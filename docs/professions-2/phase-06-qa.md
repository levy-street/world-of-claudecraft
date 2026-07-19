# Phase 06 QA: Verify Crafting window upgrades and celebrations

Audit the Phase 6 implementation (crafting window legibility, masterwork celebrations with the
zone-visible broadcast, tier-up toasts, maker's mark tooltips, and the two sanctioned seam
touches: the zone-broadcast sim emit and the online-inspect identity-wire extension) for
correctness, missing tests, dead code, determinism, three-host parity, and
i18n completeness.

## QA Starter Prompt

```
This is Phase 06 QA of the Professions 2.0 feature: Verify Crafting window upgrades and
celebrations.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context
variant where the file load demands it.
Harness: Claude Code.

Goal: Audit the Phase 6 implementation for correctness, missing tests, dead code,
determinism, three-host parity, and i18n completeness for THIS phase's surfaces.

STEP 0 - PRE-FLIGHT:
- Verify `git status` is clean (Phase 6 implementation should already be committed). If
  dirty, ask the user (a concurrent session may share this checkout).
- Memory scan (if you use Claude Code memory): check your `MEMORY.md` index and entries
  from this phase's domain (suggested topics: the design-language program guardrails, the
  node25-breaks-jsdom-gate rule for Node 24 gating, and the PR 2039 / combo-recipes-online
  state behind combo_eligibility and the cprof syncing flag).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (the Phase 6 entry under "New surfaces per phase", the
  locked combo-eligibility and masterwork decisions, the validation matrix)
- docs/professions-2/progress.md (the Phase 6 deliverables checklist and any noted
  deferrals)
- docs/professions-2/phase-06-crafting-window.md (the implementation prompt: what was
  promised, the acceptance criteria)
- All files created or modified in Phase 6 (use `git diff` against the phase-start commit)
- CLAUDE.md (root), src/ui/CLAUDE.md, src/styles/CLAUDE.md
The agent must return: the full list of Phase 6 deliverables and acceptance criteria, all
new and modified files, the new hudChrome keys and the broadcast localization path, and
any known issues or deferrals noted in progress.md.

AS-LANDED DEVIATIONS (2026-07-19, authoritative over this file's older wording; the
state.md Phase 6 surfaces entry carries the full record):
- There is NO sim_i18n matcher rule for the masterwork broadcast. The broadcast landed
  as a structured, text-free masterworkZone SimEvent (ids plus values, the Phase 4
  gatherRareEvent precedent); the HUD localizes it via hudChrome.crafting
  masterworkZoneLine and the S3 guard passes by construction. Do not fail the audit
  hunting a matcher row; DO verify the guard is green and the event carries no English.
- The celebration gate is the deeds pure-plan style (craft_celebration_view.ts,
  buildDeedUnlockPlan precedent); no deed-fireworks module exists anywhere. Reduced
  motion trims only the banner fade (plan.motion, consumed by showBanner); the log
  lines, banner text, sound, and the polite ARIA announcer are never gated.
- The parity golden professions_craft eventDigest was re-pinned deliberately in its own
  commit (the crafter receives their own masterworkZone copy); rng fingerprints are
  byte-identical, which is the no-rng proof.
- The gear-inspect surface is hud.ts openInspect/buildInspectSlotRow, NOT
  armory_inspect.ts (that file is the cosmetic skin panel and was left untouched).
- eqi rides identityFields beside eq (never ALL_DELTA_KEYS or dynamicFields), trimmed
  server-side to signer/enchant/rolled (the boundTo/charges strip is negatively pinned
  in tests/snapshots.test.ts).
- The skill-gain difficulty label consumes the shared craftSkillGainMultiplier
  (src/sim/professions/archetype.ts), the same function the sim grant site calls; the
  ceiling arm is archetypeCeilingFor ALONE, never craftCeiling.

STEP 2 - QA AUDIT (spawn the three agents below in parallel, using only the Explore
summary; prompt each for COVERAGE not filtering: report every issue including low-severity
and uncertain ones, ranking happens in a later step):

Correctness agent:
- Verify every Phase 6 deliverable was actually implemented and every acceptance
  criterion in the phase prompt is met.
- Run the phase's validation commands: npx tsc --noEmit; npx vitest run
  tests/crafting_view.test.ts tests/localization_fixes.test.ts plus the updated window
  tests; the mobile guard trio (tests/mobile_window_coverage.test.ts,
  mobile_window_transform.test.ts, mobile_window_layout.test.ts); npm run i18n:gen then
  npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts; the
  seam-touch rows: npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/world_api_parity.test.ts tests/architecture.test.ts
  tests/professions_masterwork.test.ts tests/professions_crafting.test.ts (the Phase 2
  drawCounts pins must be green: the zone-broadcast emit draws no rng).
- Exercise the real behavior, not just the tests: with npm run dev (and npm run server
  for the online host), open the crafting window, walk recipes across skill tiers, force
  each eligibility state, craft until a masterwork procs (dev commands allowed locally),
  and confirm the toast, the ZONE broadcast row (a SECOND nearby client must see it, the
  crafter's own toast is not the probe), the tier-up toast at a 25/50/75 crossing in both
  hosts, and the tooltip seal appear; inspect the crafter from the second client and
  confirm the masterwork seal, enchant, and maker's mark render from the extended
  identity wire (liveness, not shape: the 2033 stub trap); capture the mobile
  screenshot of the crafting window.
- Verify the offline Sim path and the online ClientWorld path present identical rows,
  reasons, and celebrations (the craft button never lies in either host).
- Check edge cases: empty recipe list, unknown recipes, boundary skill values at tier
  edges for the difficulty tint, a tier_unmet reason naming multiple unmet crafts.

Test coverage agent:
- Identify new code paths without tests: every rows-model branch (each eligibility
  reason, the station badge and out-of-range reason, each tint band), the celebration
  gate (including its reduced-motion arm), the tooltip composition for signed, masterwork,
  and plain instances.
- Add the missing tests; if any src/sim/ file changed in Phase 6, add a determinism test
  (same seed, same result) and run tests/architecture.test.ts.
- Update tests broken by Phase 6, remove orphaned tests for replaced code, and verify
  assertions are decisive (they pin the rendered reason text ids, not just "it runs").

Dead code and cleanup agent:
- Find unused imports, types, helpers, and CSS left behind in src/ui/crafting_view.ts,
  src/ui/crafting_window.ts, src/ui/hud.ts, and the new celebration module.
- Verify sim purity holds: src/sim/ gained no ui/render/game/net or DOM imports, and the
  view core stayed DOM-free (UI_PURE_CORES).
- Verify zero hex literals landed outside tokens.css/theme.ts and no DESIGN.md phase
  vocabulary crept in.
- Remove commented-out code and resolve or file every leftover TODO/FIXME.

PHASE-SPECIFIC QA EMPHASIS (probe these explicitly):
- Exercise EVERY combo_eligibility branch against the rendered rows: not_attuned,
  wrong_pair, tier_unmet (with the unmet crafts named, including the multi-craft case),
  eligible, and the client syncing state, which must keep the optimistic enabled button
  per the locked decision in state.md while the server still re-validates.
- Legacy signed instances WITHOUT a masterwork flag (signed before Phase 2): the maker's
  mark tooltip line renders, no seal overlay appears, and nothing throws.
- Fairness: the difficulty tint, eligibility reasons, and station badges are identical
  across every graphics preset and tier; reduced motion trims celebration motion only,
  never the masterwork information (toast, broadcast, and seal still convey it).
- The bare-disabled-button sweep: enumerate every disabled state the window can produce
  and confirm each one names its reason inline.
- The zone-broadcast audience (2026-07-17 seam touch): a nearby player sees the
  masterwork broadcast row and a distant player does not; the crafter's own toast still
  renders from the personal Phase 2 SimEvent; the emit rides the Phase 4 soft-zone
  mechanism and draws no rng (drawCounts pins green).
- Tier-up toasts: fire at every TIER_SKILL_STEP crossing, client-derived identically in
  both hosts, never on a non-crossing skill gain, and reduced-motion aware.
- Online-inspect payloads (2026-07-17 seam touch): another player's masterwork and
  enchant stats are visible via inspect in the ONLINE host (parity-pinned, live); and
  the standing security invariant holds: no wire command ingests a client-supplied
  ItemInstancePayload (attempt one; the server must re-mint or reject).

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md (the plan carries the one canonical copy).
Check `git diff --name-only` against the phase-start commit and spawn ONLY the agents
whose row matches (expected here: frontend-seam-reviewer, cross-platform-sync for the
broadcast localization path, the SimEvent emit, and the identity-wire extension, and
architecture-reviewer for the sanctioned sim touch), plus qa-checklist (this is the
phase-completion QA gate).
Prompt each for COVERAGE not filtering. Resume any review agent that truncates
mid-analysis with: "Stop reading more files. Output the full report now. No more tool
calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 3 - FIX:
Apply all BLOCKING and SHOULD-FIX items. Rerun the validation rows from state.md (at
minimum npx tsc --noEmit, tests/crafting_view.test.ts, the S3 guard
tests/localization_fixes.test.ts, and the mobile guard trio if window CSS changed).
Commit fixes with EXPLICIT paths (never `git add -A`), Conventional Commits with a body,
in separate commits from the QA verdicts so the history is reviewable.

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md (mark Phase 6 QA complete; note any items
  deferred to follow-up).
- Update docs/professions-2/state.md (any drift discovered during QA, e.g. a corrected
  key namespace or module path in the Phase 6 entry).
- If you use Claude Code memory, record any surprising rules learned during QA.

STEP 5 - FINAL RESPONSE FORMAT:
End your turn with: QA verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL), counts of BLOCKING /
SHOULD-FIX / NICE-TO-HAVE found and fixed, deferred items, and a one-line handoff for the
Phase 7 implementation session.
(The packet-teardown offer is Phase 15 QA only and does not apply to this phase.)

STOPPING RULES:
- Stop and surface to the user if any BLOCKING item cannot be fixed without changing the
  phase scope. Fixes to the TWO sanctioned seam touches (the zone-broadcast emit and the
  inspect payload extension) ARE Phase 6 scope; anything beyond them (station-system
  changes, new craft mechanics) belongs to Phase 2 or Phase 8 and must be surfaced, not
  fixed here.
```
