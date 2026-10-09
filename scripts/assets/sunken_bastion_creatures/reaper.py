"""Vael the Fogbinder as Death itself: the Sunken Bastion's final boss, a hooded,
skeletal reaper with a great scythe (src/sim/encounters/sunken_bastion/vael.ts).

  blender -b --factory-startup --python reaper.py -- <out.glb> [--sheet dir] [--blend out.blend] [--fast]

A gaunt, towering figure that never touches the flags: a skull burning with pale
soul fire deep in a peaked hood, a shroud of tattered shadow cloth that hangs to
a ragged hem a hand above the floor and trails a torn cape behind, bare ribs
where the shroud has rotted open, long skeletal hands gripping a great scythe
(a black-iron blade longer than a man, its edge lit with the same pale fire),
a caged soul lantern swinging at the hip, and five soul motes circling him.
Built on the organic kit (hollow_crypt_creatures/organic_kit.py): smooth parts
bound one bone each, the shroud and cape as membranes weighted across their
hanging spars (they bend and stream, never tear), a Cycles bake of a shadow
cloth surface with its ambient occlusion, emissive soul fire kept on the glow
material.

Scale (yards; a player stands about 2.6): 6.3 to the hood's peak at rest, the
scythe's blade over 7 up; the game draws him at template scale 1.35, so some
8.5 yards of Death looms over the crown.

Clips (24 fps):
  Idle         hovering: a slow bob, the shroud breathing, the motes circling.
  Walk, Run    the glide: leaning into it, the shroud and cape streaming back.
  Attack       a flat reaping sweep across his front, both hands on the snath:
               a coil, the wind-up held behind his right shoulder, the cut
               (contact at frame 13), the follow-through and the recovery.
  Attack2      an overhead chop, two-handed: up and back over the shoulder,
               the tip brought down onto the victim (contact at frame 15).
  Cast         the soul reap (Mist Surge): scythe raised high, the free hand
               clawing the souls out of the living.
  Hymn         the Drowning Hymn (the Fog Veil's channel): scythe planted,
               arms wide, head bowed.
  Vanish       the Shadow Crossing's bar: he folds into his shroud and sinks
               through the floor, and stays under while the pool opens.
  Emerge       he rises out of the shadow pool with the scythe drawn back
               over his right shoulder in both hands.
  ScytheSweep  the reaping from behind: the diagonal reap off that wind-up,
               brought down across his front to the floor (contact at frame 4).
  Hit, Death   a recoil; the shroud collapses empty, the scythe falls with him.

The scythe is held, never spun (the Morthen fix, hollow_crypt_creatures/
build_morthen.py): it is modelled IN the right fist (both hands are bony fists
closed round a bar) and the Scythe bone keeps its rest turn against Hand.R in
every key (tests/vael_reaper.test.ts pins it). Each pose places the grip, the
shaft and the blade's facing in the body's frame; the solver carries them with
the shoulder, the elbow, the spine and the floating body, turns the blade a
little round the shaft and nudges the grip so the wrist stays straight, and
closes the off hand round the snath below the right fist for the heavy blows.
The left fist's fingers ride their own Claw bone, so the free hand opens into a
hooked claw for the reap and the hymn. The build prints, per clip, the worst
wrist bend, how far either fist strays from the shaft and the scythe's turn
against the fist (`GRIP ...` lines; `--diag` prints every key).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'hollow_crypt_creatures')))
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from organic_kit import (  # noqa: E402
    GLOW, Membrane, Part, Rig, bake_surface, bind, build_armature, clip, cycle, expand_bones, export, join,
    make_materials, new_scene, render_sheet, setup_preview, triangles, two_bone,
)

# ------------------------------------------------------------------ palette
SHROUD = (0.075, 0.08, 0.095)
SHROUD_HI = (0.16, 0.17, 0.2)
SHROUD_EDGE = (0.22, 0.24, 0.27)
BONE = (0.8, 0.76, 0.66)
BONE_OLD = (0.62, 0.57, 0.48)
BONE_DARK = (0.3, 0.27, 0.23)
SOCKET = (0.02, 0.02, 0.025)
SOUL = (0.55, 1.0, 0.82)
SOUL_HOT = (0.9, 1.0, 0.96)
SOUL_DEEP = (0.12, 0.5, 0.36)
BLADE = (0.2, 0.21, 0.24)
BLADE_HI = (0.42, 0.44, 0.48)
WOOD = (0.2, 0.14, 0.09)
WOOD_D = (0.11, 0.08, 0.05)
IRON = (0.17, 0.17, 0.19)
ROPE = (0.3, 0.26, 0.2)
LEATHER = (0.16, 0.1, 0.08)

HOVER = 0.35
SKIRT = 12       # shroud spars round the waist
CLOAK = 11       # cloak spars round the shoulders (the front stays open)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def _n(v):
    return Vector(v).normalized()


# ---- the two hands, each a bony fist closed round a bar ------------------------------
# A fist is described by its wrist, `h` (wrist to knuckles), `a` (the bar axis, the
# thumb's side) and `n` (the palm normal, toward the bar). The bar runs through the
# fist at `grip` = wrist + h * FIST_REACH + n * FIST_DEPTH. The scythe is modelled IN
# the right fist, so the Scythe bone never turns against Hand.R: every swing is carried
# by the shoulder, the elbow, the spine and the floating body. The left fist closes
# round the snath for the heavy blows and opens into a claw (its Claw bone) when free.
FIST_REACH = 0.23
FIST_DEPTH = 0.105
GRIP_BAR = 0.1                              # the leather-wrapped grip under each fist
ELBOW_L = Vector((1.32, -0.12, 3.7))
WRIST_L = Vector((1.42, -0.5, 2.6))
KNUCK_L = Vector((1.44, -0.62, 2.2))
ELBOW_R = Vector((-1.32, -0.12, 3.7))
# The right forearm is modelled reaching forward, the fist upright round the snath.
WRIST_R = ELBOW_R + _n((-0.06, -1.0, 0.12)) * (WRIST_L - ELBOW_L).length
H_R = Vector((0.0, -1.0, 0.0))
A_R = Vector((0.0, 0.0, 1.0))               # the thumb up the snath
N_R = A_R.cross(H_R).normalized()           # the palm toward his middle (+x)
KNUCK_R = WRIST_R + H_R * (KNUCK_L - WRIST_L).length
H_L = _n(KNUCK_L - WRIST_L)
A_L = _n(Vector((0, -1, 0)) - H_L * H_L.dot(Vector((0, -1, 0))))   # the thumb forward
N_L = -(A_L.cross(H_L)).normalized()        # mirror-handed: the palm toward his middle
GRIP = WRIST_R + H_R * FIST_REACH + N_R * FIST_DEPTH    # the snath in the right fist (rest)
GRIP_L = WRIST_L + H_L * FIST_REACH + N_L * FIST_DEPTH  # the left fist's empty bar at rest
GRIP2 = 1.15                                # the off hand's grip, this far down the snath
FINGER_R = 0.031
BAR_R = GRIP_BAR + FINGER_R + 0.005         # the fingers' radius round the bar
CLAW_PIVOT = GRIP_L - N_L * BAR_R * 0.99 - H_L * BAR_R * 0.14   # the left knuckle line


# ------------------------------------------------------------------- bones
def _skirt_bones():
    out = []
    for k in range(SKIRT):
        a = math.tau * k / SKIRT
        ca, sa = math.sin(a), -math.cos(a)  # k = 0 faces -Y (front)
        top = (ca * 0.68, sa * 0.56, 3.3)
        mid = (ca * 1.12, sa * 0.98, 1.9)
        hem = (ca * 1.62, sa * 1.42, HOVER + 0.02)
        out.append((f'Skirt{k}a', 'Hips', top, mid))
        out.append((f'Skirt{k}b', f'Skirt{k}a', mid, hem))
    return out


def cloak_spar(k):
    """The k-th cloak spar's stations: neck, shoulder, mid, low, hem. theta 0
    hangs straight down the back, the two ends frame the open front."""
    th = math.radians(-152 + 304 * k / (CLOAK - 1))
    sx, cy = math.sin(th), math.cos(th)
    back = max(0.0, cy)
    return th, [
        (sx * 0.44, cy * 0.36 + 0.02, 5.22),
        (sx * 1.16, cy * 0.66 + 0.06, 4.78),
        (sx * 1.3, cy * 0.92 + 0.12 + back * 0.15, 3.25),
        (sx * 1.46, cy * 1.18 + 0.2 + back * 0.55, 1.45),
        (sx * 1.58, cy * 1.32 + back * 1.35, 0.06),
    ]


def _cloak_bones():
    out = []
    for k in range(CLOAK):
        _, st = cloak_spar(k)
        out.append((f'Cloak{k}a', 'Chest', st[1], st[2]))
        out.append((f'Cloak{k}b', f'Cloak{k}a', st[2], st[3]))
        out.append((f'Cloak{k}c', f'Cloak{k}b', st[3], st[4]))
    return out


def _mirror_right(bones):
    """expand_bones mirrors every `.L` bone onto `.R`; the right forearm and fist
    are the exception (the fist is modelled round the upright snath)."""
    out = []
    for name, parent, head, tail in bones:
        if name == 'Fore.R':
            head, tail = tuple(ELBOW_R), tuple(WRIST_R)
        elif name == 'Hand.R':
            head, tail = tuple(WRIST_R), tuple(KNUCK_R)
        out.append((name, parent, head, tail))
    return out


BONES = _mirror_right(expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Hips', 'Root', (0, 0, 3.1), (0, 0, 3.6)),
    ('Spine', 'Hips', (0, 0, 3.6), (0, -0.05, 4.3)),
    ('Chest', 'Spine', (0, -0.05, 4.3), (0, -0.1, 5.0)),
    ('Neck', 'Chest', (0, -0.1, 5.0), (0, -0.2, 5.32)),
    ('Head', 'Neck', (0, -0.2, 5.32), (0, -0.42, 5.78)),
    ('Jaw', 'Head', (0, -0.32, 5.38), (0, -0.56, 5.22)),
    ('Arm.L', 'Chest', (0.98, -0.05, 4.9), tuple(ELBOW_L)),
    ('Fore.L', 'Arm.L', tuple(ELBOW_L), tuple(WRIST_L)),
    ('Hand.L', 'Fore.L', tuple(WRIST_L), tuple(KNUCK_L)),
    ('Claw', 'Hand.L', tuple(CLAW_PIVOT), tuple(CLAW_PIVOT + H_L * 0.2)),
    ('Scythe', 'Hand.R', tuple(GRIP), tuple(GRIP + Vector((0, 0, 1)))),
    ('Lantern', 'Hips', (0.62, -0.2, 3.1), (0.7, -0.25, 2.1)),
    ('Motes', 'Root', (0, 0, 4.2), (0, 0, 4.8)),
] + _skirt_bones() + _cloak_bones()))
REST = {n: (Vector(h), Vector(t)) for n, _, h, t in BONES}

# The scythe's reach along its own bone from the grip: pommel below, blade on top.
SHAFT_BELOW = 1.5
SHAFT_ABOVE = 5.4


# ------------------------------------------------------------------- parts
def fist(p, wrist, h, a, n, digits=None):
    """A long skeletal hand CLOSED round a bar: the carpal knot, four metacarpals
    out to the knuckles, four fingers wrapped round the bar (axis `a`, through
    wrist + h * FIST_REACH + n * FIST_DEPTH), each ending in a hooked claw, and
    the thumb locked over them. `h` wrist to knuckles, `a` the bar axis (thumb
    side), `n` the palm normal. The fingers and thumb go on `digits` when given
    (the left hand's Claw part, so they can open), else on the hand itself."""
    w, h, a, n = Vector(wrist), _n(h), _n(a), _n(n)
    c = w + h * FIST_REACH + n * FIST_DEPTH
    fr = FINGER_R
    rad = BAR_R
    dg = digits if digits is not None else p

    def on_bar(phi, off, r=rad):
        # phi 0 on the back of the bar (the palm side), 90 over its front, 180 behind it
        return c + (-n * math.cos(phi) + h * math.sin(phi)) * r + a * off

    p.blob(w, (0.17, 0.16, 0.15), BONE_OLD, segments=10, rings=7)                    # the wrist knot
    p.blob(w + h * 0.085 - n * 0.012, (0.2, 0.12, 0.19), BONE, segments=10, rings=6)  # the carpals
    for k, off in enumerate((0.095, 0.033, -0.029, -0.088)):
        knuckle = on_bar(math.radians(-8), off)
        base = w + h * 0.05 + a * off * 0.45 - n * 0.024
        p.tube([base, base.lerp(knuckle, 0.5) - n * 0.015, knuckle], [0.029, 0.024, 0.031], BONE, sides=7)
        p.blob(knuckle, (0.076, 0.076, 0.068), BONE_OLD, segments=8, rings=5)
        phi = math.radians(-8)
        pos = knuckle
        for i, ln in enumerate((0.13, 0.11, 0.088)):
            ln *= 1.0 - 0.08 * abs(k - 1.2)
            phi += 2 * math.asin(min(0.99, ln / (2 * rad)))
            end = on_bar(phi, off)
            r0 = fr * (1 - 0.14 * i)
            mid = pos.lerp(end, 0.5)
            dg.tube([pos, mid + (mid - c - a * off).normalized() * 0.007, end], [r0, r0 * 0.82, r0 * 0.9],
                    lerp(BONE, BONE_OLD, i * 0.3), sides=7)
            dg.blob(end, (r0 * 2.1, r0 * 2.1, r0 * 2.1), BONE_OLD, segments=7, rings=5)
            pos = end
        # the claw of the fingertip, a long hooked point against the bar
        tip = on_bar(phi + 0.5, off, rad - 0.008)
        dg.tube([pos, pos.lerp(tip, 0.5), tip], [fr * 0.72, fr * 0.45, 0.004], BONE_DARK, sides=5)
    # the thumb: from the heel of the hand over the bar, locked across the first finger
    tb = w + h * 0.06 + a * 0.1 - n * 0.024
    t_off = 0.16
    j0 = on_bar(math.radians(-58), t_off, rad + 0.012)
    dg.tube([tb, tb.lerp(j0, 0.5), j0], [0.034, 0.031, 0.031], BONE, sides=7)
    dg.blob(j0, (0.072, 0.072, 0.068), BONE_OLD, segments=8, rings=5)
    phi = math.radians(-58)
    pos = j0
    for i, ln in enumerate((0.11, 0.085)):
        phi -= 2 * math.asin(min(0.99, ln / (2 * (rad + 0.012))))
        end = on_bar(phi, t_off - 0.043 * (i + 1), rad + 0.012)
        dg.tube([pos, pos.lerp(end, 0.5), end], [0.031 - 0.005 * i, 0.027, 0.028 - 0.005 * i], BONE, sides=7)
        dg.blob(end, (0.06, 0.06, 0.06), BONE_OLD, segments=7, rings=5)
        pos = end
    return c


def build_parts():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    # --- the torso under the shroud, and the rotted-open front with its ribs ------
    torso = part('Torso', 'Spine', subdiv=1)
    torso.loft([
        ((0, 0.02, 3.35), 0.52, 0.34, 2.4, (0, 0, 1)),
        ((0, 0.04, 3.9), 0.5, 0.33, 2.4, (0, 0, 1)),
        ((0, 0.06, 4.35), 0.66, 0.36, 2.6, (0, 0, 1)),
    ], SHROUD, sides=18)
    chest = part('Chest', 'Chest', subdiv=1)
    chest.loft([
        ((0, 0.06, 4.35), 0.7, 0.38, 2.6, (0, 0, 1)),
        ((0, 0.08, 4.75), 0.95, 0.44, 2.8, (0, 0, 1)),
        ((0, 0.06, 5.02), 1.06, 0.42, 3.0, (0, 0, 1)),
        ((0, 0.0, 5.16), 0.44, 0.3, 2.2, (0, 0, 1)),
    ], SHROUD, sides=18)
    ribs = part('Ribs', 'Chest', smooth=True)
    ribs.tube([Vector((0, -0.34, 4.9)), Vector((0, -0.4, 4.55)), Vector((0, -0.36, 4.2))], [0.035, 0.04, 0.03],
              BONE, sides=6)                                                              # the sternum
    for i in range(5):
        z = 4.86 - i * 0.14
        for s in (-1, 1):
            pts = [Vector((s * (0.03 + 0.34 * math.sin(t * math.pi * 0.62)), -0.37 + 0.36 * (1 - math.cos(t * math.pi * 0.62)),
                           z - 0.1 * t)) for t in (j / 6 for j in range(7))]
            ribs.tube(pts, [0.03 - 0.004 * i] * 7, lerp(BONE, BONE_OLD, i / 5), sides=6)
    ribs.blob((0, -0.2, 4.5), (0.26, 0.2, 0.3), SOUL, mat=GLOW, segments=10, rings=8)    # the soul he hoards
    ribs.blob((0, -0.24, 4.52), (0.13, 0.1, 0.16), SOUL_HOT, mat=GLOW, segments=8, rings=6)
    # The cord belt, its knot and its bone charms.
    belt = part('Belt', 'Hips', smooth=True)
    belt.tube([Vector((math.sin(math.tau * i / 32) * 0.58, -math.cos(math.tau * i / 32) * 0.46, 3.32 + 0.03 * math.sin(i)))
               for i in range(33)], [0.05] * 33, ROPE, sides=6, cap=False)
    for s, drop in ((-1, 0.8), (-1.3, 1.1)):
        belt.tube([Vector((s * 0.22, -0.46, 3.3)), Vector((s * 0.26, -0.5, 3.3 - drop * 0.5)),
                   Vector((s * 0.24, -0.47, 3.3 - drop))], [0.04, 0.035, 0.03], ROPE, sides=6)
        belt.blob((s * 0.24, -0.47, 3.24 - drop), (0.08, 0.07, 0.09), BONE_OLD, segments=8, rings=5)
    # --- the skull in the hood --------------------------------------------------------------
    head = part('Skull', 'Head', smooth=True, subdiv=1)
    head.blob((0, -0.36, 5.7), (0.36, 0.5, 0.46), BONE, segments=18, rings=14)           # the cranium
    head.blob((0, -0.56, 5.8), (0.3, 0.24, 0.14), BONE, segments=14, rings=8)            # the brow
    head.loft([                                                                          # the face, tapering
        ((0, -0.5, 5.66), 0.19, 0.12, 2.6, (0, -0.25, -1)),
        ((0, -0.58, 5.5), 0.16, 0.1, 2.4, (0, -0.2, -1)),
        ((0, -0.62, 5.38), 0.12, 0.08, 2.2, (0, -0.2, -1)),
    ], BONE, sides=14)
    for s in (-1, 1):
        head.blob((s * 0.12, -0.68, 5.6), (0.12, 0.09, 0.1), SOCKET, segments=12, rings=8)   # deep sockets
        head.loft([                                                                      # sharp cheekbones
            ((s * 0.14, -0.6, 5.5), 0.03, 0.04, 2.0, (s * 1, -0.6, -0.2)),
            ((s * 0.22, -0.55, 5.48), 0.04, 0.05, 2.0, (s * 1, -0.6, -0.2)),
            ((s * 0.27, -0.44, 5.5), 0.02, 0.03, 2.0, (s * 1, -0.6, -0.2)),
        ], BONE_OLD, sides=8)
        head.blob((s * 0.12, -0.765, 5.6), (0.045, 0.02, 0.045), SOUL_HOT, mat=GLOW, segments=8, rings=6)  # embers
        head.blob((s * 0.12, -0.758, 5.6), (0.085, 0.012, 0.07), SOUL, mat=GLOW, segments=8, rings=6)
        head.blob((s * 0.26, -0.32, 5.62), (0.06, 0.1, 0.09), BONE_OLD, segments=8, rings=6)   # temples
    head.prism((0, -0.66, 5.5), 3, 0.045, 0.001, 0.09, SOCKET, axis=(0, -0.3, -1))       # nasal cavity
    for k in range(8):
        x = (k - 3.5) * 0.034
        head.box((x, -0.66 + abs(x) * 0.4, 5.37), (0.026, 0.024, 0.055), BONE_OLD, bevel=0.004)   # upper teeth
    jaw = part('Jaw', 'Jaw', smooth=True)
    jaw.loft([
        ((-0.2, -0.42, 5.36), 0.03, 0.05, 2.0, (1, -0.4, 0)),
        ((-0.12, -0.58, 5.3), 0.04, 0.05, 2.0, (1, -0.4, 0)),
        ((0, -0.63, 5.28), 0.05, 0.05, 2.0, (1, 0, 0)),
        ((0.12, -0.58, 5.3), 0.04, 0.05, 2.0, (1, 0.4, 0)),
        ((0.2, -0.42, 5.36), 0.03, 0.05, 2.0, (1, 0.4, 0)),
    ], BONE, sides=8)
    for k in range(7):
        x = (k - 3) * 0.034
        jaw.box((x, -0.62 + abs(x) * 0.4, 5.33), (0.025, 0.022, 0.045), BONE_OLD, bevel=0.004)
    # The hood: a deep cowl round the skull, open at the face, its peak falling
    # back; an open shell, so it rides the double-sided shroud material.
    hood = part('Hood', 'Head', smooth=True, subdiv=1)
    hood_path = [Vector((0, 0.42, 5.3)), Vector((0, 0.3, 5.72)), Vector((0, 0.02, 5.98)), Vector((0, -0.34, 6.02)),
                 Vector((0, -0.66, 5.86)), Vector((0, -0.9, 5.6))]
    hood.tube(hood_path, [0.3, 0.52, 0.6, 0.6, 0.58, 0.6], SHROUD_HI, sides=20, squash=1.18, cap=False,
              up=(1, 0, 0), mat=2)
    hood.tube([Vector((0, 0.1, 6.35)), Vector((0, 0.42, 6.5)), Vector((0, 0.8, 6.35)), Vector((0, 1.0, 6.05))],
              [0.2, 0.14, 0.07, 0.015], SHROUD_HI, sides=12, mat=2)                      # the peak, falling back
    # The hood's rolled lip, hugging the rim of the opening.
    lip = [Vector((0.6 * math.sin(math.radians(a)), -0.9 + 0.04 * math.cos(math.radians(a)),
                   5.6 + 0.7 * math.cos(math.radians(a)))) for a in range(-125, 126, 10)]
    hood.tube(lip, [0.055] * len(lip), SHROUD_EDGE, sides=7)
    # --- arms: tattered sleeves and skeletal hands ----------------------------------------
    for tag in ('.L', '.R'):
        up = part('Sleeve' + tag, 'Arm' + tag, smooth=True)
        a0, a1 = REST['Arm' + tag]
        up.tube([a0.lerp(a1, t) for t in (0, 0.33, 0.66, 1.0)], [0.25, 0.22, 0.21, 0.22], SHROUD_HI, sides=12)
        lo = part('Cuff' + tag, 'Fore' + tag, smooth=True)
        f0, f1 = REST['Fore' + tag]
        fd = (f1 - f0).normalized()
        fu = fd.orthogonal().normalized()
        fv = fd.cross(fu).normalized()
        lo.tube([f0.lerp(f1, t) for t in (0, 0.3, 0.6, 0.85, 1.0)], [0.21, 0.23, 0.27, 0.33, 0.37], SHROUD,
                sides=14, cap=False, mat=2, up=tuple(fu))
        # tatters trailing off the bell of the cuff, past the wrist
        for k in range(7):
            ang = math.tau * k / 7
            ring = fu * math.cos(ang) + fv * math.sin(ang)
            base = f1 + ring * 0.32 - fd * 0.05
            ln = 0.35 + 0.35 * ((k * 37) % 5) / 5
            lo.tube([base, base + ring * 0.05 + fd * (ln * 0.5), base + ring * 0.08 + fd * ln], [0.09, 0.07, 0.02],
                    SHROUD_EDGE, sides=4, squash=0.25, up=tuple(ring))
    # The hands: bony fists closed round a bar. The right one is modelled round the
    # snath; the left one's fingers ride the Claw bone so the free hand can open.
    fist(part('Hand.R', 'Hand.R', smooth=True), WRIST_R, H_R, A_R, N_R)
    fist(part('Hand.L', 'Hand.L', smooth=True), WRIST_L, H_L, A_L, N_L, digits=part('Claw', 'Claw', smooth=True))
    # --- the scythe (rides the Scythe bone, modelled upright IN the right fist) --------------
    sc = part('Scythe', 'Scythe', smooth=True)
    g = Vector(REST['Scythe'][0])
    up = Vector((0, 0, 1))
    shaft = [g - up * SHAFT_BELOW + up * (SHAFT_BELOW + SHAFT_ABOVE) * t + Vector((0.03 * math.sin(t * 6), 0.02 * math.sin(t * 4), 0))
             for t in (i / 12 for i in range(13))]
    sc.tube(shaft, [0.095, 0.092, 0.09, 0.088, 0.086, 0.085, 0.084, 0.082, 0.08, 0.078, 0.076, 0.075, 0.074],
            [lerp(WOOD_D, WOOD, (i % 3) / 2) for i in range(13)], sides=9)
    for t in (0.02, 0.33, 0.55, 0.98):
        c = g - up * SHAFT_BELOW + up * (SHAFT_BELOW + SHAFT_ABOVE) * t
        sc.tube([c - up * 0.08, c + up * 0.08], [0.115, 0.115], IRON, sides=9)              # iron ferrules
    sc.blob(g - up * (SHAFT_BELOW + 0.06), (0.14, 0.14, 0.18), IRON, segments=8, rings=6)   # the pommel
    # The snath's two grips: leather bound round the shaft where each fist closes
    # (the right one at the bone, the off hand's GRIP2 below it), iron-collared.
    for at in (0.0, -GRIP2):
        c = g + up * at
        sc.tube([c - up * 0.2, c, c + up * 0.2], [GRIP_BAR, GRIP_BAR * 1.02, GRIP_BAR], LEATHER, sides=10)
        for e in (-0.22, 0.22):
            sc.tube([c + up * (e - 0.03), c + up * (e + 0.03)], [GRIP_BAR + 0.018] * 2, IRON, sides=10)
    # The blade: a long crescent of black iron, sweeping forward and down, its
    # edge burning with pale soul fire, a bone socket where it meets the shaft.
    top = g + up * SHAFT_ABOVE
    socket = top - up * 0.15
    sc.blob(socket, (0.22, 0.22, 0.26), BONE, segments=10, rings=8)
    sc.blob(socket + Vector((0, -0.18, 0.02)), (0.1, 0.07, 0.1), SOCKET, segments=8, rings=6)
    n = 14
    spine_pts = []
    for i in range(n + 1):
        t = i / n
        ang = t * 1.4
        spine_pts.append(socket + Vector((0, -math.sin(ang) * 3.7, 0.3 - (1 - math.cos(ang)) * 1.8 + 0.45 * t)))
    # The blade is a flat loft of sections: thick back, thin toward the tip.
    secs = []
    for i, pnt in enumerate(spine_pts):
        t = i / n
        tang = (spine_pts[min(n, i + 1)] - spine_pts[max(0, i - 1)]).normalized()
        width = 0.46 * (1 - t) ** 0.7 + 0.025
        secs.append((tuple(pnt + Vector((0, 0, -width * 0.5)) * 1.0), 0.035 * (1 - 0.6 * t) + 0.006, width * 0.5, 2.2,
                     tuple(tang)))
    sc.loft(secs, BLADE, sides=10)
    # The burning edge along the blade's belly.
    edge = [pnt + Vector((0, 0, -(0.46 * (1 - i / n) ** 0.7 + 0.025))) for i, pnt in enumerate(spine_pts)]
    sc.tube(edge, [0.04 * (1 - 0.7 * i / n) + 0.008 for i in range(n + 1)], SOUL, mat=GLOW, sides=5)
    # Notches hacked into the blade's back.
    for i in (3, 6, 9):
        sc.spike(spine_pts[i] + Vector((0, 0, 0.02)), 0.05, 0.16, BLADE_HI, sides=4, lean=(0, 0.04))
    # Runnels of soul light etched along the flat.
    rn = [pnt + Vector((0.04, 0, -0.14 * (1 - i / n))) for i, pnt in enumerate(spine_pts[:10])]
    sc.tube(rn, [0.012] * len(rn), SOUL_DEEP, mat=GLOW, sides=4)
    # Ribbons of shroud knotted under the blade.
    for k, ln in ((0, 1.2), (1, 0.9)):
        base = socket - up * (0.25 + 0.05 * k) + Vector((0.08 * (k * 2 - 1), 0, 0))
        sc.tube([base, base + Vector((0.12 * (k * 2 - 1), 0.05, -ln * 0.5)), base + Vector((0.2 * (k * 2 - 1), 0.12, -ln))],
                [0.07, 0.06, 0.015], SHROUD_EDGE, sides=4, squash=0.25)
    # --- the soul lantern at the hip ---------------------------------------------------------
    lan = part('Lantern', 'Lantern', smooth=True)
    l0, l1 = REST['Lantern']
    for i in range(4):
        c = l0.lerp(l1, i / 5)
        lan.tube([c + Vector((0, 0, 0.06)), c - Vector((0, 0, 0.06))], [0.03, 0.03], IRON, sides=6)
    cage_c = l1 - Vector((0, 0, 0.15))
    lan.blob(cage_c + Vector((0, 0, 0.26)), (0.2, 0.2, 0.08), IRON, segments=8, rings=5)
    lan.blob(cage_c - Vector((0, 0, 0.26)), (0.2, 0.2, 0.08), IRON, segments=8, rings=5)
    for k in range(6):
        ang = math.tau * k / 6
        off = Vector((math.cos(ang) * 0.17, math.sin(ang) * 0.17, 0))
        lan.tube([cage_c + off + Vector((0, 0, 0.25)), cage_c + off * 1.15, cage_c + off - Vector((0, 0, 0.25))],
                 [0.022] * 3, IRON, sides=5)
    lan.blob(cage_c, (0.13, 0.13, 0.19), SOUL, mat=GLOW, segments=10, rings=8)             # the trapped soul
    lan.blob(cage_c + Vector((0, 0, 0.02)), (0.07, 0.07, 0.1), SOUL_HOT, mat=GLOW, segments=8, rings=6)
    # --- the soul motes ------------------------------------------------------------------------
    motes = part('Motes', 'Motes', smooth=True)
    for k in range(5):
        ang = math.tau * k / 5
        r = 1.6 + 0.25 * math.sin(k * 2.1)
        c = Vector((math.cos(ang) * r, math.sin(ang) * r, 4.1 + 0.6 * math.sin(k * 1.7)))
        motes.blob(c, (0.14, 0.14, 0.16), SOUL, mat=GLOW, segments=10, rings=8)
        motes.blob(c, (0.07, 0.07, 0.08), SOUL_HOT, mat=GLOW, segments=8, rings=6)
        for j in (1, 2):
            sat = c + Vector((-math.sin(ang) * 0.3 * j, math.cos(ang) * 0.3 * j, -0.06 * j))
            motes.blob(sat, (0.06 / j, 0.06 / j, 0.07 / j), SOUL, mat=GLOW, segments=6, rings=4)
    return parts


def build_membranes():
    mems = []
    # The shroud: panels between the hanging skirt spars, the hem torn to rags.
    skirt = Membrane('Shroud', SHROUD, seed=7)
    spars = []
    for k in range(SKIRT):
        a0, a1 = REST[f'Skirt{k}a']
        b1 = REST[f'Skirt{k}b'][1]
        spars.append([(tuple(a0), 'Hips'), (tuple(a0.lerp(a1, 0.5)), f'Skirt{k}a'), (tuple(a1), f'Skirt{k}a'),
                      (tuple(a1.lerp(b1, 0.5)), f'Skirt{k}b'), (tuple(b1), f'Skirt{k}b')])
    for k in range(SKIRT):
        skirt.panel(spars[k], spars[(k + 1) % SKIRT], rows=14, cols=7, scallop=0.04, tear=0.75, shade=1.0)
    mems.append(skirt)
    # The cloak: from the hood's foot over the shoulders to the flags, open at the
    # front, dragging behind. The side spars ride the upper arms at the shoulder
    # so a raised arm lifts its fold of cloak.
    cloak = Membrane('Cloak', SHROUD, seed=11)
    cs = []
    for k in range(CLOAK):
        th, st = cloak_spar(k)
        sx = math.sin(th)
        mid_bone = f'Cloak{k}a'
        if abs(sx) > 0.72:
            mid_bone = 'Arm.L' if sx > 0 else 'Arm.R'
        cs.append([(st[0], 'Neck'), (st[1], 'Chest'), (st[2], mid_bone), (st[3], f'Cloak{k}b'), (st[4], f'Cloak{k}c')])
    for k in range(CLOAK - 1):
        cloak.panel(cs[k], cs[k + 1], rows=18, cols=5, scallop=0.02, tear=0.85, shade=0.92, sag=0.05)
    mems.append(cloak)
    return mems


# -------------------------------------------------------------------- posing
class GripRig(Rig):
    """The organic kit's Rig plus `absolute` world turns for chosen bones: the
    right fist (and the scythe locked in it) is placed by the grip solver, and
    the off hand by its own search round the snath."""

    def pose(self, aims=None, ik=None, turns=None, root=(0, 0, 0), absolute=None):
        absolute = dict(absolute or {})
        aims = self._mirror({k: Vector(v) for k, v in (aims or {}).items()}, 'aim')
        turns = self._mirror(turns or {}, 'turns')
        ik = dict(ik or {})
        ik_upper = {u: (lo, Vector(tgt), Vector(pole)) for u, lo, tgt, pole in ik.values()}
        delta, head, out = {}, {}, {}
        for name, parent, h, t in self.bones:
            rh, rt = self.rest[name]
            if parent:
                ph = self.rest[parent][0]
                head[name] = head[parent] + delta[parent] @ (rh - ph)
                dp = delta[parent]
            else:
                head[name] = rh + Vector(root)
                dp = Quaternion()
            if name in ik_upper:
                lo, tgt, pole = ik_upper[name]
                l1 = (rt - rh).length
                l2 = (self.rest[lo][1] - self.rest[lo][0]).length
                d1, d2 = two_bone(head[name], l1, l2, tgt, pole)
                aims[name] = d1
                aims[lo] = d2
            q = Quaternion()
            if name in absolute:
                q = dp.inverted() @ absolute[name]
            elif name in aims:
                r0 = (rt - rh).normalized()
                want = dp.inverted() @ aims[name].normalized()
                q = r0.rotation_difference(want)
            for a, deg in turns.get(name, []):
                ax = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[a] \
                    if isinstance(a, str) else Vector(a).normalized()
                q = Quaternion(ax, math.radians(deg)) @ q
            delta[name] = dp @ q
            rest_m = self.rest_matrix(name)
            out[name] = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
        out['__root'] = Vector(root)
        out['__head'] = head
        out['__delta'] = delta
        return out


def scythe_quat(d, face):
    """The world turn of the scythe, and so of the right fist locked to it: the
    snath (rest +Z) along `d`, the blade (rest -Y) toward `face`."""
    z1 = _n(d)
    f = Vector(face) - z1 * z1.dot(Vector(face))
    if f.length < 1e-4:
        f = z1.orthogonal()
    y1 = -f.normalized()
    x1 = y1.cross(z1).normalized()
    return Matrix((x1, y1, z1)).transposed().to_quaternion()


def left_grip_quat(d, psi):
    """The left fist closed round the snath (its bar axis, the thumb side, up the
    snath toward the blade), turned `psi` radians round it."""
    a1 = _n(d)
    e1 = a1.orthogonal().normalized()
    e2 = a1.cross(e1).normalized()
    h1 = e1 * math.cos(psi) + e2 * math.sin(psi)
    n1 = -(a1.cross(h1)).normalized()
    r0 = Matrix((H_L, A_L, N_L)).transposed()
    r1 = Matrix((h1, a1, n1)).transposed()
    return (r1 @ r0.transposed()).to_quaternion()


def lead(s, x=0.0):
    """The blade's facing for a swing in his own sagittal plane: the tangent the
    head of the snath travels along as it comes forward and down (the point
    leads), with an optional lean `x` across his body."""
    s = _n(s)
    return (x, -s.z, s.y)


def mg(x, y, z):
    """A grip placed on Morthen's frame, carried onto Vael's: his shoulders sit
    1.2 times as wide, his arms reach 1.25 times as far, from 4.9 instead of 3.82."""
    return (x * 1.2, y * 1.2, 4.9 + (z - 3.82) * 1.25)


DIAG = []   # (clip, frame, right wrist bend, left wrist bend, right grip gap, left grip gap, scythe vs fist)


# -------------------------------------------------------------------- clips
def make_clips(arm):
    rig = GripRig(BONES).attach(arm)
    P = rig.pose
    clips = []
    l_up = (REST['Arm.R'][1] - REST['Arm.R'][0]).length
    l_fore_r = (REST['Fore.R'][1] - REST['Fore.R'][0]).length
    l_fore_l = (REST['Fore.L'][1] - REST['Fore.L'][0]).length
    fr_r = (WRIST_R - ELBOW_R).normalized()
    fr_l = (WRIST_L - ELBOW_L).normalized()
    head_rest = (REST['Head'][1] - REST['Head'][0]).normalized()
    neck_rest = (REST['Neck'][1] - REST['Neck'][0]).normalized()

    def add(name, keys, loop_clip=True):
        for f, pose in keys:
            dg = pose.get('__diag')
            if dg:
                DIAG.append((name, f) + dg)
        clip(arm, name, keys, loop_clip)
        clips.append(name)

    def solve(sh, l1, l2, wrist, pole):
        d1, d2 = two_bone(sh, l1, l2, wrist, pole)
        over = max(0.0, (wrist - sh).length - 0.995 * (l1 + l2))
        return d1, d2, over

    def stance(root=(0, 0, 0), yaw=0.0, tilt=0.0, lean=0.0, side=0.0, twist=0.0, look=(0, -1, 0.0), jaw=6.0,
               grip=(-1.3, -0.9, 3.05), scythe=(0.06, -0.08, 1.0), face=(0.2, -1.0, 0.0), face_tol=35.0,
               both=False, grip2=GRIP2, left=(1.4, -0.85, 3.0), left_hand=(0.12, -0.35, -1.0), claw=18.0,
               left_pole=(1.2, 0.4, -0.4), right_pole=(-1.2, 0.5, -0.4), flutter=0.0, stream=0.0,
               cape_lift=0.0, motes=0.0, splay=0.0, comfort=0.9):
        """One pose, body first. The torso (`lean`, `side`, `twist` degrees through
        the spine and chest), the whole floating body (`root`, `yaw` and `tilt`
        degrees) and the arms carry the weapon; the scythe is never turned against
        the fist. The weapon is placed in the body's own frame: the right fist's
        grip at `grip`, the snath along `scythe`, the blade toward `face` (free to
        turn `face_tol` degrees round the snath to keep the wrist natural). With
        `both` the left fist closes round the snath `grip2` below the right; else
        the left wrist goes to `left`, the hand along `left_hand`, its claw open
        `claw` degrees. `look` turns the skull: x sideways, z up or bowed."""
        rootv = (root[0], root[1], root[2] + HOVER)
        aims = {
            'Spine': (side * 0.4, -0.08 - lean * 0.6, 1.0),
            'Chest': (side * 0.6, -0.1 - lean, 1.0),
            'Neck': tuple(neck_rest + Vector((look[0] * 0.3, 0.0, look[2] * 0.3))),
            'Head': tuple(head_rest + Vector((look[0], 0.0, look[2] * 1.2))),
            'Lantern': (0.08 + 0.3 * math.sin(flutter * 2.0) * (0.3 + stream), 0.25 * stream, -1.0),
            'Motes': (0.0, 0.0, 1.0),
        }
        turns = {
            'Root': [('x', tilt), ('z', yaw)],
            'Spine': [('z', twist * 0.4)],
            'Chest': [('z', twist * 0.6)],
            'Jaw': [('x', jaw)],
            'Motes': [('z', motes)],
        }
        for k in range(SKIRT):
            a = math.tau * k / SKIRT
            fwd = -math.cos(a)  # 1 at the front
            ph = flutter + k * 0.9
            sw = 4.0 * math.sin(ph) + stream * 14.0 * fwd + splay * 22.0
            turns[f'Skirt{k}a'] = [((math.cos(a), math.sin(a), 0), sw * 0.6 + splay * 10)]
            turns[f'Skirt{k}b'] = [((math.cos(a), math.sin(a), 0), sw * 0.8 + 3.0 * math.sin(ph * 1.3))]
        for k in range(CLOAK):
            th, _ = cloak_spar(k)
            ph = flutter * 1.2 + k * 1.1
            lift = cape_lift + stream * 0.9
            back = max(0.0, math.cos(th))
            ax = (math.cos(th), -math.sin(th), 0)   # swings the spar out from the body
            turns[f'Cloak{k}a'] = [(ax, -3 * lift * back - 1.5 * math.sin(ph) - splay * 8)]
            turns[f'Cloak{k}b'] = [(ax, -9 * lift * back - 3 * math.sin(ph + 0.6) - splay * 10)]
            turns[f'Cloak{k}c'] = [(ax, -14 * lift * back - 5 * math.sin(ph + 1.2) - splay * 12)]
        absolute = {}
        # pass one: the body alone, to find where the shoulders went
        first = P(aims=dict(aims), turns=turns, root=rootv)
        heads, deltas = first['__head'], first['__delta']
        rr = deltas['Root']
        at = heads['Root']
        sh_r, sh_l = heads['Arm.R'], heads['Arm.L']
        gw = at + rr @ Vector(grip)
        dw = (rr @ _n(scythe)).normalized()
        fw = rr @ Vector(face)
        pole_r = rr @ Vector(right_pole)
        pole_l = rr @ Vector(left_pole)
        q0 = scythe_quat(dw, fw)
        best = None
        for step in range(-int(face_tol), int(face_tol) + 1, 5):
            q = Quaternion(dw, math.radians(step)) @ q0
            # the arm comfortable: the elbow where a straight wrist puts it, pulled onto
            # the upper arm's reach; the weapon gives way to the body, not the wrist
            e_want = gw + q @ (ELBOW_R - GRIP)
            e_ok = sh_r + (e_want - sh_r).normalized() * l_up
            g = gw.lerp(e_ok - q @ (ELBOW_R - GRIP), comfort)
            wrist = g + q @ (WRIST_R - GRIP)
            # bend the elbow toward where the straight wrist wants it
            pole = pole_r.normalized().lerp((wrist - q @ fr_r * l_fore_r - sh_r).normalized(), comfort)
            _, d2, over = solve(sh_r, l_up, l_fore_r, wrist, pole)
            bend = math.degrees(d2.angle(q @ fr_r))
            score = bend + 0.12 * abs(step) + 25.0 * (g - gw).length + over * 400
            if best is None or score < best[0]:
                best = (score, q, wrist, bend, g, pole)
        _, q_r, wrist_r, bend_r, gw, pole_r = best
        absolute['Hand.R'] = q_r
        bend_l = 0.0
        if both:
            bestl = None
            for slide in (-0.1, -0.05, 0.0, 0.05, 0.1, 0.15):
                gl = gw - dw * (grip2 + slide)
                for step in range(0, 360, 5):
                    q = left_grip_quat(dw, math.radians(step))
                    wrist = gl + q @ (WRIST_L - GRIP_L)
                    pole = pole_l.normalized().lerp((wrist - q @ fr_l * l_fore_l - sh_l).normalized(), comfort)
                    _, d2, over = solve(sh_l, l_up, l_fore_l, wrist, pole)
                    bend = math.degrees(d2.angle(q @ fr_l))
                    score = bend + 20.0 * abs(slide) + over * 600
                    if bestl is None or score < bestl[0]:
                        bestl = (score, q, wrist, bend, pole)
            _, q_l, wrist_l, bend_l, pole_l = bestl
            absolute['Hand.L'] = q_l
            claw = 0.0
        else:
            wrist_l = at + rr @ Vector(left)
            aims['Hand.L'] = tuple(rr @ _n(left_hand))
        # the free claw opens round its knuckle line (positive about the bar axis)
        turns['Claw'] = [(tuple(A_L), claw)]
        ik = {'arm.R': ('Arm.R', 'Fore.R', tuple(wrist_r), tuple(pole_r)),
              'arm.L': ('Arm.L', 'Fore.L', tuple(wrist_l), tuple(pole_l))}
        out = P(aims=aims, ik=ik, turns=turns, root=rootv, absolute=absolute)
        hd, dl = out['__head'], out['__delta']
        got_r = hd['Hand.R'] + dl['Hand.R'] @ (GRIP - WRIST_R)
        gap_r = (got_r - gw).length
        gap_l = 0.0
        if both:
            got_l = hd['Hand.L'] + dl['Hand.L'] @ (GRIP_L - WRIST_L)
            rel = got_l - gw
            gap_l = (rel - dw * rel.dot(dw)).length
        rel_q = dl['Hand.R'].inverted() @ dl['Scythe']
        turn = math.degrees(2 * math.acos(min(1.0, abs(rel_q.w))))
        out['__diag'] = (round(bend_r, 1), round(bend_l, 1), round(gap_r, 3), round(gap_l, 3), round(turn, 2))
        return out

    # ------------------------------------------------------------------ the hold
    hold = dict(grip=(-1.3, -0.9, 3.0), scythe=(0.1, -0.12, 1.0), face=(0.2, -1.0, 0.0))

    def rest(ph, **kw):
        """The standing hover at phase `ph` (radians): the scythe upright in the
        right fist at his side, the left claw loose by the lantern."""
        base = dict(root=(0, 0, 0.09 * math.sin(ph)), flutter=ph, motes=math.degrees(ph) / 4,
                    look=(0.06 * math.sin(ph * 0.5), -1, 0.08), jaw=6 + 3 * math.sin(ph * 2),
                    lean=0.04 * math.sin(ph + 0.6), side=0.03 * math.sin(ph * 0.5),
                    left=(1.4, -0.85, 3.0 + 0.04 * math.sin(ph - 0.5)), claw=16 + 6 * math.sin(ph))
        base.update(hold)
        # the held weapon breathes a little behind the body's bob
        base['grip'] = tuple(Vector(hold['grip']) + Vector((0.0, 0.0, 0.04 * math.sin(ph - 0.9))))
        base.update(kw)
        return stance(**base)

    # Idle: hovering, the shroud breathing, the motes circling (a full turn over
    # the loop is keyed as quarter turns so each key interpolates the short way).
    idle_keys = []
    for i in range(8):
        ph = math.tau * i / 8
        idle_keys.append((1 + i * 8, rest(ph, motes=45 * i)))
    idle_keys.append((65, rest(0.0, motes=360 - 1e-3)))
    add('Idle', idle_keys)
    # The glide: leaning into it, the scythe trailing at his side in the right fist.
    glide = dict(lean=0.35, stream=0.8, look=(0, -1, -0.05), grip=(-1.25, -0.75, 3.35), scythe=(0.1, 0.4, 1.0),
                 face=(0.1, -1.0, 0.2), left=(1.3, -0.4, 3.2), claw=10)
    walk = []
    for i in range(4):
        ph = i * math.pi / 2
        kw = dict(glide)
        kw['grip'] = tuple(Vector(glide['grip']) + Vector((0, 0.05 * math.sin(ph), 0.05 * math.cos(ph))))
        walk.append((1 + i * 8, rest(ph, root=(0, 0, 0.1 * math.sin(ph)), flutter=i * 1.6, motes=22 * i,
                                     side=0.05 * math.sin(ph), **kw)))
    walk.append((33, rest(0.0, root=(0, 0, 0), flutter=6.4, motes=88, **glide)))
    add('Walk', walk)
    run = dict(glide, lean=0.6, stream=1.2, look=(0, -1, -0.15), cape_lift=0.6, grip=(-1.2, -0.55, 3.45),
               scythe=(0.12, 0.85, 0.7), face=(0.1, -0.5, 1.0), left=(1.25, -0.1, 3.4))
    add('Run', [(1 + i * 5, rest(i * math.pi / 2, root=(0, 0, 0.14 * math.sin(i * math.pi / 2)), flutter=i * 2.2,
                                 motes=30 * i, **run)) for i in range(4)]
        + [(21, rest(0.0, flutter=8.8, motes=120, **run))])
    ready = rest(0.0)

    # ------------------------------------------------------------------ the strikes
    # Attack: the flat reaping sweep right to left, both hands on the snath, the
    # point leading, the body unwinding from a deep coil through the cut. A dip
    # (anticipation), the wind-up held behind the right shoulder, a fast committed
    # arc to the contact at frame 13, the follow-through past the target, and a
    # heavy recovery to the hover.
    ss = dict(both=True, right_pole=(-1.0, 0.4, -0.7), left_pole=(1.0, 0.2, -0.9))
    c_dip = stance(root=(0, 0.06, -0.1), yaw=-8, lean=0.18, twist=-12, look=(0, -1, 0.0), jaw=10,
                   grip=mg(-0.5, -0.95, 3.35), scythe=(-0.45, -0.15, 0.95), face=(0.35, -1.0, 0.0), flutter=0.4,
                   **ss)
    c_wind = stance(root=(0, 0.24, 0.05), yaw=-22, lean=0.1, twist=-34, side=0.05, look=(-0.15, -1, 0.05), jaw=18,
                    grip=mg(-1.05, 0.05, 3.25), scythe=(-0.8, 0.45, 0.15), face=(0.0, -0.4, 1.0), stream=0.2,
                    flutter=1.0, cape_lift=0.2, **ss)
    c_hold = stance(root=(0, 0.26, 0.02), yaw=-24, lean=0.1, twist=-37, side=0.06, look=(-0.16, -1, 0.05), jaw=20,
                    grip=mg(-1.07, 0.1, 3.2), scythe=(-0.82, 0.45, 0.1), face=(0.0, -0.4, 1.0), stream=0.2,
                    flutter=1.1, cape_lift=0.25, **ss)
    c_cut = stance(root=(0, -0.12, -0.14), yaw=-2, lean=0.4, twist=0, look=(0.0, -1, -0.05), jaw=30,
                   grip=mg(-0.55, -1.25, 2.8), scythe=(-0.1, -1.0, -0.25), face=(0.95, 0.0, 0.25), stream=0.5,
                   flutter=1.8, **ss)
    c_hit = stance(root=(0, -0.24, -0.2), yaw=16, lean=0.42, twist=28, look=(0.3, -1, -0.05), jaw=34,
                   grip=mg(-0.05, -1.3, 2.75), scythe=(0.6, -0.8, -0.28), face=(0.75, 0.6, 0.2), stream=0.5,
                   flutter=2.2, **ss)
    # past the target the off hand lets the snath run on and flies out as a claw
    loose = dict(ss, both=False, left=(1.85, -0.5, 3.9), left_hand=(0.7, -0.2, 0.3), claw=45)
    c_follow = stance(root=(0, -0.18, -0.17), yaw=28, lean=0.3, twist=46, look=(0.4, -1, -0.05), jaw=24,
                      grip=mg(0.35, -1.0, 2.95), scythe=(0.95, 0.3, -0.15), face=(-0.2, 1.0, 0.25), stream=0.3,
                      flutter=2.6, **loose)
    c_rec = stance(root=(0, -0.05, -0.05), yaw=10, lean=0.18, twist=16, look=(0.15, -1, 0.0), jaw=14,
                   grip=mg(-0.15, -1.05, 3.3), scythe=(0.2, -0.5, 0.85), face=(0.4, -1.0, 0.0), flutter=3.0,
                   **dict(loose, left=(1.5, -0.8, 3.3), left_hand=(0.3, -0.4, -0.8), claw=25))
    add('Attack', [(1, ready), (3, c_dip), (7, c_wind), (10, c_hold), (12, c_cut), (13, c_hit), (16, c_follow),
                   (22, c_rec), (28, ready)], loop_clip=False)
    # Attack2: the overhead chop, two-handed: the body sinks and coils, the snath
    # goes up and back over the right shoulder and holds; a committed arc through
    # the vertical, the point driven down at frame 15 with the whole body dropping
    # into it, a follow-through and a heavy lift back to the hover.
    ch = dict(both=True, right_pole=(-1.0, 0.3, -0.7), left_pole=(1.0, 0.1, -0.9))
    s_dip = stance(root=(0, 0.06, -0.12), lean=0.12, twist=-8, look=(0, -1, 0.0), jaw=10, grip=mg(-0.6, -0.9, 3.6),
                   scythe=(-0.35, -0.3, 1.0), face=lead((-0.35, -0.3, 1.0), 0.15), flutter=0.3, **ch)
    s_wind = stance(root=(0, 0.22, 0.14), yaw=-12, lean=-0.28, twist=-28, side=-0.06, look=(0, -1, 0.3), jaw=20,
                    grip=mg(-0.62, 0.05, 4.55), scythe=(-0.08, 0.72, 0.62), face=lead((-0.08, 0.72, 0.62), 0.15),
                    cape_lift=0.3, flutter=1.0, **ch)
    s_hold = stance(root=(0, 0.24, 0.18), yaw=-13, lean=-0.3, twist=-30, side=-0.07, look=(0, -1, 0.32), jaw=22,
                    grip=mg(-0.6, 0.1, 4.6), scythe=(-0.08, 0.75, 0.6), face=lead((-0.08, 0.75, 0.6), 0.15),
                    cape_lift=0.32, flutter=1.2, **ch)
    s_over = stance(root=(0, -0.06, 0.06), yaw=-4, lean=0.15, twist=-8, look=(0, -1, 0.15), jaw=26,
                    grip=mg(-0.42, -0.9, 4.55), scythe=(0.0, -0.35, 1.0), face=lead((0.0, -0.35, 1.0), 0.15),
                    stream=0.2, flutter=1.6, **ch)
    s_smash = stance(root=(0, -0.3, -0.29), yaw=6, lean=0.6, twist=10, look=(0, -1, -0.25), jaw=38,
                     grip=mg(-0.3, -1.3, 3.05), scythe=(0.02, -1.0, -0.28), face=lead((0.02, -1.0, -0.28), 0.15),
                     stream=0.45, flutter=2.0, **ch)
    s_follow = stance(root=(0, -0.34, -0.38), yaw=9, lean=0.68, twist=14, look=(0, -1, -0.35), jaw=34,
                      grip=mg(-0.26, -1.3, 2.72), scythe=(0.03, -0.85, -0.55),
                      face=lead((0.03, -0.85, -0.55), 0.15), stream=0.35, flutter=2.3, **ch)
    s_settle = stance(root=(0, -0.24, -0.26), yaw=6, lean=0.55, twist=8, look=(0, -1, -0.2), jaw=24,
                      grip=mg(-0.3, -1.25, 2.9), scythe=(0.02, -0.95, -0.4), face=lead((0.02, -0.95, -0.4), 0.15),
                      stream=0.25, flutter=2.6, **ch)
    s_lift = stance(root=(0, -0.06, -0.06), yaw=2, lean=0.25, twist=0, look=(0, -1, 0.0), jaw=14,
                    grip=mg(-0.75, -1.0, 3.2), scythe=(0.05, -0.55, 1.0), face=(0.2, -1.0, 0.0), flutter=3.0,
                    **dict(ch, both=False, left=(1.45, -0.9, 3.2), left_hand=(0.2, -0.4, -0.8), claw=20))
    add('Attack2', [(1, ready), (4, s_dip), (9, s_wind), (12, s_hold), (14, s_over), (15, s_smash), (18, s_follow),
                    (22, s_settle), (26, s_lift), (30, ready)], loop_clip=False)

    # ------------------------------------------------------------------ the casts
    # Cast: the soul reap, the scythe raised high in the right fist, the free hand
    # an open claw dragging the souls out of the living.
    reap_kw = dict(face=(0.4, -1.0, 0.0), left_pole=(1.2, 0.8, -0.2), right_pole=(-1.2, 0.3, -0.5))
    reap_a = stance(lean=-0.25, grip=(-1.0, -0.7, 5.6), scythe=(0.08, 0.05, 1.0), left=(1.8, -1.3, 4.5),
                    left_hand=(0.5, -0.6, 0.4), claw=70, look=(0.2, -1, 0.35), jaw=36, flutter=1.0, cape_lift=0.5,
                    **reap_kw)
    reap_b = stance(lean=-0.3, grip=(-1.0, -0.65, 5.75), scythe=(0.12, 0.1, 1.0), left=(2.0, -1.1, 4.7),
                    left_hand=(0.6, -0.5, 0.5), claw=85, look=(0.25, -1, 0.4), jaw=42, flutter=2.6, cape_lift=0.7,
                    **reap_kw)
    add('Cast', [(1, reap_a), (12, reap_b), (24, reap_a), (36, reap_b), (48, reap_a)])
    # Hymn: the veil's channel: the scythe planted upright, the left arm wide with the
    # claw spread, the head bowed.
    hy = dict(scythe=(0.0, -0.06, 1.0), face=(0.25, -1.0, 0.0), left_hand=(0.8, -0.2, 0.5),
              left_pole=(1.2, 0.8, -0.3))
    hy_a = stance(grip=(-1.4, -0.8, 3.3), left=(1.95, -0.6, 4.0), claw=55, look=(0, -1, -0.45), jaw=18,
                  flutter=0.5, cape_lift=0.2, **hy)
    hy_b = stance(root=(0, 0, 0.12), grip=(-1.4, -0.8, 3.4), left=(2.05, -0.5, 4.2), claw=70, look=(0, -1, -0.4),
                  jaw=26, flutter=2.0, cape_lift=0.35, **hy)
    add('Hymn', cycle(56, [hy_a, hy_b]))
    # Vanish: he folds into the shroud and sinks through the flags, and stays under.
    fold_kw = dict(lean=0.4, grip=(-1.0, -1.0, 3.2), scythe=(0.1, -0.2, 1.0), face=(0.2, -1.0, 0.0),
                   left=(0.9, -1.1, 3.3), left_hand=(-0.3, -0.5, -0.8), claw=6, look=(0, -1, -0.5), jaw=4)
    fold = stance(root=(0, 0, -0.4), flutter=1.0, splay=0.7, cape_lift=0.4, **fold_kw)
    sink1 = stance(root=(0, 0, -2.6), flutter=2.0, splay=1.0, cape_lift=0.8, **dict(fold_kw, lean=0.5))
    under = stance(root=(0, 0, -10.5), flutter=2.0, splay=1.0, cape_lift=0.8, **dict(fold_kw, lean=0.5))
    add('Vanish', [(1, ready), (6, fold), (12, sink1), (19, under), (58, under)], loop_clip=False)
    # Emerge: up out of the pool, the scythe drawn back over the right shoulder in
    # both hands (the wind-up the reap from behind is thrown off).
    rw = dict(both=True, right_pole=(-1.0, 0.4, -0.6), left_pole=(1.0, 0.1, -0.9))
    windup = stance(root=(0, 0.19, 0.22), yaw=-18, lean=-0.3, twist=-30, side=-0.06, look=(0, -1, 0.35), jaw=30,
                    grip=mg(-0.85, 0.05, 4.55), scythe=(-0.3, 0.55, 0.78), face=(0.0, 0.1, 1.0), flutter=1.4,
                    stream=0.3, cape_lift=0.6, **rw)
    rising = stance(root=(0, 0.1, -3.5), yaw=-10, lean=0.2, twist=-18, look=(0, -1, 0.3), jaw=40,
                    grip=mg(-0.8, -0.3, 4.2), scythe=(-0.25, 0.4, 0.88), face=(0.0, -0.2, 1.0), flutter=2.4,
                    splay=0.6, cape_lift=1.2, **rw)
    add('Emerge', [(1, under), (6, rising), (11, windup), (15, windup)], loop_clip=False)
    # ScytheSweep: the reaping from behind, off that wind-up: a last coil, the
    # diagonal reap brought down across his front to the floor at his left (the
    # contact at frame 4), the follow-through and the recovery.
    r_hold = stance(root=(0, 0.22, 0.24), yaw=-20, lean=-0.32, twist=-33, side=-0.07, look=(0, -1, 0.37), jaw=34,
                    grip=mg(-0.86, 0.1, 4.6), scythe=(-0.3, 0.55, 0.8), face=(0.0, 0.1, 1.0), flutter=2.0,
                    stream=0.3, cape_lift=0.62, **rw)
    r_mid = stance(root=(0, -0.06, 0.02), yaw=-4, lean=0.2, twist=-6, look=(0, -1, 0.1), jaw=40,
                   grip=mg(-0.62, -1.0, 4.1), scythe=(-0.1, -0.75, 0.6), face=(0.6, -0.2, -0.6), stream=0.6,
                   flutter=2.6, **rw)
    r_chop = stance(root=(0, -0.34, -0.36), yaw=12, lean=0.62, twist=20, look=(0.15, -1, -0.3), jaw=44,
                    grip=mg(-0.2, -1.3, 2.9), scythe=(0.45, -0.85, -0.35), face=(0.5, 0.2, -0.8), stream=0.9,
                    flutter=3.0, **rw)
    r_follow = stance(root=(0, -0.36, -0.43), yaw=18, lean=0.68, twist=30, look=(0.2, -1, -0.35), jaw=36,
                      grip=mg(0.0, -1.2, 2.7), scythe=(0.75, -0.55, -0.45), face=(0.3, 0.5, -0.8), stream=0.7,
                      flutter=3.6, **rw)
    r_settle = stance(root=(0, -0.3, -0.34), yaw=14, lean=0.6, twist=24, look=(0.15, -1, -0.3), jaw=26,
                      grip=mg(-0.05, -1.25, 2.8), scythe=(0.65, -0.65, -0.4), face=(0.35, 0.4, -0.8), stream=0.4,
                      flutter=4.2, **rw)
    r_rec = stance(root=(0, -0.1, -0.1), yaw=8, lean=0.25, twist=10, look=(0.1, -1, -0.05), jaw=16,
                   grip=mg(-0.3, -1.05, 3.25), scythe=(0.15, -0.55, 0.85), face=(0.4, -1.0, 0.0), flutter=5.0,
                   **rw)
    add('ScytheSweep', [(1, windup), (2, r_hold), (3, r_mid), (4, r_chop), (7, r_follow), (11, r_settle),
                        (16, r_rec), (22, ready)], loop_clip=False)

    # ------------------------------------------------------------------ hit, death
    g0 = Vector(hold['grip'])
    recoil = rest(0.5, root=(0, 0.36, 0.12), yaw=8, lean=-0.35, side=-0.08, look=(0.25, -0.8, 0.35), jaw=22,
                  cape_lift=0.4, flutter=1.5, grip=tuple(g0 + Vector((-0.1, 0.3, 0.18))), claw=40)
    recoil2 = rest(0.6, root=(0, 0.3, 0.1), yaw=6, lean=-0.28, side=-0.06, look=(0.2, -0.85, 0.3), jaw=18,
                   cape_lift=0.3, flutter=1.8, grip=tuple(g0 + Vector((-0.08, 0.24, 0.14))), claw=30)
    add('Hit', [(1, ready), (4, recoil), (7, recoil2), (13, ready)], loop_clip=False)
    # Death: the shroud gives up its dead: thrown back, it slumps, the skull drops, it
    # folds empty to the flags, the scythe going down with the fist that holds it.
    jolt = rest(0.3, root=(0, 0.2, 0.2), lean=-0.4, look=(0, -0.7, 0.7), jaw=50, cape_lift=0.9,
                grip=tuple(g0 + Vector((-0.2, 0.25, 0.5))), left=(1.7, -0.6, 4.0), left_hand=(0.6, -0.3, 0.6),
                claw=80)
    sag = stance(root=(0, 0.1, -0.6), lean=0.7, look=(0.2, -1, -0.8), jaw=40, flutter=1.0, splay=0.5,
                 grip=(-1.0, -1.4, 3.0), scythe=(0.5, -0.6, 0.55), face=(0.0, 0.0, 1.0), left=(1.3, -1.2, 2.9),
                 claw=30)
    heap = stance(root=(0, 0.3, -2.9), lean=0.9, look=(0.3, -0.7, -0.9), jaw=45, flutter=1.0, splay=1.0,
                  cape_lift=-0.2, tilt=-8, grip=(-0.75, -1.7, 2.75), scythe=(0.95, 0.1, -0.08),
                  face=(0.1, -1.0, -0.4), left=(1.2, -1.3, 2.8), left_hand=(0.2, -0.4, -0.6), claw=45)
    add('Death', [(1, ready), (8, jolt), (18, sag), (32, heap), (44, heap)], loop_clip=False)
    return clips


def grip_report(verbose=False):
    """Per clip, the worst wrist bends, grip gaps and the scythe's turn against the fist."""
    by = {}
    for name, f, br, bl, gr, gl, turn in DIAG:
        if verbose:
            print('GRIPKEY', name, f, br, bl, gr, gl, turn)
        w = by.setdefault(name, [0.0, 0.0, 0.0, 0.0, 0.0])
        for i, v in enumerate((br, bl, gr, gl, turn)):
            w[i] = max(w[i], v)
    for name, w in by.items():
        print('GRIP', name, 'wristR', w[0], 'wristL', w[1], 'gapR', w[2], 'gapL', w[3], 'turn', w[4])


if __name__ == '__main__':
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    fast = '--fast' in argv
    new_scene()
    mats = make_materials('cloth', membrane_kind='cloth')
    parts = build_parts()
    mems = build_membranes()
    objects = [pt.to_object(mats) for pt in parts] + [m.to_object(mats) for m in mems]
    body = join(objects, 'VaelReaper')
    print('TRIANGLES', triangles(body))
    if '--nobake' not in argv:
        bake_surface(body, size=512 if fast else 2048, samples=16 if fast else 40)
    arm = build_armature('VaelReaper', BONES)
    bind(body, arm)
    clips = make_clips(arm)
    grip_report('--diag' in argv)
    arm.animation_data.action = bpy.data.actions['Idle']
    # the game measures him half a second into Idle (frame 13); frame 1 for reference
    for frame in (13, 1):
        bpy.context.scene.frame_set(frame)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
        print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3), 'MAXZ', round(max(zs), 3),
              'FRAME', frame)
    if out != '-':
        export(out, arm)
    if '--sheet' in argv:
        setup_preview((0, -0.4, 3.4), 15, ref_x=3.4)
        render_sheet(arm, clips, argv[argv.index('--sheet') + 1], 'reaper')
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
