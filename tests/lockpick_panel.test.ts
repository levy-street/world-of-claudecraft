// Unit tests for src/ui/lockpick_panel.ts: pure view helpers, no DOM.
import { describe, expect, it } from 'vitest';
import { generateLock, type LockTierSpec, visibleCells } from '../src/sim/lockpick';
import {
  anteOptions,
  endSummary,
  lockpickActionButtons,
  lockpickBoardModel,
  pageDots,
  stepFeedback,
  TIER_LABEL,
} from '../src/ui/lockpick_panel';
import type { LockpickView } from '../src/world_api';

const TIER: LockTierSpec = {
  cols: 11,
  rows: 6,
  width: 2,
  gateCount: 2,
  visibilityWindow: 4,
  trapCount: 3,
  allowedActions: ['hardSet', 'set', 'steady', 'ease', 'drop'],
};

function viewFromLock(seed: number, col = 0): LockpickView {
  const spec = generateLock(seed, TIER);
  const visible = visibleCells(spec, col, TIER.visibilityWindow);
  return {
    sessionId: 's1',
    objectId: 7,
    w: TIER.cols,
    h: TIER.rows,
    col,
    row: spec.startRow,
    page: 1,
    pageCount: 3,
    tries: 1,
    triesTotal: 1,
    lootTier: 'premium',
    allowed: TIER.allowedActions,
    visible,
    stepTimeoutMs: 20000,
  };
}

describe('lockpickBoardModel: tumbler tracks', () => {
  it('produces one column per lock column with fog past the visible window', () => {
    const view = viewFromLock(123, 0);
    const m = lockpickBoardModel(view);
    expect(m.columns.length).toBe(TIER.cols);
    const fogCols = m.columns.filter((c) => c.state === 'fog');
    // window is 4, so far columns are fogged (covered plates, no lit notches)
    expect(fogCols.length).toBeGreaterThan(0);
    for (const c of fogCols) expect(c.notches.length).toBe(0);
  });

  it('marks col 0 as the active column and places the pick marker on the start row', () => {
    const view = viewFromLock(123, 0);
    const m = lockpickBoardModel(view);
    expect(m.activeCol).toBe(0);
    const active = m.columns[0];
    expect(active.state).toBe('active');
    expect(active.markerRow).toBe(view.row);
    // start row is a lit open/gate notch on the active track
    expect(active.notches.some((n) => n.row === view.row)).toBe(true);
  });

  it('only emits open/gate/seat/trap notches, matching the visible cells', () => {
    const view = viewFromLock(999, 0);
    const m = lockpickBoardModel(view);
    const kinds = new Set<string>();
    for (const col of m.columns) for (const n of col.notches) kinds.add(n.kind);
    for (const k of kinds) expect(['open', 'gate', 'seat', 'trap']).toContain(k);
    // total lit notches equals the visible-cell count
    const litTotal = m.columns.reduce((n, c) => n + c.notches.length, 0);
    expect(litTotal).toBe(view.visible.length);
  });

  it('tracks before the pick are "set", later visible ones "ahead"', () => {
    const view = viewFromLock(123, 2);
    const m = lockpickBoardModel(view);
    expect(m.columns[0].state).toBe('set');
    expect(m.columns[1].state).toBe('set');
    expect(m.columns[2].state).toBe('active');
  });
});

describe('lockpickActionButtons', () => {
  it('returns all five actions in shallow→deep order with depth hotkeys Q/W/E/A/Z', () => {
    const btns = lockpickActionButtons(['hardSet', 'set', 'steady', 'ease', 'drop']);
    expect(btns.map((b) => b.action)).toEqual(['hardSet', 'set', 'steady', 'ease', 'drop']);
    expect(btns.map((b) => b.key)).toEqual(['Q', 'W', 'E', 'A', 'Z']);
    expect(btns.every((b) => b.enabled)).toBe(true);
  });

  it('disables actions not in the allowed set (hard locks drop ±2)', () => {
    const btns = lockpickActionButtons(['set', 'steady', 'ease']);
    const byAction = Object.fromEntries(btns.map((b) => [b.action, b.enabled]));
    expect(byAction.hardSet).toBe(false);
    expect(byAction.drop).toBe(false);
    expect(byAction.steady).toBe(true);
  });
});

describe('anteOptions', () => {
  it('maps ante→tier→pages (premium 3 / medium 2 / low 1, all flawless)', () => {
    const opts = anteOptions();
    expect(opts.map((o) => o.ante)).toEqual([1, 2, 3]);
    expect(opts[0]).toMatchObject({ tier: 'premium', tierLabel: TIER_LABEL.premium, pages: 3 });
    expect(opts[1]).toMatchObject({ tier: 'medium', pages: 2 });
    expect(opts[2]).toMatchObject({ tier: 'low', pages: 1 });
    expect(opts[0].margin).toContain('gauntlet');
    expect(opts[2].margin).toContain('Single');
  });

  it('carries each ante its own per-move clock (hard 3s / medium 6s / easy 9s)', () => {
    // The clock is an ante/difficulty dial, not a delve-band dial: every ante
    // shows its own ANTE_TO_STEP_TIMEOUT_MS budget.
    const opts = anteOptions();
    expect(opts.map((o) => o.timerSeconds)).toEqual([3, 6, 9]);
  });

  it('forces Premium-only for a Bountiful Coffer (§7.6)', () => {
    const opts = anteOptions(true);
    expect(opts.map((o) => o.ante)).toEqual([1]);
    expect(opts[0]).toMatchObject({ tier: 'premium', pages: 3 });
  });
});

describe('pageDots', () => {
  it('marks pages done / current / upcoming', () => {
    expect(pageDots(1, 3)).toEqual(['current', 'todo', 'todo']);
    expect(pageDots(2, 3)).toEqual(['done', 'current', 'todo']);
    expect(pageDots(1, 1)).toEqual(['current']);
  });
});

describe('stepFeedback / endSummary', () => {
  it('gives a tone for every step result, including trap + pageCleared', () => {
    expect(stepFeedback('advanced').tone).toBe('good');
    expect(stepFeedback('slip').tone).toBe('bad');
    expect(stepFeedback('bind').tone).toBe('bad');
    expect(stepFeedback('trap').tone).toBe('bad');
    expect(stepFeedback('pageCleared').tone).toBe('win');
    expect(stepFeedback('success').tone).toBe('win');
    expect(stepFeedback('fail').tone).toBe('bad');
  });

  it('summarizes each outcome', () => {
    expect(endSummary('success', 'premium')).toContain('Premium');
    expect(endSummary('fail')).toContain('again');
    expect(endSummary('abandoned')).toContain('waits');
  });
});
