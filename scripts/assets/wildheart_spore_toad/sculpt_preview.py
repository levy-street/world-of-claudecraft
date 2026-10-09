"""Clay review of the Spore Toad's body sculpt alone (authoring aid).

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
F = anatomy.build_body(voxel=float(opt('--voxel', 0.08)), detail='--nodetail' not in argv)
print('FIELD', F.shape, round(time.time() - t, 1), 's')
os.makedirs(out, exist_ok=True)
body = sdf.to_mesh(F, 'ToadSkin', bpy, workdir=out)
print('MESH', len(body.data.vertices), 'verts', len(body.data.polygons), 'faces', round(time.time() - t, 1), 's')
for p in body.data.polygons:
    p.use_smooth = True
stage.clay([body])
cam = stage.setup(knight=opt('--knight'), res=(1280, 800))
views = opt('--views')
for name, az, el, dist, focus, lens in stage.STANDARD_VIEWS:
    if views and name not in views.split(','):
        continue
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(out, f'{name}.png'))
print('DONE', round(time.time() - t, 1), 's')
