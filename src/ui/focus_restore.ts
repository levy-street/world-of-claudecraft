// The two mechanical halves of carrying keyboard focus across a full window rebuild.
//
// A painter that wipes its own subtree (`innerHTML = ''`, then a fresh createElement
// pass) destroys every control the player could be standing on. A keyboard player who
// pressed `+` has the button removed from under them and lands on <body>, unable to
// press it again. About a dozen src/ui painters answer that by hand, and each does the
// same two things in outline: before the wipe, remember WHICH control had focus; after
// it, focus the rebuilt equivalent, skipping any that came back disabled (#2528).
//
// "In outline" is the honest phrasing, because only the callers of this module key
// their controls off `data-focus-key` (professions_window migrated onto it when it
// gained action buttons). The others carry a different identity entirely:
// deeds_window a priority-ordered selector over four attributes, spellbook_window a
// four-branch chain (two class-plus-dataset pairs, then two bare attribute markers),
// claudium_window a discriminated union, bank_window a
// boolean plus a caret pair for its search box. Two more resolve the identity from a click
// handler's argument and never read activeElement at all (options_window, char_window).
// Migrating one of those means changing its rendered markup or its capture shape, not
// swapping a call, which is why #2528 scoped this to the set that already shares the
// attribute.
//
// What stays with the CALLER is the interesting half: which fresh control is the
// role-equivalent of the one that had focus, and what to degrade to when that one came
// back disabled. Those ladders are genuinely per-window (mailbox_window prefers the
// quantity input, town_focus_window walks the stepper pair outward before it leaves the
// row) and folding them in here would mean a switch over window identities. So this
// module owns only the parts every copy spells the same way, and the parts a copy can
// get subtly wrong: the activeElement narrowing, the containment check, and the
// disabled skip.
//
// DOM-touching by design (`document.activeElement` and the `instanceof` narrowing), so
// this is NOT a registered pure core and NOT a UI_PAINTER_HELPERS entry either (that
// contract bars `instanceof HTMLElement` outright). It is registered in UI_DOM_MODULES in
// tests/architecture.test.ts, the way ./focus_manager.ts is and for the same stated
// reason. Note that registration is unavoidable rather than a choice of style: even a
// version taking the document (or the already-read activeElement) as a PARAMETER still
// trips UI_DOM_CONSTRUCTOR_RE on the `instanceof HTMLElement` alone, so parameterizing
// would buy no exemption and would hand the one line each copy got wrong back to the
// copies. (./dialog_root.ts, the other micro-pattern lifted out of a dozen painters,
// really is unregistered, but only because it takes its element as a parameter AND does
// no narrowing.)
//
// Deliberately NOT FocusManager's focusability model. That manager's `canFocus` predicate
// is `isConnected && getClientRects().length > 0`, which is both a forced-reflow layout
// read (invisible to the per-file painter gate from in here) and a different question
// from the one the callers ask: they know their candidate is attached, and what they need
// to know is whether the rebuild disabled it. `disabled` it is, exactly as every copy
// spelled it.

/**
 * Anything a caller can hand back focus to. Structural rather than
 * `HTMLButtonElement`, because the two windows this was extracted from already need
 * more than one element type: town_focus_window's ladder is all buttons, but
 * mailbox_window's runs through the parcel's `<input type=number>` quantity field,
 * which is the candidate it most wants to keep. `disabled` is optional so a focusable
 * non-form node (a `tabIndex = 0` span, which several windows paint) is a legal
 * candidate too, and reads as never-disabled.
 *
 * TWO BOUNDARIES ON THE PREDICATE, both the caller's to respect:
 * - It is the IDL `disabled` property ONLY. `aria-disabled="true"` is a live idiom in
 *   this tree (bags_window paints deliberately focusable no-op buttons that way), and
 *   such a node reads as ENABLED here. A caller with aria-disabled rungs has to filter
 *   them out before it calls.
 * - Nothing checks whether a candidate is visible or attached. Both callers rebuild and
 *   then pass nodes from that fresh subtree, so the question does not arise; a caller
 *   that could pass a detached or hidden node would have `focus()` no-op on it and the
 *   walk would stop there. (This is deliberately NOT FocusManager's `canFocus`: see the
 *   header.)
 *
 * `focus(): void` and not `focus(options?: FocusOptions): void` on purpose. The seam's
 * policy is the bare call (stated on restoreFirstEnabled below), and the narrow signature
 * is what keeps a future caller from quietly reintroducing the per-window divergence
 * #2528 exists to end.
 */
