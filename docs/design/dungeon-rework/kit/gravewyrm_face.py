"""The Gravewyrm Sanctum's showpiece: the Calving Face with the Wyrm inside it,
its crack stages, and the held (the chain-gang giants and the dead in the ice).

THE FACE'S FRAME (every Face* piece, Kit_WyrmSilhouette and Kit_WyrmHeart
share it: the runtime places them all with ONE transform). The origin is the
front base centre of the face at the lake's level; the face looks toward -Y
(the game's +Z after export: place it with a half turn so it faces south over
the lake). Its foot is a concave arc, y = -22 (x / 80)^2: the wings come 22
yd toward the lake round its north half. 160 yd wide (x -80 to 80), about 100
tall at the middle, falling to about 70 at the wings; the glacier's top runs
back 60 yd behind the crest. In the middle a hollow lies behind a translucent
shell (KitGlass): the wyrm is coiled in it.

The crack stages are overlays in the same frame, a hand's breadth proud of the
ice, toggled by the runtime: Kit_FaceCrack_0 (a hairline), Kit_FaceCrack_1
(the scar where a plate fell, with Kit_FacePlateFallen lying in the lake at
its foot), Kit_FaceCrack_2a to 2d (from the four chain entries,
CHAIN_ENTRIES), Kit_FaceCrack_3 (the great split, its depth lit by the shard).
Kit_FaceCalved REPLACES Kit_CalvingFace at stage 4 (its own cracks baked in:
hide every overlay then): the shell over the head and neck has fallen and
the wyrm's head is bare. Kit_FaceChunkA to C (sculpted in gravewyrm_nature.py) are the collapse's debris.
"""
import math

from mathutils import Vector

import gravewyrm_sculpt as gs
from gwkit import (
    CHAIN, CLOTH_HELD, open_back, CRACK_GLOW, DEEP_ICE, FLESH, GLACIER, GLASS, GLASS_DEEP, GLASS_ICE, GLOW, HAIR, ICE,
    ICE_CORE, ICE_FRESH, ICE_MID, ICE_PALE, IRON, IRON_DARK, LEATHER, PAINT, PI, RIME, ARMOUR, SHARD, SHARD_DIM,
    SKIN_GIANT, SKIN_RIMED, SNOW, STONE, TAU, TIMBER, ROPE, WYRM_BELLY, WYRM_HIDE, WYRM_HORN, WYRM_MEMBRANE, P,
    _fbm, chain_link, crystal, icicles, mix, snowcap, sstep,
)

FACE_HALF = 80.0
FACE_TOP = 100.0
# Where Korgath's four chains run into the ice (face frame x, z); y from face_y.
CHAIN_ENTRIES = [(-56.0, 44.0), (-24.0, 72.0), (28.0, 70.0), (58.0, 46.0)]
# The shell over the hollow: an irregular oval round the coiled wyrm.
WINDOW_C = (6.0, 29.0)
WINDOW_R = (49.0, 28.5)
# The stage-1 scar (a plate gone from the foot, right of the coil).
SCAR = (46.0, 9.0, 13.0, 10.0)     # cx, cz, half-width, half-height


def face_base_y(x):
    return -22.0 * (x / FACE_HALF) ** 2


def face_top(x):
    t = abs(x) / FACE_HALF
    return FACE_TOP - 30.0 * t ** 3 + 7.0 * (_fbm(x * 0.06, 3.0, 1.0) - 0.5)


def face_relief(x, z):
    """How far the ice stands proud toward the lake (+ toward -Y): great
    bulges, a gentle overhang near the crest, vertical striation and the
    deep grooves of old crevasses."""
    b = 5.0 * math.exp(-((x + 34) / 22) ** 2 - ((z - 62) / 26) ** 2)
    b += 4.0 * math.exp(-((x - 44) / 18) ** 2 - ((z - 34) / 24) ** 2)
    b += 3.0 * math.exp(-((x - 6) / 30) ** 2 - ((z - 82) / 14) ** 2)
    b += 2.6 * math.exp(-((x + 62) / 12) ** 2 - ((z - 26) / 20) ** 2)
    b += 0.045 * z
    groove = math.sin(x * 0.42 + _fbm(x * 0.05, z * 0.02, 2.0) * 5.0)
    b -= 1.6 * max(0.0, groove) ** 8
    b += 0.9 * (_fbm(x * 0.5, z * 0.035, 7.0) - 0.5)
    b += 0.6 * (_fbm(x * 0.16, z * 0.16, 9.0) - 0.5)
    return b


def _snap(fn, centre, x, z):
    """Move (x, z) onto fn's edge (fn = 1) along the ray from the centre when it
    lies close to it."""
    r = fn(x, z)
    if not 0.9 < r < 1.1:
        return x, z
    dx, dz = x - centre[0], z - centre[1]
    lo, hi = 0.0, 2.0
    for _ in range(20):
        mid = (lo + hi) / 2
        if fn(centre[0] + dx * mid, centre[1] + dz * mid) < 1.0:
            lo = mid
        else:
            hi = mid
    return centre[0] + dx * lo, max(0.0, centre[1] + dz * lo)


def face_y(x, z):
    return face_base_y(x) - face_relief(x, z)


def window_r(x, z):
    """< 1 inside the shell over the hollow."""
    dx = (x - WINDOW_C[0]) / WINDOW_R[0]
    dz = (z - WINDOW_C[1]) / WINDOW_R[1]
    a = math.atan2(dz, dx)
    wob = 1 + 0.1 * math.sin(a * 3 + 0.7) + 0.06 * math.sin(a * 7 + 2.1)
    return math.hypot(dx, dz) / wob


CALVED_C = (-20.0, 31.0)
CALVED_R = (21.0, 21.0)


