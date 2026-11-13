# Prepares the PAINTED source art for the Eastbrook houses.
#
# The surfaces are painted in ChatGPT to one shared look, and land in paint/ as PNGs.
# Nothing here is a billboard: every painting ends up
# as the TEXTURE of real geometry built in kit.py. This module turns the paintings into:
#   - tiles (stone, timber, slate, hull, glass) that wrap exactly;
#   - the trim sheet, with its bands found and measured;
#   - the parts atlas: named crops of the cut-out sheets (a door leaf, a stone arch with its
#     opening punched out, a shutter, a corbel ...), each with the outline of its paint traced
#     so the kit can give it real thickness along that outline.
# Runs inside Blender's Python (numpy plus Blender's image loader).
import math
import os
import struct
import zlib

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PAINT = os.path.join(HERE, "paint")
ATLAS = 2048


def load(path):
    """An image as float RGBA, row 0 at the TOP."""
    image = bpy.data.images.load(path, check_existing=False)
    w, h = image.size
    data = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    bpy.data.images.remove(image)
    return data.reshape(h, w, 4)[::-1].astype(np.float64)


def save(path, rgba):
    """Writes float RGB or RGBA (row 0 at the top) as an 8-bit PNG."""
    data = (np.clip(rgba, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    h, w, channels = data.shape
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6 if channels == 4 else 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))


def resize(img, width, height):
    """Bilinear resize (the sources are only a little larger than what ships)."""
    h, w = img.shape[:2]
    ys = (np.arange(height) + 0.5) * h / height - 0.5
    xs = (np.arange(width) + 0.5) * w / width - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    ty = np.clip(ys - y0, 0.0, 1.0)[:, None, None]
    tx = np.clip(xs - x0, 0.0, 1.0)[None, :, None]
    top = img[np.ix_(y0, x0)] * (1 - tx) + img[np.ix_(y0, x1)] * tx
    bottom = img[np.ix_(y1, x0)] * (1 - tx) + img[np.ix_(y1, x1)] * tx
    return top * (1 - ty) + bottom * ty


def wrap_edges(img, band=8):
    """Makes a painting that is already ALMOST seamless wrap exactly. ChatGPT's tiles line up
    across their edges to within a brush stroke, so nothing is moved: only the last few pixels
    on each edge are cross-faded into the opposite edge."""
    out = img.copy()
    for axis in (0, 1):
        src = out.copy()
        n = src.shape[axis]
        for i in range(band):
            t = 0.5 * (1.0 - i / band)
            near = np.take(src, i, axis=axis)
            far = np.take(src, n - 1 - i, axis=axis)
            if axis == 0:
                out[i] = near * (1 - t) + far * t
                out[n - 1 - i] = far * (1 - t) + near * t
            else:
                out[:, i] = near * (1 - t) + far * t
                out[:, n - 1 - i] = far * (1 - t) + near * t
    return out


def key_out(img, tolerance=0.1, feather=0.06):
    """Alpha for a sheet painted on a flat ground: the ground colour is read off the corners
    and keyed out. A sheet that already carries transparency keeps its own alpha."""
    if img[..., 3].min() < 0.5:
        return img
    corners = np.concatenate([img[:12, :12, :3].reshape(-1, 3), img[:12, -12:, :3].reshape(-1, 3), img[-12:, :12, :3].reshape(-1, 3), img[-12:, -12:, :3].reshape(-1, 3)])
    ground = np.median(corners, axis=0)
    dist = np.sqrt(((img[..., :3] - ground) ** 2).sum(axis=-1))
    out = img.copy()
    out[..., 3] = np.clip((dist - tolerance) / feather, 0.0, 1.0)
    return out


def crisp_alpha(img):
    """A hard-edged cut-out from a painting whose ground fades out in a soft glow: the faint
    halo goes, the object keeps a clean antialiased edge."""
    out = img.copy()
    out[..., 3] = np.clip((img[..., 3] - 0.55) / 0.3, 0.0, 1.0)
    return out


