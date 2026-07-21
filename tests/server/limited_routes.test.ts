// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL is
// unset; the transitive imports here reach it, so set a dummy URL. The pool never
// connects: the handler touches only the injected fake runtime.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_limited_units';

import type * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildLimitedMintsResponse,
  configureLimitedRuntime,
  resetLimitedMintsCache,
  routes,
} from '../../server/limited_routes';
import type { LimitedMintsSnapshot } from '../../server/limited_supply_db';
import { resetPublicReadRateLimits } from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

function captured(res: http.ServerResponse): { status: number; body: any } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

function handler() {
  const route = routes.find((r) => r.path === '/api/limited-mints');
  if (!route) throw new Error('no /api/limited-mints route');
  return route.handler;
}

afterEach(() => {
  resetLimitedMintsCache();
  resetPublicReadRateLimits();
});

describe('buildLimitedMintsResponse', () => {
  it('enriches each supply row with the item name/quality and computes remaining', () => {
    const snapshot: LimitedMintsSnapshot = {
      supplies: [{ itemId: 'emberfall_edge', supply: 25, minted: 2, leased: 1 }],
      mints: [
        { itemId: 'emberfall_edge', serial: 2, mintedByName: 'Bru', realm: 'r1', mintedAt: 'b' },
        { itemId: 'emberfall_edge', serial: 1, mintedByName: 'Ada', realm: 'r1', mintedAt: 'a' },
      ],
    };
    const { items } = buildLimitedMintsResponse(snapshot);
    expect(items).toHaveLength(1);
    const row = items[0];
    expect(row.itemId).toBe('emberfall_edge');
    expect(row.name).toBe('Emberfall Edge'); // from the content catalog
    expect(row.quality).toBe('legendary');
    expect(row.supply).toBe(25);
    expect(row.minted).toBe(2);
    // remaining = supply - minted - leased (leases are in-flight, will likely mint)
    expect(row.remaining).toBe(22);
    // mints are sorted by serial ascending
    expect(row.mints.map((m) => m.serial)).toEqual([1, 2]);
    expect(row.mints[0].mintedBy).toBe('Ada');
  });

  // The public field is `mintedBy`, never `characterName`/`owner`/`holder`. This
  // endpoint is anonymous and unauthenticated, and the ledger is frozen at mint
  // time, so an external consumer must not be handed a name that reads as the
  // current owner. Pinned to literals: a rename back to an ownership-implying
  // field is a breaking API change and has to fail here first.
  it('names the winner field mintedBy and exposes no current-owner field', () => {
    const snapshot: LimitedMintsSnapshot = {
      supplies: [{ itemId: 'emberfall_edge', supply: 25, minted: 1, leased: 0 }],
      mints: [
        { itemId: 'emberfall_edge', serial: 1, mintedByName: 'Ada', realm: 'r1', mintedAt: 'a' },
      ],
    };
    const mint = buildLimitedMintsResponse(snapshot).items[0].mints[0];
    expect(Object.keys(mint).sort()).toEqual(['mintedAt', 'mintedBy', 'realm', 'serial']);
    expect(mint.mintedBy).toBe('Ada');
    for (const forbidden of ['characterName', 'owner', 'ownerName', 'holder', 'currentOwner'])
      expect(mint).not.toHaveProperty(forbidden);
  });

  it('carries a null winner through as null rather than inventing a name', () => {
    const snapshot: LimitedMintsSnapshot = {
      supplies: [{ itemId: 'emberfall_edge', supply: 25, minted: 1, leased: 0 }],
      mints: [
        { itemId: 'emberfall_edge', serial: 1, mintedByName: null, realm: 'r1', mintedAt: 'a' },
      ],
    };
    expect(buildLimitedMintsResponse(snapshot).items[0].mints[0].mintedBy).toBeNull();
  });

  it('never reports negative remaining and falls back to the id for an unknown item', () => {
    const snapshot: LimitedMintsSnapshot = {
      supplies: [{ itemId: 'ghost_item', supply: 3, minted: 2, leased: 5 }],
      mints: [],
    };
    const { items } = buildLimitedMintsResponse(snapshot);
    expect(items[0].name).toBe('ghost_item'); // no catalog entry -> id
    expect(items[0].remaining).toBe(0); // clamped, never negative
  });
});

describe('GET /api/limited-mints handler', () => {
  const snapshot: LimitedMintsSnapshot = {
    supplies: [{ itemId: 'crown_of_the_thornpeak_scourge', supply: 100, minted: 0, leased: 0 }],
    mints: [],
  };

  it('serves the enriched ledger and caches within the TTL', async () => {
    let reads = 0;
    let clock = 1_000;
    configureLimitedRuntime({
      readMints: async () => {
        reads++;
        return snapshot;
      },
      now: () => clock,
    });
    const run = async () => {
      const ctx = fakeCtx({ req: makeReq({ url: '/api/limited-mints' }) });
      await handler()(ctx);
      return captured(ctx.res);
    };
    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body.items[0].itemId).toBe('crown_of_the_thornpeak_scourge');
    expect(reads).toBe(1);
    // A second call inside the 30 s TTL is served from cache (no new read).
    clock += 5_000;
    await run();
    expect(reads).toBe(1);
    // Past the TTL, the ledger is read again.
    clock += 30_000;
    await run();
    expect(reads).toBe(2);
  });

  it('rate-limits with a 429 when the per-IP public-read budget is spent', async () => {
    configureLimitedRuntime({ readMints: async () => snapshot, now: () => 1_000 });
    let last: { status: number; body: any } = { status: 0, body: undefined };
    // The public-read limiter allows a bounded burst per IP; hammer well past it.
    for (let i = 0; i < 200; i++) {
      const ctx = fakeCtx({ req: makeReq({ url: '/api/limited-mints' }) });
      await handler()(ctx);
      last = captured(ctx.res);
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('rate_limited');
  });
});
