# Painted Tidehold walls re-bake: the Blender half of rebake_walls.mjs (read
# that header for the whole recipe, the inputs and the exact command).
#
# Three stages, each its own short headless Blender process so a bake's
# buffers are gone before the next allocates its own:
#
#   tile       numpy only, once per run: the seam-healed tile, its joints, its
#              BUILT height (joints the floor, stones rising off them by a
#              distance transform), the light painted into its colour from
#              that height, a Kuwahara pass into brushwork, and the shared
#              runtime detail normal from the same height.
#   bake       import the Blender-ready copy of one building (it carries the
#              walls' TEXCOORD_1, written by rebake_walls.mjs) and bake the
#              painted tile THROUGH that UV set into the walls material's own
#              atlas UVs (Cycles, CPU, Emit): coverage, colour and the tile's
#              aux maps, with a wide margin. Writes float EXRs.
#   composite  numpy only (composite_walls.py): the stone mask from the
#              ORIGINAL atlas, the new colour with the mask in its alpha, the
#              walls normal flat inside the mask, their half and quarter
#              tiers, and a stats JSON.
#
#   blender -b --factory-startup --python bake_walls.py -- <stage> <job.json>
#
# The job JSON is written by rebake_walls.mjs. Every step is deterministic:
# no randomness anywhere (the per-plane tile offset is a hash of the plane).
import json
import math
import os
import sys

import bpy
import numpy as np

# ------------------------------------------------------------------ image io

