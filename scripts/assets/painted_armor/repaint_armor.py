# Painted WOC armour, the ChatGPT repaint layer: a hand-painted repaint of a set's painted colour
# atlas (ChatGPT image editing, prompt in PROMPTS.md), locked back onto the atlas's exact UV
# layout and blended over the bake so the brushwork is ChatGPT's and the light stays the bake's.
#
# An image model redraws the whole picture: its repaint keeps the layout only roughly (a few
# texels of drift, a slightly different scale, a different canvas size), and it paints rims
# along every island border because it cannot know which borders are real plate edges and
# which are UV seams. So the repaint is never spliced in as it comes back:
#
#   register  (this file's CLI, Blender's bundled Python: numpy plus OpenImageIO) each repaint
#             half is resized to the half it was made from, then warped onto it by an affine
#             fit plus a stiff, capped residual, both matched on the island outlines only (on
#             black they survive the repaint; the inside of an island is the repaint's own
#             brushwork and is never dragged toward the bake's). A local correlation of the warped
#             repaint against its source is its confidence: where the model moved or redrew
#             something the confidence drops and the bake shows instead. The registered repaint
#             is written as src/repaint/<set>.png, RGB the repaint and A the confidence. A set
#             whose pieces are too dark for the model to tell from the black gutters (the rogue's
#             leather) is sent lifted, every island value to a power under 1 (`--gamma` is that
#             power's inverse), and its registered repaint is brought back down by `--gamma`.
#   blend     (blend_repaint, numpy only, called by composite_armor.py when the set has a
#             src/repaint file) a band split: the bake's broad light and colour mixed with the
#             repaint's (REPAINT.colourMix), the repaint's fine brushwork over it
#             (REPAINT.detail) and a little of the bake's own fine band (its painted geometric
#             edges, REPAINT.bakeDetail). Toward an island border the repaint fades out to the
#             bake (REPAINT.seamInPx to seamOutPx), so both sides of a UV seam meet in the same
#             baked texels and no painted rim lands on a seam. Gutters stay the bake's. Before
#             the split, the dark spots the model painted into a plate the bake has clean (a
#             smudge, a dent, a stray scratch) are filled from their surroundings: a spot is
#             what sits under its own neighbourhood (REPAINT.spotPx), and only the depth past
#             the bake's own there (a groove, a seam, a shaded inset panel), widened a few
#             texels for the registration's slack, goes (clean_spots).
#
#   <blender python> scripts/assets/painted_armor/repaint_armor.py register --set male_warrior \
#       --source-left in_L.png --source-right in_R.png --repaint-left gpt_L.png \
#       --repaint-right gpt_R.png [--gamma <g>] [--review <dir>]
#   (<blender python>: /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13)
#
# then re-run paint_armor.mjs --only <set> to composite, encode and splice.
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPAINT_DIR = os.path.join(HERE, 'src', 'repaint')
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

REPAINT = {
    'lowPx': 10.0,
    'colourMix': 0.6,
    'detail': 1.0,
    'bakeDetail': 0.3,
    'seamInPx': 2,
    'seamOutPx': 9,
    # the dark-spot clean: the neighbourhood's sigma, the slack the bake's own dark is widened
    # by, and the value (sRGB luma) a spot may sit deeper than the bake's before it is filled
    'spotPx': 8.0,
    'spotSlackPx': 2,
    'spotTol': 0.05,
}

# the registration: pyramid levels; the affine fit's Gauss-Newton steps per level; the stiff
# residual's finest level, its cap in full-size texels, and per level its Lucas-Kanade steps,
# window, smoothing (both in that level's texels) and damping
LEVELS = 5
AFFINE_ITERS = 30
RESIDUAL_FINEST = 2
RESIDUAL_MAX = 6.0
LK_ITERS = 8
LK_WINDOW = 6.0
LK_SMOOTH = 8.0
LK_DAMP = 0.05
# the repaint fades to the bake across the cut between its two halves (full-size texels)
CUT_IN_PX = 2
CUT_OUT_PX = 14


