import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const MODELS = [
  { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6' },
  { id: 'gpt-5.4', provider: 'openai', label: 'GPT 5.4' },
  { id: 'gemini-3.1-pro-preview', provider: 'gemini', label: 'Gemini 3.1 Pro' },
];

export const api = {
  health: () => axios.get(`${API}/health`).then((r) => r.data),
  palette: () => axios.get(`${API}/palette`).then((r) => r.data),
  analyzeGithub: (body) => axios.post(`${API}/analyze/github`, body).then((r) => r.data),
  analyzeUpload: (formData) =>
    axios.post(`${API}/analyze/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  projects: () => axios.get(`${API}/projects`).then((r) => r.data),
  project: (id) => axios.get(`${API}/projects/${id}`).then((r) => r.data),
  deleteProject: (id) => axios.delete(`${API}/projects/${id}`).then((r) => r.data),
  monitor: (id) => axios.get(`${API}/projects/${id}/monitor`).then((r) => r.data),
  generate: (body) => axios.post(`${API}/builder/generate`, body).then((r) => r.data),
  validate: (body) => axios.post(`${API}/builder/validate`, body).then((r) => r.data),
};

export async function streamChat({ session_id, message, model, provider, history, onDelta }) {
  const res = await fetch(`${API}/builder/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id, message, model, provider, history }),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onDelta(full);
  }
  return full;
}
