# WoCC DIEM Delegation Pool

DIEM holders stake their tokens on Venice.ai and get a daily-refreshing API
credit ($1/day per staked DIEM). This service lets them **delegate that
capacity to World of ClaudeCraft** without giving up custody of anything:

1. A provider registers a **scoped Venice API key** (signed with their Solana
   wallet). They keep their DIEM; they can revoke the key at any time.
2. The game backend routes its AI inference (NPC dialogue, quest generation,
   dungeon master, agent players) through the pool of registered keys.
3. Actual consumed compute is metered per provider and settled nightly in
   **Claudium**, the in-game premium currency (internal ledger — no on-chain
   transfer in v1).

## Delegation flow

```mermaid
sequenceDiagram
    participant P as Provider (wallet)
    participant D as Pool dashboard
    participant A as Pool API (Next.js)
    participant V as Venice.ai
    participant G as Game backend
    participant W as Worker (BullMQ)

    Note over P,A: Registration (non-custodial)
    P->>D: connect wallet
    D->>A: POST /api/providers/nonce
    A-->>D: nonce + message
    P->>D: sign message (ed25519)
    D->>A: POST /api/providers/register {sig, veniceApiKey, declaredDiem}
    A->>A: verify signature + one-time nonce
    A->>V: ~1-token validation call (cheapest model)
    V-->>A: 200 OK
    A->>A: AES-256-GCM encrypt key, store last4 only

    Note over G,V: Inference (steady state)
    G->>A: POST /api/internal/inference {payload, purpose} + shared secret
    A->>A: weighted round-robin pick (weight = remaining daily credit)
    A->>V: /chat/completions with provider's key
    V-->>A: response + usage tokens
    A->>A: meter cost → UsageEvent + intraday spend
    A-->>G: upstream response (provider id in headers)

    Note over W: 00:00 UTC daily
    W->>W: sum consumed $ per provider, apply multiplier/standby/cap
    W->>W: upsert RewardLedger (idempotent on providerId+date)
    W->>G: settlement-events queue + signed webhook
    G->>G: credit player's Claudium balance

    Note over P,A: Exit anytime
    P->>A: DELETE /api/providers/:id/key (wallet-signed)
    A->>A: key wiped, status REVOKED, routing stops
```

## Stack

- **Next.js 15 (App Router)** — API routes + provider/admin dashboard
- **PostgreSQL + Prisma** — providers, usage metering, reward ledger
- **BullMQ + Redis** — health probes (30 min), daily settlement (00:00 UTC),
  `settlement-events` outbox queue
- **Zod** — validation on every route
- **tweetnacl + bs58** — Solana wallet signature verification

## Setup

```bash
cd services/diem-pool
npm install

# 1. Local Postgres + Redis
docker compose up -d

# 2. Configure
cp .env.example .env
# fill in KEY_ENCRYPTION_KEY / INTERNAL_SHARED_SECRET / ADMIN_TOKEN:
#   openssl rand -hex 32

# 3. Database
npm run prisma:generate
npm run prisma:migrate      # applies prisma/migrations
npm run prisma:seed         # seeds the model pricing table

# 4. Run
npm run dev                 # Next.js app on :3100
npm run worker              # BullMQ worker (separate terminal)

# 5. Verify
npm test
npm run typecheck

# Optional full-stack verification (DESTRUCTIVE — scratch DB only): mock
# Venice upstream + real registration/routing/settlement flow end to end.
node scripts/mock_venice.mjs &          # set VENICE_BASE_URL=http://127.0.0.1:4567/api/v1
npx tsx scripts/e2e_smoke.mts           # API-level: 60+ checks incl. failover & concurrency
npx tsx scripts/ui_e2e.mts              # browser-level: dashboard/admin/leaderboard flows
npx tsx scripts/load_sanity.mts         # throughput/latency sanity vs the mock upstream
```

The game backend calls the pool like this:

