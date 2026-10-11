"""Archon Nyxaris floats: take the legs and shoes out from under the robe.

Everything else of the generated model is kept exactly as it is. The legs are two
box columns under the hips and the shoes two blocks on the floor, all well inside
the robe's tatters, so they are removed by where they are.
"""
import sys

import bmesh
import bpy

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')


def in_leg(p):
    if not (0.045 <= p.x <= 0.195 and -0.47 <= p.z <= -0.105):
        return False
    return -0.12 <= p.y <= -0.005 or 0.005 <= p.y <= 0.16


def in_shoe(p):
    return p.z <= -0.415 and 0.03 <= p.x <= 0.272 and abs(p.y) <= 0.17


bm = bmesh.new()
bm.from_mesh(obj.data)
world = obj.matrix_world
doomed = [
    f for f in bm.faces
    if all(in_leg(world @ v.co) or in_shoe(world @ v.co) for v in f.verts)
]
print('FACES', len(bm.faces), 'REMOVED', len(doomed))
bmesh.ops.delete(bm, geom=doomed, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(obj.data)
bm.free()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True)
print('WROTE', dst)
