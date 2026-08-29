# Deed Heraldry: implementation plan

Turn the Book of Deeds wearable border into a two-scale MMORPG identity reward:
a compact forged seal and shallow pointed name plaque in the world, then a richer
heraldic reveal on the player/target frame, inspect card, and picker. Cosmetic
identity only. No power and no actionable information.

The filename remains `deed-border-cartouche/implementation-plan.md` because it
is the continuity packet for the existing branch. The Phase 1-4 cartouche is
implemented and QA-green, but the post-Phase 4 art review rejected it as the
shipping visual direction: it reads as UI outline, not a reward worth wearing.
Phases 5-9 are the completed refinement plan and supersede the old visual
target. The per-phase execution prompts were removed at contribution close;
their full text remains available in git history.

Companion documents: `docs/design/deeds.md` (reward definition),
`docs/design/reliquary.md` (Eternal Spoils / `reliquary_gilt`),
`docs/design/graphics-settings-fairness.md` (identity vs bloom),
`DESIGN.md` sections 1, 3, 4, 7.13, and 13 (crafted fantasy, gold is
structural, nameplates, contracts), `docs/qa-gate.md`, and the approved
`art-direction.md` in this packet.

This packet does not change who earns a border, how it is stored
(`PlayerMeta.activeBorder` is still a deed id), or the wear command
(`deed_set_border`). It changes how a worn slug is drawn.

## Why nine phases

Phases 1-4 are completed implementation history. They established the saved
state, pure geometry seam, palette table, fairness pins, and screenshot
coverage, but their visual result is not accepted for shipping.

1. **Cartouche chassis.** Complete, retained as history.
2. **QA: chassis.** Complete, retained as history.
3. **Cartouche identity and family.** Complete, retained as history.
4. **QA: cartouche identity.** Complete technically; visual review reopened
   the feature.
5. **World Deed Heraldry.** Replace the outline cartouche with the seal and
   quiet name ribbon. Reconcile layout and tests deliberately.
6. **QA: world heraldry.** Judge nameplate distance first, then geometry,
   fairness, allocation, declutter, and screenshot evidence.
7. **Social reveal family.** Build the player/target header, refined circular
   portrait treatment, inspect banner, and meaningful picker preview.
8. **QA: heraldry family.** Prove beauty, identity, accessibility, theme and
   tier fairness, performance, and the complete social experience.
9. **v0.40 and plaque refinement.** Integrate the current release and resolve
   the generated direction as one pointed plaque family at three UI scales.

Each new build slice has a dedicated QA phase. Phase 5 must not start the
social surfaces, and Phase 7 must not begin until the world token is accepted.
The contribution is not ready for a PR until Phase 9 is green.

## Current behavior (ownership)

| Surface | What it does today |
|---|---|
| `src/ui/deed_border_view.ts` | Slug -> `{ frame, edge, glow, motif }`. Four reward slugs map to catalogue antique brass, vault gold, ward teal, and laurel green. |
| `src/render/nameplate_canvas.ts` `drawBorderAccent` | Phase 4 cartouche: midnight well, multi-line perimeter, brackets, clasp, and tiny side motif around name + title. Technically correct, visually too outline-led. |
| `src/render/nameplate_painter.ts` | Resolves `entity.border` through `deedBorderSlug` on the same cadence as `title`. Players only. |
| `src/styles/hud.css` `.portrait-wrap[data-border]` | Circular ring plus a small 12-o'clock clasp. The clasp can read as a checkbox; no heraldic target-name header exists. |
| `src/styles/shell.css` `.inspect-name[data-border]` | Enlarged CSS cartouche around the name only. It does not create a ceremonial inspect reveal. |
| `src/ui/deeds_window.ts` Titles and Borders shelf | Earned options show three anonymous color stripes; there is no live surface preview. |
| `scripts/pr_shot_targets.mjs` | Working recipes for nameplate, picker, and inspect; they need heraldry labels, dependencies, and Phase 5/7 evidence variants. |

Pinned today: shapes only (no per-slug sprite), shared `extraLift` 14 on both
y-walks, declutter 32 / 34, unique hex literals
(`tests/deed_border_accent.test.ts`), forced-colors collapse to `Canvas` /
`CanvasText`, identity is tier-invariant, and only bloom sheds. Phase 5 may
replace the geometry literals through the explicit E37-E46 supersession path.

## Desired behavior

A worn reward draws **Deed Heraldry**. At world distance, a forged 16-18px
seal sits immediately left of the name on a shallow midnight ribbon. The seal
contains the existing catalogue, vault, ward, or laurel motif at a scale where
its silhouette reads. The ribbon owns the name row only. It has a quiet material
grain and at most a fine structural metal edge. It never becomes a full rounded
rectangle around name + title.

On interaction, the same seal, metal, and motif-derived pattern expand into a
richer name header on the player and target frames and a ceremonial inspect
banner. The Book of Deeds picker shows the seal, a material sample, and live
surface previews instead of anonymous stripes.

Gold stays structural: a fine antique edge, never a thick yellow bar and never
a large fill (`DESIGN.md` 1.4 and 3). The world remains the hero. Health,
resource, guild, cast, markers, combo, raid marks, level, combat state, and
other gameplay semantics stay outside the cosmetic treatment.

The borderless plate and frames are unchanged. A worn reward is a special
identity state, not a restyle of every player or every HUD component.

## Locked decisions for Phases 5-8

1. **The art direction is approved.** `art-direction.md` and its concept image
   define the hierarchy and reward feel. Do not regress to a perimeter outline.