def bleed(img, rounds=10):
    """Spreads the edge colours out under the transparent ground so texture filtering and
    mip levels never pull in black."""
    rgb = img[..., :3].copy()
    known = img[..., 3] > 0.5
    for _ in range(rounds):
        total = np.zeros_like(rgb)
        weight = np.zeros(known.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            total += shifted * shifted_known[..., None]
            weight += shifted_known
        fill = (~known) & (weight > 0)
        rgb[fill] = total[fill] / weight[fill][:, None]
        known = known | fill
    out = img.copy()
    out[..., :3] = rgb
    return out


# -- shapes ---------------------------------------------------------------------------------
# An opening is described once and used twice: here to punch it out of the painting, and in
# kit.py to build the glass or the door leaf that sits back inside it.


def arch_inside(xx, yy, x0, x1, top, spring, bottom, power=2.0):
    """True inside an arched opening: straight sides from `bottom` up to `spring`, then an
    arch up to `top`. power 2 is a round arch, lower is pointed."""
    cx, a, b = (x0 + x1) / 2.0, (x1 - x0) / 2.0, max(spring - top, 1e-6)
    straight = (xx >= x0) & (xx <= x1) & (yy >= spring) & (yy <= bottom)
    dx = np.clip(np.abs(xx - cx) / a, 0.0, None)
    dy = np.clip((spring - yy) / b, 0.0, None)
    head = (yy < spring) & (dx**power + dy**power <= 1.0)
    return straight | head


def shape_mask(shape, xx, yy):
    kind = shape[0]
    if kind == "rect":
        _, x0, y0, x1, y1 = shape
        return (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    if kind == "arch":
        return arch_inside(xx, yy, *shape[1:])
    raise ValueError(kind)


# -- outlines -------------------------------------------------------------------------------


def trace_loops(solid):
    """The outlines of a boolean grid as closed loops of corner points (x, y), paint always
    on the right of the direction of travel, so a hole comes out the other way round."""
    rows, cols = solid.shape
    padded = np.zeros((rows + 2, cols + 2), dtype=bool)
    padded[1:-1, 1:-1] = solid
    nxt = {}
    ys, xs = np.nonzero(solid)
    for y, x in zip(ys.tolist(), xs.tolist()):
        py, px = y + 1, x + 1
        if not padded[py - 1, px]:
            nxt.setdefault((x, y), []).append((x + 1, y))
        if not padded[py, px + 1]:
            nxt.setdefault((x + 1, y), []).append((x + 1, y + 1))
        if not padded[py + 1, px]:
            nxt.setdefault((x + 1, y + 1), []).append((x, y + 1))
        if not padded[py, px - 1]:
            nxt.setdefault((x, y + 1), []).append((x, y))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop = [start]
        here = start
        while True:
            ends = nxt[here]
            there = ends.pop()
            if not ends:
                del nxt[here]
            if there == start:
                break
            loop.append(there)
            here = there
        loops.append(loop)
    return loops


def simplify(loop, tolerance):
    """Douglas-Peucker on a closed loop."""
    if len(loop) < 8:
        return loop
    pts = np.array(loop, dtype=np.float64)
    first = int(np.argmin(pts[:, 0] + pts[:, 1] * 1e-3))
    far = int(np.argmax(((pts - pts[first]) ** 2).sum(axis=1)))
    a, b = sorted((first, far))

    def reduce(seg):
        if len(seg) < 3:
            return seg[:-1]
        p0, p1 = seg[0], seg[-1]
        d = p1 - p0
        length = math.hypot(d[0], d[1])
        if length < 1e-9:
            dist = np.sqrt(((seg - p0) ** 2).sum(axis=1))
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p0[1]) - d[1] * (seg[:, 0] - p0[0])) / length
        i = int(np.argmax(dist))
        if dist[i] <= tolerance:
            return seg[:1]
        return np.concatenate([reduce(seg[: i + 1]), reduce(seg[i:])])

    one = reduce(pts[a : b + 1])
    two = reduce(np.concatenate([pts[b:], pts[: a + 1]]))
    return [tuple(p) for p in np.concatenate([one, two])]


def outline(sprite, cells=110, tolerance=1.1, min_cells=14):
    """The traced outline of a sprite's paint: loops of (fx, fy, nx, ny), the point in
    fractions of the sprite (fy down from the top) and the unit direction INTO the paint."""
    h, w = sprite.shape[:2]
    step = max(1, int(math.ceil(max(h, w) / cells)))
    gh, gw = int(math.ceil(h / step)), int(math.ceil(w / step))
    grid = np.zeros((gh, gw), dtype=bool)
    alpha = sprite[..., 3]
    for gy in range(gh):
        row = alpha[gy * step : (gy + 1) * step]
        for gx in range(gw):
            grid[gy, gx] = row[:, gx * step : (gx + 1) * step].mean() > 0.5
    loops = []
    for loop in trace_loops(grid):
        if len(loop) < min_cells:
            continue
        pts = simplify(loop, tolerance)
        if len(pts) < 3:
            continue
        n = len(pts)
        out = []
        for i, (x, y) in enumerate(pts):
            px, py = pts[i - 1]
            nx, ny = pts[(i + 1) % n]
            dx, dy = nx - px, ny - py
            length = math.hypot(dx, dy) or 1.0
            # paint is on the right of travel: (dx, dy) turned a quarter turn clockwise on screen
            out.append((min(1.0, x * step / w), min(1.0, y * step / h), -dy / length, dx / length))
        loops.append(out)
    return loops


