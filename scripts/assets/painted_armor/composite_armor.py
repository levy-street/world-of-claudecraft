# The composite stage of the painted WOC armour (bake_armor.py runs it): numpy only, no scene.
# Reads the bake stage's EXRs and the set's ORIGINAL top-level atlases, writes the painted colour
# atlas at the top file's size, the low file's atlas when the low layout is the full one, a
# stats JSON and review previews of every measure.
#
# The paint, in order (every knob is PAINT in paint_armor.mjs):
#   1. bolder colour blocks: a self-guided filter flattens the photographic grain inside a
#      plate or a cloth panel and keeps every stronger edge, and a Kuwahara pass mixed over
#      it settles flat areas into brush patches; vibrance and saturation (a little more on
#      cloth and leather, and on saturated metal so gold trim stays rich); grey metal moved
#      toward a cool painted steel of its own value; the value's own detail crisped and its
#      fold- and panel-scale structure pushed apart;
#   2. the painted key: a three-stop ramp over the key facing (the normal-mapped normal's
#      share is keyNormalMap), a warm cream light on top, a neutral terminator and a cool
#      blue-violet shade below, never black; the stops are painter's multipliers on the
#      gamma-encoded colour, and the lit side also screens a warm light over dark colours;
#   3. tinted occlusion: the crease reach, the body reach and the file's own ORM occlusion
#      multiplied, darkening toward a deep cool tint; dark painted seams (the normal map's
#      grooves on a set whose map carries relief, the dark side of the colour's own relief);
#   4. painted edges: convex geometry (the Bevel-node measure where the crease reach is
#      open), the normal map's ridges (the divergence of its tangent-space tilt, read inside
#      the islands only) and the bright side of the colour's own relief (rivets, trim rims),
#      widened into a band and brighter where it faces the key; on metal they lift far and
#      go on toward a warm cream to pale gold (gold trim stays gold, paler), on leather and
#      cloth they lift softer in their own hue;
#   5. a polished highlight on metal facing the key, and the brush tile at low strength as a
#      multiplicative stroke texture;
#   6. when the set has a ChatGPT repaint (src/repaint/<set>.png, repaint_armor.py: registered
#      onto this layout), its brushwork over the islands, faded to the bake toward every island
#      border and wherever the model redrew a shape;
#   7. one steel: metal sheds the colour of the painted shade
#      and of the tinted occlusion (keeping their value), and every steel plate's albedo moves
#      toward the set's median plate, so no plate reads as a different metal;
#   8. a softer shade where the set asks for one (the cloth sets): the finished paint relit as
#      if the shade stop sat shadeLift of the way to the terminator and the occlusion had lost
#      aoLift of its dark, so the bake and the repaint over it lighten together;
#   9. the shadow toe: the paint may deepen a shadow but never crush it to black. Where the
#      shade, the occlusion and the repaint together take a texel under twice a floor (a share
#      of the cleaned original's own light), its value eases onto the floor instead, keeping its
#      gradation and its hue, so a bronze pauldron's underside or a cloth fold reads as its own
#      colour in shadow; a colour that was dark to begin with (black leather) keeps its dark;
#  10. one plate, both sides: where a piece is a thin plate of two faces a few millimetres
#      apart (bake_twin.exr, the bake stage's `twin`), the hidden or the far more occluded side
#      takes the paint of the other, so when skinning pushes the inner face of a flap through
#      its outer face it shows the same colour, and a pauldron's inside reads as the plate in
#      shade (the runtime's light shades it) instead of a near-black crease;
#  11. a set whose palette has no blue (the paladin's white steel and gold) loses every blue
#      the repaint and the cool shade gave it: a blue texel goes to a light grey of its own
#      value, so the plates read white into a soft grey shade.
# Light terms are filled outward past the bake margin by a push-pull pyramid (the edge term
# from the islands alone: the bevel measure reads high in the margin copies), so a gutter
# carries the light of the island beside it and no mip pulls an unlit seam in.
import json
import math
import os

import numpy as np