def calved_r(x, z):
    """< 1 where the shell has calved away (over the head and the neck)."""
    dx = (x - CALVED_C[0]) / CALVED_R[0]
    dz = (z - CALVED_C[1]) / CALVED_R[1]
    a = math.atan2(dz, dx)
    jag = 1 + 0.16 * math.sin(a * 5 + 1.3) + 0.09 * math.sin(a * 11 + 0.4) + 0.05 * math.sin(a * 23)
    return math.hypot(dx, dz) / jag


def scar_in(x, z):
    cx, cz, hw, hh = SCAR
    jag = 1 + 0.12 * math.sin(x * 0.9) + 0.08 * math.sin(z * 1.3 + 1)
    return max(abs(x - cx) / hw, abs(z - cz) / hh) / jag


# =================================================================== the face
def _face(calved=False):
    """The Calving Face (or, calved, its stage 4 form)."""
    p = P('FaceCalved' if calved else 'CalvingFace', frost=0.6, seed=7 if calved else 3, depth=1.2)
    bm = p.bm
    cell = 1.6
    nx = int(FACE_HALF * 2 / cell)
    nz = 64
    grid = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            x = -FACE_HALF + i * cell
            zt = face_top(x)
            z = zt * (j / nz)
            # Snap the vertices next to the shell's edge (and the calved
            # hole's) onto it, so both edges run smooth, never stepped.
            x, z = _snap(window_r, WINDOW_C, x, z)
            if calved:
                x, z = _snap(calved_r, CALVED_C, x, z)
            row.append((x, face_y(x, z), z))
        grid.append(row)
    verts = [[bm.verts.new(Vector(q)) for q in row] for row in grid]
    front, glass = [], []
    # (Face cells are shaded smooth: the striation reads as fluting.)
    hole = set()
    for j in range(nz):
        for i in range(nx):
            q = grid[j][i]
            cx = q[0] + cell / 2
            cz = (grid[j][i][2] + grid[j + 1][i + 1][2]) / 2
            if calved and calved_r(cx, cz) < 1.0:
                hole.add((i, j))
                continue
            try:
                f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            except ValueError:
                continue
            f.smooth = True
            if window_r(cx, cz) < 1.0:
                p._paint([f], GLASS_ICE, GLASS)
                glass.append(f)
            else:
                with p.as_kind(ICE):
                    p._paint([f], GLACIER, STONE)
                front.append(f)
    # Colour by vertex (shared vertices keep one colour): the shell deepens
    # toward its middle; the ice is clear blue toward the shell, denser and
    # whiter out at the flanks and up near the crest.
    for f in glass:
        for loop in f.loops:
            q = loop.vert.co
            loop[p.col] = (*mix(GLASS_ICE, GLASS_DEEP, sstep(0.9, 0.2, window_r(q.x, q.z))), 1.0)
    for f in front:
        for loop in f.loops:
            q = loop.vert.co
            near = sstep(1.5, 1.0, window_r(q.x, q.z))
            tone = mix(ICE_MID, GLACIER, near * 0.8)
            tone = mix(tone, ICE_PALE, sstep(0.6, 1.0, q.z / face_top(q.x)) * 0.5)
            tone = mix(tone, DEEP_ICE, 0.35 * sstep(0.6, 1.0, abs(q.x) / FACE_HALF))
            loop[p.col] = (*tone, 1.0)
    p.facing(front + glass, (0, -1, 0))
    # The hollow behind the shell: an inward bowl of deep ice.
    rings = []
    steps = 9
    seg = 40
    for k in range(steps + 1):
        t = k / steps
        ring = []
        for s in range(seg):
            a = TAU * s / seg
            # Walk out to the window's edge along this bearing.
            lo, hi = 0.0, 2.0
            for _ in range(18):
                mid = (lo + hi) / 2
                x = WINDOW_C[0] + math.cos(a) * WINDOW_R[0] * mid
                z = WINDOW_C[1] + math.sin(a) * WINDOW_R[1] * mid
                if window_r(x, z) < 1.0:
                    lo = mid
                else:
                    hi = mid
            scale = lo * (1.0 + 0.08 * math.sin(PI * t) - 0.25 * t * t)
            x = WINDOW_C[0] + math.cos(a) * WINDOW_R[0] * scale
            z = max(-1.0, WINDOW_C[1] + math.sin(a) * WINDOW_R[1] * scale)
            y0 = face_y(x, z) + 0.6
            y = y0 + (44.0 - y0) * t
            ring.append((x, y, z))
        rings.append(ring)
    cv = [[bm.verts.new(Vector(q)) for q in ring] for ring in rings]
    cav = []
    for a, b in zip(cv, cv[1:]):
        for s in range(seg):
            cav.append(bm.faces.new((a[s], a[(s + 1) % seg], b[(s + 1) % seg], b[s])))
    back = bm.faces.new(cv[-1])
    cav.append(back)
    # The hollow's walls glow from within (the shard's light in the ice):
    # brightest behind the wyrm, so he stands dark against it.
    with p.as_kind(PAINT):
        for f in cav:
            c = f.calc_center_median()
            t = min(1.0, (c.y - 2) / 42)
            halo = math.exp(-((c.x - 4) / 30) ** 2 - ((c.z - 26) / 20) ** 2)
            col = mix(DEEP_ICE, (0.5, 0.78, 0.94), halo * (0.4 + 0.6 * t))
            if c.z < 4:
                col = mix(col, ICE_CORE, 0.6)
            p._paint([f], col, STONE)
    centre = Vector((WINDOW_C[0], 20.0, WINDOW_C[1]))
    p.facing(cav, lambda c: centre - c)
    # The crest and the glacier's top behind it, and the flanks closing back.
    top = []
    depth = [0.0, 6.0, 14.0, 26.0, 42.0, 60.0]
    tv = []
    for k, d in enumerate(depth):
        row = []
        for i in range(nx + 1):
            x = -FACE_HALF + i * cell
            zt = face_top(x)
            y = face_y(x, zt) + d
            z = zt + (0 if k == 0 else 3.0 * math.sin(min(1.0, d / 14) * PI / 2)
                      + 2.4 * (_fbm(x * 0.07, d * 0.07, 5.0) - 0.5) + d * 0.18)
            row.append(bm.verts.new(Vector((x, y, z))))
        tv.append(row)
    for a, b in zip(tv, tv[1:]):
        for i in range(nx):
            top.append(bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])))
    # Weld the crest row to the front grid's top row by sharing positions.
    with p.as_kind(SNOW):
        p._paint(top, RIME, STONE)
    p.facing(top, (0, 0, 1))
    sides = []
    for sgn, i in ((-1, 0), (1, nx)):
        col = [verts[j][i] for j in range(nz + 1)]
        backs = []
        for j in range(nz + 1):
            q = col[j].co
            backs.append(bm.verts.new(Vector((q.x + sgn * 4.0, q.y + 62.0, q.z))))
        for j in range(nz):
            sides.append(bm.faces.new((col[j], col[j + 1], backs[j + 1], backs[j])))
    with p.as_kind(ICE):
        p._paint(sides, DEEP_ICE, STONE)
    p.facing(sides, lambda c: Vector((1 if c.x > 0 else -1, 0, 0)))
    # Seracs along the crest, some leaning out over the face.
    for k in range(26):
        x = -FACE_HALF + 4 + k * (FACE_HALF * 2 - 8) / 25 + p.rng.uniform(-2, 2)
        zt = face_top(x)
        y = face_y(x, zt) + p.rng.uniform(1.5, 9)
        h = p.rng.uniform(5, 13) * (1.2 if abs(x) < 40 else 0.9)
        w = p.rng.uniform(4, 8)
        with p.as_kind(ICE):
            crystal(p, (x, y, zt + h * 0.35), (w, w * 0.8, h), p.vary(GLACIER, 0.08), n=14,
                    yaw=p.rng.uniform(0, TAU), pitch=p.rng.uniform(-0.25, 0.1), boxy=0.55)
        if p.rng.random() < 0.6:
            snowcap(p, (x, y + 0.5, zt + h * 0.8), (w * 0.8, w * 0.7, 1.4))
    # Icicle curtains off the crest's lip.
    tips = []
    for k in range(46):
        x = p.rng.uniform(-FACE_HALF + 3, FACE_HALF - 3)
        z = face_top(x) - 0.4
        tips.append((x, face_y(x, z) - 0.6, z))
    icicles(p, tips, 8.0, 0.6, ICE_PALE, sides=5)
    # The frame of the shell: a ridge of pale clear ice round its edge.
    rim = []
    for s_ in range(30):
        a = TAU * (s_ + p.rng.uniform(-0.3, 0.3)) / 30
        lo, hi = 0.0, 2.0
        for _ in range(16):
            mid = (lo + hi) / 2
            if window_r(WINDOW_C[0] + math.cos(a) * WINDOW_R[0] * mid, WINDOW_C[1] + math.sin(a) * WINDOW_R[1] * mid) < 1:
                lo = mid
            else:
                hi = mid
        x = WINDOW_C[0] + math.cos(a) * WINDOW_R[0] * lo * 1.01
        z = WINDOW_C[1] + math.sin(a) * WINDOW_R[1] * lo * 1.01
        if z > 0.6 and not (calved and calved_r(x, z) < 1.15):
            rim.append((x, face_y(x, z) - 0.2, z))
    with p.as_kind(ICE):
        for q in rim:
            sz = p.rng.uniform(3.0, 7.5)
            crystal(p, q, (sz, 2.2, sz * p.rng.uniform(0.5, 0.9)), p.vary(ICE_PALE, 0.06), n=14,
                    yaw=p.rng.uniform(-0.4, 0.4), roll=p.rng.uniform(0, TAU), boxy=0.55, jitter=0.2)
    # The four chain entries: where each chain runs into the ice, a dark
    # socket in a heaved collar of broken ice and rime.
    for (x, z) in CHAIN_ENTRIES:
        y = face_y(x, z)
        with p.as_kind(PAINT):
            p.prism((x, y + 0.3, z), 12, 2.6, 2.2, -0.2, ICE_CORE, axis=(0, -1, 0))
        with p.as_kind(ICE):
            for k in range(5):
                a = TAU * k / 5 + p.rng.uniform(-0.4, 0.4)
                s = p.rng.uniform(2.2, 3.8)
                crystal(p, (x + math.cos(a) * 3.4, y - 0.5, z + math.sin(a) * 3.0), (s, 1.8, s * 0.8),
                        p.vary(ICE_PALE, 0.05), n=12, yaw=p.rng.uniform(0, TAU), boxy=0.6)
        snowcap(p, (x, y - 0.8, z + 3.4), (5.0, 1.8, 0.8))
    # The foot: broken blocks in the lake, the old calvings.
    for k in range(34):
        x = p.rng.uniform(-FACE_HALF + 2, FACE_HALF - 2)
        y = face_base_y(x) - p.rng.uniform(0.5, 9)
        s = p.rng.uniform(2.2, 6.5)
        with p.as_kind(ICE):
            crystal(p, (x, y, s * 0.18), (s * 1.3, s, s * 0.8), p.vary(GLACIER, 0.1), n=12, yaw=p.rng.uniform(0, TAU),
                    pitch=p.rng.uniform(-0.4, 0.4), roll=p.rng.uniform(-0.4, 0.4), floor=-1.2)
    if calved:
        _calved_break(p, bm)
        _bake_cracks(p)
    return p


