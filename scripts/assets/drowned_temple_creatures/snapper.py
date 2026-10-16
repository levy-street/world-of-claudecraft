"""The Lagoon Snapper: a temple turtle the size of an ox cart, grown old in the
drowned courts.

A high domed shell of mossy plates rimmed with serrated scutes, pearls and
lily roots grown into its crown, a heavy plated neck, a hooked beak that
snaps like a portcullis, small cold eyes, thick elephantine legs with claws,
and a stub tail. Slow on land; its bite is the thing to fear.

Clips: Idle (breathing, the head swinging on its neck), Walk and Run (a heavy
lumber), Attack (the bite), Attack2 (a stamp of the front foot), Hit, Death
(it rolls onto its side and draws in), Cast and Snap (the neck drawn back into
the shell, then the whole head flung out across its front with the beak wide).
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge
from temple_palette import MOSS, MOSS_D, NACRE, PEARL

SHELL = (0.46, 0.56, 0.44)
SHELL_D = (0.32, 0.4, 0.3)
SCUTE = (0.62, 0.66, 0.5)
SKIN = (0.64, 0.7, 0.58)
SKIN_D = (0.46, 0.52, 0.42)
BEAK = (0.26, 0.24, 0.18)
EYE = (0.85, 0.72, 0.3)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Body', 'Root', (0, 0.2, 1.4), (0, -0.8, 1.5)),
    ('Shell', 'Body', (0, 0.2, 1.8), (0, 0.2, 2.8)),
    ('Neck', 'Body', (0, -1.5, 1.45), (0, -2.4, 1.7)),
    ('Head', 'Neck', (0, -2.4, 1.7), (0, -3.3, 1.75)),
    ('Jaw', 'Head', (0, -2.55, 1.5), (0, -3.35, 1.4)),
    ('Leg1.L', 'Body', (1.05, -0.9, 1.1), (1.35, -1.1, 0.0)),
    ('Leg2.L', 'Body', (1.05, 1.1, 1.1), (1.3, 1.3, 0.0)),
    ('Tail', 'Body', (0, 1.6, 1.2), (0, 2.4, 0.9)),
])


def body():
    p = SeaBody('LagoonSnapper', lichen=0.0, weather=0.3)
    p.on('Body')
    # The plastron and the soft body under the shell.
    p.blob((0, 0.1, 1.05), (1.35, 1.75, 0.45), SKIN_D, flat_bottom=True)
    p.on('Shell')
    # The dome: a high carapace with a serrated rim of scutes.
    p.blob((0, 0.1, 1.55), (1.6, 2.0, 1.25), SHELL, bulge=0.25, rings=12, segments=20)
    for k in range(20):
        a = k / 20 * math.tau
        x, y = math.sin(a) * 1.62, 0.1 + math.cos(a) * 2.02
        p.cone((x * 0.98, y * 0.98, 1.2), (x * 1.12, y * 1.1, 1.0), 0.28, p.vary(SCUTE, 0.08), sides=4)
    # The plates: raised polygons across the dome, mossed.
    for i, (x, y, z) in enumerate([(0, 0.1, 2.75), (0, -1.0, 2.4), (0, 1.2, 2.35), (0.95, -0.4, 2.2),
                                   (-0.95, -0.4, 2.2), (0.95, 0.8, 2.15), (-0.95, 0.8, 2.15)]):
        p.blob((x, y, z), (0.62, 0.62, 0.18), p.vary(SHELL_D if i % 2 else SCUTE, 0.06), roll=x * 0.35,
               pitch=-y * 0.2)
    # Moss hanging in beards, a pearl crown, lily roots.
    for k in range(14):
        a = k / 14 * math.tau
        x, y = math.sin(a) * 1.5, 0.1 + math.cos(a) * 1.9
        p.kelp((x, y, 1.45), 0.5 + 0.2 * (k % 3), (x * 0.05, y * 0.05), 0.12, MOSS if k % 2 else MOSS_D)
    for k in range(5):
        a = k / 5 * math.tau
        p.blob((math.sin(a) * 0.35, 0.1 + math.cos(a) * 0.35, 2.92), (0.18, 0.18, 0.18), NACRE, rings=6)
    p.blob((0, 0.1, 3.05), (0.26, 0.26, 0.26), PEARL, rings=8)
    p.blob((0.4, -0.3, 2.8), (0.5, 0.4, 0.06), (0.24, 0.42, 0.3))
    p.blob((0.45, -0.35, 2.87), (0.1, 0.1, 0.1), (0.95, 0.95, 1.0), mat=GLOW)
    # ---- the neck, head and beak ---------------------------------------------------
    p.on('Neck')
    p.tube([(0, -1.35, 1.45), (0, -1.9, 1.6), (0, -2.45, 1.72)], [0.62, 0.55, 0.5], SKIN, sides=12)
    for k in range(4):
        p.tube([(-0.5, -1.5 - k * 0.25, 1.9), (0, -1.55 - k * 0.25, 2.12), (0.5, -1.5 - k * 0.25, 1.9)],
               [0.08, 0.1, 0.08], SKIN_D, sides=5)
    p.on('Head')
    p.blob((0, -2.85, 1.82), (0.62, 0.72, 0.52), SKIN, bulge=0.1)
    p.blob((0, -3.45, 1.7), (0.34, 0.3, 0.3), BEAK)
    p.cone((0, -3.6, 1.62), (0, -3.72, 1.38), 0.18, BEAK, sides=5)
    for s in (-1, 1):
        p.eye((s * 0.48, -2.9, 2.05), 0.13, look=(s * 0.8, -0.5, 0.2), iris=EYE, pupil=0.45)
        p.blob((s * 0.5, -2.85, 2.15), (0.16, 0.12, 0.07), SKIN_D)
    p.on('Jaw')
    p.blob((0, -3.0, 1.46), (0.52, 0.62, 0.22), SKIN_D)
    p.blob((0, -3.45, 1.45), (0.3, 0.25, 0.14), BEAK)

    def leg(s, t, front):
        p.on(('Leg1' if front else 'Leg2') + t)
        y = -0.9 if front else 1.1
        p.tube([(s * 1.05, y, 1.1), (s * 1.3, y - 0.1, 0.55), (s * 1.35, y - 0.15, 0.15)], [0.46, 0.42, 0.44],
               SKIN, sides=10)
        for k in range(3):
            p.cone((s * (1.2 + k * 0.12), y - 0.5, 0.1), (s * (1.25 + k * 0.14), y - 0.72, 0.04), 0.07, BEAK,
                   sides=4)
        p.blob((s * 1.3, y - 0.1, 0.62), (0.2, 0.14, 0.12), SKIN_D)

    for s, t in ((1, '.L'), (-1, '.R')):
        leg(s, t, True)
        leg(s, t, False)
    p.on('Tail')
    p.cone((0, 1.7, 1.15), (0, 2.5, 0.8), 0.32, SKIN, sides=8, smooth=True)
    return p


def clips(arm):
    stand = {}

    def breathe(ph):
        return {'Shell': [('loc', (0, 0, 0.03 * math.sin(ph)))], 'Neck': [('y', 8 * math.sin(ph * 0.5))],
                'Head': [('y', -6 * math.sin(ph * 0.5)), ('x', 3 * math.sin(ph))],
                'Jaw': [('x', 4 + 3 * math.sin(ph))]}

    author_clip(arm, 'Idle', loop(80, [breathe(i / 6 * math.tau) for i in range(6)]))

    def lumber(ph, amp=1.0):
        a = math.sin(ph)
        return {'Root': [('loc', (0, 0, 0.05 * abs(math.cos(ph)) * amp))],
                'Body': [('z', 4 * a * amp), ('y', 3 * a)], 'Shell': [('y', -3 * a)],
                'Leg1.L': [('x', 26 * a * amp)], 'Leg1.R': [('x', -26 * a * amp)],
                'Leg2.L': [('x', -24 * a * amp)], 'Leg2.R': [('x', 24 * a * amp)],
                'Neck': [('y', 6 * a)], 'Head': [('y', -4 * a)], 'Tail': [('y', 12 * a)]}

    author_clip(arm, 'Walk', loop(36, [lumber(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(22, [lumber(i / 4 * math.tau, 1.4) for i in range(4)]))
    reared = {'Neck': [('x', -18)], 'Head': [('x', -12)], 'Jaw': [('x', 35)]}
    bite = {'Neck': [('x', 22)], 'Head': [('x', 14)], 'Jaw': [('x', -4)], 'Body': [('x', 6)]}
    author_clip(arm, 'Attack', [(1, stand), (8, reared), (11, bite), (22, stand)], loop=False)
    lift = {'Leg1.L!': [('x', 55)], 'Body': [('x', -8)], 'Neck': [('x', -8)]}
    stamp = {'Leg1.L!': [('x', -10)], 'Body': [('x', 8)], 'Root': [('loc', (0, 0, -0.08))]}
    author_clip(arm, 'Attack2', [(1, stand), (10, lift), (14, stamp), (26, stand)], loop=False)
    hit = {'Neck': [('x', -20)], 'Head': [('x', -15), ('y', 10)], 'Jaw': [('x', 25)], 'Body': [('x', -5)]}
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (14, stand)], loop=False)
    tipped = {'Root': [('y', 70), ('loc', (0.4, 0, 1.0))], 'Neck': [('x', 30), ('y', 20)], 'Head': [('x', 20)],
              'Jaw': [('x', 30)], 'Leg1.L': [('x', 40), ('z', 30)], 'Leg2.L': [('x', -30), ('z', 25)]}
    author_clip(arm, 'Death', [(1, stand), (8, hit), (26, tipped), (40, tipped)], loop=False)
    # Snap: the head drawn deep into the shell, held while the bar runs, then
    # flung out across the front with the beak wide and slammed shut.
    drawn = {'Neck': [('loc', (0, 0.6, 0.05)), ('x', -10)], 'Head': [('x', -8)], 'Jaw': [('x', 20)],
             'Shell': [('x', -4)], 'Body': [('x', -4)]}
    drawn_b = merge(drawn, {'Jaw': [('x', 10)], 'Head': [('y', 4)]})
    flung = {'Neck': [('loc', (0, -0.7, -0.1)), ('x', 16)], 'Head': [('x', 10)], 'Jaw': [('x', 50)],
             'Body': [('x', 8)], 'Leg1.L': [('x', -15)]}
    shut = merge(flung, {'Jaw': [('x', -6)]})
    author_clip(arm, 'Cast', loop(16, [drawn, drawn_b]))
    author_clip(arm, 'Snap', [(1, stand), (8, drawn), (28, drawn_b), (34, flung), (38, shut), (48, stand)],
                loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Snap']


CREATURE = (BONES, body, clips, 1.6, 10.0)
