# Orkadia Open World asset generation report

El proceso completo, las decisiones de diseño, los prompts reutilizables y el checklist para
futuros agentes están documentados en `docs/prd/orkadia-rework-playbook.md`.

Starting Tripo balance: 3850 credits (0 frozen)

Ending Tripo balance: 2660 credits (0 frozen)

| Name | Height | Prompt used | Concept image used | Job id | QA result | GLB byte size | Credit cost |
| --- | ---: | --- | --- | --- | --- | ---: | --- |
| orkadia_spiked_barricade | 2.2 | from provided concept image only | docs/screenshots/orkadia/concept/spiked-barricade.jpg | prop_orkadia_spiked_barricade_mrun772k | PASS | 55500 | 50 Tripo credits |
| orkadia_war_totem | 3.2 | from provided concept image only | docs/screenshots/orkadia/concept/orc-war-totem.jpg | prop_orkadia_war_totem_mruneeij | PASS | 74852 | 50 Tripo credits |
| orkadia_war_banner | 3.5 | from provided concept image only | docs/screenshots/orkadia/concept/orc-war-banner.jpg | prop_orkadia_war_banner_mrunjxjw | PASS | 59288 | 50 Tripo credits |
| orkadia_green_brazier | 1.6 | from provided concept image only | docs/screenshots/orkadia/concept/green-brazier.jpg | prop_orkadia_green_brazier_mrunnulk | PASS | 62064 | 50 Tripo credits |
| orkadia_skull_pile | 1.0 | from provided concept image only | docs/screenshots/orkadia/concept/skull-pile.jpg | prop_orkadia_skull_pile_mrunr2xp | PASS | 75952 | 50 Tripo credits |
| orkadia_weapon_rack | 2.0 | from provided concept image only | docs/screenshots/orkadia/concept/orc-weapon-rack.jpg | prop_orkadia_weapon_rack_mrunt60p | PASS | 63252 | 50 Tripo credits |
| orkadia_volcanic_cliff | 6.0 | from provided concept image only | docs/screenshots/orkadia/concept/volcanic-wall-texture.jpg | prop_orkadia_volcanic_cliff_mrunuog2 | PASS | 53812 | 50 Tripo credits |
| orkadia_war_gate | 7.0 | from provided concept image only | docs/screenshots/orkadia/concept/orkadia-portal-gate.jpg | prop_orkadia_war_gate_mrunwdqi | PASS | 59132 | 50 Tripo credits |
| orkadia_war_hall | 9.0 | from provided concept image only | docs/screenshots/orkadia/concept/war-hall-interior.jpg | prop_orkadia_war_hall_mrunxuu1 | PASS | 51588 | 50 Tripo credits |
| orkadia_skull_dais | 1.4 | from provided concept image only | docs/screenshots/orkadia/concept/dais-of-skulls.jpg | prop_orkadia_skull_dais_mrunzl23 | PASS | 63788 | 50 Tripo credits |
| orkadia_watchtower | 8.0 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_watchtower_mruo12dz | PASS | 67184 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_palisade | 3.0 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_palisade_mruo6yy8 | PASS | 61476 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_war_drum | 1.4 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_war_drum_mruocca7 | PASS | 63116 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_prisoner_cage | 2.6 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_prisoner_cage_mruohp77 | PASS | 66024 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_bone_throne | 2.8 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_bone_throne_mruon810 | PASS | 66576 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_torch_post | 2.4 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_torch_post_mruosijh | PASS | 55044 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_trophy_pole | 3.0 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_trophy_pole_mruox8wx | PASS | 62588 | 50 Tripo + 0.2115 USD (OpenAI concept) |
| orkadia_supply_crates | 1.2 | low-poly stylized classic-MMO orc war-camp prop, dark volcanic iron and wood, bone and skull motifs, toxic green accents | N/A (prompt only) | prop_orkadia_supply_crates_mrup2ore | PASS | 61960 | 50 Tripo + 0.2115 USD (OpenAI concept) |

## Full environment and creature rework, 2026-07-21

Starting Tripo balance: 2660 credits (0 frozen)

Ending Tripo balance: 1485 credits (0 frozen)

Total rework spend: 1175 Tripo credits. The API did not return per-task prices for these
jobs, so the audited balance delta is the authoritative total.

The rework used two environment targets: a top-down volcanic canyon blockout and a gameplay
view of a storm-dark orc fortress with terraced camps, fel fissures, basalt walls, and a broad
boss plateau. Individual prop concepts were isolated on a neutral studio background before
image-to-model generation. All creature concepts requested a front-facing, full-body, strict
T-pose with empty hands so Tripo could produce clean biped skinning.

