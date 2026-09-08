import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Play, Loader2, Rocket, CheckCircle2, XCircle, Wrench, TerminalSquare } from 'lucide-react';
import CircuitCanvas from '../components/CircuitCanvas';
import { api, API } from '../lib/api';
import { toRFNodes, toRFEdges } from '../lib/graph';

const LEVEL_COLOR = { info: '#94A3B8', ok: '#10B981', warn: '#F59E0B', error: '#EF4444' };

export default function RunPage() {
  const location = useLocation();
  const [sources, setSources] = useState([]); // {value,label,type}
  const [selected, setSelected] = useState('');
  const [graph, setGraph] = useState(location.state?.graph || null);
  const [name, setName] = useState(location.state?.name || 'circuit');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [activeEdges, setActiveEdges] = useState({});
  const [summary, setSummary] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const esRef = useRef(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    Promise.all([api.projects().catch(() => []), api.circuits().catch(() => [])]).then(([ps, cs]) => {
      const opts = [];
      if (location.state?.graph) opts.push({ value: 'current', label: `Current build · ${location.state.name || 'circuit'}`, type: 'current' });
      ps.forEach((p) => opts.push({ value: `p:${p.id}`, label: `Scan · ${p.name}`, type: 'project' }));
      cs.forEach((c) => opts.push({ value: `c:${c.id}`, label: `Circuit · ${c.name}`, type: 'circuit' }));
      setSources(opts);
      if (opts.length) setSelected((cur) => cur || opts[0].value);
    });
  }, [location.state]);

  // render circuit with live status + active-edge overrides
  useEffect(() => {
    if (!graph) return;
    const merged = {
      nodes: graph.nodes.map((n) => ({ ...n, status: statusMap[n.id] || 'idle' })),
      edges: graph.edges,
    };
    const rfNodes = toRFNodes(merged);
    const rfEdges = toRFEdges(merged).map((e) => {
      const key = `${e.source}->${e.target}`;
      if (activeEdges[key]) {
        return { ...e, className: 'wire-active', style: { ...e.style, stroke: '#22D3EE', strokeWidth: 3 } };
      }
      return e;
    });
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [graph, statusMap, activeEdges]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const resolveGraph = useCallback(async () => {
    if (selected === 'current') return { graph: location.state.graph, config: null, name: location.state.name || 'circuit' };
    if (selected.startsWith('p:')) {
      const p = await api.project(selected.slice(2));
      return { graph: p.graph, config: p.monitor_config || null, name: p.name };
    }
    if (selected.startsWith('c:')) {
      const c = await api.circuit(selected.slice(2));
      return { graph: c.graph, config: null, name: c.name };
    }
    return null;
  }, [selected, location.state]);

  const run = async () => {
    if (!selected) return toast.error('Pick a circuit to run');
    if (esRef.current) esRef.current.close();
    setRunning(true); setLogs([]); setStatusMap({}); setActiveEdges({}); setSummary(null);
    try {
      const src = await resolveGraph();
      if (!src?.graph?.nodes?.length) { setRunning(false); return toast.error('That circuit has no components'); }
      setGraph(src.graph); setName(src.name);
      const { run_id } = await api.runStart({ name: src.name, graph: src.graph, config: src.config || undefined });
      const es = new EventSource(`${API}/run/${run_id}/stream`);
      esRef.current = es;
      es.onmessage = (msg) => {
        const ev = JSON.parse(msg.data);
        if (ev.type === 'end') { es.close(); setRunning(false); return; }
        setLogs((l) => [...l, ev]);
        if (ev.type === 'summary') { setSummary(ev); return; }
        if (ev.node_id && ev.status) {
          setStatusMap((m) => ({ ...m, [ev.node_id]: ev.status === 'booting' ? 'warning' : ev.status === 'ready' ? 'healthy' : 'fault' }));
        }
        if (ev.stage === 'connect' && ev.edge_source) {
          const key = `${ev.edge_source}->${ev.edge_target}`;
          setActiveEdges((a) => ({ ...a, [key]: Date.now() }));
          setTimeout(() => setActiveEdges((a) => { const c = { ...a }; delete c[key]; return c; }), 1600);
        }
      };
      es.onerror = () => { es.close(); setRunning(false); };
    } catch (e) {
      setRunning(false);
      toast.error('Could not start run', { description: e.message });
    }
  };

  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row">
      <div className="flex-1 relative pcb-grid">
        <div className="absolute top-0 left-0 right-0 z-20 glass border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-sm text-slate-200"><Rocket size={15} className="text-cyan-400" /> Live Run</div>
          <select
            data-testid="run-source-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-md text-sm font-mono text-slate-200 px-2.5 py-1.5 outline-none max-w-[280px]"
          >
            {sources.length === 0 && <option value="">No circuits yet</option>}
            {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            data-testid="run-btn"
            onClick={run}
            disabled={running || !selected}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3.5 py-1.5 rounded disabled:opacity-50"
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {running ? 'Running…' : 'Run & Diagnose'}
          </button>
          {summary && (
            <div className={`ml-auto flex items-center gap-1.5 text-sm font-mono px-2.5 py-1 rounded ${summary.failed ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`} data-testid="run-summary">
              {summary.failed ? <XCircle size={14} /> : <CheckCircle2 size={14} />} {summary.passed} ok · {summary.failed} fault
            </div>
          )}
        </div>

        <div className="h-full pt-12">
          {graph ? <CircuitCanvas nodes={nodes} edges={edges} /> : (
            <div className="h-full flex items-center justify-center text-slate-600">
              <div className="text-center"><Rocket size={30} className="mx-auto mb-2" /><div className="font-mono text-sm">Pick a circuit and hit Run &amp; Diagnose</div></div>
            </div>
          )}
        </div>
      </div>

      {/* console + diagnosis */}
      <div className="w-full md:w-[420px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/70 flex flex-col max-h-[50vh] md:max-h-none">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 font-mono text-sm font-semibold text-slate-200">
          <TerminalSquare size={15} className="text-emerald-400" /> Boot Console
        </div>
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1" data-testid="run-console">
          {logs.length === 0 && <div className="text-slate-600">$ waiting for run…</div>}
          {logs.filter((l) => l.type !== 'summary').map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-slate-600 shrink-0">{new Date(l.ts).toLocaleTimeString([], { hour12: false })}</span>
              <span style={{ color: LEVEL_COLOR[l.level] || '#94A3B8' }}>{l.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {summary && summary.diagnosis?.length > 0 && (
          <div className="border-t border-slate-800 p-3 space-y-2 max-h-[40%] overflow-y-auto" data-testid="run-diagnosis">
            <div className="text-[11px] font-mono text-amber-400 flex items-center gap-1.5"><Wrench size={12} /> DIAGNOSIS</div>
            {summary.diagnosis.map((d, i) => (
              <div key={i} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
                <div className="text-sm text-slate-100">{d.title}</div>
                <div className="text-[11px] text-emerald-400/90 mt-1 flex items-start gap-1.5"><Wrench size={11} className="mt-0.5 shrink-0" />{d.fix}</div>
              </div>
            ))}
          </div>
        )}
        {summary && summary.diagnosis?.length === 0 && (
          <div className="border-t border-slate-800 p-4 text-center text-emerald-300 text-sm font-mono flex items-center justify-center gap-2" data-testid="run-diagnosis">
            <CheckCircle2 size={16} /> Circuit stable — no faults
          </div>
        )}
      </div>
    </div>
  );
}
