// Who gets keyboard focus back after the WOC Store body is wiped and rebuilt.
//
// The store painter assigns innerHTML, which destroys the control the player is
// standing on, and it now fires on paints the player never asked for: the 15
// second service poll, another session's cosmetics grant, and the slow-band
// ladder refresh (Bank Storage phase 15, ruling 21). Those three must not steal
// focus, and the two halves of "must not steal" are easy to get wrong
// separately, so the decision lives here as one pure function with the DOM
// ladder beside it. src/ui/daily_rewards_window.ts keeps the wiring only.
//
// The pure core (`planStoreFocus`) makes both calls at once and takes no DOM:
// it is unit-tested directly in tests/store_focus_policy.test.ts, which is the
// point of splitting it out. `restoreStoreFocus` is the thin painter half.
import { type FocusRestoreCandidate, restoreFirstEnabled } from './focus_restore';

/** The key a charter purchase parks while its own button is about to lose focus.
 *
 *  It exists because disabling the focused buy button drops the player to
 *  <body>, so the paint that follows the outcome cannot read where they were. It
 *  is a one-attempt belief, and giving it an owner is the point of this class:
 *  the window used to hold it as a bare field cleared by whichever paint ran
 *  next, which bounded it only by accident. The lifetime is now stated in one
 *  place. ARMED when the confirm opens and the button still holds focus. SPENT
 *  by a player-initiated paint that actually WROTE, since an elided paint
 *  destroyed no control and a background paint is not the player asking. DROPPED
 *  whenever the attempt ends without a paint (the player cancels the confirm) or
 *  the visit does (close), because a key that outlives its attempt is spent by
 *  some later unrelated repaint, and that repaint then moves focus into the
 *  charter grid and scrolls to it for no reason the player can see. */
export class StoreFocusStash {
  private key: string | null = null;

  arm(key: string | null): void {
    this.key = key;
  }

  peek(): string | null {
    return this.key;
  }

  clear(): void {
    this.key = null;
  }
}

/** Everything the decision depends on, read BEFORE the wipe. */
export interface StoreFocusInputs {
  /** True for a paint the PLAYER DID NOT ASK FOR: the service poll, another
   *  session's cosmetics grant, the slow-band ladder refresh. */
  background: boolean;
  /** captureFocusKey(body): the key of the focused control when focus is
   *  genuinely inside the store body, else null. */
  focusInBody: string | null;
  /** True when focus is nowhere at all (document.body). The in-flight guard
   *  produces exactly this: disabling the focused buy button drops focus to
   *  <body>, so a player who never left reads as "gone". */
  focusWentNowhere: boolean;
  /** The key a purchase flow stashed while its buy button still held focus. */
  stashed: string | null;
}

export interface StoreFocusPlan {
  /** The control to hand focus back to, or null to focus nothing. */
  focusKey: string | null;
  /** Whether the restore may fall back PAST the exact key. See below. */
  degrade: boolean;
}

/** Decide what a repaint is allowed to do to focus.
 *
 *  THE STASH, and why a background paint may not spend it. A purchase stashes
 *  the buy button's key before its confirm dialog opens, because by the time the
 *  spend settles the button has been disabled and focus has fallen to <body>.
 *  Any paint that happens in between would otherwise consume that stash and
 *  leave the outcome repaint with nothing to hand focus back to. So only a
 *  player-initiated paint may read it, and only when focus really went nowhere;
 *  if anything else has taken focus in the meantime that wins and this repaint
 *  steals nothing.
 *
 *  THE DEGRADE LADDER, and why a background paint walks a SHORTER one. When the
 *  exact control is gone the full ladder falls back to any other keyed control,
 *  then the top-up button, both of which sit at the TOP of a long scroller while
 *  the charter grid is its LAST section. focus() scrolls its target into view,
 *  so that fallback both moves focus and undoes the scroll position the painter
 *  just restored. After a purchase that is right: the card the player bought can
 *  legitimately vanish and they expect to land somewhere sane.
 *
 *  On a repaint nobody asked for, both of the obvious answers are bad. Walking
 *  the full ladder is a focus move plus a scroll jump out of nowhere. Focusing
 *  nothing is worse for the player the mechanism exists for: a keyboard user
 *  lands on <body> and has to Tab from the top of the DOCUMENT, not just the
 *  scroller. So a background paint degrades WITHIN THE SAME FAMILY, resolved by
 *  the key prefix every store control already carries (`charter-`, `armory-`):
 *  the player stays in the section they were reading, and the scroller does not
 *  jump to another one. If nothing in that family survived, focusing nothing is
 *  then the honest answer, because there is no nearby place to stand. */
export function planStoreFocus(inputs: StoreFocusInputs): StoreFocusPlan {
  const stashed = inputs.background || !inputs.focusWentNowhere ? null : inputs.stashed;
  return { focusKey: inputs.focusInBody ?? stashed, degrade: !inputs.background };
}