2. **Two scales, one identity.** Compact seal + ribbon in the world; richer
   player/target and inspect reveal on interaction.
3. **Four slugs only.** `curators_gilt`, `reliquary_gilt`, `deepward`, and
   `prestige_laurels`. No new deed, reward, slug, or motif.
4. **Seal first.** The existing catalogue, vault, ward, or laurel motif becomes
   the readable face of a forged medallion. It must not remain tiny side noise.
5. **Name ribbon only.** The ribbon owns the name row. The chosen title returns
   to its secondary text line outside. Guild and all gameplay rows stay outside.
6. **No full outline.** Remove the cartouche perimeter, corner brackets, and
   central nameplate clasp from the world token. Fine metal may edge or join the
   ribbon, but it cannot box the whole nameplate.
7. **Shared material, distinct identity.** Keep a common midnight well and
   forged construction. Distinguish slugs through existing color, seal
   silhouette, and a quiet pattern derived from the same motif.
8. **Catalogue stays antique brass.** Keep `#c9b17a` / `#2a2214` / `#f3ebcf`.
   It must not collide with Eternal Spoils `#f4ca43` or elite/quest `#f2c84b`.
9. **Player and target are social reveals, not HUD reskins.** Keep portraits
   circular. Put the seal at the portrait/name joint and pattern the name header
   only. Do not recolor or wrap bars.
10. **Inspect is the ceremonial canvas.** It shows the same seal/material plus
    the real player name, equipped title when present, and localized deed name.
11. **Picker teaches the reward.** Reuse `.deed-title-option`; earned options
    show the actual seal and material. None is empty. Selection drives a live
    world and interaction preview. The mobile floor remains 40x40.
12. **Borderless stays clean.** No seal, ribbon, header pattern, special ring,
    inspect banner, or fake picker material leaks into the empty state.
13. **Identity on every tier.** Seal, ribbon, pattern, and structural edge render
    at low. Only bloom may shed. Prefer no motion at any tier.
14. **Hot path stays allocation-free.** Shapes only for the world token. No
    generated bitmap, per-slug frame sprite, canvas gradient allocation, DOM
    read, filter, or animation in the per-frame path.
15. **Module-first.** Replace the old geometry behind a pure sibling core. Keep
    the canvas thin and under its monolith ceiling. Static motif primitives have
    one owner and are reused by cold surfaces rather than redrawn four ways.
16. **Old geometry numbers are not new visual locks.** `#14110c` near 0.4 alpha
    remains the material starting point. Phase 5 may remeasure pad, seal size,
    radius, and `extraLift`; it must name and decisively pin the accepted values.
17. **Tests change honestly.** E1-E36 remain historical coverage. When new
    behavior intentionally invalidates an old literal, replace it and record the
    supersession; never weaken it just to make the new design pass.
18. **Screenshots are QA deliverables.** Phase 6 owns `phase-05/`; Phase 8 owns
    `phase-07/`. Normal nameplate distance is the first acceptance view.
19. **Player-facing copy is localized.** If "Deed Heraldry" or preview labels
    ship, add proper `t()` keys and satisfy the current M16/i18n contract.
20. **No sim, server, wire, or IWorld change.** The deed id already travels. If
    a phase thinks it needs one, stop and surface it.

## Architecture (componentize first)

```
deed_border_view.ts           slug -> palette + motif + static seal identity
nameplate_heraldry_core.ts    seal/ribbon layout and caller-owned geometry
nameplate_canvas.ts           thin hot-path consumer
unit_frame_painter.ts         elided slug/palette/motif writes
hud.ts + hud.css              player/target name-header reveal
inspect_view/window + shell   ceremonial inspect banner
deeds_window + components     seal options + event-driven live preview
pr_shot_targets.mjs           world, target, inspect, picker evidence
```

Phase 5 replaces `nameplate_cartouche_core.ts` with
`nameplate_heraldry_core.ts`; do not leave two active geometry systems. The new
core is DOM/Three/i18n-free, registered in `RENDER_PURE_CORES`, and fills a
caller-owned result containing:

- name-row content origins and secondary title baseline
- shallow ribbon bounds/path and its fine structural edge
- forged seal bounds and the transform for normalized motif primitives
- any tiny joint/rivet primitives approved by the screenshots
- measured `extraLift` consumed by both base and emote y-walks

The allocation rule remains: the world hot path creates nothing per plate per
frame. Static motif primitives have one owner. If Phase 7 needs inline SVG on a
cold DOM surface, derive it from those static primitives in a pure UI helper;
do not duplicate four hand-authored symbols in CSS, HTML, and canvas.

`src/ui/` already imports into the nameplate canvas (`deed_border_view`,
`text_sprite_cache`). Keep that direction. `deed_border_view` must not import
render. Do not grow `nameplate_canvas.ts` past its monolith ceiling.

The player/target, inspect, and picker surfaces consume the same palette and
motif discriminant through custom properties and `data-*` attributes. CSS owns
cold-surface material and pattern. It never owns a second per-slug palette.

## Historical edge-case matrix (Phases 1-4)

Every row is a Vitest with a decisive assertion (a wrong layout, a
missing primitive, or a leaked palette hex must fail the test). Visual
confirmation is extra, never a substitute. Combinations marked
"bordered + borderless" are run twice: once with a valid slug, once with
`border: ''`.

