// The Shardpike verbs' hover card.
//
// The bar's view has computed a `tooltipKey` and a `tooltipValues` bag per verb since the
// bar shipped, resolved from the sim's own constants so the numbers cannot drift from the
// mechanic. Nothing ever rendered them: the painter set `btn.title` to the bare LABEL, so
// hovering "Loomshard Thrust" told you it was called Loomshard Thrust. Every sentence
// explaining what the verb does, how long its window lasts and what it strips off the boss
// was live data thrown away on the way to the DOM. So this is mostly a wiring fix.
//
// The one thing it adds that a static string cannot is the REASON line: when a verb is
// greyed, the card says why. On this bar that is not a nicety. Two of the three verbs are
// illegal most of the time by design, so a player's first read of the row is three dim
// tiles, and the question they have is not "what does this do" but "why can't I".
//
// Deliberately NOT a live readout of anything. `attachTooltip` (hud.ts) resolves the thunk
// once when the pointer arrives and caches the box's measured size on the stated premise
// that the content cannot change until the next show. A countdown in here would therefore
// freeze at whatever second it was hovered on, and the tile under the cursor is already
// showing that number ticking. Static prose in the card, live numbers on the icon.

import { esc } from '../../esc';
import type { TranslationKey } from '../../i18n';
import { t } from '../../i18n';
import type { ShardpikeButtonState } from './shardpike_bar_view';

/** One hover card, as keys rather than resolved text, so a Vitest can assert on it. */
export interface ShardpikeTooltipModel {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  bodyValues: Readonly<Record<string, string>>;
  /**
   * Why this verb cannot be pressed right now, or null when it can be.
   *
   * Also null for the few disabled states with nothing specific to say (a dead player: the
   * death screen is not something a tooltip needs to break the news of). Null rather than a
   * cheerful "ready!" line on an enabled verb, too: a card that always carries a status row
   * teaches the eye to skip the row, and this one only matters when it is there.
   */
  reasonKey: TranslationKey | null;
}

/**
 * The card for one verb.
 *
 * The reason ladder is per-verb rather than one shared rule, because the same greyed tile
 * means three different things here: brace is waiting on a clock, thrust is waiting on a
 * STANCE, and release simply has nothing to let go of.
 */
export function shardpikeTooltipModel(
  spec: ShardpikeButtonState,
  /**
   * Whether the pike is couched at all, the bar state's `bracing`. Passed as the one flag
   * rather than the whole bar state: it is all the ladder reads, and taking the state would
   * oblige the caller to invent a whole shape for the frame before the first paint.
   */
  bracing: boolean,
): ShardpikeTooltipModel {
  return {
    titleKey: spec.labelKey,
    bodyKey: spec.tooltipKey,
    bodyValues: spec.tooltipValues,
    reasonKey: spec.enabled ? null : reasonFor(spec, bracing),
  };
}

function reasonFor(spec: ShardpikeButtonState, bracing: boolean): TranslationKey | null {
  if (spec.action === 'thrust') {
    // "The pike is not set" is the sim's own refusal wording (src/sim/lance_trial.ts),
    // matched on purpose: the card explaining the gate and the error a mis-press produces
    // must not describe one rule two ways.
    return 'hudChrome.shardpike.whyNotSet';
  }
  if (spec.action === 'release') return 'hudChrome.shardpike.whyNothingCouched';
  // Brace. The rest clock outranks "already couched" because it is the one the player has
  // to wait out; `cooldownSeconds` is the view's own resting test, read here rather than
  // re-plumbed so the card and the digit on the tile can never disagree about it.
  if (spec.cooldownSeconds !== null) return 'hudChrome.shardpike.whyResting';
  if (bracing) return 'hudChrome.shardpike.whyAlreadyCouched';
  return null;
}

/**
 * The card as markup for the shared `#tooltip` box.
 *
 * `.tt-title` / `.tt-sub` / `.tt-red` is the established tooltip vocabulary (red is every
 * other "you cannot do this yet" line in the HUD). Every interpolated value is escaped:
 * these strings carry resolved numbers and the result is assigned through innerHTML, which
 * is the pairing the bag and bank cards handle identically.
 */
export function shardpikeTooltipHtml(model: ShardpikeTooltipModel): string {
  const parts = [
    `<div class="tt-title">${esc(t(model.titleKey))}</div>`,
    `<div class="tt-sub">${esc(t(model.bodyKey, model.bodyValues))}</div>`,
  ];
  if (model.reasonKey) parts.push(`<div class="tt-red">${esc(t(model.reasonKey))}</div>`);
  return parts.join('');
}
