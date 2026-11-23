"""The Drowned Temple world entrance: the Moon Stair, the moongate and the moon pool.

  blender -b --factory-startup --python build_temple_entrance.py -- --out DIR --terrain DIR
          [--renders none|quick|all|maps] [--tag rondas_revision/rN] [--no-ao] [--blend-name FILE.blend]

Every stone here sits on what carries it and shows no open rim: after a
change, run support_check.py (beside this file) on the saved .blend; it must
list nothing floating and no open rim before the GLBs ship.

A scrying house of the Court on the Glimmermere (door (-70, 792), Thornpeak
Heights). The door stands at the head of a steep gully that falls six yards to
a flat shelf of the old lake bed; the mere itself has sunk away into the pit
beyond the shelf, and what is left of it up here is what the Court's masonry
still holds. So the set piece is, from the far shore inward:

- the GLIMMER WEIR, a curved dam of pearl ashlar round the head of the pit,
  holding a shallow sheet of still water on the shelf (the MIRROR; the engine
  draws the water itself), with two spill notches;
- the two PENITENTS of the Pale Choir, robed and hooded, standing in the
  mirror either side of the stair's foot, stained to the old tide line;
- the MOON STAIR, a straight built flight with moulded nosings and worn
  treads climbing the gully between stepped cheek walls, a lunar phase inlaid
  in silver on every third tread, its piers carrying the COLONNADE (fluted
  drums with entasis: three standing, two broken, one fallen into the mirror);
- the MOONGATE on its dais: the same ring as the interior's Kit_Moongate
  (radius 5.2, 28 voussoirs, a rune on every second one, the crescent horns)
  sunk to its shoulders in the dais so the floor cuts its circle, the runes
  here the moon's phases waxing up one side to the full moon on the keystone
  and waning down the other;
- the MOON POOL on the terrace behind the gate: a round kerbed basin whose
  water (the engine's) shows a full moon at any hour, three leaning stelae
  behind it.

Local game coords via ec.B(lx, lz, y): lx = x + 70 (+x is WEST), lz = z - 792
(+z NORTH), y above terrainHeight at the door. Blender X = lx, Y = -lz, Z up;
the stair descends toward Blender +Y. Every glowing inlay carries its place
in the moonrise (0 the stair's drowned foot, 1 the gate's crown) in its colour
alpha: src/render/drowned_temple_entrance.ts lights them in that order.
"""
import contextlib
import json
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'kit'))
import entrance_common as ec  # noqa: E402
import temple_moon_kit as mk  # noqa: E402
from temple_moon_kit import GLOW, K_EARTH, K_GLOW, K_RAW, K_SILVER, STONE, Moon, mix, scale  # noqa: E402

B = ec.B
TAU = math.tau
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


OUT = arg('--out', os.path.join(HERE, 'out'))
TERRAIN = arg('--terrain', os.path.join(OUT, 'terreno'))
RENDERS = arg('--renders', 'none')
TAG = arg('--tag', '')
BLEND = arg('--blend-name', 'drowned_temple_entrance.blend')
os.makedirs(OUT, exist_ok=True)
GR = ec.Ground(os.path.join(TERRAIN, 'temple_heightgrid.json'))
SURR = json.load(open(os.path.join(TERRAIN, 'temple_surroundings.json')))
gh = GR.h

# ---- the levels (above the door's terrain height) and the plan ---------------
D = 0.8                # the dais floor
RING_C = D + 4.8       # the ring's centre: the full circle shows, its foot bedded in the dais
RING_R, R_IN, R_OUT, RING_Y = 5.2, 4.55, 5.85, 0.8
BLOCKS = 28
JOINT = 0.004          # half a ring joint, radians: a finger's width between the voussoirs
CORE_IN, CORE_Y = 0.12, 0.2    # how far the ring's core stands back from its radii and from its two faces
WATER = -5.85          # the mirror: the water the weir still holds on the shelf
TIDE = -3.95           # the old tide line, from when the mere stood full
ST_Z0 = -2.6           # the stair's head (lz), the dais' south edge
N_DRY, N_ALL = 23, 26  # risers down to the water, and treads in all
RISER = (D - WATER) / N_DRY
TREAD = 0.46
HS = 3.0               # the stair's half width between the cheeks
CHEEK = 0.7
FLARE_Z, FLARE = -10.88, 0.42   # south of this the flight fans out into the water
DAIS = dict(hw=7.2, z0=ST_Z0, z1=2.4)
POOL = dict(lx=0.0, lz=13.6, r=3.3)
# The weir's line, round the head of the pit (door-local lx, lz), west bank to east bank.
WEIR = [(13.6, -16.1), (9.6, -17.0), (5.6, -18.6), (3.4, -21.2), (2.7, -24.2), (0.3, -26.5), (-3.5, -27.8),
        (-9.0, -28.4), (-15.0, -28.3), (-19.5, -27.1), (-22.6, -24.4)]
NOTCHES = [(4, 0.55, 1.15), (7, 0.5, 0.9)]      # (segment, where along it, width)
PIERS = (0, 8, 16)                               # the cheek stages that are piers (their first tread)
STATUES = [(-6.7, -15.7, 'offering'), (6.7, -15.7, 'veil')]
BREACH = (4, 10)                                 # the west cheek is down beside these treads (Ondrel's way)
TAIL = 0.12                                      # how far a tread's end is built into the cheek wall
SUNK_TREADS = {(12, 1): (0.05, 0.02), (18, 0): (0.045, -0.025)}   # (tread, stone) -> (sunk, tilt); never a rune tread
# The colonnade stands on the gully's shoulders, outside the cheeks and inside the ring's own width.
COLUMNS = [(5.2, -4.6, 'whole'), (-5.2, -4.6, 'whole'), (5.2, -8.6, 'whole'), (-5.2, -8.6, 'broken'),
           (5.2, -12.4, 'stump'), (-5.2, -12.4, 'fallen')]
FLANKS = {}                                      # side (-1 east, 1 west) -> the flank's piece
RING_FACES = {}                                  # voussoir -> (half depth, slip along Y, extrados): what grows on the ring lies on these
COPINGS = {}                                     # weir segment -> [(along, half length)] of the coping stones still there
STATUE_M = {}                                    # (lx, lz) -> a penitent's placement, for what grows on it
SHAFTS = {}                                      # (lx, lz) -> a column's standing drums' offsets and where moss sits on its top
MISSING_COPINGS = ((1, 2), (-1, 12), (-1, 6))    # (side, stage): the cheek copings that have slid off
COLLIDERS = []
FOOTINGS = []
SOCKETS = {'stair_runes': [], 'ring_runes': [], 'pool_runes': [], 'glints': [], 'falls': [], 'lilies': [],
           'drips': []}


def tread_top(k):
    return D - (k + 1) * RISER


def stair_half(lz):
    return HS if lz >= FLARE_Z else HS + (FLARE_Z - lz) * FLARE


def walk(lx, lz):
    """The walk surface the sim lifts (src/sim/drowned_temple_entrance.ts):
    the dais floor, the stair's ramp through its tread centres, else terrain."""
    g = gh(lx, lz)
    if DAIS['z0'] <= lz <= DAIS['z1']:
        over = abs(lx) - DAIS['hw']
        if over <= 0:
            return max(g, D)
        return max(g, D - over * 0.6)
    z_end = ST_Z0 - N_ALL * TREAD
    if z_end <= lz < ST_Z0 and abs(lx) <= stair_half(lz):
        return max(g, D - ((ST_Z0 - lz) / TREAD + 0.5) * RISER)
    return g


def gb(x, y):
    """Ground height at a Blender XY."""
    return gh(x, -y)


def collider_obb(name, cx, cz, hw, hd, rot, top):
    COLLIDERS.append({'name': name, 'type': 'obb', 'lx': round(cx, 3), 'lz': round(cz, 3), 'hw': round(hw, 3),
                      'hd': round(hd, 3), 'rot': round(rot, 4), 'top': round(top, 2)})


def collider_circle(name, cx, cz, r, top):
    COLLIDERS.append({'name': name, 'type': 'circle', 'lx': round(cx, 3), 'lz': round(cz, 3), 'r': round(r, 3),
                      'top': round(top, 2)})


def footing(name, cx, cz, hw, hd, rot, bury):
    """Register a footing and return its underside: `bury` under the lowest
    ground anywhere under it (a half-yard grid, the one the sim test samples)."""
    lo = GR.footprint_range(cx, cz, hw, hd, rot, 0.5)[0]
    FOOTINGS.append((name, cx, cz, hw, hd, rot, lo - bury))
    return lo - bury


def P(name, **kw):
    kw.setdefault('water', WATER)
    kw.setdefault('tide', TIDE)
    return Moon(name, **kw)


def RZ(a):
    return Matrix.Rotation(a, 4, 'Z')


@contextlib.contextmanager
def own_stream(p, key):
    """Build with a random stream of its own: a stone added later leaves every
    stone already placed exactly where it was."""
    was, p.rng = p.rng, random.Random(key)
    try:
        yield
    finally:
        p.rng = was


# ================================================================= the moongate
def ring_angle(k):
    """Centre angle of voussoir k: the keystone (k 7) at the crown."""
    return math.pi / 2 + (k - 7) * TAU / BLOCKS


