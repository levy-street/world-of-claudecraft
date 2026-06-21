<!-- docs/ — design docs, feature PRDs, README screenshots, i18n contributor docs.
     Area-scoped notes only; root CLAUDE.md covers the repo. Don't duplicate it. -->

# docs/ — Design & PRD reference

**Reference material, not auto-loaded.** Open the relevant doc when working on
that feature; treat each as the source of truth for its area. These describe
intended behavior — when code and a doc disagree, re-verify against code (the
PRDs say so explicitly) and note the deviation.

## Layout
| Path | What it is |
|---|---|
| `design/` | How systems are/should be built (table below). |
| `prd/` | Feature specs: requirements + `file:line` hook points + acceptance criteria (table below). |
| `i18n/` | Localized contributor docs — the per-locale translations of the root `README.md` and `CONTRIBUTING.md` (see i18n note below). |
| `i18n-scaling/` | i18n architecture + workflow docs. `translation-workflow.md` is the canonical contributor/maintainer roles reference (root & `src/ui/CLAUDE.md` point here); `lazy-locales-and-contributor-workflow.md` is the lazy-locale/hygiene design package. |
| `hud-ux-and-accessibility/` | Phased UX/accessibility program (brainstorm → phases → QA). |
| `ui-architecture-hud-modularization/` | Phased HUD modularization refactor program. |
| `release-notes/` | Per-version release notes. |
| `screenshots/` | JPG/PNG assets embedded by docs and the repo-root `README.md` (table below). |
| `*.md` (top level) | One-off reports — `hud-program-roadmap.md`, `hud-program-validation-report.md`, `performance-feel-audit.md`. |

## design/ — how systems are/should be built
| File | What it is |
|---|---|
| `master-spec.md` | The big design doc: levels 6–20 expansion (story arc, zones, dungeons, XP math, ids). |
| `spell-ranks.md` | Vanilla-style ability rank progressions L1–20 for all 9 classes; the reference for sim ability content. |
| `icon-system.md` | Procedural icon system spec. Note: it proposes a multi-file `src/ui/icons/` module (`index.ts`, `compose.ts`, `palettes.ts`, …); the shipped code is the flat `src/ui/icons.ts` — re-verify against code. |
| `graphics-plan.md` | 11-step renderer overhaul plan (quality tiers, post FX, procedural lookdev). |
| `lookdev-hookup.md` | Integrator notes wiring the lookdev pass (sky/IBL/water/post) into `renderer.ts`. |
| `ue5-overhaul-plan.md` | Plan to swap procedural assets for CC0 packs + skeletal anim + PBR/IBL (the `public/` assets came from this). |
| `npc_voices.md` | Procedural NPC voice/voiceline design. |
| `sound_effects.md` | Procedural WebAudio sound-effect design. |

## prd/ — feature specs (requirements + `file:line` hook points + acceptance criteria)
| File | What it is |
|---|---|
| `talents-and-specializations.md` | Talents/specs flagship milestone (one-class slice first, then 9 classes). |
| `max-level-xp-overflow.md` | Post-cap XP overflow / prestige progression. |
| `build-prompts.md` | Two self-contained prompts that drive end-to-end PRD implementation (used with `/gsd:*`). |
| `woc/` | $WOC / Web3 feature specs: `wallet-link.md` (non-custodial Solana wallet verification) and `holder-cosmetic-flair.md` (verified-holder cosmetic tier). |

## screenshots/
JPG/PNG assets embedded by the repo-root `README.md` (title screen, zones, dungeons, UI).
Replacing one ⇒ keep the same filename so README links don't break.

## i18n note (the only player/contributor-facing strings under `docs/`)
The doc *prose* here is dev/design reference and is English-only. The exception
is `i18n/`: `README.<lang>.md` and `CONTRIBUTING.<lang>.md` are the **localized
mirrors** of the English root `README.md` / `CONTRIBUTING.md` (linked from the
language switcher at the top of each), one per translated locale (the 12
non-English, non-`en_CA` codes; the near-English `en_CA` overlay gets no separate
doc). They are **hand-maintained**, not generated. Follow the same
contributor/maintainer split as the app: a contributor edits the **English
source** (`README.md` / `CONTRIBUTING.md`) only; the maintainer fills the 12
`docs/i18n/` translations at release. Don't hand-translate or stub these in a PR.
(`docs/i18n-scaling/worklist/` is a gitignored generated artifact — never edit.)

## Note
PRD `file:line` anchors drift as the tree moves — re-find the exact location
before editing; trust the doc's intent, not its line numbers.
