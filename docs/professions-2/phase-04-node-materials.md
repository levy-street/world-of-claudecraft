# Phase 04: Node materials and pristine veins

This phase makes node gathering yield real materials: per-node-type tables keyed by rolled
rarity replace the placeholder junk grants, rare+ yields are signed like corpse yields, the
per-node-type rare events land (pristine vein for ore, ancient heartwood for wood, moonlit
bloom for herbs; the 2026-07-17 amendment, so every node family gets its own jackpot
fantasy), and the long-dormant `gatherResult` event finally gets
visible feedback (SFX cue plus a rarity-colored loot line). It is its own slice because it
closes the gathering input loop end to end, on top of the Phase 2 signing model and ahead of
recipe consumption (Phase 10) and tier gating (Phase 12), so materials exist and feel
rewarding before anything spends them.

## Context pointers

- `docs/professions-2/state.md`: locked decisions (RNG in, determinism out; prime directive;
  zone-1 stockpiling mitigation; the 2026-07-17 per-node-type rare-event amendment), the
  rare-event tuning target (roughly 1 per zone per 20 minutes, 5x yield, always signed; one
  shared cadence knob), the validation matrix, and the "Gathering" row under
  key existing surfaces.
- `docs/professions-2/progress.md`: status table and the Phase 4 deliverable checklist.
- `docs/professions-2/implementation-plan.md`: team workflow, the Review Dispatch Matrix,
  code hygiene, and the design-language guardrails.
- `src/sim/professions/gathering.ts`: `NODE_HARVEST_TABLE`, `resolveHarvest`, and the
  `gatherResult` event (emitted today, consumed by nobody).
- `src/sim/content/gather_nodes.ts`: node definitions per zone (node types, placement).
- `src/sim/content/items.ts`: the ItemDef catalog; new material defs land here.
- `src/sim/interaction.ts`: the corpse signing precedent for signed yield instances.
- `src/ui/`: the HUD log (loot line consumer) and the quality token family for rarity colors;
  the client matchers `src/ui/sim_i18n.ts` / `src/ui/server_i18n.ts` for id-based sim text.
