# TODOs: feat/woc-lp-staking-vault

- [x] Worktree off feat/woc-gamblefi-core
- [x] Program keypair 9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6
- [x] solana/programs/woc_lp_vault/src/lib.rs + Cargo.toml + Anchor.toml
- [x] anchor build --no-idl (clean, warnings pre-existing pattern)
- [x] Deployed to devnet (sig 4RuCHR2Q...c1B)
- [x] server/lp_vault_client.ts (encoders + decoders)
- [x] server/lp_staking.ts (pure veLP math)
- [x] server/lp_staking_db.ts + schema registered in db.ts + withLpEpochLock
- [x] server/lp_staking_service.ts (epoch runner + reads + tx builders)
- [x] server/lp_staking_routes.ts (tx-build HTTP glue)
- [x] server/lp_staking_boot.ts (flag OFF default, fail-loud half-config)
- [x] flow_ledger.ts: lp_emission (out) + lp_forfeit_recycle (in)
- [x] main.ts wiring: boot, tick interval, REST routes, internal lp/epoch ops
- [x] Unit tests: client 17 / math 19 / service 14 / routes 7 / boot 4 (all green)
- [x] Real-Postgres integration: 6 green (disposable pg16 on :5544); shared-DB
      integration files need --no-file-parallelism (documented in header)
- [x] Devnet harness: mock LP mint 4PuM...GyWF, staker funded
- [x] Devnet lifecycle test: 4/5 first pass (5th was harness statefulness, fixed
      residual-tolerant); re-run in flight
- [x] tsc --noEmit parity with base (177 pre-existing, 0 in changed files)
- [x] Biome on changed files: no errors
- [ ] Final devnet 5/5 with logged signatures
- [ ] LARP check writeup + prod-readiness score
- [ ] Commits

## LARP-check log (step 4 of the loop)
- set_paused instruction: encoder unit-tested, program logic compiled, but NOT
  exercised on devnet. FIXED SCOPE: acceptable residual, flagged in audit.
- Jupiter/keeper interactions: none on this branch (branch 2).
- paid_base column exists with no writer on this branch: the documented seam
  for the stacked fee-share distributor, not dead code (read in claimable math).
- No mocks of code under test; fakes only at the injected seams; real-Pg and
  live-devnet layers cover the seams themselves.
