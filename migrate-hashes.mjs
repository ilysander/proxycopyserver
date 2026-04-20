/**
 * migrate-hashes.mjs
 *
 * Renames hashed mock files (GET_xxxxxxxxxx_200.json) from the OLD hash format
 * (MD5 of blocks+status) to the NEW format (MD5 of blocks only).
 *
 * Run from the repo root:
 *   node migrate-hashes.mjs
 */

import fs   from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const MOCK_DIR  = path.resolve('backend/mock');
const MAX_FILENAME = 200;

// ── Replicate filePrefix() from proxy.ts ────────────────────────────────────
function sortQuery(rawQuery) {
  if (!rawQuery) return '';
  const params = new URLSearchParams(rawQuery);
  const sorted = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return sorted.toString();
}

function filePrefix(method, rawQuery) {
  const queryPart = rawQuery ? `?${sortQuery(rawQuery)}` : '';
  const base = queryPart ? `${method}_${queryPart}` : method;

  if (base.length + 8 <= MAX_FILENAME) return base;   // short → use as-is

  const hash = createHash('md5').update(base).digest('hex').slice(0, 10);
  return `${method}_${hash}`;                          // long → hash
}

// ── Walk all mock files ──────────────────────────────────────────────────────
let renamed = 0, skipped = 0, errors = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '___errors___') continue;   // skip our error logs
      walk(fullPath);
      continue;
    }

    // Only process files that look like hashed names: GET_[10 hex chars]_200.json
    if (!/^[A-Z]+_[0-9a-f]{10}_\d+\.json$/.test(entry.name)) continue;

    try {
      const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const uri     = content.uri ?? '';
      const method  = (content.method ?? 'GET').toUpperCase();
      const status  = content.res?.statusCode ?? '200';

      const [, rawQuery = ''] = uri.split('?');

      const newPrefix   = filePrefix(method, rawQuery);
      const newFilename = `${newPrefix}_${status}.json`;

      if (newFilename === entry.name) {
        console.log(`⏭  already correct: ${entry.name}`);
        skipped++;
        continue;
      }

      const newPath = path.join(dir, newFilename);

      if (fs.existsSync(newPath)) {
        console.warn(`⚠️  skip (target exists): ${entry.name} → ${newFilename}`);
        skipped++;
        continue;
      }

      fs.renameSync(fullPath, newPath);
      console.log(`✅ renamed: ${entry.name}\n        → ${newFilename}`);
      renamed++;

    } catch (err) {
      console.error(`❌ error processing ${entry.name}:`, err.message);
      errors++;
    }
  }
}

walk(MOCK_DIR);
console.log(`\nDone — renamed: ${renamed}, skipped: ${skipped}, errors: ${errors}`);