def moongate():
    p = P('Entrance_Moongate', moss=0.9)
    rng = p.rng
    cb = Vector((0.0, 0.0, RING_C))
    step = TAU / BLOCKS
    slipped = {3: (-0.07, 0.05, 0.012), 12: (0.05, -0.06, -0.01), 16: (-0.05, 0.07, 0.0)}
    for k in range(BLOCKS):
        am = ring_angle(k)
        a0, a1 = am - step / 2, am + step / 2
        if RING_C + R_IN * max(math.sin(a0), math.sin(a1)) < D + 0.3:
            continue                       # bedded in the dais, under the threshold
        key = k == 7
        proud = 0.06 if key else (rng.random() - 0.5) * 0.07
        r0 = R_IN - (0.05 if key else 0.0) + (rng.random() - 0.5) * 0.02
        r1 = R_OUT + (0.3 if key else (rng.random() - 0.5) * 0.05)
        y1 = RING_Y + proud
        col = p.tone(k * 1.7, 4.0)
        if key:
            col = mix(col, mk.PEARL_PALE, 0.5)
        p.wedge(cb, r0, r1, a0, a1, -y1, y1, col, shift=slipped.get(k, (0, 0, 0)), pillow=0.012, knock=0.2, gap=JOINT,
                true_faces=k % 2 == 1, sound=True)
        sh = slipped.get(k, (0, 0, 0))
        RING_FACES[k] = (y1, sh[1], r1 + sh[0])
        for (sgn, yy) in ((1, y1 + sh[1]), (-1, -y1 + sh[1])):
            # the two archivolt mouldings on each face
            p.arc_band(cb, r0 + 0.07 + sh[0], r0 + 0.31 + sh[0], a0 + 0.014 + sh[2], a1 - 0.014 + sh[2], yy, sgn * 0.075,
                       scale(col, 1.03), sink=0.07, steps=1)
            p.arc_band(cb, r1 - 0.30 + sh[0], r1 - 0.06 + sh[0], a0 + 0.014 + sh[2], a1 - 0.014 + sh[2], yy, sgn * 0.06,
                       scale(col, 0.98), sink=0.07, steps=1)
        if k % 2 == 1:
            # the rune: the moon's phase, waxing up the east side to the full
            # moon on the keystone and waning down the west
            dist = abs(k - 7) / 2.0             # 0 the crown ... 3 the lowest pair that shows
            phase = max(0.0, 1.0 - dist * 0.26)
            order = 0.56 + 0.4 * phase if phase > 0.3 else 0.52
            live = k not in (1, 15)
            rr = RING_R + (0.12 if key else 0.0) + sh[0]
            rad = 0.34 if key else 0.25
            up = Vector((math.cos(am), 0, math.sin(am)))
            ctr = cb + up * rr
            for sgn in (1, -1):
                # (a finger proud of the true face: clear of the face's pillowed heart)
                p.phase_disc(ctr + Vector((0, sgn * y1 + sh[1] + sgn * 0.02, 0)), (0, sgn, 0), up, rad, phase, order,
                             live=live, waning=(k > 7) == (sgn > 0))
            if live:
                SOCKETS['ring_runes'].append([round(ctr.x, 3), round(ctr.z, 3), round(-(y1 + 0.03), 3), round(order, 3),
                                              round(rad, 3)])
    # the ring's core: the rubble heart the voussoirs face. It closes every
    # joint a hand deep, so an open joint shows dark stone and never the sky,
    # and it is what ties the ring's stones to one another and to the dais.
    core = scale(mk.PEARL_DARK, 0.4)
    ca, cbr, cy = R_IN + CORE_IN, R_OUT - CORE_IN, RING_Y - CORE_Y
    seg = BLOCKS * 2
    for i in range(seg):
        a0, a1 = TAU * i / seg, TAU * (i + 1) / seg
        q = [[cb + Vector((math.cos(a) * r, y, math.sin(a) * r)) for (r, y) in ((ca, cy), (cbr, cy), (cbr, -cy), (ca, -cy))]
             for a in (a0, a1)]
        am = (a0 + a1) / 2
        out = Vector((math.cos(am), 0, math.sin(am)))
        for (e, want) in ((0, (0, 1, 0)), (1, out), (2, (0, -1, 0)), (3, -out)):
            f = (e + 1) % 4
            p.face((q[0][e], q[0][f], q[1][f], q[1][e]), core, want=want)
    # the crescent horns on the crown: the interior ring's own silhouette
    for s in (-1, 1):
        base = cb + Vector((s * 1.25, 0, R_OUT - 0.25))
        pts = p.bezier(base, cb + Vector((s * 3.15, 0, R_OUT + 1.75)), cb + Vector((s * 1.95, 0, R_OUT + 3.05)), steps=6)
        pts += p.bezier(pts[-1], cb + Vector((s * 1.55, 0, R_OUT + 3.6)), cb + Vector((s * 0.95, 0, R_OUT + 3.72)), steps=3)[1:]
        if s < 0:
            pts = pts[:-2]                 # the east horn has lost its tip
        rings, n = [], len(pts)
        for i, q in enumerate(pts):
            t = i / (len(pts) - 1 if s > 0 else len(pts) + 1)
            tan = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            e2 = tan.cross(Vector((0, 1, 0))).normalized()
            r = 0.62 * (1 - t) ** 0.8 + 0.07
            ph = 0.35 * i
            rings.append([q + (Vector((0, 1, 0)) * math.cos(ph + TAU * j / 6) * 0.8 + e2 * math.sin(ph + TAU * j / 6)) * r *
                          (0.94 + 0.12 * rng.random()) for j in range(6)])
        col = mix(mk.PEARL_WARM, mk.PEARL_PALE, 0.4)
        p.loft(rings, col, smooth_face=False, cap0=True, cap1=True,
               cols=lambda i, kk: scale(col, 0.86 + 0.2 * ((i * 7 + kk * 3) % 5) / 5))
        if s > 0:
            # the silver sheath on the whole horn's tip still holds the light
            tip = pts[-1]
            with p.as_kind(K_GLOW):
                p.loft([[q + (q - sum(ring, Vector()) / 6) * 0.12 for q in ring] for ring in rings[-3:]], mk.MOON, mat=GLOW,
                       smooth_face=False, alpha=1.0)
            SOCKETS['horn_tip'] = [round(tip.x, 3), round(tip.z, 3), 0.0]
        # the horn's seat: stepped blocks on the crown either side of the keystone
        p.block(cb + Vector((s * 1.25, 0, R_OUT + 0.12)), (1.5, 1.5, 0.5), p.tone(s * 3.0, 9.0), skip=(5,), bed=True, pillow=0.02)
        p.block(cb + Vector((s * 1.3, 0, R_OUT + 0.55)), (1.05, 1.2, 0.42), p.tone(s * 4.0, 10.0), skip=(5,), bed=True, pillow=0.02)
    # the fallen horn tip lies on the dais
    m = p.mark()
    p.loft([[Vector((math.cos(TAU * j / 6) * r, math.sin(TAU * j / 6) * r * 0.8, z)) for j in range(6)]
            for (r, z) in ((0.2, 0.0), (0.15, 0.32), (0.06, 0.62))], mk.PEARL_WARM, smooth_face=False, cap0=True, cap1=True)
    p.turn(m, Matrix.Translation(B(-5.3, -1.5, D + 0.13)) @ Matrix.Rotation(1.45, 4, 'X') @ RZ(0.7))
    # the cradle: stepped blocks hugging the ring where it rises out of the dais
    for s in (-1, 1):
        p.block(B(s * 3.95, 0, D + 0.42), (2.1, 2.4, 1.04), p.tone(s * 2.0, 0.0), chip=0.04, skip=(5,), bed=True, pillow=0.012)
        p.block(B(s * 4.95, 0, D + 1.32), (1.3, 2.1, 0.78), p.tone(s * 2.0, 1.0), chip=0.05, skip=(5,), bed=True, pillow=0.012)
        # (the cradle's lip: a pale fillet along its inner arris, wholly on the block that carries it)
        p.block(B(s * 3.09, 0, D + 1.0), (0.34, 2.34, 0.13), mk.PEARL_PALE, chip=0.03, skip=(5,), pillow=0.0, bed=True)
        collider_obb(f'moongate_foot_{"w" if s > 0 else "e"}', s * 3.75, 0, 2.2, 1.15, 0.0, RING_C + 2.0)
    # the threshold: the sill that fills the circle's foot, a step up to it on either side
    p.block(B(0, 0, D + 0.2), (3.0, 2.0, 0.6), mix(p.tone(0, 0), mk.PEARL_PALE, 0.5), chip=0.03, skip=(5,), bed=True, pillow=0.0)
    for sz in (-1, 1):
        p.block(B(0, sz * 1.27, D + 0.085), (3.5, 0.56, 0.33), p.tone(sz, 0.0), chip=0.04, skip=(5,), bed=True, pillow=0.0)
    p.inlay(B(-1.3, -0.72, D + 0.504), B(1.3, -0.72, D + 0.504), 0.07, (0, 0, 1), 0.5, live=False)
    p.phase_disc(B(0, 0, D + 0.506), (0, 0, 1), (0, -1, 0), 0.36, 0.5, 0.5, live=True)
    SOCKETS['ring_runes'].append([0.0, round(D + 0.55, 3), 0.0, 0.5, 0.36])
    # the dais: its body and its paving
    hw, z0, z1 = DAIS['hw'], DAIS['z0'], DAIS['z1']
    base = footing('dais', 0, (z0 + z1) / 2, hw, (z1 - z0) / 2, 0.0, 0.6)
    body_top = D - 0.24
    rows = max(2, int((body_top - base) / 0.5))
    hc = (body_top - base) / rows
    for j in range(rows):
        y = base + (j + 0.5) * hc
        for (ax0, ax1, face_z, face) in ((-hw, hw, z0, 0), (-hw, hw, z1, 2)):
            x = ax0 + (0.4 if j % 2 else 0.0)
            while x < ax1 - 0.05:
                ln = min(ax1 - x, 1.0 + rng.random() * 0.9)
                if face == 0 and abs(x + ln / 2) < HS + CHEEK - 0.3:
                    x += ln
                    continue              # behind the stair's head
                if y + hc / 2 > gh(x + ln / 2, face_z) - 0.25:
                    p.block(B(x + ln / 2, face_z + (0.34 if face == 0 else -0.34), y), (ln, 0.72, hc), p.tone(x, y),
                            skip=(5,), bed=True, joint=(1, 3), pillow=0.02)
                x += ln
        for s in (-1, 1):
            z = z0 + (0.35 if j % 2 else 0.0)
            while z < z1 - 0.05:
                ln = min(z1 - z, 0.95 + rng.random() * 0.8)
                if y + hc / 2 > gh(s * hw, z + ln / 2) - 0.25:
                    p.block(B(s * (hw - 0.34), z + ln / 2, y), (ln, 0.72, hc), p.tone(z, y), rot=RZ(math.pi / 2),
                            skip=(5,), bed=True, joint=(1, 3), pillow=0.02)
                z += ln
    # the cornice under the paving, all round
    for (a, b) in (((-hw - 0.06, z0 - 0.06), (hw + 0.06, z0 - 0.06)), ((-hw - 0.06, z1 + 0.06), (hw + 0.06, z1 + 0.06))):
        n = 9
        for i in range(n):
            x0 = a[0] + (b[0] - a[0]) * i / n
            x1 = a[0] + (b[0] - a[0]) * (i + 1) / n
            if a[1] < 0 and abs((x0 + x1) / 2) < HS + CHEEK:
                continue
            p.block(B((x0 + x1) / 2, a[1] + (0.2 if a[1] < 0 else -0.2), D - 0.15), (x1 - x0, 0.56, 0.2),
                    scale(mk.PEARL_PALE, 0.97), chip=0.04, skip=(5,), joint=(1, 3), pillow=0.0, bed=True)
    for s in (-1, 1):
        for i in range(4):
            za = z0 + (z1 - z0) * i / 4
            zb = z0 + (z1 - z0) * (i + 1) / 4
            p.block(B(s * (hw - 0.14), (za + zb) / 2, D - 0.15), (zb - za, 0.56, 0.2), scale(mk.PEARL_PALE, 0.97),
                    rot=RZ(math.pi / 2), chip=0.04, skip=(5,), joint=(1, 3), pillow=0.0, bed=True)
    # the bedding course under the ring's band of the floor (the ring, its
    # cradle and its sill stand on it; no slab is laid there), and the sill
    # the paving's edge lies on at the stair's head, which is the top riser
    bedc = scale(mk.PEARL_DARK, 0.62)
    p.face((B(-hw + 0.3, -0.97, D - 0.03), B(hw - 0.3, -0.97, D - 0.03), B(hw - 0.3, 0.97, D - 0.03),
            B(-hw + 0.3, 0.97, D - 0.03)), bedc, want=(0, 0, 1))
    for sz in (-1, 1):
        p.face((B(-hw + 0.3, sz * 0.97, D - 0.03), B(hw - 0.3, sz * 0.97, D - 0.03), B(hw - 0.3, sz * 0.97, D - 0.21),
                B(-hw + 0.3, sz * 0.97, D - 0.21)), scale(bedc, 0.8), want=(0, -sz, 0))
    p.face((B(-hw + 0.2, z0 + 0.1, D - 0.21), B(hw - 0.2, z0 + 0.1, D - 0.21), B(hw - 0.2, z1 - 0.1, D - 0.21),
            B(-hw + 0.2, z1 - 0.1, D - 0.21)), scale(bedc, 0.7), want=(0, 0, 1))
    with own_stream(p, 'stair head sill'):
        p.block(B(0, z0 + 0.27, D - 0.365), (2 * HS + 0.2, 0.5, 0.3), p.tone(0.0, 5.0), chip=0.02, skip=(5,), bed=True,
                pillow=0.0, knock=0.0)
    # the paving: big slabs in three bands, a few sunk, one cracked away to earth
    bands = [(z0 + 0.02, -0.95), (-0.95, 0.95), (0.95, z1 - 0.02)]
    sunk = {(0, 3): (0.05, 0.02), (2, 5): (0.07, -0.03), (0, 8): (0.04, 0.03), (1, 1): (0.03, -0.02)}
    for bi, (za, zb) in enumerate(bands):
        x = -hw + 0.3
        i = 0
        while x < hw - 0.35:
            ln = min(hw - 0.3 - x, 1.25 + rng.random() * 0.95)
            if hw - 0.3 - (x + ln) < 0.6:
                ln = hw - 0.3 - x
            cx = x + ln / 2
            under_ring = bi == 1 and abs(cx) < 6.0                 # the ring, its cradle and its sill stand here
            gone = (bi, i) == (2, 2)
            if not under_ring and not gone:
                dz, tl = sunk.get((bi, i), (0.0, 0.0))
                c = p.tone(cx * 0.8, bi * 3.0)
                p.block(B(cx, (za + zb) / 2, D - 0.11 - dz), (ln - 0.035, zb - za - 0.035, 0.22), c, chip=0.035,
                        rot=Matrix.Rotation(tl, 4, 'Y'), skip=(5,), pillow=0.0, pillows=())
            elif gone:
                with p.as_kind(K_EARTH):
                    p.face((B(x, za, D - 0.2), B(x + ln, za, D - 0.2), B(x + ln, zb, D - 0.2), B(x, zb, D - 0.2)), mk.SOIL,
                           want=(0, 0, 1))
            x += ln
            i += 1
    return p


