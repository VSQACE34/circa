import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { catOf, STATUS } from '../lib/theme';
import { X, ChevronRight } from 'lucide-react';

export default function ChipNode({ data, selected }) {
  const cat = catOf(data.category);
  const st = STATUS[data.status] || STATUS.healthy;
  const Icon = cat.Icon;
  const isFault = data.status === 'fault';

  return (
    <div
      data-testid={`node-${data.category}-${data.id}`}
      className="relative select-none"
      style={{ width: 190 }}
    >
      <Handle type="target" position={Position.Left} style={{ background: cat.color }} />
      <Handle type="source" position={Position.Right} style={{ background: cat.color }} />

      {/* pin leads top/bottom for IC look */}
      <div className="absolute -top-1 left-0 right-0 flex justify-around px-4 pointer-events-none">
        {[...Array(5)].map((_, i) => (
          <span key={`pin-top-${i}`} className="w-1 h-2 rounded-sm" style={{ background: '#334155' }} />
        ))}
      </div>
      <div className="absolute -bottom-1 left-0 right-0 flex justify-around px-4 pointer-events-none">
        {[...Array(5)].map((_, i) => (
          <span key={`pin-bottom-${i}`} className="w-1 h-2 rounded-sm" style={{ background: '#334155' }} />
        ))}
      </div>

      <div
        className="rounded-md px-3 py-3 transition-all"
        style={{
          background: 'linear-gradient(160deg,#141e30,#0d1524)',
          border: `1px solid ${selected ? cat.color : 'rgba(30,45,66,0.9)'}`,
          boxShadow: selected
            ? `0 0 0 1px ${cat.color}, 0 0 22px ${cat.glow}`
            : `0 6px 20px rgba(0,0,0,0.5)`,
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded flex items-center justify-center shrink-0"
            style={{ background: `${cat.color}1a`, border: `1px solid ${cat.color}55` }}
          >
            <Icon size={16} style={{ color: cat.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-mono tracking-widest" style={{ color: cat.color }}>
              {cat.name}
            </div>
            <div className="text-sm font-semibold text-slate-100 truncate leading-tight">
              {data.label}
            </div>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${data.status !== 'fault' ? 'led-pulse' : ''}`}
            style={{ background: st.color, boxShadow: `0 0 8px ${st.color}` }}
          />
        </div>

        {data.meta && (data.meta.framework || data.meta.engine || data.meta.provider) && (
          <div className="mt-2 text-[10px] font-mono text-slate-400 truncate">
            {data.meta.framework || data.meta.engine || data.meta.provider}
          </div>
        )}

        {data.has_children && (
          <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-emerald-400">
            <ChevronRight size={11} /> drill down
          </div>
        )}
      </div>

      {isFault && (
        <div
          className="absolute -top-3 -right-3 w-7 h-7 rounded-full flex items-center justify-center fault-blink"
          style={{ background: '#EF4444', boxShadow: '0 0 14px rgba(239,68,68,0.9)' }}
          data-testid={`fault-marker-${data.id}`}
        >
          <X size={16} className="text-white" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}
