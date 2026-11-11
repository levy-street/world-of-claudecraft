# The Quarryheart Charger's painted atlas: one base-colour sheet and one emissive sheet with the
# same layout, painted here in numpy (no image files, no reference art). Deterministic: every
# variation is a sha256 of a tag (h01), never `random` or a clock.
#
# Layout (u0, v0, u1, v1), v = 0 at the bottom as Blender stores it:
#   STONE   warm quarry stone with strata and gold-veined cracks (the plates)
#   BASALT  dark forge basalt (the saddle seat, the hoof soles, the plate undersides' rim)
#   GOLD    rubbed forge gold (hoof bands, rib rims, saddle trim, the brow circlet)
#   ICE     pale glacial ice with bright facet bands (the horns)
#   ENERGY  the heart's living fire: u is the distance from the core, white-hot to deep ember
#   EYE     white-gold, the eyes and nostrils
# The emissive sheet keeps the same regions: the veins burn gold in STONE, ENERGY is its own
# gradient, ICE carries a cold inner light, EYE is white-hot, the rest is black.

import hashlib
import math

import bpy

ATLAS_PX = 1024

R_STONE = (0.0, 0.25, 0.75, 1.0)
R_BASALT = (0.75, 0.0, 1.0, 0.25)
R_GOLD = (0.75, 0.25, 1.0, 0.5)
R_ICE = (0.75, 0.5, 1.0, 1.0)
R_ENERGY = (0.0, 0.0, 0.75, 0.125)
R_EYE = (0.0, 0.125, 0.75, 0.25)


def h01(*tag):
    d = hashlib.sha256("|".join(str(t) for t in tag).encode()).digest()
    return int.from_bytes(d[:6], "little") / float(1 << 48)


def _noise(np, w, h, cells, tag):
    """Smooth value noise on a w x h grid (cells x cells lattice), deterministic."""
    lat = np.array([[h01(tag, i, j) for j in range(cells + 1)] for i in range(cells + 1)])
    ys = np.linspace(0, cells, h, endpoint=False)
    xs = np.linspace(0, cells, w, endpoint=False)
    yi = ys.astype(int)
    xi = xs.astype(int)
    fy = (ys - yi)[:, None]
    fx = (xs - xi)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = lat[yi][:, xi]
    b = lat[yi][:, xi + 1]
    c = lat[yi + 1][:, xi]
    d = lat[yi + 1][:, xi + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def _fbm(np, w, h, tag, octaves=((4, 0.5), (11, 0.3), (29, 0.2))):
    out = np.zeros((h, w))
    for cells, amp in octaves:
        out += amp * _noise(np, w, h, cells, f"{tag}-{cells}")
    return out


def _crack_mask(np, w, h, tag, count, width):
    """Branching crack lines (random walks with forks), anti-aliased: 1 on the crack, 0 off."""
    mask = np.zeros((h, w))
    yy, xx = np.mgrid[0:h, 0:w]

    def stroke(x0, y0, x1, y1, wd):
        # distance from every pixel in the stroke's box to the segment
        pad = int(wd * 2 + 2)
        bx0 = max(0, int(min(x0, x1)) - pad)
        bx1 = min(w, int(max(x0, x1)) + pad + 1)
        by0 = max(0, int(min(y0, y1)) - pad)
        by1 = min(h, int(max(y0, y1)) + pad + 1)
        if bx0 >= bx1 or by0 >= by1:
            return
        px = xx[by0:by1, bx0:bx1]
        py = yy[by0:by1, bx0:bx1]
        dx, dy = x1 - x0, y1 - y0
        ll = dx * dx + dy * dy + 1e-9
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / ll, 0, 1)
        d = np.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
        v = np.clip(1.0 - (d - wd * 0.5) / 1.2, 0, 1)
        mask[by0:by1, bx0:bx1] = np.maximum(mask[by0:by1, bx0:bx1], v)

    def walk(x, y, ang, steps, wd, depth, key):
        for s in range(steps):
            ang += (h01(key, s, "a") - 0.5) * 0.9
            ln = 6 + 10 * h01(key, s, "l")
            nx, ny = x + math.cos(ang) * ln, y + math.sin(ang) * ln
            stroke(x, y, nx, ny, wd)
            if depth < 2 and h01(key, s, "fork") < 0.09:
                walk(nx, ny, ang + (0.7 if h01(key, s, "side") < 0.5 else -0.7),
                     int(steps * 0.45), max(0.8, wd * 0.6), depth + 1, f"{key}-{s}")
            x, y = nx, ny
            wd = max(0.8, wd * 0.985)

    for i in range(count):
        x = h01(tag, i, "x") * w
        y = h01(tag, i, "y") * h
        ang = h01(tag, i, "ang") * math.tau
        walk(x, y, ang, 26 + int(20 * h01(tag, i, "n")), width * (0.7 + 0.6 * h01(tag, i, "w")), 0,
             f"{tag}-{i}")
    return mask


