"""The cirque round the Gravewyrm Sanctum: an ERODED HEIGHTFIELD ring of Thornpeak.

Builds the closed bowl the Sanctum's glacier route winds down through, as one
heightfield (instance-local yards, z north, 1120 by 1360 yd round the field):
a ring of dark slate summits that closes the bowl on EVERY side (no horizon of
sea or mist anywhere, never an island), rising 120 to 250 yd over the floor
with a few higher horns; a high pass in the south rim behind the Gate Landing
(the gate tunnel runs through it); and in the north the Quench, a glacier
tongue that fills the valley between the summits and rises behind the Calving
Face. Ridged, domain-warped massifs under a ring envelope, hero horns with
their own silhouettes, cleavage terracing on the slate, then stream-power and
thermal erosion on a 4 yd grid (couloirs, sharpened aretes, talus fans),
upsampled to 1 yd with slope-scaled detail.

The frame (the walkable field and its landmarks, phase A lead, 2026-10-03):
  field          x -114 to 114, z -236 to 238 (everything inside is held under
                 the crevasse void, -60, so no rock ever rises into a walkway)
  Gate Landing   (0, -222) at 55, on the pass; the tunnel mouth near z -234
  frozen lake    centre (0, 188), radius 47, at 0
  Calving Face   just beyond the field, z 236 to 260 round the lake's north
                 half (a kit piece, render only); the glacier rises behind it

Outputs (raw, for scripts/assets/gravewyrm_sanctum_mountains/build.mjs, which
makes the mesh, the PNGs and the shipped GLB):
  heights.f32   the 6 yd mesh grid's heights, rows along z
  albedo.rgb    sRGB bytes at 1 yd: slate in its cleavage beds on the steep
                ground, frost-shattered scree on the gentle, snow on every
                ledge it can hold, blue ice in the couloirs, the glacier's
                snow and crevasse bands, a soft baked dusk (sky occlusion and
                a low warm light from the west afterglow)
  normal.rgb    OBJECT-SPACE normals (y up) of the 1 yd field
  meta.json     sizes, extents, the height range

Numpy only (Blender is used as a numpy host: system Python here has none):
  "<blender>" -b --factory-startup --python build_gravewyrm_sanctum_mountains.py -- --out <dir>
Deterministic: every random draw is a hash of the lattice.
"""

import json
import os
import sys

import numpy as np

# ---- the frame (must match build.mjs and the field's bounds) ------------------------
# The 6 yd mesh lines fall exactly on the field's edges (x +-114, z -236 and
# 238), so no mesh triangle straddles an edge and lifts into the field.
CX, CZ = 0.0, 126.0           # the heightfield's centre (instance-local)
HALF_X, HALF_Z = 558.0, 680.0
COARSE = 4.0                  # the erosion grid (yards)
FINE = 1.0                    # the texture grid
MESH = 6.0                    # the mesh grid
FIELD = (-114.0, 114.0, -236.0, 238.0)   # minX, maxX, minZ, maxZ
VOID = -60.0
HOLD = -66.0                  # the crevasse floor under the field
FLOOR_MIN = -74.0
LANDING_Y = 55.0
LAKE = (0.0, 188.0, 47.0)
# The low dusk light: the afterglow behind the western peaks.
SUN = np.array([-0.86, 0.32, 0.12])

# Slate beds (linear): blue-black, grey, a rusty band, a pale quartz seam.
BEDS = np.array([
    [0.085, 0.092, 0.108],
    [0.125, 0.132, 0.150],
    [0.105, 0.105, 0.115],
    [0.150, 0.128, 0.110],
    [0.095, 0.104, 0.124],
    [0.185, 0.190, 0.200],
])
SNOW = np.array([0.80, 0.86, 0.92])
ICE = np.array([0.30, 0.52, 0.70])
ICE_DEEP = np.array([0.08, 0.20, 0.36])


