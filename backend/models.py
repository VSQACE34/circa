from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid


def _uid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc).isoformat()


class Position(BaseModel):
    x: float = 0
    y: float = 0


class GraphNode(BaseModel):
    id: str
    type: str = "chip"  # react-flow node type
    label: str
    category: str  # frontend | backend | database | llm | auth | storage | cache | external | client | service
    status: str = "healthy"  # healthy | warning | fault
    position: Position = Field(default_factory=Position)
    meta: Dict[str, Any] = Field(default_factory=dict)
    has_children: bool = False


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str = ""
    status: str = "healthy"  # healthy | warning | fault
    protocol: str = ""  # HTTP | SQL | RPC | wire


class SubGraph(BaseModel):
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)


class Problem(BaseModel):
    id: str = Field(default_factory=_uid)
    severity: str = "warning"  # fault | warning | info
    target_id: str = ""
    target_type: str = "node"  # node | edge
    scope: str = "root"  # root or the parent node id when it belongs to a subgraph
    title: str
    description: str = ""
    fix: str = ""


class Graph(BaseModel):
    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)
    subgraphs: Dict[str, SubGraph] = Field(default_factory=dict)  # keyed by parent node id


class Project(BaseModel):
    id: str = Field(default_factory=_uid)
    name: str
    source_type: str  # github | zip
    source_ref: str = ""
    model: str = "claude-sonnet-4-6"
    provider: str = "anthropic"
    depth: str = "structural"  # structural | code | deep
    created_at: str = Field(default_factory=_now)
    graph: Graph = Field(default_factory=Graph)
    problems: List[Problem] = Field(default_factory=list)
    stats: Dict[str, Any] = Field(default_factory=dict)
    ai_summary: str = ""
    monitor_config: Dict[str, str] = Field(default_factory=dict)


class AnalyzeGithubRequest(BaseModel):
    url: str
    model: str = "claude-sonnet-4-6"
    provider: str = "anthropic"
    depth: str = "structural"


class ChatMessage(BaseModel):
    role: str
    content: str


class BuilderChatRequest(BaseModel):
    session_id: str
    message: str
    model: str = "claude-sonnet-4-6"
    provider: str = "anthropic"
    history: List[ChatMessage] = Field(default_factory=list)


class GenerateCircuitRequest(BaseModel):
    session_id: str
    answers: Dict[str, Any] = Field(default_factory=dict)
