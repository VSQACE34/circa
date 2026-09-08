import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNodesState, useEdgesState } from '@xyflow/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Github, Upload, Loader2, ChevronLeft, Cpu, FileCode2, Boxes, Sparkles, Trash2, RefreshCw, Wrench,
} from 'lucide-react';
import CircuitCanvas from '../components/CircuitCanvas';
import ProblemsPanel from '../components/ProblemsPanel';
import NodeDetail from '../components/NodeDetail';
import { api, MODELS } from '../lib/api';
import { toRFNodes, toRFEdges } from '../lib/graph';

const DEPTHS = [
  { id: 'structural', label: 'Structural', desc: 'Connections & wiring gaps' },
  { id: 'code', label: 'Structural + Code', desc: 'Env vars, secrets, imports' },
  { id: 'deep', label: 'Deep (AI)', desc: 'LLM reads the code' },
];

export default function AnalyzerPage() {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState(MODELS[0]);
  const [depth, setDepth] = useState('structural');
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState(null);
  const [scope, setScope] = useState('root');
  const [history, setHistory] = useState([]);
  const [detail, setDetail] = useState(null);
  const navigate = useNavigate();
  const fileRef = useRef();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const loadHistory = useCallback(() => { api.projects().then(setHistory).catch(() => {}); }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const currentGraph = useMemo(() => {
    if (!project) return { nodes: [], edges: [] };
    if (scope === 'root') return project.graph;
    return project.graph.subgraphs?.[scope] || { nodes: [], edges: [] };
  }, [project, scope]);

  useEffect(() => {
    setNodes(toRFNodes(currentGraph));
    setEdges(toRFEdges(currentGraph));
  }, [currentGraph, setNodes, setEdges]);

  const runAnalysis = async (fn) => {
    setLoading(true);
    try {
      const doc = await fn();
      setProject(doc);
      setScope('root');
      loadHistory();
      const faults = doc.problems.filter((p) => p.severity === 'fault').length;
      toast.success(`Circuit mapped: ${doc.graph.nodes.length} components`, {
        description: faults ? `${faults} fault(s) detected` : 'No faults detected',
      });
    } catch (e) {
      toast.error('Analysis failed', { description: e?.response?.data?.detail || e.message });
    } finally {
      setLoading(false);
    }
  };

  const analyzeGithub = () => {
    if (!url.trim()) return toast.error('Enter a GitHub repository URL');
    runAnalysis(() => api.analyzeGithub({ url, model: model.id, provider: model.provider, depth }));
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('model', model.id);
    fd.append('provider', model.provider);
    fd.append('depth', depth);
    runAnalysis(() => api.analyzeUpload(fd));
    e.target.value = '';
  };

  const onNodeClick = (_, node) => {
    setDetail({ node: node.data, canDrill: node.data.has_children && scope === 'root' });
  };

  const drillInto = (id) => { setDetail(null); setScope(id); };

  const handleFix = async (p) => {
    try {
      const res = await api.fixProblem(project.id, p.id);
      setProject(res.project);
      toast.success('Fix applied & re-checked', { description: res.fixed });
    } catch (e) {
      toast.error('Could not apply fix', { description: e?.response?.data?.detail || e.message });
    }
  };

  const focusProblem = (p) => {
    setScope('root');
    setTimeout(() => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === p.target_id })));
    }, 60);
  };

  const openHistory = async (id) => {
    setLoading(true);
    try {
      const doc = await api.project(id);
      setProject(doc); setScope('root');
    } finally { setLoading(false); }
  };

  const del = async (id, e) => {
    e.stopPropagation();
    await api.deleteProject(id);
    loadHistory();
    if (project?.id === id) setProject(null);
  };

  if (!project) {
    return (
      <div className="min-h-[calc(100vh-4rem)] pcb-grid">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-14 md:py-20">
          <div className="fade-up text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-mono mb-5">
              <Sparkles size={13} /> ARCHITECTURE X-RAY
            </div>
            <h1 className="text-4xl sm:text-5xl font-mono font-bold tracking-tight text-slate-100">
              Map your stack as a <span className="text-emerald-400">circuit board</span>
            </h1>
            <p className="text-slate-400 mt-4 max-w-xl mx-auto">
              Feed Circuit your code — it traces every component and wire, drills down like a C4 diagram, and marks faults with an <span className="text-red-400 font-mono">✕</span>.
            </p>
          </div>

          <div className="fade-up rounded-xl glass p-5 md:p-6 space-y-5" style={{ animationDelay: '.1s' }}>
            {/* GitHub */}
            <div>
              <label className="text-xs font-mono text-slate-400 uppercase tracking-widest">GitHub repository</label>
              <div className="flex gap-2 mt-2">
                <div className="flex-1 flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/60 px-3">
                  <Github size={16} className="text-slate-500" />
                  <input
                    data-testid="github-url-input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && analyzeGithub()}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                  />
                </div>
                <button
                  data-testid="analyze-github-btn"
                  onClick={analyzeGithub}
                  disabled={loading}
                  className="px-4 rounded-md bg-emerald-500 text-slate-950 font-semibold text-sm hover:bg-emerald-400 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Cpu size={16} />} Analyze
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono text-slate-600">
              <div className="flex-1 h-px bg-slate-800" /> OR <div className="flex-1 h-px bg-slate-800" />
            </div>

            {/* Upload */}
            <button
              data-testid="upload-zip-btn"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="w-full rounded-md border border-dashed border-slate-700 hover:border-emerald-500/50 bg-slate-950/40 py-6 flex flex-col items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Upload size={22} className="text-emerald-400" />
              <span className="text-sm text-slate-300">Drop a project <span className="font-mono text-slate-400">.zip</span> or click to browse</span>
            </button>
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={onFile} data-testid="file-input" />

            {/* Options */}
            <div className="grid md:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="text-xs font-mono text-slate-400 uppercase tracking-widest">Analysis depth</label>
                <div className="mt-2 space-y-1.5">
                  {DEPTHS.map((d) => (
                    <button
                      key={d.id}
                      data-testid={`depth-${d.id}`}
                      onClick={() => setDepth(d.id)}
                      className={`w-full text-left px-3 py-2 rounded-md border transition-all ${
                        depth === d.id ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-sm text-slate-100">{d.label}</div>
                      <div className="text-[11px] text-slate-500">{d.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-mono text-slate-400 uppercase tracking-widest">AI model {depth !== 'deep' && '(deep only)'}</label>
                <div className="mt-2 space-y-1.5">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      data-testid={`model-${m.id}`}
                      onClick={() => setModel(m)}
                      className={`w-full text-left px-3 py-2 rounded-md border transition-all ${
                        model.id === m.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-sm text-slate-100">{m.label}</div>
                      <div className="text-[11px] font-mono text-slate-500">{m.provider}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {history.length > 0 && (
            <div className="fade-up mt-8" style={{ animationDelay: '.2s' }}>
              <div className="text-xs font-mono text-slate-400 uppercase tracking-widest mb-3">Recent scans</div>
              <div className="space-y-2">
                {history.slice(0, 6).map((h) => (
                  <div
                    key={h.id}
                    data-testid={`history-${h.id}`}
                    onClick={() => openHistory(h.id)}
                    className="group flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-4 py-3 hover:border-slate-600 cursor-pointer transition-all"
                  >
                    <FileCode2 size={16} className="text-slate-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200 truncate">{h.name}</div>
                      <div className="text-[11px] font-mono text-slate-500">{h.source_type} · {h.depth}</div>
                    </div>
                    <button onClick={(e) => del(h.id, e)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all" data-testid={`del-history-${h.id}`}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" data-testid="analyzing-overlay">
              <div className="text-center">
                <Loader2 size={40} className="animate-spin text-emerald-400 mx-auto mb-4" />
                <div className="font-mono text-slate-200">Tracing circuit…</div>
                <div className="text-xs text-slate-500 mt-1 font-mono">scanning AST · detecting components · wiring traces</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const stats = project.stats || {};
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row">
      <div className="flex-1 relative pcb-grid">
        {/* top bar */}
        <div className="absolute top-0 left-0 right-0 z-20 glass border-b border-slate-800 px-4 py-2.5 flex items-center gap-3">
          {scope !== 'root' ? (
            <button data-testid="drilldown-back" onClick={() => setScope('root')} className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 font-mono">
              <ChevronLeft size={16} /> back
            </button>
          ) : (
            <div className="font-mono text-sm text-slate-200 truncate">{project.name}</div>
          )}
          <div className="text-[11px] font-mono text-slate-500">
            {scope === 'root' ? 'system overview' : 'drill-down · ' + (project.graph.nodes.find((n) => n.id === scope)?.label || '')}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button data-testid="open-in-builder-btn" onClick={() => navigate('/builder', { state: { graph: project.graph, name: project.name } })} className="text-xs font-mono text-cyan-300 hover:text-cyan-200 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-cyan-500/30 hover:border-cyan-500/60 bg-cyan-500/5">
              <Wrench size={13} /> Open in Builder
            </button>
            <button data-testid="new-scan-btn" onClick={() => setProject(null)} className="text-xs font-mono text-slate-400 hover:text-slate-100 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-800 hover:border-slate-600">
              <RefreshCw size={13} /> New scan
            </button>
          </div>
        </div>

        <div className="h-full pt-12">
          <CircuitCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
          />
        </div>

        {/* stat chips */}
        <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-2">
          {[
            ['files', stats.files, Boxes],
            ['LOC', stats.loc, FileCode2],
            ['endpoints', stats.endpoints, Cpu],
          ].map(([k, v, Ic]) => (
            <div key={k} className="glass rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
              <Ic size={12} className="text-emerald-400" /> {v ?? 0} {k}
            </div>
          ))}
        </div>

        {detail && <NodeDetail detail={detail} onClose={() => setDetail(null)} onDrill={drillInto} />}
      </div>

      {/* right panel */}
      <div className="w-full md:w-[360px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/60 flex flex-col max-h-[45vh] md:max-h-none">
        {project.ai_summary && (
          <div className="p-4 border-b border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-mono text-cyan-400 mb-2"><Sparkles size={13} /> AI SUMMARY</div>
            <p className="text-xs text-slate-300 leading-relaxed">{project.ai_summary}</p>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ProblemsPanel problems={project.problems} onFocus={focusProblem} onFix={handleFix} />
        </div>
      </div>
    </div>
  );
}
