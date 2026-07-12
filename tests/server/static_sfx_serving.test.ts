import { createHash } from 'node:crypto';
import fs, { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_STATIC_SFX_BYTES, readStaticSfxSnapshot } from '../../server/static_sfx';

const packRoot = mkdtempSync(join(tmpdir(), 'woc-static-sfx-'));
const blobsRoot = join(packRoot, 'blobs');
mkdirSync(blobsRoot);

const savedDatabaseUrl = process.env.DATABASE_URL;
const savedSfxPackDir = process.env.SFX_PACK_DIR;
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5433/wocc_static_sfx_test';
process.env.SFX_PACK_DIR = packRoot;

let routeHttpRequest: typeof import('../../server/main').routeHttpRequest;

beforeAll(async () => {
  ({ routeHttpRequest } = await import('../../server/main'));
});

afterAll(() => {
  rmSync(packRoot, { recursive: true, force: true });
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
  if (savedSfxPackDir === undefined) delete process.env.SFX_PACK_DIR;
  else process.env.SFX_PACK_DIR = savedSfxPackDir;
});

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing test server port');
  return address.port;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function requestStatic(
  url: string,
  options: {
    method?: 'GET' | 'HEAD';
    onWriteHead?: (statusCode: number) => void;
  } = {},
): Promise<{ body: Buffer; headers: Headers; status: number }> {
  const server = http.createServer((req, res) => {
    const writeHead = res.writeHead;
    res.writeHead = function (this: http.ServerResponse, statusCode: number, ...args: unknown[]) {
      options.onWriteHead?.(statusCode);
      return Reflect.apply(writeHead, this, [statusCode, ...args]);
    } as typeof res.writeHead;
    routeHttpRequest(req, res);
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method: options.method ?? 'GET',
    });
    return {
      body: Buffer.from(await response.arrayBuffer()),
      headers: response.headers,
      status: response.status,
    };
  } finally {
    await close(server);
  }
}

describe('versioned static SFX serving', () => {
  it('sends the exact bytes it verified when the pathname is replaced before body delivery', async () => {
    const original = Buffer.from('ORIGINAL_AUDIO');
    const replacement = Buffer.from('REPLACED_AUDIO');
    expect(replacement).toHaveLength(original.length);

    const hash = createHash('sha256').update(original).digest('hex');
    const asset = join(blobsRoot, `${hash}.mp3`);
    const pendingReplacement = join(blobsRoot, `${hash}.replacement`);
    writeFileSync(asset, original);
    writeFileSync(pendingReplacement, replacement);

    let swapped = false;
    const response = await requestStatic(`/audio/sfx/blobs/${hash}.mp3`, {
      onWriteHead(statusCode) {
        if (statusCode === 200 && !swapped) {
          swapped = true;
          renameSync(pendingReplacement, asset);
        }
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(original.length));
    expect(response.body).toEqual(original);
    expect(swapped).toBe(true);
  });

  it('verifies HEAD requests and reports the snapshot length without a response body', async () => {
    const original = Buffer.from('HEAD_AUDIO');
    const replacement = Buffer.from('A_DIFFERENT_LENGTH_AUDIO');
    const hash = createHash('sha256').update(original).digest('hex');
    const asset = join(blobsRoot, `${hash}.mp3`);
    const pendingReplacement = join(blobsRoot, `${hash}.replacement`);
    writeFileSync(asset, original);
    writeFileSync(pendingReplacement, replacement);

    const response = await requestStatic(`/audio/sfx/blobs/${hash}.mp3`, {
      method: 'HEAD',
      onWriteHead(statusCode) {
        if (statusCode === 200) renameSync(pendingReplacement, asset);
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(original.length));
    expect(response.body).toHaveLength(0);
  });

  it('fails closed for missing and oversized content-addressed assets', async () => {
    const missing = await requestStatic(`/audio/sfx/blobs/${'a'.repeat(64)}.mp3`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');

    const oversized = Buffer.alloc(MAX_STATIC_SFX_BYTES + 1, 1);
    const hash = createHash('sha256').update(oversized).digest('hex');
    writeFileSync(join(blobsRoot, `${hash}.mp3`), oversized);
    const tooLarge = await requestStatic(`/audio/sfx/blobs/${hash}.mp3`);
    expect(tooLarge.status).toBe(404);
    expect(tooLarge.headers.get('cache-control')).toBe('no-store');
    expect(tooLarge.body.toString('utf8')).toBe('SFX asset changed during integrity verification');
  });

  it('fails closed if the pathname is replaced while its snapshot is being read', () => {
    const asset = join(blobsRoot, 'replacement-race.mp3');
    const pendingReplacement = join(blobsRoot, 'replacement-race.pending');
    writeFileSync(asset, 'original bytes');
    writeFileSync(pendingReplacement, 'replacement bytes');

    const readSync = fs.readSync;
    let replaced = false;
    const spy = vi.spyOn(fs, 'readSync').mockImplementation(((...args) => {
      const count = Reflect.apply(readSync, fs, args) as number;
      if (count > 0 && !replaced) {
        replaced = true;
        renameSync(pendingReplacement, asset);
      }
      return count;
    }) as typeof fs.readSync);

    try {
      expect(() => readStaticSfxSnapshot(asset)).toThrow(
        'versioned SFX asset changed during snapshot',
      );
      expect(replaced).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('turns a snapshot read error into a no-store 404', async () => {
    const bytes = Buffer.from('READ_ERROR_AUDIO');
    const hash = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(blobsRoot, `${hash}.mp3`), bytes);

    const spy = vi.spyOn(fs, 'readSync').mockImplementationOnce(() => {
      throw new Error('simulated read failure');
    });
    try {
      const response = await requestStatic(`/audio/sfx/blobs/${hash}.mp3`);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.body.toString('utf8')).toBe(
        'SFX asset changed during integrity verification',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
