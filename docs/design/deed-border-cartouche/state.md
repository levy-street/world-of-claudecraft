# Deed Heraldry: state

Contribution closeout. The approved direction is `art-direction.md`; the
completed implementation and QA contract is `implementation-plan.md`.

## Final state

Phases 1-9 are complete on `feature/deed-border-cartouche`. Phase 9 merged
`origin/release/v0.40.0`, refined the family from a rounded ribbon into the
approved pointed plaque direction, and added E59-E63 without weakening E1-E58.
Three subsequent five-pass craft sessions corrected Book preview alignment, gave
the world and interaction seals protected plaque air, and rebuilt Inspect as a
centered forged mantle with a keyed medallion, attached provenance tab, one
honor rail, and a quieter paperdoll stage. The third session then audited every
live placement, fixed the tablet honor rail from 3+1 to 2x2, integrated the
current release tip, and recaptured the official evidence. The final verdict is
**SHIP WITH NOTES**; both fresh specialist reviews are **READY**, and the exact
findings and fix-forward evidence are recorded in `progress.md`.

The final plaque album is
`docs/screenshots/deed-border-cartouche/phase-09/final-five-pass/`. Its 54-file
canonical/matrix/overview ledger proves normal-distance world hierarchy, all
four seals together and in grayscale, player and target frames, every Book and
Inspect reward, borderless and remote controls, mobile/tablet/rotate behavior,
Parchment, Midnight, High Contrast, actual forced colors, and unobscured
low/high bloom-only fairness. The retained `phase-07/` album continues to prove
the real Book equip/preview flow, slug swaps, reconnect, and the long localized
Cheater target. No sim, server, persistence, wire, net, world API, or IWorld
feature path changed.

The final five-pass files are ready for task-scoped closeout commits. On
2026-08-23 the operator explicitly authorized committing, pushing, and opening
a PR targeting `release/v0.40.0`.

## Blocker

None. `origin/release/v0.40.0@b39b16022e` is integrated by merge commit
`98589bb615dedfb4eb86d0078be81080152269b2`; the branch is 21 commits ahead and
0 behind. The post-merge official evidence was recaptured and the complete
12-step gate is green.

## Next action

1. Preserve all Phase 1-9 and craft-pass changes.
2. Commit and push the remaining final-pass work with task-scoped staging.
3. Open the authorized PR against `release/v0.40.0` and do not start another
   feature phase without operator direction.

## Active locked decisions

- The approved experience is two-scale Deed Heraldry: compact world seal plus
  shallow pointed name plaque, richer social reveal on interaction.
- Four slugs and motifs only: catalogue, vault, ward, laurel. No new deed,
  reward, title, slug, motif, or reward identity.
- The world plaque owns the name row only. The selected title returns to the
  secondary line.
- No full nameplate perimeter, corner brackets, or central clasp. The motif is
  enlarged into the readable face of the forged seal.
- Guild, HP, resource, cast, combo, raid marks, quest markers, emotes, and all
  actionable/state information stay outside and unchanged.
- Player and target frames receive the seal at the portrait/name joint and a
  restrained pattern on the name header only. Portraits stay circular. No full
  HUD reskin.
- Inspect is the ceremonial reveal: a `580x72` host contains a dark 60px face,
  keyed `64x64` seal with 16px shoulder overlap, centered real name/title, and
  an attached `260x18` localized deed tab. Existing standing and badges remain
  secondary in one responsive honor rail. Picker uses actual seals/materials,
  a dark keyed portrait cameo, and live previews. `.deed-title-option`, focus,
  aria, and the 40x40 touch floor remain.
- Catalogue brass remains `#c9b17a` / `#2a2214` / `#f3ebcf`, distinct from
  Eternal Spoils `#f4ca43` and elite/quest `#f2c84b`.
- Borderless stays clean. Identity exists on every graphics tier. Only bloom
  may shed. Prefer no motion.
- World runtime stays code-native, sprite-free, and allocation-free per plate
  per frame. The generated concept is reference-only.
- The old radius is history. The accepted world values are plaque pad 7/1,
  fixed 8px tip, fixed 4px notch, midnight alpha 0.62, seal 18, protected
  seal/plaque gap 2, hidden joint overlap 2, extra lift 8, and declutter
  X/Y/stack 95/26/28. Both y-walks consume the same 8px lift.
- The frozen cold-surface silhouettes use scale-specific fixed hardware:
  compact/mirrored 8px point and 4px notch, ceremonial symmetric 16px
  shoulders, and provenance-tab symmetric 10px shoulders.
- `PlayerMeta.activeBorder`, `deed_set_border`, eligibility, persistence, and
  the wire remain unchanged. No sim/server/IWorld work is expected.

## Phase status

