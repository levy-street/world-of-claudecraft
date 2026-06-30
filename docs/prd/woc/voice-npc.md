# Voice NPC: burn $WOC for an NPC with your own voice

> **STATUS: DRAFT/SCAFFOLD.** The end-to-end pipeline (burn quote/confirm, async
> ElevenLabs voice clone + line synthesis, dynamic in-game NPC spawn, a minimal
> client entry point) is wired and unit-tested, but the feature ships **OFF**
> (`VOICE_NPC_ENABLED=false` by default) pending product, legal, and tokenomics
> sign-off called out below. Treat every TODO in this doc and in code as a real
> gate, not a formality.

| | |
|---|---|
| **Tier** | 2 - Novelty sink |
| **Ease** | 2/5 (third-party API dependency + content moderation surface) |
| **Flywheel** | Speculative - novelty/identity, not yet validated |
| **Sustainability** | Sink (burns $WOC) plus a recurring real-dollar cost (ElevenLabs) |
| **Reg risk** | Medium - biometric-adjacent voice data + AI-generated likeness |

## What
A player burns a fixed amount of $WOC, records a short voice sample in-browser,
and the game clones that voice via the ElevenLabs API. The cloned voice then
speaks a small, fixed set of dialogue lines (a greeting plus a one-step quest's
offer/complete text) as a small dynamic quest NPC ("Echo") that spawns near the
player in the game world.

