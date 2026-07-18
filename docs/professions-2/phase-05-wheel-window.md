# Phase 05: The professions wheel window

This phase ships the flagship professions window at Book of Deeds quality on today's design
tokens: identity, the craft ring visualization, ten per-craft skill bars with tier pips, and a
live perks readout. It is its own slice because it is pure UI on reads that already exist after
PR 2039 (no new wire data, no sim behavior), so it can land independently of the crafting-window
upgrades that follow in Phase 6.

## Context pointers

- `docs/professions-2/state.md`: locked decisions (CRAFT_RING order, pair-named archetypes, the
  pre-cprof optimistic client rule), the validation matrix (ui/render and i18n rows), and the
  "Key existing surfaces" section (wheel math, cprof wire key, icons recipe, the deeds UX bar).
- `docs/professions-2/implementation-plan.md`: the design-language guardrails (tokens only, no
  DESIGN.md phase vocabulary, ten-dash banner, mobile rules) and the Review Dispatch Matrix.
- `docs/professions-2/progress.md`: the Phase 5 deliverable checklist to mirror on completion.
- `docs/professions-2/asset-manifest.json`: the designer slots for `prof_*` and `gather_*` icons
  and the archetype crests; already authored, do not re-author.
- The deeds exemplar: `src/ui/deeds_view.ts`, `src/ui/deeds_window.ts`,
  `src/ui/deed_tracker_painter.ts` (pure core + cold painter + hot strip pattern).
- `src/ui/crafting_view.ts`: how an existing view core consumes profession reads.
- `src/world_api/professions.ts` (`craftingIdentity`) and `src/world_api/progression_xp.ts`
  (`craftSkills`): the reads this window is built from, plus the existing professions-state and
  gathering rows.
- The PR 2039 identity card view (`profession_identity_view`): this phase absorbs or composes it.
- `src/ui/icons.ts`: procedural icon recipes and the WebP override-set pattern.
- `src/styles/components.css` and `src/styles/hud.mobile.css`: where the new window's styles land.
- `tests/mobile_window_coverage.test.ts`: the guard the new `.window` id must satisfy.
- Local conventions: `src/ui/CLAUDE.md`, `src/ui/hud/CLAUDE.md`, `src/styles/CLAUDE.md`.

## Starter Prompt