# ---- lattice noise ------------------------------------------------------------------
def _hash(ix, iz, seed):
    h = (ix.astype(np.int64) * 374761393 + iz.astype(np.int64) * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / float(0x1000000)


def noised(x, z, seed):
    """Value noise in 0..1 with its analytic gradient."""
    ix = np.floor(x)
    iz = np.floor(z)
    fx = x - ix
    fz = z - iz
    ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    dux = 30 * fx * fx * (fx * (fx - 2) + 1)
    duz = 30 * fz * fz * (fz * (fz - 2) + 1)
    a = _hash(ix, iz, seed)
    b = _hash(ix + 1, iz, seed)
    c = _hash(ix, iz + 1, seed)
    d = _hash(ix + 1, iz + 1, seed)
    k1 = b - a
    k2 = c - a
    k3 = a - b - c + d
    v = a + k1 * ux + k2 * uz + k3 * ux * uz
    return v, dux * (k1 + k3 * uz), duz * (k2 + k3 * ux)


def noise(x, z, seed):
    return noised(x, z, seed)[0]


def fbm(x, z, seed, octaves=5, gain=0.5, lac=2.03):
    s = np.zeros_like(x)
    a = 0.5
    for o in range(octaves):
        s += noise(x, z, seed + o * 17) * a
        x, z = (x * 0.8 - z * 0.6) * lac, (x * 0.6 + z * 0.8) * lac
        a *= gain
    return s


def ridged(x, z, seed, octaves=6, lac=2.07, gain=0.52, sharp=1.0):
    """Ridged multifractal, 0..about 1: sharp crests, detail gathered on the ridges."""
    s = np.zeros_like(x)
    a = 0.55
    w = np.ones_like(x)
    for o in range(octaves):
        n = 1.0 - np.abs(noise(x, z, seed + o * 31) * 2 - 1)
        n = n ** (1.6 * sharp)
        s += n * a * w
        w = np.clip(n * 1.6, 0, 1)
        x, z = (x * 0.8 - z * 0.6) * lac, (x * 0.6 + z * 0.8) * lac
        a *= gain
    return s


def eroded_fbm(x, z, seed, octaves=7):
    """Gradient-damped fBm: smooth valleys, rough crests."""
    s = np.zeros_like(x)
    dx = np.zeros_like(x)
    dz = np.zeros_like(x)
    a = 0.5
    for o in range(octaves):
        n, gx, gz = noised(x, z, seed + o * 13)
        dx += gx
        dz += gz
        s += a * n / (1.0 + dx * dx + dz * dz)
        x, z = (x * 0.8 - z * 0.6) * 2.0, (x * 0.6 + z * 0.8) * 2.0
        a *= 0.5
    return s


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def grid(cell):
    nx = int(round(HALF_X * 2 / cell))
    nz = int(round(HALF_Z * 2 / cell))
    x = CX - HALF_X + (np.arange(nx) + 0.5) * cell
    z = CZ - HALF_Z + (np.arange(nz) + 0.5) * cell
    return np.meshgrid(x, z)


def outside_field(X, Z):
    dx = np.maximum(0, np.maximum(FIELD[0] - X, X - FIELD[1]))
    dz = np.maximum(0, np.maximum(FIELD[2] - Z, Z - FIELD[3]))
    return np.hypot(dx, dz)


def inside_field(X, Z):
    return (X >= FIELD[0]) & (X <= FIELD[1]) & (Z >= FIELD[2]) & (Z <= FIELD[3])


# ---- the glacier (the Quench) ------------------------------------------------------------
def glacier_mask(X, Z):
    """1 on the Quench's tongue (north of the face, between the flanking ridges)."""
    half = 118 + 70 * smooth(260, 760, Z) + (fbm(X / 90, Z / 90, 501, 3) - 0.5) * 40
    side = smooth(half + 26, half - 16, np.abs(X))
    return side * smooth(232, 262, Z)


def glacier_surface(X, Z):
    """The glacier's surface: at the face's top (about 100) behind the Calving
    Face, rising north to about 230, crowned across the flow, broken by
    transverse crevasse swells and an icefall step."""
    base = 98 + (Z - 262) * 0.2 + 22 * smooth(420, 520, Z)
    crown = 9 * (1 - np.clip(np.abs(X) / 150, 0, 1) ** 2)
    swell = 2.6 * np.sin(Z / 13.0 + (fbm(X / 60, Z / 60, 511, 3) - 0.5) * 6 + X * X / 9000)
    lump = (fbm(X / 40, Z / 40, 521, 4) - 0.5) * 9
    return base + crown + swell + lump


# ---- hero horns --------------------------------------------------------------------------
def horn(X, Z, cx, cz, height, radius, rot, p=1.0, lean=(0.0, 0.0), concave=1.7):
    c, s = np.cos(rot), np.sin(rot)
    u = (X - cx) * c + (Z - cz) * s
    v = -(X - cx) * s + (Z - cz) * c
    u = u / (1 + lean[0] * np.sign(u))
    v = v / (1 + lean[1] * np.sign(v))
    r = (np.abs(u) ** p + np.abs(v) ** p) ** (1.0 / p)
    return height * np.clip(1 - r / radius, 0, 1) ** concave


def hero_peaks(X, Z):
    warp = (fbm(X / 150, Z / 150, 401, 4) - 0.5) * 80
    warp2 = (fbm(X / 44, Z / 44, 402, 4) - 0.5) * 40
    Xw = X + warp + warp2
    Zw = Z - warp * 0.7 + (fbm(X / 50, Z / 50, 403, 4) - 0.5) * 40
    out = np.zeros_like(X)
    # The Gravehorn: a tilted three-sided horn north-west over the glacier.
    out = np.maximum(out, horn(Xw, Zw, -250, 470, 330, 210, 0.4, p=0.78, lean=(0.6, -0.2), concave=1.45))
    # The Anvilhead pair north-east, a notched twin summit.
    out = np.maximum(out, horn(Xw, Zw, 245, 520, 300, 190, -0.3, p=0.76, lean=(0.5, 0.0), concave=1.5))
    out = np.maximum(out, horn(Xw, Zw, 300, 400, 250, 170, 0.2, p=0.8, lean=(-0.3, 0.4), concave=1.5))
    # West and east shoulders over the wings.
    out = np.maximum(out, horn(Xw, Zw, -300, 60, 275, 200, 0.9, p=0.82, lean=(0.4, 0.2), concave=1.5))
    out = np.maximum(out, horn(Xw, Zw, 290, -70, 285, 200, -0.6, p=0.8, lean=(-0.4, 0.3), concave=1.5))
    # The south guardians either side of the pass.
    out = np.maximum(out, horn(Xw, Zw, -190, -360, 255, 180, 0.3, p=0.8, lean=(0.3, 0.3), concave=1.5))
    out = np.maximum(out, horn(Xw, Zw, 210, -340, 265, 180, -0.4, p=0.8, lean=(-0.3, 0.2), concave=1.5))
    crag = ridged(X / 120, Z / 120, 411, 5)
    return out * (0.66 + 0.56 * crag)


# ---- the base terrain --------------------------------------------------------------------
def base_terrain(X, Z):
    d = outside_field(X, Z)
    wx = (fbm(X / 260, Z / 260, 11, 4) - 0.5) * 200
    wz = (fbm(X / 260, Z / 260, 12, 4) - 0.5) * 200
    xw = X + wx
    zw = Z + wz
    r = ridged(xw / 300, zw / 300, 21, 6)
    e = eroded_fbm(xw / 360, zw / 360, 41, 7)
    massif = 0.62 * r + 0.62 * e
    # The bowl: the ring's foot follows a warped ellipse round the field (a
    # cirque, never a trench hugging the field's edge), with bays and spurs;
    # between the field and the foot a moraine and ice apron climbs out of
    # the crevasses. Behind the Gate Landing the rim stands up at once (the
    # pass the tunnel runs through).
    bearing = np.arctan2(X, Z - 8)
    spur = 0.16 * np.sin(bearing * 9 + (fbm(X / 150, Z / 150, 65, 3) - 0.5) * 7)
    ew = 1 + (fbm(X / 90, Z / 90, 63, 3) - 0.5) * 0.45 + spur
    de = (np.hypot(X / 208, (Z - 8) / 312) * ew - 1) * 240
    pzone = smooth(95, 45, np.abs(X)) * smooth(-226, -240, Z)
    de = de * (1 - pzone) + (d - 1) * 3.2 * pzone
    apron = HOLD + 34 * smooth(0, 50, d) * (0.6 + 0.8 * fbm(X / 45, Z / 45, 64, 3))
    w1 = smooth(-6, 26, de)
    rise = smooth(4, 170, de)
    crest = 175 + 75 * fbm(X / 210 + 3.1, Z / 210 - 1.7, 61, 3) + 35 * smooth(150, 420, de)
    h = apron + w1 * ((62 + 46 * fbm(X / 60, Z / 60, 62, 3)) - apron) + rise * (crest - 62) + massif * rise * 90
    # The south pass: a saddle over the tunnel, the summits climbing either side.
    pass_w = smooth(110, 30, np.abs(X)) * smooth(-470, -300, Z) * smooth(-150, -236, Z)
    saddle = (LANDING_Y + 85 + np.abs(X) * 0.7 + np.maximum(0, -Z - 290) * 0.9
              + (fbm(X / 30, Z / 30, 71, 3) - 0.5) * 18)
    h = h * (1 - pass_w) + np.minimum(h, np.maximum(saddle, LANDING_Y + 50)) * pass_w
    heroes = hero_peaks(X, Z)
    h = np.maximum(h, heroes - 30 + rise * 30)
    # Slate cleavage: the beds step the slopes into ledges that hold snow.
    step = 34.0
    warped = h + (fbm(X / 110, Z / 110, 81, 3) - 0.5) * 30 + X * 0.08
    q = np.floor(warped / step)
    f = warped / step - q
    riser = smooth(0.3, 0.7, f)
    terr = (q + riser) * step - (warped - h)
    band = smooth(0.3, 0.7, fbm(X / 180 + 9, Z / 180, 91, 3))
    h = h + (terr - h) * 0.4 * band * smooth(20, 80, h)
    # The Quench: the glacier fills the north valley between the ridges.
    g = glacier_mask(X, Z)
    h = h * (1 - g) + np.maximum(glacier_surface(X, Z), np.minimum(h, glacier_surface(X, Z) + 4)) * g
    return h, d, g


def pin_field(h, X, Z):
    """Everything inside the walkable field lies on the crevasse floor, under
    the void, whatever the mountains do (the rim rises from the field's very
    edge). Under the Calving Face, just north of the field over the lake, the
    ground lies at the lake's level, so the face stands in it, and climbs to
    the glacier behind the face."""
    floor = HOLD - 3.0 + 3.0 * fbm(X / 30, Z / 30, 95, 4) + 1.4 * ridged(X / 50, Z / 50, 96, 3)
    floor = np.clip(floor, FLOOR_MIN, VOID - 4)
    h = np.where(inside_field(X, Z), floor, h)
    under = (Z > FIELD[3]) * smooth(120, 84, np.abs(X))
    face = -2.0 + 104.0 * smooth(FIELD[3] + 18, FIELD[3] + 54, Z) + np.maximum(0, Z - FIELD[3] - 54) * 3
    return h * (1 - under) + np.minimum(h, face) * under


# ---- erosion -----------------------------------------------------------------------------
def erode(h, pinned, iterations=40):
    nz, nx = h.shape
    offs = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
            (-1, -1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (1, 1, 1.4142)]
    flat = np.arange(nz * nx).reshape(nz, nx)
    acc = np.ones_like(h)
    for it in range(iterations):
        pad = np.pad(h, 1, mode='edge')
        best = np.zeros_like(h)
        rec = flat.copy()
        for (dz, dx, dist) in offs:
            nb = pad[1 + dz:1 + dz + nz, 1 + dx:1 + dx + nx]
            slope = (h - nb) / (COARSE * dist)
            better = slope > best
            best = np.where(better, slope, best)
            iz = np.clip(np.arange(nz)[:, None] + dz, 0, nz - 1)
            ix = np.clip(np.arange(nx)[None, :] + dx, 0, nx - 1)
            rec = np.where(better, flat[iz, ix], rec)
        order = np.argsort(-h, axis=None)
        acc = np.ones(nz * nx)
        recf = rec.ravel()
        for i in order.tolist():
            r = recf[i]
            if r != i:
                acc[r] += acc[i]
        acc = acc.reshape(nz, nx)
        drop = h - h.ravel()[recf].reshape(nz, nx)
        cut = np.minimum(0.016 * acc ** 0.5 * best * COARSE, drop * 0.55)
        cut = np.minimum(cut, 5.0)
        h = h - np.where(pinned, 0, cut)
        talus = 0.95 * COARSE
        for _ in range(2):
            pad = np.pad(h, 1, mode='edge')
            move = np.zeros_like(h)
            for (dz, dx, dist) in offs[:4]:
                nb = pad[1 + dz:1 + dz + nz, 1 + dx:1 + dx + nx]
                diff = h - nb
                out = np.maximum(0, diff - talus) * 0.11
                back = np.maximum(0, -diff - talus) * 0.11
                move += back - out
            h = h + np.where(pinned, 0, move)
        if it % 8 == 0:
            print('ERODE', it, float(h.min()), float(h.max()))
    return h, acc


def upsample(a, f):
    nz, nx = a.shape
    zs = (np.arange(nz * f) + 0.5) / f - 0.5
    z0 = np.clip(np.floor(zs).astype(int), 0, nz - 1)
    z1 = np.clip(z0 + 1, 0, nz - 1)
    wz = np.clip(zs - z0, 0, 1)[:, None]
    a = a[z0] * (1 - wz) + a[z1] * wz
    xs = (np.arange(nx * f) + 0.5) / f - 0.5
    x0 = np.clip(np.floor(xs).astype(int), 0, nx - 1)
    x1 = np.clip(x0 + 1, 0, nx - 1)
    wx = np.clip(xs - x0, 0, 1)[None, :]
    return a[:, x0] * (1 - wx) + a[:, x1] * wx


def blur(a, passes=1):
    for _ in range(passes):
        p = np.pad(a, 1, mode='edge')
        a = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + p[1:-1, 1:-1] * 2) / 6.0
    return a


