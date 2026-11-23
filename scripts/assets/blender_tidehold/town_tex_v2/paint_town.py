"""The Tidehold town kit's v2 textures: hand-painted, WoW-style, authored from
nothing but noise (no photo sources). Each material is a small graph of
forge.py nodes: shape (cells / blocks / planks / shingles) -> height ->
painted key light + cavity + occlusion -> palette -> painterly finish.

    python3 scripts/assets/blender_tidehold/town_tex_v2/paint_town.py [name ...]

Writes Town<Name>_Color.jpg (1024), Town<Name>_Normal.jpg (512) and a
preview sheet per material into this folder. Deterministic (fixed seeds).
"""
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forge as fg  # noqa: E402

N = 1024
NORMAL_SIZE = 512
F = np.float32


def out(name):
    return os.path.join(HERE, name)


def preview(name, color):
    """A 2x2 tiling sheet (seams show at the centre cross)."""
    im = Image.fromarray((np.clip(color, 0, 1) * 255).astype(np.uint8))
    im = im.resize((512, 512), Image.LANCZOS)
    sheet = Image.new('RGB', (1024, 1024))
    for i in range(2):
        for j in range(2):
            sheet.paste(im, (i * 512, j * 512))
    sheet.save(out(f'_preview_{name}.jpg'), quality=90)


def finish(name, color, height, nstrength):
    fg.save_rgb(color, out(f'Town{name}_Color.jpg'))
    fg.save_normal(fg.normal(height, nstrength), out(f'Town{name}_Normal.jpg'), NORMAL_SIZE)
    preview(name, color)
    print('painted', name)


def per_cell(table, ids):
    return table[ids % len(table)]


def strokes(seed, s_along=14, s_across=2.0, angles=(0.35, -0.5, 1.2), mix=None):
    """Brush-stroke texture: white noise dragged along a few directions."""
    acc = np.zeros((N, N), F)
    for k, a in enumerate(angles):
        acc += fg.norm01(fg.dir_blur(fg.white(N, seed + k), s_along, s_across, a))
    return fg.norm01(acc)


# =============================================================================
#  STONE: the fieldstone wall (Stormwind's rounded grey-blue stones)
# =============================================================================
def dabs(seed, scales=(6, 14, 30)):
    """Soft painted dabs: blurred noise at a few brush sizes (no scratches)."""
    acc = np.zeros((N, N), F)
    for k, sc in enumerate(scales):
        acc += fg.norm01(fg.blur(fg.white(N, seed + k), sc)) * (1.0 / (k + 1))
    return fg.norm01(acc)


def split_cells(seed, coarse, fine, warp_amp, aspect, split_share):
    """Stones of mixed size: a coarse Voronoi, some of its cells split by a
    finer one (where a low-frequency mask says so). Returns (edge, id, count)."""
    wx = (fg.fbm(N, 4, 4, seed + 1) - 0.5) * warp_amp
    wy = (fg.fbm(N, 4, 4, seed + 2) - 0.5) * warp_amp * 0.8
    a = fg.voronoi(N, coarse, seed + 3, jitter=0.95, warp=(wx, wy), aspect=aspect)
    b = fg.voronoi(N, fine, seed + 4, jitter=0.95, warp=(wx, wy), aspect=aspect)
    split_tab = fg.cell_table(a['count'], seed + 5) < split_share
    split = split_tab[a['id']]
    e = np.where(split, np.minimum(a['edge'], b['edge']), a['edge'])
    ids = np.where(split, a['id'] * 997 + b['id'] + 1, a['id'] * 997)
    # compact the ids
    uniq, inv = np.unique(ids, return_inverse=True)
    return e.astype(F), inv.reshape(ids.shape), len(uniq)


