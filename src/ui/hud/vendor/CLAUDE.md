<!-- Area-scoped: src/ui/hud/vendor/ only. src/ui/CLAUDE.md and
     src/ui/hud/CLAUDE.md stay canonical for the domain-extraction, painter,
     and i18n rules. -->

# src/ui/hud/vendor/: the vendor window family

Four windows on one shape: vendor, heroic vendor, train, and the Maker's
Bond unbind service, each a pure view core (`*_view.ts`, DOM-free) plus a
thin window painter, exported only through `index.ts`.

## The row idiom (shared; extend it, do not fork it)
- Rows are inset cards: the `--color-border-showcase` hairline token, the
  shared dark fill, and the `.crafting-recipe-socket` quality-glow socket in
  its small variant.
- Price rendering is stateful: the `.vi-price-chip` gold fee chip appears on
  AFFORDABLE rows only; an unaffordable fee keeps the plain error-tint price
  (readable under the disabled opacity); locked rows keep the muted plain
  price; known rows are price-free. Pinned by
  `tests/train_window_painter.test.ts` plus the train/unbind hud suites.
- Train affordability must stay live against the purse. Online, every
  inventory/purse delta re-prices the whole open service-window family
  (heroic vendor, train, and unbind included) through
  `Hud.repaintOpenServiceWindows` on the `Hud.onInventoryChanged` edge
  (#2373); offline the ladder converges through the Learn click and
  trainResult repaints instead. `buildTrainView` also reserves the fee of
  every pending or confirmed Learn the MIRRORED known set does not answer
  yet (`availableTrainCopper`), so sibling rows disable on the first click
  and never double-reserve an already-debited purse (mirrored knownness and
  the copper debit arrive together in both hosts). The unbind list re-prices
  on the same hook but keeps no in-flight reserve of its own: the confirm
  dialog narrows the same race without closing it (a second confirm can
  still beat the first fee's mirror), an accepted gap while the exposure
  stays a deliberate two-step click. Pinned by `tests/train_view.test.ts`
  and `tests/train_window_hud.test.ts`.
- Every service painter carries keyboard focus across its full-subtree
  rebuild (`focus_restore.ts`): required since repaints became uninitiated
  (an inventory delta can land mid-keyboard-run), restoring the exact
  `data-focus-key` control, then outward row neighbors, then the close
  button. The neighbor walk is deliberate for uninitiated repaints too:
  staying in the ladder beats dropping to Close (the vendor precedent), and
  every action button's aria-label announces its name and fee before any
  activation. Pinned by `tests/train_window_painter.test.ts`,
  `tests/professions_commissions_ui.test.ts`, and
  `tests/vendor_window_painter.test.ts`.
- Recipe knownness resolves through the shared `train_view.ts` viewer
  predicates (`isRecipeKnownForViewer`); never a second knownness rule.

## Cascade trap (this family specifically)
Vendor-family rules with a pseudo-class (`.vendor-item:disabled:hover` and
kin) silently outrank single-class card rules. Any new card-level fill or
border must be restated at matching specificity for the hover and disabled
arms, or the pseudo-class arm blanks it. Custom controls that replace native
inputs must join the shared `:focus-visible` ring group in `base.css`
(`tests/focus_visible_guard.test.ts` cannot see a MISSING rule).
