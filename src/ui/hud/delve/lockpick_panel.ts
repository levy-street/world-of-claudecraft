// "Tumbler's Path" lockpick panel: pure view helpers (no DOM/canvas), mirroring
// the delve_map.ts pattern: take the fogged IWorld.LockpickView in, return plain
// draw/layout data out. hud.ts owns the actual DOM. Snapshot-tested by
// tests/lockpick_panel.test.ts.
//
// v2 redesign: NOT a grid of squares, a row of tumbler pin-tracks. Each lock
// column is a brass tumbler; only its wards (open notches / gate / seat / trap)
// are lit, the rest of the face is solid metal. Columns past the fog window are
// a blank covered plate (unknown). The run is FLAWLESS across multiple pages
// (premium 3 / medium 2 / low 1); one slip, bind, or hidden ward-trap jams it.
//
// NOTE: the strings returned here are the English SOURCE plus stable
// discriminators (tier / action / step result). hud.ts re-renders the
// player-visible text through the lockpickUi.* and sim.lockpick.tier* t() keys,
// so this module stays DOM/i18n-free and snapshot-tested as the English reference.

import type { Ante, LootTier, PickAction, StepResult } from '../../../sim/lockpick';
import {
  ACTION_DELTA,
  ANTE_TO_PAGES,
  ANTE_TO_STEP_TIMEOUT_MS,
  ANTE_TO_TIER,
  ANTE_TO_TRIES,
  PICK_ACTIONS,
} from '../../../sim/lockpick';
import type { LockpickView } from '../../../world_api';

/** Kind of a lit notch on a tumbler track. */
export type NotchKind = 'open' | 'gate' | 'seat' | 'trap';
/** Lifecycle of a tumbler column relative to the pick. */
export type ColumnState = 'set' | 'active' | 'ahead' | 'fog';

export interface TumblerNotch {
  row: number;
  kind: NotchKind;
}

export interface TumblerColumn {
  col: number;
  state: ColumnState;
  /** Lit wards on this track (empty when fogged). */
  notches: TumblerNotch[];
  /** Pick depth shown on this column, or null (only the active column carries it). */
  markerRow: number | null;
  isGate: boolean;
  isSeat: boolean;
}

export interface BoardModel {
  w: number;
  h: number;
  columns: TumblerColumn[];
  activeCol: number;
  markerRow: number;
  seatCol: number;
}

/** Human-facing names for each loot tier. */
export const TIER_LABEL: Record<LootTier, string> = {
  premium: 'Premium',
  medium: 'Medium',
  low: 'Modest',
};

/** Depth hotkeys in shallow→deep order. Letter keys avoid colliding with the
 * 1-based ward counter (Ward 4 / 16) shown above the board. */
export const PICK_ACTION_HOTKEYS = ['q', 'w', 'e', 'a', 'z'] as const;

/** Display label + delta glyph + hotkey for each depth action (shallow→deep). */
export interface ActionButton {
  action: Exclude<PickAction, 'abort'>;
  label: string;
  glyph: string;
  /** 1-based hotkey shown on the button and bound while the panel is open. */
  key: string;
  enabled: boolean;
}

const ACTION_LABEL: Record<Exclude<PickAction, 'abort'>, string> = {
  hardSet: 'Hard Set',
  set: 'Set',
  steady: 'Steady',
  ease: 'Ease',
  drop: 'Drop',
};

function deltaGlyph(delta: number): string {
  if (delta <= -2) return '▲▲';
  if (delta === -1) return '▲';
  if (delta === 0) return '=';
  if (delta === 1) return '▼';
  return '▼▼';
}

/** The five action buttons in shallow→deep order; disabled when not allowed. */
export function lockpickActionButtons(
  allowed: readonly Exclude<PickAction, 'abort'>[],
): ActionButton[] {
  const allow = new Set(allowed);
  return PICK_ACTIONS.map((action, i) => ({
    action,
    label: ACTION_LABEL[action],
    glyph: deltaGlyph(ACTION_DELTA[action]),
    key: PICK_ACTION_HOTKEYS[i].toUpperCase(),
    enabled: allow.has(action),
  }));
}

/** Build the tumbler tracks from the fogged view. Columns are 'set' (passed),
 * 'active' (current pick), 'ahead' (lit but not reached) or 'fog' (covered). */
export function lockpickBoardModel(view: LockpickView): BoardModel {
  const { w, h, visible, col, row } = view;
  let maxVisibleCol = -1;
  for (const c of visible) if (c.col > maxVisibleCol) maxVisibleCol = c.col;
  const byCol = new Map<number, TumblerNotch[]>();
  const gateCols = new Set<number>();
  let seatCol = w - 1;
  for (const c of visible) {
    if (c.kind === 'gate') gateCols.add(c.col);
    if (c.kind === 'seat') seatCol = c.col;
    const arr = byCol.get(c.col) ?? [];
    arr.push({ row: c.row, kind: c.kind as NotchKind });
    byCol.set(c.col, arr);
  }
  const columns: TumblerColumn[] = [];
  for (let c = 0; c < w; c++) {
    let state: ColumnState;
    if (c < col) state = 'set';
    else if (c === col) state = 'active';
    else if (c <= maxVisibleCol) state = 'ahead';
    else state = 'fog';
    const notches =
      state === 'fog' ? [] : (byCol.get(c) ?? []).slice().sort((a, b) => a.row - b.row);
    columns.push({
      col: c,
      state,
      notches,
      markerRow: c === col ? row : null,
      isGate: gateCols.has(c),
      isSeat: c === seatCol,
    });
  }
  return { w, h, columns, activeCol: col, markerRow: row, seatCol };
}

