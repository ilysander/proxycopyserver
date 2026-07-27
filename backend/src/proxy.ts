import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { mkdirp } from 'mkdirp';
import { getConfig, getHostname, MOCK_DIR, RECORDINGS_DIR } from './config';
import { getPath, existFile, fetchWithTimeout } from './utils';
import type { CachedResponse, GetDataResult, ValidateRule, ServerConfig } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** The URL prefix this server listens on for proxy traffic */
const PROXY_PREFIX = '/proxy';

/** Max filename length before we hash it (macOS limit is 255 bytes per component) */
const MAX_FILENAME = 200;

/**
 * Derives the cache filename PREFIX (without status suffix) from a set of path blocks.
 *
 * If the full name would exceed MAX_FILENAME chars, the block string is hashed with MD5
 * so both WRITE and READ always produce the same key for the same input.
 *
 * Write: `${filePrefix(blocks)}_${status}.json`
 * Read:  look for `${filePrefix(blocks)}_*.json`
 */
function filePrefix(blocks: string[]): string {
  const base = blocks.join('_');
  // +8 for _200.json worst case
  if (base.length + 8 <= MAX_FILENAME) return base;

  const method = blocks[0]; // e.g. "GET"
  const hash   = createHash('md5').update(base).digest('hex').slice(0, 10);
  console.warn(`[proxy] Filename too long (${base.length} chars) — using hash prefix: ${method}_${hash}`);
  return `${method}_${hash}`;
}

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

// ─── Recording asset capture ──────────────────────────────────────────────────
//
// Response bodies from ad-portal/supply-quality often embed presigned S3 URLs
// pointing at call recordings (call_recording/<callId>/<leg>.wav). Those URLs
// expire (X-Amz-Expires), so a mock recorded today is unplayable once the
// signature lapses. While in Proxy Mode — i.e. while the signature is still
// valid — we download the actual audio bytes once and rewrite the field to a
// local /recordings/<file> URL served by this same server, so future replays
// from the mock cache never depend on S3 again.

function isRecordingUrl(value: string): boolean {
  if (!value.startsWith('http')) return false;
  try {
    const u = new URL(value);
    return u.hostname.includes('amazonaws.com') && u.pathname.includes('/call_recording/');
  } catch {
    return false;
  }
}

