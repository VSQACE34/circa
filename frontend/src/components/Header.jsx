import React from 'react';
import { NavLink } from 'react-router-dom';
import { Cpu, Activity, ScanLine, Wrench, Rocket } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Analyzer', icon: ScanLine, testid: 'nav-analyzer' },
  { to: '/builder', label: 'Builder', icon: Wrench, testid: 'nav-builder' },
  { to: '/run', label: 'Live Run', icon: Rocket, testid: 'nav-run' },
  { to: '/monitor', label: 'Live Monitor', icon: Activity, testid: 'nav-monitor' },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-50 glass border-b border-slate-800" data-testid="app-header">
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-16 flex items-center gap-6">
        <NavLink to="/" className="flex items-center gap-2.5 shrink-0" data-testid="brand-logo">
          <div className="w-9 h-9 rounded-md flex items-center justify-center"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.4)' }}>
            <Cpu size={18} className="text-emerald-400" />
          </div>
          <div className="leading-none">
            <div className="font-mono text-lg font-bold tracking-tight text-slate-100">CIRCUIT</div>
            <div className="text-[9px] font-mono tracking-[0.25em] text-emerald-500/80">STACK SIMULATOR</div>
          </div>
        </NavLink>

        <nav className="flex items-center gap-1 ml-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === '/'}
                data-testid={t.testid}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                  }`
                }
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{t.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-[11px] font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 led-pulse" />
          <span className="text-slate-400 hidden md:inline">SYSTEM ONLINE</span>
        </div>
      </div>
    </header>
  );
}
