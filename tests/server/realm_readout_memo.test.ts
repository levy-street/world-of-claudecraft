import { describe, expect, it } from 'vitest';
import {
  createRealmReadoutMemo,
  realmReadoutJson,
  realmReadoutObject,
} from '../../server/realm_readout_memo';
import type { VcSharedCupInfo } from '../../src/world_api/vale_cup';

// A plain VcSharedCupInfo-shaped literal built locally: the memo is payload-agnostic,
// so the test never imports cupSharedInfoFor. Slot 3 of queueSizes carries the value
// we mutate between ticks to prove a stale-tick string is never served.
const sample = (): VcSharedCupInfo => ({
  queueSizes: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 },
  live: null,
  board: [{ name: 'A', wins: 3 }],
  guildBoard: [],
  practicing: ['B'],
});

describe('realm readout per-pass memo', () => {
  it('starts fully zeroed', () => {
    expect(createRealmReadoutMemo()).toEqual({
      tick: -1,
      shared: null,
      json: null,
      objectBuilds: 0,
      stringifies: 0,
    });
  });

  it('builds and stringifies the shared readout at most once per tick', () => {
    const memo = createRealmReadoutMemo<VcSharedCupInfo>();
    // Injected spy build thunk: real builds bump `builds`; the tick-6 build returns a
    // different queueSizes so case 5 can prove the tick-6 string reflects the tick-6 object.
    let builds = 0;
    const build = (): VcSharedCupInfo => {
      builds++;
      return builds === 1
        ? sample()
        : { ...sample(), queueSizes: { 1: 0, 2: 0, 3: 9, 4: 0, 5: 0 } };
    };

    // Case 2: first object read at tick 5 builds exactly once and returns the payload.
    const obj5 = realmReadoutObject(memo, 5, build);
    expect(obj5).toEqual(sample());
    expect(memo.objectBuilds).toBe(1);
    expect(builds).toBe(1);

    // Case 3: first JSON read at tick 5 stringifies exactly once; a repeat does not.
    const json5 = realmReadoutJson(memo, 5, build);
    expect(memo.stringifies).toBe(1);
    expect(JSON.parse(json5)).toEqual(obj5);
    realmReadoutJson(memo, 5, build);
    expect(memo.stringifies).toBe(1);

    // Case 4: repeated object/JSON reads at the SAME tick 5 recompute NEITHER. Dropping
    // the short-circuit entirely (always rebuild) reds this case: every repeated call
    // would rebuild (objectBuilds/builds would climb past 1). NOTE the narrower mutation
    // of dropping ONLY the `memo.tick !== tick` operand (leaving `memo.shared === null`)
    // does NOT red here, because memo.shared is already set; that mutation is caught by
    // case 5 instead (a new tick would never rebuild).
    realmReadoutObject(memo, 5, build);
    realmReadoutObject(memo, 5, build);
    realmReadoutJson(memo, 5, build);
    expect(memo.objectBuilds).toBe(1);
    expect(memo.stringifies).toBe(1);
    expect(builds).toBe(1);

    // Case 5: a different tick 6 rebuilds the object and restringifies. Dropping the
    // `memo.tick !== tick` operand reds THIS case (a new tick would never rebuild, so
    // objectBuilds would stay 1 instead of reaching 2). The tick-6 build returns
    // queueSizes slot 3 === 9; JSON.parse of the tick-6 string must show 9, proving the
    // rebuild invalidated the cached JSON and a stale-tick string is never served.
    const obj6 = realmReadoutObject(memo, 6, build);
    expect(memo.objectBuilds).toBe(2);
    expect(obj6.queueSizes[3]).toBe(9);
    const json6 = realmReadoutJson(memo, 6, build);
    expect(memo.stringifies).toBe(2);
    expect(JSON.parse(json6).queueSizes[3]).toBe(9);
  });

  it('serves two tenants of distinct types with independent tick keys and counters', () => {
    // The memo is generic over its payload: one GameServer holds one instance per
    // realm-wide fragment (the Vale Cup readout, the dungeon-finder board), and
    // the instances never share a tick key or a counter. A board-shaped array
    // tenant stands in for the second payload type here; the memo never inspects it.
    const cup = createRealmReadoutMemo<VcSharedCupInfo>();
    const board = createRealmReadoutMemo<{ id: number }[]>();

    const cupJson5 = realmReadoutJson(cup, 5, sample);
    expect(cup.objectBuilds).toBe(1);
    expect(cup.stringifies).toBe(1);
    // building one tenant leaves the other untouched (no shared state)
    expect(board.objectBuilds).toBe(0);
    expect(board.stringifies).toBe(0);
    expect(board.tick).toBe(-1);

    const boardJson5 = realmReadoutJson(board, 5, () => [{ id: 7 }]);
    expect(boardJson5).toBe('[{"id":7}]');
    expect(board.objectBuilds).toBe(1);
    expect(board.stringifies).toBe(1);
    expect(cup.objectBuilds).toBe(1); // and vice versa

    // independent tick keys: advancing ONE tenant to tick 6 rebuilds only it;
    // the other still serves its tick-5 value from cache on a same-tick re-read
    realmReadoutJson(cup, 6, sample);
    expect(cup.tick).toBe(6);
    expect(cup.objectBuilds).toBe(2);
    expect(board.tick).toBe(5);
    expect(realmReadoutJson(board, 5, () => [{ id: 99 }])).toBe(boardJson5);
    expect(board.objectBuilds).toBe(1);
    expect(JSON.parse(cupJson5).queueSizes[3]).toBe(1); // tick-5 cup string was real payload
  });
});
