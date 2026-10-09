"""Per-key arm report of a creature's clips (authoring aid).

  blender -b x.blend --python keyreport.py -- <builder_dir> Clip,Clip

For every key Body: the twist of each arm bone about its own length after the pole
search (U upper arm, F forearm, H hand), the elbow bend, the weapon's direction as
authored and the NATURAL direction it would take with no forearm or wrist roll (aim
the authored weapon near it), and the weapon's lowest probe height.
"""
import math
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
import os  # noqa: E402
sys.path.insert(1, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import anatomy as A  # noqa: E402
import motion as M  # noqa: E402
import rig as R  # noqa: E402

CAPT = []
_orig = M.keyed


def cap(keys):
    CAPT.append(keys)
    return _orig(keys)


M.keyed = cap
import clips as C  # noqa: E402
C.keyed = cap
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
rig = R.Rig(arm)


def tw(q):
    a = math.degrees(2 * math.atan2(q.y, q.w))
    return (a + 180) % 360 - 180


def natural(b):
    """Weapon direction with the hand carried by the forearm (no roll), wrist straight."""
    nb = b.but(weapon=None)
    p = nb.pose({})
    q = p.delta['R_Hand']
    return tuple(round(x, 2) for x in (q @ Vector(A.WEAPON_AXIS)))


names = argv[1].split(',')
for nm in names:
    fn = next(f for n, f, _ in C.CATALOG if n == nm)
    CAPT.clear()
    fn(rig)
    if not CAPT:
        print('KEY', nm, 'no key list')
        continue
    for t, b, e in M.aimed_keys(CAPT[-1]):
        p = b.pose({})
        row = []
        for s in ('L_', 'R_'):
            if s + 'UpperArm' not in p:
                continue
            up = (p.head[s + 'Forearm'] - p.head[s + 'UpperArm']).normalized()
            fo = (p.head[s + 'Hand'] - p.head[s + 'Forearm']).normalized()
            row.append(f'{s}U{tw(p[s + "UpperArm"]):5.0f} F{tw(p[s + "Forearm"]):5.0f} H{tw(p[s + "Hand"]):5.0f} '
                       f'bend{math.degrees(up.angle(fo)):4.0f}')
        wz = ''
        if 'Weapon' in A.REST:
            act_dir = tuple(round(x, 2) for x in (p.delta['R_Hand'] @ Vector(A.WEAPON_AXIS)))
            zs = [M.weapon_world(p, u)[2] for u in getattr(A, 'WEAPON_PROBES', (-0.5, 1.0, 2.0))]
            wz = f' blade={act_dir} minz={min(zs):.2f} roll={b.p["hand_roll_r"]:.0f} wrist={b.p["wrist_r"]}'
        print(f'KEY {nm}@{t:.2f} ' + ' | '.join(row) + wz, flush=True)
print('KEYREPORT_DONE')
