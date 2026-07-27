// ─── Domain types ────────────────────────────────────────────────────────────

export interface ValidateRule {
  /** URI path to match (without /proxy prefix), e.g. "/oauth/token" */
  name: string;

  /** Body params whose values are appended to the cache filename */
  params: string[];

  /**
   * Which URL query params to include in the cache key:
   *   undefined → include ALL query params (default when no validate rule exists)
   *   []        → include NONE (ignore query string entirely)
   *   [...]     → include only the listed params
   */
  queryParams?: string[];

  /**
   * Enable fallback lookup in Cache Mode:
   * If the exact cache file is not found, progressively try:
   *   1. Same route, without query params
   *   2. Same route, method only (no params at all)
   *   3. Any .json file in the directory
   */
  fallback?: boolean;
}

export interface ServerConfig {
  /** Base URL of the upstream service — used in Proxy Mode */
  url: string;
  /** true → serve from cache; false → proxy to upstream and cache responses */
  readFileMode: boolean;
  /** Per-route rules for cache key building and fallback behaviour */
  validate: ValidateRule[];
  /** Request headers forwarded to the upstream (e.g. "authorization") */
  session: string[];
}

export interface AppConfig {
  servers: Record<string, ServerConfig>;
}

// ─── Cache file structure ────────────────────────────────────────────────────

export interface CachedResponse {
  uri: string;
  method: string;
  req: {
    headers: Record<string, string>;
    body: unknown;
  };
  res: {
    statusCode: string;
    headers: Record<string, string>;
    responseTime: number;
    /** Absolute path to the companion HTML/CSS/JS asset file (if any) */
    htmlFilePath?: string;
    body: unknown;
  };
}

export interface GetDataResult {
  resCode: number;
  resData: unknown;
  res: CachedResponse['res'];
}
