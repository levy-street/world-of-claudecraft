"""The Barnacle Crawler: a hulking rock crab of the Bastion's tidal flats.

A broad sea-teal carapace plated like an isopod and crusted with acorn
barnacles, three glowing brine sacs grown into the crust (they swell before
the crawler bursts), a coral underside and legs, two chunky serrated claws,
and a FACE: big amber eyes on thick stalks under an angry brow, feelers, and
a wide mouth framed by hooked mandibles with a row of teeth.

Clips: Idle, Walk (the skitter), Run, Attack (the claw snap), Attack2 (the
lunge bite), Hit, Death (the swell, the burst, the collapse), Cast (a swell
pulse). The death clip reaches its burst at frame 36 (1.5 s), the Brine
Burst's own delay (sunken_bastion.ts deathThroes).
"""
import math

from sea_kit import (
    ALGAE, BARNACLE, KELP, KELP_D, MOUTH, TOOTH, SeaBody, author_clip, expand_bones, loop, merge,
)

# Toned down for the Bastion's fog: a wet stone-grey carapace with a green
# cast, the shell's ridges bleached pale by salt, a dull red-brown underside;
# small dark eyes with a pinpoint of sea light, not the old cartoon stare. The
# brine sacs stay the brightest thing on it (they swell before it bursts).
SHELL = (0.6, 0.63, 0.55)
SHELL_HI = (0.78, 0.77, 0.68)
SHELL_D = (0.45, 0.47, 0.42)
CORAL = (0.72, 0.52, 0.42)
CORAL_D = (0.55, 0.38, 0.31)
BELLY = (0.6, 0.54, 0.46)
AMBER = (0.44, 0.78, 0.62)
TIP = (0.14, 0.1, 0.09)
SAC = (0.34, 0.8, 0.66)
VEIN = (0.07, 0.22, 0.19)
EYE_DARK = (0.08, 0.09, 0.08)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.5)),
    ('Body', 'Root', (0, 0.2, 1.3), (0, -1.2, 1.4)),
    ('Shell', 'Body', (0, 0.3, 1.9), (0, 0.3, 2.9)),
    ('SacM', 'Shell', (0, 0.75, 2.75), (0, 0.75, 3.3)),
    ('Sac.L', 'Shell', (0.8, 0.05, 2.55), (0.8, 0.05, 3.1)),
    ('Abdomen', 'Body', (0, 1.4, 1.3), (0, 2.5, 1.0)),
    ('Head', 'Body', (0, -1.3, 1.5), (0, -2.1, 1.55)),
    ('Eye.L', 'Head', (0.42, -1.62, 1.95), (0.56, -1.85, 2.75)),
    ('Mandible.L', 'Head', (0.36, -2.0, 1.28), (0.18, -2.6, 1.08)),
    ('Arm.L', 'Body', (1.0, -1.05, 1.3), (2.2, -1.75, 1.3)),
    ('Fore.L', 'Arm.L', (2.2, -1.75, 1.3), (2.4, -2.6, 1.5)),
    ('Pincer.L', 'Fore.L', (2.4, -2.6, 1.5), (2.45, -3.75, 1.55)),
    ('Jaw.L', 'Pincer.L', (2.35, -2.8, 1.2), (2.43, -3.65, 1.08)),
    ('Leg1.L', 'Body', (1.1, -0.45, 1.2), (2.25, -0.85, 1.65)),
    ('Leg1b.L', 'Leg1.L', (2.25, -0.85, 1.65), (2.95, -1.2, 0.0)),
    ('Leg2.L', 'Body', (1.2, 0.25, 1.2), (2.45, 0.3, 1.65)),
    ('Leg2b.L', 'Leg2.L', (2.45, 0.3, 1.65), (3.15, 0.4, 0.0)),
    ('Leg3.L', 'Body', (1.05, 0.95, 1.2), (2.1, 1.4, 1.55)),
    ('Leg3b.L', 'Leg3.L', (2.1, 1.4, 1.55), (2.7, 1.95, 0.0)),
])


def sides(fn):
    for s, tag in ((1, '.L'), (-1, '.R')):
        fn(s, tag)


