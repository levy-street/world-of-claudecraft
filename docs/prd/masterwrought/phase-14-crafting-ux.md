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

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

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

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The prompt above is not
retracted and not rewritten. This section is part of it, and it is the largest amendment
in the packet. Read it after STEP 0 and fold every item into the matching step.

**The phase's goal grows.** It stops being "dress the Perfecting flow" and becomes: make
ONE professions interface out of two independently designed families. The reason is hard
and checkable, not a matter of taste. Farming's entire doc set contains ZERO references
to `DESIGN.md`, so the Harvest Journal, the plant sheet, the bed verbs, the feast
tooltip, and `farm_event_feedback` were built and QA'd without the standard ever being
cited. Phase 14 is the only phase in either packet that can hold them to it, and after
Phase 14 nothing else will.

**STEP 0 additions.**
- DECISION 4 (monolith ceiling policy) IS SETTLED (2026-08-20; rows 11b-D-4, 11d-D-4 and
  11d-U6-PAYBACK). Nothing is confirmed here.
  **TRUED 2026-08-21 by the Phase 11d QA. Everything in the paragraph below was
  written BEFORE 11d ran, and the real resolution falsified it. Read the amendment
  first.**
  What 11d actually did: TWO recorded raises (renderer.ts and online.ts, both paying
  back at Phase 16), and `hud.ts` FELL rather than rising, to 19248 at the absorb and
  then to 19235 when the QA synced release tip 35a6481825. So there is no `hud.ts`
  raise for this phase to pay back, the 19445 target is already met with 210 lines to
  spare, and the "roughly 274 lines of extraction owed" figure below is not merely
  stale: it is the cost of the option 11d explicitly REJECTED (strict
  only-ever-lower), imported here and presented as the live obligation. The
  "take-theirs floor 19324" is not a floor either; the resolver ported BOTH packets'
  extractions instead of picking a hunk side, which is why the file landed 89 lines
  under that bound.
  THE LIVE OBLIGATION, and the whole of it: this phase MAY NOT GROW `hud.ts`. The
  ceiling is pinned at the exact count with zero slack, so any growth reds, and
  raising a ceiling is a maintainer decision (root CLAUDE.md and the row's own
  comment). The `ip-14-UI` professions-module migration still counts for nothing
  either way, because a file move relocates zero lines out of `hud.ts`.
  The superseded pre-merge estimates, kept because other documents cite them and the
  packet told future sessions not to "correct" them: masterwrought's pin was 19445 at
  zero slack, farming's pin 19186 with its file at 19183, the merged clean region
  19235, the take-theirs bound 19324, and the estimated merged resolution about
  19460, with roughly 141 masterwrought lines outside every conflict region.
- Read the packet's open-item collection point (`docs/prd/masterwrought/farming/state.md`)
  for farming's (be) row, the simplified-mode gathering rows classified as a Professions
  2.0 surface change. It is an open maintainer ruling touching the same panel family the
  Masterwrought slot indicators go into. Do not resolve it here; do not contradict it.
- Memory scan gains: the farming HUD window traps and the mobile window-open body-class
  family.

**STEP 1 additions (Explore agent).**
- The merged professions UI family, whole. Masterwrought's roughly 20 modules sit at
  `src/ui/` root (`crafting_view.ts` / `crafting_window.ts`, `commission_order_view.ts` /
  `_window.ts`, `enchanting_view.ts`, `craft_denial_line_view.ts`,
  `craft_celebration_view.ts`, `profession_identity_*`, and the rest). Farming's five sit
  beside them: `src/ui/farming_plant_sheet_view.ts` / `_window.ts`,
  `src/ui/harvest_journal_view.ts` / `_window.ts`, `src/ui/farming_view.ts`,
  `src/ui/farm_event_feedback.ts`, `src/ui/feast_tooltip_view.ts`. There is NO
  `src/ui/hud/professions/` barrel today (`src/ui/hud/` holds action_bar, battleground,
  chat, cosmetics, cross_hotbar, delve, fiesta, loot, map, player_card, quest, rift,
  vendor, warlock).
- Farming's a11y patterns as shipped, and the axe browser suite rows that bind them.
- The merged `tests/hud_perf_budget.test.ts` bucket table.
Return additionally: which farming surface solves each shared visual problem, the exact
a11y attribute patterns, and the merged bucket assignments.

