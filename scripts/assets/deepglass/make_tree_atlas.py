# Painted foliage atlas + bark for the Deepglass trees (bl_dg_trees.py).
# WoW-style (Grizzly Hills / Howling Fjord): chunky brush-stroke needles in
# dark teal greens with a cool highlight, soft shapes, no fine noise.
#   python3 scripts/assets/deepglass/make_tree_atlas.py
# Atlas 1024x1024, four 512 cells:
#   (0,0) top-left  : pine bough A, stem along the top edge centre, hangs DOWN
#   (1,0) top-right : pine bough B, sparser / ragged
#   (0,1) bot-left  : broad drooping frond fan (the big-root trees)
#   (1,1) bot-right : spire tip / upright tuft, anchored bottom centre
import json, math, os, random

COLS = 4
ROWS = 2
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), 'tree_tex')
S = 3  # supersample
C = 512 * S

DARK = (20, 31, 29)
MID = (33, 54, 46)
LIGHT = (56, 82, 68)
GLINT = (88, 112, 96)
SNOW = (222, 230, 238)
SNOW_SHADE = (176, 192, 208)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def stroke(d, x, y, ang, length, width, col, curve=0.0, sweep=0.0):
    """A tapered brush stroke that CURVES as it runs: `curve` bends it sideways
    (in stroke-local space) and `sweep` turns its tip toward `sweep_to`. Straight
    strokes radiating off a stem read as a stiff flat fan, real needle sprays
    arc, and their tips gather back toward the spray's own axis (SPACEY,
    2026-09-19: "maybe they should be curved and the tips are closer to the
    middle rather than just flat like this looks kinda sloppy")."""
    pts_a, pts_b = [], []
    n = 9
    px, py = x, y
    for i in range(n + 1):
        t = i / n
        # the stroke's heading turns steadily: a genuine arc, not a bowed line
        a = ang + curve * t * t + sweep * t
        step = length / n
        if i > 0:
            px += math.cos(a) * step
            py += math.sin(a) * step
        w = width * (1 - t) ** 0.75 * (0.3 + 0.7 * math.sin(min(1, t * 3.2 + 0.2) * math.pi / 2))
        nx, ny = -math.sin(a), math.cos(a)
        pts_a.append((px + nx * w, py + ny * w))
        pts_b.append((px - nx * w, py - ny * w))
    d.polygon(pts_a + list(reversed(pts_b)), fill=col + (255,))


def bunch(d, rng, x, y, ang, size, snow=False, dense=1.0):
    """A drooping cluster of fine CURVED needles. This is the look SPACEY picked
    (2026-09-19: "go back to when we had the leaves looking like this"), dark,
    feathery, wispy at the tips. The later serrated-blade and rendered-geometry
    passes are kept in history but this is what ships: many thin strokes that
    arc back toward the spray's own axis, underpainted dark, one mid pass, and
    highlights only on the top third."""
    needles = []
    n = int(rng.uniform(42, 58) * dense)
    for _ in range(n):
        side = rng.choice((-1, 1))
        a = ang + side * rng.uniform(0.18, 1.3) + rng.uniform(-0.12, 0.12)
        ln = size * rng.uniform(0.35, 0.72)
        wd = ln * rng.uniform(0.055, 0.09)
        t = rng.random() ** 0.7
        sx = x + math.cos(ang) * size * 0.72 * t
        sy = y + math.sin(ang) * size * 0.72 * t
        needles.append((rng.random(), sx, sy, a, ln, wd,
                        -side * rng.uniform(0.9, 1.6), rng.random()))
    needles.sort(key=lambda v: v[0])
    for _, sx, sy, a, ln, wd, cv, sh in needles:
        stroke(d, sx, sy, a, ln * 1.04, wd * 1.5, DARK, curve=cv)
    for _, sx, sy, a, ln, wd, cv, sh in needles:
        stroke(d, sx, sy, a, ln, wd, lerp(DARK, MID, 0.5 + sh * 0.5), curve=cv)
    for _, sx, sy, a, ln, wd, cv, sh in needles:
        if sh > 0.62:
            stroke(d, sx - wd * 0.15, sy - wd * 0.2, a, ln * 0.62, wd * 0.5,
                   lerp(MID, LIGHT, (sh - 0.62) / 0.38), curve=cv)
    if snow:
        for _, sx, sy, a, ln, wd, cv, sh in needles:
            if math.sin(a) < -0.05 and sh > 0.25:
                stroke(d, sx, sy - wd * 1.1, a, ln * rng.uniform(0.45, 0.8), wd * 1.05,
                       SNOW if sh > 0.6 else SNOW_SHADE, curve=cv)


