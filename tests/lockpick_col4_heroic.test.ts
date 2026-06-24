// Investigate "always fails at pin 4" on Bountiful/heroic locks.
import { describe, expect, it } from 'vitest';
import { LOCKPICK_TIER_PRESETS } from '../src/sim/content/delves/lockpick_tiers';
import {
  ACTION_DELTA,
  ANTE_TO_STEP_TIMEOUT_MS,
  generateLock,
  generateLockPages,
  type LockSpec,
  solveLockActions,
  solveLockPath,
  stepLock,
  visibleCells,
} from '../src/sim/lockpick';
import { lockpickBoardModel } from '../src/ui/lockpick_panel';
import type { LockpickView } from '../src/world_api';

const heroic = LOCKPICK_TIER_PRESETS.heroic;
const SEEDS = Array.from({ length: 500 }, (_, i) => (i * 2654435761) >>> 0);

function viewAt(spec: LockSpec, col: number, row: number): LockpickView {
  return {
    sessionId: 's1',
    objectId: 1,
    w: spec.tier.cols,
    h: spec.tier.rows,
    col,
    row,
    page: 1,
    pageCount: 3,
    tries: 1,
    triesTotal: 1,
    lootTier: 'premium',
    allowed: spec.tier.allowedActions,
    visible: visibleCells(spec, col, spec.tier.visibilityWindow),
    stepTimeoutMs: ANTE_TO_STEP_TIMEOUT_MS[1], // premium ante board
  };
}

describe('heroic (Bountiful) lock, column 4 step', () => {
  it('flawless solver clears first 5 columns (through col 4) on every seed', () => {
    for (const seed of SEEDS) {
      const spec = generateLock(seed, heroic);
      const actions = solveLockActions(spec)!;
      expect(actions.length).toBe(heroic.cols - 1);
      let col = 0;
      let row = spec.startRow;
      for (let step = 0; step < 4; step++) {
        const st = stepLock(spec, col, row, actions[step]);
        expect(['advanced', 'success']).toContain(st.result);
        col = st.col;
        row = st.row;
      }
      expect(col).toBe(4);
    }
  });

  it('step 4 (col 3 -> 4) is never a gate miss when following solver', () => {
    const stats = { gate: 0, trap: 0, slip: 0, bind: 0, advanced: 0 };
    for (const seed of SEEDS) {
      const spec = generateLock(seed, heroic);
      const actions = solveLockActions(spec)!;
      let col = 0;
      let row = spec.startRow;
      for (let step = 0; step < 3; step++) {
        const st = stepLock(spec, col, row, actions[step]);
        col = st.col;
        row = st.row;
      }
      // 4th player move: from col 3 to col 4
      const st = stepLock(spec, col, row, actions[3]);
      const key: keyof typeof stats =
        st.result === 'slip'
          ? 'slip'
          : st.result === 'bind'
            ? 'bind'
            : st.result === 'trap'
              ? 'trap'
              : 'advanced';
      stats[key]++;
      expect(st.result).toBe('advanced');
      if (spec.gates.includes(4)) stats.gate++;
      if (spec.traps[4]?.length) stats.trap++;
    }
    expect(stats.advanced).toBe(SEEDS.length);
  });

  it('HUD board model marker row matches sim row at col 3 (display pin 4)', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const spec = generateLock(seed, heroic);
      const actions = solveLockActions(spec)!;
      let col = 0;
      let row = spec.startRow;
      for (let step = 0; step < 3; step++) {
        const st = stepLock(spec, col, row, actions[step]);
        col = st.col;
        row = st.row;
      }
      const view = viewAt(spec, col, row);
      const m = lockpickBoardModel(view);
      expect(m.activeCol).toBe(3);
      expect(m.columns[3].markerRow).toBe(row);
      // Every open row shown for col 4 must exist in spec.open[4]
      const col4 = m.columns[4];
      expect(col4.state).toBe('ahead');
      for (const n of col4.notches) {
        expect(spec.open[4]).toContain(n.row);
      }
    }
  });

  it('matching ward number to hotkey (1 at ward 1, 4 at ward 4) fails by ward 4', () => {
    const wardKey: Record<number, 'hardSet' | 'set' | 'steady' | 'ease' | 'drop'> = {
      0: 'hardSet',
      1: 'set',
      2: 'steady',
      3: 'ease',
      4: 'drop',
    };
    let failByWard4 = 0;
    for (const seed of SEEDS) {
      const spec = generateLock(seed, heroic);
      let col = 0;
      let row = spec.startRow;
      let failed = false;
      for (let w = 0; w <= 3; w++) {
        const st = stepLock(spec, col, row, wardKey[w]);
        if (st.result !== 'advanced') {
          failed = true;
          break;
        }
        col = st.col;
        row = st.row;
      }
      if (failed) failByWard4++;
    }
    expect(failByWard4).toBeGreaterThan(SEEDS.length * 0.85);
  });

  it('pressing hotkey A (ease) at ward 4 is wrong ~half the time (depth key, not ward index)', () => {
    let easeCorrect = 0;
    let easeFails = 0;
    for (const seed of SEEDS) {
      const spec = generateLock(seed, heroic);
      const path = solveLockPath(spec)!;
      const need = path[4] - path[3];
      if (need === ACTION_DELTA.ease) easeCorrect++;
      const st = stepLock(spec, 3, path[3], 'ease');
      if (st.result !== 'advanced') easeFails++;
    }
    expect(easeCorrect).toBeLessThan(SEEDS.length * 0.55);
    expect(easeFails).toBeGreaterThan(SEEDS.length * 0.45);
  });

  it('multi-page bountiful-style engage seeds remain solvable', () => {
    for (const baseSeed of SEEDS.slice(0, 100)) {
      const pages = generateLockPages(baseSeed, heroic, 3);
      for (const spec of pages) {
        const actions = solveLockActions(spec)!;
        let col = 0;
        let row = spec.startRow;
        for (const a of actions) {
          const st = stepLock(spec, col, row, a);
          expect(['advanced', 'success']).toContain(st.result);
          col = st.col;
          row = st.row;
        }
      }
    }
  });
});
