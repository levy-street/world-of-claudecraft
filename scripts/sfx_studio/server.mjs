// Loopback-only SFX Studio HTTP server. Mutations require a random per-launch
// token plus a same-origin request. Audio bodies are streamed with strict size,
// key, extension, and real-path containment checks.

import { randomBytes } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeLoudness,
  assertSfxKey,
  audioWorkspaceHash,
  exportProductionBundle,
  getPlaybackProfileState,
  hashFile,
  inspectAudio,
  listVersions,
  loadDraft,
  publishedPath,
  publishedStateHashForKey,
  publishPlaybackProfile,
  publishProject,
  renderPreview,
  resetAudioDraft,
  resolveSourcePath,
  restoreVersion,
  STUDIO_ROOT,
  saveDraft,
  saveStudioDraft,
  saveUpload,
  sourceUrl,
} from './audio_io.mjs';
import { collectSfxCatalog } from './catalog.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIR = fileURLToPath(new URL('.', import.meta.url));
const MAX_JSON = 2 * 1024 * 1024;
const MAX_UPLOAD = 64 * 1024 * 1024;
const STUDIO_LOCK = '.sfx-studio.server.lock';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.zip': 'application/zip',
};

function acquireStudioLock() {
  const lockRoot = process.env.WOC_SFX_STUDIO_TEST_ROOT
    ? process.env.WOC_SFX_STUDIO_TEST_ROOT
    : join(REPO_ROOT, 'tmp');
  mkdirSync(lockRoot, { recursive: true });
  const path = join(lockRoot, STUDIO_LOCK);
  const id = randomBytes(16).toString('hex');
  const owner = { pid: process.pid, id };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
      return () => {
        try {
          const current = JSON.parse(readFileSync(path, 'utf8'));
          if (current?.pid === process.pid && current?.id === id) rmSync(path, { force: true });
        } catch {
          // A missing or replaced lock does not belong to this server.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let active = true;
      try {
        const current = JSON.parse(readFileSync(path, 'utf8'));
        if (!Number.isSafeInteger(current?.pid) || current.pid <= 0) active = false;
        else process.kill(current.pid, 0);
      } catch (lockError) {
        active = lockError?.code !== 'ESRCH' && lockError?.code !== 'ENOENT';
      }
      if (active) throw new Error('another SFX Studio server is already using this repository');
      rmSync(path, { force: true });
    }
  }
  throw new Error('could not acquire the SFX Studio workspace lock');
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

async function buildThreeBundle() {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(DIR, 'three_bundle_entry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, MIME['.json'], JSON.stringify(value));
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new Error(`request exceeds ${Math.round(limit / 1024 / 1024)} MiB`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`request exceeds ${Math.round(limit / 1024 / 1024)} MiB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim();
  if (contentType !== 'application/json') throw new Error('Content-Type must be application/json');
  const body = await readBody(req, MAX_JSON);
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {};
  } catch {
    throw new Error('invalid JSON body');
  }
}

function safeRealFile(root, relativePath, extensions) {
  const rootReal = realpathSync(root);
  const lexical = resolve(rootReal, relativePath);
  if (!lexical.startsWith(`${rootReal}/`)) throw new Error('path is outside the allowed root');
  const target = realpathSync(lexical);
  if (!target.startsWith(`${rootReal}/`)) throw new Error('symlink escapes the allowed root');
  if (!statSync(target).isFile()) throw new Error('not a file');
  if (extensions && !extensions.has(extname(target).toLowerCase())) {
    throw new Error('file type is not allowed');
  }
  return target;
}

function streamFile(req, res, path, { immutable = false } = {}) {
  const stat = statSync(path);
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const common = {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-store',
  };
  const range = String(req.headers.range ?? '');
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return send(res, 416, 'text/plain', 'invalid range');
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start < 0 || end < start || end >= stat.size) {
      return send(res, 416, 'text/plain', 'range not satisfiable', {
        'Content-Range': `bytes */${stat.size}`,
      });
    }
    res.writeHead(206, {
      ...common,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...common, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}

function streamDownload(res, path, filename, headers = {}) {
  const stat = statSync(path);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME['.zip'],
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    ...headers,
  });
  createReadStream(path).pipe(res);
}

export async function startSfxStudio({ port = 5181 } = {}) {
  const host = '127.0.0.1';
  let expectedHost = `${host}:${port}`;
  const token = randomBytes(24).toString('hex');
  let origin = `http://${host}:${port}`;
  const [threeBundle, template, client, styles, viewer] = await Promise.all([
    buildThreeBundle(),
    Promise.resolve(readFileSync(join(DIR, 'studio.html'), 'utf8')),
    Promise.resolve(readFileSync(join(DIR, 'studio_ui.js'), 'utf8')),
    Promise.resolve(readFileSync(join(DIR, 'studio.css'), 'utf8')),
    Promise.resolve(readFileSync(join(DIR, 'viewer.js'), 'utf8')),
  ]);
  let catalogPromise = null;
  const catalog = () => (catalogPromise ??= collectSfxCatalog());
  const invalidateCatalog = () => {
    catalogPromise = null;
  };

  const isMutationAllowed = (req) => {
    const requestOrigin = String(req.headers.origin ?? '');
    const requestToken = String(req.headers['x-woc-sfx-studio'] ?? '');
    return requestOrigin === origin && requestToken === token;
  };

  async function api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      if (String(req.headers['x-woc-sfx-studio'] ?? '') !== token) {
        return sendJson(res, 403, { error: 'studio token is invalid' });
      }
      return sendJson(res, 200, await catalog());
    }
    if (req.method === 'GET' && url.pathname === '/api/project') {
      if (String(req.headers['x-woc-sfx-studio'] ?? '') !== token) {
        return sendJson(res, 403, { error: 'studio token is invalid' });
      }
      const key = assertSfxKey(url.searchParams.get('key'));
      const project = await loadDraft(key);
      const playbackState = getPlaybackProfileState(key);
      const source = resolveSourcePath(key, project.sourceId);
      const [info, loudness] = await Promise.all([inspectAudio(source), analyzeLoudness(source)]);
      return sendJson(res, 200, {
        key,
        project,
        audioWorkspaceHash: audioWorkspaceHash(project),
        source: { url: sourceUrl(key, project.sourceId), info, loudness },
        publishedHash: publishedStateHashForKey(key),
        versions: listVersions(key),
        ...playbackState,
      });
    }
    if (!isMutationAllowed(req))
      return sendJson(res, 403, { error: 'mutation token or origin is invalid' });
    if (req.method === 'POST' && url.pathname === '/api/project') {
      const body = await readJson(req);
      const key = assertSfxKey(body.key);
      if (Object.hasOwn(body, 'playback')) {
        return sendJson(
          res,
          200,
          await saveStudioDraft(
            key,
            body.project,
            body.playback,
            typeof body.expectedPlaybackWorkspaceHash === 'string'
              ? body.expectedPlaybackWorkspaceHash
              : null,
            typeof body.expectedAudioWorkspaceHash === 'string'
              ? body.expectedAudioWorkspaceHash
              : null,
          ),
        );
      }
      return sendJson(res, 200, {
        ...(await saveDraft(
          key,
          body.project,
          typeof body.expectedAudioWorkspaceHash === 'string'
            ? body.expectedAudioWorkspaceHash
            : null,
        )),
        ...getPlaybackProfileState(key),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset-project') {
      const body = await readJson(req);
      const key = assertSfxKey(body.key);
      return sendJson(res, 200, {
        ...(await resetAudioDraft(
          key,
          typeof body.expectedAudioWorkspaceHash === 'string'
            ? body.expectedAudioWorkspaceHash
            : null,
        )),
        ...getPlaybackProfileState(key),
      });
    }
    if (req.method === 'PUT' && url.pathname === '/api/upload') {
      const key = assertSfxKey(url.searchParams.get('key'));
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0];
      if (!(contentType.startsWith('audio/') || contentType === 'application/octet-stream')) {
        throw new Error('upload Content-Type must be audio/* or application/octet-stream');
      }
      const filename = String(req.headers['x-filename'] ?? '');
      const buffer = await readBody(req, MAX_UPLOAD);
      const result = await saveUpload(
        key,
        filename,
        buffer,
        typeof req.headers['x-woc-sfx-audio-workspace'] === 'string'
          ? req.headers['x-woc-sfx-audio-workspace']
          : null,
      );
      invalidateCatalog();
      return sendJson(res, 200, {
        ...result,
        source: { url: sourceUrl(key, result.sourceId) },
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/render') {
      const body = await readJson(req);
      return sendJson(
        res,
        200,
        await renderPreview(
          assertSfxKey(body.key),
          body.project,
          typeof body.expectedAudioWorkspaceHash === 'string'
            ? body.expectedAudioWorkspaceHash
            : null,
        ),
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const body = await readJson(req);
      const result = await publishProject(
        assertSfxKey(body.key),
        body.project,
        typeof body.expectedHash === 'string' ? body.expectedHash : null,
        typeof body.expectedAudioWorkspaceHash === 'string'
          ? body.expectedAudioWorkspaceHash
          : null,
      );
      invalidateCatalog();
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/playback') {
      const body = await readJson(req);
      const result = await publishPlaybackProfile(
        assertSfxKey(body.key),
        typeof body.expectedPlaybackProfileHash === 'string'
          ? body.expectedPlaybackProfileHash
          : null,
        typeof body.expectedPlaybackWorkspaceHash === 'string'
          ? body.expectedPlaybackWorkspaceHash
          : null,
      );
      invalidateCatalog();
      return sendJson(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/export') {
      const body = await readJson(req);
      const result = await exportProductionBundle(
        typeof body.expectedPlaybackProfileHash === 'string'
          ? body.expectedPlaybackProfileHash
          : null,
        typeof body.expectedPlaybackWorkspaceHash === 'string'
          ? body.expectedPlaybackWorkspaceHash
          : null,
      );
      return streamDownload(res, result.path, result.filename, {
        'X-Woc-Sfx-Bundle': result.bundleId,
        'X-Woc-Sfx-Keys': String(result.keyCount),
        'X-Woc-Sfx-Tracks': String(result.trackCount),
        'X-Woc-Sfx-Audio-Bytes': String(result.totalAudioBytes),
        'X-Woc-Sfx-Sha256': result.sha256,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/restore') {
      const body = await readJson(req);
      const result = await restoreVersion(
        assertSfxKey(body.key),
        String(body.hash ?? ''),
        typeof body.expectedHash === 'string' ? body.expectedHash : null,
        typeof body.expectedAudioWorkspaceHash === 'string'
          ? body.expectedAudioWorkspaceHash
          : null,
      );
      invalidateCatalog();
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { error: 'unknown API route' });
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (String(req.headers.host ?? '') !== expectedHost) {
          return send(res, 421, 'text/plain', 'misdirected request');
        }
        const url = new URL(req.url ?? '/', origin);
        const method = req.method ?? 'GET';
        if (!['GET', 'HEAD', 'POST', 'PUT'].includes(method)) {
          return send(res, 405, 'text/plain', 'method not allowed');
        }
        if (url.pathname.startsWith('/api/')) return await api(req, res, url);
        if (!['GET', 'HEAD'].includes(method))
          return send(res, 405, 'text/plain', 'method not allowed');
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const html = template.replace('__STUDIO_TOKEN__', token);
          return send(res, 200, MIME['.html'], html);
        }
        if (url.pathname === '/studio_ui.js') return send(res, 200, MIME['.js'], client);
        if (url.pathname === '/studio.css') return send(res, 200, MIME['.css'], styles);
        if (url.pathname === '/favicon.ico') {
          return streamFile(req, res, join(REPO_ROOT, 'public/favicon.ico'), { immutable: true });
        }
        if (url.pathname === '/three.bundle.js') return send(res, 200, MIME['.js'], threeBundle);
        if (url.pathname === '/viewer_live.js') return send(res, 200, MIME['.js'], viewer);
        if (url.pathname.startsWith('/audio/')) {
          const key = assertSfxKey(url.pathname.slice('/audio/'.length).replace(/\.mp3$/, ''));
          const path = publishedPath(key);
          const requestedHash = url.searchParams.get('v') ?? '';
          const actualHash = hashFile(path).slice(0, 12);
          const immutable = /^[a-f0-9]{12}$/.test(requestedHash) && requestedHash === actualHash;
          return streamFile(req, res, path, { immutable });
        }
        if (url.pathname.startsWith('/source/')) {
          const match = url.pathname.match(
            /^\/source\/([a-z0-9_]+)\/([a-f0-9]{64}\.[a-z0-9]{2,5})$/,
          );
          if (!match) return send(res, 404, 'text/plain', 'not found');
          return streamFile(req, res, resolveSourcePath(assertSfxKey(match[1]), match[2]));
        }
        if (url.pathname.startsWith('/preview/')) {
          const name = url.pathname.slice('/preview/'.length);
          if (!/^[a-z0-9_]+\.[a-f0-9]{16}\.mp3$/.test(name)) {
            return send(res, 404, 'text/plain', 'not found');
          }
          const path = safeRealFile(join(STUDIO_ROOT, 'previews'), name, new Set(['.mp3']));
          return streamFile(req, res, path, { immutable: true });
        }
        if (url.pathname.startsWith('/repo/')) {
          const rel = url.pathname.slice('/repo/'.length);
          const prefix = rel.startsWith('public/models/')
            ? 'public/models/'
            : rel.startsWith('public/textures/')
              ? 'public/textures/'
              : null;
          if (!prefix) return send(res, 403, 'text/plain', 'forbidden');
          const path = safeRealFile(
            join(REPO_ROOT, prefix),
            rel.slice(prefix.length),
            new Set(['.glb', '.png', '.jpg', '.jpeg', '.webp']),
          );
          return streamFile(req, res, path, { immutable: true });
        }
        return send(res, 404, 'text/plain', 'not found');
      } catch (error) {
        return sendJson(res, 400, { error: String(error.message ?? error).slice(0, 1200) });
      }
    })();
  });

  const releaseStudioLock = acquireStudioLock();
  try {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolvePromise);
    });
  } catch (error) {
    releaseStudioLock();
    throw error;
  }
  server.once('close', releaseStudioLock);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('studio did not bind a TCP port');
  }
  expectedHost = `${host}:${address.port}`;
  origin = `http://${expectedHost}`;
  return { server, url: origin, token, workspace: relative(REPO_ROOT, STUDIO_ROOT) };
}
