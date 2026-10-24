"""Build the Moonmantle Ray (the Pearlguard Sentinel, the Drowned Temple's sacred manta) from code.

  blender -b --factory-startup --python build.py -- <out.glb> [kit options]

Options (build_core.py): --k voxel multiplier, --bake N, --nobake, --clips A,B,
--blend path, --tex dir, --stats path, --work dir.

After the build it measures the Idle pose at half its length (the frame the
renderer's prepareVisual normalizes on): IDLE_MID prints the bounds' height
and lowest point, the manifest row's `height` and `hover`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy as A  # noqa: E402
import dressing as D  # noqa: E402
import shading as SH  # noqa: E402
import clips as C  # noqa: E402
import build_core  # noqa: E402

build_core.run(A, D, SH, C)


def idle_mid():
    import bpy
    import numpy as np

    import rig as R
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    act = bpy.data.actions.get('Idle')
    if act is None:
        return None
    R.set_action(arm, act)
    f = 1.0 + float(act['duration']) * 0.5 * R.FPS
    scene.frame_set(int(f), subframe=f - int(f))
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in scene.objects:
        if o.type != 'MESH' or o.parent != arm or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        co = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        M = np.array(o.matrix_world)
        pts.append(co @ M[:3, :3].T + M[:3, 3])
    P = np.concatenate(pts)
    lo, hi = P.min(axis=0), P.max(axis=0)
    return {'height': float(hi[2] - lo[2]), 'minz': float(lo[2]), 'maxz': float(hi[2]),
            'span_x': float(hi[0] - lo[0]), 'len_y': float(hi[1] - lo[1])}


m = idle_mid()
print('IDLE_MID', json.dumps(m), flush=True)
argv = sys.argv[sys.argv.index('--') + 1:]
if '--stats' in argv and m:
    p = argv[argv.index('--stats') + 1]
    with open(p) as f:
        st = json.load(f)
    st['idle_mid'] = m
    with open(p, 'w') as f:
        json.dump(st, f, indent=1)
