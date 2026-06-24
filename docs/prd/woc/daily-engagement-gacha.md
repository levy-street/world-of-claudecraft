# Daily Engagement: Holder Spinner, Pack Ripping, and Daily Tasks

Status: DRAFT for review (no code written yet)
Author: planning pass, 2026-06-24
Scope: a daily-active retention loop for World of ClaudeCraft built on the
existing $WOC / Solana rails. Three coupled features:

1. Daily Spinner -- a free, once-per-day wheel for $WOC holders that pays out
   SOL dust from a provably fair, on-chain prize vault.
2. Pack Ripping -- a gacha pack you buy by burning $WOC; each pack rips open to
   reveal random buffs, potions, and gear.
3. Daily Tasks -- rotating daily objectives that reward returning players with
   spin/pack currency and feed a login streak.

This document is the deliverable for the "plan and research before code" step.
It is meant to be read and amended before implementation begins.

---

## 0. Decisions locked in this planning pass

From the requirements review:

- Spinner eligibility: a linked wallet holding at least 1000 $WOC, plus the
  existing anti-bot gate. Free to spin (not a wager).
- Spinner payout: SOL dust, custodied and settled through an Anchor escrow PDA
  (provably fair), not a bare hot wallet.
- Packs: bought by burning $WOC. Contents are random buffs, potions, and
  potentially gear.
- Pack reward classes: mode-scoped power buffs + consumable QoL potions +
  persistent gear. (This is the union of options 2, 3, and 4 from the review.)
- Pay-to-win posture is a PER-REALM POLICY, not a global yes/no. All three
  guardrail strategies are implemented; a `PACK_POWER_POLICY` env var selects
  which one a given realm process runs, defaulting to the invariant-safe
  (cosmetic / power-neutral) one. See Section 7.A.

> INVARIANT NOTE. Granting persistent gear / combat power for burning $WOC
> crosses the repo's `no pay-to-win` / vanilla-formula invariant and the
> holder-tier "grants NO gameplay power" precedent. We keep the DEFAULT realm
> invariant-safe and make pay-to-win an explicit, per-realm opt-in via
> `PACK_POWER_POLICY`, so the canonical world stays clean while a designated
> degen / seasonal realm can run looser rules. The same realm model already
> scopes characters, economy, and leaderboards per process (`REALM`), so the
> blast radius of a looser policy is naturally contained to that realm.

---

## 1. Goal: what is being built and why

Why: the game has DAU instrumentation (`play_sessions`) but no reason-to-return
loop and no daily monetization touchpoint. We want a habit loop:

  log in -> do a daily task -> earn currency -> spin for SOL dust + rip packs ->
  collect / power up -> come back tomorrow (streak).

The loop also threads three project goals already in flight: reward $WOC holding
(spinner is holder-gated), create a $WOC burn sink (packs burn $WOC, deflationary
like the rename/buyback paths), and deepen retention.

Player-facing definition of done:

- A holder with >= 1000 $WOC linked can claim one free spin per UTC day and, when
  they win, receives SOL in their linked wallet, verifiably and on-chain.
- Any player can burn $WOC to rip a pack and immediately see the contents reveal,
  with the items actually granted to their character.
- Returning daily and completing tasks visibly advances a streak and yields
  spin/pack currency.
- Every spin and pack roll is auditable: published odds, a pre-committed daily
  seed, and a post-day reveal that lets anyone recompute outcomes.

---

## 2. Constraints, dependencies, and edge cases

### 2.1 Hard repo invariants this must respect

- Determinism of the sim. `src/sim/` is a seeded, replayable 20 Hz core; a client
  can replay the same seed. Therefore any RNG that decides money or scarce value
  MUST live server-side (or on-chain) and never in `src/sim/`. Item GRANTS still
  route through sim actions (`addItem`, `applyAura`) so the authoritative Sim
  stays the source of truth and JSONB persistence keeps working, but the ROLL
  that decides what to grant is computed in `server/` from a server-secret seed.
- Server authority. All economy resolves server-side; the client is a renderer.
  Spin outcomes, pack rolls, task credit, and payouts are decided on the server.