/** Hand focus back after the ERROR body replaced the pane.
 *
 *  A separate entry point because the error body is a different SHAPE, not a
 *  different policy: it is one `role="alert"` div with no control in it at all,
 *  so `restoreStoreFocus` above has nothing to walk and would silently focus
 *  nothing while the player who was standing on a buy button lands on `<body>`
 *  and has to Tab from the top of the DOCUMENT. The only surviving places to
 *  stand are in the window SHELL, outside `.dr-body`, which is why this takes
 *  the shell rather than the wiped subtree.
 *
 *  The plan is read for ONE thing: whether focus was ours to move. A null
 *  focusKey means focus was not in the body and nothing was stashed, so the wipe
 *  took nothing from anyone and this must focus nothing. `degrade` carries no
 *  meaning here and is deliberately not read: it says how FAR a restore may walk,
 *  and there is exactly one place to walk to. That is also why a BACKGROUND error
 *  paint still moves focus: the background rule exists to stop a repaint nobody
 *  asked for YANKING focus, and a paint that destroyed the focused control has
 *  already taken it. Leaving the player on `<body>` is the worse of the two.
 *
 *  The Store TAB is preferred over the window's close button on purpose: it keeps
 *  the player inside the surface they were using, while `[data-close]` is one
 *  Enter away from dismissing the window they did not ask to leave. */
export function restoreStoreErrorFocus(plan: StoreFocusPlan, shell: HTMLElement): void {
  if (plan.focusKey === null) return;
  restoreFirstEnabled([
    outsideBody(shell.querySelector<HTMLElement>('[data-woc-store-tab="store"]')),
    outsideBody(shell.querySelector<HTMLElement>('[data-close]')),
  ]);
}

/** "Survives the wipe" made structural instead of assumed.
 *
 *  Both selectors above are shell-wide, and today's error body is a single
 *  `role="alert"` div that matches neither. That is a property of the CURRENT
 *  markup, not of the query: an error or empty body that painted its own Close or
 *  Retry affordance (an idiom this tree uses elsewhere) would be matched by
 *  `[data-close]`, and focus would be handed to a node the NEXT wipe destroys,
 *  putting the player back on `<body>` with nothing red anywhere. Excluding the
 *  wiped subtree is the guarantee the doc comment was making on its own.
 *
 *  WHAT IT COUPLES TO, stated rather than assumed: the window paints its shell
 *  chrome (the tab strip and the close button) as SIBLINGS of `.dr-body`, not
 *  inside it. If a shell control ever moved inside the body this would skip it
 *  and focus nothing, which fails CLOSED: the player keeps whatever focus they
 *  had rather than being handed a node the next wipe destroys. That is the safer
 *  of the two directions, and tests/store_focus_policy.test.ts asserts the
 *  premise on real shell markup so a layout change reds here rather than in
 *  production. */
function outsideBody(el: HTMLElement | null): HTMLElement | null {
  return el !== null && el.closest('.dr-body') === null ? el : null;
}

/** The family a store focus key belongs to: everything before its first dash.
 *  `charter-strongbox_charter_1` is `charter`, `armory-cinderbrand_sword` is
 *  `armory`. Both markup cores mint their keys that way through focusKeyAttr, so
 *  the prefix is a real grouping rather than a convention this file invented.
 *
 *  An UNDASHED key is its own family of one, and one exists: the top-up button's
 *  `topup`. That is the honest answer for a control with no section around it,
 *  and it is what makes a background degrade from it land back on itself rather
 *  than wander into a section the player was not reading. */
function focusFamily(key: string): string {
  const dash = key.indexOf('-');
  return dash === -1 ? key : key.slice(0, dash);
}

/** Hand focus back after the rebuild. Degrades in the order a buyer expects:
 *  the same control, then any other still-enabled keyed control in the grid,
 *  then the top-up button, which the store always paints. A paint the player did
 *  not ask for degrades only within the SAME family, so it can neither jump the
 *  scroller to another section nor drop a keyboard user to <body> while any
 *  neighbour survives. Focuses NOTHING when focus was not in this subtree to
 *  begin with, or when nothing in the permitted set survived. */
export function restoreStoreFocus(
  body: HTMLElement,
  plan: StoreFocusPlan,
  topUp: FocusRestoreCandidate | null,
): void {
  if (plan.focusKey === null) return;
  const keyed = [...body.querySelectorAll<HTMLElement>('[data-focus-key]')];
  const exact = keyed.find((el) => el.dataset.focusKey === plan.focusKey);
  if (plan.degrade) {
    // topUp is EXCLUDED from the middle rung, not merely repeated in it. It now
    // carries a key of its own (so a player standing on it is restored to it
    // exactly, instead of dropping to <body> the way every other unkeyed control
    // would), and it sits FIRST in the store body, so leaving it in `keyed` would
    // silently promote it ahead of "any other still-enabled keyed control in the
    // grid" and invert the ladder this comment describes. It stays the LAST rung.
    restoreFirstEnabled([
      exact,
      ...keyed.filter((el) => el !== topUp && !el.hasAttribute('data-buy-claudium')),
      topUp,
    ]);
    return;
  }
  const family = focusFamily(plan.focusKey);
  const siblings = keyed.filter((el) => focusFamily(el.dataset.focusKey ?? '') === family);
  restoreFirstEnabled([exact, ...siblings]);
}
