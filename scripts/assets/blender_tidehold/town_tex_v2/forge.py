"""A small Substance-Designer-style texture forge in numpy: every generator is
PERIODIC (the output tiles seamlessly), everything is float32 in 0..1.

Building blocks: value/fbm noise, domain warp, jittered-grid Voronoi with the
exact distance to the cell edge, brick/tile layouts with per-tile ids, FFT
blurs (isotropic and directional), height -> normal / cavity / curvature / AO,
a painted top-left key light, gradient maps and per-cell colour tables. The
materials in paint_town.py are graphs of these.
"""
import math

import numpy as np
from PIL import Image

F = np.float32


# ---------------------------------------------------------------------------
#  basics
# ---------------------------------------------------------------------------
def rng(seed):
    return np.random.default_rng(seed)


def uv(n):
    y, x = np.mgrid[0:n, 0:n].astype(F)
    return (x + 0.5) / n, (y + 0.5) / n


def smooth(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def norm01(a):
    lo, hi = float(a.min()), float(a.max())
    return ((a - lo) / (hi - lo + 1e-9)).astype(F)


def sample(a, x, y):
    """Bilinear, periodic sample of a (h, w[, c]) array at pixel coords."""
    h, w = a.shape[:2]
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0).astype(F)
    fy = (y - y0).astype(F)
    x0 %= w
    y0 %= h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    if a.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    return ((a[y0, x0] * (1 - fx) + a[y0, x1] * fx) * (1 - fy) +
            (a[y1, x0] * (1 - fx) + a[y1, x1] * fx) * fy).astype(F)


# ---------------------------------------------------------------------------
#  noise
# ---------------------------------------------------------------------------
def value_noise(n, freq, seed, fx=None):
    """Periodic value noise with `freq` lattice cells across (fx across x if
    given: anisotropic noise)."""
    fx = fx or freq
    r = rng(seed)
    lat = r.random((freq, fx)).astype(F)
    u, v = uv(n)
    x = u * fx
    y = v * freq
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    tx = smooth(x - x0)
    ty = smooth(y - y0)
    x0 %= fx
    y0 %= freq
    x1 = (x0 + 1) % fx
    y1 = (y0 + 1) % freq
    a = lat[y0, x0] * (1 - tx) + lat[y0, x1] * tx
    b = lat[y1, x0] * (1 - tx) + lat[y1, x1] * tx
    return (a * (1 - ty) + b * ty).astype(F)


def fbm(n, freq, octaves, seed, gain=0.5, lac=2, fx=None):
    out = np.zeros((n, n), F)
    amp, tot = 1.0, 0.0
    f, g = freq, (fx or freq)
    for o in range(octaves):
        out += amp * value_noise(n, f, seed + 101 * o, fx=g)
        tot += amp
        amp *= gain
        f *= lac
        g *= lac
    return (out / tot).astype(F)


def ridged(n, freq, octaves, seed):
    return (1 - np.abs(fbm(n, freq, octaves, seed) * 2 - 1)).astype(F)


def white(n, seed):
    return rng(seed).random((n, n)).astype(F)


# ---------------------------------------------------------------------------
#  blur (periodic, FFT)
# ---------------------------------------------------------------------------
def _freqs(h, w=None):
    w = w or h
    return np.fft.fftfreq(w).astype(F)[None, :], np.fft.fftfreq(h).astype(F)[:, None]


def blur(a, sigma):
    if sigma <= 0:
        return a.astype(F)
    fx, fy = _freqs(a.shape[0], a.shape[1])
    k = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * k)) for c in range(a.shape[2])],
                        -1).astype(F)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k)).astype(F)


def dir_blur(a, sigma_along, sigma_across, angle):
    """Anisotropic Gaussian blur along `angle` (radians): brush-stroke
    streaks out of white noise, wood grain, rain streaks."""
    fx, fy = _freqs(a.shape[0], a.shape[1])
    c, s = math.cos(angle), math.sin(angle)
    fa = fx * c + fy * s
    fb = -fx * s + fy * c
    k = np.exp(-2 * (math.pi ** 2) * ((sigma_along ** 2) * fa ** 2 + (sigma_across ** 2) * fb ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k)).astype(F)


