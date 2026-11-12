# The raid's own trash and add bodies: sources

The fourteen bodies the blockout still borrowed (`public/models/creatures/heart_<name>.glb`, design
doc section 1's body rows), built the Quench's trash's way (`../quench_mobs_src/README.md`).
`sheet_<name>.webp` is each one's ChatGPT turnaround sheet as WebP; `prompts.json` holds every
sheet's exact prompt. The Tripo builds, the Blender files, the repainted atlases and the rig and
clip scripts stay local (`tmp/raid_mobs/`), like the Quench's.

| Mob | Template | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|---|
| Ring Forge Warder | `heart_ring_warder` | `sheet_ring_warder.webp` | `e0778009-9f57-4b1a-9eb9-334e042151fc` | 5000 | 110 |
| Breath Vein Warder | `heart_breath_warder` | `sheet_breath_warder.webp` | `3dca5d65-f25e-4e2b-b5ce-100313b50eed` | 5000 | 110 |
| Breath Vein Caller | `heart_breath_caller` | `sheet_breath_caller.webp` | `b270ed57-3181-4940-bb4e-4120b9a2fcd7` | 5000 | 110 |
| Gale Sentinel | `heart_gale_sentinel` | `sheet_gale_sentinel.webp` | `2e07fc46-de07-42d6-a1af-0ac3380fe10e` | 5000 | 110 |
| Gale Mender | `heart_gale_mender` | `sheet_gale_mender.webp` | `2bd74d39-a505-4479-beef-7b153ee9c1a6` | 5000 | 110 |
| Heat Vein Warder | `heart_heat_warder` | `sheet_heat_warder.webp` | `04b00037-6df7-4a73-bd8b-2fe5032315e3` | 5000 | 110 |
| Heat Vein Caller | `heart_heat_caller` | `sheet_heat_caller.webp` | `5cbc9bdf-bfc1-4069-b65a-f5c592e3b8cb` | 5000 | 110 |
| Wellspawn | `heart_heat_wellspawn` | `sheet_wellspawn.webp` | `16079821-92a3-4b0e-a12b-19149700bba1` | 4000 | 110 |
| Wellkeeper | `heart_heat_wellkeeper` | `sheet_wellkeeper.webp` | `0002ce1e-df1e-4e6c-8b4e-b60010705e9d` | 5000 | 110 |
| Seedflame | `heart_heat_seedflame` | `sheet_seedflame.webp` | `9994bf93-5e67-4d61-a69a-2a4f13c60d07` | 3000 | 110 |
| Splinter of the Hammer | `heart_final_splinter_hammer` | `sheet_splinter_hammer.webp` | `d76447b7-61c7-485f-b5b4-c214af68eb03` | 5000 | 110 |
| Splinter of the Breath | `heart_final_splinter_breath` | `sheet_splinter_breath.webp` | `eafa8d34-3b1e-4b88-b016-39c06094a9ff` | 5000 | 110 |
| Splinter of the Quench | `heart_final_splinter_quench` | `sheet_splinter_quench.webp` | `f817a7fe-2262-4d3c-8588-534df061b546` | 5000 | 110 |
| Splinter of the Heat | `heart_final_splinter_heat` | `sheet_splinter_heat.webp` | `4113c45a-654e-4bfd-b3a6-d104e25d09b1` | 5000 | 110 |

## The sheets

One new ChatGPT chat each, with the raid's own models attached for the body plan and the painted
style (an earth or ice body, the vein's guardian sheet, the vein's arena concept) and the Quench's
shared opening: one creature, FRONT, LEFT and BACK side by side on one ground line on flat dark
navy, orthographic, no text; and, for the 3D build, one solid connected body with no loose bits, no
particles and no wisps. Each subject then follows its vein: the Ring's grey-mauve dressed stone with
a rune per element; the Breath's storm slate with cyan lightning; the Heat's sooted basalt with
molten seams and a white-gold core (the Hearth's fire, the guardian's red-orange molten as accents).
The three other Splinters are the Hammer's sheet remade view for view in each vein's materials, so
the four share one body plan. Every sheet draws a true LEFT profile, so the split views went to
Tripo as front, left and back.

## The bodies

1. Tripo P2 multiview at the face limit above (about 2,900 to 5,500 triangles), faced to -Y, 2.2
   tall, its lowest point on the floor, welded.
2. Cut into plates, each plate one upright UV island; the Tripo paint carried across into a guide.
3. ChatGPT repainted each guide in a new chat with its sheet attached (the Quench's prompt: repaint
   image 1 in exactly the painted style and colours of image 2, keeping every shape where it is),
   each guide's own colours naming which part is which.
4. A glow map from each painting (the cracks, eyes, cores, crystals and fire hot, stone and slate
   unlit), both maps edge-padded from the mesh's own UV islands.
5. Rigged as rigid plates on one welded skin (every plate on one bone, only the seam vertices shared),
   every bone keyed in every clip at 24 fps: the earth warder's IK engine for the walkers, the float
   engine for the casters; the rises out of the floor ride the Root bone.
6. `slim_rig_source.mjs`, `build_assets.mjs` and `compress_glb_textures.mjs` from
   `scripts/assets/specs/heart_<name>.json`, keeping only the clips the game plays.