import { POINTER_FOCUS_PARK_SELECTOR } from './pointer_blur';

/** The shared focus-key ATTRIBUTE, exported so an emit-only builder (a pure
 *  chrome module that writes the markup but never reads focus back) can
 *  spell the namespace from its one source instead of a stray literal; the
 *  reads in this module stay on dataset.focusKey, the same attribute through
 *  the DOM's own camelCase mapping. */
export const FOCUS_KEY_ATTR = 'data-focus-key';

export interface FocusRestoreCandidate {
  readonly disabled?: boolean;
  focus(): void;
}

/**
 * Remember the identity of the focused control inside `root`, to be handed to the
 * caller's own resolve-and-degrade ladder after the wipe. Returns null when there is
 * nothing to carry, which is the common case: focus is on the world, in another window,
 * or on a control inside `root` that carries no key.
 *
 * `root` is the container that is ABOUT TO BE REBUILT, not necessarily the window root:
 * mailbox_window rebuilds only its `#mail-parcels` list and passes that, so focus
 * elsewhere in the mailbox is correctly left alone.
 *
 * The identity is read off `dataset.focusKey` (`data-focus-key="..."` in markup), ONE
 * flat namespace shared by every window, which is exactly why the containment check
 * lives HERE and not in the caller: mailbox_window keys its parcel steppers
 * `<itemId>:<role>`, town_focus_window keys its allocation steppers
 * `<component>:<role>`, and professions_window keys its action buttons
 * `recharge:<professionId>` and `slot:<professionId>:<effectId>`, all the same shape
 * under the same attribute name. A window that read the key without checking
 * containment would let its own repaint pull focus out of another open window.
 *
 * `instanceof HTMLElement` rather than a cast: `document.activeElement` is typed
 * `Element | null`, and the `dataset` read is only sound on an HTMLElement (an
 * `Element` has no `dataset` at all). focus_manager.ts narrows the same way.
 *
 * The one value this does NOT normalize: `data-focus-key=""` returns the empty string,
 * not null, because that is what the attribute says. No caller writes an empty key today,
 * but the two guard the result differently (`if (focusKey)` versus
 * `if (focusKey !== null)`), so a caller that could mint one must decide which it means
 * rather than inherit whichever its guard happens to be.
 */
/**
 * The one place the `data-focus-key` ATTRIBUTE is built, so a markup emitter and
 * {@link captureFocusKey} cannot disagree about the namespace's spelling. Returns
 * a leading-space attribute fragment ready to concatenate into an element's
 * opening tag, with the key escaped for a double-quoted attribute context.
 *
 * It exists because a pure markup module can legitimately EMIT a key without
 * ever reading focus: pushing the emission through this seam keeps such a module
 * inside the namespace's single-reader rule instead of hand-spelling the
 * attribute beside it.
 */
