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
| `tusker_model_core.ts` | PURE (`RENDER_PURE_CORES`): the Tusker's Blender body measured (`models/creatures/sledge_tusker.glb`: 7.76 yd to the dome at its 2.8, drawn at its authored size; the clips' beats with the GLB's one-frame `KEY_LEAD`; the bar-locked clip rates; the footfalls), and the sledge prop (`sledge_tusker_sledge.glb`): its hitch 10.5 yd behind, the trailer drag (`trailSledge`), its states (`nextSledgeState`: hitched, dropped at the pull, tipped by the spill), the Tip clip's bowl landings and `bowlOffsets` easing each bowl onto the patch the sim lit for it. |
| `sanctum_fx_core.ts` | PURE (`RENDER_PURE_CORES`): the palette (design section 8), the telegraph specs from the sim (Cinder Breath cone, Tusk Sweep cone 10 yd past the body, Trample lane and its painted length recomputed from the instance-local start with the sim's own `trampleReach`, the two kick glyphs), the object specs (the toss ring filling over the Hauler's bar, the soulfire patch standing for its 10 s), the soulfire and pyre flame ramps, the timelines, and `SANCTUM_DRAWN_HEIGHTS` (the height every body is drawn at, shared with the looks). |
| `sanctum_fx.ts` | `SanctumFx`, the coordinator: the floor telegraphs on the shared kit (`../floor_telegraph`), the encounter objects' edges and the soulfire burning inside a patch, the shock rings, the four particle pools (smoke, glow, soulfire and pyre flames) and the ice shards, lent to the layers through `sanctum_fx_host.ts`. |
| `tusker_fx.ts` | `TuskerFx`: the sledge (a gated clone of the GLB, Idle / Haul / Tip on its own mixer; latched where the beast stood on its first engaged frame, tipped by the spill, re-hitched after a reset), the gestures the sim cannot play (Unhitch at the pull and the trace chains' latch, Charge down the lane, Roar at the enrage), and the body's weight on the ice (footfalls, the paws raking through the Trample warning, the sweep's spray, the charge's wake, the enrage's slam and glow, the death). |
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
  `sanctum_trash_fx.ts`, `sanctum_kit_fx.ts` and `tusker_fx.ts` are registered strict in
  `tests/floor_vfx_layer.test.ts`).
- The story markers (`sanctum_story_*`) are empty anchors here (`../gate_objects.ts`): the
  Calving Face reads them; they never draw a body or a plate.

Tests: `tests/gravewyrm_sanctum_creatures.test.ts`. Evidence: `scripts/sanctum_creatures_shot.mjs`
(it stands in a plain snowfield and a cold light when the environment is absent, capture only).
The Tusker's Blender builder lives outside the repo (`E:/woc/sanctum-work/tusker/builder`, its
delivery notes in `E:/woc/entregas/santuario/tusker/NOTAS.md`).
