"""
Node 5d: Competitor Research (conditional)
===========================================
Runs only when questionnaire.churn_destination names a known competitor.
Retrieves competitor-positioning chunks from RAG (topic: competitor_positioning)
and surfaces a counter-positioning summary that strategy agents + the architect
can consume.

Wired in builder.py as a parallel fan-out from `behavioral_map`, fan-in at
`diagnosis_merge`.
"""

from __future__ import annotations

from app.graph.state import RetentionGraphState
from app.rag.store import retrieve as rag_retrieve


# Lowercased competitor name → optional canonical label. Substring match against
# questionnaire.churn_destination. Keep small + curated; extend over time.
KNOWN_COMPETITORS: dict[str, str] = {
    "slack": "Slack",
    "microsoft teams": "Microsoft Teams",
    "teams": "Microsoft Teams",
    "hubspot": "HubSpot",
    "salesforce": "Salesforce",
    "pipedrive": "Pipedrive",
    "intercom": "Intercom",
    "zendesk": "Zendesk",
    "freshdesk": "Freshdesk",
    "drift": "Drift",
    "notion": "Notion",
    "confluence": "Confluence",
    "asana": "Asana",
    "jira": "Jira",
    "trello": "Trello",
    "linear": "Linear",
    "monday": "Monday.com",
    "mailchimp": "Mailchimp",
    "klaviyo": "Klaviyo",
    "convertkit": "ConvertKit",
    "marketo": "Marketo",
    "pardot": "Pardot",
    "zoom": "Zoom",
    "google meet": "Google Meet",
    "webex": "Webex",
    "figma": "Figma",
    "sketch": "Sketch",
    "adobe xd": "Adobe XD",
    "stripe": "Stripe",
    "square": "Square",
    "shopify": "Shopify",
    "bigcommerce": "BigCommerce",
    "webflow": "Webflow",
    "squarespace": "Squarespace",
    "calendly": "Calendly",
    "discord": "Discord",
    "loom": "Loom",
    "vidyard": "Vidyard",
    "microsoft": "Microsoft",
    "google": "Google",
    "adobe": "Adobe",
    "atlassian": "Atlassian",
}


def _match_competitor(churn_destination: str) -> str | None:
    """Substring match (case-insensitive). Returns canonical label or None."""
    if not churn_destination:
        return None
    needle = churn_destination.strip().lower()
    if not needle or needle in {"unknown", "none", "n/a"}:
        return None
    # Try direct hit first, then substring scan.
    if needle in KNOWN_COMPETITORS:
        return KNOWN_COMPETITORS[needle]
    for key, label in KNOWN_COMPETITORS.items():
        if key in needle:
            return label
    return None


def competitor_research_node(state: RetentionGraphState) -> dict:
    """Surface competitor-positioning RAG chunks when destination is a known rival."""
    q = state.get("questionnaire", {}) or {}
    churn_destination = str(q.get("churn_destination", "") or "")
    competitor = _match_competitor(churn_destination)

    if competitor is None:
        return {
            "competitor_research_output": {
                "matched": False,
                "churn_destination": churn_destination,
                "competitor": None,
                "evidence": [],
                "counter_positioning": [],
            },
            "current_node": "competitor_research",
        }

    business_model = q.get("business_model", "SaaS")
    industry = q.get("business_context", q.get("industry", "SaaS"))
    query = (
        f"Counter-positioning, retention, and switching-cost defense when customers "
        f"churn to {competitor}. Industry: {industry}. Business model: {business_model}."
    )

    try:
        hits = rag_retrieve(
            query,
            k=4,
            signals=["competitor_threat", "switching_to_incumbent", "bundling_loss"],
        )
    except Exception as e:
        return {
            "competitor_research_output": {
                "matched": True,
                "competitor": competitor,
                "churn_destination": churn_destination,
                "evidence": [],
                "counter_positioning": [],
                "error": f"RAG retrieve failed: {e}",
            },
            "current_node": "competitor_research",
        }

    # Trim retrieved chunks to the competitor-positioning ones first; fall back to all.
    positioning = [h for h in hits if h.get("topic") == "competitor_positioning"]
    chosen = positioning or hits

    evidence = [
        {
            "id": h.get("id"),
            "source": h.get("source"),
            "topic": h.get("topic"),
            "score": h.get("score"),
            "snippet": (h.get("text") or "")[:400],
        }
        for h in chosen[:3]
    ]

    # Extract concrete counter-plays from the retrieved text — simple sentence split on
    # the phrase "Counter-play" or "Counter-positioning" to give strategy agents a
    # discrete list rather than a wall of text.
    counter_positioning: list[str] = []
    for h in chosen:
        text = h.get("text") or ""
        for marker in ("Counter-play:", "Counter-positioning:"):
            idx = text.find(marker)
            if idx >= 0:
                counter_positioning.append(text[idx + len(marker):].strip()[:300])
                break

    return {
        "competitor_research_output": {
            "matched": True,
            "competitor": competitor,
            "churn_destination": churn_destination,
            "evidence": evidence,
            "counter_positioning": counter_positioning,
        },
        "current_node": "competitor_research",
    }