def load(path):
    """An image file as float32 [H, W, 4], TOP row first, values as stored
    (no colour transform: every map here is handled as data)."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()


def save(path, arr, fmt='PNG'):
    """Write [H, W, C] (top row first). PNG is 8-bit, OPEN_EXR is float."""
    arr = np.asarray(arr, np.float32)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    h, w, c = arr.shape
    rgba = np.ones((h, w, 4), np.float32)
    if c == 1:
        rgba[:, :, :3] = arr
    else:
        rgba[:, :, :min(c, 4)] = arr[:, :, :4]
    img = bpy.data.images.new('io', w, h, alpha=(c == 4), float_buffer=(fmt == 'OPEN_EXR'))
    img.colorspace_settings.name = 'Non-Color'
    px = rgba[::-1]
    if fmt == 'PNG':
        # round to the byte grid here so the write is exact
        px = np.round(np.clip(px, 0, 1) * 255) / 255
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    img.save()
    bpy.data.images.remove(img)


# ------------------------------------------------------------ numpy helpers

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def blur_wrap(a, sigma):
    """Gaussian blur with wrap-around (FFT), for the seamless tile."""
    M, N = a.shape[:2]
    fy = np.fft.fftfreq(M)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    G = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * G)).astype(np.float32)
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * G))
                     for c in range(a.shape[2])], -1).astype(np.float32)


def box1d(a, r, axis):
    """Box mean of radius r along axis, edges clamped (no wrap): the atlas."""
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode='edge')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur_atlas(a, sigma):
    """Near-Gaussian blur (three box passes) with clamped edges."""
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2 - 0.5)))
    for _ in range(3):
        a = box1d(box1d(a, r, 0), r, 1)
    return a


def shift(m, dy, dx, wrap, fill=False):
    if wrap:
        return np.roll(np.roll(m, dy, 0), dx, 1)
    out = np.full_like(m, fill)
    H, W = m.shape
    ys = slice(max(dy, 0), H + min(dy, 0)); yd = slice(max(-dy, 0), H + min(-dy, 0))
    xs = slice(max(dx, 0), W + min(dx, 0)); xd = slice(max(-dx, 0), W + min(-dx, 0))
    out[ys, xs] = m[yd, xd]
    return out


N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def dilate(m, it=1, wrap=False):
    for i in range(it):
        n = m.copy()
        for dy, dx in (N8 if i % 2 else N4):
            n |= shift(m, dy, dx, wrap)
        m = n
    return m


def erode(m, it=1, wrap=False):
    return ~dilate(~m, it, wrap)


def erode_step(m, diag, wrap):
    n = m.copy()
    for dy, dx in (N8 if diag else N4):
        n &= shift(m, dy, dx, wrap, fill=True)
    return n


def distance_in(mask, maxd, wrap):
    """Approximate Euclidean distance (px) from each mask pixel to the
    nearest pixel outside it: alternating 4- and 8-neighbourhood erosions
    (the octagonal metric, within a few percent of Euclidean)."""
    d = np.zeros(mask.shape, np.float32)
    cur = mask.copy()
    for i in range(maxd):
        d += cur
        cur = erode_step(cur, i % 2 == 1, wrap)
        if not cur.any():
            break
    return d


def periodic_component(u):
    """Moisan's periodic plus smooth decomposition: the periodic part repeats
    with no seam and no cross (per channel)."""
    M, N = u.shape[:2]
    v = np.zeros_like(u)
    v[0] += u[-1] - u[0]
    v[-1] += u[0] - u[-1]
    v[:, 0] += u[:, -1] - u[:, 0]
    v[:, -1] += u[:, 0] - u[:, -1]
    q = np.arange(M)[:, None]
    r = np.arange(N)[None, :]
    den = 2 * np.cos(2 * np.pi * q / M) + 2 * np.cos(2 * np.pi * r / N) - 4
    den[0, 0] = 1
    out = np.empty_like(u)
    for c in range(u.shape[2]):
        S = np.fft.fft2(v[..., c]) / den
        S[0, 0] = 0
        out[..., c] = u[..., c] - np.real(np.fft.ifft2(S))
    return out


def min_cut_path(err):
    """Lowest-cost top-to-bottom path through err [H, O] (one column per row,
    each step moving at most one column): dynamic programming."""
    H, O = err.shape
    cost = err[0].copy()
    back = np.zeros((H, O), np.int8)
    for y in range(1, H):
        left = np.r_[np.inf, cost[:-1]]
        right = np.r_[cost[1:], np.inf]
        stack = np.stack([left, cost, right])
        k = stack.argmin(0)
        back[y] = k - 1
        cost = err[y] + stack[k, np.arange(O)]
    path = np.zeros(H, np.int64)
    path[-1] = int(cost.argmin())
    for y in range(H - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    return path


def quilt_tileable_x(t, ov, feather):
    """Make `t` wrap left to right with a seam that follows its own content:
    the tile is cropped by `ov` columns and its first `ov` columns become the
    original's last `ov` (which continue the previous repeat) up to a cut,
    then its own first `ov` (which continue into the rest). The cut is the
    path where the two strips differ least, so it runs through the joints."""
    H, W, C = t.shape
    R = t[:, W - ov:]
    L = t[:, :ov]
    err = ((blur_atlas(R, 1.5) - blur_atlas(L, 1.5)) ** 2).sum(-1)
    path = min_cut_path(err)
    xs = np.arange(ov)[None, :]
    w = np.clip((xs - path[:, None]) / max(feather, 1e-6) + 0.5, 0, 1)[..., None]
    out = t[:, :W - ov].copy()
    out[:, :ov] = R * (1 - w) + L * w
    return out


def quilt_tileable(t, ov, feather=3.0):
    """Tileable both ways by two content-following cuts (columns, then rows)."""
    t = quilt_tileable_x(t, ov, feather)
    t = quilt_tileable_x(t.transpose(1, 0, 2), ov, feather).transpose(1, 0, 2)
    return np.ascontiguousarray(t)


def delight_wrap(t, sigma_cycles, strength=1.0):
    """Flatten each channel's lowest frequencies multiplicatively (in log
    space, keeping the channel mean): no brightness or colour drift across the
    square for the repeat to show as (painted_ground_core.mjs delight)."""
    H, W = t.shape[:2]
    fy = np.fft.fftfreq(H)[:, None] * H
    fx = np.fft.fftfreq(W)[None, :] * W
    G = np.exp(-(fx ** 2 + fy ** 2) / (2 * sigma_cycles ** 2))
    out = np.empty_like(t)
    for c in range(t.shape[2]):
        lg = np.log(np.maximum(t[..., c], 0) + 1e-4)
        low = np.real(np.fft.ifft2(np.fft.fft2(lg) * G))
        out[..., c] = np.maximum(0, (t[..., c] + 1e-4) * np.exp((lg.mean() - low) * strength) - 1e-4)
    return out


def wrap_seam_ratio(t):
    """Mean step across the wrap over the mean step inside, per axis (1 is a
    seam no stronger than the painting's own texture)."""
    L = t @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    inner = (np.abs(np.diff(L, axis=1)).mean() + np.abs(np.diff(L, axis=0)).mean()) / 2
    return (float(np.abs(L[:, -1] - L[:, 0]).mean() / inner), float(np.abs(L[-1] - L[0]).mean() / inner))


def kuwahara_wrap(img, r):
    """Kuwahara filter with wrap-around: each pixel takes the mean colour of
    whichever of its four (r+1) x (r+1) quadrant windows varies least in
    luminance. Edges stay crisp, flat areas settle into brush-like patches."""
    H, W, C = img.shape
    lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    chans = [img[..., c] for c in range(C)] + [lum, lum * lum]
    k = (r + 1) * (r + 1)

    def window_sums(a):
        p = np.pad(a.astype(np.float64), r, mode='wrap')
        I = np.zeros((p.shape[0] + 1, p.shape[1] + 1))
        I[1:, 1:] = p.cumsum(0).cumsum(1)
        A = I[r + 1:, r + 1:] - I[:-r - 1, r + 1:] - I[r + 1:, :-r - 1] + I[:-r - 1, :-r - 1]
        return [A[0:H, 0:W], A[0:H, r:r + W], A[r:r + H, 0:W], A[r:r + H, r:r + W]]

    sums = [window_sums(a) for a in chans]
    var = np.stack([sums[C + 1][q] / k - (sums[C][q] / k) ** 2 for q in range(4)])
    best = var.argmin(0)
    out = np.zeros_like(img)
    for c in range(C):
        stack = np.stack([sums[c][q] / k for q in range(4)])
        out[..., c] = np.take_along_axis(stack, best[None], 0)[0]
    return out.astype(np.float32)


def resample_wrap(img, size):
    """Area-ish resample of a seamless tile to size x size: a wrap blur at the
    footprint, then bilinear taps with wrap."""
    H, W = img.shape[:2]
    f = W / size
    a = blur_wrap(img, max(0.0, 0.5 * f)) if f > 1 else img
    ys = (np.arange(size) + 0.5) * H / size - 0.5
    xs = (np.arange(size) + 0.5) * W / size - 0.5
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None, None]
    fx = (xs - x0)[None, :, None]
    y0m, y1m = y0 % H, (y0 + 1) % H
    x0m, x1m = x0 % W, (x0 + 1) % W
    a = a if a.ndim == 3 else a[..., None]
    top = a[y0m][:, x0m] * (1 - fx) + a[y0m][:, x1m] * fx
    bot = a[y1m][:, x0m] * (1 - fx) + a[y1m][:, x1m] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def chord_widths(stone, wrap):
    """Pixel-weighted run lengths of `stone` along rows and columns: the
    width and height of the stone a random stone pixel belongs to. Returns
    [[w25, w50, w75], [h25, h50, h75]] in pixels."""
    out = []
    for m in (stone, stone.T):
        lens = []
        for row in m:
            r = np.concatenate([row, row]) if wrap else row
            d = np.diff(np.r_[0, r.astype(np.int8), 0])
            st = np.flatnonzero(d == 1)
            en = np.flatnonzero(d == -1)
            for a, b in zip(st, en):
                if wrap and (a >= len(row) or b - a >= len(row)):
                    continue
                lens.append(b - a)
        lens = np.sort(np.array(lens, np.float64))
        if lens.size == 0:
            out.append([0.0, 0.0, 0.0])
            continue
        c = np.cumsum(lens) / lens.sum()
        out.append([float(lens[np.searchsorted(c, p)]) for p in (0.25, 0.5, 0.75)])
    return out