# ------------------------------------------------------------------ filters

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def box1d(a, r, axis):
    if r < 1:
        return a
    n = a.shape[axis]
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, sigma):
    """A Gaussian of `sigma` texels over the first two axes, edge clamped: an exact kernel
    when small, three box passes of matching variance when large."""
    if sigma <= 0:
        return a
    a = np.asarray(a, np.float32)
    if sigma < 2.5:
        r = int(np.ceil(sigma * 3))
        x = np.arange(-r, r + 1, dtype=np.float32)
        k = np.exp(-0.5 * (x / sigma) ** 2)
        k /= k.sum()
        out = a
        for axis in (0, 1):
            pad = [(0, 0)] * a.ndim
            pad[axis] = (r, r)
            p = np.pad(out, pad, mode='edge')
            acc = np.zeros_like(out)
            for i, w in enumerate(k):
                acc += w * np.take(p, np.arange(i, i + out.shape[axis]), axis=axis)
            out = acc
        return out
    r = max(1, int(round((np.sqrt(4 * sigma * sigma / 3 + 1) - 1) / 2)))
    out = a
    for _ in range(3):
        out = box1d(box1d(out, r, 0), r, 1)
    return out


def masked_blur(a, m, sigma):
    """Normalised convolution: the blur of `a` over the texels where m is set only."""
    mm = m.astype(np.float32)
    w = blur(mm, sigma)
    if a.ndim == 3:
        return blur(a * mm[..., None], sigma) / np.maximum(w, 1e-4)[..., None]
    return blur(a * mm, sigma) / np.maximum(w, 1e-4)


def down2(a):
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    a = blur(a[:h, :w], 0.8)
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def up2(a, shape):
    """Bilinear upsample of a flow component to `shape`, values doubled (texel units)."""
    h, w = shape
    ys = (np.arange(h, dtype=np.float32) + 0.5) / 2 - 0.5
    xs = (np.arange(w, dtype=np.float32) + 0.5) / 2 - 0.5
    return 2 * sample(a, np.broadcast_to(xs[None, :], (h, w)), np.broadcast_to(ys[:, None], (h, w)))


def sample(img, x, y):
    """Bilinear lookup of img at float texel coordinates (edge clamped)."""
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.0001)
    y = np.clip(y, 0, h - 1.0001)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = x - x0
    fy = y - y0
    if img.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    a = img[y0, x0]
    b = img[y0, x0 + 1]
    c = img[y0 + 1, x0]
    d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def warp(img, u, v):
    h, w = u.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return sample(img, xx + u, yy + v)


def grad(a):
    gx = np.zeros_like(a)
    gy = np.zeros_like(a)
    gx[:, 1:-1] = 0.5 * (a[:, 2:] - a[:, :-2])
    gy[1:-1] = 0.5 * (a[2:] - a[:-2])
    return gx, gy


def erode_depth(m, cap):
    """How many 4-neighbour erosions each texel of m survives, capped at `cap`."""
    depth = np.zeros(m.shape, np.float32)
    cur = m.copy()
    for i in range(cap):
        depth += cur
        nxt = cur.copy()
        nxt[1:] &= cur[:-1]
        nxt[:-1] &= cur[1:]
        nxt[:, 1:] &= cur[:, :-1]
        nxt[:, :-1] &= cur[:, 1:]
        cur = nxt
    return depth


# ------------------------------------------------------------------ register

def outline_feature(rgb):
    """What the registration matches: the soft island mask, blurred a little. Only the island
    outlines are trusted (on black they survive the repaint exactly); the inside of an island
    is the repaint's own brushwork, so matching it would drag strokes onto the bake's."""
    y = blur(rgb[..., :3] @ LUMA, 1.0)
    return blur(smoothstep(0.035, 0.09, y), 1.5)[..., None].astype(np.float32)