| Id | Case | Required read | Phase |
|---|---|---|---|
| E1 | Name only | Tight plaque, symmetric pad, name optically centered. | 1 |
| E2 | Name + title | Title inside the well, centered on `screenX`, about 2px gap above the title. | 1 |
| E3 | Title wider than name | Plaque grows to the title. Name row stays a centered group. | 1 |
| E4 | Discord portrait (24px) | Row height follows the portrait. Name/chips vertically centered with it. Portrait does not kiss the well floor. | 1 |
| E5 | Holder and/or dev badge (15px), no portrait | Same centering against the 15px stack. | 1 |
| E6 | All badges (holder + dev + Discord) | Group still centered. Horizontal pad keeps hardware off the first badge. | 1 |
| E7 | AI chip and/or Cheater chip | Stay in the name row, inside the well, vertically centered. | 1 |
| E8 | AFK prefix and/or `[ROLE]` in the name | Width follows the measured string. No clip. | 1 |
| E9 | Dev-tier name outline | Drawn on top of the well, never under it. | 1 |
| E10 | Current target | 14px name / 18px min row (existing). Plaque scales with the row, not a second layout. | 1 |
| E11 | Guild present | Guild line stays outside, below the health bar and above the cartouche. Clearance preserved. | 1 |
| E12 | HP / cast / combo / raid mark | Unchanged slots, outside the plaque. Raid mark and emote clear the clasp. | 1 |
| E13 | Dead player | HP hidden (existing). Plaque still draws if a border is worn. | 1 |
| E14 | Stealth | Existing 0.55 opacity applies to the whole plate, plaque included. | 1 |
| E15 | Unknown / empty / title-deed slug | No plaque (existing `borderAccent` null / `deedBorderSlug` `''`). | 1 |
| E16 | Forced colors | Well, hardware, and metal collapse to `Canvas` / `CanvasText`. No palette hex survives. | 1 |
| E17 | `uiScale` / DPR | Existing canvas backing-store path. Geometry in CSS pixels. extraLift does not double-scale. | 1 |
| E18 | Self plate hidden | Existing suppress. No plaque leak. | 1 |
| E19 | Hostile player with a border | Red name inside the same plaque. Border does not recolor to hostile. | 1 |
| E20 | Mob / NPC / object | Never a border (existing player-only resolve). | 1 |
| E21 | Borderless plate | No well, no hardware, title stays on its own line. Screenshot-identical in spirit. | 1 |
| E22 | Emote y-walk | `drawEmote` uses the same `extraLift` as `drawBase`. Bubble sits above the clasp. | 1 |
| E23 | Flip every slug | Sprite count stays flat. No per-slug raster. | 1 |
| E24 | Two bordered players stacked | Declutter Y threshold / stack offset clear the new extra lift. Pin the numbers. | 1 |
| E25 | Low graphics preset | Well, edge, hardware (and Phase 3 motif) still draw. Bloom is 0. | 1 / 3 |
| E26 | Higher graphics preset | Identity unchanged. Bloom / clasp glint may appear via `--fx-shadow`. | 1 / 3 |
| E27 | Theme presets (classic, midnight, parchment, highContrast) | Canvas metal is static (already). Inspect/picker metal still reads on parchment (the light-panel acid test). | 3 |
| E28 | Picker None | Empty, not a fake metal swatch. | 3 |
| E29 | Picker earned + active | Swatch uses the live palette. Active + focus-visible rules stay. Mobile tap target 40x40. | 3 |
| E30 | Inspect header | Same family (well + edge + clasp). Forced-colors arm stays. | 3 |
| E31 | Portrait ring + clasp | Circle stays a circle. Clasp at 12 o'clock. Level chip and combat flash stay above (`z-index` 3 and 4). | 3 |
| E32 | Motif distinctness | Four slugs emit four different side-primitive sets. Color uniqueness scan still green. | 3 |
| E33 | Catalogue brass vs Eternal Spoils gold | `curators_gilt` does not collide with `reliquary_gilt` or `#f2c84b`. | 3 |
| E34 | Reduced motion | No new motion. If any glint is animated, it honors `prefers-reduced-motion`. Prefer no animation. | 3 |
| E35 | Char sheet refresh | `activeBorder` still busts the sheet sig (`char_sheet_sig_core.ts`). No visual regression required beyond that. | 3 |
| E36 | ClientWorld / online | No IWorld change. Worn slug still arrives on the entity. If a phase touches `world_api` or the wire, stop. | 2 / 4 |

E1-E36 explain and pin the implemented cartouche. They remain history, not the
acceptance target for Phases 5-8. Phase 5 may replace assertions that directly
require title-inside, perimeter brackets, the central clasp, old motif
placement, or old geometry literals. It must preserve or replace the behavioral
invariants those tests protected: centering, badge clearance, y-walk agreement,
declutter, no sprites, forced colors, borderless behavior, and no wire drift.

## Active edge-case matrix (Phases 5-9)

Every row needs a decisive automated assertion and the visual rows also need
named screenshot evidence. Phase 6 maps E37-E46. Phase 8 maps E47-E58.
The post-v0.40 plaque refinement maps E59-E63 without superseding any earlier
behavioral contract.

