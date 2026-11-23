"""Review frames of any creature .blend whose clips carry a `duration` (the
Broodsworn cultists' 30 fps timeline included), with the knight for scale.

  blender -b x.blend --python clip_sheet30.py -- <out_dir> <Clip,Clip> [N] [--az A] [--el E]
      [--knight k.glb] [--prefix p] [--w W] [--h H] [--fps F]

Writes <prefix>_<Clip>_<i>.png, N evenly spaced frames per clip (the kit's
sheet.mjs stitches them). Authoring aid only.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out, clips = argv[0], argv[1].split(',')
rest = argv[2:]
n = int(rest[0]) if rest and rest[0].isdigit() else 8


def opt(name, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


scene = bpy.context.scene
fps = float(opt('--fps', scene.render.fps))
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and not o.name.startswith('Knight'))
meshes = [o for o in scene.objects if o.type == 'MESH' and o.parent == arm]
os.makedirs(out, exist_ok=True)


def at(clip, t):
    act = bpy.data.actions[clip]
    arm.animation_data.action = act
    f = act.frame_range[0] + t * fps
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def top():
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((9e9, 9e9, 9e9)), Vector((-9e9, -9e9, -9e9))
    for m in meshes:
        ev = m.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ev.matrix_world @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
        ev.to_mesh_clear()
    return lo, hi


at('Idle', 0.0)
lo, hi = top()
H = hi.z - lo.z
span = max(hi.x - lo.x, hi.y - lo.y, H)
knight_at = (lo.x - 1.6, 0.0, 0.0)
cam = stage.setup(knight=opt('--knight'), res=(int(opt('--w', 640)), int(opt('--h', 560))),
                  ref_at=knight_at, sky=(0.16, 0.2, 0.26))
focus = Vector(((lo.x + hi.x + knight_at[0] - 0.4) / 4, 0.0, H * 0.48))
dist = span * 1.75 + 1.5
prefix = opt('--prefix', 'clip')
for c in clips:
    act = bpy.data.actions[c]
    dur = float(act.get('duration', (act.frame_range[1] - act.frame_range[0]) / fps))
    for i in range(n):
        t = dur * i / (n - 1) if n > 1 else 0.0
        at(c, t)
        stage.aim(cam, float(opt('--az', 35)), float(opt('--el', 10)), dist, focus, 45)
        stage.still(os.path.join(out, f'{prefix}_{c}_{i}.png'))
print('SHEET_FRAMES', clips, n, flush=True)