def _calved_break(p, bm):
    """The fresh break round the hole: a jagged rim of clear blue ice that
    runs back from the front into the hollow, broken teeth along it."""
    seg = 56
    outer, inner = [], []
    for s in range(seg):
        a = TAU * s / seg
        lo, hi = 0.0, 2.0
        for _ in range(16):
            mid = (lo + hi) / 2
            x = CALVED_C[0] + math.cos(a) * CALVED_R[0] * mid
            z = CALVED_C[1] + math.sin(a) * CALVED_R[1] * mid
            if calved_r(x, z) < 1.0:
                lo = mid
            else:
                hi = mid
        x = CALVED_C[0] + math.cos(a) * CALVED_R[0] * lo
        z = CALVED_C[1] + math.sin(a) * CALVED_R[1] * lo
        y = face_y(x, z)
        outer.append(bm.verts.new(Vector((x, y - 0.1, z))))
        k = p.rng.uniform(0.82, 0.96)
        xi = CALVED_C[0] + math.cos(a) * CALVED_R[0] * lo * k
        zi = CALVED_C[1] + math.sin(a) * CALVED_R[1] * lo * k
        inner.append(bm.verts.new(Vector((xi, y + p.rng.uniform(6, 11), zi))))
    rim = []
    for s in range(seg):
        rim.append(bm.faces.new((outer[s], outer[(s + 1) % seg], inner[(s + 1) % seg], inner[s])))
    with p.as_kind(ICE):
        for f in rim:
            p._paint([f], p.vary(ICE_FRESH, 0.06), STONE)
    c = Vector((CALVED_C[0], 2.0, CALVED_C[1]))
    p.facing(rim, lambda q: c - q)
    for s in range(0, seg, 3):
        q = outer[s].co
        with p.as_kind(ICE):
            crystal(p, (q.x, q.y + 1.5, q.z), (p.rng.uniform(1.6, 3.4), 2.4, p.rng.uniform(1.6, 3.6)),
                    p.vary(ICE_FRESH, 0.06), n=10, yaw=p.rng.uniform(0, TAU), boxy=0.5)