# -- the parts atlas --------------------------------------------------------------------------
# Every crop: the sheet it comes from, its box in the sheet's own pixels, the scale it is
# stored at, the openings punched out of it (`punch`), the only region kept (`keep`).

CROPS = {
    # sheet_a: the casement window, in layers from the wall outward
    "win_frame": dict(sheet="sheet_a", box=(196, 104, 536, 410), punch=[("rect", 246, 133, 351, 318), ("rect", 380, 133, 484, 318)]),
    "win_lintel": dict(sheet="sheet_a", box=(128, 18, 590, 116)),
    "win_box": dict(sheet="sheet_a", box=(148, 398, 562, 518)),
    "shutter": dict(sheet="sheet_a", box=(62, 94, 202, 404)),
    # the arched stone window
    "arch_surround": dict(sheet="sheet_a", box=(744, 6, 1154, 476), punch=[("arch", 860, 1038, 130, 215, 384, 2.0)]),
    "keystone": dict(sheet="sheet_a", box=(902, 6, 1006, 114)),
    # the door: the stone arch with the leaf punched out, the leaf on its own
    "door_surround": dict(sheet="sheet_a", box=(26, 541, 649, 1132), punch=[("arch", 163, 504, 653, 765, 1140, 2.0)]),
    "door_leaf": dict(sheet="sheet_a", box=(160, 650, 507, 1130), opaque=True),
    "door_key": dict(sheet="sheet_a", box=(294, 544, 390, 654)),
    "apron": dict(sheet="sheet_a", box=(764, 986, 1110, 1046), opaque=True),
    # sheet_b
    "sign": dict(sheet="sheet_b", box=(51, 1, 582, 539), scale=0.82),
    "banner": dict(sheet="sheet_b", box=(698, 66, 984, 542)),
    "lantern_glass": dict(sheet="sheet_b", box=(1252, 285, 1343, 436), opaque=True),
    "lantern_cap": dict(sheet="sheet_b", box=(1238, 186, 1352, 270), opaque=True),
    "corbel": dict(sheet="sheet_b", box=(76, 578, 512, 1004), scale=0.6),
    "finial": dict(sheet="sheet_b", box=(544, 561, 994, 989), scale=0.62),
    "wheel": dict(sheet="sheet_b", box=(1041, 561, 1486, 994), scale=0.72),
    # sheet_c
    "figurehead": dict(sheet="sheet_c", box=(14, 24, 499, 544)),
    "net": dict(sheet="sheet_c", box=(521, 74, 1026, 504), scale=0.9),
    "dormer_front": dict(sheet="sheet_c", box=(1052, 98, 1514, 517), keep=[("arch", 1128, 1442, 100, 345, 345, 1.3), ("rect", 1040, 345, 1520, 520)], punch=[("arch", 1207, 1364, 203, 300, 432, 1.45)]),
    "awning_top": dict(sheet="sheet_c", box=(72, 668, 458, 862), opaque=True),
    "awning_valance": dict(sheet="sheet_c", box=(11, 858, 526, 942)),
    "pot": dict(sheet="sheet_c", box=(621, 588, 688, 831), opaque=True),
    "pennant": dict(sheet="sheet_c", box=(1054, 658, 1534, 897)),
    # the plants: rows of window-box flowers and a patch of climbing ivy
    "flowers_a": dict(sheet="flowers", box=(0, 0, 1536, 245), tight=True, scale=0.52),
    "flowers_b": dict(sheet="flowers", box=(0, 245, 1536, 585), tight=True, scale=0.52),
    "ivy": dict(sheet="flowers", box=(0, 585, 1536, 1024), tight=True, scale=0.52),
}
# Crops that are a sheet of cloth or netting rather than a carved piece: no outline wanted.
SHEETLIKE = ("banner", "net", "pennant", "awning_valance", "flowers_a", "flowers_b", "ivy")