**STEP 2 additions.**
- THE MODULE PLACEMENT CALL IS SETTLED (2026-08-20, row ip-14-UI): MINT AND MIGRATE. The
  prompt above says to land the Perfecting panel in "the matching `src/ui/hud/<domain>/`
  directory behind its barrel", which as written would split the family: about 25 professions
  modules at root and one new panel in a barrel. There is no choice left to make and no
  keep-at-root branch. Create `src/ui/hud/professions/` with an `index.ts` barrel and a local
  `CLAUDE.md`, and move the WHOLE family behind it as its OWN commit: pure moves plus import
  re-points, ZERO logic change, so the migration stays reviewable beside the beauty work.
  Write the `DESIGN.md` compliance statement for the farming windows in this same phase. The
  migration does NOT count toward the `hud.ts` payback target of 19445 (11d-U6-PAYBACK: a file
  move relocates zero lines out of `hud.ts`). WHY: the repo rule says HUD-domain components
  live in `src/ui/hud/<domain>/` behind a barrel, and about 25 root-level professions modules
  is the shape that rule exists to prevent.
- ONE of each, across BOTH families:
  - One token set. Farming's F14 already tokenized the plant sheet's raw rgba and the
    report window's hard-coded accent; the new masterwrought surfaces use the same tokens.
  - One window chrome and one empty-state pattern.
  - One denial-line pattern: `src/ui/farm_event_feedback.ts` versus
    `src/ui/craft_denial_line_view.ts`. Two shapes for one player moment.
  - One timer presentation. Farming's growth countdown and the Perfecting rank track are
    the SAME visual problem solved twice by two teams.
  - One placement-verb copy pattern. Farming minted a "set out" bags hint for the feast
    because "Click to use" was wrong; masterwrought's residual is the station log line
    with the article dropped. Two verbs, two copy patterns, one player action.
- REUSE farming's a11y patterns rather than reinventing them: single-select rows as a
  radiogroup (never `aria-pressed` toggles), `aria-busy` on in-flight sends, `aria-live`
  on flip-to-ready. The Perfecting panel has all three shapes (single-select target rows,
  an in-flight attempt, a flip to Perfected), and the axe browser suite already binds them
  for the farming windows.
- JOIN the mobile body-class family. Farming fixed the mobile window-open body-class gap
  family-wide for its two windows and wrote the jsdom pin; the Perfecting panel
  participates identically and uses that pin as its template.
- THE CONSUMABLE TRAY IS A FIX, not an eyeball. Phase 11 recorded the tray truncating at
  6 with 6 kinds already competing; farming adds four buff dishes, a feast, and the growth
  tonic. Design the overflow, do not defer it. The packet has no defer.
- Perf contract on a MERGED budget file: masterwrought adds the Perfecting painter to a
  `tests/hud_perf_budget.test.ts` that already carries farming's journal painter. Buckets
  are re-sorted on the merged tree, never on either branch's.
- Screenshots: a new subtree needs its sparse-checkout cone row AND its `ci_workflow`
  literal in the SAME commit (farming's `docs/screenshots/farming-phase-13/` is the
  worked example). The PR body now references both packets' capture sets.

**STEP 5 additions (acceptance).**
- [ ] Module placement call made and recorded; the professions family is not split
- [ ] One token set, one chrome and empty state, one denial-line pattern, one timer
      presentation, one placement verb, stated with the file that now owns each
- [ ] Farming's radiogroup, `aria-busy`, and `aria-live` patterns reused, not reinvented
- [ ] Perfecting panel in the mobile body-class family with the jsdom pin extended
- [ ] Consumable tray overflow FIXED against the merged kind count, not truncated
- [ ] `hud.ts` ceiling payback landed by extraction and the ceiling LOWERED, with the
      merged numbers quoted in the ledger row
- [ ] Merged `hud_perf_budget` buckets green and re-sorted on the merged tree
- [ ] DESIGN.md compliance stated with evidence for the FARMING windows as well as the
      new ones

**What the QA twin additionally owes.** Its correctness-and-design agent states DESIGN.md
rollout compliance for the farming windows with evidence, because they have no prior
statement of any kind; its frontend-contract agent audits a merged bucket table and a
`hud.ts` whose slack was consumed by the union; its i18n-and-mobile agent covers both
screenshot subtrees and both placement-copy patterns.

**Stopping rule, added.** The module placement call is settled (ip-14-UI) and is never a
stop. Stop and ask if the migration cannot be done without moving a farming window that an
open farming ruling still governs, or if the `hud.ts` payback cannot reach 19445 without
touching sim or server behavior.
