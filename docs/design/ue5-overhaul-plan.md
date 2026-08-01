# UE5-Style Asset & Graphics Overhaul — Master Plan

Branch: `feature/ue5-asset-overhaul`. Goal: replace 100% of the procedural assets with
open-source (CC0/MIT) asset packs + skeletal animation + modern rendering (IBL, PBR
terrain, real post), while keeping the sim layer untouched and the low-gfx tier alive.

Scout reports (full detail): `/tmp/scout/{u_chars,u_env,u_pipeline,u_build,r_chars,r_env,r_tex,r_tools}.md`
(session-local; key facts captured here).

## Art direction

Stylized hand-painted low-poly axis: **KayKit** (humans/undead/dungeons) + **Quaternius**
(creatures/nature/village) + **Kenney** (structural fill: cliffs, docks, castle, graveyard,
fantasy-town clutter, particles) + **ambientCG/Poly Haven** (terrain PBR + HDRI sky/IBL).
All CC0 except three.js water normals (MIT). Attribution in `CREDITS.md` (courtesy).

## Asset sources (all verified 2026-06-11; licenses read at source)

| Pack | Use | Method |
|---|---|---|
| KayKit Adventurers 1.0 (GitHub `KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0`) | players, NPCs, bandits/cultists; 25 glTF weapons; 76 clips | git clone |
| KayKit Skeletons 1.0 (same org) | undead; 95 clips, same 41-joint rig (`hips`, `handslot.l/r`) | git clone |
| KayKit Dungeon Remastered 1.0 (same org) | dungeon modular kit (~200 glb) | git clone |
| KayKit Halloween Bits 1.0 (same org) | graves, crypts, coffins, dead trees, lanterns | git clone |
| Quaternius creatures (animals/monsters/dinos/52-char packs) | wolf, bull(boar), goblin(kobold), orc(troll), yeti(ogre/bear), goleling(elemental), dragon(wyrm), ghost, zombies, alpaca(polymorph), raptor | per-model GLB scrape from poly.pizza model pages → `https://static.poly.pizza/<uuid>.glb` (license shown per page — only take CC0/Public Domain ones) |
| Quaternius Stylized Nature MegaKit (itch, free Standard tier) | trees all 3 biomes, rocks, bushes, mushrooms, grass | itch anonymous flow (csrf → /download_url) or poly.pizza bundle scrape |
| Quaternius Medieval Village Pack (poly.pizza bundle `Medieval-Village-Pack-NsHhjhlrfY`) | 39 whole buildings: house, inn, blacksmith, well, market stand, cart, fences | poly.pizza scrape (<5MB total) |
| Quaternius Fantasy Props MegaKit (itch free) | barrels, crates, lanterns, clutter | itch anonymous flow |
| Kenney Nature Kit / Graveyard 5.0 / Pirate / Fantasy Town 2.0 / Castle kits | modular cliffs, iron fences+crypts, docks/rowboats, stalls/fountains, fortress walls | `curl -LO https://kenney.nl/media/pages/assets/<kit>/<hash>/<file>.zip` (hash can rot → fall back to scraping the asset page) |
| Poly Haven HDRIs: `kloofendal_48d_partly_cloudy_puresky` (vale day), `belfast_open_field` (marsh overcast), `kiara_1_dawn` (peaks golden hour), `dikhololo_night` (spare) | IBL + sky | `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/{1k|2k}/{id}_{res}.hdr` (md5 via `api.polyhaven.com/files/{id}`) |
| ambientCG: Grass001, Ground023 (dirt), Rock051 (cliff), Ground071 (swamp mud), Ground080 (sand), PavingStones046 (cobble), Snow010A | terrain splat PBR (1K) | `https://ambientcg.com/get?file={ID}_1K-JPG.zip` |
| three.js r165 `waternormals.jpg`, `water/Water_1_M_Normal.jpg`, `Water_2_M_Normal.jpg` | water | raw.githubusercontent pinned to r165 tag (MIT) |
| Kenney Particle Pack | spell/fire/smoke/impact sprites (cherry-pick ~20) | direct zip |
| npm: `@gltf-transform/cli@4.4.0` (MIT), `n8ao@1.10.1` (ISC) | pipeline + SSAO | npm i; meshopt decoder bundled in three (`three/addons/libs/meshopt_decoder.module.js`) |

