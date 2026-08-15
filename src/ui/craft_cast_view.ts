// Pure craft-cast presentation for the crafting window (Craft Cast System
// Phases 2 to 3).
//
// Host-agnostic and DOM/i18n-free: duration chips, craft-button state machine,
// in-window progress fraction, and batch qty clamp all resolve here from
// recipe + entity cast session inputs. The thin painter (crafting_window.ts)
// localizes and paints. The entity cast/session fields are authoritative on
// BOTH hosts: the offline Sim writes them directly and the online mirror
// decodes the self-only `ccast` wire fragment into the same fields, so the
// window needs no click-time guesses.

import { CRAFT_BATCH_MAX } from '../sim/content/professions';
import { craftCastDurationSec } from '../sim/professions/craft_cast_duration';
import { CRAFT_CAST_ID } from '../sim/types';

/** Craft control states the window paints. Phase 2 machine: ready, casting
 *  (this row's recipe), missing mats, station out of range, unknown
 *  (combo/unmet/other), and busy (another craft cast is already running). */
export type CraftButtonState =
  | 'ready'
  | 'casting'
  | 'missing_mats'
  | 'station'
  | 'busy'
  | 'unknown';

/** UI + sim shared batch ceiling (CRAFT_BATCH_MAX from content). */
export const CRAFT_BATCH_UI_MAX = CRAFT_BATCH_MAX;

/** Inputs the HUD reads off the local player (and optional click fallback). */
export interface CraftCastSessionInput {
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  /** Entity craftCastRecipeId ('' when idle). */
  craftCastRecipeId: string;
  /** Entity craftCastBatchRemaining (0 when idle). */
  craftCastBatchRemaining?: number;
  /** Entity craftCastBatchTotal (0 when idle). */
  craftCastBatchTotal?: number;
}

/** Structured craft-cast session for the window (progress strip + buttons). */
export interface CraftCastSessionView {
  active: boolean;
  recipeId: string;
  /** 0..1 hardcast fill (grows toward completion). */
  progress: number;
  remainingSec: number;
  totalSec: number;
  /** Batch items still including the in-flight cast (0 when idle). */
  batchRemaining: number;
  /** Original batch size (0 when idle; 1 for a single craft). */
  batchTotal: number;
}

export const IDLE_CRAFT_CAST_SESSION: CraftCastSessionView = {
  active: false,
  recipeId: '',
  progress: 0,
  remainingSec: 0,
  totalSec: 0,
  batchRemaining: 0,
  batchTotal: 0,
};

/** Hardcast fill fraction from remaining/total (matches cast_bar.ts growth). */
export function craftCastProgressFraction(castRemaining: number, castTotal: number): number {
  if (!(castTotal > 0)) return 0;
  const remaining = Math.max(0, Math.min(castTotal, castRemaining));
  return Math.max(0, Math.min(1, 1 - remaining / castTotal));
}

/** Build the window's craft-cast session view from live entity cast fields. */
export function buildCraftCastSession(input: CraftCastSessionInput): CraftCastSessionView {
  if (input.castingAbility !== CRAFT_CAST_ID || !(input.castTotal > 0)) {
    return IDLE_CRAFT_CAST_SESSION;
  }
  const remainingSec = Math.max(0, input.castRemaining);
  const totalSec = Math.max(0, input.castTotal);
  const recipeId = input.craftCastRecipeId;
  const batchRemaining = Math.max(0, Math.floor(input.craftCastBatchRemaining ?? 0));
  const batchTotal = Math.max(0, Math.floor(input.craftCastBatchTotal ?? 0));
  return {
    active: true,
    recipeId,
    progress: craftCastProgressFraction(remainingSec, totalSec),
    remainingSec,
    totalSec,
    batchRemaining,
    batchTotal,
  };
}

/** Max crafts payable from reagent have/required rows (capped at CRAFT_BATCH_UI_MAX). */
export function maxCraftsFromReagents(
  reagents: readonly { have: number; required: number }[],
): number {
  if (reagents.length === 0) return CRAFT_BATCH_UI_MAX;
  let max = CRAFT_BATCH_UI_MAX;
  for (const r of reagents) {
    if (!(r.required > 0)) continue;
    max = Math.min(max, Math.floor(r.have / r.required));
  }
  return Math.max(0, max);
}

/** Clamp a qty stepper value to 1..min(CRAFT_BATCH_UI_MAX, mats-fit). When
 *  mats-fit is 0, still returns 1 so the control can show a value while the
 *  craft button stays disabled. */
export function clampCraftQty(qty: number, maxFit: number): number {
  const n = Number.isFinite(qty) ? Math.floor(qty) : 1;
  if (n < 1) return 1;
  const fitCap = Math.max(1, Math.min(CRAFT_BATCH_UI_MAX, Math.max(0, Math.floor(maxFit))));
  return Math.min(n, fitCap);
}

/** True when the batch remaining label should show (multi-craft session). */
export function craftBatchIndicatorVisible(session: CraftCastSessionView): boolean {
  return session.active && session.batchTotal > 1;
}

/** Row fields the button state machine needs (subset of CraftingRecipeRow). */
export interface CraftButtonRowInput {
  recipeId: string;
  craftable: boolean;
  reagents: readonly { satisfied: boolean }[];
  station: { inRange: boolean } | null;
  comboRequirement?: { met: boolean | null };
}

/**
 * Resolve the craft button state for one recipe row. Priority:
 * active cast on this recipe, active cast on another recipe, station out of
 * range, combo unmet, missing materials, ready, else unknown.
 */
export function craftButtonState(
  row: CraftButtonRowInput,
  session: CraftCastSessionView,
): CraftButtonState {
  if (session.active) {
    if (session.recipeId !== '' && session.recipeId === row.recipeId) return 'casting';
    return 'busy';
  }
  if (row.station && !row.station.inRange) return 'station';
  if (row.comboRequirement && row.comboRequirement.met === false) return 'unknown';
  if (!row.reagents.every((r) => r.satisfied)) return 'missing_mats';
  if (row.craftable) return 'ready';
  return 'unknown';
}

/** True when the craft control should accept a click. */
export function craftButtonEnabled(state: CraftButtonState): boolean {
  return state === 'ready';
}

/** True when this row's button is the in-flight craft (aria-busy). */
export function craftButtonBusy(state: CraftButtonState): boolean {
  return state === 'casting';
}

/** Expected cast duration for a recipe (content table via craftCastDurationSec). */
export function recipeDurationSec(recipe: {
  skillReq: number;
  comboRequirement?: unknown;
}): number {
  return craftCastDurationSec(recipe);
}

/** Compact signature of craft-cast activity for cold-window rebuild gates:
 *  active flag + recipe id + batch counters, so every batch item boundary
 *  repaints the window (the batch label and button states are painted on the
 *  full-paint path; per-frame fill/timer ride the strip painter alone). */
export function craftCastActivitySig(session: CraftCastSessionView): string {
  return session.active
    ? `1:${session.recipeId}:${session.batchRemaining}:${session.batchTotal}`
    : '0';
}