- Phase 1 complete: cartouche geometry seam and canvas rewire.
- Phase 2 complete: chassis QA, E1-E26, screenshots, selective gate.
- Phase 3 complete: motifs/palettes and initial family surfaces.
- Phase 4 complete technically, visually superseded: E1-E36 and `phase-03/`
  album proved implementation but not desired reward feel.
- Phase 5 complete: world seal + ribbon, secondary title, one pure core,
  E37-E46, focused suite 196/196, TypeScript green, full and selective gates
  12/12, coverage and frontend reviews READY.
- Phase 6 complete, SHIP: normal-distance and grayscale craft review, complete
  live `phase-05/` album, E1-E46 audit, test-only fix-forward, focused suite
  203/203, final full selected gate 12/12, coverage and frontend reviews READY.
- Phase 7 complete: player/target, inspect, picker previews, E47-E58, and its
  requested implementation checks green before the independent final phase.
- Phase 8 complete: **READY WITH NOTES / SHIP WITH NOTES**. E1-E58, final live
  family album, art direction, accessibility/themes, responsive behavior,
  bloom-only fairness, full selective gate, and specialist reviews passed.
- Phase 9 complete: **SHIP WITH NOTES**. v0.40 is integrated, E59-E63 are
  audited, the pointed plaque family is live across
  world/player/target/picker/inspect, the full-mode 12-step gate is green, and
  both fresh specialist reviews are READY.
- Post-Phase 9 five-pass craft polish complete: Book motifs are optically
  centered, world and picker plaques preserve the 2px seal gap, Inspect is one
  responsive ceremonial composition, the final full-mode 12-step gate is green,
  and both post-fix specialist reviews are READY. Final verdict: **SHIP WITH
  NOTES**. No new feature phase was begun.
- Second post-Phase 9 five-pass convergence complete: shared forged material,
  scale-specific shoulders, 3px unit seam air, a keyed `580x72` Inspect mantle,
  attached deed tab, dark Book cameo, final responsive/theme stress evidence,
  decisive coverage, and the full 12-step gate are green. Both fresh reviewers
  are READY. Final verdict: **SHIP WITH NOTES** because origin advanced by an
  unrelated two-commit release merge during closeout. No new feature phase was
  begun.
- Third post-Phase 9 five-pass final surface audit complete: **SHIP WITH
  NOTES**. The 54-file final-five-pass album covers every live placement and
  meaningful edge state; the tablet Inspect honor rail is a measured 2x2 with
  no overflow; current v0.40 is integrated; the focused 229-test slice, 42,006
  full-suite tests, 256 browser tests, all builds, and all 12 gate steps are
  green. Fresh frontend and test-coverage reviews are READY. The only remaining
  note is physical notched-iOS safe-area validation; no new feature phase was
  begun.

## Phase 8 closeout evidence

- Active Phase 5 list:
  `npx vitest run tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/nameplate_ai_tag.test.ts tests/nameplate_declutter.test.ts tests/deed_border_accent.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`
  passed 7 files and 207 tests.
- Active Phase 7 list:
  `npx vitest run tests/deed_border_accent.test.ts tests/nameplate_heraldry_core.test.ts tests/nameplate_canvas.test.ts tests/deeds_border_picker.test.ts tests/inspect_window.test.ts tests/inspect_view.test.ts tests/unit_frame_painter.test.ts tests/unit_frame.test.ts tests/localization_fixes.test.ts tests/i18n_completeness.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts`
  passed 12 files and 341 tests, with 3 expected skips.
- Proportional responsive/i18n/style list:
  `npx vitest run tests/mobile_window_coverage.test.ts tests/mobile_window_layout.test.ts tests/mobile_window_transform.test.ts tests/i18n_completeness.test.ts tests/localization_fixes.test.ts tests/styles_extraction.test.ts tests/css_value_validity.test.ts tests/focus_visible_guard.test.ts tests/theme.test.ts tests/ui_effects_profile.test.ts tests/ui_effects_wiring.test.ts`
  passed 11 files and 216 tests, with 1 expected skip.
- `npx tsc --noEmit`, `git diff --check`, and
  `GATE_SELECT_BASE=origin/release/v0.39.0 node scripts/gate_select.mjs` passed.
  The selective gate reported all 12 steps green.
- The live album is
  `docs/screenshots/deed-border-cartouche/phase-07/`. Required evidence is world
  distance 12-13, all-four Book equip 14-17, focus-only preview 18-21,
  player/target and low/high 01-05, picker and Parchment 06-08, inspect and
  Parchment 09-11, peer/reconnect/None/forced-colors/localized-target 22-29.
  `live-qa-evidence.json` records the exact live state assertions.
- Final `woc_test_coverage` result was **READY**, final `woc_frontend` result was
  **READY WITH NOTES / SHIP WITH NOTES**, and final
  `gate-integrity-reviewer` result was **READY**. Their confirmed findings were
  fixed in owning CSS, screenshot recipes, and source-linked tests: preview
  stacking, touch layout, forced-color edges, Parchment contrast, explicit
  tier/daylight staging, E47-E58 invariant pins, and sparse-checkout deletion
  handling. No actionable finding remains.
