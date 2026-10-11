"""Write a quadruped_rig.py spec for an eight-legged model by FINDING its legs.

Placing sixteen leg bones by eye is slow and wrong. A spider's legs are the thin
parts of the welded mesh that leave the body, so: weld, drop every vertex within
the body's radius of the leg hub, and each connected piece that is long and thin is
a leg. Its bones run hub-side end, highest point (the knee), tip.

  blender --background --python spider_spec.py -- <raw.glb> <out.json> --name Name --key key
      [--rotate-z deg] [--hub x,y] [--body-radius r]
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


SRC, OUT = args[0], args[1]
ROTATE = float(opt('--rotate-z', 0))
HUB = Vector([float(v) for v in opt('--hub', '0,0').split(',')] + [0])
BODY_R = float(opt('--body-radius', 0.1))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
obj.data.transform(obj.matrix_world)
obj.matrix_world = Matrix.Identity(4)
if ROTATE:
    obj.data.transform(Matrix.Rotation(math.radians(ROTATE), 4, 'Z'))

bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.verts.ensure_lookup_table()
floor = min(v.co.z for v in bm.verts)
flat = lambda co: Vector((co.x - HUB.x, co.y - HUB.y, 0))
outside = {v.index for v in bm.verts if flat(v.co).length > BODY_R}
seen, pieces = set(), []
for start in outside:
    if start in seen:
        continue
    stack, piece = [start], []
    seen.add(start)
    while stack:
        cur = stack.pop()
        piece.append(bm.verts[cur].co.copy())
        for edge in bm.verts[cur].link_edges:
            other = edge.other_vert(bm.verts[cur]).index
            if other in outside and other not in seen:
                seen.add(other)
                stack.append(other)
    pieces.append(piece)

legs = []
for piece in pieces:
    near = min(piece, key=lambda co: flat(co).length)
    tip = max(piece, key=lambda co: flat(co).length)
    reach = flat(tip).length - flat(near).length
    centre = sum(piece, Vector()) / len(piece)
    # The abdomen and the head also leave the hub: they sit on the midline and are fat.
    if reach < 0.12 or len(piece) < 25 or (abs(centre.y - HUB.y) < 0.05 and abs(tip.y - HUB.y) < 0.08):
        continue
    inner = sorted(piece, key=lambda co: flat(co).length)[: max(3, len(piece) // 10)]
    attach = sum(inner, Vector()) / len(inner)
    knee = max(piece, key=lambda co: co.z)
    along = (flat(knee).length - flat(attach).length) / max(1e-6, reach)
    if not 0.2 < along < 0.8:
        knee = (attach + tip) / 2 + Vector((0, 0, 0.04))
    legs.append({'attach': attach, 'knee': knee, 'tip': Vector((tip.x, tip.y, floor)), 'count': len(piece)})
print('LEGS', len(legs), [leg['count'] for leg in legs])

body = [v.co for v in bm.verts if v.index not in outside or abs(v.co.y - HUB.y) < 0.06]
rear = min(body, key=lambda co: co.x)
front = max(body, key=lambda co: co.x)
hub_z = sum(leg['attach'].z for leg in legs) / max(1, len(legs))
r3 = lambda v: [round(c, 4) for c in v]
bones = [
    ['Root', None, [HUB.x, HUB.y, floor], [HUB.x, HUB.y, floor + 0.05], 0.0],
    ['Hips', 'Root', [HUB.x - 0.04, HUB.y, hub_z], [HUB.x, HUB.y, hub_z], 0.1],
    ['Spine', 'Hips', [HUB.x, HUB.y, hub_z], [HUB.x + 0.03, HUB.y, hub_z], 0.1],
    ['Chest', 'Spine', [HUB.x + 0.03, HUB.y, hub_z], [HUB.x + 0.06, HUB.y, hub_z], 0.09],
    ['Head', 'Chest', [HUB.x + 0.06, HUB.y, hub_z], r3(Vector((front.x, HUB.y, hub_z))), 0.07],
    # The abdomen rides the tail chain, so it sways as the creature walks.
    ['Tail1', 'Hips', [HUB.x - 0.04, HUB.y, hub_z], r3(Vector(((HUB.x - 0.04 + rear.x) / 2, HUB.y, hub_z + 0.02))), 0.12],
    ['Tail2', 'Tail1', r3(Vector(((HUB.x - 0.04 + rear.x) / 2, HUB.y, hub_z + 0.02))), r3(Vector((rear.x, HUB.y, hub_z + 0.02))), 0.12],
]
side_limbs = []
for sign, tag in ((1, 'L'), (-1, 'R')):
    mine = sorted((leg for leg in legs if (leg['tip'].y - HUB.y) * sign > 0), key=lambda leg: -leg['tip'].x)
    for i, leg in enumerate(mine):
        upper, lower = 'Leg%dUpper.%s' % (i + 1, tag), 'Leg%dLower.%s' % (i + 1, tag)
        bones.append([upper, 'Chest', r3(leg['attach']), r3(leg['knee']), 0.035])
        bones.append([lower, upper, r3(leg['knee']), r3(leg['tip']), 0.03])
        out = flat(leg['tip']).normalized()
        # Neighbours step in turn, and the two sides are out of step with each other.
        phase = ((i + (0 if sign > 0 else 1)) % 2) * 0.5
        side_limbs.append({'upper': upper, 'lower': lower, 'dir': [round(out.x, 3), round(out.y, 3)], 'side': sign, 'phase': phase})

spec = {
    'name': opt('--name'), 'key': opt('--key'), 'rotateZ': ROTATE,
    'motion': {'chestUp': 0, 'headUp': 0, 'walkStride': 13, 'runStride': 19, 'bob': 0.004, 'idleBob': 0.004,
               'deathDrop': round(hub_z - floor - 0.05, 3), 'deathRoll': 172, 'deathCurl': 2.6},
    'bones': bones,
    'sideLimbs': side_limbs,
}
with open(OUT, 'w', encoding='utf-8', newline='\n') as handle:
    handle.write(json.dumps(spec, indent=2) + '\n')
print('WROTE', OUT, 'hub z', round(hub_z, 3), 'floor', round(floor, 3))
