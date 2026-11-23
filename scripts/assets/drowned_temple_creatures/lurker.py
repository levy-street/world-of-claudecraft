"""The Glimmerscale Lurker: a pale six-legged hunter of the temple shallows,
low and long like a crocodile crossed with a mantis-crab, its back a ridge of
glimmering mother-of-pearl scales.

A long armoured body on six jointed legs, a broad flat head with four glowing
eyes and scissor mandibles, a whip tail tipped with a pearl, and rows of
iridescent scale plates down its back that flash as it gathers to pounce.

Clips: Idle (crouched, the tail flicking, the plates breathing), Walk and Run
(a skittering six-legged gait), Attack (the mandibles), Attack2 (a raking
foreleg), Hit, Death (it flips and curls its legs), Cast (gathering to leap),
Leap (the pounce in flight, legs thrown forward) and Land.
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge
from temple_palette import CYAN, NACRE, NACRE_PINK, PEARL, SILVER

HIDE = (0.74, 0.8, 0.84)
HIDE_D = (0.62, 0.7, 0.78)
UNDER = (0.86, 0.84, 0.78)
CLAW = (0.3, 0.32, 0.4)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Body', 'Root', (0, 0.6, 1.2), (0, -0.6, 1.3)),
    ('Head', 'Body', (0, -1.1, 1.3), (0, -2.3, 1.25)),
    ('Jaw.L', 'Head', (0.3, -2.0, 1.1), (0.15, -2.8, 1.05)),
    ('Tail1', 'Body', (0, 1.3, 1.25), (0, 2.6, 1.35)),
    ('Tail2', 'Tail1', (0, 2.6, 1.35), (0, 4.0, 1.7)),
    ('Leg1.L', 'Body', (0.55, -0.7, 1.15), (1.45, -1.4, 1.65)),
    ('Foot1.L', 'Leg1.L', (1.45, -1.4, 1.65), (1.8, -1.8, 0.0)),
    ('Leg2.L', 'Body', (0.6, 0.1, 1.15), (1.6, 0.1, 1.6)),
    ('Foot2.L', 'Leg2.L', (1.6, 0.1, 1.6), (2.0, 0.1, 0.0)),
    ('Leg3.L', 'Body', (0.55, 0.9, 1.15), (1.45, 1.6, 1.55)),
    ('Foot3.L', 'Leg3.L', (1.45, 1.6, 1.55), (1.8, 2.0, 0.0)),
])


def body():
    p = SeaBody('GlimmerscaleLurker', lichen=0.0, weather=0.15)
    p.on('Body')
    p.blob((0, 0.1, 1.2), (0.75, 1.55, 0.48), HIDE, bulge=0.15)
    p.blob((0, 0.1, 0.95), (0.62, 1.4, 0.25), UNDER)
    # The pearl scale ridge down the back: overlapping plates that glimmer.
    for k in range(9):
        y = -1.0 + k * 0.28
        w = 0.55 - abs(k - 4) * 0.05
        p.blob((0, y, 1.62 - abs(k - 4) * 0.03), (w, 0.22, 0.12), NACRE if k % 2 else NACRE_PINK, pitch=-0.3)
        for s in (-1, 1):
            p.blob((s * (w + 0.1), y + 0.05, 1.45), (0.16, 0.16, 0.08), HIDE_D, roll=s * 0.6)
            p.blob((s * (w + 0.22), y, 1.4), (0.05, 0.05, 0.05), CYAN, mat=GLOW)
    p.on('Head')
    p.blob((0, -1.8, 1.28), (0.62, 0.78, 0.3), HIDE, bulge=0.1)
    p.blob((0, -2.2, 1.18), (0.45, 0.4, 0.2), HIDE_D)
    for s in (-1, 1):
        for k in range(2):
            p.blob((s * (0.28 + k * 0.18), -2.0 + k * 0.28, 1.46), (0.09, 0.09, 0.09), CYAN, mat=GLOW)
        p.cone((s * 0.4, -1.3, 1.5), (s * 0.7, -0.9, 1.85), 0.1, SILVER, sides=4)

    def jaw(s, t):
        p.on('Jaw' + t)
        p.tube([(s * 0.3, -2.0, 1.1), (s * 0.28, -2.5, 1.06), (s * 0.12, -2.85, 1.04)], [0.12, 0.09, 0.03], CLAW,
               sides=6)
        for k in range(3):
            p.cone((s * 0.24, -2.3 - k * 0.15, 1.06), (s * 0.1, -2.33 - k * 0.15, 1.02), 0.03, SILVER, sides=4)

    jaw(1, '.L')
    jaw(-1, '.R')
    p.on('Tail1')
    p.tube([(0, 1.3, 1.25), (0, 2.0, 1.28), (0, 2.6, 1.35)], [0.42, 0.32, 0.26], HIDE, sides=10)
    for k in range(3):
        p.blob((0, 1.5 + k * 0.4, 1.55), (0.25, 0.16, 0.08), NACRE, pitch=-0.3)
    p.on('Tail2')
    p.tube([(0, 2.6, 1.35), (0, 3.3, 1.5), (0, 4.0, 1.75)], [0.26, 0.16, 0.06], HIDE, sides=8)
    p.blob((0, 4.05, 1.78), (0.2, 0.2, 0.2), PEARL, rings=8)
    p.blob((0, 4.05, 1.78), (0.1, 0.1, 0.1), CYAN, mat=GLOW)

    def leg(s, t, i, hip, knee, foot):
        p.on(f'Leg{i}' + t)
        p.tube([(s * hip[0], hip[1], hip[2]), (s * knee[0], knee[1], knee[2])], [0.18, 0.14], HIDE_D, sides=8)
        p.blob((s * knee[0], knee[1], knee[2]), (0.17, 0.17, 0.17), NACRE)
        p.on(f'Foot{i}' + t)
        p.tube([(s * knee[0], knee[1], knee[2]), (s * foot[0], foot[1], foot[2] + 0.12)], [0.13, 0.06], HIDE_D,
               sides=6)
        p.cone((s * foot[0], foot[1], foot[2] + 0.14), (s * foot[0] * 1.05, foot[1] - 0.15, 0.0), 0.07, CLAW,
               sides=4)

    for s, t in ((1, '.L'), (-1, '.R')):
        leg(s, t, 1, (0.55, -0.7, 1.15), (1.45, -1.4, 1.65), (1.8, -1.8, 0.0))
        leg(s, t, 2, (0.6, 0.1, 1.15), (1.6, 0.1, 1.6), (2.0, 0.1, 0.0))
        leg(s, t, 3, (0.55, 0.9, 1.15), (1.45, 1.6, 1.55), (1.8, 2.0, 0.0))
    return p


def clips(arm):
    stand = {'Tail1': [('x', -4)], 'Tail2': [('x', -10)]}

    def idle(ph):
        return merge(stand, {'Body': [('loc', (0, 0, 0.03 * math.sin(ph)))], 'Tail2': [('z', 14 * math.sin(ph))],
                             'Tail1': [('z', 6 * math.sin(ph + 1))], 'Head': [('z', 5 * math.sin(ph * 0.5))],
                             'Jaw.L': [('z', 6 + 6 * math.sin(ph * 2))]})

    author_clip(arm, 'Idle', loop(60, [idle(i / 6 * math.tau) for i in range(6)]))

    def skitter(ph, amp=1.0):
        a = math.sin(ph)
        b = math.sin(ph + math.pi)
        return merge(stand, {
            'Root': [('loc', (0, 0, 0.06 * abs(math.cos(ph)) * amp))],
            'Leg1.L': [('z', 20 * a * amp), ('y', 10 * max(0.0, a))], 'Leg1.R': [('z', 20 * b * amp)],
            'Leg2.L': [('z', 20 * b * amp)], 'Leg2.R': [('z', 20 * a * amp), ('y', -10 * max(0.0, a))],
            'Leg3.L': [('z', 20 * a * amp)], 'Leg3.R': [('z', 20 * b * amp)],
            'Tail1': [('z', 10 * a)], 'Tail2': [('z', -14 * a)], 'Body': [('y', 4 * a)]})

    author_clip(arm, 'Walk', loop(20, [skitter(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(12, [skitter(i / 4 * math.tau, 1.3) for i in range(4)]))
    open_ = merge(stand, {'Jaw.L': [('z', 35)], 'Head': [('x', -10)], 'Body': [('x', -5)]})
    snap = merge(stand, {'Jaw.L': [('z', -12)], 'Head': [('x', 12)], 'Body': [('x', 8)]})
    author_clip(arm, 'Attack', [(1, stand), (7, open_), (10, snap), (20, stand)], loop=False)
    lift = merge(stand, {'Leg1.L!': [('y', 45), ('x', -30)], 'Body': [('y', -8)]})
    rake = merge(stand, {'Leg1.L!': [('y', -10), ('x', 25)], 'Body': [('y', 6)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, lift), (12, rake), (22, stand)], loop=False)
    hit = merge(stand, {'Body': [('x', -10)], 'Head': [('x', -18)], 'Jaw.L': [('z', 25)]})
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (12, stand)], loop=False)
    flip = merge(stand, {'Root': [('y', 170), ('loc', (0, 0, 2.0))], 'Leg1.L': [('y', 40)], 'Leg2.L': [('y', 45)],
                         'Leg3.L': [('y', 40)], 'Foot1.L': [('y', 60)], 'Foot2.L': [('y', 60)],
                         'Foot3.L': [('y', 60)], 'Tail1': [('x', 20)], 'Jaw.L': [('z', 30)]})
    author_clip(arm, 'Death', [(1, stand), (6, hit), (20, flip), (34, flip)], loop=False)
    # Gathering to leap: hunched low, the scale ridge flaring, the tail up.
    gather = merge(stand, {'Root': [('loc', (0, 0.2, -0.35))], 'Body': [('x', 8)], 'Head': [('x', -12)],
                           'Tail1': [('x', -25)], 'Tail2': [('x', -30)], 'Leg1.L': [('y', -12)],
                           'Leg3.L': [('y', 12)], 'Jaw.L': [('z', 25)]})
    author_clip(arm, 'Cast', loop(12, [gather, merge(gather, {'Tail2': [('z', 12)]})]))
    flight = merge(stand, {'Body': [('x', -10)], 'Head': [('x', -6)], 'Leg1.L': [('x', -40), ('y', 20)],
                           'Leg2.L': [('y', 30)], 'Leg3.L': [('x', 35), ('y', 20)], 'Tail1': [('x', 10)],
                           'Tail2': [('x', 15)], 'Jaw.L': [('z', 40)]})
    author_clip(arm, 'Leap', [(1, gather), (6, flight), (18, flight)], loop=False)
    land = merge(stand, {'Root': [('loc', (0, 0, -0.3))], 'Body': [('x', 12)], 'Jaw.L': [('z', -10)],
                         'Leg1.L': [('y', -15)]})
    author_clip(arm, 'Land', [(1, flight), (5, land), (16, stand)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Leap', 'Land']


CREATURE = (BONES, body, clips, 1.2, 9.0)
