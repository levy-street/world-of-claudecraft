"""Build one Hollow Crypt creature: model, rigid-skinned rig and clip set.

  blender -b --factory-startup --python build_creature.py -- <gargoyle|crow|drake> <out.glb> [--preview out.png] [--blend out.blend]

The creatures (src/render/characters/manifest.ts VISUALS rows):
  gargoyle  Chapel Gargoyle: a crouched stone gargoyle, bat wings, horned, ember eyes.
  crow      Carrion Crow: a ragged black crow that is always on the wing.
  drake     Ossuary Drake: the skeletal drake, four legs, bone wings with torn
            membranes, a frost-lit ribcage and eyes.

Every clip set carries Idle, Walk, Run, Attack, Hit, Death and Cast, plus the
creature's own casts (the drake's Breath, TailLash and WingGust). See
creature_kit.py for the conventions (yards, +Z up, facing -Y).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creature_kit import (  # noqa: E402
    GLOW, Body, author_clip, build_rig, expand_bones, export, finish_body, hckit, loop, new_scene, preview,
)

C = hckit
STONE_G = (0.84, 0.83, 0.85)
STONE_GD = (0.64, 0.64, 0.68)
EMBER = (1.0, 0.45, 0.15)
FROST = (0.55, 0.85, 1.0)
FEATHER = (0.09, 0.085, 0.1)
FEATHER_HI = (0.2, 0.2, 0.26)
BEAK = (0.3, 0.27, 0.22)
MEMBRANE = (0.23, 0.2, 0.24)
BONE_I = (0.9, 0.86, 0.74)
BONE_D = (0.7, 0.65, 0.54)


def membrane(p, corners, color):
    """A two-sided membrane quad or tri (both windings: no backface holes)."""
    p.plane(corners, color)
    p.plane(list(reversed(corners)), color)


def sides(fn):
    for s, tag in ((1, '.L'), (-1, '.R')):
        fn(s, tag)


# =============================================================== gargoyle
GARGOYLE_BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Hips', 'Root', (0, 0.15, 0.95), (0, 0.1, 1.25)),
    ('Spine', 'Hips', (0, 0.1, 1.25), (0, -0.05, 1.65)),
    ('Chest', 'Spine', (0, -0.05, 1.65), (0, -0.2, 2.0)),
    ('Neck', 'Chest', (0, -0.2, 2.0), (0, -0.4, 2.2)),
    ('Head', 'Neck', (0, -0.4, 2.2), (0, -0.75, 2.3)),
    ('Jaw', 'Head', (0, -0.45, 2.1), (0, -0.8, 2.05)),
    ('Arm.L', 'Chest', (0.42, -0.15, 1.95), (0.55, -0.4, 1.45)),
    ('Fore.L', 'Arm.L', (0.55, -0.4, 1.45), (0.5, -0.7, 0.95)),
    ('Hand.L', 'Fore.L', (0.5, -0.7, 0.95), (0.5, -0.85, 0.7)),
    ('Thigh.L', 'Hips', (0.3, 0.15, 0.95), (0.42, -0.3, 0.65)),
    ('Shin.L', 'Thigh.L', (0.42, -0.3, 0.65), (0.38, 0.1, 0.3)),
    ('Foot.L', 'Shin.L', (0.38, 0.1, 0.3), (0.38, -0.3, 0.02)),
    ('Wing.L', 'Chest', (0.25, 0.3, 1.95), (0.8, 0.55, 2.35)),
    ('WingTip.L', 'Wing.L', (0.8, 0.55, 2.35), (1.5, 0.75, 2.0)),
    ('Tail1', 'Hips', (0, 0.3, 1.0), (0, 0.8, 0.7)),
    ('Tail2', 'Tail1', (0, 0.8, 0.7), (0, 1.3, 0.35)),
    ('Tail3', 'Tail2', (0, 1.3, 0.35), (0, 1.7, 0.3)),
])


def gargoyle_body():
    p = Body('CryptGargoyle', lichen=0.5)
    p.on('Hips')
    p.rock((0, 0.12, 1.08), (0.72, 0.6, 0.45), p.vary(STONE_G), jitter=0.1, subdivisions=1)
    p.on('Spine')
    p.prism((0, 0.1, 1.2), 8, 0.33, 0.38, 0.5, p.vary(STONE_G), phase=math.pi / 8, lean=(0, -0.12))
    p.on('Chest')
    p.prism((0, -0.02, 1.62), 8, 0.4, 0.46, 0.42, p.vary(STONE_G), phase=math.pi / 8, lean=(0, -0.12))
    p.box((0, -0.3, 1.82), (0.62, 0.22, 0.42), p.vary(STONE_GD), bevel=0.05, pitch=0.25)
    for sx in (-1, 1):
        p.box((sx * 0.42, -0.1, 1.96), (0.34, 0.4, 0.26), p.vary(STONE_G), bevel=0.05, roll=sx * 0.2)
    for i in range(3):
        p.spike((0, 0.28 - i * 0.02, 1.7 + i * 0.16), 0.08, 0.26, STONE_GD, sides=4, lean=(0, 0.14))
    p.on('Neck')
    p.prism((0, -0.22, 1.98), 6, 0.2, 0.17, 0.3, STONE_G, lean=(0, -0.18))
    p.on('Head')
    p.box((0, -0.55, 2.27), (0.44, 0.44, 0.36), p.vary(STONE_G), bevel=0.06)
    p.box((0, -0.82, 2.2), (0.3, 0.3, 0.22), p.vary(STONE_G), bevel=0.05, taper=0.8)
    p.box((0, -0.6, 2.46), (0.5, 0.3, 0.1), STONE_GD, bevel=0.03, pitch=-0.2)
    for sx in (-1, 1):
        p.box((sx * 0.12, -0.77, 2.33), (0.1, 0.05, 0.06), EMBER, mat=GLOW)
        p.sweep(p.bezier((sx * 0.18, -0.5, 2.45), (sx * 0.35, -0.35, 2.75), (sx * 0.28, -0.05, 2.85), 6),
                0.07, 0.015, STONE_GD, sides=5)
        p.spike((sx * 0.24, -0.42, 2.3), 0.06, 0.2, STONE_G, sides=4, lean=(sx * 0.12, 0.08))
    p.on('Jaw')
    p.box((0, -0.68, 2.06), (0.3, 0.42, 0.1), p.vary(STONE_GD), bevel=0.03)
    for sx in (-0.09, 0.0, 0.09):
        p.spike((sx, -0.86, 2.1), 0.03, 0.08, BONE_I, sides=3)

    def arm(s, t):
        p.on('Arm' + t)
        p.prism((s * 0.46, -0.2, 1.48), 6, 0.1, 0.13, 0.5, p.vary(STONE_G), lean=(s * -0.06, 0.22))
        p.rock((s * 0.46, -0.16, 1.9), (0.3, 0.3, 0.28), STONE_G, jitter=0.1, subdivisions=1)
        p.on('Fore' + t)
        p.prism((s * 0.52, -0.7, 0.98), 6, 0.08, 0.12, 0.5, p.vary(STONE_G), lean=(s * 0.03, 0.3))
        p.on('Hand' + t)
        p.box((s * 0.5, -0.78, 0.84), (0.2, 0.2, 0.16), STONE_GD, bevel=0.03)
        for k in (-1, 0, 1):
            p.spike((s * 0.5 + k * 0.06, -0.84, 0.78), 0.035, 0.18, BONE_D, sides=3, lean=(0, -0.08))

    def leg(s, t):
        p.on('Thigh' + t)
        p.prism((s * 0.36, -0.08, 0.66), 6, 0.13, 0.17, 0.34, p.vary(STONE_G), lean=(s * -0.05, 0.25))
        p.on('Shin' + t)
        p.prism((s * 0.4, 0.05, 0.3), 6, 0.08, 0.11, 0.36, p.vary(STONE_G), lean=(0, -0.25))
        p.on('Foot' + t)
        p.rock((s * 0.38, 0.05, 0.26), (0.2, 0.22, 0.2), STONE_G, jitter=0.08, subdivisions=1)
        p.box((s * 0.38, -0.1, 0.1), (0.26, 0.44, 0.2), STONE_GD, bevel=0.04, taper=0.8)
        for k in (-1, 0, 1):
            p.spike((s * 0.38 + k * 0.08, -0.32, 0.03), 0.04, 0.16, BONE_D, sides=3, lean=(0, -0.12))

    def wing(s, t):
        p.on('Wing' + t)
        p.sweep([(s * 0.25, 0.3, 1.95), (s * 0.55, 0.45, 2.2), (s * 0.8, 0.55, 2.35)], 0.07, 0.05, STONE_G, sides=5)
        p.on('WingTip' + t)
        p.sweep([(s * 0.8, 0.55, 2.35), (s * 1.2, 0.68, 2.25), (s * 1.5, 0.75, 2.0)], 0.05, 0.02, STONE_G, sides=5)
        p.spike((s * 1.5, 0.75, 2.0), 0.04, 0.2, STONE_GD, sides=3, lean=(s * 0.1, 0))
        # Membrane panels between the wing bone and the body, and the tip fan.
        p.on('Wing' + t)
        membrane(p, [(s * 0.28, 0.32, 1.9), (s * 0.8, 0.55, 2.3), (s * 0.7, 0.62, 1.55), (s * 0.3, 0.4, 1.3)], MEMBRANE)
        p.on('WingTip' + t)
        membrane(p, [(s * 0.8, 0.55, 2.3), (s * 1.48, 0.74, 1.98), (s * 1.15, 0.72, 1.45), (s * 0.72, 0.62, 1.55)],
                 MEMBRANE)

    sides(arm)
    sides(leg)
    sides(wing)
    p.on('Tail1')
    p.prism((0, 0.3, 1.0), 6, 0.14, 0.1, 0.62, STONE_G, axis=(0, 0.85, -0.5))
    p.on('Tail2')
    p.prism((0, 0.8, 0.7), 6, 0.1, 0.07, 0.6, STONE_G, axis=(0, 0.8, -0.6))
    p.on('Tail3')
    p.box((0, 1.55, 0.32), (0.26, 0.3, 0.06), STONE_GD, bevel=0.02, yaw=0.78)
    return p


def gargoyle_clips(arm):
    crouch = {'Spine': [('x', 18)], 'Chest': [('x', 10)], 'Head': [('x', -22)],
              'Wing.L': [('z', 18), ('y', 10)], 'WingTip.L': [('z', 30)],
              'Tail1': [('z', 12)], 'Tail2': [('z', 18)]}
    statue_b = dict(crouch, Chest=[('x', 12)], Head=[('x', -24)])
    author_clip(arm, 'Idle', loop(72, [crouch, statue_b]))

    def stride(a):
        return {'Spine': [('x', 14)], 'Head': [('x', -12)],
                'Thigh.L': [('x', -24 * a)], 'Shin.L': [('x', 10 * a)],
                'Thigh.R': [('x', 24 * a)], 'Shin.R': [('x', -10 * a)],
                'Arm.L': [('x', 20 * a)], 'Arm.R': [('x', -20 * a)],
                'Wing.L': [('z', 14), ('y', 6)], 'Tail1': [('z', 10 * a)], 'Root': [('loc', (0, 0, 0.04))]}
    author_clip(arm, 'Walk', loop(24, [stride(1), stride(0), stride(-1), stride(0)]))

    def fly(up):
        return {'Root': [('x', 22), ('loc', (0, 0, 0.12 if up > 0 else -0.05))],
                'Head': [('x', -26)], 'Thigh.L': [('x', 40)], 'Shin.L': [('x', -30)],
                'Arm.L': [('x', 30)], 'Fore.L': [('x', -20)],
                'Wing.L': [('y', -55 * up)], 'WingTip.L': [('y', -25 * up)], 'Tail1': [('x', -12)]}
    author_clip(arm, 'Run', loop(14, [fly(1), fly(0.1), fly(-1), fly(0.1)]))
    ready = {'Spine': [('x', 12)], 'Head': [('x', -12)], 'Arm.L': [('x', -25)], 'Wing.L': [('y', -15)]}
    swipe_up = dict(ready, **{'Arm.R': [('x', -110), ('z', -20)], 'Fore.R': [('x', -30)], 'Chest': [('z', 18)]})
    swipe_down = dict(ready, **{'Arm.R': [('x', 30), ('z', 25)], 'Fore.R': [('x', 10)], 'Chest': [('z', -22), ('x', 18)],
                                 'Jaw': [('x', 25)]})
    author_clip(arm, 'Attack', [(1, ready), (8, swipe_up), (13, swipe_down), (24, ready)], loop=False)
    bite = dict(ready, **{'Neck': [('x', 25)], 'Head': [('x', 15)], 'Jaw': [('x', 35)], 'Spine': [('x', 24)]})
    author_clip(arm, 'Attack2', [(1, ready), (7, dict(ready, Head=[('x', -30)], Jaw=[('x', 30)])), (11, bite), (22, ready)],
                loop=False)
    author_clip(arm, 'Hit', [(1, ready), (5, {'Spine': [('x', -14)], 'Head': [('x', -30)], 'Wing.L': [('y', -35)]}),
                             (14, ready)], loop=False)
    dead = {'Root': [('x', 85), ('loc', (0, 0, -0.45))], 'Head': [('x', 20)], 'Wing.L': [('y', 40), ('z', 20)],
            'Thigh.L': [('x', 60)], 'Arm.L': [('x', -40)]}
    author_clip(arm, 'Death', [(1, ready), (8, {'Spine': [('x', -25)], 'Head': [('x', -35)], 'Wing.L': [('y', -40)]}),
                               (22, dead), (30, dead)], loop=False)
    rear = {'Spine': [('x', -22)], 'Chest': [('x', -12)], 'Head': [('x', -30)], 'Jaw': [('x', 45)],
            'Wing.L': [('y', -60), ('z', -20)], 'WingTip.L': [('y', -30)], 'Arm.L': [('x', -30), ('y', -25)],
            'Root': [('loc', (0, 0, 0.1))]}
    rear_b = dict(rear, Head=[('x', -34), ('z', 6)], Chest=[('x', -14)])
    author_clip(arm, 'Cast', loop(16, [rear, rear_b]))
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast']


# =============================================================== crow
CROW_BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.2)),
    ('Body', 'Root', (0, 0.1, 0.35), (0, -0.15, 0.4)),
    ('Head', 'Body', (0, -0.15, 0.42), (0, -0.3, 0.5)),
    ('Wing.L', 'Body', (0.1, 0.0, 0.42), (0.42, 0.05, 0.45)),
    ('WingTip.L', 'Wing.L', (0.42, 0.05, 0.45), (0.8, 0.12, 0.42)),
    ('Tail', 'Body', (0, 0.15, 0.36), (0, 0.4, 0.3)),
    ('Leg.L', 'Body', (0.06, 0.02, 0.3), (0.06, 0.04, 0.12)),
])


def crow_body():
    p = Body('CarrionCrow', weather=0.3, lichen=0.0)
    p.on('Body')
    p.rock((0, 0.02, 0.37), (0.24, 0.42, 0.22), FEATHER, jitter=0.12, subdivisions=1)
    p.rock((0, -0.12, 0.4), (0.2, 0.2, 0.2), FEATHER_HI, jitter=0.1, subdivisions=1)
    p.on('Head')
    p.rock((0, -0.25, 0.49), (0.16, 0.18, 0.16), FEATHER, jitter=0.08, subdivisions=1)
    p.prism((0, -0.32, 0.48), 4, 0.045, 0.0001, 0.18, BEAK, axis=(0, -1, -0.15))
    for sx in (-1, 1):
        p.box((sx * 0.06, -0.3, 0.52), (0.03, 0.03, 0.03), (0.85, 0.2, 0.15), mat=GLOW)
    for i in range(3):
        p.spike((0, -0.18 + i * 0.05, 0.56), 0.02, 0.07, FEATHER, sides=3, lean=(0, 0.05))

    def wing(s, t):
        p.on('Wing' + t)
        membrane(p, [(s * 0.08, -0.08, 0.43), (s * 0.44, 0.0, 0.46), (s * 0.44, 0.16, 0.44), (s * 0.08, 0.14, 0.4)],
                 FEATHER)
        p.on('WingTip' + t)
        for k in range(5):
            y0 = -0.02 + k * 0.05
            membrane(p, [(s * 0.42, y0, 0.45), (s * (0.82 - k * 0.04), y0 + 0.04 + k * 0.02, 0.42 - k * 0.01),
                         (s * (0.78 - k * 0.04), y0 + 0.08 + k * 0.02, 0.41), (s * 0.42, y0 + 0.05, 0.44)],
                     FEATHER_HI if k % 2 else FEATHER)

    def leg(s, t):
        p.on('Leg' + t)
        p.prism((s * 0.06, 0.02, 0.12), 4, 0.015, 0.015, 0.2, BEAK)
        for k in (-1, 0, 1):
            p.spike((s * 0.06 + k * 0.02, 0.0, 0.12), 0.012, 0.07, BEAK, sides=3, lean=(k * 0.04, -0.06))

    sides(wing)
    sides(leg)
    p.on('Tail')
    for k in (-1, 0, 1):
        membrane(p, [(k * 0.05, 0.15, 0.37), (k * 0.1 - 0.03, 0.45, 0.3), (k * 0.1 + 0.03, 0.45, 0.3)], FEATHER)
    return p


def crow_clips(arm):
    def flap(a, pitch=8, bob=0.0):
        return {'Root': [('x', pitch), ('loc', (0, 0, bob))], 'Wing.L': [('y', -60 * a)],
                'WingTip.L': [('y', -30 * a)], 'Leg.L': [('x', 40)], 'Tail': [('x', -10 * a)]}
    author_clip(arm, 'Idle', loop(10, [flap(1, 0, 0.05), flap(-0.9, 0, -0.03)]))
    author_clip(arm, 'Walk', loop(8, [flap(1, 12, 0.04), flap(-0.9, 12, -0.03)]))
    author_clip(arm, 'Run', loop(6, [flap(1, 22, 0.03), flap(-1, 22, -0.03)]))
    author_clip(arm, 'Attack', [(1, flap(0.5, 5)), (5, {'Root': [('x', -25)], 'Head': [('x', -25)], 'Wing.L': [('y', -70)]}),
                                (9, {'Root': [('x', 45), ('loc', (0, -0.15, -0.1))], 'Head': [('x', 30)],
                                     'Wing.L': [('y', 40)], 'Leg.L': [('x', -50)]}),
                                (16, flap(0.5, 5))], loop=False)
    author_clip(arm, 'Hit', [(1, flap(0, 0)), (4, {'Root': [('x', -30), ('z', 20)], 'Wing.L': [('y', -80)]}),
                             (10, flap(0, 0))], loop=False)
    # The game hovers the crow 1.4 yd (about 0.95 of its own units): the body
    # falls that far, onto the floor, and lies on its back.
    dead = {'Root': [('y', 150), ('loc', (0, 0, -1.25))], 'Wing.L': [('y', 30), ('z', 30)], 'Leg.L': [('x', -60)]}
    author_clip(arm, 'Death', [(1, flap(0.3, 0)), (6, {'Root': [('y', 60), ('x', 30), ('loc', (0, 0, -0.4))],
                                                        'Wing.L': [('y', -80)]}),
                               (16, dead), (24, dead)], loop=False)
    author_clip(arm, 'Cast', loop(8, [flap(1, -10, 0.05), flap(-1, -10, -0.02)]))
    return ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Cast']


# =============================================================== drake
def _chain(prefix, parent, pts):
    out = []
    for i in range(len(pts) - 1):
        name = f'{prefix}{i + 1}'
        out.append((name, parent, pts[i], pts[i + 1]))
        parent = name
    return out


DRAKE_BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Pelvis', 'Root', (0, 1.4, 2.4), (0, 0.8, 2.6)),
    ('Spine', 'Pelvis', (0, 0.8, 2.6), (0, -0.4, 2.9)),
    ('Chest', 'Spine', (0, -0.4, 2.9), (0, -1.4, 3.0)),
    *_chain('Neck', 'Chest', [(0, -1.4, 3.0), (0, -2.0, 3.6), (0, -2.5, 4.3), (0, -2.9, 4.8)]),
    ('Head', 'Neck3', (0, -2.9, 4.8), (0, -3.9, 4.75)),
    ('Jaw', 'Head', (0, -3.0, 4.55), (0, -3.95, 4.4)),
    *_chain('Tail', 'Pelvis', [(0, 1.4, 2.4), (0, 2.4, 2.2), (0, 3.3, 1.8), (0, 4.1, 1.3), (0, 4.8, 0.9), (0, 5.4, 0.7)]),
    ('ArmUpper.L', 'Chest', (0.55, -1.1, 2.6), (0.75, -1.5, 1.5)),
    ('ArmLower.L', 'ArmUpper.L', (0.75, -1.5, 1.5), (0.7, -1.3, 0.35)),
    ('Hand.L', 'ArmLower.L', (0.7, -1.3, 0.35), (0.7, -1.8, 0.05)),
    ('LegUpper.L', 'Pelvis', (0.55, 1.2, 2.2), (0.8, 0.6, 1.3)),
    ('LegLower.L', 'LegUpper.L', (0.8, 0.6, 1.3), (0.75, 1.1, 0.4)),
    ('Foot.L', 'LegLower.L', (0.75, 1.1, 0.4), (0.75, 0.5, 0.05)),
    ('Wing.L', 'Chest', (0.45, -0.7, 3.2), (2.2, -0.2, 4.2)),
    ('WingFore.L', 'Wing.L', (2.2, -0.2, 4.2), (4.2, 0.6, 3.6)),
    ('WingTip.L', 'WingFore.L', (4.2, 0.6, 3.6), (5.6, 1.4, 2.6)),
])


def drake_body():
    p = Body('OssuaryDrake', weather=0.8, lichen=0.0)

    def vertebra(pos, r, color=BONE_I):
        p.rock(pos, (r * 2.0, r * 1.5, r * 1.6), p.vary(color, 0.05), jitter=0.08, subdivisions=1)
        p.spike((pos[0], pos[1], pos[2] + r * 0.6), r * 0.35, r * 1.3, BONE_D, sides=4, lean=(0, 0.25 * r))

    def bone_between(a, b, r, color=BONE_I):
        p.bone(a, b, r, color=color)

    p.on('Pelvis')
    p.rock((0, 1.1, 2.45), (1.3, 0.9, 0.7), BONE_I, jitter=0.08, subdivisions=1)
    for sx in (-1, 1):
        p.box((sx * 0.55, 1.1, 2.35), (0.3, 0.8, 0.5), BONE_D, bevel=0.06, roll=sx * 0.4)
    p.on('Spine')
    for i in range(5):
        t = i / 4
        vertebra((0, 0.8 - 1.2 * t, 2.62 + 0.28 * t), 0.24)
    p.on('Chest')
    vertebra((0, -0.9, 2.95), 0.28)
    # The ribcage: arcs of bone round a frost-lit heart.
    for i in range(6):
        y = 0.4 - i * 0.32
        r = 0.95 - abs(i - 2.5) * 0.12
        for sx in (-1, 1):
            pts = [(sx * 0.1, y, 2.85), (sx * r, y - 0.05, 2.5), (sx * r * 0.9, y - 0.1, 1.85), (sx * 0.25, y - 0.12, 1.6)]
            p.sweep(pts, 0.07, 0.05, BONE_I if i % 2 else BONE_D, sides=5)
    p.box((0, -0.4, 1.6), (0.35, 2.2, 0.16), BONE_D, bevel=0.04)
    p.rock((0, -0.35, 2.25), (0.7, 0.7, 0.7), FROST, mat=GLOW, jitter=0.2, subdivisions=1)
    for k, bone_name in enumerate(('Neck1', 'Neck2', 'Neck3')):
        p.on(bone_name)
        a = [(0, -1.4, 3.0), (0, -2.0, 3.6), (0, -2.5, 4.3), (0, -2.9, 4.8)][k]
        b = [(0, -1.4, 3.0), (0, -2.0, 3.6), (0, -2.5, 4.3), (0, -2.9, 4.8)][k + 1]
        for j in range(2):
            t = (j + 0.5) / 2
            vertebra((a[0], a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t), 0.2 - k * 0.02)
    p.on('Head')
    p.box((0, -3.3, 4.85), (0.7, 1.0, 0.55), BONE_I, bevel=0.1, taper=0.85)
    p.box((0, -3.85, 4.72), (0.46, 0.55, 0.32), BONE_I, bevel=0.07, taper=0.8)
    p.box((0, -3.2, 5.1), (0.8, 0.5, 0.18), BONE_D, bevel=0.05, pitch=-0.15)
    for sx in (-1, 1):
        p.box((sx * 0.24, -3.55, 4.95), (0.2, 0.18, 0.16), (0.04, 0.05, 0.07))
        p.box((sx * 0.24, -3.6, 4.95), (0.14, 0.08, 0.1), FROST, mat=GLOW)
        p.sweep(p.bezier((sx * 0.3, -3.0, 5.1), (sx * 0.7, -2.6, 5.6), (sx * 0.55, -1.9, 5.9), 7),
                0.12, 0.02, BONE_D, sides=6)
        p.sweep(p.bezier((sx * 0.35, -2.95, 4.8), (sx * 0.75, -2.5, 4.9), (sx * 0.8, -2.1, 5.1), 5),
                0.07, 0.015, BONE_D, sides=5)
    for k in range(5):
        p.spike((-0.18 + k * 0.09, -4.05, 4.58), 0.035, 0.14, BONE_I, sides=3, lean=(0, 0))
    p.on('Jaw')
    p.box((0, -3.5, 4.45), (0.55, 0.95, 0.16), BONE_I, bevel=0.05, taper=0.85)
    for k in range(5):
        p.spike((-0.16 + k * 0.08, -3.9, 4.52), 0.03, 0.13, BONE_I, sides=3, lean=(0, 0))
    tail = [(0, 1.4, 2.4), (0, 2.4, 2.2), (0, 3.3, 1.8), (0, 4.1, 1.3), (0, 4.8, 0.9), (0, 5.4, 0.7)]
    for k in range(5):
        p.on(f'Tail{k + 1}')
        a, b = tail[k], tail[k + 1]
        for j in range(2):
            t = (j + 0.5) / 2
            vertebra((0, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t), 0.2 - k * 0.03)
    p.on('Tail5')
    for sx in (-1, 1):
        p.spike((sx * 0.12, 5.3, 0.72), 0.08, 0.5, BONE_D, sides=4, lean=(sx * 0.4, 0.2))

    def limb(s, t):
        p.on('ArmUpper' + t)
        bone_between((s * 0.55, -1.1, 2.6), (s * 0.75, -1.5, 1.5), 0.13)
        p.on('ArmLower' + t)
        bone_between((s * 0.75, -1.5, 1.5), (s * 0.7, -1.3, 0.35), 0.1)
        p.on('Hand' + t)
        for k in (-1, 0, 1):
            p.sweep(p.bezier((s * 0.7, -1.3, 0.35), (s * (0.7 + k * 0.12), -1.6, 0.2), (s * (0.7 + k * 0.18), -1.9, 0.02), 5),
                    0.05, 0.015, BONE_D, sides=4)
        p.on('LegUpper' + t)
        bone_between((s * 0.55, 1.2, 2.2), (s * 0.8, 0.6, 1.3), 0.16)
        p.on('LegLower' + t)
        bone_between((s * 0.8, 0.6, 1.3), (s * 0.75, 1.1, 0.4), 0.12)
        p.on('Foot' + t)
        for k in (-1, 0, 1):
            p.sweep(p.bezier((s * 0.75, 1.1, 0.4), (s * (0.75 + k * 0.14), 0.8, 0.2), (s * (0.75 + k * 0.2), 0.4, 0.02), 5),
                    0.06, 0.015, BONE_D, sides=4)

    def wing(s, t):
        p.on('Wing' + t)
        bone_between((s * 0.45, -0.7, 3.2), (s * 2.2, -0.2, 4.2), 0.13)
        p.on('WingFore' + t)
        bone_between((s * 2.2, -0.2, 4.2), (s * 4.2, 0.6, 3.6), 0.1)
        p.on('WingTip' + t)
        bone_between((s * 4.2, 0.6, 3.6), (s * 5.6, 1.4, 2.6), 0.07)
        # Finger bones fanning back from the wrist, torn membrane between them.
        fingers = [((s * 4.2, 0.6, 3.6), (s * 4.6, 2.4, 1.6)), ((s * 4.2, 0.6, 3.6), (s * 3.4, 2.6, 1.5))]
        for a, b in fingers:
            bone_between(a, b, 0.05, BONE_D)
        membrane(p, [(s * 4.2, 0.6, 3.5), (s * 5.5, 1.4, 2.55), (s * 4.6, 2.35, 1.65)], MEMBRANE)
        membrane(p, [(s * 4.15, 0.65, 3.45), (s * 4.55, 2.3, 1.7), (s * 3.9, 2.2, 1.9), (s * 3.45, 2.5, 1.6)], MEMBRANE)
        p.on('WingFore' + t)
        membrane(p, [(s * 2.2, -0.15, 4.1), (s * 4.15, 0.62, 3.5), (s * 3.4, 2.5, 1.62), (s * 2.6, 1.5, 2.4)], MEMBRANE)
        p.on('Wing' + t)
        membrane(p, [(s * 0.5, -0.6, 3.1), (s * 2.2, -0.15, 4.1), (s * 2.55, 1.45, 2.45), (s * 0.6, 0.9, 2.5)], MEMBRANE)

    sides(limb)
    sides(wing)
    return p


def drake_clips(arm):
    stand = {'Neck1': [('x', -6)], 'Head': [('x', 6)], 'Wing.L': [('y', 30), ('z', 35)],
             'WingFore.L': [('z', 60), ('y', 20)], 'WingTip.L': [('z', 40)], 'Tail2': [('z', 6)]}
    stand_b = dict(stand, Chest=[('x', -2)], Neck1=[('x', -9)], Head=[('x', 9)], Tail2=[('z', -6)], Tail3=[('z', -6)])
    author_clip(arm, 'Idle', loop(64, [stand, stand_b]))

    def flight(a, pitch=10):
        return {'Root': [('x', pitch), ('loc', (0, 0, 0.35 * a))], 'Neck1': [('x', -12)], 'Head': [('x', 8)],
                'Wing.L': [('y', -45 * a)], 'WingFore.L': [('y', -25 * a)], 'WingTip.L': [('y', -15 * a)],
                'ArmUpper.L': [('x', 55)], 'ArmLower.L': [('x', -60)], 'LegUpper.L': [('x', 60)],
                'LegLower.L': [('x', -40)], 'Tail1': [('x', -8 * a)], 'Tail3': [('x', 6 * a)]}
    author_clip(arm, 'Walk', loop(30, [flight(1), flight(0.2), flight(-1), flight(0.2)]))
    author_clip(arm, 'Run', loop(20, [flight(1, 16), flight(0.2, 16), flight(-1, 16), flight(0.2, 16)]))
    rear = dict(stand, Neck1=[('x', -25)], Neck2=[('x', -15)], Head=[('x', -10)], Jaw=[('x', 30)])
    strike = dict(stand, Neck1=[('x', 25)], Neck2=[('x', 15)], Head=[('x', 12)], Jaw=[('x', 5)], Chest=[('x', 8)])
    author_clip(arm, 'Attack', [(1, stand), (9, rear), (14, strike), (28, stand)], loop=False)
    claw = dict(stand, Chest=[('z', 15)], **{'ArmUpper.L': [('x', -80), ('z', -20)], 'ArmLower.L': [('x', -30)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, claw), (13, dict(stand, **{'ArmUpper.L': [('x', 25)]})), (26, stand)],
                loop=False)
    author_clip(arm, 'Hit', [(1, stand), (5, dict(stand, Neck1=[('x', -25)], Head=[('x', -20)], Chest=[('x', -8)])),
                             (16, stand)], loop=False)
    dead = {'Root': [('loc', (0, 0, -1.6)), ('y', 35)], 'Neck1': [('x', 40), ('z', 30)], 'Head': [('x', 10)],
            'Wing.L': [('y', 60), ('z', 20)], 'Tail1': [('z', 25)], 'ArmUpper.L': [('x', -60)], 'LegUpper.L': [('x', 60)]}
    author_clip(arm, 'Death', [(1, stand), (10, dict(stand, Neck1=[('x', -35)], Head=[('x', -25)], Jaw=[('x', 35)],
                                                        **{'Wing.L': [('y', -50)]})),
                               (32, dead), (40, dead)], loop=False)
    roar = dict(stand, Neck1=[('x', -30)], Neck2=[('x', -20)], Head=[('x', -15)], Jaw=[('x', 40)],
                **{'Wing.L': [('y', -55), ('z', -15)], 'WingFore.L': [('y', -25)]})
    author_clip(arm, 'Cast', loop(20, [roar, dict(roar, Head=[('x', -18), ('z', 5)])]))
    breath = dict(stand, Neck1=[('x', 12)], Neck2=[('x', 10)], Head=[('x', 10)], Jaw=[('x', 38)], Chest=[('x', 6)],
                  **{'Wing.L': [('y', -20), ('z', 10)]})
    breath_b = dict(breath, Head=[('x', 12), ('z', 6)], Jaw=[('x', 42)])
    author_clip(arm, 'Breath', loop(16, [breath, breath_b]))
    coil = dict(stand, Root=[('z', -35)], Tail1=[('z', -25)], Tail2=[('z', -25)], Tail3=[('z', -20)])
    lash = dict(stand, Root=[('z', 40)], Tail1=[('z', 40)], Tail2=[('z', 40)], Tail3=[('z', 35)], Tail4=[('z', 25)])
    author_clip(arm, 'TailLash', [(1, stand), (10, coil), (17, lash), (30, stand)], loop=False)
    spread = dict(stand, **{'Wing.L': [('y', -70), ('z', -25)], 'WingFore.L': [('y', -30)], 'WingTip.L': [('y', -20)]},
                  Chest=[('x', -12)], Neck1=[('x', -15)])
    beat = dict(stand, **{'Wing.L': [('y', 35), ('z', 40)], 'WingFore.L': [('y', 25), ('z', 20)]},
                Chest=[('x', 10)], Root=[('loc', (0, 0, 0.3))])
    author_clip(arm, 'WingGust', [(1, stand), (12, spread), (18, beat), (34, stand)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Breath', 'TailLash', 'WingGust']


CREATURES = {
    'gargoyle': (GARGOYLE_BONES, gargoyle_body, gargoyle_clips, 1.3, 7.0),
    'crow': (CROW_BONES, crow_body, crow_clips, 0.35, 2.4),
    'drake': (DRAKE_BONES, drake_body, drake_clips, 2.6, 16.0),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    which, out = argv[0], argv[1]
    bones, body_fn, clips_fn, focus, dist = CREATURES[which]
    mats = new_scene()
    body = body_fn()
    obj, names = finish_body(body, mats)
    arm = build_rig(body.name, bones, obj, names)
    clips = clips_fn(arm)
    export(out, arm)
    if '--preview' in argv:
        preview(arm, clips, argv[argv.index('--preview') + 1], focus, dist)
    if '--blend' in argv:
        import bpy
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
