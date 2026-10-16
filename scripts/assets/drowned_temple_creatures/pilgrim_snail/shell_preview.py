"""Shell-only clay preview: blender -b --factory-startup --python shell_preview.py -- <out_dir> <anatomy module> [k]"""
import importlib
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
argv = sys.argv[sys.argv.index('--') + 1:]
out, modname = argv[0], argv[1]
k = float(argv[2]) if len(argv) > 2 else 1.6
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

A = importlib.import_module(modname)
import sdf  # noqa: E402
import stage  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
work = os.path.join(out, '_w')
os.makedirs(work, exist_ok=True)
objs = [sdf.to_mesh(A.build_shell(0.011 * k * A.GS), 'Shell', bpy, workdir=work)]
objs.append(sdf.to_mesh(A.build_body(0.016 * k * A.GS), 'Body', bpy, workdir=work))
for o in objs:
    for p in o.data.polygons:
        p.use_smooth = True
cam = stage.setup(res=(800, 600), knight=None, ref_at=(-2.2, 0, 0), sky=(0.16, 0.2, 0.26))
stage.clay(objs)
for name, az, el in (('left', 90, 8), ('front', 0, 8), ('back', 180, 20), ('right', -90, 8), ('tq', 40, 25)):
    stage.aim(cam, az, el, 11.0, Vector((0, 0.2, 1.4)), 45)
    stage.still(os.path.join(out, f'{name}.png'))
