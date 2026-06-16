import * as http from 'node:http';
import * as path from 'node:path';
import { promises as fsPromises, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaticHandler } from '../server/static_files';

describe('createStaticHandler', () => {
  let root = '';
  let dir = '';
  let server: http.Server;
  let base = '';

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'woc-static-'));
    dir = path.join(root, 'public');
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    mkdirSync(path.join(dir, 'media', 'models'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<main>game shell</main>');
    writeFileSync(path.join(dir, 'admin.html'), '<main>admin shell</main>');
    writeFileSync(path.join(dir, 'assets', 'main.abc123.js'), 'console.log("ok");');
    writeFileSync(path.join(dir, 'media', 'models', 'knight.abc123.glb'), 'glbdata');
    writeFileSync(path.join(root, 'outside.js'), 'outside static root');

    const handler = createStaticHandler(dir, { wikiUrl: 'https://wiki.example.test/Main_Page' });
    server = http.createServer((req, res) => {
      void handler(req, res).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(err));
      });
    });
    server.keepAliveTimeout = 1;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('test server did not bind to a TCP port');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('serves hashed assets with immutable cache validators', async () => {
    const res = await fetch(`${base}/assets/main.abc123.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-type')).toBe('application/javascript');
    expect(res.headers.get('etag')).toMatch(/^W\/".+"$/);
    expect(await res.text()).toBe('console.log("ok");');
  });

  it('caches metadata for immutable hashed assets after the first hit', async () => {
    const statSpy = vi.spyOn(fsPromises, 'stat');
    try {
      await fetch(`${base}/assets/main.abc123.js`);
      await fetch(`${base}/assets/main.abc123.js`);

      const assetStats = statSpy.mock.calls.filter(([file]) =>
        String(file).endsWith(path.join('assets', 'main.abc123.js')));
      expect(assetStats).toHaveLength(1);
    } finally {
      statSpy.mockRestore();
    }
  });

  it('handles HEAD and conditional GET without reading the asset body', async () => {
    const head = await fetch(`${base}/media/models/knight.abc123.glb`, { method: 'HEAD' });
    const etag = head.headers.get('etag');

    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(head.headers.get('content-type')).toBe('model/gltf-binary');
    expect(etag).toMatch(/^W\/".+"$/);
    expect(await head.text()).toBe('');

    const notModified = await fetch(`${base}/media/models/knight.abc123.glb`, {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
  });

  it('falls back to the right html shell for app routes', async () => {
    const game = await fetch(`${base}/character/select`);
    expect(game.status).toBe(200);
    expect(game.headers.get('cache-control')).toBe('no-cache');
    expect(game.headers.get('content-length')).toBe(String('<main>game shell</main>'.length));
    expect(await game.text()).toBe('<main>game shell</main>');

    const admin = await fetch(`${base}/admin`);
    expect(admin.status).toBe(200);
    expect(admin.headers.get('cache-control')).toBe('no-cache');
    expect(await admin.text()).toBe('<main>admin shell</main>');
  });

  it('handles HEAD requests for app routes without streaming the html shell', async () => {
    const res = await fetch(`${base}/character/select`, { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(res.headers.get('content-length')).toBe(String('<main>game shell</main>'.length));
    expect(await res.text()).toBe('');
  });

  it('does not serve html for missing typed assets', async () => {
    const res = await fetch(`${base}/models/missing.glb`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('not found');
  });

  it('handles HEAD requests for missing typed assets without a body', async () => {
    const res = await fetch(`${base}/models/missing.glb`, { method: 'HEAD' });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('');
  });

  it('does not serve files outside the static root', async () => {
    const res = await fetch(`${base}/../outside.js`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('not found');
  });

  it('redirects wiki routes before static fallback', async () => {
    const res = await fetch(`${base}/wiki/classes`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://wiki.example.test/Main_Page');
    expect(await res.text()).toBe('');
  });
});