- `src/game/`: the sampled WebAudio SFX entry point for the gather cue.
- Local conventions: root `CLAUDE.md`, `src/sim/CLAUDE.md`, `src/ui/CLAUDE.md`,
  `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 04 of the Professions 2.0 feature: Node materials and pristine veins.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: make node gathering yield real materials with rarity, signed rare+ yields, the
per-node-type rare events (pristine vein, ancient heartwood, moonlit bloom), and visible
feedback for every harvest.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Confirm `git status` is clean (a concurrent session may share the checkout). Record the
  current HEAD hash; the QA session diffs against it (note it in progress.md at STEP 6).
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries: the node25 gate
  rule (run `npm run gate` under Node 24), PR 2039 state (the professions foundation this
  packet builds on), and the design-language program (DESIGN.md guardrails for any UI touch).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-04-node-materials.md (this file)
- src/sim/professions/gathering.ts, src/sim/content/gather_nodes.ts,
  src/sim/content/items.ts, src/sim/interaction.ts
- the HUD log module and SFX cue entry point it locates under src/ui/ and src/game/
- root CLAUDE.md, src/sim/CLAUDE.md, src/ui/CLAUDE.md, tests/CLAUDE.md
The summary must return: the NODE_HARVEST_TABLE shape and where the placeholder junk grants
live; the resolveHarvest flow and its exact Rng draw order; the gatherResult event payload
and the absence of consumers; how corpse yields get signed in interaction.ts (the precedent
to copy); ItemDef catalog conventions (fields, English names, procedural icon fallback); the
quality token family used for rarity colors; the rare-event tuning target from state.md;
the validation matrix rows for sim-only and content-only changes; and any locked decision
that constrains this phase (zone-1 stockpiling mitigation, prime directive, RNG model).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out three parallel agents. Each agent receives ONLY the Explore summary, never the raw
planning docs. Keep file ownership disjoint (sim/content agent owns gathering.ts and the
content files; event/feedback agent owns the new vein module plus ui/game consumers; tests
agent owns tests/); if ownership must overlap, sequence those agents or worktree-isolate per
implementation-plan.md.

Agent sim/content deliverables:
- Replace the placeholder junk grants in NODE_HARVEST_TABLE with per-node-type material
  tables keyed by the rolled rarity: ores for mining nodes, logs for timber, herbs for herb
  nodes, at zone-appropriate tiers. Zone 1 stays common/low tier per the stockpiling
  mitigation locked in state.md.
- Add the new material ItemDefs to src/sim/content/items.ts with English names in the items
  catalog and procedural icon fallbacks (no new WebP assets this phase).
- Rare+ node yields become signed instances exactly like corpse yields: follow the corpse
  signing precedent in src/sim/interaction.ts, signer = the gathering player.
- Do NOT delete or alter the junk ItemDefs (bone_fragments, linen_scrap, spider_leg).
  Players hold them; only their node sources go away (prime directive).

Agent event/feedback deliverables:
- The rare-event module: ONE small module behind the SimContext seam (module-first, called
  from the resolveHarvest path, never a method cluster on a coordinator) carrying a
  per-node-type flavor: pristine vein (ore), ancient heartwood (wood), moonlit bloom (herb).
  Each flavor is a rare per-player node state rolled through Rng at the shared state.md
  tuning cadence (roughly 1 per zone per 20 minutes), five-fold yield, always signed. The
  node's type decides the flavor; one shared cadence knob until Phase 15 tunes per family.
- Each flavor emits its own id-based soft zone broadcast (three additive ids): sim/server
  stays language-agnostic (stable id plus values); add the client matcher rows for all
  three in the SAME change (S3 guard).
- Leave a named per-flavor deed-mark hook at the event resolution site; deed registration is
  deferred to Phase 15. Do not author any deed records now.
- Consume gatherResult in the client: play the SFX cue and append a rarity-colored loot line
  to the HUD log. Colors come from the existing quality token family only; the feedback is
  identical on every graphics tier (fairness invariant). New player strings are English-only
  t() keys in the matching src/ui/i18n.catalog/ module.

Agent tests deliverables:
- Determinism pin: the Rng draw order through resolveHarvest INCLUDING the new rare-event
  roll; same seed gives the same yields. If the extra roll changes existing pinned draws,
  re-pin deliberately and say so in the commit body.
- Flavor mapping test: an event on an ore node is a pristine vein, on a wood node an
  ancient heartwood, on an herb node a moonlit bloom; each emits its own broadcast id.
- Rarity distribution test against the pinned roll (tests/professions_rarity_roll.test.ts).
- Signing tests: rare+ yields carry a signer; rare-event yields (all three flavors) are
  always signed.
- Zone-1 cap test: zone 1 node tables can only produce common/low-tier materials.
- Acceptance test: no node grants bone_fragments, linen_scrap, or spider_leg anymore, while
  those ItemDefs remain defined in the catalog.
- S3 guard coverage for the broadcast id and matcher (tests/localization_fixes.test.ts).

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all randomness through Rng (never Math.random, Date.now, performance.now in
  sim logic); the rare-event roll's draw order is pinned by a test.
- Sim purity: src/sim/ gains zero DOM/Three imports and never imports render/ui/game/net.
- Server authority: yields, rarity, signing, and rare-event rolls resolve in the sim on the
  server; the client only renders gatherResult and the broadcast.
- IWorld both worlds: if any new read or event crosses the render/ui seam, add it to the
  matching facet file (src/world_api/<domain>.ts), implement it in BOTH Sim and ClientWorld,
  and update tests/world_api_parity.test.ts in the same change. Verify liveness online, not
  just member shape (the 2033 stub trap).
- i18n: every player-visible string is an English-only t() key in the catalog; material
  names are English catalog entries; the broadcast and loot line are id-based and localized
  via the client matcher in the same change (the S3 guard enforces it).
- Fairness: the cue and loot line are identical on every graphics tier; rarity colors come
  only from the existing quality token family.
- Prime directive: nothing existing breaks. Junk ItemDefs stay defined; existing gathering
  flows (harvestNode in both hosts, ncd cooldowns) keep working.

Out of scope (do NOT do in this phase):
- Node TIER gating (Phase 12).
- Recipe consumption of these materials (Phase 10).
- Fishing (Phase 11; the glimmerfin rare catch already covers its jackpot).
- The corpse-harvest perfect specimen component (Phase 10).
- Rare-event deed authoring or registration (Phase 15; leave only the named per-flavor
  hooks).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the state.md validation matrix rows for sim-only and content-only changes:
  npx tsc --noEmit
  npx vitest run tests/gather_node_harvest.test.ts tests/professions_rarity_roll.test.ts \
    tests/gathering.test.ts tests/localization_fixes.test.ts tests/architecture.test.ts
- npm run wiki:content (new player-facing items feed the guide). If new t() keys were added:
  npm run i18n:gen, then npx vitest run tests/i18n_completeness.test.ts.
- npm run ci:changed; format only changed files with a scoped
  npx @biomejs/biome check --write <file>.
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
  matching rows.
- Prompt every review agent for COVERAGE, not filtering: report every correctness or
  requirement gap with confidence and severity; the main session filters afterward. No
  commit while any BLOCKING finding stands.
- If any agent reply comes back truncated, resume that agent and have it continue from where
  it stopped; do not restart completed work.

STEP 4 - COMMIT CADENCE:
Three commits, in this order, each staging explicit paths (never git add -A; the worktree
may be shared) and each carrying a body (what changed and why, 1 to 4 sentences):
- feat(professions): real node material tables
  (gathering.ts tables, gather_nodes.ts, items.ts material defs, table tests)
- feat(professions): per-node-type rare events
  (event module with the three flavors, rare+ signing, broadcast ids, deed hooks,
  determinism re-pin if any)
- feat(ui): gather feedback line and cue
  (gatherResult consumers, loot line, SFX cue, matcher rows, i18n catalog keys)

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] No node grants bone_fragments, linen_scrap, or spider_leg anymore; those ItemDefs
      themselves remain untouched in the catalog.
- [ ] Rarity distribution matches the pinned roll (tests/professions_rarity_roll.test.ts
      green against the new tables).
- [ ] Rare+ node yields are signed instances, matching the corpse signing precedent.
- [ ] The rare events: rolled through Rng at the shared state.md cadence, five-fold yield,
      always signed, with the flavor decided by node type (pristine vein / ancient
      heartwood / moonlit bloom), per-flavor id-based soft zone broadcasts emitted and
      matcher-localized; named per-flavor deed hooks left dormant.
- [ ] gatherResult consumed: SFX cue plus rarity-colored loot line in the HUD log, colors
      from the quality token family, identical on every graphics tier.
- [ ] Loot line and broadcast fully localized (English catalog keys plus matcher rows; the
      S3 guard tests/localization_fixes.test.ts is green).
- [ ] Zone-1 tables cap at common/low tier (pinned by a test).
- [ ] All STEP 3 validation commands pass.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: Phase 4 row status and dates, mirror the checked
  acceptance boxes, note the phase-start and phase-end commit hashes and any deferrals.
- Update docs/professions-2/state.md: replace the planned "Phase 4" row under "New surfaces
  per phase" with what actually landed: the material table symbol names, the new material
  ItemDef id namespace, the rare-event module path and its per-flavor SimEvent/broadcast
  ids, the deed-mark hook locations, and the gather feedback i18n key namespace.
- Record any surprises (draw-order re-pins, matcher quirks) to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT:
- Phase status (complete / partial with reasons).
- Files touched (grouped by commit).
- Validation results (each command, pass/fail).
- Review agent verdicts and how each finding was resolved.
- Deferrals with the phase that owns them.
- One-line QA handoff for the phase-04-qa.md session.

STOPPING RULES:
- None special for this phase. If satisfying a deliverable would contradict a locked
  decision in state.md, stop and report instead of improvising.
```