function recordingFilename(value: string): string {
  const u = new URL(value);
  const parts = u.pathname.split('/').filter(Boolean); // [..., "call_recording", callId, "ADVERTISER.wav"]
  const leg    = parts[parts.length - 1] || 'recording.wav';
  const callId = parts[parts.length - 2] || 'unknown';
  return `${callId}_${leg}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** URLs whose signature already failed once this process lifetime — don't hammer them again. */
const failedRecordingUrls = new Set<string>();

async function saveRecordingAsset(url: string, timeoutMs = 15_000): Promise<string | null> {
  if (failedRecordingUrls.has(url)) return null;
  try {
    const resp = await fetchWithTimeout(url, { timeout: timeoutMs });
    if (!resp.ok) {
      console.warn(`[proxy] Recording asset fetch failed (${resp.status}):`, url);
      failedRecordingUrls.add(url);
      return null;
    }
    const buffer   = Buffer.from(await resp.arrayBuffer());
    const filename = recordingFilename(url);
    await mkdirp(RECORDINGS_DIR);
    fs.writeFileSync(path.join(RECORDINGS_DIR, filename), buffer);
    console.log('[proxy] Captured recording asset →', filename);
    return filename;
  } catch (err) {
    console.warn('[proxy] Could not capture recording asset:', url, err);
    failedRecordingUrls.add(url);
    return null;
  }
}

type RecordingRef = { get: () => string; set: (v: string) => void };

/** Collects every embedded recording-URL string in a JSON tree, with a getter/setter to rewrite it in place. */
function collectRecordingRefs(node: unknown, refs: RecordingRef[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      if (typeof item === 'string' && isRecordingUrl(item)) {
        refs.push({ get: () => node[i] as string, set: (v) => { node[i] = v; } });
      } else if (item && typeof item === 'object') {
        collectRecordingRefs(item, refs);
      }
    });
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    Object.keys(obj).forEach((key) => {
      const val = obj[key];
      if (typeof val === 'string' && isRecordingUrl(val)) {
        refs.push({ get: () => obj[key] as string, set: (v) => { obj[key] = v; } });
      } else if (val && typeof val === 'object') {
        collectRecordingRefs(val, refs);
      }
    });
  }
}

/**
 * Rewrites every embedded recording URL in a JSON tree to a local /recordings/<file> URL.
 *
 * If the asset was already captured (file exists on disk), no network call is made — it
 * just rewrites the field. Otherwise it fetches the (still-presigned) S3 URL once, momentarily
 * reaching out even when the server's overall mode is Cache Mode, saves the bytes locally, and
 * rewrites the field. Failed fetches (expired signature) are left untouched and not retried
 * again this process lifetime.
 */
async function captureRecordingUrls(node: unknown, host: string, timeoutMs?: number): Promise<void> {
  const refs: RecordingRef[] = [];
  collectRecordingRefs(node, refs);
  if (refs.length === 0) return;

  await Promise.all(refs.map(async (ref) => {
    const url          = ref.get();
    const filename      = recordingFilename(url);
    const localFilePath = path.join(RECORDINGS_DIR, filename);

    if (existFile(localFilePath)) {
      ref.set(`http://${host}/recordings/${filename}`);
      return;
    }

    const saved = await saveRecordingAsset(url, timeoutMs);
    if (saved) ref.set(`http://${host}/recordings/${saved}`);
  }));
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
  body: Record<string, unknown>,
  serverConfig: ServerConfig
): string[] {
  const { validate } = serverConfig;
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
  const prefix  = filePrefix(blocks);   // ← same hash logic as write path
  const dirPath = path.join(MOCK_DIR, hostname, dir);
  if (!existFile(dirPath)) return null;

  // 1. Try prefix + _200 (happy path)
  const path200 = path.join(dirPath, `${prefix}_200.json`);
  if (existFile(path200)) return readDataFromFile(path200, 200);

  // 2. Try prefix + any status
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
  body: Record<string, unknown>,
  serverConfig: ServerConfig
): GetDataResult | null {
  const { validate } = serverConfig;

  // ── 1. Exact match ──────────────────────────────────────────────────────────
  const exactBlocks = buildPathBlocks(uriPath, rawQuery, method, body, serverConfig);
  const exact = findCacheFile(hostname, dir, exactBlocks);
  if (exact) return exact;

  // ── Check fallback flag ─────────────────────────────────────────────────────
  const rule = validate.find(r => r.name === uriPath);
  if (!rule?.fallback) return null;

  // ── 2. Without query params ─────────────────────────────────────────────────
  if (rawQuery) {
    const noQBlocks = buildPathBlocks(uriPath, '', method, body, serverConfig);
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
  let realUri             = stripPrefix(req.originalUrl);
  let targetTag           = 'default';

  // Extract /@tag/ from the path
  if (realUri.startsWith('/@')) {
    const end = realUri.indexOf('/', 2);
    if (end !== -1) {
      targetTag = realUri.slice(2, end);
      realUri = realUri.slice(end);
    } else {
      targetTag = realUri.slice(2);
      realUri = '/';
    }
  }

  const [uriPath, rawQuery = ''] = realUri.split('?');

  const headers = req.headers as Record<string, string>;
  const method  = (req.method || 'POST').toUpperCase();
  const body    = (req.body ?? {}) as Record<string, unknown>;

  console.log(`[proxy] ${method} ${realUri} (tag: ${targetTag})`);

  const config   = getConfig();
  const serverConfig = config.servers[targetTag] || config.servers['default'];

  if (!serverConfig) {
    res.status(503).json({ error: `No configuration found for tag '${targetTag}' or 'default'.` });
    return;
  }

  const hostname = getHostname(serverConfig.url);
  const dir      = uriToDir(realUri);

  // ── CACHE MODE ────────────────────────────────────────────────────────────
  if (serverConfig.readFileMode) {
    const cached = getCachedData(hostname, dir, uriPath, rawQuery, method, body, serverConfig);

    if (!cached) {
      // ── Log the miss to ___errors___ for post-analysis ──────────────────────
      try {
        const errDir = getPath(MOCK_DIR, hostname, '___errors___');
        await mkdirp(errDir);

        // Build a short, readable filename: timestamp_METHOD_path-segment.json
        const ts       = new Date().toISOString().replace(/[:.]/g, '-');
        const pathSlug = uriPath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
        const errFile  = getPath(errDir, `${ts}_${method}_${pathSlug}.json`);

        fs.writeFileSync(errFile, JSON.stringify({
          _note:     'Cache miss — request was not found in mock/ folder',
          timestamp: new Date().toISOString(),
          method,
          uri:       realUri,
          uriPath,
          rawQuery,
          queryParams: Object.fromEntries(new URLSearchParams(rawQuery)),
          body,
          lookupDir: getPath(MOCK_DIR, hostname, dir),
        }, null, 2), 'utf8');

        console.warn(`[proxy] CACHE MISS → logged to ___errors___/${ts}_${method}_${pathSlug}.json`);
      } catch (logErr) {
        console.error('[proxy] Failed to write miss log:', logErr);
      }

      res.status(404).json({
        error: 'No cached response found',
        uri:   realUri,
        hint:  'Check mock/___errors___/ for details. Switch to Proxy Mode to capture this response.',
      });
      return;
    }

    const contentType = cached.res.headers?.['content-type'] ?? 'application/json';

    // Cache Mode never talks to the real upstream — except here: if this cached
    // response embeds a call-recording URL we haven't captured locally yet, reach
    // out to it momentarily (best-effort, short timeout) so it can be played back
    // without depending on S3 again. No-op once the file has been captured once.
    if (contentType.includes('application/json') && cached.resData && typeof cached.resData === 'object') {
      const host = headers['host'] ?? `localhost:${req.socket.localPort}`;
      await captureRecordingUrls(cached.resData, host, 6_000);
    }

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
  if (!serverConfig.url) {
    res.status(503).json({ error: `No upstream URL configured for tag '${targetTag}'. Set it in the config panel.` });
    return;
  }

  const upstreamUrl = `${serverConfig.url}${realUri}`;
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
    // ── Never forward hop-by-hop or connection-management headers ────────────
    delete headersClean['content-length'];    // recalculated by fetch
    delete headersClean['host'];              // must match upstream, not proxy
    delete headersClean['postman-token'];     // postman artifact
    // ── Prevent compression Node.js can't decompress (zstd) ─────────────────
    // Let undici/Node negotiate its own Accept-Encoding (gzip, br — both supported)
    delete headersClean['accept-encoding'];
    // ── Prevent 304 Not Modified responses (empty body → json() crash) ───────
    delete headersClean['if-none-match'];
    delete headersClean['if-modified-since'];

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

    // While the presigned S3 signature is still valid, pull down any embedded
    // call-recording audio and rewrite the field to a local, non-expiring URL.
    if (contentType.includes('application/json') && responseData && typeof responseData === 'object') {
      await captureRecordingUrls(responseData, headers['host'] ?? `localhost:${req.socket.localPort}`);
    }

  } catch (err) {
    console.error('[proxy] Fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch from upstream', url: upstreamUrl });
    return;
  }

  // ── Write cache ────────────────────────────────────────────────────────────
  const pathBlocks = buildPathBlocks(uriPath, rawQuery, method, body, serverConfig);
  // pathBlocks still has method + params; filePrefix handles the length limit
  const prefix  = filePrefix(pathBlocks);
  const fileKey = `${prefix}_${codeStatus}`;

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
    const htmlFilePath = getPath(MOCK_DIR, hostname, dir, `${fileKey}.${ext}`);
    fs.writeFileSync(htmlFilePath, responseData as string, 'utf8');
    dataToWrite.res.htmlFilePath = htmlFilePath;
  }

  const jsonFullPath = getPath(MOCK_DIR, hostname, dir, `${fileKey}.json`);
  try {
    fs.writeFileSync(jsonFullPath, JSON.stringify(dataToWrite, null, 4), 'utf8');
    console.log('[proxy] Cached →', jsonFullPath.replace(MOCK_DIR + path.sep, 'mock/'));
  } catch (writeErr) {
    console.error('[proxy] Failed to write cache file:', writeErr);
    // Still send the response even if caching fails
  }

  contentType.includes('application/json')
    ? res.status(parseInt(codeStatus)).json(responseData)
    : res.status(parseInt(codeStatus)).send(responseData);
}
