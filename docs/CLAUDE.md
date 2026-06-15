<!-- docs/ — design docs, feature PRDs, README screenshots.
     Area-scoped notes only; root CLAUDE.md covers the repo. Don't duplicate it. -->

# docs/ — Design & PRD reference

**Reference material, not auto-loaded.** Open the relevant doc when working on
that feature; treat each as the source of truth for its area. These describe
intended behavior — when code and a doc disagree, re-verify against code (the
PRDs say so explicitly) and note the deviation.

## design/ — how systems are/should be built
| File | What it is |
|---|---|
| `master-spec.md` | The big design doc: levels 6–20 expansion (story arc, zones, dungeons, XP math, ids). |
| `spell-ranks.md` | Vanilla-style ability rank progressions L1–20 for all 9 classes; the reference for sim ability content. |
| `icon-system.md` | Procedural icon system spec (`src/ui/icons/` layer compositor, palettes). |
| `graphics-plan.md` | 11-step renderer overhaul plan (quality tiers, post FX, procedural lookdev). |
| `lookdev-hookup.md` | Integrator notes wiring the lookdev pass (sky/IBL/water/post) into `renderer.ts`. |
| `ue5-overhaul-plan.md` | Plan to swap procedural assets for CC0 packs + skeletal anim + PBR/IBL (the `public/` assets came from this). |

## prd/ — feature specs (requirements + `file:line` hook points + acceptance criteria)
| File | What it is |
|---|---|
| `talents-and-specializations.md` | Talents/specs flagship milestone (one-class slice first, then 9 classes). |
| `max-level-xp-overflow.md` | Post-cap XP overflow / prestige progression. |
| `build-prompts.md` | Two self-contained prompts that drive end-to-end PRD implementation (used with `/gsd:*`). |

## screenshots/
JPGs embedded by the repo-root `README.md` (title screen, zones, dungeons, UI).
Replacing one ⇒ keep the same filename so README links don't break.

## Note
PRD `file:line` anchors drift as the tree moves — re-find the exact location
before editing; trust the doc's intent, not its line numbers.