def tuft(rng, variant, snow=False):
    """Pure foliage, NO painted stem: a rosette of bunches around a hidden
    centre. These carry the bulk of every tree, the wood is real geometry now,
    so a painted twig in the card only ever fights it (SPACEY, 2026-09-19: "we
    also need just leaves without the branchs on the atlas which should make up
    majority of the trees folliage"). Anchored top-centre like the boughs, so
    the card still hangs from where it is pinned."""
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lobes = {0: 7, 1: 6, 2: 5}[variant]
    cx, cy = C * 0.5, C * 0.36
    # The core FIRST and fat: every lobe then grows out of it, so the cell is
    # one connected mass. Lobes seeded apart leave islands, and an island in
    # the cell is a leaf floating in mid air on the tree (SPACEY, 2026-09-19:
    # "each leaf should always be connected 2 another or connected to the
    # trunk"). assert_connected() below fails the build if that ever returns.
    bunch(d, rng, cx, cy - C * 0.2, math.pi / 2, C * 0.3, snow, 1.25)
    bunch(d, rng, cx, cy - C * 0.04, math.pi / 2, C * 0.26, snow, 1.1)
    for k in range(lobes):
        f = (k / max(1, lobes - 1)) * 2 - 1
        ang = math.pi / 2 + f * 1.05 + rng.uniform(-0.1, 0.1)
        r = C * (0.27 - abs(f) * 0.05) * rng.uniform(0.9, 1.1)
        # seated ON the core (0.22 of its own reach), not out at arm's length
        ox = cx + math.cos(ang) * r * 0.22
        oy = cy + math.sin(ang) * r * 0.22 - C * 0.2
        bunch(d, rng, ox, oy, ang, r, snow, 1.0 if variant == 0 else 0.9)
    return im


def bough(rng, variant, snow=False):
    """A bough: a woody stem with BUNCHES hung along it, widest at the base and
    tapering to a tip. variant 0 full, 1 sparser/ragged, 2 short and stubby."""
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    spine = []
    n = 16
    x, y, a = C * 0.5, C * 0.03, math.pi / 2
    for i in range(n + 1):
        spine.append((x, y))
        a += rng.uniform(-0.04, 0.04)
        x += math.cos(a) * C * 0.93 / n
        y += math.sin(a) * C * 0.93 / n
    # STEMS FIRST, under the needles. Drawn last they showed as bare hairlines
    # across the foliage (SPACEY, 2026-09-19: "weird lines on some the leaves").
    d.line(spine, fill=(34, 30, 26, 255), width=int(C * 0.012))
    counts = {0: 5, 1: 4, 2: 3}[variant]
    for k in range(counts):
        t = 0.12 + (0.9 - 0.12) * (k / max(1, counts - 1)) ** 0.95
        bx, by = spine[int(t * n)]
        # the pair of bunches at this node, one each side, plus the taper
        reach = C * (0.33 - t * 0.21) * (1.0 if variant == 0 else 0.86)
        for side in (-1, 1):
            if variant == 1 and rng.random() < 0.28:
                continue
            ang = math.pi / 2 + side * rng.uniform(0.62, 1.0) * (1 - t * 0.3)
            ox = bx + math.cos(ang) * reach * 0.25
            oy = by + math.sin(ang) * reach * 0.25
            d.line([(bx, by), (ox, oy)], fill=(34, 30, 26, 255), width=int(C * 0.006))
            bunch(d, rng, ox, oy, ang, reach * rng.uniform(0.85, 1.15), snow,
                  1.0 if variant != 2 else 0.8)
    # the tip
    bunch(d, rng, spine[-2][0], spine[-2][1], math.pi / 2, C * 0.16, snow, 0.9)
    return im


