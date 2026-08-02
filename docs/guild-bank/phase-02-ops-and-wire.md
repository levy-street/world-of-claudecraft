# Phase 2: ops and wire (command bodies, gating, guild_bank_* end to end)

### Starter prompt
```
This is Phase 2 of the Guild Bank feature: ops and wire.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.

Goal: implement the five guild bank operations in the sim with full gating, and wire them
end to end (client stub, allowlist, shape-check dispatch, proximity + rank gated
snapshot), with sim_i18n matcher rows for every new emit. Persistence stays out (Phase 3);
in-memory books only.

STEP 0 - PRE-FLIGHT: git status clean; memory scan; confirm Phase 1 QA passed in
progress.md.

STEP 1 - LOAD CONTEXT (via one Explore agent):
- docs/guild-bank/state.md (tokens, constants, validation order) + progress.md Phase 2
- src/sim/bank.ts (bankDeposit/bankWithdraw/bankBuySlots bodies, nearBanker, bankInfoFor)
- src/sim/social/trade.ts tradeConfirm (final re-validation + scratch capacity + atomic
  mutation idiom)
- server/game.ts: ONLY the bank_* allowlist entries, dispatch cases, the maybe('bank')
  stream line, and the join path where social/bank stamping happens
- server/social.ts: every membership/rank mutation site (invite accept, leave, kick,
  promote, demote, transfer, disband) for the re-stamp hooks
- src/net/online.ts bank stubs + snapshot decode; src/world_api.ts COMMAND_NAMES and
  COMMAND_FACETS; src/ui/sim_i18n.ts (error.bank* rows as the template)
- tests/command_facets.test.ts (the reserved-token comment), tests/command_schema.test.ts,
  tests/snapshots.test.ts (delta-key registry)
Return: the dispatch/allowlist/snapshot idioms verbatim, the full list of membership
mutation sites, and the sim_i18n row format.

STEP 2 - EXECUTE: fan out three agents in parallel, each writing its own tests:
Sim-ops agent deliverables:
- Free functions over SimContext in src/sim/guild_bank.ts: guildBankDepositGold,
  guildBankWithdrawGold, guildBankDeposit, guildBankWithdraw, guildBankBuySlots, plus
  guildBankInfoFor (proximity + officer-rank gated, boundary-cloned, null otherwise).
- Validation order per state.md on EVERY op: resolve, dead check, nearBanker, shape,
  rank gate (officer or leader via the stamp), policy (quest items refused, instanced
  stacks whole via moveBetweenContainers), price/cap from the table, affordability
  (player copper for deposits, treasury for withdrawals and expansions), capacity on
  scratch copies in BOTH directions, then the atomic mutation, then emits. No refusal
  path mutates. Treasury cap refuses; a withdrawal that would overflow the player's own
  copper refuses.
- Emits use src/sim/format_money.ts for money fragments; every new English emit listed
  for the wire agent's sim_i18n rows.
Wire agent deliverables:
- Five guild_bank_* tokens appended to COMMAND_NAMES + COMMAND_FACETS (facet
  IWorldGuildBank); online.ts stubs; game.ts allowlist + shape-only dispatch cases;
  maybe('guildBank', ...) in the snapshot stream + delta-key registry update; Sim and
  ClientWorld facet members now live.
- src/ui/sim_i18n.ts matcher rows for every sim emit from this phase, SAME change.
Stamp-hooks agent deliverables:
- Server re-stamp calls at every membership/rank mutation site found in Step 1 plus the
  join path, so sim-side rank is never stale across promote/demote/kick/leave/transfer/
  disband; disband/leave clears the stamp.
- Tests: a stale-rank scenario (demote while at the banker: next op refused, snapshot
  goes null), using the social-system test harness.

INVARIANTS IN PLAY: server validates shape only, sim owns every rule; determinism (no new
randomness at all in these paths); S3 guard; parity (both worlds); no em dashes/emojis.

Out of scope: DDL, transactions, ledger rows, creation fee, disband guard, UI.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit; npx vitest run tests/guild_bank.test.ts tests/command_schema.test.ts
  tests/command_facets.test.ts tests/snapshots.test.ts tests/world_api_parity.test.ts
  tests/localization_fixes.test.ts tests/bandwidth.test.ts tests/architecture.test.ts;
  npm run ci:changed.
- Dispatch: architecture-reviewer, cross-platform-sync, privacy-security-review.

STEP 4 - COMMIT CADENCE (explicit paths):
- feat(sim): implement guild bank operations behind SimContext
- feat(net): wire the guild_bank_* commands and snapshot end to end
- feat(server): keep the sim guild membership stamp fresh on every rank change

STEP 5 - ACCEPTANCE:
- [ ] Every op refused correctly for: member rank, no guild, dead, out of range, quest
      item, over capacity, under funds, over treasury cap (a negative test per dimension).
- [ ] Successful ops mutate atomically and emit; info stream goes null on walk-away,
      death, demotion, leave.
- [ ] All listed suites green; S3 guard green; no locale overlays touched.

STEP 6 - DOCS: update progress.md + state.md ledger (tokens, dispatch cases, matcher rows).

STEP 7 - FINAL RESPONSE: status, files, validation, review verdicts, handoff to Phase 2 QA.

STOPPING RULES: stop and ask if any membership mutation site cannot reach the sim stamp
synchronously (that would reopen the stale-rank window), or if the facet needs members
beyond state.md's list.
```
