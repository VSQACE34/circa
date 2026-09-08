"""Iteration 3 regression tests: JWT_SECRET empty placeholder + async export-job."""
import os
import io
import time
import zipfile
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _graph_with_auth():
    return {
        "nodes": [
            {"id": "frontend", "label": "Frontend", "category": "frontend"},
            {"id": "auth", "label": "Auth", "category": "auth"},
            {"id": "backend", "label": "Backend", "category": "backend"},
            {"id": "database", "label": "DB", "category": "database"},
        ],
        "edges": [
            {"id": "e1", "source": "frontend", "target": "backend", "protocol": "HTTP"},
            {"id": "e2", "source": "backend", "target": "auth", "protocol": "HTTP"},
            {"id": "e3", "source": "backend", "target": "database", "protocol": "NoSQL"},
        ],
    }


# ---------- JWT_SECRET empty placeholder in scaffold export ----------
def test_scaffold_jwt_secret_is_empty_placeholder():
    r = requests.post(
        f"{API}/builder/export",
        json={"name": "TEST_jwt", "graph": _graph_with_auth(), "ai": False},
        timeout=60,
    )
    assert r.status_code == 200
    assert r.headers.get("content-type") == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    env_name = next((n for n in zf.namelist() if n.endswith("backend/.env.example")), None)
    assert env_name, f"backend/.env.example not found. Files: {zf.namelist()}"
    body = zf.read(env_name).decode("utf-8")
    # must contain JWT_SECRET=""
    assert 'JWT_SECRET=""' in body, f"JWT_SECRET is not empty placeholder: {body!r}"
    # must NOT contain 'change-me'
    assert "change-me" not in body.lower(), f"scaffold still uses 'change-me': {body!r}"
    # comment about how to generate should be present
    assert "openssl" in body or "generate" in body.lower()


# ---------- Async export-job endpoints (scaffold only, fast) ----------
def test_export_job_scaffold_only_flow():
    # kick off
    r = requests.post(
        f"{API}/builder/export-job",
        json={"name": "TEST_job_scaffold",
              "graph": _graph_with_auth(), "ai": False},
        timeout=30,
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    assert job_id

    # poll status
    status = None
    deadline = time.time() + 30
    while time.time() < deadline:
        s = requests.get(f"{API}/builder/export-job/{job_id}", timeout=15)
        assert s.status_code == 200
        js = s.json()
        status = js["status"]
        if status in ("done", "error"):
            break
        time.sleep(0.5)
    assert status == "done", f"job did not finish: {status}"

    # download
    d = requests.get(f"{API}/builder/export-job/{job_id}/download", timeout=30)
    assert d.status_code == 200
    assert d.headers.get("content-type") == "application/zip"
    assert d.headers.get("X-AI-Files") == "0"
    zf = zipfile.ZipFile(io.BytesIO(d.content))
    assert any("README.md" in n for n in zf.namelist())

    # Iteration 4: download no longer pops the job so files+download both work
    d2 = requests.get(f"{API}/builder/export-job/{job_id}/download", timeout=15)
    assert d2.status_code == 200


def test_export_job_status_404_for_missing_id():
    r = requests.get(f"{API}/builder/export-job/nonexistent-xyz", timeout=15)
    assert r.status_code == 404


# ---------- Async export-job AI path (hit backend directly to avoid ingress 60s) ----------
def test_export_job_ai_flow():
    # POST returns quickly (background worker does the LLM call)
    r = requests.post(
        "http://localhost:8001/api/builder/export-job",
        json={"name": "TEST_job_ai", "graph": _graph_with_auth(), "ai": True,
              "model": "claude-sonnet-4-6", "provider": "anthropic"},
        timeout=30,
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    status = None
    ai_files = 0
    deadline = time.time() + 180
    while time.time() < deadline:
        s = requests.get(f"http://localhost:8001/api/builder/export-job/{job_id}", timeout=15)
        assert s.status_code == 200
        js = s.json()
        status = js["status"]
        ai_files = js.get("ai_files", 0)
        if status in ("done", "error"):
            break
        time.sleep(2)
    assert status == "done", f"AI job status={status}, ai_files={ai_files}"
    assert ai_files > 0

    d = requests.get(f"http://localhost:8001/api/builder/export-job/{job_id}/download", timeout=30)
    assert d.status_code == 200
    assert int(d.headers.get("X-AI-Files", "0")) > 0
    zf = zipfile.ZipFile(io.BytesIO(d.content))
    assert len(zf.namelist()) > 5
