"""Playtest reshapes of two T-pose Tripo raws (face +X, arms along Y, up Z).

  ember:  the hands read small against the armour, so they grow about the wrist.
  vharok: the arms read short, so the bare upper arm is stretched and the bracer
          and hand ride out with it. The pauldrons, the wings and the bracer
          studs are shells of their own (found by welding a copy): the first two
          stay put, the studs ride out rigidly so they keep their shape.
"""
import sys

import bmesh
import bpy
from mathutils import kdtree

mode, src, dst = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
world = obj.matrix_world
inv = world.inverted()


def smooth(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def shells():
    """Welded connectivity: for every original vertex, (is main body, shell's
    nearest |y| to the spine, shell's mean |y|)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.verts.ensure_lookup_table()
    tree = kdtree.KDTree(len(bm.verts))
    for v in bm.verts:
        tree.insert(v.co, v.index)
    tree.balance()
    label = {}
    groups = []
    for v in bm.verts:
        if v.index in label:
            continue
        stack, group = [v], []
        label[v.index] = len(groups)
        while stack:
            cur = stack.pop()
            group.append(cur)
            for e in cur.link_edges:
                other = e.other_vert(cur)
                if other.index not in label:
                    label[other.index] = len(groups)
                    stack.append(other)
        groups.append(group)
    biggest = max(range(len(groups)), key=lambda g: len(groups[g]))
    info = []
    for g, group in enumerate(groups):
        ys = [abs((world @ v.co).y) for v in group]
        info.append((g == biggest, min(ys), sum(ys) / len(ys)))
    out = [info[label[tree.find(v.co)[1]]] for v in obj.data.vertices]
    bm.free()
    return out


EXTEND, Y0, Y1 = 0.075, 0.18, 0.26


def ride(y):
    return EXTEND * min(1.0, max(0.0, (y - Y0) / (Y1 - Y0)))


shell = shells() if mode == 'vharok' else None
moved = 0
for v in obj.data.vertices:
    p = world @ v.co
    side = 1.0 if p.y >= 0 else -1.0
    y = abs(p.y)
    if mode == 'ember':
        grow = 0.4 * smooth(0.372, 0.41, y)
        if grow <= 0:
            continue
        pivot = (0.04, 0.385, 0.04)
        p.x = pivot[0] + (p.x - pivot[0]) * (1 + grow)
        y = pivot[1] + (y - pivot[1]) * (1 + grow)
        p.z = pivot[2] + (p.z - pivot[2]) * (1 + grow)
    else:
        main, nearest, mean = shell[v.index]
        if main:
            if p.z < -0.1 or p.z > 0.25:
                continue  # the tail, the horns
            shift = ride(y)
        else:
            shift = 0.0 if nearest < 0.2 else ride(mean)
        if shift <= 0:
            continue
        y += shift
    p.y = side * y
    v.co = inv @ p
    moved += 1
print('MOVED', moved, 'OF', len(obj.data.vertices))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True)
print('WROTE', dst)
