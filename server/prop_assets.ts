// External prop assets — GLB files served to the in-world Builder so admins can
// place them as props. Files live under WOC_PROP_DIR (an operator-configured
// directory; no default store is assumed). Served read-only at /props/<ref>.glb,
// listed at /api/props, and uploaded (admin-gated) via POST /api/props/upload.
//
// A ref is a bare `<name>.glb` or one subdirectory deep `<group>/<name>.glb`, so
// assets can be organized into named groups. This pairs with the renderer's
// `ext:<name>` prop loader, which fetches /props/<name>.glb.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// Operator-configured asset directory. Unset => the catalog is empty and statics
// 404; nothing is served from an implicit location. Read per-call so deployment
// env changes (and tests) take effect without a module reload.
function propDir(): string {
  return (process.env.WOC_PROP_DIR ?? '').replace(/[/\\]$/, '');
}

const GLB_RE = /^[A-Za-z0-9_.-]+\.glb$/; // safe filename, .glb only
const GLB_REF_RE = /^([A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+\.glb$/; // one subdir deep
const MAX_UPLOAD = 64 * 1024 * 1024; // 64 MiB

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Resolve a request ref to a real file inside the prop dir, or null if unsafe/unset.
function safePropPath(ref: string): string | null {
  const dir = propDir();
  if (!dir || !GLB_REF_RE.test(ref) || ref.includes('..')) return null;
  const full = path.join(dir, ref);
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  return full;
}

/** GET /props/<ref>.glb — stream a prop GLB. Public read (every client that sees
 *  a placed prop fetches it). Returns true if it handled the request. */
export function handlePropStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/props/')) return false;
  const ref = decodeURIComponent(url.slice('/props/'.length));
  const full = safePropPath(ref);
  if (!full || !fs.existsSync(full)) {
    res.writeHead(404);
    res.end('not found');
    return true;
  }
  const stat = fs.statSync(full);
  res.writeHead(200, {
    'content-type': 'model/gltf-binary',
    'content-length': String(stat.size),
    'cache-control': 'public, max-age=300',
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

interface PropEntry {
  key: string;
  name: string;
  url: string;
  group: string;
}

const prettify = (s: string): string => s.replace(/[_-]+/g, ' ').trim();

/** GET /api/props — list placeable prop GLBs (top-level + one group subdir deep). */
export async function handlePropCatalog(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (url !== '/api/props') return false;
  const items: PropEntry[] = [];
  const dir = propDir();
  if (!dir) {
    sendJson(res, 200, { props: items });
    return true;
  }
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile() && GLB_RE.test(e.name)) {
        const base = e.name.replace(/\.glb$/, '');
        items.push({ key: base, name: prettify(base), url: `/props/${encodeURIComponent(e.name)}`, group: 'Props' });
      } else if (e.isDirectory() && /^[A-Za-z0-9_.-]+$/.test(e.name)) {
        const sub = await fsp.readdir(path.join(dir, e.name)).catch(() => [] as string[]);
        for (const f of sub) {
          if (!GLB_RE.test(f)) continue;
          const base = f.replace(/\.glb$/, '');
          items.push({
            key: `${e.name}/${base}`,
            name: prettify(base),
            url: `/props/${encodeURIComponent(e.name)}/${encodeURIComponent(f)}`,
            group: e.name,
          });
        }
      }
    }
    sendJson(res, 200, { props: items });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}

/**
 * POST /api/props/upload?name=<x>.glb — admin upload of a GLB into the prop dir.
 * `isAdmin` is injected by the caller (resolves the request's bearer token to an
 * admin account) so this module stays free of the auth/db layer. Body = raw GLB.
 */
export async function handlePropUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  isAdmin: (req: http.IncomingMessage) => Promise<boolean>,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (url !== '/api/props/upload' || req.method !== 'POST') return false;
  if (!propDir()) {
    sendJson(res, 503, { error: 'prop store not configured' });
    return true;
  }
  if (!(await isAdmin(req))) {
    sendJson(res, 403, { error: 'admin access required' });
    return true;
  }
  const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  let name = (q.get('name') ?? '').trim();
  if (!name.toLowerCase().endsWith('.glb')) name += '.glb';
  name = path.basename(name).replace(/[^A-Za-z0-9_.-]/g, '_');
  const full = safePropPath(name);
  if (!full) {
    sendJson(res, 400, { error: 'invalid filename' });
    return true;
  }
  try {
    await fsp.mkdir(propDir(), { recursive: true });
    const chunks: Buffer[] = [];
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX_UPLOAD) {
          reject(new Error('file too large (>64MB)'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve());
      req.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'glTF') {
      sendJson(res, 400, { error: 'not a valid GLB (missing glTF magic)' });
      return true;
    }
    await fsp.writeFile(full, buf);
    const base = name.replace(/\.glb$/, '');
    sendJson(res, 200, { ok: true, key: base, url: `/props/${encodeURIComponent(name)}` });
  } catch (err) {
    sendJson(res, 500, { error: String(err) });
  }
  return true;
}
