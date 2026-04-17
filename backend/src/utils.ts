import path from 'path';
import fs from 'fs';

/**
 * Joins path segments, filtering out empty strings.
 * Preserves the original behaviour of the JS version.
 */
export function getPath(...dirs: string[]): string {
  return dirs.filter((d) => d !== '').join(path.sep);
}

/** Safe fs.statSync wrapper — returns false instead of throwing */
export function existFile(filePath: string): boolean {
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * fetch() wrapper that aborts after `timeout` milliseconds.
 * Uses the Node 18+ built-in fetch API.
 */
export async function fetchWithTimeout(
  resource: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 8_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}