def stone():
    """Fieldstone wall, hand-painted (SPACEY, 2026-09-26: "add a bit more
    variation to the cobble walls and make them look a bit more hand
    painted"). Mixed stone sizes (a coarse Voronoi, some cells split), six
    colour families with a wide per-stone value spread, the light painted in
    soft bands (not a smooth CG bevel), a lit top rim and a cool shadowed
    underside per stone, brush strokes at a per-stone angle, lichen on a few,
    and a warm mortar of varying width with a painted dark line."""
    s = 1100
    # mixed sizes from a POWER diagram (random site weights): big and small
    # stones with straight, sliver-free borders (splitting cells shattered)
    wx = (fg.fbm(N, 4, 4, s + 1) - 0.5) * 70
    wy = (fg.fbm(N, 4, 4, s + 2) - 0.5) * 70 * 0.8
    v = fg.voronoi(N, 8, s + 40, jitter=0.95, warp=(wx, wy), aspect=1.3, weight=0.95)
    e, ids, cnt = v['edge'], v['id'], v['count']
    px, py = fg.uv(N)
    # the height in each stone relative to its own centroid
    yy = (py * N + wy) % N
    xx = (px * N + wx) % N
    cyv = np.zeros(cnt, F)
    cxv = np.zeros(cnt, F)
    cnts = np.bincount(ids.ravel(), minlength=cnt).astype(F) + 1e-3
    # circular means (the tile wraps)
    for arr, coord in ((cyv, yy), (cxv, xx)):
        ang = coord / N * 2 * np.pi
        sn = np.bincount(ids.ravel(), np.sin(ang).ravel(), cnt) / cnts
        cs = np.bincount(ids.ravel(), np.cos(ang).ravel(), cnt) / cnts
        arr[:] = (np.arctan2(sn, cs) / (2 * np.pi) * N) % N
    oy = ((yy - cyv[ids] + N / 2) % N - N / 2) / 70.0
    ox = ((xx - cxv[ids] + N / 2) % N - N / 2) / 70.0
    mortar = 3.5 + 3.0 * fg.fbm(N, 6, 3, s + 3)              # 3.5-6.5 px, never a ruled line
    # some stones chunky, some flat; a rim never wider than half the stone's
    # own inradius, or a small stone creases into a pyramid down its middle
    inr = np.zeros(cnt, F)
    np.maximum.at(inr, ids.ravel(), e.ravel())
    rimw = np.minimum(fg.cell_table(cnt, s + 4, 16, 34), np.maximum(inr * 0.5, 6.0))[ids]
    d = np.clip((e - mortar * 0.5) / rimw, 0, 1)
    rim = np.sqrt(d * (2 - d))
    rim = rim * (0.85 + 0.15 * fg.blur(np.clip(e / np.maximum(inr[ids], 1.0), 0, 1), 8))
    lump = fg.fbm(N, 7, 4, s + 5)
    tilt = fg.cell_table(cnt, s + 6, -0.14, 0.14)[ids] * ox + fg.cell_table(cnt, s + 7, -0.1, 0.16)[ids] * oy
    dent = fg.sstep(0.64, 0.8, fg.fbm(N, 36, 3, s + 8)) * fg.sstep(mortar + 22, mortar + 5, e)
    h = rim * (0.8 + 0.2 * lump) + tilt * rim - 0.2 * dent * rim
    grit = fg.fbm(N, 140, 2, s + 9)
    h = np.where(e < mortar, 0.03 + 0.05 * grit, h + 0.015 * (grit - 0.5))
    h = fg.blur(h, 1.4)
    L = fg.light(h, 50.0, wrap=0.3)
    # ---- palette: six families, a wide value spread, a whisper of hue each
    fams = [('#56606d', '#a3b1c2'),     # cool blue-grey (the Stormwind stone)
            ('#5f5e5b', '#b1ada5'),     # warm grey
            ('#665f55', '#bdb19c'),     # a sandier grey
            ('#4a515c', '#8c97a6'),     # dark slate
            ('#5a6058', '#a6ad9e'),     # a greener grey
            ('#6a6e74', '#c8ccce')]     # pale limestone
    wts = np.array([0.34, 0.22, 0.12, 0.13, 0.07, 0.12])
    pick = np.searchsorted(np.cumsum(wts), fg.cell_table(cnt, s + 10))
    pick = np.minimum(pick, len(fams) - 1)
    fam = pick[ids]
    lo = np.stack([fg.hexc(a) for a, _ in fams])[fam]
    hi = np.stack([fg.hexc(b) for _, b in fams])[fam]
    val = fg.cell_table(cnt, s + 11, -0.16, 0.13)[ids][..., None]
    # the light in soft painted bands
    t = fg.soft_posterize(L, 5, 0.5)
    col = lo + (hi - lo) * t[..., None]
    col = col * (1 + val)
    col = fg.hsv_shift(col, dh=(fg.cell_table(cnt, s + 12, -0.02, 0.02)[ids]),
                       ds=fg.cell_table(cnt, s + 13, -0.05, 0.08)[ids])
    # brush strokes at a per-stone angle, following no machine
    angs = (0.35, -0.55, 1.25, 0.9)
    sel = (fg.cell_table(cnt, s + 14) * len(angs)).astype(np.int64)[ids]
    br = np.zeros((N, N), F)
    for k, a in enumerate(angs):
        fld = fg.norm01(fg.dir_blur(fg.blur(fg.white(N, s + 20 + k), 2.5), 16, 3.0, a))
        br = np.where(sel == k, fld, br)
    col = col * (0.92 + 0.16 * br[..., None])
    col = col * (0.9 + 0.2 * dabs(s + 15)[..., None])
    # each stone's lit top rim (a painted highlight stroke) and cool underside
    topness = np.clip(-oy, -1.5, 1.5)
    edge_band = fg.sstep(mortar + 12, mortar + 2, e)
    hl = edge_band * fg.sstep(0.0, 0.6, topness) * fg.sstep(0.55, 0.8, L)
    col = col + hl[..., None] * (fg.hexc('#f4ecd8') - col) * 0.45
    sh = edge_band * fg.sstep(0.1, 0.8, -topness)
    col = col + sh[..., None] * (fg.hexc('#2a3246') - col) * 0.35
    # sunlit faces warm, the shade cool (the painter's temperature shift)
    warm = fg.sstep(0.72, 0.98, L)[..., None]
    col = col + warm * (fg.hexc('#f1e3c2') - col) * 0.28
    cool = fg.sstep(0.45, 0.12, L)[..., None]
    col = col + cool * (fg.hexc('#2e3850') - col) * 0.25
    # lichen on a few stones: soft yellow-green and rust-orange freckles
    lich_on = (fg.cell_table(cnt, s + 16) < 0.1)[ids]
    lich = lich_on * fg.sstep(0.58, 0.75, fg.fbm(N, 22, 4, s + 17)) * fg.sstep(mortar + 3, mortar + 14, e)
    lcol = np.where((fg.cell_table(cnt, s + 18) < 0.65)[ids][..., None], fg.hexc('#9aa45a'), fg.hexc('#b78448'))
    col = col + lich[..., None] * (lcol * (0.7 + 0.5 * L[..., None]) - col) * 0.3
    # fine cracks on some stones
    crack = fractures(s + 19, cells=9, width=1.2, keep=0.2) * (e > mortar + 14)
    col = col * (1 - crack[..., None] * 0.45)
    h = h - crack * 0.05
    # a broad wash across the wall so no two stretches read alike
    wash = fg.fbm(N, 2, 3, s + 30)
    col = col * (0.93 + 0.14 * wash[..., None])
    # mortar: warm dark grit, a painted (not ruled) dark line hugging each stone
    mcol = fg.ramp(grit, [(0, '#2d2823'), (0.6, '#453d35'), (1, '#5c534a')])
    col = np.where((e < mortar)[..., None], mcol, col)
    outline = fg.sstep(mortar + 4, mortar + 0.4, e) * (0.75 + 0.25 * fg.fbm(N, 30, 2, s + 31))
    col = col * (1 - outline[..., None] * 0.34)
    occ = fg.ao(h, radii=(3, 10, 26), weights=(0.45, 0.35, 0.2))
    col = col * (0.55 + 0.45 * occ[..., None])
    finish('Stone', np.clip(col, 0, 1), h, 20.0)
    return h


