# Logol: the mysterious stranger cloaked in infinity

> **STATUS: DRAFT / SCAFFOLD.** The load-bearing systems (a deterministic
> weekly world-event NPC, a quest chain that unlocks his shop, a $WOC purchase
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
| **Ease** | 3/5 (on-chain payment + a voice-likeness asset + a new weekly world event) |
| **Flywheel** | Scarcity/prestige: a rarely-seen vendor selling account-bound cosmetics for $WOC |
| **Sustainability** | Sink (burns $WOC, optional treasury split) with a one-time voice-asset cost |
| **Reg risk** | Low to medium (voice likeness of a named, consenting person; cosmetic-only, no wagering) |

## What

Logol is a single, mysterious merchant who returns to the **same fixed spot
once a week**, lingers for a few days, then vanishes, the way Destiny's Xur
returns to a known place each week. He is cloaked head to toe (the "cloaked in
infinity" silhouette), speaks in a cloned voice (see Voice), and belongs to a
guild rendered only as the glyph-string `{{,,,}}` (an unpronounceable, in-world
"nameless order"; see Guild tag).

Each weekly visit he brings **new "infinity items"**: a rotating selection of
highly desired prestige cosmetics priced **solely in $WOC**, most in the
thousands of $WOC, plus one always-offered flagship (the "Cloaked in Infinity"
flair) in the hundreds of thousands. His shop does not open for a player until
they have finished a short **quest chain** that "proves they can see him."
Everyone in the world can *see* Logol during his visit; only players who
finished the chain can *trade* with him.

Two hard framings shape everything below:

- **He appears as a shared world event, not a per-player spawn.** One Logol,
  visible to everyone, present at his fixed spot for the weekly window, then
  gone. The window is a pure function of the host wall clock (see Appearance
  cadence and Determinism), so every realm, the server, and any client agree on
  when he is present without extra network state.
- **His wares are cosmetic-only.** The repo's non-negotiable invariant is
  cosmetic-only / no pay-to-win (root `CLAUDE.md`). "Weapons and gear" is
  therefore reframed as **prestige appearances**: titles and nameplate flair in
  this draft, with weapon/armor transmog and mounts as documented follow-ons
  gated on render support (see Wares and Out of scope). Nothing Logol sells
  touches a stat.

## Appearance cadence (once a week, same place)

- **Fixed spot:** `LOGOL_APPEAR_POS` (src/sim/content/logol.ts), one hand-picked
  location he always returns to. Players learn the spot; the anticipation is the
  point.
- **Weekly window:** present for the first `LOGOL_VISIT_MS` (3 days) of every
  `LOGOL_APPEAR_PERIOD_MS` (7 day) period (src/sim/logol_roam.ts). Windows are
  anchored to the Unix epoch, which lands on a Thursday, so every realm shares
  the same Thursday-to-Sunday UTC visit, Xur-style.
- **Wall-clock anchored:** the schedule reads the HOST clock through the same
  host-injected seam raid lockouts use (`SimConfig.lockoutNowMs`), NOT sim time,
  because sim time restarts at zero on every realm reboot: a sim-time week would
  reset each deploy and leave Logol nearly always present. A restart never moves
  the window. Offline and headless worlds keep the default sim-time-derived
  clock, which stays fully deterministic (and the scheduler is disabled there
  anyway, see Determinism).
- **Week index = stock index:** `logolWeekIndex(nowMs)` also selects the week's
  ware rotation (see Wares), so his stock changes exactly when he reappears.

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
completable even while Logol is away (the final step is to find him during a
weekly visit). Completing the
final step marks an account-level quest as done, which is exactly the unlock
signal (the server already persists quest turn-ins to
`accounts.cosmetics.completedQuestIds` via `markAccountQuestComplete`,
`server/game.ts`). No new unlock table is needed.

1. `q_logol_rumor` - hear the rumor: interact with the Harbinger (breadcrumb).
2. `q_logol_sign` - attune the eye: cull 6 forest wolves (the starter mob, so
   the step is completable at any level).
3. `q_logol_seen` - find Logol himself during a weekly visit and speak with him
   (an interact objective on the `logol` NPC; his gossip dialog carries the
   discussion entry), then return to the Harbinger. On turn-in the account is
   marked as having completed `q_logol_seen`, and Logol's shop is open to that
   player from then on.

Each step has a distinct objective signature (the quest-dedup guard,
`tests/quest_repeat_repro.test.ts`, rejects same-giver duplicates). Quest text,
giver placement, and rewards still want a content pass (see TODOs); the chain's
*shape* and its unlock semantics are the load-bearing part.

## Wares (cosmetic-only)

Wares are data-as-code (`src/sim/content/logol.ts`, `LOGOL_WARES`) and
account-bound: a purchase is granted to `AccountCosmetics.logolWareIds`, so it
follows the player across characters (the same account-level model as mech
chromas and event skins). Each ware has a stable `id`, a `kind`, a **per-ware**
$WOC `priceWoc`, and a `rarity`.

**Pricing bands:** every rotating ware is priced in the **thousands** of $WOC
(5,000 to 40,000 in this draft), and exactly one flagship, the legendary
"Cloaked in Infinity" flair, sits in the **hundreds of thousands** (250,000).
The bands are pinned by `tests/logol_content.test.ts`; the exact numbers are
placeholders pending a tokenomics pass.

**Weekly rotation ("new infinity items"):** each visit offers the flagship plus
`LOGOL_ROTATION_SIZE` (3) wares from the rest of the pool, selected by
`logolOfferedWares(weekIndex)`, a pure function of the same week index that
drives his appearance, so the stock changes exactly when he returns. The
rotation walks the pool cyclically: every ware is offered within one full cycle
(pinned by tests), nothing is permanently unobtainable.

This draft ships two ware kinds that need **no new render system**:

- **`title`** - a prestige title shown with the character (text only, zero
  render work). Example: "the Unseen", "Ledger-Marked".
- **`flair`** - nameplate adornments, riding the existing holder-flair /
  nameplate presentation path; the flagship "Cloaked in Infinity" is one.

Two further kinds are defined in the catalog **type** but intentionally carry no
entries yet, because they require concurrent render work and are out of scope for
this draft (documented so the catalog is honestly extensible, not silently
capped):

- **`transmog`** - weapon/armor *appearance* overrides. Blocked on a transmog
  render system, which does not exist yet.
- **`mount`** - a cosmetic mount. Blocked on a mount cosmetic + render system,
  which does not exist yet.

## Purchase flow (reuses the shared $WOC core)

No new payment machinery. The generic, asset-agnostic core the `voice-npc` /
ad-marketplace features already established is ported into this branch
(`server/solana_tx.ts`, `server/woc_payment.ts`, `server/woc_config.ts`), and a
quote-then-confirm ledger (`woc_quotes` / `woc_payments`) backs it, exactly like
the identity and voice-npc flows. Prices come from the ware catalog
(`ware.priceWoc` converted via `wocToBase`), not an env knob.

- `GET  /api/logol/info` - authed: `{ enabled, unlocked, unlockQuestId,
  present, weekIndex, nextChangeAt, wares }` plus mint/decimals, where `wares`
  is THIS WEEK's offer (flagship + rotation, each with its own price) and
  `unlocked` is per-account (has the caller finished the chain).
- `POST /api/logol/quote` - authed, wallet-required, shop-unlocked: creates a
  single-use `woc_quote` (`kind='logol'`) for one ware; returns the quoteId (the
  on-chain memo), the ware's amount in base units, burn/treasury split, and the
  payer. Refused while Logol is away (`logol_away`), for a ware outside this
  week's rotation (`not_offered_this_week`), or for an already-owned ware
  (`already_owned`).
- `POST /api/logol/confirm` - authed: verifies the finalized on-chain payment
  via `verifyWocPayment(signature, payer, priceBase, quoteId)` against the
  QUOTE's stored price (so a catalog re-tune can never mismatch an in-flight
  purchase), records it in `woc_payments` (the `tx_sig UNIQUE` replay guard),
  grants the ware to the account, and deletes the quote. A week rollover during
  the 15 minute quote TTL does not invalidate the purchase.
- `GET  /api/logol/inventory` - authed: the wares this account owns (from any
  past week's rotation).

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
`CLAUDE.md`). Logol's weekly appearance honors this without perturbing the
shared RNG stream (which would fork every existing golden/parity trace):

- **Presence is a pure function of the injected host clock.** The tick passes
  `cfg.lockoutNowMs()` (the same host-injected wall-clock seam raid lockouts
  use; the sim itself never calls `Date.now`) into `logolPresent(nowMs)`:
  present while `nowMs % APPEAR_PERIOD_MS < VISIT_MS`. No `ctx.rng` calls are
  added to the per-tick path, so the draw order is untouched. Offline worlds
  keep `lockoutNowMs`'s default sim-time-derived clock, which is fully
  deterministic.
- **The scheduler is gated by a Sim construction flag** (`SimConfig.logolEnabled`,
  default false, like `worldBossAtBoot`). Offline worlds, headless RL, and every
  parity trace leave it unset, so the roam code never runs in them and cannot
  shift a single existing trace. The authoritative server sets it from
  `LOGOL_ENABLED`.
- **Runtime state is two nullable ids** (the live Logol entity and the
  persistent Harbinger) kept on `Sim`, reconciled each tick against the
  clock-derived "should be present" boolean: spawn when he should appear and is
  absent, despawn when the window ends. He stands at his fixed spot (no per-tick
  rng wander).

## Constraints (non-negotiable)

- **Cosmetic-only / no pay-to-win.** Every ware is an appearance. No ware grants
  or scales a stat, and this is the reason mounts/transmog wait for a render
  system rather than shipping as "gear."
- **Non-custodial.** The purchase is the player's own signed on-chain
  transaction; the server only verifies the finalized payment, never holds keys.
- **`src/sim/` stays deterministic and string-agnostic.** The appearance uses
  only the injected clock; player-facing text is emitted English and localized
  at the client boundary (`sim_i18n.ts`), like all sim content.

## TODO before this can be enabled in production

- **Prices.** Per-ware `priceWoc` values (5k to 40k, flagship 250k) satisfy the
  intended bands but have had **no tokenomics review**: weigh them against $WOC
  market price and circulating supply before mainnet.
- **Voice asset + consent.** Generate the Logan Golema clone and line clips, and
  put the likeness-consent record on file, before `LOGOL_ENABLED=true`.
- **Quest design.** Giver placement, objective targets, text, and rewards for
  the "Seen and Unseen" chain are placeholders pending a content pass.
- **Cadence tuning.** The 3-day visit inside the 7-day period and the fixed
  `LOGOL_APPEAR_POS` spot are first-pass choices; they want a play-feel pass
  (how long he lingers, which scenic spot he claims).
- **Ware art.** Final flair/title copy and the flair render treatment are
  unresolved; the catalog will also want more entries so the weekly rotation
  breathes (5 rotating wares cycle in under two months).
- **Client shop polish.** The shop panel is an explicitly WIP scaffold (see
  Out of scope), not a classic-fidelity HUD window.

## Open questions

- Should price scale with the $WOC market price over time, or stay a fixed token
  amount?
- Should past-week wares ever return at a premium ("Logol remembers you looked"),
  or is the cyclic rotation enough?
- Should completing the chain also grant a one-time "first sighting" cosmetic, or
  only open the shop?

## Out of scope (this PR)

- The client shop panel. The full server API (`/api/logol/info|quote|confirm|
  inventory`) is complete and unit-testable in this draft, but the in-HUD shop
  window (and the gossip-dialog "browse wares" hook when interacting with
  visiting Logol) is deliberately deferred to a follow-up, the way `voice-npc` shipped its
  backend ahead of a polished HUD window. It is a thin fetch panel over the
  existing API plus a bearer token, no new server surface.
- Weapon/armor transmog and cosmetic mounts as wares (blocked on render
  systems that do not exist yet).
- Client-side on-chain burn-transaction signing (the panel wires quote/confirm
  HTTP but does not build/sign the Solana burn tx; this repo has no client-side
  Solana tx builder to extend, same deliberate deferral as `voice-npc`).
- The final voice/art assets.
- Any production enablement: `LOGOL_ENABLED` stays `false`.
