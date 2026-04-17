'use client';

import { useState, useCallback, useEffect } from 'react';
import { mockApi, type MockFileEntry } from '@/lib/api';

interface Props {
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function fileIcon(p: string): string {
  if (p.endsWith('.json')) return '📄';
  if (p.endsWith('.html')) return '🌐';
  if (p.endsWith('.css'))  return '🎨';
  if (p.endsWith('.js'))   return '📜';
  return '📁';
}

/** Groups files by their first path segment (the hostname folder) */
function groupByHostname(files: MockFileEntry[]): Record<string, MockFileEntry[]> {
  return files.reduce<Record<string, MockFileEntry[]>>((acc, f) => {
    const parts = f.path.replace(/\\/g, '/').split('/');
    const host  = parts.length > 1 ? parts[0] : '_root';
    const rest  = parts.length > 1 ? { ...f, path: parts.slice(1).join('/') } : f;
    (acc[host] ??= []).push(rest);
    return acc;
  }, {});
}

export default function MockManager({ onToast }: Props) {
  const [files,    setFiles]    = useState<MockFileEntry[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [clearing, setClearing] = useState(false);
  const [confirm,  setConfirm]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mockApi.list();
      setFiles(data.files);
      setTotal(data.total);
      // Auto-expand all hostname groups
      const hosts = Object.keys(groupByHostname(data.files));
      setExpanded(new Set(hosts));
    } catch {
      onToast('Failed to load cache list', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  async function handleClear() {
    if (!confirm) { setConfirm(true); return; }
    setClearing(true);
    try {
      await mockApi.clear();
      onToast('Cache cleared ✓');
      setFiles([]); setTotal(0); setConfirm(false);
    } catch {
      onToast('Failed to clear cache', 'error');
    } finally {
      setClearing(false);
    }
  }

  const toggleHost = (host: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(host) ? next.delete(host) : next.add(host);
      return next;
    });

  const filtered  = files.filter(f => f.path.toLowerCase().includes(search.toLowerCase()));
  const grouped   = groupByHostname(filtered);
  const totalSize = files.reduce((a, f) => a + f.size, 0);

  return (
    <div className="card" style={{ padding: 28 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <div>
          <p className="section-title">Cache Manager</p>
          <p className="section-desc" style={{ marginBottom: 0 }}>
            {loading ? 'Loading…' : `${total} file${total !== 1 ? 's' : ''} · ${formatBytes(totalSize)} total`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button id="btn-refresh-cache" className="btn btn-ghost btn-sm" onClick={loadFiles} disabled={loading}>↻ Refresh</button>
          <button
            id="btn-clear-cache"
            className={`btn btn-sm ${confirm ? 'btn-danger' : 'btn-ghost'}`}
            onClick={handleClear}
            disabled={clearing || total === 0}
            onBlur={() => setTimeout(() => setConfirm(false), 200)}
          >
            {clearing ? 'Clearing…' : confirm ? '⚠️ Confirm?' : '🗑 Clear all'}
          </button>
        </div>
      </div>

      <div className="divider" />

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      {total > 0 && (
        <input
          id="cache-search"
          className="input"
          placeholder="Filter by path…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="empty"><div className="empty-icon">⏳</div>Loading…</div>
      ) : total === 0 ? (
        <div className="empty">
          <div className="empty-icon">📦</div>
          Cache is empty. Switch to Proxy Mode and send requests through <code>/proxy/&lt;path&gt;</code>.
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="empty"><div className="empty-icon">🔍</div>No files match &quot;{search}&quot;</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 480, overflowY: 'auto' }}>
          {Object.entries(grouped).map(([host, hostFiles]) => (
            <div key={host}>
              {/* Hostname header */}
              <button
                onClick={() => toggleHost(host)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 'var(--radius-md)',
                  background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.15)',
                  cursor: 'pointer', marginBottom: 6, textAlign: 'left',
                }}
              >
                <span style={{ color: 'var(--accent)', fontSize: 14 }}>
                  {expanded.has(host) ? '▾' : '▸'}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', flex: 1 }}>
                  🌐 {host}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {hostFiles.length} file{hostFiles.length !== 1 ? 's' : ''} · {formatBytes(hostFiles.reduce((a, f) => a + f.size, 0))}
                </span>
              </button>

              {/* Files under this hostname */}
              {expanded.has(host) && (
                <div className="file-list" style={{ paddingLeft: 16 }}>
                  {hostFiles.map((f, i) => (
                    <div className="file-item" key={i}>
                      <span className="file-icon">{fileIcon(f.path)}</span>
                      <span className="file-name">{f.path}</span>
                      <span className="file-meta">{formatBytes(f.size)}</span>
                      <span className="file-meta" style={{ marginLeft: 8 }}>
                        {new Date(f.modified).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