def frond(rng, snow=False):
    """Broad drooping fan for the root giants: fewer, longer blades."""
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    bunch(d, rng, C * 0.5, C * 0.12, math.pi / 2, C * 0.26, snow, 1.2)
    for k in range(5):
        a = math.pi / 2 + (k / 4 - 0.5) * 1.75
        x = C * 0.5 + math.cos(a) * C * 0.04
        y = C * 0.06
        bunch(d, rng, x, y, a, C * rng.uniform(0.26, 0.36), snow, 1.15)
    return im


def spire(rng, snow=False):
    """Upright crown plume, anchored bottom centre: bunches up a short spine."""
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    spine = [(C * 0.5, C * (0.95 - 0.81 * i / 12)) for i in range(13)]
    # Nodes close enough that consecutive bunches OVERLAP: spaced further apart
    # the plume breaks into islands, which assert_connected rejects.
    for k in range(9):
        t = k / 8
        bx, by = spine[int(t * 12)]
        reach = C * (0.24 - t * 0.1)
        bunch(d, rng, bx, by, -math.pi / 2, reach * 0.9, snow, 1.0)
        for side in (-1, 1):
            ang = -math.pi / 2 + side * rng.uniform(0.55, 0.9)
            bunch(d, rng, bx, by, ang, reach * rng.uniform(0.9, 1.1), snow, 0.95)
    bunch(d, rng, spine[-1][0], spine[-1][1], -math.pi / 2, C * 0.1, snow, 0.9)
    return im


def stylize(im):
    """Turn a photoreal needle render into a WoW texture.

    The render gives shapes and depth no brush pass can, but on its own it is
    too HIGH FREQUENCY: at game scale it reads as busy noise and the tree loses
    its silhouette. WoW foliage is the opposite, a handful of flat colour
    bands, a hard dark rim, and a coarse fringe. So keep the render's geometry
    and throw away its gradients: posterise luminance onto the painted ramp,
    darken the rim, and coarsen the cut-out.
    """
    a = np.asarray(im).astype(np.float32)
    rgb, al = a[..., :3] / 255.0, a[..., 3] / 255.0
    solid = al > 0.35
    if solid.sum() < 50:
        return im
    lum = rgb.mean(axis=2)
    lo, hi = np.percentile(lum[solid], 6), np.percentile(lum[solid], 94)
    t = np.clip((lum - lo) / max(1e-4, hi - lo), 0, 1)
    ramp = np.array([DARK, DARK, MID, MID, LIGHT, GLINT], dtype=np.float32)
    idx = np.clip((t * len(ramp)).astype(np.int32), 0, len(ramp) - 1)
    out = ramp[idx]
    # Snow is bright and DESATURATED; posterising it onto the green ramp turns
    # a snow-laden bough into a pale green one. Give those pixels their own
    # two-step ramp instead.
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    snowy = np.clip((0.09 - sat) / 0.09, 0, 1) * np.clip((lum - 0.30) / 0.22, 0, 1)
    sramp = np.array([SNOW_SHADE, SNOW], dtype=np.float32)
    sout = sramp[np.clip((t * 2).astype(np.int32), 0, 1)]
    out = out * (1 - snowy[..., None]) + sout * snowy[..., None]
    # hard dark rim: wherever the cut-out edge is, sink toward the darkest band
    edge = np.asarray(Image.fromarray((al * 255).astype(np.uint8))
                      .filter(ImageFilter.MinFilter(7))).astype(np.float32) / 255.0
    rim = np.clip((al - edge) * 1.6, 0, 1)[..., None]
    out = out * (1 - rim) + np.array(DARK, dtype=np.float32) * rim
    # coarsen the fringe: a soft threshold, so the silhouette reads as chunky
    # points rather than a fine feathered haze
    na = np.clip((al - 0.42) / 0.16, 0, 1)
    res = np.concatenate([np.clip(out, 0, 255), (na * 255)[..., None]], axis=-1)
    return Image.fromarray(res.astype(np.uint8))