/** Page progress dots: one per page, marked done / current / upcoming. */
export function pageDots(page: number, pageCount: number): ('done' | 'current' | 'todo')[] {
  const out: ('done' | 'current' | 'todo')[] = [];
  for (let i = 1; i <= pageCount; i++)
    out.push(i < page ? 'done' : i === page ? 'current' : 'todo');
  return out;
}

export interface AnteOption {
  ante: Ante;
  tier: LootTier;
  tierLabel: string;
  /** Number of sequential lock pages this ante demands. */
  pages: number;
  /** Tries (attempts) granted before the chest jams (easy 3 / medium 2 / hard 1). */
  tries: number;
  /** Stakes summary line. */
  margin: string;
  /** Per-move time budget in seconds (authoritative, from the ante's
   * ANTE_TO_STEP_TIMEOUT_MS). The clock is an ante/difficulty dial: hard 3s /
   * medium 6s / easy 9s per move. Always set (every ante has a clock). */
  timerSeconds: number;
}

/** The three ante choices shown in the engage selector. Ante == loot tier ==
 * page count (premium 3 / medium 2 / low 1). Difficulty also sets the tries you
 * get (easy 3 / medium 2 / hard 1): a failed try resets the board until they run
 * out.
 *
 * A Bountiful Coffer (§7.6) is purple and forces the Hard/Premium path: only the
 * Premium ante is offered, the lower difficulties are not an option.
 *
 * The per-move clock is an ante dial, so each ante carries its OWN time budget
 * (hard 3s / medium 6s / easy 9s) from ANTE_TO_STEP_TIMEOUT_MS. */
export function anteOptions(coffer = false): AnteOption[] {
  const antes: Ante[] = coffer ? [1] : [1, 2, 3];
  return antes.map((ante) => {
    const tier = ANTE_TO_TIER[ante];
    const pages = ANTE_TO_PAGES[ante];
    const tries = ANTE_TO_TRIES[ante];
    const gauntlet = pages > 1 ? `${pages}-lock gauntlet` : 'Single lock';
    const triesText = tries > 1 ? `${tries} tries` : '1 try';
    const margin = `${gauntlet}, ${triesText}`;
    const timerSeconds = ANTE_TO_STEP_TIMEOUT_MS[ante] / 1000;
    return { ante, tier, tierLabel: TIER_LABEL[tier], pages, tries, margin, timerSeconds };
  });
}

/** Short diegetic feedback + tone for a step outcome (drives toast + SFX). */
export function stepFeedback(result: StepResult): { text: string; tone: 'good' | 'bad' | 'win' } {
  switch (result) {
    case 'advanced':
      return { text: 'The pin gives...', tone: 'good' };
    case 'slip':
      return { text: 'A ward bites, the pick slips!', tone: 'bad' };
    case 'bind':
      return { text: 'The tumbler binds: wrong depth!', tone: 'bad' };
    case 'trap':
      return { text: 'A false ward snaps shut, the lock jams!', tone: 'bad' };
    case 'retry':
      return { text: 'The lock resets. Line up a fresh attempt.', tone: 'bad' };
    case 'pageCleared':
      return { text: 'A tumbler bank falls. The next lock turns up.', tone: 'win' };
    case 'success':
      return { text: 'The bolt throws, the cache is yours!', tone: 'win' };
    case 'fail':
      return { text: "The lock seizes. It won't budge again.", tone: 'bad' };
    default:
      return { text: '', tone: 'good' };
  }
}

/** End-of-attempt summary line for the result banner. */
export function endSummary(outcome: 'success' | 'fail' | 'abandoned', tier?: LootTier): string {
  if (outcome === 'success') return `Lock sprung, ${tier ? TIER_LABEL[tier] : 'a'} cache claimed.`;
  if (outcome === 'fail') return 'The lock is ruined. Clear the delve again for another attempt.';
  return 'You ease the picks back out. The lock waits.';
}

/** Identity of the current timed move. The per-page countdown is per-MOVE: it
 * refills to the full per-lock time whenever this key changes, i.e. on every pin
 * advance (col), every fresh try (tries), every new page, and every new lock
 * session. Deriving the reset from the authoritative world.lockpickState this way
 * (instead of from a step-event result) makes the refill follow the real board in
 * both hosts, independent of event-flush timing: the clock cannot fail to reset
 * after a correct move. A null state (the lock ended) carries no key and stops
 * the clock. */
export function lockpickTimerKey(view: LockpickView): string {
  return `${view.sessionId}:${view.page}:${view.tries}:${view.col}`;
}

/** Compact signature of everything the board paint depends on. The window's
 * per-frame repaint compares this against the last paint and only touches the
 * DOM when it changes, so reading straight from the authoritative
 * world.lockpickState every frame stays cheap. */
export function lockpickRenderSig(view: LockpickView): string {
  return (
    `${view.sessionId}|${view.col}|${view.row}|${view.page}|${view.pageCount}` +
    `|${view.tries}|${view.triesTotal}|${view.w}|${view.h}|${view.visible.length}`
  );
}
