import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
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
}

function fakeFetch(responses: (number | Error)[]): { calls: FetchCall[]; fetch: typeof fetch } {
  const calls: FetchCall[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const next = responses.length > 1 ? responses.shift() : responses[0];
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as Uint8Array,
    });
    if (next instanceof Error) throw next;
    return { ok: (next ?? 200) < 400, status: next ?? 200 } as Response;
  }) as typeof fetch;
  return { calls, fetch: impl };
}

function batchLines(body: Uint8Array): Record<string, unknown>[] {
  return gunzipSync(Buffer.from(body))
    .toString('utf8')
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const IDENTITY = { realm: 'Claudemoon', env: 'qa' as const, build: '0.35.0' };

describe('BatchShipper', () => {
  test('flush ships one gzip NDJSON batch with the header line first', async () => {
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
    expect(calls[0]?.headers[PARSE_SECRET_HEADER]).toBe('s3cret');
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

  test('batch ids are unique across batches', async () => {
    const counters = createParseCounters();
    const spool = new BatchSpool(tempSpoolDir(), 1024 * 1024, counters);
    const { calls, fetch } = fakeFetch([200]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 1, ev: {} });
    await shipper.flush();
    shipper.enqueue({ t: 'ev', fightId: 'f1', tick: 2, ev: {} });
    await shipper.flush();

    const idA = batchLines(calls[0]?.body as Uint8Array)[0]?.batchId;
    const idB = batchLines(calls[1]?.body as Uint8Array)[0]?.batchId;
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  test('stop drains the whole buffer, spooling when the service is down', async () => {
    const counters = createParseCounters();
    const dir = tempSpoolDir();
    const spool = new BatchSpool(dir, 1024 * 1024, counters);
    const { fetch } = fakeFetch([new Error('down')]);
    const shipper = new BatchShipper(IDENTITY, 'http://svc/ingest', null, spool, counters, fetch);

    for (let i = 0; i < 1500; i++) shipper.enqueue({ t: 'ev', fightId: 'f1', tick: i, ev: {} });
    await shipper.stop();

    // 1500 records at the 1000-record marshal cap = 2 spooled batches.
    expect(readdirSync(dir)).toHaveLength(2);
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
});
