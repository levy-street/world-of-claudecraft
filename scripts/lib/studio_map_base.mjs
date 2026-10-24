// The base copies behind Studio's change-only push (src/editor/map_push.ts):
// when the editor opens a repo map, the dev server names that exact version of
// data/maps/<slug>.map.json by its git blob id and keeps a copy, so a later
// push can fetch the version the maker started from and merge only what they
// changed onto the current file.
//
// A copy lives in a gitignored cache (node_modules/.cache); a version that was
// ever committed is also found through git itself, so a base survives a cache
// wipe. Dev-only: vite.config.ts calls these from configureServer routes,
// behind the Studio loopback guard (studio_dev_guard.mjs).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const BLOB_ID_RE = /^[0-9a-f]{40}$/;
const CACHED_RE = /^[0-9a-f]{40}\.json$/;
/** Copies kept: the newest by write time (an open refreshes nothing, so a
 *  long-open copy's base can age out; git still has every committed one). */
export const BASE_CACHE_KEEP = 32;

/** The id git gives these bytes as a blob (what `git hash-object` prints). */
export function gitBlobId(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** Keep a copy of `bytes` under its blob id; returns the id. Written whole
 *  then renamed, so a crash never leaves a truncated base behind. */
export function snapshotBase(cacheDir, bytes) {
  const id = gitBlobId(bytes);
  const file = path.join(cacheDir, `${id}.json`);
  if (!existsSync(file)) {
    mkdirSync(cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
    pruneBases(cacheDir, BASE_CACHE_KEEP);
  }
  return id;
}

/** Drop all but the `keep` newest cached copies. */
export function pruneBases(cacheDir, keep) {
  const files = readdirSync(cacheDir)
    .filter((f) => CACHED_RE.test(f))
    .map((f) => ({ f, t: statSync(path.join(cacheDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) rmSync(path.join(cacheDir, f), { force: true });
}

/** A git object that is a map document, not any other file in the repo. */
function looksLikeMapDoc(text) {
  try {
    const doc = JSON.parse(text);
    return !!doc && typeof doc === 'object' && !!doc.meta && Array.isArray(doc.placements);
  } catch {
    return false;
  }
}

/** The text of the base version `id`: the cached copy, else git's own object,
 *  else null. */
export function readBase(cacheDir, repoRoot, id) {
  if (typeof id !== 'string' || !BLOB_ID_RE.test(id)) return null;
  const file = path.join(cacheDir, `${id}.json`);
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    // A damaged copy is not that version: fall through to git.
    if (gitBlobId(bytes) === id) return bytes.toString('utf8');
  }
  try {
    const text = execFileSync('git', ['cat-file', 'blob', id], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return looksLikeMapDoc(text) ? text : null;
  } catch {
    return null;
  }
}
