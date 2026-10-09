"""The Knellwyrm: the great bone wyrm Morthen's dying rite calls down on the
Hollow Crypt's Rite Ring (src/sim/encounters/hollow_crypt/knellwyrm.ts).

  blender -b --factory-startup --python build_knellwyrm.py -- <out.glb> [--sheet dir] [--blend out.blend] [--fast]

It is the Ossuary Drake's kin, built on the same wyvern skeleton and rig
(build_bone_drake.py) but older and burned: its bones are charred to soot and
ash, pale only where the fire has scoured them, and the rite's ghost fire
burns THROUGH it, green-white in its orbits and its caged ribs and licking up
its spine and tail in a crest of flame. A crown of four great horns sweeps
forward over its brow, and its wings are tattered black leather. The game
raises it a quarter again over the drake (template scale 1.25), so its head
rides some 12 yards up.

Clips: the drake's whole set (Idle, Walk, Run, Fly, Glide, Land, SkyRoar, Roar,
Bite, Bite2, Breath, TailSweep, WingBuffet, Hit, Death) plus its own:
  TakeWing  the Pyre Strafe's bar: it rears, beats its wings and climbs away
            to the lane's start;
  Strafe    the strafing run: level flight, neck plunged, jaws wide, pouring
            fire down the lane;
  Bellow    Dread Bellow: it rears up tall on its legs, wings flung wide and
            high, chest thrust out (the ribs bared), jaws agape, and shudders.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector  # noqa: E402

import build_bone_drake as drake  # noqa: E402
from organic_kit import (  # noqa: E402
    GLOW, bake_surface, bind, build_armature, export, join, make_materials, new_scene, render_sheet,
    setup_preview, triangles,
)

# ------------------------------------------------------------------ palette
# Charred bone, scoured pale at the edges by the fire; a soot-black horn crown;
# ghost fire (green-white, never cyan) burning inside.
CHAR = (0.55, 0.5, 0.44)
CHAR_OLD = (0.4, 0.36, 0.31)
CHAR_DARK = (0.25, 0.22, 0.2)
SOOT_HORN = (0.15, 0.14, 0.13)
HORN_EMBER = (0.5, 0.86, 0.36)
TALON = (0.09, 0.085, 0.08)
LEATHER = (0.17, 0.16, 0.15)
GHOST = (0.62, 1.0, 0.45)
GHOST_HOT = (0.95, 1.0, 0.85)
GHOST_DEEP = (0.14, 0.45, 0.1)


def recolor():
    """Re-palette the drake builder before it runs (module globals are read at
    call time; the default arguments are rebound)."""
    drake.BONE, drake.BONE_OLD, drake.BONE_DARK = CHAR, CHAR_OLD, CHAR_DARK
    drake.HORN, drake.HORN_TIP, drake.CLAW = SOOT_HORN, HORN_EMBER, TALON
    drake.SKIN = LEATHER
    drake.FIRE, drake.FIRE_HOT, drake.EMBER_DEEP = GHOST, GHOST_HOT, GHOST_DEEP
    d = list(drake.long_bone.__defaults__)
    d[0] = CHAR
    drake.long_bone.__defaults__ = tuple(d)
    d = list(drake.vertebra.__defaults__)
    d[-1] = CHAR
    drake.vertebra.__defaults__ = tuple(d)
    d = list(drake.rib.__defaults__)
    d[-1] = CHAR
    drake.rib.__defaults__ = tuple(d)
    d = list(drake.claw.__defaults__)
    d[1] = TALON
    drake.claw.__defaults__ = tuple(d)


def flame(p, base, up, lean, height, r, sides=7):
    """A tongue of ghost fire licking up from `base`: a curling, tapering tube
    on the emissive glow material, hottest at its root."""
    b = Vector(base)
    u = Vector(up).normalized()
    side = Vector(lean)
    pts = drake.bez3(b, b + u * height * 0.35 + side * 0.15, b + u * height * 0.7 - side * 0.2,
                     b + u * height + side * 0.35, 8)
    radii = [r * (1 - (i / 7) ** 0.8) + 0.01 for i in range(8)]
    colors = [drake.lerp(GHOST_HOT, GHOST, min(1, i / 3)) if i < 4 else drake.lerp(GHOST, GHOST_DEEP, (i - 3) / 4)
              for i in range(8)]
    p.tube(pts, radii, colors, sides=sides, mat=GLOW)


def extra_parts(parts):
    """The crown of horns, the spinal flame crest and the brands of fire."""
    Part = drake.Part

    def part(name, bone):
        pt = Part(name, bone)
        parts.append(pt)
        return pt

    crown = part('Crown', 'Head')
    for s in (-1, 1):
        # Two great horns sweeping FORWARD over the brow, then up: a crown.
        drake.horn(crown, drake.bez3((s * 0.4, -5.6, 11.0), (s * 0.9, -6.4, 12.1), (s * 1.0, -7.2, 13.1),
                                     (s * 0.7, -7.6, 14.2), 14), 0.26)
        drake.horn(crown, drake.bez3((s * 0.75, -5.0, 11.1), (s * 1.6, -5.2, 12.3), (s * 2.3, -5.8, 13.0),
                                     (s * 2.6, -6.6, 13.9), 12), 0.2)
        # Ghost fire guttering out of the orbits, trailing back.
        flame(crown, (s * 0.72, -6.6, 10.62), (s * 0.2, 0.8, 0.9), (s * 0.3, 0.4, 0), 1.3, 0.16)
    # The crest: tongues of ghost fire up the spine and down the tail.
    crest = [('Chest', (0, -0.6, 6.7), 1.5), ('Chest', (0, 0.3, 6.6), 1.9), ('Spine', (0, 1.3, 6.35), 1.8),
             ('Spine', (0, 2.3, 6.05), 1.6), ('Pelvis', (0, 3.3, 5.75), 1.4), ('Pelvis', (0, 4.2, 5.5), 1.2)]
    for i, (bone, base, h) in enumerate(crest):
        pt = part(f'Crest{i}', bone)
        flame(pt, base, (0, 0.25, 1), ((-1) ** i * 0.2, 0.3, 0), h, 0.2)
    for k in range(1, 7):
        a, b = Vector(drake.TAIL[k - 1]), Vector(drake.TAIL[k])
        pt = part(f'TailFlame{k}', f'Tail{k}')
        c = a.lerp(b, 0.5) + Vector((0, 0, 0.35 - k * 0.03))
        flame(pt, c, (0, 0.35, 1), ((-1) ** k * 0.15, 0.3, 0), 1.3 - k * 0.12, 0.17 - k * 0.012)
    # The caged soul fire burns bigger and higher than the drake's.
    chest = part('Soulfire', 'Chest')
    chest.blob((0, 0.45, 4.8), (1.0, 1.6, 1.05), GHOST, mat=GLOW, segments=14, rings=9, jitter=0.25)
    chest.blob((0, 0.35, 4.8), (0.5, 0.8, 0.55), GHOST_HOT, mat=GLOW, segments=10, rings=7)
    for i in range(8):
        a = i / 8 * math.tau
        flame(chest, (math.cos(a) * 0.55, 0.4 + math.sin(a) * 1.1, 5.1), (math.cos(a) * 0.3, 0.1, 1),
              (0, 0.2, 0), 1.2 + 0.3 * (i % 2), 0.2)


def extra_clips(h):
    add, stand, flight, roar = h['add'], h['stand'], h['flight'], h['roar']

    # TakeWing: over the 2.5 s bar it rears, beats hard and climbs away.
    def climb(beat, pitch, rootz):
        return flight(beat, False, pitch, rootz)
    add('TakeWing', [(1, stand(0, 0)), (10, roar(20, 0.8)), (18, climb(1.0, -24, 0.8)), (26, climb(-1.0, -20, 1.2)),
                     (34, climb(1.0, -16, 1.4)), (42, climb(-1.0, -12, 1.5)), (50, climb(1.0, -10, 1.5)),
                     (60, climb(-0.6, -8, 1.5))], loop_clip=False)

    # Strafe: level, fast, neck plunged and jaws wide, pouring fire under it.
    def strafe(beat, sweep):
        pose = flight(beat, True, 10)
        dive = h['P'](aims={'Neck1': (0, -0.95, 0.15), 'Neck2': (0, -0.95, -0.05), 'Neck3': (sweep * 0.15, -0.9, -0.3),
                            'Neck4': (sweep * 0.2, -0.85, -0.45), 'Neck5': (sweep * 0.2, -0.75, -0.6),
                            'Head': (sweep * 0.15, -0.55, -0.8)},
                      turns={'Jaw': [('x', 46)]})
        for k in ('Neck1', 'Neck2', 'Neck3', 'Neck4', 'Neck5', 'Head', 'Jaw'):
            pose[k] = dive[k]
        return pose
    add('Strafe', [(1, strafe(0.3, 0)), (8, strafe(0.1, -0.5)), (16, strafe(0.25, 0.5)), (24, strafe(0.1, -0.3)),
                   (33, strafe(0.3, 0))])

    # Bellow: rear up TALL, wings flung wide and high, chest out, jaws agape,
    # a shudder through the whole frame; then it drops back down.
    def bellow(k, shake=0.0):
        pose = roar(46 * k, 1.35 * k)
        wings = flight(1.0, True, -20 * k, rootz=1.9 * k)
        for b in list(pose.keys()):
            if b.startswith(('Humerus', 'Forearm', 'Hand', 'Finger', 'Thumb')):
                pose[b] = wings[b]
        extra = h['P'](aims={}, turns={'Chest': [('x', -12 * k + shake)], 'Neck1': [('z', shake * 2)],
                                       'Head': [('z', -shake * 3)]})
        for b in ('Chest',):
            pose[b] = extra[b]
        return pose
    add('Bellow', [(1, stand(0, 0)), (14, bellow(0.6)), (26, bellow(1.0)), (30, bellow(1.0, 4)),
                   (34, bellow(1.0, -4)), (38, bellow(1.0, 3)), (44, bellow(1.0, -2)), (56, bellow(0.5)),
                   (68, stand(0, 0))], loop_clip=False)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    new_scene()
    recolor()
    mats = make_materials('bone')
    parts, membranes = drake.build_parts()
    extra_parts(parts)
    objects = [pt.to_object(mats) for pt in parts] + [m.to_object(mats) for m in membranes]
    body = join(objects, 'Knellwyrm')
    print('TRIANGLES', triangles(body))
    size = 2048 if '--fast' not in argv else 512
    bake_surface(body, size=size, samples=24 if '--fast' in argv else 48)
    arm = build_armature('Knellwyrm', drake.BONES)
    bind(body, arm)
    clips = drake.make_clips(arm, extend=extra_clips)
    import bpy
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(13)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3))
    print('CLIPS', ','.join(a.name for a in bpy.data.actions))
    export(out, arm)
    if '--sheet' in argv:
        setup_preview((0, -1, 5), 30, ref_x=6.0)
        render_sheet(arm, clips, argv[argv.index('--sheet') + 1], 'knellwyrm')
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
