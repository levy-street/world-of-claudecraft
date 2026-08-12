import { describe, expect, it } from 'vitest';
import {
  orderTabTargets,
  stepTabTarget,
  type TabCandidate,
  type TabOrder,
} from '../src/sim/tab_target';

// Player faces +Z (facing 0): forward is (sin 0, cos 0) = (0, 1).
const FACING_NORTH = 0;

describe('orderTabTargets', () => {
  it('cycles an on-screen enemy before a closer one behind the player', () => {
    // Behind the player (-Z) but very close; in front (+Z) but farther.
    const behind: TabCandidate = { id: 1, dx: 0, dz: -5, d: 5, engaged: false };
    const front: TabCandidate = { id: 2, dx: 0, dz: 30, d: 30, engaged: false };
    const order = orderTabTargets([behind, front], FACING_NORTH);
    // The on-screen enemy leads even though it is farther away.
    expect(order.ids[0]).toBe(2);
    // The off-screen one stays reachable, just last. Only the on-screen enemy is
    // part of the cluster; the unseen one behind is the fallback band.
    expect(order.ids).toEqual([2, 1]);
    expect(order.primaryCount).toBe(1);
  });

  it('drops an idle enemy off to the side out of the cluster even when very close', () => {
    // Directly to the player's right (+X), idle, well within the near radius but
    // outside the front cone: the player cannot see it, so Tab must not grab it.
    const side: TabCandidate = { id: 1, dx: 10, dz: 0, d: 10, engaged: false };
    const front: TabCandidate = { id: 2, dx: 0, dz: 18, d: 18, engaged: false };
    const order = orderTabTargets([side, front], FACING_NORTH);
    // Only the visible front enemy is the cluster; the unseen side one falls back.
    expect(order.ids).toEqual([2, 1]);
    expect(order.primaryCount).toBe(1);
  });

  it('prioritizes an enemy in combat with the player over an idle on-screen one', () => {
    const engagedFar: TabCandidate = { id: 1, dx: 2, dz: 30, d: 30, engaged: true };
    const idleNear: TabCandidate = { id: 2, dx: 0, dz: 5, d: 5, engaged: false };
    const order = orderTabTargets([engagedFar, idleNear], FACING_NORTH);
    // Both are on screen, so the engaged one wins (tier 0 vs 1).
    expect(order.ids).toEqual([1, 2]);
  });

  it('orders on-screen enemies nearest first', () => {
    const far: TabCandidate = { id: 1, dx: 0, dz: 30, d: 30, engaged: false };
    const near: TabCandidate = { id: 2, dx: 0, dz: 8, d: 8, engaged: false };
    const mid: TabCandidate = { id: 3, dx: 0, dz: 15, d: 15, engaged: false };
    expect(orderTabTargets([far, near, mid], FACING_NORTH).ids).toEqual([2, 3, 1]);
  });

  it('keeps an engaged enemy behind the player out of the cluster but reachable', () => {
    const engagedBehind: TabCandidate = { id: 1, dx: 0, dz: -10, d: 10, engaged: true };
    const idleFront: TabCandidate = { id: 2, dx: 0, dz: 20, d: 20, engaged: false };
    const order = orderTabTargets([engagedBehind, idleFront], FACING_NORTH);
    // Visibility gates the cluster: even though it is engaged, the mob behind the
    // player is off screen, so only the visible front idle one is the cluster.
    // The engaged-behind one stays reachable as fallback (tier 2, after tier 1).
    expect(order.ids).toEqual([2, 1]);
    expect(order.primaryCount).toBe(1);
  });

  it('is deterministic and stable for ties', () => {
    const a: TabCandidate = { id: 7, dx: 0, dz: 10, d: 10, engaged: false };
    const b: TabCandidate = { id: 3, dx: 1, dz: 10, d: 10, engaged: false };
    const run = () => orderTabTargets([a, b], FACING_NORTH).ids;
    // Same tier and distance: lower id breaks the tie, and repeat runs match.
    expect(run()).toEqual([3, 7]);
    expect(run()).toEqual(run());
  });

  it('drops a distant idle enemy out of the cluster into the fallback band', () => {
    // Two on-screen idle mobs: one in the fight cluster, one two screens away.
    const near: TabCandidate = { id: 1, dx: 0, dz: 10, d: 10, engaged: false };
    const far: TabCandidate = { id: 2, dx: 0, dz: 38, d: 38, engaged: false };
    const order = orderTabTargets([near, far], FACING_NORTH);
    // The far mob is last and only the near one counts as the cluster, so Tab
    // wraps on the near mob instead of stepping out to the far one.
    expect(order.ids).toEqual([1, 2]);
    expect(order.primaryCount).toBe(1);
  });

  it('flares with distance: the same screen angle is out close but in far away', () => {
    // Both enemies sit at ~50 degrees off forward (facing north, so cos = dz/d).
    // The cone half-angle is ~48 deg at 6 yd (excludes them) but ~59 deg at 28 yd
    // (includes them), so the near one falls back while the far one is cluster.
    const COS50 = Math.cos((50 * Math.PI) / 180);
    const SIN50 = Math.sin((50 * Math.PI) / 180);
    const near: TabCandidate = { id: 1, dx: SIN50 * 6, dz: COS50 * 6, d: 6, engaged: false };
    const far: TabCandidate = { id: 2, dx: SIN50 * 28, dz: COS50 * 28, d: 28, engaged: false };
    const order = orderTabTargets([near, far], FACING_NORTH);
    expect(order.ids).toEqual([2, 1]);
    expect(order.primaryCount).toBe(1);
  });

  it('keeps a distant enemy engaged with the player inside the cluster', () => {
    // A far mob that is fighting the player stays part of the cluster even past
    // the near radius; a far idle mob does not.
    const engagedFar: TabCandidate = { id: 1, dx: 0, dz: 37, d: 37, engaged: true };
    const idleFar: TabCandidate = { id: 2, dx: 2, dz: 37, d: 37, engaged: false };
    const order = orderTabTargets([engagedFar, idleFar], FACING_NORTH);
    expect(order.ids).toEqual([1, 2]);
    expect(order.primaryCount).toBe(1);
  });
});

