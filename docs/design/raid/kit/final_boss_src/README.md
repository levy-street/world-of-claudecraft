# The Masterless Strength: sources

The Smith's Heart final boss's body (`public/models/creatures/smith_heart_masterless_strength.glb`,
design doc sections 5.17 and 7.5), rebuilt on 2026-11-26 as the four-element titan: one rigged mesh in
five paintings. `sheet_four.webp` is the owner's approved ChatGPT turnaround sheet (FRONT, LEFT, BACK),
the one the mesh is built from; `sheet_hammer.webp`, `sheet_breath.webp`, `sheet_heat.webp` and
`sheet_quench.webp` are the same body with one element over the whole of it; `prompts.json` holds every
sheet's exact prompt. The Tripo builds, the Blender files, the paintings at full size and the rig and
clip scripts stay local (`tmp/final_boss/`, its `README.md` has the rerun commands), like the raid's
other bodies (`../raid_mobs_src/README.md`).

| What | Sheet | Tripo Studio task | Setting | Credits |
|---|---|---|---|---|
| The mesh (candidate 1 of 4) | `sheet_four.webp` | `feab44e2-ce6d-4e0a-a516-7627fc09ac40` | Smart Mesh, P2.0, triangles, polycount 5000 | 100 |
| The base form's painting | `sheet_four.webp` | `af7e8419-7341-4ebb-b6d3-756818c64d14` | texture pass | 30 |
| The four element paintings | the four element sheets | the same model, one texture pass each | texture pass, 2K | 10 each |

## The sheets

One ChatGPT chat, with three of the raid's own images attached for the painted style and the body
plan: the raid's earth and ice bodies, the Splinter of the Hammer's sheet (the Splinters are fragments
broken off this titan, so it is their whole) and the Heart's arena concept (the Anvil's four-armed
spiral). The base form is quartered between the four elements round a white-gold heart crystal: its
right arm the Hammer's gold-ochre granite, its left the Quench's glacier ice, its right leg the Heat's
molten basalt, its left the Breath's storm slate; a crown of four crystal tines, a stone halo ring with
a crystal per element, a spine of crystals. The four element sheets are that sheet remade view for view
with one element over all of it.

## The body

1. Tripo Studio, multiview (front, left, back) on the Smart Mesh tab: P2.0, triangle topology,
   polycount 5000, four candidates for the one price; candidate 1 kept (about 5,500 triangles).
2. Cut into rigid plates, each wholly on one bone (the halo and the spine's crystals ride the chest,
   the crown the head), on one welded skin with only the seam vertices shared, under one root bone.
3. One UV layout for every form, an island per plate.
4. Five paintings on that layout. Each is a Tripo texture pass over the same mesh from that form's own
   sheet, carried across triangle for triangle, with the sheet's own back view laid over the
   back-facing surface (and, for the base form, its front view: the sheet the mesh was built from) and
   its lightness matched to the sheet. Each has its own glow map (the heart, the crystals, the veins and
   seams, the eyes; the Quench's ice keeps a soft inner light and its crack lines are held down, so the
   cold never reads as the Breath's lightning).
5. Its clips at 30 fps on the first model's beats (`final_body_core.ts` `FINAL_BODY_CLIP`, read off
   the GLB by `tests/smith_heart_final_body_clips.test.ts`), every bone keyed in every clip: Idle, Walk,
   Attack, Slam, Wrath, Pour, Shift, Hit, Kneel, KneelIdle, Death, and the arrival's Dormant and Rise,
   authored on the rig. Two were added after the owner's first playtest (2026-11-26): Attack2, a low
   backhand of the left fist on the Attack's beat, so its swings alternate two blows; and Channel, the
   loop Call of the Quarters holds (braced wide, hauling strength up and driving it back down), where
   the generic cast clip, a throw, had been hurled over and over through the forty-second call. The kneel folds the chest well down and forward, so the heart's and the eyes'
   anchors have their own kneeling places (`FINAL_BODY_KNEEL_ANCHORS`).
6. Shipped as five mesh nodes over ONE set of vertex data and one skin, a material per form (the
   renderer's mesh toggles show one), through `slim_rig_source.mjs`, `build_assets.mjs` and
   `compress_glb_textures.mjs` from `scripts/assets/specs/smith_heart_masterless_strength.json`. A form
   change swaps the painting and its glow map, never the model. The four element nodes carry the node
   extra `wocHiddenForm`, so a viewer that drives no toggles (the wiki's turntable and stills, the mob
   portrait baked from them: `src/guide/viewer/model.ts` `hideAlternateForms`) shows the base form
   alone, never a form picked by the order its textures happened to decode in.