## Why it's a flywheel (speculative)
A novelty identity sink: hearing your own voice (or a friend's) in the game
world is a strong, shareable moment, and the $WOC burn is a clean deflationary
sink with zero gameplay power. Unvalidated: this PRD does not assert demand,
only that the pipeline is technically sound to build and gate.

## Implemented behavior (this PR)
- **$WOC burn core**, generic and reusable, ported from the ad-marketplace PR's
  shared core: `server/solana_tx.ts` (raw Solana JSON-RPC tx verification),
  `server/woc_config.ts` (mint/RPC/decimals/burn-split config, trimmed to this
  feature's price key), `server/woc_payment.ts` (`verifyWocPayment`). A
  `woc_quotes`/`woc_payments` ledger in `server/db.ts` backs a quote-then-confirm
  flow, mirroring `server/identity.ts`'s pattern from the ad-marketplace PR.
- **`voice_npc_grants`** (`server/db.ts` DDL, `server/voice_npc_db.ts` queries):
  one row per account, walking `pending_sample -> pending_clone -> cloning ->
  generating -> ready -> failed`. Tracks the player's chosen display name, the
  recorded sample path, the ElevenLabs voice id, the resulting line-clip URLs,
  and an explicit `consent_at` timestamp (null until the player consents).
- **`server/voice_npc_keeper.ts`**: an async keeper (same constructor-injected
  executor/store split as `wt-skins/server/burn_keeper.ts`) that polls for
  `pending_clone` grants (clones the voice via ElevenLabs Instant Voice
  Cloning), then `generating` grants (synthesizes the fixed line set via
  ElevenLabs TTS, writes mp3s under `public/audio/voice_npc/<accountId>/`).
  Falls back to a console-logging stub executor when `ELEVENLABS_API_KEY` or
  `VOICE_NPC_ENABLED` is absent, so local dev never needs real credentials
  (mirrors `server/email/sender.ts`'s `ConsoleSender`/`HttpSender` split).
- **`server/voice_npc.ts`**: the HTTP surface (`GET /api/voice-npc/info`,
  `POST /api/voice-npc/sample`, `POST /api/voice-npc/quote`,
  `POST /api/voice-npc/confirm`, `GET /api/voice-npc/status`), modeled on
  `server/identity.ts`.
- **Sim content**: a static `NpcDef` (`voice_echo_npc`) and a one-step
  `QuestDef` (`q_echo_of_you`) in `src/sim/content/voice_npc.ts`, registered in
  `src/sim/data.ts` like every other zone's content. `src/sim/voice_npc_spawn.ts`
  spawns one per grant near the player (mirrors
  `src/sim/encounters/nythraxis.ts`'s `spawnNythraxisAldric`), with the
  player-chosen display name and per-player audio URL applied as runtime-only
  `Entity` overrides (`npcNameOverride`/`npcVoiceClipBaseUrl`), never baked into
  the shared static def. The grant fires once per character on login
  (`server/game.ts`'s `checkVoiceNpcGrant`), gated by an atomic
  `applied_at` claim so a reconnect or restart can never spawn it twice.
- **Client**: `src/game/voice.ts` gained `playUrl()` for playing a
  runtime-generated clip outside the build-time manifest. A new, explicitly WIP
  `src/ui/voice_npc_panel.ts` provides a minimal record-consent-burn entry
  point (mic capture via `MediaRecorder`, consent checkbox, display-name field,
  the quote/confirm flow, and a status poll), launched from a floating button
  during an online session. **Not** a classic-fidelity HUD window; that is an
  explicit follow-up (see below).

## TODO before this can ever be enabled in production
- **Burn price.** `WOC_PRICE_VOICE_NPC` defaults to a placeholder `25000` $WOC
  in `server/woc_config.ts`. This number has had **no tokenomics review**: it
  needs to weigh the real ElevenLabs cost-per-clone against the deflationary
  intent and what a player would actually pay for this novelty before any
  number ships.
- **ElevenLabs cost.** This is a **paid third-party API** with real
  per-character (TTS) and per-clone (Instant Voice Cloning) billing on
  whichever ElevenLabs plan is configured. The feature must stay
  `VOICE_NPC_ENABLED=false` until someone signs off on the expected volume and
  monthly cost; nothing in this PR estimates that cost.
- **Consent / ToS.** A player must explicitly consent (`consent === true`,
  enforced server-side, no implicit consent) before any sample is accepted, but
  the actual consent COPY shown in `src/ui/voice_npc_panel.ts` and the broader
  ToS/privacy-policy implications of cloning a player's voice (and potentially
  someone else's voice, recorded without their knowledge) have **not** had a
  legal review pass. Do not enable this feature in production before that
  review lands. Sample retention/deletion policy is also unresolved (see the
  TODO in `server/voice_npc.ts`).
- **Zone/quest placement.** `voice_echo_npc` spawns near the player wherever
  they happen to be (no fixed zone placement, no real quest design pass on the
  "Echo of You" quest's text/rewards). Placement and quest content are
  deliberately left as a placeholder pending a product decision.

## Constraints (non-negotiable)
- **Cosmetic-only / no pay-to-win** - the voice NPC and its dialogue are
  flavor; the quest reward is modest (no item reward) and grants no power.
- **Non-custodial** - the burn is the player's own signed transaction; the
  server only verifies the finalized on-chain payment, never holds keys.
- **`src/sim/` stays deterministic** - the dynamic NPC spawn uses only
  `ctx.rng`/`ctx.groundPos`, never `Math.random`/`Date.now`/`performance.now`.

## Open questions
- Final burn price and whether it should scale with $WOC market price over time.
- Does the consent flow need an explicit "this clip is being sent to a
  third-party AI service" disclosure beyond the checkbox copy in this draft?
- Should a player be able to re-record (replacing a previous clone), and if so,
  does the old ElevenLabs voice need to be explicitly deleted from ElevenLabs's
  side, not just orphaned?
- Content moderation: what stops a player from recording someone else's voice,
  or naming their NPC something abusive? `npc_display_name` and the sample
  audio are explicitly out of `t()`/i18n scope as player-submitted UGC (see
  `src/sim/content/CLAUDE.md`'s `GROUND_PICKUP_LINES` precedent for the pattern),
  but that does not mean unmoderated; a moderation pass is a follow-up.
- Final zone/quest placement, and whether "Echo" should be a one-time quest NPC
  or a persistent companion-style feature.

## Out of scope (this PR)
- A polished, classic-fidelity HUD window for the record/burn flow (the
  current `src/ui/voice_npc_panel.ts` is a minimal, explicitly WIP scaffold).
- Content moderation on player-submitted display names or audio samples.
- Any production enablement: `VOICE_NPC_ENABLED` stays `false` until the
  product/legal/tokenomics TODOs above are resolved.
- Client-side on-chain burn-transaction signing. This draft wires the quote and
  confirm HTTP calls but does not build or sign the actual Solana burn
  transaction (see the `TODO(wallet)` in `src/ui/voice_npc_panel.ts`); this
  repo has no existing client-side Solana transaction builder to extend, and
  adding one (or hand-building the instruction bytes) is left as a deliberate
  follow-up rather than a rushed, unverified signer.
