'use client';

import { useState } from 'react';
import type { AppConfig } from '@/lib/api';

interface Props {
  config: AppConfig;
  onSave: (next: AppConfig) => Promise<void>;
}

export default function ServerSettings({ config, onSave }: Props) {
  const [url, setUrl]       = useState(config.server.url);
  const [mode, setMode]     = useState(config.server.readFileMode);
  const [saving, setSaving] = useState(false);

  const isDirty = url !== config.server.url || mode !== config.server.readFileMode;

  async function handleSave() {
    setSaving(true);
    await onSave({ ...config, server: { ...config.server, url, readFileMode: mode } });
    setSaving(false);
  }

  // Derive hostname from the URL for display
  const hostname = (() => {
    if (!url) return null;
    try { return new URL(url).hostname; } catch { return null; }
  })();

  return (
    <div className="card" style={{ padding: 28 }}>
      <p className="section-title">Server Settings</p>
      <p className="section-desc">Configure the upstream service URL and operation mode.</p>

      {/* ── Proxy endpoint info ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 'var(--radius-md)',
        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)',
        marginBottom: 24, fontSize: 13,
      }}>
        <span style={{ color: 'var(--accent)', fontSize: 16 }}>🔗</span>
        <span style={{ color: 'var(--text-2)' }}>
          Point your client at&nbsp;
          <code style={{ color: 'var(--accent)' }}>http://localhost:3000/proxy/&lt;your-path&gt;</code>
        </span>
      </div>

      {/* ── Upstream URL ──────────────────────────────────────────────────── */}
      <div className="field" style={{ marginBottom: 28 }}>
        <label className="label" htmlFor="setting-url">
          Upstream Service URL
          {hostname && (
            <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--accent)', fontSize: 12 }}>
              → cache folder: <code>{hostname}/</code>
            </span>
          )}
        </label>
        <input
          id="setting-url"
          className="input"
          type="url"
          placeholder="https://api.example.com"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
        <span style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
          In Proxy Mode: where requests are forwarded.&nbsp;
          In Cache Mode: which recorded environment to serve (changing this switches the active cache folder).
        </span>
      </div>

      <div className="divider" />

      {/* ── Mode toggle ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <p className="section-title" style={{ marginBottom: 16 }}>Operation Mode</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Cache mode card */}
          <button
            id="mode-cache"
            onClick={() => setMode(true)}
            style={{
              padding: 20,
              borderRadius: 'var(--radius-md)',
              border: `2px solid ${mode ? 'var(--success)' : 'var(--card-border)'}`,
              background: mode ? 'var(--success-bg)' : 'var(--card-bg)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'var(--transition)',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>💾</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: mode ? 'var(--success)' : 'var(--text-1)', marginBottom: 4 }}>
              Cache Mode
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
              Serve responses from local mock files. No upstream dependency.
            </div>
          </button>

          {/* Proxy mode card */}
          <button
            id="mode-proxy"
            onClick={() => setMode(false)}
            style={{
              padding: 20,
              borderRadius: 'var(--radius-md)',
              border: `2px solid ${!mode ? 'var(--accent)' : 'var(--card-border)'}`,
              background: !mode ? 'var(--accent-subtle)' : 'var(--card-bg)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'var(--transition)',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔀</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: !mode ? 'var(--accent)' : 'var(--text-1)', marginBottom: 4 }}>
              Proxy Mode
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
              Forward requests to the upstream URL and cache responses.
            </div>
          </button>
        </div>
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          id="btn-save-settings"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {saving ? 'Saving…' : '✓ Save Changes'}
        </button>
      </div>
    </div>
  );
}
