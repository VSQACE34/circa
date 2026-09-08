# Circuit — Full-Stack Application Circuit Simulator & Problem Mapper

## Original Problem Statement
A standalone app that maps full-stack applications as an interactive circuit-board diagram.
Two capabilities: (1) **Analyzer** — read user code (GitHub URL / .zip), render a circuit diagram
where wires = connections between components (frontend, backend, DB, LLM agents, etc.), with
C4-style drill-down, fault ('X') markers on broken components/wires, a problems panel, and
live/interval monitoring. (2) **Builder** — a chatbot onboarding wizard followed by a
drag-and-drop circuit canvas with connection validation, exporting to a working full-stack scaffold.

## User Choices
- Build both capabilities (lighter versions)
- Support GitHub URL + .zip upload
- Analysis depths: structural / structural+code / deep (AI)
- Live interval polling in v1
- AI models selectable: Claude Sonnet 4.6 (default), GPT 5.4, Gemini 3.1 Pro (via Emergent universal key)

## Architecture
- **Frontend**: React 19 + React Router + @xyflow/react (React Flow) canvas, Tailwind, sonner toasts.
  PCB/circuit-board dark theme. Pages: AnalyzerPage, BuilderPage, MonitorPage.
- **Backend**: FastAPI + Motor (MongoDB). Modules: analyzer.py (rule-based code→graph),
  builder_service.py (chat wizard prompt, template circuit gen, export zip), llm_service.py
  (emergentintegrations wrapper, multi-provider), server.py (routes).
- **DB**: MongoDB `projects` collection stores graph, problems, stats.

## User Personas
- Developers/architects auditing an existing codebase's structure and integration health.
- Builders prototyping a new full-stack app visually before writing code.

## Core Requirements (static)
- Upload/analyze code → circuit graph with drill-down and fault detection.
- Live/interval monitoring of a mapped circuit.
- Chatbot-guided, drag-and-drop circuit builder with valid connections and code export.

## Implemented (2026-06)
- GitHub + zip analysis → circuit graph (nodes/edges/subgraphs), structural + code + deep(AI) depths.
- IC-chip node rendering, copper animated wires, C4 drill-down, fault 'X' markers, Problem Trace panel.
- Live Monitor with simulated telemetry (2s/5s/30s polling), status-colored circuit + telemetry cards.
- Builder chatbot onboarding (streaming, model selectable) → auto-generated starter circuit.
- Drag-and-drop palette, connection-rule validation, full-stack scaffold zip export.
- Verified: 13/13 backend tests + all frontend flows pass (iteration_1).

### Iteration 2 (2026-06) — 4 enhancements
- **Real Monitoring**: per-node health-check URL config (`/monitor/config`); monitor endpoint does real async HTTP probes (source:'live' with real latency/HTTP code), simulated fallback otherwise. Config editor UI + LIVE badge.
- **Deeper Drill-Down**: analyzer extracts DB tables/collections + backend endpoint lists; node detail drawer shows endpoints (method badges) and tables; database nodes drill into a schema subgraph.
- **Analyze → Builder**: "Open in Builder" loads an analyzed circuit into the editable builder canvas (skips chat).
- **Deep Builder Codegen**: AI codegen export generates real, encapsulated per-component code via LLM. Runs as an async job (submit → poll → download) to avoid the ~60s ingress timeout.
- Verified: 18/18 backend tests + all frontend flows pass (iteration_2); async AI export confirmed via public URL.

## Backlog / Remaining
- P1: Real runtime monitoring (currently SIMULATED telemetry).
- P1: Richer subgraph drill-down (deeper C4 levels, per-endpoint detail).
- P2: LLM-driven builder that generates actual component code, not just a scaffold.
- P2: Save/version built circuits; import an analyzed circuit into the builder.
- P2: Expose LLM failure reasons for deep analysis; Pydantic models for validate/export payloads.

## Next Tasks
- Gather user feedback on the MVP, then prioritize real monitoring vs. deeper builder codegen.