```
This is Phase 05 of the Professions 2.0 feature: The professions wheel window.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: ship the flagship professions window at Book of Deeds quality on today's design tokens,
built entirely from reads that already exist post-2039.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the checkout must be clean (a concurrent session may share it). Record
  git rev-parse HEAD as the phase-start commit; you will write it into progress.md at STEP 6.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries; at minimum read:
  the node25-breaks-jsdom-gate rule (run the gate under Node 24), the PR 2039 state (the cprof
  wire key and identity card this window builds on), and the design-language program entry
  (DESIGN.md is adopted but unlanded; no piecemeal re-lands).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-05-wheel-window.md (this file)
- src/ui/deeds_view.ts, src/ui/deeds_window.ts, src/ui/deed_tracker_painter.ts
- src/ui/crafting_view.ts and the PR 2039 identity card view (profession_identity_view)
- src/world_api/professions.ts (craftingIdentity) and src/world_api/progression_xp.ts
  (craftSkills), plus the existing professions-state and gathering-row reads they sit beside
- src/ui/icons.ts, src/styles/components.css, src/styles/hud.mobile.css
- tests/mobile_window_coverage.test.ts
- src/ui/CLAUDE.md, src/ui/hud/CLAUDE.md, src/styles/CLAUDE.md
The summary must return: the deeds pure-core + cold-painter recipe as concretely used (injected
deps, rebuild discipline, markDialogRoot, esc(), audio.click); the exact shapes of
craftingIdentity, craftSkills, and the gathering rows in BOTH Sim and ClientWorld (including the
pre-cprof synced:false state); how UI_PURE_CORES registration works; the icon recipe + WebP
override-set + converter + bijection pattern; the components.css ten-dash banner and
hud.mobile.css rules for a comparable window; how existing windows register launcher rows, the
mobile More tray entry, and a keybind; and the Phase 5 deliverable checklist from progress.md.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out four agents; give each ONLY the Explore summary plus its deliverable block below. The
view-core agent goes first (the others consume its module surface); the painter/styles,
icons/i18n, and tests agents then run in parallel. Use worktree isolation only if two agents
must edit the same file.

Agent view-core deliverables:
- src/ui/professions_view.ts: a pure, DOM-free view core registered in the UI_PURE_CORES
  allowlist in tests/architecture.test.ts.
- The window model built from craftingIdentity + craftSkills + professionsState + the gathering
  rows; it must render correctly from both Sim-shaped and ClientWorld-shaped inputs, including
  the pre-cprof (synced false) empty state.
- Ring layout math: node positions for the ten crafts in CRAFT_RING order, arcs for the active
  attuned pair, and the hobby chord.
- The per-craft skill bar + tier pip model, and the perks readout with the material discount
  live (the 75-skill materialCostMultiplier from src/sim/professions/wheel.ts).
- A refresh signature for slow-band diffing (cheap to compute, changes only when the model
  changes).
- Absorb or compose the PR 2039 identity card view (profession_identity_view): pick one and
  record why in the phase notes. Either way, the resulting model PRESERVES the
  identity-view semantics (2026-07-17 amendment): per-craft role (major / hobby / dormant /
  unattuned), ceiling (unlimited / rare / common), the nearTier and dormantKnowledge
  nudges, and the pre-first-tier tutorial state. Dropping any of these is a spec violation,
  not an implementer choice.
- A per-craft next-unlock line (2026-07-17 amendment): points to the next tier pip and what
  crossing it changes (the masterwork-odds step; the 75-skill specialization perks). Phase
  9's teach tiers and Phase 10's ladders enrich the same line later without a model change;
  render only from reads that exist today.
- A switch-cost-at-rest line (2026-07-17 amendment): "next switch costs N" computed
  client-side from the locked 5 + 3 * switchCount formula using the switchCount already on
  CraftingIdentityView (src/world_api/professions.ts; profession_identity_view.ts surfaces
  it to players as returnCount). Display-only; the server still resolves the real cost
  (Phase 14 owns the pre-commit preview).
- Progressive disclosure (2026-07-17 amendment): the unattuned and pre-first-tier states
  render a SIMPLIFIED view: the identity paragraph, one clear call to action (the trending
  craft and its next step), and the tutorial line promoted; the full ring, ten bars, and
  perks readout take over at first tier or attunement. A new player sees one next step,
  never ten bars first.

Agent painter/styles deliverables:
- src/ui/professions_window.ts: a cold painter on the deeds pattern (injected deps, full rebuild
  that preserves scroll position and focus, markDialogRoot, esc() on every interpolation,
  audio.click on interactions).
- The ring rendered either on a small canvas with cached token reads (tokens resolved from CSS
  custom properties once and cached, zero hex literals) or as DOM nodes; the agent picks one and
  records why in the phase notes.
- A ten-dash banner section in src/styles/components.css inside @layer components, existing
  tokens only.
- A deliberate body.mobile-touch rule for the new .window id in src/styles/hud.mobile.css: safe
  areas respected, transform re-declared on any left re-pin, 40px tap targets.
- Launcher entries: the window row, the mobile More tray entry, and a keybind following the
  existing keybind registration pattern (mirror how the deeds window is wired).

Agent icons/i18n deliverables:
- hudChrome.professions.* English keys in the matching src/ui/i18n.catalog module (English only;
  the maintainer fills locales at release; M16 applies if any new value is wordy).
- prof_* and gather_* procedural icon recipes in src/ui/icons.ts (the ten crafts and the four
  gathering skills; ids per asset-manifest.json).
- The professions WebP converter scaffold (cloned from the existing item-icon converter,
  targeting public/ui/professions/) plus its bijection test; an empty image set is valid.
- Do NOT re-author asset-manifest.json; it already lists the designer slots.

Agent tests deliverables:
- Node-only tests for professions_view: model construction from Sim-shaped and
  ClientWorld-shaped inputs (including pre-cprof synced false), ring layout math, tier pip and
  perk derivation, and refresh-signature stability.
- Painter-level coverage where feasible (rebuild preserves focus and scroll; no writes when the
  refresh signature is unchanged).
- Confirm the new .window id passes the mobile guard trio and the UI_PURE_CORES registration
  passes tests/architecture.test.ts.
- The icons bijection test wired to the converter scaffold.

After the agents land, the main session captures desktop + mobile before/after screenshots via
the pr-screenshots recipe and commits them under docs/screenshots.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: no Math.random, Date.now, or performance.now anywhere; all sim randomness goes
  through Rng (this phase should touch no sim logic at all; tests/architecture.test.ts guards).
- IWorld both worlds: this window consumes EXISTING IWorld members only; it must render from
  both Sim- and ClientWorld-shaped inputs. If any new member proves unavoidable, stop (see
  STOPPING RULES): new wire data is out of scope.
- Server authority: the window is read-only; it never decides or predicts outcomes.
- i18n: every player-visible string in this phase is a t() key added in ENGLISH ONLY to the
  matching src/ui/i18n.catalog module; if any sim- or server-origin text surfaces here, its
  matcher lands in src/ui/sim_i18n.ts or src/ui/server_i18n.ts in the SAME change (the S3 guard,
  tests/localization_fixes.test.ts, enforces it).
- Design-language guardrails from implementation-plan.md: no DESIGN.md phase vocabulary, tokens
  only (zero hex literals outside tokens.css/theme.ts), focus via the --color-border-focus
  outline mechanism only, ten-dash banner section, mobile coverage rules.
- Fairness: skill data shown is identical at every graphics tier; no preset hides or degrades
  profession information.
- Prime directive: nothing existing breaks; every currently passing test stays green.

Out of scope (do NOT do in this phase):
- Crafting-window changes of any kind (Phase 6).
- Any new wire data, IWorld member, delta key, or command; everything this window reads exists
  post-2039.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run the ui/render and i18n rows from the validation matrix in state.md:
- npx tsc --noEmit
- npx vitest run tests/architecture.test.ts tests/mobile_window_coverage.test.ts
  tests/mobile_window_transform.test.ts tests/mobile_window_layout.test.ts
  tests/localization_fixes.test.ts
- npx vitest run on the new professions_view / professions_window test files and the icons
  bijection test
- npm run i18n:gen, then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts
- A mobile screenshot script run (the scripts/mobile_*.mjs family) against a running dev client.
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows (expected: frontend-seam-reviewer for the ui/styles surface, qa-checklist once the
deliverable set is complete; no sim/server/wire rows should match). Prompt every review agent
for COVERAGE, not filtering: report every correctness or requirement gap with confidence and
severity; filtering happens in a later pass. If any agent's output is truncated, re-spawn it to
resume from its last complete finding; never act on a truncated report. No commit while any
BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Commit with explicit paths, never git add -A; every commit carries a body (what changed and
why), Conventional Commits, no em dashes or emojis:
1. feat(ui): professions view core
2. feat(ui): professions window painter and styles
3. feat(ui): professions icons and i18n
4. docs(screenshots): professions window desktop and mobile captures

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] The window opens on the desktop keybind and from the mobile More tray.
- [ ] Identity (title, majors, hobby), the ring visualization, ten per-craft skill bars, tier
      pips, and the perks readout all render from both Sim- and ClientWorld-shaped inputs,
      including the pre-cprof (synced false) empty state.
- [ ] Per-craft role and ceiling, the nudges, and the tutorial state survive from the
      absorbed identity view; the next-unlock and switch-cost lines render from existing
      reads only.
- [ ] The unattuned / pre-first-tier simplified state shows a single clear next step; the
      full ring takes over at first tier or attunement.
- [ ] src/ui/professions_view.ts is registered in UI_PURE_CORES and is DOM-free.
- [ ] Zero hex literals in every new file; existing tokens only; no DESIGN.md phase vocabulary.
- [ ] The mobile guard trio is green (coverage, transform, layout).
- [ ] hudChrome.professions.* keys are English-only and the S3 guard is green.
- [ ] The icons bijection test is green with the empty image set.
- [ ] Desktop and mobile before/after screenshots are committed under docs/screenshots.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: Phase 5 row (status, dates, the phase-start commit in
  the notes) and mirror the deliverable checklist.
- Update docs/professions-2/state.md, "New surfaces per phase", Phase 5 gains: the professions
  window (.window id professions-window), src/ui/professions_view.ts and
  src/ui/professions_window.ts, the hudChrome.professions.* key namespace, the prof_* and
  gather_* icon recipes plus the professions WebP converter and bijection test, and the launcher
  entries (window row, More tray, keybind).
- Record any surprises (pattern deviations, canvas-vs-DOM decision rationale) to memory.

STEP 7 - FINAL RESPONSE FORMAT:
Report: phase status; files touched; validation results (each command, pass or fail); review
agent verdicts; deferrals with reasons; and a one-line QA handoff naming the phase-start commit
for the diff.

STOPPING RULES:
- Stop if the window cannot be built without new tokens. The only allowed relief is adding ONE
  semantic token to tokens.css with a written justification; never add a DESIGN.md ramp, radius,
  duration, or font token. If one semantic token does not cover it, stop and surface the gap to
  the maintainer instead of working around it.
- Stop if the window turns out to need data that is not already on IWorld in both worlds; new
  wire data is out of scope, so report the gap rather than adding a member.
```
