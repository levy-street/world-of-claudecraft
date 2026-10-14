# Deepglass foliage atlases, v2 (2026-09-24): every leaf card the tree, shrub
# and grass kits draw, painted into FAMILY sheets so each GLB embeds only the
# one it uses.
#
#   python3 scripts/assets/deepglass/paint_foliage.py [--preview]
#
# Writes scripts/assets/deepglass/tree_tex/foliage/<sheet>.png + cells.json.
#
# SPACEY, 2026-09-24: "another pass on the trees bush's and grass ... some of the
# branches at the bottom of the png are sticking outward from the tree when the
# base of the branches should always be closest to the tree ... add some more
# variants some trees with purple flowers or pollen and make the frosted ones a
# bit more snowy".
#
# THE ANCHOR CONTRACT (the bug in that first sentence). The old atlas assumed
# every cell hangs from its TOP CENTRE, then fed it art that did not: the
# generated boughs are SIDE views whose woody base is at the top LEFT and whose
# stem runs sideways; the crown cell was that art flipped upside down (its twig
# landed at the bottom right); the broadleaf sprig grows UP from a stem at its
# bottom and was scattered at random angles. So woody ends sat out at the tips
# of cards. Now every cell records where its wood ENTERS (`anchor`, in UV) and
# which way it grows (`axis`); the builders put that exact point on the branch,
# and check_wood() fails the build if woody paint sits far from the anchor.
#
#   axis 'right'  : side-view bough. Base at the left, grows along +u, hangs
#                   along -v. Drawn on a VERTICAL card; the image's down = down.
#   axis 'down'   : plan-view bough / hanging raceme. Base at the top centre,
#                   grows down the image.
#   axis 'up'     : crown plume / grass tuft. Base at the bottom centre.
#   axis 'centre' : a clump with no wood at all (canopy clouds, shrub domes).
import json
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
# SPACEY's generated leaf and frond art, checked in beside the sheets it paints
# (it lived in gitignored tmp/, so no other checkout could repaint them)
SRCDIR = os.path.join(HERE, 'tree_tex', 'src')
LEAFSRC = os.path.join(SRCDIR, 'leaves')
FRONDSRC = os.path.join(SRCDIR, 'fronds')
OUT = os.path.join(HERE, 'tree_tex', 'foliage')
PREVIEW = '--preview' in sys.argv
ONLY = [a.split('=', 1)[1] for a in sys.argv if a.startswith('--only=')]
SHEET_PX = int(os.environ.get('DG_FOLIAGE_SHEET', '1024'))


# --------------------------------------------------------------------------
# basics
def load(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 20)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def arr(im):
    return np.asarray(im).astype(np.float32) / 255.0


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))


def c8(c, a=1.0):
    return tuple(int(max(0, min(1, v)) * 255) for v in c) + (int(a * 255),)


