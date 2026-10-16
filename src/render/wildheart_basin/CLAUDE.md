# src/render/wildheart_basin: the Wildheart Basin's open-air renderer

The render half of the Wildheart Basin rework (`docs/design/dungeon-rework/wildheart_basin.md`,
sections 2, 3, 4 and 7). A closed jungle caldera on a humid gold afternoon: cliff walls all
round, the braided river and its waterfalls (spray, mist, rainbows), never rain and never an
islet in a sea. The sim layout (`src/sim/content/wildheart_basin_layout.ts`), its gates
(`src/sim/content/wildheart.ts` `WILDHEART_BASIN_GATES`) and the encounter ids
(`src/sim/encounters/wildheart_basin/ids.ts`, `src/sim/mob/trash_kit/wildheart_cast_ids.ts`)
are the single source; everything here derives from them.

| Module | Role |
|---|---|
| `index.ts` | Public surface: `buildWildheartBasinInterior` (registered for interior `wildheart` in `../open_air_fields.ts`) and `WildheartFx` (hosted by `../rift_death_zone.ts`). |
| `basin_interior.ts` | Composes the interior group: the field terrain (moss, wet basalt, flagstone families of `../authored_field/`), the kit dressing, the water, the falls, the gates, the lights, the sky and the air. |
| `basin_plan_core.ts` | PURE (`RENDER_PURE_CORES`): the palette, the afternoon sun (`BASIN_SUN_DIRECTION`, also the `wildheartBasin` key light), every fall's lip and fall line (`planBasinFalls`: the rim falls, the Walk's veil, the ford spill), the rainbows against the sun, the river stations, the ford sheet and plunge pool, the braziers and the jaguar's eyes, the motes, flocks and god rays, the gorge walk mask, the vine bridge segments and the gate motion curves. |
| `basin_sky.ts` | The sky dome: a gold horizon under a hazy turquoise zenith, tall cumulus round the rim, a fair-weather deck, the low sun with its halo and the breaks through the cloud. No rain. |
| `basin_water.ts` | The ford shallows racing west (foam round the basalt steps and the Saurian's legs through `BASIN_WATER_WADERS`), the river ribbon in the gorge and the plunge pool: ONE shared material. |
| `basin_falls.ts` | The signature: every curtain merged in one mesh (layered streaks, ropes, white lip and foot; the veil a thinner torn sheet), the foam rings, the spray and the mist (one instanced draw each), the rainbows (one merged mesh, additive, face the sun) and the rock shelf the veil pours off. |
| `basin_air.ts` | The gorge haze (thick low, masked off every walkway), god rays slanting along the sun, fireflies and pollen, wheeling bird flocks. One draw per system. |
| `basin_lights.ts` | Brazier flames, halos and floor pools (the floor ladder's `ground` rung), the jaguar's eye glow, and the budgeted point lights through the fire-light sink. |
| `basin_gates.ts` | The vine bridges weaving segment by segment (Kit_VineBridge instances), the thorn walls sinking and surging back sealed (Kit_ThornWall), the warded arch and the Shrine Ward, driven by the shared gate memory. |
| `basin_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the telegraph specs from the sim tuning (Tail Swipe rear cone, Stomp ring, Entangling Lash lane, the Sap kick glyph), the spore cloud's look, the Saurian's drawn proportions and the effect timelines. |
| `basin_fx.ts` | `WildheartFx`: the floor telegraphs (the shared `../floor_telegraph` kit) and the creature effects: the Stomp's shock and dust, the Tail Swipe's sweep, the howdah bursting, the enrage glow, the totem pulses, the sap beam, the vines on a rooted player (the trash lash and the Gorgebloom's Vine Lash, `VINE_ROOT_AURAS`), the Pounce trail, the spore fog, the waders' foam, the jaguar's eyes (`jaguarEyesBurn`: a gleam idle, a smoulder while Zulgar fights, full fire during the Jaguar Avatar's hunt). Every encounter object's floor edge (`BASIN_OBJECT_SPECS`: spore clouds, seedpods, sun glyphs, the Ambush circle) rides its pooled object slots; only the spore cloud fogs (`fog`), persistent objects stand as long as the sim keeps them, and a template that flips in place (a pod ripening, a glyph going dark) re-lays its look. Composes `BasinBossFx` and `BasinTrashFx`. |
| `basin_fx_host.ts` | `BasinFxHost`: the type-only seam WildheartFx lends the boss modules (its root, kit, particle pools, shock rings). |
| `basin_boss_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the three bosses' cast specs from the sim tuning (`basinBossCastSpecs`: Beast Pit Quake and Wildheart Pulse rings, the Heel! lane jaguar to master, the locked Vine Lash lane, Gorge's tank-buster mark, the Seed Rain and Spirit of the Hunt charge sigils), the aura dressing (`BASIN_AURA_LOOKS`, `BASIN_HEAD_MARKS`), the Pack Bond cord's brightness (`bondCordStrength`, over the sim's `bondStrength`), the pods' swell, the seeds' arc, the glyph and shock looks, the bodies' drawn heights. |
| `basin_boss_fx.ts` | `BasinBossFx` (PLACEHOLDER looks): the boss cast telegraphs on the shared kit, the charge sigils, the seedpod bodies and the lobbed seeds, the sun glyph overlays, the head marks (Stalked, Prey), the aura glows and motes, the Thickhide Ward shell, the Pack Bond cord. Built under WildheartFx's root before its gated attach; no light. |
| `basin_trash_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the trash hunt (the trash mechanics pass, `src/sim/mob/trash_kit/wildheart_hunt.ts`) read off the templates (`HUNT_TUNING`): the cast telegraphs (`trashCastSpecs`: the Quarry Mark's and the Toad Hex's rings under the victim, the War Roar's 15 yd and the Rattling Dread's 8 yd reach, the Snaring Tongue's locked lane; a kick glyph exactly where `WILDHEART_KIT_CAST_SCHOOLS` lets a player kick), the landing shocks (`TRASH_SHOCKS`), the quarry sigil's and the dread skull's looks, the frenzies' breathing, the projectiles' flight, the tongue's catch (the sim's own `inLane`), hold and mouth point, the hunt casts' existing clips with the rate that fits each bar (`TRASH_CAST_CLIPS`), and the painter's pool sizes (`TRASH_FX_POOLS`: the worst pull of `WILDHEART_BASIN_SPAWNS` plus the next worst chained in, a tongue per toad per party member, a quarry mark per party member). |
| `basin_trash_fx.ts` | `BasinTrashFx` (composed by `WildheartFx` on its host): Pack Frenzy (a snarl burst, a red glow, pool and streaks on each frenzied Basin Raptor), Quarry Mark (the sight under the quarry, the thrown bone spear, then the painted sigil over the quarry's head and the claw rakes at its feet, the raptors running it down streaking orange), War Roar (kick glyph, reach, shockwave, the blood-red frenzy on every roused ravager), Toad Hex (kick glyph, the hex ring, the bolt, the green-gold smoke as the toad comes and breaks), Rattling Dread (the red skull over every Dread Totem, the reach, the bone-rattle burst), Snaring Tongue (the lane, the tongue from the toad's mouth holding each reeled player), Snarlbark (splinters on a melee attacker). Telegraphs, the sigil, the skull and the tongue draw on every tier; glows, streaks and smoke thin with the density. |
| `basin_trash_art.ts` | The hunt's painted canvases: the quarry sigil (a bone plate with a war-paint raptor print and feathers) and the dread skull (a tusked troll skull in red paint, its sockets burning). |
| `basin_boss_bursts.ts` | `playBasinBossBurst`: the one-shot bursts of every boss `spellfx` event (cosmetic, through the host's pools and rings). |
| `gorgebloom_model_core.ts` | PURE: the Gorgebloom's Blender body measured (`scripts/assets/wildheart_gorgebloom`): drawn at its authored 13.75 yd with its waterline on the pivot, the maw, sacs and lash club sampled from the GLB at each contact frame, the clips' beats (every authored beat plus the GLB's one-frame `KEY_LEAD`), model space to the world. |
| `gorgebloom_fx_core.ts` | PURE: the bloom's body beats per trigger (a bar opening, a spellfx landing, the pull, the death), the cast rates that land each strike on its bar's end, the Vine Lash thorn wave's stations, the glow pulses of its gullet and sacs (`GORGEBLOOM_GLOW`, `characters/glow_pulse_core.ts`), its glow-only and Emerge gestures, the splash looks. |
| `gorgebloom_fx.ts` | `GorgebloomFx`: the bloom's body effects from its own anchors (the seed spit at the maw, Pollinate's four sac bursts, the lash club's slam and the thorn wave down the rest of the 30 yd lane, the Gorge bite, the spit's flash, the roar, the death: petals, the head crashing into the root pool, the sinking), a Thorn Sprout bursting from its pod (and the Emerge gesture offered until its view takes it), and the gestures that drive the model (never over a strike's play-out). |
| `lasher_model_core.ts` / `lasher_fx_core.ts` / `lasher_fx.ts` | The Snarlvine Lasher's and the Thorn Sprout's Blender bodies measured (`scripts/assets/wildheart_vine_lasher`), and the Lasher's Entangling Lash: the whip's tip on the lane where the model's own tip lands, then the thorn wave from the whip's end to the 20 yd lane end (it replaces the generic heavy bolt). |
| `basin_trash_model_core.ts` | PURE: the trash's Blender bodies measured (`scripts/assets/wildheart_basin_raptor` and its siblings): each drawn at its authored size over its sim scale (`trashLookHeight`), its gait refs and clip beats (the Basin Raptor's Pounce rate that lands its feet on the sim's flight end). `TRASH_BODY_HEIGHT` reads it, so the hunt's glows ride the real bodies. |
| `basin_thorns_core.ts` / `basin_thorns.ts` | The thorn spikes both lashes (and a sprout's shoots) tear up: one instanced draw, a fixed pool, the lane wave's stations and delays; lent through `BasinFxHost.thorns`. |
| `maw_glow_core.ts` / `maw_glow.ts` | The way out in the stone jaguar's maw: which `dungeon_exit` is the boss exit portal standing on the jaw (`JAGUAR_MAW` in the sim layout; the walkway into the mouth is a hidden field surface the head itself draws), the glow's rise and breathing, and its cards (jade halos from the throat, a gold bloom round the portal, pools on the jaw and the lip). Built with the interior at zero opacity on the braziers' programs; `WildheartFx` writes the opacity once the portal stands. |
| `basin_kit.ts` / `basin_kit_plan_core.ts` | The Blender kit (`public/models/props/wildheart_basin_kit.glb`) and its placements: every prop, the caldera ring, the gorge jungle, the pyramid, the jaguar head. Owned by the kit build (`docs/design/dungeon-rework/kit/build_wildheart_basin_kit.py`). |

The creature looks live in `../characters/wildheart_creature_looks.ts` (merged into the
manifest): the Great Saurian, the Great Jaguar, the Gorgebloom, the Snarlvine Lasher and the
Thorn Sprout, the Basin Raptor, the Spore Toad, the Sunbone Totem-Binder (his staff driven
into the earth on the Plant Totem bar's end) and the Fanglord Beastmaster (his Quake over its bar,
his WarCry and Ward gestures off `basin_fx.ts`) wear their Blender bodies; the rest of the
trash keeps tinted placeholders. The Snaring Tongue leaves the toad's own open mouth
(`TOAD_MOUTH`, measured off its Tongue clip). A fallen raptor's packmates scream into their frenzy (`RAPTOR_FRENZY_GESTURE`, the
Screech clip, sent by `basin_trash_fx.ts`).
The Sunbone Totem and its Dread Totem are rigged Blender posts that rise out of the ground
when planted (`TOTEM_RISE_GESTURE`, offered by `basin_trash_fx.ts`), flare on each mending
pulse (a gesture off `basin_fx.ts`) and rattle over the Rattling Dread's bar (the fx still crown
the Dread Totem with its red warning skull), the hunt's casts play existing clips on their rigs
(`TRASH_CAST_CLIPS`), and `form_toad` (the Spore Toad's own Blender body at a player's knee)
is the polymorph slot's other animal: a Toad Hex wears it, never the sheep
(`../characters/form_visual_selection_core.ts`, `../characters/form_rig_sync.ts`). The
Gorgebloom stands in a root pool on its dais (`basin_water.ts`, `GORGEBLOOM_ROOT_POOL`): its
model's origin is the waterline. It slews round to its target (`ClipMap.turn`,
`VisualDef.turnRate`), its three bars are bar-locked (`VisualDef.castClipSync`), and its
gullet and sacs glow from its own emissive map (`VisualDef.glowPulses`).

The boss layer is PLACEHOLDER: the art phase replaces looks, never sizes (those are the
sim's). Known gaps it owns: Zulgar's model must hide while `ZULGAR_VANISHED` holds (the
fx only throws smoke at the vanish and the landing, and the renderer still draws him),
the Avatar wants a real spirit-jaguar body over the glow, and the pods want a modelled
seed in place of the ovoid.

Rules:
- Cosmetic only: nothing here decides or hides an outcome. Spray, mist, motes, birds and the
  cosmetic bursts shed with the effects tier; telegraphs draw on every tier, in the shared
  threat palette, from the sim's own numbers.
- No new directional or hemisphere light: the afternoon is the `wildheartBasin` state of
  `../interior_light_rig.ts` (fog: `../fog_scene_state.ts`); point lights go through the
  fire-light sink only, at most eight live per light zone (pinned in the core test).
- Motion is shader-side on `sharedUniforms.uTime` (the fx module keeps its own clock); the
  gates write instance matrices only while they move, in a mesh `onBeforeRender` hook
  (pinned in `tests/point_light_carriers.test.ts`).
- Every material is built with the interior (attached through the renderer's compile gate)
  or in the fx root (attached through `attachSceneGroupGated`); module caches are marked
  shared so the interior sweep never disposes them.
- Floor marks sit on the floor ladder (`../floor_vfx_layer.ts`): brazier pools on `ground`,
  every telegraph and creature effect on `encounter` (`basin_fx.ts` and `basin_boss_fx.ts`
  both registered strict); the sky, water, falls and air are registered out of scope in
  `tests/floor_vfx_layer.test.ts`.

Tests: `tests/wildheart_basin_render_core.test.ts` (the cores),
`tests/wildheart_basin_trash_fx_core.test.ts` (the trash hunt and its pool sizes),
`tests/wildheart_basin_trash_fx.test.ts` (the trash painter: nothing minted after build, every
telegraph on every density, dispose ownership), `tests/form_toad_polymorph.test.ts`
(the toad form), `tests/wildheart_field_lights.test.ts`
(the light state), `tests/wildheart_basin_kit.test.ts` (the kit). Evidence:
`scripts/wildheart_basin_shot.mjs`.
