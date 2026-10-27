<!-- src/render/smith_heart_fx/: the Smith's Heart raid's encounter effects.
     Presentation only; parent dirs cover the IWorld seam, determinism and the
     GPU scheduler contract. Don't repeat root / src / render CLAUDE.md. -->

# src/render/smith_heart_fx: the Smith's Heart's encounter effects

The encounter half of the raid's look (`docs/design/raid/smith_heart.md`, sections 5.9,
5.14, 7.1 and 7.2), hosted by `../rift_death_zone.ts` beside the dungeons' own fx. Everything is
read from IWorld (a guardian's cast bar, its events, the mirrored gate memory), so
offline and online look the same. The interior's static dressing and air are
`../smith_heart/`.

| Module | Role |
|---|---|
| `index.ts` | Public surface: `HammerFx`, `BreathFx`, `BreathFightFx`, `BreathBody`, `QuenchFx`, `HeatFx`, `HeatFightFx`, `HeatBody`, `FinalFx`, `CouncilFx`, `CouncilBodies`, `SealShake`. |
| `council_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the Hammer Council's look (design doc 5.18): a pillar's integrity on the model (`pillarLook`: seams, lean, heat, grit; `pillarPips`), its rise and fall timelines, the marks' footprints read off the sim's tuning (`COUNCIL_MARK_SPECS`, `RISE_SPOT_SPEC`) and their threat colours, the rock's fall, Resonance's ring, the heroic pulse's reach, the inheritance's arc, the energy's look, the cues it claims (`councilClaims`). |
| `council_pillars_fx.ts` | `CouncilPillarsFx`, a part of `CouncilFx` (on its host: the root, the particles, the debris, the floor telegraph): the pillars (the Hammer kit's column, the rock kit's needle for a risen one) with their crack shells (the piece's own stone pushed out along its normals, a seam net that opens and burns per integrity), lean and pips, the rise, a lost piece, the fall into rubble (a danger footprint) and the sinking. |
| `council_shelter_fx.ts` | `CouncilShelters`, a part of `CouncilFx`: the REAL safe shadow behind every soulless pillar while Mountain's Wrath's bar or the Echo of Wrath's runs (`coverShadow`, `shadowPoint`: between the tangents from the blast, from the pillar's far face out, drawn a hair inside the sim's cover, `SHELTER_PAD`): a dark wedge with a bright rim on every tier, a faint light curtain along its edges (shed on the low tier). |
| `council_soak_fx.ts` | `CouncilSoakFx`, a part of `CouncilFx`: the Falling Rock's countdown rim at the soak's own radius (one segment a second going dark, a sweeping head), the beacon over its player and the rock's shadow growing as it comes down (the rock itself hangs over the soak the whole mark: `rockFall`). |
| `council_pip_sockets.ts` | `CouncilPipSockets`, a part of `CouncilPillarsFx`: the pips as carved stone sockets holding a gem of light (lit, spent, the last throbbing, a flash on a loss), two instanced draws over the floor ring's arcs (every tier). |
| `council_slab_fx.ts` | `CouncilSlabRigs`, a part of `CouncilPillarsFx` (mythic): the Walking Slab's own look from the Heart kit (`Kit_SlabCollar`, five `Kit_SlabClaw`, `Kit_SlabFace`): the claws reaching, biting and hauling (`slabPull`), the stone lurching and rocking, its face turned to its drag, gouges raked where the talons bite (`slabTalon`, one instanced draw, thinned on the low tier). |
| `council_soul_fx.ts` | `CouncilSoulFx`, a part of `CouncilFx` (mythic, Soul in the Stone): what each soul does: the Echo of Wrath's lethal ring and its shelters (`council_shelter_fx.ts`), its blast; the Walking Slab's crush and grind footprints riding with it, a crush's impact; the Endless Song's floor ring growing with its pulses, its clock ring and the sound rings over the Quarry. The soul pillar's own look (lit cracks in the soul's colour, the sheath, the soul pips, the slab followed every frame) is `council_pillars_fx.ts`; the plan (`SOUL_COLORS`, `soulPillarLook`, `songLook`, `slabReach`) is `council_fx_core.ts`. |
| `council_fx.ts` | `CouncilFx`: the host of the pillars' part, and the Wake and soak footprints round their players (the ghost pillar, the boulder dropping), the heir's locked rise spots, Resonance's ring, shimmer and thread to the pillar it cracks, Hammer's Weight's slam and mark, the Seam Bolt's shard, the inheritance's river of beads, the energy's gauge and glow, the heroic pulse. Every footprint, ring, gauge, pip, crack and lean on every tier; claims the council's own cues. |
| `council_bodies_core.ts` | PURE (`RENDER_PURE_CORES`): the council's two provisional bodies (the Slabwright broad and blocky with slab shoulders, the Seam Singer tall and slender with amber seam crystals): joints, reach, pieces (kit node, joint, fitted box, light), the cast-to-motion mapping, the poses, the glow and the fall. Joints apart from pieces, so the final models replace the pieces only. |
| `council_bodies.ts` | `CouncilBodies`: the Slabwright's and the Seam Singer's bodies over their bodyless targets: Hammer kit stone and Heart kit rock and crystal stitched by ochre threads, breath, swings, cast poses and the fall into rubble. |
| `final_fx_core.ts` | PURE (`RENDER_PURE_CORES`, phase 2J): the Masterless Strength's numbers read off its sim template (Forge Fist's arc and reach, Forge Wrath's radius and bar, Forge Pour's cone), its body's joints (`COLOSSUS_SLOTS`, the two-bone reach `colossusArmIk`, the pieces' rest spots on the walk and in the chasm), the arrival's timeline (`ARRIVAL`: the heart rising, each piece tearing, flying and locking, the shockwave, `ARRIVAL_END`), the poses of its swing, Forge Fist, Forge Wrath and Forge Pour, the fall (`colossusFallPlan`, `heartDeathLevel`), the pools. |
| `final_fx.ts` | `FinalFx` (phase 2J): the body (the Heart kit's rock pieces round the crystal heart, threads of the veins' light, the heart's own shader) following the bodyless boss; the arrival scene from the seal memory's `awakeSince` (whole for a late arrival, run on to its end by a pull); Forge Pour's cone through the shared floor telegraph on every tier and its fire on the floor, Forge Wrath's gather and wall of light, Forge Fist's strike; the fall and the room going dark (`../smith_heart/heart_final_core.ts`). |
| `hammer_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the Hammer guardian's numbers read off its sim template (never tuned here), the crack lines, Mountain's Wrath's charge and blast timelines (the dust wall rides the trash engine's `novaWave` front on the same clock), Hammerfall's heat, the Slab's break timeline and the once-per-change rule (`slabBreakDue`), the pool sizes. |
| `seal_shake.ts` | `SealShake` (phase 2F): the seal's moments felt in the camera (the arrival's thud, the opening's tremor, jolt and aftershock), read from the slot's seal memory, scaled by distance, through the shake sink (reduced motion honoured). |
| `breath_fx_core.ts` | PURE (`RENDER_PURE_CORES`, phase 2G): the Breath guardian's numbers read off its sim template (the gust's radius and shove, the lance's length and width, both bars), the gust's charge and wall timelines, the lance's bolt, scorch and charge looks, the bolt's path (always inside the lane's half width), the pool sizes. |
| `breath_fx.ts` | `BreathFx` (phase 2G): Bellows Gust's and Storm Lance's footprints through the shared floor telegraph (`../floor_telegraph`, every tier: the ring at the gust's exact radius, the lane at the lance's exact length and width, filling with the bar), the gust's breath drawn in, its whirl of stones and funnel, its wall of wind riding out to the shove's end with grit and rings; the lance's crackle and sparks, its bolt from the cloud onto the guardian and down the lane, the scorch smouldering. |
| `breath_body_core.ts` | PURE (`RENDER_PURE_CORES`): the Guardian of the Breath's provisional body (design doc 7.2): a living bellows of storm granite, crystal and storm, no metal (a barrel chest between two bellows plates, `Kit_WindShelter`; a wind-horn mouth; fluted wind-blade wings; crystal spines; rock arms ending in wind-carved claws; a whirl of loose stones for legs), about 3.5 players tall; the joints and slots kept apart from the pieces; what the bars and the wind's phases do to it (`breathBodyAction`, `breathBodyLook`: the bellows' swell, the head's lift, the wings' spread, the exhale, the freeze's jitter, the tear), the storm body's shard rings (`stormShardSlot`) and lightning core (`STORM_CORE`), the arms, the fall. |
| `breath_body.ts` | `BreathBody`: the body over the bodyless guardian (Breath kit and Heart kit pieces recoloured a storm slate that reads on the pale Cornice, teal threads and seams); it turns its mouth to the wind object's bearing as a blow gathers and exhales through it; the storm bar draws in, freezes and tears open; through phase 2 (`BREATH_AURAS.stormForm`) every stone rings a core of living lightning (a storm figure, lightning wings, a white heart, arcs to the shards); the fall. |
| `breath_fight_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the Breath fight's look: the wind's field per phase (`windFieldLook`: chevrons, streaks, the gather's sweeping edge, inward while it draws breath), the gaps' lips read off the field's open cliff runs (`gapLips`) and their flare (`gapThreat`), the calm's states and seats, the timed spots' fills, the strike bolt's path, the objects' kinds, the claimed cues, the palette, the pools. |
| `breath_fight_fx.ts` | `BreathFightFx`: the wind's chevron field over the whole Cornice floor and the gaps' burning lips (every tier); every fight object's footprint at its exact radius through the shared floor telegraph (the calm's mint, the vortex and the strikes and charged ground in danger, the loose gales in control, the cradle in the soak's gold) and the bars' footprints round their targets (the fork's jump reach, the cradle's spot, the conductor's mark); the anchored, pinned and conductor marks; the strikes' bolts and scorches, the fork's and the anchor's beams, the crown over the lifted player, the calm's beam and dome, the funnels, the air's streaks and the gaps' updraft (cosmetic). Feeds `../../game/smith_heart_breath_audio.ts`. |
| `quench_fx_core.ts` | PURE (`RENDER_PURE_CORES`, phase 2H): the Quench guardian's numbers read off its sim template (Tempering Strike's arc and reach, Quenching Breath's cone, range and bar), the breath's charge, sweep and frost timelines, the strike's rise, hold and shatter, the strike's spikes (always inside its arc and reach), the pool sizes. |
| `quench_fx.ts` | `QuenchFx` (phase 2H): Quenching Breath's cone through the shared floor telegraph (every tier, the exact angle and range, filling with the bar), the cold drawn in and the frost creeping under it; when it lands the freezing gust, the ice ripping up behind its front and shattering, the floor frosted; Tempering Strike's spikes of ice in its arc (from the swing's windup event, no bar). |
| `quench_body_core.ts` | PURE (`RENDER_PURE_CORES`): the Guardian of the Quench's provisional body (design doc 5.20): frost-bound granite (Heart kit colossus pieces repainted pale), clear lake ice and a crystal heart (Quench kit pieces), about 3.5 players tall; the joints kept apart from the pieces; what the bars and one-shots do to it (`quenchBodyAction`, `quenchBodyLook`: the breath's rear and exhale, the strike's slam, the wake's raised arms), the arms, the fall. |
| `quench_body.ts` | `QuenchBody`: the body over the bodyless guardian, its threads and eyes of the lake's light, its crest brighter while the blades are awake (`QUENCH_AURAS.awake`), the fall. |
| `quench_fight_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the Quench fight's look: the objects' kinds, the claimed cues, the frost on a body by its bar (`frostLook`), the freeze, the cracks' and holes' timelines, the blades' poses (`bladeLook`), the echoes' and the lee's shapes, the warmth's threads, the shore ice's rise and shards, the palette, the pools. |
| `quench_fight_fx.ts` | `QuenchFightFx`: every fight footprint at the sim's exact radius through the shared floor telegraph on EVERY tier (the crack at the hole's radius, the echoes, the lees in mint, the crossing's lane, the freeze's splash ring), the frost and rime ring on every cold body, the holes' water, the frozen blocks, the warmth's glow and threads, the shore ice; mist, embers, glints and splashes cosmetic. The echoes borrow `QuenchFx`'s looks (`echoAt`, wired by `../rift_death_zone.ts`). Feeds `../../game/smith_heart_quench_audio.ts`. |
| `quench_blades_fx.ts` | `QuenchBladesFx`: the Smith's four blades over their claim objects: the kit's sunk blade, torn free with its tip shown, floating upright with its light and a chevron the way the echoes run, flying (heroic), the torn socket in the ice. |
| `heat_fx_core.ts` | PURE (`RENDER_PURE_CORES`, phase 2I): the Heat guardian's numbers read off its sim template (Molten Pour's lane, length, width and bar; Searing Knell's radius and bar, its id still `heart_anvil_clang`), the pour's gather, seams and flow timelines, the knell's gather, cracks and wave, the seam and crack paths (always inside the lane and the radius), the pool sizes. |
| `heat_fx.ts` | `HeatFx` (phase 2I): Molten Pour's lane and Searing Knell's ring through the shared floor telegraph (every tier, filling with the bar); the pour's gathering fire and its seams lighting down the lane, then the white-gold fire pouring down it behind a wave of flame, molten, crusting, smoking; the knell's sphere of fire and its cracks, then its wall of fire ringing out to the stun's edge, the rings of the toll, the sparks and ash. |
| `heat_body_core.ts` | PURE (`RENDER_PURE_CORES`): the Guardian of the Heat's provisional body (design doc 7.4): a being of the first flame in columnar basalt and white-gold crystal, nothing of a forge (Heart kit colossus basalt repainted, Heat kit fire crystal, ember boulders and hearth-pillar column bundles), about three and a half players tall; the joints kept apart from the pieces; what the bars and one-shots do to it (`heatBodyAction`, `heatBodyLook`: Shed Heat's lean and the rise, Molten Pour's arm, the knell's sphere and toll, Hearthburst, the stoking, the wind-up's strain), how white its fire burns with the heat (`heatWhiteness`), the arms, the fall. |
| `heat_body.ts` | `HeatBody`: the body over the bodyless guardian, its fire gold to white with the mirrored heat (the guardian's resource), the wind-up's white flash round the whole body (`HEAT_AURAS.overheating`), tongues of flame, embers and haze off it, the fall in smoke. |
| `heat_fight_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the Heat fight's look: the objects' kinds, the claimed cues (all of `HEAT_CUES`), the rise spots' fill, a crystal's rise and its charge toward each ray on the sim's clock (`crystalLook`), a ray's held beam (`beamLook`), Crystal Burn on a body (`burnLook`), the channel's states (`channelLook`), the embers, the pulse's ring, the wind-up's floor glow (`windupGlow`), Hearthburst's wave, the palette, the pools. |
| `heat_fight_fx.ts` | `HeatFightFx`: every fight footprint at the sim's exact size on EVERY tier (the rise spots in danger, each crystal's reach in the soak's gold filling to its next ray, the channel's lane while it brims and flows, the embers' danger rim), the Kindled Crystals (the Heat kit's cluster, a stand-in until it lands), the rays held on their target, the burn climbing a body, the channel's bed and fire, the wind-up's floor glow, Hearthburst's wave; sparks, embers, haze and smoke cosmetic. Feeds `../../game/smith_heart_heat_audio.ts`. |
| `hammer_fx.ts` | `HammerFx`: Mountain's Wrath (molten cracks racing out over its bar, loose stones lifting, dust drawn in; on landing the dust wall, rubble, rings, flash, grit off the terraces, a shake), Hammerfall (a fan of cracks in its arc, rubble, dust), the Slab breaking (the split flaring, the burst both ways, dust, rings, grit off the lintel while the halves part) and the Pit Mouth slamming shut (a dust skirt). |

Rules:
- The Masterless Strength's Forge Pour cone is actionable and drawn by `FinalFx` through the
  shared floor telegraph on EVERY tier (threat colour `danger`); Forge Wrath's sight field is
  the trash engine's. The body, the arrival and the fall are presentation only (no sim state
  but the seal markers' arrival bit); the dust, sparks and trails thin on the low tier, the
  shakes go under reduced motion. The body's joints and timeline are kept apart from the
  kit's pieces so the final model replaces the pieces only.
- The Heat guardian's lane and ring are actionable and drawn by `HeatFx` through the shared
  floor telegraph on EVERY tier (threat colour `danger`, the vein's white-gold as the
  accent); its fire, sparks and smoke are cosmetic and thin. The Heat is the Hearth: its
  fire is white-gold, never volcanic red.
- The Guardian of the Heat's rise spots, crystal reach rings, rays, the burn on bodies, the
  channel's lane (brimming and flowing), the embers' rims and the wind-up's floor glow and body
  flash draw on EVERY tier (`HeatFightFx`, `HeatBody`); sparks, embers, haze, smoke and the
  wind-up's gathering rings (`windupGather`) thin or go on the low tier, the shakes go under
  reduced motion. Its fire is the Hearth's white-gold, never volcanic red.
- The Quench guardian's cone is actionable and drawn by `QuenchFx` through the shared floor
  telegraph on EVERY tier (threat colour `danger`, the vein's pale ice as the accent); its
  frost, mist and ice are cosmetic and thin.
- The Guardian of the Quench's cold on bodies, every crack, hole, echo footprint, lee,
  crossing lane and the freeze's splash ring draw on EVERY tier (`QuenchFightFx`); mist,
  embers, glints and splashes thin. The fight's sounds are
  `../../game/smith_heart_quench_audio.ts`, fed by `QuenchFightFx`.
- The Breath guardian's footprints are actionable and drawn by `BreathFx` itself through
  the shared floor telegraph on EVERY tier (threat colour `danger`, the vein's teal as
  the accent); the wind, the lightning and the debris over them are cosmetic and thin.
- The readable telegraph of Mountain's Wrath is the trash engine's sight field
  (`../trash_engine_fx/engine_nova.ts`), drawn on every tier. Nothing here is
  actionable: the low tier and reduced motion thin the particles, the rubble and the
  shake. `handleEvent` never claims an event (the renderer's own draws still play).
- Every geometry and material is built in the constructor under one root attached
  through `attachSceneGroupGated` (the compile gate links it before the first cast);
  fixed pools, no per-frame allocation, no light.
- The cracks are floor marks on the floor ladder's encounter band, over the sight
  field's fill and under its wave.
- The Guardian of the Breath's wind direction (the floor's chevron field), the gaps' lips,
  and every fight footprint and mark (`BreathFightFx`) draw on EVERY tier; the air's
  streaks, the grit, the motes, the calm's dome, the funnels' density, the sparks and the
  shakes thin or go. Which body it wears (stone, or the storm's lightning) is phase 2's
  tell and never thins. The exhale's Bellows Gust keeps its ring at the sim's exact
  radius (the whole Cornice) in `BreathFx`; its whirl stays the guardian's own size.
  The fight's sounds are `../../game/smith_heart_breath_audio.ts`, fed by `BreathFightFx`.
- The Hammer Council's pillars, marks and footprints are actionable and drawn by `CouncilFx`
  on EVERY tier (the threat colours: `control` for Wake the Stone's throw, `danger` for the
  rubble, the heir's rising stone and the heroic pulse, `lethal` for Hammer's Weight, the
  soak's gold to gather in, the vein's ochre on the accents only); dust, grit and debris
  thin on the low tier. Mountain's Wrath stays `HammerFx`'s for whichever member holds it.
- Mythic's soul pillars are told apart on EVERY tier (the soul's colour in the cracks, the
  sheath, the three soul pips; the Walking Slab's claws, collar and face), and the Echo's
  ring and shelters, the slab's footprints and the song's rings are actionable (every
  tier); motes, embers, dust, gouges and the shelters' light curtains thin.
- The council's sounds are `../../game/smith_heart_council_audio.ts`, fed by `CouncilFx`
  (its cues, its scan, its frame).
- A new raid guardian's effects join here as their own module behind `index.ts`, never
  as a branch in `hammer_fx.ts`.

Tests: `tests/smith_heart_council_fx.test.ts`, `tests/smith_heart_council_soul_fx.test.ts`, `tests/smith_heart_council_bodies.test.ts`,
`tests/smith_heart_hammer_fx.test.ts`, `tests/smith_heart_breath_fx.test.ts`,
`tests/smith_heart_breath_fight_fx.test.ts` and `tests/smith_heart_breath_body.test.ts` and
`tests/smith_heart_quench_fx.test.ts`, `tests/smith_heart_quench_body.test.ts` (the Quench
body's and fight's cores), `tests/smith_heart_heat_fx.test.ts`, `tests/smith_heart_heat_body.test.ts`,
`tests/smith_heart_heat_fight_fx.test.ts` and
`tests/smith_heart_final_fx.test.ts` (each core and a smoke run over a fake world).