export function focusKeyAttr(key: string): string {
  return ` data-focus-key="${key.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
}

export function captureFocusKey(root: HTMLElement): string | null {
  return focusedWithin(root)?.dataset.focusKey ?? null;
}

/**
 * Resolve one focus key in a rebuilt subtree by exact dataset equality.
 *
 * Keys may include server-supplied item ids, so the value is deliberately never
 * interpolated into a CSS attribute selector. The literal selector discovers the
 * namespace members; the DOM's dataset value then performs the identity match.
 */
export function findFocusKey(root: ParentNode, key: string): HTMLElement | null {
  for (const candidate of root.querySelectorAll(`[${FOCUS_KEY_ATTR}]`)) {
    if (candidate instanceof HTMLElement && candidate.dataset.focusKey === key) return candidate;
  }
  return null;
}

/**
 * The focused element, if it is inside `root`, else null.
 *
 * This is the narrowing-plus-containment half of {@link captureFocusKey} with the
 * `data-focus-key` read left off, for a caller that carries a DIFFERENT identity and so
 * cannot use the key: `form_draft.ts` keys on the field's own `id` / `data-*` because it
 * has to find that element again to write a captured VALUE back into it, not only to
 * focus it, and the same key has to serve both. That is the "different identity entirely"
 * case the header above describes, and the reason it is exported here rather than
 * re-derived there is the other half of the same sentence: the containment check and the
 * `instanceof` narrowing are the two lines a copy gets wrong, and `data-focus-key` is not
 * what makes them worth centralizing.
 *
 * `<body>` is refused explicitly: for an ELEMENT root the containment check already
 * excludes it (`root` is a descendant of `<body>`), but `root` may be any ParentNode
 * (form_draft.ts keys its own fields and passes the container it is handed), and a
 * Document root does contain its body.
 *
 * A DIALOG ROOT is never "a focused control within": the pointer-only focus drop
 * (src/ui/pointer_blur.ts) parks pointer focus on the nearest POINTER_FOCUS_PARK_SELECTOR
 * root so the Tab trap stays armed, and a repaint ladder that read a parked root as a
 * focused control would resolve no key and fall through to its Close rung, planting focus
 * on Close after every mouse click (the #2377 double-fire family). Refused by identity (the
 * root passed in) AND by the park's own shape (the same selector, so the reader can never
 * drift from what the drop parks on, and a root nested inside `root` is refused too).
 * Repaint ladders that hand-roll `root.contains(active)` must use this helper instead
 * (deeds_window.ts, bank_window.ts and form_draft.ts do); the bare containment reads that
 * remain in src/ui are trap boundary checks or dataset-keyed reads that cannot resolve a
 * root into a Close fallback, and tests/focus_restore.test.ts lists each one with its reason.
 */
export function focusedWithin(root: ParentNode): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === root) return null;
  if (active === active.ownerDocument.body) return null;
  if (active.matches(POINTER_FOCUS_PARK_SELECTOR)) return null;
  return root.contains(active) ? active : null;
}

/**
 * Focus the first candidate that is present and not disabled, in the caller's order,
 * and stop there. Focuses nothing when every candidate is absent or disabled.
 *
 * The disabled skip is the load-bearing part, and the reason a bare
 * `candidates[0]?.focus()` will not do: the control the player just activated can
 * legitimately come back DISABLED by the rebuild it caused (stepping the last point off
 * a component disables its `-`, spending the last one disables every `+`), and a
 * disabled control cannot take focus, so a caller that ignored this would silently drop
 * focus to <body> in exactly the case the whole idiom exists for.
 *
 * `null` AND `undefined` are both accepted and skipped, because both spellings of
 * "that control does not exist in the rebuilt tree" are live at the call sites:
 * `querySelector` returns null, a `Map.get` miss and an unset optional field return
 * undefined.
 *
 * A bare `focus()`, deliberately NOT `focus({ preventScroll: true })`, and this is now
 * the ONE place that decision is spelled: every hand-rolled copy already agreed on the
 * bare call, but only town_focus_window recorded why. The reason is that a caller
 * restores its scroll offset before calling here, and `focus()` scrolling its target
 * into view is what lets a DEGRADED target (a rung further down the ladder, which the
 * player may not be looking at) win over that offset. Focus must be visible (WCAG
 * 2.4.11), and the common case cannot conflict: the control being refocused is the one
 * the player was already on, so it is in view and `focus()` scrolls nothing.
 *
 * THAT LAST PREMISE HAS ONE KNOWN EXCEPTION, and it is recorded here because this is
 * the one place the decision is spelled. Bank Storage phase 18 made `#bank-window`
 * itself a scroller on short phones, so the control a player was already on CAN be out
 * of view: they scroll away from the search box while it still holds focus. A repaint
 * then restores the offset and a bare `focus()` immediately spends 127px of it
 * (measured). The bank window passes `preventScroll` on THAT path only, and the
 * reasoning above is why it is not done here: this helper serves a DEGRADE ladder, and
 * a degraded target is one the player may genuinely not be looking at, so scrolling it
 * into view is the behaviour that keeps focus visible. A caller re-focusing the SAME
 * control it captured is the case where the offset should win instead.
 *
 * SYNCHRONOUS on purpose, unlike FocusManager.restore, which defers a tick to win
 * against a browser's own post-close focus move. There is no competing move here: the
 * caller has just finished rebuilding its own subtree, and deferring would let a Tab
 * press in between land on <body>.
 */
export function restoreFirstEnabled(
  candidates: ReadonlyArray<FocusRestoreCandidate | null | undefined>,
): void {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate.disabled) continue;
    candidate.focus();
    return;
  }
}
