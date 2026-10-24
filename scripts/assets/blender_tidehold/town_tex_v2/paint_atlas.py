"""The v2 detail atlas (2048, a 4 x 4 grid of 512 cells) + its emissive and
glass ORM maps, painted from nothing but noise and shapes:

  row 0  window arch lit | window square lit | window arch dark | window square dark
  row 1  door (teal)     | door (oak)        | rose: hall      | lancets (two)
  row 2  4 signs (256)   | 3 signs + rose    | rose: market    | rose: bank
  row 3  rose: tavern    | rose: tavern_b    | crest           | 4 roses (256)

bl_town_lib.CELL holds the same layout; a third entry there names a 256
quarter of a cell.
    python3 scripts/assets/blender_tidehold/town_tex_v2/paint_atlas.py
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forge as fg  # noqa: E402

F = np.float32
A, C = 2048, 512
atlas = np.zeros((A, A, 3), F) + fg.hexc('#140f0b')
emis = np.zeros((A, A, 3), F)
orm = np.zeros((A, A, 3), F)
orm[..., 0] = 1.0
orm[..., 1] = 0.85
FRAME = fg.hexc('#241810')
GLASS_R, LEAD_R, FRAME_R = 0.07, 0.45, 0.8


V1_SRC = os.path.join(HERE, '..', 'town_tex', 'src')


def v1_wood(fn, n=C, target=None, rot=0):
    """The v1 wood (SPACEY: "revert all of the wood textures"): a pack source
    from town_tex/src, optionally regraded to a target mean like v1 did."""
    a = np.asarray(Image.open(os.path.join(V1_SRC, fn)).convert('RGB').resize((n, n), Image.LANCZOS)).astype(F) / 255.0
    if rot:
        a = np.rot90(a, k=rot).copy()
    if target is not None:
        lin = fg.srgb_to_lin(a)
        m = lin.reshape(-1, 3).mean(0)
        lin = lin * (np.array(target, F) / np.maximum(m, 1e-4))
        a = fg.lin_to_srgb(lin)
    return a.astype(F)


def put(dst, arr, ci, cj, ox=0):
    dst[cj * C:(cj + 1) * C, ci * C + ox:ci * C + ox + arr.shape[1]] = arr


def arch_mask(w, h, spring):
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    r = w / 2
    d.rectangle((0, spring, w, h), fill=255)
    d.ellipse((0, spring - r, w, spring + r), fill=255)
    return m


def grid(n):
    y, x = np.mgrid[0:n, 0:n].astype(F)
    return x, y


def dabs(n, seed, scales=(4, 10, 22)):
    acc = np.zeros((n, n), F)
    for k, sc in enumerate(scales):
        acc += fg.norm01(fg.blur(fg.rng(seed + k).random((n, n)).astype(F), sc)) / (k + 1)
    return fg.norm01(acc)


def oak(n, seed, lines=26, dark='#2a1a10', mid='#5c3c25', light='#8f6340', vertical=True):
    """Procedural oak: warped growth lines, fibres, long streaks."""
    x, y = grid(n)
    wv = (fg.value_noise(n, 5, seed, fx=1) - 0.5) * 40 + (fg.value_noise(n, 16, seed + 1, fx=3) - 0.5) * 8
    coord = x if vertical else y
    t = (coord + wv) / n * lines
    ln = (0.5 + 0.5 * np.sin(t * 2 * math.pi)) ** 4
    ang = math.pi / 2 if vertical else 0.0
    streak = fg.norm01(fg.dir_blur(fg.rng(seed + 2).random((n, n)).astype(F), 40, 1.5, ang))
    fibre = fg.norm01(fg.dir_blur(fg.rng(seed + 3).random((n, n)).astype(F), 10, 0.6, ang))
    tt = np.clip(0.55 * streak + 0.25 * (1 - ln) + 0.2 * fibre, 0, 1)
    col = fg.ramp(tt, [(0, dark), (0.55, mid), (1, light)])
    return (col * (1 - 0.35 * ln[..., None])).astype(F)


def emboss(mask, strength=18.0, blur=3.0):
    """Painted relief of a 0..1 mask: its shading under the top-left key."""
    h = fg.blur(mask, blur)
    return fg.light(h, strength, wrap=0.3)


# =============================================================================
#  WINDOWS
# =============================================================================
def leaded(n, lit, seed, pitch=46):
    x, y = grid(n)
    u = (x + y) / pitch
    v = (x - y) / pitch
    du = np.abs(u - np.round(u))
    dv = np.abs(v - np.round(v))
    lead = np.clip(1.0 - np.minimum(du, dv) * pitch / 2.2, 0, 1) ** 1.5
    pane = (np.floor(u) * 7 + np.floor(v) * 13).astype(np.int64)
    jit = (np.sin(pane * 12.9898) * 43758.5453) % 1.0
    cy = y / n
    cx = x / n - 0.5
    d = dabs(n, seed)
    if lit:
        glow = np.clip(1.15 - (cx * 1.3) ** 2 - (cy - 0.58) ** 2 * 1.5, 0.22, 1.0)
        glow = glow * (0.86 + 0.28 * jit) * (0.9 + 0.2 * d)
        warm = fg.ramp(np.clip(glow, 0, 1), [(0, '#5a2a0e'), (0.35, '#b8641c'), (0.7, '#f0a53e'), (1, '#ffe7a6')])
        col = warm * (1 - lead[..., None]) + fg.hexc('#1a120b') * lead[..., None]
        g = warm * (1 - lead[..., None]) * 0.95
    else:
        sky = np.clip(0.95 - cy * 0.75, 0.15, 1.0)
        base = fg.ramp(np.clip(sky * (0.8 + 0.3 * jit) * (0.9 + 0.2 * d), 0, 1),
                       [(0, '#0b1320'), (0.45, '#1b3350'), (0.8, '#3f6a8e'), (1, '#8fb6d6')])
        gleam = np.clip(1.0 - np.abs((x - y * 0.6) / n - 0.25) * 8.0, 0, 1) * 0.4
        col = base + gleam[..., None] * fg.hexc('#cfe6ff') * 0.6
        col = col * (1 - lead[..., None]) + fg.hexc('#0c0e12') * lead[..., None]
        g = col * 0.0
    return np.clip(col, 0, 1), np.clip(g, 0, 1), lead


def window_cell(ci, cj, lit, arched, seed):
    col, g, lead = leaded(C, lit, seed)
    m = arch_mask(C, C, C // 2) if arched else Image.new('L', (C, C), 255)
    er = np.asarray(m.filter(ImageFilter.MinFilter(33))).astype(F) / 255.0
    bar = np.zeros((C, C), F)
    bar[:, C // 2 - 9:C // 2 + 9] = 1
    bar[int(C * 0.62) - 9:int(C * 0.62) + 9, :] = 1
    glassm = er * (1 - bar)
    frame = oak(C, seed + 50, dark='#1e140c', mid='#3f2a19', light='#5d4028')
    L = emboss(1 - glassm, 16.0, 2.5)
    frame = frame * (0.6 + 0.6 * L[..., None])
    put(atlas, col * glassm[..., None] + frame * (1 - glassm[..., None]), ci, cj)
    put(emis, g * glassm[..., None], ci, cj)
    metal = glassm * ((0.12 if lit else 0.32) * (1 - lead) + 0.55 * lead)
    rough = FRAME_R * (1 - glassm) + glassm * (GLASS_R * (1 - lead) + LEAD_R * lead)
    orm[cj * C:(cj + 1) * C, ci * C:(ci + 1) * C, 1] = rough
    orm[cj * C:(cj + 1) * C, ci * C:(ci + 1) * C, 2] = metal


# =============================================================================
#  STAINED GLASS
# =============================================================================
# Each building wears its own rose (SPACEY, 2026-09-26: "unique to each building
# right now they all share the same pattern"). A pattern is a PANE field (an id
# per piece of glass) and a palette class per pane: the lead runs along every
# boundary between two ids, so the leading always follows the design. The disk
# fills 0.94 of its cell (the geometry maps r = 1 to 0.47 of the cell) so a
# quarter-cell rose never samples its neighbour.
TAU = 2 * math.pi
ROSE_FILL = 0.94
RIM, OUT = -1, -2


def _sec(a, k, off=0.0):
    return np.floor(a / TAU * k + off).astype(np.int64) % k


def _tf(a, k, off=0.0):
    return (a / TAU * k + off) % 1.0 - 0.5


def pat_original(r, a):
    """The v2 Tidehold rose: four rings of twelve, cyan and deep blue, a gold
    star at the heart."""
    pal = ['#35c2f0', '#1b3aa8', '#f4c257']
    ring = np.minimum(np.floor(r / 0.92 * 4).astype(np.int64), 3)
    k = _sec(a, 12)
    pane = 10 + ring * 12 + k
    cls = ring % 2
    star = r < (0.16 + 0.09 * np.cos(a * 8))
    pane = np.where(star, 1, pane)
    cls = np.where(star, 2, cls)
    return pane, cls, pal


def pat_hall(r, a):
    """The hall: a cathedral rose. A gold boss in a ring of eight, twelve
    pointed petals (blue heart, ruby tip) on green spandrels, an outer band of
    twenty-four roundels on deep blue."""
    pal = ['#f2c14e', '#c8283a', '#2a4fc4', '#22349c', '#2f9a52', '#46c6ee']
    pane = np.zeros(r.shape, np.int64)
    cls = np.zeros(r.shape, np.int64)
    k8, k12, k24 = _sec(a, 8), _sec(a, 12), _sec(a, 24)
    t12 = _tf(a, 12)
    s = (r - 0.24) / 0.42
    w = 0.40 * np.clip(1 - np.clip(s, 0, 1) ** 3, 0, 1) ** 0.6
    band = (r >= 0.24) & (r < 0.66)
    petal = band & (np.abs(t12) < w)
    ac = (np.floor(a / TAU * 24) + 0.5) * TAU / 24
    roundel = np.hypot(r * np.cos(a) - 0.79 * np.cos(ac), r * np.sin(a) - 0.79 * np.sin(ac)) < 0.085
    outer = (r >= 0.66) & (r < 0.92)
    ring = (r >= 0.13) & (r < 0.24)
    for m, pv, cv in ((r < 0.13, 1, 0),
                      (ring, 10 + k8, np.where(k8 % 2, 1, 2)),
                      (band & ~petal, 30 + k12, 4),
                      (petal & (s < 0.45), 50 + k12, 2),
                      (petal & (s >= 0.45), 70 + k12, 1),
                      (outer & ~roundel, 100 + k24, 3),
                      (outer & roundel, 130 + k24, np.where(k24 % 2, 0, 5))):
        pane = np.where(m, pv, pane)
        cls = np.where(m, cv, cls)
    return pane, cls, pal


def pat_market(r, a):
    """The auction house: a sunburst of wealth. A gold coin, sixteen tapering
    rays of gold and amber over purple and royal blue, a band of teal and
    purple."""
    pal = ['#f5c542', '#e0862a', '#5a2590', '#2e3fb0', '#27b3a4', '#fff0b0']
    pane = np.zeros(r.shape, np.int64)
    cls = np.zeros(r.shape, np.int64)
    k8, k16, k32 = _sec(a, 8), _sec(a, 16), _sec(a, 32)
    s = (r - 0.2) / 0.52
    ray = (r >= 0.2) & (r < 0.72) & (np.abs(_tf(a, 16)) < 0.46 * np.clip(1 - s, 0, 1) ** 0.8)
    bg = (r >= 0.2) & (r < 0.72) & ~ray
    for m, pv, cv in ((r < 0.12, 1, 5),
                      ((r >= 0.12) & (r < 0.2), 10 + k8, 0),
                      (ray, 20 + k16, np.where(k16 % 2, 1, 0)),
                      (bg & (r < 0.46), 40 + k16, 2),
                      (bg & (r >= 0.46), 60 + k16, 3),
                      ((r >= 0.72) & (r < 0.92), 80 + k32, np.where(k32 % 2, 2, 4))):
        pane = np.where(m, pv, pane)
        cls = np.where(m, cv, cls)
    return pane, cls, pal


def pat_bank(r, a):
    """The bank: an eight-pointed gold star on emerald, each point cut in a
    light and a dark half (a faceted look), a ruby at its heart, a band of
    cream and dark emerald."""
    pal = ['#f3c24a', '#c98a26', '#1f9150', '#0f5a34', '#f1e6c0', '#b8283a']
    pane = np.zeros(r.shape, np.int64)
    cls = np.zeros(r.shape, np.int64)
    phi = (a / (TAU / 8) + 0.5) % 1.0 - 0.5
    th = np.abs(phi) * (TAU / 8)
    Ro, Ri = 0.64, 0.34
    p1 = np.array([Ro, 0.0])
    p2 = np.array([Ri * math.cos(TAU / 16), Ri * math.sin(TAU / 16)])
    d = p2 - p1
    ux, uy = np.cos(th), np.sin(th)
    t = -(ux * p1[1] - uy * p1[0]) / (ux * d[1] - uy * d[0])
    edge = np.hypot(p1[0] + t * d[0], p1[1] + t * d[1])
    star = r < edge
    kp = _sec(a, 8, 0.5)
    half = (phi >= 0).astype(np.int64)
    k8 = _sec(a, 8)
    k16 = _sec(a, 16)
    for m, pv, cv in ((star, 10 + kp * 2 + half, np.where(half == 1, 1, 0)),
                      ((r < 0.8) & ~star, 40 + k8, np.where(k8 % 2, 2, 3)),
                      (r < 0.15, 1, 5),
                      ((r >= 0.8) & (r < 0.92), 60 + k16, np.where(k16 % 2, 4, 3))):
        pane = np.where(m, pv, pane)
        cls = np.where(m, cv, cls)
    return pane, cls, pal


def pat_tavern(r, a):
    """The tavern: a warm flower. An amber heart, eight round petals (red
    toward the heart, orange at the tip) on green leaves, a band of yellow,
    green and orange."""
    pal = ['#f0a030', '#f6d25a', '#c83a2a', '#ee7a2a', '#3b9a3a', '#23692c']
    pane = np.zeros(r.shape, np.int64)
    cls = np.zeros(r.shape, np.int64)
    off = TAU / 16
    kp = np.round((a - off) / (TAU / 8)).astype(np.int64) % 8
    ac = off + kp * TAU / 8
    dp = np.hypot(r * np.cos(a) - 0.47 * np.cos(ac), r * np.sin(a) - 0.47 * np.sin(ac))
    petal = (dp < 0.2) & (r >= 0.18)
    kl = _sec(a, 8)
    k24 = _sec(a, 24)
    for m, pv, cv in (((r < 0.78) & (r >= 0.18) & ~petal, 50 + kl, np.where(kl % 2, 4, 5)),
                      (petal & (r < 0.47), 20 + kp, 2),
                      (petal & (r >= 0.47), 30 + kp, 3),
                      (r < 0.1, 1, 1),
                      ((r >= 0.1) & (r < 0.18), 2, 0),
                      ((r >= 0.78) & (r < 0.92), 80 + k24, np.array([1, 4, 3])[k24 % 3])):
        pane = np.where(m, pv, pane)
        cls = np.where(m, cv, cls)
    return pane, cls, pal


def pat_tavern_b(r, a):
    """The big tavern: a hexafoil, six circles through the heart. Where two
    overlap a pale aqua petal, where one covers a teal lens, violet between;
    a gold heart, a band of teal and deep violet."""
    pal = ['#1fa8a0', '#8fe3e0', '#5b2c8a', '#35175c', '#f0c04a']
    x, y = r * np.cos(a), r * np.sin(a)
    m = np.zeros(r.shape, np.int64)
    for k in range(6):
        ang = k * TAU / 6
        inside = np.hypot(x - 0.36 * math.cos(ang), y - 0.36 * math.sin(ang)) < 0.36
        m |= inside.astype(np.int64) << k
    cnt = sum(((m >> k) & 1) for k in range(6))
    k6 = _sec(a, 6, 0.5)
    k12 = _sec(a, 12)
    pane = np.where(cnt > 0, 100 + m, 10 + k6)
    cls = np.select([cnt >= 3, cnt == 2, cnt == 1], [4, 1, 0], 2)
    for mm, pv, cv in ((r < 0.07, 1, 4),
                       ((r >= 0.8) & (r < 0.92), 300 + k12, np.where(k12 % 2, 0, 3))):
        pane = np.where(mm, pv, pane)
        cls = np.where(mm, cv, cls)
    return pane, cls, pal


def pat_house_b(r, a):
    """house_b: a quatrefoil. Four lobes of rose pink and violet round a gold
    heart, blue and cyan spandrels, a band of pink, blue and violet."""
    pal = ['#d0467a', '#7a3aa8', '#f2c14e', '#2a55c0', '#4cc4ec']
    x, y = r * np.cos(a), r * np.sin(a)
    lobe = np.zeros(r.shape, bool)
    for k in range(4):
        ang = k * TAU / 4
        lobe |= np.hypot(x - 0.34 * math.cos(ang), y - 0.34 * math.sin(ang)) < 0.34
    quat = lobe | (r < 0.3)
    kq = np.round(a / (TAU / 4)).astype(np.int64) % 4
    k8 = _sec(a, 8)
    k16 = _sec(a, 16)
    pane = np.where(quat, 20 + kq, 40 + k8)
    cls = np.where(quat, np.where(kq % 2, 1, 0), np.where(k8 % 2, 4, 3))
    for mm, pv, cv in ((r < 0.15, 1, 2),
                       ((r >= 0.8) & (r < 0.92), 60 + k16, np.array([0, 3, 1])[k16 % 3])):
        pane = np.where(mm, pv, pane)
        cls = np.where(mm, cv, cls)
    return pane, cls, pal


def pat_shop_a(r, a):
    """shop_a: a pinwheel. Ten swept blades of green and gold (lighter toward
    the heart), a berry-red heart, a band of teal and green."""
    pal = ['#58c05a', '#f6de6a', '#2f8f3c', '#e8b030', '#c83040', '#27b3a4']
    t = a / TAU * 10 + r * 1.8
    k = np.floor(t).astype(np.int64) % 10
    out = (r >= 0.5).astype(np.int64)
    k20 = _sec(a, 20)
    pane = 20 + k + out * 10
    cls = np.where(k % 2, 1, 0) + out * 2
    for mm, pv, cv in ((r < 0.15, 1, 4),
                       ((r >= 0.8) & (r < 0.92), 60 + k20, np.where(k20 % 2, 5, 2))):
        pane = np.where(mm, pv, pane)
        cls = np.where(mm, cv, cls)
    return pane, cls, pal


def pat_shop_b(r, a):
    """shop_b (spare, no rose yet): a heraldic cross, red arms on blue
    quarters, a gold and blue band."""
    pal = ['#c0303a', '#2c50b8', '#f2c14e', '#efe3c0']
    x, y = r * np.cos(a), r * np.sin(a)
    arm = ((np.abs(x) < 0.16) | (np.abs(y) < 0.16)) & (r < 0.8)
    kq = np.round(a / (TAU / 4)).astype(np.int64) % 4
    quad_ = _sec(a, 4)
    k16 = _sec(a, 16)
    pane = np.where(arm, 20 + kq, 40 + quad_)
    cls = np.where(arm, 0, 1)
    for mm, pv, cv in (((np.abs(x) < 0.16) & (np.abs(y) < 0.16), 1, 2),
                       ((r >= 0.8) & (r < 0.92), 60 + k16, np.where(k16 % 2, 2, 3))):
        pane = np.where(mm, pv, pane)
        cls = np.where(mm, cv, cls)
    return pane, cls, pal


ROSES = {'original': pat_original, 'hall': pat_hall, 'market': pat_market, 'bank': pat_bank,
         'tavern': pat_tavern, 'tavern_b': pat_tavern_b, 'house_b': pat_house_b, 'shop_a': pat_shop_a,
         'shop_b': pat_shop_b}


def rose_paint(kind, seed, n=C):
    """One rose at n x n: (colour, glow, rough, metal)."""
    x, y = grid(n)
    dx = (x + 0.5 - n / 2) / (n / 2 * ROSE_FILL)
    dy = -(y + 0.5 - n / 2) / (n / 2 * ROSE_FILL)
    r = np.sqrt(dx * dx + dy * dy)
    a = np.arctan2(dy, dx) % TAU
    pane, cls, pal = ROSES[kind](r, a)
    rim = (r >= 0.92) & (r < 1.0)
    out = r >= 1.0
    pane = np.where(rim, 2_000_000, np.where(out, 3_000_000, pane))
    cls = np.where(rim, RIM, np.where(out, OUT, cls))
    # the lead: every boundary between two panes, drawn 7 px at 512
    b = np.zeros(pane.shape, bool)
    dv = pane[:-1] != pane[1:]
    dh = pane[:, :-1] != pane[:, 1:]
    b[:-1] |= dv
    b[1:] |= dv
    b[:, :-1] |= dh
    b[:, 1:] |= dh
    wpx = max(3, int(round(7 * n / 512)) | 1)
    hard = np.asarray(Image.fromarray((b * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(wpx))) > 127
    hard &= ~out
    lead = np.clip(fg.blur(hard.astype(F), 0.7 * n / 512) * 1.4, 0, 1)
    # each pane glows brightest at its middle, a little different to the next
    near = np.clip(fg.blur(hard.astype(F), 9 * n / 512) * 2.2, 0, 1)
    jit = ((np.sin(pane.astype(np.float64) * 12.9898) * 43758.5453) % 1.0).astype(F)
    d = dabs(n, seed)
    shade = (0.74 + 0.36 * (1 - near)) * (0.9 + 0.2 * jit) * (0.88 + 0.24 * d)
    palc = np.stack([fg.hexc(h) for h in pal])
    col = palc[np.clip(cls, 0, len(pal) - 1)] * shade[..., None]
    gold = fg.hexc('#f4c257')
    col = np.where((cls == RIM)[..., None], gold * (0.72 + 0.28 * d[..., None]), col)
    col = np.where(out[..., None], FRAME, col)
    col = col * (1 - lead[..., None]) + fg.hexc('#140f0a') * lead[..., None]
    glass = (cls >= 0) & ~hard
    glow = np.where(glass[..., None], col * 0.85, 0.0)
    rough = np.where(out, FRAME_R, np.where(cls == RIM, 0.3, GLASS_R + 0.02))
    rough = rough * (1 - lead) + LEAD_R * lead
    metal = np.where(out, 0.0, np.where(cls == RIM, 0.85, 0.22))
    metal = metal * (1 - lead) + 0.55 * lead * (1 - out)
    return np.clip(col, 0, 1).astype(F), np.clip(glow, 0, 1).astype(F), rough.astype(F), metal.astype(F)


def _half(a):
    """512 -> 256 by a 2 x 2 box."""
    h = a.shape[0] // 2
    return a.reshape(h, 2, h, 2, *a.shape[2:]).mean(axis=(1, 3)).astype(F)


def put_cell(col, glow, rough, metal, ci, cj, q=None):
    """Write a painted 512 cell, or (q = 0..3: top-left, top-right, bottom-
    left, bottom-right) a quarter of one at 256."""
    if q is None:
        y0, x0, n = cj * C, ci * C, C
    else:
        col, glow, rough, metal = [_half(m) if m is not None else None for m in (col, glow, rough, metal)]
        n = C // 2
        y0, x0 = cj * C + (q // 2) * n, ci * C + (q % 2) * n
    atlas[y0:y0 + n, x0:x0 + n] = col
    emis[y0:y0 + n, x0:x0 + n] = glow if glow is not None else 0.0
    if rough is not None:
        orm[y0:y0 + n, x0:x0 + n, 1] = rough
    if metal is not None:
        orm[y0:y0 + n, x0:x0 + n, 2] = metal


def rose_cell(kind, ci, cj, q=None, seed=77):
    put_cell(*rose_paint(kind, seed), ci, cj, q)


def lancet_cell(ci, cj):
    for k in range(2):
        w, h = C // 2, C
        y, x = np.mgrid[0:h, 0:w].astype(F)
        rr = w * 0.9
        left = ((x - (w - rr)) ** 2 + (y - w * 0.95) ** 2) <= rr * rr
        right = ((x - rr) ** 2 + (y - w * 0.95) ** 2) <= rr * rr
        inside = (y > w * 0.95) | (left & right)
        inset = (x > 14) & (x < w - 14) & (y > 14) & (y < h - 14)
        cells = (np.floor(y / 38) + np.floor(x / 42)) % 3
        pal = np.stack([fg.hexc('#2fb0e8'), fg.hexc('#1d3fa6'), fg.hexc('#e0ad3e')])
        d = fg.norm01(fg.blur(fg.rng(90 + k).random((h, w)).astype(F), 6))
        col = pal[cells.astype(np.int64)] * (0.82 + 0.3 * d[..., None])
        lead = (np.abs((y / 38) - np.round(y / 38)) < 0.07) | (np.abs((x / 42) - np.round(x / 42)) < 0.06)
        col = np.where(lead[..., None], fg.hexc('#120e0a'), col)
        ok = inside & inset
        col = np.where(ok[..., None], col, FRAME)
        glow = np.where((ok & ~lead)[..., None], col * 0.78, 0.0)
        put(atlas, col, ci, cj, ox=k * w)
        put(emis, glow, ci, cj, ox=k * w)
        rough = np.where(ok, np.where(lead, LEAD_R, GLASS_R + 0.02), FRAME_R)
        metal = np.where(ok, np.where(lead, 0.55, 0.22), 0.0)
        orm[cj * C:(cj + 1) * C, ci * C + k * w:ci * C + (k + 1) * w, 1] = rough
        orm[cj * C:(cj + 1) * C, ci * C + k * w:ci * C + (k + 1) * w, 2] = metal


# =============================================================================
#  DOORS: vertical oak boards (the ironwork is geometry)
# =============================================================================
def door_cell_v1(ci, cj, fn):
    img = v1_wood(fn) * 0.95
    m = np.asarray(arch_mask(C, C, C // 2)).astype(F) / 255.0
    put(atlas, img * m[..., None] + FRAME * (1 - m[..., None]), ci, cj)


def door_cell(ci, cj, seed, paint=None):
    x, y = grid(C)
    nb = 6
    bw = C / nb
    ex = np.minimum(x % bw, bw - x % bw)
    board = (x // bw).astype(np.int64)
    wood = oak(C, seed, lines=18)
    val = fg.rng(seed + 1).uniform(-0.12, 0.1, nb).astype(F)[board]
    col = wood * (1 + val[..., None])
    if paint is not None:
        wear = fg.fbm(C, 10, 4, seed + 2) + fg.sstep(18, 2, ex) * 0.4
        pc = fg.ramp(np.clip(0.5 + 0.4 * (dabs(C, seed + 3) - 0.5), 0, 1), paint)
        col = np.where((wear < 0.74)[..., None], pc * (0.85 + 0.25 * fg.norm01(wood.mean(-1))[..., None]), col)
    h = np.sqrt(np.clip(ex / 10.0, 0, 1))
    L = fg.light(h, 20.0, wrap=0.4)
    col = col * (0.66 + 0.44 * L[..., None])
    col = np.where((ex < 2.0)[..., None], fg.hexc('#0e0906'), col)
    col = col * (0.9 + 0.2 * dabs(C, seed + 4)[..., None])
    m = np.asarray(arch_mask(C, C, C // 2)).astype(F) / 255.0
    put(atlas, col * m[..., None] + FRAME * (1 - m[..., None]), ci, cj)


# =============================================================================
#  SIGNS: an oak board, an embossed gold border, a painted relief icon
# =============================================================================
def sign_cell(ci, cj, icon, seed, q=None):
    board = v1_wood('Wood182_07_Color.jpg', target=(0.34 ** 2.2, 0.23 ** 2.2, 0.15 ** 2.2), rot=1)
    col = board * (0.9 + 0.2 * dabs(C, seed + 1)[..., None])
    # the gold frame, embossed
    fm = Image.new('L', (C, C), 0)
    d = ImageDraw.Draw(fm)
    d.rectangle((14, 14, C - 14, C - 14), outline=255, width=20)
    fmask = np.asarray(fm).astype(F) / 255.0
    Lf = emboss(fmask, 22.0, 3.0)
    gold = fg.ramp(Lf, [(0, '#5a3a10'), (0.5, '#c8923a'), (0.85, '#f6d27a'), (1, '#fff3c8')])
    col = col * (1 - fmask[..., None]) + gold * fmask[..., None]
    # the icon: shapes drawn as coloured masks, each shaded as relief
    layers = []

    def shape(fill, draw):
        m = Image.new('L', (C, C), 0)
        draw(ImageDraw.Draw(m))
        layers.append((np.asarray(m).astype(F) / 255.0, fg.hexc(fill)))
    cx, cy = C // 2, C // 2
    if icon == 'tankard':
        shape('#8a5a2c', lambda d: d.rounded_rectangle((cx - 90, cy - 70, cx + 70, cy + 120), 18, fill=255))
        shape('#c9a24a', lambda d: [d.rectangle((cx - 90, yb, cx + 70, yb + 16), fill=255) for yb in (cy - 30, cy + 70)])
        shape('#8a5a2c', lambda d: d.arc((cx + 30, cy - 40, cx + 150, cy + 90), -90, 90, fill=255, width=20))
        shape('#f6f0e0', lambda d: d.ellipse((cx - 112, cy - 125, cx + 92, cy - 50), fill=255))
    elif icon == 'anvil':
        shape('#5d6470', lambda d: d.polygon([(cx - 150, cy - 40), (cx + 120, cy - 40), (cx + 160, cy - 80), (cx + 60, cy - 80),
                                              (cx + 40, cy - 100), (cx - 170, cy - 100)], fill=255))
        shape('#5d6470', lambda d: d.rectangle((cx - 60, cy - 40, cx + 40, cy + 40), fill=255))
        shape('#5d6470', lambda d: d.polygon([(cx - 110, cy + 110), (cx + 90, cy + 110), (cx + 40, cy + 40), (cx - 60, cy + 40)], fill=255))
        shape('#8a5a2c', lambda d: d.line((cx - 30, cy - 180, cx + 110, cy - 110), fill=255, width=22))
        shape('#b8bec8', lambda d: d.rectangle((cx - 80, cy - 205, cx + 10, cy - 160), fill=255))
    elif icon == 'potion':
        shape('#35b8dc', lambda d: d.ellipse((cx - 110, cy - 30, cx + 110, cy + 170), fill=255))
        shape('#35b8dc', lambda d: d.rectangle((cx - 36, cy - 140, cx + 36, cy - 10), fill=255))
        shape('#8a5a2c', lambda d: d.rectangle((cx - 50, cy - 172, cx + 50, cy - 136), fill=255))
        shape('#d8f6ff', lambda d: d.ellipse((cx - 64, cy + 10, cx - 14, cy + 60), fill=255))
    elif icon == 'sack':
        shape('#c29a5e', lambda d: d.polygon([(cx - 120, cy + 150), (cx + 120, cy + 150), (cx + 100, cy - 40), (cx + 40, cy - 110),
                                              (cx - 40, cy - 110), (cx - 100, cy - 40)], fill=255))
        shape('#6e4a24', lambda d: d.rectangle((cx - 50, cy - 130, cx + 50, cy - 100), fill=255))
        shape('#f0c24a', lambda d: [d.ellipse((cx - 90 + k * 55, cy + 20 - (k % 2) * 30, cx - 40 + k * 55, cy + 70 - (k % 2) * 30), fill=255) for k in range(3)])
    elif icon == 'scroll':
        shape('#e8d8b0', lambda d: d.rectangle((cx - 120, cy - 120, cx + 120, cy + 120), fill=255))
        shape('#7a5a38', lambda d: [d.line((cx - 90, cy + yl, cx + 90, cy + yl), fill=255, width=8) for yl in range(-80, 100, 36)])
        shape('#b8282a', lambda d: d.ellipse((cx + 40, cy + 60, cx + 110, cy + 130), fill=255))
    elif icon == 'coin':
        # the bank: a stack of gold coins and a big iron key across it
        for k in range(5):
            yk = cy + 120 - k * 34
            shape('#d9a93e', lambda d, yk=yk: d.ellipse((cx - 110, yk - 34, cx + 60, yk + 18), fill=255))
        shape('#f6d27a', lambda d: d.ellipse((cx - 100, cy - 60, cx + 50, cy - 18), fill=255))
        shape('#e0b04a', lambda d: d.ellipse((cx + 40, cy + 40, cx + 150, cy + 150), fill=255))
        shape('#5d6470', lambda d: d.ellipse((cx - 30, cy - 190, cx + 60, cy - 100), fill=255))
        shape('#5d6470', lambda d: d.line((cx + 30, cy - 110, cx + 150, cy + 10), fill=255, width=26))
        shape('#5d6470', lambda d: [d.line((cx + 100 + o, cy - 30 + o, cx + 130 + o, cy - 60 + o), fill=255, width=18) for o in (0, 36)])
    elif icon == 'gavel':
        # the auction house: a gavel raised over its sound block
        import math as _m
        shape('#6e4a24', lambda d: d.rounded_rectangle((cx - 140, cy + 110, cx + 120, cy + 165), 14, fill=255))
        shape('#c9a24a', lambda d: d.rectangle((cx - 140, cy + 104, cx + 120, cy + 118), fill=255))
        shape('#8a5a2c', lambda d: d.line((cx - 120, cy + 70, cx + 40, cy - 60), fill=255, width=28))
        dx_, dy_ = 0.77, -0.64                      # along the handle
        px_, py_ = 0.64, 0.77                       # across it: the head
        hx, hy = cx + 70, cy - 85

        def head(d):
            pts = [(hx + px_ * a * 95 + dx_ * b * 42, hy + py_ * a * 95 + dy_ * b * 42) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            d.polygon(pts, fill=255)
        shape('#8a5a2c', head)

        def bands(d):
            for a in (-0.62, 0.62):
                c0 = (hx + px_ * a * 95 - dx_ * 44, hy + py_ * a * 95 - dy_ * 44)
                c1 = (hx + px_ * a * 95 + dx_ * 44, hy + py_ * a * 95 + dy_ * 44)
                d.line((c0, c1), fill=255, width=16)
        shape('#c9a24a', bands)
    elif icon == 'bell':
        shape('#e8b448', lambda d: d.polygon([(cx - 120, cy + 110), (cx + 120, cy + 110), (cx + 80, cy - 10), (cx + 60, cy - 110),
                                              (cx - 60, cy - 110), (cx - 80, cy - 10)], fill=255))
        shape('#e8b448', lambda d: d.ellipse((cx - 22, cy + 100, cx + 22, cy + 144), fill=255))
    # a soft drop shadow under the whole icon, then each layer in relief
    allm = np.clip(sum(m for m, _ in layers), 0, 1)
    sh = fg.blur(np.roll(np.roll(allm, 8, 0), 6, 1), 5)
    col = col * (1 - sh[..., None] * 0.55)
    for m, c in layers:
        L = emboss(m, 16.0, 4.0)
        lit = c * (0.55 + 0.6 * L[..., None])
        lit = lit + fg.sstep(0.85, 1.0, L)[..., None] * 0.15
        col = col * (1 - m[..., None]) + lit * m[..., None]
    edge = np.clip(fg.blur(allm, 1.2) - allm, 0, 1) * 3 + np.clip(allm - fg.blur(allm, 1.2), 0, 1) * 3
    col = col * (1 - np.clip(edge, 0, 1)[..., None] * 0.5)
    put_cell(np.clip(col, 0, 1), None, None, None, ci, cj, q)


def crest_cell(ci, cj):
    x, y = grid(C)
    d = dabs(C, 311)
    col = fg.ramp(np.clip(0.4 + 0.4 * (d - 0.5) + 0.3 * (1 - y / C), 0, 1), [(0, '#0f2358'), (0.6, '#1f3f93'), (1, '#3a62c4')])
    fm = Image.new('L', (C, C), 0)
    dr = ImageDraw.Draw(fm)
    dr.rectangle((10, 10, C - 10, C - 10), outline=255, width=16)
    ccx, ccy = C // 2, C // 2 - 40
    pts = []
    for k in range(16):
        a = math.pi / 2 + k * math.pi / 8
        rr = 150 if k % 2 == 0 else 58
        pts.append((ccx + math.cos(a) * rr, ccy - math.sin(a) * rr))
    dr.polygon(pts, fill=255)
    gm = np.asarray(fm).astype(F) / 255.0
    L = emboss(gm, 20.0, 3.0)
    gold = fg.ramp(L, [(0, '#6a4412'), (0.5, '#d49b3c'), (0.85, '#f8d67e'), (1, '#fff4cc')])
    col = col * (1 - gm[..., None]) + gold * gm[..., None]
    wm = Image.new('L', (C, C), 0)
    dw = ImageDraw.Draw(wm)
    for w in range(3):
        yw = C // 2 + 110 + w * 40
        dw.line([(60 + xx, yw + 16 * math.sin(xx / 34)) for xx in range(0, C - 120, 6)], fill=255, width=14)
    wmask = np.asarray(wm).astype(F) / 255.0
    Lw = emboss(wmask, 14.0, 2.5)
    col = col * (1 - wmask[..., None]) + (fg.hexc('#7fd8ee') * (0.6 + 0.5 * Lw[..., None])) * wmask[..., None]
    put(atlas, np.clip(col, 0, 1), ci, cj)


def rune_cell(ci, cj):
    x, y = grid(C)
    base = fg.ramp(np.clip(0.4 + 0.5 * (dabs(C, 401) - 0.5), 0, 1), [(0, '#07161f'), (1, '#16303f')])
    m = Image.new('L', (C, C), 0)
    d = ImageDraw.Draw(m)
    d.rectangle((30, 30, C - 30, C - 30), outline=255, width=10)
    d.polygon([(C // 2, 80), (C - 120, C // 2), (C // 2, C - 80), (120, C // 2)], outline=255, width=10)
    d.line((C // 2, 40, C // 2, C - 40), fill=255, width=8)
    mm = np.asarray(m).astype(F) / 255.0
    halo = fg.blur(mm, 6)
    cyan = fg.hexc('#3cc8f2')
    col = base + halo[..., None] * cyan * 0.35
    col = col * (1 - mm[..., None]) + cyan * mm[..., None]
    put(atlas, np.clip(col, 0, 1), ci, cj)
    put(emis, np.clip(mm[..., None] * cyan + halo[..., None] * cyan * 0.3, 0, 1), ci, cj)


window_cell(0, 0, True, True, 1)
window_cell(1, 0, True, False, 2)
window_cell(2, 0, False, True, 3)
window_cell(3, 0, False, False, 4)
door_cell_v1(0, 1, 'Wood189_17_Color.jpg')          # v1 wood (the painted door_cell stays for reference)
door_cell_v1(1, 1, 'Wood187_09_Color.jpg')
lancet_cell(3, 1)
# 2026-09-26: the shop signs moved to quarter cells (256 on a ~1.2-yd board is
# still sharper per yard than the walls) to free five cells for one rose window
# per building (bl_town_lib.CELL has the same layout)
for k, (ci, cj, q, icon) in enumerate([(0, 2, 0, 'tankard'), (0, 2, 1, 'anvil'), (0, 2, 2, 'potion'),
                                        (0, 2, 3, 'sack'), (1, 2, 0, 'coin'), (1, 2, 1, 'bell'),
                                        (1, 2, 2, 'gavel')]):
    sign_cell(ci, cj, icon, 500 + k * 7, q=q)
rose_cell('original', 1, 2, q=3)                     # 'rose': the v2 pattern, for anything unassigned
rose_cell('hall', 2, 1, seed=81)
rose_cell('market', 2, 2, seed=83)
rose_cell('bank', 3, 2, seed=85)
rose_cell('tavern', 0, 3, seed=87)
rose_cell('tavern_b', 1, 3, seed=89)
crest_cell(2, 3)
rose_cell('house_b', 3, 3, q=0, seed=91)
rose_cell('original', 3, 3, q=1, seed=93)            # house_e keeps the v2 Tidehold blue
rose_cell('shop_a', 3, 3, q=2, seed=95)
rose_cell('shop_b', 3, 3, q=3, seed=97)
fg.save_rgb(atlas, os.path.join(HERE, 'TownAtlas_Color.jpg'), q=93)
fg.save_rgb(emis, os.path.join(HERE, 'TownAtlas_Emissive.jpg'), q=93)
Image.fromarray((np.clip(orm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(HERE, 'TownAtlas_ORM.png'))
Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(
    os.path.join(HERE, '_preview_atlas.jpg'), quality=90)
print('painted atlas')
