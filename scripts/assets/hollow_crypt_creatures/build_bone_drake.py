"""The Ossuary Drake, rebuilt: a colossal skeletal wyvern of the Hollow Crypt.

  blender -b --factory-startup --python build_bone_drake.py -- <out.glb> [--sheet dir] [--blend out.blend]

A wyvern, not a four-legged lizard: its wings ARE its forelimbs, so it stands
and walks on its wing knuckles and its hind legs, and it never paws at anyone
with little hands. It fights with its jaws, a torrent of spectral fire from its
throat, a sweep of its tail and a buffet of its wings.

Scale (yards, the game's units; a player stands about 2.6): the head rides
about 10 up, the body runs about 24 from snout to tail tip and the wings span
about 34, so its silhouette fills the sky over the Processional. The model is
centred on its SHOULDERS, not its hips: the sim's breath cone opens at the
entity position, so the jaws that pour the fire sit right over the cone's apex.

Anatomy: a horned skull with ember-lit orbits and a hinged jaw full of teeth,
a long S-curved neck of spined vertebrae, a keeled ribcage caging a soul fire,
scapulae, a bladed pelvis, a tail of 20-odd vertebrae ending in a bone blade,
digitigrade hind legs with hooked talons, and wings of hollow bone (humerus,
twin forearm bones, a walking thumb claw and four long fingers) with torn,
bat-like membranes weighted across the finger bones.

Clips (24 fps): Idle, Walk, Run (ground gaits on the wing knuckles), Fly (the
airborne loop: two great downbeats and a long glide), Glide (the descent),
Land (the touchdown), Roar, Bite, Bite2 (the auto attacks), Breath (inhale over
the 2 s bar, then the exhale plays out), TailSweep, WingBuffet, Hit, Death.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402

from organic_kit import (  # noqa: E402
    BODY, GLOW, Membrane, Part, Rig, two_bone, bake_surface, bind, build_armature, clip, cycle, expand_bones,
    export, join, make_materials, new_scene, render_sheet, setup_preview, triangles,
)

BONE = (0.87, 0.83, 0.72)
BONE_OLD = (0.74, 0.68, 0.56)
BONE_DARK = (0.52, 0.47, 0.39)
HORN = (0.44, 0.39, 0.32)
HORN_TIP = (0.16, 0.14, 0.13)
CLAW = (0.3, 0.27, 0.24)
SOCKET = (0.03, 0.03, 0.035)
SKIN = (0.23, 0.2, 0.24)
FIRE = (0.55, 1.0, 0.82)
FIRE_HOT = (0.9, 1.0, 0.95)
EMBER_DEEP = (0.12, 0.5, 0.38)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def bez(a, b, c, n=8):
    a, b, c = Vector(a), Vector(b), Vector(c)
    return [(1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c for t in (i / n for i in range(n + 1))]


def bez3(a, b, c, d, n=10):
    a, b, c, d = Vector(a), Vector(b), Vector(c), Vector(d)
    return [(1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d
            for t in (i / n for i in range(n + 1))]


def chain(prefix, parent, pts):
    out = []
    for i in range(len(pts) - 1):
        name = f'{prefix}{i + 1}'
        out.append((name, parent, pts[i], pts[i + 1]))
        parent = name
    return out


# ---------------------------------------------------------------- skeleton
NECK = [(0, -1.0, 6.1), (0, -2.2, 6.9), (0, -3.1, 8.0), (0, -3.7, 9.1), (0, -4.4, 9.9), (0, -5.4, 10.3)]
TAIL = [(0, 4.8, 5.0), (0, 6.3, 4.75), (0, 7.8, 4.3), (0, 9.3, 3.7), (0, 10.7, 3.05), (0, 12.0, 2.45),
        (0, 13.2, 1.95), (0, 14.3, 1.6), (0, 15.3, 1.4), (0, 16.2, 1.3)]
HAND = (10.8, -0.8, 7.4)
BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 1.0)),
    ('Pelvis', 'Root', (0, 4.8, 5.0), (0, 3.4, 5.3)),
    ('Spine', 'Pelvis', (0, 3.4, 5.3), (0, 1.0, 5.9)),
    ('Chest', 'Spine', (0, 1.0, 5.9), (0, -1.0, 6.1)),
    *chain('Neck', 'Chest', NECK),
    ('Head', 'Neck5', (0, -5.4, 10.3), (0, -8.2, 9.8)),
    ('Jaw', 'Head', (0, -5.75, 9.75), (0, -8.2, 9.3)),
    *chain('Tail', 'Pelvis', TAIL),
    ('Thigh.L', 'Pelvis', (1.35, 4.5, 4.8), (1.8, 2.8, 3.0)),
    ('Shin.L', 'Thigh.L', (1.8, 2.8, 3.0), (1.7, 4.6, 1.2)),
    ('Foot.L', 'Shin.L', (1.7, 4.6, 1.2), (1.7, 4.0, 0.25)),
    ('Toes.L', 'Foot.L', (1.7, 4.0, 0.25), (1.7, 2.8, 0.12)),
    ('Humerus.L', 'Chest', (1.1, -0.4, 6.1), (4.4, 0.0, 7.0)),
    ('Forearm.L', 'Humerus.L', (4.4, 0.0, 7.0), (9.2, -0.7, 7.3)),
    ('Hand.L', 'Forearm.L', (9.2, -0.7, 7.3), HAND),
    ('Thumb.L', 'Hand.L', (9.3, -0.75, 7.3), (9.7, -1.9, 7.0)),
    ('Finger1a.L', 'Hand.L', HAND, (14.0, -0.2, 7.3)),
    ('Finger1b.L', 'Finger1a.L', (14.0, -0.2, 7.3), (17.0, 1.0, 7.0)),
    ('Finger2a.L', 'Hand.L', HAND, (13.4, 2.0, 7.1)),
    ('Finger2b.L', 'Finger2a.L', (13.4, 2.0, 7.1), (15.6, 4.8, 6.8)),
    ('Finger3.L', 'Hand.L', HAND, (12.6, 6.6, 6.6)),
    ('Finger4.L', 'Hand.L', HAND, (9.4, 7.4, 6.3)),
])
REST = {n: (Vector(h), Vector(t)) for n, _, h, t in BONES}


def along(name, t):
    h, tl = REST[name]
    return h.lerp(tl, t)


# ---------------------------------------------------------------- anatomy
def long_bone(p, a, b, r, color=BONE, knob=1.45, bow=0.0, sides=10, condyles=True):
    a, b = Vector(a), Vector(b)
    axis = b - a
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = axis.cross(Vector((0, 1, 0)))
    side.normalize()
    ts = [0.0, 0.05, 0.16, 0.34, 0.5, 0.66, 0.84, 0.95, 1.0]
    prof = [knob * 0.85, knob, 1.05, 0.86, 0.8, 0.86, 1.05, knob, knob * 0.85]
    pts = [a.lerp(b, t) + side * bow * math.sin(math.pi * t) * axis.length for t in ts]
    p.tube(pts, [r * k for k in prof], color, sides=sides)
    if condyles:
        up = axis.cross(side).normalized()
        for end, sgn in ((a, 1), (b, -1)):
            for s in (-1, 1):
                p.blob(end + side * s * r * 0.55 + axis.normalized() * sgn * r * 0.15,
                       (r * 1.15, r * 1.15, r * 1.0), p.vary(color, 0.04), segments=10, rings=6)
            p.blob(end + up * r * 0.3, (r * 0.9, r * 0.9, r * 0.9), color, segments=8, rings=5)


def claw(p, base, direction, length, r, curl=1.0, color=CLAW, sides=8):
    d = Vector(direction).normalized()
    down = Vector((0, 0, -1))
    bend = (down - d * down.dot(d))
    if bend.length < 1e-4:
        bend = d.orthogonal()
    bend.normalize()
    pts = []
    n = 7
    for i in range(n + 1):
        t = i / n
        ang = curl * 1.1 * t * t
        dirv = d * math.cos(ang) + bend * math.sin(ang)
        pts.append(Vector(base) + dirv * length * t)
    # smooth the arc: accumulate small steps
    acc = [Vector(base)]
    for i in range(1, n + 1):
        t = i / n
        ang = curl * 1.1 * t
        dirv = d * math.cos(ang) + bend * math.sin(ang)
        acc.append(acc[-1] + dirv * length / n)
    p.tube(acc, [r * (1 - (i / n) ** 1.2) + 0.004 for i in range(n + 1)],
           [lerp(color, HORN_TIP, i / n) for i in range(n + 1)], sides=sides)


def horn(p, pts, r0, r1=0.01, sides=10):
    n = len(pts)
    p.tube(pts, [r0 + (r1 - r0) * (i / (n - 1)) ** 0.9 for i in range(n)],
           [lerp(HORN, HORN_TIP, (i / (n - 1)) ** 1.5) for i in range(n)], sides=sides)


def vertebra(p, center, direction, size, spine=0.8, back=0.3, lateral=0.9, color=BONE):
    c = Vector(center)
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    col = p.vary(color, 0.05)
    # centrum: an hourglass drum
    p.tube([c - d * size * 0.5, c - d * size * 0.38, c, c + d * size * 0.38, c + d * size * 0.5],
           [size * 0.5, size * 0.56, size * 0.42, size * 0.56, size * 0.5], col, sides=10)
    # neural arch + spine: a flattened blade leaning back
    base = c + up * size * 0.45
    tip = base + up * size * spine + d * size * back
    p.tube([base, base.lerp(tip, 0.45) + d * size * 0.05, tip],
           [size * 0.3, size * 0.2, size * 0.04], col, sides=8, squash=0.38, up=tuple(d))
    # transverse processes
    for s in (-1, 1):
        a = c + up * size * 0.15
        b = a + side * s * size * lateral - up * size * 0.12 + d * size * 0.1
        p.tube([a, a.lerp(b, 0.5), b], [size * 0.2, size * 0.13, size * 0.06], col, sides=6, squash=0.5)
    # zygapophyses: the little articular knobs fore and aft
    for s in (-1, 1):
        for e in (-1, 1):
            p.blob(c + up * size * 0.42 + side * s * size * 0.22 + d * e * size * 0.42,
                   (size * 0.16, size * 0.2, size * 0.14), col, segments=6, rings=4)


def rib(p, root, sx, reach, drop, fwd, r, color=BONE):
    a = Vector(root)
    pts = bez3(a, a + Vector((sx * reach * 0.9, fwd * 0.2, 0.25)),
               a + Vector((sx * reach * 1.08, fwd * 0.6, -drop * 0.55)),
               a + Vector((sx * reach * 0.45, fwd, -drop)), 12)
    n = len(pts)
    p.tube(pts, [r * (1.1 - 0.35 * i / (n - 1)) for i in range(n)], p.vary(color, 0.05), sides=7, squash=0.5,
           up=(0, 1, 0))


# ------------------------------------------------------------------- parts
def build_parts():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    # --- skull ---------------------------------------------------------------
    head = part('Skull', 'Head')
    ax = (0, -1, -0.12)
    head.loft([
        ((0, -5.0, 10.55), 0.46, 0.46, 2.4, ax),
        ((0, -5.3, 10.62), 0.9, 0.62, 2.8, ax),
        ((0, -5.8, 10.6), 1.02, 0.6, 3.2, ax),
        ((0, -6.3, 10.46), 0.94, 0.52, 3.4, ax),
        ((0, -6.8, 10.28), 0.7, 0.44, 3.4, ax),
        ((0, -7.35, 10.1), 0.52, 0.36, 3.2, ax),
        ((0, -7.9, 9.94), 0.4, 0.3, 3.0, ax),
        ((0, -8.45, 9.8), 0.3, 0.24, 2.8, ax),
        ((0, -8.8, 9.72), 0.18, 0.16, 2.4, ax),
        ((0, -8.95, 9.68), 0.05, 0.05, 2.0, ax),
    ], BONE, sides=24)
    # a sagittal crest down the midline of the skull
    head.tube(bez((0, -7.8, 10.2), (0, -6.6, 10.75), (0, -5.1, 11.1), 10), [0.05, 0.1, 0.13, 0.1],
              BONE_OLD, sides=6, squash=3.0, up=(1, 0, 0))
    for s in (-1, 1):
        # the orbit rim: a heavy angular brow over a deep socket, a cheek bar under it
        head.tube(bez((s * 0.45, -7.15, 10.52), (s * 0.95, -6.75, 10.95), (s * 1.05, -5.95, 10.75), 8),
                  [0.05, 0.13, 0.16, 0.12], BONE_OLD, sides=6, squash=0.55, up=(0, 0, 1))
        head.tube(bez((s * 0.55, -7.3, 10.02), (s * 1.08, -6.5, 9.98), (s * 1.12, -5.4, 10.2), 8),
                  [0.07, 0.13, 0.15, 0.1], BONE, sides=7, squash=0.7, up=(0, 0, 1))
        # the socket sits INSIDE the skull: only its hollow shows, spectral fire deep in it
        head.blob((s * 0.62, -6.55, 10.5), (0.42, 0.62, 0.36), EMBER_DEEP, mat=GLOW, rot=(0.15, 0, s * 0.3),
                  segments=14, rings=8)
        head.blob((s * 0.74, -6.66, 10.5), (0.2, 0.26, 0.16), FIRE_HOT, mat=GLOW, segments=10, rings=6)
        # nostril slits and the temporal opening behind the eye
        head.blob((s * 0.14, -8.55, 9.95), (0.1, 0.24, 0.07), SOCKET, rot=(0, 0, s * 0.3), segments=8, rings=5)
        head.blob((s * 0.78, -5.55, 10.62), (0.2, 0.36, 0.2), SOCKET, segments=8, rings=5)
        # great horns sweeping back, a lesser pair below them, jaw spikes
        horn(head, bez3((s * 0.55, -5.3, 10.95), (s * 1.3, -4.6, 11.9), (s * 1.9, -3.2, 12.0), (s * 1.7, -1.9, 12.9), 14),
             0.3)
        horn(head, bez3((s * 0.95, -5.4, 10.35), (s * 1.8, -4.7, 10.2), (s * 2.3, -3.9, 10.6), (s * 2.35, -3.2, 11.3), 10),
             0.17)
        horn(head, bez((s * 1.05, -5.1, 10.05), (s * 1.6, -4.4, 9.5), (s * 1.9, -3.9, 9.2), 8), 0.11)
        for k in range(3):
            horn(head, bez((s * (1.0 - k * 0.05), -6.2 + k * 0.45, 10.2 + k * 0.08),
                           (s * (1.35 - k * 0.05), -5.8 + k * 0.45, 10.25 + k * 0.1),
                           (s * (1.55 - k * 0.1), -5.3 + k * 0.45, 10.5 + k * 0.12), 5), 0.07)
        # upper teeth: a ragged row, fangs at the front
        for i in range(11):
            t = i / 10
            y = -6.55 - t * 2.1
            half = 0.66 - t * 0.44
            length = 0.24 + (0.26 if i in (8, 9) else 0.0) + 0.05 * math.sin(i * 2.1)
            head.spike((s * half, y, 9.74 - t * 0.12), 0.055, -length, lerp(BONE, BONE_OLD, 0.3 * (i % 2)),
                       sides=5, lean=(-s * 0.03, -0.04))
    # crest spikes down the crown
    for i in range(4):
        head.spike((0, -6.0 + i * 0.35, 10.95 - i * 0.05), 0.08 - i * 0.012, 0.35 - i * 0.05, HORN, sides=5,
                   lean=(0, 0.18))

    jaw = part('Jaw', 'Jaw')
    for s in (-1, 1):
        mand = bez3((s * 0.95, -5.75, 9.8), (s * 0.95, -6.6, 9.35), (s * 0.55, -7.6, 9.3), (s * 0.12, -8.45, 9.35), 12)
        jaw.tube(mand, [0.15, 0.16, 0.15, 0.14, 0.13, 0.12, 0.115, 0.11, 0.1, 0.095, 0.09, 0.085, 0.08],
                 BONE, sides=10, squash=2.0, up=(0, 0, 1))
        # the coronoid hook at the hinge
        jaw.spike((s * 0.95, -6.0, 9.85), 0.12, 0.45, BONE_OLD, sides=5, lean=(0, 0.12))
        for i in range(9):
            t = i / 8
            pt = mand[1 + int(t * (len(mand) - 3))]
            length = 0.22 + (0.18 if i in (6, 7) else 0) + 0.04 * math.cos(i * 1.7)
            jaw.spike((pt.x * 0.97, pt.y, pt.z + 0.12), 0.05, length, lerp(BONE, BONE_OLD, 0.3 * (i % 2)), sides=5)
    jaw.blob((0, -8.4, 9.3), (0.4, 0.3, 0.18), BONE, segments=10, rings=6)
    # the throat glow the breath rises from
    jaw.blob((0, -6.3, 9.55), (0.5, 0.9, 0.18), FIRE, mat=GLOW, segments=10, rings=6)

    # --- neck -----------------------------------------------------------------
    for k in range(5):
        nk = part(f'Neck{k + 1}Bones', f'Neck{k + 1}')
        a, b = Vector(NECK[k]), Vector(NECK[k + 1])
        for j, t in enumerate((0.28, 0.78)):
            size = 0.62 - (k * 2 + j) * 0.035
            vertebra(nk, a.lerp(b, t), b - a, size, spine=0.7, back=0.35, lateral=0.8)
        # cervical ribs: short hooks hanging from each neck bone
        for s in (-1, 1):
            c = a.lerp(b, 0.5)
            nk.tube(bez(c + Vector((s * 0.35, 0, -0.1)), c + Vector((s * 0.6, 0.25, -0.35)), c + Vector((s * 0.45, 0.5, -0.7)), 5),
                    [0.08, 0.05, 0.02], BONE_OLD, sides=6)

    # --- chest, spine, pelvis -------------------------------------------------
    chest = part('ChestBones', 'Chest')
    spine = part('SpineBones', 'Spine')
    pelvis = part('PelvisBones', 'Pelvis')
    back_line = [(0, 4.6, 5.05), (0, 3.4, 5.3), (0, 2.2, 5.6), (0, 1.0, 5.9), (0, 0.0, 6.02), (0, -1.0, 6.1)]
    for i in range(11):
        t = i / 10
        y = 4.2 - t * 5.1
        z = 5.15 + t * 0.95
        target = chest if y < 1.0 else spine if y < 3.4 else pelvis
        vertebra(target, (0, y, z), (0, -1, 0.12), 0.6, spine=1.5 + 0.5 * math.sin(math.pi * t), back=0.55,
                 lateral=1.0)
    for i in range(9):
        y = -0.7 + i * 0.44
        target = chest if y < 1.0 else spine
        size = 1.0 - abs(i - 3.0) * 0.07
        for s in (-1, 1):
            rib(target, (s * 0.35, y, 5.95 - i * 0.03), s, 1.7 * size, 2.4 * size - i * 0.05, 0.5, 0.13)
    # the keeled sternum the ribs close on
    chest.blob((0, 0.2, 3.55), (1.0, 2.8, 0.45), BONE_OLD, segments=14, rings=8)
    chest.tube(bez((0, -1.2, 3.5), (0, 0.2, 2.9), (0, 1.6, 3.4), 10), [0.1, 0.2, 0.25, 0.2, 0.08], BONE,
               sides=8, squash=2.4, up=(0, 0, 1))
    # scapulae
    for s in (-1, 1):
        chest.tube(bez((s * 0.95, -0.55, 6.35), (s * 1.3, 0.3, 6.9), (s * 1.15, 1.3, 7.1), 8),
                   [0.42, 0.4, 0.28, 0.1], BONE, sides=10, squash=0.14, up=(s, 0, 0.3))
        chest.blob((s * 1.1, -0.4, 6.1), (0.5, 0.5, 0.5), BONE, segments=10, rings=6)
    # the soul fire caged in the ribs
    chest.blob((0, 0.4, 4.75), (0.75, 1.3, 0.8), FIRE, mat=GLOW, segments=12, rings=8, jitter=0.2)
    chest.blob((0, 0.3, 4.75), (0.38, 0.6, 0.42), FIRE_HOT, mat=GLOW, segments=8, rings=6)
    for i in range(6):
        a = i / 6 * math.tau
        base = Vector((math.cos(a) * 0.5, 0.4 + math.sin(a) * 1.0, 5.0))
        chest.tube(bez(base, base + Vector((math.cos(a) * 0.3, 0.2, 0.6)), base + Vector((math.cos(a) * 0.1, 0.4, 1.1)), 5),
                   [0.3, 0.16, 0.0], FIRE, mat=GLOW, sides=6)
    # pelvis: ilium blades, pubis and ischium, the fused sacral plate
    for s in (-1, 1):
        pelvis.tube(bez((s * 0.5, 3.6, 5.4), (s * 1.25, 4.6, 5.75), (s * 0.9, 5.8, 5.55), 8),
                    [0.3, 0.52, 0.46, 0.18], BONE, sides=10, squash=0.16, up=(s, 0, 0.4))
        pelvis.tube(bez((s * 1.0, 4.4, 4.9), (s * 0.8, 3.7, 4.3), (s * 0.3, 3.3, 3.7), 6), [0.2, 0.16, 0.12],
                    BONE, sides=8)
        pelvis.tube(bez((s * 1.0, 4.9, 4.85), (s * 0.8, 5.6, 4.4), (s * 0.3, 6.1, 3.9), 6), [0.18, 0.14, 0.1],
                    BONE, sides=8)
        pelvis.blob((s * 1.3, 4.5, 4.8), (0.55, 0.55, 0.55), BONE_OLD, segments=10, rings=6)
    pelvis.blob((0, 4.6, 5.4), (0.9, 1.6, 0.35), BONE, segments=12, rings=6)

    # --- tail -------------------------------------------------------------------
    for k in range(len(TAIL) - 1):
        tp = part(f'Tail{k + 1}Bones', f'Tail{k + 1}')
        a, b = Vector(TAIL[k]), Vector(TAIL[k + 1])
        count = 3 if k < 6 else 2
        for j in range(count):
            t = (j + 0.5) / count
            size = 0.56 - (k + t) * 0.045
            vertebra(tp, a.lerp(b, t), b - a, size, spine=0.9 - k * 0.06, back=0.5, lateral=0.9 - k * 0.05)
            if k < 4:
                # chevrons hanging under the tail
                c = a.lerp(b, t)
                tp.tube([c + Vector((0, 0, -size * 0.4)), c + Vector((0, size * 0.25, -size * 1.1))],
                        [size * 0.15, size * 0.05], BONE_OLD, sides=6, squash=0.5)
    # the tail blade: three bone vanes fanned at the tip
    tip = part('TailBlade', 'Tail9')
    end = Vector(TAIL[-1])
    for s, lift in ((0, 0.0), (-1, 0.1), (1, 0.1)):
        tip.tube(bez(end + Vector((0, -0.4, 0)), end + Vector((s * 0.9, 0.6, 0.35 + lift)), end + Vector((s * 0.5, 1.9, 0.5 + lift)), 8),
                 [0.35, 0.3, 0.02], lerp(BONE_OLD, HORN, 0.3), sides=8, squash=0.25, up=(s, 0, 1) if s else (1, 0, 0))

    # --- hind legs ---------------------------------------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        def mx(v):
            return (v[0] * s, v[1], v[2])
        th = part('Thigh' + tag + 'Bone', 'Thigh' + tag)
        long_bone(th, mx(REST['Thigh.L'][0]), mx(REST['Thigh.L'][1]), 0.3, bow=0.04)
        sh = part('Shin' + tag + 'Bone', 'Shin' + tag)
        a, b = REST['Shin.L']
        long_bone(sh, mx(a), mx(b), 0.24)
        long_bone(sh, mx(a + Vector((0.22, 0.12, -0.1))), mx(b + Vector((0.18, -0.05, 0.15))), 0.1, condyles=False)
        ft = part('Foot' + tag + 'Bone', 'Foot' + tag)
        a, b = REST['Foot.L']
        for off in (-0.16, 0.0, 0.16):
            long_bone(ft, mx(a + Vector((off, 0, 0))), mx(b + Vector((off * 1.4, 0, 0))), 0.1, condyles=False)
        ft.blob(mx(b), (0.4, 0.4, 0.3), BONE_OLD, segments=10, rings=6)
        # the dew claw spur behind the heel
        claw(ft, mx(a.lerp(b, 0.5) + Vector((0, 0.18, 0))), mx((0, 1, -0.3)), 0.7, 0.1, curl=0.6)
        to = part('Toes' + tag + 'Bone', 'Toes' + tag)
        base = REST['Toes.L'][0]
        for spread in (-0.5, 0.0, 0.5):
            d = Vector((spread * 0.6, -1.0, -0.05)).normalized()
            p0 = base + Vector((spread * 0.25, -0.1, 0))
            p1 = p0 + d * 0.8
            p2 = p1 + d * 0.6
            long_bone(to, mx(p0), mx(p1), 0.09, condyles=False)
            long_bone(to, mx(p1), mx(p2), 0.08, condyles=False)
            claw(to, mx(p2), mx(tuple(d)), 0.95, 0.12, curl=1.0)
        claw(to, mx(base + Vector((0, 0.3, 0))), mx((0, 1, -0.2)), 0.6, 0.09, curl=0.8)

    # --- wings ---------------------------------------------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        def mx(v):
            return (v[0] * s, v[1], v[2])
        hu = part('Humerus' + tag + 'Bone', 'Humerus' + tag)
        a, b = REST['Humerus.L']
        long_bone(hu, mx(a), mx(b), 0.34, bow=0.03)
        fa = part('Forearm' + tag + 'Bone', 'Forearm' + tag)
        a, b = REST['Forearm.L']
        long_bone(fa, mx(a), mx(b), 0.24, bow=0.02)
        long_bone(fa, mx(a + Vector((0, 0.3, -0.12))), mx(b + Vector((0, 0.22, -0.08))), 0.14, condyles=False)
        hd = part('Hand' + tag + 'Bone', 'Hand' + tag)
        a, b = REST['Hand.L']
        long_bone(hd, mx(a), mx(b), 0.22)
        hd.blob(mx(b), (0.5, 0.5, 0.42), BONE_OLD, segments=10, rings=6)
        tb = part('Thumb' + tag + 'Bone', 'Thumb' + tag)
        a, b = REST['Thumb.L']
        long_bone(tb, mx(a), mx(b), 0.14, condyles=False)
        claw(tb, mx(b), mx(tuple((b - a).normalized())), 1.1, 0.17, curl=1.1)
        for fname, r0, r1, has_b in (('Finger1', 0.17, 0.08, True), ('Finger2', 0.15, 0.07, True),
                                     ('Finger3', 0.13, 0.05, False), ('Finger4', 0.13, 0.05, False)):
            if has_b:
                fp = part(fname + 'a' + tag + 'Bone', fname + 'a' + tag)
                a, b = REST[fname + 'a.L']
                long_bone(fp, mx(a), mx(b), r0, knob=1.35, condyles=False)
                fq = part(fname + 'b' + tag + 'Bone', fname + 'b' + tag)
                a, b = REST[fname + 'b.L']
                long_bone(fq, mx(a), mx(b), r1 * 1.25, knob=1.4, condyles=False)
                claw(fq, mx(b), mx(tuple((b - a).normalized())), 0.5, r1 * 0.9, curl=0.6)
            else:
                fp = part(fname + tag + 'Bone', fname + tag)
                a, b = REST[fname + '.L']
                long_bone(fp, mx(a), mx(b), (r0 + r1) * 0.5, knob=1.35, condyles=False)
                claw(fp, mx(b), mx(tuple((b - a).normalized())), 0.4, r1 * 0.9, curl=0.5)

    # --- membranes -----------------------------------------------------------------
    membranes = []
    for s, tag in ((1, '.L'), (-1, '.R')):
        def mx(v):
            v = Vector(v)
            return Vector((v.x * s, v.y, v.z))

        def spar(names):
            out = []
            for n in names:
                h, t = REST[n + '.L']
                out.append((mx(h), n + tag))
            h, t = REST[names[-1] + '.L']
            out.append((mx(t), names[-1] + tag))
            return out

        f1 = spar(['Finger1a', 'Finger1b'])
        f2 = spar(['Finger2a', 'Finger2b'])
        f3 = spar(['Finger3'])
        f4 = spar(['Finger4'])
        # the arm and the flank: wrist -> elbow -> shoulder -> flank -> thigh
        body = [(mx(REST['Hand.L'][0]), 'Hand' + tag), (mx(REST['Forearm.L'][0]), 'Forearm' + tag),
                (mx((1.35, 0.4, 6.0)), 'Chest'), (mx((1.3, 2.4, 5.6)), 'Spine'),
                (mx((1.6, 4.3, 4.9)), 'Pelvis'), (mx((1.9, 3.6, 3.6)), 'Thigh' + tag)]
        m = Membrane('Membrane' + tag, SKIN, seed=7 if s > 0 else 11)
        m.panel(f1, f2, rows=16, cols=11, scallop=0.2, tear=0.45, shade=0.95)
        m.panel(f2, f3, rows=16, cols=11, scallop=0.24, tear=0.55, sag=0.1)
        m.panel(f3, f4, rows=14, cols=11, scallop=0.24, tear=0.5, sag=0.15)
        m.panel(f4, body, rows=16, cols=14, scallop=0.12, tear=0.35, sag=0.25, shade=0.9)
        # the leading-edge skin between the shoulder and the wrist
        lead = [(mx((1.25, -0.55, 6.2)), 'Chest'), (mx(REST['Humerus.L'][1] + Vector((0, -0.3, 0.1))), 'Humerus' + tag),
                (mx(REST['Hand.L'][0] + Vector((0, -0.35, 0.05))), 'Forearm' + tag)]
        arm_line = [(mx(REST['Humerus.L'][0]), 'Humerus' + tag), (mx(REST['Humerus.L'][1]), 'Forearm' + tag),
                    (mx(REST['Hand.L'][0]), 'Hand' + tag)]
        m.panel(lead, arm_line, rows=8, cols=2, scallop=0.0, tear=0.0, shade=1.0)
        membranes.append(m)
    return parts, membranes


# -------------------------------------------------------------------- clips
def make_clips(arm, extend=None):
    rig = Rig(BONES).attach(arm)
    P = rig.pose

    L_WRIST_GROUND = (3.6, -2.4, 0.35)
    L_FOOT_GROUND = (1.9, 3.4, 0.15)

    def stand(breath=0.0, sway=0.0, root=(0, 0, 0), head_look=(0, -1, -0.15), wrist=None, foot=None,
              tail=0.0, jaw=0.0, neck_lift=0.0, wings=0.0):
        """The ground stance: wrists and feet planted, neck raised in an S."""
        rz = root[2]
        w = Vector(wrist or L_WRIST_GROUND)
        f = Vector(foot or L_FOOT_GROUND)
        # Where the folded forearm runs: the fingers furl back up along it.
        sh = Vector(REST['Humerus.L'][0]) + Vector(root)
        l1 = (REST['Humerus.L'][1] - REST['Humerus.L'][0]).length
        l2 = (REST['Forearm.L'][1] - REST['Forearm.L'][0]).length
        _, fore = two_bone(sh, l1, l2, w, Vector((0.4, 0.8, 0.9)))
        back = -fore
        def furl(out, up):
            return tuple(back + Vector((out, 0.15, up)))
        aims = {
            # folded wing: humerus down-forward to the planted wrist, fingers
            # swept up and back along the arm like a furled umbrella
            'Finger1a.L': furl(0.05, 0.25), 'Finger1b.L': furl(0.0, 0.1),
            'Finger2a.L': furl(0.12, 0.15), 'Finger2b.L': furl(0.08, 0.0),
            'Finger3.L': furl(0.18, 0.05), 'Finger4.L': furl(0.25, -0.1),
            'Thumb.L': (0.15, -1.0, -0.12),
            'Hand.L': furl(0.1, 0.4),
            'Neck1': (0, -0.55, 0.84 + neck_lift), 'Neck2': (0, -0.45, 0.9 + neck_lift),
            'Neck3': (0, -0.35, 1.0), 'Neck4': (0, -0.7, 0.75 - neck_lift * 0.5),
            'Neck5': (0, -1.0, 0.3 - neck_lift), 'Head': head_look,
            'Toes.L': (0.1, -1.0, 0.22), 'Foot.L': (0.0, -0.55, -0.95),
        }
        ik = {'arm.L': ('Humerus.L', 'Forearm.L', tuple(w + Vector((0, 0, rz * 0.0))), (0.4, 0.8, 0.9)),
              'leg.L': ('Thigh.L', 'Shin.L', tuple(f + Vector((0, 0.45, 1.25))), (0.1, -1, 0.2))}
        turns = {'Chest': [('x', -breath * 2.5)], 'Spine': [('x', breath * 1.2)],
                 'Neck2': [('z', sway * 3)], 'Neck4': [('z', sway * 4)], 'Head': [('z', sway * 6)],
                 'Jaw': [('x', jaw)],
                 'Tail1': [('z', tail * 5), ('x', 4)], 'Tail2': [('z', tail * 6), ('x', 3)], 'Tail3': [('z', tail * 7)],
                 'Tail4': [('z', tail * 8), ('x', -4)], 'Tail5': [('z', tail * 8), ('x', -5)], 'Tail6': [('z', tail * 7)],
                 'Tail7': [('z', tail * 6)], 'Tail8': [('z', tail * 5)], 'Foot.L': [('x', 0)]}
        if wings:
            turns['Humerus.L'] = [('y', -wings)]
        pose = P(aims=aims, ik=ik, turns=turns, root=root)
        return pose

    clips = []

    def add(name, keys, loop_clip=True):
        clip(arm, name, keys, loop_clip)
        clips.append(name)

    # Idle: slow deep breaths, the neck weaving, the tail drifting.
    add('Idle', cycle(96, [stand(0, 0, (0, 0, 0), tail=0.4), stand(1, 0.6, (0, 0, 0.12), tail=0.0, jaw=4),
                          stand(0.3, 0, (0, 0, 0.05), tail=-0.4), stand(1, -0.6, (0, 0, 0.12), tail=0.0, jaw=3)]))

    # Walk: a heavy four-point gait on wrists and feet (diagonal pairs).
    def gait(phase, stride, lift, rootz, lean=0.0):
        def cyc(o):
            a = (phase + o) % 1.0
            if a < 0.6:   # planted, sliding back under the body
                t = a / 0.6
                return stride * (0.5 - t), 0.0
            t = (a - 0.6) / 0.4
            return stride * (-0.5 + t), lift * math.sin(math.pi * t)
        wl, wlz = cyc(0.0)
        fr, frz = cyc(0.0)
        wr, wrz = cyc(0.5)
        fl, flz = cyc(0.5)
        pose = stand(0.3, math.sin(phase * math.tau) * 0.8, (0, 0, rootz), tail=math.sin(phase * math.tau) * 0.9,
                     head_look=(0, -1, -0.25 - lean))
        left = stand(0.3, math.sin(phase * math.tau) * 0.8, (0, 0, rootz), tail=math.sin(phase * math.tau) * 0.9,
                     head_look=(0, -1, -0.25 - lean),
                     wrist=(3.6, -2.4 + wl, 0.35 + wlz), foot=(1.9, 3.4 + fl, 0.15 + flz))
        right = stand(0.3, math.sin(phase * math.tau) * 0.8, (0, 0, rootz), tail=math.sin(phase * math.tau) * 0.9,
                      head_look=(0, -1, -0.25 - lean),
                      wrist=(3.6, -2.4 + wr, 0.35 + wrz), foot=(1.9, 3.4 + fr, 0.15 + frz))
        for k, v in right.items():
            if k.endswith('.R'):
                pose[k] = v
        for k, v in left.items():
            if k.endswith('.L'):
                pose[k] = v
        return pose

    add('Walk', cycle(48, [gait(i / 8, 2.6, 0.9, 0.1 * math.cos(i / 8 * 2 * math.tau)) for i in range(8)]))
    add('Run', cycle(26, [gait(i / 8, 4.2, 1.5, 0.25 * math.cos(i / 8 * 2 * math.tau), lean=0.2) for i in range(8)]))

    # Flight: the wings spread, body level, legs tucked back.
    def flight(beat, glide=False, pitch=0.0, rootz=0.0):
        """beat in [-1, 1]: +1 wings high, -1 wings low (the downstroke end)."""
        up = beat
        arm_up = 0.55 * up
        tip = 0.35 * up
        aims = {
            'Humerus.L': (1.0, 0.05 + 0.2 * max(0, -up), 0.25 + arm_up),
            'Forearm.L': (1.0, -0.12 - 0.1 * up, 0.1 + arm_up * 0.9 + (0.0 if glide else -0.05)),
            'Hand.L': (1.0, -0.05, 0.08 + tip),
            'Finger1a.L': (1.0, 0.18, tip * 0.6), 'Finger1b.L': (0.92, 0.38, tip * 0.4 - 0.08),
            'Finger2a.L': (0.7, 0.72, tip * 0.4), 'Finger2b.L': (0.6, 0.8, tip * 0.2 - 0.1),
            'Finger3.L': (0.3, 0.95, tip * 0.2 - 0.1), 'Finger4.L': (-0.12, 1.0, -0.12),
            'Thumb.L': (0.2, -1.0, -0.2),
            'Neck1': (0, -0.85, 0.5), 'Neck2': (0, -0.9, 0.45), 'Neck3': (0, -0.95, 0.3), 'Neck4': (0, -1, 0.15),
            'Neck5': (0, -1, 0.0), 'Head': (0, -1, -0.2),
            'Thigh.L': (0.15, 0.8, -0.45), 'Shin.L': (0.05, 0.95, 0.2), 'Foot.L': (0, 0.9, -0.3), 'Toes.L': (0, 0.4, -0.9),
        }
        turns = {'Root': [('x', pitch)], 'Tail1': [('x', 6)], 'Tail2': [('x', 4 - up * 3)], 'Tail3': [('x', 2 - up * 3)],
                 'Tail5': [('x', -2 + up * 3)], 'Tail7': [('x', up * 3)], 'Chest': [('x', -up * 3)]}
        return P(aims=aims, turns=turns, root=(0, 0, rootz - up * 0.35))

    # Two great downbeats, then a long glide on spread wings.
    add('Fly', [(1, flight(0.1)), (8, flight(1.0)), (16, flight(-1.0)), (24, flight(1.0)), (32, flight(-1.0)),
                (40, flight(0.2)), (56, flight(0.05, True, 2)), (72, flight(-0.05, True, -1)),
                (88, flight(0.1, True, 1)), (97, flight(0.1))])
    # Descent: wings cupped high to brake, legs reaching down.
    def descend(k):
        pose = flight(0.55 + 0.1 * k, True, -8)
        return pose
    add('Glide', cycle(32, [descend(0), descend(1)]))
    # Land: flare, touch, crouch on the impact, rise into the stance.
    flare = flight(0.9, True, -18)
    crouch = stand(1.0, 0, (0, 0, -1.1), head_look=(0, -1, -0.45), tail=0.2)
    add('Land', [(1, flare), (8, flight(0.6, True, -10)), (13, crouch), (22, crouch), (34, stand(0.5, 0, (0, 0, 0.05))),
                 (40, stand(0, 0))], loop_clip=False)

    # Roar: rear up, neck high, jaws wide, wings half spread.
    def roar(open_jaw, rise):
        pose = stand(1.0, 0, (0, 0.6 * rise, 0.9 * rise), head_look=(0, -0.6, 0.8 * rise - 0.1), jaw=open_jaw,
                     neck_lift=0.5 * rise, wings=25 * rise, wrist=(3.6, -2.0, 0.35 + 1.2 * rise))
        return pose
    add('Roar', [(1, stand(0, 0)), (14, roar(10, 0.6)), (22, roar(42, 1.0)), (40, roar(44, 1.0)),
                 (52, roar(20, 0.6)), (64, stand(0, 0))], loop_clip=False)

    # Bite: coil the neck back, lunge down, snap shut, recoil.
    def bite(lunge, open_jaw, turn=0.0):
        head_look = (turn * 0.5, -1, -0.2 - 0.9 * lunge)
        pose = stand(0.5, turn * 2, (0, -0.8 * lunge, -0.3 * lunge), head_look=head_look, jaw=open_jaw,
                     neck_lift=-0.9 * lunge + 0.25 * max(0, -lunge))
        return pose
    add('Bite', [(1, stand(0, 0)), (8, bite(-0.4, 25)), (13, bite(1.0, 38)), (16, bite(1.0, 0)), (22, bite(0.5, 4)),
                 (30, stand(0, 0))], loop_clip=False)
    add('Bite2', [(1, stand(0, 0)), (7, bite(-0.3, 20, -0.8)), (12, bite(0.9, 40, 0.6)), (15, bite(0.95, 0, 0.3)),
                  (19, bite(0.9, 0, -0.4)), (23, bite(0.9, 0, 0.3)), (32, stand(0, 0))], loop_clip=False)

    # Breath: over the 2 s bar the drake rears back and draws the fire up its
    # throat (the chest swells, the jaw slowly parts); the exhale plays OUT
    # after the bar (castPlayOut) with the head thrust low and forward, jaws
    # agape, sweeping the cone; then it settles.
    rear = stand(1.0, 0, (0, 1.0, 0.7), head_look=(0, -0.3, 0.9), neck_lift=0.7, jaw=8, wings=15,
                 wrist=(3.6, -1.9, 1.0))
    rear_hi = stand(1.0, 0, (0, 1.2, 0.9), head_look=(0, -0.2, 0.95), neck_lift=0.8, jaw=18, wings=22,
                    wrist=(3.6, -1.8, 1.2))

    def exhale(sweep):
        return stand(0.2, sweep * 2, (0, -1.0, -1.1), head_look=(sweep * 0.3, -0.75, -1.0), neck_lift=-1.1, jaw=46,
                     wings=-5)
    add('Breath', [(1, stand(0, 0)), (20, rear), (44, rear_hi), (49, exhale(0)), (60, exhale(-0.6)),
                   (74, exhale(0.6)), (84, exhale(0)), (100, stand(0, 0))], loop_clip=False)

    # Tail sweep: over the 1 s bar it coils the tail round one flank, then it
    # whips it across the whole rear at the bar's end (frame 25), and recovers.
    def tail_pose(a, body_turn):
        pose = stand(0.4, 0, (0, 0, 0.1), tail=a, head_look=(-a * 0.2, -1, -0.2))
        extra = P(aims={}, turns={'Pelvis': [('z', body_turn)], 'Tail1': [('z', a * 14)], 'Tail2': [('z', a * 16)],
                                   'Tail3': [('z', a * 16)], 'Tail4': [('z', a * 14)], 'Tail5': [('z', a * 12)],
                                   'Tail6': [('z', a * 10)], 'Tail7': [('z', a * 8)], 'Tail8': [('z', a * 6)]})
        for k in ('Pelvis',) + tuple(f'Tail{i}' for i in range(1, 9)):
            pose[k] = extra[k]
        return pose
    add('TailSweep', [(1, stand(0, 0)), (14, tail_pose(-1.0, -10)), (22, tail_pose(-1.2, -14)), (25, tail_pose(0.2, 6)),
                      (29, tail_pose(1.3, 16)), (36, tail_pose(0.8, 8)), (46, stand(0, 0))], loop_clip=False)

    # Wing buffet: over the 1.5 s bar it rears up and raises both wings high
    # and wide, then at the bar's end (frame 37) slams them down in one
    # buffet that throws everyone close back.
    def buffet(up, rise):
        pose = flight(up, True, -22 * rise, rootz=1.6 * rise)
        ground = stand(0.8, 0, (0, 0, 1.6 * rise), head_look=(0, -0.6, 0.5 * rise), jaw=20 * rise, neck_lift=0.4 * rise)
        for k in list(pose.keys()):
            if k.startswith(('Thigh', 'Shin', 'Foot', 'Toes', 'Neck', 'Head', 'Jaw', 'Tail')):
                pose[k] = ground[k]
        return pose
    add('WingBuffet', [(1, stand(0, 0)), (16, buffet(0.6, 0.6)), (34, buffet(1.0, 1.0)), (37, buffet(-0.3, 0.7)),
                       (41, buffet(-1.0, 0.35)), (50, buffet(-0.8, 0.2)), (62, stand(0, 0))], loop_clip=False)

    # SkyRoar: the cry it gives as it breaks off its flight and dives in.
    def sky_roar(k):
        pose = flight(0.7 - 0.3 * k, True, -14)
        pose.update({b: q for b, q in P(aims={'Neck1': (0, -0.6, 0.8), 'Neck2': (0, -0.5, 0.85),
                                               'Neck3': (0, -0.5, 0.85), 'Neck4': (0, -0.8, 0.6),
                                               'Neck5': (0, -0.9, 0.4), 'Head': (0, -0.8, 0.55)},
                                         turns={'Jaw': [('x', 40 * k)], 'Root': [('x', -14)]}).items()
                     if b.startswith(('Neck', 'Head', 'Jaw'))})
        return pose
    add('SkyRoar', [(1, flight(0.6, True, -10)), (8, sky_roar(0.6)), (14, sky_roar(1.0)), (30, sky_roar(1.0)),
                    (40, flight(0.6, True, -8))], loop_clip=False)

    add('Hit', [(1, stand(0, 0)), (4, stand(0.6, 1.5, (0, 0.5, 0.1), head_look=(0.3, -0.8, 0.2), jaw=20)),
                (14, stand(0, 0))], loop_clip=False)
    # Death: a last roar, the legs buckle, it crashes on its side, wings crumpled.
    dying = stand(1.0, 0, (0, 0.4, 0.4), head_look=(0, -0.4, 0.8), jaw=40, neck_lift=0.6)
    slump = stand(0.0, 0, (0, 0.5, -2.2), head_look=(0.5, -0.6, -0.8), jaw=30, neck_lift=-1.2,
                  wrist=(4.6, -2.0, 0.2), foot=(2.6, 3.6, 0.3), tail=1.2)
    dead = P(aims={}, turns={'Root': [('y', 24)]}, root=(0.3, 0.6, -3.0))
    dead_pose = dict(slump)
    dead_pose['Root'] = dead['Root']
    dead_pose['__root'] = dead['__root']
    add('Death', [(1, stand(0, 0)), (10, dying), (26, slump), (40, dead_pose), (52, dead_pose)], loop_clip=False)
    if extend is not None:
        # A variant (build_knellwyrm.py) authors its own clips with the same
        # pose helpers; the drake itself passes nothing and is unchanged.
        extend({'add': add, 'P': P, 'stand': stand, 'flight': flight, 'roar': roar,
                'exhale': exhale, 'buffet': buffet})
    return clips


# --------------------------------------------------------------------- main
if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    new_scene()
    mats = make_materials('bone')
    parts, membranes = build_parts()
    objects = [pt.to_object(mats) for pt in parts] + [m.to_object(mats) for m in membranes]
    body = join(objects, 'OssuaryDrake')
    print('TRIANGLES', triangles(body))
    size = 2048 if '--fast' not in argv else 512
    bake_surface(body, size=size, samples=24 if '--fast' in argv else 48)
    arm = build_armature('OssuaryDrake', BONES)
    bind(body, arm)
    clips = make_clips(arm)
    # Measure the idle stance the runtime normalizes to (mid-idle).
    import bpy
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(13)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3))
    export(out, arm)
    if '--sheet' in argv:
        setup_preview((0, -1, 5), 30, ref_x=6.0)
        render_sheet(arm, clips, argv[argv.index('--sheet') + 1], 'drake')
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