# =============================================================================
#  shared nodes
# =============================================================================
def fractures(seed, cells=5, width=1.6, keep=0.3, warp=14.0):
    """Hairline cracks: SHORT runs of a coarse Voronoi's borders (straight-ish,
    branching like real fractures), most of the network masked away."""
    wx = (fg.fbm(N, 12, 3, seed + 1) - 0.5) * warp
    wy = (fg.fbm(N, 12, 3, seed + 2) - 0.5) * warp
    v = fg.voronoi(N, cells, seed + 3, jitter=1.0, warp=(wx, wy))
    line = fg.sstep(width, 0.2, v['edge'])
    mask = fg.sstep(1 - keep, 1 - keep + 0.08, fg.fbm(N, 9, 3, seed + 4))
    return (line * mask).astype(F)
def grain_field(seed, lines=38, warp_amp=9.0, knots=5, n=N):
    """Wood grain running along x: warped growth lines + a few knots.
    Returns (lines 0..1, knot mask 0..1)."""
    y, x = np.mgrid[0:n, 0:n].astype(F)
    # long, lazy undulation along the grain
    wv = (fg.value_noise(n, 6, seed + 1, fx=2) - 0.5) * warp_amp * 6 \
        + (fg.value_noise(n, 20, seed + 2, fx=4) - 0.5) * warp_amp
    r = fg.rng(seed + 3)
    kn = np.zeros((n, n), F)
    for _ in range(knots):
        kx, ky = r.uniform(0, n), r.uniform(0, n)
        rx, ry = r.uniform(18, 42), r.uniform(10, 22)
        dx = (x - kx + n / 2) % n - n / 2
        dy = (y - ky + n / 2) % n - n / 2
        dd = (dx / rx) ** 2 + (dy / ry) ** 2
        kn = np.maximum(kn, np.exp(-dd))
        # growth rings bend AROUND a knot (smooth: no sign flip across it)
        wv += np.exp(-dd * 0.3) * ry * 1.2 * np.tanh(dy / ry)
    # uneven ring spacing: the phase drifts with a slow noise
    drift = (fg.value_noise(n, 5, seed + 4, fx=1) - 0.5) * lines * 0.6
    t = (y + wv) / n * lines + drift
    ln = 0.5 + 0.5 * np.sin(t * 2 * math.pi)
    # rings break and fade along their length
    brk = fg.sstep(0.3, 0.7, fg.value_noise(n, 24, seed + 5, fx=6))
    ln = (ln ** 4) * (0.35 + 0.65 * brk)
    return ln.astype(F), kn.astype(F)