| Id | Case | Required read | Phase |
|---|---|---|---|
| E37 | World silhouette | Worn state emits one forged seal plus a shallow name ribbon; no full perimeter, four corner brackets, or central clasp primitive survives. | 5 |
| E38 | Name + secondary title | Ribbon owns the name row only. Title is centered on its secondary line outside the ribbon. | 5 |
| E39 | Name-row variants | Long/Unicode name, AFK/role prefix, AI/Cheater chip, and 15/24px badges neither collide with the seal nor move the name group off `screenX`. | 5 |
| E40 | Four seal identities | Catalogue, vault, ward, and laurel use four distinct normalized primitive sets that remain distinguishable without color. | 5 |
| E41 | Gameplay slots | Guild, HP, cast, combo, raid mark, quest marker, and emote keep their existing order and clearance. The reward never paints around them. | 5 |
| E42 | Borderless / stale | Empty, unknown, removed, or title-reward ids emit no seal/ribbon and use the unchanged secondary-title path. | 5 |
| E43 | Reaction and state | Friendly/hostile name color, current-target size, dead state, stealth opacity, and self-hide behavior survive the new geometry. | 5 |
| E44 | Scale and y-walk | CSS-pixel geometry does not double-scale with DPR/uiScale. `drawBase` and `drawEmote` consume the same newly measured `extraLift`. | 5 |
| E45 | Declutter | Two nearby heraldry plates clear each other using newly measured and literal-pinned Y threshold/stack values. | 5 |
| E46 | Hot-path and fairness | No per-frame allocation, raster/sprite, gradient, filter, tier input, or governor input. Seal/ribbon survive low; forced colors use system colors. | 5 / 6 |
| E47 | Player-frame reveal | A worn player gets the same seal and restrained name-header material; borderless player frame remains unchanged. | 7 |
| E48 | Target-frame reveal | A bordered player target gets the same seal at the portrait/name joint and pattern on the name header only. Mobs/NPCs and target-of-target do not inherit it. | 7 |
| E49 | Unit-frame semantics | Portrait stays circular. Level, elite, combat flash, title, sanction, HP, resource, absorb, cast, and debuffs keep hierarchy, color, and z-order. | 7 |
| E50 | Portrait hardware | The hollow 12-o'clock checkbox clasp is gone or transformed into clearly integrated hardware; no square replaces the circle. | 7 |
| E51 | Inspect banner | In-range bordered inspect shows seal, restrained pattern, real name, equipped title when present, and localized granting-deed name. Borderless and remote cards stay clean. | 7 |
| E52 | Inspect constraints | The banner does not dominate the paperdoll, standing, flair badges, or equipment and remains readable on desktop/mobile. | 7 |
| E53 | Picker options | Earned options show canonical seal + material + existing deed name. None is empty. Shared focus/active semantics and 40x40 touch floor survive. | 7 |
| E54 | Picker live preview | Selection updates representative world and interaction previews from the live palette/motif without equipping until the existing action fires. | 7 |
| E55 | Family single source | One slug resolves to the same palette and motif on world, player, target, inspect, and picker; no second per-slug color table or hand-copied symbol set exists. | 7 |
| E56 | Themes and contrast | Classic, midnight, parchment, highContrast, and forced colors keep the name readable, the seal identifiable, and selection visible. | 7 / 8 |
| E57 | Tier and motion | Full identity exists at low and high. Only bloom may differ. No continuous animation; reduced motion has nothing essential to remove. | 7 / 8 |
| E58 | Persistence and wire | Equip/unequip, slug swap, character-sheet refresh, reconnect, and online mirror still use `activeBorder`; no sim/server/wire/IWorld change. | 7 / 8 |
| E59 | Shared plaque silhouette | One frozen CSS authority binds each scale to fixed-pixel hardware: compact and mirrored use an 8px tip / 4px notch, ceremonial uses symmetric 16px shoulders, and the attached provenance tab uses symmetric 10px shoulders. Long localized names do not stretch any end. | 9 |
| E60 | World plaque geometry | The world token is a six-point plaque with the existing round seal, one quiet inset glint, no rounded rectangle, and the retained 7/1 pad, 18px seal, protected 2px seal/plaque gap, hidden 2px joint bridge, and 8px lift. | 9 |
| E61 | Interaction-scale plaque | Player and target plaques span the existing name-header column, mirror correctly, center the name, and leave portrait, level, bars, title, sanction, cast, and auras unchanged. | 9 |
| E62 | Cold-surface plaque family | Picker previews and inspect use the same silhouette/material family across desktop, mobile, Parchment, low/high, and forced colors. Inspect remains subordinate to the paperdoll. | 9 |
| E63 | Capture isolation | Intentional screenshot page closes clear the v0.40 entry crash probe before the next storage seed, so tier evidence cannot silently step down. | 9 |

Phase 5 must remeasure `extraLift` and the declutter constants from the new
world geometry. The old 14 / 32 / 34 literals remain history until replaced by
the accepted Phase 5 numbers. Both y-walks and every decisive test move in the
same change.

## Standing QA contract (every phase)

Build phases write the tests. QA phases prove the tests are real. For the active
program, Phase 5 owns E37-E46 and Phase 7 owns E47-E58.

A test is decisive when a wrong implementation fails it. Forbidden:
constant-self-comparison, asserting a function equals itself, pinning
only that a function was called, or a snapshot of an object the test
just built. Load-bearing numbers (pad, extraLift, badge sizes 15 and 24,
title gap, well alpha) are pinned to literals.

Graphics-tier contract, pinned, not implied:

- Seal, ribbon, pattern, fine edge, and integrated hardware have no `gfx` /
  governor / effects-profile input. Extend the existing path scan in
  `tests/deed_border_accent.test.ts` to every new module.
- The only tier-scaled quantity is bloom via `--fx-shadow` (already 0 at low).
  Phases 5 and 7 must not add another shed path that hides identity.
- QA screenshots seed `graphicsPreset: 1` unless the shot is a deliberate
  low-vs-high comparison.

Commands that close a QA phase:

```
npx tsc --noEmit
npx vitest run <the phase test list>
npx vitest run tests/architecture.test.ts tests/localization_fixes.test.ts tests/monolith_budget.test.ts
npx @biomejs/biome check <changed files>
node scripts/gate_select.mjs
```

