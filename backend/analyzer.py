"""Rule-based static analyzer that turns a source tree into a circuit graph."""
import os
import re
import json
from pathlib import Path
from models import GraphNode, GraphEdge, Graph, SubGraph, Problem, Position, _uid

TEXT_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".env", ".txt", ".md",
    ".yml", ".yaml", ".toml", ".html", ".css", ".go", ".rb", ".php", ".java",
}
SKIP_DIRS = {"node_modules", ".git", "__pycache__", "dist", "build", ".next",
             "venv", ".venv", "env", "coverage", ".cache", "vendor"}
MAX_FILE_BYTES = 400_000


def _walk(root: Path):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".git")]
        for fn in filenames:
            p = Path(dirpath) / fn
            rel = str(p.relative_to(root))
            files.append((rel, p))
    return files


def _read(p: Path):
    try:
        if p.stat().st_size > MAX_FILE_BYTES:
            return ""
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


# ---- Category detection signatures ----
DB_SIGS = {
    "MongoDB": [r"pymongo", r"motor", r"mongoose", r"MongoClient", r"AsyncIOMotorClient", r"mongodb://", r"mongodb\+srv"],
    "PostgreSQL": [r"psycopg2?", r"asyncpg", r"pg8000", r"sequelize", r"postgres://", r"postgresql://", r"prisma"],
    "MySQL": [r"mysql", r"pymysql", r"mariadb"],
    "SQLite": [r"sqlite3", r"sqlite://"],
    "Redis": [r"redis", r"ioredis"],
}
LLM_SIGS = {
    "OpenAI": [r"openai", r"gpt-", r"OPENAI_API_KEY"],
    "Anthropic": [r"anthropic", r"claude", r"ANTHROPIC_API_KEY"],
    "Gemini": [r"google\.generativeai", r"gemini", r"GEMINI_API_KEY"],
    "Emergent LLM": [r"emergentintegrations", r"EMERGENT_LLM_KEY"],
    "LangChain": [r"langchain"],
}
AUTH_SIGS = {
    "JWT Auth": [r"pyjwt", r"jsonwebtoken", r"jwt\.", r"jose"],
    "OAuth": [r"oauth", r"passport", r"authlib"],
    "Password Hashing": [r"bcrypt", r"passlib", r"argon2"],
}
STORAGE_SIGS = {
    "S3 / Object Storage": [r"boto3", r"aws-sdk", r"s3\.", r"cloudinary", r"gcs", r"google-cloud-storage"],
}
FRONTEND_SIGS = {
    "React": [r"\"react\"", r"from ['\"]react['\"]", r"react-dom"],
    "Vue": [r"\"vue\""],
    "Angular": [r"@angular/core"],
    "Next.js": [r"\"next\""],
    "Svelte": [r"\"svelte\""],
}
BACKEND_SIGS = {
    "FastAPI": [r"fastapi", r"FastAPI\("],
    "Flask": [r"flask", r"Flask\(__name__"],
    "Django": [r"django"],
    "Express": [r"express\(\)", r"require\(['\"]express"],
    "NestJS": [r"@nestjs/core"],
}


def _match_any(patterns, text):
    for pat in patterns:
        if re.search(pat, text, re.IGNORECASE):
            return True
    return False


def _detect(sig_map, blob):
    found = []
    for name, pats in sig_map.items():
        if _match_any(pats, blob):
            found.append(name)
    return found


# ---- Endpoint & route extraction ----
def _py_endpoints(text):
    eps = []
    for m in re.finditer(r"@\w+\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]", text, re.IGNORECASE):
        eps.append((m.group(1).upper(), m.group(2)))
    return eps


def _express_endpoints(text):
    eps = []
    for m in re.finditer(r"\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]", text, re.IGNORECASE):
        eps.append((m.group(1).upper(), m.group(2)))
    return eps


def _api_calls(text):
    calls = []
    for m in re.finditer(r"(?:axios|fetch)\s*(?:\.\w+)?\(\s*[`'\"]([^`'\"]+)[`'\"]", text):
        calls.append(m.group(1))
    for m in re.finditer(r"axios\.(get|post|put|delete|patch)\(\s*[`'\"]([^`'\"]+)[`'\"]", text):
        calls.append(m.group(2))
    return calls


