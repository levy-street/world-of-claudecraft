"""The Bastion Warhound: the garrison's war-beast, a shark-headed sea hound.

A heavy four-legged hunter with a blunt shark's head (a gaping jaw with two
rows of teeth, small yellow eyes under a hard brow, gill slits down the
neck), a tall back fin, a slate-blue hide over a pale belly, webbed clawed
paws and an eel's tail ending in a crescent fin. It still wears the Bastion's
rusted spiked war-collar, a length of broken chain and weed hanging from it.

Clips: Idle, Walk, Run (a bounding gallop), Attack (the snapping bite),
Attack2 (the bite-and-thrash), Hit, Death (it rolls onto its side), Cast (a
crouched, jaw-wide snarl), Leap (Lunge: the airborne pounce, held while it
flies) and Land (the impact crouch).
"""
import math

from sea_kit import (
    BARNACLE, KELP, MOUTH, RUST, RUST_D, TOOTH, SeaBody, author_clip, expand_bones, loop, merge,
)

HIDE = (0.36, 0.5, 0.6)
HIDE_D = (0.24, 0.34, 0.43)
HIDE_HI = (0.5, 0.64, 0.72)
BELLY = (0.9, 0.88, 0.8)
GILL = (0.14, 0.1, 0.12)
YELLOW = (1.0, 0.86, 0.2)
CLAW = (0.18, 0.16, 0.15)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.5)),
    ('Hips', 'Root', (0, 1.1, 1.9), (0, 0.2, 2.0)),
    ('Chest', 'Hips', (0, 0.2, 2.0), (0, -0.9, 2.2)),
    ('Neck', 'Chest', (0, -1.0, 2.3), (0, -1.6, 2.5)),
    ('Head', 'Neck', (0, -1.6, 2.5), (0, -2.9, 2.4)),
    ('Jaw', 'Head', (0, -1.85, 2.15), (0, -2.9, 2.0)),
    ('Tail1', 'Hips', (0, 1.8, 2.0), (0, 2.7, 1.95)),
    ('Tail2', 'Tail1', (0, 2.7, 1.95), (0, 3.55, 1.8)),
    ('Tail3', 'Tail2', (0, 3.55, 1.8), (0, 4.3, 1.7)),
    ('Front.L', 'Chest', (0.58, -0.65, 1.75), (0.62, -0.75, 0.95)),
    ('FrontShin.L', 'Front.L', (0.62, -0.75, 0.95), (0.62, -0.85, 0.2)),
    ('FrontPaw.L', 'FrontShin.L', (0.62, -0.85, 0.2), (0.62, -1.25, 0.05)),
    ('Hind.L', 'Hips', (0.6, 1.25, 1.75), (0.66, 1.55, 0.95)),
    ('HindShin.L', 'Hind.L', (0.66, 1.55, 0.95), (0.62, 1.25, 0.2)),
    ('HindPaw.L', 'HindShin.L', (0.62, 1.25, 0.2), (0.62, 0.85, 0.05)),
])


def sides(fn):
    for s, tag in ((1, '.L'), (-1, '.R')):
        fn(s, tag)


