"""Probe which weapon directions a clip pose can actually reach (authoring aid).

  blender -b x.blend --python probe_aim.py -- <builder dir> <pose expr> [dirs...]

<pose expr> is evaluated in the builder's clips module (e.g. "_sweep_poses(rig)[3]");
each candidate direction "x,y,z" prints the aim error in degrees. With no
directions, a sphere of 98 candidates is scanned and the best 12 listed.
"""
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
sys.path.insert(1, os.path.dirname(os.path.abspath(__file__)))
import clips as C  # noqa: E402
import motion as M  # noqa: E402
import rig as R  # noqa: E402

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
rig = R.Rig(arm)
ns = dict(vars(C))
ns['rig'] = rig
exprs = argv[1].split('||')
cands = []
if len(argv) > 2:
    for s in argv[2:]:
        cands.append(np.array([float(x) for x in s.split(',')]))
else:
    for el in np.linspace(-80, 80, 7):
        for az in np.arange(0, 360, 26):
            e, a = math.radians(el), math.radians(az)
            cands.append(np.array((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))))
for ex in exprs:
    base = eval(ex, ns)
    res = []
    for d in cands:
        d = d / np.linalg.norm(d)
        b = M.aim_weapon(base.but(weapon=tuple(d)))
        res.append((b.aim_err, tuple(np.round(d, 2))))
    res.sort()
    for err, d in res[:12] if len(argv) <= 2 else res:
        print('AIM', ex[:90], d, round(err, 1))
