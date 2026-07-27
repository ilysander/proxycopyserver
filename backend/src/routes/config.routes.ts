import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getConfig, updateConfig, MOCK_DIR } from '../config';
import type { AppConfig } from '../types';

const router = Router();

// ─── Config endpoints ─────────────────────────────────────────────────────────

router.get('/config', (_req: Request, res: Response) => {
  res.json(getConfig());
});

router.put('/config', (req: Request, res: Response) => {
  try {
    updateConfig(req.body as AppConfig);
    res.json({ success: true, config: getConfig() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: String(err) });
  }
});

// ─── Validate rules ───────────────────────────────────────────────────────────

router.post('/config/validate', (req: Request, res: Response) => {
  const { name, params, queryParams, fallback } = req.body as {
    name: string;
    params: string[];
    queryParams?: string[];
    fallback?: boolean;
  };

  if (!name || !Array.isArray(params)) {
    res.status(400).json({ error: '`name` (string) and `params` (string[]) are required' });
    return;
  }

  const config = getConfig();
  config.server.validate.push({
    name,
    params,
    ...(queryParams !== undefined && { queryParams }),
    ...(fallback    !== undefined && { fallback }),
  });
  updateConfig(config);
  res.json({ success: true, config });
});

router.put('/config/validate/:index', (req: Request, res: Response) => {
  const config = getConfig();
  const index  = parseInt(req.params.index);

  if (isNaN(index) || index < 0 || index >= config.server.validate.length) {
    res.status(400).json({ error: 'Invalid index' });
    return;
  }

  const { name, params, queryParams, fallback } = req.body as {
    name: string;
    params: string[];
    queryParams?: string[];
    fallback?: boolean;
  };

  config.server.validate[index] = {
    name,
    params,
    ...(queryParams !== undefined && { queryParams }),
    ...(fallback    !== undefined && { fallback }),
  };
  updateConfig(config);
  res.json({ success: true, config });
});

router.delete('/config/validate/:index', (req: Request, res: Response) => {
  const config = getConfig();
  const index  = parseInt(req.params.index);

  if (isNaN(index) || index < 0 || index >= config.server.validate.length) {
    res.status(400).json({ error: 'Invalid index' });
    return;
  }

  config.server.validate.splice(index, 1);
  updateConfig(config);
  res.json({ success: true, config });
});

// ─── Session headers ──────────────────────────────────────────────────────────

router.post('/config/session', (req: Request, res: Response) => {
  const { header } = req.body as { header: string };
  if (!header) { res.status(400).json({ error: '`header` is required' }); return; }

  const config = getConfig();
  if (!config.server.session.includes(header)) {
    config.server.session.push(header);
    updateConfig(config);
  }
  res.json({ success: true, config });
});

router.delete('/config/session/:index', (req: Request, res: Response) => {
  const config = getConfig();
  const index  = parseInt(req.params.index);

  if (isNaN(index) || index < 0 || index >= config.server.session.length) {
    res.status(400).json({ error: 'Invalid index' }); return;
  }

  config.server.session.splice(index, 1);
  updateConfig(config);
  res.json({ success: true, config });
});

// ─── Mock cache endpoints ─────────────────────────────────────────────────────

interface MockFileEntry { path: string; size: number; modified: string; }

function listRecursive(dir: string, base: string = dir): MockFileEntry[] {
  const results: MockFileEntry[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listRecursive(full, base));
    } else {
      const stat = fs.statSync(full);
      results.push({
        path:     full.replace(base + path.sep, ''),
        size:     stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }
  return results;
}

router.get('/mock/list', (_req: Request, res: Response) => {
  const files = listRecursive(MOCK_DIR);
  res.json({ files, total: files.length });
});

router.delete('/mock/clear', (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(MOCK_DIR)) fs.rmSync(MOCK_DIR, { recursive: true, force: true });
    fs.mkdirSync(MOCK_DIR, { recursive: true });
    res.json({ success: true, message: 'Cache cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear cache', details: String(err) });
  }
});

export default router;
