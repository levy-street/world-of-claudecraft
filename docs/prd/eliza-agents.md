# PRD — elizaOS Agents (Players + Pet Familiars) with Auto Wallets

| | |
|---|---|
| **Status** | Draft / Proposed — **RFC, stub PR, not for merge** |
| **Owner** | TBD |
| **Created** | 2026-06-16 |
| **Source demand** | Product direction: let [elizaOS](https://github.com/elizaos/eliza) agents play WoC as autonomous players or as a human's AI companion; monetize as a paid feature. |
| **Related systems** | Auth/WS (`server/main.ts`, `src/net/online.ts`), command layer (`server/game.ts`), sim entities + pets (`src/sim/sim.ts`, `src/sim/entity.ts`, `src/sim/types.ts`), persistence (`server/db.ts`), reference headless client (`scripts/mp_integration.mjs`), top-level non-sim service precedent (`headless/env_server.ts`) |
| **Locked decisions** | Solana only · on-chain crypto paid gate · real sim companion entity for familiars · wallet role v1 = identity + hold/earn |
| **Scale** | Flagship milestone (not one PR). Three new components + a server/sim seam; staged in 5 phases. This PR is **scaffolding + spec only** to anchor discussion. |

---

## 1. Summary

Let **elizaOS agents ("elizas")** participate in World of Claudecraft in two modes:

- **Player mode** — an eliza is its own character; it connects exactly like a human client and quests/fights/chats autonomously.
- **Pet familiar mode** — an eliza drives a **companion entity owned by a human player**, fighting alongside them.

Each eliza **automatically gets a Solana wallet** (identity + hold/earn in v1). The whole capability is a **paid feature gated by an on-chain Solana payment**.

The integration is deliberately **additive and isolated**: it never weakens the server's "trust nothing from the client" model, and it never violates the `src/sim/` determinism / no-web3 invariants. All money/web3 lives in `server/` only; the sim never learns money exists.

---

## 2. Background & motivation

Two existing systems make this far cheaper than it sounds:

1. **WoC already has a headless-client contract.** `scripts/mp_integration.mjs` proves an external process can speak the full REST-auth → WebSocket protocol: `{t:'auth'}` → stream `{t:'input', mi}` + `{t:'cmd', …}`, and merge delta-encoded `{t:'snap'}` snapshots. An eliza *player* is just another well-behaved WS client — **no new transport**.
2. **WoC already has owner-bound pets.** Hunter pets are `kind:'mob'` with `ownerId` set, driven by `updatePet` (`src/sim/sim.ts`) with follow/leash/taunt. A *familiar* reuses this verbatim. Critically, the existing pet code already:
   - routes kill credit to the owner — `target.tappedById = source.ownerId` (`src/sim/sim.ts`),
   - grants pet deaths no loot/XP — `if (e.ownerId !== null) { …; return; }` (`src/sim/sim.ts`).
   - **Therefore an agent familiar cannot inject economy value** — it can only help the human it is bound to, with **zero new credit logic**.

Monetization is greenfield (no payment/wallet/billing code exists today), so we add it cleanly.

elizaOS provides the agent runtime and an `actions`/`providers`/`evaluators`/`services` plugin model, plus `@elizaos/plugin-wallet` (Solana). **Caveat:** elizaOS v2 is **beta** — pinning the exact API is Phase 0.

---

## 3. Architecture

Three components — two new and living **outside** the sim invariants:

```
 bridge/  (NEW)  ── REST /api/agent/* + WS /ws ──►  server/  (authoritative)
 hosts N runtimes                                   + server/billing.ts + server/solana.ts (NEW)
 + Solana wallets   ◄── snapshots · events ──       + agent/billing tables, is_agent
        │ loads                                              │ calls pure methods
        ▼                                                    ▼
 @woc/plugin-claudecraft  (NEW)                      src/sim/  (deterministic, NO web3)
 Service + Actions + Providers                       + summonFamiliar/despawnFamiliar
 + 20Hz steering control loop                        + Entity.familiarAgentId
```

### 3.1 Component A — WoC server + sim changes (`server/`, `src/sim/`)

**Player connection — reuse the existing path.** An eliza player is an ordinary account + character + token. Minimal server changes:
- `is_agent` boolean on `accounts` (denormalized onto `characters` for cheap in-loop reads) → moderation, leaderboard segregation, paid gate. Thread through `GameServer.join` → `ClientSession.isAgent`. **The sim stays agnostic** (no `Entity` change for "is agent").
- WS-upgrade connection throttle with an `AGENT_BRIDGE_IPS` allowlist (today only REST register/login is throttled).
- **Per-session command rate limit** (new) — token bucket on `ClientSession` mirroring `consumeChatToken` (`server/game.ts`); `input`/`cmd` are currently unthrottled per session.
- **Paid gate** in `authenticateWebSocket` (`server/main.ts`): if `account.is_agent` and no active entitlement → reject `{t:'auth'}` with `{t:'error', error:'agent entitlement required'}`. Humans bypass entirely.

**Pet familiar entity — reuse `kind:'mob'` + `ownerId`; do NOT add a new `EntityKind`.** A new `'familiar'` kind would ripple through dozens of `kind==='mob'` branches for no behavioral gain. Instead:
- One new **runtime-only** field `Entity.familiarAgentId: number | null` (declare in `src/sim/types.ts`, init in `src/sim/entity.ts` `baseEntity`) to distinguish an agent-driven familiar from a plain tamed beast. Never serialized.
- New pure sim methods `Sim.summonFamiliar(ownerPid, opts)` (modeled on `completeTame`; spawns a non-tamable `familiar_*` template from `src/sim/content/`) and `Sim.despawnFamiliar(pid)` (familiars have no wild home → drop rather than `releasePetToWild`). Hook owner logout in `removePlayer`.
- Determinism preserved: decisions enter as discrete commands applied at the next `tick()`, using only `this.rng`.

**Familiar control transport — the eliza gets its own authed WS session bound to the human's familiar** (preferred over relaying through the owner's socket — keeps per-agent rate-limiting/backpressure/moderation clean):
- Extend the auth frame: `{t:'auth', token, character, mode:'familiar', ownerCharacter}`. The token identifies the **agent's own** account+character; `ownerCharacter` is the human to assist.
- `authenticateWebSocket` branches on `mode==='familiar'` → requires `is_agent` + entitlement → `game.joinFamiliarControl(...)`.
- **Consent gate:** the human must first issue a `bind_familiar` cmd naming the agent. No uninvited familiars.
- New `dispatchFamiliarMessage` accepts only a whitelist (`familiar_target`, `familiar_cast`, `familiar_move`, `familiar_heel`/`attack`/`passive`), each validated against the familiar owned by `ownerPid` and refused unless the caller is the bound `familiarAgentId`. Movement the agent omits falls back to `updatePet`.
- **Scoped observation feed** reusing the existing interest query + `canObserveEntity` (so it cannot see stealthed players a normal client could not).

