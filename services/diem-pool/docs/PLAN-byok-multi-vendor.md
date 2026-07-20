# Plan: BYOK Multi-Vendor Compute Pool (OpenAI, Anthropic, Kimi, …)

Extend the DIEM delegation pool so players can attach **their own API keys
from other AI vendors** — OpenAI, Anthropic, Kimi (Moonshot), and future
OpenAI-compatible providers — and earn Claudium for the compute the game
actually consumes through them.

Status: **Phases 1–2 implemented** (schema, adapters for OpenAI/Kimi/Anthropic,
model classes, trust ramp, vesting/voiding, per-vendor admin controls, full
test coverage). Phase 3 items (multiplier tuning UI, fraud view, image/vision
classes, streaming) remain future work. Deviations from this design are noted
in the README's Known-limitations section.

---

## 1. The two things that fundamentally change

Everything else in this plan follows from these.

**(a) The economics invert.** A Venice/DIEM key spends a *daily-refreshing
credit* backed by staked tokens — the provider's marginal cost per request is
zero, and unused capacity genuinely "expires", which is why the standby rate
exists. An OpenAI/Anthropic/Kimi key spends the provider's **real, non-refreshing
money**. Consequences:

- The declared number is no longer "staked capacity", it is a **daily spend
  budget** the provider is willing to donate. There is nothing to probe; it
  is purely a self-imposed cap.
- **Standby rewards must not apply to BYOK vendors.** Paying standby on a
  self-declared budget that costs nothing to declare is free-money printing
  (declare $10k/day, serve nothing, farm standby Claudium). Standby stays
  Venice-only, tied to stake-backed capacity.
- Reward rates may need to differ per vendor (real dollars arguably deserve
  a premium over refresh-credit). Make `CLAUDIUM_PER_USD` a per-vendor
  multiplier, admin-editable, default 1.0×.

**(b) The fraud surface inverts.** With DIEM keys the worst case is a dead
key. With real-money keys the pool becomes attractive for **laundering stolen
API keys into game currency** — stolen OpenAI/Anthropic keys are a
commodity, and "attach stolen key → farm Claudium → key dies when the victim
notices" is the obvious attack. Mitigations are a first-class part of this
design (§7), not a bolt-on:

- **Trust ramp**: new keys route only a few dollars a day no matter what they
  declare; the cap grows with healthy key age.
- **Reward vesting**: Claudium from BYOK compute is credited PENDING and
  vests after N days; a key that goes INVALID upstream (the signature of a
  stolen key being killed) voids its pending rewards.