def wood_color(seed, lines, dark, mid, light, warp_amp=9.0, knots=5, n=N):
    ln, kn = grain_field(seed, lines, warp_amp, knots, n)
    streak = fg.norm01(fg.dir_blur(fg.white(n, seed + 7), 60, 1.5, 0.0))
    fibre = fg.norm01(fg.dir_blur(fg.white(n, seed + 8), 12, 0.6, 0.0))
    t = np.clip(0.55 * streak + 0.25 * (1 - ln) + 0.2 * fibre, 0, 1)
    col = fg.ramp(t, [(0, dark), (0.55, mid), (1, light)])
    col = col * (1 - 0.35 * ln[..., None]) * (1 - 0.45 * kn[..., None])
    h = 0.5 + 0.25 * (streak - 0.5) - 0.2 * ln - 0.15 * kn + 0.1 * (fibre - 0.5)
    return col.astype(F), h.astype(F)


# =============================================================================
#  DRESSED: ashlar blocks (quoins, door arches, courses, sills)
# =============================================================================
def dressed():
    """ONE dressed stone, no joints: every M_DRESSED cuboid (quoins, jambs,
    voussoirs, imposts, sills, courses, steps) IS a single block, so the
    texture must not paint more blocks inside it (SPACEY, 2026-09-26: "these
    stone trim textures ... dont make sense" - a quoin showed four bricks).
    Warm limestone at 2.4 yd a repeat (a quoin shows a fifth of it): soft
    sedimentary bedding, patches of pitched chisel work, a scatter of
    angular chips with lit rims, pores, the odd hairline crack. The block
    edges come from the geometry and the smart mask's edge wear."""
    s = 1200
    px, py = fg.uv(N)
    big = fg.fbm(N, 3, 4, s + 1)
    mid = fg.fbm(N, 8, 4, s + 2)
    # bedding: lazy horizontal layers (the stone was cut along its bed)
    bw = (fg.fbm(N, 3, 3, s + 3) - 0.5) * 0.9 + (fg.fbm(N, 11, 2, s + 4) - 0.5) * 0.12
    bed_phase = (py * 7 + bw) * 2 * np.pi
    bed = 0.5 + 0.5 * np.sin(bed_phase)
    vein = fg.sstep(0.93, 0.995, 0.5 + 0.5 * np.sin(bed_phase * 2.0 + 1.3)) \
        * fg.sstep(0.45, 0.7, fg.fbm(N, 6, 3, s + 5))
    # pitched tooling: short parallel chisel strokes, two directions, in patches
    t1 = fg.norm01(fg.dir_blur(fg.white(N, s + 6), 7, 0.9, 0.95))
    t2 = fg.norm01(fg.dir_blur(fg.white(N, s + 7), 7, 0.9, -0.75))
    pm = fg.sstep(0.35, 0.65, fg.fbm(N, 5, 3, s + 8))
    tool = (t1 * pm + t2 * (1 - pm)) * fg.sstep(0.3, 0.6, fg.fbm(N, 4, 3, s + 9))
    # chips: a few small Voronoi cells knocked out whole (angular, flat
    # bottomed, a crisp broken rim), never round
    cv = fg.voronoi(N, 44, s + 10, jitter=1.0, warp=((fg.fbm(N, 20, 2, s + 11) - 0.5) * 6,
                                                     (fg.fbm(N, 20, 2, s + 12) - 0.5) * 6))
    chip_on = (fg.cell_table(cv['count'], s + 20) < 0.014)[cv['id']]
    chip = chip_on * fg.sstep(0.5, 7.0, cv['edge'])
    pits = fg.sstep(0.93, 0.975, fg.white(N, s + 13) * 0.35 + fg.fbm(N, 60, 2, s + 14) * 0.65)
    crack = fractures(s + 15, cells=4, width=1.1, keep=0.12, warp=18)
    h = (0.5 + 0.1 * (big - 0.5) + 0.05 * (mid - 0.5) + 0.025 * (bed - 0.5)
         + 0.045 * tool - 0.09 * chip - 0.05 * pits - 0.07 * crack)
    h = fg.blur(h, 0.7)
    L = fg.light(h, 34.0, wrap=0.5)
    occ = fg.ao(h, radii=(2, 5, 12), weights=(0.5, 0.3, 0.2))
    t = np.clip(0.52 + 0.5 * (big - 0.5) + 0.3 * (mid - 0.5) + 0.12 * (bed - 0.5) + 0.45 * (L - 0.62), 0, 1)
    col = fg.ramp(fg.soft_posterize(t, 7, 0.35), [(0, '#7d7568'), (0.3, '#a89f8e'), (0.55, '#c4baa6'),
                                                  (0.8, '#d9cfba'), (1, '#efe6d0')])
    # warm ochre stains and cool grey patches, broad and soft
    ochre = fg.sstep(0.58, 0.8, fg.fbm(N, 4, 4, s + 16))[..., None]
    col = col + ochre * (fg.hexc('#c39a62') * (0.6 + 0.5 * t[..., None]) - col) * 0.16
    cool = fg.sstep(0.62, 0.85, fg.fbm(N, 5, 3, s + 17))[..., None]
    col = col + cool * (fg.hexc('#8f949a') * (0.7 + 0.45 * t[..., None]) - col) * 0.25
    col = col * (0.94 + 0.1 * tool[..., None])
    col = col * (1 - vein[..., None] * 0.06)
    col = col * (0.93 + 0.12 * dabs(s + 18)[..., None])
    # chips: cooler, rougher hollows (the painted light shades their walls)
    col = col + chip[..., None] * (fg.hexc('#8a8479') * (0.7 + 0.5 * L[..., None]) - col) * 0.35
    col = col * (1 - pits[..., None] * 0.35)
    col = col * (1 - crack[..., None] * 0.45)
    col = col * (0.72 + 0.28 * occ[..., None])
    col = fg.hsv_shift(col, dh=(fg.fbm(N, 2, 3, s + 19) - 0.5) * 0.025)
    finish('Dressed', np.clip(col, 0, 1), h, 12.0)