// Tab (+1) and Shift+Tab (-1) share one index step so the two binds are exact
// mirrors. These pin the forward arm at its pre-existing behavior AND the
// backward arm as its inverse.
describe('stepTabTarget', () => {
  const order = (ids: number[], primaryCount: number): TabOrder => ({ ids, primaryCount });

  it('grabs the priority enemy in both directions when nothing is targeted', () => {
    const o = order([7, 8, 9], 3);
    expect(stepTabTarget(o, -1, 1)).toBe(7);
    expect(stepTabTarget(o, -1, -1)).toBe(7);
  });

  it('walks the near cluster forward and wraps at its end', () => {
    const o = order([7, 8, 9], 3);
    expect(stepTabTarget(o, 0, 1)).toBe(8);
    expect(stepTabTarget(o, 1, 1)).toBe(9);
    expect(stepTabTarget(o, 2, 1)).toBe(7);
  });

  it('walks the near cluster backward and wraps at its start', () => {
    const o = order([7, 8, 9], 3);
    expect(stepTabTarget(o, 2, -1)).toBe(8);
    expect(stepTabTarget(o, 1, -1)).toBe(7);
    expect(stepTabTarget(o, 0, -1)).toBe(9);
  });

  it('stays inside the cluster in both directions while a fallback band exists', () => {
    // ids 7,8 are the cluster; 9 is the distant fallback. Neither direction may
    // step out to it from inside the cluster.
    const o = order([7, 8, 9], 2);
    expect(stepTabTarget(o, 1, 1)).toBe(7);
    expect(stepTabTarget(o, 0, -1)).toBe(8);
  });

  it('walks the fallback band forward, then wraps back into the cluster', () => {
    const o = order([7, 8, 9], 1);
    expect(stepTabTarget(o, 1, 1)).toBe(9);
    expect(stepTabTarget(o, 2, 1)).toBe(7);
  });

  it('walks the fallback band backward, re-entering the cluster at its last id', () => {
    const o = order([7, 8, 9], 2);
    expect(stepTabTarget(o, 2, -1)).toBe(8);
  });

  it('wraps backward to the very last id when the cluster is empty', () => {
    const o = order([7, 8, 9], 0);
    expect(stepTabTarget(o, 0, -1)).toBe(9);
    expect(stepTabTarget(o, 2, 1)).toBe(7);
  });

  it('is its own inverse across the whole cluster: forward n then back n returns', () => {
    const o = order([7, 8, 9, 10], 4);
    for (let start = 0; start < o.ids.length; start++) {
      let idx = start;
      for (let n = 0; n < 3; n++) idx = o.ids.indexOf(stepTabTarget(o, idx, 1));
      for (let n = 0; n < 3; n++) idx = o.ids.indexOf(stepTabTarget(o, idx, -1));
      expect(idx).toBe(start);
    }
  });

  it('handles a single candidate by staying on it in either direction', () => {
    const o = order([7], 1);
    expect(stepTabTarget(o, 0, 1)).toBe(7);
    expect(stepTabTarget(o, 0, -1)).toBe(7);
  });

  // The documented EXCEPTION to the inverse property, pinned so a future
  // "symmetry fix" reds here on purpose instead of silently changing what Tab
  // selects. Forward off the last fallback wraps to the cluster HEAD, backward
  // off the cluster head wraps to the cluster TAIL, so the round trip does not
  // return. That is deliberate: making it return would mean backward stepping
  // OUT of the cluster into a distant idle enemy, which is exactly what the
  // cluster design forbids.
  it('is deliberately NOT an inverse across the cluster/fallback wrap', () => {
    const o = order([7, 8, 9], 2); // 7,8 = cluster; 9 = distant fallback
    // Forward off the fallback lands on the cluster head, not back in the band.
    expect(stepTabTarget(o, 2, 1)).toBe(7);
    // Backward off that head wraps within the cluster instead of returning to 9.
    expect(stepTabTarget(o, 0, -1)).toBe(8);
    expect(stepTabTarget(o, 0, -1)).not.toBe(9);
  });
});