Reviewers (read-only, fresh, not the implementer):

| Reviewer | When |
|---|---|
| `$woc-qa` / `docs/qa-gate.md` | Every QA phase; parent runs deterministic commands once. |
| `woc_test_coverage` | Every QA phase. Map each active matrix id to a named decisive test and audit intentionally retired pins. |
| `woc_frontend` | Every QA phase. Judge normal-distance craft, family, responsive layout, themes, forced colors, and fairness. |
| `woc_sim_architecture` | Only if `src/sim/` was touched unexpectedly; stop before proceeding. |
| `woc_cross_platform` | Only if `world_api`, wire, or `ClientWorld` was touched unexpectedly; stop before proceeding. |

A QA phase is red if any matrix id in play has no decisive test, if the
selective gate is red, if screenshots are missing, or if a reviewer
finds a coverage gap the implementer cannot refute from the diff.

## Phase 1: cartouche chassis

**Outcome.** A worn border is a centered ink plaque around name + title,
with shared corner brackets and a top clasp, on today's palettes. Every
Phase 1 matrix row (E1-E26 as applicable) has a decisive test. Emote and
raid-mark anchors stay correct.

**In scope.**

- Add `src/render/nameplate_cartouche_core.ts` and
  `tests/nameplate_cartouche_core.test.ts`.
- Register the core in `RENDER_PURE_CORES`.
- Rewire `drawBorderAccent` / `drawNameRow` / `drawBase` / `drawEmote`
  to consume `extraLift` and the content origins. Title is drawn inside
  the plaque when a slug is active; the borderless title path is
  unchanged.
- Vertically center name-row text with badges.
- Symmetric pad. Shared hardware (brackets + clasp) as canvas shapes.
- Shared ink well fill.
- Replace the "adds no vertical space" pin with the shared-lift pin.
- Review declutter Y constants (E24).
- Forced-colors: well + hardware use the same system pair.
- Update `tests/nameplate_canvas.test.ts` (stroke family, no new sprites,
  emote walk, forced-colors, title-inside, slug flip).
- Touch `tests/deed_border_accent.test.ts` so the canvas source-scan
  still describes the real drawer, and so the fairness scan still proves
  no tier input.
- Allocation / reference-stability pin on the core result record.
- Extend `nameplate-border` in `scripts/pr_shot_targets.mjs` `when` to
  include `render/nameplate_canvas` and `render/nameplate_cartouche_core`
  so later diffs actually shoot the plate.

**Out of scope.** Motifs, palette retune, picker swatches, inspect/ring
clasp, new i18n, sim/server/wire, committing screenshots (that is Phase 2).

**Validation (implementer, before handing to QA).**

```
npx tsc --noEmit
npx vitest run tests/nameplate_cartouche_core.test.ts tests/nameplate_canvas.test.ts tests/nameplate_ai_tag.test.ts tests/deed_border_accent.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts
npx @biomejs/biome check --write src/render/nameplate_cartouche_core.ts src/render/nameplate_canvas.ts tests/nameplate_cartouche_core.test.ts
```

**Exit into Phase 2.** Matrix E1-E26 tests exist and are green. Emote walk
locked to `extraLift`. No new sprites. Borderless path has an explicit
"no well / no hardware" pin. Fairness scan still green. `progress.md`
and `state.md` updated. No Phase 3 work in the tree.

Historical starter prompt removed at contribution close.

## Phase 2: QA, chassis

**Outcome.** An independent pass proves Phase 1 did not miss a matrix
row, a graphics-tier leak, a y-walk desync, or a "looks fine" test.
Before/after screenshots exist. Reviewers are clean or their findings
are fixed and re-checked.

**In scope (read-only first, then fix-forward only for confirmed gaps).**

- Coverage map: every E1-E26 id to a test name in
  `progress.md`. Any unmapped id is a Phase 2 defect.
- Re-run the Phase 1 test list plus `tests/localization_fixes.test.ts`.
- `node scripts/gate_select.mjs`.
- Dispatch `qa-checklist`, `test-coverage-auditor`,
  `frontend-seam-reviewer` on the real diff.
- Screenshots, lowest graphics preset, per
  `.claude/skills/pr-screenshots/SKILL.md`:
  - before (release outline) and after (cartouche) of the own nameplate
    with title, without title, with Discord portrait, without badges
  - current-target plate
  - borderless control (must not grow a well)
  - player-frame portrait ring (still the old circle; confirm no
    accidental CSS change)
  Desktop required. Mobile nameplate is the same canvas; one mobile HUD
  frame is enough to prove the plate still fits the compact viewport.
  Commit under `docs/screenshots/deed-border-cartouche/phase-01/`.
- Manual graphics-tier check: seed preset 1 and a high preset. Identity
  present on both. Bloom only on the high preset.
- Manual forced-colors (or the existing unit pin if a browser OS setting
  cannot be toggled): no palette hex.
- Adversarial "what is missing" pass: long Unicode name, title-only
  width, stealth + emote + border together, two nearby bordered players.

**Out of scope.** Starting Phase 3. "While I am here" motif or color work.

**Exit into Phase 3.** Coverage map complete. Gate green. Screenshots
committed. Reviewer findings fixed or recorded as non-blocking with
evidence. `state.md` lists the first Phase 3 action.

Historical starter prompt removed at contribution close.

## Phase 3: identity and family

**Outcome.** Each slug has a distinct side motif. Catalogue brass is
retuned. Inspect, portrait ring, and the Book of Deeds picker read as
the same family. Matrix E27-E36 have decisive tests.

