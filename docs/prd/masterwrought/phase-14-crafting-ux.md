# Phase 14: Crafting UX beauty pass

### Starter Prompt
```
This is Phase 14 of the Masterwrought feature: the crafting UX beauty pass. DESIGN.md
governs: this system must be beautiful and a pleasure to use, not just correct
(maintainer directive).

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: apex crafting, the Perfecting flow, cap visibility, and commission quality
signaling all get first-class UI: view-core + painter pairs, localized, mobile-ready,
with SFX cues and committed screenshots.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on HUD/CSS traps (window refocus double-fire, capped
  flex collapse, landscape duplicate specificity), pure-core triple registration, SFX
  gotchas (UI_CUES catalog row, manifest one-run-behind), screenshot traps, window-shell
  coordinates.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (delivery contract; ledger for the phase 12/13 facet
  members), docs/prd/masterwrought/progress.md
- DESIGN.md (rollout phases; the standard this phase is held to), src/ui/CLAUDE.md
  (view-core + painter recipe, UI_PURE_CORES, PainterHost, the two cold-window
  contracts), src/ui/hud/CLAUDE.md, src/styles/CLAUDE.md
- the crafting window modules (grep the crafting window/panel), the commission flow ui,
  the character panel + tooltip arms, src/game/ SFX cue wiring + scripts/sfx
  conventions, tests/hud_perf_budget.test.ts bucket contract, the pr-screenshots skill
  (.claude/skills/pr-screenshots).
Return: which windows exist to extend vs compose fresh, the painter registration path,
where commission fees resolve, the SFX cue pipeline steps.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (crafting window + Perfecting panel):
- Apex recipes surfaced in the crafting window with pattern-source hints, reagent
  availability, and cast/batch integration.
- The Perfecting flow gets its own window/panel (progress track, materials, a bind
  warning BEFORE the first attempt per R2, the celebration moment) as a view-core +
  painter pair per src/ui/CLAUDE.md: a DOM-free <name>_view.ts registered in
  UI_PURE_CORES, a thin write-elided painter on PainterHost, landed in the matching
  src/ui/hud/<domain>/ directory behind its barrel.
Agent 2 (cap visibility + commission):
- Character panel + tooltip indicators for Masterwrought slots in use, reads via IWorld
  only; add a facet member ONLY if existing reads cannot express it, with the parity pin
  in the same change.
- Commission quality signaling: the crafter's masterwork/Perfecting record surfaced in
  the commission flow, plus the minimum-fee floor (the two fields the research showed
  ARE the feature). If the floor lands in sim/server commission logic, that arm gets its
  own sim test and the sim reviewers. Undo paths verified: the enchant replace flow and
  the no-downgrade guarantees stated accurately in ui copy.
Agent 3 (sfx + mobile + screenshots):
- SFX cues for Perfecting attempt, success, and the orange moment through the sfx
  pipeline (UI_CUES row + catalog entry + npm run sfx:manifest; tuning only via the
  gain/speed maps).
- Mobile layouts + touch targets for every new surface; then before/after screenshots
  (desktop AND mobile) per the pr-screenshots skill, committed under docs/screenshots
  for the PR body.

INVARIANTS IN PLAY: DESIGN.md rollout phases; every player-visible string a t() key
classified by render sink; the view-core + painter contracts (write elision for every
per-frame painter, the two cold-window contracts otherwise; hud_perf_budget buckets
decide which); graphics settings stay gameplay-neutral; IWorld-only reads; hud.ts and
main.ts never grow.

Out of scope: orange render-side visuals and item icons (phase 16); any balance number;
new sim behavior beyond the commission fee floor named above.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run <the new view-core tests> tests/hud_perf_budget.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts (plus
tests/world_api_parity.test.ts if a facet member landed, and the commission sim test if
the fee floor touched sim); npm run ci:changed; the mobile screenshot script. Review
Dispatch Matrix (implementation-plan.md): frontend-seam-reviewer (always here);
cross-platform-sync if a facet member landed; architecture-reviewer if the fee floor
touched src/sim/. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(ui): perfecting window view-core and painter
- feat(ui): masterwrought cap visibility and commission signaling
- feat(game): sfx cues for perfecting and the orange moment
- docs(screenshots): crafting ux before and after captures

STEP 5 - ACCEPTANCE:
- [ ] Perfecting panel is a registered view-core + painter pair; buckets satisfied
- [ ] Bind warning shown BEFORE the first attempt (R2); undo/no-downgrade copy accurate
- [ ] Cap indicators live in the character panel + tooltips in both hosts
- [ ] Commission signaling + minimum-fee floor working and tested
- [ ] SFX conformant; mobile layouts pass; screenshots committed and referenced
- [ ] All listed suites green; ci:changed clean; DESIGN.md compliance stated in the report

STEP 6 - DOCS: progress.md Phase 14 row; state.md ledger (view-cores, painters, i18n
keys, cue ids, any facet member); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, screenshot
paths, handoff line for Phase 14 QA.

STOPPING RULES: stop and ask if the Perfecting flow cannot be expressed without a
repeating driver of its own (a cold-window contract breach), or if the commission fee
floor demands an economy rule state.md does not record.
```
