"""Live capabilities: agent event ingestion/streaming + live-run boot diagnostics."""
import asyncio
import uuid
import time
from collections import deque, defaultdict
from datetime import datetime, timezone

import requests

# ---- in-memory stores (single-node dev) ----
AGENT_SUBS = defaultdict(set)          # project_id -> set[asyncio.Queue]
AGENT_EVENTS = defaultdict(lambda: deque(maxlen=200))  # project_id -> recent events
TOKENS = {}                            # project_id -> agent_token (cache)
RUNS = {}                              # run_id -> asyncio.Queue


def _now():
    return datetime.now(timezone.utc).isoformat()


# ---------------- Agent ingest / stream ----------------
def record_agent_event(pid: str, evt: dict):
    evt.setdefault("id", str(uuid.uuid4()))
    evt.setdefault("ts", _now())
    AGENT_EVENTS[pid].append(evt)
    for q in list(AGENT_SUBS[pid]):
        try:
            q.put_nowait(evt)
        except Exception:
            pass
    return evt


def agent_subscribe(pid: str) -> asyncio.Queue:
    q = asyncio.Queue()
    AGENT_SUBS[pid].add(q)
    return q


def agent_unsubscribe(pid: str, q: asyncio.Queue):
    AGENT_SUBS[pid].discard(q)


# ---------------- Live-run diagnostics ----------------
CAT_ORDER = {"client": 0, "frontend": 1, "service": 1, "backend": 2,
             "auth": 3, "database": 3, "llm": 3, "storage": 3, "cache": 3, "external": 3}


def _probe(url: str):
    t = time.time()
    try:
        r = requests.get(url, timeout=6, headers={"User-Agent": "Circuit-Run"})
        lat = round((time.time() - t) * 1000, 1)
        return {"ok": r.status_code < 400, "latency_ms": lat, "code": r.status_code}
    except Exception as e:
        return {"ok": False, "latency_ms": 0, "code": 0, "err": str(e)[:80]}


async def run_diagnostics(run_id: str, graph: dict, config: dict = None):
    q = RUNS.get(run_id)
    if q is None:
        return
    config = config or {}

    async def emit(**kw):
        kw["ts"] = _now()
        await q.put(kw)

    nodes = sorted(graph.get("nodes", []), key=lambda n: CAT_ORDER.get(n.get("category"), 2))
    edges = graph.get("edges", [])
    incoming = defaultdict(list)
    for e in edges:
        incoming[e["target"]].append(e["source"])
    label = {n["id"]: n.get("label", n["id"]) for n in nodes}

    passed, failed, diagnosis = 0, 0, []
    await emit(level="info", stage="init", message="⚡ Powering up circuit board…")
    await asyncio.sleep(0.3)

    for n in nodes:
        nid, lab, cat = n["id"], n.get("label", n["id"]), n.get("category")
        await emit(level="info", node_id=nid, node_label=lab, stage="boot", status="booting",
                   message=f"[{cat}] Booting {lab}…")
        await asyncio.sleep(0.45)

        for src in incoming.get(nid, []):
            await emit(level="info", node_id=nid, node_label=lab, stage="connect",
                       edge_source=src, edge_target=nid,
                       message=f"↳ wiring {label.get(src, src)} → {lab}")
            await asyncio.sleep(0.28)

        url = config.get(nid)
        if url:
            pr = await asyncio.to_thread(_probe, url)
            if pr["ok"]:
                passed += 1
                await emit(level="ok", node_id=nid, node_label=lab, stage="health", status="ready",
                           message=f"✓ {lab} healthy — {pr['latency_ms']}ms (HTTP {pr['code']})")
            else:
                failed += 1
                await emit(level="error", node_id=nid, node_label=lab, stage="health", status="fault",
                           message=f"✗ {lab} health check FAILED at {url} ({pr.get('err', 'HTTP ' + str(pr['code']))})")
                diagnosis.append({"node_id": nid, "title": f"{lab} failed its health check",
                                  "fix": f"Make sure {lab} is running and reachable at {url}."})
        else:
            base = n.get("status", "healthy")
            if base == "fault":
                failed += 1
                await emit(level="error", node_id=nid, node_label=lab, stage="health", status="fault",
                           message=f"✗ {lab} reported a fault during boot")
                diagnosis.append({"node_id": nid, "title": f"{lab} is faulty",
                                  "fix": "Open the Analyzer Problem Trace to auto-fix this component."})
            else:
                passed += 1
                await emit(level="ok", node_id=nid, node_label=lab, stage="health", status="ready",
                           message=f"✓ {lab} is ready")
        await asyncio.sleep(0.15)

    await emit(level=("ok" if failed == 0 else "warn"), stage="done", type="summary",
               passed=passed, failed=failed, diagnosis=diagnosis,
               message=(f"✅ All {passed} components online — circuit is stable"
                        if failed == 0 else f"⚠️ {failed} component(s) need attention"))
    await q.put(None)


# ---------------- Agent snippet templates ----------------
def python_snippet(ingest_url: str, token: str) -> str:
    return f'''# --- Circuit Live Agent (FastAPI) ---
# Paste into your app; every request streams live to Circuit.
import time, threading, requests

CIRCUIT_INGEST = "{ingest_url}"
CIRCUIT_TOKEN = "{token}"

def circuit_emit(event: dict):
    event["kind"] = event.get("kind", "request")
    threading.Thread(target=lambda: _safe_post(event), daemon=True).start()

def _safe_post(event):
    try:
        requests.post(CIRCUIT_INGEST, json=event,
                      headers={{"X-Circuit-Token": CIRCUIT_TOKEN}}, timeout=2)
    except Exception:
        pass

@app.middleware("http")
async def circuit_agent(request, call_next):
    start = time.time()
    try:
        resp = await call_next(request)
    except Exception as e:
        circuit_emit({{"kind": "error", "target": "backend",
                      "path": request.url.path, "status": 500, "message": str(e)}})
        raise
    circuit_emit({{"kind": "request", "target": "backend", "method": request.method,
                  "path": request.url.path, "status": resp.status_code,
                  "latency_ms": round((time.time() - start) * 1000, 1)}})
    return resp

# Optional: light other wires from your own code, e.g.
#   circuit_emit({{"kind": "db",  "target": "database", "message": "users.find"}})
#   circuit_emit({{"kind": "llm", "target": "llm",      "message": "chat.completion"}})
'''


def express_snippet(ingest_url: str, token: str) -> str:
    return f'''// --- Circuit Live Agent (Express) ---
// Paste after you create `app`; every request streams live to Circuit.
const CIRCUIT_INGEST = "{ingest_url}";
const CIRCUIT_TOKEN = "{token}";

function circuitEmit(event) {{
  event.kind = event.kind || "request";
  fetch(CIRCUIT_INGEST, {{
    method: "POST",
    headers: {{ "Content-Type": "application/json", "X-Circuit-Token": CIRCUIT_TOKEN }},
    body: JSON.stringify(event),
  }}).catch(() => {{}});
}}

app.use((req, res, next) => {{
  const start = Date.now();
  res.on("finish", () => {{
    circuitEmit({{ kind: res.statusCode >= 500 ? "error" : "request", target: "backend",
      method: req.method, path: req.path, status: res.statusCode,
      latency_ms: Date.now() - start }});
  }});
  next();
}});

// Optional: light other wires from your own code, e.g.
//   circuitEmit({{ kind: "db",  target: "database", message: "users.find" }});
//   circuitEmit({{ kind: "llm", target: "llm",      message: "chat.completion" }});
'''
