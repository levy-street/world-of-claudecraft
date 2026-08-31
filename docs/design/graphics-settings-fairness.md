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
  screen, so hiding a buff icon removes no actionable information. (2026-08-27: a
  short-duration buff, e.g. a tank's active-mitigation cooldown, is exempted FIRST when the
  cap must shed something -- see "The 2026-08-27 short-buff priority pass" below -- and a
  player may opt fully out of the shed via the "Always Show All Buffs" interface setting,
  which pays the cap's usual per-frame cost. Neither changes the rule itself: the cap
  still only ever hides cosmetic icon information, never a mechanical effect.)
- Portrait and HP-bar redraw smoothness within human reaction tolerance (about 200 ms).
- Sun-shadow refresh cadence under budget pressure (`src/render/shadow_cadence_core.ts`).
  Under sustained over-budget readings the shadow map updates every other frame instead of
  every frame; shadows are never removed, and a one-frame-stale shadow (50 ms at 20 FPS)
  conveys nothing a player acts on. This is a GOVERNOR-driven shed by design, like the
  weapon-VFX `vfx` bucket arm below: a perf-governor output, not a UI tier knob, so the
  static-preset rule at the bottom of this doc does not apply to it.
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
- Deed Heraldry's decorative bloom (the Book of Deeds rewards worn in-world and on social
  surfaces). Heraldry is IDENTITY: it encodes no health, range, rank, or threat, so its
  forged seal, motif, material, and structural edge may never be hidden. The world seal and
  name ribbon are canvas shapes resolved from entity state on the same cadence as the title
  text. The player and valid-player-target headers, inspect banner, picker samples, and both
  picker previews consume the same canonical slug-to-palette-and-motif mapping. None accepts
  a graphics preset, tier, effects profile, or governor input. `tests/deed_border_accent.test.ts`
  pins those identity arms and the four normalized motif paths. The ONE tier-scaled quantity
  is outer box-shadow bloom, which rides `--fx-shadow` and may reach 0 on low. Structural
  borders, inset edges, seals, motifs, and material fills remain. The target reveal repaints
  on the existing low-tier target-frame body throttle (about 10 Hz, target swap bypasses), a
  redraw-smoothness shed this list already sanctions for the portrait. Party, pet,
  target-of-target, NPC, mob, and object frames receive no heraldry on any tier.

- The armour DYE of a picked outfit colorway (`src/render/characters/armor_dye.ts`,
  `outfitDye` in `modular.ts`). The colorway itself is IDENTITY the player chose in the
  creator, so it may never be dropped outright; what a tier with no shader stage may shed is
  its FIDELITY. On standard tier and above, `attachArmorDye` remaps the atlas's steel, trim,
  leather, and cloth zones independently in a fragment shader. On low tier, every rig
  material rebuilds as flat Lambert with no `onBeforeCompile` hook to run that shader in, so
  `outfitDyeFallbackHex` (`modular.ts`) stands in with a single, value-normalized multiply
  toward the colorway's own hue: a rougher, whole-armour approximation of the same colour
  rather than the atlas's undyed default. Pinned by `tests/tinted_material.test.ts`.

