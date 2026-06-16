import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cacheControlFor, etagFor, isNotModified } from './static_cache';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

function isAdminRequest(req: http.IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const urlPath = (req.url ?? '/').split('?')[0];
  return host.startsWith('admin.') || urlPath === '/admin' || urlPath === '/admin/';
}

async function statPath(file: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(file);
  } catch {
    return null;
  }
}

function isWithinDir(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel === '' || (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function pipeStaticFile(res: http.ServerResponse, file: string): void {
  fs.createReadStream(file)
    .on('error', () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    })
    .pipe(res);
}

function sendText(req: http.IncomingMessage, res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(req.method === 'HEAD' ? undefined : text);
}

export function createStaticHandler(staticDir: string, opts: { wikiUrl?: string } = {}) {
  const immutableStats = new Map<string, fs.Stats>();

  async function statStaticPath(file: string, urlPath: string): Promise<fs.Stats | null> {
    const immutable = cacheControlFor(urlPath).includes('immutable');
    if (immutable) {
      const cached = immutableStats.get(file);
      if (cached) return cached;
    }
    const stats = await statPath(file);
    if (immutable && stats?.isFile()) immutableStats.set(file, stats);
    return stats;
  }

  return async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const shell = isAdminRequest(req) ? 'admin.html' : 'index.html';
    let urlPath = (req.url ?? '/').split('?')[0];
    if (opts.wikiUrl && (urlPath === '/wiki' || urlPath === '/wiki/' || urlPath.startsWith('/wiki/'))) {
      res.writeHead(302, { Location: opts.wikiUrl });
      res.end();
      return;
    }
    if (urlPath === '/' || urlPath === '/admin' || urlPath === '/admin/') urlPath = `/${shell}`;
    // normalize once and reuse for BOTH file resolution and cache policy —
    // otherwise /assets/../x would serve a mutable file with immutable caching
    urlPath = path.posix.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
    const file = path.join(staticDir, urlPath);
    const stats = isWithinDir(staticDir, file) ? await statStaticPath(file, urlPath) : null;
    if (!stats?.isFile()) {
      // Asset paths must 404, not SPA-fall-back: a missing .glb served as index.html
      // surfaces as a cryptic GLTFLoader parse error instead of a clear 404.
      if (path.extname(urlPath) && path.extname(urlPath) !== '.html') {
        sendText(req, res, 404, 'not found');
        return;
      }
      // SPA fallback
      const index = path.join(staticDir, shell);
      const indexStats = await statPath(index);
      if (indexStats?.isFile()) {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache',
          'Content-Length': indexStats.size,
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        pipeStaticFile(res, index);
      } else {
        sendText(req, res, 404, 'not found (run `npm run build` to serve the client from the game server)');
      }
      return;
    }
    const isReadMethod = req.method === 'GET' || req.method === 'HEAD';
    const etag = etagFor(stats);
    const validators = {
      'Cache-Control': cacheControlFor(urlPath),
      'ETag': etag,
      'Last-Modified': stats.mtime.toUTCString(),
    };
    if (isReadMethod && isNotModified(req.headers, etag, stats.mtime)) {
      res.writeHead(304, validators);
      res.end();
      return;
    }
    res.writeHead(200, {
      ...validators,
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': stats.size,
    });
    if (req.method === 'HEAD') {
      // don't read a multi-MB asset from disk just to discard the bytes
      res.end();
      return;
    }
    pipeStaticFile(res, file);
  };
}