# ---------------------------------------------------------------------------
#  cellular
# ---------------------------------------------------------------------------
def voronoi(n, cells, seed, jitter=0.9, warp=None, aspect=1.0, weight=0.0):
    """Jittered-grid periodic Voronoi. Returns dict(id, f1, edge, cx, cy):
    id = cell index, f1 = distance to the site, edge = EXACT distance to the
    nearest cell border (in texture pixels), cx/cy = the site in pixels.
    `warp` = (dx, dy) pixel offsets applied to the lookup (organic edges).
    `aspect` > 1 stretches the cells along x (cells wider than tall).
    `weight` > 0 makes it a POWER diagram: each site gets a random weight (a
    share of its cell's squared size), so cells vary in size with straight,
    sliver-free borders."""
    r = rng(seed)
    cy_n = cells
    cx_n = max(1, int(round(cells / aspect)))
    jit = (r.random((cy_n, cx_n, 2)).astype(F) - 0.5) * jitter + 0.5
    sx, sy = n / cx_n, n / cy_n
    wtab = (r.random((cy_n, cx_n)).astype(F) * weight * sx * sy)
    y, x = np.mgrid[0:n, 0:n].astype(F)
    if warp is not None:
        x = x + warp[0]
        y = y + warp[1]
    gx = np.floor(x / sx).astype(np.int64)
    gy = np.floor(y / sy).astype(np.int64)
    pts = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cxi = gx + ox
            cyi = gy + oy
            j = jit[cyi % cy_n, cxi % cx_n]
            px = (cxi + j[..., 0]) * sx
            py = (cyi + j[..., 1]) * sy
            pw = wtab[cyi % cy_n, cxi % cx_n]
            pts.append((px, py, (cyi % cy_n) * cx_n + (cxi % cx_n), pw))
    d2 = np.stack([(x - p[0]) ** 2 + (y - p[1]) ** 2 - p[3] for p in pts], 0)
    k = np.argmin(d2, 0)
    ax = np.choose(k, [p[0] for p in pts])
    ay = np.choose(k, [p[1] for p in pts])
    aw = np.choose(k, [p[3] for p in pts])
    ids = np.choose(k, [p[2] for p in pts])
    da = np.min(d2, 0)
    edge = np.full((n, n), 1e9, F)
    for i, p in enumerate(pts):
        bx, by = p[0], p[1]
        ln = np.hypot(ax - bx, ay - by)
        same = ln < 1e-4
        # distance to the (power) bisector: ((|p-b|^2 - wb) - (|p-a|^2 - wa)) / 2|a-b|
        e = (d2[i] - da) / (2 * np.maximum(ln, 1e-4))
        e = np.where(same | (k == i), 1e9, e)
        edge = np.minimum(edge, e)
    d = np.sqrt(np.maximum(da + aw, 0))
    return {'id': ids.astype(np.int64), 'f1': d.astype(F), 'edge': edge.astype(F),
            'cx': np.mod(ax, n).astype(F), 'cy': np.mod(ay, n).astype(F), 'count': cy_n * cx_n}


def bricks(n, rows, seed, min_w=0.6, max_w=1.4, row_h_jit=0.0, per_row=None, stagger=0.5):
    """Periodic running-bond blocks: `rows` courses across the tile, each
    course cut into blocks of random width (in course-heights * aspect).
    Returns dict(id, edge (pixels to the block border), bx0, bx1, by0, by1)."""
    r = rng(seed)
    rh = n / rows
    y, x = np.mgrid[0:n, 0:n].astype(F)
    row = np.floor(y / rh).astype(np.int64) % rows
    ids = np.zeros((n, n), np.int64)
    edge = np.zeros((n, n), F)
    bx0 = np.zeros((n, n), F)
    bx1 = np.zeros((n, n), F)
    y0 = row * rh
    y1 = y0 + rh
    nid = 0
    for ri in range(rows):
        # cut the course into widths that sum to n
        cuts = [0.0]
        target = per_row[ri % len(per_row)] if per_row else None
        while cuts[-1] < n - 1e-3:
            if target:
                w = n / target * r.uniform(0.8, 1.2)
            else:
                w = rh * r.uniform(min_w, max_w) * 1.6
            cuts.append(cuts[-1] + w)
        # stretch so the course closes exactly at n
        cuts = [c * n / cuts[-1] for c in cuts]
        off = (ri * stagger % 1.0) * (cuts[1] - cuts[0]) + r.uniform(-0.1, 0.1) * rh
        m = row == ri
        xx = (x[m] - off) % n
        idx = np.searchsorted(np.array(cuts), xx, side='right') - 1
        idx = np.clip(idx, 0, len(cuts) - 2)
        c0 = np.array(cuts)[idx]
        c1 = np.array(cuts)[idx + 1]
        ids[m] = nid + idx
        bx0[m] = c0
        bx1[m] = c1
        ex = np.minimum(xx - c0, c1 - xx)
        ey = np.minimum(y[m] - y0[m], y1[m] - y[m])
        edge[m] = np.minimum(ex, ey)
        nid += len(cuts) - 1
    return {'id': ids, 'edge': edge, 'count': nid}