- Edge anti-aliasing, and WHICH edge anti-aliasing a tier gets. High and above run the SMAA
  tail; medium (and any mix that resolves to the grade-only chain) runs the FXAA arm fused
  into `OutputGradePass`; low and the memory-constrained WebKit rungs run none, because they
  have no grade pass to fuse into. All three arms filter the display-space image AFTER
  everything a player reads has been drawn into it, and none of them removes, hides, delays,
  or repositions anything: an aliased silhouette and an anti-aliased one carry the same
  information at the same time. Which arm a session gets is a pure function of the STATIC
  device policy (`gfxAaPolicy`) plus the Anti-Aliasing dial, never of the frame-budget
  governor, so it cannot vary between two players standing in the same spot.

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
  **The 2026-08-26 buff-bar overflow badge:** the shed itself stayed a silent count for a while
  (a player on low with more than `AURA_VISIBLE_CAP_LOW` buffs simply saw fewer icons than they
  had, with nothing distinguishing "hidden" from "gone"), which read as a bug report even though
  no rule here was actually violated. The fix restores no information (the classification above
  is unchanged: a buff icon is still cosmetic, and the cap still never touches a debuff); it only
  makes the shed HONEST. `AurasPainter` now accepts an optional `overflowEl`, a static sibling
  `hud.ts` mints once into `#buff-bar` ahead of the pooled aura nodes; on a paint that actually
  sheds N buffs, the badge shows a dashed "+N" tile (`hudChrome.unitFrame.buffOverflowLabel`)
  with a native tooltip (`hudChrome.plurals.buffsHidden`) explaining that those buffs are still
  active. Full tiers never see it (the cap never bites there), and neither does the debuff bar or
  the target strip (their `overflowEl` stays null: neither can ever shed).
  **The 2026-08-27 short-buff priority pass:** player feedback on the overflow badge (PR #3668)
  pointed out that an HONEST shed is still a shed: a tank's Raised Guard (2 charges, 6 sec active
  mitigation, 12 sec recharge) applied AFTER a wall of long-lived raid buffs could still lose its
  icon to them under the flat first-N cap, hiding the one piece of timing information a tank
  actually needs from the bar. The selection itself is now priority-ordered, not just honestly
  reported: `AurasPainter.paint()` delegates the shed decision to
  `aura_overflow_priority.ts::selectShedSlots`, which keeps `cap` ordinary buffs (exempt slots
  render on top, unconditionally, exactly as before) but fills that budget with short-duration
  buffs FIRST (`AuraSlotState.shortDuration`, `auras_view.ts::isShortDurationBuff`, at or under
  `SHORT_BUFF_PRIORITY_SEC` = 60 sec, the natural gap in the content catalog's selfBuff
  durations between active-cooldown buffs and raid/world buffs) and only sheds a long-duration
  buff once every short one already fits. This restores no NEW information a full tier does not
  already show (a long buff was always the one shed on low; this only changes WHICH long buff,
  never whether a debuff or an actionable/always-visible buff sheds), so the rule above is
  unchanged. The same PR also added an opt-out: "Always Show All Buffs"
  (`game.settings.alwaysShowAllBuffs`, Interface panel, Frames tab, off by default) makes the
  buff bar's own `AurasPainter` report the 'ultra' tier to `auraVisibleCap` regardless of the
  real preset (`Hud.buffBarFxTier()`), so the cap never bites for a player who opts in, at the
  cap's usual per-frame cost. It touches only that one painter instance; every other low-tier
  knob (FCT, minimap, the debuff bar, the target strip) is unaffected, so this is a player
  PREFERENCE layered on top of the STATIC preset, never a second preset-like governor.
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

### Low-tier rocks with a real collider stayed invisible (2026-08-15)

Not a HUD tier this time: the same principle applies to a WORLD-scenery LOD trim, and the
answer is that a physical collision is the sharpest form of actionable information there is,
sharper than anything on this list so far.

`src/render/foliage.ts` sheds triangle count on `GFX.leanFoliage` tiers (Low, and Medium on a
weak integrated GPU) by randomly dropping a fraction of scatter decorations from rendering. That
trim treated every rock the same, with no awareness that `src/sim/colliders.ts` had already given
some of them a real physical collider (rocks at or above `ROCK_COLLIDER_MIN_SCALE`). The sim side
is correctly tier-agnostic (the server is authoritative and knows nothing about a client's
graphics preset), so the collider always existed; only the client's decision about what to draw
was missing the check. A player on Low could walk into an empty-looking patch of ground and be
stopped by a rock they could not see.

