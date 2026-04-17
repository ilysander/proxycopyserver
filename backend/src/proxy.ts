import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { mkdirp } from 'mkdirp';
import { getConfig, getHostname, MOCK_DIR } from './config';
import { getPath, existFile, fetchWithTimeout } from './utils';
import type { CachedResponse, GetDataResult, ValidateRule } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** The URL prefix this server listens on for proxy traffic */
const PROXY_PREFIX = '/proxy';

// ─── URI helpers ──────────────────────────────────────────────────────────────

/** Removes the /proxy prefix: "/proxy/oauth/token?a=1" → "/oauth/token?a=1" */
function stripPrefix(originalUrl: string): string {
  const [pathname, query] = originalUrl.split('?');
  const stripped = pathname.startsWith(PROXY_PREFIX)
    ? pathname.slice(PROXY_PREFIX.length) || '/'
    : pathname;
  return query ? `${stripped}?${query}` : stripped;
}

/** "//oauth/token?a=1" → "oauth/token" (no leading slash, no query) */
function uriToDir(realUri: string): string {
  const clean = realUri.split('?')[0];
  return clean.split('/').filter(Boolean).join('/') || '_root';
}

// ─── Cache key builders ───────────────────────────────────────────────────────

/**
 * Returns the query-param segment for the cache filename.
 *
 * Behaviour driven by the validate rule's `queryParams` field:
 *   undefined → include ALL params, sorted alphabetically   (default)
 *   []        → include NONE                                (ignore query string)
 *   ['a','b'] → include only the listed params, sorted
 *
 * Returns null when there's nothing to include.
 */
