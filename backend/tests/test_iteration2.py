"""Iteration 2 tests for Circuit: monitor config live probe, deep drill-down, AI codegen."""
import os
import io
import zipfile
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def deep_project():
    """Analyze a repo with DB models to test drill-down."""
    payload = {"url": "https://github.com/gothinkster/node-express-realworld-example-app",
               "depth": "structural"}
    r = requests.post(f"{API}/analyze/github", json=payload, timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Real monitoring ----------
class TestRealMonitoring:
    def test_set_config_and_live_probe(self, deep_project):
        pid = deep_project["id"]
        backend_node = next(
            (n for n in deep_project["graph"]["nodes"] if n["category"] == "backend"), None)
        assert backend_node, "No backend node in graph"
        nid = backend_node["id"]
        # save config
        r = requests.post(f"{API}/projects/{pid}/monitor/config",
                          json={"config": {nid: "https://example.com"}}, timeout=30)
        assert r.status_code == 200
        assert r.json()["saved"] is True
        # poll monitor
        r2 = requests.get(f"{API}/projects/{pid}/monitor", timeout=30)
        assert r2.status_code == 200
        tele = r2.json()["telemetry"]
        live = [t for t in tele if t["id"] == nid][0]
        assert live["source"] == "live"
        assert live["latency_ms"] > 0
        assert live["code"] and live["code"] < 500
        # other nodes without config -> simulated
        others = [t for t in tele if t["id"] != nid]
        assert all(t["source"] == "simulated" for t in others)

    def test_config_404_for_missing_project(self):
        r = requests.post(f"{API}/projects/nonexistent-abc/monitor/config",
                          json={"config": {"x": "https://example.com"}}, timeout=30)
        assert r.status_code == 404


# ---------- Deep drill-down ----------
class TestDeepDrilldown:
    def test_database_and_backend_meta(self, deep_project):
        graph = deep_project["graph"]
        stats = deep_project["stats"]
        assert "tables" in stats
        # database nodes should have meta.tables + has_children
        db_nodes = [n for n in graph["nodes"] if n["category"] == "database"]
        # backend meta.endpoint_list
        be_nodes = [n for n in graph["nodes"] if n["category"] == "backend"]
        assert be_nodes, "No backend nodes"
        assert any(n.get("meta", {}).get("endpoint_list") for n in be_nodes), \
            "No backend has endpoint_list"
        # subgraphs
        subs = graph.get("subgraphs", {})
        assert isinstance(subs, dict)
        # at least one backend/frontend/database node should be present as subgraph key
        target_ids = {n["id"] for n in graph["nodes"]
                      if n["category"] in ("backend", "frontend", "database")}
        assert target_ids.intersection(subs.keys()), \
            f"No subgraphs for backend/frontend/database. Subs: {list(subs.keys())}"
        # If DB detected, verify tables meta
        tables_stat = stats.get("tables", 0)
        tables_count = len(tables_stat) if isinstance(tables_stat, list) else tables_stat
        if db_nodes and tables_count > 0:
            assert any(n.get("meta", {}).get("tables") for n in db_nodes), \
                "DB node without meta.tables"
            assert any(n.get("has_children") for n in db_nodes)


# ---------- Builder export ----------
class TestBuilderExport:
    def _graph(self):
        return {
            "nodes": [
                {"id": "frontend", "label": "Frontend", "category": "frontend"},
                {"id": "backend", "label": "Backend", "category": "backend"},
                {"id": "database", "label": "DB", "category": "database"},
            ],
            "edges": [
                {"id": "e1", "source": "frontend", "target": "backend", "protocol": "HTTP"},
                {"id": "e2", "source": "backend", "target": "database", "protocol": "SQL"},
            ],
        }

    def test_scaffold_only_export(self):
        r = requests.post(f"{API}/builder/export",
                         json={"name": "TEST_scaffold", "graph": self._graph(), "ai": False},
                         timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type") == "application/zip"
        assert r.headers.get("X-AI-Files") == "0"
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert any("README.md" in n for n in names)

    @pytest.mark.slow
    def test_ai_codegen_export(self):
        # ingress may 502 due to >60s LLM latency; hit backend directly on localhost
        r = requests.post("http://localhost:8001/api/builder/export",
                         json={"name": "TEST_ai", "graph": self._graph(), "ai": True,
                               "model": "claude-sonnet-4-6", "provider": "anthropic"},
                         timeout=180)
        assert r.status_code == 200
        ai_files = int(r.headers.get("X-AI-Files", "0"))
        print(f"X-AI-Files: {ai_files}")
        assert ai_files > 0, "AI codegen returned zero files"
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        # multiple encapsulated files expected
        assert len(names) > 5