| Name | Height | Role and concept prompt summary | Job id | QA result | Final GLB bytes |
| --- | ---: | --- | --- | --- | ---: |
| orkadia_volcanic_cliff | 22 | Tall modular black-basalt cliff rib with restrained green cracks | prop_orkadia_volcanic_cliff_mrv0ufzb | PASS | 56172 |
| orkadia_palisade | 5 | Heavy timber and iron palisade wall with tusks and red hide | prop_orkadia_palisade_mrv0ufzj | PASS | 80536 |
| orkadia_war_gate | 12 | Orc gatehouse bastion with basalt, timber, skulls, and green braziers | prop_orkadia_war_gate_mrv149ys | PASS | 94840 |
| orkadia_war_hall | 20 | Multi-tier warlord fortress with towers, spikes, and fel furnaces | prop_orkadia_war_hall_mrv0ufzr | PASS | 86640 |
| orkadia_war_tent | 6.5 | Round hide war tent reinforced with tusks, bone, and iron | prop_orkadia_war_tent_mrv0ufzf | PASS | 68216 |
| orkadia_catapult | 4.5 | Chunky orc siege catapult with timber frame and iron spikes | prop_orkadia_catapult_mrv149yk | PASS | 97396 |
| orkadia_axethrower | 2.4 | Lean Bloodtusk scout with throwing axes strapped flat across the back | creature_orkadia_axethrower_mrv14kn5 | PASS, 41 joints, 8 clips | 1123436 |
| orkadia_fel_shaman | 2.4 | Ashenbone caster with skull headdress, split robes, and fel runes | creature_orkadia_fel_shaman_mrv14kn1 | PASS, 41 joints, 8 clips | 1194080 |
| orkadia_beast_handler | 2.5 | Broad Ironhide beastmaster with fur mantle, fangs, and chain coils | creature_orkadia_beast_handler_mrv14kn6 | PASS, 41 joints, 8 clips | 1235432 |
| orkadia_siege_brute | 2.9 | Elite shock trooper in black basalt plate with toxic-green cracks | creature_orkadia_siege_brute_mrv14kn8 | PASS, 41 joints, 8 clips | 991528 |
| orkadia_banner_captain | 2.7 | Elite commander in dark lamellar armor with a crimson cape and back banner | creature_orkadia_banner_captain_mrv14kn8 | PASS, 41 joints, 8 clips | 1169936 |

Every new creature ships `Idle`, `Walk`, `Run`, `Attack`, `Hit`, `Death`, `Cast`, and
`Jump`. Each clip was reviewed from the final rig preview. The five `Death` clips are real
retargeted collapses and do not use the old procedural T-pose fall.

All six reworked props were recompressed with Meshopt after application. They use WebP
textures, require no Draco extension, and stay inside the 40 to 100 KB prop budget. The gate
generator repeatedly placed a closed leaf in the arch, so the renderer uses the approved
gatehouse as mirrored outer bastions around a genuinely clear center passage.

## Hard won notes
- QA initially reported no local preview rendering available for some early runs, which blocked PASS checks. The fix was to set `BROWSER_PATH` to a local Chromium binary and run `pipeline.mjs preview --file ... --out ...` before re-running QA.
- `orkadia_war_hall` was under the 40 KB minimum after first optimization. I regenerated it from the job raw GLB with `--texture-compress webp --compress meshopt --texture-size 512 --simplify-ratio 1` and replaced the applied GLB with the resulting file so it is now 51588 bytes.
- All props were verified as meshopt-compressed (no Draco extension detected) and all QA results are PASS.

## Applied summary
- Applied props: 24 total, including 6 structural rework assets.
- Applied creatures: 5 new biped specialists with complete eight-clip sets.
- Skipped props: none.

## Third-party IP remediation, 2026-07-27

`orkadia_war_drum` shipped with a recognisable third-party faction crest baked into its base
colour map: the generator painted it onto the drum skin, and the prop-QA pass (silhouette,
budget, meshopt, bounds) had no step that looked at what the texture actually depicted. Three
drums are placed in the camp (`src/sim/orkadia_field.ts`, local -43/80, 31/121, 34/154), so it
was visible on every run.

Fixed in place rather than regenerated, so no Tripo credits were spent and the mesh is
untouched:

- The drum skin was resynthesised from the prop's own clean outer band. A 2D quadratic fitted
  to the band carries the lighting falloff, and two octaves of fixed-seed value noise put the
  hide grain back, so the head reads as plain stretched hide instead of a patched disc.
- The emblem left a faint imprint in the normal map too; the same ellipse was flattened to the
  band average there. The ORM map never carried it.
- The mesh, UVs, ORM map, materials, and all three required extensions
  (`EXT_meshopt_compression`, `EXT_texture_webp`, `KHR_mesh_quantization`) are unchanged. Only
  the two image payloads were swapped, with every meshopt blob copied byte-for-byte and its
  offset shifted. GLB 63116 to 65456 bytes, still inside the 40 to 100 KB prop budget.
- The other 19 Orkadia props were swept the same way (base colour maps inspected at full
  resolution). They are clean: the marks on `orkadia_prisoner_cage` are hide weathering and the
  `orkadia_war_banner` motif is an original orc skull-and-fist.

Before and after, from `pipeline.mjs preview`, plus an in-game capture of the reworked drum
in the camp: `docs/screenshots/orkadia/ip-fix/`.