- Non-custodial default. Today the server "never holds keys or funds." The
  spinner payout is the first real prize custody. We honor the spirit by using an
  Anchor program PDA vault (program-enforced caps + replay guard + payout only to
  the winner), with the keeper key holding only settle authority, not funds.
- i18n. Every player-facing string is a `t()` key; sim/server emits register a
  matcher rule (`sim_i18n.ts` / `server_i18n.ts`) in the same change. New HUD
  windows are fully localized (English-only PR is legal; maintainer batch-fills).
- SQL only in `db.ts` / `*_db.ts`; logic modules talk to a DB interface.
- No new heavy deps. `@solana/web3.js`, `@solana/spl-token`, `bs58`,
  `@noble/curves` are already present (buyback + wallet-link). Anchor tooling for
  the new program lives under `programs/` like `character-market`.

### 2.2 The pay-to-win tension (the load-bearing constraint)

- `CLAUDE.md`: "Gameplay math follows real classic-era formulas ... no pay-to-win."
- `src/ui/holder_tier.ts`: holder flair "grants NO gameplay power."
- The requested pack contents (gear, combat potions, persistent buffs) directly
  oppose that. Section 7.A proposes three guardrail strategies and a recommendation.

### 2.3 Legal / regulatory edge cases

- A free, holder-gated SOL faucet is low risk but still a value giveaway tied to a
  token; paid lootboxes (burn-to-open with value inside) are squarely in
  lootbox/gambling regulation in several jurisdictions (e.g. BE/NL lootbox bans,
  mandatory gacha odds disclosure in JP/CN, UK loot-box guidance).
- Mitigations baked into the design: published odds, provable fairness,
  geo-gating hook, an over-18 / ToS acknowledgement, and a global kill switch.
  Counsel review is a release gate, not an engineering one, but the flags exist.

### 2.4 Anti-abuse edge cases

- Sybil farming of free SOL: many accounts each spinning daily. Cost-to-attack is
  set by the 1000 $WOC hold requirement per linked wallet plus turnstile/antibot.
- Flash-hold of 1000 $WOC: borrow 1000 $WOC, link, spin, return it. Mitigation:
  re-read balance (cache-bypass) at spin time AND re-check at settle time, and/or
  require the balance to be held across two snapshots N minutes apart.
- One wallet, many accounts: `wallet_links.pubkey` is UNIQUE, so a wallet maps to
  one account already. Good.
- Double-spend of a spin or pack: DB unique keys + on-chain replay PDA + `tx_sig`
  UNIQUE (same belt-and-suspenders the rename flow uses).
- Treasury drain: expected value per spin x DAU must stay under a daily budget;
  odds adapt to the live vault balance and a hard daily cap.

### 2.5 Online-only nature

These features require a wallet and chain access, so they are inherently
online-only. The offline browser `Sim` must degrade gracefully (the spinner/pack
UI is hidden or shows a "play online to use" state). New `IWorld` surface is
implemented for real in `ClientWorld` (server-fed) and stubbed/disabled in offline
`Sim`.

---

## 3. Research: existing patterns we reuse (not reinvent)

| Need | Reuse | File |
|---|---|---|
| "Is this wallet a holder, and how much?" | `holderInfoForPubkey` (cached `getTokenAccountsByOwner`) | `server/woc_balance.ts` |
| Tier ladder + thresholds | `HOLDER_TIERS`, `holderTierForBalance` | `src/ui/holder_tier.ts` |
| Link wallet -> account, prove control | ed25519 sign-to-link, replay-guarded challenges | `server/wallet_link.ts`, `wallet_links` table |
| Verify an inbound burn/payment | finalized tx, balance-delta proof, burn check, memo binding | `server/woc_payment.ts`, `server/solana_tx.ts` |
| Quote -> pay -> redeem state machine | single-use quotes, `tx_sig UNIQUE` replay guard | `woc_quotes`, `woc_payments` tables; `server/identity_actions.ts` |
| Sign + send outbound tx with a keeper | keeper Keypair from base58 secret, sign, send, confirm | `server/buyback.ts` |
| Anchor escrow PDA with a settler role | listing PDA + token vault + atomic settle, IDL-free encoders | `programs/character-market/src/lib.rs`, gamblefi `woc_escrow_client.ts` |
| Mode-scoped power without world pay-to-win | augment picks fold into `TalentModifiers`, never the leveling world | `src/sim/content/augments.ts` |
| Grant an item / apply a buff in-world | `sim.addItem(itemId, n, entityId)`, `sim.applyAura(p, {...})` | `src/sim/sim.ts` |
| Item / gear / consumable schema | `ItemDef { kind, slot, quality, use }` | `src/sim/content/items.ts` |
| Scheduled keeper loop | `setInterval`, gated on a `ready()` flag, `.unref()` | `server/main.ts` (buyback cadence) |
| DAU / session tracking to build streaks on | one row per login | `play_sessions` table |
| Anti-bot + human check | turnstile + heuristics | `server/turnstile.ts`, `server/antibot.ts` |

