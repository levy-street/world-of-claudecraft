# Bastion ghost crew

> Superseded for the captain: the Shipwreck Captain now ships the art guide's model (concept,
> Tripo P2, a skeleton and every clip built in Blender) as `public/models/creatures/woc_bastion_captain.glb`
> from `scripts/assets/specs/woc_bastion_captain.json`. The builders below are kept for the sailor, the
> ship and as reference; the captain's old output GLB is no longer in the repo.

Original drowned sailors and their naval captain. The character builders reuse
the established `sunken_bastion_drowned/kit` SDF/OpenVDB sculpt, skin weighting,
Cycles atlas bake and animation export pipeline. The revenant's anatomical head,
hands and cutlass are shared source; naval coats, tricorn, epaulettes, ragged tails,
chains, spectral lower bodies and all movement and command clips are authored here.

Both creatures have physical upper silhouettes and native blended soul streamers.
There are no hidden legs. Death recoils, rises, then collapses into the floor for
the runtime dissolution effect. Walk and Run are intentionally hovering clips.
The ship is an offline curved/planked brig with ragged sails, ratlines and a
five-cannon broadside on each side. It has no runtime geometry construction.

Build from the repository root with Blender 5.2 (OpenVDB required):

```powershell
blender -b --factory-startup --python scripts/assets/bastion_ghost_crew/build.py -- tmp/ghost-captain-raw.glb --variant captain --bake 2048 --blend tmp/ghost-captain.blend --stats tmp/ghost-captain-stats.json
blender -b --factory-startup --python scripts/assets/bastion_ghost_crew/build.py -- tmp/ghost-sailor-raw.glb --variant sailor --bake 2048 --blend tmp/ghost-sailor.blend --stats tmp/ghost-sailor-stats.json
blender -b --factory-startup --python scripts/assets/bastion_ghost_crew/ship.py -- tmp/ghost-ship-raw.glb
node scripts/assets/sunken_bastion_drowned/kit/ship.mjs tmp/ghost-captain-raw.glb public/models/creatures/bastion_ghost_captain.glb
node scripts/assets/sunken_bastion_drowned/kit/ship.mjs tmp/ghost-sailor-raw.glb public/models/creatures/bastion_ghost_sailor.glb
node scripts/assets/sunken_bastion_drowned/kit/ship.mjs tmp/ghost-ship-raw.glb public/models/props/bastion_ghost_ship.glb
```

The shipping stage meshopt-compresses geometry and converts every character map
to KTX2. Set `KTX_BIN` to the installed Khronos KTX tools directory. The ship uses
constant PBR materials without texture allocations. Regenerate the media manifest
after all assets are finalized.

Preview a baked character or the ship:

```powershell
blender -b tmp/ghost-captain.blend --python scripts/assets/bastion_ghost_crew/preview.py -- tmp/ghost-captain-preview.png Idle 0
```

Shipping coordinates are +Y up, captain facing +Z. The ship bow faces +Z, hull
length 27, beam 5.4, mast height 13.6. Cannon muzzles are `(+-2.705, 2.1, z)`
for `z = -10, -5, 0, 5, 10`, matching the encounter's broadside lane offsets.

Reviewed shipping measurements (24 fps clips): captain Idle height 4.355622,
sailor Idle height 4.131697; both have minimum height 0.408759 before renderer
normalization. Both carry eleven clips and 52 joints. Anchor and Boarding last
exactly 2 seconds. Death lasts 67/24 seconds, holds its final scale from 2.7 seconds,
and reduces the complete skinned geometry below 0.001 yards on every axis. Run
`measure.py` against a baked blend to assert that disappearance and report the
posed head/chest anchors. The ship has no rig or clips because the encounter owns
its apparition and firing timing.

The final compressed files are approximately 2.2 MB per character and 79 KB for
the ship. `tests/bastion_ghost_assets.test.ts` checks the shipping files, animation
timings, skinning, KTX2-only embedded atlases and native blended soul materials.