def outline_misfit(ref, img):
    """Mean absolute difference of the outline features: 0 when every outline sits exactly."""
    return float(np.abs(outline_feature(ref) - outline_feature(img)).mean())


def _affine_flow(p, h, w):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xn, yn = xx / w - 0.5, yy / h - 0.5
    return (p[0] * xn + p[1] * yn + p[2]) * w, (p[3] * xn + p[4] * yn + p[5]) * h, xn, yn


def register(source, repaint):
    """The flow (u, v) that warps `repaint` onto `source` (same size): an affine fit (the
    model's own reframing), then a stiff residual solved on the coarse levels only (smooth
    drift, at most RESIDUAL_MAX texels), never at the scale of a brush stroke."""
    fs = [outline_feature(source)]
    fr = [outline_feature(repaint)]
    for _ in range(LEVELS - 1):
        fs.append(down2(fs[-1]))
        fr.append(down2(fr[-1]))
    p = np.zeros(6)
    for lvl in range(LEVELS - 1, -1, -1):
        ref, src = fs[lvl][..., 0], fr[lvl]
        h, w = ref.shape
        for _ in range(AFFINE_ITERS):
            u, v, xn, yn = _affine_flow(p, h, w)
            ws = warp(src, u, v)[..., 0]
            gx, gy = grad(ws)
            e = (ws - ref).ravel()
            J = np.stack([gx * w * xn, gx * w * yn, gx * w, gy * h * xn, gy * h * yn, gy * h],
                         -1).reshape(-1, 6).astype(np.float64)
            H = J.T @ J
            dp = -np.linalg.solve(H + np.eye(6) * 1e-6 * np.trace(H), J.T @ e)
            p += dp
            if np.abs(dp).max() < 1e-7:
                break
    ru = rv = None
    for lvl in range(LEVELS - 1, RESIDUAL_FINEST - 1, -1):
        ref, src = fs[lvl], fr[lvl]
        h, w = ref.shape[:2]
        au, av = _affine_flow(p, h, w)[:2]
        if ru is None:
            ru = np.zeros((h, w), np.float32)
            rv = np.zeros((h, w), np.float32)
        else:
            ru, rv = up2(ru, (h, w)), up2(rv, (h, w))
        rgx, rgy = grad(ref)
        cap = RESIDUAL_MAX / 2 ** lvl
        for _ in range(LK_ITERS):
            ws = warp(src, au + ru, av + rv)
            sgx, sgy = grad(ws)
            gx = 0.5 * (rgx + sgx)
            gy = 0.5 * (rgy + sgy)
            e = ws - ref
            sxx = blur((gx * gx).sum(-1), LK_WINDOW)
            sxy = blur((gx * gy).sum(-1), LK_WINDOW)
            syy = blur((gy * gy).sum(-1), LK_WINDOW)
            bx = blur((gx * e).sum(-1), LK_WINDOW)
            by = blur((gy * e).sum(-1), LK_WINDOW)
            lam = LK_DAMP * float((sxx + syy).mean()) + 1e-6
            a, d = sxx + lam, syy + lam
            det = a * d - sxy * sxy
            ru = np.clip(blur(ru - (d * bx - sxy * by) / det, LK_SMOOTH), -cap, cap)
            rv = np.clip(blur(rv - (a * by - sxy * bx) / det, LK_SMOOTH), -cap, cap)
    h, w = source.shape[:2]
    while ru.shape[0] < h:
        ru, rv = up2(ru, (ru.shape[0] * 2, ru.shape[1] * 2)), up2(rv, (rv.shape[0] * 2, rv.shape[1] * 2))
    au, av = _affine_flow(p, h, w)[:2]
    return au + ru, av + rv, p