**In scope.**

- Extend `BorderAccent` with a `motif` kind. Dispatch four shape sets
  from the cartouche core (still no sprites).
- Retune `curators_gilt` only. Re-pin uniqueness in
  `tests/deed_border_accent.test.ts`. Do not collide with elite/quest
  gold `#f2c84b`.
- Inspect header: CSS cartouche (well + edge + optional clasp), still
  driven by `--border-accent-*`. Forced-colors arm stays.
- Portrait ring: keep the circle. Add a 12-o'clock clasp via an extra
  `::before` or equivalent, still under the level chip (`z-index: 2`).
  Do not put a rectangle on a circular portrait.
- Picker: each earned option shows a 3-color swatch (frame / edge /
  glow) plus the deed name. The None option is empty, not a fake metal.
  Mobile tap floor stays 40x40 (`body.mobile-touch .deed-title-option`).
  Reuse `.deed-title-option`; do not invent a second button class that
  drops the existing a11y/focus rules (`tests/deeds_border_picker.test.ts`).
- Fairness doc: one sentence that the motif is identity (tier-invariant)
  and only glint sheds.
- Deeds / Reliquary design docs: the in-world border is a cartouche, not
  a "slug-keyed accent" outline.
- Shot targets: add or extend recipes for the picker shelf and the
  inspect header so Phase 4 can capture them from the diff.
- Tests: motif distinctness, Catalogue uniqueness, picker swatch markup
  (None vs earned vs active), inspect well, ring clasp z-index, theme
  parchment still consumes custom properties (no raw hex in the CSS
  rule), i18n guard if any key was added.

**Out of scope.** New slugs, new deeds, animated sparkle, wrapping the
health bar, per-slug silhouettes (wings, full wreath, arch).

**Validation (implementer, before handing to QA).**

```
npx tsc --noEmit
npx vitest run tests/deed_border_accent.test.ts tests/nameplate_cartouche_core.test.ts tests/nameplate_canvas.test.ts tests/deeds_border_picker.test.ts tests/inspect_window.test.ts tests/inspect_view.test.ts tests/unit_frame_painter.test.ts tests/localization_fixes.test.ts tests/architecture.test.ts
npx @biomejs/biome check --write <changed files>
```

**Exit into Phase 4.** E27-E36 tests exist and are green. Four motifs
readable in the core's primitive lists. Catalogue uniqueness re-pinned.
No Phase 4 screenshot work left to the implementer except smoke.

Historical starter prompt removed at contribution close.

## Phase 4: QA, identity and family

**Historical outcome.** The cartouche chassis held, every automated gate was
green, and the Phase 3 album covered the surfaces. The subsequent visual review
found that the result still read as a generic outline: color was visible before
identity, motifs disappeared at play distance, the inspect treatment was a
larger slab, the ring clasp resembled a checkbox, and picker stripes did not
communicate reward. That review opened Phases 5-8.

**In scope.**

- Coverage map: every E1-E36 id to a test name. Phase 1 rows must still
  pass after the motif/color change.
- Re-run the Phase 3 test list plus the Phase 1 list.
- `node scripts/gate_select.mjs` (merge bar). Record the exact command
  and outcome.
- Dispatch `qa-checklist`, `test-coverage-auditor`,
  `frontend-seam-reviewer` on the full diff vs `release/v0.39.0`.
- Screenshots under `docs/screenshots/deed-border-cartouche/phase-03/`:
  - all four slugs on the nameplate (desktop, lowest preset)
  - Catalogue vs Eternal Spoils side by side (brass vs capstone gold)
  - low preset vs high preset (identity same, bloom only on high)
  - inspect header
  - Book of Deeds picker (desktop + mobile)
  - player and target portrait rings with clasp
  - parchment theme inspect/picker (light-panel acid test)
  - borderless control still clean
- Manual: flip all four borders in the Book of Deeds, inspect a bordered
  player, current-target plate, forced-colors if available,
  `prefers-reduced-motion` if any glint landed.
- Confirm no IWorld / sim / server drift (E36).
- PR body checklist: gate command, screenshot links, matrix coverage
  pointer to `progress.md`.

**Out of scope.** New motifs, extra slugs, drive-by HUD restyles.

**Historical exit.** Coverage map complete. Gate green. Screenshots committed
and referenced. `progress.md` marks Phases 1-4 complete, but the feature is not
ready to ship until Phase 8 closes.

Historical starter prompt removed at contribution close.

## Phase 5: world Deed Heraldry

**Outcome.** The world-space reward is no longer a perimeter cartouche. It is a
compact forged seal attached to a quiet name ribbon, recognizable at normal
nameplate distance. The title returns to the secondary line. E37-E46 have
decisive tests, and every intentionally retired E1-E36 pin has a documented
replacement.

**In scope.**

- Add `src/render/nameplate_heraldry_core.ts` and
  `tests/nameplate_heraldry_core.test.ts`; register the core in
  `RENDER_PURE_CORES`.
- Move the normalized catalogue/vault/ward/laurel seal primitives to one static,
  allocation-free owner reachable by the renderer without reversing the
  UI-to-render dependency.
- Rewire `nameplate_canvas.ts` to draw the shallow well, fine edge, seal, and
  approved minimal joint/rivets. Remove the world perimeter, four corner
  brackets, central clasp, and tiny side-motif treatment.
- Keep the name-row badge group optically centered on `screenX`. Place the seal
  relative to the ribbon without letting it re-center the text incorrectly.
