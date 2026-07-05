# Logol: the mysterious stranger cloaked in infinity

> **STATUS: DRAFT / SCAFFOLD.** The load-bearing systems (a deterministic
> roaming world-event NPC, a quest chain that unlocks his shop, a $WOC purchase
> flow reusing the shared on-chain payment core, and an account-level cosmetic
> grant) are wired and unit-tested, but the feature ships **OFF**
> (`LOGOL_ENABLED=false` by default). The voice clone, the final ware art, the
> tokenomics, and the client shop polish are explicit gates called out below,
> not formalities. This mirrors the `voice-npc` draft's bar
> (`docs/prd/woc/voice-npc.md`): a technically sound, gated scaffold, not a
> shipped feature.

| | |
|---|---|
| **Tier** | 2 - Prestige cosmetic sink |
| **Ease** | 3/5 (on-chain payment + a voice-likeness asset + a new roaming world event) |
| **Flywheel** | Scarcity/prestige: a rarely-seen vendor selling account-bound cosmetics for $WOC |
| **Sustainability** | Sink (burns $WOC, optional treasury split) with a one-time voice-asset cost |
| **Reg risk** | Low to medium (voice likeness of a named, consenting person; cosmetic-only, no wagering) |

## What

Logol is a single, mysterious merchant who appears at unpredictable places
around the realm for short windows, then vanishes, the way Destiny's Xur or
Resident Evil 4's Merchant do. He is cloaked head to toe (the "cloaked in
infinity" silhouette), speaks in a cloned voice (see Voice), and belongs to a
guild rendered only as the glyph-string `{{,,,}}` (an unpronounceable, in-world
"nameless order"; see Guild tag).

He sells a small, rotating set of **highly desired prestige cosmetics** priced
**solely in $WOC**. His shop does not open for a player until they have finished
a short **quest chain** that "proves they can see him." Everyone in the world can
*see* Logol roaming; only players who finished the chain can *trade* with him.

Two hard framings shape everything below:

- **He roams as a shared world event, not a per-player spawn.** One Logol,
  visible to everyone, present at a pseudo-random point-of-interest for a window,
  then gone. Deterministic (see Determinism), so every client and the server
  agree on where he is without extra network state.
- **His wares are cosmetic-only.** The repo's non-negotiable invariant is
  cosmetic-only / no pay-to-win (root `CLAUDE.md`). "Weapons and gear" is
  therefore reframed as **prestige appearances**: titles and a signature
  "cloaked in infinity" nameplate flair in this draft, with weapon/armor
  transmog and mounts as documented follow-ons gated on render support (see
  Wares and Out of scope). Nothing Logol sells touches a stat.

## Why it is a flywheel

Scarcity plus prestige. A vendor you rarely catch, who only opens after a quest,
selling account-bound cosmetics you cannot get any other way, is a strong
"drop what you are doing and go" moment and a clean $WOC sink with zero gameplay
power. The burn is deflationary; an optional treasury split can fund the voice
and art costs. Unvalidated: this PRD asserts the pipeline is sound to build and
gate, not that demand is proven.

## Lore and characterization

- **Name:** Logol. A palindromic near-miss, deliberately odd, like a word that
  loops back on itself.
- **Guild:** `{{,,,}}` (see Guild tag). Displayed as his `<title>` under his
  name in the gossip frame. It reads as a nameless order rather than a word.
- **Silhouette:** fully cloaked, face obscured (the reference art is the RE4
  Merchant). "Cloaked in infinity" is the flavor hook and the name of his
  signature flair ware.
- **Cadence:** he greets, he offers, he leaves. He never explains where he goes.
  Dialogue is sparse and a little knowing (the Xur register).

## The unlock quest chain ("Seen and Unseen")

A three-step chain given by a fixed lore NPC, the **Harbinger of the Nameless
Order** (`logol_harbinger`), placed at a starting-zone hub so it is always
completable (you do not have to catch roaming Logol to start). Completing the
final step marks an account-level quest as done, which is exactly the unlock
signal (the server already persists quest turn-ins to
`accounts.cosmetics.completedQuestIds` via `markAccountQuestComplete`,
`server/game.ts`). No new unlock table is needed.

1. `q_logol_rumor` - hear the rumor, interact with the Harbinger (breadcrumb).
2. `q_logol_sign` - collect a token that "attunes your eye" (a collect
   objective against an existing low-level drop, tuned later).
3. `q_logol_seen` - return to the Harbinger; on turn-in the account is marked
   as having completed `q_logol_seen`, and Logol's shop is now open to that
   player wherever they next meet him.