def body():
    p = SeaBody('BastionWarhound', lichen=0.0, weather=0.2)
    # ---- the torso: a deep chest, a lean waist, the belly pale ---------------------
    p.on('Chest')
    p.blob((0, -0.45, 2.05), (0.92, 1.15, 0.92), p.vary(HIDE, 0.03), segments=20, rings=12)
    p.blob((0, -0.45, 1.62), (0.72, 0.95, 0.55), BELLY)
    # The back fin: tall, swept back, a paler leading edge.
    p.blob((0, 0.05, 3.1), (0.1, 0.62, 0.95), HIDE_D, pitch=-0.55)
    p.blob((0, -0.18, 3.0), (0.07, 0.25, 0.85), HIDE_HI, pitch=-0.55)
    # Scars and a barnacle cluster on the flank.
    for k in range(4):
        p.tube([(0.9, -0.9 + k * 0.28, 2.35), (0.93, -0.6 + k * 0.28, 2.0)], [0.035, 0.03], HIDE_HI, sides=4)
    for k in range(6):
        a = k / 6 * math.tau
        p.barnacle((-0.86 + 0.05 * math.cos(a), -0.2 + 0.25 * math.cos(a), 2.3 + 0.2 * math.sin(a)),
                   (-1, 0, 0.3), 0.13, p.vary(BARNACLE, 0.08))
    p.on('Hips')
    p.blob((0, 1.0, 1.95), (0.72, 1.0, 0.74), p.vary(HIDE, 0.03), segments=18, rings=10)
    p.blob((0, 1.0, 1.6), (0.55, 0.8, 0.42), BELLY)
    p.blob((0, 1.3, 2.6), (0.06, 0.3, 0.3), HIDE_D, pitch=-0.6)
    # ---- the tail: an eel's tail ending in a crescent fin --------------------------
    for bone, (a, b), (r0, r1) in (
        ('Tail1', ((0, 1.75, 2.0), (0, 2.75, 1.95)), (0.5, 0.36)),
        ('Tail2', ((0, 2.65, 1.95), (0, 3.6, 1.8)), (0.37, 0.22)),
        ('Tail3', ((0, 3.5, 1.8), (0, 4.3, 1.7)), (0.23, 0.1)),
    ):
        p.on(bone)
        p.tube([a, b], [r0, r1], p.vary(HIDE, 0.03), sides=12)
    p.on('Tail3')
    p.blob((0, 4.45, 2.25), (0.06, 0.28, 0.7), HIDE_D, pitch=-0.55)
    p.blob((0, 4.45, 1.3), (0.06, 0.25, 0.5), HIDE_D, pitch=0.6)
    # ---- the neck: gills, the rusted war-collar and its broken chain --------------
    p.on('Neck')
    p.tube([(0, -0.85, 2.2), (0, -1.35, 2.35), (0, -1.75, 2.45)], [0.72, 0.66, 0.6], p.vary(HIDE, 0.03),
           sides=14)
    p.tube([(0, -0.9, 1.85), (0, -1.5, 2.0)], [0.45, 0.4], BELLY, sides=10)
    for s in (1, -1):
        for k in range(4):
            y = -1.1 - k * 0.14
            p.blob((s * 0.62, y, 2.3), (0.05, 0.035, 0.26), GILL, roll=s * 0.2)
    ring = [(math.cos(a) * 0.78, -1.25 + 0.05 * math.sin(a), 2.35 + math.sin(a) * 0.72)
            for a in [i / 24 * math.tau for i in range(25)]]
    p.tube(ring, [0.14] * len(ring), p.vary(RUST, 0.05), sides=8, cap=False)
    for k in range(10):
        a = k / 10 * math.tau
        c = (math.cos(a) * 0.9, -1.25, 2.35 + math.sin(a) * 0.84)
        p.cone(c, (math.cos(a) * 1.22, -1.25, 2.35 + math.sin(a) * 1.15), 0.08, RUST_D, sides=5)
    # A broken chain hanging from the collar ring, weed caught in it.
    for k in range(5):
        z = 1.55 - k * 0.24
        yaw = (k % 2) * math.pi / 2
        link = [(0.13 * math.cos(a) * math.cos(yaw), -1.35 + 0.13 * math.cos(a) * math.sin(yaw),
                 z + 0.16 * math.sin(a)) for a in [i / 10 * math.tau for i in range(11)]]
        p.tube(link, [0.04] * len(link), RUST_D, sides=5, cap=False)
    p.kelp((0.55, -1.3, 1.9), 0.9, (0.2, 0.1), 0.08, KELP)
    # ---- the head: a blunt shark's head, eyes under a hard brow --------------------
    p.on('Head')
    p.blob((0, -2.35, 2.5), (0.74, 1.24, 0.58), p.vary(HIDE, 0.02), pitch=0.06, bulge=0.1)
    p.blob((0, -2.35, 2.28), (0.6, 1.05, 0.3), BELLY)
    # The upper gum and its row of teeth round the snout's U.
    p.blob((0, -2.45, 2.2), (0.52, 0.9, 0.12), MOUTH)
    for k in range(13):
        a = -math.pi * 0.95 + k / 12 * math.pi * 0.9
        x = math.cos(a + math.pi / 2) * 0.46
        y = -2.4 - math.sin(a + math.pi / 2) * 0.0 - (1 - abs(k - 6) / 6) * 0.72
        p.cone((x * (0.4 + 0.6 * abs(k - 6) / 6) / 0.46 * 0.46, y, 2.2), (x * 0.95, y - 0.02, 2.02), 0.07, TOOTH,
               sides=4)
    for s in (1, -1):
        p.eye((s * 0.46, -2.25, 2.72), 0.15, look=(s * 1, -0.5, 0.05), pupil=0.5, iris=YELLOW)
        p.blob((s * 0.42, -2.25, 2.86), (0.2, 0.3, 0.07), HIDE_D, roll=s * 0.3, pitch=0.1)
        # Nostril pits near the snout tip.
        p.blob((s * 0.2, -3.25, 2.48), (0.05, 0.08, 0.03), GILL)
    p.on('Jaw')
    p.blob((0, -2.35, 2.02), (0.55, 0.98, 0.24), BELLY)
    p.blob((0, -2.4, 2.14), (0.46, 0.82, 0.1), MOUTH)
    for k in range(11):
        f = k / 10
        x = (f - 0.5) * 0.8 * (0.5 + 0.5 * abs(f - 0.5) * 2)
        y = -2.3 - (1 - abs(f - 0.5) * 2) * 0.72
        p.cone((x, y, 2.12), (x * 0.95, y - 0.02, 2.3), 0.06, TOOTH, sides=4)

    def legs(s, t):
        p.on('Front' + t)
        p.tube([(s * 0.58, -0.65, 1.9), (s * 0.64, -0.72, 1.35), (s * 0.62, -0.75, 0.95)], [0.44, 0.36, 0.27],
               p.vary(HIDE, 0.03), sides=10)
        # A small pectoral fin at the elbow.
        p.blob((s * 0.82, -0.5, 1.45), (0.05, 0.35, 0.15), HIDE_D, pitch=0.5, yaw=s * 0.3)
        p.on('FrontShin' + t)
        p.tube([(s * 0.62, -0.75, 0.95), (s * 0.62, -0.85, 0.2)], [0.26, 0.21], p.vary(HIDE, 0.03), sides=10)
        p.on('FrontPaw' + t)
        p.blob((s * 0.62, -1.0, 0.13), (0.26, 0.34, 0.13), HIDE_D, flat_bottom=True)
        for k in (-1, 0, 1):
            p.cone((s * 0.62 + k * 0.12, -1.28, 0.1), (s * 0.62 + k * 0.14, -1.45, 0.02), 0.05, CLAW, sides=4)
        p.on('Hind' + t)
        p.tube([(s * 0.6, 1.2, 1.95), (s * 0.68, 1.45, 1.35), (s * 0.66, 1.55, 0.95)], [0.5, 0.4, 0.27],
               p.vary(HIDE, 0.03), sides=10)
        p.on('HindShin' + t)
        p.tube([(s * 0.66, 1.55, 0.95), (s * 0.62, 1.25, 0.2)], [0.25, 0.2], p.vary(HIDE, 0.03), sides=10)
        p.on('HindPaw' + t)
        p.blob((s * 0.62, 1.05, 0.12), (0.24, 0.32, 0.12), HIDE_D, flat_bottom=True)
        for k in (-1, 0, 1):
            p.cone((s * 0.62 + k * 0.11, 0.78, 0.09), (s * 0.62 + k * 0.13, 0.62, 0.02), 0.045, CLAW, sides=4)

    sides(legs)
    return p


