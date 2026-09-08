"""Circuit Builder: chatbot wizard prompt, template circuit generation, and export."""
import io
import json
import zipfile
from models import GraphNode, GraphEdge, Graph, Problem, Position, _uid
from analyzer import layout

BUILDER_SYSTEM = (
    "You are Circuit's onboarding assistant, an expert full-stack architect. "
    "Your job is to interview the user in a friendly, concise way to design their app before we draw the circuit board. "
    "Ask ONE question at a time. Cover these topics in order: "
    "1) What kind of app is it (purpose + who uses it)? "
    "2) Frontend style (web dashboard, marketing site, mobile-web, etc.)? "
    "3) Will it run online, offline-first, or offline-then-online? Where will it be hosted? "
    "4) Does it need a database, and what kind of data? "
    "5) Does it need auth, file storage, payments, or AI/LLM features? "
    "Keep each message under 60 words. After you have enough info (about 5 answers), reply with a short summary "
    "starting with the exact token 'READY:' followed by a one-line plan. Do not use markdown headings."
)


# Reusable component blueprints for the drag-and-drop palette
PALETTE = [
    {"key": "frontend", "label": "Frontend UI", "category": "frontend", "icon": "layout",
     "desc": "React web interface", "ports": ["out"]},
    {"key": "backend", "label": "API Server", "category": "backend", "icon": "server",
     "desc": "FastAPI backend", "ports": ["in", "out"]},
    {"key": "database", "label": "Database", "category": "database", "icon": "database",
     "desc": "MongoDB / SQL store", "ports": ["in"]},
    {"key": "auth", "label": "Auth Service", "category": "auth", "icon": "shield",
     "desc": "Login & sessions", "ports": ["in"]},
    {"key": "llm", "label": "LLM Agent", "category": "llm", "icon": "brain",
     "desc": "AI model integration", "ports": ["in"]},
    {"key": "storage", "label": "Object Storage", "category": "storage", "icon": "hard-drive",
     "desc": "File / media storage", "ports": ["in"]},
    {"key": "cache", "label": "Cache", "category": "cache", "icon": "zap",
     "desc": "Redis cache layer", "ports": ["in"]},
    {"key": "external", "label": "External API", "category": "external", "icon": "globe",
     "desc": "Third-party service", "ports": ["in"]},
]

# Which categories are allowed to connect TO which (for placement validation)
CONNECT_RULES = {
    "client": ["frontend", "backend"],
    "frontend": ["backend", "external"],
    "backend": ["database", "llm", "auth", "storage", "cache", "external"],
    "database": [],
    "auth": ["database"],
    "llm": [],
    "storage": [],
    "cache": [],
    "external": [],
    "service": ["backend", "database", "llm", "auth", "storage"],
}


def generate_circuit(answers: dict):
    """Build a preliminary, guaranteed-connected circuit from wizard answers."""
    text = json.dumps(answers).lower()
    needs_db = any(k in text for k in ["data", "store", "save", "user", "record", "database"]) or answers.get("database")
    needs_auth = any(k in text for k in ["login", "auth", "account", "user", "sign"]) or answers.get("auth")
    needs_llm = any(k in text for k in ["ai", "llm", "gpt", "chat", "assistant", "generate"]) or answers.get("llm")
    needs_storage = any(k in text for k in ["file", "image", "upload", "photo", "media", "document"]) or answers.get("storage")

    nodes, edges = [], []

    def n(key, label, cat):
        nodes.append(GraphNode(id=key, label=label, category=cat, position=Position()))

    def e(s, t, label, proto):
        edges.append(GraphEdge(id=f"e_{s}_{t}", source=s, target=t, label=label, protocol=proto))

    n("client", "Client / Browser", "client")
    n("frontend", "Frontend UI", "frontend")
    n("backend", "API Server", "backend")
    e("client", "frontend", "renders", "HTTP")
    e("frontend", "backend", "REST API", "HTTP")

    if needs_db or True:  # every stable app gets a datastore
        n("database", "Database", "database")
        e("backend", "database", "query", "NoSQL")
    if needs_auth:
        n("auth", "Auth Service", "auth")
        e("backend", "auth", "verify", "internal")
    if needs_llm:
        n("llm", "LLM Agent", "llm")
        e("backend", "llm", "inference", "HTTPS")
    if needs_storage:
        n("storage", "Object Storage", "storage")
        e("backend", "storage", "read/write", "HTTPS")

    layout(nodes)
    return Graph(nodes=nodes, edges=edges, subgraphs={}), []


def validate_connection(source_cat: str, target_cat: str):
    allowed = CONNECT_RULES.get(source_cat, [])
    return target_cat in allowed


# ---------------- Export ----------------
def build_export_zip(name: str, graph_dict: dict):
    """Generate a boilerplate full-stack scaffold zip from the circuit graph."""
    nodes = graph_dict.get("nodes", [])
    edges = graph_dict.get("edges", [])
    cats = {n.get("category") for n in nodes}
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in name).strip("-") or "circuit-app"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{safe}/README.md", _readme(safe, nodes, edges))
        z.writestr(f"{safe}/circuit.json", json.dumps({"nodes": nodes, "edges": edges}, indent=2))
        z.writestr(f"{safe}/docker-compose.yml", _compose(cats))

        if "frontend" in cats:
            z.writestr(f"{safe}/frontend/package.json", _fe_pkg(safe))
            z.writestr(f"{safe}/frontend/src/App.jsx", _fe_app())
            z.writestr(f"{safe}/frontend/src/api.js", _fe_api())
            z.writestr(f"{safe}/frontend/.env.example", "REACT_APP_BACKEND_URL=http://localhost:8001\n")
        if "backend" in cats:
            z.writestr(f"{safe}/backend/requirements.txt", _be_reqs(cats))
            z.writestr(f"{safe}/backend/server.py", _be_server(cats))
            z.writestr(f"{safe}/backend/.env.example", _be_env(cats))
            z.writestr(f"{safe}/backend/db.py", _be_db())
    buf.seek(0)
    return buf.getvalue(), f"{safe}.zip"


