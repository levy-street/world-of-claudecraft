# Stage 2 of the painted Tidehold walls re-bake (bake_walls.py runs it):
# numpy only, no scene. Reads the bake stage's EXRs and the building's
# ORIGINAL walls maps, writes the new walls colour and normal atlases with
# their half and quarter tiers, a stats JSON and review previews.
#
# The stone mask is built in atlas space from the original colour atlas:
#   - texel classes off colour alone: cool grey or ochre-lit stone, cream
#     (plaster, quoins, dressed surrounds), warm brown timber, dark (the old
#     joint lines, the forge, the chimney), lit window panes (emission);
#   - a region test over a window about a third of an old stone across:
#     mostly stone, little cream, timber or dark, inside the walls' UVs;
#   - cleaned (close, open, drop small islands), with solid cream and timber
#     blocks and the lit panes cut back out, then feathered a few texels.
# Inside it the colour is the painted tile as baked through TEXCOORD_1: it
# keeps its own painted values and takes only the original's hue and a
# gentle low-pass grime (a masked, normalised blur about an old stone
# across). Outside the mask the original texel is kept exactly. The mask
# itself rides in the colour's alpha; the walls normal keeps its own size,
# flat inside the mask, where the shared detail normal carries the stones.
import json
import math
import os

import numpy as np

from bake_walls import (blur_atlas, chord_widths, dilate, erode, linear_to_srgb, load, save,
                        srgb_to_linear)


def resize_bilinear(a, h, w):
    """Bilinear resample by texel centres (the atlas maps are smooth enough;
    used to bring the emission and the old normal onto another grid)."""
    H, W = a.shape[:2]
    ys = (np.arange(h) + 0.5) * H / h - 0.5
    xs = (np.arange(w) + 0.5) * W / w - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 1)
    y1 = np.clip(y0 + 1, 0, H - 1)
    x1 = np.clip(x0 + 1, 0, W - 1)
    fy = np.clip(ys - y0, 0, 1)[:, None, None]
    fx = np.clip(xs - x0, 0, 1)[None, :, None]
    a = a if a.ndim == 3 else a[:, :, None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def box_down(a, f):
    """Mean over f x f blocks (exact integer factor)."""
    H, W = a.shape[:2]
    a = a if a.ndim == 3 else a[:, :, None]
    return a.reshape(H // f, f, W // f, f, a.shape[2]).mean((1, 3)).astype(np.float32)


def sized(v, factor):
    """How the tier files size a map (tests/tidehold_texture_tiers.test.ts):
    the model's own size times the factor, on the four-texel block grid."""
    return max(4, round(v * factor / 4) * 4)


def decode_n(c):
    n = c[..., :3] * 2 - 1
    return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)


def encode_n(n):
    n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    return n * 0.5 + 0.5


def hue_deg(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    d = np.maximum(mx - rgb.min(-1), 1e-5)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4))
    return h * 60