def clips(arm):
    stand = {'Tail1': [('z', 4)], 'Head': [('x', 3)]}

    def breathe(k):
        return merge(stand, {'Chest': [('scale', 1 + 0.015 * k)], 'Jaw': [('x', 5 + 6 * k)],
                             'Head': [('z', 8 * k)], 'Tail1': [('z', 10 * k)], 'Tail2': [('z', 12 * k)],
                             'Neck': [('x', -3 * k)]})

    author_clip(arm, 'Idle', loop(56, [breathe(0), breathe(1), breathe(0), breathe(-1)]))

    def walk(ph, amp=1.0):
        a = math.sin(ph)
        b = math.sin(ph + math.pi / 2)
        return merge(stand, {
            'Root': [('loc', (0, 0, 0.05 * abs(b) * amp))],
            'Front.L': [('x', 24 * a * amp)], 'Front.R': [('x', -24 * a * amp)],
            'Hind.L': [('x', -22 * a * amp)], 'Hind.R': [('x', 22 * a * amp)],
            'FrontShin.L': [('x', -18 * max(0, -a) * amp)], 'FrontShin.R': [('x', -18 * max(0, a) * amp)],
            'HindShin.L': [('x', 20 * max(0, a) * amp)], 'HindShin.R': [('x', 20 * max(0, -a) * amp)],
            'Chest': [('z', 4 * a * amp)], 'Hips': [('z', -3 * a * amp)],
            'Tail1': [('z', 14 * b * amp)], 'Tail2': [('z', 16 * a * amp)], 'Tail3': [('z', 18 * b * amp)],
            'Head': [('z', -4 * a), ('x', 3)], 'Jaw': [('x', 6)],
        })

    author_clip(arm, 'Walk', loop(24, [walk(i / 4 * math.tau) for i in range(4)]))

    def gallop(ph):
        a = math.sin(ph)
        return merge(stand, {
            'Root': [('loc', (0, 0, 0.18 * max(0.0, math.sin(ph + 0.6))))],
            'Hips': [('x', 8 * a)], 'Chest': [('x', -10 * a)], 'Neck': [('x', 6 * a)],
            'Front.L': [('x', 45 * a)], 'Front.R': [('x', 40 * a)],
            'Hind.L': [('x', -42 * a)], 'Hind.R': [('x', -38 * a)],
            'FrontShin.L': [('x', -30 * max(0, -a))], 'FrontShin.R': [('x', -30 * max(0, -a))],
            'HindShin.L': [('x', 30 * max(0, a))], 'HindShin.R': [('x', 30 * max(0, a))],
            'Tail1': [('x', -10 * a), ('z', 10 * math.cos(ph))], 'Tail2': [('z', 18 * math.sin(ph + 1))],
            'Tail3': [('z', 22 * math.sin(ph + 2))], 'Jaw': [('x', 14)],
        })

    author_clip(arm, 'Run', loop(14, [gallop(i / 4 * math.tau) for i in range(4)]))
    # The bite: the head draws back, the jaw drops wide, it snaps forward.
    draw = merge(stand, {'Neck': [('x', -14)], 'Head': [('x', -18)], 'Jaw': [('x', 42)], 'Chest': [('x', -4)],
                         'Root': [('loc', (0, 0.2, 0))]})
    snap = merge(stand, {'Neck': [('x', 16)], 'Head': [('x', 12)], 'Jaw': [('x', -2)], 'Chest': [('x', 6)],
                         'Root': [('loc', (0, -0.55, 0))], 'Front.L': [('x', -20)], 'Front.R': [('x', -16)]})
    author_clip(arm, 'Attack', [(1, stand), (8, draw), (12, snap), (22, stand)], loop=False)
    # The bite-and-thrash: jaws clamp, then the head rips left and right.
    clamp = merge(snap, {'Jaw': [('x', 4)]})
    author_clip(arm, 'Attack2', [(1, stand), (7, draw), (10, clamp),
                                 (14, merge(clamp, {'Head': [('z', 28)], 'Neck': [('z', 18)], 'Chest': [('y', 6)]})),
                                 (18, merge(clamp, {'Head': [('z', -28)], 'Neck': [('z', -18)], 'Chest': [('y', -6)]})),
                                 (22, merge(clamp, {'Head': [('z', 18)]})), (30, stand)], loop=False)
    author_clip(arm, 'Hit', [(1, stand), (4, merge(stand, {'Head': [('x', -20), ('z', 14)], 'Chest': [('y', 8)],
                                                            'Jaw': [('x', 24)], 'Root': [('loc', (0, 0.25, 0))]})),
                             (13, stand)], loop=False)
    # Death: it staggers, the legs give, and it rolls onto its side.
    stagger = merge(stand, {'Head': [('x', 20), ('z', -12)], 'Jaw': [('x', 30)], 'Front.L': [('x', -20)],
                            'Root': [('loc', (0, 0, -0.2))]})
    down = merge(stand, {'Root': [('y', 82), ('loc', (0.5, 0, -0.95))], 'Head': [('x', 10), ('z', 10)],
                         'Jaw': [('x', 34)], 'Front.L': [('x', 30)], 'Front.R': [('x', -10)],
                         'Hind.L': [('x', -24)], 'Hind.R': [('x', 16)], 'Tail2': [('z', 20)], 'Tail3': [('z', 26)]})
    author_clip(arm, 'Death', [(1, stand), (8, stagger), (20, down), (30, merge(down, {'Tail3': [('z', 10)]})),
                               (40, down)], loop=False)
    # The snarl before the Lunge: crouched on its haunches, jaws wide, fin up.
    crouch = merge(stand, {'Root': [('loc', (0, 0.2, -0.3))], 'Hips': [('x', -8)], 'Chest': [('x', 10)],
                           'Hind.L': [('x', 24)], 'HindShin.L': [('x', -30)], 'Front.L': [('x', -10)],
                           'Head': [('x', -10)], 'Jaw': [('x', 36)], 'Tail1': [('x', 10)]})
    author_clip(arm, 'Cast', loop(16, [crouch, merge(crouch, {'Jaw': [('x', 26)], 'Head': [('z', 6)]})]))
    # The Lunge in the air: stretched out, forelegs reaching, jaws gaping.
    fly = merge(stand, {'Chest': [('x', -8)], 'Hips': [('x', 6)], 'Front.L': [('x', -62)], 'FrontShin.L': [('x', -15)],
                        'Hind.L': [('x', 55)], 'HindShin.L': [('x', 25)], 'Head': [('x', -6)], 'Jaw': [('x', 48)],
                        'Tail1': [('x', -8)], 'Tail2': [('x', -6)]})
    author_clip(arm, 'Leap', [(1, crouch), (6, fly), (12, fly)], loop=False)
    impact = merge(stand, {'Root': [('loc', (0, 0, -0.35))], 'Chest': [('x', 12)], 'Front.L': [('x', -22)],
                           'FrontShin.L': [('x', 30)], 'Head': [('x', 18)], 'Jaw': [('x', 5)]})
    author_clip(arm, 'Land', [(1, fly), (4, impact), (14, stand)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Leap', 'Land']


CREATURE = (BONES, body, clips, 1.8, 11.0)
