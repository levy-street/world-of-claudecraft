# Graphics and performance settings are gameplay-neutral

Status: principle adopted and FULLY enforced. The HUD effect tiers shipped in
frontend-modernization v0.16.0 (P14a + the 2026-06-26 fairness re-audit), and the one
remaining wire-fidelity gap (negative-value stat-sap auras reading as buffs online) was
closed in commit `a15c910c` (see "Resolved" below). No graphics or performance preset can
hide actionable information.

## The principle

A player's graphics / performance preset must never give them a competitive ADVANTAGE or a
DISADVANTAGE. The simulation is identical for every client (the server is authoritative; the
client is a renderer), so two players on different presets must have the same information to
act on. A graphics tier may shed COSMETIC richness; it must never change ACTIONABLE
information.

ACTIONABLE (must be identical across every tier; never tiered):
- Your own debuffs. You must see a DoT, curse, CC, or move-out mechanic to react, and there
  is no self-dispel, so the aura icon is the only read.
- Party / raid member HP. A healer reacts to it directly.
- The target / boss cast bar. Interrupt timing depends on it.
- Target HP at a usable granularity (execute thresholds, is-it-dead).
- Enemy / aggro positions a player acts on.
- The fishing bobber and its bite state. The reel window is a timed reaction; the bite
  affordance must read identically on every preset (splash richness may vary, the state
  may not).
- The minimap and zone-map gather-node markers: spotting, the per-viewer ready/cooldown
  state, and the lock strike (the non-hue lock cue), plus the node tooltip's respawn
  countdown and fine-grade preview lines. Both surfaces (`minimap_markers` /
  `minimap_painter` and `map_window_view` / `map_window_painter`) are pinned
  profile-free by `tests/professions_graphics_fairness.test.ts`.
- The node prop tier ladder in the 3D world (`nodeTierScale`): tier is actionable
  information expressed as SIZE, static on every preset.

COSMETIC (may be tiered down on lower presets):
- Floating combat text volume and lifetime (the live-floater cap and how long each number
  lingers). The damage itself is server-resolved and the HP bars and combat log carry the
  numbers too. NOTE: the numbers themselves are NOT dropped. Refusing non-crit damage numbers
  on low used to hide the player's own hits on their target, their primary combat feedback, so
  low still spawns every floater and sheds cost only through the bounded pool.
- Minimap redraw smoothness. It is a coarse overview; the 3D world and nameplates carry the
  same signal at full rate.
- Buff-icon overflow when the bar is full. A buff is active whether or not its icon is on
  screen, so hiding a buff icon removes no actionable information.
- Portrait and HP-bar redraw smoothness within human reaction tolerance (about 200 ms).
- Weapon-skin VFX richness (`src/render/weapon_vfx_shed_core.ts`). The rarity rig on a
  VFX-bearing weapon skin (glow, motes, aurora, shell, cast light) FADES on two inputs.
  Neither reaches zero: what removes a rig is the character LOD swap, which replaces the whole
  articulated rig with one baked mesh and is shared by the entire render path. The fade exists
  so that removal is not a pop.
  - VIEWER DISTANCE, measured against `CHARACTER_LOD_RANGE_SQ`, the articulated-rig range
    BEFORE the crowd and per-tier factors scale it. Deliberately that fixed constant and not
    the live band edge: the live edge reads a per-client, per-frame count of visible rigs, so
    a fade keyed to it would pulse as unrelated players wander past a viewer's frustum and
    would differ between two viewers standing in the same spot. Against the constant this arm
    is identical for every player on every preset.
  - The frame-budget governor's `vfx` bucket, the same lever the pooled particle cloud and the
    ability VFX already answer to, floored at `WEAPON_VFX_GOVERNOR_FLOOR`. It is the one input
    that differs between two players looking at the same wearer, and it can only dim.
  What is faded is decoration ON a weapon. The wearer, their nameplate, their cast bar, their
  auras, their position and the weapon model itself are untouched at every scale.