def body():
    p = SeaBody('BarnacleCrawler', lichen=0.0, weather=0.2)
    # ---- the belly and the underside ----------------------------------------------
    p.on('Body')
    p.blob((0, -0.1, 1.2), (1.35, 1.65, 0.62), p.vary(BELLY, 0.04), flat_bottom=True)
    for k in range(4):
        p.tube([(-1.0, -0.9 + k * 0.5, 0.92), (0, -0.95 + k * 0.5, 0.78), (1.0, -0.9 + k * 0.5, 0.92)],
               [0.08, 0.1, 0.08], CORAL_D, sides=6)
    # ---- the carapace: a plated dome with a pale rim, crusted with barnacles -----
    p.on('Shell')
    p.blob((0, 0.05, 1.72), (1.72, 1.95, 0.95), p.vary(SHELL, 0.03), bulge=0.15, segments=24, rings=14)
    # The rim: a rolled lip all round the dome.
    rim = [(math.cos(a) * 1.72, 0.05 + math.sin(a) * 1.95, 1.42 + 0.06 * math.sin(a * 3))
           for a in [i / 32 * math.tau for i in range(33)]]
    p.tube(rim, [0.16] * len(rim), SHELL_HI, sides=8, cap=False)
    # Isopod plates: overlapping ridges across the back.
    for k in range(5):
        y = -1.1 + k * 0.52
        half = 1.55 * math.sqrt(max(0.1, 1 - (y / 2.0) ** 2))
        pts = [(x, y + 0.08 * math.cos(x), 1.72 + 0.93 * math.sqrt(max(0.0, 1 - (x / 1.75) ** 2 - (y / 1.98) ** 2)))
               for x in [(-half + 2 * half * i / 10) for i in range(11)]]
        p.tube(pts, [0.1] + [0.2] * 9 + [0.1], p.vary(SHELL_HI, 0.04), sides=8, squash=0.35)
    # Barnacle crust, densest at the crown, clear of the three brine sacs.
    sacs = [(0.0, 0.75, 2.62), (0.8, 0.05, 2.45), (-0.8, 0.05, 2.45)]
    placed = 0
    tries = 0
    while placed < 150 and tries < 2000:
        tries += 1
        a = p.rng.random() * math.tau
        rr = p.rng.random() ** 0.7 * 0.92
        x = math.cos(a) * rr * 1.7
        y = 0.05 + math.sin(a) * rr * 1.9
        zz = 1 - (x / 1.72) ** 2 - ((y - 0.05) / 1.95) ** 2
        if zz <= 0.02:
            continue
        z = 1.72 + 0.95 * math.sqrt(zz) * (1 + 0.15 * max(0, 1 - (x * x + y * y) / 3))
        if any((x - sx) ** 2 + (y - sy) ** 2 < 0.42 for sx, sy, _ in sacs):
            continue
        n = (x / 1.72 ** 2, (y - 0.05) / 1.95 ** 2, (z - 1.72) / 0.95 ** 2)
        p.barnacle((x, y, z - 0.03), n, p.rng.uniform(0.14, 0.3), p.vary(BARNACLE, 0.07))
        placed += 1
    # Kelp draped off the rim at the back and the flanks.
    for k in range(9):
        a = math.pi * 0.15 + k / 8 * math.pi * 0.7
        x, y = math.cos(a) * 1.78, 0.05 + math.sin(a) * 2.0
        p.kelp((x, y, 1.5), p.rng.uniform(0.5, 1.0), (math.cos(a) * 0.25, math.sin(a) * 0.2), 0.09,
               p.vary(KELP if k % 2 else ALGAE, 0.1))

    def sac(bone, c, r):
        p.on(bone)
        # Lit, not emissive: an exported emissive part glows flat white.
        p.blob(c, (r, r, r * 0.85), SAC)
        # Veins over the glowing skin and a collar of barnacles at its root.
        for k in range(5):
            a = k / 5 * math.tau
            p.tube([(c[0] + math.cos(a) * r * 0.3, c[1] + math.sin(a) * r * 0.3, c[2] + r * 0.8),
                    (c[0] + math.cos(a) * r * 0.95, c[1] + math.sin(a) * r * 0.95, c[2] + r * 0.2),
                    (c[0] + math.cos(a) * r * 0.9, c[1] + math.sin(a) * r * 0.9, c[2] - r * 0.4)],
                   [0.025, 0.035, 0.02], VEIN, sides=4)
        for k in range(8):
            a = k / 8 * math.tau
            p.barnacle((c[0] + math.cos(a) * r * 1.05, c[1] + math.sin(a) * r * 1.05, c[2] - r * 0.45),
                       (math.cos(a), math.sin(a), 0.6), 0.12)

    sac('SacM', sacs[0], 0.42)
    sac('Sac.L', sacs[1], 0.33)
    sac('Sac.R', sacs[2], 0.33)
    # ---- the abdomen: tucked plated segments ending in a tail fan -----------------
    p.on('Abdomen')
    for k in range(3):
        p.blob((0, 1.6 + k * 0.38, 1.18 - k * 0.12), (0.95 - k * 0.2, 0.34, 0.36 - k * 0.05), p.vary(SHELL, 0.04))
        p.tube([(-(0.9 - k * 0.2), 1.6 + k * 0.38, 1.3 - k * 0.12), (0, 1.62 + k * 0.38, 1.5 - k * 0.14),
                (0.9 - k * 0.2, 1.6 + k * 0.38, 1.3 - k * 0.12)], [0.05, 0.08, 0.05], SHELL_HI, sides=5)
    for k in range(5):
        a = (k - 2) * 0.35
        p.blob((math.sin(a) * 0.45, 2.6 + math.cos(a) * 0.28, 0.9), (0.2, 0.42, 0.06), CORAL, yaw=-a)
    # ---- the head: a face plate, an angry brow, stalked eyes, a toothed mouth -----
    p.on('Head')
    p.blob((0, -1.55, 1.5), (0.98, 0.62, 0.62), p.vary(SHELL_D, 0.03))
    p.blob((0, -1.72, 1.2), (0.78, 0.45, 0.35), CORAL_D)
    # The mouth: a dark maw with upper and lower teeth.
    p.blob((0, -2.08, 1.26), (0.5, 0.2, 0.24), MOUTH)
    for k in range(7):
        x = -0.36 + k * 0.12
        p.cone((x, -2.12, 1.44), (x * 0.95, -2.2, 1.3), 0.05, TOOTH, sides=5)
        p.cone((x, -2.1, 1.07), (x * 0.95, -2.19, 1.19), 0.045, TOOTH, sides=5)
    # Lips: coral rolls above and below the maw.
    p.tube([(-0.55, -2.0, 1.47), (0, -2.14, 1.52), (0.55, -2.0, 1.47)], [0.08, 0.1, 0.08], CORAL, sides=8)
    p.tube([(-0.5, -2.0, 1.04), (0, -2.12, 1.0), (0.5, -2.0, 1.04)], [0.07, 0.09, 0.07], CORAL, sides=8)

    def face(s, t):
        # Brow plate angled down toward the centre: an unmistakable scowl.
        p.on('Head')
        p.blob((s * 0.38, -1.95, 1.84), (0.36, 0.2, 0.12), SHELL_HI, roll=s * 0.45, yaw=s * 0.2)
        # Feelers under the mouth corners.
        p.tube(p.bezier((s * 0.42, -2.05, 1.16), (s * 0.62, -2.5, 1.0), (s * 0.5, -2.75, 0.62), 5),
               [0.05, 0.015], CORAL, sides=5)
        # Antennae sweeping back over the carapace.
        p.tube(p.bezier((s * 0.25, -2.0, 1.9), (s * 0.9, -2.6, 2.9), (s * 1.3, -1.2, 3.1), 8), [0.05, 0.012],
               CORAL_D, sides=5)
        p.on('Eye' + t)
        p.tube([(s * 0.42, -1.62, 1.8), (s * 0.5, -1.75, 2.2), (s * 0.55, -1.85, 2.4)], [0.16, 0.13, 0.13],
               SHELL_D, sides=10)
        p.eye((s * 0.58, -1.92, 2.52), 0.22, look=(s * 0.08, -1, -0.3), pupil=0.45, color=EYE_DARK, iris=AMBER)
        # A heavy lid over the back of each eye, slanting in.
        p.blob((s * 0.58, -1.86, 2.66), (0.26, 0.24, 0.09), SHELL_HI, pitch=-0.5, roll=s * 0.35)
        p.on('Mandible' + t)
        p.tube(p.bezier((s * 0.4, -1.98, 1.3), (s * 0.55, -2.45, 1.2), (s * 0.14, -2.62, 1.08), 7),
               [0.13, 0.04], p.vary(TOOTH, 0.1), sides=7)
        p.cone((s * 0.16, -2.6, 1.08), (s * 0.05, -2.72, 1.05), 0.05, TIP, sides=5)
        for k in range(3):
            q = 0.35 + k * 0.2
            bx = s * (0.4 + (0.14 - 0.4) * q)
            p.cone((bx, -2.2 - q * 0.35, 1.2), (bx - s * 0.12, -2.25 - q * 0.35, 1.18), 0.035, TOOTH, sides=4)

    sides(face)

    def claw(s, t):
        p.on('Arm' + t)
        p.tube([(s * 1.0, -1.05, 1.3), (s * 1.6, -1.4, 1.35), (s * 2.2, -1.75, 1.3)], [0.3, 0.28, 0.27],
               p.vary(SHELL, 0.04), sides=10)
        p.blob((s * 2.2, -1.75, 1.3), (0.34, 0.34, 0.32), CORAL)
        p.on('Fore' + t)
        p.tube([(s * 2.2, -1.75, 1.3), (s * 2.35, -2.2, 1.42), (s * 2.4, -2.6, 1.5)], [0.3, 0.33, 0.38],
               p.vary(SHELL, 0.04), sides=10)
        for k in range(3):
            p.cone((s * (2.4 + 0.18), -2.1 - k * 0.22, 1.6), (s * 2.75, -2.12 - k * 0.22, 1.75), 0.06, CORAL_D)
        p.on('Pincer' + t)
        # The palm, then the curling upper finger with its serrated inner edge.
        p.blob((s * 2.43, -3.15, 1.52), (0.62, 0.72, 0.55), p.vary(SHELL, 0.03))
        p.tube(p.bezier((s * 2.45, -3.5, 1.72), (s * 2.53, -4.15, 1.9), (s * 2.35, -4.45, 1.45), 8),
               [0.3, 0.07], SHELL_HI, sides=10)
        p.cone((s * 2.35, -4.42, 1.47), (s * 2.31, -4.6, 1.32), 0.08, TIP)
        for k in range(4):
            q = 0.25 + k * 0.17
            y = -3.55 - q * 0.8
            p.cone((s * 2.43, y, 1.62 - q * 0.1), (s * 2.42, y - 0.05, 1.42 - q * 0.1), 0.05, TOOTH, sides=4)
        for k in range(5):
            a = p.rng.random() * math.tau
            p.barnacle((s * (2.43 + math.cos(a) * 0.35), -3.1 + math.sin(a) * 0.3, 1.95), (s * 0.3, 0, 1),
                       p.rng.uniform(0.08, 0.14))
        p.on('Jaw' + t)
        p.tube(p.bezier((s * 2.37, -3.2, 1.2), (s * 2.45, -3.9, 1.05), (s * 2.33, -4.2, 1.25), 7),
               [0.24, 0.06], CORAL, sides=9)
        p.cone((s * 2.33, -4.18, 1.26), (s * 2.3, -4.3, 1.38), 0.06, TIP)
        for k in range(3):
            q = 0.3 + k * 0.2
            p.cone((s * 2.4, -3.35 - q * 0.7, 1.18), (s * 2.4, -3.38 - q * 0.7, 1.34), 0.045, TOOTH, sides=4)

    sides(claw)

    def legs(s, t):
        joints = (
            ((1.1, -0.45, 1.2), (2.25, -0.85, 1.65), (2.95, -1.2, 0.0)),
            ((1.2, 0.25, 1.2), (2.45, 0.3, 1.65), (3.15, 0.4, 0.0)),
            ((1.05, 0.95, 1.2), (2.1, 1.4, 1.55), (2.7, 1.95, 0.0)),
        )
        for n, ((ax, ay, az), (bx, by, bz), (cx, cy, cz)) in enumerate(joints):
            p.on(f'Leg{n + 1}{t}')
            p.tube([(s * ax, ay, az), (s * (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2 + 0.18), (s * bx, by, bz)],
                   [0.24, 0.22, 0.2], p.vary(CORAL, 0.05), sides=9)
            p.blob((s * bx, by, bz), (0.24, 0.24, 0.22), SHELL_HI)
            p.cone((s * bx, by, bz + 0.12), (s * bx, by + 0.05, bz + 0.42), 0.07, SHELL_D)
            p.on(f'Leg{n + 1}b{t}')
            p.tube([(s * bx, by, bz), (s * (bx + cx) / 2 + s * 0.05, (by + cy) / 2, (bz + cz) / 2 + 0.25),
                    (s * cx, cy, cz + 0.28)], [0.19, 0.15, 0.1], p.vary(CORAL, 0.05), sides=9)
            p.cone((s * cx, cy, cz + 0.3), (s * cx, cy, cz), 0.1, TIP, sides=6)

    sides(legs)
    return p


def clips(arm):
    stand = {'Arm.L': [('x', -6)], 'Fore.L': [('x', 4)], 'Eye.L': [('x', -4)]}
    breath = merge(stand, {'Shell': [('x', -1.5)], 'SacM': [('scale', 1.07)], 'Sac.L': [('scale', 1.05)],
                           'Mandible.L': [('z', 14)], 'Eye.L': [('z', 12)], 'Jaw.L': [('x', 12)],
                           'Body': [('loc', (0, 0, 0.04))]})
    look = merge(stand, {'Mandible.L': [('z', -4)], 'Eye.L': [('z', -10), ('x', 6)], 'Abdomen': [('x', 4)]})
    author_clip(arm, 'Idle', loop(64, [stand, breath, look, breath]))

    def gait(ph, amp=1.0, low=0.0):
        # Tripod skitter: legs 1 and 3 on one side move with 2 on the other.
        a = math.sin(ph)
        b = math.sin(ph + math.pi)
        lift_a = max(0.0, math.cos(ph)) * 22 * amp
        lift_b = max(0.0, math.cos(ph + math.pi)) * 22 * amp
        return merge(stand, {
            'Root': [('loc', (0, 0, -low + 0.07 * abs(math.cos(ph * 2)) * amp))],
            'Body': [('y', 4 * a * amp), ('x', -3 - low * 8)],
            'Shell': [('y', -2 * a * amp)],
            'Leg1.L': [('z', 20 * a * amp), ('y', lift_a)], 'Leg3.L': [('z', 20 * a * amp), ('y', lift_a)],
            'Leg2.L': [('z', 20 * b * amp), ('y', lift_b)],
            'Leg1.R': [('z', 20 * b * amp), ('y', -lift_b)], 'Leg3.R': [('z', 20 * b * amp), ('y', -lift_b)],
            'Leg2.R': [('z', 20 * a * amp), ('y', -lift_a)],
            'Arm.L': [('x', -14), ('z', 6 * a * amp)], 'Fore.L': [('x', 10)],
            'Eye.L': [('x', -8), ('z', 5 * b)], 'Mandible.L': [('z', 6 * a)],
        })

    author_clip(arm, 'Walk', loop(16, [gait(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(10, [gait(i / 4 * math.tau, 1.35, 0.12) for i in range(4)]))
    # The claw snap: the right claw rises open and snaps shut in front.
    cock = merge(stand, {'Arm.R': [('x', -38), ('z', -12)], 'Fore.R': [('x', -24)], 'Jaw.R': [('x', 40)],
                         'Body': [('z', 8)], 'Mandible.L': [('z', 20)]})
    snap = merge(stand, {'Arm.R': [('x', 16), ('z', 14)], 'Fore.R': [('x', 14)], 'Jaw.R': [('x', -4)],
                         'Body': [('z', -8), ('x', 6)]})
    author_clip(arm, 'Attack', [(1, stand), (9, cock), (13, snap), (24, stand)], loop=False)
    # The lunge bite: coils back on its hind legs, lunges its whole body in,
    # mandibles thrown wide, then snaps them shut on the target.
    coil = merge(stand, {'Root': [('loc', (0, 0.45, 0.1))], 'Body': [('x', -14)], 'Head': [('x', -10)],
                         'Mandible.L': [('z', 34)], 'Arm.L': [('x', -30), ('z', 22)], 'Fore.L': [('x', -12)],
                         'Leg1.L': [('y', 18)], 'Leg3.L': [('y', -10)], 'Eye.L': [('x', 12)]})
    lunge = merge(stand, {'Root': [('loc', (0, -1.2, -0.05))], 'Body': [('x', 12)], 'Head': [('x', 8)],
                          'Mandible.L': [('z', 40)], 'Arm.L': [('x', 20), ('z', -18)], 'Leg1.L': [('z', 25)],
                          'Leg3.L': [('z', -25)], 'Shell': [('x', 4)]})
    chomp = merge(lunge, {'Mandible.L': [('z', -14)], 'Head': [('x', 14)]})
    author_clip(arm, 'Attack2', [(1, stand), (10, coil), (15, lunge), (18, chomp), (32, stand)], loop=False)
    author_clip(arm, 'Hit', [(1, stand), (4, merge(stand, {'Body': [('x', -10), ('z', 6)], 'Eye.L': [('x', 25)],
                                                            'Mandible.L': [('z', 22)], 'Shell': [('x', 5)]})),
                             (14, stand)], loop=False)
    # Death: it buckles, then SWELLS (the brine sacs and the whole shell
    # inflating, shuddering) and BURSTS at 1.5 s, the shell cracking up and the
    # body flattening into the brine.
    buckle = merge(stand, {'Root': [('loc', (0, 0, -0.35))], 'Body': [('x', 6)], 'Eye.L': [('x', 30)],
                           'Leg1.L': [('y', -22)], 'Leg2.L': [('y', -22)], 'Leg3.L': [('y', -22)],
                           'Mandible.L': [('z', 30)]})

    def swell(k, shake):
        return merge(buckle, {'Shell': [('scale', 1 + 0.2 * k), ('y', shake * 4), ('x', -3 * k)],
                              'SacM': [('scale', 1 + 0.95 * k)], 'Sac.L': [('scale', 1 + 0.9 * k)],
                              'Body': [('y', -shake * 3)], 'Head': [('x', -12 * k)],
                              'Arm.L': [('x', -20 * k), ('z', 30 * k)], 'Eye.L': [('x', 30 - 50 * k)]})

    burst = merge(stand, {'Root': [('loc', (0, 0, -0.8))], 'Body': [('x', 4)],
                          'Shell': [('scale', 0.92), ('x', -24), ('loc', (0, 0, 0.35))],
                          'SacM': [('scale', 0.05)], 'Sac.L': [('scale', 0.05)],
                          'Leg1.L': [('y', -40)], 'Leg2.L': [('y', -42)], 'Leg3.L': [('y', -40)],
                          'Leg1b.L': [('y', -20)], 'Arm.L': [('x', 18), ('z', 36)], 'Eye.L': [('x', 65)],
                          'Mandible.L': [('z', 36)], 'Head': [('x', 18)], 'Abdomen': [('x', -12)]})
    settle = merge(burst, {'Shell': [('scale', 0.92), ('x', -12), ('loc', (0, 0, 0.12))]})
    author_clip(arm, 'Death', [(1, stand), (6, buckle), (14, swell(0.35, 1)), (20, swell(0.55, -1)),
                               (26, swell(0.75, 1)), (31, swell(0.92, -1)), (35, swell(1.0, 1)),
                               (37, burst), (44, settle), (52, settle)], loop=False)
    puff = merge(stand, {'SacM': [('scale', 1.35)], 'Sac.L': [('scale', 1.3)], 'Shell': [('scale', 1.05)],
                         'Mandible.L': [('z', 26)], 'Body': [('x', -5)]})
    author_clip(arm, 'Cast', loop(24, [stand, puff]))
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast']


CREATURE = (BONES, body, clips, 1.6, 11.0)
