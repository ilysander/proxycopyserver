'use client';

import { useState } from 'react';
import { configApi, type AppConfig } from '@/lib/api';

interface Props {
  config: AppConfig;
  targetTag: string;
  onSave: (next: AppConfig) => Promise<void>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function SessionHeaders({ config, targetTag, onSave, onToast }: Props) {
  const [newHeader, setNewHeader] = useState('');
  const [adding, setAdding]       = useState(false);

  const currentServer = config.servers[targetTag];
  const headers = currentServer?.session || [];

  async function handleAdd() {
    const header = newHeader.trim().toLowerCase();
    if (!header) { onToast('Header name is required', 'error'); return; }
    if (headers.includes(header)) { onToast('Header already in list', 'error'); return; }

    setAdding(true);
    try {
      const updatedHeaders = [...headers, header];
      await onSave({
        ...config,
        servers: { ...config.servers, [targetTag]: { ...currentServer, session: updatedHeaders } }
      });
      setNewHeader('');
      onToast('Header added ✓');
    } catch {
      onToast('Failed to add header', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(index: number) {
    try {
      const updatedHeaders = headers.filter((_, i) => i !== index);
      await onSave({
        ...config,
        servers: { ...config.servers, [targetTag]: { ...currentServer, session: updatedHeaders } }
      });
      onToast('Header removed');
    } catch {
      onToast('Failed to remove header', 'error');
    }
  }

  return (
    <div className="card" style={{ padding: 28 }}>
      <p className="section-title">Session Headers</p>
      <p className="section-desc">
        Headers listed here are forwarded from the incoming request to the upstream service
        (e.g. <code>authorization</code> tokens).
      </p>

      {/* ── Header tags ───────────────────────────────────────────────────── */}
      {headers.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔑</div>
          No session headers configured.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {headers.map((h, i) => (
            <span className="tag" key={i}>
              <code style={{ fontSize: 13 }}>{h}</code>
              <button
                id={`btn-remove-header-${i}`}
                className="tag-remove"
                title={`Remove ${h}`}
                onClick={() => handleRemove(i)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="divider" />

      {/* ── Add header ────────────────────────────────────────────────────── */}
      <p className="section-title" style={{ fontSize: 14, marginBottom: 12 }}>Add Header</p>
      <div className="form-row">
        <input
          id="new-header"
          className="input"
          placeholder="authorization"
          value={newHeader}
          onChange={e => setNewHeader(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          style={{ textTransform: 'lowercase' }}
        />
        <button
          id="btn-add-header"
          className="btn btn-primary"
          onClick={handleAdd}
          disabled={adding}
        >
          {adding ? '…' : '+ Add'}
        </button>
      </div>
    </div>
  );
}