def label_ids(mask):
    """Connected (4-neighbour) component id of each mask texel (0 outside),
    by row runs and union-find (no scipy in Blender's Python)."""
    H, W = mask.shape
    runs, rows = [], []
    for y in range(H):
        d = np.diff(np.r_[0, mask[y].astype(np.int8), 0])
        st, en = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        rows.append(list(range(len(runs), len(runs) + len(st))))
        runs.extend((y, int(a), int(b)) for a, b in zip(st, en))
    parent = list(range(len(runs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for y in range(H - 1):
        a_ids, b_ids = rows[y], rows[y + 1]
        i = j = 0
        while i < len(a_ids) and j < len(b_ids):
            a, b = runs[a_ids[i]], runs[b_ids[j]]
            if a[1] < b[2] and b[1] < a[2]:
                ra, rb = find(a_ids[i]), find(b_ids[j])
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
            if a[2] < b[2]:
                i += 1
            else:
                j += 1
    ids = {}
    out = np.zeros((H, W), np.int64)
    for k, (y, a, b) in enumerate(runs):
        out[y, a:b] = ids.setdefault(find(k), len(ids) + 1)
    return out


def label_sizes(mask):
    lab = label_ids(mask)
    return np.bincount(lab.ravel())[lab] * (lab > 0)


def build_mask(job, O, E, cover):
    """The stone mask (float 0..1, feathered) and its binary core."""
    mk = job['mask']
    V = O.max(-1)
    S = (V - O.min(-1)) / np.maximum(V, 1e-4)
    hue = hue_deg(O)
    r, b = O[..., 0], O[..., 2]
    grey = (S < mk['greySat']) & (V > 0.22) & (V < 0.80) & ((b - r) > -0.07)
    # the warm light on a stone's upper face is LIGHT; a brown at the same
    # hue and lower value is wood (planked doors and boarding)
    ochre = (hue > 15) & (hue < 50) & (S > 0.18) & (S < 0.55) & (V > 0.42) & (V < 0.78)
    cream = (V > mk['creamValue']) & (r > b + 0.03) & (S < 0.40)
    timber = (hue > 8) & (hue < 45) & (S > 0.28) & (V > 0.06) & (V < 0.47)
    vivid = S > 0.42
    dark = V < 0.30
    lit = E.max(-1) > 0.04
    covered = cover > 0.5
    R = mk['regionRadius']
    f = lambda m: blur_atlas(m.astype(np.float32), R)
    fg, fo, fc, ft, fd = f(grey), f(ochre), f(cream), f(timber), f(dark)
    region = covered & ((fg + 0.7 * fo) > mk['stoneShare']) & (fg > mk['minGrey']) & \
        (fc < mk['maxCream']) & (ft < mk['maxTimber']) & (fd < mk['maxDark'])
    # close the old joint lines inside a wall, open away crumbs
    region = erode(dilate(region, 3), 3)
    region = dilate(erode(region, 3), 3)
    # solid cream (quoins, surrounds, sills, plaster) and solid timber, cut
    # back out with a little margin; the lit panes with their frames
    solid_cream = dilate(erode(cream, 3), 4)
    # (the old atlas's joint lines are thin dark-brown lines that read as
    # timber texel by texel: an erosion of 3 drops them, a shutter or a beam
    # is thicker and stays)
    solid_timber = dilate(erode(timber, 3), 3)
    region &= ~solid_cream & ~solid_timber & ~dilate(lit, mk['litMargin'])
    glass_cut = lit | ((hue > 190) & (hue < 260) & (S > 0.35) & (V > 0.25))
    region &= ~dilate(dilate(erode(glass_cut, 1), 1), mk['glassMargin'])
    region &= covered
    # an old pale stone the cream test cut out of the middle of a wall is
    # still wall: fill enclosed holes that hold no pane, wood or vivid glass
    holes = label_ids(~region)
    n = holes.max() + 1
    area = np.bincount(holes.ravel(), minlength=n)
    # (the old joint lines ringing a pale stone are dark brown: only wood or
    # glass bright enough to be a real feature vetoes the fill)
    feature = lit | ~covered | ((timber | vivid) & (V > 0.32))
    bad = np.bincount(holes.ravel(), weights=feature.ravel(), minlength=n)
    fill = (area < mk['maxHole']) & (bad < 0.08 * area)
    fill[0] = False
    region |= fill[holes]
    # an old pale stone beside an arch or a quoin joins that trim's hole, so
    # also take each pale blob on its own: one whose rim is mostly rubble is
    # a stone of the wall, one ringed by more trim or the wall's edge is trim
    blobs = label_ids(erode(cream, 1))
    nb = blobs.max() + 1
    grown = blobs.copy()
    # the region test leaves a margin round a pale blob (its window sees the
    # cream), so the rim is read a margin's width out
    for _ in range(mk['paleReach']):
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(grown, dy, 0), dx, 1)
            grown = np.where(grown == 0, sh, grown)
    rim = (grown > 0) & ~cream & ~dilate(blobs > 0, mk['paleReach'] - 4)
    rim_all = np.bincount(grown[rim], minlength=nb)
    rim_wall = np.bincount(grown[rim], weights=region[rim], minlength=nb)
    b_area = np.bincount(blobs.ravel(), minlength=nb)
    b_bad = np.bincount(blobs.ravel(), weights=feature.ravel(), minlength=nb)
    # a quoin or a dressed block is a near-perfect rectangle; a painted
    # rubble stone is an irregular polygon (a hexagon fills 0.75 of its box)
    ys, xs = np.nonzero(blobs)
    lb = blobs[ys, xs]
    y0 = np.full(nb, 1 << 30); y1 = np.zeros(nb, np.int64)
    x0 = np.full(nb, 1 << 30); x1 = np.zeros(nb, np.int64)
    np.minimum.at(y0, lb, ys); np.maximum.at(y1, lb, ys)
    np.minimum.at(x0, lb, xs); np.maximum.at(x1, lb, xs)
    box = np.maximum((y1 - y0 + 1) * (x1 - x0 + 1), 1)
    squared = b_area > mk['maxBoxFill'] * box
    stone_blob = (rim_wall > mk['paleRim'] * np.maximum(rim_all, 1)) & (b_area < mk['maxHole']) & \
        (b_bad < 0.08 * np.maximum(b_area, 1)) & ~squared
    stone_blob[0] = False
    region |= dilate(stone_blob[blobs], mk['paleReach']) & covered & ~dilate(lit, mk['litMargin']) & \
        ~solid_timber
    # the window test keeps clear of every trim by about its own radius, so
    # a band of old stones would survive round each window, shutter and
    # quoin: regrow the region up to the hard edges themselves
    # (thick dark areas, the forge mouth and the chimney, and vivid glass are
    # edges too; the old atlas's thin dark joint lines are not)
    solid_dark = dilate(erode(dark, 4), 3)
    # every window, lit or not, with a ring for its frame: the lit panes, and
    # the unlit blue glass (the frames are too thin to count as timber)
    glass = lit | ((hue > 190) & (hue < 260) & (S > 0.35) & (V > 0.25))
    glass_ring = dilate(dilate(erode(glass, 1), 1), mk['glassMargin'])
    hard = solid_cream | solid_timber | solid_dark | glass_ring | ~covered
    for _ in range(mk['regrowPx']):
        region = region | (dilate(region, 1) & ~hard)
    # drop islands too small to carry a stone (a stray patch on a trim)
    sizes = label_sizes(region)
    region &= sizes >= mk['minArea']
    # reach a few texels past the UV edge into the bake margin, so filtering
    # at a seam samples the new texels, not the old
    core = region | (dilate(region, mk['seamReach']) & ~covered)
    soft = np.clip(blur_atlas(core.astype(np.float32), mk['feather']) * 2 - 0.5, 0, 1)
    # never let the feather creep back over a lit pane or a solid trim
    soft *= ~(dilate(lit, 2) | (erode(cream, 3) & ~region))
    return soft.astype(np.float32), region, {'grey': grey, 'dark': dark}


def run(job):
    W, H = job['atlasSize']
    wd = job['work']
    O8 = load(job['origColorPng'])[..., :3]
    E = resize_bilinear(load(job['origEmitPng'])[..., :3], H, W)
    On = decode_n(load(job['origNormalPng']))
    cover = load(os.path.join(wd, 'bake_cover.exr'))[..., 0]
    Tc = load(os.path.join(wd, 'bake_color.exr'))[..., :3]
    aux = load(os.path.join(wd, 'bake_aux.exr'))[..., :3]
    tile = json.load(open(os.path.join(job['tileDir'], 'stats.json')))
    bake = json.load(open(os.path.join(wd, 'bake.json')))

    soft, region, cls = build_mask(job, O8, E, cover)
    covered = cover > 0.5

    # colour: the painted tile keeps its own painted values (its highlights,
    # shadows and joints stay bold); the original atlas lends only its hue and
    # a gentle grime, from a masked, normalised blur about an old stone across
    # (old dark joint lines left out of the average), in linear light
    O = srgb_to_linear(O8)
    w = (region & ~cls['dark']).astype(np.float32)
    col = job['colour']
    wb = blur_atlas(w, col['lowpassTexels'])
    lp = blur_atlas(O * w[..., None], col['lowpassTexels']) / np.maximum(wb, 1e-4)[..., None]
    tile_stone = np.array(tile['stoneMeanLinear'], np.float32)
    lum = lambda c: c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722
    lp_l = np.maximum(lum(lp), 1e-5)
    hue = (lp / lp_l[..., None]) / (tile_stone / max(float(lum(tile_stone)), 1e-5))
    hue = 1 + col['hueStrength'] * (hue - 1)
    ref = float(np.median(lp_l[region])) if region.any() else 1.0
    grime = np.clip(1 + col['grimeStrength'] * (lp_l / ref - 1), col['grimeRange'][0], col['grimeRange'][1])
    ratio = np.clip(hue * grime[..., None], 0.25, 3.0)
    T = srgb_to_linear(np.clip(Tc, 0, 1))
    new = T * ratio * aux[..., 0:1]
    out_lin = O * (1 - soft[..., None]) + new * soft[..., None]
    rgb = linear_to_srgb(out_lin)
    # outside the mask keep the original texel exactly (no 8-bit round trip)
    rgb = np.where(soft[..., None] > 0, rgb, O8)
    # the stone mask rides in the alpha: 1 re-tiled painted stone, 0 the
    # original atlas, feathered (the runtime detail normal blends by it)
    colour = np.concatenate([rgb, soft[..., None]], -1)

    # the atlas normal keeps its own size: the original relief outside the
    # mask, flat inside it (the shared detail normal carries the stones)
    nh, nw = On.shape[:2]
    ms = np.clip(resize_bilinear(blur_atlas(soft, W / nw / 2), nh, nw)[..., 0], 0, 1)[..., None]
    flat = np.zeros_like(On)
    flat[..., 2] = 1
    nrm = encode_n(On * (1 - ms) + flat * ms)

    out = job['out']
    os.makedirs(out, exist_ok=True)
    files = {}

    def put(key, arr):
        p = os.path.join(out, f'{key}.png')
        save(p, arr)
        files[key] = {'path': p, 'size': [arr.shape[1], arr.shape[0]]}

    put('color', colour)
    put('normal', nrm)
    for tier, fac in (('half', 2), ('quarter', 4)):
        assert sized(W, 1 / fac) == W // fac and sized(nw, 1 / fac) == nw // fac
        c = box_down(np.concatenate([srgb_to_linear(colour[..., :3]), colour[..., 3:]], -1), fac)
        put(f'color_{tier}', np.concatenate([linear_to_srgb(c[..., :3]), c[..., 3:]], -1))
        put(f'normal_{tier}', encode_n(box_down(decode_n(nrm), fac)))

    # stats: mask coverage of the walls' own texels, stone sizes before/after
    dens = bake['texelsPerUnit']
    to_yd = job['standScale'] / dens
    old_stone = region & ~cls['dark']
    ow = chord_widths(old_stone, wrap=False)
    new_stone = region & (aux[..., 1] < 0.5)
    nwid = chord_widths(new_stone, wrap=False)
    stats = {
        'building': job['building'],
        'atlas': [W, H],
        'normal': [nw, nh],
        'maskCoverage': round(float((soft * covered).sum() / max(1, covered.sum())), 4),
        'texelsPerUnit': dens,
        'texelsPerWorldYd': round(dens / job['standScale'], 2),
        'oldStoneChordYd': {'rows': [round(v * to_yd, 2) for v in ow[0]],
                            'cols': [round(v * to_yd, 2) for v in ow[1]]},
        'newStoneChordYd': {'rows': [round(v * to_yd, 2) for v in nwid[0]],
                            'cols': [round(v * to_yd, 2) for v in nwid[1]]},
        'tileStoneYd': {'width': tile['stoneWidthYd'], 'height': tile['stoneHeightYd']},
        'files': files,
    }
    json.dump(stats, open(os.path.join(out, 'stats.json'), 'w'), indent=1)
    prev = O8.copy()
    prev[..., 0] = np.clip(prev[..., 0] * (1 - 0.55 * soft) + 0.55 * soft, 0, 1)
    prev[..., 1:] *= (1 - 0.45 * soft[..., None])
    save(os.path.join(wd, 'review_mask.png'), prev)
    print(json.dumps({k: v for k, v in stats.items() if k != 'files'}), flush=True)