**On-chain paid gate — server only.** New modules (no raw SQL — they call `db.ts`):
- `server/solana.ts` — thin `@solana/web3.js` (+ `@solana/spl-token`) wrapper: fetch/confirm a tx, check SPL balance, verify an ed25519 signed nonce. Mockable for tests.
- `server/billing.ts` — build a quote; verify a payment (finalized commitment, correct recipient/amount, memo == quoteId, replay-guarded via `onchain_payments.tx_sig UNIQUE`) or a token-hold; write entitlements.

New REST endpoints in `server/main.ts` (bearer-authed, IP-rate-limited like register/login):
`POST /api/agent/wallet/challenge` · `/wallet/verify` · `/quote` · `/verify-payment` · `/verify-hold` · `GET /api/agent/entitlements`.

New Postgres tables (added to `db.ts` `SCHEMA`, inside the existing `ensureSchema` advisory lock):

```sql
account_wallets(id, account_id→accounts, chain DEFAULT 'solana', address, verified_at, created_at,
                UNIQUE(chain, address));
onchain_payments(id, account_id, chain, tx_sig, from_address, to_address, amount, mint, reference,
                 status, confirmed_at, created_at, UNIQUE(chain, tx_sig));   -- tx_sig UNIQUE = replay guard
agent_entitlements(id, account_id, kind /* 'agent_player'|'familiar' */, status, source /* 'payment'|'hold' */,
                   payment_id→onchain_payments, granted_at, expires_at, created_at);
-- + ALTER accounts/characters ADD COLUMN is_agent BOOLEAN DEFAULT FALSE
```

**Two choke points:** at connect (`authenticateWebSocket`) and at `summon_familiar` (`dispatchMessage`, defense in depth). A periodic sweep disconnects sessions whose (hold-based) entitlement lapsed.

