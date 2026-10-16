# src/render/gravewyrm_sanctum_fx: the Gravewyrm Sanctum's creatures and telegraphs

The creature half of the Ice Tomb of the Wyrm rework (`docs/design/dungeon-rework/
gravewyrm_sanctum.md` sections 5 and 8): the Sledge Tusker's sledge and body effects, every
trash telegraph and creature effect, hosted by `../rift_death_zone.ts` beside the other
dungeons' fx. The environment (terrain, sky, light rig, gates, the Calving Face) is
`../gravewyrm_sanctum/`'s; the three bosses' looks and fx are phase B's
(`../characters/sanctum_boss_looks.ts`). The sim mirrors only cast bars, facing, auras, spellfx
and encounter objects to the client, so everything here derives from those
(`src/sim/encounters/gravewyrm_sanctum/ids.ts`, `src/sim/mob/trash_kit/sanctum_cast_ids.ts`,
the templates in `src/sim/content/gravewyrm_sanctum.ts`).

| Module | Role |
|---|---|
| `index.ts` | Public surface: `SanctumFx`. |
| `tusker_model_core.ts` | PURE (`RENDER_PURE_CORES`): the Tusker's art-guide body measured (`models/creatures/woc_sanctum_tusker.glb`: 7.44 yd to the hump at its 2.8, drawn at its authored size; the clips' beats at 1x; the bar-locked clip rates; the footfalls), and the sledge prop (`sledge_tusker_sledge.glb`, its clips with the delivery's one-frame `KEY_LEAD`): its hitch 10.5 yd behind, the trailer drag (`trailSledge`), its states (`nextSledgeState`: hitched through the patrol AND the first half of the fight, tipped by the spill), the Tip clip's bowl landings and `bowlOffsets` easing each bowl onto the patch the sim lit for it. |
| `sanctum_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the palette (design section 8), the telegraph specs from the sim (Cinder Breath cone, Tusk Sweep cone 10 yd past the body, Trample lane and its painted length from the sim's own lane plan `planTrampleLaneWorld`, which ends it in a standing ice outcrop, the two kick glyphs), the object specs (the toss ring filling over the Hauler's bar, the soulfire patch standing for its 10 s), the soulfire and pyre flame ramps, the timelines, and `SANCTUM_DRAWN_HEIGHTS` (the height every body is drawn at, shared with the looks). |
| `sanctum_fx.ts` | `SanctumFx`, the coordinator: the floor telegraphs on the shared kit (`../floor_telegraph`), the encounter objects' edges and the soulfire burning inside a patch, the shock rings, the four particle pools (smoke, glow, soulfire and pyre flames) and the ice shards, lent to the layers through `sanctum_fx_host.ts`. |
| `tusker_fx.ts` | `TuskerFx`: the sledge (a gated clone of the GLB, Idle / Haul / Tip on its own mixer; hauled through the pull and dragged down every charge, slopping soulfire, tipped by the spill where it stands as its traces snap, re-hitched after a reset), the gestures the sim cannot play (Charge down the lane, Roar at the enrage, the trace chains' latch), and the body's weight on the ice (footfalls, the paws raking through the Trample warning, the sweep's spray, the charge's wake, the enrage's slam and glow, the death). |
| `tusker_bait_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the bait rework's plan. An outcrop's three looks off its template (`outcropPhase`), its shape (`OUTCROP_FANGS`: a cluster of fangs three players tall inside the body the sim tests) and its stump, the shove, shudder and cracks of an outcrop the tusks are buried in (`struckOutcrop`), an impact's flash, the gold window ring under a stuck Tusker (`stuckRing`, the Sunstruck ring's own law), the ring round a baited outcrop, the soulfire trail's life (`trailPresence`: it races down the lane, stands, gutters; its edge never fades early) and the pool sizes. |
| `tusker_bait_fx.ts` | `TuskerBaitFx` (composed by `SanctumFx`): the five ice outcrops (one faceted ice shader; whole, struck with cracks of light climbing it, a jagged stump), the warm pulse and the gold ring on the shared kit round the outcrop a painted lane will end in, the slam and the burst (flash, the shared ice shards, powder, the shock, the shake), the gold damage-window ring under a stuck Tusker with the frost off its tusks and its pawing (`TUSKER_STRAIN_GESTURE`), and the soulfire trail (its edge on the shared kit lane, a river of soulfire on the ice and walls of flame down and across it: separate noise-carved tongues on a burning bed, soul-green at the root and violet where they tear, drawn over (normal blending) so the overlapping walls keep their hue instead of adding up to white). Every one of those is a mesh built once whose state is a uniform: every tier; particles, shards and the cross walls' count thin with the density. |
| `tusker_aim_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the Trample readability pass's plan. The lane's answer (`trampleAimLook`: ice blue with an ice-shard cap while it would end in an intact outcrop, red with a plain arrowhead while not, locked with the sim's `trampleAimLocked`), where the cap stands (`trampleCapAlong`), each outcrop's floor circle (`outcropCircleLook`: lit all fight, pulsing through an aim, the aimed one hardest, white-blue while it holds, a dark dead disc inside a cold grey broken ring once burst), and the target marker (`targetMarkerMode`: a down arrow while the lane follows, side arrows once it locks; always `TARGET_MARKER_COLOR` gold, never the lane's colour; its height, size and distance scale). Never colour alone: every state is a shape too. |
| `tusker_aim_fx.ts` | `TuskerAimFx` (composed by `SanctumFx`, fed the Tusker and the outcrop slots by `TuskerBaitFx`): the outcrops' floor circles, the lane's end cap draped on the road, and the billboard marker plus feet reticle over the Trample's target (drawn over everything, kept a readable size from afar). Meshes built once under the gated root, state in uniforms: every tier. The lane's own colour is `sanctum_fx.ts` `paintLanes`, off the same plan, re-planned each frame as the lane follows its target. |
| `sanctum_trash_fx.ts` | `SanctumTrashFx`: the Warming Rite's soulfire tether, the Goad's spark stream and the goaded fury, the Soul Brazier's fire and pulse and the stoked motes, the Pyre-Tender's yoke fires, the Thawcaller's censer smoke, the Scaleguard's meltwater and its Cinder Breath torrent, the Ice Block Toss's block and crash, the Splinter's Shatter (it hides the corpse), the Hoarfrost Pop. |
| `sanctum_kit_fx.ts` | `SanctumKitFx`, the trash mechanics pass: Thaw the Held's soul tether, the corpse's cracks and the eruption column, the Counterweight Lash's tail sweep, the Branding Iron's spark stream and sear, the Rime Breath's puff, Fracture's split, and the toppled Soul Brazier (its standing body hidden by `BRAZIER_TOPPLED_GESTURE`, a fallen double drawn in its place). The pass's floor telegraphs (the lash cone behind the Scaleguard, the Rime Breath cone, the two kick glyphs) are rows of `sanctumTelegraphSpecs`. The engine pieces themselves (pools, the Ice Slab, freeze, brand, quench pools) are `../trash_engine_fx`'s. |
| `sanctum_shards.ts` | `SanctumShards`: one instanced draw of tumbling ice shards (and rune-iron flecks). |
| `sanctum_fx_host.ts` | `SanctumFxHost`: the type-only seam the coordinator lends its layers. |

The creature looks live in `../characters/sanctum_creature_looks.ts` (merged by the manifest):
the Sledge Tusker wears its Blender body; the trash are re-tinted shipped rigs (placeholders until
the art phase), every one drawn at its `SANCTUM_DRAWN_HEIGHTS` row, clearly past a player.

Rules:
- Cosmetic only: nothing here decides or hides an outcome. Telegraphs draw on every tier in the
  shared threat palette from the sim's own numbers; particles, glows and rings thin on the low
  tier (`density`).
- No light of any kind. Every material is built under the coordinator's root before its
  `attachSceneGroupGated`; the sledge, loaded later, attaches through its own gate.
- Floor marks sit on the floor ladder's `encounter` band (`sanctum_fx.ts`,
  `sanctum_trash_fx.ts`, `sanctum_kit_fx.ts`, `tusker_fx.ts`, `tusker_bait_fx.ts` and
  `tusker_aim_fx.ts` are registered strict in `tests/floor_vfx_layer.test.ts`).
- The ice shader cuts its facet normals from VIEW-space derivatives: a world position a
  hundred thousand yards from the origin has too few bits left for it, and the faces speckle.
- The story markers (`sanctum_story_*`) are empty anchors here (`../gate_objects.ts`): the
  Calving Face reads them; they never draw a body or a plate.

Tests: `tests/gravewyrm_sanctum_creatures.test.ts`, `tests/gravewyrm_sanctum_tusker_bait_fx.test.ts`
(the bait rework's plan and its painter on every density), `tests/gravewyrm_sanctum_tusker_aim_fx.test.ts`
(the readability pass's plan and its painter on every density). Evidence: `scripts/tusker_bait_shot.mjs`
(the bait rework), `scripts/sanctum_creatures_shot.mjs`
(it stands in a plain snowfield and a cold light when the environment is absent, capture only).
The Tusker's Blender builder lives outside the repo (`E:/woc/sanctum-work/tusker/builder`, its
delivery notes in `E:/woc/entregas/santuario/tusker/NOTAS.md`).
