# Phase 12: Base tool tier gating

Tools finally matter: `GatherNodeDef` gains a tier, and the player's best owned matching tool plus
skill decide what they can harvest, skin, and catch. The pure gating functions in
`src/sim/professions/tools.ts` (`gatherToolTier`, `canGatherTier`, `canHarvestMonsterMaterial`)
already exist, are tested, and have zero callers; this phase wires them into the live harvest
paths and gives the existing tool items and six tool recipes a real purpose. It is its own slice
because it depends on the node materials (Phase 4), recipe ladders (Phase 10), and fishing catch
ladder (Phase 11) all being in place, while tool effects and charges stay parked for wave 2+.

## Context pointers

- `docs/professions-2/state.md`: locked decisions (tool effects PARKED; prime directive), the
  validation matrix (sim row, i18n-keys row), and the Phase 11 fishing entry under "New surfaces
  per phase".
- `docs/professions-2/progress.md`: Phase 12 status row and deliverable checklist.
- `src/sim/professions/tools.ts`: `gatherToolTier`, `canGatherTier`, `canHarvestMonsterMaterial`,
  `isGatherToolUse`, `GatherToolUse`. Pure, tested, zero callers today. The effect/recharge half
  of the file (`slotEffect`, `resolveToolEffectUse`, `rechargeEffect`) stays dormant.
- `src/sim/types.ts`: `GatherNodeDef` (currently `id`, `zoneId`, `type`, `pos`, `level`; gains
  `tier`).
- `src/sim/content/gather_nodes.ts`: `GATHER_NODES`, every pre-phase node def across the three
  existing zones.
- `src/sim/professions/gathering.ts`: `harvestNode` (the node outcome path), `resolveHarvest`,
  `isNodeHarvestableBy`, the existing denial handling.
- `src/sim/interaction.ts`: `harvestCorpse` (corpse component pulls, claims).
- The fishing catch band surface Phase 11 landed (locate via `state.md`; rods gate the higher
  bands the same way).
- `tests/professions_tools.test.ts`: carries the stale pin "using a gathering tool is a safe
  no-op until the gather-node system lands"; this phase retires it.
- `tests/gather_node_harvest.test.ts`, `tests/gathering.test.ts`, `tests/architecture.test.ts`:
  the phase's named validation suites.
