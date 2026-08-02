# Phase 1: foundation (sim state module, membership stamp, facet)

### Starter prompt
```
This is Phase 1 of the Guild Bank feature: foundation.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank (feature/guild-bank).

Goal: land the sim-side guild bank state model, the session-only guild membership stamp,
and the IWorldGuildBank facet with offline no-ops, so every later phase builds on a typed,
tested foundation. No wire tokens, no persistence, no UI in this phase.

STEP 0 - PRE-FLIGHT: git status clean in this worktree; memory scan (guild, bank entries).

STEP 1 - LOAD CONTEXT (via one Explore agent, never read sim.ts whole):
- docs/guild-bank/state.md (constants, names, locked decisions) and progress.md Phase 1
- src/sim/bank.ts (BankState, sanitizeBankState, capacity, moveBetweenContainers and its
  test block in tests/bank.test.ts)
- src/sim/bags.ts (countFit/addStacked/removeStacked/fitsAll signatures)
- src/sim/sim_context.ts (the append-only seam; how views like bankerIds are exposed)
- src/sim/sim.ts: ONLY setPlayerGuild, the guild no-op stubs, addPlayer join-time stamping
  (the bankBonus precedent), and PlayerMeta's session-only fields
- src/world_api/bank.ts + src/world_api.ts barrel + tests/world_api_parity.test.ts pin
- src/sim/CLAUDE.md, src/world_api/CLAUDE.md
Return: the exact idioms for a new sim module behind SimContext, the parity-trace
exclusion mechanism for server-stamped meta, and the facet + pin recipe.

STEP 2 - EXECUTE: fan out two agents in parallel, each writing its own tests:
Sim-module agent deliverables:
- src/sim/guild_bank.ts with GuildBankState { treasury: number; inventory: InvSlot[];
  purchasedSlots: number }, the constants from state.md, guildBankCapacity,
  createEmptyGuildBankState, sanitizeGuildBankState (the ONE load path: clamp numbers,
  floor purchasedSlots to whole expansions, never destroy items, tolerate unknown item
  ids and over-capacity like the personal bank does).
- The per-guild book map owned by Sim with a SimContext view (append-only addition), plus
  load/serialize helpers the server will call in Phase 3 (pure shape in/out, no SQL).
- Unit tests: capacity math per expansion tier, sanitize round-trips, treasury clamp
  boundaries, hostile-shape loads (negative numbers, non-arrays) never throw or destroy.
Stamp + facet agent deliverables:
- Session-only guildId + rank on PlayerMeta with a server-callable stamp entry point
  beside setPlayerGuild (never serialized into CharacterState; excluded from the parity
  trace exactly like bankBonusSources; document why in one comment).
- src/world_api/guild_bank.ts: IWorldGuildBank facet (GuildBankInfo { treasury, slots,
  capacity, purchasedSlots, nextExpansionPrice } read + the five command members named in
  state.md), aggregated by the barrel; Sim implements reads as null / commands as no-ops
  offline; ClientWorld implements matching stubs (real wiring is Phase 2).
- tests/world_api_parity.test.ts pin updated in the SAME change; stamp tests (set, clear
  on leave, rank change) and a parity-trace exclusion test.

INVARIANTS IN PLAY: sim purity (tests/architecture.test.ts must stay green), SimContext
append-only, facet-not-barrel rule, both-worlds implementation, no em dashes or emojis.

Out of scope: op bodies, wire tokens, dispatch, DDL, ledger, UI, creation fee.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit; npx vitest run tests/guild_bank.test.ts tests/architecture.test.ts
  tests/world_api_parity.test.ts tests/bank.test.ts; npm run ci:changed.
- Dispatch per the implementation-plan.md matrix: architecture-reviewer,
  cross-platform-sync. COVERAGE not filtering.

STEP 4 - COMMIT CADENCE (explicit paths):
- feat(sim): add the guild bank state module and membership stamp
- feat(world-api): add the IWorldGuildBank facet with offline no-ops

STEP 5 - ACCEPTANCE:
- [ ] New module compiles and is fully unit-tested; constants match state.md exactly.
- [ ] Stamp is session-only, parity-excluded, and clears on leave/kick/disband paths the
      stamp entry point models.
- [ ] Facet exists in both worlds; parity pin updated; architecture guard green.
- [ ] sim.ts gained only thin delegates/stamp wiring, no logic.

STEP 6 - DOCS: update progress.md and the state.md ledger (files, members, pins).

STEP 7 - FINAL RESPONSE: status, files touched, validation results, review verdicts,
one-line handoff for Phase 1 QA.

STOPPING RULES: stop and ask if the parity-trace exclusion mechanism cannot accommodate
the stamp without touching unrelated meta serialization, or if SimContext needs a
non-append change.
```