# =============================================================== the moon stair
def moon_stair():
    p = P('Entrance_MoonStair', moss=1.0)
    rng = p.rng
    # ---- the treads
    for k in range(N_ALL):
        top = tread_top(k)
        yb = -(ST_Z0 - k * TREAD)                 # Blender y of the tread's back
        yf = yb + TREAD
        lzf = -yf
        half = stair_half(lzf) - (0.0 if lzf >= FLARE_Z else 0.02)
        flared = lzf < FLARE_Z
        last = k == N_ALL - 1
        gmin = min(gh(x, lzf) for x in (-half, 0.0, half))
        bottom = (gmin - 0.5) if last else top - RISER - 0.17
        cuts = sorted([-half, half] + [(-half + 2 * half * (i + 1) / 3) + (rng.random() - 0.5) * 1.1 for i in range(2)])
        if rng.random() < 0.3:
            cuts.pop(1)
        breach = BREACH[0] <= k < BREACH[1]
        for i in range(len(cuts) - 1):
            x0, x1 = cuts[i], cuts[i + 1]          # (the stones butt: a tread shows no slit into the flight's hollow)
            c = p.tone(k * 0.9 + i * 2.3, k * 0.4)
            sink = 0.0
            tilt = 0.0
            if (k, i) in ((6, 0), (13, 1), (19, 0), (21, 1)):
                sink, tilt = 0.035 + 0.03 * rng.random(), (rng.random() - 0.5) * 0.07
            rune = k % 3 == 1
            if rune:
                sink, tilt = 0.0, 0.0           # a rune tread is kept true: its silver lies in the stone
            elif (k, i) in SUNK_TREADS:
                sink, tilt = SUNK_TREADS[(k, i)]
            lastx = i == len(cuts) - 2
            # a tread with a sunk stone shows the ends of its stones at the step between them
            stepped = k in (6, 21) or any(kk == k for (kk, _i) in SUNK_TREADS)
            ends = (stepped or (flared and i == 0), stepped or ((flared or breach) and lastx))
            # between the cheeks a tread's two ends are built a hand into the walls (no slit beside
            # it where a wall stone has lost a corner); in the breach it runs out past the fallen wall
            segs = max(2, int((x1 - x0 - 0.024) / 0.6))
            xa = x0 - (TAIL if i == 0 and not flared else 0.0)
            xb = x1 + (0.9 if breach and lastx else TAIL if lastx and not flared else 0.0)
            p.tread(xa, xb, yf, TREAD + 0.03, top, bottom, c, segs=segs, ends=ends, sink=sink, tilt=tilt,
                    end_bottom=min(gh(x0, lzf), gh(x1 + 1.0, lzf), gh(x0, lzf + TREAD)) - 0.5,
                    wear=0.006 if rune else (0.04 if not flared else 0.02),
                    back=flared or (breach and lastx and k == BREACH[0]))
        # a lunar phase in silver on every third tread, waxing as the flight climbs
        if k % 3 == 1:
            idx = (k - 1) // 3                     # 0 the top rune ... 8 the drowned one
            order = 0.47 * (1 - idx / 8.0)
            phase = 0.92 - idx * 0.105
            live = idx not in (2, 5)
            yc = yf - 0.19
            zc = top + 0.006
            p.phase_disc(Vector((0, yc, zc)), (0, 0, 1), (0, -1, 0), 0.17, phase, order, live=live)
            for s in (-1, 1):
                p.inlay(Vector((s * 0.34, yc, zc)), Vector((s * 1.3, yc, zc)), 0.05, (0, 0, 1), order, live=False)
                p.disc(Vector((s * 1.47, yc, zc)), (0, 0, 1), 0.075, mk.SILVER_TARN, sides=6)
            if live:
                SOCKETS['stair_runes'].append([0.0, round(zc, 3), round(-yc, 3), round(order, 3), 0.17])
        if top < WATER + 1.1 and top > WATER - 0.1:
            # the wet treads by the water catch the light
            for i in range(3):
                SOCKETS['glints'].append([round((rng.random() - 0.5) * 2 * (half - 0.3), 3), round(top + 0.01, 3),
                                          round(-(yf - 0.06 - rng.random() * 0.3), 3)])
    footing('stair', 0, ST_Z0 - N_ALL * TREAD / 2, HS, N_ALL * TREAD / 2, 0.0, 0.5)
    # ---- the stepped cheek walls and their piers, each on its own flank
    treads = p
    for s in (-1, 1):
        p = FLANKS[s]
        rng = p.rng
        for k in range(0, 18, 2):
            pier = k in PIERS
            gap = s > 0 and BREACH[0] <= k < BREACH[1]
            zn = ST_Z0 - k * TREAD
            zs = zn - 2 * TREAD
            top = tread_top(k) + (1.25 if pier else 0.52)
            if gap:
                top = tread_top(k + 1) - 0.05          # the breach: the wall is down to the treads
            x0, x1 = (HS - 0.12, HS + 0.98) if pier else (HS, HS + CHEEK)
            zn2, zs2 = (zn + 0.09, zs - 0.09) if pier else (zn, zs)
            cx = s * (x0 + x1) / 2
            cz = (zn2 + zs2) / 2
            lo = footing(f'{"pier" if pier else "cheek"}_{"w" if s > 0 else "e"}_{k}', cx, cz, (x1 - x0) / 2,
                         (zn2 - zs2) / 2, 0.0, 0.5)
            cap = 0.0 if gap else 0.22
            n = max(1, round((top - cap - lo) / 0.44))
            hc = (top - cap - lo) / n
            for j in range(n):
                yb = lo + j * hc
                if yb + hc < min(gh(cx, zn2), gh(cx, zs2), gh(s * x1, cz), walk(s * (x0 - 0.3), cz)) - 0.3:
                    continue              # wholly buried
                cut = (zn2 - zs2) * (0.5 + (rng.random() - 0.5) * 0.3) if (j % 2 == 0 or pier) else None
                spans = [(zs2, zs2 + cut), (zs2 + cut, zn2)] if cut else [(zs2, zn2)]
                for (a, b) in spans:
                    p.block(B(cx, (a + b) / 2, yb + hc / 2), (b - a - 0.02, x1 - x0, hc - 0.012), p.tone(a * 1.3, yb),
                            rot=RZ(math.pi / 2), skip=(5,), bed=True, pillow=0.022, chip=0.05, knock=0.5 if gap else 0.12)
            if gap:
                continue
            missing = (s, k) in MISSING_COPINGS
            if not missing:
                cc = mix(p.tone(k, 9.0), mk.PEARL_PALE, 0.35)
                tl = (rng.random() - 0.5) * (0.05 if not pier else 0.0)
                p.block(B(cx, cz, top - cap / 2), (zn2 - zs2 + 0.1, x1 - x0 + 0.12, cap), cc, rot=RZ(math.pi / 2) @
                        Matrix.Rotation(tl, 4, 'X'), skip=(5,), pillow=0.0, chip=0.05, bed=True)
            else:
                # the coping stone has slid off and lies on the bank
                ox = s * (x1 + 0.75)
                p.block(B(ox, cz - 0.2, gh(ox, cz - 0.2) + 0.05), (0.95, 0.8, 0.22), p.tone(k, 9.0),
                        rot=RZ(0.5 * s) @ Matrix.Rotation(0.32 * s, 4, 'Y'), pillow=0.0, chip=0.07)
            if pier:
                # the pier's finial: a ball on a neck, the Court's crescent cradling it
                q = B(cx, cz, top)
                p.lathe((q.x, q.y, top), [(0.3, 0), (0.22, 0.08), (0.2, 0.2), (0.3, 0.3), (0.34, 0.44), (0.28, 0.6), (0.12, 0.7),
                                          (0.0, 0.72)], 10, mix(mk.PEARL_PALE, mk.PEARL_WARM, 0.4), smooth=True)
                if (s, k) != (-1, 16):
                    for s2 in (-1, 1):
                        pts = p.bezier(Vector((q.x, q.y + s2 * 0.12, top + 0.68)), Vector((q.x, q.y + s2 * 0.5, top + 0.95)),
                                       Vector((q.x, q.y + s2 * 0.26, top + 1.32)), steps=4)
                        with p.as_kind(K_SILVER):
                            p.sweep(pts, 0.085, 0.02, mk.SILVER_BRIGHT, sides=5)
        zn, zs = ST_Z0, ST_Z0 - 18 * TREAD
        if s > 0:
            za, zb = ST_Z0 - BREACH[0] * TREAD, ST_Z0 - BREACH[1] * TREAD
            collider_obb('cheek_w_upper', s * (HS + CHEEK / 2 + 0.05), (zn + za) / 2, CHEEK / 2 + 0.1, (zn - za) / 2, 0.0, D + 1.4)
            collider_obb('cheek_w_lower', s * (HS + CHEEK / 2 + 0.05), (zb + zs) / 2, CHEEK / 2 + 0.1, (zb - zs) / 2, 0.0, D - 1.6)
        else:
            collider_obb('cheek_e', s * (HS + CHEEK / 2 + 0.05), (zn + zs) / 2, CHEEK / 2 + 0.1, (zn - zs) / 2, 0.0, D + 1.4)
    return treads


def drum_ring(c, r, flutes, z, ph=0.0, depth=0.085):
    """One ring of a fluted drum: arris, flute, arris..."""
    out = []
    for i in range(flutes * 2):
        a = ph + TAU * i / (flutes * 2)
        rr = r if i % 2 == 0 else r * (1 - depth)
        out.append(Vector((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, z)))
    return out


def shaft_r(t, r0=0.47):
    """Entasis: the shaft swells a touch to a third of its height, then tapers."""
    return r0 * (1.0 + 0.045 * math.sin(min(1.0, t / 0.36) * math.pi / 2) - 0.2 * max(0.0, t - 0.2) ** 1.25)


def drum(p, c, z0, z1, t0, t1, col, flutes=12, ph=0.0, r0=0.47, M=None, cap=(False, False), bedded=0.0):
    """One drum of a shaft. `bedded` carries its two ends that far past its
    joints, so a standing drum is set in the one under it: no open slit at
    the joint, and its closed ends hide where the flutes do not line up."""
    rings = [drum_ring(c, shaft_r(t0, r0) * 0.985, flutes, z0 + 0.012 - bedded, ph),
             drum_ring(c, shaft_r(t0, r0), flutes, z0 + 0.04, ph),
             drum_ring(c, shaft_r(t1, r0), flutes, z1 - 0.04, ph),
             drum_ring(c, shaft_r(t1, r0) * 0.985, flutes, z1 - 0.012 + bedded, ph)]
    if M is not None:
        rings = [[M @ q for q in ring] for ring in rings]
    n = flutes * 2
    # (a standing drum's two beds lie in the joint: dark, so the sliver of one that shows
    # where the flutes of two drums do not line up reads as the joint's shadow)
    p.loft(rings, col, smooth_face=False, cap0=cap[0], cap1=cap[1], cap_color=scale(col, 0.4) if bedded else None,
           cols=lambda i, kk: scale(col, (1.04 if kk % 2 == 0 else 0.80) * (0.9 if i in (0, 3) else 1.0)))
    return n


