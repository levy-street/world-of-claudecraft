"""The Pearlguard Sentinel: a guardian of pearl and coral the temple grew for
itself, three times a man's height.

A hulking body of nacre plates over a coral frame, pink and red coral
branching from its shoulders and back, a great moon pearl glowing in its open
chest, a dome of a head with a slit visor lit cyan, and two huge club fists
crusted with smaller pearls. When low it closes its shell: the plates slide
over the core and it hunches behind its crossed arms.

Clips: Idle (a slow sway, the core pulsing), Walk and Run (a ponderous
stride), Attack (a hammer fist), Attack2 (a backhand sweep), Hit, Death (it
cracks and slumps into a heap of plates), Cast, Carapace (the arms crossed over
the core, hunched, the shell closed).
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge
from temple_palette import CORAL, CYAN, NACRE, NACRE_PINK, PEARL, PEARL_D, SILVER

CORAL_D = (0.66, 0.26, 0.32)
FRAME = (0.72, 0.5, 0.52)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Hips', 'Root', (0, 0, 1.6), (0, 0, 2.1)),
    ('Chest', 'Hips', (0, 0, 2.1), (0, 0, 3.4)),
    ('Head', 'Chest', (0, -0.1, 3.5), (0, -0.2, 4.3)),
    ('Arm.L', 'Chest', (1.25, 0, 3.1), (1.55, -0.1, 2.2)),
    ('Fore.L', 'Arm.L', (1.55, -0.1, 2.2), (1.6, -0.3, 1.2)),
    ('Thigh.L', 'Hips', (0.55, 0, 1.6), (0.6, 0, 0.8)),
    ('Shin.L', 'Thigh.L', (0.6, 0, 0.8), (0.6, 0, 0.0)),
])


def body():
    p = SeaBody('PearlguardSentinel', lichen=0.0, weather=0.15)

    def leg(s, t):
        p.on('Thigh' + t)
        p.tube([(s * 0.55, 0, 1.65), (s * 0.6, 0, 0.85)], [0.4, 0.36], FRAME, sides=10)
        p.blob((s * 0.58, -0.1, 1.3), (0.44, 0.4, 0.42), PEARL_D, bulge=0.1)
        p.on('Shin' + t)
        p.tube([(s * 0.6, 0, 0.85), (s * 0.6, 0, 0.2)], [0.36, 0.44], FRAME, sides=10)
        p.blob((s * 0.6, -0.15, 0.55), (0.46, 0.4, 0.5), PEARL, bulge=0.1)
        p.blob((s * 0.6, -0.2, 0.15), (0.55, 0.7, 0.22), PEARL_D, flat_bottom=True)

    for s, t in ((1, '.L'), (-1, '.R')):
        leg(s, t)
    p.on('Hips')
    p.blob((0, 0, 1.85), (0.95, 0.7, 0.45), FRAME)
    for k in range(5):
        a = -0.8 + k * 0.4
        p.blob((math.sin(a) * 0.95, -math.cos(a) * 0.6, 1.8), (0.32, 0.18, 0.4), PEARL_D, yaw=a)
    p.on('Chest')
    # The torso: a coral frame round the glowing core, nacre plates over it.
    p.blob((0, 0.15, 2.85), (1.25, 0.95, 0.95), FRAME, bulge=0.1)
    for sx in (-1, 1):
        p.blob((sx * 0.68, -0.45, 2.95), (0.55, 0.3, 0.8), NACRE, roll=sx * 0.35, yaw=-sx * 0.3)
        p.blob((sx * 1.05, 0.1, 3.35), (0.62, 0.58, 0.42), PEARL, bulge=0.2)
    p.blob((0, 0.5, 3.0), (1.05, 0.5, 0.9), NACRE_PINK)
    # The moon pearl heart and its cyan halo ring.
    p.blob((0, -0.62, 2.9), (0.46, 0.4, 0.46), SILVER, mat=GLOW)
    p.tube([(math.cos(a) * 0.58, -0.6, 2.9 + math.sin(a) * 0.58) for a in [i / 16 * math.tau for i in range(17)]],
           [0.06] * 17, CYAN, sides=5, cap=False, mat=GLOW)
    # Coral branching from the shoulders and back.
    for k in range(7):
        sx = -1 if k % 2 else 1
        base = (sx * (0.4 + (k % 3) * 0.25), 0.55, 3.2 + (k % 2) * 0.3)
        tip = (base[0] + sx * 0.4, base[1] + 0.5, base[2] + 1.0 + (k % 3) * 0.3)
        mid = ((base[0] + tip[0]) / 2 + sx * 0.2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2)
        p.tube([base, mid, tip], [0.16, 0.11, 0.04], CORAL if k % 3 else CORAL_D, sides=6)
        p.blob(tip, (0.08, 0.08, 0.08), CYAN, mat=GLOW)
    p.on('Head')
    p.blob((0, -0.15, 3.85), (0.52, 0.5, 0.48), PEARL, bulge=0.2)
    p.blob((0, -0.58, 3.82), (0.32, 0.06, 0.07), CYAN, mat=GLOW)
    p.blob((0, -0.3, 4.25), (0.14, 0.4, 0.2), NACRE_PINK)

    def arm(s, t):
        p.on('Arm' + t)
        p.blob((s * 1.3, 0.05, 3.15), (0.55, 0.55, 0.5), PEARL, bulge=0.15)
        p.tube([(s * 1.3, 0, 3.0), (s * 1.55, -0.1, 2.2)], [0.36, 0.32], FRAME, sides=10)
        p.on('Fore' + t)
        p.tube([(s * 1.55, -0.1, 2.2), (s * 1.6, -0.25, 1.5)], [0.36, 0.42], FRAME, sides=10)
        p.blob((s * 1.6, -0.3, 1.05), (0.62, 0.62, 0.62), PEARL, bulge=0.1)
        for k in range(6):
            a = k / 6 * math.tau
            p.blob((s * 1.6 + math.cos(a) * 0.5, -0.3 + math.sin(a) * 0.5, 1.05 + math.sin(a * 2) * 0.2),
                   (0.16, 0.16, 0.16), NACRE, rings=6)

    for s, t in ((1, '.L'), (-1, '.R')):
        arm(s, t)
    return p


def clips(arm):
    stand = {'Arm.L': [('x', -8), ('y', -6)], 'Fore.L': [('x', -12)], 'Head': [('x', 6)]}

    def idle(ph):
        return merge(stand, {'Chest': [('x', 2 * math.sin(ph)), ('loc', (0, 0, 0.03 * math.sin(ph)))],
                             'Head': [('y', 5 * math.sin(ph * 0.5))], 'Arm.L': [('y', 3 * math.sin(ph))]})

    author_clip(arm, 'Idle', loop(72, [idle(i / 4 * math.tau) for i in range(4)]))

    def stride(ph, amp=1.0):
        a = math.sin(ph)
        return merge(stand, {'Root': [('loc', (0, 0, -0.08 * abs(math.cos(ph)) * amp))],
                             'Hips': [('z', -5 * a)], 'Chest': [('z', 7 * a), ('y', 3 * a)],
                             'Thigh.L': [('x', -24 * a * amp)], 'Thigh.R': [('x', 24 * a * amp)],
                             'Shin.L': [('x', 26 * max(0.0, a) * amp)], 'Shin.R': [('x', 26 * max(0.0, -a) * amp)],
                             'Arm.L': [('x', 18 * a * amp)], 'Arm.R': [('x', -18 * a * amp)]})

    author_clip(arm, 'Walk', loop(36, [stride(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(24, [stride(i / 4 * math.tau, 1.3) for i in range(4)]))
    raise_ = merge(stand, {'Arm.R': [('x', -150)], 'Fore.R': [('x', -30)], 'Chest': [('x', -10), ('z', 12)]})
    smash = merge(stand, {'Arm.R': [('x', -40)], 'Fore.R': [('x', -5)], 'Chest': [('x', 16), ('z', -10)],
                          'Root': [('loc', (0, 0, -0.12))]})
    author_clip(arm, 'Attack', [(1, stand), (10, raise_), (14, smash), (28, stand)], loop=False)
    wind = merge(stand, {'Arm.L': [('z', 55), ('x', -40)], 'Chest': [('z', 25)]})
    sweep = merge(stand, {'Arm.L': [('z', -40), ('x', -60)], 'Chest': [('z', -25)]})
    author_clip(arm, 'Attack2', [(1, stand), (9, wind), (14, sweep), (26, stand)], loop=False)
    hit = merge(stand, {'Chest': [('x', -12)], 'Head': [('x', -16)], 'Arm.L': [('y', -20)]})
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (14, stand)], loop=False)
    kneel = merge(stand, {'Root': [('loc', (0, 0, -0.7))], 'Thigh.L': [('x', -70)], 'Shin.L': [('x', 90)],
                          'Chest': [('x', 25)], 'Head': [('x', 30)], 'Arm.L': [('x', 20)]})
    heap = merge(kneel, {'Root': [('x', 60), ('loc', (0, 1.2, -0.9))], 'Chest': [('x', 30), ('y', 20)],
                         'Head': [('y', 30)], 'Arm.L': [('x', -60)]})
    author_clip(arm, 'Death', [(1, stand), (10, kneel), (26, heap), (38, heap)], loop=False)
    cast = merge(stand, {'Arm.L': [('x', -70), ('y', -30)], 'Chest': [('x', -6)], 'Head': [('x', -8)]})
    author_clip(arm, 'Cast', loop(24, [cast, merge(cast, {'Chest': [('x', -2)]})]))
    # Carapace: arms crossed over the pearl core, hunched, the shell closed.
    shell = merge(stand, {'Arm.L': [('x', -85), ('z', -55)], 'Fore.L': [('z', -60), ('x', -20)],
                          'Chest': [('x', 22)], 'Head': [('x', 25)], 'Root': [('loc', (0, 0, -0.2))]})
    author_clip(arm, 'Carapace', [(1, stand), (8, shell), (40, merge(shell, {'Chest': [('x', 3)]})), (48, shell)],
                loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Carapace']


CREATURE = (BONES, body, clips, 2.2, 11.0)
