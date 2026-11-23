"""Repaint the heart-shard's texels in the baked albedo and emissive maps (no rebake).

The procedural bake left the star-glass too pale (it read white-lavender under
light). This paints every texel the shard covers: a saturated rose-gold core,
gold-white sparks and a few teal-violet facets at the tips, emissive brighter than
the albedo. Then it re-saves the .blend, the maps and the raw GLB.

  blender -b korzul.blend --python fix_shard.py -- <out_raw.glb> <tex_dir>
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402
import rig as R  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out, tex_dir = argv[0], argv[1]
body = bpy.data.objects['Korzul']
arm = body.parent
me = body.data
g = body.vertex_groups['Shard'].index
inshard = np.zeros(len(me.vertices), bool)
for v in me.vertices:
    for gg in v.groups:
        if gg.group == g and gg.weight > 0.5:
            inshard[v.index] = True
uv = me.uv_layers.active.data
rng = np.random.default_rng(5)
CORE = np.array((1.0, 0.55, 0.26))
HOT = np.array((1.0, 0.86, 0.58))
TEAL = np.array((0.3, 0.75, 0.9))
VIOLET = np.array((0.6, 0.42, 0.9))


def srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def paint(img_name, gain):
    img = bpy.data.images[img_name]
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    n = 0
    for poly in me.polygons:
        if not all(inshard[i] for i in poly.vertices):
            continue
        r = rng.random()
        col = CORE if r < 0.55 else HOT if r < 0.82 else TEAL if r < 0.93 else VIOLET
        col = col * rng.uniform(0.85, 1.05)
        loops = list(poly.loop_indices)
        tri = [(loops[0], loops[k], loops[k + 1]) for k in range(1, len(loops) - 1)]
        for a, b, c in tri:
            P = np.array([uv[i].uv[:] for i in (a, b, c)]) * (w, h)
            x0, y0 = np.floor(P.min(0)).astype(int) - 1
            x1, y1 = np.ceil(P.max(0)).astype(int) + 1
            xs, ys = np.meshgrid(np.arange(max(0, x0), min(w, x1 + 1)), np.arange(max(0, y0), min(h, y1 + 1)))
            q = np.stack([xs + 0.5, ys + 0.5], -1)
            v0, v1 = P[1] - P[0], P[2] - P[0]
            d = v0[0] * v1[1] - v0[1] * v1[0]
            if abs(d) < 1e-9:
                continue
            rel = q - P[0]
            l1 = (rel[..., 0] * v1[1] - rel[..., 1] * v1[0]) / d
            l2 = (v0[0] * rel[..., 1] - v0[1] * rel[..., 0]) / d
            inside = (l1 >= -0.08) & (l2 >= -0.08) & (l1 + l2 <= 1.08)
            edge = np.minimum(np.minimum(l1, l2), 1 - l1 - l2)
            shade = 0.75 + 0.25 * np.clip(edge * 6, 0, 1)
            sub = px[ys[inside], xs[inside]]
            c_lin = np.clip(col * gain, 0, 1)   # the maps hold sRGB-encoded values
            sub[:, :3] = c_lin[None, :] * shade[inside][:, None]
            px[ys[inside], xs[inside]] = sub
            n += int(inside.sum())
    img.pixels[:] = px.ravel()
    img.pack()
    img.filepath_raw = os.path.join(tex_dir, f'korzul_{img_name[6:].lower()}_{w}.png')
    img.file_format = 'PNG'
    img.save()
    print('PAINTED', img_name, n, 'texels')


paint('KorzulAlbedo', 0.6)
paint('KorzulEmissive', 1.0)
build.export(out, arm)
R.set_action(arm, bpy.data.actions['Idle'])
bpy.ops.wm.save_mainfile()
print('SHARD_FIXED')