```bash
curl -s http://localhost:3100/api/internal/inference \
  -H "content-type: application/json" \
  -H "x-internal-secret: $INTERNAL_SHARED_SECRET" \
  -d '{
        "purpose": "npc_dialogue",
        "gameAccountId": "acct_123",
        "payload": {
          "model": "llama-3.3-70b",
          "messages": [{"role": "user", "content": "Greet the traveler."}],
          "max_tokens": 128
        }
      }'
```

The response body is the upstream Venice (OpenAI-compatible) response;
`x-pool-provider-id` / `x-pool-house` headers say who served it.

## Router weighting algorithm

Smooth weighted round-robin (the nginx variant) over ACTIVE providers, where
each provider's weight is its **remaining routable budget** for the UTC day:

```
weight(p) = max(0, dailyCapacityUsd × SPEND_HEADROOM − spentTodayUsd)
```

- `SPEND_HEADROOM` (default 0.90) stops routing at ~90% of declared capacity,
  leaving slack for metering-vs-Venice estimation error.
- Per pick, every candidate's counter grows by its weight; the max counter
  wins and pays back the total. Selection is exactly proportional over time,
  burst-free, and deterministic — see `tests/router.test.ts`.
- Failure handling: one same-key retry on retryable errors (5xx/network/429),
  then failover to the next-best-budget provider (max 3 providers per
  request). Two consecutive hard failures → `DEGRADED` (skipped until a
  health probe recovers it). 401/403 → `INVALID`. "Insufficient credit" pins
  the provider's intraday spend to capacity so it sits out the rest of the day.
- Pool exhausted → the house Venice key serves the call, tagged `house`
  (never rewarded).

## Settlement economics (00:00 UTC, settles the day that just ended)

| Step | Rule |
| --- | --- |
| Base | `floor(consumedUsd × CLAUDIUM_PER_USD)` — consumed compute only, never pledged capacity |
| Uptime bonus | ×`UPTIME_MULTIPLIER` (1.25) once `consecutiveHealthyDays ≥ 30` |
| Standby | `floor(unusedCapacityUsd × STANDBY_CLAUDIUM_PER_USD_CAPACITY)` for providers ACTIVE and healthy all day |
| Cap | nobody keeps more than `MAX_DAILY_SHARE` (20%) of the day's total uncapped emission |

Notes:

- The cap only engages when at least `MIN_PROVIDERS_FOR_CAP` (default 5)
  providers earned that day — with a tiny pool a literal 20%-of-total cap
  would zero out most of the emission (a lone provider could never earn more
  than 20% of its own reward). Set it to 1 for the literal rule.
- Settlement is **idempotent**: ledger rows upsert on `(providerId, date)`;
  streak bumps and suspicion scores commit in one transaction guarded by
  `SettlementRun.streaksApplied`, so re-running a crashed or duplicate job
  never double-pays or double-bumps.
- Each settlement emits a message on the `settlement-events` BullMQ queue and
  (optionally) an HMAC-signed webhook (`x-wocc-signature`) to
  `GAME_WEBHOOK_URL`. Delivery is at-least-once — the game backend must
  dedupe on `(providerId, date)` before crediting Claudium.

## Security model

- **Keys**: validated with a ~1-token call before acceptance; AES-256-GCM
  encrypted at rest (`KEY_ENCRYPTION_KEY`, KMS-shaped envelope); never logged,
  never returned by any API (only `keyLast4`); wiped immediately on
  revocation. Upstream error bodies are redacted before they leave the
  service.
- **Provider mutations** (register/revoke): one-time server-issued nonce
  (10 min TTL, atomically consumed) + ed25519 wallet signature over a
  server-built message that binds action, wallet, and nonce — replay- and
  purpose-confusion-proof.
- **Internal inference**: constant-time shared-secret check
  (`x-internal-secret`); everything else is rejected.
- **Rate limits**: registration per-IP and per-wallet (Redis fixed windows).
- **Self-dealing**: each settlement scores providers by the share of their
  usage coming from their single busiest game account (`suspicionScore`,
  flagged at ≥0.6 in the admin panel — no auto-ban in v1).