from bake_armor import load, save
from repaint_armor import blend_repaint, repaint_path

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def srgb_to_linear(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def box1d(a, r, axis):
    """Box mean of radius r along an axis, edges clamped."""
    if r <= 0:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode='edge')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, sigma):
    """Near-Gaussian blur (three box passes), edges clamped."""
    if sigma <= 0:
        return a
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2 - 0.5)))
    for _ in range(3):
        a = box1d(box1d(a, r, 0), r, 1)
    return a


def masked_blur(a, w, sigma):
    """Blur `a` over the texels where `w` (0..1) is set, normalised by the blurred weight."""
    if sigma <= 0:
        return a
    ww = w if a.ndim == 2 else w[..., None]
    num = blur(a * ww, sigma)
    den = blur(w.astype(np.float32), sigma)
    den = den if a.ndim == 2 else den[..., None]
    return np.where(den > 1e-4, num / np.maximum(den, 1e-4), a).astype(np.float32)


def kuwahara(img, r):
    """Kuwahara filter (edges clamped): each texel takes the mean colour of whichever of its
    four (r+1) x (r+1) quadrant windows varies least in luminance."""
    if r <= 0:
        return img
    H, W, C = img.shape
    lum = img @ LUMA
    chans = [img[..., c] for c in range(C)] + [lum, lum * lum]
    k = (r + 1) * (r + 1)

    def window_sums(a):
        p = np.pad(a.astype(np.float64), r, mode='edge')
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


def guided(img, r, eps):
    """Self-guided filter (He, Sun and Tang), per channel, edges clamped: a window whose
    variance is under eps is flattened toward its mean, a window across a stronger edge keeps
    the edge. Removes grain, keeps the painted shapes."""
    if r <= 0:
        return img
    box = lambda a: box1d(box1d(a, r, 0), r, 1)
    out = np.empty_like(img)
    for c in range(img.shape[2]):
        p = img[..., c].astype(np.float32)
        m = box(p)
        v = box(p * p) - m * m
        a = v / (v + eps)
        b = m - a * m
        out[..., c] = box(a) * p + box(b)
    return out


def up2(a):
    """Bilinear 2x upsample by texel centres, edges clamped."""
    H, W = a.shape[:2]
    a3 = a if a.ndim == 3 else a[..., None]
    ys = (np.arange(2 * H) + 0.5) / 2 - 0.5
    xs = (np.arange(2 * W) + 0.5) / 2 - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 1)
    y1 = np.clip(y0 + 1, 0, H - 1)
    x1 = np.clip(x0 + 1, 0, W - 1)
    fy = np.clip(ys - np.floor(ys), 0, 1)[:, None, None]
    fx = np.clip(xs - np.floor(xs), 0, 1)[None, :, None]
    top = a3[y0][:, x0] * (1 - fx) + a3[y0][:, x1] * fx
    bot = a3[y1][:, x0] * (1 - fx) + a3[y1][:, x1] * fx
    out = (top * (1 - fy) + bot * fy).astype(np.float32)
    return out if a.ndim == 3 else out[..., 0]


