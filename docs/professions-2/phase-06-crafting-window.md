# Phase 06: Crafting window upgrades and celebrations

This phase makes the crafting window legible (profession, required skill, combo requirement,
station binding) and makes progress a celebrated moment: the masterwork toast, a zone-visible
masterwork broadcast, tier-up toasts at every skill-tier crossing, the tooltip seal, and the
maker's mark. It builds on surfaces earlier phases already shipped: Phase 2's masterwork
SimEvent and instance flag, PR 2039's shared `combo_eligibility` rule, and today's
`requiresHubStation` station gate. It is ALMOST pure presentation; the 2026-07-17 amendments
sanction exactly two seam touches: (1) the zone-visible masterwork broadcast (the Phase 2
SimEvent is PERSONAL, pid = crafter, so the zone audience rides the Phase 4
soft-zone-broadcast mechanism via a small deliberate emit at the craft site) and (2) the
identity-wire extension that makes another player's masterwork and enchant stats inspectable
online (the Phase 2 QA drift decision resolves as EXTEND). Everything else renders what
already exists.

## Context pointers

- `docs/professions-2/state.md`: locked decisions (combo eligibility deny reasons and the
  optimistic `syncing` button, the masterwork model, the fairness and design constraints), the
  validation matrix (ui/render row and i18n row), and the "Key existing surfaces" section
  (crafting gates, `ItemInstancePayload`, stations today).
- `docs/professions-2/progress.md`: the Phase 6 deliverable checklist to mirror on completion.
- `docs/professions-2/implementation-plan.md`: team workflow, the Review Dispatch Matrix (the one
  canonical copy), and the design-language guardrails every UI phase must obey.
- `src/ui/crafting_view.ts`: the DOM-free rows model (the view core this phase extends).
- `src/ui/crafting_window.ts`: the window painter that renders the rows model.
- `src/ui/hud.ts`: the `craftResult` toast arm and the item tooltip composition. Read narrowly;
  it is an active extraction target and must never grow (new logic goes in sibling modules).
- `src/sim/professions/combo_eligibility.ts`: the shared eligibility rule and its reason union
  (`not_attuned`, `wrong_pair`, `tier_unmet`); this phase only reads it.
- `src/sim/professions/wheel.ts`: `tierForSkill` and `tierCapability`, the inputs to the
  skill-gain difficulty tint.
- `src/ui/i18n.catalog/hud_chrome.ts`: where every new English key lands.
- `src/ui/sim_i18n.ts`: the matcher that re-localizes id-based sim text (the masterwork
  broadcast row resolves here).
- Issue #2037 (recipe skill legibility): this phase closes its scope.
- `CLAUDE.md` (root), `src/ui/CLAUDE.md`, `src/styles/CLAUDE.md`.

## Starter Prompt

