"""The Mist Chanter: a hunched sea hag who sings the Bastion's fog in.

A bent crone in a weed-green robe under a shawl of old fishing net hung with
cork floats, a hump of barnacled shawl, a long hooked nose over a snaggled
grin, one great yellow eye and one squinting, weed hair to the ground under a
crown of shells, long clawed fingers, and a driftwood staff whose top curls
over into an anglerfish lure glowing sea-green.

Clips: Idle, Walk (a hobble planting the staff), Run (a scuttle), Attack (the
staff brought down), Attack2 (a raking claw), Hit, Death (she folds into a
heap), Cast (Chilling Mist: the lure thrust out, the free hand pushing the
cold), Ward (Fog Ward: the staff raised high, the free hand circling).
"""
import math

from sea_kit import (
    BARNACLE, GLOW, KELP, KELP_D, MOUTH, TOOTH, SeaBody, author_clip, expand_bones, loop, merge, over,
)

SKIN = (0.55, 0.66, 0.54)
SKIN_D = (0.4, 0.5, 0.4)
ROBE = (0.3, 0.46, 0.4)
ROBE_D = (0.2, 0.32, 0.28)
SHAWL = (0.42, 0.44, 0.36)
NET = (0.16, 0.14, 0.12)
CORK = (0.86, 0.6, 0.32)
DRIFT = (0.62, 0.55, 0.45)
DRIFT_D = (0.42, 0.36, 0.3)
LURE = (0.5, 1.0, 0.85)
EYE_Y = (1.0, 0.85, 0.25)
CLAW = (0.2, 0.18, 0.15)
SHELL = (0.95, 0.8, 0.72)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Hips', 'Root', (0, 0.05, 0.95), (0, 0.1, 1.3)),
    ('Spine', 'Hips', (0, 0.1, 1.3), (0, 0.0, 1.65)),
    ('Chest', 'Spine', (0, 0.0, 1.65), (0, -0.2, 1.9)),
    ('Head', 'Chest', (0, -0.22, 1.9), (0, -0.55, 2.3)),
    ('Jaw', 'Head', (0, -0.45, 1.86), (0, -0.7, 1.8)),
    ('Arm.L', 'Chest', (0.42, -0.05, 1.8), (0.55, -0.1, 1.36)),
    ('Fore.L', 'Arm.L', (0.55, -0.1, 1.36), (0.6, -0.15, 0.94)),
    ('Hand.L', 'Fore.L', (0.6, -0.15, 0.94), (0.6, -0.2, 0.66)),
    ('Thigh.L', 'Hips', (0.2, 0.05, 0.92), (0.22, 0.0, 0.5)),
    ('Shin.L', 'Thigh.L', (0.22, 0.0, 0.5), (0.22, 0.05, 0.12)),
])


def sides(fn):
    for s, tag in ((1, '.L'), (-1, '.R')):
        fn(s, tag)


