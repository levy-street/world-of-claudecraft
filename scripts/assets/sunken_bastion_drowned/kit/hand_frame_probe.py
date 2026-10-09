"""Print the rest-space directions that a posed right fist turns onto given world
directions (authoring aid: lay a held prop out so it points where it should in a
key pose).

  blender -b x.blend --python hand_frame_probe.py -- <builder dir> "<pose expr>" fx,fy,fz ux,uy,uz
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
sys.path.insert(1, os.path.dirname(os.path.abspath(__file__)))
import clips as C  # noqa: E402
import rig as R  # noqa: E402

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
rig = R.Rig(arm)
ns = dict(vars(C))
ns['rig'] = rig
b = eval(argv[1], ns)
pose = b.pose({})
D = pose.delta['R_Hand']
f = Vector([float(x) for x in argv[2].split(',')]).normalized()
u = Vector([float(x) for x in argv[3].split(',')]).normalized()
fr = D.inverted() @ f
ur = D.inverted() @ u
print('HANDFRAME fwd_rest', tuple(round(x, 4) for x in fr), 'up_rest', tuple(round(x, 4) for x in ur))
print('HANDFRAME hand_head', tuple(round(x, 3) for x in pose.head['R_Hand']))