# ----------------------------------------------------------------- the tile

TILE_VERSION = 4

def prep_tile(job):
    """Seam-healed tile colour, its joint mask, height, GL normal and joint
    occlusion, cached in the work dir (the same source gives the same maps)."""
    tdir = job['tileDir']
    os.makedirs(tdir, exist_ok=True)
    stamp = os.path.join(tdir, 'stamp.json')
    want = {'src': job['tile'], 'mtime': os.path.getmtime(job['tile']), 'relief': job['relief'],
            'tileRecipe': job['tileRecipe'], 'version': TILE_VERSION}
    if os.path.exists(stamp) and json.load(open(stamp)) == want:
        return json.load(open(os.path.join(tdir, 'stats.json')))
    rec_cfg = job['tileRecipe']
    t = load(job['tile'])[:, :, :3]
    seam_before = wrap_seam_ratio(t)
    # tileable for real: the repeat's seam follows the joints (a content cut),
    # any colour step left is spread out (Moisan), and the low-frequency
    # drift is divided out so the repeat never shows as a brightness pattern
    if rec_cfg.get('quiltPx'):
        t = quilt_tileable(t, rec_cfg['quiltPx'])
    t = np.clip(periodic_component(t), 0, 1)
    if rec_cfg.get('delightCycles'):
        t = np.clip(linear_to_srgb(delight_wrap(srgb_to_linear(t), rec_cfg['delightCycles'])), 0, 1)
    seam_after = wrap_seam_ratio(t)
    H, W, _ = t.shape
    r, g, b = t[..., 0], t[..., 1], t[..., 2]
    V = t.max(2)
    S = (V - t.min(2)) / np.maximum(V, 1e-4)
    L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if rec_cfg['jointTone'] == 'light':
        # joints: cream lime mortar and the moss in it
        raw = ((L > 0.58) & (r > b + 0.04) & (S < 0.5)) | ((g > r - 0.01) & (g > b + 0.05) & (S > 0.18))
    else:
        # joints: dark painted mortar, darker than the tile's own low end and
        # than its neighbourhood (a stone's cool lower shadow is neither)
        thr = float(np.percentile(L, rec_cfg['jointPercentile']))
        warm = (r > b + rec_cfg['jointWarmth']) | ((g > b + 0.04) & (S > 0.2))   # umber or moss
        raw = (L < thr) & warm & (L < blur_wrap(L, rec_cfg['jointLocalPx']) - rec_cfg['jointLocalDrop'])
    # a plain threshold also catches specks inside stones, so smooth it, keep
    # only parts thick enough to be joint, and grow those back within the
    # threshold (geodesic reconstruction): an isolated speck never connects
    sm = blur_wrap(raw.astype(np.float32), 1.6) > 0.5
    rec = erode(sm, rec_cfg['jointMarkerPx'], wrap=True)
    for _ in range(400):
        nxt = dilate(rec, 1, wrap=True) & sm
        if (nxt == rec).all():
            break
        rec = nxt
    joint = erode(dilate(rec, 1, wrap=True), 1, wrap=True)
    stone = dilate(erode(~joint, 2, wrap=True), 2, wrap=True)
    joint = ~stone
    # the tile's world size: its typical stone lands at the target width
    cw = chord_widths(stone, wrap=True)
    tile_yd = rec_cfg['stoneTargetYd'] * W / max(cw[0][1], 1.0)
    rel = job['relief']
    px_yd = tile_yd / W
    d = distance_in(stone, 120, wrap=True)
    # the height, in world yards: a rounded arris (the bevel) and a gentle
    # dome rising off the joint, a little of the painting's own brushwork on
    # the faces, and a faint grain in the lime. The joints are the floor.
    x = np.clip(d / rel['bevelPx'], 0, 1)
    h = rel['bevelYd'] * (1 - (1 - x) ** 2)
    h += rel['domeYd'] * (1 - np.exp(-d / rel['domePx']))
    hp = L - blur_wrap(L, 5.0)
    h += rel['brushYd'] * np.clip(hp / 0.15, -1, 1) * stone
    h += rel['grainYd'] * np.clip((L - blur_wrap(L, 2.0)) / 0.08, -1, 1) * joint
    h = blur_wrap(h, 1.2)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px_yd)
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px_yd)
    # GL convention, image x right and y up: rows run down, so +dh/drow
    n = np.stack([-gx, gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # joint occlusion: how far a pixel sits below its neighbourhood
    cav = np.clip((blur_wrap(h, rel['aoPx']) - h) / rel['aoDepthYd'], 0, 1)
    ao = 1 - rel['aoStrength'] * cav ** 0.8
    hn = (h - h.min()) / max(1e-6, float(h.max() - h.min()))
    # the painted treatment: the stone's light painted INTO the colour (a
    # warm soft highlight on each stone's upper edge, a cool shadow on its
    # lower edge, the joints darker and occluded), then the whole simplified
    # into brushwork by a Kuwahara filter, so it reads as paint at the
    # atlas's resolution rather than as photographic grain
    paint = rec_cfg.get('paint')
    if paint:
        # simplify first, so the painted light lands on clean brush patches
        if paint['kuwaharaPx'] > 0:
            t = np.clip(kuwahara_wrap(t, paint['kuwaharaPx']), 0, 1)
        lin = srgb_to_linear(t)
        ldir = np.array(paint['lightDir'], np.float32)
        ldir /= np.linalg.norm(ldir)
        shade = n @ ldir - ldir[2]              # 0 on a flat face
        hl = np.clip(shade / paint['shadeRange'], 0, 1)[..., None]
        sh = np.clip(-shade / paint['shadeRange'], 0, 1)[..., None]
        lin = lin * (1 + paint['highlight'] * hl * np.array(paint['warm'], np.float32))
        lin = lin * (1 - paint['shadow'] * sh * np.array(paint['cool'], np.float32))
        jsoft = blur_wrap(joint.astype(np.float32), 1.5)[..., None]
        lin = lin * (1 - paint['mortarDarken'] * jsoft) * ao[..., None]
        t = np.clip(linear_to_srgb(lin), 0, 1)
        ao = np.ones_like(ao)                   # painted in: the bake must not apply it twice
    # the shared runtime detail normal: the same relief at its own size
    dsize = rec_cfg.get('detailSize')
    if dsize:
        dn = resample_wrap(n, dsize)
        dn /= np.linalg.norm(dn, axis=-1, keepdims=True)
        save(os.path.join(tdir, 'detail_normal.png'), dn * 0.5 + 0.5)
    save(os.path.join(tdir, 'color.png'), t)
    # the tiling check: the painted tile three by three, for review at 1:1
    save(os.path.join(tdir, 'tile3x3.png'), np.tile(t, (3, 3, 1)))
    save(os.path.join(tdir, 'normal.png'), n * 0.5 + 0.5)
    save(os.path.join(tdir, 'aux.png'), np.stack([ao, joint.astype(np.float32), hn], -1))
    slope = np.hypot(gx, gy)
    stats = {
        'seamRatioBefore': [round(v, 3) for v in seam_before],
        'seamRatioAfter': [round(v, 3) for v in seam_after],
        'tileYd': round(float(tile_yd), 4),
        'size': [W, H],
        'jointFraction': round(float(joint.mean()), 4),
        'stoneMean': [round(float(v), 4) for v in t[stone].mean(0)],
        'stoneMeanLinear': [round(float(v), 5) for v in srgb_to_linear(t[stone]).mean(0)],
        'tileMean': [round(float(v), 4) for v in t.reshape(-1, 3).mean(0)],
        'stoneChordPx': cw,
        'stoneWidthYd': [round(v * px_yd, 3) for v in cw[0]],
        'stoneHeightYd': [round(v * tile_yd / H, 3) for v in cw[1]],
        'slopeP50P90': [round(float(np.percentile(slope, p)), 3) for p in (50, 90)],
        'aoMean': round(float(ao.mean()), 4),
        'aoStoneMean': round(float(ao[stone].mean()), 4),
    }
    json.dump(stats, open(os.path.join(tdir, 'stats.json'), 'w'), indent=1)
    json.dump(want, open(stamp, 'w'))
    return stats


# ------------------------------------------------------------------ baking

def new_float_image(name, w, h):
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 0)
    return img


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        setattr(n, k, v)
    return n


def link(nt, a, b):
    nt.links.new(a, b)


def build_bake_material(tile_imgs, target, uv1_name):
    """The walls' bake material: the painted tile sampled through the
    building's own TEXCOORD_1 (rebake_walls.mjs computes it per vertex, in
    tile units, the same coordinates the runtime detail normal reads), so the
    paint and the relief line up exactly and the pattern is continuous
    wherever two faces share a vertex. `mode` picks what the Emission carries."""
    mat = bpy.data.materials.new('wallbake')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = node(nt, 'ShaderNodeOutputMaterial')
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = uv1_name

    def tex(img):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.interpolation = 'Linear'
        n.extension = 'REPEAT'
        link(nt, uv.outputs['UV'], n.inputs['Vector'])
        return n

    col = tex(tile_imgs['color'])
    aux = tex(tile_imgs['aux'])
    emit = node(nt, 'ShaderNodeEmission')
    link(nt, emit.outputs['Emission'], out.inputs['Surface'])
    tgt = nt.nodes.new('ShaderNodeTexImage')
    tgt.image = target
    nt.nodes.active = tgt
    return mat, {'emit': emit, 'col': col, 'aux': aux, 'tgt': tgt}


def set_mode(mat, parts, mode):
    nt = mat.node_tree
    e = parts['emit']
    for l in list(e.inputs['Color'].links):
        nt.links.remove(l)
    if mode == 'cover':
        e.inputs['Color'].default_value = (1, 1, 1, 1)
    elif mode == 'color':
        link(nt, parts['col'].outputs['Color'], e.inputs['Color'])
    elif mode == 'aux':
        link(nt, parts['aux'].outputs['Color'], e.inputs['Color'])


def walls_texel_density(users, walls_name, W, H):
    """Area-weighted median atlas texels per model unit over the walls faces."""
    import bmesh
    vals = []
    for o in users:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        uv = bm.loops.layers.uv.active
        for f in bm.faces:
            m = o.data.materials[f.material_index]
            if m is None or m.name != walls_name:
                continue
            a3 = f.calc_area()
            l = [lp[uv].uv for lp in f.loops]
            a2 = sum(abs((l[i] - l[0]).cross(l[i + 1] - l[0])) / 2 for i in range(1, len(l) - 1))
            if a3 > 1e-6 and a2 > 0:
                vals.append((math.sqrt(a2 * W * H / a3), a3))
        bm.free()
    vals.sort()
    tot = sum(a for _, a in vals)
    acc = 0.0
    for d, a in vals:
        acc += a
        if acc >= tot / 2:
            return round(d, 2)
    return 0.0


def stage_tile(job):
    """The painted tile, its maps and the shared detail normal, once."""
    stats = prep_tile(job)
    print('TILE ' + json.dumps({k: stats[k] for k in ('tileYd', 'stoneWidthYd', 'stoneHeightYd', 'jointFraction')}), flush=True)


def stage_bake(job):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=job['blenderGlb'])
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.render.bake.margin_type = 'ADJACENT_FACES'
    walls_name = f"painted_walls@{job['building']}"
    users = [o for o in scene.objects if o.type == 'MESH' and walls_name in [m.name for m in o.data.materials if m]]
    if not users:
        raise SystemExit(f'no mesh uses {walls_name}')
    W, H = job['atlasSize']
    density = walls_texel_density(users, walls_name, W, H)
    target = new_float_image('target', W, H)
    dummy = new_float_image('dummy', 8, 8)
    tdir = job['tileDir']
    tile_imgs = {}
    for k in ('color', 'aux'):
        img = bpy.data.images.load(os.path.join(tdir, f'{k}.png'))
        img.colorspace_settings.name = 'Non-Color'
        tile_imgs[k] = img
    uv1 = None
    for o in users:
        if len(o.data.uv_layers) < 2:
            raise SystemExit(f'{o.name} carries no TEXCOORD_1')
        uv1 = o.data.uv_layers[1].name
    mat, parts = build_bake_material(tile_imgs, target, uv1)
    skip = bpy.data.materials.new('skip')
    skip.use_nodes = True
    sn = skip.node_tree.nodes.new('ShaderNodeTexImage')
    sn.image = dummy
    skip.node_tree.nodes.active = sn
    for o in users:
        for i, m in enumerate(o.data.materials):
            o.data.materials[i] = mat if (m and m.name == walls_name) else skip
    bpy.ops.object.select_all(action='DESELECT')
    for o in users:
        o.select_set(True)
    bpy.context.view_layer.objects.active = users[0]
    passes = [('cover', 4, 0), ('color', job['samples'], job['margin']), ('aux', job['samples'], job['margin'])]
    for name, samples, margin in passes:
        set_mode(mat, parts, name)
        scene.cycles.samples = samples
        scene.render.bake.margin = margin
        bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True)
        a = np.empty(W * H * 4, np.float32)
        target.pixels.foreach_get(a)
        save(os.path.join(job['work'], f'bake_{name}.exr'), a.reshape(H, W, 4)[::-1], fmt='OPEN_EXR')
        print(f'baked {name} {W}x{H} samples {samples}', flush=True)
    tile = json.load(open(os.path.join(tdir, 'stats.json')))
    json.dump({'tile': tile, 'walls_objects': [o.name for o in users], 'texelsPerUnit': density},
              open(os.path.join(job['work'], 'bake.json'), 'w'), indent=1)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    stage, job_path = argv[0], argv[1]
    job = json.load(open(job_path))
    if stage == 'tile':
        stage_tile(job)
    elif stage == 'bake':
        stage_bake(job)
    elif stage == 'composite':
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import composite_walls  # stage 2 lives beside this file
        composite_walls.run(job)
    else:
        raise SystemExit(f'unknown stage {stage}')
