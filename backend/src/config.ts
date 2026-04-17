import fs from 'fs';
import path from 'path';
import type { AppConfig } from './types';

// ─── Paths ────────────────────────────────────────────────────────────────────

const BACKEND_ROOT = path.join(__dirname, '..');

export const CONFIG_PATH = path.join(BACKEND_ROOT, 'config.json');
export const MOCK_DIR    = path.join(BACKEND_ROOT, 'mock');

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  server: {
    url: '',
    readFileMode: true,
    validate: [],
    session: ['authorization'],
  },
};

// ─── Persistence ──────────────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw) as AppConfig;
    }
  } catch (err) {
    console.warn('[config] Could not load config.json — using defaults:', err);
  }
  return structuredClone(DEFAULT_CONFIG);
}

export function saveConfig(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// ─── In-memory singleton ──────────────────────────────────────────────────────

let _config: AppConfig = loadConfig();

export function getConfig(): AppConfig { return _config; }

export function updateConfig(newConfig: AppConfig): void {
  _config = newConfig;
  saveConfig(_config);
}

// ─── Hostname helper ──────────────────────────────────────────────────────────

/**
 * Extracts the hostname from the upstream URL to use as the root
 * directory inside mock/. Returns "_default" when no URL is set.
 *
 * Examples:
 *   "https://api.bancolombia.com"     → "api.bancolombia.com"
 *   "https://staging.myapp.com:8080"  → "staging.myapp.com"
 *   ""                                → "_default"
 */
export function getHostname(url: string): string {
  if (!url) return '_default';
  try {
    return new URL(url).hostname;
  } catch {
    return '_default';
  }
}