def paint():
    """Returns (base_image, emissive_image), both packed into the .blend and exported."""
    import numpy as np

    W = H = ATLAS_PX
    base = np.zeros((H, W, 3))
    emit = np.zeros((H, W, 3))

    def region(r):
        u0, v0, u1, v1 = r
        return int(v0 * H), int(v1 * H), int(u0 * W), int(u1 * W)

    def c(*rgb):
        return np.array(rgb, dtype=np.float64)

    # STONE: a warm grey-tan quarry stone, sedimentary strata running across it, chisel
    # mottling, and a net of gold-veined cracks that burn in the emissive sheet
    y0, y1, x0, x1 = region(R_STONE)
    h, w = y1 - y0, x1 - x0
    mott = _fbm(np, w, h, "stone")
    strata_n = _noise(np, w, h, 5, "strata-warp")
    yy = np.arange(h)[:, None] / h
    strata = 0.5 + 0.5 * np.sin((yy * 22 + strata_n * 3.2) * math.tau)
    light = c(0.86, 0.76, 0.6)
    mid = c(0.68, 0.58, 0.45)
    dark = c(0.46, 0.39, 0.31)
    t = np.clip(0.62 * mott + 0.38 * strata, 0, 1)[..., None]
    col = dark * (1 - t) + light * t
    col = 0.75 * col + 0.25 * mid
    # pits and flecks
    fleck = _noise(np, w, h, 160, "fleck")
    col[fleck > 0.9] *= 0.82
    col[fleck < 0.04] = col[fleck < 0.04] * 0.8 + c(0.7, 0.66, 0.6) * 0.2
    cracks = _crack_mask(np, w, h, "vein", 11, 2.0)
    halo = _crack_mask(np, w, h, "vein", 11, 6.0)
    gold = c(1.0, 0.74, 0.28)
    # a scorched rim round each crack, then the gold in it
    col = col * (1 - 0.45 * (halo - cracks).clip(0, 1)[..., None])
    col = col * (1 - cracks[..., None]) + gold * cracks[..., None]
    base[y0:y1, x0:x1] = col
    emit[y0:y1, x0:x1] = c(1.0, 0.6, 0.16) * cracks[..., None] + c(0.5, 0.18, 0.02) * (
        (halo - cracks).clip(0, 1) * 0.35)[..., None]

    # BASALT: near-black forge basalt with a faint warm cast and fine grain
    y0, y1, x0, x1 = region(R_BASALT)
    h, w = y1 - y0, x1 - x0
    n = _fbm(np, w, h, "basalt")
    base[y0:y1, x0:x1] = c(0.12, 0.105, 0.1) + c(0.12, 0.1, 0.08) * n[..., None]

    # GOLD: forge gold, rubbed bright on the high spots and deep in the low
    y0, y1, x0, x1 = region(R_GOLD)
    h, w = y1 - y0, x1 - x0
    n = _fbm(np, w, h, "gold")
    brushed = _noise(np, w, h, 90, "gold-b")
    t = np.clip(0.7 * n + 0.3 * brushed, 0, 1)[..., None]
    base[y0:y1, x0:x1] = c(0.48, 0.3, 0.08) * (1 - t) + c(1.0, 0.82, 0.42) * t

    # ICE: glacial blue-white with long bright facet bands and a deep cold heart along v
    y0, y1, x0, x1 = region(R_ICE)
    h, w = y1 - y0, x1 - x0
    uu = np.arange(w)[None, :] / w
    vv = np.arange(h)[:, None] / h
    n = _fbm(np, w, h, "ice")
    bands = (0.5 + 0.5 * np.sin((uu * 7 + n * 0.8) * math.tau)) ** 6
    col = c(0.42, 0.72, 0.92) * (1 - vv[..., None] * 0.35) + c(0.86, 0.96, 1.0) * (
        0.3 * n[..., None] + 0.55 * bands[..., None])
    base[y0:y1, x0:x1] = np.clip(col, 0, 1)
    emit[y0:y1, x0:x1] = c(0.2, 0.62, 1.0) * (0.25 + 0.55 * vv + 0.4 * bands)[..., None]

    # ENERGY: u is distance from the core. White-hot at the heart, gold, forge orange, then a
    # deep ember red that still glows, so every gap between the plates reads as living fire
    y0, y1, x0, x1 = region(R_ENERGY)
    h, w = y1 - y0, x1 - x0
    uu = np.arange(w)[None, :] / (w - 1)
    flow = _fbm(np, w, h, "energy", ((6, 0.6), (18, 0.4)))
    stops = [
        (0.0, c(1.0, 0.97, 0.88)),
        (0.08, c(1.0, 0.84, 0.42)),
        (0.2, c(1.0, 0.52, 0.1)),
        (0.45, c(0.86, 0.24, 0.04)),
        (1.0, c(0.42, 0.07, 0.02)),
    ]
    g = np.zeros((h, w, 3))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        m = ((uu >= a) & (uu <= b))
        f = ((uu - a) / (b - a)).clip(0, 1)[..., None]
        g = np.where(m[..., None], ca * (1 - f) + cb * f, g)
    # molten flow: dark crusted bands drifting across, bright rivers between them
    vv = np.arange(h)[:, None] / h
    river = 0.5 + 0.5 * np.sin((vv * 3.0 + flow * 2.2 + uu * 1.5) * math.tau)
    crust = np.clip((river - 0.62) / 0.3, 0, 1)
    hot = np.clip((0.3 - river) / 0.3, 0, 1)
    g = g * (0.9 - 0.55 * crust[..., None]) + c(1.0, 0.75, 0.3) * (0.35 * hot)[..., None]
    # the unlit colour is the crust (dark), the light is all in the emissive sheet
    base[y0:y1, x0:x1] = np.clip(g * 0.35, 0, 1)
    emit[y0:y1, x0:x1] = np.clip(g, 0, 1)

    # EYE: white-gold
    y0, y1, x0, x1 = region(R_EYE)
    base[y0:y1, x0:x1] = c(1.0, 0.94, 0.72)
    emit[y0:y1, x0:x1] = c(1.0, 0.9, 0.6)

    return _image("QuarryheartAtlas", np, base), _image("QuarryheartGlow", np, emit)


def _image(name, np, rgb):
    H, W = rgb.shape[:2]
    rgba = np.ones((H, W, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    image = bpy.data.images.new(name, W, H, alpha=False)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    return image


def uv_in(region, u, v):
    """Map a (0..1, 0..1) coordinate into a region of the atlas."""
    u0, v0, u1, v1 = region
    return (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)