# =============================================================================
#  PLASTER: cream daub, painted mottling, water stains, hairline cracks
# =============================================================================
def plaster():
    s = 1300
    big = fg.fbm(N, 3, 4, s + 1)
    mid = fg.soft_posterize(fg.fbm(N, 7, 4, s + 2), 5, 0.3)
    fine = fg.fbm(N, 90, 3, s + 3)
    trowel = fg.norm01(fg.dir_blur(fg.white(N, s + 4), 26, 5, 0.15)) * 0.5 \
        + fg.norm01(fg.dir_blur(fg.white(N, s + 5), 26, 5, 2.2)) * 0.5
    crack = fractures(s + 6, cells=4, width=1.1, keep=0.12, warp=22)
    h = 0.5 + 0.12 * (big - 0.5) + 0.06 * (trowel - 0.5) + 0.03 * (fine - 0.5) - 0.2 * crack
    h = fg.blur(h, 1.0)
    L = fg.light(h, 30.0, wrap=0.6)
    brush = strokes(s + 11, s_along=30, s_across=7, angles=(0.2, 1.9, -0.9))
    t = np.clip(0.4 + 0.6 * (mid - 0.5) + 0.45 * (big - 0.5) + 0.35 * (L - 0.6) + 0.55 * (brush - 0.5), 0, 1)
    col = fg.ramp(fg.soft_posterize(t, 7, 0.35), [(0, '#9c8b6f'), (0.3, '#c4b393'), (0.62, '#ddd0b1'), (0.85, '#ece2c8'), (1, '#f8f1dc')])
    # weathered patches: bigger, browner, soft-edged (a painter's glaze)
    patch = fg.sstep(0.58, 0.75, fg.fbm(N, 4, 4, s + 12))
    col = col * (1 - patch[..., None] * 0.1) + patch[..., None] * fg.hexc('#9b8563') * 0.05
    # water stains: long vertical drips out of a patchy mask (tile-safe)
    drip = fg.norm01(fg.dir_blur(fg.white(N, s + 8), 90, 3, math.pi / 2))
    mask = fg.sstep(0.55, 0.8, fg.fbm(N, 3, 3, s + 9))
    stain = np.clip((drip - 0.5) * 2.2, 0, 1) * mask
    col = col * (1 - stain[..., None] * 0.18) + stain[..., None] * fg.hexc('#8a7a5e') * 0.06
    col = col * (0.94 + 0.12 * trowel[..., None])
    col = col * (0.97 + 0.06 * fine[..., None])
    # cracks: a dark line with a lit lip
    lip = np.roll(np.roll(crack, 1, 0), -1, 1)
    col = col * (1 - crack[..., None] * 0.5) + (lip * (1 - crack))[..., None] * 0.06
    # a few chipped spots showing the dark daub under the skin
    chip = fg.sstep(0.84, 0.88, fg.fbm(N, 22, 3, s + 10))
    col = col * (1 - chip[..., None] * 0.35)
    finish('Plaster', np.clip(col, 0, 1), h - 0.1 * chip, 10.0)


# =============================================================================
#  TIMBER: dark oak beams (grain runs along the beam: texture x)
# =============================================================================
def timber():
    s = 1400
    col, h = wood_color(s, 34, '#2a1a10', '#5a3a24', '#8a5e3a', warp_amp=8, knots=4)
    split = fg.sstep(0.93, 0.975, fg.norm01(fg.dir_blur(fg.white(N, s + 9), 40, 0.8, 0.0)))
    split = split * fg.sstep(0.5, 0.65, fg.fbm(N, 5, 3, s + 10))
    col = col * (1 - split[..., None] * 0.6)
    h = h - split * 0.2
    L = fg.light(fg.blur(h, 1.0), 28.0, wrap=0.5)
    col = col * (0.68 + 0.5 * L[..., None])
    # long painted highlight streaks along the grain
    hl = fg.sstep(0.62, 0.85, fg.norm01(fg.dir_blur(fg.white(N, s + 12), 80, 3, 0.0)))
    col = col + hl[..., None] * (fg.hexc('#b88452') - col) * 0.35
    col = col * (0.88 + 0.2 * dabs(s + 11, (10, 26, 60))[..., None])
    col = fg.hsv_shift(col, ds=0.12)
    finish('Timber', np.clip(col, 0, 1), h, 8.0)