- The deed border accent's decorative bloom (the Book of Deeds border rewards worn in-world).
  The accent is IDENTITY: it encodes no health, range, rank, or threat, so it may never be
  hidden, but its outer glow is pure richness. The identity arms are tier-invariant by
  construction: the nameplate cartouche is canvas shapes resolved from entity state on the
  same cadence as the title text (no tier input on the accent path, pinned by the path scan
  in `tests/deed_border_accent.test.ts`), and the portrait ring's frame border, edge outline,
  and inset shadow never read a tier token (pinned by the CSS arm of the same suite). The ONE
  tier-scaled quantity is the ring's outer box-shadow bloom, which rides `--fx-shadow` (0 at
  low) exactly like the sibling portrait combat glow. The ring also repaints on the existing
  low-tier target-frame body throttle (about 10 Hz, target swap bypasses), a redraw-smoothness
  shed this list already sanctions for the portrait.

The test for any new tier knob: if a knob hides or delays something a player READS AND REACTS
TO, it is not allowed. If it only reduces visual richness or redraw smoothness, it is fine.

## Current implementation (frontend-modernization v0.16.0)

The HUD effect tier is the player's STATIC graphics preset (`data-fx-level`, resolved by
`src/game/ui_effects_profile.ts`), never the FPS auto-governor. Per-element knobs live in
`src/game/ui_tier_knobs.ts`. Only the `low` tier sheds; medium / high / ultra are
byte-equivalent to pre-tiering.

What each knob does, and why it is gameplay-neutral:

- FCT (floating combat text), `src/ui/fct_painter.ts`: on low, caps live floaters
  (`fctMaxConcurrent`) and shortens their lifetime (`fctTtlScale`), so a burst sheds sooner.
  Every floater is still spawned on every tier, including the player's own non-crit hits, so no
  damage number is ever hidden. The only crit knob left is the CSS crit-emphasis gate
  (`[data-fx-level="low"] .fct.crit`), which keeps the number and drops only the scale/pop.
  Cosmetic: server-authoritative damage is unchanged and the HP bars and combat log also carry
  the numbers.
- Minimap, `src/ui/minimap_painter.ts` + the hud cadence gate: on low, redraws at about 4 Hz
  instead of 10 Hz. Cosmetic: the minimap never draws enemy players (only PvE aggro mobs and
  allies), and the same aggro signal is full-rate in the 3D world and on nameplates.
- Auras, `src/ui/auras_painter.ts`: on low, the visible-count cap is DEBUFF-PRIORITY. The
  player's own buff bar (`createAurasView('buffs')`) and debuff bar (`createAurasView('debuffs')`)
  are two separate view instances; the cap sheds BUFF overflow only
  (`if (!s.isDebuff && rendered >= cap) continue`), so a debuff is never culled. Full tiers are
  byte-identical (cap is +Infinity). The player's OWN buff and debuff bars are never tier-gated:
  they repaint every frame on every preset, because your own debuffs are the ACTIONABLE read
  named above. The TARGET's (non-self) debuffs strip (`createAurasView('all')`, which
  interleaves buffs and debuffs in sim-application order) is likewise never tier-gated: it can
  carry a purgeable buff, an allied maintained buff, or a group-coordinated foreign debuff that a
  player reacts to, so it repaints every frame on every preset just like the player's own bars.
- Target frame, hud + `unit_frame_painter.ts`: on low, the target frame BODY (HP / level /
  portrait) refreshes at about 10 Hz; a target SWAP bypasses the throttle
  (`nonSelfRepaintDue`), and the cast bar and the debuffs strip are both painted OUTSIDE the
  throttle (full rate, so interrupt timing and target aura reads are never degraded). Cosmetic:
  100 ms is below the reaction loop and target HP is a coarse read.
- Party frames: deliberately NOT tiered. Party-member HP is a healer's only actionable signal,
  so it stays on the 4 Hz mediumHud band for EVERY tier. (An earlier draft throttled it to
  2 Hz on low; the re-audit removed that. The perf win was illusory anyway, because
  `updatePartyFrames` already short-circuits an unchanged party via its HP-bearing signature.)

### The 2026-06-26 fairness re-audit

A senior re-audit (a five-dimension adversarial review plus a coverage reviewer) found that the
original P14a, while correct and spec-compliant, had drafted two gameplay-relevant sheds. Both
were fixed:

1. The aura cap was a flat first-N cap that could hide a player debuff past slot 8 on low while
   every other tier showed it. Now debuff-priority (never culls a debuff).
2. The party-frame 2 Hz throttle delayed a healer's HP reaction on the preset large-raid players
   pick. Removed; party HP is full-rate on every tier.