```
This is Phase 06 of the Professions 2.0 feature: Crafting window upgrades and celebrations.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context
variant where the file load demands it.
Harness: Claude Code.

Goal: make the crafting window legible (skill, combo, station) and make progress a
celebrated moment: masterworks (toast + zone-visible broadcast + inspectable seal) and
skill-tier crossings (tier-up toasts).

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Verify `git status` is clean before starting. If not, ask the user (a concurrent session
  may share this checkout).
- Memory scan (if you use Claude Code memory): check your `MEMORY.md` index and any entries
  relevant to this phase's domain (suggested topics: the design-language program and its
  guardrails for src/styles/ and HUD chrome, the node25-breaks-jsdom-gate rule for running
  `npm run gate` under Node 24, and the PR 2039 / combo-recipes-online state that produced
  the shared combo_eligibility rule and the cprof syncing flag).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, key existing surfaces)
- docs/professions-2/progress.md (Phase 6 status and deliverable checklist)
- docs/professions-2/phase-06-crafting-window.md (this prompt); verify the agent has the
  same understanding of the deliverables
- src/ui/crafting_view.ts, src/ui/crafting_window.ts
- src/ui/hud.ts (ONLY the craftResult toast arm and the item tooltip composition)
- src/sim/professions/combo_eligibility.ts and src/sim/professions/wheel.ts
- src/ui/i18n.catalog/hud_chrome.ts and src/ui/sim_i18n.ts
- CLAUDE.md (root), src/ui/CLAUDE.md, src/styles/CLAUDE.md
The agent must return: the current rows-model shape in crafting_view.ts and its test file;
the full combo_eligibility reason union plus how the client syncing state reaches the view;
how requiresHubStation and canUseCraftingHubStation are exposed today; the exact Phase 2
masterwork SimEvent id and payload plus the instance.rolled.masterwork flag on the inv-wire
ItemInstancePayload (and the signer field for the maker's mark); the craftResult toast arm
and item tooltip composition points in hud.ts; the deed-fireworks celebration gate pattern
(pure module, reduced-motion aware) to copy; the existing hudChrome key namespaces and the
sim_i18n matcher rule pattern; and the design-language guardrails in play (tokens only, no
DESIGN.md phase vocabulary, mobile rules).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Spawn four agents in parallel (request the fan-out explicitly; Opus 4.8 will not
self-initiate it). Give each ONLY the Explore summary, not raw planning docs. Never
`mode: "plan"` on teammates. The four own disjoint files, so no worktree isolation is
needed; the presentation agent consumes the rows-model contract stated in the summary.

Agent view (rows model; owns src/ui/crafting_view.ts and its tests) deliverables:
- Recipe rows surface profession, required skill, and a skill-gain difficulty tint derived
  from tierForSkill/tierCapability (this is the #2037 scope). Tint colors come from the
  quality tokens and are tier-identical: the same value on every graphics preset.
- Combo rows carry the eligibility reason from combo_eligibility (not_attuned, wrong_pair,
  tier_unmet with the unmet crafts named). The client syncing state (pre-cprof) keeps the
  button enabled optimistically per the locked decision in state.md; the server
  re-validates.
- requiresHubStation joins RecipeDefLike: station-bound rows carry a station badge flag
  and, when the player is out of range, the inline disable reason.
- The view core stays DOM-free and Node-tested (it is in the UI_PURE_CORES allowlist);
  every new branch gets a unit test in tests/crafting_view.test.ts.

Agent presentation (window, tooltip, toast; owns src/ui/crafting_window.ts plus thin
touch points in src/ui/hud.ts) deliverables:
- Render the extended rows model: profession and skill line, difficulty tint, combo reason
  text, station badge, and the inline out-of-range disable reason. No eligibility state may
  render as a bare disabled button; every disabled state names its reason.
- Masterwork celebration: the craft toast shows the masterwork state; the celebration gate
  is a pure, reduced-motion-aware module in the deed-fireworks style (new logic in a
  sibling module, hud.ts stays a thin consumer).
- The crafter's own toast renders from the Phase 2 masterwork SimEvent (personal,
  pid = crafter). The ZONE-visible broadcast row renders the seam agent's emit (the Phase
  4 soft-zone-broadcast mechanism, id-based; text resolves through the sim_i18n matcher,
  coordinate the rule with the i18n agent); this agent owns only the rendering side.
- Tier-up celebration: a toast at every TIER_SKILL_STEP crossing (25/50/75), derived
  CLIENT-side from craftSkills transitions on craft results (both hosts read identical
  data; no wire change); it reuses the same toast pipeline and celebration gate as the
  masterwork toast, reduced-motion aware.
- Item tooltips gain the maker's mark line (Crafted by {name}) and the masterwork seal
  overlay for flagged instances, sourced from the inv-wire ItemInstancePayload. Legacy
  signed instances without a masterwork flag keep a correct tooltip (mark line, no seal).
- Window body CSS follows the design guardrails: today's tokens only, zero hex literals
  outside tokens.css/theme.ts, the mobile rules for the crafting window (40px tap floor)
  respected.

Agent seam (owns BOTH sanctioned seam touches: the identity/inspect wire touch points in
src/net/online.ts, server/game.ts, and the matching world_api facet, PLUS the
zone-broadcast emit module in src/sim/ that the presentation agent's broadcast row
consumes) deliverables:
- The masterwork zone-broadcast emit: a small module beside the Phase 4 event broadcasts
  (module-first, called at the craft site), emitting the id-based soft-zone broadcast the
  presentation agent renders. It draws NO rng and must leave the Phase 2 drawCounts pins
  green.
- Extend the online identity/inspect surface so another player's equipped items carry
  their ItemInstancePayload (masterwork flag, enchant, signer): the offline render mirror
  already builds them; the online inspect path gains the payloads so the tooltip seal and
  maker's mark work on OTHER players' gear (the 2026-07-17 resolution of the Phase 2 QA
  drift decision: extend, do not accept the limitation).
- Both-worlds parity: the inspect read renders identically from Sim- and
  ClientWorld-shaped inputs; parity and wire pins updated in the same change; verify
  liveness, not shape (the 2033 stub trap).
- Server authority: the payloads are server-minted rows mirrored outward; no wire command
  may ingest a client-supplied ItemInstancePayload (the standing Phase 2 security
  invariant; re-assert it in a test if the surface makes it expressible).

Agent i18n/matcher (owns src/ui/i18n.catalog/hud_chrome.ts and src/ui/sim_i18n.ts)
deliverables:
- Every new player string is an English-only t() key in the hud_chrome catalog module
  (M16: a wordy new English value also needs its five non-Latin fills in the same change).
  This covers the skill line, the difficulty tint labels, all three combo reasons, the
  station badge and disable reason, the toast masterwork text, the tier-up toast text, the
  broadcast row, the maker's mark line, and the seal label.
- A matcher rule in src/ui/sim_i18n.ts for the id-based masterwork broadcast so the S3
  guard (tests/localization_fixes.test.ts) passes.
- Values interpolate through the placeholder contract ({name}, {crafts}); never
  concatenate; numbers through the formatters.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: the only sanctioned sim BEHAVIOR change is the zone-broadcast emit (a
  Sim-side facet-member implementation required by the inspect seam touch is part of that
  touch, not a third change); neither draws ANY rng nor perturbs the craft path draw
  order (the Phase 2 drawCounts pins stay green); all randomness goes through Rng (never
  Math.random, Date.now, or performance.now) and tests/architecture.test.ts must stay
  green.
- Seam: this phase renders existing IWorld data (craftingIdentity, inventory instances,
  craftResult); if a new IWorld member becomes necessary, add it to the matching facet
  file, implement it in BOTH Sim and ClientWorld, and re-pin
  tests/world_api_parity.test.ts in the same change. Verify liveness, not just member
  shape (the 2033 stub trap).
- Server authority: the client renders eligibility and outcomes; it never decides them.
  The optimistic syncing button still submits to the server, which re-validates.
- i18n: every new player string is a t() key added in ENGLISH ONLY to
  src/ui/i18n.catalog/hud_chrome.ts (never edit the locale overlays); the sim-originated
  broadcast is re-localized via a matcher rule in src/ui/sim_i18n.ts in the SAME change
  (the S3 guard enforces it).
- Fairness: the difficulty tint, eligibility reasons, and station badges are actionable
  information and must be identical across every graphics preset and tier; reduced motion
  may trim celebration MOTION only, never the information (the toast, broadcast, and
  tooltip still convey the masterwork).
- Design-language guardrails: build on today's tokens and the shared window shell; do NOT
  introduce DESIGN.md phase vocabulary (that is a PR-blocking piecemeal re-land).
- Prime directive: nothing existing breaks. The crafting window keeps working for every
  recipe and host exactly as before where this phase adds nothing.

Out of scope (do NOT do in this phase):
- The professions wheel window (Phase 5 owns it).
- Station SYSTEM changes (Phase 8 owns typed stations and masters): only render what
  requiresHubStation and canUseCraftingHubStation already expose today.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the state.md matrix rows for this change type (ui/render plus i18n keys added):
  - npx tsc --noEmit
  - npx vitest run tests/crafting_view.test.ts tests/localization_fixes.test.ts plus every
    crafting window test you updated
  - the mobile guard trio: npx vitest run tests/mobile_window_coverage.test.ts
    tests/mobile_window_transform.test.ts tests/mobile_window_layout.test.ts
  - npm run i18n:gen, then npx vitest run tests/i18n_completeness.test.ts
    tests/localization_fixes.test.ts
  - a mobile screenshot of the crafting window (pr-screenshots skill; desktop and mobile,
    committed under docs/screenshots).
- The seam touches add validation rows: the net/wire row (npx vitest run
  tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts
  tests/world_api_parity.test.ts) and the sim rows (npx vitest run
  tests/architecture.test.ts tests/professions_masterwork.test.ts
  tests/professions_crafting.test.ts; the drawCounts pins must stay green).
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check `git diff --name-only` against the
  phase-start commit and spawn ONLY matching rows (expected here: frontend-seam-reviewer
  for the src/ui/ surface, cross-platform-sync for the sim_i18n matcher, the SimEvent
  emit, and the identity-wire extension, architecture-reviewer for the sim touch, and
  qa-checklist once the deliverable set is complete; if no row matches a part of the diff,
  spawn nothing extra).
- Prompt each review agent you spawn for COVERAGE not filtering: report every issue
  including low-severity and uncertain ones; ranking happens in a later step.
- Resume any agent that truncates with: "Stop reading more files. Output the full report
  now based on what you've already seen. No more tool calls. Format: BLOCKING /
  SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Do not commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Aim for 3 commits with these headlines (Conventional Commits with a scope; EXPLICIT paths,
never `git add -A`; every commit carries a body; no em dashes or emojis):
- feat(ui): recipe skill and requirement legibility
  (src/ui/crafting_view.ts, src/ui/crafting_window.ts, src/ui/i18n.catalog/hud_chrome.ts,
  tests/crafting_view.test.ts and the window tests)
- feat(ui): masterwork and tier-up celebrations and maker's mark
  (the hud.ts toast arm and tooltip touch points, the celebration gate module,
  src/ui/sim_i18n.ts, remaining hud_chrome keys, tests, docs/screenshots)
- feat(professions): masterwork zone broadcast and inspectable instances
  (the sim emit module, the identity wire extension, parity and snapshot pins, liveness
  tests)

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] #2037's scope is closed: recipe rows show profession, required skill, and the
      skill-gain difficulty tint derived from tierForSkill/tierCapability, in quality-token
      colors, identical on every graphics tier
- [ ] Combo rows name their requirement for every eligibility branch (not_attuned,
      wrong_pair, tier_unmet with the unmet crafts); the syncing state keeps the optimistic
      enabled button
- [ ] Station-bound rows show the badge; out-of-range rows show the inline disable reason
      (requiresHubStation joined RecipeDefLike)
- [ ] No eligibility state renders as a bare disabled button anywhere in the window
- [ ] A masterwork craft produces the crafter's toast AND a zone-visible broadcast row for
      nearby players (the Phase 4 soft-zone mechanism), plus the tooltip seal; the
      celebration gate is pure and reduced-motion aware
- [ ] Tier crossings (25/50/75) produce the tier-up toast in both hosts, client-derived
      from craftSkills transitions, no wire change
- [ ] Online inspect shows another player's masterwork seal, enchant, and maker's mark
      (identity wire extended, parity pinned, liveness verified); no wire command ingests
      a client-supplied ItemInstancePayload
- [ ] Tooltips show the maker's mark (Crafted by {name}); legacy signed instances without
      a masterwork flag render correctly (mark line, no seal, no throw)
- [ ] Craft button never lies: the window uses the same shared eligibility rule as the sim
      in both hosts
- [ ] Every new string is an English-only t() key; the S3 matcher rule landed in the same
      change; tests/localization_fixes.test.ts and tests/i18n_completeness.test.ts green
- [ ] The ui/render and i18n validation rows pass; desktop and mobile screenshots captured
      and committed under docs/screenshots

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: mark Phase 6 status and mirror the checklist; note
  any deferrals.
- Update docs/professions-2/state.md, "New surfaces per phase" gains the Phase 6 entry:
  the hudChrome crafting key namespace added, the sim_i18n masterwork broadcast matcher
  rule, the zone-broadcast emit site, the tier-up toast module, requiresHubStation on
  RecipeDefLike, the celebration gate module path, and the identity-wire inspect payload
  extension with its parity pins.
- If you use Claude Code memory, record any surprising rules or current-state notes for
  the next session.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent
verdicts, any deferred items, and a one-line handoff for the Phase 6 QA session.

STOPPING RULES:
- Packet defaults apply: stop and ask if git status is dirty at pre-flight; stop and
  surface if the Phase 2 masterwork SimEvent or the instance-payload masterwork flag is
  not actually available; stop and ask if a deliverable turns out to require a sim, wire,
  or station-system change beyond the TWO sanctioned seam touches (the zone-broadcast emit
  and the inspect payload extension); station-system changes stay Phase 8 scope.
- If Phase 4 has not landed its soft-zone-broadcast mechanism when this phase runs, stop
  and surface the ordering problem instead of inventing a second broadcast path.
```
