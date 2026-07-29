import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createParseCounters } from '../server/parse/counters';
import { BatchShipper, PARSE_SECRET_HEADER } from '../server/parse/shipper';
import { BatchSpool } from '../server/parse/spool';

function tempSpoolDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'parse-spool-'));
}

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
  redirect: string | undefined;
}

function fakeFetch(responses: (number | Error)[]): { calls: FetchCall[]; fetch: typeof fetch } {
  const calls: FetchCall[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const next = responses.length > 1 ? responses.shift() : responses[0];
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as Uint8Array,
      redirect: init?.redirect,
    });
    if (next instanceof Error) throw next;
    return { ok: (next ?? 200) < 400, status: next ?? 200 } as Response;
  }) as typeof fetch;
  return { calls, fetch: impl };
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !until(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function batchLines(body: Uint8Array): Record<string, unknown>[] {
  return gunzipSync(Buffer.from(body))
    .toString('utf8')
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const IDENTITY = { realm: 'Claudemoon', env: 'qa' as const, build: '0.35.0' };

afterEach(() => {
  vi.useRealTimers();
});

describe('BatchShipper', () => {
  test('the wire header name is the literal the service matches', () => {
    expect(PARSE_SECRET_HEADER).toBe('x-woc-parse-secret');
  });

  test('flush ships one gzip NDJSON batch: header line first, secret and encoding set', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(
      IDENTITY,
      'http://svc/ingest/v1/batch',
      's3cret',
      spool,
      counters,
      fetch,
    );

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 5, ev: { type: 'damage' } });
    shipper.enqueue({ t: 'fight_close', fightId: 'f1', tick: 6 });
    await shipper.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://svc/ingest/v1/batch');
    expect(calls[0]?.headers[PARSE_SECRET_HEADER]).toBe('s3cret');
    expect(calls[0]?.headers['content-type']).toBe('application/x-ndjson');
    expect(calls[0]?.headers['content-encoding']).toBe('gzip');
    // A followed cross-origin redirect would forward the secret header, so
    // the shipper must refuse redirects outright.
    expect(calls[0]?.redirect).toBe('error');
    const lines = batchLines(calls[0]?.body as Uint8Array);
    expect(lines[0]).toMatchObject({
      t: 'batch',
      v: 1,
      realm: 'Claudemoon',
      env: 'qa',
      build: '0.35.0',
    });
    expect(lines[1]).toMatchObject({ t: 'ev', fightId: 'f1' });
    expect(lines[2]).toMatchObject({ t: 'fight_close' });
    expect(counters.batchesShipped).toBe(1);
  });

  test('with no configured token, the secret header is omitted entirely', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    await shipper.flush();

    expect(PARSE_SECRET_HEADER in (calls[0]?.headers ?? {})).toBe(false);
  });

  test('a failed ship falls to the spool and replays after a later success', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([new Error('down'), 200, 200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    await shipper.flush();

    expect(counters.batchesShipFailed).toBe(1);
    expect(counters.batchesSpooled).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 2, ev: {} });
    await shipper.flush();

    // The new batch shipped, then the spooled one replayed and was removed.
    expect(counters.batchesShipped).toBe(2);
    expect(counters.batchesReplayed).toBe(1);
    expect(readdirSync(dir)).toHaveLength(0);
    const replayed = batchLines(calls[2]?.body as Uint8Array);
    expect(replayed[1]).toMatchObject({ tick: 1 });
  });

  test('an HTTP error response spools exactly like a thrown fetch', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 1024 * 1024, counters);
    const { fetch } = fakeFetch([500]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    await shipper.flush();

    expect(counters.batchesShipFailed).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test('batch ids are unique and carry the boot prefix', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    await shipper.flush();
    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 2, ev: {} });
    await shipper.flush();

    const idA = String(batchLines(calls[0]?.body as Uint8Array)[0]?.batchId);
    const idB = String(batchLines(calls[1]?.body as Uint8Array)[0]?.batchId);
    expect(idA).toMatch(/^[A-Za-z0-9_-]{8}-0$/);
    expect(idB).toMatch(/^[A-Za-z0-9_-]{8}-1$/);
    expect(idA).not.toBe(idB);
  });

  test('the 2 second timer flushes without any manual flush call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    await settle(() => calls.length === 1);

    expect(calls).toHaveLength(1);
  });

  test('the 500-record threshold flushes early with no timer involved', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    for (let i = 0; i < 500; i++) shipper.enqueue({ t: 'ev', fightId: 'f1', tick: i, ev: {} });
    await settle(() => calls.length >= 1);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const lines = batchLines(calls[0]?.body as Uint8Array);
    expect(lines).toHaveLength(501);
  });

  test('past the buffer cap the oldest record sheds with a counter', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    // A fetch that never resolves wedges the first flush cycle open.
    const hanging = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, hanging);

    for (let i = 0; i < 50_501; i++) {
      shipper.enqueue({ t: 'ev', fightId: 'f1', tick: i, ev: {} });
    }

    expect(counters.recordsDroppedOverflow).toBeGreaterThanOrEqual(1);
    expect(counters.recordsBuffered).toBeLessThanOrEqual(50_000);
  });

  test('enqueue after stop() is dropped', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    await shipper.stop();
    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    await shipper.flush();

    expect(calls).toHaveLength(0);
  });

  test('stop awaits the in-flight cycle then drains, spooling when the service is down', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 1024 * 1024, counters);
    const { fetch } = fakeFetch([new Error('down')]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    // Enqueue 1500: the 500th enqueue starts an in-flight cycle that splices
    // 500 records (spool file 1); stop() must AWAIT it, then drain the
    // remaining 1000 as one marshal-capped batch (spool file 2).
    for (let i = 0; i < 1500; i++) shipper.enqueue({ t: 'ev', fightId: 'f1', tick: i, ev: {} });
    await shipper.stop();

    expect(readdirSync(dir)).toHaveLength(2);
    expect(counters.recordsBuffered).toBe(0);
  });

  test('past the stop deadline, remaining batches spool without ship attempts', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([new Error('down')]);
    // A clock already past any deadline: stop() must not try the network.
    let clock = 0;
    const shipper = new BatchShipper(
      IDENTITY,
      'http://svc/ingest',
      null,
      spool,
      counters,
      fetch,
      () => {
        clock += 10_000;
        return clock;
      },
    );

    for (let i = 0; i < 100; i++) shipper.enqueue({ t: 'ev', fightId: 'f1', tick: i, ev: {} });
    await shipper.stop();

    expect(calls).toHaveLength(0);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(counters.recordsBuffered).toBe(0);
  });
});

