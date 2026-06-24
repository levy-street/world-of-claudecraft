import { describe, expect, it } from 'vitest';
import {
  ACTION_DELTA,
  generateLock,
  type LockTierSpec,
  solveLock,
  solveLockActions,
  solveLockPath,
  stepLock,
  visibleCells,
} from '../src/sim/lockpick';

const ALL_ACTIONS: LockTierSpec['allowedActions'] = ['hardSet', 'set', 'steady', 'ease', 'drop'];
const NO_COARSE: LockTierSpec['allowedActions'] = ['set', 'steady', 'ease'];

const TIERS: Record<string, LockTierSpec> = {
  easy: {
    cols: 11,
    rows: 6,
    width: 2,
    gateCount: 1,
    visibilityWindow: 99,
    allowedActions: ALL_ACTIONS,
  },
  mid: {
    cols: 14,
    rows: 6,
    width: 1,
    gateCount: 3,
    visibilityWindow: 6,
    allowedActions: ALL_ACTIONS,
  },
  hard: {
    cols: 18,
    rows: 7,
    width: 1,
    gateCount: 4,
    visibilityWindow: 3,
    allowedActions: NO_COARSE,
  },
};

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 2654435761);

describe('generateLock, invariants', () => {
  for (const [name, tier] of Object.entries(TIERS)) {
    describe(`tier ${name}`, () => {
      it('every generated lock is solvable (flawless ante-1 is always fair)', () => {
        for (const seed of SEEDS) {
          const spec = generateLock(seed, tier);
          expect(solveLock(spec), `seed ${seed} unsolvable`).toBe(true);
        }
      });

      it('gate columns + bolt seat have exactly one open row; start/seat are open', () => {
        for (const seed of SEEDS) {
          const spec = generateLock(seed, tier);
          for (const g of spec.gates) {
            expect(spec.open[g].length, `gate ${g} not single`).toBe(1);
          }
          const last = spec.open.length - 1;
          expect(spec.open[last].length).toBe(1);
          expect(spec.open[last][0]).toBe(spec.seatRow);
          expect(spec.open[0]).toContain(spec.startRow);
        }
      });

      it('respects board dimensions and gate count', () => {
        for (const seed of SEEDS.slice(0, 20)) {
          const spec = generateLock(seed, tier);
          expect(spec.open.length).toBe(tier.cols);
          expect(spec.gates.length).toBe(Math.min(tier.gateCount, tier.cols - 2));
          for (let c = 0; c < spec.open.length; c++) {
            for (const r of spec.open[c]) {
              expect(r).toBeGreaterThanOrEqual(0);
              expect(r).toBeLessThan(tier.rows);
            }
          }
        }
      });

      it('every open cell (post-trim) is reachable from the previous column', () => {
        const deltas = tier.allowedActions.map((a) => ACTION_DELTA[a]);
        for (const seed of SEEDS.slice(0, 50)) {
          const spec = generateLock(seed, tier);
          for (let c = 1; c < spec.open.length; c++) {
            for (const r of spec.open[c]) {
              const reachable = spec.open[c - 1].some((pr) => deltas.includes(r - pr));
              expect(reachable, `seed ${seed} col ${c} row ${r} unreachable`).toBe(true);
            }
          }
        }
      });

      it('no open cell is stranded in front of a gate or bolt seat (forward reachability)', () => {
        const deltas = tier.allowedActions.map((a) => ACTION_DELTA[a]);
        for (const seed of SEEDS) {
          const spec = generateLock(seed, tier);
          for (let c = 0; c < spec.open.length - 1; c++) {
            // A single-open-row next column is an exact checkpoint (gate or seat).
            if (spec.open[c + 1].length !== 1) continue;
            const target = spec.open[c + 1][0];
            for (const r of spec.open[c]) {
              const canReach = deltas.some((d) => r + d === target);
              expect(
                canReach,
                `seed ${seed} ${name}: col ${c} row ${r} cannot legally reach checkpoint row ${target} at col ${c + 1}`,
              ).toBe(true);
            }
          }
        }
      });

      it('the solver path actually clears the lock via stepLock', () => {
        for (const seed of SEEDS.slice(0, 50)) {
          const spec = generateLock(seed, tier);
          const actions = solveLockActions(spec)!;
          expect(actions).not.toBeNull();
          let col = 0;
          let row = spec.startRow;
          let result = 'advanced';
          for (const a of actions) {
            const step = stepLock(spec, col, row, a);
            col = step.col;
            row = step.row;
            result = step.result;
            expect(['advanced', 'success']).toContain(step.result);
          }
          expect(result).toBe('success');
        }
      });
    });
  }

  it('is fully deterministic: same (seed, tier) ⇒ identical lock', () => {
    const a = generateLock(12345, TIERS.mid);
    const b = generateLock(12345, TIERS.mid);
    expect(a).toEqual(b);
  });

  it('solveLockPath stays within open cells', () => {
    const spec = generateLock(99, TIERS.hard);
    const path = solveLockPath(spec)!;
    expect(path.length).toBe(spec.open.length);
    for (let c = 0; c < path.length; c++) expect(spec.open[c]).toContain(path[c]);
  });
});

