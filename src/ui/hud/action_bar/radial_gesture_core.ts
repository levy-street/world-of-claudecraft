// Pure decision core for the touch radial gesture: what a press, a drag and a
// release MEAN. The DOM half (pointer capture, the reveal timer, measuring the
// pressed button) lives in radial_gesture_controller.ts, which owns no rules of
// its own, so
// a Vitest drives every branch here without a browser.
//
// resolveRadialDirection in radial_action_core.ts answers WHERE a drag points;
// this module answers what to do about it, which is the part that has to agree
// with the rest of the HUD (a rearrange drag owns the press, an open radial
// makes the centre the way out rather than a cast).

import type { TapMenuAnchorRole } from '../tap_menu_core';
import type { RadialDirection } from './radial_action_core';

/** What a release does. 'none' means some other owner consumed the press (a
 *  rearrange drag, an empowered hold), so the radial must stay silent rather
 *  than casting on top of it. 'open' belongs to a control with no action of its
 *  own (anchorRole 'toggle'), whose bare tap reveals the petals instead. */
export type RadialGestureOutcome =
  | { kind: 'cast'; direction: RadialDirection }
  | { kind: 'open' }
  | { kind: 'cancel' }
  | { kind: 'none' };

export type RadialPressOutcome = { kind: 'cancel-aim' } | { kind: 'continue' };

export interface RadialPressInput {
  /** Whether the active ground aim belongs to any direction on this button. */
  aimOwnedByButton: boolean;
}

/**
 * An active ground aim owned by the physical button takes the whole press. The
 * decision runs before the drag and tap-menu tables, so the raw centre gesture
 * cannot cast or open over an aim started from one of the button's petals.
 */
export function resolveRadialPress(input: RadialPressInput): RadialPressOutcome {
  return input.aimOwnedByButton ? { kind: 'cancel-aim' } : { kind: 'continue' };
}

export interface RadialReleaseInput {
  /** The direction the drag resolved to at release. */
  direction: RadialDirection;
  /** Whether the petals were showing when the finger came up. */
  revealed: boolean;
  /** Whether that direction maps to a real hotbar slot on the current page. */
  hasSlot: boolean;
  /** Another owner (a rearrange drag, an empowered hold) took the press. */
  consumedElsewhere: boolean;
  /** What this control's OWN press means. Defaults to 'action'; the meaning of
   *  the two roles is tap_menu_core.ts's, never restated here. */
  anchorRole?: TapMenuAnchorRole;
}

/**
 * The release rule. Released at the centre with the petals open means the player
 * opened the menu and chose nothing, so back out instead of casting: the centre
 * action stays one plain tap away, and committing to it here would turn an
 * inspect-then-think-better-of-it into an accidental cast.
 *
 * A 'toggle' control has no centre action to commit to, so the same bare tap
 * OPENS its petals instead. That is the one per-control variable, and it is a
 * PARAMETER here for the same reason it is one in tap_menu_core.ts: a second
 * release table is how two menus start disagreeing about the same gesture.
 */
export function resolveRadialRelease(input: RadialReleaseInput): RadialGestureOutcome {
  if (input.consumedElsewhere) return { kind: 'none' };
  if (input.revealed && input.direction === 'center') return { kind: 'cancel' };
  if (input.direction === 'center' && (input.anchorRole ?? 'action') === 'toggle') {
    return { kind: 'open' };
  }
  if (!input.hasSlot) return { kind: 'none' };
  return { kind: 'cast', direction: input.direction };
}

/**
 * Whether a drag that just changed direction should pull the petals up early.
 * Moving past the deadzone is itself intent, so the player never waits out the
 * reveal timer to see what they already committed to.
 */
export function shouldRevealOnDrag(direction: RadialDirection, revealed: boolean): boolean {
  return !revealed && direction !== 'center';
}

/** Whether the cancel target (the radial's centre) is the live choice. It only
 *  exists once the petals are up; before that the centre is a plain tap. */
export function radialCancelIsLive(direction: RadialDirection, revealed: boolean): boolean {
  return revealed && direction === 'center';
}