New external dependency: none required for commit-reveal fairness. (Optional:
Switchboard VRF if we later want on-chain randomness instead of commit-reveal;
not needed for v1.)

---

## 4. Architecture and data flow

### 4.A Eligibility layer (shared by spinner; informs packs/tasks)

- New `server/woc_eligibility.ts` (thin, pure-ish) exposing
  `isSpinEligible(pubkey): { ok, balance, reason }` built on a cache-bypassing
  variant of `fetchWocBalance`. Threshold `SPIN_MIN_WOC = 1000` (env-overridable),
  expressed in human $WOC, decoupled from tier index so the ladder can move.
- Eligibility = wallet linked (`wallet_links`) AND fresh balance >= `SPIN_MIN_WOC`
  AND turnstile/antibot pass. Reward odds MAY scale with `holderTierForBalance`.

### 4.B Daily Spinner (provably fair, Anchor PDA payout)

Fairness (commit-reveal, standard provably-fair):

1. Each UTC day the server generates a 32-byte secret `S_day` and publishes
   `commit = sha256(S_day)` BEFORE any spins (`spin_daily_commits` row, surfaced
   at `GET /api/spin/fairness`). Committing before bets proves no seed-grinding.
2. A spin's outcome is `H = sha256(S_day || accountId || dayNonce || clientSeed)`,
   where `clientSeed` is supplied by the player (player entropy => the server
   cannot target a specific player), and `dayNonce` is the player's spin counter
   for the day (always 1 in v1 since one spin/day). `H` maps onto the published
   weighted prize table.
3. At day rollover the server reveals `S_day` at `/api/spin/fairness`; anyone can
   recompute every outcome and confirm it matches what was paid on-chain.

Why not the sim RNG: a client can replay the seed; money RNG must be unpredictable
pre-commit, so it is server-secret. Consistent with "economy resolves server-side."

Payout (Anchor program `woc_spin_vault`, modeled on `character-market`):

- PDA `["spin_vault"]` holds SOL (treasury funds it). State: `authority`
  (treasury, can refill/withdraw), `settler` (keeper pubkey), `max_payout`,
  `paused`.
- `initialize(authority, settler, max_payout)`.
- `fund` (or plain system-transfer to the PDA) tops up the prize pool.
- `payout(day, account_tag, amount, winner)`, settler-signed. On-chain guards:
  `amount <= max_payout`, `!paused`, and a per-spin replay PDA
  `["payout", day, account_tag]` that the program inits (so the same spin cannot
  be paid twice on-chain), then transfers `amount` lamports vault -> winner.
- Server encoders are IDL-free (sha256 discriminator + borsh args + account list
  matching the struct), unit-tested against the program, exactly like
  `woc_escrow_client.ts`.

Server flow:

1. `GET /api/spin/status` -> { eligible, balance, alreadySpunToday, streak,
   nextResetAt (UTC midnight), dailyCommit, prizeTable }.
2. `POST /api/spin` { characterId, clientSeed, turnstileToken } -> verify
   bearer auth + antibot + fresh balance >= 1000 + not-yet-spun (DB UNIQUE on
   (account_id, utc_day)); compute outcome; insert `spins` row (status `pending`);
   return outcome immediately for the wheel animation + a receipt id.