- `CLAUDE.md` (root), `src/sim/CLAUDE.md`, `src/sim/professions/CLAUDE.md`, `src/ui/CLAUDE.md`,
  `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 12 of the Professions 2.0 feature: Base tool tier gating.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: give tools real purpose by adding node tiers and gating node, corpse, and fishing harvests
on the player's best owned matching tool tier plus skill, while every piece of pre-phase content
stays bare-hands harvestable.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Verify `git status` is clean before starting. If not, ask the user (a concurrent session may
  share this checkout).
- Memory scan: check the `MEMORY.md` index for entries relevant to this phase's domain.
  Suggested topics: node25-breaks-jsdom-gate (run the gate under Node 24),
  combo-recipes-broken-online (the 2033 stub trap: verify liveness in BOTH hosts, not just
  member shape), design-language-program (the node tooltip touch must not introduce DESIGN.md
  phase vocabulary).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly, save your context):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, Phase 11 fishing surface,
  tool-effects PARKED rule)
- docs/professions-2/progress.md (Phase 12 status + deliverable checklist)
- docs/professions-2/phase-12-tool-gating.md (this prompt; verify the agent has the same
  understanding)
- src/sim/professions/tools.ts (gatherToolTier, canGatherTier, canHarvestMonsterMaterial; the
  dormant effect/recharge half stays dormant)
- src/sim/types.ts (GatherNodeDef)
- src/sim/content/gather_nodes.ts (every pre-phase node def)
- src/sim/professions/gathering.ts (harvestNode, resolveHarvest, isNodeHarvestableBy, denial
  handling)
- src/sim/interaction.ts (harvestCorpse, claim resolution)
- the fishing catch band module Phase 11 landed (find it via state.md's Phase 11 entry)
- tests/professions_tools.test.ts (the stale no-op pin this phase retires)
- CLAUDE.md (root) plus src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md,
  tests/CLAUDE.md
The agent should return: the exact canGatherTier comparator semantics; how harvestNode denies
today and how a denial reaches the player in BOTH hosts; the full list of pre-phase node defs
per zone; every existing tool ItemDef (its GatherToolUse professionId and tier) and the six tool
recipes; the fishing catch band shape from Phase 11; how the node tooltip and minimap ready-state
are produced today; and the exact assertion of the stale no-op pin.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Spawn four agents in parallel (sim, content, ui, tests). Give each agent ONLY the Explore
summary, not raw planning docs. Never `mode: "plan"` on teammates. Use worktree isolation only
if agents edit overlapping files in parallel (the sim and tests agents both touch
tests/professions_tools.test.ts; sequence or isolate them).

Locked semantics all four agents share:
- Bare hands resolve to effective tool tier 1, so every tier-1 node (and all pre-phase content)
  stays harvestable with no tool. Only tiers 2 and up gate behind a tool.
- Owned-best resolution: the harvest path scans the player's OWNED items (bags) for the best
  matching tool via gatherToolTier for the node's profession and takes the highest tier. There
  is no equip UI and none is added.
- The prime directive concretely: every node def that exists before this phase keeps a tier
  bare hands can harvest. The tier ramp comes from NEW higher-tier node defs added to the
  existing three zones (zone 1 stays all tier 1; zones 2 and 3 gain new tier-2 and tier-3
  veins). No pre-phase node, corpse pull, or fishing catch a player could complete before this
  phase may gate behind a tool.

Agent sim deliverables:
- `harvestNode` consults the player's best owned matching tool via gatherToolTier plus
  canGatherTier before resolving; a failed gate denies with a stable, localized reason id
  carrying the required tier (follow the existing denial pattern in gathering.ts).
- `harvestCorpse` consults canHarvestMonsterMaterial for rare and above component pulls only;
  common and uncommon pulls stay ungated. The claim resolution is computed exactly as before
  and is never affected by a denied pull.
- Fishing rods gate the higher catch bands the same way (canGatherTier against the band tier);
  everything catchable before this phase stays catchable bare-handed or with the basic rod.
- Denial reason ids are emitted identically in the offline Sim and through the server so both
  hosts surface the same reasons (server authority: the server decides the outcome online).

Agent content deliverables:
- `GatherNodeDef` gains a required `tier` field (src/sim/types.ts).
- A content pass over src/sim/content/gather_nodes.ts assigns tiers zone-appropriately: every
  pre-phase node def gets tier 1; new tier-2 veins land in zone 2 and new tier-2 and tier-3
  veins land in zone 3 so the three existing zones ramp.
- New node defs follow the existing authoring pattern (id, zoneId, type, pos, level snapshot)
  and get render prop coverage per the note at the top of gather_nodes.ts.

Agent ui deliverables:
- Denial reasons render as `t()` keys: English-only catalog entries in the matching
  src/ui/i18n.catalog/<domain>.ts module plus the sim matcher rule in src/ui/sim_i18n.ts in the
  SAME change (the S3 guard enforces it).
- The node tooltip and minimap ready-state show the tier requirement. This is actionable info:
  it must be tier-identical across every graphics preset (the fairness invariant), and it must
  work in BOTH hosts. Prefer reading the tier from the shared content def; if any new IWorld
  member is genuinely needed, add it to the matching facet file, implement it in BOTH Sim and
  ClientWorld, and update the parity pin in tests/world_api_parity.test.ts in the same change.
- No DESIGN.md phase vocabulary; today's tokens only.

Agent tests deliverables:
- Retire the stale pin "using a gathering tool is a safe no-op until the gather-node system
  lands" in tests/professions_tools.test.ts; replace it with tests proving tools change
  outcomes (a better pick unlocks a higher-tier vein; a wrong-profession tool does not count).
- A lockout-prevention test that walks EVERY pre-phase node def and asserts a bare-hands player
  can still harvest it (this pins the prime directive).
- Owned-best resolution tests: multiple matching tools in bags picks the highest tier;
  mixed-profession bags resolve per profession.
- Corpse gating tests: rare and above pulls gate; common and uncommon pulls do not; the claim
  outcome is identical whether or not the pull is denied.
- A determinism test (same seed, same world) covering the new gating paths.

INVARIANTS THIS PHASE MUST KEEP:
- Prime directive: nothing existing breaks. Tier-1 nodes and ALL current content stay
  bare-hands harvestable; no existing player is locked out of anything they could do before.
  Only NEW higher tiers gate.
- Determinism: all randomness via `Rng`; no `Math.random` / `Date.now` / `performance.now` in
  src/sim/; new draws take a fixed place in the shared draw order.
- Seam: any new IWorld member lands on a facet file and is implemented in BOTH Sim and
  ClientWorld with the parity pin updated, verified live (not just member shape).
- Server authority: online, the server decides every harvest outcome and denial; the client
  never does.
- i18n: every new player string is a `t()` key added in ENGLISH ONLY to the matching
  src/ui/i18n.catalog/<domain>.ts module; sim denial ids get their matcher rule in
  src/ui/sim_i18n.ts in the SAME change; never edit the locale overlays.
- Fairness: the tier requirement display is identical across graphics presets.
- Tool effects/charges/recharge stay PARKED: do not wire resolveToolEffectUse, rechargeEffect,
  or any slot state; do not delete them either.

Out of scope (do NOT do in this phase):
- Tool effects, charges, and recharge (parked for wave 2+; the pure modules stay dormant).
- Crafted tool recipe additions or recipe ladder changes (Phase 10 owns recipe content).
- An equip UI or tool slots (owned-best semantics only).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the state.md sim row: `npx tsc --noEmit`, then
  `npx vitest run tests/professions_tools.test.ts tests/gather_node_harvest.test.ts
  tests/gathering.test.ts tests/architecture.test.ts`, plus the determinism check.
- New denial i18n keys were added, so also run the i18n row: `npm run i18n:gen` then
  `npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts`.
- Any code change: `npm run ci:changed`; format only touched files with a SCOPED
  `npx @biomejs/biome check --write <file>`.
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check `git diff --name-only` against the
  phase-start commit and spawn ONLY matching rows (expect architecture-reviewer,
  cross-platform-sync, and frontend-seam-reviewer to match; if no row matches, spawn none).
- Prompt each review agent for COVERAGE not filtering: report every issue including
  low-severity and uncertain ones; ranking happens in a later step.
- Resume any agent that truncates with: "Stop reading more files. Output the full report now
  based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
  NICE-TO-HAVE / VERDICT."
- Do not commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Aim for three commits with these headlines (Conventional Commits with a scope; EXPLICIT paths,
never `git add -A`; every commit carries a body of 1 to 4 sentences saying what changed and
why; no em dashes or emojis):
- `feat(professions): add gather node tiers`
- `feat(professions): gate harvesting on owned tool tier`
- `test(professions): retire the tool no-op pin`

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A bare-hands player harvests every node, corpse component, and fishing catch they could
      before this phase (the lockout-prevention test walks every pre-phase node def)
- [ ] A bare-hands player cannot harvest a tier-3 vein and sees a localized denial reason
- [ ] Buying or crafting a better pick changes outcomes; owned-best resolution picks the
      highest matching tier among multiple owned tools, per profession
- [ ] `harvestCorpse` gates rare and above component pulls via canHarvestMonsterMaterial, and
      the claim resolution is unaffected by a denied pull
- [ ] Fishing rods gate the higher catch bands the same way
- [ ] Denial reasons are localized ids surfaced in BOTH hosts (catalog keys + S3 matcher rule
      in the same change; the S3 guard is green)
- [ ] The node tooltip and minimap ready-state show the tier requirement identically across
      graphics presets
- [ ] The stale no-op pin is replaced with tests proving tools change outcomes; the existing
      tool items and six tool recipes now have real purpose
- [ ] Tool effects/charges remain parked: no new callers of the effect/recharge half of
      tools.ts
- [ ] The validation matrix rows above are green, including tests/architecture.test.ts

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md (mark Phase 12 status; mirror the checkboxes; note
  deferrals).
- Update docs/professions-2/state.md: Phase 12 entry under "New surfaces per phase"
  (GatherNodeDef.tier; the bare-hands-equals-effective-tier-1 rule; owned-best resolution
  semantics; the new denial reason ids and their i18n key namespace; the new tier-2 and tier-3
  node defs; note that tools.ts gating fns now have live callers while the effect half stays
  dormant).
- Record any surprising rules or current-state notes to memory for the next session.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent verdicts, any
deferred items, and a one-line handoff for the Phase 12 QA session.

STOPPING RULES:
- Stop immediately if any pre-phase content would gate behind a tool; that violates the prime
  directive and the tier assignment must be reworked instead.
- Stop and ask the user if the Phase 11 fishing surface landed with a shape that cannot express
  catch band tiers without redesign.
- Stop and ask the user if the gating cannot be added without wiring the parked tool-effect
  modules.
```
