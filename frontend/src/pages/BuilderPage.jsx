import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNodesState, useEdgesState, addEdge, useReactFlow, MarkerType } from '@xyflow/react';
import axios from 'axios';
import { toast } from 'sonner';
import { Download, Loader2, Trash2, Plus, MousePointerClick } from 'lucide-react';
import CircuitCanvas from '../components/CircuitCanvas';
import ChatOnboarding from '../components/ChatOnboarding';
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

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    api.palette().then((d) => { setPalette(d.palette); setRules(d.rules); }).catch(() => {});
  }, []);

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

  const doExport = async () => {
    if (nodes.length === 0) return toast.error('Add components first');
    setExporting(true);
    try {
      const graph = {
        nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, category: n.data.category, position: n.position })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, protocol: e.data?.protocol || '', label: e.label || '' })),
      };
      const res = await axios.post(`${API}/builder/export`, { name: projectName, graph }, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${projectName}.zip`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      toast.success('Full-stack scaffold exported', { description: `${projectName}.zip downloaded` });
    } catch (e) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
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
          <div className="ml-auto flex items-center gap-2">
            <button data-testid="delete-selected-btn" onClick={deleteSelected} className="text-xs font-mono text-slate-400 hover:text-red-400 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-800 hover:border-red-500/40">
              <Trash2 size={13} /> Delete
            </button>
            <button data-testid="export-btn" onClick={doExport} disabled={exporting} className="text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 flex items-center gap-1.5 px-3.5 py-1.5 rounded disabled:opacity-50">
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
    </div>
  );
}
