"""The Tideglass Colossus: the temple's great moon-lens made to walk, a giant of
pearl stone blocks with a faceted prism of tideglass for a heart.

Built, not born: coursed pearl masonry for a body, bronze bands, a head that
is a crystal crown with one cold violet eye, shards of tideglass jutting from
its shoulders and spine, and in its chest the prism, blazing silver-violet,
that shows every intruder a hostile image of themselves. It never leaves its
plinth; it turns to face you and brings its fists down.

Clips: Idle (a slow grinding breath, the prism pulsing), Walk and Run (a
ponderous step on the spot), Attack (a hammer fist), Attack2 (a backhand),
Hit, Death (it cracks down the middle and topples in pieces), Cast, Flare (the
arms thrown wide, the chest pushed out: the prism floods the terrace), Lance
(one arm levelled, the prism aimed down it) and Slam (both fists raised high
and brought down on the terrace).
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge
from temple_palette import NACRE, PEARL, PEARL_D, SILVER, VIOLET

GLASS_BLUE = (0.66, 0.8, 0.98)
BRONZE = (0.5, 0.42, 0.28)
SEAM = (0.3, 0.32, 0.4)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Pelvis', 'Root', (0, 0, 3.0), (0, 0, 3.8)),
    ('Torso', 'Pelvis', (0, 0, 3.8), (0, 0, 6.6)),
    ('Head', 'Torso', (0, -0.2, 6.9), (0, -0.3, 8.2)),
    ('Arm.L', 'Torso', (2.3, 0, 6.1), (2.9, -0.2, 4.3)),
    ('Fore.L', 'Arm.L', (2.9, -0.2, 4.3), (3.0, -0.6, 2.4)),
    ('Thigh.L', 'Pelvis', (1.0, 0, 3.0), (1.1, 0, 1.6)),
    ('Shin.L', 'Thigh.L', (1.1, 0, 1.6), (1.1, 0, 0.0)),
])


def blocks(p, cx, cy, z0, z1, rx, ry, color, courses=4, n=10):
    """A drum of coursed stone blocks (an elliptical ring of blocks per course)."""
    for i in range(courses):
        zc = z0 + (i + 0.5) * (z1 - z0) / courses
        h = (z1 - z0) / courses
        off = 0.5 * (i % 2)
        for k in range(n):
            a = (k + off) / n * math.tau
            x = cx + math.cos(a) * rx
            y = cy + math.sin(a) * ry
            w = math.tau * (rx + ry) / 2 / n
            p.box((x, y, zc), (w * 0.94, 0.5, h * 0.92), p.vary(color, 0.06), yaw=a + math.pi / 2, bevel=0.06)
    p.blob((cx, cy, (z0 + z1) / 2), (rx * 0.92, ry * 0.92, (z1 - z0) * 0.55), SEAM)


def body():
    p = SeaBody('TideglassColossus', lichen=0.0, weather=0.2)

    def leg(s, t):
        p.on('Thigh' + t)
        blocks(p, s * 1.05, 0, 1.7, 3.1, 0.75, 0.7, PEARL_D, courses=2, n=8)
        p.on('Shin' + t)
        blocks(p, s * 1.1, 0, 0.35, 1.7, 0.72, 0.68, PEARL, courses=2, n=8)
        p.box((s * 1.1, -0.25, 0.2), (1.8, 2.2, 0.4), PEARL_D, bevel=0.1)
        p.lathe((s * 1.1, 0, 1.6), [(0.8, 0), (0.8, 0.18)], 16, BRONZE)

    for s, t in ((1, '.L'), (-1, '.R')):
        leg(s, t)
    p.on('Pelvis')
    blocks(p, 0, 0, 3.0, 3.9, 1.5, 1.0, PEARL_D, courses=1, n=12)
    p.on('Torso')
    blocks(p, 0, 0.1, 3.9, 6.8, 2.1, 1.4, PEARL, courses=4, n=14)
    p.lathe((0, 0.1, 3.95), [(2.25, 0), (2.25, 0.25)], 20, BRONZE)
    p.lathe((0, 0.1, 6.55), [(2.25, 0), (2.25, 0.25)], 20, BRONZE)
    # The prism heart set into the chest, blazing, and its bronze cradle.
    p.prism((0, -1.3, 4.6), 6, 0.1, 1.1, 1.3, GLASS_BLUE, mat=GLOW)
    p.prism((0, -1.3, 5.9), 6, 1.1, 0.1, 1.3, VIOLET, mat=GLOW)
    for k in range(6):
        a = k / 6 * math.tau
        p.box((math.cos(a) * 1.25, -1.3 + math.sin(a) * 0.2, 5.25 + math.sin(a) * 1.2), (0.18, 0.3, 0.18), BRONZE)
    # Tideglass shards jutting from the shoulders and spine.
    for k in range(8):
        sx = -1 if k % 2 else 1
        base = (sx * (1.2 + (k % 3) * 0.4), 0.8, 6.2 + (k % 2) * 0.4)
        p.prism(base, 5, 0.35, 0.02, 1.4 + (k % 3) * 0.6, GLASS_BLUE, mat=GLOW,
                axis=(sx * 0.4, 0.5, 1.0))
    p.on('Head')
    # The crystal crown and its one cold eye.
    p.box((0, -0.2, 7.3), (1.4, 1.2, 1.0), PEARL, bevel=0.1)
    p.prism((0, -0.2, 7.8), 6, 0.9, 0.05, 1.6, GLASS_BLUE, mat=GLOW)
    for s in (-1, 1):
        p.prism((s * 0.6, -0.1, 7.7), 5, 0.3, 0.02, 1.0, NACRE, axis=(s * 0.6, 0, 1))
    p.blob((0, -0.82, 7.35), (0.32, 0.08, 0.14), VIOLET, mat=GLOW)

    def arm(s, t):
        p.on('Arm' + t)
        p.blob((s * 2.35, 0.1, 6.2), (0.95, 0.95, 0.8), PEARL, bulge=0.15)
        p.prism((s * 2.6, 0.2, 6.8), 5, 0.4, 0.02, 1.6, GLASS_BLUE, mat=GLOW, axis=(s * 0.5, 0.2, 1.0))
        blocks(p, s * 2.7, -0.1, 4.4, 5.8, 0.55, 0.55, PEARL_D, courses=2, n=7)
        p.on('Fore' + t)
        blocks(p, s * 2.95, -0.4, 3.0, 4.4, 0.6, 0.6, PEARL, courses=2, n=7)
        # The great fist.
        p.box((s * 3.0, -0.65, 2.3), (1.5, 1.5, 1.5), PEARL, bevel=0.2)
        p.lathe((s * 3.0, -0.6, 3.0), [(0.72, 0), (0.72, 0.2)], 12, BRONZE)
        for k in range(3):
            p.box((s * (2.6 + k * 0.4), -1.45, 2.4), (0.34, 0.2, 0.9), PEARL_D, bevel=0.06)

    for s, t in ((1, '.L'), (-1, '.R')):
        arm(s, t)
    p.blob((0, -1.35, 5.25), (0.5, 0.2, 0.5), SILVER, mat=GLOW)
    return p


def clips(arm):
    stand = {'Arm.L': [('x', -6), ('y', -6)], 'Fore.L': [('x', -10)]}

    def breathe(ph):
        return merge(stand, {'Torso': [('x', 1.5 * math.sin(ph)), ('loc', (0, 0, 0.05 * math.sin(ph)))],
                             'Head': [('z', 6 * math.sin(ph * 0.5))], 'Arm.L': [('y', 2 * math.sin(ph))]})

    author_clip(arm, 'Idle', loop(96, [breathe(i / 4 * math.tau) for i in range(4)]))

    def stomp(ph, amp=1.0):
        a = math.sin(ph)
        return merge(stand, {'Root': [('loc', (0, 0, -0.1 * abs(math.cos(ph)) * amp))],
                             'Pelvis': [('z', -6 * a)], 'Torso': [('z', 8 * a)],
                             'Thigh.L': [('x', -18 * a * amp)], 'Thigh.R': [('x', 18 * a * amp)],
                             'Shin.L': [('x', 20 * max(0.0, a) * amp)], 'Shin.R': [('x', 20 * max(0.0, -a) * amp)],
                             'Arm.L': [('x', 10 * a)], 'Arm.R': [('x', -10 * a)]})

    author_clip(arm, 'Walk', loop(44, [stomp(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(30, [stomp(i / 4 * math.tau, 1.2) for i in range(4)]))
    raise_ = merge(stand, {'Arm.R': [('x', -150)], 'Fore.R': [('x', -25)], 'Torso': [('x', -8), ('z', 14)]})
    hammer = merge(stand, {'Arm.R': [('x', -35)], 'Fore.R': [('x', -5)], 'Torso': [('x', 14), ('z', -8)],
                           'Root': [('loc', (0, 0, -0.2))]})
    author_clip(arm, 'Attack', [(1, stand), (12, raise_), (17, hammer), (32, stand)], loop=False)
    wind = merge(stand, {'Arm.L': [('z', 50), ('x', -40)], 'Torso': [('z', 22)]})
    back = merge(stand, {'Arm.L': [('z', -45), ('x', -60)], 'Torso': [('z', -25)]})
    author_clip(arm, 'Attack2', [(1, stand), (10, wind), (16, back), (30, stand)], loop=False)
    hit = merge(stand, {'Torso': [('x', -8)], 'Head': [('x', -12)]})
    author_clip(arm, 'Hit', [(1, stand), (5, hit), (16, stand)], loop=False)
    crack = merge(stand, {'Torso': [('x', -10), ('y', 8)], 'Head': [('x', -25)], 'Arm.L': [('y', -30)],
                          'Arm.R': [('y', 20)]})
    topple = merge(stand, {'Root': [('x', -70), ('loc', (0, -2.8, 1.6))], 'Torso': [('y', 15)],
                           'Head': [('x', 30), ('y', 25)], 'Arm.L': [('x', -60), ('y', -40)],
                           'Arm.R': [('x', 30)], 'Thigh.L': [('x', 20)]})
    author_clip(arm, 'Death', [(1, stand), (12, crack), (22, crack), (44, topple), (56, topple)], loop=False)
    # Flare: arms thrown wide, the chest pushed out, the head back.
    flare = merge(stand, {'Arm.L': [('y', -75), ('x', -20)], 'Fore.L': [('x', -20)], 'Torso': [('x', -14)],
                          'Head': [('x', -22)], 'Root': [('loc', (0, 0, 0.25))]})
    flare_b = merge(flare, {'Torso': [('x', -4)], 'Arm.L': [('y', -8)]})
    author_clip(arm, 'Flare', [(1, stand), (14, flare), (30, flare_b), (48, flare), (56, stand)], loop=False)
    # Lance: the right arm levelled at the victim, the prism aimed down it.
    aim = merge(stand, {'Arm.R': [('x', -90), ('z', -15)], 'Fore.R': [('x', 0)], 'Torso': [('z', -18), ('x', 6)],
                        'Head': [('x', 8)]})
    author_clip(arm, 'Lance', [(1, stand), (10, aim), (40, merge(aim, {'Torso': [('x', 2)]})), (48, aim),
                               (60, stand)], loop=False)
    # Slam: both fists raised high, then brought down on the terrace.
    high = merge(stand, {'Arm.L': [('x', -165)], 'Fore.L': [('x', -20)], 'Torso': [('x', -12)],
                         'Head': [('x', -12)], 'Root': [('loc', (0, 0, 0.3))]})
    down = merge(stand, {'Arm.L': [('x', -45)], 'Fore.L': [('x', -10)], 'Torso': [('x', 22)],
                         'Head': [('x', 15)], 'Root': [('loc', (0, 0, -0.45))], 'Thigh.L': [('x', -25)],
                         'Shin.L': [('x', 35)]})
    author_clip(arm, 'Slam', [(1, stand), (26, high), (36, high), (40, down), (52, down), (64, stand)],
                loop=False)
    author_clip(arm, 'Cast', loop(24, [flare, flare_b]))
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Flare', 'Lance', 'Slam', 'Cast']


CREATURE = (BONES, body, clips, 4.5, 22.0)
