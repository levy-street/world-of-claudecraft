# Compose the foliage atlas from GENERATED leaf PNGs (SPACEY, 2026-09-19: "gen
# some leaf pngs to use with the transparent background option ... to create
# the perfect atlas that matches our wrath of the lich king style leaves").
#
# Drop transparent-background leaf art into tmp/tidehold/work/leafsrc/, either
# single leaves or small sprigs, any size, alpha cut out, then:
#
#   python3 scripts/assets/deepglass/compose_leaf_atlas.py
#   python3 scripts/assets/deepglass/make_tree_atlas.py   # picks the cells up
#   /Applications/Blender.app/.../Blender -b --python .../bl_dg_trees.py -- <dir>
#   node scripts/assets/deepglass/finish_dg_trees.mjs <dir>
#
# This lays the source leaves out on the SAME sprig skeleton the painted atlas
# uses (a drooping spine with bunches along it), so the cells stay
# interchangeable: same eight names, same anchored-top-centre convention, same
# connectivity guarantee. Only the mark-making changes.
#
# Every cell is checked with the same flood fill make_tree_atlas.py uses: a leaf
# island in the art is a leaf floating in mid air on the tree.
import hashlib
import math
import os
import random
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get('LEAF_SRC', os.path.join(HERE, '../../../tmp/tidehold/work/leafsrc'))
OUT = os.environ.get('LEAF_CELLS', os.path.join(HERE, '../../../tmp/tidehold/work/cells'))
C = 512

# Which source leaf goes where. A cell is built from ONE source family so it
# reads as a single plant, but scale and angle vary per placement.
# Each cell names the SOURCE ART it is built from, by filename stem in
# leafsrc/. Being deliberate matters: the generated set holds both conifer and
# broadleaf, and mixing needles with oval leaves on one tree looks wrong. The
# snow cells use the already-snow-laden source directly rather than tinting the
# bare one, so the snow is the artist's, not a filter of mine.
CELLS = [
    # The generated boughs are already whole, delicate sprays with their own
    # internal value range. `whole` places one nearly cell-sized plus a couple
    # of smaller offset copies for depth, packing them like loose leaves
    # destroys the hair-thin tips that are the reason they read as hand-made.
    ('tuft_a', ['bough_1', 'bough_3'], dict(whole=True, extra=2)),
    ('tuft_b', ['bough_2', 'bough_1'], dict(whole=True, extra=2)),
    ('tuft_c', ['bough_3', 'bough_2'], dict(whole=True, extra=1)),
    ('spire', ['bough_2', 'bough_3'], dict(whole=True, extra=2, up=True)),
    ('frond', ['broadleaf_sprig', 'leaf_single', 'leaf_single_2'],
     dict(spine=0.62, nodes=5, reach=0.32, droop=0.7)),
    # Snow-laden boughs are generated art too now, in the same style as the
    # green ones, so they take the same whole-bough treatment rather than the
    # old packed sprig.
    ('tuft_a_snow', ['bough_snow'], dict(whole=True, extra=2)),
    ('tuft_b_snow', ['bough_snow'], dict(whole=True, extra=2)),
    ('spire_snow', ['bough_snow'], dict(whole=True, extra=2, up=True)),
]