- Restore the title to the secondary text line and keep guild/actionable slots
  outside. Cover absent title and title wider than name without widening the
  ribbon to the title.
- Remeasure and export accepted seal/ribbon dimensions, alpha, and `extraLift`.
  Update both y-walks and declutter constants from those values.
- Replace `nameplate_cartouche_core.ts` and its test once migration is complete;
  do not leave two active geometry paths.
- Update the canvas/fairness/source-scan tests and record the E1-E36
  supersession map in `progress.md`.
- Update the `nameplate-border` shot recipe dependencies/label for heraldry so
  Phase 6 captures the real diff.

**Out of scope.** Player/target DOM header, inspect banner, picker redesign,
new copy, new slugs/motifs, generated runtime image assets, animation, and Phase
6 screenshot commitment.

**Validation (implementer, before handing to QA).**

```text
npx tsc --noEmit
npx vitest run tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/nameplate_ai_tag.test.ts tests/nameplate_declutter.test.ts tests/deed_border_accent.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts
npx @biomejs/biome check --write <changed files>
```

**Exit into Phase 6.** E37-E46 exist and pass. Old geometry tests were replaced,
not weakened. There is one active core, no sprite/allocation/tier regression,
and no Phase 7 surface work in the tree. `progress.md` and `state.md` point to
Phase 6.

Historical starter prompt removed at contribution close.

## Phase 6: QA, world heraldry

**Outcome.** Independent QA proves the seal reads at play distance, the name
still wins the hierarchy, all four identities differ without relying only on
color, and the new geometry is fair and cheap. This phase may reject technically
correct work for weak reward feel.

**In scope (read-only first, then fix-forward only for confirmed gaps).**

- Audit the E1-E36 supersession map and map E37-E46 to named decisive tests.
- Run the Phase 5 list, selective gate, and required QA workflow.
- Dispatch `woc_test_coverage` and `woc_frontend` on the real diff vs
  `origin/release/v0.39.0`.
- Capture live-game evidence under
  `docs/screenshots/deed-border-cartouche/phase-05/`:
  - all four slugs at normal town/nameplate distance, low preset
  - tight crop of all four seals only after the distance shots pass
  - Catalogue vs Eternal Spoils side by side
  - current-target-sized world plate
  - long Unicode name and all-badge stress case
  - title and no-title
  - borderless control
  - low vs high (identity same, bloom only)
  - two nearby bordered players after declutter
- Manual grayscale check on the four seal crops; color cannot be the only cue.
- Verify forced colors through a real browser setting when available, otherwise
  use the decisive unit pin and record the limitation.

Generated concepts never count as QA proof. If a visual blocker requires a new
direction mockup, use `$imagegen`, ground it in the live screenshot, save it
under `direction/`, record its prompt, and keep it separate from captured proof.

**Exit into Phase 7.** Tests and gate are green, reviewers have no blocking
finding, and the normal-distance album earns a visual verdict of SHIP or SHIP
WITH NOTES. "Readable when zoomed" is not enough. `state.md` points to Phase 7.

Historical starter prompt removed at contribution close.

## Phase 7: social reveal family

**Outcome.** The player and target HUD reveal the worn heraldry without
reskinning gameplay bars; inspect provides the ceremonial reward moment; the
Book of Deeds picker shows meaningful seal/material options and live previews.
E47-E58 have decisive tests.

**In scope.**

- Extend the shared border view with the motif/custom-property data cold
  surfaces need. Keep one slug-to-palette/motif table.
- Add a player/target name-header host through the existing unit-frame painter
  seam. Put the seal at the portrait/name joint and a quiet motif-derived pattern
  behind the name header only.
- Keep both portraits circular. Refine the ring to a fine family edge and remove
  the current hollow top clasp when the joint seal becomes the hardware focus.
- Preserve target name ellipsis, title spans, Cheater tag, reaction color, and
  every bar/state z-order. Player and target only; party, pet, target-of-target,
  NPC, mob, and object frames do not inherit the reward.
- Extend inspect models with the existing localized granting-deed name. Build a
  compact banner around name/title/deed label with the same seal/material and a
  pattern derived from the existing motif.
- Replace picker stripes with the canonical seal, material sample, and existing
  deed name. None stays empty. Reuse `.deed-title-option`.
- Add event-driven live preview for representative world and interaction forms.
  Previewing a row must not equip it; only the existing picker action mutates
  `activeBorder`.
- Add only the necessary localized labels, satisfying M16 and a11y. Prefer the
  existing deed name/title keys over new copy.
- Update `docs/design/deeds.md`, `docs/design/reliquary.md`, and
  `docs/design/graphics-settings-fairness.md` from cartouche terminology to the
  implemented Deed Heraldry contract.
- Update shot recipes for player/target, inspect, picker, theme, and mobile
  variants. Phase 8 owns the committed album.

**Out of scope.** New deed content, new motifs, changing reward eligibility,
full unit-frame skinning, bar recolors, 3D capes/mounts, sparkle, continuous
motion, sim/server/wire changes, and Phase 8 screenshot commitment.

**Validation (implementer, before handing to QA).**

```text
npx tsc --noEmit
npx vitest run tests/deed_border_accent.test.ts tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/deeds_border_picker.test.ts tests/inspect_window.test.ts tests/inspect_view.test.ts tests/unit_frame_painter.test.ts tests/unit_frame.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts
npx @biomejs/biome check --write <changed files>
```

**Exit into Phase 8.** E47-E58 exist and pass. One family mapping drives every
surface. Mobile/focus/forced-colors contracts are pinned. No gameplay bar or
wire path changed. `progress.md` and `state.md` point to Phase 8.