def body():
    p = SeaBody('MistChanter', lichen=0.0, weather=0.25)

    def leg(s, t):
        p.on('Thigh' + t)
        p.tube([(s * 0.2, 0.05, 0.95), (s * 0.22, 0.0, 0.5)], [0.16, 0.13], ROBE_D, sides=8)
        p.on('Shin' + t)
        p.tube([(s * 0.22, 0.0, 0.5), (s * 0.22, 0.05, 0.14)], [0.1, 0.09], SKIN_D, sides=8)
        # A webbed, clawed foot.
        p.blob((s * 0.22, -0.12, 0.07), (0.16, 0.26, 0.07), SKIN_D, flat_bottom=True)
        for k in (-1, 0, 1):
            p.cone((s * 0.22 + k * 0.08, -0.36, 0.06), (s * 0.22 + k * 0.1, -0.48, 0.02), 0.035, CLAW, sides=4)

    sides(leg)
    # ---- the robe: a tattered bell, the net shawl and its floats ------------------
    p.on('Hips')
    p.tube([(0, 0.08, 1.3), (0, 0.08, 1.0), (0, 0.08, 0.6), (0, 0.1, 0.25)], [0.4, 0.5, 0.6, 0.66], ROBE,
           sides=18, cap=False)
    for k in range(16):
        a = k / 16 * math.tau
        ln = 0.18 + 0.14 * ((k * 7) % 3) / 2
        p.tube([(math.cos(a) * 0.64, 0.1 + math.sin(a) * 0.64, 0.28), (math.cos(a) * 0.7, 0.1 + math.sin(a) * 0.7,
                                                                      0.28 - ln)],
               [0.1, 0.03], ROBE_D, sides=4, squash=0.4)
    for k in range(8):
        a = k / 8 * math.tau
        pts = [(math.cos(a + t * 0.5) * (0.42 + t * 0.24), 0.08 + math.sin(a + t * 0.5) * (0.42 + t * 0.24),
                1.25 - t * 0.95) for t in [i / 6 for i in range(7)]]
        p.tube(pts, [0.018] * 7, NET, sides=4, cap=False)
    for k in range(7):
        a = k / 7 * math.tau + 0.3
        p.blob((math.cos(a) * 0.62, 0.08 + math.sin(a) * 0.62, 0.62), (0.08, 0.08, 0.11), CORK)
    p.on('Spine')
    p.blob((0, 0.05, 1.45), (0.42, 0.36, 0.28), ROBE)
    p.on('Chest')
    # The hunched back under a barnacled net shawl.
    p.blob((0, 0.1, 1.72), (0.52, 0.48, 0.38), SHAWL, bulge=0.3)
    for k in range(9):
        a = k / 9 * math.pi
        p.barnacle((math.cos(a) * 0.25, 0.3 + math.sin(a) * 0.15, 2.02), (0, 0.5, 1), 0.07, p.vary(BARNACLE, 0.08))
    for k in range(6):
        a = k / 6 * math.pi
        p.tube([(math.cos(a) * 0.5, 0.1 + math.sin(a) * 0.4, 1.9), (math.cos(a) * 0.55, 0.12 + math.sin(a) * 0.45,
                                                                     1.4)], [0.018, 0.018], NET, sides=4)
    # A necklace of shells and fish bones.
    for k in range(7):
        a = math.pi * (0.15 + k / 6 * 0.7)
        p.blob((math.cos(a) * 0.3, -0.25 - math.sin(a) * 0.08, 1.7 - math.sin(a) * 0.12), (0.06, 0.03, 0.06), SHELL)

    def arm(s, t):
        p.on('Arm' + t)
        p.blob((s * 0.42, -0.05, 1.8), (0.16, 0.16, 0.14), SHAWL)
        p.tube([(s * 0.42, -0.05, 1.8), (s * 0.55, -0.1, 1.36)], [0.12, 0.1], ROBE, sides=8)
        p.on('Fore' + t)
        p.tube([(s * 0.55, -0.1, 1.36), (s * 0.6, -0.15, 0.98)], [0.14, 0.07], ROBE_D, sides=8)
        p.tube([(s * 0.6, -0.15, 1.05), (s * 0.6, -0.16, 0.92)], [0.07, 0.07], SKIN_D, sides=6)
        p.on('Hand' + t)
        p.blob((s * 0.6, -0.18, 0.84), (0.1, 0.09, 0.11), SKIN)
        for k in range(4):
            x = s * (0.53 + k * 0.045)
            p.tube(p.bezier((x, -0.22, 0.8), (x, -0.32, 0.66), (x, -0.25, 0.54), 4), [0.03, 0.015], SKIN_D,
                   sides=5)
            p.cone((x, -0.25, 0.55), (x, -0.2, 0.48), 0.018, CLAW, sides=4)

    sides(arm)
    # ---- the head: hooked nose, snaggled grin, one great eye, weed hair ----------------
    p.on('Head')
    p.blob((0, -0.42, 2.08), (0.36, 0.34, 0.36), SKIN)
    p.blob((0, -0.62, 1.98), (0.2, 0.12, 0.08), MOUTH)
    p.tube(p.bezier((0, -0.72, 2.12), (0, -0.98, 2.05), (0, -0.9, 1.84), 6), [0.09, 0.03], SKIN_D, sides=8)
    p.blob((0.03, -0.9, 1.95), (0.035, 0.035, 0.035), BARNACLE)
    p.cone((-0.08, -0.66, 1.99), (-0.08, -0.69, 1.9), 0.03, TOOTH, sides=4)
    p.cone((0.09, -0.66, 1.99), (0.09, -0.69, 1.91), 0.025, TOOTH, sides=4)
    p.eye((-0.15, -0.66, 2.2), 0.13, look=(-0.2, -1, -0.1), pupil=0.45, iris=EYE_Y)
    p.blob((-0.15, -0.66, 2.33), (0.16, 0.12, 0.05), SKIN_D, roll=-0.3)
    p.blob((0.16, -0.7, 2.2), (0.08, 0.05, 0.03), (0.1, 0.08, 0.06))
    p.blob((0.16, -0.7, 2.25), (0.12, 0.08, 0.05), SKIN_D, roll=0.25)
    # Weed hair to the ground, a crown of scallop shells on top.
    for k in range(18):
        a = math.pi * (0.05 + k / 17 * 0.9)
        x = math.cos(a) * 0.36
        y = -0.3 + math.sin(a) * 0.3
        p.kelp((x, y, 2.36), 0.9 + 0.35 * (k % 3), (math.cos(a) * 0.2, 0.25), 0.07, KELP if k % 2 else KELP_D)
    for k in range(5):
        a = math.pi * (0.2 + k / 4 * 0.6)
        p.blob((math.cos(a) * 0.26, -0.42 + math.sin(a) * 0.08, 2.43), (0.1, 0.03, 0.1), SHELL, pitch=-0.3,
               yaw=math.cos(a) * 0.6)
    p.on('Jaw')
    p.blob((0, -0.6, 1.86), (0.2, 0.14, 0.09), SKIN)
    p.cone((0, -0.72, 1.82), (0, -0.78, 1.72), 0.05, SKIN_D, sides=6, smooth=True)
    # ---- the driftwood staff and its lure --------------------------------------------
    p.on('Hand.R')
    # Modelled level along the fist's forward axis, stood upright by the stance.
    p.tube([(-0.6, 0.6, 0.84), (-0.6, -1.0, 0.86), (-0.6, -2.3, 0.82)], [0.07, 0.06, 0.055], DRIFT, sides=7)
    for k in range(3):
        y = -0.4 - k * 0.6
        p.blob((-0.6, y, 0.86), (0.08, 0.09, 0.08), DRIFT_D)
    # The lure stalk curling over the top (on the side that faces forward in
    # the stance) and its glowing bulb.
    lure = p.bezier((-0.6, -2.3, 0.82), (-0.6, -2.75, 0.8), (-0.6, -2.7, 0.4), 7)
    p.tube(lure, [0.05, 0.025], DRIFT_D, sides=6)
    p.blob((-0.6, -2.62, 0.28), (0.14, 0.14, 0.16), LURE, mat=GLOW)
    p.blob((-0.6, -2.62, 0.28), (0.2, 0.2, 0.08), (0.2, 0.5, 0.45))
    p.kelp((-0.6, -2.2, 0.8), 0.35, (0.05, 0), 0.05, KELP)
    return p


