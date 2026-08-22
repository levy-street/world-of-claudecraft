// Static streams must be destroyed when the client goes away (issue #3562).
// serveStatic piped fs.createReadStream into the response with bare pipe(),
// which never destroys the SOURCE stream when the response side closes first:
// every static request a client aborted mid-transfer left its file descriptor
// open for the life of the process (~95 fds/hour on prod, with runtime-pack
// .json the most-duplicated handle). The fix routes both static stream sites
// through stream.pipeline, whose teardown destroys the read stream on a
// premature response close.
//
// server/main.ts binds fs through a namespace import, so a plain vi.spyOn on
// the test's own fs object never sees its calls; the capture has to wrap the
// module itself (pass-through mock, real behavior preserved).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface CapturedStream {
  path: unknown;
  stream: { destroyed: boolean; closed: boolean };
}

const { captured } = vi.hoisted(() => ({ captured: [] as CapturedStream[] }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      const stream = actual.createReadStream(...args);
      captured.push({ path: args[0], stream });
      return stream;
    },
  };
  return { ...wrapped, default: wrapped };
});

const packRoot = mkdtempSync(join(tmpdir(), 'woc-static-fd-'));
mkdirSync(join(packRoot, 'blobs'));
// Large enough that the response cannot fit in kernel/socket buffers, so the
// read stream is still mid-flight when the client aborts.
writeFileSync(join(packRoot, 'runtime-pack.json'), Buffer.alloc(16 * 1024 * 1024, 0x7b));

// DATABASE_URL needs no ceremony here: vite.config.ts test.env defaults it
// for every test file. Only the pack dir override is load-bearing.
const savedSfxPackDir = process.env.SFX_PACK_DIR;
process.env.SFX_PACK_DIR = packRoot;

let routeHttpRequest: typeof import('../../server/main').routeHttpRequest;

beforeAll(async () => {
  ({ routeHttpRequest } = await import('../../server/main'));
}, 30000);

afterAll(() => {
  rmSync(packRoot, { recursive: true, force: true });
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

const until = async (probe: () => boolean, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (probe()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return probe();
};

const packStream = (): CapturedStream | undefined =>
  captured.find((c) => String(c.path).includes('runtime-pack.json'));

describe('static file streams on client abort', () => {
  it('destroys the read stream when the client disconnects mid-transfer', async () => {
    const server = http.createServer((req, res) => routeHttpRequest(req, res));
    const port = await listen(server);
    try {
      // Raw socket so the abort is a hard TCP teardown, not a graceful end.
      const socket = net.connect(port, '127.0.0.1');
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      socket.write(
        'GET /audio/sfx/runtime-pack.json HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n',
      );
      // Take the first bytes so the stream is genuinely flowing, then abort.
      const first = await new Promise<Buffer>((resolve) => socket.once('data', resolve));
      expect(first.toString('utf8').split('\r\n')[0]).toBe('HTTP/1.1 200 OK');
      socket.destroy();

      expect(await until(() => packStream() !== undefined, 2000)).toBe(true);
      // The load-bearing assertion: an aborted response must tear the file
      // stream down (bare pipe() leaves it open and leaks the descriptor).
      // `closed` pins the descriptor actually being released: `destroyed`
      // alone would stay true even under a future { autoClose: false }.
      expect(await until(() => packStream()?.stream.destroyed === true, 3000)).toBe(true);
      // closed flips on the close event after the fd is actually released,
      // strictly later than destroyed: poll it too or a loaded CI worker can
      // read inside the gap (measured ~1-4% under drifted observation).
      expect(await until(() => packStream()?.stream.closed === true, 3000)).toBe(true);
    } finally {
      await close(server);
    }
  }, 15000);
});
