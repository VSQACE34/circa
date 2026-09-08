import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNodesState, useEdgesState } from '@xyflow/react';
import { toast } from 'sonner';
import { Activity, Play, Pause, Radio, Cpu, Clock, Settings, Save, Globe, Loader2 } from 'lucide-react';
import CircuitCanvas from '../components/CircuitCanvas';
import { api } from '../lib/api';
import { toRFNodes, toRFEdges } from '../lib/graph';
import { catOf, STATUS } from '../lib/theme';

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
  const timer = useRef();

  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);

  useEffect(() => {
    api.projects().then((p) => {
      setProjects(p);
      if (p.length && !selId) setSelId(p[0].id);
    }).catch(() => {});
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!selId) return;
    api.project(selId).then((p) => { setProject(p); setConfig(p.monitor_config || {}); }).catch(() => {});
  }, [selId]);

  const saveConfig = async () => {
    setSavingCfg(true);
    try {
      await api.monitorConfig(selId, config);
      toast.success('Health-check endpoints saved', { description: 'Configured nodes now report live status.' });
      poll();
    } catch (e) {
      toast.error('Could not save endpoints');
    } finally { setSavingCfg(false); }
  };

  const poll = useCallback(async () => {
    if (!selId) return;
    try {
      const d = await api.monitor(selId);
      setTele(d.telemetry);
      setTs(d.timestamp);
    } catch (e) { /* ignore */ }
  }, [selId]);

  useEffect(() => {
    clearInterval(timer.current);
    if (live && selId) {
      poll();
      timer.current = setInterval(poll, interval);
    }
    return () => clearInterval(timer.current);
  }, [live, interval, selId, poll]);

  // merge telemetry status into the circuit graph
  const teleMap = useMemo(() => Object.fromEntries(tele.map((t) => [t.id, t])), [tele]);

  useEffect(() => {
    if (!project) return;
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
  }, [project, teleMap, setNodes, setEdges]);

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
        </div>

        <div className="h-full pt-12">
          <CircuitCanvas nodes={nodes} edges={edges} />
        </div>
      </div>

      {/* telemetry panel */}
      <div className="w-full md:w-[340px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/60 flex flex-col max-h-[45vh] md:max-h-none">
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
      </div>
    </div>
  );
}
