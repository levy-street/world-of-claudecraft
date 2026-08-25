// The Shardpike bar: which buttons the pike offers right now, and in what state.
//
// The Mirefen world boss's level-spread mechanic (src/sim/lance_trial.ts) is reachable
// ONLY through these three verbs, and none of them is an ability: there is no spell to
// drag onto the hotbar, no cast to key-bind, and no target to click. Without a bar of its
// own the entire trial is unreachable in play, which is exactly the state it shipped in:
// sim, wire, IWorld facet and server dispatch all complete, and no way for a player to
// couch the pike.
//
// It is a SECOND bar rather than slots on the main one on purpose. The main hotbar is the
// player's own kit, persisted per character and per spec; these verbs belong to an ITEM
// held for one quest, they appear and vanish with it, and two of the three are only legal
// inside a window measured in seconds. A transient, self-arranging row says that; a
// hotbar slot the player has to find and assign does not.
//
// Pure and DOM-free (a Vitest drives it directly); registered in
// tests/architecture.test.ts UI_PURE_CORES.

import {
  LANCE_FIXED_DAMAGE,
  LANCE_REST_SECONDS,
  LANCE_SET_SECONDS,
  LANCE_THRUST_RANGE,
  LANCE_WINDOW_SECONDS,
} from '../../../sim/lance_balance_core';
import type { LanceTrialView } from '../../../world_api/lance_trial';
import type { TranslationKey } from '../../i18n';

/** The item whose presence in the mainhand is the bar's whole visibility rule. */
export const SHARDPIKE_ITEM_ID = 'skerrits_shardpike';

/**
 * How close to a rail counts as "about to fumble".
 *
 * The beam runs -1..1 and either rail drops the pike, so the warning has to arrive with
 * enough travel left to correct. 0.62 is roughly a third of the remaining span.
 */
export const SHARDPIKE_DANGER_BALANCE = 0.62;

/** One button's live state. `action` is the verb the painter calls. */
export interface ShardpikeButtonState {
  action: 'brace' | 'thrust' | 'release';
  /** Localization key for the button's name. */
  labelKey: TranslationKey;
  /** Localization key for the hover/hold tooltip body. */
  tooltipKey: TranslationKey;
  /**
   * Values the tooltip's placeholders resolve against, read from the sim's own constants.
   * Carried per button so the catalog string never has to hardcode a tuning number.
   */
  tooltipValues: Readonly<Record<string, string>>;
  /** Procedural icon id. */
  iconId: string;
  enabled: boolean;
  /** Seconds overlay, or null for no swirl. Whole seconds: this is a chrome readout. */
  cooldownSeconds: number | null;
  /** Drawn as the primed action: the one thing the fight wants from you right now. */
  primed: boolean;
  /**
   * Fraction of a live AVAILABILITY WINDOW still left, 1 down to 0, or null when this
   * action has no window.
   *
   * Deliberately NOT `cooldownSeconds`, and that distinction is the whole point. The thrust
   * window used to ride the cooldown field, so the one moment the fight actually wants a
   * press rendered as a dark tile with a number counting down on it, which every game in
   * this genre uses to mean "you cannot press this". Players read the primed action as
   * unavailable and let the window expire. A window is the opposite of a cooldown: the
   * action is available and the clock is how long that stays true, so it is drawn as a
   * BRIGHT border draining away rather than a dark overlay filling up.
   */
  windowFrac: number | null;
  /** Whole seconds left on that window, for the label and the announcer. */
  windowSeconds: number | null;
}

export interface ShardpikeBarState {
  visible: boolean;
  /** True once the pike is couched, whatever phase. Drives the beam's own visibility. */
  bracing: boolean;
  /** 0..1 across the beam track, for CSS positioning. 0.5 is dead centre. */
  balanceFrac: number;
  /** The beam is near a rail; the meter turns and the warning reads. */
  danger: boolean;
  /** 0..1 through the set. Holds at 1 once steadied. */
  setFrac: number;
  /** Seconds left in the thrust window, or 0 while still bracing. */
  windowRemaining: number;
  buttons: readonly ShardpikeButtonState[];
}

export interface ShardpikeBarInput {
  /** The equipped mainhand item id. The pike is the only one that shows this bar. */
  mainhandItemId: string | null | undefined;
  trial: LanceTrialView | null;
  /** Seconds until the pike can be braced again; 0 when ready. */
  restRemaining: number;
  dead: boolean;
}

const HIDDEN: ShardpikeBarState = {
  visible: false,
  bracing: false,
  balanceFrac: 0.5,
  danger: false,
  setFrac: 0,
  windowRemaining: 0,
  buttons: [],
};

