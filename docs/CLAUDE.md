<!-- docs/: design docs, feature PRDs, README screenshots, i18n contributor docs.
     Area-scoped notes only; root CLAUDE.md covers the repo. Don't duplicate it. -->

# docs/: Design & PRD reference

**Reference material, not auto-loaded.** Open the relevant doc when working on that
feature; treat each as the source of truth for its area, but these describe *intended*
behavior: when code and a doc disagree, re-verify against code and note the deviation.
PRD `file:line` hook points drift as the tree moves: re-find the exact location, trust
the doc's intent, not its line numbers.

## Layout
| Path | What it is |
|---|---|
| `design/` | How systems are/should be built (notes below). |
| `prd/` | Feature specs: requirements + `file:line` hook points + acceptance criteria. |
| `i18n/` | Localized contributor docs: per-locale translations of the root `README.md` and `CONTRIBUTING.md` (see i18n note below). |
| `i18n-scaling/` | i18n architecture + workflow docs. `translation-workflow.md` is the canonical contributor/maintainer roles reference (root and `src/ui/CLAUDE.md` point here); `lazy-locales-and-contributor-workflow.md` is the lazy-locale/hygiene design package. |
| `hud-ux-and-accessibility/` | Phased UX/accessibility program (brainstorm, phases, QA). |
| `ui-architecture-hud-modularization/` | Phased HUD modularization refactor program. |
| `release-notes/` | Per-version release notes. |
| `screenshots/` | JPG/PNG assets embedded by docs and the repo-root `README.md` (see below). |
| `*.md` (top level) | One-off reports (`hud-program-roadmap.md`, `hud-program-validation-report.md`, `performance-feel-audit.md`). |

## design/ & prd/ contents
`ls` the dirs for the current set; most filenames say what they are. The non-obvious
ones worth knowing: `design/master-spec.md` is the big design doc (levels 6 to 20
expansion: story arc, zones, dungeons, XP math, ids); `design/spell-ranks.md` is the
classic-era ability-rank reference for sim ability content. **TRAP:**
`design/icon-system.md` proposes a multi-file `src/ui/icons/` module, but the shipped
code is the flat `src/ui/icons.ts`, so re-verify against code.

## screenshots/
JPG/PNG assets embedded by the repo-root `README.md` (title screen, zones, dungeons, UI).
Replacing one: keep the same filename so README links don't break.

## i18n note (the only player/contributor-facing strings under `docs/`)
The doc *prose* here is dev/design reference, English-only. The exception is `i18n/`:
`README.<lang>.md` and `CONTRIBUTING.<lang>.md` are **hand-maintained localized mirrors**
(not generated) of the English root `README.md` / `CONTRIBUTING.md`, linked from each
doc's language switcher, one per translated locale (the near-English `en_CA` overlay gets
no separate doc). Same split as the app: a contributor edits the **English source** only;
the maintainer fills every locale mirror at release. Don't hand-translate or stub these in
a PR. (`docs/i18n-scaling/worklist/` is a gitignored generated artifact, never edit.)
