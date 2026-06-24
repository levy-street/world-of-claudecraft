# Player job contracts ("paid bodyguard")

Players pay each other to help in-game. A **payer** hires a **helper** for an
agreed goal, locks a WOC/USDC reward in on-chain escrow, and the helper is paid
**automatically** once the authoritative server confirms the goal was met — or
the payer is refunded if it isn't met in time, or the protected client dies.

This sits on top of the simpler **direct tip-send** (send WOC / SOL / USDC to any
player with a verified wallet, from the bag's balance), which needs no escrow.

## Trust model

Non-custodial, server-as-oracle — the house pattern (same as the arena-wager
escrow):

- The payer signs their **own** deposit; the server never holds player keys.
- The reward sits in a per-job vault (the job PDA's associated token account) in
  the on-chain `job_escrow` program.
- The server holds one narrowly-scoped **settler** key. It can move a job's
  escrow **only** to the helper (`release`) or back to the payer (`refund`) — the
  program's `has_one` + token-owner constraints make any other destination
  impossible. It cannot steal, and a job settles exactly once (the vault + job
  account `close` on settle).
- The server is trusted only to *adjudicate the game fairly*. The settlement tx
  is on-chain and immutable; the server cannot withhold a rightful payout or
  double-pay.

## Goals (milestones)

Adjudicated by the pure, unit-tested engine in `server/job_milestone.ts`. The
helper must be **present** (grouped with the subject) at completion, so payment
only ever follows actual help. All timing is **wall-clock seconds** so it
survives a server restart.

| Goal | Completes when | Voids (→ refund) |
|---|---|---|
| `reach_level` | subject reaches the target level | deadline |
| `clear_dungeon` | the subject's **own** dungeon instance is fully cleared | deadline |
| `complete_quest` | the subject turns in the agreed quest | deadline |
| `survive` (bodyguard) | subject survives N seconds with the helper present | subject dies, deadline |
| `escort` | subject reaches a destination alive with the helper | subject dies, deadline |

Dungeon clears are attributed to the subject's **specific instance**
(`Sim.instanceForPlayer`), never to another party's concurrent copy of the same
dungeon.

## Lifecycle

`pending_deposit → open → active → released | refunded`

1. **Quote** (`POST /api/jobs/quote`) — resolves payer (caller's character +
   verified wallet) and helper (by character name → verified wallet), validates
   the goal, and returns the unsigned escrow-deposit tx. State: `pending_deposit`.
2. **Confirm** (`POST /api/jobs/:id/confirm`) — the client signs + submits the
   deposit, then reports the signature; the server verifies the deposit finalized
   into our vault **on our exact terms** (settler == ours, helper/mint/amount
   match — this binding stops a client crafting their own `open()` with a rogue
   settler). State: `open`.
3. **Accept** (`POST /api/jobs/:id/accept`) — the helper accepts; the milestone
   watcher begins. State: `active`.
4. **Settle** — the per-tick watcher (`GameServer.evaluateJobs`) runs the engine;
   on completion it `release`s, on death/deadline it `refund`s. Both online
   parties get a system log line. State: `released` / `refunded`.

`cancel` (`POST /api/jobs/:id/cancel`) refunds an **unaccepted** job (payer only);
once accepted, only the milestone or deadline can settle it (no griefing).

### Robustness

- **Idempotent settle**: on a chain error the job is retried next tick; if the
  on-chain account is already gone (a settle landed before a crash), it just
  finalizes the record — never double-pays.
- **Reconcile sweep** (boot + every 3 min): recovers deposits that funded
  on-chain but were never `confirm`ed (the payer closed the tab) by opening them,
  so their locked reward can settle instead of being stranded. The same sweep
  prunes *abandoned* quotes — `pending_deposit` rows older than
  `JOB_PENDING_TTL_SECONDS` with **no** on-chain escrow (the payer never signed)
  — so the table can't grow unbounded. It never prunes a row that still has funds
  on-chain.

## Code map

| Layer | File |
|---|---|
| On-chain program | `programs/job-escrow/src/lib.rs` (Anchor) |
| Settler client (build/verify/release/refund, hand-encoded ix) | `server/job_escrow.ts` |
| Milestone engine (pure) | `server/job_milestone.ts` |
| Lifecycle service (injected DB/escrow/observation) | `server/job_contracts.ts` |
| SQL + schema | `server/jobs_db.ts` |
| REST handlers | `server/jobs_api.ts` |
| Per-tick watcher + observation source + notifications | `server/game.ts` |
| Client API | `src/net/online.ts` |
| Hire + Jobs UI (wallet panel tabs) | `src/main.ts` + `index.html` |

Tests: `tests/job_milestone.test.ts`, `tests/job_contracts.test.ts`,
`tests/job_escrow.test.ts`, `tests/job_instance.test.ts`.

## Deploy / ops

1. `anchor build && anchor deploy` the `job-escrow` program; run
   `anchor keys sync` and set `JOB_ESCROW_PROGRAM_ID` to the deployed id (the
   build-time placeholder is dev-only).
2. Fund a settler keypair with a little SOL (fees + recipient ATA rent) and set
   `JOB_ESCROW_SETTLER_SECRET` (base58 or JSON byte array — **KMS, never git**).
3. Set `JOBS_ENABLED=true`. Optional: `JOB_MAX_DURATION_SECONDS` (default 7 days).

The feature is inert until both the flag and the settler key are set.

## Devnet verification (live)

The program is deployed to **devnet** at
`5X39bYGeHPSeNipQGrZRk1siKdgDXXSqhBkpWDTTQzm8` (upgradeable; authority = the
`SOLANA_DEVNET_DEPLOYER`). `scripts/job_escrow_devnet_e2e.mjs` exercised every
transaction type against it on-chain — **escrow open (deposit), release (the
helper received exactly the locked amount, verified), refund (returned to the
payer), a native SOL tip, and an SPL token tip** — all `Success` / `Finalized`.

Solscan (devnet) links for each tx: `docs/screenshots/jobs/devnet-tx-links.json`.
Explorer screenshots (Solscan is Cloudflare-walled for headless capture, so these
are the official Solana Explorer for the same signatures):
`docs/screenshots/jobs/tx-*.png`. Re-run with `node scripts/job_escrow_devnet_e2e.mjs`
(needs the deployer funded) then `node scripts/job_devnet_tx_shots.mjs`.

## Scope note

Escrowed rewards are **WOC and USDC** (SPL tokens). Native SOL is supported for
direct tips but not for held escrow in v1 — escrowing SOL needs wSOL
wrap/unwrap; it can be added later by treating wSOL as another SPL currency.
