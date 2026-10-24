"""Export the open sprite buddy .blend to a GLB (same settings as the build scripts).

blender --background sprites_buddy.blend --python export_glb.py -- <out.glb>
"""
import sys

import bpy

out_glb = sys.argv[sys.argv.index("--") + 1]
rig = bpy.data.objects["SpritesRig"]
for tr in rig.animation_data.nla_tracks:
    tr.mute = False
rig.animation_data.action = None
for b in rig.pose.bones:
    b.location, b.scale = (0, 0, 0), (1, 1, 1)
    b.rotation_quaternion = (1, 0, 0, 0)
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_animation_mode="NLA_TRACKS",
    export_frame_range=False,
    export_force_sampling=True,
    export_optimize_animation_size=False,
)
print("EXPORTED", out_glb)