- Remaining risks are release-branch drift, 18 logged but unrelated mobile NPC
  asset skips, and no separate axe/mobile E2E/ARM3 wall-clock rerun. The
  canonical browser suite, deterministic accessibility/responsive/style
  coverage, hot-path guards, and final selective gate passed.

## Phase 9 closeout evidence

- `origin/release/v0.40.0@14ab2e8630` merged as `2e15170f9c` with no conflict.
  `git rev-list --left-right --count origin/release/v0.40.0...HEAD` returned
  `0 17`.
- The shared plaque authority is `src/ui/deed_heraldry_plaque_core.ts`: compact
  and mirrored clip paths use fixed 8px tips and 4px notches, the ceremonial
  face uses fixed symmetric 16px shoulders, and the attached deed tab uses
  fixed symmetric 10px shoulders. The world core imports only the compact
  measurements and remains caller-owned.
- The world painter uses one six-point Canvas2D path, one inset glint, the
  existing seal and frozen motif primitives, and no image, gradient, filter,
  animation, tier, governor, or per-call container allocation.
- The Phase 9 album is
  `docs/screenshots/deed-border-cartouche/phase-09/`. Normal distance was judged
  before `all-four-world-crop.png`; the grayscale comparison remains distinct.
  Low/high, mobile, Parchment, picker, inspect, and real forced-colors evidence
  are enumerated in `live-qa-evidence.json`.
- `GATE_SELECT_BASE=origin/release/v0.40.0 node scripts/gate_select.mjs` selected
  full mode and passed all 12 steps: 2,986 test files passed with 12 skipped,
  41,995 tests passed with 2 expected failures and 115 skipped, 28 browser test
  files passed, and types/build/artifacts/security checks were green.
- Fresh `woc_test_coverage` and `woc_frontend` reviews both returned **READY**.
  The confirmed E63 ordering gap was fixed so every page-creation arm now pins
  `newPage`, probe cleanup, then storage seed/navigation. An unused plaque
  string getter and its misleading primitive-identity assertion were removed.
  The final focused suite passed 13 files and 385 tests; TypeScript,
  `git diff --check`, and `npm run ci:changed` also passed.
- No generated concept was used as QA evidence and no runtime image, deed, slug,
  motif, title, lore, or player-facing string was added.
- Remaining notes are non-blocking: offline captures logged proxy 502s and
  seven unrelated skipped mobile NPC models, and no separate browser axe,
  dedicated mobile E2E, or ARM3 wall-clock run was performed. Canonical browser,
  accessibility/responsive, allocation, typecheck, build, and full-gate
  coverage passed.

## Existing implementation surfaces

- `src/ui/deed_border_view.ts`: one slug -> palette + normalized static motif owner.
- `src/render/nameplate_heraldry_core.ts`: caller-owned world seal/plaque
  geometry. The Phase 4 cartouche core is deleted.
- `src/render/nameplate_canvas.ts`: thin world consumer.
- `src/render/nameplate_painter.ts`: border slug resolution.
- `src/render/nameplate_declutter.ts`: remeasure after new world extents.
- `src/ui/unit_frame.ts` + `src/ui/unit_frame_painter.ts`: player/target reveal
  seam with optional heraldry hosts and elided token writes.
- `src/ui/hud.ts`, `index.html`, `play.html`, `src/styles/hud.css`: player and
  valid-player-target seal/header markup and style.
- `src/ui/inspect_view.ts`, `src/ui/inspect_window.ts`,
  `src/styles/shell.css`: centered ceremonial Inspect mantle, standing row,
  responsive honor rail, and quiet class-hazed paperdoll stage.
- `src/ui/deeds_view.ts`, `src/ui/deeds_window.ts`,
  `src/styles/components.css`: canonical picker samples and event previews.
- `scripts/pr_shot_targets.mjs`: Phase 8 recipes for world, unit frames,
  inspect, picker, mobile, parchment, and low/high comparison.
- Tests and coverage maps are listed in `progress.md`.

## Review dispatch for active QA phases

- Use `$woc-qa` or follow `docs/qa-gate.md`; parent runs deterministic commands
  once and integrates findings.
- `woc_test_coverage` in Phases 6 and 8.
- `woc_frontend` in Phases 6 and 8.
- `woc_sim_architecture` only if `src/sim/` changes unexpectedly; stop first.
- `woc_cross_platform` only if world API/wire state changes unexpectedly; stop
  first.

## Image direction

Approved imagegen reference:
`docs/screenshots/deed-border-cartouche/direction/deed-heraldry-concept.png`.

If a later phase truly needs another visual option, use `$imagegen`, ground it
in a live client screenshot, save the selected project-bound output under the
same `direction/` folder, record the final prompt, and never treat generated art
as runtime UI or QA evidence.
