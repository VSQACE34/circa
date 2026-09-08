import {
  Layout, Server, Database, Brain, Shield, HardDrive, Zap, Globe, Monitor, Cpu,
} from 'lucide-react';

export const CATEGORY = {
  client: { color: '#94A3B8', glow: 'rgba(148,163,184,0.5)', Icon: Monitor, name: 'CLIENT' },
  frontend: { color: '#06B6D4', glow: 'rgba(6,182,212,0.55)', Icon: Layout, name: 'FRONTEND' },
  backend: { color: '#10B981', glow: 'rgba(16,185,129,0.55)', Icon: Server, name: 'BACKEND' },
  database: { color: '#F59E0B', glow: 'rgba(245,158,11,0.55)', Icon: Database, name: 'DATABASE' },
  llm: { color: '#8B5CF6', glow: 'rgba(139,92,246,0.55)', Icon: Brain, name: 'LLM AGENT' },
  auth: { color: '#F43F5E', glow: 'rgba(244,63,94,0.55)', Icon: Shield, name: 'AUTH' },
  storage: { color: '#38BDF8', glow: 'rgba(56,189,248,0.55)', Icon: HardDrive, name: 'STORAGE' },
  cache: { color: '#EC4899', glow: 'rgba(236,72,153,0.55)', Icon: Zap, name: 'CACHE' },
  external: { color: '#A3A3A3', glow: 'rgba(163,163,163,0.5)', Icon: Globe, name: 'EXTERNAL' },
  service: { color: '#22D3EE', glow: 'rgba(34,211,238,0.5)', Icon: Cpu, name: 'SERVICE' },
};

export const catOf = (c) => CATEGORY[c] || CATEGORY.service;

export const STATUS = {
  healthy: { color: '#10B981', label: 'HEALTHY' },
  warning: { color: '#F59E0B', label: 'WARNING' },
  fault: { color: '#EF4444', label: 'FAULT' },
};
