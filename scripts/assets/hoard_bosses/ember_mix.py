"""Emberforge Tyrant: keep the ORIGINAL texture (its molten visor and furnace grate
glow), and take only the hands and the feet from the iron repaint.

Both GLBs are the same mesh with the same UV layout (Tripo's repaint preserves
UVs), so the two textures are mixed per UV triangle: triangles of faces that lie
in the hands or the feet take the repaint's pixels, everything else keeps the
original's.
"""
import sys

import bpy
import numpy as np

raw, repaint, dst = sys.argv[sys.argv.index('--') + 1:][:3]
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    obj = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
    image = None
    for node in obj.data.materials[0].node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image and image is None:
            link = node.outputs['Color'].links
            if link and link[0].to_socket.name == 'Base Color':
                image = node.image
    if image is None:
        image = next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE')
    return obj, image


base_obj, base_img = load(raw)
paint_obj, paint_img = load(repaint)
w, h = base_img.size
if tuple(paint_img.size) != (w, h):
    paint_img.scale(w, h)
base = np.array(base_img.pixels[:], dtype=np.float32).reshape(h, w, 4)
paint = np.array(paint_img.pixels[:], dtype=np.float32).reshape(h, w, 4)

mesh = base_obj.data
world = base_obj.matrix_world
uvs = mesh.uv_layers.active.data
mask = np.zeros((h, w), dtype=bool)


def extremity(p):
    # The model faces +X in a T-pose: arms along Y, up is Z.
    return abs(p.y) > 0.36 or p.z < -0.385


count = 0
for poly in mesh.polygons:
    pts = [world @ mesh.vertices[i].co for i in poly.vertices]
    if not all(extremity(p) for p in pts):
        continue
    count += 1
    loop = list(poly.loop_indices)
    for k in range(1, len(loop) - 1):
        tri = [uvs[loop[0]].uv, uvs[loop[k]].uv, uvs[loop[k + 1]].uv]
        xs = [t.x * w for t in tri]
        ys = [t.y * h for t in tri]
        x0, x1 = int(max(0, min(xs) - 2)), int(min(w - 1, max(xs) + 2))
        y0, y1 = int(max(0, min(ys) - 2)), int(min(h - 1, max(ys) + 2))
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        ax, ay, bx, by, cx, cy = xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        l3 = 1 - l1 - l2
        pad = 0.08  # a little past the edges, so no seam of skin is left
        inside = (l1 >= -pad) & (l2 >= -pad) & (l3 >= -pad)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside

print('FACES_REPAINTED', count, 'PIXELS', int(mask.sum()), 'OF', w * h)
base[mask] = paint[mask]
base_img.pixels = base.reshape(-1).tolist()
base_img.pack()
bpy.data.objects.remove(paint_obj, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
base_obj.select_set(True)
for parent in [base_obj.parent] if base_obj.parent else []:
    parent.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True)
print('WROTE', dst)
