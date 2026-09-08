"""Iteration 5 tests: Live Agent + Live Run Diagnostics (SSE)."""
import os
import json
import time
import uuid
import threading
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


# ---------------- helpers ----------------
def _create_project():
    """Create a small project via analyzer to get a real project id."""
    # Use a tiny existing project via GitHub is slow; use a saved graph instead.
    # Easiest: use analyzer.github with a small repo? Too slow. Instead, insert via analyze/upload
    # of a tiny zip.
    import io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("app/main.py", "from fastapi import FastAPI\napp=FastAPI()\n")
        z.writestr("frontend/package.json", '{"name":"x","dependencies":{"react":"^18"}}')
    buf.seek(0)
    r = requests.post(f"{BASE_URL}/api/analyze/upload",
                      files={"file": ("TEST_iter5.zip", buf.getvalue(), "application/zip")},
                      data={"depth": "structural"}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def project():
    return _create_project()


# ---------------- LIVE AGENT ----------------
class TestLiveAgent:
    def test_generate_token(self, project):
        pid = project["id"]
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/agent/token", timeout=15)
        assert r.status_code == 200
        tok = r.json()["token"]
        assert tok.startswith("cir_")

    def test_get_agent_returns_existing(self, project):
        pid = project["id"]
        r1 = requests.get(f"{BASE_URL}/api/projects/{pid}/agent", timeout=15)
        assert r1.status_code == 200
        t1 = r1.json()["token"]
        assert t1.startswith("cir_")
        # Second call returns same (persistent) token
        r2 = requests.get(f"{BASE_URL}/api/projects/{pid}/agent", timeout=15)
        assert r2.json()["token"] == t1

    def test_get_agent_404_for_bad_project(self):
        r = requests.get(f"{BASE_URL}/api/projects/nope-{uuid.uuid4().hex[:8]}/agent", timeout=15)
        assert r.status_code == 404

    def test_ingest_requires_token(self, project):
        pid = project["id"]
        # get token
        tok = requests.get(f"{BASE_URL}/api/projects/{pid}/agent", timeout=15).json()["token"]

        # missing token -> 401
        r = requests.post(f"{BASE_URL}/api/agent/{pid}/ingest",
                          json={"kind": "request", "target": "backend", "path": "/x", "status": 200}, timeout=10)
        assert r.status_code == 401

        # wrong token -> 401
        r = requests.post(f"{BASE_URL}/api/agent/{pid}/ingest",
                          headers={"X-Circuit-Token": "cir_bogus"},
                          json={"kind": "request"}, timeout=10)
        assert r.status_code == 401

        # correct token -> 200
        r = requests.post(f"{BASE_URL}/api/agent/{pid}/ingest",
                          headers={"X-Circuit-Token": tok},
                          json={"kind": "request", "target": "backend",
                                "method": "GET", "path": "/api/x", "status": 200,
                                "latency_ms": 12}, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert "id" in body

    def test_events_endpoint(self, project):
        pid = project["id"]
        tok = requests.get(f"{BASE_URL}/api/projects/{pid}/agent", timeout=15).json()["token"]
        # push an error event
        requests.post(f"{BASE_URL}/api/agent/{pid}/ingest",
                      headers={"X-Circuit-Token": tok},
                      json={"kind": "error", "target": "backend",
                            "status": 500, "message": "boom"}, timeout=10)
        r = requests.get(f"{BASE_URL}/api/agent/{pid}/events", timeout=10)
        assert r.status_code == 200
        events = r.json()["events"]
        assert any(e.get("kind") == "error" and e.get("status") == 500 for e in events)

    def test_stream_sse(self, project):
        """Open SSE stream, then POST an event; verify it arrives."""
        pid = project["id"]
        tok = requests.get(f"{BASE_URL}/api/projects/{pid}/agent", timeout=15).json()["token"]
        seen = []
        target_msg = f"stream-test-{uuid.uuid4().hex[:6]}"

        def read_stream():
            with requests.get(f"{BASE_URL}/api/agent/{pid}/stream",
                              stream=True, timeout=15) as resp:
                assert resp.status_code == 200
                assert "text/event-stream" in resp.headers.get("content-type", "")
                start = time.time()
                for line in resp.iter_lines(decode_unicode=True):
                    if line and line.startswith("data: "):
                        try:
                            payload = json.loads(line[6:])
                            seen.append(payload)
                            if payload.get("message") == target_msg:
                                return
                        except Exception:
                            pass
                    if time.time() - start > 10:
                        return

        t = threading.Thread(target=read_stream, daemon=True)
        t.start()
        time.sleep(1.0)  # let subscriber attach
        r = requests.post(f"{BASE_URL}/api/agent/{pid}/ingest",
                          headers={"X-Circuit-Token": tok},
                          json={"kind": "request", "target": "backend",
                                "path": "/stream-check", "status": 200,
                                "message": target_msg}, timeout=10)
        assert r.status_code == 200
        t.join(timeout=12)
        assert any(e.get("message") == target_msg for e in seen), f"target event not seen; got {len(seen)} events"


# ---------------- LIVE RUN ----------------
class TestLiveRun:
    def _graph(self, fault_node=False):
        nodes = [
            {"id": "fe", "label": "Frontend", "category": "frontend"},
            {"id": "be", "label": "Backend", "category": "backend"},
            {"id": "db", "label": "Database", "category": "database"},
        ]
        if fault_node:
            # inject a node whose base status=fault
            nodes.append({"id": "bad", "label": "BadService", "category": "service"})
        return {
            "nodes": nodes,
            "edges": [
                {"id": "e1", "source": "fe", "target": "be"},
                {"id": "e2", "source": "be", "target": "db"},
            ]
        }

    def test_start_and_stream(self):
        graph = self._graph()
        # give backend node a real reachable URL for a real probe
        cfg = {"be": "https://example.com"}
        r = requests.post(f"{BASE_URL}/api/run/start",
                          json={"name": "TEST_run", "graph": graph, "config": cfg}, timeout=15)
        assert r.status_code == 200, r.text
        run_id = r.json()["run_id"]

        events = []
        with requests.get(f"{BASE_URL}/api/run/{run_id}/stream",
                          stream=True, timeout=60) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")
            for line in resp.iter_lines(decode_unicode=True):
                if line and line.startswith("data: "):
                    payload = json.loads(line[6:])
                    events.append(payload)
                    if payload.get("type") == "end":
                        break

        # We got a full lifecycle
        stages = {e.get("stage") for e in events}
        assert "init" in stages
        assert "boot" in stages
        assert "connect" in stages
        assert "health" in stages
        assert "done" in stages

        # Summary present
        summary = [e for e in events if e.get("type") == "summary"]
        assert summary, "missing summary event"
        s = summary[0]
        assert "passed" in s and "failed" in s and "diagnosis" in s

        # Real probe: backend node ok with latency>0 and code=200 (example.com)
        be_health = [e for e in events if e.get("stage") == "health" and e.get("node_id") == "be"]
        assert be_health
        assert be_health[0]["level"] == "ok"
        assert "HTTP 200" in be_health[0]["message"] or "HTTP" in be_health[0]["message"]

        # end event terminates
        assert events[-1].get("type") == "end"

    def test_run_fault_node_in_diagnosis(self):
        # simulate fault: pass an unreachable URL to force fault path
        graph = self._graph()
        cfg = {"be": "http://127.0.0.1:1/definitely-not-listening"}
        r = requests.post(f"{BASE_URL}/api/run/start",
                          json={"name": "TEST_run_fail", "graph": graph, "config": cfg}, timeout=15)
        run_id = r.json()["run_id"]

        events = []
        with requests.get(f"{BASE_URL}/api/run/{run_id}/stream",
                          stream=True, timeout=60) as resp:
            for line in resp.iter_lines(decode_unicode=True):
                if line and line.startswith("data: "):
                    payload = json.loads(line[6:])
                    events.append(payload)
                    if payload.get("type") == "end":
                        break

        summary = next(e for e in events if e.get("type") == "summary")
        assert summary["failed"] >= 1
        assert any(d.get("node_id") == "be" for d in summary["diagnosis"])

    def test_run_stream_404(self):
        r = requests.get(f"{BASE_URL}/api/run/nope-{uuid.uuid4().hex[:8]}/stream", timeout=10)
        assert r.status_code == 404


# ---------------- Regression: strict payload 422 ----------------
class TestRegressionStrict:
    def test_validate_missing_fields(self):
        r = requests.post(f"{BASE_URL}/api/builder/validate", json={}, timeout=10)
        assert r.status_code == 422

    def test_export_missing_graph(self):
        r = requests.post(f"{BASE_URL}/api/builder/export", json={"name": "x"}, timeout=10)
        assert r.status_code == 422

    def test_run_missing_graph(self):
        r = requests.post(f"{BASE_URL}/api/run/start", json={"name": "x"}, timeout=10)
        assert r.status_code == 422


# ---------------- Regression: circuits still work ----------------
class TestRegressionCircuits:
    def test_list_circuits(self):
        r = requests.get(f"{BASE_URL}/api/circuits", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_palette(self):
        r = requests.get(f"{BASE_URL}/api/palette", timeout=10)
        assert r.status_code == 200
        assert "palette" in r.json()
