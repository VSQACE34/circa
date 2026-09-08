export function pythonSnippet(ingestUrl, token) {
  return `# --- Circuit Live Agent (FastAPI) ---
# Paste into your app; every request streams live to Circuit.
import time, threading, requests

CIRCUIT_INGEST = "${ingestUrl}"
CIRCUIT_TOKEN = "${token}"

def circuit_emit(event: dict):
    event["kind"] = event.get("kind", "request")
    threading.Thread(target=lambda: _safe_post(event), daemon=True).start()

def _safe_post(event):
    try:
        requests.post(CIRCUIT_INGEST, json=event,
                      headers={"X-Circuit-Token": CIRCUIT_TOKEN}, timeout=2)
    except Exception:
        pass

@app.middleware("http")
async def circuit_agent(request, call_next):
    start = time.time()
    try:
        resp = await call_next(request)
    except Exception as e:
        circuit_emit({"kind": "error", "target": "backend",
                      "path": request.url.path, "status": 500, "message": str(e)})
        raise
    circuit_emit({"kind": "request", "target": "backend", "method": request.method,
                  "path": request.url.path, "status": resp.status_code,
                  "latency_ms": round((time.time() - start) * 1000, 1)})
    return resp

# Optional: light other wires from your own code, e.g.
#   circuit_emit({"kind": "db",  "target": "database", "message": "users.find"})
#   circuit_emit({"kind": "llm", "target": "llm",      "message": "chat.completion"})`;
}

export function expressSnippet(ingestUrl, token) {
  return `// --- Circuit Live Agent (Express) ---
// Paste after you create \`app\`; every request streams live to Circuit.
const CIRCUIT_INGEST = "${ingestUrl}";
const CIRCUIT_TOKEN = "${token}";

function circuitEmit(event) {
  event.kind = event.kind || "request";
  fetch(CIRCUIT_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Circuit-Token": CIRCUIT_TOKEN },
    body: JSON.stringify(event),
  }).catch(() => {});
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    circuitEmit({ kind: res.statusCode >= 500 ? "error" : "request", target: "backend",
      method: req.method, path: req.path, status: res.statusCode,
      latency_ms: Date.now() - start });
  });
  next();
});

// Optional: light other wires from your own code, e.g.
//   circuitEmit({ kind: "db",  target: "database", message: "users.find" });
//   circuitEmit({ kind: "llm", target: "llm",      message: "chat.completion" });`;
}
