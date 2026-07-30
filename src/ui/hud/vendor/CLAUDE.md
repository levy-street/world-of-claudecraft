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
- Recipe knownness resolves through the shared `train_view.ts` viewer
  predicates (`isRecipeKnownForViewer`); never a second knownness rule.

## Cascade trap (this family specifically)
Vendor-family rules with a pseudo-class (`.vendor-item:disabled:hover` and
kin) silently outrank single-class card rules. Any new card-level fill or
border must be restated at matching specificity for the hover and disabled
arms, or the pseudo-class arm blanks it. Custom controls that replace native
inputs must join the shared `:focus-visible` ring group in `base.css`
(`tests/focus_visible_guard.test.ts` cannot see a MISSING rule).
