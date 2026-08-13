# Phase 13: Integration polish and the handoff

The closing phase: no new mechanics, only the surfaces that make the feature complete
and maintainable. The wiki farming page, the full-journey screenshot set, the
model-sourcing handoff manifest in docs/design (deliberately outside this packet so it
survives teardown), the deferral sweep, and the whole-feature audit against
docs/farming/qa-checklist.md. docs/farming/state.md is the authority; if this file
contradicts it, state.md wins and this file plus phase-13-qa.md get swept in the same
pass.

Live-surface note (binding): LIVE, complete. No new mechanic ships. This phase merges the wiki
page, the screenshots, the asset handoff manifest, and the recorded whole-feature audit
evidence. After it, the feature is done and the packet is ready for the teardown offer
in Phase 13 QA.

### Starter Prompt

```
This is Phase 13 of the Farming feature: Integration polish and the handoff.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: the feature is documented, photographed, handoff-ready, and audited whole, with
zero new mechanics.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Use
  git -C ~/Documents/woc-farming-plan for every git command.
- git status must be clean. If it is not, stop and surface; never stash or discard WIP
  that is not yours.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create branch
  fix/farming-phase-13-integration-polish off LOCAL feature/farming-plan (D22: never
  off the release tip, which lacks the packet and all farming work), then MERGE the
  newest release tip INTO the phase branch FIRST: run the release-merge-audit skill
  plus the state.md deviation (al) absorb checklist, re-run the parity and count-pin
  suites, and verify the farming_session golden md5 unchanged. A jump of a minor
  version or more (or a triple-digit intersection) runs
  docs/farming/phase-06b-release-sync.md's shape as its own mid-phase BEFORE this
  phase instead. Record the phase-start commit sha.
- If release moves mid-phase and this branch turns long-lived, merge release in and run
  the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: pr-screenshot-browser-path, node25-breaks-jsdom-gate,
  malware-scan-comment-keywords, worktree-cwd-drift-misroutes-git,
  no-claude-session-links, i18n-semantic-regressions-gate-trap.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (very thorough) to read and summarize: docs/farming/state.md,
docs/farming/progress.md (EVERY phase's Notes block, for the deferral sweep),
docs/farming/phase-13-integration-polish.md, docs/farming/qa-checklist.md, and these
sources: src/guide/CLAUDE.md (where guide.* prose keys land and the spoiler-safe
rules), tests/guide.test.ts (the freshness gate), scripts/assets/build_farm_props.mjs
(the complete inventory of swap-ready farming assets as authored),
src/render/farm_patches.ts and the feast adapter arm (footprints, pivots, tints, stage
lists as consumed), plus the CLAUDE.md files: root, src/ui/CLAUDE.md,
src/render/CLAUDE.md, and docs/design/deeds.md if the wiki page covers deeds. V0.38.0
SYNC ADDITION (2026-08-13, Phase 6b): the release added the Reliquary and its
same-change obligation (docs/design/reliquary.md, pinned by
tests/reliquary_content.test.ts): any phase that added conquerable UNIQUE farming
loot owes a Reliquary page, so this phase's obligations sweep checks the whole
farming content set against that gate too (as of the sync no farming item qualifies;
a future golden_harvest trophy would). The
orchestrator never reads planning docs or coordinator monoliths directly; the summary
is your only context.
The summary must return, explicitly:
- Where guide.* prose keys land, the spoiler-safe rules that bind them, the wiki regen
  chain (npm run wiki:content) and exactly how tests/guide.test.ts gates freshness.
- The complete inventory of swap-ready farming assets with their authored parameters:
  the bed, every growth-stage mesh in every crop family, every withered variant, the
  compost bin, and the feast, each with footprint, pivot, tints, and stage list as they
  exist in the exporter and adapters.
- Every deferral recorded in any progress.md Notes block, verbatim, with its phase.
- The docs/farming/qa-checklist.md rows and what evidence each demands.
- The pr-screenshots recipe plus the pr-screenshot-browser-path memory facts.
- The i18n catalog modules Phases 1 to 12 touched, for the final IP-safe audit.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Spawn three implementation agents by vertical slice, each owning its slice plus its
checks. Fan-out reminders: request the fan-out explicitly and spawn all three in one
message so they run in parallel; give each agent ONLY the Explore summary plus its own
bullets (never a planning doc to read); never run a teammate in plan mode.
- Agent A, the wiki page (guide): the guide.* prose keys for the farming page,
  spoiler-safe per src/guide/CLAUDE.md, regenerated via npm run wiki:content, with the
  tests/guide.test.ts freshness gate green. Then the final IP-safe naming audit (D17)
  across EVERY player-visible farming string in the i18n catalog modules the Explore
  summary listed: real plant words and original zone-flavored coinages only, no coined
  terms from other games; report each string checked.
- Agent B, the handoff and the photographs (docs plus screenshots):
  docs/design/farming-asset-manifest.json listing EVERY swap-ready asset (the bed, each
  growth-stage mesh per family, the withered variants, the compost bin, the feast),
  each row carrying footprint, pivot, tints, stage list, and a replacement-intent note
  (what a sourced model must match to drop in without code changes). Cross-check the
  manifest against scripts/assets/build_farm_props.mjs and the render adapters: every
  exporter output and every adapter consumer has a row. This manifest is the
  maintainer's model-sourcing handoff and lives in docs/design so it SURVIVES packet
  teardown; it must not reference any docs/farming/ path. Then the full-journey
  screenshot set (plant, growth stages, harvest, the Harvest Journal, the feast;
  desktop and mobile) via the pr-screenshots skill, committed under docs/screenshots
  (git add -f by EXPLICIT path per the memory entry: docs/screenshots is gitignored,
  so the force-add by explicit path is the sanctioned exception per the repo
  screenshot workflow; never a bare -A or a tree-wide force) and referenced from the
  PR body.
- Agent C, the sweep and the audit (docs): the deferral sweep: every progress.md Notes
  deferral collected into docs/farming/state.md and staged for the PR body, none lost.
  Then the full execution of docs/farming/qa-checklist.md, including the anti-chore
  audit, with evidence recorded per row (a test run, a probe transcript, or a
  screenshot; never "looks done"); record the evidence in the progress.md Phase 13
  Notes block.
After the slices merge, YOU (the orchestrator) run the full npm run gate.

INVARIANTS THIS PHASE MUST KEEP
- The manifest is complete: every swap-ready asset has a row with footprint, pivot,
  tints, stage list, and replacement-intent notes; an asset missing from it cannot be
  replaced later without code archaeology, so a missing row is a defect.
- No em dashes, en dashes, or emojis in any prose, wiki keys and manifest notes
  included.
- Every player-visible farming string passes the final IP-safe audit (D17).
- No new mechanic, no balance change, no tuning change of any kind.
- Generated wiki content is never hand-edited: regen via npm run wiki:content only.
- All commits use explicit paths, never git add -A.

Out of scope (do NOT do in this phase)
- Any new mechanic, item, recipe, deed, or tuning change.
- The packet teardown (Phase 13 QA offers it to the user; never delete docs/farming/
  here).
- Locale fills beyond the M16 requirement (release-time work via i18n-locale-fill).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npm run wiki:content, then npx vitest run tests/guide.test.ts (freshness green)
- The full docs/farming/qa-checklist.md matrix with evidence per row (Agent C's record;
  spot-check it yourself)
- npm run ci:changed
- npm run gate (the deep check; the armory browser red is the standing environmental
  exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker)
Then check git diff --name-only against the phase-start commit and dispatch
qa-checklist (the phase-completion gate) plus any Review Dispatch Matrix row in
docs/farming/implementation-plan.md the residual diff matches; if the diff is
docs-plus-guide only, qa-checklist alone is correct, and no row means no extra agent.
Every review agent gets a hard 30-tool-call budget, the coverage instruction ("report
every issue including low-severity and uncertain ones; ranking happens later"), and,
if truncated, the resume line: "Stop reading more files. Output the full report now
based on what you have already seen. No more tool calls. Format: BLOCKING /
SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a BODY, explicit paths only, never
git add -A, no session links or Claude attribution:
- feat(guide): the farming wiki prose keys and the regenerated content
- docs(design): the farming asset handoff manifest
- docs(screenshots): the full-journey desktop and mobile set
- docs(farming): the deferral sweep, the qa-checklist evidence, progress and state
  updates

STEP 5 - ACCEPTANCE CRITERIA
- [ ] The wiki farming page is regenerated via npm run wiki:content, the
      tests/guide.test.ts freshness gate is green, and the prose is spoiler-safe per
      src/guide/CLAUDE.md.
- [ ] docs/design/farming-asset-manifest.json exists and lists every swap-ready asset
      (the bed, each growth-stage mesh per family, the withered variants, the compost
      bin, the feast) with footprint, pivot, tints, stage list, and replacement-intent
      notes, cross-checked against the exporter and adapters.
- [ ] The manifest references no docs/farming/ path (it must survive teardown intact).
- [ ] The full-journey screenshot set (desktop and mobile) is committed under
      docs/screenshots and referenced from the PR body.
- [ ] Every progress.md Notes deferral is swept into state.md and the PR body.
- [ ] docs/farming/qa-checklist.md is executed in full, anti-chore audit included, with
      evidence recorded per row.
- [ ] The final IP-safe audit covered every player-visible farming string.
- [ ] No em dashes, en dashes, or emojis anywhere in the new prose.
- [ ] npm run gate green modulo the armory environmental exception; ci:changed green.

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (the Phase 13 status row, the acceptance list above
copied with its check states, a Notes block holding the qa-checklist evidence and any
last deferrals) and the docs/farming/state.md ledgers (the swept deferrals, any final
drift). Any deviation decided in-phase gets swept into
docs/farming/phase-13-integration-polish.md AND docs/farming/phase-13-qa.md in the same
pass. Record genuine surprises in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (complete or partial with reasons); files touched, grouped by
surface; validation results per command including the qa-checklist row verdicts; review
verdicts per agent; deferrals with reasons; one line handing off to the Phase 13 QA
session (the final audit and the teardown offer).

STOPPING RULES
- Stop if any qa-checklist row fails with evidence: fix it inside phase scope or
  surface it; never wave a row through, and never add a mechanic to make a row pass.
- Stop if an asset exists with no manifest row and its parameters cannot be recovered
  from the exporter or adapters: surface it; never guess a footprint or pivot.
- Stop if git status is dirty at STEP 0 or the newest release branch cannot be
  resolved.
- Stop while any review BLOCKING stands.

Close: gate via node scripts/gate_select.mjs (the armory browser red is the standing
environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker, never trust a piped exit code;
PR CI is the arbiter). Push and open the PR against the release branch this phase was
based on, following .github/PULL_REQUEST_TEMPLATE.md. Screenshots via the pr-screenshots
skill apply to the visual phases (12 and 13); this phase IS one, so the PR body
references the committed full-journey set. No Claude attribution or session links in
commits or PR text.
```