def load_sources():
    """Every PNG in leafsrc/, keyed by filename stem."""
    if not os.path.isdir(SRC):
        sys.exit(f'no leaf source folder: {SRC}\n'
                 'Put transparent-background leaf PNGs there and re-run.')
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(('.png', '.webp')))
    if not files:
        sys.exit(f'no PNGs in {SRC}')
    out = {}
    for f in files:
        im = Image.open(os.path.join(SRC, f)).convert('RGBA')
        a = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(a > 24)
        if len(xs) == 0:
            continue
        # crop to the art so placement maths is about the leaf, not its padding
        out[os.path.splitext(f)[0]] = im.crop(
            (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    print(f'{len(out)} source leaves from {SRC}: {", ".join(sorted(out))}')
    return out


def snowify(im, amount=0.62):
    """A snow-laden copy: lift the UPPER part of each leaf toward white. Keeps
    the source art's own shape, so snow reads as lying on it."""
    a = np.asarray(im).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3:4]
    h = a.shape[0]
    # vertical falloff: the top of the leaf catches the snow
    g = np.clip(1.0 - np.arange(h)[:, None, None] / (h * 0.55), 0, 1)
    snow = np.array([232, 238, 245], dtype=np.float32)
    lit = rgb * (1 - g * amount) + snow * (g * amount)
    return Image.fromarray(np.concatenate([lit, al], axis=-1).astype(np.uint8))


def attach_offset(leaf):
    """Where the bough's WOODY END sits, as a fraction of its width.

    A card is anchored at its top centre, which is the point that touches the
    trunk. If the art's twig is off to one side (these are painted attaching at
    the top-left), placing the image centred puts the woody end out in the air
    and it reads as a branch growing the wrong way (SPACEY, 2026-09-20: "insure
    the branches of these stems connect to the middle of the tree"). Find the
    attachment and shift the image so it lands on the anchor.
    """
    a = np.asarray(leaf)
    al = a[..., 3] > 120
    rows = np.nonzero(al.any(axis=1))[0]
    if len(rows) == 0:
        return 0.0
    # the top eighth of the art: the twig enters there
    band = al[rows[0]:rows[0] + max(2, len(rows) // 8)]
    xs = np.nonzero(band.any(axis=0))[0]
    if len(xs) == 0:
        return 0.0
    return float(xs.mean()) / max(1, a.shape[1]) - 0.5


def place(canvas, leaf, cx, cy, scale, angle, flip):
    w = max(6, int(leaf.width * scale))
    h = max(6, int(leaf.height * scale))
    im = leaf.resize((w, h), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    im = im.rotate(math.degrees(angle), resample=Image.BICUBIC, expand=True)
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def build_cell(name, leaves, cfg, rng, snow):
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    if cfg.get('whole'):
        pool = [snowify(l) for l in leaves] if snow else leaves
        fit = C * 0.99 / max(pool[0].width, pool[0].height)
        flip_v = cfg.get('up', False)
        main = pool[0].transpose(Image.FLIP_TOP_BOTTOM) if flip_v else pool[0]
        dx = attach_offset(main) * main.width * fit
        place(im, main, C * 0.5 - dx, C * (0.58 if flip_v else 0.42), fit, 0.0, False)
        for _ in range(cfg.get('extra', 0)):
            l2 = rng.choice(pool)
            if flip_v:
                l2 = l2.transpose(Image.FLIP_TOP_BOTTOM)
            mirror = rng.random() < 0.5
            if mirror:
                l2 = l2.transpose(Image.FLIP_LEFT_RIGHT)
            sc = fit * rng.uniform(0.58, 0.82)
            # re-measure AFTER mirroring: flipping moves the attachment
            dx2 = attach_offset(l2) * l2.width * sc
            place(im, l2, C * (0.5 + rng.uniform(-0.1, 0.1)) - dx2,
                  C * (0.45 + rng.uniform(-0.08, 0.14)), sc,
                  rng.uniform(-0.18, 0.18), False)
        return im
    up = cfg['droop'] < 0
    spine_len = C * cfg['spine']
    # the spine runs DOWN from the top for a hanging bough, UP for a crown plume
    y0 = C * (0.06 if not up else 0.94)
    sign = 1 if not up else -1
    src = [snowify(l) for l in leaves] if snow else leaves

    def leaf_at(t, off, scale, ang):
        cx = C * 0.5 + off
        cy = y0 + sign * spine_len * t
        place(im, rng.choice(src), cx, cy, scale, ang, rng.random() < 0.5)

    # SILHOUETTE. Packing leaves into the full square fills it edge to edge and
    # the card then reads as a rectangle of foliage. A leaf is only placed when
    # its centre falls inside a bough profile, wide near the anchor, tapering
    # to a point at the tip, with per-row jitter so the rim is ragged rather
    # than a clean curve. Whole leaves are kept, so the outline follows the art
    # instead of slicing through it.
    def half_width(t, jitter):
        core = (1.0 - t) ** 0.62
        return C * cfg['reach'] * (0.55 + 1.15 * core) * jitter

    nodes = cfg['nodes']
    for k in range(nodes):
        t = 0.08 + 0.86 * (k / max(1, nodes - 1))
        # a bough narrows as it runs out to the tip
        hw = half_width(t, rng.uniform(0.78, 1.12))
        count = max(3, int(7 - k * 0.6))
        for i in range(count):
            f = (i / max(1, count - 1)) * 2 - 1
            off = f * hw
            if abs(off) > half_width(t, 1.12):
                continue
            # leaves hang outward and down along the bough
            ang = -f * rng.uniform(0.5, 1.0) * sign + rng.uniform(-0.25, 0.25)
            sc = rng.uniform(0.85, 1.25) * (1.0 - t * 0.2) * (C * (0.5 if cfg.get('sparse') else 0.22) / max(1, src[0].height))
            leaf_at(t + rng.uniform(-0.03, 0.03), off, sc, ang)
    # a denser core down the spine so the middle never reads hollow and every
    # bough is connected to its neighbours
    core = int(nodes * (3 if cfg.get('sparse') else 10))
    for k in range(core):
        t = 0.06 + 0.88 * (k / max(1, core - 1))
        sc = rng.uniform(0.9, 1.3) * (C * (0.45 if cfg.get('sparse') else 0.24) / max(1, src[0].height))
        hw = half_width(t, 0.62)
        leaf_at(t, rng.uniform(-1, 1) * hw, sc, rng.uniform(-0.6, 0.6))
    return im


def prune_islands(im, name):
    """Delete every part of the cell not joined to its main mass.

    A warning is not enough here: an island in the art is a leaf floating in
    mid air on the tree, and the packing jitter WILL throw the occasional sprig
    clear of the rest. Label the alpha's connected components, keep the biggest,
    erase the others. Deterministic, and it cannot be eyeballed wrong.
    """
    arr = np.asarray(im).copy()
    solid = arr[..., 3] > 100
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
    if cur <= 1:
        return im, 0
    keep = int(np.argmax(sizes))
    drop = (lab > 0) & (lab != keep)
    arr[..., 3][drop] = 0
    # ...and anything the soft alpha left hanging around a deleted island
    arr[..., 3][(arr[..., 3] > 0) & drop] = 0
    print(f'    pruned {cur - 1} island(s), {int(drop.sum())} px from {name}')
    return Image.fromarray(arr), cur - 1


def main():
    leaves = load_sources()
    os.makedirs(OUT, exist_ok=True)
    def seed_of(n):
        # NOT hash(): Python salts it per process, so the atlas would differ
        # between runs and every rebuild would churn the shipped texture.
        return int(hashlib.md5(n.encode()).hexdigest()[:8], 16)

    for name, want, cfg in CELLS:
        pool = [leaves[w] for w in want if w in leaves]
        if not pool:
            print(f'  SKIP {name}: none of {want} in {SRC}')
            continue
        rng = random.Random(seed_of(name))
        im = build_cell(name, pool, cfg, rng, snow=False)
        im, _ = prune_islands(im, name)
        im.save(os.path.join(OUT, f'{name}.png'))
        n = int((np.asarray(im)[..., 3] > 100).sum())
        print(f'  {name}.png  from {"+".join(want)}  {n} opaque px')
    print(f'\nwrote cells to {OUT}\n'
          'Now: DG_LEAF_RENDER=1 python3 scripts/assets/deepglass/make_tree_atlas.py')


main()
