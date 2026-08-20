# Phase 14: Final polish (PROPOSED)

The perfection-sweep phase. Phase 13 QA (2026-08-19) classified every finding ever
recorded in the program into RESOLVED / ACTIONABLE-IN-REPO / MAINTAINER-GATED /
ACCEPTED-BY-DESIGN per the D22 addendum's amendment (C). This packet scopes EXACTLY
the ACTIONABLE-IN-REPO bucket: thirteen items needing no new mechanic, no tuning
change, and no maintainer input. Everything maintainer-gated (the D11/GATE 1 ruling,
the tuning reads, the art batch, the release-tier locale fills, the ceiling raises)
stays in the state.md MAINTAINER GATES block and is OUT of scope here; touching any
of it is a stopping-rule violation, not initiative. docs/farming/state.md is the
authority; if this file contradicts it, state.md wins and this file gets swept in the
same pass.

Delivery per D22 as amended: no push, no PR, ever. The phase lands as commits on
fix/farming-phase-14-final-polish cut off LOCAL feature/farming-plan, merges back
--no-ff, and the branch is deleted; the gate log is the arbiter. The program's
end-state delivery stays: push feature/farming-plan to origin on the user's go,
nothing more.

Live-surface note (binding): polish only. No new mechanic, no new content row, no
tuning constant moves. Items 6 and 9 touch sim/server behavior at the hygiene level
(honoring an already-validated index; extending an existing event union); both state
their zero-golden expectation inline.

### Starter Prompt

