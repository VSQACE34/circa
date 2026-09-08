import './App.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Toaster } from 'sonner';
import Header from './components/Header';
import AnalyzerPage from './pages/AnalyzerPage';
import BuilderPage from './pages/BuilderPage';
import MonitorPage from './pages/MonitorPage';
import RunPage from './pages/RunPage';

const TOAST_OPTIONS = { style: { background: '#0f172a', border: '1px solid #1e2d42', color: '#f8fafc' } };

function App() {
  return (
    <div className="App min-h-screen">
      <BrowserRouter>
        <ReactFlowProvider>
          <Header />
          <Routes>
            <Route path="/" element={<AnalyzerPage />} />
            <Route path="/builder" element={<BuilderPage />} />
            <Route path="/monitor" element={<MonitorPage />} />
            <Route path="/run" element={<RunPage />} />
          </Routes>
        </ReactFlowProvider>
      </BrowserRouter>
      <Toaster theme="dark" position="bottom-right" toastOptions={TOAST_OPTIONS} />
    </div>
  );
}

export default App;