def bleed(im):
    """Push colour out under the transparent border so mips never fringe dark."""
    a = np.asarray(im).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3:4] / 255.0
    acc, wsum = rgb * al, al.copy()
    for _ in range(24):
        pa = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))
        pw = Image.fromarray(np.clip(wsum[..., 0] * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3))
        na = np.asarray(pa).astype(np.float32)
        nw = (np.asarray(pw).astype(np.float32) / 255.0)[..., None]
        fill = wsum < 0.01
        acc = np.where(fill, na, acc)
        wsum = np.where(fill, nw, wsum)
    out = np.where(wsum > 0.003, acc / np.maximum(wsum, 0.003), MID)
    res = np.concatenate([np.clip(out, 0, 255), a[..., 3:4]], axis=-1).astype(np.uint8)
    return Image.fromarray(res)

def largest_component(solid):
    """Mask of the biggest 4-connected blob in a boolean image."""
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


def assert_connected(alpha, name):
    """Every painted cell must be ONE connected blob: an island in the art is a
    leaf floating free of the tree. Flood fill from the largest row's first
    solid pixel and fail the build if anything solid is left unvisited."""
    solid = alpha > 100
    total = int(solid.sum())
    if total == 0:
        return
    ys, xs = np.where(solid)
    start = (int(ys[len(ys) // 2]), int(xs[len(xs) // 2]))
    seen = np.zeros_like(solid)
    stack = [start]
    seen[start] = True
    h, w = solid.shape
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    stray = total - int(seen.sum())
    if stray > total * 0.005:
        raise SystemExit(f'{name}: {stray} of {total} painted pixels are an ISLAND '
                         ', they would float free of the tree')


def atlas():
    """One 2048x1024 sheet, eight 512 cells. Four bough/crown variants plus a
    frond, and SNOW twins of the three a snowy tree needs, so a stand can mix
    bare and snow-laden trees off one texture and one draw."""
    rng = random.Random(7)
    # Cells are RENDERED from real needle geometry (bl_dg_leafatlas.py) when
    # they are present. The painted fallback below is kept for a machine with
    # no Blender, but the render is what ships: a brush pass cannot produce the
    # depth of a spray where near needles cross far ones, and up close the
    # painted blades read as aloe rather than spruce.
    names = ['tuft_a', 'tuft_b', 'tuft_c', 'spire',
             'tuft_a_snow', 'tuft_b_snow', 'spire_snow', 'frond']
    rendered = os.path.join(os.path.dirname(__file__), '../../../tmp/tidehold/work/cells')
    if os.environ.get('DG_LEAF_RENDER') == '1' and all(
            os.path.exists(os.path.join(rendered, f'{n}.png')) for n in names):
        # Composed/generated cells are FINISHED ART: pass them through
        # untouched. stylize() posterises onto the painted ramp, which is right
        # for a raw geometry render and destructive to hand-made leaves
        # (SPACEY, 2026-09-20: "just not compress them"). Opt in with
        # DG_LEAF_STYLIZE=1 if you ever want that flattening back.
        post = stylize if os.environ.get('DG_LEAF_STYLIZE') == '1' else (lambda x: x)
        cells = [(n, post(Image.open(os.path.join(rendered, f'{n}.png'))
                          .convert('RGBA').resize((C, C), Image.LANCZOS)))
                 for n in names]
        use_render = True
    else:
        use_render = False
        cells = [
            ('tuft_a', tuft(rng, 0)),
            ('tuft_b', tuft(rng, 1)),
            ('tuft_c', tuft(rng, 2)),
            ('spire', spire(rng)),
            ('tuft_a_snow', tuft(random.Random(7), 0, snow=True)),
            ('tuft_b_snow', tuft(random.Random(11), 1, snow=True)),
            ('spire_snow', spire(random.Random(13), snow=True)),
            ('frond', frond(rng)),
        ]
    COLS, ROWS = 4, 2
    sheet = Image.new('RGBA', (C * COLS, C * ROWS), (0, 0, 0, 0))
    for i, (_, c) in enumerate(cells):
        sheet.paste(c, ((i % COLS) * C, (i // COLS) * C))
    # 256 per cell, not 512. The atlas is embedded in EVERY tree GLB, so at
    # 512 the kit was 13 identical copies of an 8 MB texture, 104 MB of VRAM
    # and 12 MB of download for one image. A foliage card covers a few hundred
    # screen pixels at most, so 256 loses nothing visible and costs a quarter
    # as much. Still lossless; the art is not being degraded, only sized.
    CELL_PX = int(os.environ.get('DG_ATLAS_CELL', '256'))
    W, H = CELL_PX * COLS, CELL_PX * ROWS
    sheet = sheet.resize((W, H), Image.LANCZOS)
    arr = np.asarray(sheet).copy()
    al = arr[..., 3].astype(np.float32) / 255
    if not use_render:
        arr[..., 3] = (np.clip((al - 0.35) / 0.3, 0, 1) * 255).astype(np.uint8)
    # Fade each cell's alpha to zero over its outer margin. Without this the
    # tight UV crop slices through solid paint and the card's rectangle shows
    # as a staircase in the silhouette.
    m = 14
    ramp = np.ones(CELL_PX, dtype=np.float32)
    ramp[:m] = np.linspace(0, 1, m)
    ramp[-m:] = np.linspace(1, 0, m)
    fall = np.minimum(ramp[:, None], ramp[None, :])
    for cy in range(ROWS):
        for cx in range(COLS):
            sl = arr[cy * CELL_PX:(cy + 1) * CELL_PX, cx * CELL_PX:(cx + 1) * CELL_PX, 3]
            sl[:] = (sl.astype(np.float32) * fall).astype(np.uint8)
    # A darker, slightly less saturated canopy (SPACEY, 2026-09-20: "overlay a
    # darker hue so it looks darker"). Applied to the ATLAS so every tree and
    # every card gets it consistently; DG_LEAF_DARK=1 to leave the art alone.
    dark = float(os.environ.get('DG_LEAF_DARK', '0.66'))
    if dark < 0.999:
        rgbf = arr[..., :3].astype(np.float32)
        grey = rgbf.mean(axis=2, keepdims=True)
        rgbf = rgbf * 0.86 + grey * 0.14
        # SNOW resists the darkening. It is bright and desaturated, and taking
        # it down with the greens turns a snow-laden bough into a grey one.
        sat = rgbf.max(axis=2) - rgbf.min(axis=2)
        snowy = (np.clip((40 - sat) / 40, 0, 1)
                 * np.clip((rgbf.mean(axis=2) - 120) / 70, 0, 1))[..., None]
        rgbf = rgbf * (dark + (1.0 - dark) * snowy)
        # keep a cool cast as it darkens, the way foliage sits in shadow
        rgbf *= np.array([0.96, 1.0, 0.99], dtype=np.float32)
        arr[..., :3] = np.clip(rgbf, 0, 255).astype(np.uint8)
    out = bleed(Image.fromarray(arr))
    out.save(os.path.join(OUT, 'dg_tree_leaves.png'))
    # tight UV box per cell, in Blender UV space (v up)
    outarr = np.asarray(out).copy()
    alpha = outarr[..., 3]
    boxes = {}
    cover = {}
    for i, (name, _) in enumerate(cells):
        cx, cy = (i % COLS) * CELL_PX, (i // COLS) * CELL_PX
        cellA = alpha[cy:cy + CELL_PX, cx:cx + CELL_PX]
        # Downsampling can strand a few pixels that were joined at full size,
        # so prune on the FINAL alpha before checking it. Same rule as the
        # composer: anything not joined to the main mass is erased, not warned
        # about, it would be a leaf floating free on the tree.
        keep = largest_component(cellA > 100)
        stray = (cellA > 0) & ~keep
        if stray.any():
            alpha[cy:cy + CELL_PX, cx:cx + CELL_PX][stray] = 0
            cellA = alpha[cy:cy + CELL_PX, cx:cx + CELL_PX]
        assert_connected(cellA, name)
        ys, xs = np.where(cellA > 100)
        if len(xs) == 0:
            continue
        x0, x1 = cx + max(0, xs.min() - 3), cx + min(CELL_PX - 1, xs.max() + 3)
        y0, y1 = cy + max(0, ys.min() - 3), cy + min(CELL_PX - 1, ys.max() + 3)
        boxes[name] = [x0 / W, 1 - y1 / H, x1 / W, 1 - y0 / H]
        # Where the paint actually SITS inside that box, and how big it is:
        # a card's quad may reach the trunk while its opaque pixels sit far
        # out, and it is the pixels that read as floating. Fractions of the
        # box: u across, v from the box TOP (the card's anchored end), and an
        # equal-area radius as a fraction of the box's larger side.
        a = cellA[max(0, ys.min() - 3):ys.max() + 4, max(0, xs.min() - 3):xs.max() + 4] > 100
        hgt, wid = a.shape
        yy, xx = np.nonzero(a)
        area = len(xx)
        cover[name] = [
            float(xx.mean() / max(1, wid - 1)),
            float(yy.mean() / max(1, hgt - 1)),
            float(math.sqrt(area / math.pi) / max(wid, hgt)),
        ]
    Image.fromarray(outarr).save(os.path.join(OUT, 'dg_tree_leaves.png'))
    json.dump({'boxes': boxes, 'cover': cover},
              open(os.path.join(OUT, 'dg_tree_cells.json'), 'w'), indent=1)
    print('atlas cells', list(boxes))


def ice():
    """Ice surface, derived from the repository's painted Snow002 the same way
    the bark is: lifted toward white and pushed cool, so a berg reads as ice
    under daylight rather than as blue-grey ground (bl_dg_ice.py)."""
    src = os.path.join(os.path.dirname(__file__), '../../../public/textures/terrain')
    a = np.asarray(Image.open(os.path.join(src, 'Snow002_Color.jpg')).convert('RGB'))
    a = np.power(a.astype(np.float32) / 255, 0.62)
    a = a * np.array((0.95, 0.99, 1.05), dtype=np.float32)
    Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'dg_ice.png'))


def bark():
    """Trunk bark, DERIVED from the repository's own painted terrain bark
    (Wood003 "Weathered Bark", Wood004 "Mossy Bark"). Those ship for ground
    painting under the triplanar material and are very dark, mean luma about
    21%, so a trunk wearing one raw reads near-black against daylight. Lift
    them onto a trunk's value range and warm the pine one slightly; the paint,
    which is the reason to use them, is untouched."""
    src = os.path.join(os.path.dirname(__file__), '../../../public/textures/terrain')
    for out_name, in_name, warm in (('dg_bark_pine.png', 'Wood003_Color.jpg', (1.06, 1.0, 0.94)),
                                    ('dg_bark_root.png', 'Wood004_Color.jpg', (1.0, 1.0, 1.0))):
        a = np.asarray(Image.open(os.path.join(src, in_name)).convert('RGB')).astype(np.float32) / 255
        a = np.power(a, 0.55)
        a = a * np.array(warm, dtype=np.float32)
        if out_name == 'dg_bark_root.png':
            # Wood004's lichen is bright green, which on a trunk reads as a
            # mossy log rather than as Deepglass wood (SPACEY, 2026-09-19: "the
            # green bark trees make that green a dark woody purple"). Rotate
            # the green-dominant pixels to a deep violet and sink them; the
            # brown bark underneath keeps its own paint.
            g = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
            m = np.clip(g / 0.09, 0, 1)[..., None]
            lum = a.mean(axis=2, keepdims=True)
            violet = np.concatenate([lum * 0.92, lum * 0.55, lum * 1.05], axis=2) * 0.72
            a = a * (1 - m) + violet * m
        Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).save(os.path.join(OUT, out_name))



os.makedirs(OUT, exist_ok=True)
atlas()
bark()
ice()
print('wrote', OUT)
