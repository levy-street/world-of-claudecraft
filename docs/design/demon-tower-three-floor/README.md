# Demon Tower: three-floor overhaul

The tower is one permanent landmark and exactly three authored raid floors. It
uses the existing deterministic rift instance/runtime, but the environment,
terrain silhouette, hazards, formations, boss and lighting grade come from one
floor registry (`src/sim/rift/tower_floors.ts`).

## Content contract

| Floor | Terrain and ambience | Encounter identity | Boss |
|---|---|---|---|
| The Bloodforge | octagonal black-iron forge, slag lanes, brass channels, warm enclosed vault | alternating forge rings, herald kill order, moving around molten lanes | Cinderax, the Ash Tyrant |
| The Ossuary of Chains | concave bone-cathedral cross, soul chasms, violet/cyan vault | four-arm assaults, healer priority, constrained bridge control | Ghol the Flesh-Shaper |
| The Void Crown | five-petal shattered crown, void fractures, open storm dome | rotating sectors, Vaskar lieutenant phase, full four-mechanic climax | Malgrath, the Tower Unbound |

Acceptance is executable: exactly three profiles; unique polygon/style/hazard and
encounter signatures; one boss per floor; only floor three owns the run-clear
boss slot; deterministic plans; no spawn overlaps with the core, hazards or solid
decor; and floor/backdrop/hazard/landmark information preserved in low graphics.

## Asset wave

The overhaul ships 50 Tower GLBs: the existing 20 animated mobs and 15 original
props/core, plus 15 new hero/modular props (five per floor). The new props were
generated through the repository's Tripo v3.1 hifi lane, stopped for four-angle
review, normalized to authored world heights, structurally QA'd, meshopt encoded,
then converted to KTX2. The original 35 assets received the same meshopt/KTX2
release maintenance pass without simplifying rigs.

The selected concepts are under `references/`; `generated-prop-contact-sheet.png`
is the accepted final-model review. Exact prompts, Tripo task IDs, costs and final
SHA-256 seals are in `provenance.json`. Generated references and models are
project assets; no third-party reference art was used. The Tripo API credential
was process-local and is not recorded in any file.

## Performance and fairness

- Decor loading is key-scoped to the current floor rather than loading every
  authored-rift prop.
- KTX2 removes the prior 105 MiB decoded-RGBA amplification from the 35 original
  Tower GLBs; meshopt is retained after transcoding.
- Low graphics keeps the authored floor silhouette, opaque color, backdrop,
  hazards and landmark bodies. Extra point lights and floating storm shards are
  cosmetic only.
- Curated packs top out below the live-demon cap, replacing the old 14-body wave
  wall that occluded the camera.

## Regeneration

New props are regenerated with `scripts/asset_pipeline/pipeline.mjs prop`, using
the options in `provenance.json`; every job must end in `qa --job`. The original
asset meshopt maintenance spec is `scripts/assets/specs/demon_tower.json`.
After any model change, run `compress_glb_textures.mjs`, regenerate the media
manifest, inspect the in-game floor on desktop and mobile landscape, then run the
Tower-focused tests and repository gate.