/**
 * The bar for this frame.
 *
 * Returns a fully hidden state rather than null so the painter has one shape to write and
 * can hide the row without a second branch.
 */
export function shardpikeBarState(input: ShardpikeBarInput): ShardpikeBarState {
  if (input.mainhandItemId !== SHARDPIKE_ITEM_ID) return HIDDEN;
  const trial = input.trial;
  const steadied = trial?.phase === 'steadied';
  const resting = input.restRemaining > 0;
  // A dead player keeps the bar (the pike is still in hand and the row must not jump out
  // of the layout mid-fight) but every verb is refused, which is also what the sim does.
  const alive = !input.dead;

  const brace: ShardpikeButtonState = {
    action: 'brace',
    labelKey: 'hudChrome.shardpike.braceLabel',
    tooltipKey: 'hudChrome.shardpike.braceTooltip',
    tooltipValues: { set: String(LANCE_SET_SECONDS) },
    iconId: 'lance_brace',
    enabled: alive && !trial && !resting,
    // The rest timer is a REAL cooldown: the action is unavailable and this is the wait.
    cooldownSeconds: resting ? Math.ceil(input.restRemaining) : null,
    // Primed whenever it is the only move available: nothing couched, nothing to wait for.
    primed: alive && !trial && !resting,
    windowFrac: null,
    windowSeconds: null,
  };
  const thrust: ShardpikeButtonState = {
    action: 'thrust',
    labelKey: 'hudChrome.shardpike.thrustLabel',
    tooltipKey: 'hudChrome.shardpike.thrustTooltip',
    tooltipValues: {
      damage: String(LANCE_FIXED_DAMAGE),
      reach: String(LANCE_THRUST_RANGE),
      seconds: String(LANCE_WINDOW_SECONDS),
    },
    iconId: 'lance_thrust',
    enabled: alive && steadied,
    // Never a cooldown. The thrust is either unavailable (no set pike, nothing to draw) or
    // available with a deadline, and a deadline is a window.
    cooldownSeconds: null,
    primed: alive && steadied,
    windowFrac: steadied
      ? Math.min(1, Math.max(0, trial.windowRemaining / LANCE_WINDOW_SECONDS))
      : null,
    windowSeconds: steadied ? Math.max(0, Math.ceil(trial.windowRemaining)) : null,
  };
  const release: ShardpikeButtonState = {
    action: 'release',
    labelKey: 'hudChrome.shardpike.releaseLabel',
    tooltipKey: 'hudChrome.shardpike.releaseTooltip',
    tooltipValues: { rest: String(LANCE_REST_SECONDS) },
    iconId: 'lance_release',
    enabled: alive && !!trial,
    cooldownSeconds: null,
    primed: false,
    windowFrac: null,
    windowSeconds: null,
  };

  return {
    visible: true,
    bracing: !!trial,
    // -1..1 to 0..1. Clamped: the sim clamps too, but the painter writes this straight
    // into a CSS position and a stray value would push the pip out of its own track.
    balanceFrac: trial ? Math.min(1, Math.max(0, (trial.balance + 1) / 2)) : 0.5,
    danger: !!trial && Math.abs(trial.balance) >= SHARDPIKE_DANGER_BALANCE,
    setFrac: trial ? Math.min(1, Math.max(0, trial.setProgress)) : 0,
    windowRemaining: steadied ? Math.max(0, trial.windowRemaining) : 0,
    buttons: [brace, thrust, release],
  };
}

/**
 * A stable signature for the bar's state, so the painter can skip an unchanged rebuild.
 *
 * The beam is deliberately quantized: it moves every tick and the pip is positioned from
 * a CSS custom property, so writing it at full precision would rebuild the row 20 times a
 * second for sub-pixel motion nobody can see.
 */
export function shardpikeBarSignature(state: ShardpikeBarState): string {
  if (!state.visible) return '';
  const buttons = state.buttons
    .map(
      (b) =>
        `${b.action}${b.enabled ? '1' : '0'}${b.primed ? 'p' : ''}${b.cooldownSeconds ?? ''}` +
        // Quantized to 2%: the border sweep is a CSS custom property draining every tick,
        // and writing it at full precision rebuilds the row twenty times a second for
        // motion under one pixel of arc.
        `${b.windowFrac === null ? '' : `w${Math.round(b.windowFrac * 50)}`}`,
    )
    .join(',');
  return `${state.bracing ? 'b' : '-'}:${Math.round(state.balanceFrac * 40)}:${
    state.danger ? 'd' : '-'
  }:${Math.round(state.setFrac * 20)}:${buttons}`;
}
