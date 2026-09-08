import os
import re
import io
import json
import shutil
import zipfile
import asyncio
import tempfile
import logging
from pathlib import Path
from datetime import datetime, timezone

import requests
from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from models import (Project, AnalyzeGithubRequest, BuilderChatRequest, GenerateCircuitRequest)
import analyzer
import builder_service
import llm_service

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("circuit")


# ----------------- helpers -----------------
def _filter_by_depth(problems, depth):
    if depth == "structural":
        drop_kw = ["environment variable", "hardcoded"]
        return [p for p in problems if not any(k in p.title.lower() for k in drop_kw)]
    return problems


def _parse_github(url: str):
    url = url.strip().rstrip("/")
    url = re.sub(r"\.git$", "", url)
    m = re.search(r"github\.com[:/]+([^/]+)/([^/]+)", url)
    if not m:
        raise HTTPException(status_code=400, detail="Not a valid GitHub URL")
    owner, repo = m.group(1), m.group(2)
    branch = None
    bm = re.search(r"/tree/([^/]+)", url)
    if bm:
        branch = bm.group(1)
    return owner, repo, branch


def _download_github_zip(owner, repo, branch):
    branches = [branch] if branch else ["main", "master"]
    last_err = None
    for b in branches:
        u = f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/{b}"
        try:
            r = requests.get(u, timeout=45)
            if r.status_code == 200 and r.content:
                return r.content
            last_err = f"HTTP {r.status_code} for branch {b}"
        except Exception as e:
            last_err = str(e)
    raise HTTPException(status_code=400, detail=f"Could not download repo: {last_err}")


def _extract_zip(content: bytes, dest: Path):
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        z.extractall(dest)
    entries = list(dest.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


async def _deep_analysis(blob, model, provider):
    system = (
        "You are a senior software architect reviewing a codebase. "
        "Given file excerpts, return ONLY valid JSON with two keys: "
        '"summary" (2-3 sentence architecture summary) and "problems" (array of objects with '
        '"severity" [fault|warning|info], "title", "description", "fix"). '
        "Focus on architecture, missing connections, security, and integration risks. Max 6 problems."
    )
    prompt = f"Analyze this codebase and respond with JSON only.\n\n{blob}"
    try:
        raw = await llm_service.complete("analysis", system, prompt, model, provider)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return "", []
        data = json.loads(m.group(0))
        return data.get("summary", ""), data.get("problems", [])[:6]
    except Exception as e:
        logger.warning(f"deep analysis failed: {e}")
        return "", []


async def _run_analysis(root: Path, name, source_type, source_ref, model, provider, depth):
    graph, problems, stats, blob = await asyncio.to_thread(analyzer.analyze_tree, root, name)
    problems = _filter_by_depth(problems, depth)
    ai_summary = ""
    if depth == "deep":
        ai_summary, extra = await _deep_analysis(blob, model, provider)
        from models import Problem
        for ep in extra:
            problems.append(Problem(
                severity=ep.get("severity", "info"),
                target_id=graph.nodes[0].id if graph.nodes else "",
                target_type="node", scope="root",
                title="AI: " + ep.get("title", "Insight"),
                description=ep.get("description", ""),
                fix=ep.get("fix", ""),
            ))
    proj = Project(name=name, source_type=source_type, source_ref=source_ref,
                   model=model, provider=provider, depth=depth,
                   graph=graph, problems=problems, stats=stats, ai_summary=ai_summary)
    doc = proj.model_dump()
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ----------------- routes -----------------
@api_router.get("/")
async def root():
    return {"message": "Circuit API online"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/palette")
async def palette():
    return {"palette": builder_service.PALETTE, "rules": builder_service.CONNECT_RULES}


@api_router.post("/analyze/github")
async def analyze_github(req: AnalyzeGithubRequest):
    owner, repo, branch = _parse_github(req.url)
    content = await asyncio.to_thread(_download_github_zip, owner, repo, branch)
    tmp = Path(tempfile.mkdtemp(prefix="circuit_"))
    try:
        root = _extract_zip(content, tmp)
        doc = await _run_analysis(root, f"{owner}/{repo}", "github", req.url,
                                  req.model, req.provider, req.depth)
        return doc
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@api_router.post("/analyze/upload")
async def analyze_upload(file: UploadFile = File(...), model: str = Form("claude-sonnet-4-6"),
                         provider: str = Form("anthropic"), depth: str = Form("structural")):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file")
    content = await file.read()
    tmp = Path(tempfile.mkdtemp(prefix="circuit_"))
    try:
        root = _extract_zip(content, tmp)
        name = file.filename[:-4]
        doc = await _run_analysis(root, name, "zip", file.filename,
                                  model, provider, depth)
        return doc
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@api_router.get("/projects")
async def list_projects():
    docs = await db.projects.find({}, {"_id": 0, "graph": 0}).sort("created_at", -1).to_list(100)
    return docs


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str):
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    return doc


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    await db.projects.delete_one({"id": project_id})
    return {"deleted": True}


@api_router.get("/projects/{project_id}/monitor")
async def monitor(project_id: str):
    """Simulated live telemetry per node based on stored analysis status."""
    import random
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0, "graph": 1, "problems": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    nodes = doc.get("graph", {}).get("nodes", [])
    fault_ids = {p["target_id"] for p in doc.get("problems", []) if p.get("severity") == "fault"}
    warn_ids = {p["target_id"] for p in doc.get("problems", []) if p.get("severity") == "warning"}
    telemetry = []
    for n in nodes:
        base = n.get("status", "healthy")
        if n["id"] in fault_ids:
            status = "fault"
        elif n["id"] in warn_ids:
            status = "warning"
        else:
            status = base
        latency = round(random.uniform(8, 45), 1)
        if status == "warning":
            latency = round(random.uniform(120, 400), 1)
        elif status == "fault":
            latency = 0
        telemetry.append({
            "id": n["id"], "label": n["label"], "category": n["category"],
            "status": status, "latency_ms": latency,
            "uptime": 0 if status == "fault" else round(random.uniform(97.5, 100.0), 2),
            "requests": 0 if status == "fault" else random.randint(20, 900),
        })
    return {"timestamp": datetime.now(timezone.utc).isoformat(), "telemetry": telemetry}


@api_router.post("/builder/chat")
async def builder_chat(req: BuilderChatRequest):
    history = [{"role": m.role, "content": m.content} for m in req.history]

    async def gen():
        async for chunk in llm_service.stream_reply(
            req.session_id, builder_service.BUILDER_SYSTEM, req.message,
            req.model, req.provider, history):
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api_router.post("/builder/generate")
async def builder_generate(req: GenerateCircuitRequest):
    graph, problems = builder_service.generate_circuit(req.answers)
    return {"graph": graph.model_dump(), "problems": [p.model_dump() for p in problems]}


@api_router.post("/builder/validate")
async def builder_validate(payload: dict):
    ok = builder_service.validate_connection(payload.get("source_cat", ""), payload.get("target_cat", ""))
    return {"valid": ok}


@api_router.post("/builder/export")
async def builder_export(payload: dict):
    name = payload.get("name", "circuit-app")
    graph = payload.get("graph", {})
    data, filename = await asyncio.to_thread(builder_service.build_export_zip, name, graph)
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename={filename}"})


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
