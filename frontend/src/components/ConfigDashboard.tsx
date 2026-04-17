'use client';

import { useState, useEffect, useCallback } from 'react';
import { configApi, type AppConfig } from '@/lib/api';
import ServerSettings from './ServerSettings';
import ValidateRules from './ValidateRules';
import SessionHeaders from './SessionHeaders';
import MockManager from './MockManager';

type Tab = 'general' | 'validate' | 'session' | 'cache';

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'general',  label: 'General',        emoji: '⚙️' },
  { id: 'validate', label: 'Validate Rules',  emoji: '✅' },
  { id: 'session',  label: 'Session Headers', emoji: '🔑' },
  { id: 'cache',    label: 'Cache Manager',   emoji: '📦' },
];

interface Toast { message: string; type: 'success' | 'error' }

export default function ConfigDashboard() {
  const [tab, setTab]           = useState<Tab>('general');
  const [config, setConfig]     = useState<AppConfig | null>(null);
  const [loading, setLoading]   = useState(true);
  const [status, setStatus]     = useState<'online' | 'offline' | 'checking'>('checking');
  const [toast, setToast]       = useState<Toast | null>(null);

  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await configApi.get();
      setConfig(data);
      setStatus('online');
    } catch {
      setStatus('offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleConfigChange = useCallback(async (next: AppConfig) => {
    setConfig(next);
    try {
      const result = await configApi.update(next);
      setConfig(result.config);
      showToast('Configuration saved ✓');
    } catch {
      showToast('Failed to save configuration', 'error');
    }
  }, [showToast]);

  return (
    <div style={{ minHeight: '100vh', padding: '32px 0 80px' }}>
      <div className="container">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.2 }}>
                <span className="gradient-text">ProxyCopyServer</span>
              </h1>
              <p style={{ marginTop: 4, fontSize: 14 }}>Proxy & cache configuration panel</p>
            </div>

            {/* Server status */}
            <div>
              {status === 'checking' && (
                <span className="badge badge-warning">
                  <span className="dot dot-pulse" />
                  Connecting…
                </span>
              )}
              {status === 'online' && (
                <span className="badge badge-success">
                  <span className="dot dot-pulse" />
                  Backend online
                </span>
              )}
              {status === 'offline' && (
                <span className="badge badge-error">
                  <span className="dot" />
                  Backend offline
                </span>
              )}
            </div>
          </div>

          {/* Mode banner */}
          {config && (() => {
            const hostname = (() => {
              if (!config.server.url) return null;
              try { return new URL(config.server.url).hostname; } catch { return null; }
            })();
            return (
              <div className={`mode-banner ${config.server.readFileMode ? 'cache-mode' : 'proxy-mode'}`}
                   style={{ marginTop: 20 }}>
                <span style={{ fontSize: 18 }}>{config.server.readFileMode ? '💾' : '🔀'}</span>
                {config.server.readFileMode
                  ? <>Cache Mode — reading from <code style={{ marginLeft: 4 }}>mock/{hostname ?? '_default'}/</code></>
                  : `Proxy Mode — forwarding to ${config.server.url || '(no URL set)'}`}
              </div>
            );
          })()}
        </header>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="tabs" style={{ marginBottom: 28, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.emoji}&nbsp; {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-3)' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
            <p>Connecting to backend…</p>
          </div>
        ) : status === 'offline' ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔌</div>
            <p className="section-title" style={{ marginBottom: 8 }}>Backend not reachable</p>
            <p style={{ fontSize: 13 }}>
              Make sure the backend is running: <code>npm run dev:backend</code>
            </p>
            <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={loadConfig}>
              Retry
            </button>
          </div>
        ) : config ? (
          <div>
            {tab === 'general'  && <ServerSettings config={config} onSave={handleConfigChange} />}
            {tab === 'validate' && <ValidateRules config={config} onSave={handleConfigChange} onToast={showToast} />}
            {tab === 'session'  && <SessionHeaders config={config} onSave={handleConfigChange} onToast={showToast} />}
            {tab === 'cache'    && <MockManager onToast={showToast} />}
          </div>
        ) : null}
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="alert">
          {toast.message}
        </div>
      )}
    </div>
  );
}