def confidence(source, warped):
    """Local correlation of the warped repaint's luma against its source's: near 1 where the
    model kept the shapes and light, low where it moved or redrew them. Flat texels (no
    structure to disagree on) count as confident unless the broad colour moved far."""
    a = blur(source[..., :3] @ LUMA, 2.0)
    b = blur(warped[..., :3] @ LUMA, 2.0)
    s = 8.0
    ma, mb = blur(a, s), blur(b, s)
    va = np.maximum(blur(a * a, s) - ma * ma, 0)
    vb = np.maximum(blur(b * b, s) - mb * mb, 0)
    cov = blur(a * b, s) - ma * mb
    ncc = cov / np.sqrt(va * vb + 1e-6)
    flat = 1 - smoothstep(2e-4, 1.5e-3, va)
    corr = np.maximum(smoothstep(0.25, 0.6, ncc), flat)
    broad = np.abs(blur(source[..., :3], s) - blur(warped[..., :3], s)).max(-1)
    return (corr * (1 - smoothstep(0.22, 0.4, broad))).astype(np.float32), ncc


# ------------------------------------------------------------------ blend

def repaint_path(set_name):
    return os.path.join(REPAINT_DIR, f'{set_name}.png')


def grow(a, px):
    """A grey max filter over 4-neighbours, `px` steps."""
    out = a
    for _ in range(px):
        n = out.copy()
        n[1:] = np.maximum(n[1:], out[:-1])
        n[:-1] = np.maximum(n[:-1], out[1:])
        n[:, 1:] = np.maximum(n[:, 1:], out[:, :-1])
        n[:, :-1] = np.maximum(n[:, :-1], out[:, 1:])
        out = n
    return out


def clean_spots(over, rgb, island, R=REPAINT):
    """The repaint `over` with the dark spots the bake `rgb` does not have filled from their
    surroundings (both sRGB): each texel's depth under its neighbourhood over the islands, less
    the bake's own depth there (grown by the registration's slack) and the tolerance, is the
    share of the spot that goes, toward the neighbourhood's colour without the spots."""
    px = R['spotPx']
    lr = over @ LUMA
    lb = rgb @ LUMA
    depth_r = np.maximum(masked_blur(lr, island, px) - lr, 0)
    depth_b = grow(np.maximum(masked_blur(lb, island, px) - lb, 0), R['spotSlackPx'])
    extra = np.maximum(depth_r - depth_b - R['spotTol'], 0)
    a = blur(np.clip(extra / np.maximum(depth_r, 1e-4), 0, 1) * island, 1.0)
    fill = masked_blur(over, island & (a < 0.1), px)
    return over + (fill - over) * np.clip(a, 0, 1)[..., None]


def blend_repaint(rgb, island, over, conf, R=REPAINT):
    """The bake `rgb` (sRGB, the atlas) with the registered repaint `over` (sRGB) blended in
    over the islands, its stray dark spots cleaned (clean_spots), weighted by the repaint's
    confidence `conf` and faded out toward every island border. Gutters stay the bake's."""
    over = clean_spots(over, rgb, island, R)
    low_b = masked_blur(rgb, island, R['lowPx'])
    low_r = masked_blur(over, island, R['lowPx'])
    painted = (low_b + R['colourMix'] * (low_r - low_b)
               + R['detail'] * (over - low_r)
               + R['bakeDetail'] * (rgb - low_b))
    depth = erode_depth(island, R['seamOutPx'] + 1)
    w = smoothstep(R['seamInPx'], R['seamOutPx'], depth) * conf * island
    return np.clip(rgb + (painted - rgb) * w[..., None], 0, 1).astype(np.float32)


# ------------------------------------------------------------------ cli (OpenImageIO io)
# Alpha is data here (the repaint's confidence), so every read and write keeps it unassociated:
# OpenImageIO would otherwise premultiply on read and divide on write, and Blender's loader (the
# composite's) reads the PNG's RGB as stored.

def _read(path):
    import OpenImageIO as oiio
    config = oiio.ImageSpec()
    config.attribute('oiio:UnassociatedAlpha', 1)
    buf = oiio.ImageBuf(path, 0, 0, config)
    return np.asarray(buf.get_pixels(oiio.FLOAT), np.float32)


