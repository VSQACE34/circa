import React, { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Bot, User, Cpu } from 'lucide-react';
import { streamChat, MODELS } from '../lib/api';

const GREETING =
  "Hey! I'm your Circuit architect. Let's design your app before we wire it up. First — what kind of app are you building, and who's it for?";

const uid = () => 'm' + Math.random().toString(36).slice(2);

export default function ChatOnboarding({ model, setModel, onReady }) {
  const [messages, setMessages] = useState([{ id: uid(), role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const sessionId = useRef('build-' + Math.random().toString(36).slice(2)).current;
  const endRef = useRef();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const next = [...messages, { id: uid(), role: 'user', content: text }, { id: uid(), role: 'assistant', content: '' }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const full = await streamChat({
        session_id: sessionId, message: text, model: model.id, provider: model.provider,
        history,
        onDelta: (acc) => {
          setMessages((prev) => {
            const c = [...prev];
            c[c.length - 1] = { ...c[c.length - 1], content: acc };
            return c;
          });
        },
      });
      if (full.includes('READY:')) setReady(true);
    } catch (e) {
      setMessages((prev) => {
        const c = [...prev];
        c[c.length - 1] = { ...c[c.length - 1], content: '⚠️ Connection error. Please try again.' };
        return c;
      });
    } finally {
      setBusy(false);
    }
  };

  const conversation = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  return (
    <div className="max-w-2xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="px-4 py-4 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-md flex items-center justify-center bg-cyan-500/12 border border-cyan-500/40">
            <Bot size={17} className="text-cyan-400" />
          </div>
          <div>
            <div className="font-mono text-sm font-semibold text-slate-100">Design Assistant</div>
            <div className="text-[11px] font-mono text-slate-500">answer a few questions to scaffold your circuit</div>
          </div>
        </div>
        <select
          data-testid="builder-model-select"
          value={model.id}
          onChange={(e) => setModel(MODELS.find((m) => m.id === e.target.value))}
          className="bg-slate-900 border border-slate-700 rounded-md text-xs font-mono text-slate-200 px-2 py-1.5 outline-none"
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-emerald-500/15 border border-emerald-500/40' : 'bg-cyan-500/12 border border-cyan-500/40'}`}>
              {m.role === 'user' ? <User size={15} className="text-emerald-400" /> : <Bot size={15} className="text-cyan-400" />}
            </div>
            <div className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed max-w-[80%] ${m.role === 'user' ? 'bg-emerald-500/12 text-slate-100 border border-emerald-500/25' : 'bg-slate-900/80 text-slate-200 border border-slate-800'}`}>
              {m.content || <Loader2 size={14} className="animate-spin text-slate-500" />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {ready && (
        <div className="px-4 pb-3">
          <button
            data-testid="generate-circuit-btn"
            onClick={() => onReady({ conversation })}
            className="w-full py-3 rounded-md bg-emerald-500 text-slate-950 font-semibold text-sm hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
          >
            <Cpu size={16} /> Generate my circuit
          </button>
        </div>
      )}

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/60 px-3">
          <input
            data-testid="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Type your answer…"
            disabled={busy}
            className="flex-1 bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600"
          />
          <button data-testid="chat-send-btn" onClick={send} disabled={busy} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
        <button data-testid="skip-to-builder-btn" onClick={() => onReady({ conversation })} className="mt-2 text-[11px] font-mono text-slate-500 hover:text-slate-300">
          skip → generate a starter circuit
        </button>
      </div>
    </div>
  );
}
