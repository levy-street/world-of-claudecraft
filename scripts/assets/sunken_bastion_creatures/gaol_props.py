"""The Sunken Bastion's encounter bodies: the Gaol Turnkey's Iron Cage and Gaoler
Ossick's Drowned Anchor, modelled and rigged in Blender from code.

  blender -b --factory-startup --python gaol_props.py -- cage   <out.glb> [--sheet dir] [--blend out.blend] [--fast]
  blender -b --factory-startup --python gaol_props.py -- anchor <out.glb> [--sheet dir] [--blend out.blend] [--fast]

Both are sea-rotted wrought iron on the organic kit's baked 'iron' surface
(pitting and rust blooms over painted iron and rust), crusted with barnacles and
hung with kelp, and both are hittable bodies in the game (the group smashes the
cage's bars and breaks the anchor's chain), so their idle is alive:

  The Iron Cage: a gibbet cage a player stands inside (about 2.4 across, 3.6
  to the dome), twelve square bars bitten into the flags by spiked feet, three
  hoop bands, a riveted door with a heavy padlock, a domed crown with a lifting
  ring, and a length of snapped chain trailing up off the crown (it dropped
  from the gaol's gibbet crane). Clips: Idle (the chain swings and settles),
  Hit (the bars rattle).
  The Drowned Anchor: a great barnacled ship's anchor (about 4.3 tall) with its
  timber stock, curved arms and spade flukes, the ring at the crown and a few
  links of chain. Clips: Idle (the links sway), Hit (it shudders).

Conventions are organic_kit's: yards, +Z up, facing -Y, one bone per rigid part.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'hollow_crypt_creatures')))
from mathutils import Vector  # noqa: E402
from organic_kit import (  # noqa: E402
    GLOW, Part, Rig, bake_surface, bind, build_armature, clip, cycle, expand_bones, export, join,
    make_materials, new_scene, render_sheet, setup_preview, triangles,
)

IRON = (0.24, 0.23, 0.23)
IRON_D = (0.14, 0.13, 0.13)
IRON_HI = (0.36, 0.34, 0.32)
RUST = (0.46, 0.22, 0.1)
RUST_D = (0.3, 0.13, 0.06)
BARNACLE = (0.78, 0.76, 0.68)
BARNACLE_D = (0.55, 0.53, 0.46)
KELP = (0.16, 0.26, 0.12)
KELP_HI = (0.3, 0.4, 0.18)
WEED = (0.22, 0.34, 0.2)
TIMBER = (0.3, 0.22, 0.15)
TIMBER_D = (0.18, 0.13, 0.09)
BRASS = (0.55, 0.43, 0.2)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def rusty(p, k=0.5):
    """An iron colour a random way toward rust."""
    t = min(1.0, max(0.0, k * p.rng.random() + (1 - k) * 0.25))
    return p.vary(lerp(IRON, RUST, t), 0.08)


def link(p, center, along, flat, length, width, r, color, sides=7):
    """One chain link: a closed stadium tube `length` long along `along`, its
    ring in the plane of `along` and `flat`."""
    c = Vector(center)
    a = Vector(along).normalized()
    f = Vector(flat).normalized()
    f = (f - a * f.dot(a)).normalized()
    half = max(0.0, length / 2 - width / 2)
    pts = []
    n = 7
    for end, sgn in ((half, 1), (-half, -1)):
        for i in range(n + 1):
            ang = math.pi * i / n
            pts.append(c + a * (end + sgn * math.sin(ang) * width / 2) + f * (sgn * math.cos(ang) * width / 2))
    pts.append(pts[0])
    p.tube(pts, [r] * len(pts), color, sides=sides, cap=False)


def barnacles(p, center, radius, count, lift=(0, 0, 1)):
    up = Vector(lift).normalized()
    for _ in range(count):
        d = Vector((p.rng.uniform(-1, 1), p.rng.uniform(-1, 1), p.rng.uniform(-1, 1)))
        d = (d - up * d.dot(up) * 0.5).normalized() * radius * p.rng.uniform(0.4, 1.0)
        base = Vector(center) + d
        s = p.rng.uniform(0.05, 0.11)
        p.prism(base, 6, s, s * 0.45, s * 1.1, p.vary(BARNACLE, 0.12), axis=tuple(up + d * 0.6))
        p.blob(base + up * s * 1.05, (s * 0.7, s * 0.7, s * 0.25), BARNACLE_D, segments=6, rings=4)


def kelp(p, top, length, sway=(0.1, 0.0), width=0.09):
    """A hanging strand of kelp: a flattened ribbon drooping from `top`."""
    t = Vector(top)
    pts = []
    for i in range(7):
        k = i / 6
        pts.append(t + Vector((sway[0] * math.sin(k * 3.1) * k, sway[1] * k + 0.05 * math.sin(k * 5), -length * k)))
    p.tube(pts, [width * (1 - 0.6 * i / 6) for i in range(7)], [lerp(KELP_HI, KELP, i / 6) for i in range(7)],
           sides=5, squash=0.25)


# ============================================================ the Iron Cage
CAGE_R = 1.55       # bar ring radius
CAGE_H = 4.1        # to the dome's shoulder
CHAIN_LINKS = 7

CAGE_BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.5)),
    ('Cage', 'Root', (0, 0, 0.1), (0, 0, CAGE_H)),
    ('Door', 'Cage', (-0.42, -CAGE_R, 0.3), (-0.42, -CAGE_R, 3.4)),
    ('Chain1', 'Cage', (0, 0, CAGE_H + 0.95), (0, 0.05, CAGE_H + 1.9)),
    ('Chain2', 'Chain1', (0, 0.05, CAGE_H + 1.9), (0, 0.12, CAGE_H + 2.85)),
    ('Chain3', 'Chain2', (0, 0.12, CAGE_H + 2.85), (0, 0.2, CAGE_H + 3.7)),
])


def build_cage():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    body = part('CageBody', 'Cage', smooth=True)
    n_bars = 12
    door_a = -math.pi / 2  # the door faces -Y
    # The floor ring (the cage stands open-floored: its prisoner stands on the flags).
    ring_pts = [Vector((math.cos(math.tau * i / 48) * CAGE_R, math.sin(math.tau * i / 48) * CAGE_R, 0.14))
                for i in range(49)]
    body.tube(ring_pts, [0.13] * 49, IRON_D, sides=8, cap=False, squash=0.6)
    # A heavy base plate ring, bolted, the bars' feet seated through it.
    base_pts = [Vector((math.cos(math.tau * i / 48) * (CAGE_R + 0.1), math.sin(math.tau * i / 48) * (CAGE_R + 0.1), 0.05))
                for i in range(49)]
    body.tube(base_pts, [0.16] * 49, rusty(body, 0.5), sides=6, cap=False, squash=0.35)
    for k in range(16):
        a = math.tau * (k + 0.5) / 16
        body.blob((math.cos(a) * (CAGE_R + 0.2), math.sin(a) * (CAGE_R + 0.2), 0.1), (0.09, 0.09, 0.06), IRON_HI,
                  segments=6, rings=4)
    for z in (1.3, 2.7, CAGE_H - 0.05):
        pts = [Vector((math.cos(math.tau * i / 48) * (CAGE_R + 0.02), math.sin(math.tau * i / 48) * (CAGE_R + 0.02), z))
               for i in range(49)]
        body.tube(pts, [0.085] * 49, rusty(body, 0.6), sides=6, cap=False, squash=0.5)
        # Rivets where each bar crosses the band.
        for k in range(n_bars):
            a = math.tau * k / n_bars
            body.blob((math.cos(a) * (CAGE_R + 0.08), math.sin(a) * (CAGE_R + 0.08), z), (0.07, 0.07, 0.07),
                      IRON_HI, segments=6, rings=4)
    # The bars: square section, a little bowed by the sea, spiked feet in the flags.
    for k in range(n_bars):
        a = math.tau * k / n_bars
        if abs(math.atan2(math.sin(a - door_a), math.cos(a - door_a))) < 0.3:
            continue  # the door's own bars ride the Door bone
        ca, sa = math.cos(a), math.sin(a)
        bow = body.rng.uniform(-0.05, 0.08)
        pts = [Vector((ca * (CAGE_R + bow * math.sin(math.pi * t)), sa * (CAGE_R + bow * math.sin(math.pi * t)),
                       0.0 + t * CAGE_H)) for t in (i / 8 for i in range(9))]
        body.tube(pts, [0.075] * 9, [lerp(RUST_D, IRON, t / 8) for t in range(9)], sides=4)
        body.spike((ca * CAGE_R, sa * CAGE_R, 0.02), 0.07, -0.35, IRON_D, sides=4)
    # The dome: eight ribs from the shoulder band to the crown.
    for k in range(8):
        a = math.tau * k / 8 + 0.2
        ca, sa = math.cos(a), math.sin(a)
        pts = [Vector((ca * CAGE_R * math.cos(t * math.pi / 2), sa * CAGE_R * math.cos(t * math.pi / 2),
                       CAGE_H + 0.75 * math.sin(t * math.pi / 2))) for t in (i / 8 for i in range(9))]
        body.tube(pts, [0.08] * 9, rusty(body, 0.7), sides=5)
    # The crown boss and its lifting ring.
    body.blob((0, 0, CAGE_H + 0.78), (0.44, 0.44, 0.26), IRON, segments=10, rings=6)
    link(body, (0, 0, CAGE_H + 1.02), (0, 0, 1), (1, 0, 0), 0.6, 0.44, 0.07, IRON_D)
    # Barnacles and weed on the lower bars and the floor ring (they soaked in the gaol well).
    for k in range(n_bars):
        a = math.tau * k / n_bars + 0.12
        if body.rng.random() < 0.8:
            barnacles(body, (math.cos(a) * CAGE_R, math.sin(a) * CAGE_R, body.rng.uniform(0.15, 1.1)), 0.16, 5)
        if body.rng.random() < 0.6:
            kelp(body, (math.cos(a) * (CAGE_R + 0.08), math.sin(a) * (CAGE_R + 0.08), body.rng.uniform(1.6, 3.2)),
                 body.rng.uniform(1.0, 1.9), sway=(0.16 * math.cos(a), 0.16 * math.sin(a)), width=0.14)
    # The door: two bars, a riveted plate, hinges and the padlock.
    door = part('CageDoor', 'Door', smooth=True)
    for off in (-0.3, 0.3):
        a = door_a + off / CAGE_R
        ca, sa = math.cos(a), math.sin(a)
        door.tube([Vector((ca * CAGE_R, sa * CAGE_R, 0.05 + t * 0.44)) for t in range(9)], [0.08] * 9,
                  rusty(door, 0.4), sides=4)
    door.box((0, -CAGE_R - 0.02, 1.9), (0.85, 0.08, 0.4), rusty(door, 0.6), bevel=0.025)
    for z in (0.8, 3.1):
        door.box((0, -CAGE_R - 0.03, z), (0.82, 0.06, 0.14), IRON_D, bevel=0.02)
    for x in (-0.36, 0.36):
        for z in (0.8, 3.1):
            door.blob((x, -CAGE_R - 0.08, z), (0.08, 0.06, 0.08), IRON_HI, segments=6, rings=4)
    door.box((0.12, -CAGE_R - 0.24, 1.72), (0.46, 0.2, 0.42), IRON, bevel=0.04)         # the padlock body
    door.tube([Vector((0.12 + 0.15 * math.cos(math.pi * t / 6), -CAGE_R - 0.24, 1.93 + 0.22 * math.sin(math.pi * t / 6)))
               for t in range(7)], [0.05] * 7, IRON_HI, sides=6)                        # its shackle
    door.box((0.12, -CAGE_R - 0.35, 1.68), (0.08, 0.02, 0.13), (0.03, 0.03, 0.03))      # the keyhole
    door.box((0.12, -CAGE_R - 0.35, 1.78), (0.14, 0.02, 0.06), BRASS, bevel=0.01)       # its brass escutcheon
    # The snapped chain trailing up off the crown (three bones: it swings).
    for b in range(3):
        cp = part(f'Chain{b + 1}Links', f'Chain{b + 1}', smooth=True)
        h, t = CAGE_BONES[3 + b][2], CAGE_BONES[3 + b][3]
        h, t = Vector(h), Vector(t)
        n = 3
        for i in range(n):
            c = h.lerp(t, (i + 0.5) / n)
            flat = (1, 0, 0) if (i + b) % 2 == 0 else (0, 1, 0)
            link(cp, c, (t - h), flat, 0.46, 0.3, 0.05, rusty(cp, 0.8))
    return parts


def cage_clips(arm):
    rig = Rig(CAGE_BONES).attach(arm)
    P = rig.pose
    clips = []

    def add(name, keys, loop_clip=True):
        clip(arm, name, keys, loop_clip)
        clips.append(name)

    def swing(a, b=0.0, cage=0.0, door=0.0):
        return P(turns={'Chain1': [('x', a), ('y', b)], 'Chain2': [('x', a * 1.5), ('y', -b)],
                        'Chain3': [('x', a * 2.0), ('y', b * 1.3)], 'Cage': [('z', cage)], 'Door': [('z', door)]})

    rest = swing(0)
    # Idle: the snapped chain still swinging from the drop, then settling.
    add('Idle', [(1, swing(24, 8)), (13, swing(-18, -6)), (25, swing(13, 4)), (37, swing(-9, -3)),
                 (49, swing(6, 2)), (61, swing(-4, -1)), (73, swing(2)), (97, rest), (145, swing(1.5, 1)),
                 (193, rest), (241, swing(1, -1)), (265, rest)], loop_clip=False)
    # Hit: the bars rattle on their rivets, the door jumps on its hinge.
    add('Hit', [(1, rest), (3, swing(10, -6, cage=2.5, door=-6)), (5, swing(-8, 5, cage=-2.0, door=5)),
                (8, swing(5, -3, cage=1.0, door=-3)), (12, rest)], loop_clip=False)
    return clips


# ========================================================= the Drowned Anchor
ANCHOR_H = 4.3
ANCHOR_BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.5)),
    ('Anchor', 'Root', (0, 0, 0.1), (0, 0, ANCHOR_H)),
    ('Link1', 'Anchor', (0, 0, ANCHOR_H + 0.55), (0, 0.12, ANCHOR_H + 1.35)),
    ('Link2', 'Link1', (0, 0.12, ANCHOR_H + 1.35), (0, 0.3, ANCHOR_H + 2.15)),
])


def build_anchor():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    a = part('AnchorBody', 'Anchor', smooth=True)
    H = ANCHOR_H
    # The shank: a tapering bar of wrought iron, the crown at its foot on the flags.
    a.tube([Vector((0, 0, z)) for z in (0.4, 1.2, 2.1, 3.0, H - 0.05)], [0.27, 0.24, 0.21, 0.19, 0.18],
           [RUST_D, rusty(a, 0.7), rusty(a, 0.5), IRON, IRON_HI], sides=10, squash=0.8)
    a.blob((0, 0, 0.42), (0.62, 0.5, 0.46), rusty(a, 0.6), segments=12, rings=8)        # the crown
    # The arms: curved up and out, thick at the crown.
    for s in (-1, 1):
        pts = [Vector((s * (0.3 + 1.85 * math.sin(t * math.pi / 2)), 0,
                       0.45 + 1.45 * (1 - math.cos(t * math.pi / 2)))) for t in (i / 10 for i in range(11))]
        a.tube(pts, [0.25 - 0.1 * i / 10 for i in range(11)], [lerp(RUST_D, IRON, i / 10) for i in range(11)],
               sides=10, squash=0.72)
        tip = pts[-1]
        # The fluke: a broad spade plate welded on the arm, and its bill.
        base = pts[6]
        axis = (tip - pts[4]).normalized()
        a.loft([
            (tuple(base - axis * 0.2), 0.08, 0.08, 2.5, tuple(axis)),
            (tuple(base + axis * 0.2), 0.62, 0.11, 3.2, tuple(axis)),
            (tuple(base + axis * 0.6), 0.5, 0.1, 3.2, tuple(axis)),
            (tuple(tip + axis * 0.45), 0.03, 0.03, 2.0, tuple(axis)),
        ], rusty(a, 0.9), sides=14)
        barnacles(a, tuple(base - axis * 0.4), 0.32, 8, lift=(s * 0.3, 0, 1))
        kelp(a, tuple(base + Vector((0, 0.12, 0.1))), 1.2, sway=(s * 0.18, 0.06), width=0.14)
    # The stock: a timber beam through the shank's head, iron-banded.
    a.box((0, 0, H - 0.55), (0.3, 3.1, 0.3), TIMBER, bevel=0.04)
    for y in (-1.3, -0.6, 0.6, 1.3):
        a.box((0, y, H - 0.55), (0.36, 0.1, 0.36), IRON_D, bevel=0.02)
    for y in (-1.58, 1.58):
        a.blob((0, y, H - 0.55), (0.22, 0.16, 0.22), TIMBER_D, segments=8, rings=5)
    # The ring at the crown of the shank.
    link(a, (0, 0, H + 0.22), (0, 0, 1), (1, 0, 0), 0.78, 0.68, 0.09, rusty(a, 0.5), sides=9)
    barnacles(a, (0, 0, 2.4), 0.26, 10)
    barnacles(a, (0, 0, 0.7), 0.5, 12)
    kelp(a, (0.2, 0.12, H - 0.8), 1.5, sway=(0.12, 0.12), width=0.13)
    kelp(a, (-0.16, -0.12, H - 1.3), 1.1, sway=(-0.12, 0.06), width=0.12)
    for b in (1, 2):
        lp = part(f'Link{b}Iron', f'Link{b}', smooth=True)
        h = Vector(ANCHOR_BONES[1 + b][2])
        t = Vector(ANCHOR_BONES[1 + b][3])
        link(lp, h.lerp(t, 0.5), t - h, (0, 1, 0) if b == 1 else (1, 0, 0), 0.86, 0.5, 0.085, rusty(lp, 0.7))
    return parts


def anchor_clips(arm):
    rig = Rig(ANCHOR_BONES).attach(arm)
    P = rig.pose
    clips = []

    def add(name, keys, loop_clip=True):
        clip(arm, name, keys, loop_clip)
        clips.append(name)

    def sway(x, y=0.0, body=0.0):
        return P(turns={'Link1': [('x', x), ('y', y)], 'Link2': [('x', x * 1.6), ('y', -y)],
                        'Anchor': [('x', body)]})

    add('Idle', cycle(72, [sway(8, 4), sway(-6, -3), sway(7, -4), sway(-8, 3)]))
    add('Hit', [(1, sway(0)), (3, sway(14, 6, body=-3)), (6, sway(-10, -4, body=2)), (10, sway(4, 2, body=-1)),
                (14, sway(0))], loop_clip=False)
    return clips


if __name__ == '__main__':
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:]
    which, out = argv[0], argv[1]
    fast = '--fast' in argv
    new_scene()
    mats = make_materials('iron', membrane_kind='iron')
    if which == 'cage':
        parts, bones, make, name, focus = build_cage(), CAGE_BONES, cage_clips, 'IronCage', (0, 0, 2.6)
    else:
        parts, bones, make, name, focus = build_anchor(), ANCHOR_BONES, anchor_clips, 'DrownedAnchor', (0, 0, 2.4)
    objects = [pt.to_object(mats) for pt in parts]
    body = join(objects, name)
    print('TRIANGLES', triangles(body))
    bake_surface(body, size=512 if fast else 1024, samples=16 if fast else 40)
    arm = build_armature(name, bones)
    bind(body, arm)
    clips = make(arm)
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(150)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3))
    export(out, arm)
    if '--sheet' in argv:
        setup_preview(focus, 9, ref_x=2.6)
        render_sheet(arm, clips, argv[argv.index('--sheet') + 1], which)
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