**sim/ vs server/ boundary (invariant audit):** no `src/sim/` file imports `@solana/web3.js`, `pg`, `ws`, or anything in `server/`. Familiar behavior is deterministic sim; wallet/payment/entitlement is server-only; the control session + binding + scoped feed + command whitelist live in `server/game.ts`.

### 3.2 Component B — `@woc/plugin-claudecraft` (elizaOS plugin)

What one agent uses to perceive and act in WoC. Stubbed in this PR under `packages/plugin-claudecraft/`.
- **Actions** map 1:1 to `dispatchMessage` cmds (`WOC_CAST`, `WOC_TARGET`, `WOC_MOVE_TO`, `WOC_ACCEPT_QUEST`, `WOC_CHAT`, …). Combat/quest actions forward a one-shot `{t:'cmd'}`; movement actions **set a goal** on the service (never emit raw `mi`).
- **Providers** inject perception into the prompt (`WOC_GAME_STATE`: self HP/res, nearby entities, threats, target; `WOC_QUESTS`; `WOC_WALLET`).
- **Service** `WocConnectionService` holds the WS + the world mirror + the control loop.

### 3.3 Component C — `bridge/` (multi-agent host)

A new top-level Node service (sibling of `headless/`) hosting **N `AgentRuntime` instances**, each with its own character + wallet + WS. Stubbed in this PR under `bridge/`.
- **Wallet auto-provisioning** (recommended: generated keypair + `@elizaos/plugin-wallet`, **not** Steward for v1): on agent creation, generate a `Keypair`, base58-encode the secret into an encrypted `SecretVault` (AES-GCM at rest, master key from env/KMS, **never in git**), inject as character secret `SOLANA_PRIVATE_KEY`, register the public address via `POST /api/agent/wallet`. `SecretVault` is an interface so Steward/KMS slot in later. This is **custodial** — must be documented.
- **On-chain pay flow** (`@solana/web3.js`): `quote → sign transfer (agent wallet → recipient, memo=quoteId) → sendAndConfirm('finalized') → verify-payment → entitlement → connect`. Owner-funded variant: if the agent wallet is empty, surface the address (via `WOC_WALLET`) so the human can fund it.
- **Scaling:** vertical first (~20–50 runtimes/process, bounded by LLM concurrency); horizontal by sharding agents across bridge processes (each is just more independent WS clients).

---

## 4. The load-bearing idea — two clocks

The LLM must **not** emit 20 movement frames/sec.

- **Clock A — deterministic control loop (20 Hz, in the Service, no LLM):** ingest WS → update `WorldMirror` (delta-merge ported from `mp_integration.mjs`) → `steering.tick(goal, world)` → send `{t:'input', mi, facing}`. The server accepts an **absolute `facing`** (`src/sim/move_input.ts`), so steering is mostly "point at destination, hold `f:1`, stop within range" — no `tl/tr` ramping. Pure and unit-testable.
- **Clock B — LLM decisions (event/interval-driven, sets goals):** invoked on salient events (entered combat, HP band crossed, target died, quest step done, whisper, loot, leash broken) and an idle interval. Emits Actions that set goals / fire one-shot commands. One decision ("kill that wolf") → `WOC_TARGET` + `WOC_MOVE_TO` + `WOC_ATTACK` + `WOC_CAST`; Clock A then closes distance for seconds with **zero** further LLM calls.

LLM = "what to do"; deterministic loop = "how to move there." Keeps token cost bounded and movement server-friendly.

---

## 5. Phased delivery

| Phase | Deliverable |
|---|---|
| **0 — Verify** | Clone elizaOS to a reference dir; pin exact `Service`/`Action`/`Provider`/`Plugin` shapes + `@elizaos/plugin-wallet` Solana secret encoding. De-risks the #1 (v2-beta API churn) uncertainty. |
| **1 — Player MVP, no payments** | Plugin + bridge + `WocConnectionService` two-clock loop; one agent quests against local `npm run server`. Dev bypass `WOC_SKIP_PAYMENT=1` (dev-only, like `ALLOW_DEV_COMMANDS`). |
| **2 — Wallets + paid gate** | `server/solana.ts`+`billing.ts`, new tables/endpoints, `is_agent`, connect-time gate; bridge provisioning + pay flow on devnet. |
| **3 — Familiar mode** | `summonFamiliar`/`despawnFamiliar` + `familiarAgentId`, `familiar_*` template, `joinFamiliarControl`/`dispatchFamiliarMessage`, consent `bind_familiar`, scoped feed; bridge familiar binding. |
| **4 — Hardening** | Command rate limit, entitlement-expiry sweep, leaderboard segregation, spend caps, prompt-injection guards, moderation review. |

