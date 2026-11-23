"""Clay review of the body sculpt alone (authoring aid).

  blender -b --factory-startup --python sculpt_preview.py -- <out_dir> [--voxel 0.05] [--nodetail]
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
F = anatomy.build_body(voxel=float(opt('--voxel', 0.05)), detail='--nodetail' not in argv)
print('FIELD', F.shape, round(time.time() - t, 1), 's')
body = sdf.to_mesh(F, 'BalgathSkin', bpy, workdir=os.path.dirname(out.rstrip('/')))
print('MESH', len(body.data.vertices), 'verts', len(body.data.polygons), 'faces', round(time.time() - t, 1), 's')
for p in body.data.polygons:
    p.use_smooth = True
stage.clay([body])
cam = stage.setup(knight=opt('--knight'))
views = opt('--views')
for name, az, el, dist, focus, lens in stage.STANDARD_VIEWS:
    if views and name not in views.split(','):
        continue
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(out, f'{name}.png'))
if '--blend' in argv:
    bpy.ops.wm.save_as_mainfile(filepath=opt('--blend'))
print('DONE', round(time.time() - t, 1), 's')