3. Keeper settles: settler signs `payout`, on confirm updates the row to `settled`
   with `settle_sig` (UNIQUE). Failures stay `pending` and are retried
   idempotently (same (day, account_tag) => same replay PDA, safe to resubmit).
4. Client polls `GET /api/spin/receipt/:id` (or receives a WS push) for the
   settle signature.

Anti-abuse recap: one spin per account per UTC day (DB UNIQUE); 1000 $WOC hold
per linked wallet (sybil cost); turnstile/antibot; balance re-check at settle to
blunt flash-holds; on-chain `max_payout` cap; per-spin replay PDA.

### 4.C Pack Ripping (burn $WOC -> random buffs/potions/gear)

Purchase mirrors the rename/identity quote -> pay -> redeem flow (non-custodial,
the player signs their own burn):

1. `POST /api/packs/quote` { packId } -> single-use quote (extend `woc_quotes`
   with `kind = 'pack_open'`, payload `{ packId }`), returns `quoteId`, `priceBase`,
   and burn instructions (client builds `burnChecked` with `quoteId` as memo).
2. Player burns $WOC on-chain client-side.
3. `POST /api/packs/redeem` { quoteId, txSig } -> `verifyWocPayment(txSig, payer,
   priceBase, quoteId)` (finalized, legacy SPL, memo == quoteId, burned >=
   price). Insert `woc_payments` (`tx_sig` UNIQUE replay guard); consume the quote.
4. Server rolls contents from the pack's weighted loot table (server-secret RNG,
   same commit-reveal option as spins for auditable odds), records a
   `pack_openings` row, and GRANTS the contents, then returns the revealed list
   for the rip animation.

Pack model (data-as-code, new `src/sim/content/packs.ts`, sim-pure):

- `PackDef { id, name, priceWoc, table: WeightedEntry[], pity? }`.
- `WeightedEntry` references a reward: a gear `ITEMS` id, a consumable `ITEMS` id,
  or a mode-scoped buff/augment id, with a weight and a quality band.
- Gacha mechanics: rarity weights, pity counter (guarantee a rare within N opens),
  and duplicate -> shard conversion for a craft/collection economy.

Granting contents (routes through the authoritative Sim so persistence is free):

- Policy filter first: each `WeightedEntry` is tagged with the minimum
  `PACK_POWER_POLICY` it requires (cosmetic/QoL/mode-scoped entries require
  `cosmetic`; vertical gear and combat potions require `seasonal` or `open`). At
  roll time the realm's policy filters the table to permitted entries and
  renormalizes weights, so ONE pack definition works on every realm and degrades
  gracefully on a strict realm. See Section 7.A.
- Gear / potions: `sim.addItem(itemId, 1, entityId)` into the character inventory
  (JSONB state already persists inventory). A new server command path, validated
  like loot, applies the grant inside the `Sim`.
- Mode-scoped buffs: recorded against the account and applied only in opt-in PvP
  modes via the augment pipeline (`fiestaApplyAugments`-style), never the leveling
  world.

The "cards" framing: each pull is also recorded as a collectible card in a
`collection` table (account-scoped), powering a collection UI, dupes -> dust, and
set bonuses. Cards are the cosmetic/collectible layer; the buff/potion/gear is the
payload a card represents.

### 4.D Daily Tasks + streak (the retention glue)

- A small rotating set of daily objectives (log in; kill N of type X; clear a
  dungeon; win an arena), tracked server-side from sim events the server already
  observes (combat/quest/arena credit).
- Completion grants soft currency (spin tokens / pack keys) and advances a login
  streak; 3/7/30-day streak milestones grant bonus keys or improved spin odds.
- Tables `daily_activity` (account_id, realm, utc_day, spun, tasks_done, streak,
  keys) and `daily_tasks` (the day's rolled task set). Reset is implicit (keyed by
  utc_day), so no cron is needed for reset; the keeper handles vault funding,
  payout settling, and the daily fairness commit/reveal.

### 4.E Client (HUD) surface

- New `IWorld` fields for client-visible state: spin availability + streak + keys,
  collection summary, last reveal. Implemented in `ClientWorld` (server-fed),
  stubbed/disabled in offline `Sim`.