def column(p, lx, lz, state):
    """A votive column: a stepped plinth bedded in the bank, an attic base, a
    fluted shaft of drums with entasis, and for the ones still whole a capital
    carrying the Court's crescent. state: whole, broken, stump or fallen."""
    rng = p.rng
    side = 1 if lx > 0 else -1
    name = f'column_{"w" if side > 0 else "e"}_{abs(round(lz))}'
    pts = [(lx + u, lz + v) for u in (-0.85, 0, 0.85) for v in (-0.85, 0, 0.85)]
    hi = max(gh(x, z) for (x, z) in pts)
    lo = footing(name, lx, lz, 0.85, 0.85, 0.0, 0.55)
    c = B(lx, lz, 0)
    col0 = mix(mk.PEARL, mk.PEARL_PALE, 0.3)
    base_y = hi + 0.62
    # the plinth: a bedded footing course, the die, a moulded cap
    p.block(B(lx, lz, (lo + hi + 0.12) / 2), (1.9, 1.9, hi + 0.12 - lo), p.tone(lx, 1.0), skip=(5,), bed=True, pillow=0.012, chip=0.04)
    p.block(B(lx, lz, hi + 0.27), (1.5, 1.5, 0.56), p.tone(lx, 2.0), skip=(5,), bed=True, pillow=0.02, chip=0.045)
    p.block(B(lx, lz, base_y - 0.05), (1.66, 1.66, 0.14), mk.PEARL_PALE, skip=(5,), pillow=0.0, chip=0.04, knock=0.4,
            bed=True)
    p.phase_disc(B(lx, lz, 0) + Vector((0, 0.755, hi + 0.33)), (0, 1, 0), (0, 0, 1), 0.13, 0.5, 0.2, live=False)
    # the attic base: plinth, torus, scotia, torus
    p.block(B(lx, lz, base_y + 0.1), (1.2, 1.2, 0.2), p.tone(lx, 3.0), skip=(5,), bed=True, pillow=0.0, chip=0.04)
    p.lathe((c.x, c.y, base_y + 0.2), [(0.58, 0), (0.62, 0.06), (0.58, 0.13), (0.51, 0.17), (0.51, 0.22), (0.55, 0.27),
                                       (0.51, 0.33), (0.48, 0.35)], 16, col0, smooth=True)
    z = base_y + 0.55
    full_h = 6.2
    drums = 5
    dh = full_h / drums
    n_stand = {'whole': 5, 'broken': 2, 'stump': 3, 'fallen': 0}[state]
    lean = {'stump': (0.03, 0.02)}.get(state, (0, 0))
    top = z
    shaft = SHAFTS[(lx, lz)] = {'z': z, 'dh': dh, 'offs': [], 'moss': None}
    for i in range(n_stand):
        cc = mix(p.tone(lx + i, lz), col0, 0.5)
        off = Vector(((rng.random() - 0.5) * 0.03 + lean[0] * i, (rng.random() - 0.5) * 0.03 + lean[1] * i, 0))
        shaft['offs'].append(off)
        last_broken = state in ('broken', 'stump') and i == n_stand - 1
        z1 = z + dh * (i + 1)
        if last_broken:
            # the break: a ragged top
            rings = [drum_ring(c + off, shaft_r(i / drums), 12, z + dh * i - 0.006, 0.2 * i)]
            rag = [q + Vector((0, 0, dh * (0.35 + 0.6 * rng.random()))) for q in
                   drum_ring(c + off, shaft_r((i + 0.6) / drums), 12, z + dh * i, 0.2 * i)]
            rings.append(rag)
            p.loft(rings, cc, smooth_face=False, cap0=True, cap_color=scale(cc, 0.4),
                   cols=lambda ii, kk, cc=cc: scale(cc, 1.04 if kk % 2 == 0 else 0.8))
            ctr = c + off + Vector((0, 0, z + dh * (i + 0.42)))
            for kk in range(len(rag)):
                p.face((rag[kk], rag[(kk + 1) % len(rag)], ctr), scale(mk.PEARL_PALE, 0.92), want=(0, 0, 1))
            shaft['moss'] = (ctr, 0.14)
            top = z + dh * (i + 0.9)
        else:
            drum(p, c + off, z + dh * i, z1, i / drums, (i + 1) / drums, cc, ph=0.2 * i + 0.1 * rng.random(),
                 cap=(True, True), bedded=0.018)
            top = z1
    if state == 'whole':
        # the capital: necking, echinus, abacus, and the crescent the Court set on it
        # (the echinus runs a finger into the abacus, whose bed lies on it: seen
        # from the stair below, the slab rests on the bell all the way round)
        p.lathe((c.x, c.y, top - 0.004), [(0.385, 0), (0.41, 0.054), (0.385, 0.104), (0.45, 0.204), (0.62, 0.364),
                                          (0.66, 0.44)], 16, mix(col0, mk.PEARL_WARM, 0.5), smooth=True)
        p.block(Vector((c.x, c.y, top + 0.52)), (1.36, 1.36, 0.2), mk.PEARL_PALE, skip=(5,), pillow=0.0, chip=0.06,
                knock=0.5, bed=True)
        shaft['moss'] = (Vector((c.x + 0.3, c.y + 0.3, top + 0.616)), 0.2)
        for s2 in (-1, 1):
            pts = p.bezier(Vector((c.x + s2 * 0.2, c.y, top + 0.62)), Vector((c.x + s2 * 0.66, c.y, top + 0.98)),
                           Vector((c.x + s2 * 0.3, c.y, top + 1.4)), steps=4)
            with p.as_kind(K_SILVER):
                p.sweep(pts, 0.12, 0.025, mk.SILVER_BRIGHT, sides=5)
        top += 1.4
    if state == 'fallen':
        # its drums lie where they rolled, off the bank and into the mirror
        line = [(-6.9, -13.0, 0.35), (-8.5, -13.9, 0.2), (-10.3, -14.6, 0.6), (-12.1, -15.9, 0.05), (-13.4, -17.4, 0.9)]
        for i, (fx, fz, roll) in enumerate(line):
            yaw = math.atan2(-(line[min(i + 1, 4)][1] - line[max(i - 1, 0)][1]),
                             line[min(i + 1, 4)][0] - line[max(i - 1, 0)][0]) + (rng.random() - 0.5) * 0.5
            cy = max(gh(fx, fz), WATER - 0.3) + 0.3
            M = Matrix.Translation(B(fx, fz, cy)) @ RZ(yaw) @ Matrix.Rotation(math.pi / 2 + (rng.random() - 0.5) * 0.12, 4, 'Y') @ \
                Matrix.Rotation(roll * 3.0, 4, 'Z')
            cc = mix(p.tone(fx, fz), col0, 0.5)
            if i < 4:
                drum(p, (0, 0, 0), -dh / 2, dh / 2, (4 - i) / drums * 0.9, (5 - i) / drums * 0.9, cc, M=M, cap=(True, True))
            else:
                m = p.mark()
                p.lathe((0, 0, -0.3), [(0.385, 0), (0.45, 0.2), (0.62, 0.36), (0.66, 0.42)], 14, cc, smooth=True)
                p.block(Vector((0, 0, 0.22)), (1.36, 1.36, 0.2), mk.PEARL_PALE, pillow=0.0, chip=0.07, knock=0.6)
                p.turn(m, M)
        collider_circle('fallen_drums', -10.3, -14.7, 1.5, WATER + 1.1)
        # the plinth keeps the broken foot of its shaft
        rings = [drum_ring(c, shaft_r(0), 12, z - 0.006),
                 [q + Vector((0, 0, 0.25 + 0.4 * rng.random())) for q in drum_ring(c, shaft_r(0.05), 12, z)]]
        p.loft(rings, col0, smooth_face=False, cap0=True, cols=lambda ii, kk: scale(col0, 1.04 if kk % 2 == 0 else 0.8))
        for kk in range(24):
            p.face((rings[1][kk], rings[1][(kk + 1) % 24], c + Vector((0, 0, z + 0.3))), scale(mk.PEARL_PALE, 0.9),
                   want=(0, 0, 1))
        top = z + 0.6
    collider_circle(name, lx, lz, 0.95, top)
    SOCKETS.setdefault('columns', []).append([round(lx, 3), round(lz, 3), round(base_y, 3), round(top, 3), state])


# ================================================================ the penitents
def penitent_lean(z):
    """How far a penitent's figure leans forward at height z over its plinth."""
    return 0.0 if z < 2.45 else 0.55 * ((z - 2.45) / 1.15) ** 1.35