# ---------------------------------------------------------------- the cracks
def _crack_path(p, a, b, steps, wander):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = a[0] + (b[0] - a[0]) * t
        z = a[1] + (b[1] - a[1]) * t
        if 0 < i < steps:
            x += p.rng.uniform(-wander, wander)
            z += p.rng.uniform(-wander, wander) * 0.6
        pts.append((x, z))
    return pts


def _ribbon(p, pts, width, color, mat, lift, kind=ICE):
    """A strip over the face along (x, z) points, `lift` proud of the ice."""
    bm = p.bm
    before = set(bm.faces)
    left, right = [], []
    for i, (x, z) in enumerate(pts):
        x0, z0 = pts[max(0, i - 1)]
        x1, z1 = pts[min(len(pts) - 1, i + 1)]
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz) or 1.0
        nx_, nz_ = -dz / L, dx / L
        w = width * (0.25 + 0.75 * math.sin(PI * min(1.0, (i + 0.5) / max(1, len(pts) - 1))) ** 0.6)
        for sgn, out in ((1, left), (-1, right)):
            px, pz = x + nx_ * w * sgn, z + nz_ * w * sgn
            out.append(bm.verts.new(Vector((px, face_y(px, pz) - lift, pz))))
    for i in range(len(pts) - 1):
        bm.faces.new((left[i], left[i + 1], right[i + 1], right[i]))
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(kind):
        p._paint(faces, color, mat)
    p.facing(faces, (0, -1, 0))
    return faces


def _crack(p, a, b, width, glow, steps=14, wander=2.4, branches=3):
    """One crack: dark fissure lips with the light of the depth in it, and
    a few branches."""
    main = _crack_path(p, a, b, steps, wander)
    _ribbon(p, main, width, DEEP_ICE, STONE, 0.18)
    _ribbon(p, main, width * 0.34, glow, GLOW, 0.3, kind=PAINT)
    for k in range(branches):
        i = p.rng.randrange(2, len(main) - 2)
        x, z = main[i]
        ang = p.rng.uniform(0, TAU)
        L = p.rng.uniform(5, 12) * (width / 0.9)
        end = (x + math.cos(ang) * L, z + math.sin(ang) * L * 0.7)
        br = _crack_path(p, (x, z), end, 5, wander * 0.6)
        _ribbon(p, br, width * 0.55, DEEP_ICE, STONE, 0.17)
        _ribbon(p, br, width * 0.2, glow, GLOW, 0.27, kind=PAINT)
    return main


def face_crack_0():
    """Stage 0: one hairline crack across the face, high over the shell."""
    p = P('FaceCrack_0', frost=0.0, seed=1)
    _crack(p, (-46, 58), (30, 63), 0.55, mix(CRACK_GLOW, (0.3, 0.45, 0.55), 0.3), steps=22, wander=1.6, branches=4)
    return p


