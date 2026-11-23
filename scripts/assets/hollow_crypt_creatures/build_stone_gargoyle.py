"""The Chapel Gargoyle, rebuilt: a great, heavy stone gargoyle of the Hollow Crypt.

  blender -b --factory-startup --python build_stone_gargoyle.py -- <out.glb> [--sheet dir] [--blend out.blend] [--fast]

A hunched brute of weathered, cracked chapel stone with lichen in its seams:
ram horns curling off a heavy brow, a fanged underbite, ember eyes, a thick
neck sunk into a humped back ridged with spurs, long arms ending in taloned
hands, digitigrade legs, a spade-tipped tail, and ribbed stone wings with torn
edges. It waits on the arcade caps as a statue, gripping the front lip.

Scale (yards; a player stands about 2.6): crouched on its perch it is about
4.5 tall, reared up nearly 6, the wings span about 11.

Clips (24 fps): Perch (the statue on its arch: stone still), Ready (the awake
fighting crouch), Walk, Run (a heavy knuckle lope, wings half open), Awaken
(the statue cracks free and shakes off its dust), Dive (the plunge off the
perch), DiveLand (the slam on landing that throws the shockwave), ClawRake,
ClawRake2 (the auto attacks: a two-handed rake and a crossing backhand),
Screech (the petrifying shriek over the cast bar), Hit, Death.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402

from organic_kit import (  # noqa: E402
    GLOW, Membrane, Part, Rig, bake_surface, bind, build_armature, clip, cycle, expand_bones, export, join,
    make_materials, new_scene, render_sheet, setup_preview, triangles,
)

STONE = (0.66, 0.66, 0.67)
STONE_D = (0.5, 0.5, 0.53)
STONE_W = (0.74, 0.73, 0.7)
LICHEN = (0.47, 0.52, 0.42)
HORN = (0.4, 0.4, 0.43)
TALON = (0.3, 0.3, 0.33)
EYE = (1.0, 0.55, 0.18)
EYE_HOT = (1.0, 0.85, 0.55)
MAW = (0.12, 0.1, 0.1)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def bez(a, b, c, n=8):
    a, b, c = Vector(a), Vector(b), Vector(c)
    return [(1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c for t in (i / n for i in range(n + 1))]


BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Hips', 'Root', (0, 0.3, 2.3), (0, 0.1, 2.8)),
    ('Spine', 'Hips', (0, 0.1, 2.8), (0, -0.2, 3.6)),
    ('Chest', 'Spine', (0, -0.2, 3.6), (0, -0.5, 4.4)),
    ('Neck', 'Chest', (0, -0.5, 4.4), (0, -0.95, 4.75)),
    ('Head', 'Neck', (0, -0.95, 4.75), (0, -1.8, 4.8)),
    ('Jaw', 'Head', (0, -1.05, 4.55), (0, -1.75, 4.38)),
    ('Arm.L', 'Chest', (0.95, -0.4, 4.25), (1.35, -0.6, 3.1)),
    ('Fore.L', 'Arm.L', (1.35, -0.6, 3.1), (1.35, -1.2, 2.1)),
    ('Hand.L', 'Fore.L', (1.35, -1.2, 2.1), (1.35, -1.55, 1.55)),
    ('Thigh.L', 'Hips', (0.55, 0.3, 2.25), (0.8, -0.6, 1.3)),
    ('Shin.L', 'Thigh.L', (0.8, -0.6, 1.3), (0.75, 0.35, 0.55)),
    ('Foot.L', 'Shin.L', (0.75, 0.35, 0.55), (0.75, 0.0, 0.14)),
    ('Toes.L', 'Foot.L', (0.75, 0.0, 0.14), (0.75, -0.7, 0.06)),
    ('Wing.L', 'Chest', (0.45, 0.25, 4.35), (1.8, 0.6, 5.3)),
    ('WingFore.L', 'Wing.L', (1.8, 0.6, 5.3), (3.8, 0.9, 5.9)),
    ('WingF1.L', 'WingFore.L', (3.8, 0.9, 5.9), (5.6, 1.4, 5.4)),
    ('WingF2.L', 'WingFore.L', (3.8, 0.9, 5.9), (4.9, 2.6, 4.6)),
    ('WingF3.L', 'WingFore.L', (3.8, 0.9, 5.9), (3.2, 2.9, 4.0)),
    ('Tail1', 'Hips', (0, 0.45, 2.2), (0, 1.3, 1.7)),
    ('Tail2', 'Tail1', (0, 1.3, 1.7), (0, 2.1, 1.1)),
    ('Tail3', 'Tail2', (0, 2.1, 1.1), (0, 2.7, 0.5)),
    ('Tail4', 'Tail3', (0, 2.7, 0.5), (0, 3.25, 0.2)),
])
REST = {n: (Vector(h), Vector(t)) for n, _, h, t in BONES}


def _bez3(a, b, c, d, n=10):
    a, b, c, d = Vector(a), Vector(b), Vector(c), Vector(d)
    return [(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
            for t in (i / n for i in range(n + 1))]


def talon(p, base, direction, length, r, curl=1.0):
    d = Vector(direction).normalized()
    down = Vector((0, 0, -1))
    bend = down - d * down.dot(d)
    if bend.length < 1e-4:
        bend = d.orthogonal()
    bend.normalize()
    pts = [Vector(base)]
    n = 6
    for i in range(1, n + 1):
        ang = curl * 1.0 * i / n
        pts.append(pts[-1] + (d * math.cos(ang) + bend * math.sin(ang)) * length / n)
    p.tube(pts, [r * (1 - (i / n) ** 1.1) + 0.004 for i in range(n + 1)],
           [lerp(TALON, (0.14, 0.14, 0.16), i / n) for i in range(n + 1)], sides=7)


def horn(p, pts, r0, r1=0.012, sides=10):
    n = len(pts)
    p.tube(pts, [r0 + (r1 - r0) * (i / (n - 1)) ** 0.9 for i in range(n)],
           [lerp(HORN, (0.22, 0.22, 0.25), (i / (n - 1)) ** 1.4) for i in range(n)], sides=sides)


def limb(p, a, b, r0, r1, color=STONE, sides=12):
    a, b = Vector(a), Vector(b)
    p.tube([a.lerp(b, t) for t in (0, 0.2, 0.5, 0.8, 1.0)],
           [r0 * 0.9, r0, (r0 + r1) / 2 * 1.05, r1, r1 * 0.9], p.vary(color, 0.04), sides=sides)


def build_parts():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    # --- hips, belly, chest: a hunched, heavy torso --------------------------
    hips = part('HipsStone', 'Hips')
    hips.blob((0, 0.25, 2.35), (1.35, 1.05, 0.95), STONE, segments=16, rings=10, jitter=0.03)
    for s in (-1, 1):
        hips.blob((s * 0.45, 0.55, 2.3), (0.75, 0.8, 0.8), STONE_D, segments=12, rings=8)
    spine = part('SpineStone', 'Spine')
    spine.blob((0, -0.05, 3.05), (1.2, 1.0, 1.15), STONE, segments=16, rings=10, jitter=0.03)
    for i in range(3):
        for s in (-1, 1):
            spine.blob((s * 0.2, -0.45, 2.75 + i * 0.3), (0.36, 0.16, 0.26), STONE, segments=8, rings=6)
    chest = part('ChestStone', 'Chest')
    chest.blob((0, -0.35, 3.95), (1.95, 1.35, 1.3), STONE, segments=18, rings=12, jitter=0.03)
    chest.blob((0, 0.2, 4.35), (1.75, 1.2, 0.95), STONE_D, segments=16, rings=10)   # the hump
    for s in (-1, 1):
        chest.blob((s * 0.42, -0.78, 4.02), (0.8, 0.38, 0.6), STONE, rot=(0, s * 0.2, 0), segments=12, rings=8)
        chest.blob((s * 0.95, -0.35, 4.3), (0.8, 0.8, 0.72), STONE, segments=12, rings=8)          # deltoid
    # spurs down the back ridge
    for i in range(6):
        y = 0.55 - i * 0.02
        z = 4.75 - i * 0.42
        target = chest if z > 3.6 else spine if z > 2.8 else hips
        target.spike((0, y + i * 0.16, z), 0.13 - i * 0.012, 0.5 - i * 0.04, STONE_D, sides=5, lean=(0, 0.18))
    # lichen crusted on the shoulders
    for s in (-1, 1):
        chest.blob((s * 0.7, 0.05, 4.72), (0.55, 0.45, 0.14), LICHEN, segments=10, rings=5, jitter=0.2)

    neck = part('NeckStone', 'Neck')
    neck.tube(bez((0, -0.35, 4.3), (0, -0.7, 4.7), (0, -1.0, 4.8), 6), [0.55, 0.5, 0.45], STONE, sides=14)

    # --- the head: heavy brow, bat snout, underbite, ram horns ---------------
    head = part('HeadStone', 'Head')
    ax = (0, -1, -0.08)
    head.loft([
        ((0, -0.75, 4.9), 0.36, 0.4, 2.2, ax),
        ((0, -0.95, 4.98), 0.56, 0.48, 2.8, ax),
        ((0, -1.25, 4.95), 0.58, 0.42, 3.0, ax),
        ((0, -1.55, 4.85), 0.46, 0.34, 3.0, ax),
        ((0, -1.85, 4.76), 0.36, 0.28, 2.8, ax),
        ((0, -2.1, 4.7), 0.26, 0.22, 2.6, ax),
        ((0, -2.25, 4.66), 0.1, 0.1, 2.0, ax),
    ], STONE, sides=22)
    for s in (-1, 1):
        # a heavy brow slanting down to the snout: the scowl
        head.tube(bez((s * 0.08, -1.62, 5.02), (s * 0.35, -1.5, 5.2), (s * 0.62, -1.18, 5.3), 8),
                  [0.08, 0.15, 0.13], STONE_D, sides=8, squash=0.7)
        # ember eyes: slits glowing under the brow
        head.blob((s * 0.34, -1.6, 5.02), (0.24, 0.14, 0.11), MAW, rot=(0, 0, s * 0.35), segments=10, rings=6)
        head.blob((s * 0.36, -1.68, 5.02), (0.21, 0.1, 0.08), EYE, mat=GLOW, rot=(0, 0, s * 0.35), segments=8, rings=5)
        head.blob((s * 0.36, -1.72, 5.02), (0.1, 0.06, 0.05), EYE_HOT, mat=GLOW, segments=6, rings=4)
        # flared nostrils on a wrinkled snout
        head.blob((s * 0.13, -2.18, 4.8), (0.12, 0.1, 0.09), STONE_D, segments=8, rings=5)
        head.blob((s * 0.13, -2.24, 4.8), (0.06, 0.05, 0.05), MAW, segments=6, rings=4)
        for k in range(3):
            head.tube(bez((s * 0.05, -1.95 + k * 0.1, 4.95 - k * 0.02), (s * 0.2, -1.92 + k * 0.1, 5.0),
                          (s * 0.32, -1.86 + k * 0.1, 4.93), 4), [0.03, 0.04, 0.03], STONE_D, sides=5)
        # long pointed ears swept back
        head.tube(bez((s * 0.5, -0.95, 5.1), (s * 0.95, -0.65, 5.35), (s * 1.3, -0.25, 5.6), 6),
                  [0.2, 0.14, 0.02], STONE_D, sides=6, squash=0.35, up=(0, 1, 0))
        # great horns sweeping back and up off the brow, a ram curl under each
        horn(head, [Vector(q) for q in _bez3((s * 0.32, -1.25, 5.22), (s * 0.75, -0.95, 5.85),
                                              (s * 1.0, -0.25, 6.05), (s * 0.95, 0.35, 6.7), 14)], 0.19)
        pts = []
        for i in range(16):
            t = i / 15
            phi = t * 1.45 * math.pi
            r = 0.36 * (1 - 0.4 * t)
            pts.append((s * (0.5 + 0.4 * t), -0.85 + r * math.sin(phi), 4.92 + r * math.cos(phi) - 0.3))
        horn(head, [(s * 0.46, -0.95, 5.0)] + pts[1:], 0.13)
        # a crown of spurs
        for k in range(2):
            head.spike((s * (0.18 + k * 0.14), -1.0 + k * 0.18, 5.32 - k * 0.04), 0.06, 0.28 - k * 0.06, STONE_D,
                       sides=5, lean=(s * 0.1, 0.15))
        # cheek spurs
        head.spike((s * 0.52, -1.25, 4.72), 0.08, 0.38, STONE_D, sides=5, lean=(s * 0.28, 0.12))
    head.blob((0, -1.45, 4.58), (0.78, 1.1, 0.2), MAW, segments=10, rings=6)            # the mouth cavity
    for i in range(7):
        x = -0.3 + i * 0.1
        big = i in (1, 5)
        head.spike((x, -1.92 + abs(x) * 0.55, 4.62), 0.045 if big else 0.035, -0.34 if big else -0.16, STONE_W, sides=5)

    jaw = part('JawStone', 'Jaw')
    jaw.loft([
        ((0, -1.0, 4.45), 0.5, 0.2, 2.6, (0, -1, -0.2)),
        ((0, -1.5, 4.36), 0.46, 0.18, 2.8, (0, -1, -0.2)),
        ((0, -1.95, 4.28), 0.32, 0.16, 2.6, (0, -1, -0.2)),
        ((0, -2.1, 4.25), 0.12, 0.1, 2.0, (0, -1, -0.2)),
    ], STONE, sides=16)
    for s in (-1, 1):
        jaw.spike((s * 0.28, -1.92, 4.4), 0.08, 0.48, STONE_W, sides=5, lean=(s * 0.06, -0.06))   # tusks
        for i in range(3):
            jaw.spike((s * (0.08 + i * 0.08), -2.02 + i * 0.07, 4.4), 0.035, 0.15, STONE_W, sides=4)

    # --- arms and taloned hands ------------------------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        def mx(v):
            v = Vector(v)
            return Vector((v.x * s, v.y, v.z))
        ar = part('Arm' + tag + 'Stone', 'Arm' + tag)
        a, b = REST['Arm.L']
        limb(ar, mx(a), mx(b), 0.42, 0.3)
        ar.blob(mx(a.lerp(b, 0.45) + Vector((0, -0.2, 0))), (0.5, 0.52, 0.72), STONE, segments=12, rings=8)
        fo = part('Fore' + tag + 'Stone', 'Fore' + tag)
        a, b = REST['Fore.L']
        limb(fo, mx(a), mx(b), 0.36, 0.26)
        fo.blob(mx(a.lerp(b, 0.3)), (0.5, 0.5, 0.62), STONE, segments=12, rings=8)
        fo.blob(mx(a), (0.62, 0.62, 0.62), STONE, segments=12, rings=8)                         # elbow
        fo.spike(mx(a + Vector((0.05, 0.28, 0))), 0.1, 0.45, STONE_D, sides=5, lean=(0, 0.3))    # elbow spur
        ha = part('Hand' + tag + 'Stone', 'Hand' + tag)
        a, b = REST['Hand.L']
        ha.blob(mx(a), (0.5, 0.5, 0.5), STONE, segments=10, rings=6)                          # wrist
        ha.blob(mx(a.lerp(b, 0.55)), (0.62, 0.66, 0.46), STONE, segments=12, rings=8)
        for k in (-1, 0, 1):
            ha.blob(mx(b + Vector((k * 0.16, -0.05, 0.05))), (0.2, 0.22, 0.18), STONE_D, segments=8, rings=5)
        for k, spread in enumerate((-0.18, 0.0, 0.18)):
            d = mx((spread, -1.0, -0.5))
            base = mx(b + Vector((spread * 0.6, 0, 0)))
            ha.tube([base, base + d.normalized() * 0.3], [0.1, 0.08], STONE, sides=8)
            talon(ha, base + d.normalized() * 0.3, tuple(d), 0.55, 0.08, curl=0.9)
        talon(ha, mx(a.lerp(b, 0.5) + Vector((-0.28, -0.1, 0))), tuple(mx((-0.6, -0.6, -0.4))), 0.4, 0.07)

    # --- legs ----------------------------------------------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        def mx(v):
            v = Vector(v)
            return Vector((v.x * s, v.y, v.z))
        th = part('Thigh' + tag + 'Stone', 'Thigh' + tag)
        a, b = REST['Thigh.L']
        limb(th, mx(a), mx(b), 0.5, 0.36)
        th.blob(mx(a.lerp(b, 0.4)), (0.72, 0.78, 0.9), STONE, segments=14, rings=8)
        sh = part('Shin' + tag + 'Stone', 'Shin' + tag)
        a, b = REST['Shin.L']
        limb(sh, mx(a), mx(b), 0.3, 0.22)
        sh.blob(mx(a), (0.55, 0.55, 0.55), STONE, segments=12, rings=8)                          # knee
        sh.blob(mx(a.lerp(b, 0.3) + Vector((0, 0.12, 0))), (0.42, 0.5, 0.6), STONE, segments=10, rings=6)
        ft = part('Foot' + tag + 'Stone', 'Foot' + tag)
        a, b = REST['Foot.L']
        limb(ft, mx(a), mx(b), 0.24, 0.22)
        ft.blob(mx(a), (0.42, 0.42, 0.42), STONE, segments=10, rings=6)                            # ankle
        ft.blob(mx(b), (0.42, 0.5, 0.3), STONE, segments=10, rings=6)
        ft.spike(mx(a + Vector((0, 0.15, -0.1))), 0.08, 0.35, STONE_D, sides=5, lean=(0, 0.3))
        to = part('Toes' + tag + 'Stone', 'Toes' + tag)
        base = REST['Toes.L'][0]
        for spread in (-0.3, 0.0, 0.3):
            d = Vector((spread, -1.0, -0.1)).normalized()
            p0 = base + Vector((spread * 0.3, 0, 0.02))
            to.tube([mx(p0), mx(p0 + d * 0.35)], [0.11, 0.09], STONE, sides=8)
            talon(to, mx(p0 + d * 0.35), tuple(mx(tuple(d))), 0.42, 0.08, curl=1.0)

    # --- wings: stone arm, three finger spars, ribbed torn stone membranes ---------
    membranes = []
    for s, tag in ((1, '.L'), (-1, '.R')):
        def mx(v):
            v = Vector(v)
            return Vector((v.x * s, v.y, v.z))
        wa = part('Wing' + tag + 'Stone', 'Wing' + tag)
        a, b = REST['Wing.L']
        limb(wa, mx(a), mx(b), 0.24, 0.18, color=STONE_D)
        wa.blob(mx(a), (0.45, 0.45, 0.45), STONE, segments=10, rings=6)
        wf = part('WingFore' + tag + 'Stone', 'WingFore' + tag)
        a, b = REST['WingFore.L']
        limb(wf, mx(a), mx(b), 0.17, 0.13, color=STONE_D)
        wf.blob(mx(b), (0.3, 0.3, 0.3), STONE_D, segments=8, rings=6)
        horn(wf, bez(mx(b), mx(b + Vector((0.3, -0.4, 0.4))), mx(b + Vector((0.2, -0.7, 0.9))), 5), 0.1)   # wrist hook
        for fn in ('WingF1', 'WingF2', 'WingF3'):
            fp = part(fn + tag + 'Stone', fn + tag)
            a, b = REST[fn + '.L']
            limb(fp, mx(a), mx(b), 0.11, 0.05, color=STONE_D, sides=8)
            fp.spike(mx(b), 0.05, 0.25, TALON, sides=5, lean=(s * 0.1, 0.1))

        def spar(names):
            out = []
            for n in names:
                h, t = REST[n + '.L']
                out.append((mx(h), n + tag))
            h, t = REST[names[-1] + '.L']
            out.append((mx(t), names[-1] + tag))
            return out
        f1, f2, f3 = spar(['WingF1']), spar(['WingF2']), spar(['WingF3'])
        body = [(mx(REST['WingF1.L'][0]), 'WingFore' + tag), (mx(REST['WingFore.L'][0]), 'Wing' + tag),
                (mx((0.55, 0.45, 4.2)), 'Chest'), (mx((0.55, 0.6, 3.2)), 'Spine')]
        m = Membrane('Membrane' + tag, STONE_D, seed=3 if s > 0 else 5)
        m.panel(f1, f2, rows=10, cols=8, scallop=0.22, tear=0.35, shade=1.0)
        m.panel(f2, f3, rows=10, cols=8, scallop=0.24, tear=0.4, shade=1.0)
        m.panel(f3, body, rows=10, cols=10, scallop=0.18, tear=0.3, shade=1.0, sag=0.1)
        membranes.append(m)

    # --- tail with its spade --------------------------------------------------------
    for k in range(4):
        tp = part(f'Tail{k + 1}Stone', f'Tail{k + 1}')
        a, b = REST[f'Tail{k + 1}']
        limb(tp, a, b, 0.34 - k * 0.07, 0.28 - k * 0.07, sides=10)
        tp.spike(a.lerp(b, 0.5) + Vector((0, 0, 0.26 - k * 0.05)), 0.07, 0.26 - k * 0.04, STONE_D, sides=5,
                 lean=(0, 0.12))
    spade = part('TailSpade', 'Tail4')
    end = REST['Tail4'][1]
    spade.blob(end + Vector((0, 0.3, 0)), (0.7, 0.6, 0.12), STONE_D, segments=10, rings=6)
    for s in (-1, 1):
        spade.spike(end + Vector((s * 0.3, 0.35, 0)), 0.1, 0.4, STONE_D, sides=4, lean=(s * 0.3, 0.2))
    return parts, membranes


# -------------------------------------------------------------------- clips
def make_clips(arm):
    rig = Rig(BONES).attach(arm)
    P = rig.pose
    clips = []

    def add(name, keys, loop_clip=True):
        clip(arm, name, keys, loop_clip)
        clips.append(name)

    def crouch(root=(0, 0, -0.7), hand=(1.0, -1.3, 0.22), foot=(0.8, 0.35, 0.02), head=(0, -1, -0.3),
               wing_up=0.0, wing_open=0.0, jaw=0.0, chest=0.0, tail=0.0, look=0.0, arm_pole=(0.6, 0.8, 0.2)):
        """The squat: feet planted, knuckles down, wings furled over the back."""
        open_k = wing_open
        aims = {
            'Spine': (0, -0.55, 0.85), 'Chest': (0, -0.75, 0.66 + chest), 'Neck': (look * 0.4, -1.0, 0.2),
            'Head': (look * 0.6 + head[0], head[1], head[2]),
            'Wing.L': (0.35 + 0.7 * open_k, 0.6 - 0.3 * open_k, 0.75 + wing_up),
            'WingFore.L': (0.2 + 0.9 * open_k, 0.75 - 0.5 * open_k, -0.1 + wing_up * 0.8 + 0.2 * open_k),
            'WingF1.L': (0.2 + 0.8 * open_k, 0.55, -0.8 + 0.7 * open_k),
            'WingF2.L': (0.12 + 0.5 * open_k, 0.75, -0.8 + 0.4 * open_k),
            'WingF3.L': (0.05 + 0.2 * open_k, 0.6, -0.9 + 0.2 * open_k),
            'Foot.L': (0, -0.3, -0.95), 'Toes.L': (0, -1, 0.3),
            'Hand.L': (0, -0.55, -0.85),
            'Tail1': (tail * 0.3, 0.85, -0.5), 'Tail2': (0.25 + tail * 0.6, 0.9, -0.45),
            'Tail3': (0.7 + tail * 0.4, 0.6, -0.15), 'Tail4': (0.95 + tail * 0.3, -0.3, 0.0),
        }
        ik = {'arm.L': ('Arm.L', 'Fore.L', tuple(Vector(hand) + Vector((0, 0.3, 0.55))), arm_pole),
              'leg.L': ('Thigh.L', 'Shin.L', tuple(Vector(foot) + Vector((0, 0.3, 0.62))), (0.3, -1.0, 0.3))}
        turns = {'Jaw': [('x', jaw)]}
        return P(aims=aims, ik=ik, turns=turns, root=root)

    statue = crouch(head=(0, -1, -0.05))
    # Perch: stone still (the renderer holds it while the gargoyle sits on its arch).
    add('Perch', [(1, statue), (24, statue)])
    add('Idle', [(1, statue), (48, statue)])
    # Ready: awake, low, breathing, wings a little open, tail lashing.
    ready_a = crouch(root=(0, 0, -0.45), wing_open=0.35, wing_up=0.1, chest=0.05, tail=0.6, head=(0, -1, -0.1),
                     hand=(1.15, -1.1, 0.05))
    ready_b = crouch(root=(0, 0, -0.52), wing_open=0.3, wing_up=0.05, chest=0.0, tail=-0.6, head=(0, -1, -0.15),
                     hand=(1.15, -1.1, 0.05), jaw=8)
    add('Ready', cycle(40, [ready_a, ready_b]))

    def lope(ph, stride, rootz):
        def cyc(o):
            a = (ph + o) % 1.0
            if a < 0.55:
                t = a / 0.55
                return stride * (0.5 - t), 0.0
            t = (a - 0.55) / 0.45
            return stride * (-0.5 + t), 0.35 * math.sin(math.pi * t)
        hl, hlz = cyc(0.0)
        hr, hrz = cyc(0.5)
        fl, flz = cyc(0.5)
        fr, frz = cyc(0.0)
        base = dict(root=(0, 0, -0.5 + rootz), wing_open=0.3, wing_up=0.15 * math.sin(ph * math.tau), tail=math.sin(ph * math.tau),
                    head=(0, -1, -0.05))
        left = crouch(hand=(1.1, -1.2 + hl, 0.05 + hlz), foot=(0.8, 0.35 + fl, 0.02 + flz), **base)
        right = crouch(hand=(1.1, -1.2 + hr, 0.05 + hrz), foot=(0.8, 0.35 + fr, 0.02 + frz), **base)
        out = dict(left)
        for k, v in right.items():
            if k.endswith('.R'):
                out[k] = v
        return out
    add('Walk', cycle(32, [lope(i / 8, 1.1, 0.06 * math.cos(i / 8 * 2 * math.tau)) for i in range(8)]))
    add('Run', cycle(18, [lope(i / 8, 1.8, 0.12 * math.cos(i / 8 * 2 * math.tau)) for i in range(8)]))

    # Awaken: the statue cracks, shudders, rears with the wings flung wide.
    shudder = crouch(head=(0.15, -1, -0.3), chest=0.05)
    rise = crouch(root=(0, 0, -0.2), wing_open=1.0, wing_up=0.45, chest=0.25, head=(0, -0.7, 0.5), jaw=30,
                  hand=(1.0, -0.9, 0.6))
    add('Awaken', [(1, statue), (6, shudder), (9, statue), (12, shudder), (22, rise), (30, rise), (40, ready_a)],
        loop_clip=False)

    # Dive: wings swept back, arms thrust forward, talons out, plunging.
    dive = crouch(root=(0, 0, 0.3), wing_open=0.55, wing_up=0.55, chest=-0.2, head=(0, -1, -0.5), jaw=18,
                  hand=(0.9, -2.0, 0.9), foot=(0.8, 0.9, 0.9), arm_pole=(0.8, 0.2, 0.9))
    dive_b = crouch(root=(0, 0, 0.3), wing_open=0.62, wing_up=0.7, chest=-0.25, head=(0, -1, -0.55), jaw=22,
                    hand=(0.95, -2.1, 0.85), foot=(0.8, 0.95, 0.95), arm_pole=(0.8, 0.2, 0.9))
    add('Dive', cycle(12, [dive, dive_b]))
    # DiveLand: the slam: fists and feet hit the floor, wings snap open, then up.
    slam = crouch(root=(0, 0, -1.0), wing_open=1.0, wing_up=-0.1, chest=-0.1, head=(0, -1, -0.6), jaw=35,
                  hand=(1.3, -1.6, 0.0))
    add('DiveLand', [(1, dive), (3, slam), (12, slam), (24, ready_a)], loop_clip=False)

    # ClawRake: rise, both arms high, rake down and across.
    def reach(hand_l, hand_r, root=(0, 0, -0.3), chest=0.2, jaw=10, wing=0.4):
        a = crouch(root=root, hand=hand_l, chest=chest, jaw=jaw, wing_open=wing, head=(0, -1, 0.0),
                   arm_pole=(0.9, 0.4, -0.3))
        b = crouch(root=root, hand=hand_r, chest=chest, jaw=jaw, wing_open=wing, head=(0, -1, 0.0),
                   arm_pole=(0.9, 0.4, -0.3))
        out = dict(a)
        for k, v in b.items():
            if k.endswith('.R'):
                out[k] = v
        return out
    wind = reach((1.3, -0.3, 3.4), (1.3, -0.3, 3.4), root=(0, 0.2, -0.1), chest=0.45, jaw=25, wing=0.6)
    rake = reach((0.3, -2.3, 1.0), (0.4, -2.2, 1.3), root=(0, -0.4, -0.5), chest=-0.1, jaw=30, wing=0.5)
    add('ClawRake', [(1, ready_a), (8, wind), (12, rake), (15, rake), (26, ready_a)], loop_clip=False)
    back_w = reach((1.5, -0.6, 2.4), (0.6, -1.4, 1.6), root=(0, 0.1, -0.3), chest=0.2, jaw=15)
    back_s = reach((-0.4, -2.0, 1.4), (1.6, -0.2, 2.2), root=(0, -0.3, -0.4), chest=0.0, jaw=35)
    back_s2 = reach((-0.3, -1.8, 1.6), (-0.3, -2.1, 1.2), root=(0, -0.4, -0.45), chest=0.0, jaw=30)
    add('ClawRake2', [(1, ready_a), (7, back_w), (11, back_s), (16, back_s2), (28, ready_a)], loop_clip=False)

    # Screech: rear back, chest out, wings flung wide, jaws agape at the sky.
    scream_a = crouch(root=(0, 0.3, 0.1), wing_open=1.0, wing_up=0.6, chest=0.55, head=(0, -0.6, 0.55), jaw=48,
                      hand=(1.3, -0.6, 1.6), arm_pole=(0.9, 0.5, -0.2))
    scream_b = crouch(root=(0, 0.3, 0.14), wing_open=1.0, wing_up=0.7, chest=0.6, head=(0.1, -0.6, 0.6), jaw=52,
                      hand=(1.35, -0.55, 1.7), arm_pole=(0.9, 0.5, -0.2))
    add('Screech', [(1, ready_a), (10, scream_a)] + [(10 + 4 * i, scream_b if i % 2 else scream_a) for i in range(1, 9)]
        + [(48, scream_a)], loop_clip=True)
    add('Hit', [(1, ready_a), (4, crouch(root=(0, 0.35, -0.35), wing_open=0.5, head=(0.3, -0.8, 0.2), jaw=20, chest=0.2)),
                (14, ready_a)], loop_clip=False)
    slump = crouch(root=(0, -0.2, -1.4), wing_open=0.7, wing_up=-0.4, head=(0.4, -0.6, -0.9), jaw=20,
                   hand=(1.6, -1.8, 0.0), foot=(1.0, 0.6, 0.0), tail=0.8)
    fall = P(aims={}, turns={'Root': [('y', 28), ('x', 20)]}, root=(0.2, -0.3, -1.7))
    dead = dict(slump)
    dead['Root'] = fall['Root']
    dead['__root'] = fall['__root']
    add('Death', [(1, ready_a), (8, crouch(root=(0, 0.2, 0.0), wing_open=1.0, wing_up=0.5, head=(0, -0.5, 0.7), jaw=45)),
                  (22, slump), (32, dead), (40, dead)], loop_clip=False)
    return clips


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    new_scene()
    mats = make_materials('stone', membrane_kind='stone')
    parts, membranes = build_parts()
    objects = [pt.to_object(mats) for pt in parts] + [m.to_object(mats) for m in membranes]
    body = join(objects, 'ChapelGargoyle')
    print('TRIANGLES', triangles(body))
    fast = '--fast' in argv
    bake_surface(body, size=512 if fast else 2048, samples=24 if fast else 48)
    arm = build_armature('ChapelGargoyle', BONES)
    bind(body, arm)
    clips = make_clips(arm)
    import bpy
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(13)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3))
    export(out, arm)
    if '--sheet' in argv:
        setup_preview((0, -0.5, 2.5), 12, ref_x=3.0)
        render_sheet(arm, clips, argv[argv.index('--sheet') + 1], 'gargoyle')
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