def _readme(name, nodes, edges):
    lines = [f"# {name}", "", "Generated by **Circuit** — visual full-stack architect.", "",
             "## Components"]
    for n in nodes:
        lines.append(f"- **{n.get('label')}** ({n.get('category')})")
    lines += ["", "## Connections"]
    id_label = {n["id"]: n.get("label", n["id"]) for n in nodes}
    for e in edges:
        lines.append(f"- {id_label.get(e.get('source'), e.get('source'))} → "
                     f"{id_label.get(e.get('target'), e.get('target'))} ({e.get('protocol', '')})")
    lines += ["", "## Run", "```bash", "docker-compose up --build", "```", "",
              "Each component is encapsulated in its own folder and communicates only through the",
              "connections defined above, following clean separation-of-concerns principles."]
    return "\n".join(lines)


def _compose(cats):
    svc = ["services:"]
    if "frontend" in cats:
        svc += ["  frontend:", "    build: ./frontend", "    ports:", '      - "3000:3000"',
                "    depends_on:", "      - backend"]
    if "backend" in cats:
        svc += ["  backend:", "    build: ./backend", "    ports:", '      - "8001:8001"',
                "    env_file: ./backend/.env"]
        if "database" in cats:
            svc += ["    depends_on:", "      - mongo"]
    if "database" in cats:
        svc += ["  mongo:", "    image: mongo:7", "    ports:", '      - "27017:27017"']
    if "cache" in cats:
        svc += ["  redis:", "    image: redis:7", "    ports:", '      - "6379:6379"']
    return "\n".join(svc) + "\n"


def _fe_pkg(name):
    return json.dumps({
        "name": name + "-frontend", "version": "0.1.0", "private": True,
        "dependencies": {"react": "^19.0.0", "react-dom": "^19.0.0", "axios": "^1.7.0"},
        "scripts": {"start": "react-scripts start", "build": "react-scripts build"},
    }, indent=2)


def _fe_app():
    return (
        "import { useEffect, useState } from 'react';\n"
        "import { getHealth } from './api';\n\n"
        "export default function App() {\n"
        "  const [status, setStatus] = useState('...');\n"
        "  useEffect(() => { getHealth().then(setStatus).catch(() => setStatus('offline')); }, []);\n"
        "  return <div style={{padding: 40, fontFamily: 'monospace'}}>\n"
        "    <h1>Circuit App</h1>\n"
        "    <p>Backend status: {status}</p>\n"
        "  </div>;\n"
        "}\n"
    )


def _fe_api():
    return (
        "import axios from 'axios';\n"
        "const API = `${process.env.REACT_APP_BACKEND_URL}/api`;\n\n"
        "export async function getHealth() {\n"
        "  const { data } = await axios.get(`${API}/health`);\n"
        "  return data.status;\n"
        "}\n"
    )


def _be_reqs(cats):
    r = ["fastapi==0.110.1", "uvicorn==0.25.0", "python-dotenv>=1.0.1", "pydantic>=2.6.4"]
    if "database" in cats:
        r += ["motor==3.3.1", "pymongo==4.6.3"]
    if "auth" in cats:
        r += ["pyjwt>=2.10.1", "passlib>=1.7.4", "bcrypt==4.1.3"]
    if "llm" in cats:
        r += ["emergentintegrations"]
    return "\n".join(r) + "\n"


def _be_env(cats):
    e = ['MONGO_URL="mongodb://mongo:27017"', 'DB_NAME="app"', 'CORS_ORIGINS="*"']
    if "auth" in cats:
        e.append('JWT_SECRET="change-me"')
    if "llm" in cats:
        e.append('EMERGENT_LLM_KEY="your-key"')
    return "\n".join(e) + "\n"


def _be_db():
    return (
        "import os\n"
        "from motor.motor_asyncio import AsyncIOMotorClient\n\n"
        "client = AsyncIOMotorClient(os.environ['MONGO_URL'])\n"
        "db = client[os.environ.get('DB_NAME', 'app')]\n"
    )


def _be_server(cats):
    s = [
        "import os",
        "from fastapi import FastAPI, APIRouter",
        "from fastapi.middleware.cors import CORSMiddleware",
        "from dotenv import load_dotenv",
        "load_dotenv()",
        "",
        "app = FastAPI()",
        "api = APIRouter(prefix='/api')",
        "",
        "@api.get('/health')",
        "async def health():",
        "    return {'status': 'ok'}",
        "",
        "app.include_router(api)",
        "app.add_middleware(CORSMiddleware, allow_origins=os.environ.get('CORS_ORIGINS','*').split(','),",
        "                   allow_credentials=True, allow_methods=['*'], allow_headers=['*'])",
    ]
    return "\n".join(s) + "\n"