- **No custom base URLs, ever, in v1.** Only allowlisted vendors with pinned
  endpoints. A provider-supplied URL would let anyone point the pool at a
  server that returns fabricated `usage` blocks and mint Claudium out of thin
  air (plus it's SSRF into our network).

---

## 2. Vendor adapter layer

New module `src/lib/vendors/` replacing the direct `venice.ts` coupling in
`inference.ts` (venice.ts becomes the Venice adapter's transport).

```ts
// src/lib/vendors/types.ts
export type Vendor = 'venice' | 'openai' | 'anthropic' | 'kimi';

export interface VendorAdapter {
  vendor: Vendor;
  /** Pinned upstream base URL — never provider-supplied. */
  baseUrl: string;
  /** ~1-token spend call proving the key is real AND funded. */
  validateKey(key: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Zero/near-zero-cost auth probe (GET /models equivalent). */
  probe(key: string): Promise<'healthy' | 'auth_failed' | 'rate_limited' | 'error'>;
  /**
   * Normalized in (OpenAI chat shape + concrete vendor model), normalized
   * out (OpenAI chat-completion shape + usage) so the game-facing contract
   * of POST /api/internal/inference never changes per vendor.
   */
  chat(key: string, req: NormalizedChatRequest): Promise<NormalizedChatResult>;
  /** Strip key material from any text destined for logs/errors. */
  redact(text: string, key: string): string;
}
```

Error classification stays the shared `VeniceError`-style taxonomy
(`auth | insufficient_credit | rate_limited | bad_request | server | network`)
— the router logic (retry once → fail over → 2 strikes → DEGRADED; credit
exhausted → pin spend to budget) is already vendor-agnostic and unchanged.

Per-vendor specifics the adapters own:

| | auth | endpoint | usage fields | credit-exhausted signal | quirks |
|---|---|---|---|---|---|
| **Venice** | `Bearer` | `/chat/completions` | `prompt_tokens`/`completion_tokens` | 429 + credit hint | existing behavior, unchanged |
| **OpenAI** | `Bearer sk-…` | `api.openai.com/v1/chat/completions` | same | 429 with `code: "insufficient_quota"` (must be classified by body code, not status — plain 429 is retryable, quota is not) | `GET /v1/models` probe |
| **Anthropic** | `x-api-key` + `anthropic-version` | `api.anthropic.com/v1/messages` | `input_tokens`/`output_tokens` | 400 "credit balance is too low" | request translation: top-level `system`, `max_tokens` required (default per model class), response `content` blocks → OpenAI `choices[0].message`; 529 `overloaded_error` → retryable server |
| **Kimi (Moonshot)** | `Bearer sk-…` | `api.moonshot.ai/v1/chat/completions` | OpenAI-compatible | quota error code in body | essentially the OpenAI adapter with a different base URL + key-prefix redaction |

OpenAI and Kimi share an `openai-compatible.ts` implementation
parameterized by base URL; Anthropic is the only real translation work.

## 3. Data model changes (Prisma)

```prisma
enum Vendor { venice openai anthropic kimi }

model Provider {
  // wallet loses @unique — a wallet may attach one key per vendor
  wallet  String
  vendor  Vendor  @default(venice)
  // renamed semantics: staked capacity (venice) OR donated budget (BYOK)
  dailyCapacityUsd Decimal @db.Decimal(12, 2)
  trustTier        TrustTier @default(NEW)   // NEW | ESTABLISHED | TRUSTED
  @@unique([wallet, vendor])
  // …everything else unchanged
}

model ModelPricing {
  vendor Vendor @default(venice)
  model  String        // loses @unique
  @@unique([vendor, model])
}

// purpose → concrete model per vendor, admin-editable, priority-ordered
model ModelClassMap {
  id       String @id @default(cuid())
  class    ModelClass   // fast | standard | smart
  vendor   Vendor
  model    String
  priority Int          // lower = preferred within the vendor
  active   Boolean @default(true)
  @@unique([class, vendor, model])
}

model UsageEvent  { vendor Vendor @default(venice) /* + existing */ }
model RewardLedger {
  status  RewardStatus @default(VESTED)  // PENDING | VESTED | VOIDED
  vestAt  DateTime?                      // null = vested immediately (venice)
  // …existing fields; unique(providerId, date) unchanged
}

model VendorConfig {   // admin-editable per-vendor economics + kill switch
  vendor            Vendor  @id
  enabled           Boolean @default(true)
  rewardMultiplier  Decimal @default(1.0) @db.Decimal(4, 2)
  standbyEligible   Boolean @default(false) // true only for venice
  vestingDays       Int     @default(7)     // 0 for venice
}
```

Migration is additive: existing rows backfill `vendor = venice`,
`status = VESTED`. The `@@unique([wallet, vendor])` swap needs one careful
migration step (drop old unique, add compound) — zero data movement.

## 4. Routing changes

The game stops naming concrete models and asks for a **model class**:

```jsonc
POST /api/internal/inference
{ "purpose": "npc_dialogue", "modelClass": "fast", "payload": { "messages": [...] } }
```

- `payload.model` becomes optional/ignored when `modelClass` is present;
  passing a concrete `vendor:model` string stays supported for
  back-compat and pins routing to that vendor.
- Eligibility gains one filter: provider's vendor must have an active
  `ModelClassMap` entry for the requested class *and* `VendorConfig.enabled`.
- Weight function is unchanged (`remaining budget × headroom`) — it already
  expresses "route where the most donated capacity remains". Effective
  capacity becomes `min(dailyCapacityUsd, trustTierCap)` (§7).
- The adapter substitutes the vendor's concrete model (highest-priority
  active mapping) before dispatch; metering records the concrete
  vendor+model actually used.
- Failover now naturally crosses vendors: OpenAI down → same request retries
  on an Anthropic or Venice provider. The per-request provider cap (3) and
  the 2-strike DEGRADED rule are unchanged.
- Recommended default class map (admin-editable, seeded):
  - `fast` (npc_dialogue barks): gpt-4o-mini · claude-haiku-4-5 · kimi-k2 · llama-3.2-3b
  - `standard` (quest_gen, agent_player): gpt-4.1-mini · claude-haiku-4-5 · kimi-k2 · llama-3.3-70b
  - `smart` (dungeon_master): gpt-4.1 · claude-sonnet-4-5 · kimi-k2-thinking · deepseek-r1-671b

Note the incentive nuance: expensive vendors burn budget faster and earn
more Claudium per request — which is correct, reward ∝ dollars contributed.

## 5. Metering & pricing

- `getRate(vendor, model)` — pricing cache keys on the pair; seeds from each
  vendor's published pricing (snapshot, admin-synced, same as today).
  Conservative fallback + warn-once behavior unchanged.
- `costUsd` math unchanged (micro-USD integer arithmetic).
- Per-vendor spend is what the *vendor* charges — provider's real cost —
  which is exactly what we want to reward.

## 6. Settlement & reward changes

Per provider-day, with `vc = VendorConfig[provider.vendor]`:

```
base      = floor(consumedUsd × CLAUDIUM_PER_USD × vc.rewardMultiplier)
multiplier= 1.25× at 30-day healthy streak            (unchanged, all vendors)
standby   = vc.standbyEligible ? floor(unused × STANDBY_RATE) : 0
cap       = MAX_DAILY_SHARE of total emission          (unchanged, cross-vendor)
vesting   = vc.vestingDays == 0 ? VESTED now : PENDING until date + vestingDays
```

- Settlement writes PENDING rows for BYOK vendors; a new daily **vesting
  step** (same worker, after settlement) flips rows whose `vestAt` has
  passed to VESTED and emits the `settlement-events` message + webhook *at
  vesting time* — the game credits Claudium only for vested rows. Venice
  keeps `vestingDays = 0` (today's behavior, event at settlement).
- **Voiding**: when a provider goes INVALID (401 upstream) or is revoked
  with pending rewards, PENDING rows are marked VOIDED and never emitted.
  Voiding is logged and surfaced in admin (it is also a strong stolen-key
  signal).
- Idempotency model unchanged: ledger upserts on (providerId, date), the
  vesting flip is a guarded status transition (PENDING→VESTED only), events
  stay at-least-once with consumer dedupe.

## 7. Abuse & fraud analysis

| Attack | Mitigation |
|---|---|
| **Stolen key laundering** (attach stolen sk-…, farm, key dies) | Trust ramp (below) limits daily exposure; 7-day vesting means rewards from a key that dies young are VOIDED; INVALID-triggered voiding; admin fraud view (keys that died within vesting window, voided totals per wallet); wallet-level strikes — repeated dead keys freeze the wallet from re-registration. |
| **Fake upstream / usage minting** (point pool at own server returning fat `usage`) | Impossible by construction: vendors are an allowlist with pinned base URLs; no provider-supplied endpoints in v1. |
| **Standby farming** (declare huge budget, serve nothing) | Standby is Venice-only (`standbyEligible=false` for BYOK). Declared BYOK budget earns nothing by itself — only consumed compute pays. |
| **Self-dealing** (own game account spams NPC chat through own key) | Existing `suspicionScore` (top-account share) unchanged and now per key; game-side per-account inference quotas remain the primary throttle. |
| **Trust-ramp evasion via many wallets** | Per-IP and per-wallet registration rate limits (existing); one key per (wallet, vendor); game-account linkage means farming still requires aged game accounts. |
| **Key probing/enumeration through us** | Validation calls only after nonce+signature auth and rate limits (existing flow, unchanged). |

**Trust ramp** (config, admin-overridable per provider):

| tier | condition | effective daily routing cap |
|---|---|---|
| NEW | 0–6 healthy days | min(declared, **$2**) |
| ESTABLISHED | 7–29 healthy days | min(declared, **$25**) |
| TRUSTED | 30+ healthy days | declared |

Tier promotion happens in settlement (it already owns streak bookkeeping);
any INVALID/streak reset demotes to NEW.

## 8. API & dashboard changes

- `POST /api/providers/register` gains `vendor` (default `venice`); wallet
  signature message gains the vendor line (`Action: register\nVendor: openai\n…`)
  so a signature can't be replayed across vendors. Key-format sanity per
  vendor (`sk-`, `sk-ant-`) before the paid validation call.
- `DELETE /api/providers/:id/key` unchanged (id is already per-key).
- `GET /api/providers/by-wallet/:wallet` returns an array of keys (one per
  vendor) + aggregate totals; pending vs vested Claudium shown separately.
- Dashboard: vendor picker on the register form; one status card per
  attached key; "pending (vests <date>)" line on rewards.
- Leaderboard: unchanged ranking (lifetime $ served) + a vendor badge;
  optional per-vendor filter tab.
- Admin: per-vendor pool overview, per-vendor kill switch (`VendorConfig.enabled`
  — global kill switch unchanged), pricing table gains vendor column, model
  class map editor, fraud view (voided rewards, young-dead keys).
- Health endpoint: per-vendor provider counts + per-vendor enabled flags.

## 9. Rollout phases

**Phase 1 — framework + OpenAI-compatible vendors** (the bulk):
schema migration + adapter layer + OpenAI + Kimi adapters (shared
implementation), model classes, trust ramp, vesting, standby restriction,
register/dashboard vendor support, mock-upstream E2E for both dialects.

**Phase 2 — Anthropic**: Messages-API translation adapter (request/response
mapping, 529 handling, required max_tokens), its pricing seeds and class
mappings, translation unit tests against recorded response shapes.

**Phase 3 — polish**: per-vendor reward multiplier tuning UI, fraud-view
refinements, optional per-vendor house keys, image_gen/vision classes,
streaming (still off in v1).

Each phase ships behind `VendorConfig.enabled` — vendors flip on
independently, and a misbehaving vendor flips off without a deploy.

## 10. Testing plan

- **Adapter units** (injected fetch, per vendor): payload translation
  exactness (esp. Anthropic system/max_tokens/content-blocks), usage
  parsing, error classification tables (OpenAI `insufficient_quota` vs plain
  429; Anthropic 529 and low-balance 400), key redaction per key format.
- **Router units**: model-class filtering, cross-vendor failover order,
  trust-tier effective capacity, vendor kill switch exclusion.
- **Settlement units**: standby denied for BYOK, per-vendor multiplier,
  vesting transitions (PENDING→VESTED at date, →VOIDED on INVALID), voiding
  idempotency, cap across mixed vendors.
- **E2E**: mock upstream grows OpenAI-quota and Anthropic-dialect
  personalities; scenarios — multi-vendor registration per wallet, class
  routing lands on the right vendor+model, cross-vendor failover, stolen-key
  simulation (key dies day 2 → pending rewards VOIDED, wallet flagged),
  trust-ramp cap enforcement, vendor kill switch.
- **UI E2E**: vendor picker registration, multi-key dashboard, pending/vested
  display, admin vendor controls.

## 11. Open questions (recommended defaults chosen above)

1. Reward premium for real-money compute — launch multipliers all at 1.0×
   and tune with data, or launch BYOK at 1.25× to bootstrap supply?
   *Recommendation: 1.0×, tune later; the admin knob makes it a config change.*
2. Vesting length — 7 days balances fraud window vs provider patience.
   Shorten for TRUSTED providers later?
3. Should Venice also move to vesting for uniformity? *Recommendation: no —
   stake-backed keys don't have the stolen-key economics.*
4. Which vendor first — OpenAI (largest key population) or Kimi (cheapest
   per token)? They ship together in Phase 1 since they share an adapter.
