import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNodesState, useEdgesState, addEdge, useReactFlow, MarkerType } from '@xyflow/react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { Download, Loader2, Trash2, Plus, MousePointerClick, Sparkles, Save, FolderOpen, ChevronDown } from 'lucide-react';
import CircuitCanvas from '../components/CircuitCanvas';
import ChatOnboarding from '../components/ChatOnboarding';
import CodegenPreview from '../components/CodegenPreview';
import { api, API, MODELS } from '../lib/api';
import { catOf } from '../lib/theme';
import { toRFNodes, toRFEdges } from '../lib/graph';

let idc = 1;
const nid = (k) => `${k}_${idc++}`;

export default function BuilderPage() {
  const [stage, setStage] = useState('chat'); // chat | build
  const [model, setModel] = useState(MODELS[0]);
  const [palette, setPalette] = useState([]);
  const [rules, setRules] = useState({});
  const [projectName, setProjectName] = useState('my-circuit-app');
  const [exporting, setExporting] = useState(false);
  const [aiExporting, setAiExporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [circuits, setCircuits] = useState([]);
  const [currentCircuitId, setCurrentCircuitId] = useState(null);
  const [savingCircuit, setSavingCircuit] = useState(false);
  const [showCircuits, setShowCircuits] = useState(false);
  const location = useLocation();
  const loadedRef = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    api.palette().then((d) => { setPalette(d.palette); setRules(d.rules); }).catch(() => {});
  }, []);

  const refreshCircuits = useCallback(() => {
    api.circuits().then(setCircuits).catch((e) => console.error('load circuits failed', e));
  }, []);
  useEffect(() => { refreshCircuits(); }, [refreshCircuits]);

  useEffect(() => {
    if (location.state?.graph && !loadedRef.current) {
      loadedRef.current = true;
      setStage('build');
      setNodes(toRFNodes(location.state.graph, { editable: true }));
      setEdges(toRFEdges(location.state.graph));
      if (location.state.name) setProjectName(location.state.name.replace(/[^a-zA-Z0-9-_]/g, '-'));
      toast.success('Loaded analyzed circuit', { description: 'Re-wire it and export when ready.' });
    }
  }, [location.state, setNodes, setEdges]);

  const onReady = async ({ conversation }) => {
    setStage('build');
    try {
      const { graph } = await api.generate({ session_id: 'b', answers: { conversation } });
      setNodes(toRFNodes(graph, { editable: true }));
      setEdges(toRFEdges(graph));
      toast.success('Preliminary circuit generated', { description: 'Stable & fully connected. Add more components!' });
    } catch (e) {
      toast.error('Could not generate circuit');
    }
  };

  const onConnect = useCallback((params) => {
    const src = nodesRef.current.find((n) => n.id === params.source);
    const tgt = nodesRef.current.find((n) => n.id === params.target);
    if (!src || !tgt) return;
    const allowed = rules[src.data.category] || [];
    if (!allowed.includes(tgt.data.category)) {
      toast.error('Invalid connection', {
        description: `A ${src.data.category} cannot wire directly to a ${tgt.data.category}.`,
      });
      return;
    }
    const color = catOf(src.data.category).color;
    setEdges((eds) => addEdge({
      ...params,
      type: 'smoothstep',
      className: 'wire-active',
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    }, eds));
  }, [rules, setEdges]);

  const onDragStart = (e, item) => {
    e.dataTransfer.setData('application/circuit', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/circuit');
    if (!raw) return;
    const item = JSON.parse(raw);
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const id = nid(item.key);
    setNodes((nds) => nds.concat({
      id, type: 'chip', position, draggable: true,
      data: { id, label: item.label, category: item.category, status: 'healthy', meta: { desc: item.desc } },
    }));
    toast.success(`${item.label} placed`, { description: 'Drag from its edge to wire it up.' });
  }, [screenToFlowPosition, setNodes]);

  const deleteSelected = () => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((ed) => !ed.selected));
  };

  const getGraph = () => ({
    nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, category: n.data.category, position: n.position })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, protocol: e.data?.protocol || '', label: e.label || '' })),
  });

  const saveCircuit = async () => {
    if (nodes.length === 0) return toast.error('Nothing to save');
    setSavingCircuit(true);
    try {
      const body = { name: projectName, graph: getGraph() };
      const saved = currentCircuitId
        ? await api.updateCircuit(currentCircuitId, body)
        : await api.createCircuit(body);
      setCurrentCircuitId(saved.id);
      refreshCircuits();
      toast.success('Circuit saved', { description: `${saved.name} · v${saved.version}` });
    } catch (e) {
      toast.error('Save failed', { description: e.message });
    } finally { setSavingCircuit(false); }
  };

  const openCircuit = async (id) => {
    setShowCircuits(false);
    try {
      const c = await api.circuit(id);
      setStage('build');
      setNodes(toRFNodes(c.graph, { editable: true }));
      setEdges(toRFEdges(c.graph));
      setProjectName(c.name);
      setCurrentCircuitId(c.id);
      toast.success('Circuit loaded', { description: `${c.name} · v${c.version}` });
    } catch (e) { toast.error('Could not load circuit'); }
  };

  const removeCircuit = async (id, e) => {
    e.stopPropagation();
    await api.deleteCircuit(id);
    if (currentCircuitId === id) setCurrentCircuitId(null);
    refreshCircuits();
  };

  const doExport = async (ai = false) => {
    if (nodes.length === 0) return toast.error('Add components first');
    ai ? setAiExporting(true) : setExporting(true);
    if (ai) toast.info('Generating real code with AI…', { description: 'This can take up to ~90 seconds.' });
    try {
      const graph = getGraph();
      if (!ai) {
        const res = await axios.post(`${API}/builder/export`, { name: projectName, graph, ai: false }, { responseType: 'blob' });
        triggerDownload(URL.createObjectURL(res.data), `${projectName}.zip`);
        toast.success('Scaffold exported', { description: `${projectName}.zip downloaded` });
        return;
      }
      // AI codegen runs as a background job (avoids the ~60s ingress timeout)
      const { data } = await axios.post(`${API}/builder/export-job`, { name: projectName, graph, ai: true, model: model.id, provider: model.provider });
      const jobId = data.job_id;
      let tries = 0;
      while (tries < 90) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await axios.get(`${API}/builder/export-job/${jobId}`);
        if (s.data.status === 'done') {
          const f = await api.exportJobFiles(jobId);
          setPreview({ jobId, files: f.files, filename: f.filename, aiCount: f.ai_files });
          toast.success('Code generated', { description: `${f.ai_files} AI files — preview & download` });
          return;
        }
        if (s.data.status === 'error') throw new Error(s.data.error || 'codegen failed');
        tries++;
      }
      throw new Error('timed out');
    } catch (e) {
      toast.error(ai ? 'AI codegen failed' : 'Export failed', { description: e.message });
    } finally {
      ai ? setAiExporting(false) : setExporting(false);
    }
  };

  const triggerDownload = (href, filename) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
  };

  if (stage === 'chat') {
    return <ChatOnboarding model={model} setModel={setModel} onReady={onReady} />;
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* palette */}
      <div className="w-56 shrink-0 border-r border-slate-800 bg-slate-950/60 flex flex-col" data-testid="component-palette">
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="font-mono text-sm font-semibold text-slate-200">Components</div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5"><MousePointerClick size={11} /> drag onto board</div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {palette.map((item) => {
            const cat = catOf(item.category);
            const Icon = cat.Icon;
            return (
              <div
                key={item.key}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                data-testid={`palette-${item.key}`}
                className="group flex items-center gap-2.5 rounded-md border border-slate-800 bg-slate-900/60 p-2.5 cursor-grab active:cursor-grabbing hover:border-slate-600 transition-all"
              >
                <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: `${cat.color}1a`, border: `1px solid ${cat.color}55` }}>
                  <Icon size={15} style={{ color: cat.color }} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 leading-tight">{item.label}</div>
                  <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* canvas */}
      <div className="flex-1 relative pcb-grid">
        <div className="absolute top-0 left-0 right-0 z-20 glass border-b border-slate-800 px-4 py-2.5 flex items-center gap-3">
          <input
            data-testid="project-name-input"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="bg-slate-950/60 border border-slate-700 rounded px-2.5 py-1.5 text-sm font-mono text-slate-100 outline-none focus:border-emerald-500/50 w-52"
          />
          <div className="text-[11px] font-mono text-slate-500">{nodes.length} chips · {edges.length} traces</div>

          <div className="relative">
            <button data-testid="circuits-menu-btn" onClick={() => { setShowCircuits((v) => !v); if (!showCircuits) refreshCircuits(); }} className="text-xs font-mono text-slate-300 hover:text-slate-100 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-800 hover:border-slate-600">
              <FolderOpen size={13} /> My Circuits <ChevronDown size={12} />
            </button>
            {showCircuits && (
              <div className="absolute left-0 top-full mt-1 w-64 max-h-72 overflow-y-auto glass rounded-md border border-slate-800 shadow-xl z-30 p-1.5" data-testid="circuits-menu">
                {circuits.length === 0 && <div className="text-[11px] text-slate-500 px-2 py-3 text-center">No saved circuits yet</div>}
                {circuits.map((c) => (
                  <div key={c.id} data-testid={`circuit-item-${c.id}`} onClick={() => openCircuit(c.id)} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800/60 cursor-pointer">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-100 truncate">{c.name}</div>
                      <div className="text-[10px] font-mono text-slate-500">v{c.version}</div>
                    </div>
                    <button onClick={(e) => removeCircuit(c.id, e)} data-testid={`circuit-del-${c.id}`} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button data-testid="save-circuit-btn" onClick={saveCircuit} disabled={savingCircuit} className="text-xs font-mono text-emerald-300 hover:text-emerald-200 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/5 disabled:opacity-50">
              {savingCircuit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </button>
            <button data-testid="delete-selected-btn" onClick={deleteSelected} className="text-xs font-mono text-slate-400 hover:text-red-400 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-800 hover:border-red-500/40">
              <Trash2 size={13} /> Delete
            </button>
            <button data-testid="ai-export-btn" onClick={() => doExport(true)} disabled={aiExporting || exporting} className="text-sm font-semibold text-cyan-200 border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 flex items-center gap-1.5 px-3.5 py-1.5 rounded disabled:opacity-50">
              {aiExporting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Codegen
            </button>
            <button data-testid="export-btn" onClick={() => doExport(false)} disabled={exporting || aiExporting} className="text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 flex items-center gap-1.5 px-3.5 py-1.5 rounded disabled:opacity-50">
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export
            </button>
          </div>
        </div>

        <div className="h-full pt-12">
          <CircuitCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            editable
          />
        </div>

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-slate-600">
              <Plus size={30} className="mx-auto mb-2" />
              <div className="font-mono text-sm">Drag components from the palette to start wiring</div>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <CodegenPreview
          files={preview.files}
          filename={preview.filename}
          aiCount={preview.aiCount}
          onClose={() => setPreview(null)}
          onDownload={() => triggerDownload(`${API}/builder/export-job/${preview.jobId}/download`, preview.filename)}
        />
      )}
    </div>
  );
}