def face_crack_1():
    """Stage 1: the scar where a plate fell from the foot: a fresh break of
    clear blue ice with a broken rim, cracks running up from it."""
    p = P('FaceCrack_1', frost=0.2, seed=2)
    bm = p.bm
    cx, cz, hw, hh = SCAR
    n = 14
    rows = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            x = cx - hw * 1.25 + 2.5 * hw * i / n
            z = max(0.0, cz - hh * 1.25 + 2.5 * hh * j / n)
            row.append((x, z))
        rows.append(row)
    vs = []
    for row in rows:
        vr = []
        for (x, z) in row:
            s = scar_in(x, z)
            sink = 2.2 * sstep(1.0, 0.55, s)
            vr.append(bm.verts.new(Vector((x, face_y(x, z) - 0.25 + sink, z))))
        vs.append(vr)
    faces = []
    for j in range(n):
        for i in range(n):
            x, z = rows[j][i]
            if scar_in(x + hw * 0.09, z + hh * 0.09) > 1.05:
                continue
            faces.append(bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])))
    with p.as_kind(ICE):
        for f in faces:
            c = f.calc_center_median()
            p._paint([f], mix(ICE_FRESH, GLACIER, sstep(0.4, 1.0, scar_in(c.x, c.z))), STONE)
    p.facing(faces, (0, -1, 0))
    # The broken rim: teeth of old weathered ice round the scar.
    for k in range(18):
        a = TAU * k / 18
        x = cx + math.cos(a) * hw * 1.02
        z = cz + math.sin(a) * hh * 1.02
        if z < 0.5:
            continue
        with p.as_kind(ICE):
            crystal(p, (x, face_y(x, z) - 0.6, z), (2.4, 1.6, 2.2), p.vary(GLACIER, 0.06), n=10,
                    yaw=p.rng.uniform(0, TAU), boxy=0.5)
    _crack(p, (cx - 4, cz + hh), (cx - 14, cz + hh + 22), 0.7, CRACK_GLOW, steps=10, branches=2)
    _crack(p, (cx + 6, cz + hh), (cx + 16, cz + hh + 16), 0.55, CRACK_GLOW, steps=8, branches=1)
    return p


def face_plate_fallen():
    """The plate that fell at stage 1, lying broken in the lake at the scar's
    foot (face frame: the runtime places it with the face)."""
    p = P('FacePlateFallen', frost=0.4, seed=4)
    cx = SCAR[0]
    y0 = face_base_y(cx) - 14
    with p.as_kind(ICE):
        crystal(p, (cx - 1, y0, 1.0), (24, 15, 4.5), GLACIER, n=22, yaw=0.15, pitch=0.12, roll=-0.08, boxy=0.4,
                floor=-2.0)
        crystal(p, (cx + 10, y0 - 7, 0.6), (9, 7, 3.4), ICE_MID, n=14, yaw=0.9, pitch=-0.2, boxy=0.45, floor=-2.0)
        crystal(p, (cx - 12, y0 + 3, 1.2), (8, 9, 4), DEEP_ICE, n=14, yaw=-0.5, roll=0.3, boxy=0.45, floor=-2.0)
        for k in range(10):
            crystal(p, (cx + p.rng.uniform(-16, 16), y0 + p.rng.uniform(-12, 8), 0.3),
                    (p.rng.uniform(1.4, 3.6),) * 3, p.vary(GLACIER, 0.1), n=10, yaw=p.rng.uniform(0, TAU),
                    pitch=p.rng.uniform(-0.6, 0.6), floor=-1.2)
    snowcap(p, (cx - 1, y0 + 1, 3.2), (16, 9, 1.0), yaw=0.15)
    return p


def face_crack_2(which):
    """Stage 2: a crack racing from one of the four chain entries."""
    p = P('FaceCrack_2' + 'abcd'[which], frost=0.0, seed=10 + which)
    x, z = CHAIN_ENTRIES[which]
    ends = [(-30, 6), (-6, 30), (22, 34), (40, 4)]
    _crack(p, (x, z), ends[which], 0.85, CRACK_GLOW, steps=16, wander=3.0, branches=4)
    # A radial burst round the entry where the chain tore out.
    for k in range(6):
        a = TAU * k / 6 + p.rng.uniform(-0.3, 0.3)
        L = p.rng.uniform(4, 8)
        _crack(p, (x, z), (x + math.cos(a) * L, z + math.sin(a) * L), 0.4, CRACK_GLOW, steps=4, wander=0.8,
               branches=0)
    return p


def face_crack_3():
    """Stage 3: the great split from the crest to the foot, the shard's warm
    light deep in it."""
    p = P('FaceCrack_3', frost=0.0, seed=20)
    main = _crack(p, (10, face_top(10) - 1), (-4, 0.5), 2.6, mix(SHARD, SHARD_DIM, 0.35), steps=34, wander=3.4,
                  branches=7)
    # Its edges stand proud and broken.
    for (x, z) in main[1:-1:2]:
        for sgn in (-1, 1):
            xx = x + sgn * p.rng.uniform(2.2, 3.4)
            with p.as_kind(ICE):
                crystal(p, (xx, face_y(xx, z) - 0.7, z), (p.rng.uniform(1.4, 2.6), 1.4, p.rng.uniform(2, 3.4)),
                        p.vary(ICE_FRESH, 0.06), n=10, yaw=p.rng.uniform(0, TAU), boxy=0.5)
    return p


def _bake_cracks(p):
    """FaceCalved carries every crack the face has suffered by stage 4."""
    _crack(p, (-46, 58), (30, 63), 0.55, CRACK_GLOW, steps=22, wander=1.6, branches=2)
    _crack(p, (10, face_top(10) - 1), (6, 50), 2.4, mix(SHARD, SHARD_DIM, 0.35), steps=18, wander=3.0, branches=3)
    _crack(p, (2, 12), (-4, 0.5), 2.0, mix(SHARD, SHARD_DIM, 0.35), steps=6, wander=2.0, branches=1)
    for (x, z), end in zip(CHAIN_ENTRIES, [(-36, 30), (-10, 52), (22, 34), (40, 4)]):
        _crack(p, (x, z), end, 0.8, CRACK_GLOW, steps=10, wander=2.6, branches=2)