def cut(sheets, spec):
    """One crop as an RGBA sprite, with its openings punched and its keep-region applied."""
    img = sheets[spec["sheet"]]
    x0, y0, x1, y1 = spec["box"]
    if spec.get("tight"):
        # shrink the box onto the paint inside it
        ys, xs = np.nonzero(img[y0:y1, x0:x1, 3] > 0.5)
        x0, x1, y0, y1 = x0 + int(xs.min()), x0 + int(xs.max()) + 1, y0 + int(ys.min()), y0 + int(ys.max()) + 1
    sprite = img[y0:y1, x0:x1].copy()
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    xx += 0.5
    yy += 0.5
    if spec.get("opaque"):
        sprite[..., 3] = 1.0
    if "keep" in spec:
        kept = np.zeros(sprite.shape[:2], dtype=bool)
        for shape in spec["keep"]:
            kept |= shape_mask(shape, xx, yy)
        sprite[..., 3] *= kept
    for shape in spec.get("punch", ()):
        sprite[..., 3] *= ~shape_mask(shape, xx, yy)
    scale = spec.get("scale", 1.0)
    if scale != 1.0:
        sprite = resize(sprite, max(8, round(sprite.shape[1] * scale)), max(8, round(sprite.shape[0] * scale)))
    return sprite


def pack_parts(out_dir):
    """Cuts every crop, packs them into one atlas and returns {name: {"uv": (u0, v0, u1, v1)
    with v up, "aspect": width / height, "loops": traced outline}}."""
    sheets = {}
    for spec in CROPS.values():
        if spec["sheet"] not in sheets:
            sheets[spec["sheet"]] = crisp_alpha(key_out(load(os.path.join(PAINT, f"{spec['sheet']}.png"))))
    pieces = [(name, cut(sheets, spec)) for name, spec in CROPS.items()]
    atlas = np.zeros((ATLAS, ATLAS, 4))
    parts = {}
    pad = 10
    # shelves, tallest pieces first; a piece goes on the first shelf with room for it
    shelves = []  # [y, height, next free x]
    floor = pad
    for name, sprite in sorted(pieces, key=lambda p: -p[1].shape[0]):
        h, w = sprite.shape[:2]
        for shelf in shelves:
            if h <= shelf[1] and shelf[2] + w + pad <= ATLAS:
                break
        else:
            if floor + h + pad > ATLAS:
                raise RuntimeError(f"the parts do not fit the atlas ({name} is left over): lower their scales")
            shelf = [floor, h, pad]
            shelves.append(shelf)
            floor += h + pad
        x, y = shelf[2], shelf[0]
        shelf[2] += w + pad
        atlas[y : y + h, x : x + w] = sprite
        parts[name] = {
            "uv": (x / ATLAS, 1.0 - (y + h) / ATLAS, (x + w) / ATLAS, 1.0 - y / ATLAS),
            "aspect": w / h,
            "loops": [] if name in SHEETLIKE or CROPS[name].get("opaque") else outline(sprite),
        }
    save(os.path.join(out_dir, "parts.png"), bleed(atlas))
    return parts


# -- the trim sheet ---------------------------------------------------------------------------

TRIM_BANDS = ("bargeboard", "gilded", "oak", "plaster", "planks", "teal")


def find_bands(img, names=TRIM_BANDS, inset=4):
    """The trim sheet's bands, found by the near-black strips between them: {name: (v0, v1,
    aspect)} with v up and aspect = sheet width / band height."""
    h = img.shape[0]
    lum = (img[..., 0] * 0.3 + img[..., 1] * 0.59 + img[..., 2] * 0.11).mean(axis=1)
    bright = lum > 0.16
    runs_raw = []
    start = None
    for y in range(h + 1):
        on = y < h and bright[y]
        if on and start is None:
            start = y
        if not on and start is not None:
            runs_raw.append((start, y))
            start = None
    # a shadow line inside a band (under a rope moulding) is not a gap between bands
    merged = []
    for run in runs_raw:
        if merged and run[0] - merged[-1][1] < h * 0.006:
            merged[-1] = (merged[-1][0], run[1])
        else:
            merged.append(run)
    runs = [run for run in merged if run[1] - run[0] > h * 0.05]
    if len(runs) != len(names):
        raise RuntimeError(f"trim sheet: found {len(runs)} bands, expected {len(names)}: {runs}")
    bands = {}
    for name, (top, bottom) in zip(names, runs):
        top, bottom = top + inset, bottom - inset
        bands[name] = (1.0 - bottom / h, 1.0 - top / h, img.shape[1] / (bottom - top))
    return bands