def clips(arm):
    stand = {'Arm.R': [('x', -20)], 'Fore.R': [('x', -50)], 'Arm.L': [('x', -15), ('y', -10)],
             'Fore.L': [('x', -35)], 'Spine': [('x', 12)], 'Head': [('x', -8)]}
    sway = merge(stand, {'Chest': [('z', 5)], 'Head': [('y', 8), ('z', 8)], 'Jaw': [('x', 12)],
                         'Hand.L': [('x', -20)], 'Spine': [('y', 3)]})
    sway_b = merge(stand, {'Chest': [('z', -5)], 'Head': [('y', -6)], 'Hand.L': [('x', 10)]})
    author_clip(arm, 'Idle', loop(72, [stand, sway, stand, sway_b]))

    def hobble(ph, amp=1.0):
        a = math.sin(ph)
        return merge(stand, {
            'Hips': [('loc', (0, 0, -0.05 * abs(math.cos(ph)) * amp)), ('z', -5 * a), ('y', 4 * a)],
            'Spine': [('z', 4 * a)], 'Head': [('y', -5 * a)], 'Jaw': [('x', 8)],
            'Thigh.L': [('x', -24 * a * amp)], 'Thigh.R': [('x', 24 * a * amp)],
            'Shin.L': [('x', 30 * max(0.0, a) * amp)], 'Shin.R': [('x', 30 * max(0.0, -a) * amp)],
            # The staff planted and lifted with the right leg.
            'Arm.R': [('x', 12 * a * amp)], 'Arm.L': [('x', -14 * a * amp)],
        })

    author_clip(arm, 'Walk', loop(30, [hobble(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(18, [hobble(i / 4 * math.tau, 1.5) for i in range(4)]))
    lift = over(stand, {'Arm.R': [('x', -140)], 'Fore.R': [('x', -30)], 'Spine': [('x', -6)],
                        'Head': [('x', -18)], 'Jaw': [('x', 25)]})
    whack = over(stand, {'Arm.R': [('x', -70)], 'Fore.R': [('x', 20)], 'Spine': [('x', 26)], 'Chest': [('x', 10)]})
    author_clip(arm, 'Attack', [(1, stand), (10, lift), (14, whack), (28, stand)], loop=False)
    rake_up = over(stand, {'Arm.L': [('x', -110), ('y', -40)], 'Fore.L': [('x', -30)], 'Chest': [('z', 25)]})
    rake = over(stand, {'Arm.L': [('x', -60), ('y', 30)], 'Fore.L': [('x', -10)], 'Chest': [('z', -25)],
                        'Jaw': [('x', 30)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, rake_up), (12, rake), (24, stand)], loop=False)
    author_clip(arm, 'Hit', [(1, stand), (4, merge(stand, {'Spine': [('x', -14)], 'Head': [('x', -20), ('y', 14)],
                                                            'Jaw': [('x', 25)]})), (15, stand)], loop=False)
    heap = merge(stand, {'Root': [('loc', (0, 0, -0.55))], 'Thigh.L': [('x', -80)], 'Thigh.R': [('x', -70)],
                         'Shin.L': [('x', 90)], 'Shin.R': [('x', 90)], 'Spine': [('x', 35)], 'Chest': [('x', 20)],
                         'Head': [('x', 30), ('y', 20)], 'Arm.R': [('x', 40)], 'Arm.L': [('y', 30)]})
    slump = merge(heap, {'Root': [('y', 70), ('loc', (0.2, 0, -0.1))]})
    author_clip(arm, 'Death', [(1, stand), (10, heap), (22, slump), (34, slump)], loop=False)
    # Chilling Mist: the lure thrust at the target, the free hand pushing.
    thrust = over(stand, {'Arm.R': [('x', -75)], 'Fore.R': [('x', 10)], 'Arm.L': [('x', -80), ('y', 15)],
                          'Fore.L': [('x', -15)], 'Spine': [('x', 18)], 'Head': [('x', -10)], 'Jaw': [('x', 30)]})
    gather = over(stand, {'Arm.R': [('x', -40)], 'Fore.R': [('x', -50)], 'Arm.L': [('x', -40), ('y', -30)],
                          'Fore.L': [('x', -70)], 'Spine': [('x', 4)], 'Jaw': [('x', 14)]})
    author_clip(arm, 'Cast', loop(24, [gather, thrust]))
    # Fog Ward: the staff raised high, the free hand circling over an ally.
    high = over(stand, {'Arm.R': [('x', -165), ('y', 10)], 'Fore.R': [('x', -15)], 'Spine': [('x', -10)],
                        'Chest': [('x', -8)], 'Head': [('x', -25)], 'Jaw': [('x', 35)]})
    circ = [merge(high, {'Arm.L': [('x', -90 + 30 * math.sin(k / 4 * math.tau)), ('y', -20 * math.cos(k / 4 * math.tau))],
                         'Fore.L': [('x', -30)]}) for k in range(4)]
    author_clip(arm, 'Ward', loop(28, circ))
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Ward']


CREATURE = (BONES, body, clips, 1.4, 8.0)
