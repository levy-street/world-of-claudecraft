"""The tavern's dog, asleep on the porch (build_tavern.py calls build(B, parts)): a shaggy brown
farm dog curled nose to tail, its head on its forepaws, one ear flopped, built on its own part
(TavernDog) round its own origin, so the runtime can make it breathe (a slow rise and fall of
its flank, src/render/mirefen_tavern_dog_core.ts) without touching the rest of the model.

Built in the dog's frame: the origin on the porch floor under its middle, +z toward its head,
then turned by LAYOUT['grounds']['dog']['rot'] and set down at its (x, z). About 700 triangles.
"""
import math

COAT = (0.52, 0.34, 0.2)
COAT_DARK = (0.38, 0.24, 0.14)
COAT_LIGHT = (0.8, 0.66, 0.46)
NOSE = (0.12, 0.09, 0.08)


def build(B, parts):
    from mathutils import Matrix
    from shiplib import P, rot_matrix

    p = parts['TavernDog']
    d = B.LAYOUT['grounds']['dog']
    mark = p.mark()
    body(B, p)
    # turn it and set it down on the porch (the frame's origin is where it lies)
    m = Matrix.Translation(P(d['x'], 0.0, d['z'])) @ rot_matrix(yaw=d['rot'])
    p.turn(mark, m)


def body(B, p):
    # the body: one tube curled into a C round the dog's middle, the spine outside (toward -x),
    # the rump at the -z end and the chest at the +z end, open toward +x where the head, the
    # paws and the tail's tip meet
    R = 0.2
    path, radii = [], []
    n = 11
    for k in range(n):
        t = k / (n - 1)
        th = math.radians(-50 - 260 * t)
        path.append((R * math.cos(th), 0.2 + 0.02 * math.sin(math.pi * t), R * math.sin(th)))
        radii.append(0.24 - 0.04 * math.sin(math.pi * t * 1.4) + 0.04 * t * t)

    def coat(i, k):
        # a dark saddle along the spine, a pale belly
        if k in (1, 2):
            return COAT_DARK
        if k in (0, 3):
            return B.scale_color(COAT, 0.95 + 0.06 * (i % 2))
        return B.scale_color(COAT_LIGHT, 0.92)

    p.sweep(path, 0.2, 0.2, COAT, sides=6, radii=radii, squash=0.85, color_fn=coat)
    # the haunch over the rump and the hind paw tucked forward along the belly
    p.rock_blob((0.08, 0.26, -0.3), (0.42, 0.36, 0.4), COAT, B.WOOD, jitter=0.05)
    p.rock_blob((0.3, 0.07, -0.22), (0.3, 0.12, 0.16), COAT_LIGHT, B.WOOD, jitter=0.05)
    # the forepaws stretched out from the chest into the curl
    for dx in (0.0, 0.1):
        p.cylinder((0.1 + dx, 0.07, 0.28), (0.34 + dx, 0.06, 0.12), 0.065, COAT_LIGHT, B.WOOD, sides=6)
    # the head resting on the paws, its muzzle toward the tail
    hx, hy, hz = 0.26, 0.3, 0.16
    p.rock_blob((hx, hy, hz), (0.4, 0.32, 0.38), COAT, B.WOOD, jitter=0.04)
    p.rock_blob((hx + 0.08, hy - 0.07, hz - 0.2), (0.2, 0.16, 0.26), COAT_LIGHT, B.WOOD, jitter=0.04)
    p.box((hx + 0.1, hy - 0.04, hz - 0.33), (0.08, 0.07, 0.05), NOSE, B.WOOD)
    # the closed eyes, dark lines over the muzzle
    for d in (-0.07, 0.07):
        p.box((hx + 0.05 + d, hy + 0.07, hz - 0.1), (0.07, 0.015, 0.02), NOSE, B.WOOD, yaw=0.3)
    # the ears: one pricked and folded, one flopped over the head
    p.box((hx - 0.1, hy + 0.17, hz + 0.05), (0.1, 0.16, 0.06), COAT_DARK, B.WOOD, pitch=0.5, taper=0.4)
    p.box((hx + 0.09, hy + 0.12, hz + 0.07), (0.15, 0.04, 0.13), COAT_DARK, B.WOOD, roll=0.5)
    # the tail from the rump round the front of the curl, its tip by the nose
    tail = [(0.18, 0.2, -0.3), (0.34, 0.14, -0.38), (0.5, 0.08, -0.24), (0.52, 0.06, -0.04), (0.44, 0.05, 0.02)]
    p.sweep(tail, 0.07, 0.03, COAT, sides=5)
    p.rock_blob((0.44, 0.06, 0.02), (0.12, 0.08, 0.12), COAT_LIGHT, B.WOOD, jitter=0.05)
