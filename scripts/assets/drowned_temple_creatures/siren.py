"""The Moonlit Siren: a sea-priestess of the drowned choir who traded her legs
for the lagoon, rearing twice a man's height on a long serpent tail.

A pale scaled tail trailing behind her, lit by a frill of fins, a slender
blue-white body in a bodice of shells and pearl strands, fin ears, a flowing
mane of moon-silver hair, and a staff of coral topped with a glowing moon
pearl. She calls the tide with her song: wisps of living water rise to it.

Clips: Idle (the tail undulating, hair adrift), Walk and Run (a gliding
slither), Attack (the staff brought down), Attack2 (a raking hand), Hit, Death
(she sinks down onto her coils), Cast (Brine Lash: the staff thrust out),
Sing (Call the Tide: arms flung wide and up, head thrown back in song).
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge
from temple_palette import CORAL, CYAN, MOUTH, NACRE, NACRE_PINK, PEARL, SILVER

SKIN = (0.72, 0.84, 0.9)
SKIN_D = (0.54, 0.66, 0.76)
SCALE = (0.62, 0.64, 0.82)
SCALE_D = (0.42, 0.44, 0.64)
FIN = (0.5, 0.8, 0.9)
HAIR = (0.86, 0.88, 0.98)
HAIR_D = (0.66, 0.68, 0.86)
EYE = (0.4, 0.95, 1.0)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Tail3', 'Root', (0, 3.4, 0.25), (0, 1.5, 0.35)),
    ('Tail2', 'Root', (0, 1.5, 0.35), (0, 0.4, 0.7)),
    ('Tail1', 'Tail2', (0, 0.4, 0.7), (0, 0.0, 1.6)),
    ('Hips', 'Tail1', (0, 0.0, 1.6), (0, 0.0, 2.1)),
    ('Chest', 'Hips', (0, 0.0, 2.1), (0, 0.0, 2.85)),
    ('Head', 'Chest', (0, -0.05, 2.9), (0, -0.1, 3.55)),
    ('Arm.L', 'Chest', (0.42, 0.0, 2.72), (0.62, 0.0, 2.2)),
    ('Fore.L', 'Arm.L', (0.62, 0.0, 2.2), (0.72, -0.15, 1.72)),
    ('Hand.L', 'Fore.L', (0.72, -0.15, 1.72), (0.74, -0.2, 1.5)),
])


def body():
    p = SeaBody('MoonlitSiren', lichen=0.0, weather=0.1)
    # ---- the serpent tail ----------------------------------------------------------
    p.on('Tail3')
    pts3 = [(0.25, 3.5, 0.22), (-0.1, 2.5, 0.28), (0.1, 1.5, 0.35)]
    p.tube(pts3, [0.14, 0.34, 0.46], SCALE, sides=12)
    # The fluke.
    p.tube([(0.25, 3.5, 0.22), (0.9, 4.1, 0.12), (1.3, 4.3, 0.1)], [0.18, 0.12, 0.02], FIN, sides=4, squash=0.2)
    p.tube([(0.25, 3.5, 0.22), (-0.4, 4.1, 0.12), (-0.8, 4.3, 0.1)], [0.18, 0.12, 0.02], FIN, sides=4, squash=0.2)
    p.on('Tail2')
    p.tube([(0.1, 1.5, 0.35), (0, 0.9, 0.48), (0, 0.4, 0.72)], [0.46, 0.5, 0.52], SCALE, sides=12)
    p.on('Tail1')
    p.tube([(0, 0.4, 0.72), (0, 0.12, 1.15), (0, 0.0, 1.62)], [0.52, 0.48, 0.44], SCALE, sides=12)
    # The fin frill down the tail's back and the scale bands down its front.
    for bone, pts in (('Tail3', pts3), ('Tail2', [(0.1, 1.5, 0.35), (0, 0.4, 0.72)]),
                      ('Tail1', [(0, 0.4, 0.72), (0, 0.0, 1.62)])):
        p.on(bone)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            p.tube([(a[0], a[1] + 0.05, a[2] + 0.4), (b[0], b[1] + 0.05, b[2] + 0.4)], [0.16, 0.16], FIN, sides=4,
                   squash=0.15)
            for k in range(3):
                t = (k + 0.5) / 3
                p.blob((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 0.36, a[2] + (b[2] - a[2]) * t),
                       (0.3, 0.1, 0.12), SCALE_D)
                p.blob((a[0] + (b[0] - a[0]) * t + 0.4, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t + 0.1),
                       (0.05, 0.05, 0.05), CYAN, mat=GLOW)
    # ---- the body -----------------------------------------------------------------------
    p.on('Hips')
    p.blob((0, 0.0, 1.85), (0.42, 0.34, 0.32), SCALE)
    # A girdle of shells.
    for k in range(10):
        a = k / 10 * math.tau
        p.blob((math.cos(a) * 0.42, math.sin(a) * 0.34, 2.02), (0.1, 0.1, 0.08), NACRE_PINK if k % 2 else NACRE)
    p.on('Chest')
    p.blob((0, 0.0, 2.45), (0.4, 0.3, 0.4), SKIN)
    for sx in (-1, 1):
        p.blob((sx * 0.16, -0.24, 2.55), (0.16, 0.1, 0.13), NACRE_PINK, roll=sx * 0.3)
    # Pearl strands across the chest.
    for k in range(9):
        t = k / 8
        p.blob((-0.3 + t * 0.6, -0.28 + abs(t - 0.5) * 0.1, 2.72 - math.sin(t * math.pi) * 0.12),
               (0.05, 0.05, 0.05), PEARL)
    p.blob((0, 0.02, 2.82), (0.12, 0.12, 0.14), SKIN)
    p.on('Head')
    p.blob((0, -0.06, 3.15), (0.26, 0.26, 0.3), SKIN, bulge=0.05)
    for s in (-1, 1):
        p.eye((s * 0.1, -0.26, 3.2), 0.07, look=(s * 0.2, -1, 0), color=EYE, glow=True)
        # Fin ears swept back.
        p.tube([(s * 0.24, -0.05, 3.2), (s * 0.42, 0.15, 3.35), (s * 0.5, 0.35, 3.45)], [0.1, 0.07, 0.01], FIN,
               sides=4, squash=0.2)
    p.blob((0, -0.3, 3.05), (0.06, 0.03, 0.03), MOUTH)
    # A crown of coral and a mane of moon-silver hair down the back.
    for k in range(5):
        a = -0.8 + k * 0.4
        p.cone((math.sin(a) * 0.22, 0.02 + math.cos(a) * 0.05, 3.38), (math.sin(a) * 0.35, 0.05, 3.72), 0.05, CORAL,
               sides=4)
    for k in range(11):
        a = math.pi * 0.15 + k / 10 * math.pi * 0.7
        top = (math.cos(a) * 0.24, 0.06 + math.sin(a) * 0.14, 3.35)
        p.kelp(top, 1.3 + 0.2 * (k % 3), (math.cos(a) * 0.25, 0.35), 0.07, HAIR if k % 2 else HAIR_D)

    def arm(s, t):
        p.on('Arm' + t)
        p.tube([(s * 0.42, 0, 2.72), (s * 0.62, 0, 2.2)], [0.09, 0.08], SKIN, sides=8)
        p.on('Fore' + t)
        p.tube([(s * 0.62, 0, 2.2), (s * 0.72, -0.15, 1.74)], [0.08, 0.07], SKIN, sides=8)
        # A fin along each forearm.
        p.tube([(s * 0.66, 0.06, 2.1), (s * 0.78, 0.12, 1.8)], [0.1, 0.02], FIN, sides=4, squash=0.2)
        p.on('Hand' + t)
        p.blob((s * 0.73, -0.18, 1.62), (0.08, 0.07, 0.1), SKIN_D)
        for k in range(3):
            p.cone((s * (0.7 + k * 0.03), -0.24, 1.58), (s * (0.7 + k * 0.03), -0.3, 1.46), 0.02, SKIN_D, sides=4)

    arm(1, '.L')
    arm(-1, '.R')
    # The coral staff in the right hand, crowned with the moon pearl.
    p.on('Hand.R')
    p.tube([(-0.74, -0.2, 0.2), (-0.74, -0.22, 1.6), (-0.76, -0.25, 3.3)], [0.05, 0.05, 0.045], CORAL, sides=6)
    for s in (-1, 1):
        p.tube([(-0.76, -0.25, 3.2), (-0.76 + s * 0.2, -0.25, 3.45), (-0.76 + s * 0.12, -0.25, 3.7)],
               [0.04, 0.03, 0.01], CORAL, sides=4)
    p.blob((-0.76, -0.25, 3.48), (0.16, 0.16, 0.16), SILVER, mat=GLOW)
    return p


def clips(arm):
    stand = {'Arm.L': [('y', -12), ('x', -10)], 'Fore.L': [('x', -20)], 'Arm.R!': [('x', -18)],
             'Fore.R!': [('x', -40)], 'Head': [('x', -4)]}

    def undulate(ph, amp=1.0):
        return merge(stand, {'Tail3': [('z', 10 * math.sin(ph) * amp)], 'Tail2': [('z', -8 * math.sin(ph + 1) * amp)],
                             'Tail1': [('y', 4 * math.sin(ph + 2) * amp)], 'Hips': [('y', -3 * math.sin(ph + 2))],
                             'Chest': [('y', 3 * math.sin(ph + 2.5)), ('x', 2 * math.cos(ph))],
                             'Head': [('z', 5 * math.sin(ph * 0.5))]})

    author_clip(arm, 'Idle', loop(64, [undulate(i / 6 * math.tau) for i in range(6)]))
    author_clip(arm, 'Walk', loop(28, [undulate(i / 4 * math.tau, 2.0) for i in range(4)]))
    author_clip(arm, 'Run', loop(18, [merge(undulate(i / 4 * math.tau, 2.6), {'Tail1': [('x', 12)],
                                                                              'Chest': [('x', 10)]})
                                      for i in range(4)]))
    raise_ = merge(stand, {'Arm.R!': [('x', -160)], 'Fore.R!': [('x', -10)], 'Chest': [('x', -10), ('z', 15)]})
    strike = merge(stand, {'Arm.R!': [('x', -60)], 'Fore.R!': [('x', -5)], 'Chest': [('x', 14), ('z', -12)],
                           'Tail1': [('x', 10)]})
    author_clip(arm, 'Attack', [(1, stand), (9, raise_), (13, strike), (26, stand)], loop=False)
    reach = merge(stand, {'Arm.L': [('x', -95), ('z', 25)], 'Fore.L': [('x', -5)], 'Chest': [('z', 18)]})
    rake = merge(stand, {'Arm.L': [('x', -70), ('z', -30)], 'Fore.L': [('x', -20)], 'Chest': [('z', -20)]})
    author_clip(arm, 'Attack2', [(1, stand), (7, reach), (11, rake), (22, stand)], loop=False)
    hit = merge(stand, {'Chest': [('x', -14)], 'Head': [('x', -20)], 'Tail1': [('x', -8)]})
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (14, stand)], loop=False)
    sink = merge(stand, {'Tail1': [('x', 55)], 'Hips': [('x', 20)], 'Chest': [('x', 15), ('y', 15)],
                         'Head': [('x', 20), ('y', 20)], 'Arm.L': [('x', 30)], 'Arm.R!': [('x', 20)],
                         'Root': [('loc', (0, 0, -0.1))]})
    author_clip(arm, 'Death', [(1, stand), (6, hit), (22, sink), (36, sink)], loop=False)
    thrust = merge(stand, {'Arm.R!': [('x', -95)], 'Fore.R!': [('x', -5)], 'Chest': [('x', 8)],
                           'Arm.L': [('x', -60), ('y', -30)]})
    author_clip(arm, 'Cast', loop(18, [thrust, merge(thrust, {'Head': [('x', -8)]})]))
    # Call the Tide: arms flung wide and up, head back, chest lifted, singing.
    sing = merge(stand, {'Arm.L': [('x', -140), ('y', -60)], 'Fore.L': [('x', -10)], 'Arm.R!': [('x', -170)],
                         'Fore.R!': [('x', 0)], 'Chest': [('x', -14)], 'Head': [('x', -30)],
                         'Tail1': [('x', -6)], 'Root': [('loc', (0, 0, 0.15))]})
    sing_b = merge(sing, {'Chest': [('y', 5)], 'Head': [('y', -6)], 'Arm.L': [('y', -8)]})
    author_clip(arm, 'Sing', loop(24, [sing, sing_b]))
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Sing']


CREATURE = (BONES, body, clips, 1.8, 8.0)