# =============================================================================
#  ROOF: Stormwind slate, round-bottomed shingles (eave = bottom of the image)
# =============================================================================
def roof():
    s = 1500
    rows, cols = 8, 5
    rh, cw = N / rows, N / cols
    y, x = np.mgrid[0:N, 0:N].astype(F)
    r = fg.rng(s)
    hue_tab = r.uniform(-0.03, 0.035, (rows, cols)).astype(F)
    val_tab = r.uniform(-0.13, 0.1, (rows, cols)).astype(F)
    fam_tab = r.random((rows, cols))
    tongue = 0.42                            # how far a shingle's round foot overlaps the row below

    def cell(rowi, xx):
        off = (rowi % 2) * 0.5 * cw
        c = np.floor(((xx - off) % N) / cw).astype(np.int64)
        lx = (((xx - off) % N) - c * cw) / cw
        return c % cols, lx

    row = np.floor(y / rh).astype(np.int64)
    ly = (y - row * rh) / rh                 # 0 at the row's top, 1 at its bottom
    rw = row % rows
    c_here, lx_here = cell(rw, x)
    ra = (rw - 1) % rows
    c_up, lx_up = cell(ra, x)
    # the row above's shingle hangs a rounded foot down into this row
    foot = tongue * np.sqrt(np.clip(1 - (2 * lx_up - 1) ** 2, 0, 1))
    on_up = ly < foot
    owner_r = np.where(on_up, ra, rw)
    owner_c = np.where(on_up, c_up, c_here)
    lx = np.where(on_up, lx_up, lx_here)
    depth = np.where(on_up, 1 + ly, ly)       # distance down the owning shingle (in rows)
    # its own foot boundary (the scallop edge) sits at 1 + foot_own
    foot_own = tongue * np.sqrt(np.clip(1 - (2 * lx - 1) ** 2, 0, 1))
    to_edge = (1 + foot_own - depth) * rh     # pixels above its scalloped edge
    side = np.minimum(lx, 1 - lx) * cw        # pixels from its side gaps
    edge = np.minimum(to_edge, side)
    # shingle height: thickens toward the foot, rounded rim, a hair of warp
    body = 0.35 + 0.45 * np.clip(depth / (1 + tongue), 0, 1)
    rim = np.sqrt(np.clip(edge / 14.0, 0, 1))
    h = body * rim + 0.02 * (fg.fbm(N, 60, 3, s + 1) - 0.5)
    h = np.where(side < 2.0, 0.05, h)
    h = fg.blur(h, 1.0)
    L = fg.light(h, 40.0, wrap=0.3)
    occ = fg.ao(h, radii=(3, 8, 18))
    # palette: royal blue, indigo, teal-blue shingles
    fams = [('#1b2c63', '#4a78d4'), ('#1d2458', '#4d62c8'), ('#193660', '#4581c2'), ('#22306a', '#5b82d8')]
    fw = np.cumsum([0.42, 0.24, 0.1, 0.24])
    fi = np.searchsorted(fw, fam_tab)[owner_r, owner_c]
    lo = np.stack([fg.hexc(a) for a, _ in fams])[fi]
    hi = np.stack([fg.hexc(b) for _, b in fams])[fi]
    # value: dark up under the shingle above, bright at the round foot
    t = np.clip(0.25 + 0.55 * np.clip(depth / (1 + tongue), 0, 1) + 0.45 * (L - 0.55), 0, 1)
    t = fg.soft_posterize(t, 6, 0.35)
    col = lo + (hi - lo) * t[..., None]
    col = col * (1 + val_tab[owner_r, owner_c][..., None])
    col = fg.hsv_shift(col, dh=hue_tab[owner_r, owner_c])
    # a painted light lip on the foot, a cast shadow under it
    lipm = fg.sstep(16, 3, to_edge) * fg.sstep(0.5, 0.8, L)
    col = col + lipm[..., None] * (fg.hexc('#b7cff5') - col) * 0.55
    shade = fg.sstep(0, 0.35, ly) * (~on_up)
    col = col * (0.72 + 0.28 * shade[..., None])
    col = col * (0.9 + 0.2 * dabs(s + 2, (5, 12, 26))[..., None])
    # a few chipped corners and light speckle
    spk = fg.white(N, s + 3)
    col = np.where((spk > 0.994)[..., None], col * 1.3, col)
    col = np.where((side < 2.0)[..., None], fg.hexc('#0c1330'), col)
    col = col * (0.62 + 0.38 * occ[..., None])
    finish('Roof', np.clip(col, 0, 1), h, 18.0)


