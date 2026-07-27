'use client';

import { useState } from 'react';
import { configApi, type AppConfig, type ValidateRule } from '@/lib/api';

interface Props {
  config: AppConfig;
  targetTag: string;
  onSave: (next: AppConfig) => Promise<void>;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

// ─── Query-params mode selector ───────────────────────────────────────────────

type QMode = 'all' | 'none' | 'specific';

function qModeFromRule(rule?: ValidateRule): QMode {
  if (!rule || rule.queryParams === undefined) return 'all';
  if (rule.queryParams.length === 0) return 'none';
  return 'specific';
}

function qModeBadge(qMode: QMode, qParams: string[]): string {
  if (qMode === 'all')      return '🌐 All';
  if (qMode === 'none')     return '🚫 None';
  return qParams.length ? `🔍 ${qParams.join(', ')}` : '🔍 Specific (empty)';
}

// ─── Row component (existing rule) ───────────────────────────────────────────

function RuleRow({
  rule,
  index,
  onRemove,
  onUpdate,
  onToast,
}: {
  rule: ValidateRule;
  index: number;
  onRemove: (i: number) => void;
  onUpdate: (i: number, r: ValidateRule) => void;
  onToast: Props['onToast'];
}) {
  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(rule.name);
  const [params,  setParams]  = useState(rule.params.join(', '));
  const [qMode,   setQMode]   = useState<QMode>(qModeFromRule(rule));
  const [qParams, setQParams] = useState((rule.queryParams ?? []).join(', '));
  const [fallback,setFallback]= useState(rule.fallback ?? false);
  const [saving,  setSaving]  = useState(false);

  async function handleSave() {
    setSaving(true);
    const updated: ValidateRule = {
      name:   name.trim(),
      params: params.split(',').map(p => p.trim()).filter(Boolean),
      fallback,
      ...(qMode === 'all'      && {}),
      ...(qMode === 'none'     && { queryParams: [] }),
      ...(qMode === 'specific' && {
        queryParams: qParams.split(',').map(p => p.trim()).filter(Boolean),
      }),
    };
    try {
      await onUpdate(index, updated);
      setEditing(false);
      onToast('Rule updated ✓');
    } catch {
      onToast('Failed to update rule', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{index + 1}</td>
        <td colSpan={4}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 0' }}>
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label className="label">Route</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label className="label">Body params</label>
                <input className="input" value={params} onChange={e => setParams(e.target.value)} placeholder="client_id, grant_type" />
              </div>
            </div>

            {/* Query params mode */}
            <div className="field">
              <label className="label">Query params in cache key</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['all', 'none', 'specific'] as QMode[]).map(m => (
                  <button
                    key={m}
                    className={`btn btn-sm ${qMode === m ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setQMode(m)}
                    type="button"
                  >
                    {m === 'all' ? '🌐 All' : m === 'none' ? '🚫 None' : '🔍 Specific'}
                  </button>
                ))}
              </div>
              {qMode === 'specific' && (
                <input
                  className="input"
                  style={{ marginTop: 8 }}
                  placeholder="page, status, filter"
                  value={qParams}
                  onChange={e => setQParams(e.target.value)}
                />
              )}
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {qMode === 'all' && 'All query params will be included in the cache filename (sorted alphabetically).'}
                {qMode === 'none' && 'Query string is ignored — same cached response regardless of query params.'}
                {qMode === 'specific' && 'Only the listed params affect the cache key; others are ignored.'}
              </span>
            </div>

            {/* Fallback toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className={`toggle-track ${fallback ? 'on' : ''}`} onClick={() => setFallback(!fallback)} style={{ cursor:'pointer' }}>
                <div className="toggle-knob" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>Enable fallback</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  If exact match not found, serve closest cached response (without query params → method only → any file).
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? '…' : '✓ Save'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{index + 1}</td>
      <td><code>{rule.name}</code></td>
      <td>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {rule.params.map((p, j) => (
            <span className="tag" key={j} style={{ fontSize: 11, padding: '2px 8px' }}>{p}</span>
          ))}
          {rule.params.length === 0 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
        </span>
      </td>
      <td>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{qModeBadge(qModeFromRule(rule), rule.queryParams ?? [])}</span>
        {rule.fallback && <span className="badge badge-success" style={{ marginLeft: 6, fontSize: 11, padding: '2px 8px' }}>fallback</span>}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <button id={`btn-edit-rule-${index}`} className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>✎</button>
          <button id={`btn-remove-rule-${index}`} className="btn btn-icon" title="Remove" onClick={() => onRemove(index)}>✕</button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ValidateRules({ config, targetTag, onSave, onToast }: Props) {
  const [newName,    setNewName]    = useState('');
  const [newParams,  setNewParams]  = useState('');
  const [newQMode,   setNewQMode]   = useState<QMode>('all');
  const [newQParams, setNewQParams] = useState('');
  const [newFallback,setNewFallback]= useState(false);
  const [adding,     setAdding]     = useState(false);

  const currentServer = config.servers[targetTag];
  const rules = currentServer?.validate || [];

  async function handleAdd() {
    const name = newName.trim();
    if (!name) { onToast('Route is required', 'error'); return; }

    const rule: ValidateRule = {
      name,
      params: newParams.split(',').map(p => p.trim()).filter(Boolean),
      fallback: newFallback,
      ...(newQMode === 'none'     && { queryParams: [] }),
      ...(newQMode === 'specific' && {
        queryParams: newQParams.split(',').map(p => p.trim()).filter(Boolean),
      }),
    };

    setAdding(true);
    try {
      const updatedRules = [...rules, rule];
      await onSave({
        ...config,
        servers: { ...config.servers, [targetTag]: { ...currentServer, validate: updatedRules } }
      });
      setNewName(''); setNewParams(''); setNewQParams(''); setNewQMode('all'); setNewFallback(false);
      onToast('Rule added ✓');
    } catch {
      onToast('Failed to add rule', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(index: number) {
    try {
      const updatedRules = rules.filter((_, i) => i !== index);
      await onSave({
        ...config,
        servers: { ...config.servers, [targetTag]: { ...currentServer, validate: updatedRules } }
      });
      onToast('Rule removed');
    } catch { onToast('Failed to remove rule', 'error'); }
  }

  async function handleUpdate(index: number, updated: ValidateRule) {
    const updatedRules = [...rules];
    updatedRules[index] = updated;
    await onSave({
      ...config,
      servers: { ...config.servers, [targetTag]: { ...currentServer, validate: updatedRules } }
    });
  }

  return (
    <div className="card" style={{ padding: 28 }}>
      <p className="section-title">Validate Rules</p>
      <p className="section-desc">
        Per-route rules that control which params fingerprint the cache filename, and whether
        to fall back to a less-specific cached response when an exact match is missing.
      </p>

      {/* ── Rules table ────────────────────────────────────────────────────── */}
      {rules.length === 0 ? (
        <div className="empty"><div className="empty-icon">📋</div>No validate rules configured yet.</div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Route</th>
                <th>Body params</th>
                <th>Query params</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => (
                <RuleRow
                  key={i}
                  rule={rule}
                  index={i}
                  onRemove={handleRemove}
                  onUpdate={handleUpdate}
                  onToast={onToast}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="divider" />

      {/* ── Add rule ─────────────────────────────────────────────────────────── */}
      <p className="section-title" style={{ fontSize: 14, marginBottom: 14 }}>Add Rule</p>

      <div className="form-row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ flex: 2 }}>
          <label className="label" htmlFor="new-route">Route path</label>
          <input id="new-route" className="input" placeholder="/oauth/token" value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label className="label" htmlFor="new-params">Body params <span style={{ opacity: 0.6, fontWeight: 400 }}>(comma-sep.)</span></label>
          <input id="new-params" className="input" placeholder="client_id, grant_type" value={newParams} onChange={e => setNewParams(e.target.value)} />
        </div>
      </div>

      {/* Query params mode */}
      <div className="field" style={{ marginBottom: 14 }}>
        <label className="label">Query params in cache key</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['all', 'none', 'specific'] as QMode[]).map(m => (
            <button
              key={m}
              id={`new-rule-qmode-${m}`}
              className={`btn btn-sm ${newQMode === m ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setNewQMode(m)}
              type="button"
            >
              {m === 'all' ? '🌐 All' : m === 'none' ? '🚫 None' : '🔍 Specific'}
            </button>
          ))}
        </div>
        {newQMode === 'specific' && (
          <input
            id="new-qparams"
            className="input"
            style={{ marginTop: 8 }}
            placeholder="page, status"
            value={newQParams}
            onChange={e => setNewQParams(e.target.value)}
          />
        )}
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, display: 'block' }}>
          {newQMode === 'all'      && 'All query params included in cache filename (sorted alphabetically).'}
          {newQMode === 'none'     && 'Query string ignored — same cache entry regardless of query params.'}
          {newQMode === 'specific' && 'Only listed params affect the cache key; others are ignored.'}
        </span>
      </div>

      {/* Fallback toggle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
        <div
          className={`toggle-track ${newFallback ? 'on' : ''}`}
          style={{ cursor: 'pointer', marginTop: 2 }}
          onClick={() => setNewFallback(!newFallback)}
        >
          <div className="toggle-knob" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>Enable fallback</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
            In Cache Mode, if exact params not found → try without query params → method only → any cached file.
          </div>
        </div>
      </div>

      <button id="btn-add-rule" className="btn btn-primary" onClick={handleAdd} disabled={adding}>
        {adding ? '…' : '+ Add Rule'}
      </button>
    </div>
  );
}
