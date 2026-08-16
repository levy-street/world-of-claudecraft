// The char-select "Edit Appearance" affordance: the PAID redesign path, unlocked
// by holding at least one Stylist redesign credit.
//
// Its own module rather than more branches in the char-select renderer, because
// it is a self-contained decision with no need for the coordinator's private
// mutable state: given a roster row it answers "is there a redesign available on
// this character, and which route does saving take". Both halves are then
// reachable from a Vitest with plain objects instead of only by clicking, which
// is the whole point (the routing decision below is the one that can silently
// charge the wrong thing).
//
// It deliberately does NOT own an editor. The editor is the shipped
// CharselectRedesignEditor (charselect_redesign.ts), which already reuses the
// creation customizer preloaded with the character's stored look; this module
// only decides WHEN its button appears and WHERE its Save posts. Reusing that
// editor as-is, rather than forking a second one, is why the paid path renders a
// preloaded creator for free.

import { esc } from './esc';
import { t } from './i18n';

/** The roster fields this module reads. Structural, so the char-select
 *  `CharacterSummary` satisfies it without this module importing the net layer. */
export interface RedesignEligibilityRow {
  name: string;
  /** Unspent Stylist credits (server-decided; absent or 0 = none). */
  redesignCredits?: number;
  /** The FREE one-shot legacy token (server-decided): a character that predates
   *  the modular creator, token unspent. */
  appearanceRerollAvailable?: boolean;
}

/** Which endpoint a Save on this character must post to.
 *  - 'token': the free one-shot legacy reroll (/appearance-reroll).
 *  - 'credit': a paid Stylist credit (/redesign). */
export type RedesignRoute = 'token' | 'credit';

/** Unspent credits held, defensively read. The wire is untrusted the same way
 *  persisted JSON is: a fractional count floors, and anything not a positive
 *  finite number reads as zero. */
export function redesignCreditsOnRow(c: RedesignEligibilityRow): number {
  const held = c.redesignCredits;
  if (typeof held !== 'number' || !Number.isFinite(held) || held < 1) return 0;
  return Math.floor(held);
}

/**
 * Which route a redesign on this character takes, or null when none is
 * available.
 *
 * THE FREE TOKEN WINS when a character somehow holds both. A player who bought
 * a credit while still carrying their untouched legacy freebie must spend the
 * freebie first: the alternative charges them for something they already own,
 * and the credit is not consumed by the token route, so nothing is lost. This
 * ordering is the reason the decision is a function with a test rather than an
 * inline `credits >= 1 ? ... : ...` at the call site.
 */
export function redesignRouteFor(c: RedesignEligibilityRow): RedesignRoute | null {
  if (c.appearanceRerollAvailable === true) return 'token';
  return redesignCreditsOnRow(c) >= 1 ? 'credit' : null;
}

/** Whether the roster row shows the paid Edit Appearance button. False when the
 *  free token applies: that row shows the existing Redesign button instead, so
 *  the two never render together and the player is never offered one action
 *  under two names. */
export function showsEditAppearance(c: RedesignEligibilityRow): boolean {
  return redesignRouteFor(c) === 'credit';
}

/** The roster row's Edit Appearance button, or '' when the row does not show it.
 *  The hint line states the cost model plainly (a credit is spent on SAVE, not
 *  on opening the editor), because that is the one thing a player cannot undo. */
export function editAppearanceButtonHtml(c: RedesignEligibilityRow): string {
  if (!showsEditAppearance(c)) return '';
  const credits = redesignCreditsOnRow(c);
  const hint =
    credits === 1
      ? t('character.editAppearanceHintOne')
      : t('character.editAppearanceHint', { count: credits });
  return `<button type="button" class="btn edit-appearance-btn" title="${esc(hint)}" aria-label="${esc(
    t('character.editAppearanceAria', { name: c.name }),
  )}">${esc(t('character.editAppearance'))}</button>`;
}

/** The two submit paths the router dispatches between. Both resolve with the
 *  stored look and reject with an api error the caller localizes. */
export interface RedesignSubmitDeps {
  /** POST /api/characters/:id/appearance-reroll (free one-shot token). */
  saveWithFreeToken(characterId: number, app: object, helmHidden: boolean): Promise<unknown>;
  /** POST /api/characters/:id/redesign (spends one Stylist credit). */
  saveWithCredit(characterId: number, app: object, helmHidden: boolean): Promise<unknown>;
}

/**
 * Remembers which route the OPEN editor was opened under, so Save posts to the
 * endpoint the player was actually offered.
 *
 * This exists because the editor is shared: one CharselectRedesignEditor serves
 * both the free token and the paid credit, and its save dep receives only a
 * character id. Deciding the route again at save time by re-reading the roster
 * would race a refresh (a roster re-pull between open and save could flip the
 * answer and post the wrong endpoint, charging a credit for a design the player
 * was told was free). Latching it at open is what makes the two agree.
 */
export class RedesignSubmitRouter {
  private route: RedesignRoute | null = null;

  constructor(private readonly deps: RedesignSubmitDeps) {}

  /** Latch the route for the character whose editor is being opened. */
  noteOpen(c: RedesignEligibilityRow): void {
    this.route = redesignRouteFor(c);
  }

  /** Forget the latched route (editor closed or cancelled). */
  clear(): void {
    this.route = null;
  }

  /** The currently latched route, for tests and callers that need to explain
   *  themselves. */
  get pendingRoute(): RedesignRoute | null {
    return this.route;
  }

  /**
   * Post the design to the latched route's endpoint.
   *
   * With NO latched route this throws rather than guessing. Falling back to
   * either endpoint would be wrong in a way the player pays for: guessing
   * 'credit' spends money on a save nobody was offered, and guessing 'token'
   * burns a one-shot freebie. A save with no open editor is a bug in the
   * caller, so it fails loudly here instead of quietly charging someone.
   */
  async submit(characterId: number, app: object, helmHidden: boolean): Promise<void> {
    const route = this.route;
    if (route === null) {
      throw new Error('redesign submit with no open editor: route was never latched');
    }
    if (route === 'credit') await this.deps.saveWithCredit(characterId, app, helmHidden);
    else await this.deps.saveWithFreeToken(characterId, app, helmHidden);
    // Cleared only on SUCCESS: a rejected save leaves the editor open with its
    // draft intact (charselect_redesign.ts save()), so the player can fix the
    // problem and retry against the same route they were offered.
    this.route = null;
  }
}