describe('BatchSpool', () => {
  test('evicts oldest batches past the byte cap and counts the drop', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 300, counters);

    await spool.append(Buffer.alloc(150, 1));
    await spool.append(Buffer.alloc(150, 2));
    await spool.append(Buffer.alloc(150, 3));

    expect(counters.batchesSpoolDropped).toBeGreaterThanOrEqual(1);
    expect(counters.spoolBytes).toBeLessThanOrEqual(300);
    const oldest = await spool.peekOldest();
    expect(oldest?.data[0]).toBe(2);
  });

  test('remove deletes a batch and keeps byte accounting sane', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 10_000, counters);

    await spool.append(Buffer.alloc(100));
    const oldest = await spool.peekOldest();
    expect(oldest).not.toBeNull();
    if (oldest === null) return;
    await spool.remove(oldest.name);

    expect(counters.spoolBytes).toBe(0);
    expect(await spool.peekOldest()).toBeNull();
  });

  test('foreign files in the spool dir are ignored, and appends never throw on a bad dir', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 10_000, counters);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(dir, 'README.txt'), 'not a batch');

    await spool.append(Buffer.alloc(10, 7));
    const oldest = await spool.peekOldest();
    expect(oldest?.data[0]).toBe(7);

    const broken = new BatchSpool('/dev/null/not-a-dir', 10_000, createParseCounters());
    await expect(broken.append(Buffer.alloc(4))).resolves.toBeUndefined();
    expect(await broken.peekOldest()).toBeNull();
  });
});

describe('BatchSpool review pins', () => {
  test('a failed unlink never moves byte accounting, so the cap keeps bounding disk', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 10_000, counters);
    await spool.append(Buffer.alloc(100, 1));
    const before = counters.spoolBytes;
    const oldest = await spool.peekOldest();
    expect(oldest).not.toBeNull();
    if (oldest === null) return;

    const { chmodSync } = await import('node:fs');
    chmodSync(dir, 0o555);
    try {
      await spool.remove(oldest.name);
      expect(counters.spoolBytes).toBe(before);
    } finally {
      chmodSync(dir, 0o755);
    }
    // Once the dir is writable again, the same remove succeeds and accounts.
    await spool.remove(oldest.name);
    expect(counters.spoolBytes).toBe(0);
  });
});