Quest text, giver placement, objective targets, and rewards are placeholders in
this draft (see TODOs); the chain's *shape* and its unlock semantics are the
load-bearing part.

## Wares (cosmetic-only)

Wares are data-as-code (`src/sim/content/logol.ts`, `LOGOL_WARES`) and
account-bound: a purchase is granted to `AccountCosmetics.logolWareIds`, so it
follows the player across characters (the same account-level model as mech
chromas and event skins). Each ware has a stable `id`, a `kind`, a $WOC
`priceWoc`, and a `rarity`. This draft ships two ware kinds that need **no new
render system**:

- **`title`** - a prestige title shown with the character (text only, zero
  render work). Example: "the Unseen", "Ledger-Marked".
- **`flair`** - the signature "Cloaked in Infinity" nameplate adornment, riding
  the existing holder-flair / nameplate presentation path.

Two further kinds are defined in the catalog **type** but intentionally carry no
entries yet, because they require concurrent render work and are out of scope for
this draft (documented so the catalog is honestly extensible, not silently
capped):

- **`transmog`** - weapon/armor *appearance* overrides. Blocked on a transmog
  render system, which does not exist yet.
- **`mount`** - a cosmetic mount. Blocked on a mount cosmetic + render system,
  which does not exist yet.

Ware selection is a small, tunable rotation; the initial draft exposes the full
catalog and leaves rotation logic as a follow-up.

## Purchase flow (reuses the shared $WOC core)