def cell_table(count, seed, lo=0.0, hi=1.0):
    return (rng(seed).random(count) * (hi - lo) + lo).astype(F)


# ---------------------------------------------------------------------------
#  height -> surface
# ---------------------------------------------------------------------------
def grad(h):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    return gx.astype(F), gy.astype(F)


def normal(h, strength):
    """Tangent-space normal (OpenGL: +y up the texture) from a height field."""
    gx, gy = grad(h)
    nx = -gx * strength
    ny = gy * strength           # image rows run down; OpenGL green points up
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], -1).astype(F)


def light(h, strength, key=(-0.55, 0.62, 0.56), wrap=0.35):
    """Painted key light from the top-left (WoW bakes its light into the
    diffuse): a wrapped lambert over the height's normal, 0..1."""
    nrm = normal(h, strength)
    lx, ly, lz = key
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    d = (nrm[..., 0] * lx + nrm[..., 1] * ly + nrm[..., 2] * lz) / ln
    return np.clip((d + wrap) / (1 + wrap), 0, 1).astype(F)


def cavity(h, sigma):
    return (h - blur(h, sigma)).astype(F)


def ao(h, radii=(2, 6, 16), weights=(0.5, 0.3, 0.2)):
    """Height-field occlusion: how far below its blurred neighbourhood a
    pixel sits, over a few radii. 1 = open, lower = occluded."""
    occ = np.zeros_like(h)
    for r, w in zip(radii, weights):
        occ += w * np.clip(blur(h, r) - h, 0, None)
    return np.clip(1 - occ * 4.0, 0, 1).astype(F)


# ---------------------------------------------------------------------------
#  colour
# ---------------------------------------------------------------------------
def srgb_to_lin(c):
    c = np.asarray(c, F)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(F)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], F)


def ramp(t, stops):
    """Gradient map: stops = [(pos, '#rrggbb'), ...] (sRGB, interpolated in
    sRGB like a painter's palette). Returns (h, w, 3)."""
    t = np.clip(t, 0, 1)
    pos = np.array([s[0] for s in stops], F)
    cols = np.stack([hexc(s[1]) for s in stops])
    out = np.zeros(t.shape + (3,), F)
    for c in range(3):
        out[..., c] = np.interp(t, pos, cols[:, c])
    return out


def hsv_shift(rgb, dh=0.0, ds=0.0, dv=0.0):
    """Per-pixel HSV nudge (dh in turns, ds/dv multiplicative offsets); the
    offsets may be arrays (per-cell variation)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, -1)
    mn = np.min(rgb, -1)
    d = mx - mn + 1e-9
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-9), 0)
    v = mx
    h = (h + dh) % 1.0
    s = np.clip(s * (1 + ds), 0, 1)
    v = np.clip(v * (1 + dv), 0, 1)
    i = np.floor(h * 6).astype(np.int64) % 6
    f = h * 6 - np.floor(h * 6)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    rr = np.choose(i, [v, q, p, p, t, v])
    gg = np.choose(i, [t, v, v, q, p, p])
    bb = np.choose(i, [p, p, t, v, v, q])
    return np.stack([rr, gg, bb], -1).astype(F)


def overlay(base, blend, amount=1.0):
    """Photoshop overlay of a 0..1 grey `blend` onto `base` (rgb)."""
    b = blend[..., None] if blend.ndim == 2 else blend
    o = np.where(base < 0.5, 2 * base * b, 1 - 2 * (1 - base) * (1 - b))
    return (base + (o - base) * amount).astype(F)


def soft_posterize(x, levels, softness=0.25):
    """Painterly banding: quantize with soft steps (a painter's value groups)."""
    y = x * levels
    f = np.floor(y)
    t = sstep(0.5 - softness, 0.5 + softness, y - f)
    return ((f + t) / levels).astype(F)


# ---------------------------------------------------------------------------
#  io
# ---------------------------------------------------------------------------
def save_rgb(a, path, q=94):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    if path.endswith('.png'):
        im.save(path)
    else:
        im.save(path, quality=q)


def save_normal(nrm, path, size=None, q=94):
    a = (nrm * 0.5 + 0.5)
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    im.save(path, quality=q)


def save_gray(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)
