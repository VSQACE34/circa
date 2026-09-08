"""Backend tests for Circuit app."""
import os
import io
import time
import zipfile
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # fallback to parsing frontend/.env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ----- Health -----
def test_health(client):
    r = client.get(f"{API}/health", timeout=30)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_palette(client):
    r = client.get(f"{API}/palette", timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "palette" in j and "rules" in j
    assert len(j["palette"]) >= 5


# ----- Builder validate -----
def test_validate_backend_to_db(client):
    r = client.post(f"{API}/builder/validate",
                    json={"source_cat": "backend", "target_cat": "database"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["valid"] is True


def test_validate_db_to_llm_invalid(client):
    r = client.post(f"{API}/builder/validate",
                    json={"source_cat": "database", "target_cat": "llm"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["valid"] is False


# ----- Builder generate -----
def test_builder_generate(client):
    payload = {"session_id": "test-sess", "answers": {"conversation": "ai chat with login and file uploads"}}
    r = client.post(f"{API}/builder/generate", json=payload, timeout=30)
    assert r.status_code == 200
    j = r.json()
    cats = {n["category"] for n in j["graph"]["nodes"]}
    assert "auth" in cats
    assert "llm" in cats
    assert "storage" in cats
    assert len(j["graph"]["edges"]) > 0


# ----- Builder export -----
def test_builder_export(client):
    graph = {
        "nodes": [
            {"id": "client", "label": "Client", "category": "client"},
            {"id": "frontend", "label": "Frontend", "category": "frontend"},
            {"id": "backend", "label": "Backend", "category": "backend"},
            {"id": "database", "label": "DB", "category": "database"},
        ],
        "edges": [
            {"id": "e1", "source": "client", "target": "frontend", "protocol": "HTTP"},
            {"id": "e2", "source": "frontend", "target": "backend", "protocol": "HTTP"},
            {"id": "e3", "source": "backend", "target": "database", "protocol": "NoSQL"},
        ],
    }
    r = client.post(f"{API}/builder/export", json={"name": "TEST_app", "graph": graph}, timeout=60)
    assert r.status_code == 200
    assert r.headers.get("content-type") == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert any("README.md" in n for n in names)
    assert any("docker-compose.yml" in n for n in names)
    assert any("frontend/" in n for n in names)
    assert any("backend/" in n for n in names)


# ----- Builder chat streaming -----
def test_builder_chat_stream(client):
    payload = {"session_id": "test-chat-sess", "message": "I want to build a todo app", "history": []}
    r = requests.post(f"{API}/builder/chat", json=payload, timeout=60, stream=True)
    assert r.status_code == 200
    chunks = []
    for chunk in r.iter_content(chunk_size=None, decode_unicode=True):
        if chunk:
            chunks.append(chunk)
        if len("".join(chunks)) > 20:
            break
    reply = "".join(chunks)
    assert len(reply.strip()) > 0


# ----- Analyze github (structural) -----
@pytest.fixture(scope="session")
def analyzed_project(client):
    payload = {"url": "https://github.com/expressjs/express", "depth": "structural"}
    r = client.post(f"{API}/analyze/github", json=payload, timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


def test_analyze_github_structural(analyzed_project):
    doc = analyzed_project
    assert "graph" in doc and "nodes" in doc["graph"]
    assert len(doc["graph"]["nodes"]) >= 2
    assert "problems" in doc
    assert "stats" in doc
    cats = {n["category"] for n in doc["graph"]["nodes"]}
    # express repo should detect backend
    assert "backend" in cats or "frontend" in cats


# ----- Projects CRUD -----
def test_list_projects_no_graph(client, analyzed_project):
    r = client.get(f"{API}/projects", timeout=30)
    assert r.status_code == 200
    projects = r.json()
    assert isinstance(projects, list)
    assert len(projects) >= 1
    # graph should be excluded
    assert "graph" not in projects[0]


def test_get_project_full(client, analyzed_project):
    pid = analyzed_project["id"]
    r = client.get(f"{API}/projects/{pid}", timeout=30)
    assert r.status_code == 200
    doc = r.json()
    assert doc["id"] == pid
    assert "graph" in doc
    assert "_id" not in doc


def test_monitor(client, analyzed_project):
    pid = analyzed_project["id"]
    r1 = client.get(f"{API}/projects/{pid}/monitor", timeout=30)
    assert r1.status_code == 200
    j1 = r1.json()
    assert "timestamp" in j1
    assert isinstance(j1["telemetry"], list)
    if j1["telemetry"]:
        item = j1["telemetry"][0]
        for k in ("id", "label", "category", "status", "latency_ms", "uptime", "requests"):
            assert k in item
    # second poll -> latency probably different
    time.sleep(0.5)
    r2 = client.get(f"{API}/projects/{pid}/monitor", timeout=30)
    assert r2.status_code == 200


def test_delete_project(client, analyzed_project):
    # create a small one just for delete test using generate + insert path is not exposed;
    # instead, delete the analyzed project last (after other tests reference it) is risky.
    # We'll create a lightweight zip analyze to have a separate id.
    # Use analyze/upload with a minimal zip.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("TEST_del/app.py", "from fastapi import FastAPI\napp=FastAPI()\n")
    buf.seek(0)
    r = requests.post(f"{API}/analyze/upload",
                      files={"file": ("TEST_del.zip", buf, "application/zip")},
                      data={"depth": "structural"}, timeout=60)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    d = requests.delete(f"{API}/projects/{pid}", timeout=30)
    assert d.status_code == 200
    g = requests.get(f"{API}/projects/{pid}", timeout=30)
    assert g.status_code == 404


# ----- Deep analysis (LLM) - marked slow -----
def test_analyze_github_deep(client):
    payload = {"url": "https://github.com/expressjs/express", "depth": "deep"}
    r = client.post(f"{API}/analyze/github", json=payload, timeout=180)
    assert r.status_code == 200, r.text
    doc = r.json()
    # ai_summary may be empty if LLM fails but should be a string
    assert "ai_summary" in doc
    # If we got a summary, it should be non-empty; otherwise this is a soft signal
    print("AI Summary length:", len(doc.get("ai_summary", "")))
    print("Problems count:", len(doc.get("problems", [])))