def _env_keys(text):
    keys = set()
    for m in re.finditer(r"(?:os\.environ(?:\.get)?\(?\[?['\"]([A-Z0-9_]+)['\"]|process\.env\.([A-Z0-9_]+))", text):
        keys.add(m.group(1) or m.group(2))
    return keys


def analyze_tree(root: Path, project_name: str):
    files = _walk(root)
    frontend_files, backend_files, env_files = [], [], []
    all_blob_parts = []
    loc = 0
    frameworks = {"frontend": set(), "backend": set()}
    dbs, llms, auths, storages = set(), set(), set(), set()
    endpoints = []
    api_calls = []
    defined_env = set()
    used_env = set()
    has_cors = False
    hardcoded = []

    for rel, p in files:
        ext = p.suffix.lower()
        if ext not in TEXT_EXTS and p.name not in {".env", "Dockerfile", "docker-compose.yml"}:
            continue
        text = _read(p)
        if not text:
            continue
        loc += text.count("\n")
        all_blob_parts.append(f"### {rel}\n{text[:4000]}")
        low_rel = rel.lower()

        # env definitions
        if p.name == ".env" or ".env" in p.name:
            env_files.append(rel)
            for line in text.splitlines():
                mm = re.match(r"\s*([A-Z0-9_]+)\s*=", line)
                if mm:
                    defined_env.add(mm.group(1))

        used_env |= _env_keys(text)

        for name, pats in FRONTEND_SIGS.items():
            if _match_any(pats, text):
                frameworks["frontend"].add(name)
        for name, pats in BACKEND_SIGS.items():
            if _match_any(pats, text):
                frameworks["backend"].add(name)

        dbs |= set(_detect(DB_SIGS, text))
        llms |= set(_detect(LLM_SIGS, text))
        auths |= set(_detect(AUTH_SIGS, text))
        storages |= set(_detect(STORAGE_SIGS, text))

        if re.search(r"CORSMiddleware|cors\(\)|Access-Control-Allow", text, re.IGNORECASE):
            has_cors = True

        if ext in {".jsx", ".tsx", ".vue", ".svelte"} or "src/" in low_rel and ext in {".js", ".ts"}:
            frontend_files.append(rel)
            api_calls += _api_calls(text)
        if ext == ".py":
            endpoints += _py_endpoints(text)
            backend_files.append(rel)
        if ext in {".js", ".ts"} and ("server" in low_rel or "route" in low_rel or "app" in low_rel or "api" in low_rel):
            ex = _express_endpoints(text)
            if ex:
                endpoints += ex
                backend_files.append(rel)

        # hardcoded secrets / urls
        for m in re.finditer(r"(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|https?://[a-zA-Z0-9.-]+:[0-9]{2,5})", text):
            val = m.group(1)
            if "localhost" not in val:
                hardcoded.append((rel, val[:40]))

    has_frontend = bool(frameworks["frontend"]) or bool(frontend_files)
    has_backend = bool(frameworks["backend"]) or bool(endpoints)

    # ---------- Build top-level nodes ----------
    nodes, edges, subgraphs, problems = [], [], {}, []
    node_ids = {}

    def add_node(key, label, category, status="healthy", meta=None):
        nid = f"n_{key}"
        node_ids[key] = nid
        nodes.append(GraphNode(id=nid, label=label, category=category, status=status,
                               meta=meta or {}, position=Position()))
        return nid

    def add_edge(src_key, tgt_key, label, protocol, status="healthy"):
        if src_key not in node_ids or tgt_key not in node_ids:
            return None
        eid = f"e_{src_key}_{tgt_key}"
        edges.append(GraphEdge(id=eid, source=node_ids[src_key], target=node_ids[tgt_key],
                               label=label, protocol=protocol, status=status))
        return eid

    add_node("client", "Client / Browser", "client", meta={"desc": "End user device"})
    if has_frontend:
        fw = ", ".join(sorted(frameworks["frontend"])) or "Web UI"
        add_node("frontend", "Frontend", "frontend",
                 meta={"framework": fw, "files": len(frontend_files), "api_calls": len(api_calls)})
    if has_backend:
        fw = ", ".join(sorted(frameworks["backend"])) or "API Server"
        add_node("backend", "Backend", "backend",
                 meta={"framework": fw, "endpoints": len(endpoints)})
    for i, dbn in enumerate(sorted(dbs)):
        add_node(f"db{i}", dbn, "database", meta={"engine": dbn})
    for i, ln in enumerate(sorted(llms)):
        add_node(f"llm{i}", ln, "llm", meta={"provider": ln})
    for i, an in enumerate(sorted(auths)):
        add_node(f"auth{i}", an, "auth", meta={"kind": an})
    for i, sn in enumerate(sorted(storages)):
        add_node(f"storage{i}", sn, "storage", meta={"kind": sn})

    # ---------- Edges ----------
    if has_frontend:
        add_edge("client", "frontend", "renders", "HTTP")
    if has_frontend and has_backend:
        add_edge("frontend", "backend", "REST API", "HTTP")
    elif not has_frontend and has_backend:
        add_edge("client", "backend", "REST API", "HTTP")
    for i, _ in enumerate(sorted(dbs)):
        add_edge("backend", f"db{i}", "query", "SQL/NoSQL")
    for i, _ in enumerate(sorted(llms)):
        add_edge("backend", f"llm{i}", "inference", "HTTPS")
    for i, _ in enumerate(sorted(auths)):
        add_edge("backend", f"auth{i}", "verify", "internal")
    for i, _ in enumerate(sorted(storages)):
        add_edge("backend", f"storage{i}", "read/write", "HTTPS")

    # ---------- Problem detection (structural + basic code) ----------
    def add_problem(sev, tid, ttype, title, desc, fix, scope="root"):
        problems.append(Problem(severity=sev, target_id=tid, target_type=ttype, scope=scope,
                                title=title, description=desc, fix=fix))

    # frontend calls but no backend
    if has_frontend and api_calls and not has_backend:
        add_problem("fault", node_ids.get("frontend", ""), "node",
                    "Frontend has no backend to talk to",
                    f"Detected {len(api_calls)} API call(s) in the frontend but no backend server was found.",
                    "Add a backend service, or point the frontend at an existing API.")
        for n in nodes:
            if n.id == node_ids.get("frontend"):
                n.status = "fault"

    # backend without database while it looks data-driven
    if has_backend and not dbs and any("db" in e.lower() or "model" in e.lower() for e, _ in files if isinstance(e, str)):
        pass

    # missing CORS
    if has_frontend and has_backend and not has_cors:
        eid = node_ids.get("frontend")
        add_problem("warning", "e_frontend_backend", "edge",
                    "CORS not configured",
                    "Frontend and backend detected but no CORS middleware/headers were found on the backend.",
                    "Enable CORS on the backend so the browser can call the API.")
        for e in edges:
            if e.id == "e_frontend_backend":
                e.status = "warning"

    # env vars used but not defined
    missing_env = {k for k in used_env if k not in defined_env}
    if missing_env:
        tgt = node_ids.get("backend") or node_ids.get("frontend") or (nodes[0].id if nodes else "")
        add_problem("warning", tgt, "node",
                    f"{len(missing_env)} environment variable(s) not defined",
                    "Referenced in code but missing from any .env file: " + ", ".join(sorted(missing_env)[:8]),
                    "Add these keys to the appropriate .env file.")
        for n in nodes:
            if n.id == tgt and n.status == "healthy":
                n.status = "warning"

    # hardcoded secrets
    if hardcoded:
        tgt = node_ids.get("backend") or (nodes[0].id if nodes else "")
        add_problem("fault", tgt, "node",
                    f"{len(hardcoded)} hardcoded secret/URL detected",
                    "Example: " + "; ".join([f"{r}: {v}" for r, v in hardcoded[:3]]),
                    "Move secrets and absolute URLs into environment variables.")

    # orphan nodes (no edges)
    connected = set()
    for e in edges:
        connected.add(e.source)
        connected.add(e.target)
    for n in nodes:
        if n.id not in connected and n.category not in {"client"}:
            add_problem("warning", n.id, "node",
                        f"Orphan component: {n.label}",
                        "This component is not connected to anything else in the graph.",
                        "Wire it to the component that uses it, or remove it.")
            if n.status == "healthy":
                n.status = "warning"

    # ---------- Subgraphs (drill-down) ----------
    # Backend subgraph = endpoints grouped
    if has_backend and node_ids.get("backend"):
        sg_nodes, sg_edges = [], []
        api_id = "sb_api"
        sg_nodes.append(GraphNode(id=api_id, label="API Router", category="service", position=Position()))
        seen = set()
        groups = {}
        for method, path in endpoints[:40]:
            grp = "/" + (path.strip("/").split("/")[0] or "root")
            groups.setdefault(grp, []).append(f"{method} {path}")
        for i, (grp, eps) in enumerate(list(groups.items())[:10]):
            gid = f"sb_g{i}"
            sg_nodes.append(GraphNode(id=gid, label=grp, category="backend",
                                      position=Position(), meta={"endpoints": eps[:8]}))
            sg_edges.append(GraphEdge(id=f"se_{i}", source=api_id, target=gid, label="route", protocol="HTTP"))
        subgraphs[node_ids["backend"]] = SubGraph(nodes=sg_nodes, edges=sg_edges)
        for n in nodes:
            if n.id == node_ids["backend"]:
                n.has_children = True

    # Frontend subgraph = top folders / pages
    if has_frontend and node_ids.get("frontend"):
        sg_nodes, sg_edges = [], []
        app_id = "sf_app"
        sg_nodes.append(GraphNode(id=app_id, label="App Root", category="service", position=Position()))
        comps = []
        for rel in frontend_files:
            base = os.path.basename(rel)
            if base.lower() in {"index.js", "index.jsx", "index.ts"}:
                continue
            comps.append(base)
        comps = sorted(set(comps))[:10]
        for i, c in enumerate(comps):
            cid = f"sf_c{i}"
            sg_nodes.append(GraphNode(id=cid, label=c, category="frontend", position=Position()))
            sg_edges.append(GraphEdge(id=f"sfe_{i}", source=app_id, target=cid, label="mounts", protocol="import"))
        subgraphs[node_ids["frontend"]] = SubGraph(nodes=sg_nodes, edges=sg_edges)
        for n in nodes:
            if n.id == node_ids["frontend"]:
                n.has_children = True

    layout(nodes)
    for pid, sg in subgraphs.items():
        layout(sg.nodes)

    graph = Graph(nodes=nodes, edges=edges, subgraphs=subgraphs)
    stats = {
        "files": len(files),
        "loc": loc,
        "frontend_files": len(frontend_files),
        "backend_files": len(backend_files),
        "endpoints": len(endpoints),
        "databases": sorted(dbs),
        "llms": sorted(llms),
        "auth": sorted(auths),
        "storage": sorted(storages),
        "frontend_frameworks": sorted(frameworks["frontend"]),
        "backend_frameworks": sorted(frameworks["backend"]),
    }
    blob = "\n\n".join(all_blob_parts)[:60000]
    return graph, problems, stats, blob


COLUMN = {
    "client": 0, "frontend": 1, "backend": 2,
    "service": 1, "database": 3, "llm": 3, "auth": 3, "storage": 3, "cache": 3, "external": 3,
}


def layout(nodes):
    """Simple column layout by category."""
    col_counts = {}
    for n in nodes:
        col = COLUMN.get(n.category, 2)
        idx = col_counts.get(col, 0)
        col_counts[col] = idx + 1
        n.position = Position(x=col * 320, y=idx * 150)
    # center columns vertically
    max_rows = max(col_counts.values()) if col_counts else 1
    per_col_idx = {}
    for n in nodes:
        col = COLUMN.get(n.category, 2)
        rows = col_counts.get(col, 1)
        i = per_col_idx.get(col, 0)
        per_col_idx[col] = i + 1
        offset = (max_rows - rows) * 75
        n.position = Position(x=col * 320, y=offset + i * 150)