def penitent(p, lx, lz, pose, yaw, lean):
    """A penitent of the Pale Choir in pearl stone: robed, cowled, the head
    bowed; 'offering' holds a silver crescent in both hands under the bowed
    face, 'veil' hides the face in the hands. Five yards from the plinth, on a
    drowned stepped plinth; modelled facing Blender +Y (south), then turned."""
    rng = p.rng
    m = p.mark()
    seg = 36
    folds = 9
    col = mix(mk.PEARL, mk.PEARL_COOL, 0.2)
    famp = [0.6 + 0.8 * rng.random() for _ in range(folds)]
    ftop = [1.6 + 1.6 * rng.random() for _ in range(folds)]      # where each fold dies out

    lean_y = penitent_lean

    def fold(i, z, amp):
        """How far the cloth stands out at vertex i of a ring at height z."""
        x = math.pi * folds * i / seg + 0.35
        f = abs(math.cos(x)) ** 0.5 * 2.0 - 1.25
        fi = int((folds * i / seg + 0.5 + 0.35 / math.pi)) % folds
        live = max(0.12, min(1.0, (ftop[fi] - z) / 1.2 + 0.4))
        return 1 + amp * f * famp[fi] * live

    def robe_ring(z, rx, ry, amp, hem=0.0):
        ring = []
        for i in range(seg):
            a = TAU * i / seg
            k = fold(i, z, amp)
            front = 0.5 + 0.5 * math.sin(a)
            k *= 1 + 0.06 * front
            ring.append(Vector((math.cos(a) * rx * k, math.sin(a) * ry * k + lean_y(z),
                                z + hem * (0.5 + 0.5 * math.cos(math.pi * 2 * folds * i / seg + 0.7)))))
        return ring

    prof = [(-0.13, 1.10, 1.0, 0.2, 0.09), (0.28, 1.05, 0.95, 0.2, 0.02), (0.7, 0.98, 0.87, 0.18, 0), (1.2, 0.9, 0.78, 0.16, 0),
            (1.7, 0.81, 0.69, 0.13, 0), (2.1, 0.72, 0.6, 0.1, 0), (2.36, 0.65, 0.53, 0.06, 0), (2.5, 0.63, 0.5, 0.03, 0),
            (2.66, 0.69, 0.52, 0.04, 0), (2.9, 0.8, 0.56, 0.045, 0), (3.15, 0.9, 0.58, 0.04, 0), (3.36, 0.96, 0.55, 0.03, 0),
            (3.52, 0.9, 0.5, 0.02, 0), (3.66, 0.6, 0.4, 0.0, 0), (3.74, 0.34, 0.3, 0.0, 0)]
    rings = [robe_ring(*r) for r in prof]

    def robe_col(i, kk):
        x = math.pi * folds * kk / seg + 0.35
        f = abs(math.cos(x)) ** 0.5
        amp = prof[i][3] / 0.2
        return scale(col, 1.0 - 0.34 * amp * (1 - f) + 0.06 * amp * f)

    p.loft(rings, col, cols=robe_col, cap1=True)
    # the girdle: a knotted cord, its two ends hanging
    gz = 2.5
    for dz in (-0.07, 0.07):
        cord = [[Vector((q.x * kx, (q.y - lean_y(gz)) * kx + lean_y(gz), gz + dz + dd)) for q in robe_ring(gz, 0.66, 0.53, 0.0)]
                for (kx, dd) in ((0.94, -0.055), (1.07, -0.03), (1.07, 0.03), (0.94, 0.055))]
        p.loft(cord, scale(col, 0.86), smooth_face=True)
    for s in (-1, 1):
        x = s * 0.1
        pts = [Vector((x, 0.6, gz)), Vector((x + s * 0.04, 0.72, gz - 0.7)), Vector((x + s * 0.07, 0.84, gz - 1.45)),
               Vector((x + s * 0.06, 0.9, gz - 1.9))]
        p.sweep(pts, 0.06, 0.05, scale(col, 0.88), sides=5)
        p.rock(pts[-1] + Vector((0, 0, -0.1)), (0.2, 0.2, 0.3), scale(col, 0.84), jitter=0.1, subdivisions=1)
    p.rock(Vector((0, 0.62, gz)), (0.34, 0.26, 0.26), scale(col, 0.86), jitter=0.12, subdivisions=1)
    # the mantle of the cowl over the shoulders: a rolled, scalloped edge
    mant = []
    # (its first ring is inside the robe: the underside of the rolled edge)
    for (z, rx, ry, sc) in ((3.08, 0.84, 0.54, 0.0), (3.02, 1.04, 0.68, 0.07), (3.1, 1.1, 0.72, 0.07), (3.34, 1.06, 0.68, 0.0), (3.58, 0.84, 0.6, 0.0),
                            (3.78, 0.56, 0.48, 0.0), (3.92, 0.4, 0.4, 0.0)):
        mant.append([Vector((math.cos(TAU * i / seg) * rx * (1 + 0.045 * math.cos(7 * TAU * i / seg + 1.0)),
                             math.sin(TAU * i / seg) * ry + lean_y(z) + 0.03,
                             z + sc * math.cos(9 * TAU * i / seg + 0.4) - 0.12 * max(0.0, math.sin(TAU * i / seg)) * (z < 3.2)))
                     for i in range(seg)])
    p.loft(mant, scale(col, 1.04), cap1=True,
           cols=lambda i, kk: scale(col, (0.5 if i == 0 else 0.72 if i == 1 else 0.92) +
                                    0.16 * (0.5 + 0.5 * math.cos(7 * TAU * kk / seg + 1.0))))
    # the hooded head, bowed: a deep cowl with a rolled rim, its peak fallen back
    bow = 0.66 if pose == 'offering' else 0.86
    hm = p.mark()
    hseg = 20
    head = []
    hprof = ((0.0, 0.36, 0.38, 0.0), (0.16, 0.5, 0.54, 0.0), (0.36, 0.57, 0.64, 0.0), (0.56, 0.59, 0.67, 0.0),
             (0.78, 0.56, 0.64, 0.02), (1.0, 0.44, 0.52, 0.07), (1.17, 0.26, 0.34, 0.16), (1.27, 0.08, 0.12, 0.26))

    def mouth(a, z):
        da = (a - math.pi / 2 + math.pi) % TAU - math.pi
        return (da / 0.82) ** 2 + ((z - 0.54) / 0.4) ** 2

    for (z, rx, ry, back) in hprof:
        ring = []
        for i in range(hseg):
            a = TAU * i / hseg
            q = Vector((math.cos(a) * rx, math.sin(a) * ry - 0.04 - back, z))
            # the cowl's mouth: an oval hollowed for the face, its rim standing proud
            oval = mouth(a, z)
            if oval < 1.0:
                q.y -= 0.34 * (1 - oval) ** 0.5
            elif oval < 1.9:
                q.y += 0.07
                q.x *= 1.06
            ring.append(q)
        head.append(ring)

    def head_col(i, kk):
        oval = mouth(TAU * kk / hseg, hprof[i][0])
        if oval < 1.0:
            return scale(col, 0.34)
        return scale(col, 1.08 if oval < 1.9 else 0.96)

    p.loft(head, col, cols=head_col, cap0=True, cap1=True)
    # the face in the cowl's shadow: brow, nose, cheeks and chin, no more than hinted
    fc = scale(col, 0.6)
    p.rock(Vector((0, 0.27, 0.56)), (0.56, 0.3, 0.66), scale(fc, 0.9), jitter=0.05, subdivisions=2)
    p.block(Vector((0, 0.39, 0.72)), (0.42, 0.12, 0.1), fc, chip=0.2, pillow=0.0, rot=Matrix.Rotation(0.25, 4, 'X'))
    p.block(Vector((0, 0.43, 0.55)), (0.09, 0.16, 0.26), scale(fc, 1.1), chip=0.2, pillow=0.0, rot=Matrix.Rotation(-0.2, 4, 'X'))
    p.block(Vector((0, 0.385, 0.3)), (0.2, 0.12, 0.13), scale(fc, 0.95), chip=0.25, pillow=0.0)
    p.turn(hm, Matrix.Translation(Vector((0, lean_y(3.74) + 0.05, 3.72))) @ Matrix.Rotation(-bow, 4, 'X'))
    # the arms: wide bell sleeves from the shoulders, the cuffs hanging deep
    sy = lean_y(3.36)
    hands = []
    for s in (-1, 1):
        if pose == 'offering':
            path = p.bezier(Vector((s * 0.9, sy, 3.34)), Vector((s * 1.12, sy + 0.5, 2.25)), Vector((s * 0.3, sy + 1.0, 2.84)),
                            steps=7)
        else:
            path = p.bezier(Vector((s * 0.9, sy, 3.34)), Vector((s * 1.05, sy + 0.82, 2.7)), Vector((s * 0.2, sy + 1.06, 3.96)),
                            steps=7)
        srings = []
        n = len(path) - 1
        for i, q in enumerate(path):
            t = i / n
            tan = (path[min(i + 1, n)] - path[max(i - 1, 0)]).normalized()
            e1 = tan.cross(Vector((0, 0, 1)))
            if e1.length < 1e-3:
                e1 = Vector((1, 0, 0))
            e1.normalize()
            e2 = e1.cross(tan).normalized()
            if e2.z < 0:
                e2 = -e2
            r = 0.32 - 0.05 * t + 0.11 * t ** 3
            ring = []
            for j in range(12):
                a = TAU * j / 12
                sn = math.sin(a)
                droop = (1.0 + 0.85 * t * t) if sn < 0 else 1.0
                ring.append(q + (e1 * math.cos(a) + e2 * sn * droop) * r)
            srings.append(ring)
        p.loft(srings, scale(col, 0.97), cap0=True, cols=lambda i, kk: scale(col, 0.8 + 0.22 * ((kk + i) % 2)))
        # the dark of the sleeve's mouth
        p.face(list(reversed(srings[-1])), scale(col, 0.45), want=(path[-1] - path[-2]))
        wrist = path[-1]
        reach = (path[-1] - path[-2]).normalized()
        hand = wrist + reach * 0.2 + Vector((-s * 0.05, 0, 0.02))
        # the forearm: out of the sleeve's dark and into the hand (its own
        # stream, so the flank's stones stay where they were)
        own, p.rng = p.rng, random.Random(f'forearm {lx} {s}')
        p.block(wrist + (hand - wrist) * 0.42, (0.15, 0.13, 0.34), scale(col, 0.92), chip=0.12, pillow=0.0, knock=0.0,
                rot=(hand - wrist).to_track_quat('Z', 'Y').to_matrix().to_4x4())
        p.rng = own
        rot = Matrix.Rotation(-0.75 if pose == 'offering' else -0.2, 4, 'X') @ Matrix.Rotation(-s * 0.3, 4, 'Y')
        p.block(hand, (0.22, 0.34, 0.14) if pose == 'offering' else (0.24, 0.14, 0.4), scale(col, 1.05), chip=0.14, pillow=0.0,
                rot=rot)
        for f in range(4):
            if pose == 'offering':
                p.block(hand + rot @ Vector((-0.08 + f * 0.055, 0.24, 0.04)), (0.045, 0.2, 0.07), scale(col, 0.96), chip=0.2,
                        pillow=0.0, rot=rot @ Matrix.Rotation(0.35, 4, 'X'))
            else:
                p.block(hand + rot @ Vector((-0.09 + f * 0.06, 0.03, 0.27)), (0.05, 0.11, 0.2), scale(col, 0.96), chip=0.2,
                        pillow=0.0, rot=rot)
        hands.append(hand)
    if pose == 'offering':
        # the crescent offered up in both hands: tarnished silver, its inner limb still alight
        cc = (hands[0] + hands[1]) / 2 + Vector((0, 0.16, 0.13))       # (its bow lies in the two palms)
        arc = [math.pi * (1.1 + 0.8 * i / 10) for i in range(11)]
        outer = [cc + Vector((math.cos(a) * 0.46, 0.0, math.sin(a) * 0.46 + 0.24)) for a in arc]
        inner = [cc + Vector((math.cos(a) * 0.37, 0.0, math.sin(a) * 0.29 + 0.27)) for a in arc]
        with p.as_kind(K_SILVER):
            for i in range(10):
                for (dy, sh, wn) in ((0.07, 1.0, 1), (-0.07, 0.6, -1)):
                    o = Vector((0, dy, 0))
                    p.face((outer[i] + o, outer[i + 1] + o, inner[i + 1] + o, inner[i] + o), scale(mk.SILVER_TARN, sh * 1.5),
                           want=(0, wn, 0))
                p.face((outer[i] + Vector((0, 0.07, 0)), outer[i + 1] + Vector((0, 0.07, 0)), outer[i + 1] - Vector((0, 0.07, 0)),
                        outer[i] - Vector((0, 0.07, 0))), scale(mk.SILVER_TARN, 1.2), want=(outer[i] - cc - Vector((0, 0, 0.24))))
            # (the bow is a solid bar: its inner limb under the light, and its two tips)
            o = Vector((0, 0.07, 0))
            for i in (0, 9):
                p.face((inner[i] + o, inner[i + 1] + o, inner[i + 1] - o, inner[i] - o), scale(mk.SILVER_TARN, 0.9),
                       want=(0, 0, 1))
            for (i, sgn) in ((0, -1), (10, 1)):
                p.face((outer[i] + o, outer[i] - o, inner[i] - o, inner[i] + o), scale(mk.SILVER_TARN, 1.1), want=(sgn, 0, 0.4))
        with p.as_kind(K_GLOW):
            for i in range(1, 9):
                p.face((inner[i] + Vector((0, 0.085, 0)), inner[i + 1] + Vector((0, 0.085, 0)), inner[i + 1] - Vector((0, 0.085, 0)),
                        inner[i] - Vector((0, 0.085, 0))), mk.MOON, mat=GLOW, want=(0, 0, 1), alpha=0.5)
    # the stepped plinth, drowned
    base = WATER + 0.42
    M = Matrix.Translation(B(lx, lz, base)) @ RZ(yaw) @ Matrix.Rotation(lean, 4, 'X')
    STATUE_M[(lx, lz)] = M
    p.turn(m, M)
    lo = footing(f'penitent_{"w" if lx > 0 else "e"}', lx, lz, 1.15, 1.15, 0.0, 0.6)
    pc = B(lx, lz, 0)
    p.lathe((pc.x, pc.y, lo), [(1.7, 0), (1.7, WATER + 0.0 - lo), (1.58, WATER + 0.12 - lo)], 8, p.tone(lx, 1.0),
            phase=TAU / 16, smooth=False)
    p.lathe((pc.x, pc.y, WATER + 0.1), [(1.4, 0), (1.4, 0.2), (1.44, 0.24), (1.44, 0.3), (1.3, 0.36)], 8, p.tone(lx, 2.0),
            phase=TAU / 16, smooth=False)
    for i in range(8):
        a = TAU / 16 + TAU * (i + 0.5) / 8
        n = Vector((math.cos(a), math.sin(a), 0))
        p.phase_disc(pc + n * 1.3 + Vector((0, 0, WATER + 0.2)), n, (0, 0, 1), 0.07, (i + 1) / 8.0, 0.02, live=i in (1, 5))
    collider_circle(f'penitent_{"w" if lx > 0 else "e"}', lx, lz, 1.3, base + 4.9)
    SOCKETS.setdefault('statues', []).append([round(lx, 3), round(lz, 3), round(base, 3), pose])
    for i in range(3):
        a = yaw + TAU * (0.2 + 0.3 * i)
        SOCKETS['drips'].append([round(lx + math.sin(a) * 0.9, 3), round(base + 0.3, 3), round(lz - math.cos(a) * 0.9, 3)])


def penitents():
    for (lx, lz, pose) in STATUES:
        s = 1 if lx > 0 else -1
        penitent(FLANKS[s], lx, lz, pose, yaw=-s * 0.5, lean=0.0 if s < 0 else 0.04)


# ==================================================================== the weir
def weir_outward(i):
    a, b = Vector(WEIR[i]), Vector(WEIR[i + 1])
    d = (b - a).normalized()
    n = Vector((d.y, -d.x))
    mid = (a + b) / 2
    if n.dot(mid - Vector((-7.0, -19.0))) < 0:
        n = -n
    return d, n


