// Pure presentation logic for the overhead spell cast/channel bar. Kept DOM-free
// (and free of i18n: no t()/tEntity here) so the fill + label rules stay
// unit-testable without a WebGL context. The renderer turns this into DOM and
// resolves the visible text (fishing label vs. ability name) via i18n.
import { CONSUME_DURATION, type Consuming, type Entity, FISHING_CAST_ID } from '../sim/types';

export interface CastBarState {
  /** whether the bar should be shown at all this frame */
  visible: boolean;
  /** channels drain (true); hardcasts fill toward completion (false) */
  channel: boolean;
  /** 0..1 width fraction — casts grow toward 1, channels shrink toward 0 */
  fill: number;
  /**
   * Stable discriminator for the renderer to localize, never display text:
   * the raw castingAbility id (an ABILITIES key, or an unknown id rendered
   * verbatim). When `fishing` is true this is the fishing cast id.
   */
  label: string;
  /** the cast is the fishing channel → renderer shows the localized fishing label */
  fishing: boolean;
}

const HIDDEN: CastBarState = { visible: false, channel: false, fill: 0, label: '', fishing: false };

export function castBarState(e: Entity): CastBarState {
  // corpses, doors/crates, and idle entities show nothing; guard the divide too
  if (e.dead || e.kind === 'object' || !e.castingAbility || e.castTotal <= 0) return HIDDEN;
  const remaining = Math.max(0, Math.min(1, e.castRemaining / e.castTotal));
  const fill = e.channeling ? remaining : 1 - remaining;
  return {
    visible: true,
    channel: e.channeling,
    fill,
    label: e.castingAbility,
    fishing: e.castingAbility === FISHING_CAST_ID,
  };
}

/**
 * Stable eat/drink discriminator the renderer localizes (it is never display
 * text): which consumable(s) are running. Follows the same i18n-free precedent
 * as `label` (the raw ability id the renderer turns into a name): the core emits
 * the mode, the painter resolves the localized 'eating'/'drinking' label.
 */
export type ConsumeMode = 'eat' | 'drink' | 'eatdrink';

/** The eat/drink overlay state. A PLAYER-ONLY concern: only players eat/drink, so
 *  this rides on the player cast-bar instance and the generic-Entity `castBarState`
 *  path (which the target also uses) stays a pure cast/channel function. */
export interface ConsumeBarState {
  /** whether the eat/drink overlay should be shown at all this frame */
  visible: boolean;
  /** 0..1 width fraction; drains from full toward 0 as the timer ticks down,
   *  like a channel (the consume bar uses the channel styling) */
  fill: number;
  /** stable discriminator for the renderer to localize: eat vs drink vs both */
  mode: ConsumeMode;
  /** seconds left on the bar-driving consumable (the longer-running one), for the
   *  timer text the painter formats */
  remaining: number;
}

const CONSUME_HIDDEN: ConsumeBarState = { visible: false, fill: 0, mode: 'eat', remaining: 0 };

/**
 * Derive the player's eat/drink overlay from the food/drink timers. Food and
 * drink run concurrently; when both are active the longer-remaining one drives
 * the bar (matching the inline HUD block this replaced). i18n-free: emits the
 * `mode` discriminator only, never a `t()` call or visible text. Same input gives
 * the same output; no Math.random/Date.now/performance.now.
 */
export function consumeBarState(
  eating: Consuming | null,
  drinking: Consuming | null,
): ConsumeBarState {
  // the longer-remaining consumable drives the bar (matching the inline HUD block);
  // null only when neither food nor drink is active
  const driver =
    eating && drinking
      ? eating.remaining >= drinking.remaining
        ? eating
        : drinking
      : (eating ?? drinking);
  if (!driver) return CONSUME_HIDDEN;
  const mode: ConsumeMode = eating && drinking ? 'eatdrink' : eating ? 'eat' : 'drink';
  return {
    visible: true,
    fill: Math.max(0, Math.min(1, driver.remaining / CONSUME_DURATION)),
    mode,
    remaining: driver.remaining,
  };
}
