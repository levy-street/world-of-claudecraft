"""Clay review of the Gorgebloom's sculpts alone (authoring aid).

  blender -b --factory-startup --python sculpt_preview.py -- <out_dir> [--voxel 0.08] [--nodetail]
         [--knight knight.glb] [--views front,side]
"""
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy  # noqa: E402
import sdf  # noqa: E402
import stage  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


bpy.ops.wm.read_factory_settings(use_empty=True)
t = time.time()
v = float(opt('--voxel', 0.08))
F = anatomy.build_body(voxel=v, detail='--nodetail' not in argv)
print('FIELD', F.shape, round(time.time() - t, 1), 's')
os.makedirs(out, exist_ok=True)
objs = [sdf.to_mesh(F, 'BloomSkin', bpy, workdir=out)]
for name in anatomy.VINES:
    G = anatomy.build_vine(name, voxel=max(0.03, v * 0.7))
    objs.append(sdf.to_mesh(G, name + 'Skin', bpy, workdir=out))
import numpy as np
co = np.array([v.co[:] for v in objs[0].data.vertices])
print('BOUNDS', co.min(0).round(2), co.max(0).round(2))
print('MESH', sum(len(o.data.polygons) for o in objs), 'faces', round(time.time() - t, 1), 's')
for o in objs:
    for p in o.data.polygons:
        p.use_smooth = True
stage.clay(objs)
cam = stage.setup(knight=opt('--knight'), res=(1280, 800))
views = opt('--views')
for name, az, el, dist, focus, lens in stage.STANDARD_VIEWS:
    if views and name not in views.split(','):
        continue
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(out, f'{name}.png'))
print('DONE', round(time.time() - t, 1), 's')
