# Wolf rig

Rebuilds the two wolf creature files on a skeleton fitted to each body, with new skin
weights and every clip carried over from the old dog rig and finished here (planted
paws, nothing through the floor, a tail that trails the body, moving ears). The mesh,
UVs and texture are kept exactly as they shipped; only the skeleton, the weights and
the clips change.

| File | Drawn as |
|---|---|
| `public/models/creatures/wolf_basic.glb` | the pack wolves (`mob_wolf`, also the beast-family fallback) and the shaman's Shadewolf form (`form_ghost_wolf`) |
| `public/models/creatures/greyjaw.glb` | Old Greyjaw and the first Stampede beast (`greyjaw`) |

All of them play one clip set (`WOLF_BAKED` in `src/render/characters/manifest.ts`),
Greyjaw included: his old bespoke attack (a sit-down howl into a lunge, from its own clip
file) was dropped with this rebuild, so he bites like the pack.

## Modules

| File | Job |
|---|---|
| `anatomy.py` | one joint table per wolf (`MODELS`), measured off the body; bone roles and the shoulder fade bounds |
| `rig.py` | the armature and the skin weights (bone heat on a welded copy, loose pieces rigid, the shoulder fade) |
| `motion.py` | carries each old clip onto the new skeleton and plants the paws (leg solver, contacts, floor checks against the blended skin) |
| `layers.py` | the tail and the ears, authored over the carried body |
| `clips.py` | every clip the wolves ship and its layer settings; the clip names are the game's contract (`WOLF_BAKED` in `src/render/characters/manifest.ts`) |
| `animate.py` | builds every clip: transfer, plant, layers |
| `build.py` | the Blender entry point: rig, weights, clips, raw GLB export |
| `to_blender.mjs` | a Blender-readable copy of a shipped GLB (KTX2 to PNG, meshopt and quantization undone) |
| `ship.mjs` | raw export to game file: the shipped KTX2 texture back byte for byte, meshopt, and read-back checks (clip set, joints, weights, codec, compression drift) |
| `contract.mjs` | what the rig ships and the game relies on: the files, the clip names, the loops, the joint names, the hit react cap, the floor tolerance, each wolf's on-screen scale (`ship.mjs` and `tests/wolf_rig.test.ts` both read it) |
| `skin_pose.mjs` | skins a wolf GLB at any clip time with glTF math, as three.js does, binding a clip by joint name (`clip_check.mjs` and the test) |
| `clip_check.mjs` | frame-by-frame floor and flick report for one clip (`--donor` for a clip from a mesh-free file) |

## Rebuild

Run from the repo root in Git Bash (PowerShell's `>` re-encodes binary output). Needs
Blender 5.x and KTX-Software 4.3+ (`ktx` on PATH, or `KTX_BIN` pointing at its `bin/`).
The old dog-rig files are the source of both the body and the motion:

```bash
m=wolf_basic   # or greyjaw
mkdir -p tmp/wolf_rig
git show e201d764db:public/models/creatures/$m.glb > tmp/wolf_rig/${m}_dogrig.glb
node scripts/assets/wolf_rig/to_blender.mjs tmp/wolf_rig/${m}_view.glb tmp/wolf_rig/${m}_dogrig.glb
blender -b --factory-startup --python scripts/assets/wolf_rig/build.py -- \
  --model $m --body tmp/wolf_rig/${m}_view.glb --ref tmp/wolf_rig/${m}_view.glb \
  --out tmp/wolf_rig/${m}_raw.glb --blend tmp/wolf_rig/$m.blend
node scripts/assets/wolf_rig/ship.mjs tmp/wolf_rig/${m}_raw.glb tmp/wolf_rig/${m}_dogrig.glb \
  public/models/creatures/$m.glb
```

`e201d764db` is the last commit that shipped the old rigs. The raw export
(`tmp/wolf_rig/<model>_raw.glb`) opens in any glTF viewer, so it doubles as the preview
file. Then, for the game:

1. `node scripts/build_media_manifest.mjs generate` (the preload hashes).
2. Sizing. The game scales a creature so its Idle's skinned height (`prepareVisual` in
   `src/render/characters/assets.ts`, measured the same way by `idleHeight` in
   `skin_pose.mjs`) matches the `VisualDef.height`. `tests/wolf_rig.test.ts` pins each
   wolf's height over that raw height to `WOLF_ON_SCREEN_SCALE` (`contract.mjs`), the size
   it has always been drawn at; if a rebuild changes the raw idle height, set the height to
   that scale times the new raw height.
3. The wiki: `npm run wiki:content` (its model table carries the heights), then
   `ONLY=mob_wolf,greyjaw npm run wiki:stills` (the guide's pictures of both).
4. Portraits. The mob portrait ledger pins every portrait to its model's bytes. Re-render
   the wolves with `scripts/render_finder_portraits.mjs` (`ONLY=<mob ids>`,
   `PORTRAIT_RECEIPT=<file>`), then
   `node scripts/build_mob_portrait_source_manifest.mjs --write --receipt <file>`, and
   refresh the ledger's pin in that folder's `accepted-art.json` (`sourceManifests`).
5. Checks: `tests/wolf_rig.test.ts`, `tests/anim_pipeline_greyjaw.test.ts`,
   `tests/character_clipmaps.test.ts`, `tests/guide.test.ts`, the portrait ledger tests,
   then a look in game.

## Checking a clip

```bash
node scripts/assets/wolf_rig/clip_check.mjs public/models/creatures/wolf_basic.glb Gallop
```

prints, every frame, the lowest point of each leg region (paw soles, the lower limbs,
the body, the tail) and the biggest single joint turn that frame. The ground is where
the game stands the wolf (the Idle's lowest point when `prepareVisual` measures it).
A flick shows as one step far above its neighbours; anything under the ground line is
going through the floor. A fast gait legitimately shows big single steps (the gallop's
wrist snaps up as each forepaw leaves the ground), so read a step against its
neighbours, not on its own. `--donor <clips.glb>` takes the clip from a mesh-free clip
file instead, bound to the body by joint name as the game binds one.