# ================================================================== the wyrm
def wyrm_silhouette(bpy):
    """Korzul in the ice (face frame): the sculpted coiled great wyrm, dark and
    rimed, one wing half spread across the face, the head turned toward the
    lake, ribs arching over the hollow in his chest where the heart glows
    (Kit_WyrmHeart). The fallback until the real Korzul model is swapped in."""
    p = P('WyrmSilhouette', frost=0.35, seed=5)
    f, verts, faces = gs.wyrm_mesh(bpy)
    bm = p.bm
    vs = [bm.verts.new(Vector(v)) for v in verts]
    made = []
    for poly in faces:
        try:
            made.append(bm.faces.new([vs[i] for i in poly]))
        except ValueError:
            pass
    bm.normal_update()
    import numpy as np
    centres = np.array([tuple(m.calc_center_median()) for m in made])
    kinds = f.classify(centres)
    colours = {'hide': WYRM_HIDE, 'belly': WYRM_BELLY, 'horn': WYRM_HORN, 'membrane': WYRM_MEMBRANE}
    with p.as_kind(FLESH):
        for m, k in zip(made, kinds):
            m.smooth = True
            p._paint([m], colours.get(k, WYRM_HIDE), STONE)
    return p


def wyrm_heart():
    """The shard's heartbeat in the wyrm's chest (glow, its own node, face
    frame): the runtime pulses it. A knot of rose-gold light with a core."""
    p = P('WyrmHeart', frost=0.0, seed=6)
    hx, hy, hz = gs.WYRM_HEART
    with p.as_kind(PAINT):
        crystal(p, (hx, hy + 0.6, hz), (6.2, 4.6, 7.0), mix(SHARD, SHARD_DIM, 0.5), n=20, boxy=0.9, mat=GLOW)
        crystal(p, (hx, hy - 0.6, hz + 0.2), (3.2, 2.6, 4.0), SHARD, n=14, boxy=0.8, mat=GLOW)
        # Splinters of the shard pushing out between the ribs.
        for k in range(7):
            a = TAU * k / 7 + 0.3
            q = (hx + math.cos(a) * 2.2, hy - 1.6, hz + math.sin(a) * 2.6)
            p.prism(q, 4, 0.35, 0.02, 1.6, mix(SHARD, SHARD_DIM, 0.3), mat=GLOW, axis=(math.cos(a), -0.8, math.sin(a)))
    return p


# ================================================================== the held
def _bm_sculpt(p, field, verts, faces, colours, kind=FLESH):
    import numpy as np
    bm = p.bm
    vs = [bm.verts.new(Vector(v)) for v in verts]
    made = []
    for poly in faces:
        try:
            made.append(bm.faces.new([vs[i] for i in poly]))
        except ValueError:
            pass
    bm.normal_update()
    centres = np.array([tuple(m.calc_center_median()) for m in made])
    kinds = field.classify(centres, default='skin')
    with p.as_kind(kind):
        for m, k in zip(made, kinds):
            m.smooth = True
            c = colours.get(k, colours['skin'])
            sub = IRON if k == 'iron' else kind
            with p.as_kind(sub):
                p._paint([m], c, STONE)
    return made


GIANT_COLOURS = {'skin': SKIN_GIANT, 'leather': LEATHER, 'iron': CHAIN, 'hair': HAIR, 'cloth': CLOTH_HELD,
                 'armour': ARMOUR}
HELD_COLOURS = {'skin': SKIN_RIMED, 'leather': LEATHER, 'iron': (0.4, 0.42, 0.45), 'hair': HAIR, 'cloth': CLOTH_HELD,
                'armour': ARMOUR, 'wood': TIMBER, 'rope': ROPE}

# The chain gang's poses (human scale; the giants are 3.3 times it).
GIANT_POSES = {
    # Leaning back, hauling, the chain running out in front and down.
    'A': dict(pelvis=(0, 0.25, 0.86), lean=(-0.32, 0.05), facing=(0, -1, 0), look=(0, -1, 0.15),
              arms=((0.05, -0.2, -0.25), (0.22, -0.48, -0.12), (-0.05, -0.2, -0.25), (-0.2, -0.5, -0.1)),
              legs=((0.16, -0.25, 0.48), (0.18, -0.42, 0.05), (-0.14, 0.32, 0.45), (-0.16, 0.6, 0.06))),
    # Crouched, pulling low with both hands at the knee.
    'B': dict(pelvis=(0, 0.15, 0.62), lean=(0.42, 0.0), facing=(0, -1, 0), look=(0.2, -1, 0.35),
              arms=((0.12, -0.16, -0.3), (0.08, -0.42, -0.42), (-0.1, -0.18, -0.3), (-0.08, -0.4, -0.44)),
              legs=((0.2, -0.22, 0.44), (0.22, -0.18, 0.05), (-0.18, 0.05, 0.3), (-0.2, 0.38, 0.05)), crouch=1.0),
    # One knee down, straining, a hand high on the chain overhead.
    'C': dict(pelvis=(0, 0.1, 0.55), lean=(-0.12, -0.1), facing=(0, -1, 0), look=(0.1, -0.5, 1.0),
              arms=((0.1, -0.05, 0.26), (0.05, -0.12, 0.58), (-0.22, -0.12, -0.1), (-0.3, -0.28, -0.3)),
              legs=((0.18, -0.32, 0.4), (0.2, -0.36, 0.05), (-0.14, 0.12, 0.06), (-0.14, 0.42, 0.06))),
}