Commits on `feature/frontend-modernization-v016`: `8aba739d` (aura debuff-priority cap),
`ae619faf` (party full-rate + the `nonSelfRepaintDue` swap-bypass), `82721b18` (minimap token
cache), `119b47fa` (FCT drop-kind uniformity test), `4915b6b7` (docs).

### The world map's open-sea limit (2026-08-03)

Not a graphics-preset shed, but the same question asked of a MAP read, and the answer landed
somewhere worth recording: the map now marks the swim-fatigue limit LESS than it used to, on
purpose.

The zone map used to colour water with two palettes a stark distance apart, split by the sim's
swim-fatigue predicate (`inHollowOpenSea`): safe water light, the lethal open sea near-navy.
That predicate is a rectangle test, so the two met at a hard straight step through open water
and the map read as a lighter box pasted on a flat sea. The sea is now one shallow-to-deep ramp
that the limit's nearness walks (`src/ui/map_open_sea_edge_core.ts`, consumed by
`map_terrain.ts`), and the boundary is not drawn at all.

That is defensible because the map was never the load-bearing signal. `src/sim/fatigue.ts`
raises an on-screen error toast the moment a swimmer crosses, repeats it every 4 seconds, logs
it, and gives 8 seconds of grace before the first damage pulse: real time to turn around,
delivered to a player who is looking at the world rather than at the map. A rule drawn across
open water restated that worse, for the cost of a straight line through the sea.

The rule this leaves behind: check WHERE a signal actually reaches the player before treating a
cosmetic surface as though it carried the read. `tests/map_terrain.test.ts` pins the outcome in
both directions, including that no pixel near the limit is drawn brighter than the water inside
it, so the boundary cannot creep back in as decoration.

## Enforcing guards

- `tests/auras_painter.test.ts`: a debuff past the buff cap still renders; an all-debuff bar
  exceeds the cap; the cap is byte-identical on full tiers.
- `tests/ui_tier_knobs.test.ts`: the LOW shed constants are literal-pinned; a `Hud.fxTier()`
  source-scan proves the knobs read the static `data-fx-level` stamp and never the FPS
  governor; a source-scan pins that party frames are not tiered.
- `tests/architecture.test.ts`: `ui_tier_knobs.ts` is a registered UI_PURE_CORE (no governor,
  DOM, or render import).
- `tests/professions_graphics_fairness.test.ts`: the professions actionable set (the fishing
  bobber pair, the minimap markers and painter, the node tooltip, the node prop ladder) is
  scanned profile- and governor-free with comment-stripped sources, the tier ladder is
  literal-pinned and proven applied on the built meshes, and the cosmetic set (LOW_FOG's
  scenery shed, splash richness) is named beside it.
- `scripts/perf_tour.mjs` per-tier run: `hudHotDomWrites` pinned across tiers (byte-equivalence)
  and the FCT cap engaging per tier.
- `tests/snapshots.test.ts`: a real Sim aura to `wireEntity` to `ClientWorld` round trip pins that
  a negative-value `buff_*` stat-sap carries its value over the wire (so `isAuraDebuff` agrees
  online and offline), while positive buffs, absorb shields, and negative-value non-buff auras
  (a fear angle) stay sparse and decode to 0 (no other online behavior changes); an old-server
  wire with no value decodes to 0 (backward compatible).
- `tests/auras_painter.test.ts`: a wire-faithful negative-value `buff_*` sap, driven through the
  real `createAurasView` into the low painter, renders past the buff budget (the view to painter
  cap path for the sap).
- `tests/auras_view.test.ts`: `isAuraDebuff` classifies a negative-value `buff_*` sap identically
  for the Sim aura and its `ClientWorld` mirror.
- `tests/weapon_vfx_shed.test.ts`: the weapon-skin fade. Neither arm reaches zero and the
  lever's floor is proven to stay clear of the multiplier at which a part would stop drawing,
  so the fade can never be mistaken for a cull; the distance arm is anchored to the fixed
  `CHARACTER_LOD_RANGE_SQ` rather than the live band edge, and the policy is scanned free of
  any tier, preset or device-profile input and pinned to its two arguments; the applied fade is
  proven to dim the rig light WITHOUT clearing its `visible` flag, because three counts visible
  point lights into every lit material's program cache key and dropping one is the open-world
  recompile freeze; and the far-LOD skip is pinned to require a baked stand-in mesh, since
  `setFar` leaves the rig drawing when there is none.