function buildQuerySegment(
  uriPath: string,
  rawQuery: string,
  rules: ValidateRule[]
): string | null {
  if (!rawQuery) return null;

  const params  = new URLSearchParams(rawQuery);
  const rule    = rules.find(r => r.name === uriPath);
  let entries: [string, string][];

  if (!rule || rule.queryParams === undefined) {
    // No rule (or rule without queryParams) → include ALL, alphabetically sorted
    entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  } else if (rule.queryParams.length === 0) {
    // Explicitly [] → include NONE
    return null;
  } else {
    // Include only the declared params that are present in the request
    entries = rule.queryParams
      .filter(p => params.has(p))
      .sort()
      .map(p => [p, params.get(p)!] as [string, string]);
  }

  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

/** Returns body-param segments from the validate rule for this URI */
function buildBodySegments(
  uriPath: string,
  body: Record<string, unknown>,
  rules: ValidateRule[]
): string[] {
  const rule = rules.find(r => r.name === uriPath);
  if (!rule) return [];

  return rule.params
    .filter(p => body[p] !== undefined && body[p] !== null && body[p] !== '')
    .map(p => `&${p}=${body[p]}`);
}

/**
 * Assembles the filename path-blocks array.
 * Format: [METHOD, ?qKey=val&..., &bodyParam=val, ...]
 * The caller appends the status code before joining.
 */
function buildPathBlocks(
  uriPath: string,
  rawQuery: string,
  method: string,
  body: Record<string, unknown>
): string[] {
  const { validate } = getConfig().server;
  const blocks: string[] = [method];

  const qSeg = buildQuerySegment(uriPath, rawQuery, validate);
  if (qSeg) blocks.push(`?${qSeg}`);

  blocks.push(...buildBodySegments(uriPath, body, validate));
  return blocks;
}

// ─── File lookup ──────────────────────────────────────────────────────────────

function readDataFromFile(filePath: string, statusCode: number): GetDataResult | null {
  try {
    const raw  = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as CachedResponse;
    return { resCode: statusCode, resData: data.res.body, res: data.res };
  } catch {
    console.warn('[proxy] Could not read cached file:', filePath);
    return null;
  }
}

/**
 * Tries to find a cache file matching the given path-blocks exactly.
 * Prefers _200, then any other status code.
 */
function findCacheFile(
  hostname: string,
  dir: string,
  blocks: string[]
): GetDataResult | null {
  const prefix  = blocks.join('_');
  const dirPath = path.join(MOCK_DIR, hostname, dir);
  if (!existFile(dirPath)) return null;

  // 1. Try exact prefix + _200
  const path200 = path.join(dirPath, `${prefix}_200.json`);
  if (existFile(path200)) return readDataFromFile(path200, 200);

  // 2. Try exact prefix + any status
  try {
    const match = fs.readdirSync(dirPath)
      .find(f => f.endsWith('.json') && f.startsWith(`${prefix}_`));
    if (match) {
      const code = parseInt(match.replace('.json', '').split('_').pop() ?? '200') || 200;
      return readDataFromFile(path.join(dirPath, match), code);
    }
  } catch { /* ignore */ }

  return null;
}

/** Last-resort: return any .json file in the directory */
function findAnyInDir(hostname: string, dir: string): GetDataResult | null {
  const dirPath = path.join(MOCK_DIR, hostname, dir);
  if (!existFile(dirPath)) return null;

  try {
    const file = fs.readdirSync(dirPath).find(f => f.endsWith('.json'));
    if (file) {
      const code = parseInt(file.replace('.json', '').split('_').pop() ?? '200') || 200;
      console.log('[proxy] Fallback: serving nearest file:', file);
      return readDataFromFile(path.join(dirPath, file), code);
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Looks up a cached response using a progressive fallback strategy:
 *
 *   1. Exact match (method + query params + body params)
 *   2. [if fallback=true] Without query params
 *   3. [if fallback=true] Method only (no params)
 *   4. [if fallback=true] Any .json in directory
 */
function getCachedData(
  hostname: string,
  dir: string,
  uriPath: string,
  rawQuery: string,
  method: string,
  body: Record<string, unknown>
): GetDataResult | null {
  const { validate } = getConfig().server;

  // ── 1. Exact match ──────────────────────────────────────────────────────────
  const exactBlocks = buildPathBlocks(uriPath, rawQuery, method, body);
  const exact = findCacheFile(hostname, dir, exactBlocks);
  if (exact) return exact;

  // ── Check fallback flag ─────────────────────────────────────────────────────
  const rule = validate.find(r => r.name === uriPath);
  if (!rule?.fallback) return null;

  // ── 2. Without query params ─────────────────────────────────────────────────
  if (rawQuery) {
    const noQBlocks = buildPathBlocks(uriPath, '', method, body);
    const noQ = findCacheFile(hostname, dir, noQBlocks);
    if (noQ) { console.log('[proxy] Fallback: serving without query params'); return noQ; }
  }

  // ── 3. Method only ──────────────────────────────────────────────────────────
  const methodOnly = findCacheFile(hostname, dir, [method]);
  if (methodOnly) { console.log('[proxy] Fallback: serving method-only cache'); return methodOnly; }

  // ── 4. Any file in directory ────────────────────────────────────────────────
  return findAnyInDir(hostname, dir);
}

// ─── Main request handler ─────────────────────────────────────────────────────

export async function handleProxyRequest(req: Request, res: Response): Promise<void> {
  // Real URI (without /proxy prefix, with original query string)
  const realUri             = stripPrefix(req.originalUrl);
  const [uriPath, rawQuery = ''] = realUri.split('?');

  const headers = req.headers as Record<string, string>;
  const method  = (req.method || 'POST').toUpperCase();
  const body    = (req.body ?? {}) as Record<string, unknown>;

  console.log(`[proxy] ${method} ${realUri}`);

  const config   = getConfig();
  const hostname = getHostname(config.server.url);
  const dir      = uriToDir(realUri);

  // ── CACHE MODE ────────────────────────────────────────────────────────────
  if (config.server.readFileMode) {
    const cached = getCachedData(hostname, dir, uriPath, rawQuery, method, body);

    if (!cached) {
      res.status(404).json({
        error: 'No cached response found',
        uri: realUri,
        hint: 'Switch to Proxy Mode to capture this response, or enable fallback on the validate rule.',
      });
      return;
    }

    const contentType = cached.res.headers?.['content-type'] ?? 'application/json';
    res.setHeader('Content-Type', contentType);

    const send = () => {
      if (contentType.includes('application/json')) {
        res.status(cached.resCode).json(cached.resData);
      } else if (cached.res.htmlFilePath && fs.existsSync(cached.res.htmlFilePath)) {
        res.status(cached.resCode).send(fs.readFileSync(cached.res.htmlFilePath, 'utf8'));
      } else {
        res.status(cached.resCode).send(cached.resData);
      }
    };

    cached.res.responseTime > 0 ? setTimeout(send, cached.res.responseTime) : send();
    return;
  }

  // ── PROXY MODE ────────────────────────────────────────────────────────────
  if (!config.server.url) {
    res.status(503).json({ error: 'No upstream URL configured. Set it in the config panel.' });
    return;
  }

  const upstreamUrl = `${config.server.url}${realUri}`;
  const globalDir   = getPath(MOCK_DIR, hostname, dir);

  try { await mkdirp(globalDir); } catch (err) {
    console.warn('[proxy] Could not create directory:', globalDir, err);
  }

  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

  let codeStatus     = '502';
  let responseData: unknown = {};
  let responseHeaders: Record<string, string> = {};
  let contentType    = '';
  let responseTime   = 0;
  let isResourceHtml = false;
  let isHtml         = false;

  const startTime = Date.now();

  try {
    const headersClean = { ...headers };
    delete headersClean['content-length'];
    delete headersClean['host'];
    delete headersClean['postman-token'];
    delete headersClean['if-none-match'];

    const fetchOptions: RequestInit = { method, headers: headersClean };

    if (body && Object.keys(body).length > 0 && method === 'POST') {
      fetchOptions.body =
        headers['content-type'] === 'application/x-www-form-urlencoded'
          ? new URLSearchParams(body as Record<string, string>)
          : JSON.stringify(body);
    }

    const raw       = await fetchWithTimeout(upstreamUrl, fetchOptions);
    responseTime    = Date.now() - startTime;
    raw.headers.forEach((value, key) => { responseHeaders[key] = value; });
    codeStatus      = `${raw.status}`;
    contentType     = raw.headers.get('content-type') ?? '';

    if      (contentType.includes('application/json'))  { responseData = await raw.json(); }
    else if (contentType.includes('text/html'))          { responseData = await raw.text(); isHtml = true; isResourceHtml = true; }
    else if (contentType.includes('javascript') || contentType.includes('text/css')) { responseData = await raw.text(); isResourceHtml = true; }
    else                                                 { responseData = await raw.text(); }

  } catch (err) {
    console.error('[proxy] Fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch from upstream', url: upstreamUrl });
    return;
  }

  // ── Write cache ────────────────────────────────────────────────────────────
  const pathBlocks = buildPathBlocks(uriPath, rawQuery, method, body);
  pathBlocks.push(codeStatus);

  const dataToWrite: CachedResponse = {
    uri: realUri,
    method,
    req:  { headers, body },
    res:  {
      statusCode:   codeStatus,
      headers:      responseHeaders,
      responseTime,
      htmlFilePath: undefined,
      body:         isResourceHtml ? '' : responseData,
    },
  };

  if (isResourceHtml) {
    let ext = 'html';
    if (!isHtml) {
      const parts = uriPath.split('.');
      if (parts.length > 1) ext = parts[parts.length - 1];
    }
    const htmlFilePath = getPath(MOCK_DIR, hostname, dir, `${pathBlocks.join('_')}.${ext}`);
    fs.writeFileSync(htmlFilePath, responseData as string, 'utf8');
    dataToWrite.res.htmlFilePath = htmlFilePath;
  }

  const jsonFullPath = getPath(MOCK_DIR, hostname, dir, `${pathBlocks.join('_')}.json`);
  fs.writeFileSync(jsonFullPath, JSON.stringify(dataToWrite, null, 4), 'utf8');
  console.log('[proxy] Cached →', jsonFullPath.replace(MOCK_DIR + path.sep, 'mock/'));

  contentType.includes('application/json')
    ? res.status(parseInt(codeStatus)).json(responseData)
    : res.status(parseInt(codeStatus)).send(responseData);
}