def box_down(a, f):
    """Mean over f x f blocks (exact integer factor)."""
    H, W = a.shape[:2]
    a3 = a if a.ndim == 3 else a[:, :, None]
    out = a3.reshape(H // f, f, W // f, f, a3.shape[2]).mean((1, 3)).astype(np.float32)
    return out if a.ndim == 3 else out[..., 0]


def push_pull(a, w):
    """Fill the texels where w is 0 from the weighted texels around them: a pyramid of 2 x 2
    weighted means down, then each level's gaps filled from the level below on the way up.
    Texels with w = 1 come back exactly."""
    a3 = a if a.ndim == 3 else a[..., None]
    levels = [(a3 * w[..., None], w.astype(np.float32))]
    while min(levels[-1][1].shape) > 1 and levels[-1][1].shape[0] % 2 == 0 and levels[-1][1].shape[1] % 2 == 0:
        s, ww = levels[-1]
        levels.append((box_down(s, 2) * 4, box_down(ww, 2) * 4))
    filled = None
    for s, ww in reversed(levels):
        mean = s / np.maximum(ww, 1e-6)[..., None]
        if filled is not None:
            coarse = np.repeat(np.repeat(filled, 2, 0), 2, 1)
            k = np.clip(ww, 0, 1)[..., None]
            mean = mean * k + coarse * (1 - k)
        filled = mean
    out = filled.astype(np.float32)
    keep = w[..., None] >= 1
    out = np.where(keep, a3, out)
    return out if a.ndim == 3 else out[..., 0]


def dilate(m, it):
    for _ in range(it):
        n = m.copy()
        n[1:] |= m[:-1]
        n[:-1] |= m[1:]
        n[:, 1:] |= m[:, :-1]
        n[:, :-1] |= m[:, 1:]
        m = n
    return m


def widen(a, px):
    """A grey max filter over a (2 px + 1) square, then softened: a painted edge band px
    texels wider on each side."""
    out = a
    for _ in range(px):
        n = out.copy()
        n[1:] = np.maximum(n[1:], out[:-1])
        n[:-1] = np.maximum(n[:-1], out[1:])
        n[:, 1:] = np.maximum(n[:, 1:], out[:, :-1])
        n[:, :-1] = np.maximum(n[:, :-1], out[:, 1:])
        out = n
    return blur(out, 0.7) if px > 0 else out


def ridges(normal_png):
    """Convexity of the normal map's relief, per texel of the normal atlas: the divergence of
    its tangent-space tilt (positive on a ridge, a rivet or a raised rim; negative in a
    groove). Image x runs right (+u) and rows run down (-v in the map's +Y-up convention)."""
    n = load(normal_png)[..., :3] * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    nx = blur(n[..., 0], 0.7)
    ny = blur(n[..., 1], 0.7)
    dx = np.zeros_like(nx)
    dy = np.zeros_like(ny)
    dx[:, 1:-1] = (nx[:, 2:] - nx[:, :-2]) / 2
    dy[1:-1] = (ny[2:] - ny[:-2]) / 2
    return (dx - dy).astype(np.float32)


def relief_share(normal_png, island, tilt):
    """How much relief a set's normal map carries: the share of its island texels whose
    tangent-space tilt is over `tilt` (a flat map, the paladin's and the mage's, is near 0)."""
    n = load(normal_png)[..., :3] * 2 - 1
    xy = np.hypot(n[..., 0], n[..., 1])
    isl = box_down(island.astype(np.float32), island.shape[0] // n.shape[0]) > 0.5
    return float((xy[isl] > tilt).mean()) if isl.any() else 0.0


def components(mask):
    """4-connected components of a boolean mask: every texel's label is the smallest flat
    index in its component, -1 off the mask (neighbour minimum plus pointer jumping)."""
    h, w = mask.shape
    big = h * w
    lab = np.where(mask, np.arange(big).reshape(h, w), big)
    while True:
        m = lab.copy()
        m[1:] = np.minimum(m[1:], np.where(mask[:-1], lab[:-1], big))
        m[:-1] = np.minimum(m[:-1], np.where(mask[1:], lab[1:], big))
        m[:, 1:] = np.minimum(m[:, 1:], np.where(mask[:, :-1], lab[:, :-1], big))
        m[:, :-1] = np.minimum(m[:, :-1], np.where(mask[:, 1:], lab[:, 1:], big))
        m = np.where(mask, m, big)
        f = m.reshape(-1)
        on = f < big
        f[on] = f[f[on]]
        f[on] = f[f[on]]
        if np.array_equal(m, lab):
            return np.where(mask, lab, -1)
        lab = m


def unify_steel(rgb, O8, metal, island, mul, ao, strength, lit_share, min_area=400):
    """One steel across a set: each steel plate (a 4-connected run of metal that is not gold or
    bronze, by the original colour) has its albedo, its mean colour over the mean light the
    paint gave it, moved toward the median plate's by `strength`, as one factor per plate
    (softened across a plate's border, carried into the gutters). Each plate keeps its own
    painted light and detail, except that an open plate (not an occluded inside: a helm's
    lining stays dark) also moves `lit_share` of the way toward the median plate's painted
    value, so a plate facing away from the key (the back plate, which the camera sees most)
    is not a darker metal. Plates under min_area texels (rivets, buckles) are left alone."""
    mx = O8.max(-1)
    sat = (mx - O8.min(-1)) / np.maximum(mx, 1e-4)
    gold = smoothstep(0.02, 0.08, O8[..., 0] - O8[..., 2]) * smoothstep(0.22, 0.34, sat)
    w = np.clip(metal, 0, 1) * (1 - gold) * island
    steel = w > 0.5
    lab = components(steel)
    on = lab >= 0
    if not on.any():
        return rgb
    C = srgb_to_linear(rgb)
    _, inv, cnt = np.unique(lab[on], return_inverse=True, return_counts=True)
    light = np.maximum(mul[on] @ LUMA, 1e-3)
    col = C[on]
    albedo = np.stack([np.bincount(inv, col[:, c]) for c in range(3)], -1) / (
        np.bincount(inv, light)[:, None])
    plates = cnt >= min_area
    if plates.sum() < 2:
        return rgb
    target = np.median(albedo[plates], axis=0)
    f = np.clip(target / np.maximum(albedo, 1e-4), 0.5, 2.0) ** strength
    lit = (np.stack([np.bincount(inv, col[:, c]) for c in range(3)], -1) / cnt[:, None] * f) @ LUMA
    open_share = smoothstep(0.55, 0.8, np.bincount(inv, ao[on]) / cnt)
    v = np.clip(np.median(lit[plates]) / np.maximum(lit, 1e-4), 0.7, 1.5) ** (lit_share * open_share)
    f = f * v[:, None]
    f[~plates] = 1
    F = np.ones_like(C)
    F[on] = f[inv]
    F = masked_blur(F, steel.astype(np.float32), 1.5)
    F = 1 + (F - 1) * w[..., None]
    F = push_pull(np.where(island[..., None], F, 0).astype(np.float32), island.astype(np.float32))
    return np.clip(linear_to_srgb(C * F), 0, 1).astype(np.float32)


def shadow_toe(rgb, base, island, share, black=0.0, blur_px=2.0):
    """Lift the texels the paint took near black: with the floor `share` of the cleaned
    original's own linear luminance (softened over the islands), and never under `black`
    (linear; 0 lets a colour that was black to begin with stay black), a texel of value Y under
    twice the floor takes floor * (1 + t * t / 4), t = Y / floor (the floor at black, itself at
    twice the floor, slope matched), so the darkest shade keeps its gradation. Hue comes from
    the texel, with the original's own colour mixed in as it nears black (a black texel has
    none)."""
    C = srgb_to_linear(rgb)
    B = srgb_to_linear(base)
    floor = np.maximum(share * masked_blur(B @ LUMA, island.astype(np.float32), blur_px), black)
    Y = C @ LUMA
    t = Y / np.maximum(floor, 1e-6)
    toe = (t < 2) & (floor > 1e-5)
    near = np.clip(1 - t / 2, 0, 1) ** 2
    Cm = C + B * (0.05 * near)[..., None]
    Ym = np.maximum(Cm @ LUMA, 1e-6)
    lifted = Cm * (floor * (1 + t * t / 4) / Ym)[..., None]
    return np.clip(linear_to_srgb(np.where(toe[..., None], lifted, C)), 0, 1).astype(np.float32)


def sample(a, x, y):
    """Bilinear lookup of `a` at texel-index coordinates (edges clamped)."""
    h, w = a.shape[:2]
    x = np.clip(x, 0, w - 1.0001)
    y = np.clip(y, 0, h - 1.0001)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx, fy = x - x0, y - y0
    if a.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    top = a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx
    bot = a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def paint_twins(rgb, twin, island, ao, gap_lo, gap_hi, blur_px, ao_weight, spread_px, rigid):
    """Both sides of a thin plate in one paint. bake_twin.exr gives each plate texel its other
    side's texel, the gap, its side's visibility vote and whether the piece is rigid (a rigid
    piece's plates take part only with `rigid`); a texel takes its other side's colour
    when its side is the hidden one or the more occluded one (the vote plus ao_weight times how
    much more open the other side is: the inside of a pauldron, a crease the paint takes near
    black, is more occluded than its outside), all of it under gap_lo of gap, fading out by
    gap_hi. The score flips sign between the two sides, so only one side takes the other's.
    The colour taken is softened over the islands by blur_px (a hidden side only shows where
    skinning pokes it through, and the pose shifts it a little anyway); the share taken is
    spread over the islands by spread_px, so a plate whose search found its other side for only
    part of it fades from taken to its own paint instead of breaking into patches (the texels
    that found nothing take their found neighbours' colour); and the change is carried into the
    gutters, so no mip pulls the old colour back in."""
    on_rigid = twin[..., 3] > 3.5
    ok = (twin[..., 3] > 0.5) & island & (bool(rigid) | ~on_rigid)
    isl = island.astype(np.float32)
    x, y = twin[..., 0] - 0.5, twin[..., 1] - 0.5
    seen = masked_blur(rgb, isl, blur_px) if blur_px > 0 else rgb
    other = push_pull(np.where(ok[..., None], sample(seen, x, y), 0).astype(np.float32), ok.astype(np.float32))
    score = (twin[..., 3] - np.where(on_rigid, 5, 2)) + ao_weight * (sample(ao, x, y) - ao)
    w = smoothstep(0.15, 0.4, score) * smoothstep(gap_hi, gap_lo, twin[..., 2]) * ok
    if spread_px > 0:
        w = masked_blur(w.astype(np.float32), isl, spread_px) * island
    delta = np.where(island[..., None], (other - rgb) * w[..., None], 0).astype(np.float32)
    delta = push_pull(delta, island.astype(np.float32))
    return np.clip(rgb + delta, 0, 1).astype(np.float32), float(w[island].mean())


def neutral_blue(rgb, share, lift, hue_lo=165.0, hue_hi=280.0, soft=25.0):
    """Blue taken out of a set whose palette has none: a texel whose hue lies in the blue band
    (hue_lo to hue_hi degrees, eased `soft` degrees past each end; gold, bronze and leather sit
    far outside it) moves `share` of the way to a grey between its own luminance (lift 0) and
    its brightest channel (lift 1), so a repaint's white-to-blue plate reads as white steel
    into a light grey shade rather than a darker grey. A texel with next to no chroma has no
    hue to lose."""
    mx = rgb.max(-1)
    c = mx - rgb.min(-1)
    cs = np.maximum(c, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = 60 * np.where(mx == r, ((g - b) / cs) % 6, np.where(mx == g, (b - r) / cs + 2, (r - g) / cs + 4))
    band = smoothstep(hue_lo - soft, hue_lo, hue) * (1 - smoothstep(hue_hi, hue_hi + soft, hue))
    w = (band * smoothstep(0.0, 0.03, c) * share)[..., None]
    luma = linear_to_srgb(srgb_to_linear(rgb) @ LUMA)
    grey = (luma + (mx - luma) * lift)[..., None]
    return np.clip(rgb + (grey - rgb) * w, 0, 1).astype(np.float32)


def run(job):
    P = job['paint']
    W, H = job['atlasSize']
    wd = job['work']
    out = job['out']
    os.makedirs(out, exist_ok=True)
    O8 = load(job['colorPng'])[..., :3]
    cover = load(os.path.join(wd, 'bake_cover.exr'))
    frame = load(os.path.join(wd, 'bake_frame.exr'))
    occl = load(os.path.join(wd, 'bake_occl.exr'))
    brush_b = load(os.path.join(wd, 'bake_brush.exr'))
    data = up2(load(job['dataPng'])[..., :3])
    if data.shape[:2] != (H, W) or O8.shape[:2] != (H, W):
        raise SystemExit(f'atlas sizes differ: colour {O8.shape}, data {data.shape}, want {H}x{W}')
    island = cover[..., 3] > 0.5
    valid = frame[..., 3] > 0.5
    validf = valid.astype(np.float32)
    k_geo = frame[..., 0] * 2 - 1
    k_map = frame[..., 1] * 2 - 1
    ao_s = masked_blur(occl[..., 0], validf, P['aoBlurPx'])
    ao_l = masked_blur(occl[..., 1], validf, P['aoBlurPx'])
    bevel = occl[..., 2]
    occ_orm = data[..., 0]
    metal = np.clip(data[..., 2], 0, 1)

    # 1. bolder colour blocks, painted steel, crisp painted detail
    smooth = np.clip(guided(O8, P['guidedPx'], P['guidedEps']), 0, 1)
    kuw = kuwahara(smooth, P['kuwaharaPx'])
    base_s = smooth + (kuw - smooth) * P['kuwaharaMix']
    C = srgb_to_linear(base_s)
    luma = C @ LUMA
    mx = base_s.max(-1)
    sat = (mx - base_s.min(-1)) / np.maximum(mx, 1e-4)
    boost = 1 + P['saturation'] + P['vibrance'] * (1 - np.clip(sat / 0.6, 0, 1))
    # cloth, leather and tabards take a little more; saturated metal (gold, bronze trim)
    # a little more again, so trim stays rich
    boost = boost + P['clothSaturation'] * (1 - metal) + P['goldSaturation'] * metal * smoothstep(0.3, 0.5, sat)
    C = np.maximum(luma[..., None] + (C - luma[..., None]) * boost[..., None], 0)
    steel = metal * (1 - smoothstep(0.2, 0.38, sat))
    C = C + (luma[..., None] * np.array(P['steelTint'], np.float32) - C) * (P['steelCool'] * steel)[..., None]
    # the value's own detail, sharpened in proportion (hue kept): painted edges stay crisp;
    # and its value structure at the scale of a fold or a panel, pushed a little
    L = np.maximum(C @ LUMA, 1e-4)
    Ls = np.maximum(blur(L, P['crispPx']), 1e-4)
    Lw = np.maximum(blur(L, P['structurePx']), 1e-4)
    C = C * np.clip(1 + P['crisp'] * (L - Ls) / Ls + P['structure'] * (Ls - Lw) / Lw, 0.5, 1.8)[..., None]

    # 2. the painted key: shade, terminator and light stops
    k = k_geo + (k_map - k_geo) * P['keyNormalMap']
    # metal sheds a share of the shade's colour and keeps its value (metalShadeNeutral), so a
    # plate facing away from the key darkens without turning another colour
    neutral = (P['metalShadeNeutral'] * metal)[..., None]
    shade = np.array(P['shadeTint'], np.float32)
    shade = shade + (shade @ LUMA - shade) * neutral
    mid = np.array(P['midTint'], np.float32)
    lit = np.array(P['litTint'], np.float32)
    t1 = smoothstep(P['keyShade'], P['keyMid'], k)[..., None]
    t2 = smoothstep(P['keyMid'], P['keyLit'], k)[..., None]
    ramp = shade + (mid - shade) * t1 + (lit - mid) * t2
    # the stops are painter's values (multipliers on the gamma-encoded colour): in linear
    # light a stop is its power 2.2, so a dark cloth takes the key as visibly as a pale plate
    key_mul = np.maximum(1 + (ramp - 1) * P['keyStrength'], 0) ** 2.2
    shade_lift = P.get('shadeLift', 0)
    soft = shade + (mid - shade) * shade_lift
    key_soft = np.maximum(1 + (soft + (mid - soft) * t1 + (lit - mid) * t2 - 1) * P['keyStrength'], 0) ** 2.2

    # 3. tinted occlusion
    ao = np.clip(ao_s, 0, 1) ** P['aoShortPow'] * np.clip(ao_l, 0, 1) ** P['aoLongPow']
    ao = ao * (1 + (np.clip(occ_orm, 0, 1) - 1) * P['ormOcclusion'])
    tint = np.array(P['aoTint'], np.float32)
    tint = tint + (tint @ LUMA - tint) * neutral
    ao_mul = 1 + ((tint + (1 - tint) * ao[..., None]) - 1) * P['aoStrength']
    ao_soft = ao + (1 - ao) * P.get('aoLift', 0)
    ao_mul_soft = 1 + ((tint + (1 - tint) * ao_soft[..., None]) - 1) * P['aoStrength']
    relit = shade_lift > 0 or P.get('aoLift', 0) > 0
    if relit:
        relight = push_pull(key_soft * ao_mul_soft / np.maximum(key_mul * ao_mul, 1e-4), validf)

    # 4. painted edges and grooves
    open_ = smoothstep(P['openLo'], P['openHi'], ao_s)
    # the bevel measure is only good where a surface was baked: its margin copies read high
    on_island = dilate(island, 1)
    rim = smoothstep(P['bevelLo'], P['bevelHi'], bevel) * open_ * on_island
    relief = relief_share(job['normalPng'], island, P['reliefTilt'])
    gate = float(smoothstep(P['reliefLo'], P['reliefHi'], np.float32(relief)))
    rid = up2(ridges(job['normalPng']))
    # the normal map jumps to its padding at an island's border: read relief only inside
    inner = ~dilate(~island, P['ridgeInsetPx'])
    ridge = smoothstep(P['ridgeLo'], P['ridgeHi'], rid) * (P['ridgeWeight'] * gate) * inner
    groove = smoothstep(P['grooveLo'], P['grooveHi'], -rid) * (P['groove'] * gate) * inner
    # the cleaned colour's own relief: the bright side of a rivet, a trim rim or a raised panel
    # (the painted edge on a set whose normal map is flat) and the dark of a seam, read at a
    # painted edge's scale off the gamma-encoded value
    v = base_s @ LUMA
    hp = v - blur(v, P['albedoEdgePx'])
    weight = P['albedoEdgeNonMetal'] + (1 - P['albedoEdgeNonMetal']) * metal
    a_rim = smoothstep(P['albedoEdgeLo'], P['albedoEdgeHi'], hp) * weight * inner
    a_seam = smoothstep(P['albedoEdgeLo'], P['albedoEdgeHi'], -hp) * P['albedoSeam'] * inner
    groove = np.maximum(groove, a_seam)
    edge = widen(np.maximum(np.maximum(rim, ridge), a_rim), P['edgeWidenPx'])
    edge = np.clip(edge, 0, 1) * (0.45 + 0.55 * smoothstep(-0.4, 0.6, k))

    # light terms off the island and its margin come from the island beside them (the
    # edges from the island alone)
    light = np.concatenate(
        [key_mul * ao_mul * (1 - groove)[..., None], k[..., None], ao[..., None]], -1)
    light = push_pull(light, validf)
    mul, k_f, ao_f = light[..., :3], light[..., 3], light[..., 4]
    edge = push_pull(np.where(on_island, edge, 0).astype(np.float32), on_island.astype(np.float32))
    C = C * mul
    # the lit side also screens a warm light over the colour, so a dark cloth lifts toward a
    # lighter hue of itself where a pale one barely moves
    lit_screen = (smoothstep(P['keyMid'], P['keyLit'], k_f) * P['litScreen'] * smoothstep(0.4, 0.9, ao_f))[..., None]
    Cs = linear_to_srgb(C)
    Cs = 1 - (1 - Cs) * (1 - lit_screen * np.array(P['litScreenTint'], np.float32))
    C = srgb_to_linear(Cs)

    lift_m = np.minimum(C * P['edgeLiftMetal'] + 0.02, 1)
    lift_m = lift_m + (np.array(P['edgeTint'], np.float32) - lift_m) * P['edgeWhiteMetal']
    lift_n = np.minimum(C * P['edgeLiftNonMetal'] + 0.01, 1)
    edge_col = lift_n + (lift_m - lift_n) * metal[..., None]
    strength = P['edgeNonMetal'] + (P['edgeMetal'] - P['edgeNonMetal']) * metal
    a = np.clip(edge * strength, 0, 1)[..., None]
    C = C + (np.maximum(C, edge_col) - C) * a

    # 5. polished metal facing the key; the brush tile
    shine = smoothstep(P['shineLo'], P['shineHi'], k_f) * metal * smoothstep(0.6, 0.9, ao_f) * P['shine']
    shine_col = np.minimum(C * 1.7 + 0.03 * np.array(P['edgeTint'], np.float32), 1)
    C = C + (np.maximum(C, shine_col) - C) * shine[..., None]
    brush = blur(brush_b[..., 0], P['brushBlurPx'])
    mean = float(brush[island].mean()) if island.any() else 0.5
    sd = float(brush[island].std()) if island.any() else 1.0
    z = np.clip((brush - mean) / max(sd, 1e-4), -2.5, 2.5)
    z = push_pull(np.where(valid, z, 0).astype(np.float32), validf)
    C = C * (1 + P['brush'] * z)[..., None]

    rgb = np.clip(linear_to_srgb(C), P['floor'], P['ceiling'])

    # 6. the ChatGPT repaint (RGB the registered repaint, A its confidence)
    repaint = repaint_path(job['set'])
    repainted = os.path.exists(repaint)
    if repainted:
        over = load(repaint)
        if over.shape[:2] != (H, W):
            raise SystemExit(f'{repaint} is {over.shape[1]}x{over.shape[0]}, want {W}x{H}')
        rgb = blend_repaint(rgb, island, over[..., :3], over[..., 3])

    # 7. one steel
    if P['steelUnify'] > 0:
        rgb = np.clip(unify_steel(rgb, O8, metal, island, mul, ao_f, P['steelUnify'], P['steelLitShare']),
                      P['floor'], P['ceiling'])

    # 8. a softer shade
    if relit:
        rgb = np.clip(linear_to_srgb(srgb_to_linear(rgb) * relight), P['floor'], P['ceiling'])

    # 9. the shadow toe
    if P.get('toeShare', 0) > 0:
        rgb = np.clip(shadow_toe(rgb, base_s, island, P['toeShare'], P.get('toeBlack', 0)),
                      P['floor'], P['ceiling'])

    # 10. one plate, both sides
    twin_path = os.path.join(wd, 'bake_twin.exr')
    twinned = 0.0
    if P.get('twinGapHi', 0) > 0 and os.path.exists(twin_path):
        rgb, twinned = paint_twins(rgb, load(twin_path), island, ao_f, P['twinGapLo'], P['twinGapHi'],
                                   P.get('twinBlurPx', 0), P.get('twinAoWeight', 0), P.get('twinSpreadPx', 0),
                                   P.get('twinRigid', 0))

    # 11. no blue where the set's palette has none
    if P.get('neutralBlue', 0) > 0:
        rgb = np.clip(neutral_blue(rgb, P['neutralBlue'], P.get('neutralBlueLift', 0)), P['floor'], P['ceiling'])
    files = {}

    def put(key, arr):
        p = os.path.join(out, f'{key}.png')
        save(p, arr)
        files[key] = {'path': p, 'size': [arr.shape[1], arr.shape[0]]}

    put('full', rgb)
    if not job['lowDiffers']:
        lw, lh = job['lowSize']
        f = W // lw
        if f * lw != W or f * lh != H:
            raise SystemExit(f'the low atlas {lw}x{lh} is not a whole fraction of {W}x{H}')
        put('low', linear_to_srgb(box_down(srgb_to_linear(rgb), f)))

    # review previews (never shipped)
    rev = os.path.join(wd, 'review')
    os.makedirs(rev, exist_ok=True)
    save(os.path.join(rev, 'key.png'), np.clip(mul, 0, 1.3) / 1.3)
    save(os.path.join(rev, 'edge.png'), np.clip(edge, 0, 1))
    save(os.path.join(rev, 'ao.png'), np.clip(ao_f, 0, 1))
    save(os.path.join(rev, 'ridge.png'), np.clip(rid * 4 + 0.5, 0, 1))
    save(os.path.join(rev, 'bevel.png'), np.clip(bevel * 4, 0, 1))
    save(os.path.join(rev, 'base.png'), np.clip(linear_to_srgb(srgb_to_linear(base_s)), 0, 1))

    def pct(x, m):
        v = x[m]
        return [round(float(np.percentile(v, q)), 4) for q in (5, 50, 95, 99)] if v.size else []

    summary = {
        'atlas': [W, H],
        'islandShare': round(float(island.mean()), 4),
        'validShare': round(float(valid.mean()), 4),
        'relief': round(relief, 4),
        'reliefGate': round(gate, 4),
        'keyMulLuma': pct(mul @ LUMA, island),
        'aoP': pct(ao_f, island),
        'bevelP': pct(bevel, island),
        'ridgeP': pct(rid, island),
        'edgeShare': round(float((edge[island] > 0.3).mean()), 4),
        'metalShare': round(float((metal[island] > 0.5).mean()), 4),
        'lumaBefore': pct(O8 @ LUMA, island),
        'lumaAfter': pct(rgb @ LUMA, island),
        'repaint': repainted,
        'twinShare': round(twinned, 4),
    }
    json.dump({'summary': summary, 'files': files}, open(os.path.join(out, 'stats.json'), 'w'), indent=1)
    print(json.dumps(summary), flush=True)
