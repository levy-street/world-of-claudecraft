"""The Lagoon Eel: a great moray of the temple lagoon, reared up out of its
own coils like a cobra, as tall as a watchtower door.

A thick coil of dark teal eel laid on the flags, its length rising in an S out
of the coil to a long needle-toothed head; a pale belly, a ragged dorsal fin
crackling with blue light, rows of cyan photophores down both flanks that
brighten as it charges, small blind glowing eyes and trailing barbels.

Clips: Idle (an S-wave climbing the column over its coil, the head held
level: the body ripples, the head never shakes), Walk and Run (the coil
gliding, the wave running faster), Attack (rear and strike), Attack2 (a
sideways lash), Hit, Death (the column falls and uncoils along the ground),
Cast and Coil (Static Coil: the coils clench, the head thrown up, jaws wide,
shuddering), Spit (Lightning Spit: drawn back crackling, then the bolt spat
down its lane). A replacement eel model keeps these clip names, or remaps
them in the manifest's temple_eel row.
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge
from temple_palette import CYAN, DEEP, EYE_GLOW, MOUTH, TEAL, TEAL_D, TOOTH

BELLY = (0.9, 0.9, 0.86)
FIN = (0.3, 0.62, 0.74)
# the polish pass: the temple's turquoise in place of the old dark green-teal,
# the coil the same living eel as the column (it read as a black tyre)
EEL = (0.3, 0.72, 0.78)
EEL_D = (0.2, 0.52, 0.6)

CHAIN = [(0, 0.35, 0.8), (0, 0.25, 1.9), (0, 0.0, 3.0), (0, -0.25, 4.0), (0, -0.4, 4.9), (0, -0.6, 5.7)]

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Coil', 'Root', (0, 0.2, 0.3), (0, 0.2, 0.8)),
    ('S1', 'Coil', CHAIN[0], CHAIN[1]),
    ('S2', 'S1', CHAIN[1], CHAIN[2]),
    ('S3', 'S2', CHAIN[2], CHAIN[3]),
    ('S4', 'S3', CHAIN[3], CHAIN[4]),
    ('S5', 'S4', CHAIN[4], CHAIN[5]),
    ('Head', 'S5', (0, -0.6, 5.7), (0, -2.1, 5.95)),
    ('Jaw', 'Head', (0, -0.85, 5.55), (0, -2.0, 5.3)),
    ('Fin.L', 'S4', (0.42, -0.35, 4.6), (1.25, -0.15, 4.25)),
])

RADII = [0.62, 0.6, 0.56, 0.52, 0.48, 0.44]


def body():
    p = SeaBody('LagoonEel', lichen=0.0, weather=0.2)
    # ---- the coil on the flags ---------------------------------------------------
    p.on('Coil')
    pts = []
    for i in range(34):
        t = i / 33
        a = t * math.tau * 1.55 + 0.6
        r = 1.9 - t * 0.55
        pts.append((math.sin(a) * r, 0.2 + math.cos(a) * r, 0.45 + t * 0.35))
    p.tube(pts, [0.42 + 0.2 * (i / 33) for i in range(34)], EEL, sides=14)
    # The coil is the same eel as the column: a pearl belly underneath and the
    # lit dorsal fin running round on top.
    rr = [0.42 + 0.2 * (i / 33) for i in range(34)]
    p.tube([(x, y, z - rr[i] * 0.45) for i, (x, y, z) in enumerate(pts)], [r * 0.7 for r in rr], BELLY, sides=10)
    p.tube([(x, y, z + rr[i] * 0.92) for i, (x, y, z) in enumerate(pts)], [0.16] * 34, FIN, sides=4, squash=0.25)
    for i in range(1, 33, 3):
        x, y, z = pts[i]
        p.blob((x, y, z + rr[i] * 1.02), (0.03, 0.03, 0.12), CYAN, mat=GLOW)
    # the photophores carry on round the coil, on both flanks
    for i in range(0, 34, 2):
        x, y, z = pts[i]
        d = math.hypot(x, y - 0.2) or 1.0
        ux, uy = x / d, (y - 0.2) / d
        for side in (-1, 1):
            p.blob((x + side * ux * rr[i] * 0.97, y + side * uy * rr[i] * 0.97, z + 0.08), (0.075, 0.075, 0.075), CYAN,
                   mat=GLOW)
    # The tail tip trailing out behind.
    p.tube([(1.2, 1.8, 0.35), (1.8, 2.8, 0.25), (1.6, 3.8, 0.18)], [0.36, 0.22, 0.04], EEL, sides=10)
    p.tube([(1.2, 1.8, 0.62), (1.8, 2.8, 0.5), (1.6, 3.8, 0.34)], [0.12, 0.08, 0.02], FIN, sides=4, squash=0.3)
    # ---- the rising column ------------------------------------------------------------
    for k in range(5):
        p.on(f'S{k + 1}')
        a, b = CHAIN[k], CHAIN[k + 1]
        mid = [(a[j] + b[j]) / 2 for j in range(3)]
        p.tube([a, mid, b], [RADII[k], (RADII[k] + RADII[k + 1]) / 2, RADII[k + 1]], EEL, sides=14)
        # The pale belly on the front of the column.
        p.tube([(a[0], a[1] - RADII[k] * 0.55, a[2]), (b[0], b[1] - RADII[k + 1] * 0.55, b[2])],
               [RADII[k] * 0.62, RADII[k + 1] * 0.62], BELLY, sides=10)
        # The dorsal fin down the back, lit blue.
        p.tube([(a[0], a[1] + RADII[k] * 0.9, a[2]), (b[0], b[1] + RADII[k + 1] * 0.9 + 0.1, b[2])],
               [0.18, 0.16], FIN, sides=4, squash=0.25)
        p.blob((mid[0], mid[1] + RADII[k] * 1.05, mid[2]), (0.03, 0.06, 0.3), CYAN, mat=GLOW)
        # Photophores in rows on both flanks.
        for s in (-1, 1):
            for j in range(3):
                t = (j + 0.5) / 3
                z = a[2] + (b[2] - a[2]) * t
                y = a[1] + (b[1] - a[1]) * t
                p.blob((s * RADII[k] * 0.95, y, z), (0.07, 0.07, 0.07), CYAN, mat=GLOW)
    # ---- the head ---------------------------------------------------------------------
    p.on('Head')
    p.blob((0, -1.25, 5.95), (0.5, 1.15, 0.42), EEL, bulge=0.1)
    p.blob((0, -1.4, 5.78), (0.44, 0.95, 0.2), BELLY)
    p.blob((0, -2.2, 5.9), (0.28, 0.35, 0.24), EEL_D)
    for s in (-1, 1):
        # glowing orbs of moonlight for eyes (no pupils)
        p.blob((s * 0.38, -1.7, 6.15), (0.13, 0.16, 0.12), EYE_GLOW, mat=GLOW)
        p.blob((s * 0.34, -1.68, 6.24), (0.16, 0.2, 0.05), EEL_D)
        # Barbels trailing from the snout.
        p.tube([(s * 0.18, -2.3, 5.78), (s * 0.35, -2.4, 5.4), (s * 0.5, -2.2, 4.95)], [0.05, 0.03, 0.01], DEEP,
               sides=4)
        # The gill slit glowing.
        p.blob((s * 0.46, -0.75, 5.85), (0.04, 0.22, 0.18), CYAN, mat=GLOW)
    # Upper needle teeth.
    for k in range(13):
        t = k / 12
        for s in (-1, 1):
            p.cone((s * (0.3 - t * 0.12), -0.95 - t * 1.25, 5.72), (s * (0.28 - t * 0.12), -0.95 - t * 1.25,
                                                                       5.46 - 0.06 * (k % 2)),
                   0.04, TOOTH, sides=4)
    p.on('Jaw')
    p.blob((0, -1.35, 5.48), (0.4, 1.0, 0.18), BELLY)
    p.blob((0, -1.25, 5.58), (0.3, 0.8, 0.07), MOUTH)
    for k in range(12):
        t = k / 11
        for s in (-1, 1):
            p.cone((s * (0.26 - t * 0.1), -1.0 - t * 1.1, 5.5), (s * (0.24 - t * 0.1), -1.0 - t * 1.1,
                                                                    5.74 + 0.05 * (k % 2)),
                   0.035, TOOTH, sides=4)

    def fin(s, t):
        p.on('Fin' + t)
        p.tube([(s * 0.42, -0.35, 4.6), (s * 1.05, -0.3, 4.42), (s * 1.6, -0.12, 4.1)], [0.42, 0.32, 0.06], FIN,
               sides=4, squash=0.2)
        for j, (fx, fz) in enumerate(((0.8, 4.5), (1.15, 4.38), (1.42, 4.2))):
            p.tube([(s * 0.45, -0.34, 4.6), (s * fx, -0.27, fz)], [0.03, 0.012], CYAN, sides=4, mat=GLOW)

    fin(1, '.L')
    fin(-1, '.R')
    return p


def clips(arm):
    stand = {'S1': [('x', -2)], 'Head': [('x', 4)]}
    chain = ['S1', 'S2', 'S3', 'S4', 'S5']

    # Each column bend pivot's height below the Head pivot (yards): a side
    # bend of `t` degrees at height `h` swings the head sideways by about t*h.
    pivot_h = [4.9, 3.8, 2.7, 1.7, 0.8]

    def level(bends):
        """Project the bends so they sum to zero (no net roll at the head) AND
        their moments sum to zero (no sideways drift of the head): the column
        still ripples, the head rides dead level and dead centre. (Least-squares
        projection onto the null space of A = [[1]*5, pivot_h].)"""
        n = len(bends)
        a = [[1.0] * n, pivot_h]
        g = [[sum(a[i][k] * a[j][k] for k in range(n)) for j in range(2)] for i in range(2)]
        det = g[0][0] * g[1][1] - g[0][1] * g[1][0]
        inv = [[g[1][1] / det, -g[0][1] / det], [-g[1][0] / det, g[0][0] / det]]
        ab = [sum(a[i][k] * bends[k] for k in range(n)) for i in range(2)]
        lam = [inv[i][0] * ab[0] + inv[i][1] * ab[1] for i in range(2)]
        return [bends[k] - (a[0][k] * lam[0] + a[1][k] * lam[1]) for k in range(n)]

    def sway(ph, amp=1.0):
        """A serpentine S-wave travelling UP the column: each vertebra bends to
        the side a beat after the one below it (the wave's crest climbs from
        the coil to the neck). The bends are levelled (no net roll, no net
        sideways swing at the head) and the coil never yaws, so the body
        ripples while the head holds still, looking ahead: it never shakes.
        A slower fore-and-aft breath rides under it."""
        side = [5.0, 7.0, 8.0, 7.0, 5.0]
        bends = level([side[k] * amp * math.sin(ph - k * 1.05) for k in range(5)])
        pose = {}
        for k, bone in enumerate(chain):
            pose[bone] = [('y', bends[k]), ('x', 1.6 * amp * math.sin(ph * 0.5 - k * 0.6))]
        # Level head: cancel most of the column's nod; it never rolls or yaws.
        pose['Head'] = [('x', -0.8 * amp * math.sin(ph * 0.5 - 2.4))]
        pose['Jaw'] = [('x', 5 + 3 * math.sin(ph))]
        pose['Fin.L'] = [('z', 8 * math.sin(ph - 2.0))]
        return merge(stand, pose)


    def slither(ph, amp=1.0):
        # Gliding on its coil: the S-wave runs faster and wider up the column
        # and the coil slides side to side under it (a slide, never a yaw, so
        # the head rides level and pointed ahead).
        return merge(sway(ph, 1.5 * amp), {
            'Coil': [('loc', (0.1 * math.sin(ph) * amp, 0, 0))],
            'Root': [('loc', (0, 0, 0.04 * abs(math.sin(ph))))],
        })

    author_clip(arm, 'Idle', loop(96, [sway(i / 8 * math.tau) for i in range(8)]))
    author_clip(arm, 'Walk', loop(32, [slither(i / 8 * math.tau) for i in range(8)]))
    author_clip(arm, 'Run', loop(20, [slither(i / 8 * math.tau, 1.3) for i in range(8)]))
    rear = merge(stand, {'S3': [('x', -14)], 'S4': [('x', -16)], 'S5': [('x', -14)], 'Head': [('x', -18)],
                         'Jaw': [('x', 25)]})
    strike = merge(stand, {'S2': [('x', 14)], 'S3': [('x', 20)], 'S4': [('x', 24)], 'S5': [('x', 18)],
                           'Head': [('x', 12)], 'Jaw': [('x', 38)]})
    author_clip(arm, 'Attack', [(1, stand), (9, rear), (13, strike), (17, merge(strike, {'Jaw': [('x', -30)]})),
                                (28, stand)], loop=False)
    # The second swing: a low double snap straight ahead (fore and aft only:
    # a sideways lash rolled the head half over and read as a head shake).
    coil_back = merge(stand, {'S2': [('x', -6)], 'S3': [('x', -10)], 'S4': [('x', -12)], 'Head': [('x', -10)],
                              'Jaw': [('x', 30)]})
    snap = merge(stand, {'S1': [('x', 6)], 'S2': [('x', 12)], 'S3': [('x', 16)], 'S4': [('x', 18)],
                         'Head': [('x', 6)], 'Jaw': [('x', -20)]})
    half_back = merge(stand, {'S3': [('x', -4)], 'S4': [('x', -6)], 'Head': [('x', -4)], 'Jaw': [('x', 24)]})
    author_clip(arm, 'Attack2', [(1, stand), (7, coil_back), (11, snap), (15, half_back), (19, snap),
                                 (28, stand)], loop=False)
    hit = merge(stand, {'S3': [('x', -12)], 'S4': [('x', -10)], 'Head': [('x', -22)], 'Jaw': [('x', 30)]})
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (14, stand)], loop=False)
    fall = merge(stand, {'S1': [('x', 30)], 'S2': [('x', 26)], 'S3': [('x', 20), ('y', 12)], 'S4': [('x', 12), ('y', 15)],
                         'S5': [('y', 20)], 'Head': [('y', 25)], 'Jaw': [('x', 40)]})
    flat = merge(stand, {'S1': [('x', 48)], 'S2': [('x', 40), ('y', 25)], 'S3': [('x', 36), ('y', -20)],
                         'S4': [('x', 20), ('y', 25)], 'S5': [('x', 10), ('y', -20)], 'Head': [('x', 8), ('y', 15)],
                         'Jaw': [('x', 30)], 'Coil': [('scale', 0.96)], 'Fin.L': [('z', -30)]})
    author_clip(arm, 'Death', [(1, stand), (8, hit), (20, fall), (34, flat), (44, flat)], loop=False)
    # Static Coil: the coils clench, the column draws tight, the head thrown up
    # with the jaws wide, the whole body shuddering as the charge builds.
    clench = merge(stand, {'Coil': [('scale', 0.93)], 'S1': [('x', -6)], 'S2': [('x', 8)], 'S3': [('x', -8)],
                           'S4': [('x', 6)], 'S5': [('x', -10)], 'Head': [('x', -28)], 'Jaw': [('x', 48)],
                           'Fin.L': [('z', 35)]})
    shake_a = merge(clench, {'S3': [('y', 3)], 'S5': [('y', -3)]})
    shake_b = merge(clench, {'S3': [('y', -3)], 'S5': [('y', 3)]})
    author_clip(arm, 'Cast', loop(8, [shake_a, shake_b]))
    author_clip(arm, 'Coil', [(1, stand), (8, clench), (11, shake_a), (14, shake_b), (17, shake_a), (20, shake_b),
                              (23, shake_a), (26, shake_b), (29, shake_a), (32, shake_b), (36, clench),
                              (44, strike), (52, stand)], loop=False)
    # Lightning Spit: it draws the column back and down, crackling, then
    # snaps forward and spits the bolt down its lane, jaws wide.
    draw = merge(stand, {'S2': [('x', -6)], 'S3': [('x', -12)], 'S4': [('x', -14)], 'S5': [('x', -10)],
                         'Head': [('x', 8)], 'Jaw': [('x', 14)], 'Fin.L': [('z', 30)]})
    crackle_a = merge(draw, {'S4': [('y', 2)], 'Head': [('y', -2)], 'Jaw': [('x', 6)]})
    crackle_b = merge(draw, {'S4': [('y', -2)], 'Head': [('y', 2)], 'Jaw': [('x', -4)]})
    spit = merge(stand, {'S2': [('x', 10)], 'S3': [('x', 14)], 'S4': [('x', 12)], 'S5': [('x', 6)],
                         'Head': [('x', -6)], 'Jaw': [('x', 42)], 'Fin.L': [('z', -12)]})
    author_clip(arm, 'Spit', [(1, stand), (10, draw), (16, crackle_a), (22, crackle_b), (28, crackle_a),
                              (34, crackle_b), (40, draw), (44, spit), (50, merge(spit, {'Jaw': [('x', -20)]})),
                              (62, stand)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'Coil', 'Spit']


CREATURE = (BONES, body, clips, 3.5, 13.0)
