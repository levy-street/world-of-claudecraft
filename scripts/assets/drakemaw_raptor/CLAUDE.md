# Drakemaw Raptor mount

The Drakemaw Raptor (and the Friendship Raptor, which shares its body) is the Tripo
mesh and paint on a theropod rig whose skeleton, skin and clips are all authored
here, in Blender, from code. `source/drakemaw_raptor_source.glb` is the unrigged
source: the mesh and KTX2 paint lifted unchanged out of the old Tripo-rigged export
by `extract_source.mjs` (one-shot provenance; nothing of the old rig survives).

Rebuild with `node scripts/assets/drakemaw_raptor/build.mjs [--blend <path>]`:
`prep.mjs` makes a Blender-readable copy (needs `ktx`, KTX-Software 4.3+), `build.py`
runs headless in Blender 5.2+ (`BLENDER=` to point at it), `ship.mjs` writes
`public/models/mounts/drakemaw_raptor.glb` with the source's original KTX2 bytes, and
the media manifest is regenerated. `--blend` keeps the editable rig and actions.

- `anatomy.py`: every joint, measured off the mesh, in source units; the build works
  in game yards (one model yard per game yard).
- `rig.py`: the armature and the skin (bone heat on a welded copy, mirrored from the
  left, forelimbs and thighs kept local, the toes owning everything ahead of the
  ball, the saddle rigid, loose buckles and teeth riding the skin under them).
- `pose.py`: a `Body` of readable numbers to a pose: two-bone leg IK, head lock, tail
  waves, and a ground clamp that keeps the sole and the claws out of the ground.
- `clips.py`: Idle, Walk, Run, WalkBack, Jump, Land. `keys.py` keys them.

Contracts `tests/drakemaw_raptor_mount.test.ts` holds the shipped GLB to: the
fingerprint over every input (edit any builder or the source, then rebuild; the input
list itself is checked against this folder), the manifest's `height` is the Idle's
height on the frame the renderer sizes it by, the walk/run/backpedal refs are both
planted feet's speeds and each planted foot sits on the ground, no vertex dips under
the ground past the slerp sag between two solved keys (sampled between keys, as the
mixer plays them), every loop closes, the Jump has reached its held touchdown pose by
the time the sim lands a flat mounted jump, Land settles into the Idle's stance, and
the rider's clearance over the saddle's leather on both bodies. Never add the raptor
back to `scripts/bake_mount_gaits.mjs` or any `scripts/assets/specs/` spec: either
would overwrite this build.