- **Kill switch**: admin toggle pauses all routing instantly.

## Surfaces

| Path | What |
| --- | --- |
| `/` | Provider dashboard: connect wallet, register/revoke key, live stats |
| `/leaderboard` | Public ranking by lifetime $ served |
| `/admin` | Pool overview, pricing editor, kill switch (needs `ADMIN_TOKEN`) |
| `POST /api/providers/nonce` | Issue signing nonce |
| `POST /api/providers/register` | Register a validated Venice key |
| `DELETE /api/providers/:id/key` | Wallet-signed revocation |
| `GET /api/providers/by-wallet/:wallet` | Provider stats |
| `GET /api/leaderboard` | Leaderboard JSON |
| `POST /api/internal/inference` | Game → pool inference (shared secret) |
| `GET /api/admin/overview` · `GET/PUT /api/admin/pricing` · `GET/POST /api/admin/killswitch` | Admin API |

## Operations

- **Monitoring**: `GET /api/health` (unauthenticated, for LB probes and
  alerting) reports DB round-trip latency, Redis reachability, last settled
  day (flags a stuck settlement worker), the kill-switch state, and provider
  status counts. 200 when fully healthy, 503 otherwise. Structured
  warn/error logs mark every degraded path: `[ratelimit]` fail-open,
  `[pricing]` unknown-model fallback, `[inference] METERING FAILED`,
  `[settle]`/`[health]`/`[worker]` job outcomes.
- **Rollback**: deploys are stateless — roll back by redeploying the previous
  image. The schema is a single additive migration (`prisma migrate deploy`
  is idempotent); settlement re-runs are idempotent by design. For incidents,
  the admin kill switch stops all routing instantly without a deploy, and
  individual providers can be revoked.
- **Job resilience**: scheduled jobs retry with exponential backoff
  (settlement: 5 attempts from midnight UTC; probes: 2). A settlement missed
  entirely (worker down) is picked up safely later — run
  `runDailySettlement()` for the missed date or just let ops re-fire; the
  `SettlementRun` guard prevents double-pay.
- **Data retention**: nonces are pruned automatically after a day.
  `UsageEvent` grows with traffic (one row per inference call) — the reward
  ledger only needs daily sums, so archive/partition events older than your
  audit window once volume warrants it.
- **Dependencies**: `package-lock.json` pins the tree; `npm audit` is clean
  as of the last commit (a `postcss` override keeps Next's transitive pin on
  the patched line).

## Known limitations (v1)

These are the places where the implementation makes assumptions that must be
checked against the real Venice API before money-equivalent rewards ship:

- **Venice balance shapes are assumed, not verified.** `src/lib/venice.ts`
  sniffs a few plausible balance headers (`parseBalanceUsd`) and otherwise
  trusts the provider's *declared* DIEM count for capacity. Inspect real
  Venice responses and adapt; until then a provider can over-declare
  capacity (bounded by `MAX_DECLARED_DIEM`, and metering still only pays for
  actually-served compute).
- **Seeded model pricing is a snapshot** (`prisma/seed.ts`), not live data.
  Keep the table in sync with https://venice.ai/pricing via the admin
  editor; unknown models are metered at a conservative fallback rate and
  logged.
- **`purpose: image_gen` is tagged and metered but routed through
  `/chat/completions`** like everything else; wiring Venice's image endpoint
  is follow-up work.
- **Streaming is not supported** — the router forces `stream: false` so the
  `usage` block is always present for metering.
- **Self-dealing detection is a heuristic** (top-account share of daily
  usage), surfaced in admin only — it flags, it does not prove or ban.
- **The wallet flow is verified with an injected test wallet**
  (`scripts/ui_e2e.mts`) that implements the Phantom `connect`/`signMessage`
  interface with real ed25519 signatures; a pass against the actual Phantom
  extension is still worth doing before launch.

## Non-goals (v1)

- No on-chain Claudium settlement (internal ledger only)
- No custodial DIEM pooling — we never hold tokens
- No provider payouts in $WOC