The fix is a shared predicate, `decorationHasCollider` (`src/sim/decoration_dims.ts`), consumed
by both `colliders.ts` (which already had the same check inline; it now calls the named,
shared version instead) and a new pure core, `src/render/foliage_decimation_core.ts`
(`survivesLeanDecimation`), which exempts any rock the predicate calls solid from the trim before
falling back to the previous tuned keep rates for everything else. Trees carry the identical
architectural gap (every tree/tree2 trunk gets an unconditional collider, with no size gate at
all), but a correct fix there would exempt effectively every tree from the trim, a much larger
triangle-count and frame-time tradeoff on the weak/software GPUs this tier targets than the rock
fix is, so it was tracked separately rather than folded in blind at
levy-street/world-of-claudecraft#3415: see the entry below, where its decimation-trim half is
fixed for real (a distinct, still-open bucket-culling half is also identified there). A second,
unrelated invisible-collision gap was found in the same review, in the Evergarden's parterre
beds and garden-biome pines (a zone-curation exclusion, unconditional on every preset, not this
tier trim), tracked at levy-street/world-of-claudecraft#3417 and still open.

The rule this adds to the list at the top: ACTIONABLE now explicitly includes "the presence of
any entity a player can physically collide with", not only HUD/map reads. A render-side decision
about what to draw must never diverge from what the sim decides a player can be blocked by.
`tests/foliage_decimation_core.test.ts` pins the predicate itself, and
`tests/foliage_decimation_wiring.test.ts` source-scans `foliage.ts` so a future re-inlining of
the old hash-vs-keep-rate filter (which is exactly what caused this) fails loudly instead of
silently reopening the bug behind a green core test.

### Low-tier trees with a real collider stayed invisible too (2026-08-20)

`levy-street/world-of-claudecraft#3415` (opened alongside the rock fix above) was closed as
completed on 2026-08-17 with no linked commit or PR: the gap it tracked was never actually
closed. A player reported the live symptom again on Low graphics: a tree visible from one camera
angle, then gone after a small camera turn, while still blocking movement in a straight line.

The deliberation the issue asked for (accept the full triangle-count cost, or invent a cheaper
"kept but budget" stand-in visual) resolves the same way the graphics-fairness principle at the
top of this file already states it: a preset may shed COSMETIC richness, never ACTIONABLE
information, and there is no "unless it is expensive" clause. A collider a player cannot see is
the sharpest form of hidden actionable information there is, so the answer is the rock fix's
exemption, generalized: `survivesLeanDecimation` now exempts ANY decoration `decorationHasCollider`
calls solid, not only rocks. Since every tree/tree2 trunk carries an unconditional collider, this
removes the lean-tier trim for trees entirely; the hash-based keep rate that used to thin them
(0.68 standard materials / 0.46 otherwise) is now unreachable dead weight and was deleted along
with the tree-specific branch in `leanKeepRate` (renamed `leanRockKeepRate`, the only decoration
kind that can still lack a collider).