# =============================================================================
#  FLOOR: oak planks (grain along x), butt joints, nail heads
# =============================================================================
def floor():
    s = 1600
    b = fg.bricks(N, 7, s, min_w=2.2, max_w=4.0, stagger=0.37)
    e, ids, cnt = b['edge'], b['id'], b['count']
    col, hg = wood_color(s + 1, 70, '#3a2416', '#6b4629', '#96683f', warp_amp=5, knots=6)
    val = fg.cell_table(cnt, s + 2, -0.16, 0.12)[ids][..., None]
    hue = fg.cell_table(cnt, s + 3, -0.008, 0.012)[ids]
    col = fg.hsv_shift(col * (1 + val), dh=hue, ds=fg.cell_table(cnt, s + 5, -0.15, 0.1)[ids])
    gap = 3.0
    d = np.clip((e - gap * 0.5) / 8.0, 0, 1)
    h = np.sqrt(d * (2 - d)) * 0.8 + 0.2 * hg
    # nail heads near every plank end
    y, x = np.mgrid[0:N, 0:N].astype(F)
    rowh = N / 7
    nails = np.zeros((N, N), F)
    ly = (y % rowh) / rowh
    for fy in (0.28, 0.72):
        nails = np.maximum(nails, fg.sstep(7, 3, np.hypot((e - 14) * (e < 30), (ly - fy) * rowh)))
    col = col * (1 - nails[..., None] * 0.55)
    h = h - nails * 0.1
    L = fg.light(fg.blur(h, 0.8), 30.0, wrap=0.4)
    col = col * (0.72 + 0.4 * L[..., None])
    col = np.where((e < gap)[..., None], fg.hexc('#150d08'), col)
    col = col * (0.92 + 0.14 * dabs(s + 4)[..., None])
    finish('Floor', np.clip(col, 0, 1), h, 12.0)


# =============================================================================
#  FLAG: big flagstones (thresholds, the smithy, the church nave)
# =============================================================================
def flag():
    s = 1700
    wx = (fg.fbm(N, 5, 3, s + 1) - 0.5) * 30
    wy = (fg.fbm(N, 5, 3, s + 2) - 0.5) * 30
    b = fg.bricks(N, 3, s, min_w=0.9, max_w=1.8, stagger=0.45)
    # warp the block field for hand-cut edges
    e = fg.sample(b['edge'], (fg.uv(N)[0] * N + wx), (fg.uv(N)[1] * N + wy))
    ids = b['id'][((fg.uv(N)[1] * N + wy).astype(np.int64)) % N, ((fg.uv(N)[0] * N + wx).astype(np.int64)) % N]
    cnt = b['count']
    joint = 5.0
    d = np.clip((e - joint * 0.5) / 22.0, 0, 1)
    h = np.sqrt(d * (2 - d)) * (0.85 + 0.15 * fg.fbm(N, 7, 4, s + 3))
    wear = fg.fbm(N, 14, 4, s + 4)
    h = h - 0.05 * wear
    crk = fractures(s + 5, cells=5, width=1.4, keep=0.25) * (e > joint + 10)
    h = np.where(e < joint, 0.05, h - crk * 0.12)
    h = fg.blur(h, 1.2)
    L = fg.light(h, 40.0, wrap=0.35)
    occ = fg.ao(h, radii=(3, 9, 22))
    fams = [('#5c5a58', '#b2ada3'), ('#5b6068', '#a8aeb6'), ('#665d52', '#bdb09d')]
    fam = (fg.cell_table(cnt, s + 7) * len(fams)).astype(np.int64)[ids]
    lo = np.stack([fg.hexc(a) for a, _ in fams])[fam]
    hi = np.stack([fg.hexc(b2) for _, b2 in fams])[fam]
    t = fg.soft_posterize(np.clip(L * 0.9 + 0.05 * (wear - 0.5), 0, 1), 6, 0.4)
    col = lo + (hi - lo) * t[..., None]
    col = col * (1 + fg.cell_table(cnt, s + 8, -0.1, 0.08)[ids][..., None])
    col = col * (0.9 + 0.2 * dabs(s + 9)[..., None])
    col = col * (1 - crk[..., None] * 0.5)
    jcol = fg.ramp(fg.fbm(N, 90, 2, s + 10), [(0, '#2b2724'), (1, '#4a443e')])
    col = np.where((e < joint)[..., None], jcol, col)
    col = col * (1 - fg.sstep(joint + 5, joint, e)[..., None] * 0.35)
    col = col * (0.55 + 0.45 * occ[..., None])
    finish('Flag', np.clip(col, 0, 1), h, 16.0)


# =============================================================================
#  GOLD: finials, bands, the keystone rims: warm painted metal
# =============================================================================
def gold():
    s = 1800
    y, x = np.mgrid[0:N, 0:N].astype(F)
    big = fg.fbm(N, 3, 4, s + 2)
    bands = 0.5 + 0.35 * np.sin((y / N) * 2 * math.pi * 2 + big * 3.0) + 0.15 * (big - 0.5)
    st = fg.norm01(fg.dir_blur(fg.white(N, s + 1), 60, 1.2, 0.0))
    t = np.clip(0.15 + 0.7 * bands + 0.25 * (st - 0.5), 0, 1)
    col = fg.ramp(fg.soft_posterize(t, 6, 0.3), [(0, '#4a2e0e'), (0.3, '#9c6a1c'), (0.6, '#dca640'), (0.85, '#ffe08a'), (1, '#fffbe8')])
    glint = fg.sstep(0.93, 0.99, st) * fg.sstep(0.7, 0.9, bands)
    col = col + glint[..., None] * 0.35
    h = 0.5 + 0.15 * (bands - 0.5) + 0.03 * (st - 0.5)
    finish('Gold', np.clip(col, 0, 1), h, 6.0)


