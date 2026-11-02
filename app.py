"""CareGraph — Healthcare Intelligence Powered by Graph Analytics

Web application providing on-demand healthcare facility discovery,
conservative triage routing, and proximity graph topology using live
public data from OpenStreetMap, OSRM, CMS Care Compare, and NPPES.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from live_services import LiveSourceError, discover, official_detail, recommend
from triage import CONCERNS, assess, filter_facilities

app = Flask(__name__)
LOG_PATH = Path(__file__).parent / "logs" / "usage.jsonl"


def record(event: str, payload: dict, count: int = 0) -> None:
    """Record query telemetry into local privacy-preserving JSON-lines audit file."""
    LOG_PATH.parent.mkdir(exist_ok=True)
    item = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "event": event,
        "zip": payload.get("zip", ""),
        "transport": payload.get("mode", "drive"),
        "concerns": payload.get("concerns", []),
        "results": count,
    }
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item) + "\n")


def read_logs() -> list[dict]:
    """Read the latest 100 activity records from the local audit log."""
    if not LOG_PATH.exists():
        return []
    lines = [
        json.loads(line)
        for line in LOG_PATH.read_text(encoding="utf-8").splitlines()[-100:]
        if line.strip()
    ]
    return list(reversed(lines))


# ---------------------------------------------------------------------------
# View Routes
# ---------------------------------------------------------------------------

@app.get("/")
def navigator():
    """Find care & topological proximity graph analytics."""
    return render_template("navigator.html")


@app.get("/care-guide")
def care_guide():
    """Conservative symptom triage and clinical routing."""
    return render_template("care_guide.html", concerns=CONCERNS)


@app.get("/nj-recommender")
def nj_recommender():
    """Regional hospital access recommender with CMS throughput weighting."""
    return render_template("recommender.html")


@app.get("/facility")
def facility():
    """Verified official profile with CMS and NPPES registry check."""
    return render_template("facility.html", facility=request.args)


@app.get("/logs")
def activity():
    """Local privacy-preserving audit trail."""
    return render_template("logs.html", rows=read_logs())


@app.get("/sources")
def sources():
    """Public data sources, architecture transparency, and limits."""
    return render_template("sources.html")


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

def live(payload: dict, regional: bool = False):
    """Execute live facility discovery or regional access recommendation."""
    try:
        if regional:
            result = recommend(
                payload.get("zip", ""),
                payload.get("mode", "drive"),
                payload.get("radius", 200),
            )
        else:
            result = discover(
                payload.get("zip", ""),
                payload.get("mode", "drive"),
                payload.get("radius", 15),
            )
        return result, None
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except LiveSourceError as exc:
        return jsonify({"error": str(exc)}), 503


@app.post("/api/discover")
def api_discover():
    """Discover nearby hospitals and urgent-care facilities with live OSRM routes."""
    payload = request.get_json(silent=True) or {}
    result, error = live(payload)
    if error:
        return result, error
    record("facility_search", payload, len(result["facilities"]))
    return jsonify(result)


@app.post("/api/care-guide")
def api_care():
    """Filter facilities based on non-diagnostic triage guidelines."""
    payload = request.get_json(silent=True) or {}
    valid_concerns = dict(CONCERNS)
    payload["concerns"] = [x for x in payload.get("concerns", []) if x in valid_concerns]
    result, error = live(payload)
    if error:
        return result, error
    result["assessment"] = assess(payload["concerns"])
    result["facilities"], result["care_filter"] = filter_facilities(
        payload["concerns"], result["facilities"]
    )
    record("care_guide", payload, len(result["facilities"]))
    return jsonify(result)


@app.post("/api/recommend")
def api_recommend():
    """Generate regional hospital access rankings with CMS historical throughput."""
    payload = request.get_json(silent=True) or {}
    result, error = live(payload, regional=True)
    if error:
        return result, error
    record("nj_recommender", payload, len(result["hospitals"]))
    return jsonify(result)


@app.post("/api/facility-detail")
def api_detail():
    """Fetch live CMS Care Compare and NPPES registry details for a facility."""
    payload = request.get_json(silent=True) or {}
    try:
        result = official_detail(
            payload.get("name", ""),
            payload.get("city", ""),
            payload.get("state", ""),
        )
    except LiveSourceError as exc:
        return jsonify({"error": str(exc)}), 503
    record("facility_detail", payload, 1)
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5055)
