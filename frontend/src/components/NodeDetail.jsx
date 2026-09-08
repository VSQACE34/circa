import React from 'react';
import { X, ChevronRight, Server, Database, Layout } from 'lucide-react';
import { catOf } from '../lib/theme';

export default function NodeDetail({ detail, onClose, onDrill }) {
  const n = detail.node;
  const cat = catOf(n.category);
  const Icon = cat.Icon;
  const meta = n.meta || {};
  const endpoints = meta.endpoint_list || meta.endpoints || [];
  const tables = meta.tables || [];

  return (
    <div
      className="absolute top-14 right-3 z-30 w-[320px] max-h-[80%] rounded-lg glass shadow-2xl flex flex-col fade-up"
      data-testid="node-detail-drawer"
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800">
        <div className="w-8 h-8 rounded flex items-center justify-center shrink-0"
          style={{ background: `${cat.color}1a`, border: `1px solid ${cat.color}55` }}>
          <Icon size={16} style={{ color: cat.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-mono tracking-widest" style={{ color: cat.color }}>{cat.name}</div>
          <div className="text-sm font-semibold text-slate-100 truncate">{n.label}</div>
        </div>
        <button onClick={onClose} data-testid="node-detail-close" className="text-slate-500 hover:text-slate-200">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {(meta.framework || meta.engine || meta.provider || meta.kind || meta.desc) && (
          <div className="grid grid-cols-2 gap-2">
            {meta.framework && <Field label="Framework" value={meta.framework} />}
            {meta.engine && <Field label="Engine" value={meta.engine} />}
            {meta.provider && <Field label="Provider" value={meta.provider} />}
            {meta.kind && <Field label="Kind" value={meta.kind} />}
            {typeof meta.files === 'number' && <Field label="Files" value={meta.files} />}
            {typeof meta.endpoints === 'number' && <Field label="Endpoints" value={meta.endpoints} />}
            {typeof meta.api_calls === 'number' && <Field label="API calls" value={meta.api_calls} />}
          </div>
        )}

        {endpoints.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 mb-2">
              <Server size={12} /> ENDPOINTS ({endpoints.length})
            </div>
            <div className="space-y-1" data-testid="detail-endpoints">
              {endpoints.map((e, i) => {
                const [method, ...rest] = String(e).split(' ');
                return (
                  <div key={`${e}-${i}`} className="flex items-center gap-2 text-xs font-mono bg-slate-950/60 rounded px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${methodColor(method)}`}>{method}</span>
                    <span className="text-slate-300 truncate">{rest.join(' ')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tables.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400 mb-2">
              <Database size={12} /> TABLES / COLLECTIONS ({tables.length})
            </div>
            <div className="flex flex-wrap gap-1.5" data-testid="detail-tables">
              {tables.map((t) => (
                <span key={t} className="text-xs font-mono bg-amber-500/10 text-amber-300 border border-amber-500/25 rounded px-2 py-1">{t}</span>
              ))}
            </div>
          </div>
        )}

        {endpoints.length === 0 && tables.length === 0 && !meta.framework && !meta.engine && !meta.provider && (
          <div className="text-xs text-slate-500 text-center py-4 flex flex-col items-center gap-2">
            <Layout size={20} className="text-slate-600" />
            No extra detail extracted for this component.
          </div>
        )}
      </div>

      {detail.canDrill && (
        <button
          data-testid="node-detail-drill"
          onClick={() => onDrill(n.id)}
          className="m-3 py-2.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 transition-colors flex items-center justify-center gap-1.5"
        >
          Drill down into {n.label} <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

const Field = ({ label, value }) => (
  <div className="bg-slate-950/50 rounded px-2.5 py-2">
    <div className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{label}</div>
    <div className="text-xs text-slate-200 truncate">{value}</div>
  </div>
);

function methodColor(m) {
  const map = {
    GET: 'bg-emerald-500/20 text-emerald-300',
    POST: 'bg-cyan-500/20 text-cyan-300',
    PUT: 'bg-amber-500/20 text-amber-300',
    PATCH: 'bg-purple-500/20 text-purple-300',
    DELETE: 'bg-red-500/20 text-red-300',
  };
  return map[m] || 'bg-slate-500/20 text-slate-300';
}
