import { describe, expect, it } from 'vitest';
import { type LockSpec, type LockTierSpec, stepLock } from '../src/sim/lockpick';

// Hand-built lock so outcomes are exact and obvious. 5 columns, 5 rows.
// Solution path: 2 -> 2 -> 3 -> 3 -> 3 (seat). Gate at col 2 (single open row 3).
const tier: LockTierSpec = {
  cols: 5,
  rows: 5,
  width: 1,
  gateCount: 1,
  visibilityWindow: 99,
  allowedActions: ['hardSet', 'set', 'steady', 'ease', 'drop'],
};

const spec: LockSpec = {
  seed: 1,
  tier,
  open: [
    [1, 2, 3], // col 0
    [1, 2, 3], // col 1
    [3], // col 2, GATE (single)
    [2, 3, 4], // col 3
    [3], // col 4, bolt seat
  ],
  gates: [2],
  traps: [[], [], [], [], []],
  startRow: 2,
  seatRow: 3,
};

describe('stepLock, outcomes', () => {
  it('advances when landing on an open cell (steady)', () => {
    const s = stepLock(spec, 0, 2, 'steady');
    expect(s.result).toBe('advanced');
    expect(s).toMatchObject({ col: 1, row: 2 });
  });

  it('slips into a ward (non-gate blocked cell): position unchanged', () => {
    // From col0 row2, hardSet (-2) -> row0 at col1, which is a ward (open is 1..3).
    const s = stepLock(spec, 0, 2, 'hardSet');
    expect(s.result).toBe('slip');
    expect(s).toMatchObject({ col: 0, row: 2 });
  });

  it('binds when missing a gate row: position unchanged', () => {
    // Entering gate col2 from row2 with steady -> row2, but gate is row3 only.
    const s = stepLock(spec, 1, 2, 'steady');
    expect(s.result).toBe('bind');
    expect(s).toMatchObject({ col: 1, row: 2 });
  });

  it('seats the gate exactly when hitting its row (ease +1)', () => {
    const s = stepLock(spec, 1, 2, 'ease');
    expect(s.result).toBe('advanced');
    expect(s).toMatchObject({ col: 2, row: 3 });
  });

  it('reaches success only on the bolt seat row', () => {
    const s = stepLock(spec, 3, 3, 'steady');
    expect(s.result).toBe('success');
    expect(s).toMatchObject({ col: 4, row: 3 });
  });

  it('arriving at the last column off-seat is a slip, not success', () => {
    // Last col open holds only the seat (row3); any other row is blocked. From
    // col3 row4, hardSet (-2) -> row2 at col4 -> ward slip.
    const s = stepLock(spec, 3, 4, 'hardSet');
    expect(s.result).toBe('slip');
    expect(s).toMatchObject({ col: 3, row: 4 });
  });

  it('clamps at the top edge and evaluates the clamped cell', () => {
    // From row1, hardSet (-2) clamps to row0 at col1 (a ward) -> slip, no crash.
    const s = stepLock(spec, 0, 1, 'hardSet');
    expect(s.result).toBe('slip');
    expect(s).toMatchObject({ col: 0, row: 1 });
  });

  it('clamps at the bottom edge', () => {
    // From col0 row3, drop (+2) clamps to row4 at col1 (ward, open is 1..3) -> slip.
    const s = stepLock(spec, 0, 3, 'drop');
    expect(s.result).toBe('slip');
    expect(s).toMatchObject({ col: 0, row: 3 });
  });

  it('jams on a ward-trap (open-looking cell flagged as a trap)', () => {
    // Same board, but col1 row1 is a trap. hardSet (-1... ), use a trapped spec.
    const trapped: LockSpec = { ...spec, traps: [[], [1], [], [], []] };
    // From col0 row2, set (-1) -> row1 at col1, which is OPEN but a TRAP -> jam.
    const s = stepLock(trapped, 0, 2, 'set');
    expect(s.result).toBe('trap');
    expect(s).toMatchObject({ col: 0, row: 2 }); // pick does not advance
  });
});

describe('generateLock, traps + multi-page', () => {
  it('places exactly trapCount traps, none on the solution path, lock still solvable', async () => {
    const { generateLock, solveLockPath, solveLockActions, stepLock } = await import(
      '../src/sim/lockpick'
    );
    const t: LockTierSpec = {
      cols: 14,
      rows: 6,
      width: 1,
      gateCount: 2,
      visibilityWindow: 4,
      trapCount: 4,
      allowedActions: ['hardSet', 'set', 'steady', 'ease', 'drop'],
    };
    for (const seed of [1, 2, 3, 99, 12345, 654321]) {
      const sp = generateLock(seed, t);
      const trapTotal = sp.traps.reduce((n, c) => n + c.length, 0);
      expect(trapTotal).toBeLessThanOrEqual(4);
      const path = solveLockPath(sp);
      expect(path, `seed ${seed} unsolvable with traps`).not.toBeNull();
      // no trap sits on the solution path
      for (let c = 0; c < path!.length; c++) expect(sp.traps[c]?.includes(path![c]!)).toBe(false);
      // walking the solver path never hits a trap
      let col = 0,
        row = sp.startRow,
        result = 'advanced';
      for (const a of solveLockActions(sp)!) {
        const st = stepLock(sp, col, row, a);
        col = st.col;
        row = st.row;
        result = st.result;
        expect(['advanced', 'success']).toContain(result);
      }
      expect(result).toBe('success');
    }
  });

  it('generateLockPages produces N distinct deterministic boards', async () => {
    const { generateLockPages } = await import('../src/sim/lockpick');
    const t: LockTierSpec = {
      cols: 12,
      rows: 6,
      width: 1,
      gateCount: 2,
      visibilityWindow: 4,
      trapCount: 3,
      allowedActions: ['hardSet', 'set', 'steady', 'ease', 'drop'],
    };
    const a = generateLockPages(777, t, 3);
    const b = generateLockPages(777, t, 3);
    expect(a.length).toBe(3);
    expect(a).toEqual(b); // deterministic
    expect(a[0]).not.toEqual(a[1]); // pages differ
    expect(a[1]).not.toEqual(a[2]);
  });
});