Historical starter prompt removed at contribution close.

## Phase 8: QA, full Deed Heraldry family

**Outcome.** The hard-earned reward is beautiful, coherent, legible, fair, and
performant across every surface and supported presentation mode. The player can
enable it confidently from the picker and is rewarded both by passive world
recognition and by the richer social reveal.

**In scope (read-only first, then fix-forward only for confirmed gaps).**

- Audit the complete E37-E58 map plus every retained E1-E36 invariant.
- Run both active-phase test lists, the required QA workflow, and
  `node scripts/gate_select.mjs`.
- Dispatch `woc_test_coverage` and `woc_frontend`; add another specialist only
  if the finished diff actually touches its domain.
- Capture the final live-game family album under
  `docs/screenshots/deed-border-cartouche/phase-07/`:
  - all four world seals at normal distance and in tight crops
  - Catalogue vs Eternal Spoils
  - low vs high
  - player and target frames with the same active heraldry
  - target frame with long localized title and Cheater tag
  - inspect desktop, mobile, and parchment
  - picker desktop, mobile, parchment, focus-visible, active, and None
  - picker live preview for all four choices
  - borderless world/player/target/inspect/picker controls
- Wear each reward through the real Book of Deeds flow, click a bordered player,
  inspect them, swap slugs, unequip, reconnect, and verify the owner/player-frame
  view as well as the observer view.
- Judge the world at nameplate distance first. Then inspect close craft, family,
  motif legibility, parchment survival, and cheap-yellow/chrome regressions.
- Record exact commands, screenshots, reviewer findings, fixes, and remaining
  risks in `progress.md` and `state.md`.

**Exit (feature ready).** E37-E58 coverage is complete, the selective gate is
green, reviewers are READY or READY WITH NOTES without a blocking craft issue,
the final album proves the approved art direction, and no unsupported system
changed. Only then may the operator open a PR.

Historical starter prompt removed at contribution close.

## Phase 9: v0.40 integration and plaque refinement

**Outcome.** The feature is rebased onto `release/v0.40.0`, and the approved
generated direction reads as one convincing crafted plaque family rather than
a thin rounded ribbon or a full gameplay-frame reskin.

**In scope.**

- Merge `origin/release/v0.40.0` without discarding the completed E1-E58 work.
- Replace the compact rounded name ribbon with a shallow pointed plaque using
  fixed-pixel tips and notches that remain stable for localized names.
- Expand the player and target version across the existing name-header column,
  mirror the target form, and keep every gameplay bar and status slot ordinary.
- Give picker previews and inspect the same code-native silhouette family at
  their appropriate interaction and ceremonial scales.
- Preserve the caller-owned world core, static frozen motifs, sprite-free
  Canvas2D painter, elided DOM writers, and allocation-free per-frame path.
- Capture a new live-client album under `phase-09/`, judging the world at normal
  distance before crops and proving grayscale identity, low/high parity,
  responsive and Parchment layout, forced colors, picker, and inspect.
- Run the complete repository gate and fresh test-coverage and frontend reviews.

**Out of scope.** New deeds, slugs, motifs, titles, lore, runtime images,
gameplay power, wire/persistence changes, animation, sparkle, or a full unit
frame skin.

**Exit.** E1-E58 remain green, E59-E63 are decisive, the v0.40 gate passes, and
the permanent album proves that name reads first, seal second, and metal third
in a crowded town. A shipping verdict still requires the independent reviews.

## Risks

- Extra lift colliding with raid marks or emotes if only `drawBase` is
  updated. Mitigation: one `extraLift` constant, both walks, one test (E22).
- Declutter under-stacking bordered players. Mitigation: measure and
  bump in Phase 1 (E24).
- Growing `nameplate_canvas.ts` past its monolith ceiling. Mitigation:
  the core extraction is mandatory.
- Catalogue brass colliding with `reliquary_gilt` or `#f2c84b`.
  Mitigation: uniqueness scan already exists; retune in Phase 3 only.
- Picker markup breaking the shared title-option contract. Mitigation:
  keep the class, add an inner swatch span.
- QA skipped because "the tests are already there." Mitigation: Phase 2
  and Phase 4 are named phases with a coverage map and reviewers. A
  build phase cannot close itself.
- Identity accidentally shed on low. Mitigation: core takes no tier
  argument; fairness scan; low-preset screenshot.
- The seal becomes a larger generic badge. Mitigation: keep it attached to the
  name ribbon, use the deed motif as its face, and accept at normal distance.
- The ribbon becomes the same cartouche with fewer strokes. Mitigation: E37
  forbids a full perimeter and Phase 6 reviews distance before crops.
- Target treatment expands into a full HUD skin. Mitigation: only the name
  header and portrait joint receive heraldry; bars and state semantics are
  explicitly pinned by E49.
- Cold surfaces drift from the world seal. Mitigation: one palette/motif owner,
  canonical static primitives, E55, and a side-by-side family album.
- Picker preview mutates the equipped reward or becomes per-frame work.
  Mitigation: selection preview is event-driven and equip remains on the
  existing action path, pinned by E54.
- A generated concept is mistaken for shippable UI or QA proof. Mitigation: the
  concept is reference-only; runtime remains code-native and screenshots come
  from the booted client.

## Worktree and branch

The worktree and branch already exist:

```text
cd /Users/fernando/Documents/wocc-deed-border-cartouche
git status --short --branch
```

Work only there on `feature/deed-border-cartouche`, diff vs
`origin/release/v0.40.0`. Do not recreate the branch, implement on the release
checkout, or base on `main`.
