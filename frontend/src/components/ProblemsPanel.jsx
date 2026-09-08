import React from 'react';
import { AlertTriangle, XCircle, Info, CheckCircle2, Wrench } from 'lucide-react';

const SEV = {
  fault: { color: '#EF4444', Icon: XCircle, label: 'FAULT' },
  warning: { color: '#F59E0B', Icon: AlertTriangle, label: 'WARNING' },
  info: { color: '#06B6D4', Icon: Info, label: 'INFO' },
};

export default function ProblemsPanel({ problems = [], onFocus, onFix, activeScope = 'root' }) {
  const list = problems;
  const faults = list.filter((p) => p.severity === 'fault').length;
  const warns = list.filter((p) => p.severity === 'warning').length;

  return (
    <div className="flex flex-col h-full" data-testid="problems-panel">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="font-mono text-sm font-semibold text-slate-200">Problem Trace</div>
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{faults} fault</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">{warns} warn</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {list.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 text-slate-500">
            <CheckCircle2 size={34} className="text-emerald-400 mb-3" />
            <div className="font-mono text-sm text-slate-300">No faults detected</div>
            <div className="text-xs mt-1">All traces nominal.</div>
          </div>
        )}
        {list.map((p) => {
          const sev = SEV[p.severity] || SEV.info;
          const Icon = sev.Icon;
          return (
            <div
              key={p.id}
              onClick={() => onFocus && onFocus(p)}
              data-testid={`problem-${p.id}`}
              className="w-full text-left rounded-md border border-slate-800 bg-slate-900/60 p-3 hover:border-slate-600 hover:bg-slate-800/60 transition-all cursor-pointer"
            >
              <div className="flex items-start gap-2.5">
                <Icon size={16} style={{ color: sev.color }} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-100">{p.title}</div>
                  {p.description && (
                    <div className="text-xs text-slate-400 mt-1 leading-relaxed">{p.description}</div>
                  )}
                  {p.fix && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-emerald-400/90">
                      <Wrench size={12} className="mt-0.5 shrink-0" />
                      <span>{p.fix}</span>
                    </div>
                  )}
                  {p.fixable && onFix && (
                    <button
                      data-testid={`fix-${p.id}`}
                      onClick={(e) => { e.stopPropagation(); onFix(p); }}
                      className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded px-2.5 py-1 transition-colors"
                    >
                      <Wrench size={11} /> Apply fix & re-check
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
