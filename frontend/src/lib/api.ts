// ─── Types (mirrored from backend/src/types.ts) ───────────────────────────────

export interface ValidateRule {
  name: string;
  params: string[];
  /**
   * Which URL query params to include in the cache key.
   * undefined → ALL  |  [] → NONE  |  [...] → specific
   */
  queryParams?: string[];
  /** Enable fallback lookup when exact cache match is not found */
  fallback?: boolean;
}

export interface ServerConfig {
  url: string;
  readFileMode: boolean;
  validate: ValidateRule[];
  session: string[];
}

export interface AppConfig {
  servers: Record<string, ServerConfig>;
}

export interface MockFileEntry {
  path: string;
  size: number;
  modified: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Config API ───────────────────────────────────────────────────────────────

export const configApi = {
  get: () =>
    request<AppConfig>('/config'),

  update: (config: AppConfig) =>
    request<{ success: boolean; config: AppConfig }>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  addValidateRule: (rule: ValidateRule) =>
    request<{ success: boolean; config: AppConfig }>('/config/validate', {
      method: 'POST',
      body: JSON.stringify(rule),
    }),

  updateValidateRule: (index: number, rule: ValidateRule) =>
    request<{ success: boolean; config: AppConfig }>(`/config/validate/${index}`, {
      method: 'PUT',
      body: JSON.stringify(rule),
    }),

  removeValidateRule: (index: number) =>
    request<{ success: boolean; config: AppConfig }>(`/config/validate/${index}`, {
      method: 'DELETE',
    }),

  addSessionHeader: (header: string) =>
    request<{ success: boolean; config: AppConfig }>('/config/session', {
      method: 'POST',
      body: JSON.stringify({ header }),
    }),

  removeSessionHeader: (index: number) =>
    request<{ success: boolean; config: AppConfig }>(`/config/session/${index}`, {
      method: 'DELETE',
    }),
};

// ─── Mock cache API ───────────────────────────────────────────────────────────

export const mockApi = {
  list: () =>
    request<{ files: MockFileEntry[]; total: number }>('/mock/list'),

  clear: () =>
    request<{ success: boolean; message: string }>('/mock/clear', {
      method: 'DELETE',
    }),
};
