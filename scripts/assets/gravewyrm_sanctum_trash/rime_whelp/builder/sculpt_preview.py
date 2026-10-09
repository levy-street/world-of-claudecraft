"""Clay review of Korzul's sculpt alone (authoring aid).

  blender -b --factory-startup --python sculpt_preview.py -- <out_dir> [--voxel 0.15] [--nodetail]
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
out = os.path.abspath(argv[0])


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


bpy.ops.wm.read_factory_settings(use_empty=True)
t = time.time()
vox = float(opt('--voxel', 0.15))
F = anatomy.build_body(voxel=vox, detail='--nodetail' not in argv)
print('FIELD', F.shape, round(time.time() - t, 1), 's')
os.makedirs(out, exist_ok=True)
objs = [sdf.to_mesh(F, 'KorzulSkin', bpy, workdir=out)]
for s in (1, -1):
    W = anatomy.build_wing(voxel=max(0.06, vox * 0.7), s=s)
    objs.append(sdf.to_mesh(W, f'Wing{s}', bpy, workdir=out))
if '--dressing' in argv:
    import dressing as D
    for hi, lo in D.build_all(F, out, fast=True):
        objs.append(lo)
        bpy.data.objects.remove(hi, do_unlink=True)
print('MESH', sum(len(o.data.vertices) for o in objs), 'verts', round(time.time() - t, 1), 's')
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
