import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { handlePropCatalog, handlePropStatic, handlePropUpload } from '../server/prop_assets';

// A minimal fake response capturing status + body for handler assertions.
function fakeRes() {
  const r = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, headers?: Record<string, string>) {
      r.statusCode = code;
      if (headers) r.headers = headers;
      return r;
    },
    end(chunk?: string) {
      if (chunk) r.body += chunk;
    },
  };
  return r;
}

function get(url: string): http.IncomingMessage {
  return { url, method: 'GET', headers: {} } as unknown as http.IncomingMessage;
}

describe('prop_assets serving', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-'));
    process.env.WOC_PROP_DIR = dir;
    const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(8)]);
    fs.writeFileSync(path.join(dir, 'barrel.glb'), glb);
    fs.mkdirSync(path.join(dir, 'village'));
    fs.writeFileSync(path.join(dir, 'village', 'well.glb'), glb);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.WOC_PROP_DIR;
  });

  it('catalog lists top-level + grouped GLBs and ignores non-GLB files', async () => {
    const res = fakeRes();
    await handlePropCatalog(get('/api/props'), res as unknown as http.ServerResponse);
    expect(res.statusCode).toBe(200);
    const { props } = JSON.parse(res.body) as { props: { key: string; group: string }[] };
    const keys = props.map((p) => p.key).sort();
    expect(keys).toContain('barrel');
    expect(keys).toContain('village/well');
    expect(props.some((p) => p.key.includes('notes'))).toBe(false);
  });

  it('static serve rejects path traversal and unknown files', () => {
    const bad = fakeRes();
    handlePropStatic(get('/props/..%2f..%2fetc%2fpasswd'), bad as unknown as http.ServerResponse);
    expect(bad.statusCode).toBe(404);

    const missing = fakeRes();
    handlePropStatic(get('/props/nope.glb'), missing as unknown as http.ServerResponse);
    expect(missing.statusCode).toBe(404);
  });

  it('catalog is empty when the prop dir is unset', async () => {
    delete process.env.WOC_PROP_DIR;
    const res = fakeRes();
    await handlePropCatalog(get('/api/props'), res as unknown as http.ServerResponse);
    expect(JSON.parse(res.body)).toEqual({ props: [] });
  });

  it('upload requires admin', async () => {
    const res = fakeRes();
    const denyAdmin = async () => false;
    const req = {
      url: '/api/props/upload?name=x.glb',
      method: 'POST',
      headers: {},
      on: () => {},
    } as unknown as http.IncomingMessage;
    await handlePropUpload(req, res as unknown as http.ServerResponse, denyAdmin);
    expect(res.statusCode).toBe(403);
  });
});
