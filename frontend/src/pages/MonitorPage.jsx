import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNodesState, useEdgesState } from '@xyflow/react';
import { toast } from 'sonner';
import { Activity, Play, Pause, Radio, Cpu, Clock, Settings, Save, Globe, Loader2, PlugZap, Copy, Wifi } from 'lucide-react';
import CircuitCanvas from '../components/CircuitCanvas';
import { api, API } from '../lib/api';
import { toRFNodes, toRFEdges } from '../lib/graph';
import { catOf, STATUS } from '../lib/theme';
import { pythonSnippet, expressSnippet } from '../lib/snippets';

const INTERVALS = [
  { ms: 2000, label: '2s' },
  { ms: 5000, label: '5s' },
  { ms: 30000, label: '30s' },
];

export default function MonitorPage() {
  const [projects, setProjects] = useState([]);
  const [selId, setSelId] = useState('');
  const [project, setProject] = useState(null);
  const [live, setLive] = useState(true);
  const [interval, setIntervalMs] = useState(2000);
  const [tele, setTele] = useState([]);
  const [ts, setTs] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({});
  const [savingCfg, setSavingCfg] = useState(false);
  const [mode, setMode] = useState('telemetry');
  const [token, setToken] = useState('');
  const [snippetLang, setSnippetLang] = useState('python');
  const [agentEvents, setAgentEvents] = useState([]);
  const [agentStatus, setAgentStatus] = useState({});
  const [agentActive, setAgentActive] = useState({});
  const esRef = useRef(null);
  const timer = useRef();

  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);

  useEffect(() => {
    api.projects().then((p) => {
      setProjects(p);
      if (p.length && !selId) setSelId(p[0].id);
    }).catch((e) => console.error('load projects failed', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount only

  useEffect(() => {
    if (!selId) return;
    api.project(selId).then((p) => { setProject(p); setConfig(p.monitor_config || {}); })
      .catch((e) => console.error('load project failed', e));
  }, [selId]);

  const poll = useCallback(async () => {
    if (!selId) return;
    try {
      const d = await api.monitor(selId);
      setTele(d.telemetry);
      setTs(d.timestamp);
    } catch (e) {
      console.error('monitor poll failed', e);
    }
  }, [selId]);

  const saveConfig = useCallback(async () => {
    setSavingCfg(true);
    try {
      await api.monitorConfig(selId, config);
      toast.success('Health-check endpoints saved', { description: 'Configured nodes now report live status.' });
      poll();
    } catch (e) {
      console.error('save monitor config failed', e);
      toast.error('Could not save endpoints');
    } finally { setSavingCfg(false); }
  }, [selId, config, poll]);

  useEffect(() => {
    clearInterval(timer.current);
    if (live && selId && mode === 'telemetry') {
      poll();
      timer.current = setInterval(poll, interval);
    }
    return () => clearInterval(timer.current);
  }, [live, interval, selId, poll, mode]);

  // merge telemetry status into the circuit graph
  const teleMap = useMemo(() => Object.fromEntries(tele.map((t) => [t.id, t])), [tele]);

  useEffect(() => {
    if (mode !== 'telemetry' || !project) return;
    const g = project.graph;
    const merged = {
      nodes: g.nodes.map((n) => ({ ...n, status: teleMap[n.id]?.status || n.status })),
      edges: g.edges.map((e) => {
        const s = teleMap[e.source]?.status, t = teleMap[e.target]?.status;
        let status = 'healthy';
        if (s === 'fault' || t === 'fault') status = 'fault';
        else if (s === 'warning' || t === 'warning') status = 'warning';
        return { ...e, status };
      }),
    };
    setNodes(toRFNodes(merged));
    setEdges(toRFEdges(merged));
  }, [project, teleMap, setNodes, setEdges, mode]);

  const ingestUrl = selId ? `${API}/agent/${selId}/ingest` : '';
  const snippet = useMemo(
    () => (snippetLang === 'python' ? pythonSnippet(ingestUrl, token) : expressSnippet(ingestUrl, token)),
    [snippetLang, ingestUrl, token],
  );

  // Live Agent: subscribe to the SSE event stream from the user's running app
  useEffect(() => {
    if (mode !== 'agent' || !selId || !project) return undefined;
    api.getAgent(selId).then((d) => setToken(d.token)).catch((e) => console.error('agent token failed', e));
    setAgentStatus({});
    setAgentEvents([]);
    const es = new EventSource(`${API}/agent/${selId}/stream`);
    esRef.current = es;
    es.onmessage = (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      setAgentEvents((l) => [ev, ...l].slice(0, 40));
      const node = project.graph.nodes.find((n) => n.category === ev.target);
      const isErr = ev.kind === 'error' || (ev.status && ev.status >= 500);
      if (node) {
        setAgentStatus((s) => ({ ...s, [node.id]: isErr ? 'fault' : 'healthy' }));
        const keys = project.graph.edges.filter((e) => e.target === node.id).map((e) => `${e.source}->${e.target}`);
        if (keys.length) {
          setAgentActive((a) => { const c = { ...a }; keys.forEach((k) => (c[k] = Date.now())); return c; });
          setTimeout(() => setAgentActive((a) => { const c = { ...a }; keys.forEach((k) => delete c[k]); return c; }), 1300);
        }
      }
    };
    return () => { es.close(); esRef.current = null; };
  }, [mode, selId, project]);

  useEffect(() => {
    if (mode !== 'agent' || !project) return;
    const g = project.graph;
    const merged = { nodes: g.nodes.map((n) => ({ ...n, status: agentStatus[n.id] || 'idle' })), edges: g.edges };
    const rfEdges = toRFEdges(merged).map((e) => {
      const key = `${e.source}->${e.target}`;
      return agentActive[key] ? { ...e, className: 'wire-active', style: { ...e.style, stroke: '#22D3EE', strokeWidth: 3 } } : e;
    });
    setNodes(toRFNodes(merged));
    setEdges(rfEdges);
  }, [mode, project, agentStatus, agentActive, setNodes, setEdges]);

  if (projects.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center pcb-grid">
        <div className="text-center text-slate-500">
          <Activity size={34} className="mx-auto mb-3 text-slate-600" />
          <div className="font-mono text-slate-300">No circuits to monitor yet</div>
          <div className="text-xs mt-1">Analyze a codebase first, then watch it live here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col md:flex-row">
      <div className="flex-1 relative pcb-grid">
        <div className="absolute top-0 left-0 right-0 z-20 glass border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-3">
          <select
            data-testid="monitor-project-select"
            value={selId}
            onChange={(e) => setSelId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-md text-sm font-mono text-slate-200 px-2.5 py-1.5 outline-none max-w-[220px]"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div className="flex items-center gap-1 rounded-md border border-slate-800 p-0.5">
            <button data-testid="mode-telemetry" onClick={() => setMode('telemetry')} className={`text-xs font-mono px-2.5 py-1 rounded ${mode === 'telemetry' ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>Telemetry</button>
            <button data-testid="mode-agent" onClick={() => setMode('agent')} className={`text-xs font-mono px-2.5 py-1 rounded ${mode === 'agent' ? 'bg-cyan-600/40 text-cyan-100' : 'text-slate-500 hover:text-slate-300'}`}>Live Agent</button>
          </div>

          {mode === 'telemetry' && (
            <>
              <button
                data-testid="monitor-toggle"
                onClick={() => setLive((v) => !v)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border font-mono transition-all ${
                  live ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400'
                }`}
              >
                {live ? <Pause size={14} /> : <Play size={14} />} {live ? 'Live' : 'Paused'}
              </button>

              <div className="flex items-center gap-1 rounded-md border border-slate-800 p-0.5">
                {INTERVALS.map((iv) => (
                  <button
                    key={iv.ms}
                    data-testid={`interval-${iv.label}`}
                    onClick={() => setIntervalMs(iv.ms)}
                    className={`text-xs font-mono px-2 py-1 rounded ${interval === iv.ms ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                    {iv.label}
                  </button>
                ))}
              </div>

              {live && <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400"><Radio size={12} className="led-pulse" /> streaming</span>}
              {ts && <span className="ml-auto text-[11px] font-mono text-slate-500 hidden md:flex items-center gap-1"><Clock size={11} /> {new Date(ts).toLocaleTimeString()}</span>}
            </>
          )}
          {mode === 'agent' && (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-400"><Wifi size={12} className="led-pulse" /> agent listening</span>
          )}
        </div>

        <div className="h-full pt-12">
          <CircuitCanvas nodes={nodes} edges={edges} />
        </div>
      </div>

      {/* right panel */}
      <div className="w-full md:w-[360px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/60 flex flex-col max-h-[45vh] md:max-h-none">
        {mode === 'telemetry' ? (
        <>
        <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
          <Cpu size={15} className="text-emerald-400" />
          <span className="font-mono text-sm font-semibold text-slate-200">Telemetry</span>
          <button
            data-testid="monitor-config-toggle"
            onClick={() => setShowConfig((v) => !v)}
            className={`ml-auto flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border transition-all ${showConfig ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400 hover:text-slate-100'}`}
          >
            <Settings size={12} /> Endpoints
          </button>
        </div>

        {showConfig && project && (
          <div className="border-b border-slate-800 p-3 space-y-2 bg-slate-950/40" data-testid="monitor-config-editor">
            <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
              <Globe size={11} /> Set a real health-check URL per component
            </div>
            {project.graph.nodes.map((n) => (
              <div key={n.id} className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400 w-20 truncate shrink-0" title={n.label}>{n.label}</span>
                <input
                  data-testid={`config-url-${n.id}`}
                  value={config[n.id] || ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [n.id]: e.target.value }))}
                  placeholder="https://…/health"
                  className="flex-1 bg-slate-950/60 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-100 outline-none focus:border-emerald-500/50 min-w-0"
                />
              </div>
            ))}
            <button
              data-testid="save-config-btn"
              onClick={saveConfig}
              disabled={savingCfg}
              className="w-full mt-1 py-2 rounded-md bg-emerald-500 text-slate-950 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {savingCfg ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save & probe
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="telemetry-list">
          {tele.map((t) => {
            const cat = catOf(t.category);
            const st = STATUS[t.status] || STATUS.healthy;
            const Icon = cat.Icon;
            return (
              <div key={t.id} data-testid={`telemetry-${t.id}`} className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex items-center gap-2">
                  <Icon size={14} style={{ color: cat.color }} />
                  <div className="text-sm text-slate-100 flex-1 truncate">{t.label}</div>
                  {t.source === 'live' && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300" title={t.url}>LIVE</span>
                  )}
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${st.color}22`, color: st.color }}>{st.label}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[10px] font-mono text-slate-500">LATENCY</div><div className="text-sm font-mono" style={{ color: st.color }}>{t.latency_ms}ms</div></div>
                  <div><div className="text-[10px] font-mono text-slate-500">UPTIME</div><div className="text-sm font-mono text-slate-200">{t.uptime}%</div></div>
                  <div><div className="text-[10px] font-mono text-slate-500">REQ/M</div><div className="text-sm font-mono text-slate-200">{t.requests}</div></div>
                </div>
              </div>
            );
          })}
        </div>
        </>
        ) : (
        <>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <PlugZap size={15} className="text-cyan-400" />
            <span className="font-mono text-sm font-semibold text-slate-200">Live Agent</span>
          </div>
          <div className="border-b border-slate-800 p-3 space-y-2">
            <div className="text-[11px] font-mono text-slate-500">Paste into your running app — every request streams here live (works offline on your PC):</div>
            <div className="flex items-center gap-1 rounded-md border border-slate-800 p-0.5 w-max">
              {[['python', 'FastAPI'], ['express', 'Express']].map(([l, lbl]) => (
                <button key={l} data-testid={`snippet-${l}`} onClick={() => setSnippetLang(l)} className={`text-xs font-mono px-2.5 py-1 rounded ${snippetLang === l ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>{lbl}</button>
              ))}
            </div>
            <div className="relative">
              <pre className="text-[10px] font-mono bg-slate-950 border border-slate-800 rounded p-2.5 max-h-56 overflow-auto text-slate-300 whitespace-pre-wrap" data-testid="agent-snippet">{snippet}</pre>
              <button data-testid="copy-snippet-btn" onClick={() => { navigator.clipboard.writeText(snippet); toast.success('Agent snippet copied'); }} className="absolute top-2 right-2 text-slate-400 hover:text-slate-100 bg-slate-900/80 rounded p-1"><Copy size={13} /></button>
            </div>
            <div className="text-[10px] font-mono text-slate-600 break-all">POST {ingestUrl}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5" data-testid="agent-feed">
            {agentEvents.length === 0 && <div className="text-xs text-slate-600 text-center py-8">Waiting for events…<br />start your app and hit an endpoint.</div>}
            {agentEvents.map((ev) => {
              const isErr = ev.kind === 'error' || (ev.status && ev.status >= 500);
              return (
                <div key={ev.id} className="flex items-center gap-2 text-xs font-mono rounded bg-slate-900/60 border border-slate-800 px-2 py-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] shrink-0 ${isErr ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{ev.kind}</span>
                  {ev.method && <span className="text-slate-400 shrink-0">{ev.method}</span>}
                  <span className="text-slate-200 truncate flex-1">{ev.path || ev.message || ev.target}</span>
                  {ev.status ? <span className={isErr ? 'text-red-300' : 'text-slate-400'}>{ev.status}</span> : null}
                  {ev.latency_ms != null ? <span className="text-slate-500 shrink-0">{ev.latency_ms}ms</span> : null}
                </div>
              );
            })}
          </div>
        </>
        )}
      </div>
    </div>
  );
}