def ramp(stops, t):
    """Piecewise-linear colour ramp; stops = [(t, (r,g,b)), ...] in 0..1."""
    t = np.clip(np.asarray(t, np.float32), 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        m = (t >= t0) & (t <= t1)
        f = ((t - t0) / max(1e-6, t1 - t0))[m][:, None]
        out[m] = np.array(c0) * (1 - f) + np.array(c1) * f
    return out


def ramp1(stops, t):
    return tuple(ramp(stops, np.array([t]))[0])


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


def blur(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0


def attach(canvas, im, ax, ay, deg, base='top'):
    """Composite `im` rotated `deg` (CCW on screen) so that its BASE point , 
    top centre or bottom centre of the unrotated image, lands on (ax, ay).
    Every frond/leaf placement goes through here so a stem can only ever sit
    where it was asked to."""
    h = im.height
    r = im.rotate(deg, resample=Image.BICUBIC, expand=True)
    t = math.radians(deg)
    vy = -h / 2 if base == 'top' else h / 2
    # image coords (y down): a CCW-on-screen rotation maps (0, vy) to
    # (vy*sin, vy*cos)
    bx, by = vy * math.sin(t), vy * math.cos(t)
    cx, cy = ax - bx, ay - by
    canvas.alpha_composite(r, (int(round(cx - r.width / 2)), int(round(cy - r.height / 2))))


def noise2(w, h, cell, rng):
    g = np.array([[rng.random() for _ in range(w // cell + 3)] for _ in range(h // cell + 3)], np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w + 3 * cell, h + 3 * cell), Image.BICUBIC)
    return np.asarray(im).astype(np.float32)[cell:cell + h, cell:cell + w] / 255.0


# --------------------------------------------------------------------------
# palettes. Deepglass is a cold fjord: teal-green conifers with a warm moss
# highlight, violet accents (the root bark and the Warden runes), and snow that
# shades BLUE, never grey.
# ONE fjord palette across every sheet (round-1 review: "grass is lime, pines
# are cyan-teal, shrubs a third green"): cool blue-green shadows rising to
# warm olive lights.
# lifted ~15% in round 4: with the emissive floor lowered so the skirt-to-
# crown gradient shows, the sheet itself has to carry the mid values
PINE = [(0.0, rgb('#193534')), (0.2, rgb('#2a564d')), (0.45, rgb('#44835b')),
        (0.7, rgb('#73af64')), (0.88, rgb('#b6d37b')), (1.0, rgb('#ecefa1'))]
PINE_WARM = [(0.0, rgb('#1e392c')), (0.2, rgb('#325c42')), (0.45, rgb('#508c51')),
             (0.7, rgb('#85b85c')), (0.88, rgb('#c8dc78')), (1.0, rgb('#faf6a5'))]
PINE_BLUE = [(0.0, rgb('#162f39')), (0.2, rgb('#234e50')), (0.45, rgb('#397668')),
             (0.7, rgb('#5ba07f')), (0.88, rgb('#99c89f')), (1.0, rgb('#d4eec2'))]
PINE_COLD = [(0.0, rgb('#162d36')), (0.2, rgb('#244c4e')), (0.45, rgb('#3c7662')),
             (0.7, rgb('#609f78')), (0.88, rgb('#a0c7a0')), (1.0, rgb('#dcf1c9'))]
# snow tops out below pure white: at 1.0 it blew out under the sun and read
# as flat paper (round-6 review)
SNOW = [(0.0, rgb('#4a6089')), (0.3, rgb('#7890b8')), (0.55, rgb('#a9bdd8')), (0.8, rgb('#d5e1ee')),
        (1.0, rgb('#eef3f9'))]
LILAC = [(0.0, rgb('#2c1240')), (0.25, rgb('#582a82')), (0.5, rgb('#8a4dbc')),
         (0.75, rgb('#bd88e0')), (0.9, rgb('#dcb6f2')), (1.0, rgb('#f8e8ff'))]
LILAC_PINK = [(0.0, rgb('#351238')), (0.3, rgb('#6c2a72')), (0.55, rgb('#a2509f')),
              (0.8, rgb('#d289c9')), (1.0, rgb('#f7dcf0'))]
LILAC_PALE = [(0.0, rgb('#3a2856')), (0.3, rgb('#70539e')), (0.6, rgb('#ae8fd8')),
              (0.85, rgb('#dcc6f4')), (1.0, rgb('#f8efff'))]
HEATHER = [(0.0, rgb('#3a1238')), (0.3, rgb('#742a6c')), (0.6, rgb('#b0509c')),
           (0.85, rgb('#df8cc6')), (1.0, rgb('#fad7ee'))]
LEAF = [(0.0, rgb('#132b2b')), (0.25, rgb('#21493b')), (0.5, rgb('#397249')),
        (0.75, rgb('#6c9a50')), (0.9, rgb('#a1b865')), (1.0, rgb('#d3d38c'))]
LEAF_DEEP = [(0.0, rgb('#10262b')), (0.3, rgb('#1e443d')), (0.6, rgb('#356c50')),
             (0.85, rgb('#6a955b')), (1.0, rgb('#b2bf80'))]
LEAF_YOUNG = [(0.0, rgb('#15291f')), (0.3, rgb('#284a2c')), (0.6, rgb('#4f7a3a')),
              (0.85, rgb('#8fab52')), (1.0, rgb('#d4d487'))]
LEAF_COLD = [(0.0, rgb('#0d1d26')), (0.3, rgb('#173534')), (0.6, rgb('#2a5446')),
             (0.85, rgb('#557c62')), (1.0, rgb('#9cb296'))]
GRASS = [(0.0, rgb('#172a22')), (0.22, rgb('#23432c')), (0.5, rgb('#3f6638')),
         (0.78, rgb('#738c4a')), (1.0, rgb('#aeb07a'))]
GRASS_FROST = [(0.0, rgb('#17261f')), (0.25, rgb('#253e31')), (0.55, rgb('#43604c')),
               (0.8, rgb('#728a73')), (1.0, rgb('#aebaa6'))]
GRASS_COLD = [(0.0, rgb('#132624')), (0.25, rgb('#1f4036')), (0.55, rgb('#3a6552')),
              (0.8, rgb('#6f9178')), (1.0, rgb('#b0c4a4'))]
GRASS_DRY = [(0.0, rgb('#262a1c')), (0.3, rgb('#44472a')), (0.6, rgb('#76703c')),
             (0.85, rgb('#a99a58')), (1.0, rgb('#d6ca8c'))]
BERRY = [(0.0, rgb('#33061a')), (0.35, rgb('#7d1030')), (0.7, rgb('#cf2f4a')), (1.0, rgb('#ffc9c0'))]
FERN = [(0.0, rgb('#0f2426')), (0.3, rgb('#1b4136')), (0.6, rgb('#356944')),
        (0.85, rgb('#6a9253')), (1.0, rgb('#adc07a'))]
WOOD = rgb('#3a2a20')
WOOD_LIT = rgb('#6b5140')


# --------------------------------------------------------------------------
# source art (SPACEY's generated leaves: tree_tex/src/leaves + fronds)
SRC = {}


def src(name):
    if name not in SRC:
        for d in (LEAFSRC, FRONDSRC):
            p = os.path.join(d, name + '.png')
            if os.path.exists(p):
                SRC[name] = load(p)
                break
        else:
            raise SystemExit(f'missing source art {name} in {LEAFSRC} / {FRONDSRC}')
    return SRC[name]


def fronds():
    names = sorted(os.path.splitext(f)[0] for f in os.listdir(FRONDSRC) if f.endswith('.png'))
    return [src(n) for n in names]


def regrade(im, stops, keep=0.25, lo=3, hi=98, gamma=1.0):
    """Remap the art's luminance onto a colour ramp, keeping `keep` of its own
    colour. Each source came out of the model at its own exposure and hue;
    regrading puts every cell of a sheet on ONE palette so boughs from
    different sources sit together on one tree."""
    a = arr(im)
    solid = a[..., 3] > 0.4
    L = lum(a)
    p0, p1 = np.percentile(L[solid], lo), np.percentile(L[solid], hi)
    t = np.clip((L - p0) / max(1e-4, p1 - p0), 0, 1) ** gamma
    a[..., :3] = ramp(stops, t) * (1 - keep) + a[..., :3] * keep
    return img(a)


def shade_field(a, fn):
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    f = fn(xx / max(1, w - 1), yy / max(1, h - 1))
    a[..., :3] *= f[..., None]
    return a


def volume(a, light=(-0.45, -0.9), strength=0.5, core_dark=0.3, r=None):
    """Give a flat painted mass VOLUME the WoW way: the rim facing the light
    lifts, the far rim and the buried core sink. `d` = blurred alpha (1 deep
    in the mass, ~0.5 at its rim); sampling it a step TOWARD the light tells
    which rims face it."""
    h, w = a.shape[:2]
    r = r or max(4, int(min(h, w) * 0.03))
    d = blur(a[..., 3], r)
    lx, ly = light
    n = math.hypot(lx, ly)
    sx, sy = int(round(lx / n * r * 1.5)), int(round(ly / n * r * 1.5))
    toward = np.roll(np.roll(d, -sy, axis=0), -sx, axis=1)
    away = np.roll(np.roll(d, sy, axis=0), sx, axis=1)
    lit = np.clip((away - toward) * 2.0, -1, 1)
    core = np.clip((d - 0.6) / 0.35, 0, 1)
    f = 1.0 + lit * strength - core * core_dark
    a[..., :3] *= np.clip(f, 0.4, 1.7)[..., None]
    return a


# --------------------------------------------------------------------------
# conifer
def find_anchor_left(im):
    """The generated side boughs enter at their top LEFT: the leftmost woody
    pixel in the top-left of the art is where the stem leaves the trunk."""
    rgba = np.asarray(im)
    al = rgba[..., 3] > 120
    r, g, b = (rgba[..., i].astype(int) for i in range(3))
    wood = al & (r > g + 4) & (r > b + 8)
    h, w = al.shape
    ys, xs = np.nonzero(wood[: h // 3, : w // 4])
    if len(xs) == 0:
        ys, xs = np.nonzero(al[:, : max(2, w // 12)])
        return 0.0, float(np.median(ys)) / h
    i = np.argmin(xs)
    return float(xs[i]) / w, float(ys[i]) / h


def side_bough(name, stops, seed, snow=0.0, pollen=0.0):
    """A SIDE-VIEW bough from SPACEY's generated art: woody base at the left,
    growing right, needle sprays hanging down. On a vertical card this is the
    drooping Grizzly Hills tier seen from eye level."""
    base = src(name)
    rng = random.Random(seed)
    anc = find_anchor_left(base)
    a = arr(regrade(base, stops, keep=0.22, gamma=1.08))
    # top-lit: upper needle surfaces catch the sky, the hanging tips sink.
    # The rim lift is kept SMALL: at 0.4 it painted a pale-mint edge on every
    # frond that read as tinsel (round-1 review).
    a = shade_field(a, lambda x, y: 1.12 - 0.5 * y ** 1.1 + 0.05 * (1 - x))
    a = volume(a, light=(-0.3, -1.0), strength=0.12, core_dark=0.24)
    if pollen:
        a = add_pollen_side(a, rng, pollen)
    if snow:
        a = add_snow_side(a, rng, snow)
    return img(a), anc


def add_snow_side(a, rng, amount, smooth=0):
    """Snow that LIES ON the bough (SPACEY: "make the frosted ones a bit more
    snowy"). It collects on every up-facing surface: the first solid pixels
    of each column and the top of every spray below a gap. Grow those rims
    DOWN into rounded pillows and paint them with a blue-shadowed ramp.
    amount 0.5 = frosted, 1.0 = laden, 1.4 = buried."""
    h, w = a.shape[:2]
    al = a[..., 3] > 0.45
    # `smooth` > 0 finds the rims of the SMOOTHED mass, so a clump of many
    # small leaves takes one snow cap over its crown rather than a white edge
    # on every leaf
    body = (blur(al.astype(np.float32), smooth) > 0.5) if smooth else al
    k = max(2, int(h * 0.012))
    above = np.zeros_like(body)
    above[k:] = body[:-k]
    rim = body & ~above
    thick = h * (0.025 + 0.07 * amount)
    lump = 0.5 + 0.5 * noise2(w, 1, max(8, w // 22), rng)[0]
    lump = lump * np.linspace(1.2, 0.75, w)
    mask = np.zeros((h, w), np.float32)
    ys, xs = np.nonzero(rim)
    for y, x in zip(ys, xs):
        t = int(thick * lump[x])
        if t < 1:
            continue
        n = min(t, h - y)
        mask[y:y + n, x] = np.maximum(mask[y:y + n, x], np.linspace(1.0, 0.45, n))
    mask = blur(mask, max(2, h * 0.008))
    mask = np.clip((mask - 0.22) / 0.35, 0, 1) * al
    # shading: sky-lit top of each pillow, blue underside
    top = blur(mask, max(2, h * 0.012))
    s = max(2, int(h * 0.018))
    under = np.zeros_like(top)
    under[s:] = top[:-s]
    # a real SHADE SIDE: lit crest, blue-grey belly (round-2 review: "flat
    # paper white"), plus soft lumps so a pillow is not one flat value
    t = np.clip(0.5 + (top - under) * 3.6, 0, 1)
    t = np.clip(t + (noise2(w, h, max(6, w // 26), rng) - 0.5) * 0.3, 0, 1)
    m = mask[..., None]
    a[..., :3] = a[..., :3] * (1 - m) + ramp(SNOW, t) * m
    # frost over the remaining needles, strongest on the upper half
    L = lum(a)
    frost = np.clip(0.22 * amount * (1.15 - np.linspace(0, 1, h))[:, None] * al
                    * np.clip((L - 0.12) / 0.3, 0, 1), 0, 0.5)[..., None]
    a[..., :3] = a[..., :3] * (1 - frost) + np.array(rgb('#c9dbee')) * frost
    return a


def add_snow_cap(a, rng, amount):
    """A snow CAP over a clump's crown, for a card that stays upright (image
    up = world up): one smooth pillow following the smoothed top of the mass,
    thick in the middle, a scalloped lower edge with a blue shadow line under
    it, a few drips, and small tufts caught on the leaves below. The v1
    snow put a white rim on every leaf, which read as polka dots."""
    h, w = a.shape[:2]
    al = a[..., 3]
    body = blur(al, max(6, w * 0.05)) > 0.35
    cols = np.where(body.any(axis=0))[0]
    top = np.full(w, h, np.int32)
    for x in cols:
        top[x] = int(np.argmax(body[:, x]))
    xs = np.arange(w)
    nz = noise2(w, 1, max(8, w // 9), rng)[0]
    span = max(1, cols.max() - cols.min()) if len(cols) else w
    u = np.clip((xs - (cols.min() if len(cols) else 0)) / span, 0, 1)
    thick = h * (0.14 + 0.2 * amount) * (0.55 + 0.9 * nz) * (0.35 + 0.65 * np.sin(np.pi * u) ** 0.6)
    thick += h * 0.035 * np.sin(xs / w * 38 + rng.random() * 6)
    yy = np.arange(h)[:, None]
    cap = (yy >= top[None, :] - h * 0.012) & (yy < top[None, :] + thick[None, :]) & body
    # drips
    for k in range(int(6 * amount)):
        x0 = int(rng.uniform(0.15, 0.85) * w)
        wd = int(w * rng.uniform(0.015, 0.03))
        ln = int(h * rng.uniform(0.04, 0.1))
        for x in range(max(0, x0 - wd), min(w, x0 + wd)):
            y0 = int(top[x] + thick[x])
            cap[y0:y0 + int(ln * (1 - abs(x - x0) / max(1, wd)) ** 0.5), x] = True
    m = blur(cap.astype(np.float32), max(2, w * 0.006))
    m = np.clip((m - 0.35) / 0.25, 0, 1)
    # pillow shading: lit toward the upper left, blue along its underside
    r = max(3, int(w * 0.02))
    bm = blur(m, r)
    below = np.zeros_like(bm)
    below[:-r] = bm[r:]
    under = np.clip((bm - below) * 2.5, 0, 1)                  # lower edge
    left = np.roll(bm, r, axis=1)
    lit = np.clip((bm - left) * 2.0, 0, 1)
    t = np.clip(0.66 - 0.5 * under + 0.22 * lit + (noise2(w, h, max(6, w // 22), rng) - 0.5) * 0.22, 0, 1)
    mm = m[..., None]
    a[..., :3] = a[..., :3] * (1 - mm) + ramp(SNOW, t) * mm
    a[..., 3] = np.maximum(a[..., 3], m)
    # a thin blue shadow the cap casts on the leaves just under it
    sh = np.zeros_like(m)
    s2 = max(2, int(h * 0.02))
    sh[s2:] = m[:-s2]
    sh = np.clip(sh - m, 0, 1)[..., None] * 0.45
    a[..., :3] = a[..., :3] * (1 - sh) + np.array(rgb('#2a3c5a')) * sh
    return a


def cone_image(s, rng):
    """A violet pollen CATKIN as its own little image (so it can be tilted):
    a soft, slender, tapered tassel on a short stalk, painted as one body
    with a lit left flank and faint scale BANDS, pale lilac at the shoulder
    deepening to violet at the tip. Round-2 review: per-bead highlights read
    as grapes. `s` = length px."""
    W, H = int(s * 0.5) + 8, int(s * 1.2) + 8
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, top = W / 2, 4 + s * 0.1
    d.line([(cx, 2), (cx, top + s * 0.08)], fill=c8(rgb('#3a1f48')), width=max(1, int(s * 0.05)))
    n = 24
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        w0 = s * 0.15 * math.sin(math.pi * (0.08 + 0.92 * t0)) ** 0.55 * (1 - 0.5 * t0)
        w1 = s * 0.15 * math.sin(math.pi * (0.08 + 0.92 * t1)) ** 0.55 * (1 - 0.5 * t1)
        y0, y1 = top + s * t0, top + s * t1
        band = 0.018 * math.sin(i * 1.9)
        base_t = 0.34 + 0.46 * (1 - t0) + band
        # shaded right half, lit left half
        d.polygon([(cx, y0), (cx + w0, y0), (cx + w1, y1), (cx, y1)], fill=c8(ramp1(LILAC, base_t)))
        d.polygon([(cx - w0, y0), (cx, y0), (cx, y1), (cx - w1, y1)], fill=c8(ramp1(LILAC, min(1, base_t + 0.16))))
    return im


def paint_cones(a, rng, n, seat, size_fn, tilt=12):
    """Seat `n` cones where `seat(x, y)` allows, on a layer over `a`."""
    h, w = a.shape[:2]
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    placed = tries = 0
    while placed < n and tries < 8000:
        tries += 1
        x, y = rng.uniform(0.1, 0.92) * w, rng.uniform(0.08, 0.9) * h
        if not seat(int(x), int(y)):
            continue
        k = 2 if rng.random() < 0.35 else 1          # the odd pair
        for j in range(k):
            ci = cone_image(size_fn(x, y), rng)
            attach(layer, ci, x + j * ci.width * 0.55, y + j * 4, rng.uniform(-tilt, tilt), 'top')
        placed += 1
    la = arr(layer)
    m = la[..., 3:4]
    a[..., :3] = a[..., :3] * (1 - m) + la[..., :3] * m
    a[..., 3] = np.maximum(a[..., 3], la[..., 3])
    return a


def add_pollen_side(a, rng, amount):
    """Violet pollen cones hanging under the sprays plus a lilac dusting on
    the brightest needle tips. Violet is the Deepglass accent (root bark,
    Warden rune glass), so a pollen pine reads as native to the fjord."""
    h, w = a.shape[:2]
    al = a[..., 3] > 0.5
    L = lum(a)
    tip = np.clip((L - 0.38) / 0.3, 0, 1) * al * 0.62 * amount
    a[..., :3] = a[..., :3] * (1 - tip[..., None]) + np.array(rgb('#c49ceb')) * tip[..., None]
    lo = int(h * 0.05)
    # small cones on stalks, hanging, clustered toward the bough TIPS in the
    # upper half of the art (round-1 review: cones strewn over the skirt read
    # as caterpillars and lint)
    a = paint_cones(a, rng, int(17 * amount),
                    lambda x, y: al[y, x] and al[max(0, y - lo), x] and y < h * 0.55 and x > w * 0.36,
                    lambda x, y: h * rng.uniform(0.13, 0.17), tilt=6)
    return a


def plan_bough(seed, stops, snow=0.0, pollen=0.0, sides=3, spread=(34, 52)):
    """A PLAN-VIEW (from above) bough: a leader frond with side fronds swept
    forward off it, like a feather. SPACEY's generated fronds (frondsrc/),
    regraded onto the sheet palette. Anchor top centre, grows down the image.
    This is what a tier's near-horizontal card shows from above and below;
    the side-view card carries the eye-level silhouette."""
    rng = random.Random(seed)
    fr = fronds()
    H = 1800
    canvas = Image.new('RGBA', (H * 2, H + 200), (0, 0, 0, 0))
    ax, ay = H, 60
    for k in range(sides):
        t = 0.1 + 0.62 * k / max(1, sides - 1)
        ln = H * (0.66 - 0.4 * t) * rng.uniform(0.92, 1.06)
        for side in (-1, 1):
            f = fr[rng.randrange(len(fr))]
            fi = f.resize((max(4, int(f.width * ln / f.height * 1.35)), max(4, int(ln))), Image.LANCZOS)
            if rng.random() < 0.5:
                fi = fi.transpose(Image.FLIP_LEFT_RIGHT)
            attach(canvas, fi, ax, ay + H * 0.92 * t, side * rng.uniform(*spread), 'top')
    m = fr[rng.randrange(len(fr))]
    mi = m.resize((max(4, int(m.width * H / m.height * 1.45)), H), Image.LANCZOS)
    attach(canvas, mi, ax, ay, rng.uniform(-3, 3), 'top')
    im, anc = crop_cell(canvas, (ax, ay))
    a = arr(regrade(im, stops, keep=0.18, gamma=1.0))
    a = shade_field(a, lambda x, y: 1.1 - 0.32 * y + 0.1 * (1 - np.abs(x - 0.5) * 2))
    a = volume(a, light=(-0.5, -0.8), strength=0.12, core_dark=0.2)
    if pollen:
        a = add_pollen_plan(a, rng, pollen)
    if snow:
        a = add_snow_plan(a, rng, snow)
    return img(a), anc


def add_snow_plan(a, rng, amount):
    """Snow seen from ABOVE: crisp pillows over the frond bodies where the mass
    is deepest, thinning out toward the needle tips so green shows between
    them; lit on the upper-left rim, blue in the lower-right shadow."""
    h, w = a.shape[:2]
    al = a[..., 3]
    d = blur(al, max(3, w * 0.022))
    body = np.clip((d - 0.42) / 0.4, 0, 1)
    nz = noise2(w, h, max(8, w // 11), rng)
    field = body * (0.45 + 0.9 * nz)
    thr = 1.0 - 0.22 * amount
    m = np.clip((field - thr) / 0.07, 0, 1) * (al > 0.5)
    # close the holes INSIDE each pillow: a dilate-then-erode over the mask
    # (round-3 review: "cow-print / Swiss cheese" snow)
    r_ = max(3, int(w * 0.03))
    closed = blur((blur(m, r_) > 0.18).astype(np.float32), r_)
    m = np.clip(np.maximum(m, (closed > 0.55).astype(np.float32)) * (al > 0.5), 0, 1)
    m = blur(m, 1.2)
    r = max(2, int(w * 0.018))
    bm = blur(m, r)
    upleft = np.roll(np.roll(bm, r, axis=0), r, axis=1)       # value up-left of here
    downright = np.roll(np.roll(bm, -r, axis=0), -r, axis=1)
    lit = np.clip((bm - upleft) * 3.0, 0, 1)                  # upper-left rim
    shadow = np.clip((bm - downright) * 3.0, 0, 1)            # lower-right rim
    t = np.clip(0.62 + 0.3 * lit - 0.5 * shadow - (1 - bm) * 0.15 + (noise2(w, h, max(6, w // 18), rng) - 0.5) * 0.2,
                0, 1)
    a[..., :3] = a[..., :3] * (1 - m[..., None]) + ramp(SNOW, t) * m[..., None]
    L = lum(a)
    frost = np.clip(0.16 * amount * (al > 0.5) * np.clip((L - 0.15) / 0.3, 0, 1), 0, 0.35)[..., None]
    a[..., :3] = a[..., :3] * (1 - frost) + np.array(rgb('#c9dbee')) * frost
    return a


def add_pollen_plan(a, rng, amount):
    """Seen from above a pollen bough is only DUSTED lilac: cones hang under
    the sprays, where the side-view card carries them."""
    al = a[..., 3] > 0.5
    L = lum(a)
    tip = np.clip((L - 0.42) / 0.3, 0, 1) * al * 0.55 * amount
    a[..., :3] = a[..., :3] * (1 - tip[..., None]) + np.array(rgb('#c9a6ec')) * tip[..., None]
    return a


def plan_full(name, stops, seed, snow=0.0, pollen=0.0):
    """A PLAN-VIEW bough built from SPACEY's side-view bough art: the art is
    turned so its stem runs down from the top centre, and a mirrored copy is
    laid against it, so needle sprays fan out on BOTH sides of one stem, a
    full spruce bough seen from above. The v2.0 plan cells were composed of
    thin single fronds and read as fern leaves (round-2 review)."""
    base = src(name)
    rng = random.Random(seed)
    ax_, ay_ = find_anchor_left(base)
    bw, bh = base.size
    # the stem's own slope, from the woody pixels (it runs down-right)
    rgba = np.asarray(base)
    r_, g_, b_ = (rgba[..., i].astype(int) for i in range(3))
    wood = (rgba[..., 3] > 120) & (r_ > g_ + 4) & (r_ > b_ + 8)
    ys, xs = np.nonzero(wood)
    slope = math.degrees(math.atan2(np.polyfit(xs, ys, 1)[0], 1.0)) if len(xs) > 50 else 25.0
    # Turn the art so the stem runs STRAIGHT DOWN from its anchor: `attach`
    # rotates about the anchor (the woody base is the image's left end, so
    # treat that end as the 'top' of a sideways image).
    W = int(bw * 1.6)
    H = int(bw * 1.15)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cx, cy = W / 2, H * 0.03
    # a sideways image whose base is its left edge: pad it so the anchor is
    # the top-centre of a square-ish tile, then rotate
    tile = Image.new('RGBA', (bw * 2, bw * 2), (0, 0, 0, 0))
    tile.alpha_composite(base, (int(bw - ax_ * bw), int(bw - ay_ * bh)))
    # the anchor is now the tile centre; stem heads right at `slope` degrees
    for flip in (True, False):
        t_ = tile.transpose(Image.FLIP_LEFT_RIGHT) if flip else tile
        # rotate so the stem points down (image +y): from `slope` (flip:
        # 180 - slope) to 90 degrees, CCW-on-screen convention. The mirrored
        # half is turned a little further and scaled down, so the bough is
        # not bilaterally symmetric (round-5: "a mirrored notch pattern")
        deg = (slope - 90) if not flip else (90 - slope + rng.uniform(6, 12))
        if flip:
            sc = rng.uniform(0.82, 0.9)
            t_ = t_.resize((int(t_.width * sc), int(t_.height * sc)), Image.LANCZOS)
            pad = Image.new('RGBA', tile.size, (0, 0, 0, 0))
            pad.alpha_composite(t_, (int((tile.width - t_.width) / 2), int((tile.height - t_.height) / 2)))
            t_ = pad
        rt = t_.rotate(deg, resample=Image.BICUBIC, expand=False)
        canvas.alpha_composite(rt, (int(cx - bw), int(cy - bw)))
    im, anc = crop_cell(canvas, (cx, cy))
    a = arr(regrade(im, stops, keep=0.22, gamma=1.02))
    a = shade_field(a, lambda x, y: 1.1 - 0.34 * y + 0.08 * (1 - np.abs(x - 0.5) * 2))
    a = volume(a, light=(-0.5, -0.8), strength=0.12, core_dark=0.22)
    if pollen:
        a = add_pollen_plan(a, rng, pollen)
    if snow:
        a = add_snow_plan(a, rng, snow)
    return img(a), anc


def crown_plume(seed, stops, snow=0.0, pollen=0.0):
    """Upright crown leader: fronds rising from a base at the BOTTOM CENTRE
    (its anchor), a leader straight up and side fronds swept up and out, so a
    pine ends in a sharp spire. The old crown was a hanging bough flipped
    upside down, which put its twig at the bottom RIGHT, sticking out
    sideways, one of the woody ends SPACEY saw."""
    rng = random.Random(seed)
    fr = fronds()
    H = 1800
    canvas = Image.new('RGBA', (H * 2, H + 200), (0, 0, 0, 0))
    ax, ay = H, H + 140
    for k in range(4):
        t = 0.06 + 0.2 * k
        ln = H * (0.62 - 0.5 * t) * rng.uniform(0.92, 1.05)
        for side in (-1, 1):
            f = fr[rng.randrange(len(fr))].transpose(Image.FLIP_TOP_BOTTOM)
            fi = f.resize((max(4, int(f.width * ln / f.height * 1.35)), max(4, int(ln))), Image.LANCZOS)
            attach(canvas, fi, ax, ay - H * 0.88 * t, side * rng.uniform(26, 40), 'bottom')
    lead = fr[rng.randrange(len(fr))].transpose(Image.FLIP_TOP_BOTTOM)
    li = lead.resize((max(4, int(lead.width * H / lead.height * 1.5)), H), Image.LANCZOS)
    attach(canvas, li, ax, ay, 0, 'bottom')
    im, anc = crop_cell(canvas, (ax, ay))
    a = arr(regrade(im, stops, keep=0.18, gamma=1.0))
    a = shade_field(a, lambda x, y: 0.84 + 0.3 * (1 - y))
    a = volume(a, light=(-0.5, -0.8), strength=0.12, core_dark=0.2)
    if snow:
        a = add_snow_side(a, rng, snow * 0.8)
    if pollen:
        a = add_pollen_side(a, rng, pollen * 0.5)
    return img(a), anc


# --------------------------------------------------------------------------
# broadleaf / bloom
def leaf_shape(d, x, y, ang, ln, wd, col_dark, col_lit, rib=True):
    """One painted leaf: an almond with a LIT half and a SHADED half split down
    its midrib (the flat two-tone WoW leaf), base at (x, y), pointing `ang`."""
    ca, sa = math.cos(ang), math.sin(ang)
    px, py = -sa, ca
    n = 7
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        w = wd * math.sin(math.pi * min(1.0, t * 1.08)) ** 0.8 * (1 - 0.25 * t)
        cx, cy = x + ca * ln * t, y + sa * ln * t
        left.append((cx + px * w, cy + py * w))
        right.append((cx - px * w, cy - py * w))
    mid = [(x + ca * ln * i / n, y + sa * ln * i / n) for i in range(n + 1)]
    d.polygon(left + list(reversed(mid)), fill=c8(col_lit))
    d.polygon(right + list(reversed(mid)), fill=c8(col_dark))
    if rib:
        d.line([mid[0], mid[-2]], fill=c8(lerp(col_dark, (0, 0, 0), 0.25)), width=max(1, int(wd * 0.12)))


LIGHT3 = np.array([-0.45, -0.7, 0.55])
LIGHT3 = LIGHT3 / np.linalg.norm(LIGHT3)


def sphere_shade(dx, dy, wrap=0.35):
    """Lambert on a sphere at normalised (dx, dy) inside a clump, light from
    the upper left and a little toward the viewer; `wrap` keeps the far side
    from going dead."""
    r2 = min(1.0, dx * dx + dy * dy)
    n = np.array([dx, dy, math.sqrt(max(0.0, 1 - r2))])
    return max(0.0, (float(n @ LIGHT3) + wrap) / (1 + wrap))


def blossom(d, x, y, r, rot_, shade, stops, petals=5):
    """A five-petal blossom: rounded petals darker at the throat, a lit rim,
    and a pale pollen centre. Painted flat, in two tones per petal."""
    for k in range(petals):
        a = rot_ + k / petals * math.tau
        px, py = x + math.cos(a) * r * 0.55, y + math.sin(a) * r * 0.55
        pr = r * 0.52
        lit = min(1.0, shade * (1.05 + 0.25 * math.cos(a + 2.2)))
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=c8(ramp1(stops, 0.2 + 0.62 * lit)))
        d.ellipse([px - pr * 0.72 + math.cos(a) * pr * 0.2, py - pr * 0.72 + math.sin(a) * pr * 0.2,
                   px + pr * 0.62 + math.cos(a) * pr * 0.2, py + pr * 0.62 + math.sin(a) * pr * 0.2],
                  fill=c8(ramp1(stops, 0.35 + 0.62 * lit)))
    cr = r * 0.26
    d.ellipse([x - cr, y - cr, x + cr, y + cr], fill=c8(lerp(rgb('#f7e7a8'), rgb('#ffffff'), 0.3 * shade)))
    d.ellipse([x - cr * 0.5, y - cr * 0.6, x + cr * 0.2, y], fill=c8(rgb('#fffbe8')))


def flower_cluster(d, cx, cy, r, stops, base_sh, rng):
    """A soft PANICLE of small four-petal florets, shaded as a little ball of
    its own and by where it sits on the clump. Replaces v1's five-petal disc
    with a white centre per flower, which read as salt-and-pepper noise
    (round-1 review)."""
    n = int(18 + r * 0.22)
    fl = []
    for i in range(n):
        rr = math.sqrt(rng.random())
        a = rng.uniform(0, math.tau)
        fl.append((math.sqrt(max(0.0, 1 - rr * rr)) + rng.uniform(-0.2, 0.2), math.cos(a) * rr,
                   math.sin(a) * rr * 0.85))
    fl.sort(key=lambda v: v[0])
    for z, fx, fy in fl:
        sh = base_sh * (0.6 + 0.55 * sphere_shade(fx, fy, 0.5))
        s_ = r * rng.uniform(0.2, 0.28)
        x, y = cx + fx * r, cy + fy * r
        tone = max(0.1, min(0.88, 0.3 + 0.56 * sh))
        rot_ = rng.uniform(0, math.pi / 2)
        for k in range(4):
            aa = rot_ + k * math.pi / 2
            px, py = x + math.cos(aa) * s_ * 0.32, y + math.sin(aa) * s_ * 0.32
            pr = s_ * 0.42
            d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=c8(ramp1(stops, tone - 0.06)))
        d.ellipse([x - s_ * 0.5, y - s_ * 0.52, x + s_ * 0.12, y + s_ * 0.05], fill=c8(ramp1(stops, tone + 0.07)))


LEAF_SHAPES = {'almond': (1.0, (0.21, 0.28)), 'round': (0.78, (0.4, 0.48)), 'narrow': (1.25, (0.11, 0.15))}


def leaf_clump(seed, stops, leaves=90, flowers=0, flower_stops=LILAC, berries=0, size=1400,
               leaf_len=(0.13, 0.2), squash=1.0, snow=0.0, buds=True, snow_smooth=0, cap=0.0, shape='almond'):
    """A canopy CLOUD: the WoW clump. Leaves radiate from a hidden centre (their
    stems point INWARD, so no wood ever reaches the rim), drawn back to front,
    each shaded by where it sits on an imagined sphere lit from the upper
    left. Flowers come in CLUSTERS on the lit upper half, the way blossom
    reads from across a zone, instead of an even sprinkle."""
    rng = random.Random(seed)
    W = H = size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, R = W / 2, H / 2, W * 0.42
    lmul, wrange = LEAF_SHAPES[shape]
    leaf_len = (leaf_len[0] * lmul, leaf_len[1] * lmul)
    # The buried interior first: a mass of the DARKEST leaves filling the
    # inner three quarters. A clump is a solid ball of foliage whose inside is
    # in shadow; without this the leaves radiate into a hollow wreath.
    for i in range(int(leaves * 0.45)):
        r = math.sqrt(rng.random()) * 0.72
        a = rng.uniform(0, math.tau)
        dx, dy = math.cos(a) * r, math.sin(a) * r * squash
        ln = W * rng.uniform(*leaf_len) * 1.05
        ang = rng.uniform(0, math.tau)
        t = 0.04 + 0.2 * sphere_shade(dx, dy)
        leaf_shape(d, cx + dx * R - math.cos(ang) * ln * 0.5, cy + dy * R - math.sin(ang) * ln * 0.5, ang, ln,
                   ln * 0.3, ramp1(stops, t * 0.8), ramp1(stops, t), rib=False)
    items = []
    for i in range(leaves):
        r = math.sqrt(rng.random())          # uniform over the disc
        a = rng.uniform(0, math.tau)
        dx, dy = math.cos(a) * r, math.sin(a) * r * squash
        # depth on the sphere: centre leaves face the viewer and sit in FRONT
        z = math.sqrt(max(0.0, 1 - r * r)) + rng.uniform(-0.15, 0.15)
        items.append((z, r, dx, dy, a))
    items.sort(key=lambda v: v[0])           # back (rim) to front (centre)
    for z, r, dx, dy, a in items:
        sh = sphere_shade(dx, dy) * rng.uniform(0.88, 1.08)
        ln = W * rng.uniform(*leaf_len) * (0.85 + 0.25 * r)
        # rim leaves point OUT (the scalloped silhouette), face-on centre
        # leaves point anywhere; their stems always point back into the mass
        radial = min(1.0, max(0.0, (r - 0.35) / 0.45))
        ang = a * radial + rng.uniform(0, math.tau) * (1 - radial) + rng.uniform(-0.5, 0.5)
        bx, by = cx + dx * R - math.cos(ang) * ln * 0.5, cy + dy * R - math.sin(ang) * ln * 0.5
        t = 0.1 + 0.8 * sh
        dark = ramp1(stops, max(0.0, t - 0.17))
        lit = ramp1(stops, min(1.0, t + 0.07))
        leaf_shape(d, bx, by, ang, ln, ln * rng.uniform(*wrange) * (1.15 - 0.2 * r), dark, lit)
    if flowers:
        # CLUSTERS on the lit upper half, big enough to read across a zone
        cl = []
        # SMALL clusters (SPACEY, 2026-09-24: "make the purple smaller so they
        # take up less of the green leaves and dont look as over the top")
        for k in range(max(1, flowers // 18)):
            a = rng.uniform(math.pi * 0.9, math.pi * 2.3)
            r = rng.uniform(0.12, 0.78)
            cl.append((math.cos(a) * r, math.sin(a) * r * squash, W * rng.uniform(0.06, 0.09)))
        cl.sort(key=lambda v: -(v[0] ** 2 + v[1] ** 2))
        for fx, fy, rr in cl:
            flower_cluster(d, cx + fx * R, cy + fy * R, rr, flower_stops,
                           sphere_shade(fx, fy) * rng.uniform(0.92, 1.08), rng)
    if berries:
        for k in range(max(1, berries // 5)):
            a = rng.uniform(0, math.tau)
            r = rng.uniform(0.2, 0.82)
            bx0, by0 = math.cos(a) * r, math.sin(a) * r * squash
            for j in range(rng.randint(3, 6)):
                fx, fy = bx0 + rng.gauss(0, 0.07), by0 + rng.gauss(0, 0.07)
                if fx * fx + fy * fy > 0.9:
                    continue
                sh = sphere_shade(fx, fy)
                berry(d, cx + fx * R, cy + fy * R, W * rng.uniform(0.022, 0.03), sh)
    a = arr(im)
    a = volume(a, light=(-0.45, -0.9), strength=0.3, core_dark=0.12)
    if snow:
        a = add_snow_side(a, rng, snow, smooth=snow_smooth)
    if cap:
        a = add_snow_cap(a, rng, cap)
    return crop_cell(img(a), (cx, cy))


def berry(d, x, y, r, sh):
    d.ellipse([x - r, y - r, x + r, y + r], fill=c8(ramp1(BERRY, 0.15 + 0.35 * sh)))
    d.ellipse([x - r * 0.85, y - r * 0.9, x + r * 0.55, y + r * 0.45], fill=c8(ramp1(BERRY, 0.35 + 0.45 * sh)))
    hr = r * 0.28
    d.ellipse([x - r * 0.5 - hr, y - r * 0.5 - hr, x - r * 0.5 + hr, y - r * 0.5 + hr],
              fill=c8(lerp(rgb('#ffd6d0'), rgb('#ffffff'), 0.5)))


def floret(d, x, y, r, col, lit, keel, facing):
    """A pea-flower floret (wisteria): a WIDE, flattened standard petal
    that overlaps its neighbours (so a raceme reads as one tapering mass, not
    a string of beads, round-4 review), a lit upper edge, and the darker keel
    tucked under it."""
    d.ellipse([x - r * 1.35, y - r * 0.55, x + r * 1.35, y + r * 0.6], fill=c8(col))
    d.ellipse([x - r * 1.1 + facing * r * 0.1, y - r * 0.55, x + r * 0.9 + facing * r * 0.1, y - r * 0.05],
              fill=c8(lit))
    d.ellipse([x - r * 0.5, y + r * 0.15, x + r * 0.5, y + r * 0.75], fill=c8(keel))


def wisteria(seed, stops=LILAC, strands=3, size=1600):
    """Hanging wisteria racemes: dense tapering cones of pea-florets, pale at
    the top and deepening to violet at the tip, lit from the left. The strands
    share one top, where a few leaves seat them on their branch. Anchor top
    centre, grows down the image."""
    rng = random.Random(seed)
    W, H = int(size * 0.8), size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ax, ay = W / 2, H * 0.03
    specs = []
    for s_ in range(strands):
        off = (s_ - (strands - 1) / 2) * W * 0.21 + rng.uniform(-W * 0.03, W * 0.03)
        ln = H * rng.uniform(0.74, 0.93) * (1.0 if s_ == strands // 2 else 0.84)
        specs.append((abs(off), off, ln))
    specs.sort(key=lambda v: -v[0])   # outer strands behind
    for _, off, ln in specs:
        sway = rng.uniform(-0.05, 0.05) * W
        pts = []
        for i in range(80):
            t = i / 79
            x = ax + off * min(1.0, 0.25 + t * 4) + sway * t * t
            y = ay + H * 0.04 + ln * t
            pts.append((x, y))
        # a green-violet stalk, not wood: it is the raceme's own axis, and it
        # is buried in florets for all but its first few percent
        d.line(pts[:12], fill=c8(rgb('#3b4236')), width=max(2, int(W * 0.007)))
        n = int(260 * ln / H)
        florets = []
        for i in range(n):
            t = 0.06 + 0.94 * (i + rng.random()) / n
            x, y = pts[min(79, int(t * 79))]
            half = W * (0.085 * (1 - t) ** 0.75 + 0.012)
            u = rng.uniform(-1, 1)
            florets.append((rng.random(), t, x + u * half, y + rng.uniform(-4, 4), u))
        florets.sort(key=lambda v: v[0])
        for depth, t, fx, fy, u in florets:
            sh = min(1.0, max(0.0, 0.62 - 0.32 * u + 0.25 * (depth - 0.5)))
            tone = (0.28 + 0.62 * (1 - t) ** 0.85) * (0.62 + 0.5 * sh)
            r = W * (0.036 * (1 - t * 0.6)) * rng.uniform(0.85, 1.12)
            floret(d, fx, fy, r, ramp1(stops, min(1, tone)), ramp1(stops, min(1, tone + 0.2)),
                   ramp1(stops, max(0.03, tone - 0.22)), -u)
    for k in range(16):
        ang = math.pi / 2 + rng.uniform(-1.5, 1.5)
        ln = W * rng.uniform(0.11, 0.19)
        sh = rng.uniform(0.4, 0.95)
        leaf_shape(d, ax + rng.uniform(-W * 0.1, W * 0.1), ay + rng.uniform(0, H * 0.04), ang, ln,
                   ln * 0.25, ramp1(LEAF_DEEP, 0.2 + 0.5 * sh), ramp1(LEAF_DEEP, 0.35 + 0.6 * sh))
    a = arr(im)
    a = volume(a, light=(-0.6, -0.6), strength=0.22, core_dark=0.12)
    return crop_cell(img(a), (ax, ay))


def fern_frond(seed, stops=FERN, size=1800, snow=0.0):
    """A fern frond seen from above, anchored at its base (top centre) and
    running down the image: a rachis with paired pinnae swept FORWARD, length
    swelling then tapering to the tip, separated by gaps so each reads. A
    pinna is a narrow serrated leaf in two tones (lit side / shaded side)."""
    rng = random.Random(seed)
    W, H = int(size * 0.8), size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ax, ay = W / 2, H * 0.02
    n = 11
    bend = rng.uniform(-0.12, 0.12)
    rach = [(ax + math.sin(t * 2.0) * bend * W, ay + H * 0.96 * t) for t in (i / 60 for i in range(61))]
    d.line(rach, fill=c8(ramp1(stops, 0.3)), width=max(3, int(W * 0.014)))
    pinnae = []
    for i in range(n):
        t = 0.15 + 0.81 * i / (n - 1)
        x, y = rach[int(t * 60)]
        env = math.sin(math.pi * min(1.0, 0.05 + t * 0.95)) ** 0.9 * (1 - 0.45 * t)
        ln = max(W * 0.08, W * 0.42 * env * rng.uniform(0.92, 1.06))
        for side in (-1, 1):
            ang = math.pi / 2 - side * (1.25 - 0.55 * t) + rng.uniform(-0.06, 0.06)
            pinnae.append((t, x, y, ang, ln, side))
    for t, x, y, ang, ln, side in pinnae:
        sh = 0.55 + 0.3 * (1 - t) + (0.12 if side < 0 else -0.1)
        # a pinna as ONE soft lobed shape: a scalloped outline (the
        # leaflets implied by the edge) filled in two close tones. Separate
        # leaflets tiled into fish scales / chain mail (round-4 and -5).
        m = 16
        left, right, mid = [], [], []
        for j in range(m + 1):
            u = j / m
            bend = 0.22 * u * u * (1 if side > 0 else -1)
            cx_ = x + (math.cos(ang) * u - math.sin(ang) * bend) * ln
            cy_ = y + (math.sin(ang) * u + math.cos(ang) * bend) * ln
            w = max(ln * 0.035, ln * 0.14 * (1 - u) ** 0.75) * (0.72 + 0.28 * abs(math.sin(u * math.pi * 5.5)))
            px, py = -math.sin(ang), math.cos(ang)
            mid.append((cx_, cy_))
            left.append((cx_ + px * w, cy_ + py * w))
            right.append((cx_ - px * w, cy_ - py * w))
        tone = sh
        up_c = ramp1(stops, min(1.0, 0.24 + 0.6 * tone))
        dn_c = ramp1(stops, max(0.02, 0.18 + 0.55 * tone))
        up, dn = (left, right) if side < 0 else (right, left)
        d.polygon(up + list(reversed(mid)), fill=c8(up_c))
        d.polygon(dn + list(reversed(mid)), fill=c8(dn_c))
    a = arr(im)
    a = volume(a, light=(-0.5, -0.8), strength=0.25, core_dark=0.1)
    if snow:
        a = add_snow_plan(a, rng, snow)
    return crop_cell(img(a), (ax, ay))


# --------------------------------------------------------------------------
# grass
def blade(d, x0, y0, ln, wd, lean, curl, dark_t, stops, split=True, tip_col=None, kink=None):
    """One grass blade from (x0, y0) upward: an even strap that tapers only in
    its last third, curving as it rises (and optionally KINKED over, the bent
    blade every real tuft has), in TWO tones split down its length (lit edge /
    shaded edge), graded from a dark root to a light tip."""
    n = 14
    pts = []
    x, y, a = x0, y0, -math.pi / 2 + lean
    for i in range(n + 1):
        pts.append((x, y))
        t = i / n
        a += curl / n * (0.4 + 1.2 * t)       # curls more as it rises
        if kink and abs(t - kink[0]) < 0.5 / n:
            a += kink[1]
        x += math.cos(a) * ln / n
        y += math.sin(a) * ln / n
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        dx, dy = xb - xa, yb - ya
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        w0 = wd * (1 - t0 ** 2.2) ** 0.75
        w1 = wd * (1 - t1 ** 2.2) ** 0.75
        tt = dark_t + (1 - dark_t) * (t0 + t1) / 2
        # a SOFT split: v1's lit half was so much lighter it read as a white
        # midrib on every blade (round-1 review)
        lit = ramp1(stops, min(1, tt * 0.86 + 0.08))
        shd = ramp1(stops, max(0, tt * 0.76 + 0.01))
        if tip_col is not None and t0 > 0.78:
            f = (t0 - 0.78) / 0.22
            lit, shd = lerp(lit, tip_col, f * 0.9), lerp(shd, tip_col, f * 0.65)
        d.polygon([(xa + nx * w0, ya + ny * w0), (xb + nx * w1, yb + ny * w1), (xb, yb), (xa, ya)], fill=c8(lit))
        d.polygon([(xa, ya), (xb, yb), (xb - nx * w1, yb - ny * w1), (xa - nx * w0, ya - ny * w0)], fill=c8(shd))
    return pts[-1]


def grass_tuft(seed, stops=GRASS, blades=34, size=1400, tall=1.0, flowers=0, seeds=0, snow=0.0,
               spread=0.55, width=(0.014, 0.024), curl_mul=1.0):
    """A grass tuft like SPACEY's reference: blades fanned from ONE root at the
    bottom centre (the anchor), the long ones arching outward, back blades
    darker than front ones, every blade dark at the root and light at the
    tip."""
    rng = random.Random(seed)
    W, H = size, size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ax, ay = W / 2, H * 0.985
    specs = []
    for i in range(blades):
        f = rng.uniform(-1, 1)
        lean = f * spread + rng.uniform(-0.12, 0.12)
        ln = H * tall * rng.uniform(0.42, 0.95) * (1 - 0.28 * abs(f))
        # outer blades arch out and over; the middle ones stay upright
        curl = (f * rng.uniform(0.5, 1.5) + rng.uniform(-0.15, 0.15)) * curl_mul
        kink = (rng.uniform(0.45, 0.75), (1 if f > 0 else -1) * rng.uniform(0.5, 1.0)) \
            if rng.random() < 0.16 else None
        depth = rng.random()           # 0 back, 1 front
        specs.append((depth, lean, ln, curl, kink))
    specs.sort(key=lambda v: v[0])
    tips = []
    for depth, lean, ln, curl, kink in specs:
        x0 = ax + rng.uniform(-W * 0.035, W * 0.035) + lean * W * 0.03
        tipc = rgb('#f4f8ff') if snow else None
        tip = blade(d, x0, ay, ln, W * rng.uniform(*width), lean, curl,
                    0.06 + 0.3 * depth, stops, tip_col=tipc, kink=kink)
        tips.append((tip, ln))
    for k in range(seeds):
        # a seed stalk from the ROOT, standing above the blades and nodding
        # over at the head: the arching seed heads of a tall grass
        lean = rng.uniform(-0.45, 0.45)
        ln = H * tall * rng.uniform(0.85, 0.98)
        pts = []
        x, y, a = ax + rng.uniform(-W * 0.02, W * 0.02), ay, -math.pi / 2 + lean * 0.6
        for i in range(13):
            pts.append((x, y))
            a += lean * 0.12
            x += math.cos(a) * ln / 12
            y += math.sin(a) * ln / 12
        d.line(pts, fill=c8(ramp1(GRASS_DRY, 0.35)), width=max(4, int(W * 0.02)))
        d.line(pts, fill=c8(ramp1(GRASS_DRY, 0.6)), width=max(3, int(W * 0.012)))
        hx, hy = pts[-1]
        # an OAT PANICLE: a short straight rachis with spikelets hanging off
        # it on thread-thin pedicels (round-2 review: the curled heads read as
        # question marks)
        dirx = 1 if lean > 0 else -1
        for g in range(7):
            t = g / 6
            px, py = hx + dirx * W * 0.03 * t, hy - H * 0.05 * (1 - t)
            for sgn in (-1, 1):
                ex_, ey_ = px + sgn * W * 0.02, py + H * 0.03
                d.line([(px, py), (ex_, ey_)], fill=c8(ramp1(GRASS_DRY, 0.6)), width=max(1, int(W * 0.002)))
                r = W * 0.008
                d.ellipse([ex_ - r * 0.7, ey_ - r * 0.5, ex_ + r * 0.7, ey_ + r * 1.9], fill=c8(ramp1(GRASS_DRY, 0.55)))
                d.ellipse([ex_ - r * 0.6, ey_ - r * 0.4, ex_ + r * 0.1, ey_ + r * 1.4], fill=c8(ramp1(GRASS_DRY, 0.85)))
    for k in range(flowers):
        (tx, ty), ln = tips[rng.randrange(len(tips))]
        ex, ey = tx + rng.uniform(-W * 0.05, W * 0.05), ty - H * rng.uniform(0.04, 0.12)
        # the stem runs all the way down to the ROOT: a flower must never
        # float beside the blades (round-1 review)
        bx = ax + rng.uniform(-W * 0.02, W * 0.02)
        mid = ((bx + ex) / 2 + rng.uniform(-W * 0.03, W * 0.03), (ay + ey) / 2)
        d.line([(bx, ay), mid, (ex, ey)], fill=c8(ramp1(stops, 0.45)), width=max(3, int(W * 0.009)))
        flower_cluster(d, ex, ey, W * rng.uniform(0.05, 0.065), LILAC, rng.uniform(0.8, 1.0), rng)
    # snow: frost on the blade TIPS only (tip colour above); the root and the
    # inner blades stay dark (round-1 review: "a cotton ball at the base")
    a = arr(im)
    return crop_cell(img(a), (ax, ay))


def snow_top(seed):
    """The crown of a snow-buried bush seen from above/at an angle: a leaf
    clump under deep, LUMPY snow pillows with a blue-grey shade side and
    green showing only in the creases (round-3 review: flat white "paper
    napkin" cards)."""
    im, anc = leaf_clump(seed, LEAF_COLD, leaves=100, leaf_len=(0.12, 0.18))
    a = arr(im)
    a = add_snow_plan(a, random.Random(seed), 1.9)
    # the lower half of the cap in blue-grey shade (round-5: "flat napkin")
    h = a.shape[0]
    g = np.clip((np.linspace(0, 1, h) - 0.35) / 0.65, 0, 1)[:, None, None] * 0.38
    L = lum(a)[..., None]
    snowy = np.clip((L - 0.6) / 0.2, 0, 1)
    a[..., :3] = a[..., :3] * (1 - g * snowy) + np.array(rgb('#7d93b6')) * (g * snowy)
    return img(a), anc


def heather_tuft(seed, stems=22, size=1400, stops=HEATHER):
    """Heather: many fine upright stems from one root, needle leaves ticking
    along them and BELL SPIKES of tiny pink-lilac florets on their upper
    third, not the hydrangea balls of v1 (round-1 review). Anchor bottom
    centre."""
    rng = random.Random(seed)
    W = H = size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ax, ay = W / 2, H * 0.985
    specs = sorted(((rng.random(), rng.uniform(-1, 1)) for _ in range(stems)), key=lambda v: v[0])
    for depth, f in specs:
        lean = f * 0.55
        ln = H * rng.uniform(0.55, 0.95) * (1 - 0.25 * abs(f))
        pts = []
        x, y, a = ax + rng.uniform(-W * 0.04, W * 0.04), ay, -math.pi / 2 + lean
        for i in range(11):
            pts.append((x, y))
            a += f * 0.04
            x += math.cos(a) * ln / 10
            y += math.sin(a) * ln / 10
        tone = 0.35 + 0.5 * depth
        d.line(pts, fill=c8(ramp1(LEAF_DEEP, 0.12 + 0.25 * depth)), width=max(3, int(W * 0.011)))
        for i in range(1, 10):
            px, py = pts[i]
            t = i / 10
            for sgn in (-1, 1):
                l2 = W * 0.028 * (1 - 0.4 * t)
                leaf_shape(d, px, py, -math.pi / 2 + lean + sgn * 0.9, l2, l2 * 0.3,
                           ramp1(LEAF_DEEP, 0.15 + 0.35 * depth), ramp1(LEAF_DEEP, 0.3 + 0.45 * depth), rib=False)
            if t > 0.55:
                for sgn in (-1, 1):
                    bx, by = px + sgn * W * 0.012, py + rng.uniform(-3, 3)
                    r = W * 0.026 * (1.15 - 0.4 * (t - 0.55) / 0.45)
                    sh = min(1.0, tone + (0.12 if sgn < 0 else -0.08) + 0.2 * (t - 0.55))
                    # a bell: flared mouth down, lit shoulder
                    bell = [(bx - r * 0.55, by - r * 1.1), (bx + r * 0.55, by - r * 1.1), (bx + r * 1.0, by + r * 0.6),
                            (bx + r * 0.4, by + r * 0.9), (bx - r * 0.4, by + r * 0.9), (bx - r * 1.0, by + r * 0.6)]
                    d.polygon(bell, fill=c8(ramp1(stops, 0.2 + 0.6 * sh)))
                    d.polygon(bell[:3] + [(bx, by + r * 0.3)], fill=c8(ramp1(stops, min(1, 0.32 + 0.6 * sh))))
        tx, ty = pts[-1]
        r = W * 0.011
        d.ellipse([tx - r, ty - r * 1.4, tx + r, ty + r * 0.6], fill=c8(ramp1(stops, 0.3 + 0.55 * tone)))
    a = arr(im)
    a = volume(a, light=(-0.5, -0.8), strength=0.18, core_dark=0.12)
    return crop_cell(img(a), (ax, ay))


def leaf_spray(seed, stems=9, size=1400, stops=LEAF):
    """An upright SPRAY of leafy stems from one root (a tuft that is not a
    ball): each stem arches out carrying alternate leaves that grow toward the
    tip, ending in a terminal leaf. Anchor bottom centre."""
    rng = random.Random(seed)
    W = H = size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ax, ay = W / 2, H * 0.985
    specs = sorted(((rng.random(), (k / max(1, stems - 1)) * 2 - 1) for k in range(stems)), key=lambda v: v[0])
    for depth, f in specs:
        f += rng.uniform(-0.12, 0.12)
        lean = f * 0.7
        ln = H * rng.uniform(0.6, 0.9) * (1 - 0.2 * abs(f))
        pts = []
        x, y, a = ax + rng.uniform(-W * 0.02, W * 0.02), ay, -math.pi / 2 + lean * 0.7
        for i in range(9):
            pts.append((x, y))
            a += f * 0.09
            x += math.cos(a) * ln / 8
            y += math.sin(a) * ln / 8
        d.line(pts, fill=c8(ramp1(stops, 0.22 + 0.2 * depth)), width=max(2, int(W * 0.007)))
        for i in range(2, 9):
            px, py = pts[i]
            t = i / 8
            sgn = 1 if i % 2 else -1
            la = a + sgn * rng.uniform(0.7, 1.0)
            l2 = W * (0.06 + 0.09 * t) * rng.uniform(0.55, 1.45)
            sh = (0.2 + 0.45 * depth) * (0.45 + 0.75 * t) + (0.1 if sgn < 0 else -0.05)
            leaf_shape(d, px, py, la, l2, l2 * 0.3, ramp1(stops, max(0.02, 0.1 + 0.55 * sh)),
                       ramp1(stops, min(1.0, 0.25 + 0.65 * sh)))
        tx, ty = pts[-1]
        l2 = W * 0.16
        leaf_shape(d, tx, ty, a, l2, l2 * 0.3, ramp1(stops, 0.2 + 0.4 * depth), ramp1(stops, 0.4 + 0.5 * depth))
    a = arr(im)
    # the lower leaves sit in their own shade
    a = shade_field(a, lambda x, y: 0.55 + 0.5 * (1 - y) ** 0.8)
    a = volume(a, light=(-0.5, -0.8), strength=0.18, core_dark=0.12)
    return crop_cell(img(a), (ax, ay))


def moss_mat(seed, size=1500, stops=LEAF):
    """A creeping mat for rock edges: a cushion of small round leaves at the
    anchor (top centre) with trailing strands fanning DOWN from it, each a
    chain of leaves shrinking toward its tip. Drawn on a card that drapes over
    a ledge."""
    rng = random.Random(seed)
    W, H = size, size
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ax, ay = W / 2, H * 0.03
    strands = 11
    for k in range(strands):
        f = (k / (strands - 1)) * 2 - 1
        ang = math.pi / 2 + f * 0.85 + rng.uniform(-0.1, 0.1)
        ln = H * rng.uniform(0.55, 0.92) * (1 - 0.25 * abs(f))
        x, y, a = ax + f * W * 0.12, ay + H * 0.08, ang
        # the strand's own stem first, so every leaf on it is joined to the
        # cushion (unjoined leaves are pruned as floating islands)
        pts = [(ax, ay + H * 0.05), (x, y)]
        for i in range(16):
            a += rng.uniform(-0.12, 0.12)
            x += math.cos(a) * ln / 15
            y += math.sin(a) * ln / 15
            pts.append((x, y))
        d.line(pts, fill=c8(ramp1(stops, 0.18)), width=max(3, int(W * 0.008)))
        x, y, a = pts[1][0], pts[1][1], ang
        for i in range(16):
            t = i / 15
            x, y = pts[i + 2]
            for sgn in (-1, 1):
                la = a + sgn * rng.uniform(0.9, 1.4)
                l2 = W * 0.045 * (1 - 0.55 * t) * rng.uniform(0.85, 1.1)
                sh = 0.35 + 0.45 * (1 - t) + (0.12 if sgn < 0 else -0.05)
                leaf_shape(d, x, y, la, l2, l2 * 0.42, ramp1(stops, max(0.02, 0.06 + 0.5 * sh)),
                           ramp1(stops, min(1.0, 0.2 + 0.62 * sh)), rib=False)
    for i in range(90):
        r = math.sqrt(rng.random())
        a = rng.uniform(0, math.tau)
        x, y = ax + math.cos(a) * r * W * 0.2, ay + H * 0.1 + math.sin(a) * r * H * 0.1
        l2 = W * rng.uniform(0.04, 0.06)
        sh = 0.5 + 0.4 * sphere_shade(math.cos(a) * r, math.sin(a) * r)
        leaf_shape(d, x, y, rng.uniform(0, math.tau), l2, l2 * 0.45, ramp1(stops, 0.1 + 0.5 * sh),
                   ramp1(stops, 0.25 + 0.6 * sh), rib=False)
    a = arr(im)
    a = volume(a, light=(-0.5, -0.8), strength=0.15, core_dark=0.1)
    return crop_cell(img(a), (ax, ay))


# --------------------------------------------------------------------------
# cells, sheets, packing
def crop_cell(im, anchor_px, margin=0.03):
    """Crop to the art (plus a margin, so the atlas border fade never slices
    paint) and express the anchor as a fraction of the crop."""
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 8)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    m = int(max(x1 - x0, y1 - y0) * margin)
    x0, y0 = max(0, x0 - m), max(0, y0 - m)
    x1, y1 = min(im.width, x1 + m), min(im.height, y1 + m)
    ax, ay = anchor_px
    return im.crop((x0, y0, x1, y1)), ((ax - x0) / (x1 - x0), (ay - y0) / (y1 - y0))


def warp_bough(im, anchor, mode):
    """Make a second bough SHAPE from the same painting (round-3 review: the
    re-tinted twins read as the same bough, so every stand looked cloned).
    'upswept': columns rise toward the tip, so the bough lifts and the sprays
    splay (a young, springy bough). 'heavy': the sprays are stretched down
    and a lower layer is added, so the bough sags and reads broad and full."""
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    out = np.zeros_like(a)
    ax, ay = anchor[0] * w, anchor[1] * h
    xs = np.arange(w)
    if mode == 'upswept':
        f = np.clip((xs - ax) / max(1.0, w - ax), 0, 1)
        shift = (-(f ** 1.5) * h * 0.34).astype(np.int32)
        for x in range(w):
            sft = shift[x]
            if sft < 0:
                out[:h + sft, x] = a[-sft:, x]
            else:
                out[:, x] = a[:, x]
        # thin it: drop every third needle spray column band
        return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)), anchor
    # heavy: stretch below the stem line and lay a second, lower copy under it
    big = im.resize((w, int(h * 1.28)), Image.LANCZOS)
    canvas = Image.new('RGBA', (w, int(h * 1.38)), (0, 0, 0, 0))
    under = big.resize((int(w * 0.9), int(big.height * 0.85)), Image.LANCZOS)
    canvas.alpha_composite(under, (int(w * 0.07), int(h * 0.3)))
    canvas.alpha_composite(big, (0, 0))
    return canvas, (anchor[0], anchor[1] / 1.38)


SNOW_TAG_ALPHA = 0.66


def snow_tagged(snowy, green):
    """Tag a snow cell's snow pixels in its ALPHA: 0.66 instead of 1.0. Both
    are over the 0.5 cutout, so nothing changes in how the card draws, but the
    shader can now tell snow from needles exactly (foliage_edge_fade.ts: snow
    seen from below turns to underside green). A colour heuristic missed the
    blue-grey shaded snow (round-9 review). The mask is the difference
    between the snowy cell and its green twin, painted from the same art."""
    (im, anc), (g, _) = snowy, green
    a, b = arr(im), arr(g)
    if a.shape != b.shape:
        b = arr(g.resize(im.size, Image.LANCZOS))
    diff = np.abs(a[..., :3] - b[..., :3]).max(-1)
    tag = (diff > 0.09) & (a[..., 3] > 0.5)
    a[..., 3] = np.where(tag, SNOW_TAG_ALPHA, a[..., 3])
    return img(a), anc


def side_cell(name, stops, seed, warp=None, **kw):
    im, anc = side_bough(name, stops, seed, **kw)
    if warp:
        im, anc = warp_bough(im, anc, warp)
    # side boughs came from a crop already; add the margin
    pad = int(max(im.size) * 0.03)
    big = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    big.alpha_composite(im, (pad, pad))
    return big, ((anc[0] * im.width + pad) / big.width, (anc[1] * im.height + pad) / big.height)


# name -> (builder, axis). Each sheet is a list of (cell, slot) where slot is
# (x, y, w, h) in 0..1 of the sheet.
def sheets():
    """Each sheet is a list of (cell, painter, axis, slot, back). `slot` is
    (x, y, w, h) in 0..1 of the sheet; `back` names the cell a card's BACK
    face shows (snow boughs show their green twin from below: snow lies on
    top of a branch, never under it)."""
    S = {}
    # PINE: green conifers, root giants, pollen pines. Four bough variants
    # (two sources x fresh/old growth) so no two tiers repeat.
    S['dg_fol_pine'] = [
        ('side_a', lambda: side_cell('bough_1', PINE, 11), 'right', (0.0, 0.0, 0.5, 0.24), None),
        ('side_b', lambda: side_cell('bough_3', PINE, 12), 'right', (0.5, 0.0, 0.5, 0.24), None),
        ('side_c', lambda: side_cell('bough_1', PINE_WARM, 15, warp='upswept'), 'right', (0.0, 0.24, 0.5, 0.24),
         None),
        ('side_d', lambda: side_cell('bough_3', PINE_BLUE, 16, warp='heavy'), 'right', (0.5, 0.24, 0.5, 0.24), None),
        ('side_pollen', lambda: side_cell('bough_1', PINE, 13, pollen=1.0), 'right', (0.0, 0.48, 0.5, 0.24), None),
        ('side_pollen_b', lambda: side_cell('bough_3', PINE_WARM, 14, pollen=1.0), 'right',
         (0.5, 0.48, 0.5, 0.24), None),
        ('plan_a', lambda: plan_full('bough_1', PINE, 21), 'down', (0.0, 0.72, 0.2, 0.28), None),
        ('plan_b', lambda: plan_full('bough_3', PINE_BLUE, 22), 'down', (0.2, 0.72, 0.2, 0.28), None),
        ('plan_c', lambda: plan_full('bough_1', PINE_WARM, 24), 'down', (0.4, 0.72, 0.2, 0.28), None),
        ('plan_pollen', lambda: plan_full('bough_3', PINE, 23, pollen=1.0), 'down', (0.6, 0.72, 0.2, 0.28), None),
        ('crown', lambda: crown_plume(31, PINE), 'up', (0.8, 0.72, 0.2, 0.28), None),
    ]
    # SNOW: the frosted conifers. Each snow bough has a green COLD twin at half
    # size, painted from the same art and crop, for its back face.
    S['dg_fol_snow'] = [
        ('side_snow_a', lambda: snow_tagged(side_cell('bough_1', PINE_COLD, 41, snow=1.3),
                                            side_cell('bough_1', PINE_COLD, 41)), 'right', (0.0, 0.0, 0.5, 0.28),
         'side_cold_a'),
        ('side_snow_b', lambda: snow_tagged(side_cell('bough_3', PINE_COLD, 42, snow=1.15),
                                            side_cell('bough_3', PINE_COLD, 42)), 'right', (0.5, 0.0, 0.5, 0.28),
         'side_cold_b'),
        ('side_frost', lambda: snow_tagged(side_cell('bough_3', PINE_COLD, 43, snow=0.55),
                                           side_cell('bough_3', PINE_COLD, 43)), 'right', (0.0, 0.28, 0.5, 0.28),
         'side_cold_b'),
        ('side_cold_a', lambda: side_cell('bough_1', PINE_COLD, 41), 'right', (0.5, 0.28, 0.25, 0.14), None),
        ('side_cold_b', lambda: side_cell('bough_3', PINE_COLD, 42), 'right', (0.75, 0.28, 0.25, 0.14), None),
        ('plan_cold_a', lambda: plan_full('bough_1', PINE_COLD, 46), 'down', (0.5, 0.42, 0.125, 0.14), None),
        ('plan_cold_b', lambda: plan_full('bough_3', PINE_COLD, 47), 'down', (0.625, 0.42, 0.125, 0.14), None),
        ('plan_snow_a', lambda: plan_full('bough_1', PINE_COLD, 46, snow=0.95), 'down', (0.0, 0.56, 0.3, 0.44),
         'plan_cold_a'),
        ('plan_snow_b', lambda: plan_full('bough_3', PINE_COLD, 47, snow=0.8), 'down', (0.3, 0.56, 0.3, 0.44),
         'plan_cold_b'),
        ('crown_snow', lambda: snow_tagged(crown_plume(49, PINE_COLD, snow=1.2), crown_plume(49, PINE_COLD)), 'up',
         (0.6, 0.56, 0.2, 0.44), 'crown_cold'),
        ('crown_cold', lambda: crown_plume(49, PINE_COLD), 'up', (0.8, 0.56, 0.2, 0.44), None),
    ]
    # BLOOM: violet-flowering broadleaf trees and flowering shrubs, three
    # blossom colours and leaf-only cells for the undersides of the clouds.
    S['dg_fol_bloom'] = [
        ('bloom_a', lambda: leaf_clump(51, LEAF_DEEP, leaves=110, flowers=130), 'centre', (0.0, 0.0, 0.25, 0.25), None),
        ('bloom_b', lambda: leaf_clump(52, LEAF_DEEP, leaves=110, flowers=130, flower_stops=LILAC_PINK), 'centre',
         (0.25, 0.0, 0.25, 0.25), None),
        ('bloom_c', lambda: leaf_clump(53, LEAF_DEEP, leaves=110, flowers=130, flower_stops=LILAC_PALE), 'centre',
         (0.5, 0.0, 0.25, 0.25), None),
        ('bloom_dense', lambda: leaf_clump(54, LEAF_DEEP, leaves=100, flowers=160), 'centre', (0.75, 0.0, 0.25, 0.25),
         None),
        ('leaf_a', lambda: leaf_clump(55, LEAF_DEEP, leaves=125), 'centre', (0.0, 0.25, 0.25, 0.25), None),
        ('bloom_full', lambda: leaf_clump(56, LEAF_DEEP, leaves=90, flowers=180), 'centre', (0.25, 0.25, 0.25, 0.25),
         None),
        ('bloom_full_b', lambda: leaf_clump(57, LEAF_DEEP, leaves=90, flowers=180, flower_stops=LILAC_PINK), 'centre',
         (0.5, 0.25, 0.25, 0.25), None),
        ('bloom_squash', lambda: leaf_clump(58, LEAF_DEEP, leaves=100, flowers=130, squash=0.62), 'centre',
         (0.75, 0.25, 0.25, 0.25), None),
        ('wisteria_a', lambda: wisteria(61), 'down', (0.0, 0.5, 0.25, 0.5), None),
        ('wisteria_b', lambda: wisteria(62, strands=2), 'down', (0.25, 0.5, 0.25, 0.5), None),
        ('wisteria_pale', lambda: wisteria(63, stops=LILAC_PALE), 'down', (0.5, 0.5, 0.25, 0.5), None),
        ('wisteria_pink', lambda: wisteria(64, stops=LILAC_PINK, strands=2), 'down', (0.75, 0.5, 0.25, 0.5), None),
    ]
    # UNDER: shrubs, leafy, berry, heather, juniper, creeping mat, snow bush.
    S['dg_fol_under'] = [
        ('leaf_a', lambda: leaf_clump(71, LEAF, leaves=120, leaf_len=(0.12, 0.18)), 'centre',
         (0.0, 0.0, 0.25, 0.25), None),
        ('leaf_b', lambda: leaf_clump(72, LEAF_DEEP, leaves=125, leaf_len=(0.1, 0.16), shape='narrow'), 'centre',
         (0.25, 0.0, 0.25, 0.25), None),
        ('leaf_round', lambda: leaf_clump(73, LEAF, leaves=110, shape='round'), 'centre', (0.5, 0.0, 0.25, 0.25),
         None),
        ('leaf_young', lambda: leaf_clump(74, LEAF_YOUNG, leaves=115), 'centre', (0.75, 0.0, 0.25, 0.25), None),
        ('berry', lambda: leaf_clump(75, LEAF, leaves=110, berries=45, leaf_len=(0.11, 0.17)), 'centre',
         (0.0, 0.25, 0.25, 0.25), None),
        ('snow_clump', lambda: leaf_clump(76, LEAF_COLD, leaves=110, snow=0.3, cap=1.0, leaf_len=(0.12, 0.18)),
         'centre', (0.25, 0.25, 0.25, 0.25), None),
        ('leaf_cold', lambda: leaf_clump(77, LEAF_COLD, leaves=115, leaf_len=(0.12, 0.18)), 'centre',
         (0.5, 0.25, 0.25, 0.25), None),
        ('moss_mat', lambda: moss_mat(78), 'down', (0.75, 0.25, 0.25, 0.25), None),
        ('snow_top', lambda: snow_top(85),
         'centre', (0.5, 0.75, 0.25, 0.25), None),
        ('heather', lambda: heather_tuft(79), 'up', (0.0, 0.5, 0.25, 0.25), None),
        ('heather_b', lambda: heather_tuft(80, stems=24, stops=LILAC), 'up', (0.25, 0.5, 0.25, 0.25), None),
        ('leaf_spray', lambda: leaf_spray(81), 'up', (0.5, 0.5, 0.25, 0.25), None),
        ('leaf_spray_b', lambda: leaf_spray(82, stems=11, stops=LEAF_DEEP), 'up', (0.75, 0.5, 0.25, 0.25), None),
        ('juniper', lambda: plan_bough(83, PINE, sides=3, spread=(40, 62)), 'down', (0.0, 0.75, 0.25, 0.25), None),
        ('juniper_b', lambda: plan_bough(84, PINE_WARM, sides=4, spread=(44, 64)), 'down', (0.25, 0.75, 0.25, 0.25),
         None),
    ]
    # GRASS + FERN.
    S['dg_fol_grass'] = [
        ('grass_a', lambda: grass_tuft(91, GRASS, blades=26, width=(0.022, 0.034)), 'up', (0.0, 0.0, 0.25, 0.4),
         None),
        ('grass_b', lambda: grass_tuft(92, GRASS, blades=30, tall=1.0, seeds=6, spread=0.4), 'up',
         (0.25, 0.0, 0.25, 0.4), None),
        ('grass_c', lambda: grass_tuft(93, GRASS_COLD, blades=34, spread=0.7), 'up', (0.5, 0.0, 0.25, 0.4), None),
        ('grass_bloom', lambda: grass_tuft(94, GRASS, blades=26, flowers=4, tall=0.9), 'up', (0.75, 0.0, 0.25, 0.4),
         None),
        ('grass_snow', lambda: grass_tuft(95, GRASS_FROST, blades=28, snow=1.0, tall=0.8, spread=1.0, curl_mul=1.7,
                                          width=(0.02, 0.03)), 'up',
         (0.0, 0.4, 0.25, 0.4), None),
        ('grass_dry', lambda: grass_tuft(96, GRASS_DRY, blades=30, spread=0.6), 'up', (0.25, 0.4, 0.25, 0.4), None),
        ('fern', lambda: fern_frond(97, FERN), 'down', (0.5, 0.4, 0.25, 0.6), None),
        ('fern_b', lambda: fern_frond(98, FERN, size=1500), 'down', (0.75, 0.4, 0.25, 0.6), None),
    ]
    return S


def bleed(a):
    """Push colour out under the transparent border so mips never fringe dark."""
    rgb_, al = a[..., :3].copy(), a[..., 3:4]
    acc, wsum = rgb_ * al, al.copy()
    for _ in range(28):
        pa = np.stack([blur(acc[..., i], 3) for i in range(3)], -1) if False else None
        acc_im = Image.fromarray(np.clip(acc * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))
        w_im = Image.fromarray(np.clip(wsum[..., 0] * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))
        na = np.asarray(acc_im).astype(np.float32) / 255
        nw = (np.asarray(w_im).astype(np.float32) / 255)[..., None]
        fill = wsum < 0.01
        acc = np.where(fill, na, acc)
        wsum = np.where(fill, nw, wsum)
    out = np.where(wsum > 0.003, acc / np.maximum(wsum, 0.003), 0.25)
    return np.concatenate([np.clip(out, 0, 1), a[..., 3:4]], -1)


def largest_component(solid):
    h, w = solid.shape
    lab = np.zeros((h, w), np.int32)
    sizes = [0]
    cur = 0
    ys, xs = np.nonzero(solid)
    for sy, sx in zip(ys, xs):
        if lab[sy, sx]:
            continue
        cur += 1
        n = 0
        stack = [(int(sy), int(sx))]
        lab[sy, sx] = cur
        while stack:
            y, x = stack.pop()
            n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = cur
                    stack.append((ny, nx))
        sizes.append(n)
    return lab == int(np.argmax(sizes)) if cur else solid


def check_wood(cell_a, anchor, axis, name):
    """The rule SPACEY asked for, as a gate: woody paint (warm, dark, low
    saturation brown) may only appear along the growth axis out of the
    anchor, never out at a card's far edge. For a centre clump there must be
    essentially none at all."""
    rgb_ = cell_a[..., :3]
    al = cell_a[..., 3] > 0.5
    r, g, b = rgb_[..., 0], rgb_[..., 1], rgb_[..., 2]
    sat = rgb_.max(-1) - rgb_.min(-1)
    # bark brown: warm, dark, and LOW saturation (a red berry is none of those)
    wood = al & (r > g + 0.03) & (r > b + 0.05) & (lum(cell_a) < 0.42) & (sat < 0.22) & ~((b > g) & (r > 0.35))
    h, w = al.shape
    n = int(wood.sum())
    tot = max(1, int(al.sum()))
    if axis == 'centre':
        if n > tot * 0.01:
            raise SystemExit(f'{name}: {n} woody px in a stemless clump')
        return
    ys, xs = np.nonzero(wood)
    # a few stray warm pixels (a cone stalk, a needle shadow) are not a branch
    if n < max(12, tot * 0.004):
        return
    ax, ay = anchor[0] * w, anchor[1] * h
    # distance along the growth axis must be the SMALLER part of the card for
    # the bulk of the wood: its median must sit in the half nearest the anchor
    if axis == 'right':
        along = (xs - ax) / w
    elif axis == 'down':
        along = (ys - ay) / h
    else:
        along = (ay - ys) / h
    med = float(np.median(along))
    far = float((along > 0.85).mean())
    if med > 0.55 or far > 0.08:
        raise SystemExit(f'{name}: woody paint sits away from the anchor (median {med:.2f}, '
                         f'{far:.0%} past 0.85), a branch would grow outward')


def pack(sheet_name, cells, out_dir, preview):
    Wpx = Hpx = SHEET_PX
    sheet = Image.new('RGBA', (Wpx, Hpx), (0, 0, 0, 0))
    meta = {}
    backs = {}
    for name, fn, axis, slot, back in cells:
        if back:
            backs[name] = back
        im, anc = fn()
        sx, sy, sw, sh = slot
        bw, bh = int(sw * Wpx) - 4, int(sh * Hpx) - 4
        sc = min(bw / im.width, bh / im.height)
        tw, th = max(4, int(im.width * sc)), max(4, int(im.height * sc))
        cell = im.resize((tw, th), Image.LANCZOS)
        ca = arr(cell)
        # prune islands on the FINAL alpha: downsampling strands pixels, and a
        # stranded pixel is a leaf floating free of the tree
        keep = largest_component(ca[..., 3] > 0.4)
        ca[..., 3] = np.where(keep | (blur(keep.astype(np.float32), 1.5) > 0.2), ca[..., 3], 0)
        check_wood(ca, anc, axis, f'{sheet_name}/{name}')
        cell = img(ca)
        ox = int(sx * Wpx) + 2 + (bw - tw) // 2
        oy = int(sy * Hpx) + 2 + (bh - th) // 2
        sheet.alpha_composite(cell, (ox, oy))
        # tight UV box of the paint, and the anchor, in glTF-agnostic
        # Blender UV (u right, v UP)
        ys, xs = np.nonzero(ca[..., 3] > 0.4)
        x0, x1, y0, y1 = ox + xs.min(), ox + xs.max() + 1, oy + ys.min(), oy + ys.max() + 1
        axp, ayp = ox + anc[0] * tw, oy + anc[1] * th
        meta[name] = {
            'box': [x0 / Wpx, 1 - y1 / Hpx, x1 / Wpx, 1 - y0 / Hpx],
            'anchor': [axp / Wpx, 1 - ayp / Hpx],
            'axis': axis,
            'aspect': (x1 - x0) / max(1, (y1 - y0)),
        }
        print(f'  {sheet_name}/{name:14s} {axis:6s} {tw}x{th} anchor {anc[0]:.2f},{anc[1]:.2f}')
    for name, back in backs.items():
        meta[name]['back'] = back
        # the twin must be the same art: same aspect, or the remap distorts it
        ra, rb = meta[name]['aspect'], meta[back]['aspect']
        if abs(ra - rb) / ra > 0.04:
            raise SystemExit(f'{sheet_name}/{name}: back twin {back} aspect {rb:.3f} != {ra:.3f}')
    a = bleed(arr(sheet))
    out = img(a)
    out.save(os.path.join(out_dir, f'{sheet_name}.png'))
    if preview:
        bg = Image.new('RGBA', out.size, (196, 186, 166, 255))
        bg.alpha_composite(Image.fromarray((np.concatenate([a[..., :3], a[..., 3:4]], -1) * 255).astype(np.uint8)))
        dr = ImageDraw.Draw(bg)
        for name, m in meta.items():
            u0, v0, u1, v1 = m['box']
            dr.rectangle([u0 * Wpx, (1 - v1) * Hpx, u1 * Wpx, (1 - v0) * Hpx], outline=(255, 0, 0, 255))
            x, y = m['anchor'][0] * Wpx, (1 - m['anchor'][1]) * Hpx
            dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 30, 200, 255))
            dr.text((u0 * Wpx + 3, (1 - v1) * Hpx + 2), name, fill=(0, 0, 0, 255))
        # previews are review aids, not shipped art: keep them out of the tree
        pv = os.path.join(HERE, '../../../tmp/foliage_qa/atlas')
        os.makedirs(pv, exist_ok=True)
        bg.convert('RGB').save(os.path.join(pv, f'{sheet_name}_preview.png'))
    return meta


def main():
    os.makedirs(OUT, exist_ok=True)
    allmeta = {}
    path = os.path.join(OUT, 'cells.json')
    if ONLY and os.path.exists(path):
        allmeta = json.load(open(path))
    for name, cells in sheets().items():
        if ONLY and name not in ONLY:
            continue
        allmeta[name] = pack(name, cells, OUT, PREVIEW)
    json.dump(allmeta, open(path, 'w'), indent=1)
    print('wrote', OUT)


main()