# =============================================================================
#  PAINTED BOARDS (teal / blue): the alchemist's accent, paint chipped off oak
# =============================================================================
def boards(name, seed, paint_lo, paint_hi):
    s = seed
    # five boards side by side: seams are vertical, the grain runs up them
    y, x = np.mgrid[0:N, 0:N].astype(F)
    bw = N / 5
    ex = np.minimum(x % bw, bw - x % bw)
    e = ex.astype(F)
    ids = (x // bw).astype(np.int64)
    b = {'count': 5}
    wood, hg = wood_color(s + 1, 40, '#2e1d12', '#5e3e26', '#8a6040', warp_amp=6, knots=3)
    wood = np.transpose(wood, (1, 0, 2)).copy()
    hg = hg.T.copy()
    paint_t = np.clip(0.5 + 0.35 * (dabs(s + 2) - 0.5) + 0.2 * (hg - 0.5), 0, 1)
    paint = fg.ramp(paint_t, [(0, paint_lo), (1, paint_hi)])
    paint = paint * (1 + fg.cell_table(b['count'], s + 3, -0.1, 0.08)[ids][..., None])
    wearn = fg.fbm(N, 22, 4, s + 4)
    chipped = (wearn + fg.sstep(26, 3, e) * 0.45) > 0.78
    col = np.where(chipped[..., None], wood, paint)
    gap = 3.0
    d = np.clip((e - gap * 0.5) / 8.0, 0, 1)
    h = np.sqrt(d * (2 - d)) * 0.8 + 0.15 * hg - 0.08 * chipped
    L = fg.light(fg.blur(h, 0.8), 25.0, wrap=0.45)
    col = col * (0.72 + 0.38 * L[..., None])
    col = np.where((e < gap)[..., None], fg.hexc('#120b07'), col)
    finish(name, np.clip(col, 0, 1), h, 10.0)


def teal():
    boards('Teal', 1900, '#1f5f66', '#3f9aa0')


def blue():
    boards('Blue', 1950, '#1f3a78', '#4169b4')


# =============================================================================
#  CLOTH: the Tidehold blue of the banners (a woven wool, soft folds)
# =============================================================================
def cloth():
    s = 2000
    y, x = np.mgrid[0:N, 0:N].astype(F)
    wv = (0.5 + 0.5 * np.sin(x / N * 2 * math.pi * 256)) * (0.5 + 0.5 * np.sin(y / N * 2 * math.pi * 256))
    folds = fg.norm01(fg.dir_blur(fg.white(N, s + 1), 120, 18, math.pi / 2))
    t = np.clip(0.45 + 0.4 * (folds - 0.5) + 0.12 * (wv - 0.5) + 0.1 * (fg.fbm(N, 20, 3, s + 2) - 0.5), 0, 1)
    col = fg.ramp(fg.soft_posterize(t, 5, 0.4), [(0, '#0f1b45'), (0.5, '#243f93'), (1, '#4a70cf')])
    finish('Cloth', np.clip(col, 0, 1), 0.5 + 0.2 * (folds - 0.5) + 0.05 * wv, 6.0)


# The WOOD stays on the v1 set (SPACEY, 2026-09-26: "revert all of the wood
# textures"): TownTimber / TownFloor / TownTeal / TownBlue are copied from
# ../town_tex by keep_v1_wood(); the painted timber/floor/teal/blue graphs
# above are kept for reference, not run by default.
V1_WOOD = ('Timber', 'Floor', 'Teal', 'Blue')


def keep_v1_wood():
    import shutil
    for m in V1_WOOD:
        for k in ('Color', 'Normal'):
            shutil.copyfile(os.path.join(HERE, '..', 'town_tex', f'Town{m}_{k}.jpg'), out(f'Town{m}_{k}.jpg'))
    print('kept v1 wood:', ', '.join(V1_WOOD))


MATERIALS = {'stone': stone, 'dressed': dressed, 'plaster': plaster, 'roof': roof, 'flag': flag, 'gold': gold,
             'cloth': cloth, 'v1wood': keep_v1_wood,
             # painted alternatives, only on request: python3 paint_town.py timber floor teal blue
             'timber': timber, 'floor': floor, 'teal': teal, 'blue': blue}
DEFAULT = ['stone', 'dressed', 'plaster', 'roof', 'flag', 'gold', 'cloth', 'v1wood']

if __name__ == '__main__':
    want = sys.argv[1:] or DEFAULT
    for w in want:
        MATERIALS[w]()