def sun_shadow(h, cell):
    """0 lit .. 1 shadowed: march toward the low western light over the field."""
    hx, hz = SUN[0], SUN[2]
    hor = np.hypot(hx, hz)
    ux, uz = hx / hor, hz / hor
    rise = SUN[1] / hor
    nz, nx = h.shape
    shadow = np.zeros_like(h)
    iz = np.arange(nz)[:, None]
    ix = np.arange(nx)[None, :]
    for k in range(1, 170):
        sx = np.clip(np.rint(ix + ux * k).astype(int), 0, nx - 1)
        sz = np.clip(np.rint(iz + uz * k).astype(int), 0, nz - 1)
        over = h[sz, sx] - (h + k * cell * rise)
        shadow = np.maximum(shadow, np.clip(over / 12.0, 0, 1))
    return shadow


def sky_view(h, cell, dirs=12, steps=60):
    """0..1 openness to the sky (horizon-based): bowls and couloirs darker."""
    nz, nx = h.shape
    iz = np.arange(nz)[:, None]
    ix = np.arange(nx)[None, :]
    total = np.zeros_like(h)
    for k in range(dirs):
        a = np.pi * 2 * k / dirs
        dx, dz = np.cos(a), np.sin(a)
        best = np.zeros_like(h)
        for s in range(1, steps):
            r = s * 1.6
            sx = np.clip(np.rint(ix + dx * r).astype(int), 0, nx - 1)
            sz = np.clip(np.rint(iz + dz * r).astype(int), 0, nz - 1)
            best = np.maximum(best, (h[sz, sx] - h) / (r * cell))
        total += 1 - np.sin(np.arctan(best))
    return total / dirs


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(os.path.dirname(__file__), 'out')
    os.makedirs(out, exist_ok=True)

    Xc, Zc = grid(COARSE)
    h, d, g = base_terrain(Xc, Zc)
    h = pin_field(h, Xc, Zc)
    pinned = (d < 2) | (g > 0.5) | ((Zc > FIELD[3]) & (np.abs(Xc) < 96) & (Zc < FIELD[3] + 60))
    h, acc = erode(h, pinned)
    h = pin_field(h, Xc, Zc)
    shadow_c = sun_shadow(h, COARSE)
    sky_c = sky_view(h, COARSE)

    f = int(COARSE / FINE)
    H = blur(upsample(h, f), 3)
    Xf, Zf = grid(FINE)
    df = outside_field(Xf, Zf)
    gf = blur(upsample(glacier_mask(Xc, Zc), f), 2)
    gz_, gx_ = np.gradient(H, FINE)
    slope = np.hypot(gx_, gz_)
    # Detail: craggy slate where it is steep, frost-shattered scree where not;
    # the glacier keeps its smooth snow skin with crevasse grooves.
    crag = ridged(Xf / 30, Zf / 30, 131, 5) - 0.5
    fine = fbm(Xf / 6, Zf / 6, 141, 4) - 0.5
    amp = smooth(4, 60, df) * (1 - gf * 0.85)
    H = H + (crag * (1.4 + 6.5 * np.clip(slope, 0, 1.3)) + fine * (0.5 + 0.9 * np.clip(slope, 0, 1))) * amp
    # Cleavage ledges on the steep faces (slate splits in thin steps).
    ledge = np.sin((H + (fbm(Xf / 80, Zf / 80, 151, 3) - 0.5) * 26 + Xf * 0.05) * (2 * np.pi / 15.0))
    H = H + ledge * 0.7 * np.clip(slope - 0.5, 0, 1) * amp
    # Crevasses across the glacier: narrow transverse grooves, bowed down-flow.
    bow = Zf - (Xf ** 2) / 900.0 + (fbm(Xf / 70, Zf / 70, 161, 3) - 0.5) * 30
    crev = np.maximum(0, np.sin(bow / 7.0 * np.pi) - 0.86) / 0.14
    crev *= smooth(0.35, 0.75, fbm(Xf / 26 + 4, Zf / 26, 162, 3)) * smooth(270, 300, Zf)
    H = H - crev * 4.5 * gf
    # Hold the field and its seams exactly as pinned.
    inside = inside_field(Xf, Zf)
    H = np.where(inside, np.clip(H, FLOOR_MIN, VOID - 4), H)

    gz_, gx_ = np.gradient(H, FINE)
    slope = np.hypot(gx_, gz_)
    nrm = np.stack([-gx_, np.ones_like(gx_), -gz_], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

    # ---- albedo
    flow = upsample(np.log1p(acc), f)
    gully = smooth(3.0, 5.6, flow)
    lap = blur(H, 6) - H           # > 0 in hollows, < 0 on crests
    hollow = np.clip(lap / 2.5, -1, 1)
    bedh = H * 1.0 + Xf * 0.06 - Zf * 0.03 + (fbm(Xf / 90, Zf / 90, 171, 3) - 0.5) * 20
    bed = np.floor(bedh / 22.0).astype(np.int64)
    tone = BEDS[np.mod(bed, len(BEDS))] * (0.85 + 0.3 * _hash(bed, bed * 0 + 7, 72))[..., None]
    # One slate mass, bedded: the beds only tint it.
    tone = tone * 0.3 + np.array([0.115, 0.12, 0.135]) * 0.7
    parting = 1 - 0.18 * smooth(0.1, 0.0, bedh / 22.0 - bed)[..., None]
    mottle = (0.8 + 0.4 * fbm(Xf / 45, Zf / 45, 181, 4))[..., None]
    rock = tone * parting * mottle * 1.25
    scree = np.array([0.15, 0.155, 0.165]) * (0.8 + 0.5 * fbm(Xf / 8, Zf / 8, 191, 3))[..., None]
    steep = smooth(0.6, 1.0, slope)[..., None]
    col = scree * (1 - steep) + rock * steep
    col = col * (1 - 0.35 * gully[..., None])
    # Ice in the couloirs and gullies: blue water-ice streaks down the faces.
    couloir = np.clip(gully * smooth(0.5, 1.1, slope) + 0.6 * np.clip(hollow, 0, 1) * smooth(0.7, 1.2, slope), 0, 1)
    couloir *= smooth(0.3, 0.6, fbm(Xf / 20, Zf / 20, 201, 3)) * smooth(-40, 20, H)
    icec = ICE * (0.8 + 0.35 * fbm(Xf / 12, Zf / 12, 202, 3))[..., None]
    col = col * (1 - couloir[..., None] * 0.85) + icec * couloir[..., None] * 0.85
    # Snow: polar, so it lies on every ledge and gentle slope it can hold,
    # banking in the hollows, never on the steepest rock.
    sslope = blur(slope, 5)
    hold = smooth(1.2, 0.55, sslope - 0.35 * np.clip(hollow, 0, 1))
    hold = np.clip(hold + 0.25 * smooth(0.6, 0.85, fbm(Xf / 14, Zf / 14, 205, 3)) * smooth(1.6, 0.9, sslope), 0, 1)
    line = -40 + (fbm(Xf / 140, Zf / 140, 211, 3) - 0.5) * 60 - hollow * 40
    snow = smooth(0, 25, H - line) * hold
    snow = np.clip(snow + 0.5 * smooth(0.65, 0.3, slope) * smooth(-20, 30, H), 0, 1)
    # Spindrift flutes: thin vertical runnels of snow down the steep faces.
    flute = smooth(0.5, 0.72, fbm(Xf / 5.0 + Zf / 9.0, H / 70.0, 223, 3)) * smooth(0.7, 1.3, sslope)
    flute *= smooth(0.25, 0.55, fbm(Xf / 60, Zf / 60, 224, 3)) * smooth(10, 70, H)
    # Snow lines along the beds: each bed's top weathers back into a ledge
    # that holds a band of snow, broken where the face is sheer.
    bedtop = smooth(0.78, 0.9, bedh / 22.0 - bed) * smooth(0.35, 0.6, fbm(Xf / 18, Zf / 18, 225, 3))
    bedtop *= smooth(0.6, 1.0, sslope) * smooth(2.4, 1.4, sslope) * smooth(-10, 40, H)
    # The apron between the field and the ring: old snow over the moraine.
    apron = smooth(2, 10, df) * smooth(30, -10, H) * smooth(1.1, 0.6, sslope)
    apron *= 0.7 + 0.3 * smooth(0.4, 0.6, fbm(Xf / 16, Zf / 16, 226, 3))
    snow = np.clip(snow + flute * 0.85 + bedtop * 0.9 + apron, 0, 1)
    snowc = SNOW * (0.86 + 0.18 * fbm(Xf / 20, Zf / 20, 221, 3))[..., None]
    # The glacier: snow skin, blue in the crevasses, wind-scoured blue ice
    # in bands, the icefall steps exposed.
    glac = snowc * (1 - 0.25 * smooth(0.3, 0.8, fbm(Xf / 30, Zf / 30, 231, 3)))[..., None]
    scour = smooth(0.55, 0.8, fbm(Xf / 50 + 2, Zf / 18, 232, 3)) * 0.55
    glac = glac * (1 - scour[..., None]) + (ICE * 1.4) * scour[..., None]
    glac = glac * (1 - crev[..., None]) + ICE_DEEP * crev[..., None]
    col = col * (1 - snow[..., None]) + snowc * snow[..., None]
    col = col * (1 - gf[..., None]) + glac * gf[..., None]
    # The crevasse floor under the field: dark blue ice and old snow.
    deep = inside[..., None]
    floorc = ICE_DEEP * 0.7 * (0.8 + 0.4 * fbm(Xf / 10, Zf / 10, 241, 3))[..., None]
    col = np.where(deep, floorc, col)
    # Sky occlusion and the low warm afterglow from the west.
    sky = np.clip(blur(upsample(sky_c, f), 3), 0.25, 1)
    ao = np.clip(1 - 0.3 * np.clip(hollow, 0, 1) + 0.1 * np.clip(-hollow, 0, 1), 0.6, 1.12)
    shade = blur(upsample(shadow_c, f), 4)
    sunl = np.clip((nrm * (SUN / np.linalg.norm(SUN))).sum(-1), 0, 1) * (1 - shade)
    warm = np.array([1.18, 0.98, 0.82])
    cold = np.array([0.94, 0.98, 1.06])
    col = col * (ao * (0.55 + 0.45 * sky))[..., None] * cold * (0.82 + 0.38 * sunl[..., None] * warm)
    albedo = (np.clip(col, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
    normal = (np.clip(nrm * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)

    # ---- the mesh grid (heights at the 6 yd lines)
    mx = int(round(HALF_X * 2 / MESH)) + 1
    mz = int(round(HALF_Z * 2 / MESH)) + 1
    ix = np.clip((np.arange(mx) * MESH / FINE).astype(int), 0, H.shape[1] - 1)
    iz = np.clip((np.arange(mz) * MESH / FINE).astype(int), 0, H.shape[0] - 1)
    Hs = blur(H, 2)
    mesh = Hs[np.ix_(iz, ix)].astype(np.float32)
    # Every mesh vertex on or inside the field's edge stays under the void
    # (the lines fall on the edges, so no triangle lifts into the field).
    mxs = CX - HALF_X + np.arange(mx) * MESH
    mzs = CZ - HALF_Z + np.arange(mz) * MESH
    MX, MZ = np.meshgrid(mxs, mzs)
    mesh = np.where(inside_field(MX, MZ), np.minimum(mesh, VOID - 4), mesh).astype(np.float32)

    mesh.tofile(os.path.join(out, 'heights.f32'))
    albedo.tofile(os.path.join(out, 'albedo.rgb'))
    normal.tofile(os.path.join(out, 'normal.rgb'))
    meta = {
        'centerX': CX, 'centerZ': CZ,
        'halfX': HALF_X, 'halfZ': HALF_Z, 'meshCell': MESH,
        'meshX': mx, 'meshZ': mz,
        'texX': int(H.shape[1]), 'texZ': int(H.shape[0]),
        'minY': float(mesh.min()), 'maxY': float(mesh.max()),
    }
    with open(os.path.join(out, 'meta.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    print('MOUNTAINS', json.dumps(meta))


if __name__ == '__main__':
    main()
