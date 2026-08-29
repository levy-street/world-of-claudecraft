// Pure, DOM-free decision core for tap mode (settings.touchTapMenus): what a
// press MEANS on any of the three touch gesture menus (the action radial, the
// consumables row, the menu strip). The DOM halves live in the three gesture
// controllers, which own no rule of their own here, so a Vitest drives every
// branch without a browser. Registered in tests/architecture.test.ts
// UI_PURE_CORES.
//
// WHY ONE CORE FOR THREE MENUS. Tap mode has to behave identically everywhere or
// it is not a mode, it is three dialects: touching the control opens, touching an
// item chooses, touching the control again runs its default (or closes the row,
// for a control that has no default), and touching outside dismisses. Three
// controllers each re-deriving that table would drift on the first fix. They ask
// this instead.
//
// Only the ANCHOR press depends on the setting: with tap mode off the anchor
// press belongs to the gesture layer, unchanged. Item and outside presses only
// ever arrive while a sticky menu is already open, which is a state assistive
// activation can reach with the setting off too.
//
// The one thing that differs per control is what its own anchor MEANS, which is
// the anchorRole below rather than a second table.

/** Where a press landed, relative to the menu it concerns. */
export type TapMenuPressTarget = 'anchor' | 'item' | 'outside';

/**
 * What the control's OWN press means, beyond opening its menu.
 *  - `action`: the control has a default action of its own (the radial's centre
 *    slot, the seat's first consumable), which a press runs while the menu is
 *    open. The historical behaviour, and the default.
 *  - `toggle`: the control only ever opens its menu (Quick Actions), so the
 *    press that follows the one that opened it is the way back out, and an
 *    outside press dismisses whether or not tap mode is on: with a plain tap
 *    able to open the row, a row with no tap-driven way out would strand a
 *    player who opened it by accident.
 */
export type TapMenuAnchorRole = 'action' | 'toggle';

/**
 * What a press does.
 *  - `open`: reveal the menu as a persistent, focusable one. Casts nothing.
 *  - `choose`: activate the revealed item at `index`.
 *  - `default`: run the control's default action (its centre slot, its first
 *    consumable). Never returned for a 'toggle' control, which has none.
 *  - `dismiss`: the player looked and chose nothing.
 *  - `gesture`: not tap mode; the press belongs to the gesture layer.
 *  - `none`: nothing to do (a press that cannot mean anything in this state).
 */
export type TapMenuPress =
  | { readonly kind: 'open' }
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'default' }
  | { readonly kind: 'dismiss' }
  | { readonly kind: 'gesture' }
  | { readonly kind: 'none' };

export interface TapMenuPressInput {
  /** settings.touchTapMenus, read live at press time. */
  readonly tapMenus: boolean;
  /** Whether THIS control's menu is open right now. */
  readonly open: boolean;
  readonly target: TapMenuPressTarget;
  /** Row position of an item press, in the order the items are seated. */
  readonly index?: number;
  /** What this control's own press means. Defaults to 'action'. */
  readonly anchorRole?: TapMenuAnchorRole;
}

/**
 * The whole tap-mode table, as one transition.
 *
 * An anchor press with the setting OFF stays with the gesture layer while the
 * menu is DOWN, whatever the role: that is what keeps the swipe working, since
 * the gesture layer resolves a bare tap at release rather than at the press. An
 * 'action' control keeps that answer while its menu is open too (the assistive
 * path, where the gesture layer's own guard ignores the press); a 'toggle'
 * control has nothing to arm there and takes the press as its way out.
 *
 * An outside press is a dismissal in tap mode, and for a 'toggle' control in
 * either mode, because a plain tap can open its row with the setting off. For an
 * 'action' control the document-level listener that reports one exists only
 * while tap mode holds a menu open, so the answer stays silence.
 */
export function resolveTapMenuPress(input: TapMenuPressInput): TapMenuPress {
  const toggle = (input.anchorRole ?? 'action') === 'toggle';
  if (input.target === 'anchor') {
    if (!input.tapMenus) {
      return input.open && toggle ? { kind: 'dismiss' } : { kind: 'gesture' };
    }
    if (!input.open) return { kind: 'open' };
    return toggle ? { kind: 'dismiss' } : { kind: 'default' };
  }
  if (input.target === 'item') {
    const index = input.index ?? -1;
    if (!input.open || index < 0) return { kind: 'none' };
    return { kind: 'choose', index };
  }
  if (!input.open) return { kind: 'none' };
  return input.tapMenus || toggle ? { kind: 'dismiss' } : { kind: 'none' };
}