def held_giant(bpy, pose_name):
    """A giant of the Smith's chain gang frozen in the ice mid-haul, still
    gripping a mast-thick link (about 6.5 yd tall in a block 9 x 7 x 9):
    the figure sculpted (apron, bracers, beard, rimed skin), the block a
    translucent shell over an opaque frozen foot, rime on its shoulders,
    the chain running out of the block. Origin at the block's base centre."""
    p = P('HeldGiant' + pose_name, frost=0.55, seed=30 + ord(pose_name))
    spec = dict(GIANT_POSES[pose_name])
    crouch = spec.pop('crouch', 0.0)
    pose = gs.pose_points(spec['pelvis'], spec['lean'], spec['facing'], spec['look'], spec['arms'], spec['legs'],
                          crouch)
    S = 4.2
    import numpy as np
    hands = (np.asarray(pose['hand_l']) + np.asarray(pose['hand_r'])) / 2 * S
    if pose_name == 'C':
        hands = np.asarray(pose['hand_l']) * S
        dirs = np.array((0.15, -0.35, 1.0))
    elif pose_name == 'B':
        dirs = np.array((0.0, -1.0, 0.25))
    else:
        dirs = np.array((0.0, -1.0, -0.35))
    dirs = dirs / np.linalg.norm(dirs)
    field = gs.humanoid_field(pose, scale=S, kit='giant', voxel=0.075)
    verts, faces = gs.mesh_sculpt(field, bpy, 'Giant' + pose_name, 7000)
    lo, hi = verts.min(axis=0), verts.max(axis=0)
    mid = (lo + hi) / 2
    size = hi - lo
    _bm_sculpt(p, field, verts, faces, GIANT_COLOURS)
    # The mast-thick chain in his fists, running out of the block.
    up = np.array((0.0, 0.0, 1.0))
    for i in range(3):
        c = hands + dirs * (i * 4.3 + 1.9)
        side = np.cross(dirs, up)
        side = side / (np.linalg.norm(side) or 1.0)
        v = side if i % 2 == 0 else np.cross(dirs, side)
        chain_link(p, tuple(c), tuple(dirs), tuple(v), 1.5, 1.05, 0.4, sides=8, segs=5)
    # The block: a frozen opaque foot, a faceted translucent shell, rime.
    # The block, fitted to him: a low frozen foot, a faceted clear shell a
    # hand's breadth off his body, rime and icicles on its brow.
    bw, bd, bh = size[0] + 2.4, size[1] + 2.0, hi[2] + 1.4
    cx, cy = mid[0], mid[1]
    with p.as_kind(ICE):
        crystal(p, (cx, cy, 0.2), (bw * 1.05, bd * 1.05, 1.4), DEEP_ICE, n=18, boxy=0.45, floor=-0.6)
        for k in range(7):
            a = TAU * k / 7 + 0.3
            crystal(p, (cx + math.cos(a) * bw * 0.5, cy + math.sin(a) * bd * 0.5, 0.3), (2.2, 1.9, 1.4),
                    p.vary(GLACIER, 0.08), n=10, yaw=a, floor=-0.6)
    shell = crystal(p, (cx, cy, bh / 2), (bw, bd, bh), GLASS_ICE, n=28, boxy=0.4, jitter=0.08, floor=-0.3, mat=GLASS)
    p.facing(shell, lambda c: c - Vector((cx, cy, bh / 2)))
    open_back(p, shell, (cx, cy, bh / 2))
    snowcap(p, (cx + 0.3, cy + 0.3, bh - 0.2), (bw * 0.7, bd * 0.6, 0.9))
    icicles(p, [(cx + p.rng.uniform(-bw * 0.4, bw * 0.4), cy - bd * 0.48, bh - p.rng.uniform(0.6, 1.6))
                for _ in range(8)], 1.8, 0.18)
    return p


HELD_DEAD = {
    # name: (kit, ice surface height, pose)
    'A': ('soldier', 1.3, dict(pelvis=(0, 0, 0.95), lean=(-0.12, 0.0), facing=(0, -1, 0), look=(0, -0.45, 1.0),
                               arms=((0.06, -0.06, -0.26), (0.08, -0.1, -0.5), (-0.06, -0.08, 0.26),
                                     (-0.05, -0.14, 0.56)),
                               legs=((0.1, 0.02, 0.5), (0.1, 0.0, 0.05), (-0.1, 0.04, 0.5), (-0.1, 0.02, 0.05)))),
    'B': ('spear', 1.0, dict(pelvis=(0, 0, 0.95), lean=(-0.2, 0.05), facing=(0, -1, 0), look=(0.1, -0.3, 1.0),
                             arms=((0.08, -0.04, -0.26), (0.12, -0.04, -0.5), (-0.1, -0.12, -0.2), (-0.1, -0.24, -0.02)),
                             legs=((0.1, -0.04, 0.5), (0.11, -0.06, 0.05), (-0.1, 0.06, 0.5), (-0.1, 0.08, 0.05)))),
    'C': ('climber', 0.7, dict(pelvis=(0, 0, 0.95), lean=(-0.28, 0.1), facing=(0.3, -1, 0), look=(0.2, -0.2, 1.0),
                               arms=((0.14, -0.02, -0.24), (0.28, -0.08, -0.42), (-0.16, -0.04, -0.22),
                                     (-0.3, -0.06, -0.4)),
                               legs=((0.11, -0.02, 0.5), (0.12, 0.0, 0.05), (-0.11, 0.05, 0.5), (-0.13, 0.08, 0.05)))),
    'D': ('soldier', 1.0, dict(pelvis=(0, 0.05, 0.5), lean=(0.05, 0.0), facing=(0, -1, 0), look=(0, -0.6, 0.8),
                               arms=((0.1, -0.14, -0.2), (0.06, -0.3, -0.34), (-0.05, -0.06, 0.28),
                                     (-0.08, -0.1, 0.58)),
                               legs=((0.12, -0.36, 0.42), (0.12, -0.42, 0.05), (-0.1, 0.0, 0.06), (-0.1, 0.36, 0.06)))),
    'E': ('soldier', 2.05, dict(pelvis=(0, 0, 0.95), lean=(-0.08, 0.0), facing=(0, -1, 0), look=(0, -0.3, 1.0),
                                arms=((0.08, -0.06, 0.28), (0.1, -0.08, 0.62), (-0.1, -0.08, -0.26),
                                      (-0.12, -0.12, -0.5)),
                                legs=((0.1, 0.0, 0.5), (0.1, 0.0, 0.05), (-0.1, 0.02, 0.5), (-0.1, 0.02, 0.05)))),
    'F': ('climber', 1.5, dict(pelvis=(0, 0, 0.95), lean=(-0.14, 0.0), facing=(0, -1, 0), look=(0, -0.25, 1.0),
                               arms=((0.12, -0.06, 0.25), (0.16, -0.1, 0.58), (-0.12, -0.06, 0.25),
                                     (-0.16, -0.1, 0.58)),
                               legs=((0.1, 0.0, 0.5), (0.1, 0.0, 0.05), (-0.1, 0.02, 0.5), (-0.1, 0.02, 0.05)))),
}


