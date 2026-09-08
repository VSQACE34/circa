import { MarkerType } from '@xyflow/react';
import { STATUS } from './theme';

export function toRFNodes(graph, { editable = false } = {}) {
  return (graph.nodes || []).map((n) => ({
    id: n.id,
    type: 'chip',
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    draggable: editable,
    data: { ...n },
  }));
}

export function toRFEdges(graph) {
  return (graph.edges || []).map((e) => {
    const st = STATUS[e.status] || STATUS.healthy;
    const healthy = e.status === 'healthy' || !e.status;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: false,
      className: healthy ? 'wire-active' : '',
      label: e.status === 'fault' ? '✕' : e.label,
      labelStyle: {
        fill: e.status === 'fault' ? '#EF4444' : '#64748B',
        fontFamily: 'Fira Code, monospace',
        fontSize: e.status === 'fault' ? 18 : 10,
        fontWeight: e.status === 'fault' ? 800 : 500,
      },
      labelBgStyle: { fill: '#0b1220', fillOpacity: 0.85 },
      labelBgPadding: [4, 2],
      style: { stroke: st.color, strokeWidth: e.status === 'fault' ? 2.5 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: st.color, width: 16, height: 16 },
      data: { status: e.status },
    };
  });
}
