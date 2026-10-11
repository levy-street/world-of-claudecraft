"""Give a BAKED Olen .blend the Shield bone the builder now makes (anatomy._bones), without
re-sculpting or re-baking: the bone goes in under the left fist, and the low mesh's shield
islands (the board, its sigil, its barnacles and its weed, found by their distance to the
shield's high sculpts) move off L_Hand onto it, rigid as before. A pose that never turns the
bone deforms exactly as the old binding did; a clip hides the shield by a keyed scale.

  blender -b x.blend --python add_shield_bone.py -- <builder_dir> <out.blend>
"""
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
sys.path.insert(1, os.path.join(os.path.dirname(os.path.abspath(argv[0])), 'kit'))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import anatomy as A  # noqa: E402

SHIELD_PARTS = ('Shield_hi', 'ShieldSigil_hi', 'BarnShield_hi', 'KelpShield_hi')
NEAR = 0.02

arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.name.startswith('Knight'))
body = next(o for o in arm.children if o.type == 'MESH')
assert 'Shield' not in arm.data.bones, 'already has a Shield bone'
want = {n: (p, h, t) for n, p, h, t in A._bones()}
_, hand_h, _ = want['L_Hand']
print('L_Hand head blend', tuple(arm.data.bones['L_Hand'].head_local), 'anatomy', tuple(hand_h))
assert (arm.data.bones['L_Hand'].head_local - Vector(hand_h)).length < 1e-3, 'frames differ'

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
parent, head, tail = want['Shield']
eb = arm.data.edit_bones.new('Shield')
eb.head = Vector(head)
eb.tail = Vector(tail)
eb.parent = arm.data.edit_bones[parent]
eb.use_connect = False
eb.use_deform = True
bpy.ops.object.mode_set(mode='OBJECT')

# The shield's high sculpts, as one nearest-surface query (world space).
trees = []
for name in SHIELD_PARTS:
    o = bpy.data.objects[name]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    trees.append(BVHTree.FromBMesh(bm))
    bm.free()

me = body.data
mw = body.matrix_world
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
seen = np.zeros(len(bm.verts), bool)
islands = []
for v in bm.verts:
    if seen[v.index]:
        continue
    stack, isl = [v], []
    seen[v.index] = True
    while stack:
        a = stack.pop()
        isl.append(a.index)
        for e in a.link_edges:
            b = e.other_vert(a)
            if not seen[b.index]:
                seen[b.index] = True
                stack.append(b)
    islands.append(isl)
bm.free()

gi = {g.name: g.index for g in body.vertex_groups}
hand = gi['L_Hand']
shield = body.vertex_groups.new(name='Shield')
moved = 0
for isl in islands:
    near = 0
    on_hand = 0
    for i in isl:
        p = mw @ me.vertices[i].co
        if any((t.find_nearest(p, NEAR)[0] is not None) for t in trees):
            near += 1
        gs = me.vertices[i].groups
        if gs and max(gs, key=lambda g: g.weight).group == hand:
            on_hand += 1
    if near < 0.6 * len(isl) or on_hand < 0.9 * len(isl):
        continue
    for i in isl:
        for g in list(me.vertices[i].groups):
            body.vertex_groups[g.group].remove([i])
        shield.add([i], 1.0, 'REPLACE')
    moved += len(isl)
print('SHIELD_ISLANDS moved', moved, 'verts of', len(me.vertices))
assert moved > 1000, 'shield not found'
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[1]))
print('SHIELD_BONE_DONE')