- New HUD windows in `src/ui/`: a spin wheel (canvas, `prefers-reduced-motion`
  aware), a pack-rip reveal, a daily-task tracker, a collection grid. All copy via
  `t()`; all controls meet the mobile 16px input / 40px target rules.

### 4.F Data-flow summary (one line each)

- Spin: client -> POST /api/spin -> server (eligibility + commit-reveal outcome +
  DB row) -> keeper settles on-chain PDA payout -> SOL in wallet, receipt to client.
- Pack: client quote -> client burns $WOC -> redeem -> server verifies burn +
  rolls + grants via Sim -> reveal to client.
- Task: sim event -> server tasks tracker -> currency/streak -> feeds spin/pack.

---

## 5. New persistence (all in `db.ts`, realm-scoped where player-bound)

- `spin_daily_commits(utc_day PK, commit_hash, revealed_seed NULL, created_at)`.
- `spins(id, account_id, realm, utc_day, day_nonce, client_seed, commit_day,
  prize_key, lamports, status, settle_sig UNIQUE NULL, created_at,
  UNIQUE(account_id, realm, utc_day))`.
- `pack_openings(id, account_id, realm, pack_id, tx_sig, contents JSONB,
  created_at)`; reuse `woc_payments` for the burn receipt.
- `collection(account_id, realm, card_id, count, first_at, PRIMARY KEY(account_id,
  realm, card_id))`.
- `daily_activity(account_id, realm, utc_day, spun bool, tasks_done int,
  streak int, keys int, PRIMARY KEY(account_id, realm, utc_day))`.
- `daily_tasks(account_id, realm, utc_day, tasks JSONB, completed JSONB)`.
- Extend `woc_quotes.kind` to accept `pack_open` (no schema change; it is TEXT).

---

## 6. Config / feature flags (env, off by default)

- `SPIN_ENABLED` (default false), `PACKS_ENABLED` (default false): master gates,
  like `SNS_ENABLED` / `BUYBACK_ENABLED`.
- `SPIN_MIN_WOC` (default 1000).
- `SPIN_VAULT_PROGRAM_ID`, `SPIN_SETTLER_SECRET` (base58, via KMS like
  `BUYBACK_KEEPER_SECRET`), `SPIN_MAX_PAYOUT_LAMPORTS`, `SPIN_DAILY_BUDGET_SOL`.
- Prize table + pack tables are config (env-overridable like `WOC_PRICE_*`).
- `PACK_POWER_POLICY` (per realm; one of `cosmetic` | `seasonal` | `open`;
  default `cosmetic`). Read per process like `REALM`. Selects the pack-power
  guardrail (Section 7.A); surfaced to clients so the realm-select / pack UI can
  disclose the realm's rules and odds.
- Geo-gate + ToS-ack hooks (no-op stubs until counsel sets policy).

---

## 7. Risks, unknowns, and open decisions

### 7.A RESOLVED: pack power is a per-realm policy (`PACK_POWER_POLICY`)

All three guardrail strategies are implemented; each realm process picks one via
the `PACK_POWER_POLICY` env var (default `cosmetic`). The realm model already
scopes characters, economy, and leaderboards per process, so a looser policy is
contained to its own realm and the canonical world stays invariant-safe.

The three values, least to most permissive:

1. `cosmetic` (default, invariant-safe): gear from packs is cosmetic transmog +
   lateral sidegrades (same item budget as drop-equivalent gear, never a vertical
   upgrade over what play yields); potions are out-of-combat QoL (rested XP, town
   speed); real power buffs are mode-scoped (Arena/Fiesta) only. Feels like gacha,
   keeps the open-world vanilla-formula invariant intact. This is what the main /
   canonical realm runs.
2. `seasonal`: vertical power from packs IS granted to the persistent character,
   but only on a realm explicitly designated non-canonical (its own walled-off
   leaderboards/economy, like an opt-in season). Protects the main game; isolates
   the pay-to-win to players who chose that realm.
