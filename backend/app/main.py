from fastapi import FastAPI, Body, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import uuid
import traceback
import inngest
import inngest.fast_api
import asyncio
import json
import math
import os
import pathlib
import shutil
import tempfile

load_dotenv()

# Re-link ONNX model cache into project dir so Render preserves it across cold
# starts. Chroma's default embedder downloads ~80MB to ~/.cache/chroma at first
# query; on ephemeral filesystems that download repeats every restart and the
# spike OOM-kills the process. Build step pre-warms the project-dir cache; this
# symlink makes runtime Chroma find it.
_onnx_cache_target = pathlib.Path(__file__).resolve().parent / "rag" / "onnx_cache"
if _onnx_cache_target.exists():
    _onnx_cache_link = pathlib.Path.home() / ".cache" / "chroma"
    if not _onnx_cache_link.exists():
        _onnx_cache_link.parent.mkdir(parents=True, exist_ok=True)
        try:
            _onnx_cache_link.symlink_to(_onnx_cache_target)
        except OSError:
            pass

from app.graph.builder import build_retention_graph
from app.shared import active_streams, push_event, JobCancelled
from typing import Dict, Any

UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "retain_ai_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _sanitize(obj):
    """Recursively replace NaN/Infinity with None so the result is valid JSON."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj

app = FastAPI(title="Retain AI Backend")


@app.on_event("startup")
def _prewarm_rag() -> None:
    """Load Chroma + the ONNX embedder in the background at boot.

    First rag query otherwise pays ~5-30s of lazy model loading mid-pipeline —
    on Render free tier that cost recurs after every spin-down.
    """
    import threading

    def _warm():
        try:
            from app.rag.store import retrieve
            retrieve("warmup", k=1)
            print("[startup] RAG prewarm complete", flush=True)
        except Exception as e:
            print(f"[startup] RAG prewarm failed (non-fatal): {e}", flush=True)

    threading.Thread(target=_warm, daemon=True, name="rag-prewarm").start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create an Inngest client
inngest_client = inngest.Inngest(
    app_id="fast_api_example",
#     logger=logging.getLogger("uvicorn"),
)

@inngest_client.create_function(
    fn_id="analyze_retention_job",
    # Event that triggers this function
    trigger=inngest.TriggerEvent(event="app/analyze"),
)
async def analyze_retention_job(*args, **kwargs):
    ctx = kwargs.get('ctx') or (args[0] if len(args) > 0 else None)
    step = kwargs.get('step') or getattr(ctx, 'step', None)
    
    if not step:
        raise ValueError("Inngest step runner could not be resolved from context or arguments.")
    
    event_data = getattr(ctx, 'event', None)
    event_data = event_data.data if event_data else {}
    
    job_id = event_data.get("job_id")

    initial_state = {
        "raw_csv_path": event_data.get("raw_csv_path", ""),
        "questionnaire": event_data.get("questionnaire", {}),
        "job_id": job_id,
        "iteration_count": 0,
        "discovery_attempts": 0,
        "retry_count": 0,
        "errors": [],
    }

    # Define an async runner for the graph to stream updates internally
    async def execute_and_stream():
        stream = active_streams.get(job_id) if job_id else None
        final_state = None

        def _schedule_cleanup():
            # Keep the event history around briefly so a refresh right at
            # completion can still replay it; frontend snapshot handles later visits.
            try:
                asyncio.get_running_loop().call_later(120, active_streams.pop, job_id, None)
            except Exception:
                active_streams.pop(job_id, None)

        try:
            async for state in graph.astream(
                initial_state,
                config={"configurable": {"job_id": job_id}},
                stream_mode="values",
            ):
                final_state = state
                if not stream:
                    continue

                node = state.get("current_node")

                if node == "feature_engineering":
                    fs = state.get("feature_store", {})
                    risk = fs.get("predictive_churn_risk", {})
                    has_model = "high_risk_customers_count" in risk and "error" not in risk

                    high_risk = risk.get("high_risk_customers_count", 0)
                    total = risk.get("total_active_evaluated", 0)
                    pct = risk.get("risk_segment_pct", 0)

                    if has_model:
                        if pct > 0.3:
                            insight = f"{high_risk} users ({round(pct*100)}%) show high churn probability in the near term"
                        elif pct > 0.1:
                            insight = f"A focused segment of {high_risk} users is driving most immediate churn risk"
                        elif high_risk > 0:
                            insight = f"{high_risk} users identified with significantly shorter expected lifetime"
                        else:
                            insight = "No immediate high-risk patterns detected — monitoring recommended"
                    else:
                        insight = "Risk model could not be trained — ensure your dataset has churn and tenure columns"

                    push_event(job_id, {
                        "type": "risk_ready",
                        "message": "Risk analysis complete.",
                        "data": {
                            "high_risk_count": high_risk,
                            "total_active": total,
                            "risk_pct": round(pct * 100, 1),
                            "confidence": round(risk.get("concordance_index", 0) * 100) if has_model else 0,
                            "insight": insight,
                            "has_model": has_model,
                            "feature_store": {
                                "ltv_estimates": fs.get("ltv_estimates", {}),
                                "velocity_metrics": fs.get("velocity_metrics", {}),
                                "engagement_cohorts": fs.get("engagement_cohorts", {}),
                                "rfm_scores": fs.get("rfm_scores", {}),
                            },
                            "data_quality_score": fs.get("data_quality_score", 0),
                            "data_quality_logs": fs.get("data_quality_logs", []),
                            "input_context": state.get("input_context", {}),
                        }
                    })

                elif node == "behavioral_map":
                    curves = state.get("behavior_curves", {})
                    push_event(job_id, {
                        "type": "churn_profile_ready",
                        "message": "Churn profile and behavior mapping complete.",
                        "data": {
                            "churn_probability": round(curves.get("churn_probability", 0) * 100, 1),
                            "survival_curve": curves.get("survival_curve", {}),
                            "max_tenure": curves.get("max_tenure", 0),
                            "median_survival_time": curves.get("median_survival_time"),
                            "milestone_retention": curves.get("milestone_retention", {}),
                            "milestone_metadata": curves.get("milestone_metadata", {}),
                            "behavior_cohorts": state.get("behavior_cohorts", []),
                        }
                    })

                elif node == "diagnosis_merge":
                    diagnosis = state.get("diagnosis_results", {})
                    pattern_findings = state.get("pattern_findings", {})
                    q = state.get("questionnaire", {})
                    fs = state.get("feature_store", {}) or {}
                    driver_features = (fs.get("predictive_churn_risk", {}) or {}).get("driver_features", []) or []
                    push_event(job_id, {
                        "type": "diagnosis_ready",
                        "message": "Core problems diagnosed.",
                        "data": {
                            "merged_hypotheses": diagnosis.get("merged_hypotheses", []),
                            "forensic_findings": diagnosis.get("forensic_findings", []),
                            "pattern_findings": diagnosis.get("pattern_findings", []),
                            "skeptic_findings": diagnosis.get("skeptic_findings", []),
                            "user_segments": (
                                pattern_findings.get("user_segments", [])
                                if isinstance(pattern_findings, dict) else []
                            ),
                            "top_segments": state.get("top_segments", []),
                            "driver_features": driver_features,
                            "total_patterns_identified": diagnosis.get("total_patterns_identified", 0),
                            "competitors": q.get("competitors", []),
                            "churn_destination": q.get("churn_destination", ""),
                            "competitor_research": diagnosis.get("competitor_research", {}),
                        }
                    })

                elif node == "simulation":
                    simulations = state.get("simulations", {})
                    ci = simulations.get("confidence_interval_5_95", [])
                    push_event(job_id, {
                        "type": "simulation_ready",
                        "message": "Monte Carlo simulation complete.",
                        "data": {
                            "expected_lift": simulations.get("expected_lift", 0),
                            "confidence_low": ci[0] if len(ci) > 0 else 0,
                            "confidence_high": ci[1] if len(ci) > 1 else 0,
                            "expected_roi": simulations.get("expected_roi", 0),
                            "iterations": simulations.get("iterations", 0),
                            "interventions": [
                                {
                                    "name": imp.get("intervention", ""),
                                    "p10": imp.get("percentile_10", 0),
                                    "mean": imp.get("mean_lift", 0),
                                    "p90": imp.get("percentile_90", 0),
                                    "lift_prior_anchor": imp.get("lift_prior_anchor"),
                                    "lift_prior_pct": imp.get("lift_prior_pct"),
                                    "lift_prior_citations": imp.get("lift_prior_citations", []),
                                }
                                for imp in simulations.get("intervention_impacts", [])
                            ],
                            "rag_anchored_count": (
                                simulations.get("simulation_summary", {}).get("rag_anchored_count", 0)
                            ),
                            "strategy_skeptic": state.get("strategy_skeptic_output", {}),
                        }
                    })

                elif node == "execution_architect":
                    push_event(job_id, {
                        "type": "solution_ready",
                        "message": "Final playbook generated.",
                        "data": {
                            "final_playbook": state.get("final_playbook"),
                            "evidence_dossier": state.get("evidence_dossier", []),
                        }
                    })

            if stream:
                push_event(job_id, {"type": "complete", "message": "Analysis finished.", "data": {}})
                _schedule_cleanup()
        except JobCancelled as e:
            print(f"[CANCEL] job {job_id} cancelled mid-pipeline", flush=True)
            if stream:
                push_event(job_id, {
                    "type": "cancelled",
                    "message": "Analysis cancelled by user.",
                    "data": {"job_id": job_id},
                })
                push_event(job_id, {"type": "complete", "message": "Cancelled.", "data": {}})
                _schedule_cleanup()
            return _sanitize(final_state)
        except Exception as e:
            print(f"[ERROR] pipeline failed for job {job_id}: {type(e).__name__}: {e}", flush=True)
            traceback.print_exc()
            if stream:
                push_event(job_id, {
                    "type": "error",
                    "message": "Analysis failed.",
                    "data": {
                        "error_type": type(e).__name__,
                        "error_message": str(e),
                        "last_node": (final_state or {}).get("current_node"),
                    },
                })
                push_event(job_id, {"type": "complete", "message": "Failed.", "data": {}})
                _schedule_cleanup()
            raise

        return _sanitize(final_state)

    try:
        # Run async stream invocation within an inngest step
        final_state = await step.run("execute_langgraph", execute_and_stream)
        return {"status": "success", "result": final_state}
    except Exception as e:
        ctx.logger.error(f"Error in background job: {str(e)}\n{traceback.format_exc()}")
        raise e


graph = build_retention_graph()

@app.get("/")
async def root():
    return {"message": "Retain AI Backend running"}

@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        file_extension = os.path.splitext(file.filename)[1]
        temp_filename = f"{uuid.uuid4().hex}{file_extension}"
        temp_filepath = os.path.join(UPLOAD_DIR, temp_filename)
        
        with open(temp_filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        return {"status": "success", "file_path": temp_filename, "original_name": file.filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/analyze")
async def run_analysis(
    req_body: Dict[str, Any] = Body(
        ...,
        examples=[{
            "raw_csv_path": "data/sample.csv",
            "questionnaire": {"industry": "SaaS", "size": "100-500"}
        }]
    )
):
    try:
        job_id = str(uuid.uuid4())
        active_streams[job_id] = {
            "events": [],        # append-only history; SSE readers replay from their cursor
            "subscribers": [],   # asyncio.Event wake signals, one per open SSE connection
            "hitl_event": asyncio.Event(),
            "hitl_answers": {},
            "cancelled": False,
        }
        req_body["job_id"] = job_id
        
        # Send event to Inngest to trigger the background job
        await inngest_client.send(
            inngest.Event(
                name="app/analyze",
                data=req_body
            )
        )
        return {"status": "queued", "job_id": job_id, "message": "Analysis started in background"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e) + "\n" + traceback.format_exc())

@app.get("/analyze/stream/{job_id}")
async def stream_job(job_id: str, request: Request):
    stream = active_streams.get(job_id)
    if stream is None:
        raise HTTPException(status_code=404, detail="Job not found or already completed")

    async def event_generator():
        # Broadcast model: replay full history from cursor 0, then follow live.
        # A page refresh gets every event again (frontend stagesData is keyed
        # by event type, so replay is idempotent). No event is ever consumed —
        # the old Queue design lost events into the dying connection's socket.
        wake = asyncio.Event()
        subscribers = stream.setdefault("subscribers", [])
        subscribers.append(wake)
        cursor = 0
        try:
            while True:
                wake.clear()
                events = stream.get("events", [])
                terminal = False
                while cursor < len(events):
                    event = events[cursor]
                    cursor += 1
                    yield f"data: {json.dumps(event)}\n\n"
                    # `error` and `cancelled` are followed by `complete`; treat
                    # any of them as terminal in case the worker crashed early.
                    if event.get("type") in ("complete", "cancelled", "error"):
                        terminal = True
                        break
                if terminal:
                    break
                if await request.is_disconnected():
                    break
                try:
                    await asyncio.wait_for(wake.wait(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Heartbeat keeps Render / proxy from killing the idle SSE connection
                    yield ": heartbeat\n\n"
        except Exception:
            pass
        finally:
            try:
                subscribers.remove(wake)
            except ValueError:
                pass
        # active_streams cleanup happens in the worker (_schedule_cleanup, 120s
        # after `complete`) — never here, so reconnects can still replay.

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/analyze/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Signal the running pipeline to stop. Wrapper in builder.py checks the
    `cancelled` flag before every node and raises `JobCancelled`; the worker
    catches that and pushes a `cancelled` SSE event then `complete`."""
    stream = active_streams.get(job_id)
    if not stream:
        raise HTTPException(status_code=404, detail="Job not found or already completed")
    stream["cancelled"] = True
    # Unblock any HITL wait so the cancellation can propagate immediately.
    hitl_event = stream.get("hitl_event")
    if hitl_event:
        hitl_event.set()
    print(f"[CANCEL] flagged job {job_id}", flush=True)
    return {"status": "ok", "job_id": job_id, "cancelled": True}

@app.post("/analyze/{job_id}/respond")
async def submit_hitl_response(job_id: str, body: Dict[str, Any] = Body(...)):
    stream = active_streams.get(job_id)
    if not stream:
        raise HTTPException(status_code=404, detail="Job not found or already completed")
    stream["hitl_answers"] = body.get("answers", {})
    stream["hitl_event"].set()
    return {"status": "ok"}


inngest.fast_api.serve(app, inngest_client, [analyze_retention_job])