No new payment machinery. The generic, asset-agnostic core the `voice-npc` /
ad-marketplace features already established is ported into this branch
(`server/solana_tx.ts`, `server/woc_payment.ts`, `server/woc_config.ts`,
trimmed to Logol's price key), and a quote-then-confirm ledger
(`woc_quotes` / `woc_payments`) backs it, exactly like the identity and
voice-npc flows.

- `GET  /api/logol/info` - public: `{ enabled, unlocked, priceless catalog }`
  plus mint/decimals. `unlocked` is per-account (has the caller finished the
  chain).
- `POST /api/logol/quote` - authed, wallet-required, shop-unlocked: creates a
  single-use `woc_quote` (`kind='logol'`) for one ware; returns the quoteId (the
  on-chain memo), amount in base units, burn/treasury split, and the payer.
- `POST /api/logol/confirm` - authed: verifies the finalized on-chain payment
  via `verifyWocPayment(signature, payer, priceBase, quoteId)`, records it in
  `woc_payments` (the `tx_sig UNIQUE` replay guard), grants the ware to the
  account, and deletes the quote.
- `GET  /api/logol/inventory` - authed: the wares this account owns.

Burn vs. treasury is config-only (`WOC_BURN_BPS`, `WOC_TREASURY`): default 100%
burn; set a bps < 10000 plus a treasury address to split (e.g. the aldrin-club
50/50 burn-and-fund model). `verifyWocPayment` enforces both legs.

## Voice (cloned from Logan Golema)

Logol's in-game voice is a **fixed, developer-authored** clone of Logan Golema
via the ElevenLabs voice-clone API, produced **once** as a build/deploy asset,
not cloned at runtime per player. This is the key difference from `voice-npc`
(which clones each player's own voice live): Logol has one voice, one set of
lines, generated ahead of time and served as static audio.

- A one-time dev script (`scripts/logol_voice_gen.mjs`) clones the consented
  Logan Golema sample into a voice id and synthesizes Logol's fixed line set
  (greeting, offer, purchase-accept, farewell) to
  `public/audio/logol/<line>.mp3`. The script is a documented dev step; it needs
  `ELEVENLABS_API_KEY` and does nothing without it.
- The client plays those clips through the same runtime-clip mechanism
  `voice-npc` added (`Entity.npcVoiceClipBaseUrl` + a `playUrl`-style helper).
  Logol's spawned entity carries a fixed `npcVoiceClipBaseUrl` of
  `/audio/logol`.
- **Consent / likeness:** Logan Golema is a named, consenting person (the
  project owner). The consent record and any ElevenLabs ToS obligations for a
  named-person clone are a sign-off gate before enabling in production; the
  sample and generated clips are committed assets, not user UGC, so the
  moderation surface is nil, but the likeness consent must be on file.

## Guild tag `{{,,,}}`

Rendered verbatim as Logol's title/guild string. It is deliberately not a word:
a glyph-string standing for a nameless order. It is developer-authored content
(not player UGC), so it flows through the normal entity-name i18n source
(`src/ui/world_entity_i18n.ts`) as a fixed English/symbol string and is not
translated (symbols, like brand strings, stay identical across locales).

## Determinism (non-negotiable)

`src/sim/` is a deterministic 20 Hz core: same seed, same world, all randomness
through `Rng`, never `Math.random`/`Date.now`/`performance.now` (root
`CLAUDE.md`). Logol's roaming honors this without perturbing the shared RNG
stream (which would fork every existing golden/parity trace):

- **Presence and location are a pure function of the sim clock.** Given the
  shared `ctx.time`, `windowIndex = floor(time / APPEAR_PERIOD)`; Logol is
  present for the first `VISIT_DURATION` of each window, at a point-of-interest
  chosen by the stateless `hash2(windowIndex, ...)` (a pure hash, it does **not**
  advance the shared mulberry32 stream). No `ctx.rng.next()` calls are added to
  the per-tick path, so the draw order is untouched.
- **The scheduler is gated by a Sim construction flag** (`SimConfig.logolEnabled`,
  default false, like `worldBossAtBoot`). Offline worlds, headless RL, and every
  parity trace leave it unset, so the roam code never runs in them and cannot
  shift a single existing trace. The authoritative server sets it from
  `LOGOL_ENABLED`.
- **Runtime state is a single nullable id** (the live Logol entity) kept on
  `Sim`, reconciled each tick against the clock-derived "should be present"
  boolean: spawn when he should appear and is absent, despawn when the window
  ends. He stands at his POI (no per-tick rng wander).

## Constraints (non-negotiable)

- **Cosmetic-only / no pay-to-win.** Every ware is an appearance. No ware grants
  or scales a stat, and this is the reason mounts/transmog wait for a render
  system rather than shipping as "gear."
- **Non-custodial.** The purchase is the player's own signed on-chain
  transaction; the server only verifies the finalized payment, never holds keys.
- **`src/sim/` stays deterministic and string-agnostic.** Roaming uses only the
  clock + `hash2`; player-facing text is emitted English and localized at the
  client boundary (`sim_i18n.ts`), like all sim content.

## TODO before this can be enabled in production

- **Burn price.** `WOC_PRICE_LOGOL` is a placeholder in `server/woc_config.ts`
  with **no tokenomics review**. Per-ware pricing (a title should not cost what a
  mount would) is a follow-up; this draft prices the whole catalog off one key.
- **Voice asset + consent.** Generate the Logan Golema clone and line clips, and
  put the likeness-consent record on file, before `LOGOL_ENABLED=true`.
- **Quest design.** Giver placement, objective targets, text, and rewards for
  the "Seen and Unseen" chain are placeholders pending a content pass.
- **Roaming tuning.** `APPEAR_PERIOD`, `VISIT_DURATION`, and the POI list are
  first-pass numbers; they want a play-feel pass (how often, how long, where).
- **Ware art + rotation.** Final flair/title copy and a rotation policy (is the
  whole catalog always available, or a weekly subset?) are unresolved.
- **Client shop polish.** The shop panel is an explicitly WIP scaffold (see
  Out of scope), not a classic-fidelity HUD window.

## Open questions

- Should the shop be a rotating subset per window (more Xur-like scarcity) or the
  full catalog whenever you catch him?
- Should price scale with the $WOC market price over time, or stay a fixed token
  amount?
- Does Logol's roaming want to be zone-gated (only in leveled zones) or truly
  world-wide?
- Should completing the chain also grant a one-time "first sighting" cosmetic, or
  only open the shop?

## Out of scope (this PR)

- The client shop panel. The full server API (`/api/logol/info|quote|confirm|
  inventory`) is complete and unit-testable in this draft, but the in-HUD shop
  window (and the gossip-dialog "browse wares" hook when interacting with roaming
  Logol) is deliberately deferred to a follow-up, the way `voice-npc` shipped its
  backend ahead of a polished HUD window. It is a thin fetch panel over the
  existing API plus a bearer token, no new server surface.
- Weapon/armor transmog and cosmetic mounts as wares (blocked on render
  systems that do not exist yet).
- Client-side on-chain burn-transaction signing (the panel wires quote/confirm
  HTTP but does not build/sign the Solana burn tx; this repo has no client-side
  Solana tx builder to extend, same deliberate deferral as `voice-npc`).
- Ware rotation logic, per-ware pricing, and the final voice/art assets.
- Any production enablement: `LOGOL_ENABLED` stays `false`.