def weir():
    p = P('Entrance_Weir', moss=1.1, wet_fn=lambda x, y: inside_weir(x, -y, 0.2))
    rng = p.rng
    top = WATER + 0.24
    cap = 0.2
    hc = 0.43
    th = 0.92
    notch = {seg: (t, w) for (seg, t, w) in NOTCHES}
    for i in range(len(WEIR) - 1):
        a, b = Vector(WEIR[i]), Vector(WEIR[i + 1])
        d, n = weir_outward(i)
        L = (b - a).length
        rot = RZ(math.atan2(-d.y, d.x))        # Blender yaw of the segment (Blender Y = -lz)
        mid = (a + b) / 2
        lo_out = min(gh(*(a + n * 0.9 + d * (L * t))) for t in (0.0, 0.25, 0.5, 0.75, 1.0))
        lo = footing(f'weir_{i}', mid.x, mid.y, L / 2, th / 2, math.atan2(-d.y, d.x), 0.55)
        rows = max(1, math.ceil((top - cap - lo) / hc))
        for j in range(rows):
            yt = top - cap - j * hc
            yb = yt - hc
            x = (0.45 if j % 2 else 0.0) - 0.1
            batter = 0.1 * max(0, j - 1)          # the wall's foot stands out, course by course
            while x < L - 0.05:
                ln = min(L - x, 1.0 + rng.random() * 0.75)
                if L - (x + ln) < 0.5:
                    ln = L - x
                c0 = a + d * (x + ln / 2)
                tn = notch.get(i)
                in_notch = tn is not None and j == 0 and abs((x + ln / 2) / L - tn[0]) * L < tn[1] * 0.5 + ln * 0.25
                buried = yt < min(gh(*(c0 + n * (0.55 + batter))), gh(*(c0 - n * 0.55))) - 0.2
                if not in_notch and not buried and ln > 0.12:
                    proud = (rng.random() - 0.5) * 0.06
                    cc = p.tone(x * 0.7 + i * 5, yb)
                    q = c0 + n * (proud + batter / 2)
                    p.block(B(q.x, q.y, (yt + yb) / 2), (ln - 0.02, th + batter, hc - 0.012), cc, rot=rot, skip=(5,), bed=True, joint=(1, 3),
                            pillow=0.022, chip=0.06, knock=0.15)
                x += ln
        # the coping
        x = 0.0
        while x < L - 0.05:
            ln = min(L - x, 1.1 + rng.random() * 0.6)
            if L - (x + ln) < 0.55:
                ln = L - x
            c0 = a + d * (x + ln / 2)
            tn = notch.get(i)
            in_notch = tn is not None and abs((x + ln / 2) / L - tn[0]) * L < tn[1] * 0.5 + ln * 0.3
            gone = rng.random() < 0.09
            if not in_notch and not gone:
                p.block(B(c0.x, c0.y, top - cap / 2 + (rng.random() - 0.5) * 0.02), (ln - 0.025, th + 0.16, cap),
                        mix(p.tone(x + i * 3, 0.0), mk.PEARL_PALE, 0.3), rot=rot @ Matrix.Rotation((rng.random() - 0.5) * 0.04, 4, 'X'),
                        skip=(5,), pillow=0.0, chip=0.05, knock=0.25, bed=True)
                COPINGS.setdefault(i, []).append((x + ln / 2, ln / 2))
                if rng.random() < 0.3:
                    SOCKETS['glints'].append([round(c0.x, 3), round(top + 0.01, 3), round(c0.y, 3)])
            x += ln
        tn = notch.get(i)
        if tn is not None:
            # the spill: a lip stone standing out of the wall, a green wet run under it
            c0 = a + d * (L * tn[0])
            lip = c0 + n * (th / 2 + 0.22)
            # (it lies on the course under the notch, its tail built into the wall)
            p.block(B(lip.x, lip.y, WATER - 0.235), (tn[1] + 0.2, 0.7, 0.35), mk.PEARL_DARK, rot=rot, pillow=0.0, chip=0.03)
            g = gh(*(c0 + n * (th / 2 + 0.85)))
            edge = c0 + n * (th / 2 + 0.55)
            p.streaks.append((B(edge.x - n.x * 0.5, edge.y - n.y * 0.5, WATER - 0.1), tn[1] * 1.3, WATER - g + 0.6, 0.95))
            SOCKETS['falls'].append([round(edge.x, 3), round(WATER - 0.07, 3), round(edge.y, 3), round(WATER - 0.07 - g, 3),
                                     round(n.x, 3), round(n.y, 3), round(tn[1], 3)])
        if WATER - lo_out > 0.75:
            collider_obb(f'weir_{i}', mid.x, mid.y, L / 2 + 0.2, th / 2 + 0.06, math.atan2(-d.y, d.x), top)
    # a bollard at every turn of the line; the three round the deep corner carry the Court's crescent
    for i, (lx, lz) in enumerate(WEIR):
        lo = min(gh(lx + dx, lz + dz) for dx in (-0.6, 0.6) for dz in (-0.6, 0.6)) - 0.5
        tall = i in (4, 5, 6)
        ht = top + (0.5 if tall else 0.26)
        if ht - lo < 0.3:
            continue
        p.lathe((lx, -lz, lo), [(0.8, 0), (0.74, ht - lo - 0.3), (0.74, ht - lo - 0.2), (0.82, ht - lo - 0.16), (0.82, ht - lo - 0.07),
                                (0.6, ht - lo), (0.0, ht - lo + 0.1)], 8, p.tone(i * 3.0, 0.0), phase=TAU / 16 + i, smooth=False)
    return p


def on_coping(i, along, L):
    """Where along weir segment i a thing set at `along` lands on a coping
    stone that is still there, clear of the bollards at the wall's two turns;
    None when the segment has no such stone."""
    spans = [(max(1.1, c - hl + 0.15), min(L - 1.1, c + hl - 0.15)) for (c, hl) in COPINGS.get(i, [])]
    spans = [sp for sp in spans if sp[1] > sp[0]]
    if not spans:
        return None
    a0, a1 = min(spans, key=lambda sp: max(sp[0] - along, along - sp[1], 0.0))
    return max(a0, min(a1, along))


