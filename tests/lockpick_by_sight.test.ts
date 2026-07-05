// Fairness regression: the lock must be winnable by a player who can ONLY see
// what the client sees (the fogged visibleCells, with ward-traps now revealed as
// kind 'trap') and avoids the visible traps. This is the test the earlier solvers
// could not provide: they read the hidden spec (full board incl. trap positions),
// so they never proved a HUMAN reading the board could win. Before traps were
// revealed, this test fails (the player cannot distinguish a trap from an open
// notch); after revealing them, a fog-limited planner clears every shipped preset.

import { describe, expect, it } from 'vitest';
import { LOCKPICK_TIER_PRESETS } from '../src/sim/content/delves/lockpick_tiers';
import {
  ACTION_DELTA,
  generateLock,
  type LockTierSpec,
  stepLock,
  visibleCells,
} from '../src/sim/lockpick';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 2654435761);

/** A careful player using ONLY the fogged board (visibleCells), avoiding any notch
 * painted as a trap. At each pin it plans within the visible window, picking the
 * move that keeps the most safe options open at the fog edge, then replans. Returns
 * true if it threads all the way to the bolt seat without ever touching a trap. */
function winsBySight(spec: ReturnType<typeof generateLock>): boolean {
  const tier = spec.tier;
  const W = tier.cols;
  const window = tier.visibilityWindow;
  const allowed = tier.allowedActions;
  let col = 0;
  let row = spec.startRow;
  let guard = 0;
  while (col < W - 1 && guard++ < W * 3) {
    const view = visibleCells(spec, col, window); // exactly what the client renders
    const safeAt = (c: number, r: number): boolean =>
      view.some((x) => x.col === c && x.row === r && x.kind !== 'trap');
    const horizon = Math.min(W - 1, col + window);
    // Reachability layers over safe (non-trap) cells from here to the fog edge,
    // tagging each reachable cell with the FIRST delta taken out of the current pin.
    let layer = new Map<number, number | null>([[row, null]]);
    let reached = col;
    for (let cc = col; cc < horizon; cc++) {
      const next = new Map<number, number | null>();
      for (const [r, firstDelta] of layer) {
        for (const a of allowed) {
          const nr = r + ACTION_DELTA[a];
          if (safeAt(cc + 1, nr) && !next.has(nr)) {
            next.set(nr, cc === col ? ACTION_DELTA[a] : firstDelta);
          }
        }
      }
      if (next.size === 0) break;
      layer = next;
      reached = cc + 1;
    }
    if (reached === col) return false; // no safe move at all -> genuinely stuck
    // Among first moves that reach the farthest safe column, prefer the one that
    // keeps the most options open (avoids walking into a soon-to-strand corridor).
    const optionsByFirstDelta = new Map<number, number>();
    for (const firstDelta of layer.values()) {
      if (firstDelta == null) continue;
      optionsByFirstDelta.set(firstDelta, (optionsByFirstDelta.get(firstDelta) ?? 0) + 1);
    }
    let bestDelta: number | null = null;
    let best = -1;
    for (const [d, n] of optionsByFirstDelta)
      if (n > best) {
        best = n;
        bestDelta = d;
      }
    if (bestDelta == null) return false;
    const action = allowed.find((a) => ACTION_DELTA[a] === bestDelta)!;
    const st = stepLock(spec, col, row, action);
    if (st.result !== 'advanced' && st.result !== 'success') return false;
    col = st.col;
    row = st.row;
  }
  return col === W - 1;
}

describe('lock is solvable by sight (fogged board, traps revealed)', () => {
  for (const [name, tier] of Object.entries(LOCKPICK_TIER_PRESETS) as [string, LockTierSpec][]) {
    it(`${name} preset: a fog-limited player avoiding visible traps clears every seed`, () => {
      let won = 0;
      const failed: number[] = [];
      for (const seed of SEEDS) {
        const spec = generateLock(seed, tier);
        if (winsBySight(spec)) won++;
        else failed.push(seed);
      }
      expect(
        failed,
        `${failed.length} seeds unwinnable by sight: ${failed.slice(0, 5).join(', ')}`,
      ).toEqual([]);
      expect(won).toBe(SEEDS.length);
    });
  }
});