Rejected: Mixamo (Adobe), Sketchfab (login wall), postprocessing@6.39+ (needs three≥0.168;
we stay on the stock composer + N8AOPass instead), Draco (meshopt better for animation-heavy
low-poly), KTX2 for HDR (r165 can't transcode HDR), OGA spiders (CC-BY .blend only).

## Visual mapping (sim untouched — keys stay `e.kind` + `e.templateId` + family)

Players (KayKit Adventurers char + KayKit weapon glTF on `handslot.r/l` + class tint):
warrior=Knight+sword+shield · paladin=Knight gold+mace+shield · hunter=Barbarian+crossbow ·
rogue=Rogue+dual daggers · priest=Mage white+staff · shaman=Barbarian blue+mace ·
mage=Mage+staff · warlock=Mage purple+staff · druid=Mage green+staff.

Mob families: beast→Quaternius Wolf (tints; `wild_boar`→Bull 0.85 brown) ·
spider→best 8-legged in monster listing, fallback Crab tinted dark-purple ·
murloc→swampy biped pick (fallback Goblin teal) · kobold→Goblin brown ·
humanoid→KayKit (bandit/cultist=Rogue_Hooded, casters=Mage, bruisers=Barbarian/Knight) ·
undead→KayKit Skeletons (Minion/Warrior/Rogue/Mage by template; use `Skeletons_Awaken_*` for spawns) ·
troll→Orc green · ogre→Yeti flesh-tint (or pack Ogre if present) · elemental→Goleling_Evolved ·
dragonkin→Dragon_Evolved (flying clip set) · polymorph→Alpaca · bear form→Yeti dark brown.
18 NPCs: Knight (marshal/warden/captain), Mage (brother_aldric*), Barbarian (smith/armorer),
Rogue +crossbow (scouts), unhooded Rogue civilians (traders etc).

## Architecture (contracts to honor — from scout reports)

- **Sim stays three/DOM/fetch-free** (bundled into vitest, dist-env, dist-server).
- **Conventions**: facing 0=+Z, pivot at feet, humanoid height 2.6u, `e.scale` applied once
  at createView, nameplate anchor = `height*scale+0.5`, attack = `damage` event with
  school 'physical', swim derived renderer-side, death is a level not an edge (need local
  edge trigger for the death clip; corpse stays pickable).
- **New modules**: `src/render/assets/loader.ts` (GLTFLoader+meshopt+RGBELoader, cache,
  refcounted), `src/render/assets/manifest.ts` (key→url+clips+tint+scale),
  `src/render/characters.ts` (replaces models.ts dispatch; SkeletonUtils.clone + per-instance
  AnimationMixer; state machine from existing sync-derived state: speed/dead/casting/
  swimming/sitting/form). Keep `Rig`-shaped return (body/parts/kind/height) where cheap.
- **Preload**: `await preloadAssets()` in `startGame` (main.ts:25) before `new Renderer`;
  set a readiness flag for probes. `initGfxTier` must still run right after WebGLRenderer
  creation, before any scene build.
- **Disposal**: `removeView` (renderer.ts:908-928) must stop disposing shared geometry —
  dispose only per-instance clones/mixers.
- **LOD**: articulated shadows <25u; 25-62u shadow proxy + >50u far LOD get **idle-pose
  baked static meshes** (bake once per asset via SkinnedMesh.applyBoneTransform).
  Distance-tiered mixer updates (near=every frame, mid=2-3, far=4 with compensated delta).
- **Foliage**: keep InstancedMesh bucketing/wind/fog-cull; swap geometry+materials for glTF
  extracts. Trees authored base-y=0; wind weights by smoothstep(y) so single-mesh trees are
  OK. `instanceColor` tints fight textured materials → soften tints toward white.
- **Props**: keep `PropsResult { group, flames[], fireLights[], update() }` contract.
  Repeated kinds (tents/crates/campfires/headstones/columns/fences) → InstancedMesh per
  part×z-band like foliage; one-offs merged per material. **Scale assets to existing
  collider footprints** (building w×d, tent r1.5, crate 0.65, campfire 0.85, mudHut 1.1,
  ruin column 0.6, trunk 0.55×scale, rock 0.7×scale) — do not move placements.
- **Dungeons**: rebuild crypt+sanctum from KayKit Dungeon kit on a grid-layout data file
  (plain data) consumed by BOTH the render builder and regenerated
  `CRYPT_COLLIDERS`/`SANCTUM_COLLIDERS`. Sunken Bastion gets its own look (today it
  reuses crypt geometry). Keep torch budget (`budgetFireLights`, max 6 point lights).
- **Terrain**: rewrite splat onBeforeCompile for real albedo+normal layers (1K ambientCG),
  remove the mid-gray ×2.0 hack, blend vertex hue gently. Keep low-tier Lambert path.
- **Sky/IBL**: sky dome shader samples real HDRI equirect (blend 2 textures across biome
  transitions); `scene.environment` = PMREM per biome HDRI, eased intensity; keep dungeon
  overrides. Keep ACES + existing bloom economy (do NOT switch to AgX — retune cost).
- **Post**: stock EffectComposer + insert N8AOPass (n8ao) at high+ultra; keep
  UnrealBloom + GradePass. Low tier: no composer (unchanged).
- **Low tier must keep working**: same glTF assets with Lambert-converted materials, no
  shadows/composer/wind; headless probes force `?gfx=high|ultra` on SwiftShader.

## Pipeline (scripts/assets/)

Raw downloads → `tmp/asset_src/` (gitignored). Node scripts using @gltf-transform:
strip animation clips to keep-list (KayKit chars: ~18 of 76-95 clips; clips live ONCE in a
shared `kaykit_anims.glb`, character GLBs stripped to 0 clips — same rig, bind by name),
prune/dedup, meshopt-compress (`--level high`; for chars NO join/flatten/simplify/palette),
resize textures (512 char atlas, 1024 props). Output → `public/models/`, `public/env/`,
`public/textures/`, `public/vfx/` (NOT public/assets/ — collides with vite dist/assets).
Budget: ≤120MB total in public/.

## Infra changes

Dockerfile: `COPY public ./public` before build. Add `.dockerignore` (node_modules, tmp,
dist*, .git, python, docs). server/main.ts: add MIME for .glb/.gltf/.hdr/.ktx2/.bin/.wasm;
SPA fallback → 404 for extension-bearing asset paths. Keep-list of probe gotchas:
networkidle0 + 30s timeout in tour_expansion.mjs (asset fetches extend boot), 2500ms
SwiftShader settle, `window.__game.sim.player` wait.

## Execution order

1. ✅ Scout + research (workflow wf_a4ed3714-ee6)
2. Acquisition workflow (parallel: KayKit clones / Quaternius scrapes / Kenney+tex+HDRI
   curls) → optimize scripts → public/ + manifest + CREDITS.md
   — meanwhile inline: infra edits + extract `src/render/dungeon.ts` (verbatim move of
   buildCrypt/buildSanctum/dungeonPillar/addDungeonTorch/addTorchGlow) so later phases
   touch disjoint files
3. Characters phase (models.ts → characters system + renderer seams: createView, sync
   animation block, removeView, LOD/shadow proxies, weapon attachments)
4. Parallel: foliage+props phase · dungeons phase (dungeon.ts + collider regen) ·
   rendering phase (terrain splat, HDRI sky/IBL, water normals, N8AO)
5. Verify: 89 vitest, tour_expansion ultra screenshots all zones+dungeons, gfx_probe
   draw/tri counters vs <300 draws budget, lowgfx sanity, multi-agent review, fix, commit.

## Verification commands

`npm test` · `npm run dev` then `GFX_TIER=ultra node scripts/tour_expansion.mjs` ·
`node tmp/gfx_probe.mjs <label> ultra` · single shot: `node tmp/gfx_one.mjs town 2 -2 0.5 ultra`.
Known flake: mp_combat_visibility.mjs (SwiftShader timing). crypt_raid.mjs needs
`PORT=8788 ALLOW_DEV_COMMANDS=1 node dist-server/server.cjs`.