def held_dead_mesh(bpy, name, target=2600):
    kit, surface, spec = HELD_DEAD[name]
    spec = dict(spec)
    pose = gs.pose_points(spec['pelvis'], spec['lean'], spec['facing'], spec['look'], spec['arms'], spec['legs'])
    field = gs.humanoid_field(pose, scale=1.0, kit=kit)
    verts, faces = gs.mesh_sculpt(field, bpy, 'Held' + name, target)
    return field, verts, faces, surface


def held_dead(bpy, name):
    """One of the held dead: a soldier or a climber standing in shallow ice like
    a statue, whole and rimed (never a skeleton), face up, some with a hand
    above the surface. The body is seen dimly through the clear ice up to its
    surface; an opaque frozen rim and drifted snow round the foot. Origin at
    the base centre; the ice surface height is in HELD_DEAD."""
    p = P('HeldDead' + name, frost=0.65, seed=50 + ord(name))
    field, verts, faces, surface = held_dead_mesh(bpy, name)
    _bm_sculpt(p, field, verts, faces, HELD_COLOURS)
    # The ice: a clear mound to the surface, a frosted rim, snow.
    with p.as_kind(ICE):
        for k in range(7):
            a = TAU * k / 7 + p.rng.uniform(-0.2, 0.2)
            crystal(p, (math.cos(a) * 0.95, math.sin(a) * 0.85, 0.1), (0.9, 0.8, 0.45), p.vary(GLACIER, 0.08), n=9,
                    yaw=a, floor=-0.2)
    shell = crystal(p, (0, 0, surface / 2), (1.9, 1.6, surface), GLASS_ICE, n=20, boxy=0.35, jitter=0.08,
                    floor=-0.1, mat=GLASS)
    p.facing(shell, lambda c: c - Vector((0, 0, surface / 2)))
    open_back(p, shell, (0, 0, surface / 2))
    with p.as_kind(SNOW):
        for k in range(3):
            a = p.rng.uniform(0, TAU)
            crystal(p, (math.cos(a) * 1.1, math.sin(a) * 1.0, 0.05), (1.2, 0.8, 0.35), RIME, n=10, yaw=a,
                    boxy=0.9, floor=-0.1)
    return p


def vault_wall(bpy, held_cache):
    """The Ritual Vault's dripping wall (a 16 yd module, 14 tall, along X,
    front -Y): deep blue ice behind, the held dead standing inside it as
    shadowed shapes, a clear dripping skin in front, frozen drip columns and
    icicles off its lip, meltwater sheen at its foot."""
    p = P('VaultWall', frost=0.4, seed=61, depth=1.4)
    with p.as_kind(ICE):
        for k in range(9):
            x = -8 + k * 2.0 + p.rng.uniform(-0.4, 0.4)
            crystal(p, (x, 3.2 + p.rng.uniform(0, 1.2), 7), (2.8, 4.0, 14.5 + p.rng.uniform(-1, 1)),
                    p.vary(DEEP_ICE, 0.08), n=14, boxy=0.5, floor=0.0)
    # The held, deep in the wall (decimated copies of the held dead).
    import numpy as np
    for k, (name, x, y, z, s, yaw) in enumerate((('A', -5.0, 1.2, 1.4, 1.15, 0.2), ('C', -1.0, 1.8, 3.6, 1.05, -0.3),
                                                ('F', 3.2, 1.4, 0.6, 1.2, 0.1), ('B', 6.2, 1.9, 4.8, 1.0, 0.4))):
        field, verts, faces, _ = held_cache(name)
        c, sn = math.cos(yaw), math.sin(yaw)
        moved = [(x + (v[0] * c - v[1] * sn) * s, y + (v[0] * sn + v[1] * c) * s, z + v[2] * s) for v in verts]
        bm = p.bm
        vs = [bm.verts.new(Vector(v)) for v in moved]
        made = []
        for poly in faces[::1]:
            try:
                made.append(bm.faces.new([vs[i] for i in poly]))
            except ValueError:
                pass
        with p.as_kind(FLESH):
            for m in made:
                m.smooth = True
                p._paint([m], mix(SKIN_RIMED, ICE_CORE, 0.55), STONE)
    # The clear dripping skin in front.
    skin = []
    with p.as_kind(PAINT):
        for k in range(8):
            x = -7 + k * 2.0 + p.rng.uniform(-0.3, 0.3)
            skin += crystal(p, (x, -0.2, 7), (2.6, 1.6, 14), p.vary(GLASS_ICE, 0.05), n=12, boxy=0.4, floor=0.0,
                            mat=GLASS)
    p.facing(skin, (0, -1, 0))
    # Drip columns and icicles off the lip.
    with p.as_kind(ICE):
        for k in range(7):
            x = -7 + k * 2.3 + p.rng.uniform(-0.5, 0.5)
            p.prism((x, -1.1, 0), 6, 0.35, 0.2, 14.0, p.vary(ICE_PALE, 0.05), lean=(0, 0.1))
    icicles(p, [(p.rng.uniform(-7.5, 7.5), -1.2 + p.rng.uniform(-0.2, 0.3), 14.2) for _ in range(22)], 3.2, 0.16)
    with p.as_kind(SNOW):
        for k in range(6):
            snowcap(p, (-7 + k * 2.8, 2.5, 14.4), (3.2, 4.6, 1.0))
    return p
