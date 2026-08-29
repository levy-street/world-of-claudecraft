// The extracted process-local ledger arithmetic
// (server/woc_market_local_ledgers.ts): a faithful move out of the service
// coordinator, so the direct pin is cheap and the semantics (stamp maps age
// on their stamp, park maps on their RETRY time) cannot drift silently.

import { describe, expect, it } from 'vitest';
import {
  pruneWocLocalLedgers,
  WOC_LOCAL_LEDGER_TTL_MS,
  WOC_LOCAL_PARK_MAX_ENTRIES,
  WOC_LOCAL_STAMP_HIGH_WATER,
  wocBackedOffIds,
  wocParkRefusalCount,
  wocParkRow,
} from '../../server/woc_market_local_ledgers';

describe('woc local ledgers', () => {
  it('backedOffIds returns exactly the ids whose retry is still in the future', () => {
    const parked = new Map<number, number>([
      [1, 900], // retry passed
      [2, 1_000], // retry AT now is not "in the future": eligible again
      [3, 1_001],
      [4, 5_000],
    ]);
    expect(wocBackedOffIds(parked, 1_000).sort()).toEqual([3, 4]);
    // Read-only: the walk never mutates the ledger.
    expect(parked.size).toBe(4);
  });

  it('prunes stamp maps on their stamp and park maps on their stale retry, each on the shared TTL', () => {
    const now = 10_000_000;
    const grants = new Map([
      ['old', { stampMs: now - WOC_LOCAL_LEDGER_TTL_MS - 1 }],
      ['live', { stampMs: now - 1_000 }],
    ]);
    const mail = new Map([['boundary', { stampMs: now - WOC_LOCAL_LEDGER_TTL_MS }]]);
    const park = new Map<number, number>([
      // A retry that has itself been stale for the horizon: dead weight.
      [1, now - WOC_LOCAL_LEDGER_TTL_MS - 1],
      // A merely PASSED retry stays: the row is due again, not abandoned.
      [2, now - 1_000],
      [3, now + 30_000],
    ]);
    pruneWocLocalLedgers(now, [grants, mail], [park]);
    expect([...grants.keys()]).toEqual(['live']);
    // The boundary stamp (exactly TTL old) prunes: the cutoff is inclusive.
    expect(mail.size).toBe(0);
    expect([...park.keys()].sort()).toEqual([2, 3]);
  });

  it('the shared TTL is the documented ten minutes', () => {
    expect(WOC_LOCAL_LEDGER_TTL_MS).toBe(600_000);
  });

  it('wocParkRow admits under the cap and refuses only NEW entries at it, counting refusals', () => {
    // The growth bound (the escrow write-path rider): a mass-park event may
    // fill the map to the cap and no further; a refused park costs the row
    // one batch slot next pass, never memory.
    const park = new Map<number, number>();
    const refusalsBefore = wocParkRefusalCount();
    expect(wocParkRow(park, 1, 100, 2)).toBe(true);
    // One BELOW the cap still admits (the boundary the cap must not
    // overshoot by an off-by-one).
    expect(wocParkRow(park, 2, 100, 2)).toBe(true);
    // AT the cap: a new id refuses and writes nothing.
    expect(wocParkRow(park, 3, 100, 2)).toBe(false);
    expect(park.has(3)).toBe(false);
    expect(park.size).toBe(2);
    // An EXISTING id re-parks at the cap: rotation must not die exactly when
    // the ledger is fullest.
    expect(wocParkRow(park, 1, 900, 2)).toBe(true);
    expect(park.get(1)).toBe(900);
    // A prune-freed slot admits again, and the one refusal above was
    // COUNTED (the readout's mass-park signal).
    park.delete(2);
    expect(wocParkRow(park, 3, 100, 2)).toBe(true);
    expect(wocParkRefusalCount()).toBe(refusalsBefore + 1);
  });

  it('the caps are the documented values, and backedOffIds inherits the park bound', () => {
    expect(WOC_LOCAL_PARK_MAX_ENTRIES).toBe(512);
    expect(WOC_LOCAL_STAMP_HIGH_WATER).toBe(512);
    // The default-cap arm (the call sites pass no cap): filling through
    // wocParkRow can never hand the batch reads an exclusion array past the
    // cap, which is what bounds the `id <> ALL($n)` SQL cost.
    const park = new Map<number, number>();
    for (let id = 0; id < WOC_LOCAL_PARK_MAX_ENTRIES + 50; id++) {
      wocParkRow(park, id, 1_000_000);
    }
    expect(park.size).toBe(WOC_LOCAL_PARK_MAX_ENTRIES);
    expect(wocBackedOffIds(park, 0).length).toBe(WOC_LOCAL_PARK_MAX_ENTRIES);
  });
});