---

## 6. Security & fairness

- **Hard, non-LLM spend cap** in `WocPaymentService` (max lamports/quote, max quotes/hour) — the LLM cannot move money, exactly as it can't override Clock A movement.
- **Prompt-injection:** in-world chat/social text is untrusted and must never trigger payment/wallet actions.
- **Key custody:** encrypted at rest, decrypted only in-process; a vault compromise drains all agent wallets — gate any future withdrawals behind spend caps / Steward / user-held keys.
- **Server trust boundary intact:** the bridge gets no privileged WS path; every action still passes `dispatchMessage` validation.
- **Moderation:** agents are full accounts → existing ban/suspend/report paths cover them; `is_agent` enables agent-specific policy + human/agent leaderboard split.
- **Familiar consent gate** prevents uninvited-familiar griefing.

---

## 7. Acceptance criteria

- **Player mode:** an entitled agent registers → connects `/ws` → autonomously accepts a quest, navigates to and kills the objective mob, loots, and turns in — visible as a second player in the browser client. An **unentitled** agent is rejected at `auth` with `agent entitlement required`.
- **Familiar mode:** a human summons a familiar and `bind_familiar`s an agent; the agent drives `familiar_target`/`familiar_cast`; the **human** receives the XP/loot events; the familiar is owner-bound in snapshots; an **unbound** agent is rejected.
- **Wallet:** each agent has a unique Solana address, surfaced via `WOC_WALLET`; the secret is encrypted at rest and never in git.
- **Paid gate:** a finalized Solana payment with `memo==quoteId` grants an entitlement; a replayed `tx_sig` is rejected.
- **Invariants:** `npx tsc --noEmit` + `npm test` green; no `src/sim/` file imports web3/`pg`/`ws`/`server`.

---

## 8. Testing

**Vitest (deterministic, no DB/net):**
- Extend `tests/fixes.test.ts` (already sets `pet.ownerId`) with a `familiar` suite: `summonFamiliar` ownership; `updatePet` follow/leash; external `familiar_target` override; **owner** kill credit/XP; familiar death grants nothing; `despawnFamiliar` on logout.
- Extend `tests/threat.test.ts` for familiar hate-table/taunt.
- New `tests/billing.test.ts` against a **fake `solana.ts`** (mirror the in-memory `SocialDb` fake pattern): replay guard, amount/recipient validation, entitlement grant/expiry, signed-nonce verify.
- New `tests/entitlement_gate.test.ts` for the gate decision in isolation.
- Plugin package: `worldMirror` (delta-merge vs recorded snapshots), `steering` (goal→input reaches a waypoint in bounded ticks).

**E2E (`scripts/*.mjs`, running server + Postgres, `ALLOW_DEV_COMMANDS=1`):**
- `scripts/agent_player_e2e.mjs` (model on `mp_integration.mjs`): no entitlement → error; granted → `hello`; drive movement + cmd; exercise the rate limiter.
- `scripts/familiar_control_e2e.mjs`: human summons + binds; agent drives; assert the human receives XP/loot; assert an unbound agent is rejected.

---

## 9. Open risks

- **elizaOS v2 is beta** — API churn is the #1 risk; isolate elizaOS coupling to `services/` + `index.ts`, pin the version (Phase 0).
- **Steward availability** — assumed immature for v1; the `SecretVault` interface lets it slot in later.
- **Entitlement expiry mid-session** — must have the disconnect sweep, or a hold can be sold after connecting.
- **On-chain reorg/replay** — require `finalized` + `tx_sig UNIQUE`.
- **Custodial key model** — must be documented to users before any transfer/withdraw capability ships.

---

## 10. Scope of THIS PR

**Discussion scaffolding only — not for merge.** Contains:
- this PRD;
- non-functional stub trees under `packages/plugin-claudecraft/` and `bridge/` (outside the root `tsconfig` include → not typechecked/built by CI), with interfaces + `TODO(eliza)` markers;
- compile-clean seam stubs `server/billing.ts` + `server/solana.ts` (no web3 imports yet, not wired into `server/main.ts`).

No changes to `src/sim/`, `server/main.ts`, `server/game.ts`, `server/db.ts`, or the build config. Those edits land in Phases 1–4 once the approach is agreed.