- `tests/drape_lod_core.test.ts`: the ground-VFX drape LOD reads viewer distance and the mark's
  own geometry only (pinned to its two arguments), every sample it takes is one the exact drape
  would also have taken, and the marks it is allowed to thin at all are bounded by a world-space
  sample-spacing cap, so no mark's footprint, radius or position can move with it.
- `tests/ability_vfx_cc_bands.test.ts`: the held crowd-control bands (the "why can't I act"
  tell: yellow stars over a stunned victim, violet wisps over a feared one, green shards at a
  rooted one's ankles, each keyed off what the SIM says the victim wears so every source reads,
  mob stomps and ensnare affixes included) occupy the FIRST overlay slots, draw identically at
  vfx quality 0, hold an alpha floor for the aura's whole life, and are bounded by a band cap
  instead of a tier shed. One band per victim, the most severe worn, and ONE shared cap across
  all three types (`MAX_CC_BANDS`), so adding types never widens the batch claim. The cap ranks
  by severity first, then bands in front of the camera ahead of ones behind it, which is a
  fairness rule and not just polish: character self-culling is enabled only on the tier that
  casts no sun shadow (`GFX.dynamicShadows` -> `cullCharacters`), so on medium and above every
  controlled entity in interest range competes for a slot, behind-camera ones included, while
  on low the offscreen non-actionable ones are slept first. Ranking on raw camera distance
  would let a medium-tier player lose an on-screen CC read that a low-tier player keeps. A band
  that still loses its slot is not dark: the cast-moment sequence stands down only for bands
  that WON a slot, so a dropped one keeps reading through the burst. Pinned skips: a dead body,
  a frustum-culled non-actionable rig, and a cast-moment sequence for a band that is actually
  being drawn.
  The band's TYPE is itself actionable, not decoration, which is why the cast-moment stand-down
  answers on any band type rather than stun alone: the `cc` archetype flashes the same yellow
  stars for every control ability, so a rooted victim would otherwise read as stunned for the
  burst's length. Each band is also separated from the others on two axes at once, colour and
  motion signature (ring position, sprite shape, and the fear band's vertical bob), so the
  distinction survives for a colourblind player rather than resting on hue alone.

## Resolved: negative-value stat-sap auras now classify as debuffs in both worlds

The one residual gap (it predated P14a) is closed as of commit `a15c910c`. A negative-value
`buff_*` stat-sap aura (an attack-power or intellect drain that rides a `buff_*` kind with a
negative value) used to be classified as a debuff by `src/ui/auras_view.ts` `isAuraDebuff` only
OFFLINE: the online wire did not send the aura value (`WireAura` omitted it and the client decode
hardcoded `value: 0`), so `isAuraDebuff`'s `value < 0` branch never fired online. The sap read as
a buff, and on the LOW preset it could ride the buff budget and be hidden past the debuff-priority
cap. The same gap also made the debuff BORDER on such a sap offline-only.

The fix gives the UI the input it was missing, keeping the classification in the UI (the wire only
carries the data):

- `server/game.ts`: `WireAura` gained an optional `value`, emitted SPARSELY by the aura serializer
  for exactly the case the classification reads it, `a.value < 0 && a.kind.startsWith('buff_')`,
  sent raw so the sign survives the wire. Positive buffs, absorb shields, and negative-value
  non-buff auras (a fear's random facing angle) stay off the wire.
- `src/net/online.ts`: the aura decode reads `a.value ?? 0` (was hardcoded `0`), so a missing
  value still decodes to `0` (an old server, or any sparse case) and the field is backward
  compatible in both directions.
- `src/ui/auras_view.ts` and `src/ui/auras_painter.ts`: doc-only updates; the `value < 0` branch
  now fires identically in both worlds, so the debuff-priority cap can never hide such a sap.

Every other allowlisted debuff KIND (dot, stun, silence, sunder, and the rest of
`DEBUFF_AURA_KINDS`) was already value-independent and classified correctly online, because the
kind is on the wire. With this change the graphics-fairness invariant is fully enforced: no
graphics or performance preset can hide any actionable information.