def _resize(path, w, h):
    import OpenImageIO as oiio
    buf = oiio.ImageBuf(path)
    spec = buf.spec()
    out = oiio.ImageBufAlgo.resize(buf, roi=oiio.ROI(0, w, 0, h, 0, 1, 0, spec.nchannels),
                                   filtername='lanczos3')
    return np.clip(np.asarray(out.get_pixels(oiio.FLOAT), np.float32), 0, 1)


def _write(path, arr):
    import OpenImageIO as oiio
    arr = np.asarray(arr, np.float32)
    if arr.ndim == 2:
        arr = arr[..., None]
    h, w, c = arr.shape
    spec = oiio.ImageSpec(w, h, c, oiio.UINT8)
    spec.attribute('oiio:UnassociatedAlpha', 1)
    buf = oiio.ImageBuf(spec)
    buf.set_pixels(oiio.ROI(0, w, 0, h, 0, 1, 0, c), np.ascontiguousarray(np.clip(arr, 0, 1)))
    if not buf.write(path):
        raise SystemExit(f'write failed: {path}: {buf.geterror()}')


def _outline(mask):
    edge = mask & ~(np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1))
    return edge


def cmd_register(args):
    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args else default

    set_name = opt('--set')
    review = opt('--review')
    gamma = float(opt('--gamma', 1))
    halves = []
    report = {'set': set_name, 'gamma': gamma, 'halves': {}}
    for side in ('left', 'right'):
        source = _read(opt(f'--source-{side}'))[..., :3]
        h, w = source.shape[:2]
        repaint = _resize(opt(f'--repaint-{side}'), w, h)[..., :3]
        u, v, p = register(source, repaint)
        warped = np.clip(warp(repaint, u, v), 0, 1)
        conf, ncc = confidence(source, warped)
        isl = smoothstep(0.035, 0.09, blur(source @ LUMA, 1.0)) > 0.5
        mag = np.hypot(u, v)
        report['halves'][side] = {
            'flowMean': round(float(mag[isl].mean()), 3),
            'flowP95': round(float(np.percentile(mag[isl], 95)), 3),
            'flowMax': round(float(mag.max()), 3),
            'affine': [round(float(x), 5) for x in p],
            'misfitBefore': round(outline_misfit(source, repaint), 5),
            'misfitAfter': round(outline_misfit(source, warped), 5),
            'nccBefore': round(float(confidence(source, repaint)[1][isl].mean()), 4),
            'nccAfter': round(float(ncc[isl].mean()), 4),
            'confMean': round(float(conf[isl].mean()), 4),
            'confLowShare': round(float((conf[isl] < 0.5).mean()), 4),
        }
        halves.append((warped ** gamma, conf))
        if review:
            os.makedirs(review, exist_ok=True)
            edge = _outline(isl)
            for name, img in (('before', repaint), ('after', warped)):
                o = img.copy()
                o[edge] = [0.1, 1.0, 0.2]
                _write(os.path.join(review, f'{set_name}_{side}_{name}_outline.png'), o)
            _write(os.path.join(review, f'{set_name}_{side}_conf.png'), conf)
    over = np.concatenate([halves[0][0], halves[1][0]], 1)
    conf = np.concatenate([halves[0][1], halves[1][1]], 1)
    # the two halves were painted apart: an island the cut runs through shows the bake along
    # the cut, so no line between two different repaints lands on the armour
    cut = halves[0][0].shape[1]
    x = np.abs(np.arange(conf.shape[1], dtype=np.float32) + 0.5 - cut)
    conf = conf * smoothstep(CUT_IN_PX, CUT_OUT_PX, x)[None, :]
    os.makedirs(REPAINT_DIR, exist_ok=True)
    out = opt('--out', repaint_path(set_name))
    _write(out, np.concatenate([over, conf[..., None]], -1))
    report['out'] = out
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    argv = sys.argv[1:]
    if not argv or argv[0] != 'register':
        raise SystemExit(__doc__ or 'usage: repaint_armor.py register --set <set> ...')
    cmd_register(argv[1:])
