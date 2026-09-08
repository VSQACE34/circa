import React, { useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
} from '@xyflow/react';
import ChipNode from './ChipNode';
import { catOf } from '../lib/theme';

const nodeTypes = { chip: ChipNode };
const FIT_VIEW_OPTIONS = { padding: 0.25 };
const PRO_OPTIONS = { hideAttribution: true };
const DEFAULT_EDGE_OPTIONS = { type: 'smoothstep' };

export default function CircuitCanvas({
  nodes, edges, onNodesChange, onEdgesChange, onConnect,
  onNodeClick, onInit, editable = false, onDrop, onDragOver, children,
}) {
  const mmColor = useMemo(() => (n) => catOf(n.data?.category).color, []);
  return (
    <div className="w-full h-full relative" onDrop={onDrop} onDragOver={onDragOver} data-testid="circuit-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onInit={onInit}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#1E2D42" />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={mmColor} maskColor="rgba(7,10,15,0.7)" pannable zoomable />
        {children}
      </ReactFlow>
    </div>
  );
}