This is a real, accepted frame-time tradeoff on the weak/software GPUs `GFX.leanFoliage`
targets, not an oversight, and it is smaller than it first looks: the LEAN arm never had
impostors to begin with (`src/render/foliage_lod.ts`'s own header: "THE LEAN ARM HAS NO
IMPOSTORS AT ALL: past the tree-detail distance its trees simply end"), so a tree exempted
from the decimation trim does not draw at full detail out to the render horizon, only out to
the same `treeDetailDistance` every other lean-tier tree already ends at. It also still holds
every species to a single model variant per bucket and skips shadow casters entirely on
`GFX.leanFoliage` (both unconditional on this tier, collider status aside). Correction from an
earlier draft of this entry: the bark-cull and billboard-impostor sheds do NOT apply here at
all; `cullBark` requires `GFX.standardMaterials`, which is false for the plain Low preset (it
only fires on the lean-MEDIUM weak-integrated-GPU cohort), and impostors require
`!leanFoliage`. Neither was ever part of what a lean-tier tree degrades through.

`tests/foliage_decimation_core.test.ts` pins the new behavior directly (a tree at either scale
extreme survives the unluckiest possible hash draw, on both material tiers), and
`tests/decoration_dims.test.ts` already pinned `decorationHasCollider`'s tree arm before this
fix, so the only thing that changed is `survivesLeanDecimation` actually trusting it for every
decoration kind rather than only rocks.

**A second, distinct mechanism can still hide a collider-bearing rock or tree on this tier,
independent of this fix, found during this entry's own review:** `bucketVisible()`
(`src/render/foliage_lod.ts`) culls a whole scatter bucket by comparing camera distance to the
bucket's CENTER against a numeric cap, not the bucket's near edge, and the shipped world's
buckets run 273-307 yards in radius (two columns splitting the world in half, times depth
bands), against an effective 106-245 yard lean-tier cap. A player standing right next to a
decoration near a huge bucket's edge, whose content-weighted center is far away, can still have
that decoration's entire InstancedMesh set invisible while the sim's collider (which knows
nothing about camera position) keeps it solid, the same invisible-but-solid shape as the bug
this entry fixes, through a real-time, camera-position-dependent path rather than a static
build-time roll, which also better matches a report of a decoration flickering as the camera
turns (this decimation-trim fix cannot produce that: its keep/drop decision is made once, at
build time, and cannot change during a session). This affects rocks too, meaning the original
rock fix above does not fully close the rock case either. Deliberately not folded into this fix
for the same reason the tree case itself was originally deferred: it is a real, camera-distance
performance tradeoff across ALL scenery sharing a bucket, cosmetic or not, and deserves its own
measured design decision. Tracked at levy-street/world-of-claudecraft#3525.

## Enforcing guards

- `tests/auras_painter.test.ts`: a debuff past the buff cap still renders; an all-debuff bar
  exceeds the cap; the cap is byte-identical on full tiers. The "overflow badge" block pins the
  new honesty affordance: hidden and blank under the cap or on a full tier, revealed with the
  EXACT shed count once the low-tier buff cap bites, the shed count excludes a debuff that
  rendered past the cap (only dropped buffs count), a painter built with no `overflowEl` never
  touches one, and the count clears again once the buff count drops back under the cap.
- `tests/ui_tier_knobs.test.ts`: the LOW shed constants are literal-pinned; a `Hud.fxTier()`
  source-scan proves the knobs read the static `data-fx-level` stamp and never the FPS
  governor; a source-scan pins that party frames are not tiered.
- `tests/architecture.test.ts`: `ui_tier_knobs.ts` is a registered UI_PURE_CORE (no governor,
  DOM, or render import).
- `tests/tinted_material.test.ts`: an active outfit colorway renders as a genuinely different
  colour on low tier too (never the atlas's undyed default), the low-tier fallback is
  value-normalized so it cannot crush the whole armour toward black the way a naive multiply
  of the swatch chip would, a non-armour material (skin) is proven untouched by the fallback,
  and the standard-tier shader-dyed material's own `.color` is proven unchanged by the fix
  (the shader still carries the dye there).
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
- `tests/shadow_cadence_core.test.ts` + `tests/shadow_render_wiring.test.ts`: the sun-shadow
  cadence shed. The policy core imports nothing (preset, tier, and profile blind; its only
  inputs are the governor's pressure/enabled plus dt), the dwell thresholds are
  literal-pinned, the shed is strictly every-other-frame (never a removal: the application
  writes only the `shadowMap.autoUpdate`/`needsUpdate` flags), and the wiring scan pins the
  renderer call sites.
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
- `tests/decoration_dims.test.ts`: `decorationHasCollider` classifies a rock at or above
  `ROCK_COLLIDER_MIN_SCALE` as solid, one below it as dressing, and every tree/tree2 as solid
  (colliders.ts gives every trunk a collider unconditionally).
- `tests/foliage_decimation_core.test.ts`: `survivesLeanDecimation` never drops a solid rock or
  any tree/tree2 regardless of its hash draw, and still decimates sub-floor dressing rocks (the
  one decoration kind that can lack a collider) at the tuned keep rate.
- `tests/foliage_decimation_wiring.test.ts`: source-scans `foliage.ts` to prove the leanFoliage
  decoration filter actually calls `survivesLeanDecimation` and that the old bare
  `hashAt(d.x, d.z, 83) < keep` shape has not been re-inlined.
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
