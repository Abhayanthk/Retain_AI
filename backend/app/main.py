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
import shutil
import tempfile

load_dotenv()

from app.graph.builder import build_retention_graph
from app.shared import active_streams
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
    
    initial_state = {
        "raw_csv_path": event_data.get("raw_csv_path", ""),
        "questionnaire": event_data.get("questionnaire", {}),
        "iteration_count": 0,
        "discovery_attempts": 0,
        "retry_count": 0,
        "errors": [],
    }

    job_id = event_data.get("job_id")

    # Define an async runner for the graph to stream updates internally
    async def execute_and_stream():
        stream = active_streams.get(job_id) if job_id else None
        queue = stream["queue"] if stream else None
        final_state = None

        async for state in graph.astream(
            initial_state,
            config={"configurable": {"job_id": job_id}},
            stream_mode="values",
        ):
            final_state = state
            if not queue:
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

                await queue.put({
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
                await queue.put({
                    "type": "churn_profile_ready",
                    "message": "Churn profile and behavior mapping complete.",
                    "data": {
                        "churn_probability": round(curves.get("churn_probability", 0) * 100, 1),
                        "survival_curve": curves.get("survival_curve", {}),
                        "max_tenure": curves.get("max_tenure", 0),
                        "median_survival_time": curves.get("median_survival_time"),
                        "milestone_retention": curves.get("milestone_retention", {}),
                        "behavior_cohorts": state.get("behavior_cohorts", []),
                    }
                })

            elif node == "diagnosis_merge":
                diagnosis = state.get("diagnosis_results", {})
                pattern_findings = state.get("pattern_findings", {})
                q = state.get("questionnaire", {})
                await queue.put({
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
                        "total_patterns_identified": diagnosis.get("total_patterns_identified", 0),
                        "competitors": q.get("competitors", []),
                        "churn_destination": q.get("churn_destination", ""),
                    }
                })

            elif node == "simulation":
                simulations = state.get("simulations", {})
                ci = simulations.get("confidence_interval_5_95", [])
                await queue.put({
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
                            }
                            for imp in simulations.get("intervention_impacts", [])
                        ],
                    }
                })

            elif node == "execution_architect":
                await queue.put({
                    "type": "solution_ready",
                    "message": "Final playbook generated.",
                    "data": {
                        "final_playbook": state.get("final_playbook"),
                    }
                })
                
        if queue:
            await queue.put({"type": "complete", "message": "Analysis finished.", "data": {}})
            
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
            "queue": asyncio.Queue(),
            "hitl_event": asyncio.Event(),
            "hitl_answers": {},
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
    if job_id not in active_streams:
        raise HTTPException(status_code=404, detail="Job not found or already completed")

    queue = active_streams[job_id]["queue"]

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                
                yield f"data: {json.dumps(event)}\n\n"
                
                if event["type"] == "complete":
                    break
        finally:
            active_streams.pop(job_id, None)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/analyze/{job_id}/respond")
async def submit_hitl_response(job_id: str, body: Dict[str, Any] = Body(...)):
    stream = active_streams.get(job_id)
    if not stream:
        raise HTTPException(status_code=404, detail="Job not found or already completed")
    stream["hitl_answers"] = body.get("answers", {})
    stream["hitl_event"].set()
    return {"status": "ok"}


inngest.fast_api.serve(app, inngest_client, [analyze_retention_job])