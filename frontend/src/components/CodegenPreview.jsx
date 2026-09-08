import React, { useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { X, Download, FileCode2, Folder, Sparkles } from 'lucide-react';

const LANG = {
  py: 'python', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', css: 'css', html: 'markup',
  env: 'bash', txt: 'text', example: 'bash',
};

function langOf(path) {
  const ext = path.split('.').pop().toLowerCase();
  return LANG[ext] || 'text';
}

export default function CodegenPreview({ files, filename, aiCount, onClose, onDownload }) {
  const sorted = useMemo(() => [...files].sort((a, b) => a.path.localeCompare(b.path)), [files]);
  const [sel, setSel] = useState(sorted[0]?.path || '');
  const current = sorted.find((f) => f.path === sel) || sorted[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 md:p-6" data-testid="codegen-preview">
      <div className="w-full max-w-6xl h-[85vh] rounded-xl glass shadow-2xl flex flex-col overflow-hidden fade-up">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Sparkles size={16} className="text-cyan-400" />
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold text-slate-100">Generated code preview</div>
            <div className="text-[11px] font-mono text-slate-500 truncate">{sorted.length} files · {aiCount} AI-generated</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button data-testid="preview-download-btn" onClick={onDownload} className="text-sm font-semibold text-slate-950 bg-emerald-500 hover:bg-emerald-400 flex items-center gap-1.5 px-3.5 py-1.5 rounded">
              <Download size={14} /> Download .zip
            </button>
            <button data-testid="preview-close-btn" onClick={onClose} className="text-slate-400 hover:text-slate-100 p-1.5">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="w-64 shrink-0 border-r border-slate-800 overflow-y-auto p-2 bg-slate-950/40" data-testid="preview-file-tree">
            {sorted.map((f) => {
              const parts = f.path.split('/');
              const depth = parts.length - 1;
              const isDir = parts.length > 1;
              return (
                <button
                  key={f.path}
                  onClick={() => setSel(f.path)}
                  data-testid={`preview-file-${f.path}`}
                  className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-mono truncate transition-colors ${
                    sel === f.path ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                  style={{ paddingLeft: `${8 + depth * 10}px` }}
                  title={f.path}
                >
                  {isDir ? <Folder size={12} className="shrink-0 text-amber-400/70" /> : <FileCode2 size={12} className="shrink-0 text-slate-500" />}
                  <span className="truncate">{parts[parts.length - 1]}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-2 border-b border-slate-800 text-xs font-mono text-slate-400 truncate">{current?.path}</div>
            <div className="flex-1 overflow-auto" data-testid="preview-code">
              {current && (
                <SyntaxHighlighter
                  language={langOf(current.path)}
                  style={oneDark}
                  customStyle={{ margin: 0, background: 'transparent', fontSize: 12.5, padding: '16px' }}
                  showLineNumbers
                >
                  {current.content}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