3. `open`: packs can yield top-tier gear and combat potions in the persistent
   world with no isolation. Maximum gacha pull; knowingly breaks the invariant and
   the classic-MMO ethos; highest community + regulatory risk. For a deliberately
   degen realm only.

Implementation: pack loot entries are tagged with the minimum policy that unlocks
them (Section 4.C). The roll filters to the realm's permitted entries and
renormalizes, so one pack catalog serves all realms. The active policy is sent to
the client so the realm-select and pack UIs disclose the rules and odds up front.
Guardrail for `seasonal`/`open` realms: they must also be flagged non-canonical
where their power would otherwise pollute shared/canonical leaderboards (confirm
how strict that separation needs to be at review).

### 7.B Other risks

- Treasury economics: free SOL faucet must be budgeted; adapt odds to live vault
  balance + hard daily cap; model EV x DAU before funding.
- Legal: lootbox/gambling exposure (esp. paid packs). Published odds + provable
  fairness + geo-gate + ToS-ack + kill switch built in; counsel sign-off is a
  release gate.
- Flash-hold of 1000 $WOC to qualify (mitigated by dual balance snapshot).
- Sybil farming (mitigated by hold cost + antibot + one-spin-per-day).
- RPC reliability/rate limits for balance reads + tx verification (existing
  concern; cache + retry).
- Payout settlement reliability: partial/failed on-chain payout; idempotent retry
  via the per-spin replay PDA.
- Determinism leak: ensure no money-deciding RNG enters `src/sim/` (enforced by
  keeping rolls in `server/`).
- Community optics: an open-source classic MMO selling power is contentious;
  option 1 in 7.A is the on-brand path.

### 7.C Unknowns to confirm before building

- How strict the canonical separation must be for `seasonal`/`open` realms (do
  they share any leaderboards/economy with canonical, or fully wall off?).
- Which realm(s) ship each `PACK_POWER_POLICY` at launch (default everywhere, or
  is there a designated degen realm on day one?).
- Spin prize table values + daily treasury budget.
- Pack tiers, prices (burn amounts), loot tables, and pity thresholds.
- Whether spinner odds should scale with holder tier (and how much).
- Geo-gating policy + jurisdictions to exclude (counsel input).
- Whether v1 ships all three features together or spinner-first.

---

## 8. Proposed build order (phased, each independently shippable behind a flag)

1. Foundations: eligibility module + `daily_activity`/streak + DB tables + config
   flags. No money yet. Tests: eligibility, streak math.
2. Anchor `woc_spin_vault` program + IDL-free server encoders + program tests on
   devnet. No game wiring yet.
3. Spinner backend: commit-reveal engine, `/api/spin/*`, keeper settle loop.
   Tests: fairness verify, prize weighting, replay/idempotency, payout cap math.
4. Spinner HUD: wheel window, status, receipt, fairness page. Mobile + a11y + i18n.
5. Packs backend: `packs.ts` content, quote/redeem on the burn-verify path, roll +
   grant via Sim, collection. Tests: burn verify reuse, weighting, pity, grant.
6. Packs HUD: rip reveal + collection grid.
7. Daily tasks: server tracker off sim events + task UI; wires currency into 1.
8. Hardening: geo-gate, ToS-ack, odds disclosure, kill switch, load/EV review,
   security review of the keeper + program, counsel review (release gate).

Each phase keeps `npm test` + `npm run build` green and lands behind its flag.

---

## 9. Test and verification strategy

- Vitest (pure logic): eligibility threshold, streak transitions, commit-reveal
  outcome mapping + reveal verification, prize/loot weighting, pity counter,
  payout cap + EV math, escrow instruction encoders vs the program structs,
  quote/redeem replay guards.
- Anchor program tests (devnet): init, fund, payout cap, double-payout rejection
  (replay PDA), pause.
- Integration scripts (`scripts/*.mjs`): full spin happy path against a dev
  server + a funded devnet vault; full pack quote -> burn -> redeem -> grant path.
- Browser/visual: wheel + rip reveal in portrait and landscape, reduced-motion,
  keyboard operation, 16px inputs / 40px targets.
- i18n: `npm run i18n:scan`; S3 matcher guard for any sim/server player text.
