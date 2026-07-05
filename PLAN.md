# feat(defi): LP staking vault (foundation)

Branch: `feat/woc-lp-staking-vault`, stacked on `feat/woc-gamblefi-core` (#799, the
v0.17.0-lineage economy core: flow ledger + reward seasons + woc_escrow + keeper).
Base rationale: the task pins emissions to #799's flow_ledger; that code is NOT on
`origin/release/v0.17.0` itself, it lives on the #799 head, whose merge base is the
v0.17.0 fork point. Stacking here is how every other economy PR in this repo works.

## What this branch ships
1. `solana/programs/woc_lp_vault/` - non-custodial LP-token staking program
   (id `9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6`):
   per-staker position PDA + per-position vault ATA; instructions init_pool,
   open_position, stake(amount, lock_seconds), extend_lock, unstake, close_position,
   set_paused. Locks are monotone (never shorten); unstake works even when paused
   (principal exit never gated); MAX_LOCK_SECONDS = 366d program constant.
2. `server/lp_vault_client.ts` - pure no-IDL instruction encoders + account
   decoders (Pool, Position), mirroring woc_escrow_client.ts.
3. `server/lp_staking.ts` - pure veLP logic: tier table (lock duration ->
   multiplier bps), position weights, epoch emission budgeting (bounded by flow
   ledger headroom), pro-rata share split (floor, dust stays in headroom),
   linear vesting, proportional unstake forfeit.
4. `server/lp_staking_db.ts` - LP_STAKING_SCHEMA (lp_positions mirror, lp_epochs,
   lp_accruals) + PgLpStakingDb; registered in db.ts ensureSchema.
5. `server/lp_staking_service.ts` - injected-deps service: epoch runner
   (snapshot chain positions -> mirror sync + forfeits -> budget -> reserve via
   ledger.emit with synthetic txSig `lp_epoch:<pool>:<epoch>` -> accrual rows),
   read models, unsigned stake/unstake tx builders (non-custodial).
6. `server/lp_staking_boot.ts` - env wiring; `WOC_LP_STAKING_ENABLED !== '1'` ->
   null (feature dead, server runs as before); enabled-but-half-configured ->
   throw at boot (fail loud). main.ts: boot + epoch interval + REST routes
   (GET /api/woc/lp, GET /api/woc/lp/position, POST /api/woc/lp/tx/stake|unstake)
   + /internal/woc/lp/epoch ops trigger (WOC_OPS_SECRET).
7. flow_ledger.ts FlowSource extended: `lp_emission` (out), `lp_forfeit_recycle` (in).
   NO new ledger; NO parallel emission path. Accrual reservation goes through
   recordOutflowWithinBudget (advisory-locked, idempotent on synthetic sig), so
   concurrent arena settles can never double-spend the same headroom.

## Reward model (why accrual != payment)
Each epoch the service reserves an emission (bounded by min(rate, headroom*capBps))
through the ledger FIRST, then splits it into per-staker accruals that vest linearly
over LP_VEST_SECONDS. Unstaking forfeits unvested accruals proportionally; forfeits
are credited back as `lp_forfeit_recycle` inflows (headroom returns). Actual token
payment is branch 2 (fee-share distributor via reward-season API + keeper pattern).
Anti-mercenary: multiplier derives from REMAINING lock (ve-decay), vesting delays
exit, forfeit claws back on unstake.

## Two-phase epoch idempotency
1. txn: insert lp_epochs row (status pending) + accrual rows (computed shares).
2. ledger.emit(synthetic sig). ok -> mark epoch reserved; budget_exceeded ->
   mark epoch void (accruals dead); duplicate -> a previous crash already
   reserved it -> mark reserved.
Cross-process single-flight via pg advisory lock (distinct key from keeper).

## Flags / fail-closed
- WOC_LP_STAKING_ENABLED (default off -> buildLpStakingService returns null).
- Enabled requires WOC_LP_VAULT_PROGRAM_ID, WOC_LP_MINT, WOC_LP_SEASON_ID.
- Emissions additionally require LP_EMISSION_RATE_BASE > 0 (default 0 = accrue
  nothing; stake/unstake reads still work).
- On-chain: pool set_paused for emergencies; unstake always available.

## Tests
- lp_vault_client.test.ts: discriminators, arg encoding, account order/flags vs lib.rs.
- lp_staking.test.ts: tiers, weights, budget bounding (adversarial), split
  conservation, vesting boundaries, forfeit math.
- lp_staking_service.test.ts: epoch runner with in-memory fakes (MemFlowDb),
  crash-recovery idempotency, concurrent emit vs arena spend, forfeit crediting.
- lp_staking_db.integration.test.ts: real Postgres (gated like flow_ledger_db one).
- lp_vault.devnet.test.ts (WOC_DEVNET_TEST=1): live devnet: init_pool, open+stake,
  extend_lock, early-unstake refused, unstake after expiry, close_position; logged sigs.
- boot fail-closed test: flag unset -> null; half config -> throws.