describe('visibleCells, fog boundary (anti-cheat)', () => {
  it('full-visibility tier reveals the whole board', () => {
    const spec = generateLock(7, TIERS.easy);
    const cells = visibleCells(spec, 0, TIERS.easy.visibilityWindow);
    const totalOpen = spec.open.reduce((n, col) => n + col.length, 0);
    expect(cells.length).toBe(totalOpen);
  });

  it('fogged tier never reveals beyond col + window', () => {
    const spec = generateLock(7, TIERS.hard);
    const window = TIERS.hard.visibilityWindow;
    for (let col = 0; col < spec.open.length; col++) {
      const cells = visibleCells(spec, col, window);
      for (const cell of cells) {
        expect(cell.col).toBeLessThanOrEqual(col + window);
      }
    }
  });

  it('tags gate, seat, and trap cells correctly', () => {
    const spec = generateLock(42, TIERS.mid);
    const cells = visibleCells(spec, 0, TIERS.mid.cols);
    const last = spec.open.length - 1;
    for (const cell of cells) {
      if (cell.col === last) expect(cell.kind).toBe('seat');
      else if (spec.gates.includes(cell.col)) expect(cell.kind).toBe('gate');
      else if (spec.traps[cell.col]?.includes(cell.row)) expect(cell.kind).toBe('trap');
      else expect(cell.kind).toBe('open');
    }
  });

  it('reveals ward-traps in the fog so the player can see and avoid them, yet stepLock still jams', () => {
    // The shipped reliquary tiers carry traps (normal 3 / heroic 5). A trap that
    // is invisible (painted as a plain open notch) is pure RNG death: a "correct"
    // looking press jams a 1-try lock. So traps are now revealed as kind 'trap'
    // and the player can thread around them; the server still jams on contact.
    const trapTier: LockTierSpec = {
      cols: 12,
      rows: 6,
      width: 1,
      gateCount: 2,
      visibilityWindow: 99,
      trapCount: 4,
      allowedActions: ALL_ACTIONS,
    };
    let trapsGenerated = 0;
    let trapsRevealed = 0;
    let jams = 0;
    for (const seed of SEEDS.slice(0, 80)) {
      const spec = generateLock(seed, trapTier);
      const cells = visibleCells(spec, 0, trapTier.visibilityWindow); // full reveal
      for (let c = 1; c < spec.open.length - 1; c++) {
        for (const r of spec.traps[c] ?? []) {
          trapsGenerated++;
          // The trap is now painted as a distinct hazard notch, never a plain 'open'.
          const cell = cells.find((x) => x.col === c && x.row === r);
          expect(cell?.kind).toBe('trap');
          trapsRevealed++;
          // Server-side, stepping onto it from a reachable previous row still jams.
          for (const pr of spec.open[c - 1]) {
            for (const a of ALL_ACTIONS) {
              const nr = Math.max(0, Math.min(trapTier.rows - 1, pr + ACTION_DELTA[a]));
              if (nr === r && stepLock(spec, c - 1, pr, a).result === 'trap') jams++;
            }
          }
        }
      }
    }
    expect(trapsGenerated).toBeGreaterThan(0); // the tier really does generate traps
    expect(trapsRevealed).toBe(trapsGenerated); // and every one is now visible to the player
    expect(jams).toBeGreaterThan(0); // and they still jam server-side
  });
});