def prepare(out_dir, size=1024):
    """Everything the kit maps onto geometry, written into out_dir. Returns ({texture name:
    path}, parts, trim bands)."""
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    bands = {}
    for name, px in (("stone", size), ("slate", size), ("hull", size), ("timber", size), ("trim", size), ("glass", size // 2)):
        source = os.path.join(PAINT, f"{name}.png")
        if not os.path.exists(source):
            continue
        img = wrap_edges(resize(load(source)[..., :3], px, px))
        if name == "trim":
            bands = find_bands(img)
        save(os.path.join(out_dir, f"{name}.png"), img)
        paths[name] = os.path.join(out_dir, f"{name}.png")
    if "glass" in paths:
        # the chapel's stained glass is the house glass in other colours (stained()), not a
        # painting of its own
        paths["stained"] = os.path.join(out_dir, "stained.png")
        save(paths["stained"], stained(load(paths["glass"]))[..., :3])
    parts = pack_parts(out_dir)
    paths["parts"] = os.path.join(out_dir, "parts.png")
    return paths, parts, bands


_YIQ = np.array([[0.299, 0.587, 0.114], [0.5959, -0.2746, -0.3213], [0.2115, -0.5227, 0.3112]])


def recolour(img, hue=0.0, sat=1.0, val=1.0, dye=None):
    """A painting in another colourway. Without `dye`: its hue turned by `hue` degrees round
    the grey axis (brightness kept), its colour strengthened by `sat`, then lifted or lowered
    by `val`. With `dye` (an RGB colour): every light and dark of the painting is kept and
    laid over that colour, and `sat` is how much of the painting's own colour variation
    (turned by `hue`) still shows through. The brushwork stays exactly where it was painted."""
    a = math.radians(hue)
    turn = np.array([[1.0, 0.0, 0.0], [0.0, math.cos(a) * sat, -math.sin(a) * sat], [0.0, math.sin(a) * sat, math.cos(a) * sat]])
    yiq = img[..., :3] @ _YIQ.T
    if dye is not None:
        target = _YIQ @ np.array(dye, dtype=np.float64)
        level = yiq[..., 0:1] / max(float(yiq[..., 0].mean()), 1e-6)
        mean = yiq[..., 1:].reshape(-1, 2).mean(0)
        varied = (yiq - np.array([0.0, mean[0], mean[1]])) @ turn.T
        yiq = np.concatenate([level * target[0], level * target[1] + varied[..., 1:2], level * target[2] + varied[..., 2:3]], axis=-1)
    else:
        yiq = yiq @ turn.T
    out = img.copy()
    out[..., :3] = np.clip(yiq @ np.linalg.inv(_YIQ).T * val, 0.0, 1.0)
    return out


def _blur_wrap(img, radius_y, radius_x=None):
    """A box blur that wraps round both edges (twice over, so it falls off softly), so a tile
    blurred with it still tiles. One radius for both ways, or one each for down and across."""
    out = img.astype(np.float64)
    for axis, radius in ((0, radius_y), (1, radius_y if radius_x is None else radius_x)):
        if radius < 1:
            continue
        for _ in range(2):
            n = out.shape[axis]
            pad = np.concatenate([out.take(range(n - radius, n), axis=axis), out, out.take(range(0, radius + 1), axis=axis)], axis=axis)
            total = np.cumsum(pad, axis=axis)
            hi = total.take(range(2 * radius + 1, 2 * radius + 1 + n), axis=axis)
            lo = total.take(range(0, n), axis=axis)
            out = (hi - lo) / (2 * radius + 1)
    return out


def ashlar(stone, dye=(0.7, 0.73, 0.77), courses=4, seed=11):
    """Dressed stone out of the rubble painting: its colours, with the rubble itself washed
    out, relaid as level courses of long blocks. Every block has its own shade, a dark seam
    round it, a lit upper edge and a shaded foot, and the long soft strokes of a brush drawn
    along it. A castle wall wants courses: rubble at a curtain wall's size reads as noise.
    Tiles both ways."""
    h, w = stone.shape[:2]
    base = recolour(stone, sat=0.3, dye=dye)[..., :3]
    # only the painting's slow drift of colour survives: no stone of the rubble does
    field = _blur_wrap(base, max(4, w // 7))
    field = field / field.mean(axis=(0, 1)) * np.array(dye)
    rng = np.random.default_rng(seed)
    # brushwork: noise drawn out along the courses, and a finer grain under it
    strokes = _blur_wrap(rng.normal(size=(h, w)), max(1, w // 300), max(4, w // 22))
    strokes = strokes / max(float(np.abs(strokes).max()), 1e-6)
    grain = _blur_wrap(rng.normal(size=(h, w)), max(1, w // 500))
    grain = grain / max(float(np.abs(grain).max()), 1e-6)
    course = h // courses
    seam = max(1.5, w / 210.0)
    bevel = max(3.0, w / 46.0)
    ys = np.arange(h)[:, None].astype(np.float64)
    x = np.arange(w).astype(np.float64)
    gain = np.ones((h, w), dtype=np.float64)

    def ramp(distance, width):
        t = np.clip(distance / width, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)

    for c in range(courses):
        y0 = c * course
        rows = slice(y0, y0 + course if c < courses - 1 else h)
        count = 2 + (c + int(rng.integers(0, 2))) % 2
        start = rng.uniform(0.0, w)
        cuts = np.sort((start + (np.arange(count) + rng.uniform(-0.14, 0.14, count)) * w / count) % w)
        block = np.searchsorted(cuts, x, side="right") % count
        from_left = (x - cuts[(block - 1) % count]) % w
        to_right = (cuts[block % count] - x) % w
        tone = rng.uniform(0.88, 1.1, count)[block]
        y = ys[rows] - y0
        height = y.shape[0]
        from_top = np.broadcast_to(y, (height, w))
        to_foot = np.broadcast_to(height - 1 - y, (height, w))
        fl = np.broadcast_to(from_left[None, :], (height, w))
        tr = np.broadcast_to(to_right[None, :], (height, w))
        g = np.broadcast_to(tone[None, :], (height, w)).copy()
        # a block's face: lighter toward its top, lit along its upper and left edges, shaded
        # along its foot and its right
        g *= 1.05 - 0.1 * (from_top / max(height - 1, 1))
        g *= 1.0 + 0.2 * (1.0 - ramp(from_top - seam, bevel))
        g *= 1.0 - 0.24 * (1.0 - ramp(to_foot - seam, bevel))
        g *= 1.0 + 0.08 * (1.0 - ramp(fl - seam, bevel))
        g *= 1.0 - 0.12 * (1.0 - ramp(tr - seam, bevel))
        # the seam itself
        nearest = np.minimum(np.minimum(from_top, to_foot), np.minimum(fl, tr))
        g *= 0.4 + 0.6 * ramp(nearest, seam * 1.5)
        gain[rows] = g
    # (and the slow clouding of a wash laid on by hand, so no block is one flat colour)
    clouds = _blur_wrap(rng.normal(size=(h, w)), max(2, w // 36))
    clouds = clouds / max(float(np.abs(clouds).max()), 1e-6)
    gain *= 1.0 + 0.035 * strokes + 0.03 * grain + 0.09 * clouds
    out = stone.copy()
    out[..., :3] = np.clip(field * gain[..., None], 0.0, 1.0)
    return out


def stained(glass, hue=178.0, sat=1.45, val=0.66):
    """The leaded glass in a chapel's colours: the amber quarries of the house glass turned
    to sapphire, their teal ones to rose and their red ones to sea-green, a shade deeper so
    the lit glass still reads as coloured. The leading and every brush stroke stay where they
    were painted (it is the same tile, so the two can stand side by side in one window)."""
    return recolour(glass, hue, sat, val)


def colourway(out_dir, paths, changes):
    """The prepared textures in another colourway: `changes` is {texture name: (hue, sat,
    val) or (hue, sat, val, dye)}; the others are shared. Returns the new {texture name: path}."""
    os.makedirs(out_dir, exist_ok=True)
    fresh = dict(paths)
    for name, change in changes.items():
        if name not in paths:
            continue
        target = os.path.join(out_dir, f"{name}.png")
        save(target, recolour(load(paths[name]), *change)[..., :3])
        fresh[name] = target
    return fresh


def downsized(out_dir, paths, tile=512, atlas=1024):
    """The prepared paintings at a smaller size, for small things seen small (the props):
    the same pictures and the same texture coordinates, a quarter of the memory. Returns
    the new {texture name: path}."""
    os.makedirs(out_dir, exist_ok=True)
    fresh = {}
    for name, source in paths.items():
        img = load(source)
        size = atlas if name == "parts" else min(tile, img.shape[0])
        small = resize(img, size, size) if img.shape[0] > size else img
        target = os.path.join(out_dir, f"{name}.png")
        save(target, small if name == "parts" else small[..., :3])
        fresh[name] = target
    return fresh
