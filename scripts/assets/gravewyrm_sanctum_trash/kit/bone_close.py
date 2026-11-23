"""A close still aimed at a bone at a clip time (authoring aid).

  blender -b x.blend --python bone_close.py -- <out.png> <Bone> <Clip:t> [--az A] [--el E] [--d D] [--fps F]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out, bone, spec = argv[0], argv[1], argv[2]


def opt(name, default):
    return float(argv[argv.index(name) + 1]) if name in argv else default


scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and not o.name.startswith('Knight'))
cam = stage.setup(res=(900, 900), sky=(0.16, 0.2, 0.26))
clip, _, t = spec.partition(':')
act = bpy.data.actions[clip]
arm.animation_data.action = act
f = act.frame_range[0] + float(t) * opt('--fps', scene.render.fps)
scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
p = arm.matrix_world @ arm.pose.bones[bone].head
stage.aim(cam, opt('--az', 30), opt('--el', 8), opt('--d', 2.4), Vector(p), 45)
stage.still(out)
