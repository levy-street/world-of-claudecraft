// Serving the static encyclopedia (scripts/wiki_site/build.mjs writes it into dist/).
// Each article is <static>/wiki/<section>/<slug>/index.html, answered at its slashless
// path; a trailing-slash variant 301s to that canonical path. Retired addresses live in
// <static>/encyclopedia-data/redirects.json: a target path 301s there, null is 410 Gone.
// Anything else returns null so serveStatic keeps its Guide SPA fallback.
import fs from 'node:fs';
import path from 'node:path';

export type WikiResolution =
  | { kind: 'file'; file: string; stats: fs.Stats }
  | { kind: 'redirect'; location: string }
  | { kind: 'gone' };

const REDIRECTS_FILE = path.join('encyclopedia-data', 'redirects.json');
const redirectCache = new Map<string, Record<string, string | null>>();

/** The redirect table for a static dir, read once; missing or invalid reads as empty. */
export function wikiRedirects(staticDir: string): Record<string, string | null> {
  const cached = redirectCache.get(staticDir);
  if (cached) return cached;
  let table: Record<string, string | null> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(staticDir, REDIRECTS_FILE), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) table = parsed;
  } catch {}
  redirectCache.set(staticDir, table);
  return table;
}

/** Test hook: forget cached redirect tables. */
export function resetWikiRedirectCache(): void {
  redirectCache.clear();
}

function pageFile(staticDir: string, pathname: string): { file: string; stats: fs.Stats } | null {
  const file = path.join(staticDir, pathname, 'index.html');
  const root = path.resolve(staticDir) + path.sep;
  if (!path.resolve(file).startsWith(root)) return null;
  try {
    const stats = fs.statSync(file);
    return stats.isFile() ? { file, stats } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a /wiki request. `pathname` is the raw URL pathname, `search` the query string
 * (kept on redirects). Returns null when the static encyclopedia has nothing for it.
 */
export function resolveWikiRequest(
  staticDir: string,
  pathname: string,
  search = '',
): WikiResolution | null {
  if (!pathname.startsWith('/wiki/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // Only plain path segments: no traversal, no backslashes, no file extensions.
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  const normalized = path.posix.normalize(decoded);
  if (normalized !== decoded && normalized + '/' !== decoded) return null;
  if (normalized.split('/').some((seg) => seg === '..')) return null;
  const slashless = normalized.replace(/\/+$/, '');
  if (path.posix.extname(slashless)) return null;

  const hit = pageFile(staticDir, slashless);
  if (hit) {
    if (slashless !== decoded) return { kind: 'redirect', location: slashless + search };
    return { kind: 'file', ...hit };
  }
  const redirects = wikiRedirects(staticDir);
  if (Object.hasOwn(redirects, slashless)) {
    const target = redirects[slashless];
    if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//'))
      return { kind: 'redirect', location: target + search };
    return { kind: 'gone' };
  }
  return null;
}
