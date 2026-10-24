"""Print where a bone sits at given clip times, as fractions of the Idle height
(forward, side, up), the frame the Sanctum fx anchor their effects in
(src/render/gravewyrm_sanctum_fx/sanctum_fx_core.ts SANCTUM_BODY_ANCHORS).

  blender -b x.blend --python probe_anchor.py -- <Bone[:head|tail|mid]> <Clip:t,Clip:t> [--idle-height H] [--along Y]

Blender is Z up with the creature facing -Y; forward = -Y, side = +X (its left).
`--along Y` offsets the point Y yards along the bone (a blade tip, a lantern).
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
spec, times = argv[0], argv[1].split(',')
bone_name, _, where = spec.partition(':')
where = where or 'head'
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.name.startswith('Knight'))
along = float(argv[argv.index('--along') + 1]) if '--along' in argv else 0.0


def idle_height():
    if '--idle-height' in argv:
        return float(argv[argv.index('--idle-height') + 1])
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(int(0.5 * bpy.context.scene.render.fps) + 1)
    dg = bpy.context.evaluated_depsgraph_get()
    top = 0.0
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or o.parent != arm:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        top = max(top, max((ev.matrix_world @ v.co).z for v in me.vertices))
        ev.to_mesh_clear()
    return top


H = idle_height()
fps = bpy.context.scene.render.fps
for item in times:
    clip, _, t = item.partition(':')
    arm.animation_data.action = bpy.data.actions[clip]
    f = float(t) * fps + 1
    bpy.context.scene.frame_set(int(f), subframe=f % 1)
    pb = arm.pose.bones[bone_name]
    m = arm.matrix_world
    head, tail = m @ pb.head, m @ pb.tail
    p = {'head': head, 'tail': tail, 'mid': (head + tail) / 2}[where]
    if along:
        p = head + (tail - head).normalized() * along
    print(f'ANCHOR {bone_name} {clip}@{t}: forward {-p.y / H:.3f} side {p.x / H:.3f} up {p.z / H:.3f} '
          f'(yd {-p.y:.2f} {p.x:.2f} {p.z:.2f}, idle height {H:.2f})', flush=True)