def inside_weir(lx, lz, margin=0.0):
    """Whether a point of the shelf lies on the mirror's side of the weir's
    line (pushed `margin` yards out toward the pit)."""
    line = WEIR
    if margin:
        line = []
        for i, (x, z) in enumerate(WEIR):
            d, n = weir_outward(min(i, len(WEIR) - 2))
            line.append((x + n.x * margin, z + n.y * margin))
    poly = [(22.0, -11.0)] + list(line) + [(-30.0, -24.4), (-30.0, -8.0), (22.0, -8.0)]
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > lz) != (zj > lz) and lx < (xj - xi) * (lz - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


# =============================================================== the moon pool
def ring_stone(p, c, r0, r1, a0, a1, z0, z1, color, level=False, **kw):
    """A stone of a round course. `level` keeps its top true (a kerb that
    carries an inlay); otherwise each top corner is worn down a little."""
    cs = []
    for z in (z0, z1):
        for (r, a) in ((r1, a0), (r1, a1), (r0, a1), (r0, a0)):
            q = 0.03 * p.rng.random()
            cs.append(Vector((c[0] + math.cos(a) * (r - q if r == r1 else r + q), c[1] + math.sin(a) * (r - q if r == r1 else r + q),
                              z - (q if z == z1 and not level else 0))))
    return p._hewn(cs, color, joint=(1, 3), skip=(5,), level=level, **kw)


def pool_step_sink(i):
    """How far stone i (of 20) of the pool's outer step has sunk."""
    return 0.09 if i in (3, 9, 14) else (0.03 if i % 4 == 1 else 0.0)


def moon_pool():
    p = P('Entrance_MoonPool', moss=1.4, tide=-1e9, water=-1e9)
    rng = p.rng
    cx, cz, r = POOL['lx'], POOL['lz'], POOL['r']
    c = B(cx, cz, 0)
    pts = [(cx + math.cos(a) * 4.6, cz + math.sin(a) * 4.6) for a in [TAU * i / 12 for i in range(12)]]
    hi = max(gh(x, z) for (x, z) in pts)
    lo = footing('moon_pool', cx, cz, 3.4, 3.4, 0.0, 0.55)
    rim = hi + 0.46
    # the outer step, sunk here and there
    n = 20
    for i in range(n):
        a0, a1 = TAU * i / n + 0.012, TAU * (i + 1) / n - 0.012
        sink = pool_step_sink(i)
        ring_stone(p, c, r + 0.98, r + 1.62, a0, a1, lo, rim - 0.36 - sink, scale(p.tone(i * 2.1, 1.0), 0.96), pillow=0.02,
                   pillows=(0,))
    # the kerb, the lunar month inlaid round it
    n = 24
    slipped = {5: 0.09, 15: 0.12}
    for i in range(n):
        a0, a1 = TAU * i / n + 0.008, TAU * (i + 1) / n - 0.008
        am = (a0 + a1) / 2
        out = slipped.get(i, 0.0)
        col = p.tone(i * 1.9, 2.0)
        if i == 9:
            continue                      # one kerb stone is gone
        ring_stone(p, c, r + 0.3 + out, r + 1.04 + out, a0, a1, lo, rim - 0.02 - (0.06 if i in slipped else 0.0), col,
                   level=True, pillow=0.015, pillows=(0,))
        nrm = Vector((math.cos(am), math.sin(am), 0))
        ph = 0.5 - 0.5 * math.cos(TAU * i / n)
        live = i % 3 == 0
        q = c + nrm * (r + 0.67 + out) + Vector((0, 0, rim - 0.014 - (0.06 if i in slipped else 0.0)))
        p.phase_disc(q, (0, 0, 1), nrm, 0.16, ph, 0.985, live=live, waning=i > n / 2)
        if live:
            SOCKETS['pool_runes'].append([round(q.x, 3), round(q.z, 3), round(-q.y, 3), 0.985, 0.16])
    # the inner lip: a rounded course of small stones standing a hand above the kerb
    n = 30
    for i in range(n):
        if 14 <= i <= 15:
            continue
        a0, a1 = TAU * i / n + 0.01, TAU * (i + 1) / n - 0.01
        ring_stone(p, c, r - 0.02, r + 0.32, a0, a1, lo, rim + 0.07, mix(p.tone(i * 1.3, 3.0), mk.PEARL_PALE, 0.4),
                   pillow=0.03, pillows=(0, 2, 4))
    # three stelae of the Court behind the pool, one broken
    for (a, h, tilt, broken) in ((1.12, 3.9, 0.05, False), (1.62, 4.9, -0.03, False), (2.14, 2.2, 0.09, True)):
        bx, by = cx + math.cos(a) * 6.3, -(cz + math.sin(a) * 6.3)
        lx, lz = bx, -by
        g = gh(lx, lz)
        m = p.mark()
        col = p.tone(a * 5.0, 1.0)
        stela(p, h, 1.5, 1.14, 0.5, col, broken=broken)
        p.block(Vector((0, 0, 0.14)), (2.0, 0.95, 0.5), scale(col, 0.95), chip=0.05, pillow=0.012, skip=(5,), bed=True)
        p.block(Vector((0, 0, 0.47)), (1.72, 0.74, 0.16), mk.PEARL_PALE, chip=0.05, pillow=0.0, skip=(5,), bed=True)
        if not broken:
            for s in (-1, 1):
                with p.as_kind(K_SILVER):
                    p.sweep(p.bezier(Vector((s * 0.16, 0, h + 0.56)), Vector((s * 0.62, 0, h + 0.86)), Vector((s * 0.3, 0, h + 1.36)),
                                     steps=4), 0.12, 0.025, mk.SILVER_BRIGHT, sides=5)
            p.phase_disc(Vector((0, 0.262, h + 0.05)), (0, 1, 0), (0, 0, 1), 0.36, 1.0, 0.99, live=True)
            p.inlay(Vector((0, 0.258, h - 0.5)), Vector((0, 0.258, 1.2)), 0.05, (0, 1, 0), 0.97, live=False)
            for q in range(3):
                zz = h - 0.95 - q * 0.75
                p.phase_disc(Vector((0, 0.262, zz)), (0, 1, 0), (0, 0, 1), 0.15, 0.75 - q * 0.25, 0.97, live=q == 0)
        yaw = math.atan2(c.y - by, c.x - bx) - math.pi / 2
        p.turn(m, Matrix.Translation(Vector((bx, by, g))) @ RZ(yaw) @ Matrix.Rotation(tilt, 4, 'Y'))
        footing(f'stela_{round(a * 100)}', lx, lz, 0.45, 0.45, 0.0, 0.5)
        collider_circle(f'stela_{round(a * 100)}', lx, lz, 0.95, g + h + 1.0)
        if broken:
            p.block(B(lx + 1.3, lz + 0.5, gh(lx + 1.3, lz + 0.5) + 0.12), (1.2, 0.9, 0.4), col, chip=0.2, pillow=0.03,
                    rot=RZ(0.6) @ Matrix.Rotation(0.2, 4, 'X'))
    SOCKETS['pool'] = {'lx': cx, 'lz': cz, 'r': r, 'water': round(rim - 0.16, 3), 'rim': round(rim, 3)}
    return p


# ====================================================================== rubble
def rubble(p, spots):
    rng = p.rng
    for (lx, lz, n, spread, size) in spots:
        for _ in range(n):
            a = rng.random() * TAU
            rr = spread * math.sqrt(rng.random())
            x, z = lx + math.cos(a) * rr, lz + math.sin(a) * rr
            s = size * (0.5 + rng.random())
            g = max(walk(x, z), gh(x, z))
            p.block(B(x, z, g + s * 0.05), (s * (1.0 + rng.random() * 0.7), s * (0.7 + 0.5 * rng.random()), s * (0.45 + 0.3 * rng.random())),
                    p.tone(x, z), chip=0.22, pillow=0.03, knock=0.6,
                    rot=RZ(rng.random() * 3) @ Matrix.Rotation((rng.random() - 0.5) * 0.5, 4, 'X'))


# ====================================================================== growth
def growth():
    gate = P('Growth_Gate')
    treads = P('Growth_Stair')
    flank = {-1: P('Growth_FlankEast'), 1: P('Growth_FlankWest')}
    works = P('Growth_Works')
    # ---- the gate: moss on the ring's shoulders and shoes, a creeper up each flank
    rng = gate.rng
    cb = Vector((0.0, 0.0, RING_C))
    for k in range(BLOCKS):
        am = ring_angle(k)
        if math.sin(am) > 0.3 and rng.random() < 0.55:
            a = am + (rng.random() - 0.5) * 0.2
            q = cb + Vector((math.cos(a), 0, math.sin(a))) * (RING_FACES[k][2] * math.cos(TAU / BLOCKS / 2) / math.cos(a - am) + 0.006) + \
                Vector((0, (rng.random() - 0.5) * 1.3 + RING_FACES[k][1], 0))
            gate.moss(q, 0.24 + 0.22 * rng.random(), normal=(math.cos(a), 0, math.sin(a)), height=0.07)
    for s in (-1, 1):
        for _ in range(3):
            # on the cradle's lower step, clear of the ring and of the step over it
            u, v = rng.random(), rng.random() - 0.5
            gate.moss(B(s * (3.0 + u * 1.26), math.copysign(0.92 + abs(v) * 0.3, v), D + 0.945),
                      0.16 + 0.12 * rng.random())
        for _ in range(2):
            # on the upper step, in the crevice at the ring's foot
            u, v = rng.random(), rng.random() - 0.5
            gate.moss(B(s * (5.05 + u * 0.4), v * 1.7, D + 1.715), 0.16 + 0.14 * rng.random())
    for (a_from, a_to, y, wob) in ((math.pi * 1.2, math.pi * 0.66, RING_Y + 0.11, 0.2), (math.pi * 1.16, math.pi * 0.84, RING_Y + 0.1, 0.28),
                                   (-0.22, 0.24, RING_Y + 0.1, 0.25), (math.pi * 1.2, math.pi * 0.8, -RING_Y - 0.1, 0.3),
                                   (-0.2, 0.42, -RING_Y - 0.1, 0.26)):
        pts = []
        n = 24
        sg = 1 if y > 0 else -1
        for i in range(n + 1):
            t = i / n
            a = a_from + (a_to - a_from) * t
            rr = RING_R + math.sin(t * 9.0 + y) * wob         # (between the two archivolt mouldings)
            y1, slip, _r1 = RING_FACES.get((round((a - math.pi / 2) / (TAU / BLOCKS)) + 7) % BLOCKS, (RING_Y, 0.0, R_OUT))
            pts.append(cb + Vector((math.cos(a) * rr, sg * (y1 + 0.03) + slip, math.sin(a) * rr)))
        gate.creeper(pts, leaf=0.19, every=0.2, flowers=0.2, normals=lambda i, sg=sg: (0, sg, 0))
    for _ in range(16):
        x, z = (rng.random() - 0.5) * 2 * (DAIS['hw'] - 0.4), DAIS['z0'] + rng.random() * (DAIS['z1'] - DAIS['z0'])
        if abs(x) < 3.7 and abs(z) < 1.2:
            continue
        gate.moss(B(x, z, D + 0.005), 0.16 + 0.2 * rng.random(), height=0.05)
    for s in (-1, 1):
        for _ in range(4):
            x = s * (DAIS['hw'] - 0.2 - rng.random() * 1.2)
            z = DAIS['z1'] - 0.3 - rng.random() * 1.5
            gate.sedge(B(x, z, max(D, gh(x, z))), radius=0.25, blades=8, height=0.55)
    # ---- the stair: moss where feet miss, slime and short weed on the wet treads, creepers on the columns
    stair = treads
    rng = stair.rng
    for k in range(N_ALL):
        top = tread_top(k)
        lzf = ST_Z0 - (k + 1) * TREAD
        half = stair_half(lzf)
        wet = top < TIDE
        for s in (-1, 1):
            if rng.random() < 0.75:
                x = s * (half - 0.05 - rng.random() * 0.75)
                c = None if not wet else mix(mk.SLIME, mk.SLIME_BRIGHT, rng.random())
                stair.moss(B(x, lzf + 0.34 + rng.random() * 0.1, top + 0.004), 0.12 + 0.14 * rng.random(), color=c, height=0.045)
        if top < WATER + 0.7 and top > WATER - 0.4:
            for _ in range(4):
                x = (rng.random() - 0.5) * 2 * (half - 0.2)
                stair.weed(B(x, lzf, top - 0.1), 0.2 + 0.14 * rng.random(), (0, 1, 0), width=0.4, blades=4, blade=0.035)
    for s in (-1, 1):
        stair = flank[s]
        for k in range(0, 18, 2):
            pier = k in PIERS
            zn = ST_Z0 - k * TREAD
            top = tread_top(k) + (1.25 if pier else 0.52)
            if s > 0 and BREACH[0] <= k < BREACH[1]:
                continue
            if not pier and rng.random() < 0.8:
                bare = 0.226 if (s, k) in MISSING_COPINGS else 0.0
                stair.moss(B(s * (HS + 0.1 + rng.random() * (CHEEK - 0.15)), zn - rng.random() * 0.9, top + 0.004 - bare),
                           0.16 + 0.18 * rng.random(), height=0.06)
    for (cx, cz, base, top, state) in SOCKETS.get('columns', []):
        stair = flank[1 if cx > 0 else -1]
        if state == 'fallen':
            continue
        shaft = SHAFTS[(cx, cz)]
        turns = 1.9 if state == 'whole' else 0.9
        # (it climbs to the necking of a whole column, and stops under the break of a broken one)
        h = (top - base) - (1.5 if state == 'whole' else 0.3 + 0.6 * shaft['dh'])
        n = int(20 * turns)
        ph = rng.random() * TAU
        pts, axis = [], []
        for i in range(n + 1):
            t = i / n
            a = ph + turns * TAU * t
            zz = base + 0.1 + h * t
            ts = (zz - shaft['z']) / (shaft['dh'] * 5)
            if ts > 0:
                # on the shaft: its own drum's axis and the entasis' radius
                c0 = B(cx, cz, 0) + shaft['offs'][min(len(shaft['offs']) - 1, int(ts * 5))]
                rr = shaft_r(min(1.0, ts)) + 0.012
            else:
                c0, rr = B(cx, cz, 0), 0.64                     # over the attic base
            axis.append(c0)
            pts.append(c0 + Vector((math.cos(a) * rr, math.sin(a) * rr, zz)))
        stair.creeper(pts, leaf=0.2, every=0.2, flowers=0.22,
                      normals=lambda i, pts=pts, axis=axis: (pts[i].x - axis[i].x, pts[i].y - axis[i].y, 0))
        stair.moss(shaft['moss'][0] + Vector((0, 0, 0.005)), shaft['moss'][1], height=0.08)
        for _ in range(3):
            a = rng.random() * TAU
            g = gh(cx + math.cos(a) * 1.2, cz + math.sin(a) * 1.2)
            if g > WATER + 0.3:
                stair.sedge(B(cx + math.cos(a) * 1.2, cz + math.sin(a) * 1.2, g), radius=0.26, blades=8, height=0.6)
    for (lx, lz, n, kind) in ((-4.9, -14.2, 3, 'reed'), (5.0, -14.0, 3, 'reed'), (-8.6, -14.6, 2, 'reed'), (8.7, -14.8, 2, 'reed'),
                              (-5.4, -16.8, 2, 'sedge'), (5.6, -17.0, 2, 'sedge')):
        stair = flank[1 if lx > 0 else -1]
        for _ in range(n):
            x, z = lx + (rng.random() - 0.5) * 1.3, lz + (rng.random() - 0.5) * 1.3
            g = gh(x, z)
            if abs(x) < stair_half(z) + 0.15 and z > ST_Z0 - N_ALL * TREAD:
                continue
            if kind == 'reed':
                stair.reeds(B(x, z, g), radius=0.4, stems=6, height=1.7 + rng.random() * 0.9)
            else:
                stair.sedge(B(x, z, max(g, WATER)), radius=0.3, blades=9, height=0.7)
    # the penitents: a fringe of fine weed on the drowned plinth, moss on shoulders and cowl
    for (lx, lz, base, pose) in SOCKETS.get('statues', []):
        stair = flank[1 if lx > 0 else -1]
        for i in range(8):
            a = TAU * (i + 0.5) / 8 + TAU / 16
            n = Vector((math.cos(a), math.sin(a), 0))
            stair.weed(B(lx, lz, 0) + n * 1.38 + Vector((0, 0, WATER + 0.28)), 0.3 + 0.12 * rng.random(), n, width=0.8, blades=5,
                       blade=0.03)
        M = STATUE_M[(lx, lz)]
        for _ in range(5):
            a = rng.random() * TAU
            z = 3.36 + rng.random() * 0.2
            u = (z - 3.34) / 0.24                          # between the mantle's shoulder ring and the next
            q = Vector((math.cos(a) * (1.06 - 0.22 * u) * (1 + 0.045 * math.cos(7 * a + 1.0)),
                        math.sin(a) * (0.68 - 0.08 * u) + penitent_lean(z) + 0.03, z))
            stair.moss(M @ q, 0.2 + 0.15 * rng.random(), normal=M.to_3x3() @ Vector((math.cos(a) * 0.6, math.sin(a) * 0.6, 0.8)),
                       height=0.06)
    # ---- the works: lilies on the mirror, reed beds against the weir and the shores, moss on the pool
    rng = works.rng
    beds = [(-1.5, -17.6, 2.4, 13), (3.0, -18.2, 1.6, 7), (-9.5, -18.0, 2.2, 9), (9.0, -19.0, 1.0, 3),
            (-3.0, -23.0, 2.6, 11), (-11.0, -23.5, 2.8, 11), (1.6, -21.6, 1.6, 6), (9.5, -15.8, 1.8, 7), (-16.5, -19.5, 2.6, 9),
            (-7.0, -26.0, 2.0, 8), (-17.0, -25.2, 1.8, 6), (-6.7, -17.6, 1.4, 5), (6.7, -17.7, 1.4, 5)]
    for (lx, lz, spread, n) in beds:
        placed = 0
        for _ in range(n * 3):
            if placed >= n:
                break
            a = rng.random() * TAU
            rr = spread * math.sqrt(rng.random())
            x, z = lx + math.cos(a) * rr, lz + math.sin(a) * rr
            if gh(x, z) > WATER - 0.12 or not inside_weir(x, z, -0.6):
                continue
            if abs(x) < stair_half(z) + 0.1 and z > ST_Z0 - N_ALL * TREAD + 0.3:
                continue
            if any(math.hypot(x - sx, z - sz) < 1.9 for (sx, sz, _b, _p) in SOCKETS.get('statues', [])):
                continue
            rad = 0.2 + 0.28 * rng.random() ** 1.5
            works.lily(B(x, z, WATER + 0.012), rad, tilt=(rng.random() - 0.5) * 0.06)
            placed += 1
            if rng.random() < 0.14:
                works.lotus(B(x + rad * 0.5, z + rad * 0.3, WATER + 0.02), size=0.18 + 0.08 * rng.random())
                SOCKETS['lilies'].append([round(x, 3), round(z, 3)])
    for i in range(len(WEIR) - 1):
        a, b = Vector(WEIR[i]), Vector(WEIR[i + 1])
        d, n = weir_outward(i)
        L = (b - a).length
        for _ in range(int(L / 2.2)):
            t = rng.random()
            q = a + d * (L * t) - n * (0.75 + rng.random() * 0.9)
            if gh(q.x, q.y) > WATER + 0.1:
                continue
            works.reeds(B(q.x, q.y, gh(q.x, q.y)), radius=0.45, stems=5 + rng.randrange(3), height=1.7 + rng.random() * 1.0)
        for _ in range(int(L / 1.6)):
            along = L * rng.random()
            dx, dz = (rng.random() - 0.5) * 0.6, (rng.random() - 0.5) * 0.6
            rad = 0.18 + 0.2 * rng.random()
            seat = on_coping(i, along, L)
            # (on a coping stone that is still there; where a whole run is gone, on the bare course under it)
            q = a + d * (along if seat is None else seat)
            side = max(-0.3, min(0.3, Vector((dx, dz)).dot(n)))
            works.moss(B(q.x + n.x * side, q.y + n.y * side, WATER + (0.245 if seat is not None else 0.045)), rad, height=0.06)
    for (lx, lz, n, sp) in ((-21.0, -20.0, 5, 2.6), (-20.0, -15.5, 4, 2.2), (11.5, -14.6, 4, 1.8), (-13.5, -12.6, 4, 2.0)):
        for _ in range(n):
            x, z = lx + (rng.random() - 0.5) * 2 * sp, lz + (rng.random() - 0.5) * 2 * sp
            g = gh(x, z)
            if g > WATER + 0.5:
                works.sedge(B(x, z, g), radius=0.3, blades=9, height=0.7 + rng.random() * 0.3)
            else:
                works.reeds(B(x, z, g), radius=0.5, stems=6 + rng.randrange(3), height=1.8 + rng.random() * 1.0)
    # fine weed down the weir's outer face under the notches
    for (fx, fy, fz, fall, nx, nz, w) in SOCKETS['falls']:
        for _ in range(6):
            off = (rng.random() - 0.5) * (w + 1.0)
            q = Vector((fx - nx * 0.5 - nz * off, fz - nz * 0.5 + nx * off))
            works.weed(B(q.x + nx * 0.06, q.y + nz * 0.06, WATER - 0.2 - rng.random() * 0.3), min(fall, 0.8 + rng.random() * 0.6),
                       (nx, -nz, 0), width=0.5, blades=5, blade=0.035)
    # the pool: moss on the kerb, moonflowers and sedge round it, a creeper on each standing stela
    pool = SOCKETS['pool']
    pc = B(pool['lx'], pool['lz'], 0)
    for i in range(22):
        a = rng.random() * TAU
        rr = pool['r'] + 0.36 + rng.random() * 1.2
        q = pc + Vector((math.cos(a) * rr, math.sin(a) * rr, pool['rim'] - 0.016))
        if rr > pool['r'] + 1.0:
            q.z -= 0.36 + pool_step_sink(int(a / (TAU / 20)))      # down on the outer step, sunk as its stone is
        kerb = int(a / (TAU / 24))
        if kerb == 9 and rr < pool['r'] + 1.0:
            q.z = gb(q.x, q.y) + 0.01                      # the kerb stone that is gone: the moss is on the earth it left
        elif kerb in (5, 15) and rr < pool['r'] + 1.0:
            q.z -= 0.06                                    # the two kerb stones that have slipped and sunk
        works.moss(q, 0.16 + 0.2 * rng.random(), height=0.06)
    for i in range(14):
        a = rng.random() * TAU
        rr = pool['r'] + 1.8 + rng.random() * 1.3
        x, z = pool['lx'] + math.cos(a) * rr, pool['lz'] + math.sin(a) * rr
        g = gh(x, z)
        works.sedge(B(x, z, g), radius=0.26, blades=8, height=0.5 + rng.random() * 0.3)
        if rng.random() < 0.6:
            for _ in range(3):
                q = B(x + (rng.random() - 0.5) * 0.5, z + (rng.random() - 0.5) * 0.5, g + 0.24 + rng.random() * 0.2)
                works.blade(Vector((q.x, q.y, gb(q.x, q.y) - 0.04)), q, 0.012, mk.STEM)
                works.moonflower(q, (rng.random() - 0.5, rng.random() - 0.5, 1.0), size=0.12)
    return [gate, treads, flank[-1], flank[1], works]


def colonnade():
    """The colonnade on the gully's shoulders, either side of the flight."""
    for (lx, lz, state) in COLUMNS:
        column(FLANKS[1 if lx > 0 else -1], lx, lz, state)


def stela(p, h, w0, w1, th, col, broken=False):
    """A stela of the Court in its own frame (faces +Y): a tapering slab with
    a round lunette head."""
    prof = [(-w0 / 2, -1.0), (w0 / 2, -1.0), (w1 / 2, h)]
    if broken:
        prof += [(w1 * 0.2, h + 0.5), (-w1 * 0.1, h + 0.15), (-w1 / 2, h + 0.42)]
    else:
        prof += [(math.cos(a) * w1 / 2, h + math.sin(a) * w1 / 2) for a in [math.pi * i / 8 for i in range(1, 8)]]
        prof += [(-w1 / 2, h)]
    front = [Vector((x, th / 2, z)) for (x, z) in prof]
    back = [Vector((x, -th / 2, z)) for (x, z) in prof]
    p.face(front, col, want=(0, 1, 0), cols=[scale(col, 0.8 if z < 0.5 else 1.03) for (_x, z) in prof])
    p.face(back, scale(col, 0.95), want=(0, -1, 0))
    n = len(prof)
    cx = Vector((0, 0, h * 0.5))
    for i in range(n):
        j = (i + 1) % n
        if i == 0:
            continue
        p.face((front[i], front[j], back[j], back[i]), scale(col, 0.84), centre=cx)


# ====================================================================== output
def new_root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


def join(objs, name):
    """One object from several (same materials, same colour layer)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def mirror_cells(step=1.25):
    """The mirror's cells (door-local squares): inside the weir's line, over
    ground no higher than 0.6 above the water (the land hides the rest)."""
    cells = []
    x = -30.0
    while x < 22.0:
        z = -30.0
        while z < -8.0:
            cx, cz = x + step / 2, z + step / 2
            lo = min(gh(x + u, z + v) for u in (0, step) for v in (0, step))
            if inside_weir(cx, cz) and lo < WATER + 0.6:
                cells.append((round(x, 3), round(z, 3)))
            z += step
        x += step
    return cells


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = mk.make_materials()
    gate = moongate()
    FLANKS[-1] = P('Entrance_FlankEast', moss=1.1)
    FLANKS[1] = P('Entrance_FlankWest', moss=1.1)
    stair = moon_stair()
    colonnade()
    penitents()
    fe, fw = FLANKS[-1], FLANKS[1]
    wr = weir()
    pool = moon_pool()
    rubble(fw, [(4.3, -5.3, 5, 0.7, 0.36)])
    rubble(fe, [(-4.5, -9.8, 3, 0.7, 0.32), (-6.4, -11.6, 3, 0.8, 0.4)])
    rubble(wr, [(7.6, -20.6, 5, 1.2, 0.5), (3.9, -26.9, 6, 1.5, 0.55), (-12.0, -30.0, 4, 1.2, 0.45), (-22.0, -26.0, 3, 1.0, 0.4)])
    rubble(pool, [(4.6, 10.4, 3, 0.8, 0.3), (-4.8, 16.0, 3, 0.9, 0.3)])
    g_gate, g_stair, g_fe, g_fw, g_works = growth()
    pieces = {'main': [('Entrance_Moongate', [gate]), ('Entrance_MoonStair', [stair]), ('Entrance_FlankEast', [fe]),
                       ('Entrance_FlankWest', [fw])],
              'works': [('Entrance_Works', [wr, pool])],
              'growth': [('Growth_Gate', [g_gate]), ('Growth_Stair', [g_stair]), ('Growth_FlankEast', [g_fe]),
                         ('Growth_FlankWest', [g_fw]), ('Growth_Works', [g_works])]}
    allp = [gate, stair, fe, fw, wr, pool, g_gate, g_stair, g_fe, g_fw, g_works]
    bvh = None if '--no-ao' in argv else mk.occluder(allp, GR)
    roots = {'main': 'TempleEntrance_ROOT', 'works': 'TempleEntranceWorks_ROOT', 'growth': 'TempleEntranceGrowth_ROOT'}
    files = {'main': 'drowned_temple_entrance.glb', 'works': 'drowned_temple_entrance_works.glb',
             'growth': 'drowned_temple_entrance_growth.glb'}
    raw = os.path.join(OUT, 'glb_raw')
    os.makedirs(raw, exist_ok=True)
    stats = {'tris': {}, 'total_tris': 0}
    for key, groups in pieces.items():
        root = new_root(roots[key])
        outs = []
        for (name, group) in groups:
            objs = [pc.finish(mats, root, ground=gb, bvh=bvh) for pc in group]
            o = join(objs, name)
            n = ec.count_tris([o])
            stats['tris'][name] = n
            stats['total_tris'] += n
            outs.append(o)
        ec.export_glb([root] + outs, os.path.join(raw, files[key]))
    cells = mirror_cells()
    stats.update({
        'sockets': SOCKETS, 'colliders': COLLIDERS, 'footings': ec.gap_report(GR, FOOTINGS), 'door': GR.door,
        'levels': {'dais': D, 'ringCentre': RING_C, 'ringInner': R_IN, 'ringOuter': R_OUT, 'water': WATER, 'tide': TIDE},
        'walk': {'dais': DAIS, 'stairZ0': ST_Z0, 'tread': TREAD, 'riser': round(RISER, 6), 'treads': N_ALL,
                 'halfWidth': HS, 'flareZ': FLARE_Z, 'flare': FLARE},
        'breach': BREACH, 'weir': WEIR, 'mirror': {'step': 1.25, 'cells': cells},
    })
    stats['footingsShort'] = [f['name'] for f in stats['footings'] if not f['ok']]
    stats['footingRows'] = [{'name': n, 'cx': round(cx, 3), 'cz': round(cz, 3), 'hw': round(hw, 3), 'hd': round(hd, 3),
                             'rot': round(rot, 4), 'bottom': round(b, 3)} for (n, cx, cz, hw, hd, rot, b) in FOOTINGS]
    json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
    print('STATS', json.dumps({'tris': stats['tris'], 'total': stats['total_tris'], 'short': stats['footingsShort'],
                               'colliders': len(COLLIDERS), 'cells': len(cells)}))
    ec.build_terrain(GR, 'thornpeak', paths=[])
    import temple_renders
    temple_renders.dress(GR, stats, walk)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, BLEND))
    if RENDERS != 'none':
        temple_renders.run(OUT, GR, SURR, COLLIDERS, RENDERS, walk, TAG)


if __name__ == '__main__':
    main()