```
This is Phase 14 of the Farming feature: Final polish (the perfection-sweep
actionables). Model: Opus 4.8 or newer, xhigh effort. Harness: Claude Code.
DELIVERY per D22 as amended (state.md D22 addendum): LOCAL-ONLY, no push, no PR.
QA fixes and work land as commits on fix/farming-phase-14-final-polish cut off
LOCAL feature/farming-plan, merge back --no-ff, and the branch is deleted. The
gate log is the arbiter.

Goal: clear the ACTIONABLE-IN-REPO bucket exactly as scoped below, nothing else.
Every item discharges its state.md handoff row in the same change that lands it.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Prefix every
  shell command with cd ~/Documents/woc-farming-plan && export
  PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH; use
  git -C ~/Documents/woc-farming-plan for every git command.
- git status must be clean, on feature/farming-plan at or after the Phase 13 QA
  merge (progress.md records the hash). Stop if it is not.
- Re-resolve the NEWEST release/** branch (git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V, take the last row). If a tip
  newer than the last absorb exists, absorb per D22 FIRST (release-merge-audit +
  the state.md (al) checklist; minor-version jump or triple-digit intersection
  runs the 06b shape as its own mid-phase). Then branch
  fix/farming-phase-14-final-polish off LOCAL feature/farming-plan.
- Verify the baselines by RUNNING the suites (never trust this file over them):
  farming_session golden md5, IWorld counts, command counts, delta keys, the
  monolith ceilings (hud.ts is EXACT-ZERO 19214/19214: any Hud line is
  extraction-first from the outset; renderer.ts 13774/13774 is NEVER touched,
  three evidence seals; sim.ts 12246/12249).
- Read the state.md MAINTAINER GATES block and the D22 addendum. Scan memory:
  farming-skill-program (the Phase 13 QA paragraph), mutation-checks-commit-first,
  big-diff-reviewer-turn-budgets, no-claude-session-links.

THE SCOPE, exactly thirteen items (each names its origin and its acceptance):

LANE A - UI polish (src/ui, src/styles seams)
A1. The mobile-window-open body-class gap, FAMILY-WIDE for the two farming
    windows: the harvest journal and the plant sheet do not set the
    mobile-window-open body class the sibling windows set, so the mobile chrome
    does not yield while they are open (P9b QA residual; handoff row "Mobile
    window-open body-class gap"). Acceptance: both windows participate exactly
    like a sibling window; a jsdom arm pins the class on open and its removal on
    close for BOTH windows; mobile landscape 844x390 screenshot of each, LOW
    preset, committed under the EXISTING docs/screenshots/farming-phase-13/
    subtree or a properly coned new one (cone rows + ci_workflow literal in the
    same commit if new).
A2. The style batch: .ps-seed's raw rgba() literal and the report window's
    #ffd100 literal move onto the tokens the styles contract names (P9b QA
    residual; handoff row "Style batch"). Acceptance: no raw color literal in
    either rule; the styles suites and css corpus stay green; visual parity
    eyeballed (before/after screenshot pair).
A3. The bags feast hint says a generic "Click to use"; it needs its own "set
    out" key (the feast is placed, not eaten) plus the five M16 non-Latin fills
    in the same change (P12 QA deferral; handoff row "Bags feast hint copy").
    Acceptance: new catalog key + fills, rendered through t(), pinned by literal
    on the bags row for the feast item; English-only elsewhere per the i18n
    contract.
A4. The a11y batch, farming-introduced surfaces ONLY: the plant sheet's seed
    rows are single-select but expose aria-pressed toggles (should be a
    radiogroup per the recorded note); the sheet's in-flight send has no
    aria-busy affordance; the journal's flip-to-ready needs its recorded
    aria-live design follow-up; the husk-trade row's aria label gap (P8/P9b QA
    residuals; handoff row "A11y polish batch"). Acceptance: axe browser suite
    green; the real-browser a11y test exercises the changed semantics; no
    keyboard regression (the P9b keydown-guard pins stay green).
A5. The i18n pending generator emits pending Latin rows for RETIRED keys
    (guide.profPages.gatherDeeds.farming is the outlier vs the harvestBodyChoice
    precedent), so the release fill pass would be asked to translate prose that
    never renders (Phase 13 QA frontend review NICE-TO-HAVE). Acceptance: the
    generator excludes RETIRED_KEYS rows from pending; regen via the owning
    build step; the retired key keeps its five filled non-Latin overlays; the
    release-tier gate stays green.

LANE B - sim/server hygiene (src/sim, server)
B6. useItem's feast arm ignores the validated slotIndex and re-scans bags for
    the item id (P12 QA deferral; handoff row "useItem feast arm"). Acceptance:
    the arm consumes from the validated slot exactly like the sibling arms; a
    test plants two feast stacks and proves the CLICKED slot is the one spent;
    zero golden movement (no scenario places two feast stacks).
B7. countRawInSlots is the fifth private copy in src/ui, and the bed-distance
    read re-derives the sim's private distToBed by comment contract (P9b QA
    residual; handoff row "countRawInSlots fifth copy"). Acceptance: one shared
    export each behind the existing seams (the sim util exported from its owning
    module, the UI copies deleted; distToBed exported and consumed by the
    mirror), rule-of-three satisfied, all callers migrated, no behavior change
    (the suites that pinned the copies re-point at the shared export).
B8. Sim.mobMeleeRange lost its last production caller in the M5 extraction and
    survives only for a test-by-cast (Phase 13 QA dead-code lane; architecture
    review NOTE). Acceptance: the delegate is retired, tests/threat.test.ts
    re-points at mobCombatProfile(mob).meleeRange (or the module import), sim.ts
    shrinks, the monolith ceiling is LOWERED to match, tsc clean.
B9. The gatherDowngrade surface union gains 'crop' so a full-bag golden-harvest
    downgrade names its surface instead of riding the silent signature
    truncation ((bu) follow-up; handoff row "gatherDowngrade surface union").
    Acceptance: the union member, the farming emit site, and the client line
    land together; S3 green; EXPECT zero golden movement (no scenario downgrades
    on full bags); if a golden moves anyway, STOP, classify, and re-record only
    in a deliberate isolated commit with the machine classification recorded.

LANE C - guide, comments, test depth
C10. The wiki shows no consumable-effect prose for ANY dish (P12 QA deferral;
     handoff row "Wiki effect-prose generator gap"). Acceptance: the guide
     generator renders the foodHp line and the well-fed boon line for the
     dishes from live item data (docs/design/tooltip-writing.md rules,
     spoiler-safe: no probabilities, no hidden constants); wiki regen committed
     fresh (the freshness gate binds it); guide prose stays honest against the
     (bo) dormancy disclosure (the later-patch pins in tests/guide.test.ts must
     stay green untouched).
C11. Nameplate comment pair: the feast row's INTERACT_RANGE + 1 hysteresis
     comment overstates the pad, and non-player farming casts render a raw-id
     cast label (the pre-existing class shared with craft/enchant/salvage;
     handoff rows "Nameplate feast row" and "Nameplate raw-id cast label").
     Acceptance: the comment states the real pad; the farming cast ids gain
     their display-name rows through the existing cast-name path (the
     cast_display_name module); the class-wide fix for the other trades is OUT
     of scope, note it discharged for farming only.
C12. tests/mob_boss_mechanics.test.ts depth (Phase 13 QA architecture + coverage
     NICE-TO-HAVEs): add the summon-threshold loop case directly against the
     module (fires once per pull via firedSummons, resets on evade) and
     de-fragilize the two "stays silent" arms (drain pre-act events so a future
     benign log cannot red them spuriously). Acceptance: new arms kill a
     deleted-countdown mutant and a threshold-loop mutant through the DIRECT
     import (not the Sim delegate); mutation-check through the dirty-refusing
     runner AFTER committing.
C13. The perfection-sweep records: every item above discharges its handoff-table
     row in state.md in the SAME commit that lands it (status moves to
     closed-by-Phase-14 with the commit hash); progress.md gains the Phase 14
     block with the acceptance matrix and the mutation kill table (itemize it;
     the P12 omission lesson).

INVARIANTS (all standing rules bind; the load-bearing ones restated)
- No new mechanic, no tuning constant change, no maintainer-gated item.
- Zero golden movement except B9's stated contingency (isolated, classified).
- hud.ts 19214/19214 EXACT-ZERO: any Hud line is extraction-first from the
  outset. renderer.ts is NEVER touched. Ratchet ceilings only ever LOWER.
- Every player-visible string is a t() key; new wordy English carries M16 fills.
- Fix bugs test-first; mutation checks only after committing, through a
  dirty-refusing runner, rc nonzero AND named failing tests AND a summary line.
- No em dashes, en dashes, or emojis. No session links or Claude attribution.

STEP N - REVIEWS + CLOSE
- Dispatch the matrix rows the diff matches (architecture-reviewer for B6-B9,
  cross-platform-sync for B9 in particular: a SimEvent union member is a wire
  shape change and takes the parity reviewer, not architecture alone;
  frontend-seam-reviewer for A1-A5 and C10-C11, test-coverage-auditor for C12),
  FRESH, hard 30-tool-call budgets, report-first; qa-checklist LAST.
- Gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
  chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs on the
  frozen committed tree (never edit while a gate runs). A run passes only when
  the exit code is 0 AND the log prints the PASS marker; a printed FAIL marker
  overrides a zero exit (the recorded shell-exit-lied precedent). Budget the
  druid_engines 20 s contention timeout as the recorded environmental flake
  (prove it standalone if it fires, do not chase it).
- Merge --no-ff into LOCAL feature/farming-plan, delete the branch, record the
  merge hash in progress.md and the farming-skill-program memory topic.

ACCEPTANCE (the phase is done when every box is checked)
- [ ] A1 body-class family fix landed with pins + mobile shots
- [ ] A2 style literals tokenized, suites green
- [ ] A3 feast hint key + five fills, pinned
- [ ] A4 a11y batch (radiogroup, aria-busy, aria-live follow-up, husk aria), axe green
- [ ] A5 pending generator excludes RETIRED_KEYS, regen committed
- [ ] B6 feast arm consumes the validated slot, two-stack proof
- [ ] B7 shared countRawInSlots + distToBed exports, copies deleted
- [ ] B8 mobMeleeRange delegate retired, ceiling lowered
- [ ] B9 gatherDowngrade 'crop' member end to end, zero golden movement
- [ ] C10 dish effect prose generated, freshness green, dormancy pins untouched
- [ ] C11 nameplate comment truth + farming cast labels
- [ ] C12 boss-mechanics direct-suite depth, mutants killed named
- [ ] C13 handoff rows discharged in-commit, progress block + kill table written
- [ ] Gate PASS by log markers on the frozen tree; merge hash recorded

STOPPING RULES
- Stop if any item turns out to need a mechanic, tuning, or maintainer decision:
  ledger it back to the handoff table instead of deciding it.
- Stop if any golden or parity pin moves outside B9's stated contingency.
- Never push, never open a PR, never execute the packet teardown, never generate
  committed item art.
```
