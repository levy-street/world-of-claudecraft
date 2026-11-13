"""Prepares the painted maps of the Eastbrook ferry and the harbours from the Eastbrook town paintings.

  blender --background --python scripts/assets/eastbrook_ferry/paint_ferry.py

Reads the hand-painted sheets the Eastbrook houses are built from
(scripts/assets/eastbrook_houses/paint/*.png, prepared by that kit's paint.py) and writes,
beside this file:

  tex/ferry_wood.png      planking that tiles both ways: the painted hull's plank lines and
                          brush strokes, lifted light and nearly neutral so the ship's vertex
                          colours tint it (oxblood strakes, cream castles, gold mouldings)
  tex/ferry_cloth.png     sail canvas that tiles both ways: cream brushwork with sewn seams
  tex/ferry_fittings.png  the metal and carved work: bands that tile along their length
                          (gilded scrollwork, the red and gold bargeboard, a rope moulding,
                          riveted iron) over the gilded figurehead
  tex/harbour_stone.png   rubble stone that tiles both ways (the harbours' quay walls, plinths
                          and flagstones; the ferry wears none): the painted wall's joints and
                          facets, lifted light and nearly neutral like the planking
  tex/layout.json         where each band and part sits, the plank courses of the wood tile,
                          the figurehead's traced outline, and each map's mean colour (left
                          in the repo formatter's layout: Biome formats it as the last step)

Run it only when the paintings change. The builder (build_eastbrook_ferry.py) reads tex/ and
never the paintings, so a ferry build does not depend on the town kit.
"""
import json
import math
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_houses'))

import numpy as np  # noqa: E402
import paint  # noqa: E402

OUT = os.path.join(HERE, 'tex')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
LAYOUT_JSON = 'scripts/assets/eastbrook_ferry/tex/layout.json'
LUMA = np.array([0.299, 0.587, 0.114])


def luma(img):
    return (img[..., :3] * LUMA).sum(axis=-1)


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mean_linear(img):
    return [round(float(v), 4) for v in to_linear(np.clip(img[..., :3], 0, 1)).reshape(-1, 3).mean(axis=0)]


def blur_wrap(a, radius):
    """A separable box blur, three passes (close to a gaussian), wrapping at the edges."""
    out = a.astype(np.float64)
    for _ in range(3):
        for axis in (0, 1):
            acc = np.zeros_like(out)
            for d in range(-radius, radius + 1):
                acc += np.roll(out, d, axis=axis)
            out = acc / (2 * radius + 1)
    return out


def soft_clip(x, knee=0.86):
    """Leaves values under the knee alone and eases the rest in under 1."""
    over = np.maximum(x - knee, 0.0)
    span = 1.0 - knee
    return np.where(x > knee, knee + span * (1.0 - np.exp(-over / span)), x)


def noise(shape, cell, seed):
    """Smooth value noise that wraps (bilinear over a random lattice)."""
    rng = np.random.default_rng(seed)
    h, w = shape
    gh, gw = max(1, h // cell), max(1, w // cell)
    grid = rng.random((gh, gw))
    ys = np.arange(h) * gh / h
    xs = np.arange(w) * gw / w
    y0 = np.floor(ys).astype(int) % gh
    x0 = np.floor(xs).astype(int) % gw
    y1 = (y0 + 1) % gh
    x1 = (x0 + 1) % gw
    ty = (ys - np.floor(ys))[:, None]
    tx = (xs - np.floor(xs))[None, :]
    ty = ty * ty * (3 - 2 * ty)
    tx = tx * tx * (3 - 2 * tx)
    top = grid[np.ix_(y0, x0)] * (1 - tx) + grid[np.ix_(y0, x1)] * tx
    bottom = grid[np.ix_(y1, x0)] * (1 - tx) + grid[np.ix_(y1, x1)] * tx
    return top * (1 - ty) + bottom * ty


# -- wood ---------------------------------------------------------------------------------------

def wood_tile(size=1024, target=0.8, saturation=0.12):
    """The painted hull, kept for its drawing (plank lines, cracks, brush strokes) and lifted
    to a light, nearly neutral board: each pixel keeps its brightness RELATIVE to the board
    around it, so a dark outline stays dark while the red, brown and teal boards even out."""
    src = paint.wrap_edges(paint.resize(paint.load(os.path.join(paint.PAINT, 'hull.png'))[..., :3], size, size))
    lum = np.maximum(luma(src), 1e-3)
    base = np.maximum(blur_wrap(lum, size // 40), 1e-3)
    ratio = lum / base
    # a third of the board-to-board tone survives, so the courses still differ a little
    board = (base / base.mean()) ** 0.3
    shape = board * ratio ** 1.3
    # the outlines between boards go properly dark, like the ink lines of the town's paintings
    edge = np.clip((ratio - 0.42) / (0.8 - 0.42), 0.0, 1.0)
    line = 1.0 - edge * edge * (3 - 2 * edge)
    # ...and thick enough to still read from the quay: each line spreads a few pixels
    thick = line.copy()
    for d in (-5, -4, -3, -2, -1, 1, 2, 3, 4, 5):
        thick = np.maximum(thick, np.roll(line, d, axis=0) * (1.0 - 0.1 * abs(d)))
    shape = shape * (1.0 - 0.64 * thick)
    # the gain that lands the mean on target with the lights eased in rather than clipped
    lo, hi = 0.2, 3.0
    for _ in range(24):
        gain = (lo + hi) / 2
        if soft_clip(gain * shape, knee=0.7).mean() < target:
            lo = gain
        else:
            hi = gain
    out_lum = soft_clip(gain * shape, knee=0.7)
    chroma = src / lum[..., None]
    rgb = out_lum[..., None] * (1.0 + saturation * (chroma - 1.0))
    # a faint warmth: bare seasoned timber rather than grey card
    rgb = np.clip(rgb * np.array([1.025, 1.0, 0.94]), 0.0, 1.0)
    return paint.wrap_edges(rgb), ratio


def plank_courses(ratio):
    """The courses of the wood tile, found by the dark lines between them: [(v0, v1)] with v
    up, each inset to stay on its own board. One course wraps round the tile's edge."""
    h = ratio.shape[0]
    dark = (ratio < 0.62).mean(axis=1)
    dark = np.convolve(np.concatenate([dark[-6:], dark, dark[:6]]), np.ones(13) / 13, mode='valid')
    lines = []
    for y in np.argsort(-dark):
        if dark[y] < 0.18:
            break
        if all(min(abs(y - k), h - abs(y - k)) > h // 12 for k in lines):
            lines.append(int(y))
    lines.sort()
    inset = h * 0.022
    courses = []
    for a, b in zip(lines, lines[1:] + [lines[0] + h]):
        top, bottom = a + inset, b - inset
        courses.append((round(1.0 - bottom / h, 5), round(1.0 - top / h, 5)))
    return lines, courses


# -- stone --------------------------------------------------------------------------------------

def stone_tile(size=1024, target=0.78, saturation=0.22):
    """The painted rubble wall, kept for its drawing (the dark joints, the chiselled facets)
    and lifted to a light, nearly neutral stone the same way as the planking, so a harbour's
    vertex colours decide how warm or dark each block is."""
    src = paint.wrap_edges(paint.resize(paint.load(os.path.join(paint.PAINT, 'stone.png'))[..., :3], size, size))
    lum = np.maximum(luma(src), 1e-3)
    base = np.maximum(blur_wrap(lum, size // 28), 1e-3)
    ratio = lum / base
    # some of the stone-to-stone tone survives, so the wall is not one flat grey
    shape = (base / base.mean()) ** 0.35 * ratio ** 1.2
    edge = np.clip((ratio - 0.4) / (0.78 - 0.4), 0.0, 1.0)
    shape = shape * (0.5 + 0.5 * edge * edge * (3 - 2 * edge))
    lo, hi = 0.2, 3.0
    for _ in range(24):
        gain = (lo + hi) / 2
        if soft_clip(gain * shape, knee=0.7).mean() < target:
            lo = gain
        else:
            hi = gain
    out_lum = soft_clip(gain * shape, knee=0.7)
    chroma = src / lum[..., None]
    rgb = out_lum[..., None] * (1.0 + saturation * (chroma - 1.0))
    return paint.wrap_edges(np.clip(rgb, 0.0, 1.0))


# -- cloth --------------------------------------------------------------------------------------

def cloth_tile(trim, bands, size=512, target=0.9):
    """Sail canvas: the painted plaster's cream brushwork (a stretch with no cracks in it),
    mirrored into a tile, with sewn seams every quarter across and every half down."""
    v0, v1, _ = bands['plaster']
    h = trim.shape[0]
    top, bottom = int(round((1 - v1) * h)), int(round((1 - v0) * h))
    w = trim.shape[1]
    patch = trim[top + 6 : bottom - 6, int(w * 0.25) : int(w * 0.68), :3]
    quarter = size // 4
    strip = paint.wrap_edges(paint.resize(patch, size, quarter))
    # four courses of the same brushwork, each slid along and every other one turned over, so
    # no two line up and nothing mirrors
    rows = [np.roll(strip if k % 2 == 0 else strip[::-1], k * 131, axis=1) for k in range(4)]
    img = np.concatenate(rows, axis=0)
    soft = (np.roll(img, 1, axis=0) + img + np.roll(img, -1, axis=0)) / 3.0
    for k in range(4):
        for d in range(-3, 3):
            img[(k * quarter + d) % size] = soft[(k * quarter + d) % size]
    lum = np.maximum(luma(img), 1e-3)
    base = np.maximum(blur_wrap(lum, size // 16), 1e-3)
    out_lum = soft_clip(target * 1.02 * (lum / base) ** 1.2 * (base / base.mean()) ** 0.1, knee=0.93)
    chroma = img / lum[..., None]
    rgb = out_lum[..., None] * (1.0 + 0.3 * (chroma - 1.0))
    # weathering: broad soft patches, a touch darker and warmer
    patches = noise((size, size), size // 4, 7) * 0.6 + noise((size, size), size // 10, 11) * 0.4
    rgb = rgb * (1.0 - 0.035 * patches[..., None] * np.array([0.8, 1.0, 1.35]))
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    wobble = noise((size, size), size // 8, 3) - 0.5

    def seam(coord, across, at, strength=1.0):
        """A sewn seam: a dark painted line, a lit hem beside it, stitches along it."""
        d = coord + wobble * 3.0 - at
        d = (d + size / 2) % size - size / 2
        line = np.exp(-(d / 3.0) ** 2)
        hem = np.exp(-((d - 6.5) / 3.0) ** 2)
        shade = np.exp(-((d + 7.0) / 6.0) ** 2)
        stitch = np.exp(-((d - 11.5) / 1.2) ** 2) * (((across + at * 3) % 11.0) < 5.0)
        ink = 0.55 + 0.45 * noise((size, size), size // 12, int(at) + 17)
        return strength * ink * (0.8 * line + 0.34 * stitch + 0.14 * shade) - strength * 0.07 * hem

    darken = np.zeros((size, size))
    for k in range(4):
        darken += seam(xx, yy, k * size / 4 + 2.0)
    for k in range(2):
        darken += seam(yy, xx, k * size / 2 + 2.0, strength=0.8)
    darken = np.clip(darken, -0.1, 0.75)
    ink = np.array([0.5, 0.38, 0.26])
    rgb = rgb * (1.0 - darken[..., None]) + ink * rgb * np.maximum(darken, 0.0)[..., None]
    rgb = np.clip(rgb * (target / luma(rgb).mean()), 0.0, 1.0)
    return rgb


# -- fittings -----------------------------------------------------------------------------------

def band_rows(trim, bands, name):
    v0, v1, _ = bands[name]
    h = trim.shape[0]
    return trim[int(round((1 - v1) * h)) : int(round((1 - v0) * h)), :, :3]


def iron_strip(trim, bands, target=0.74):
    """Riveted iron: the painted oak beam with its studs, with the colour taken out, cooled a
    little and lifted light so the vertex colour decides how dark each fitting is."""
    oak = band_rows(trim, bands, 'oak')
    lum = np.maximum(luma(oak), 1e-3)
    base = np.maximum(blur_wrap(lum, 20), 1e-3)
    out = soft_clip(target * (lum / base) ** 1.1 * (base / base.mean()) ** 0.35)
    rgb = out[..., None] * np.array([0.97, 0.99, 1.04])
    return np.clip(rgb * (target / luma(rgb).mean()), 0.0, 1.0)


def fittings_atlas(trim, bands, size=1024):
    atlas = np.zeros((size, size, 3))
    layout = {'bands': {}, 'parts': {}}
    gutter = 6
    y = 0
    bargeboard = band_rows(trim, bands, 'bargeboard')
    rope_rows = max(8, int(bargeboard.shape[0] * 0.2))
    rope = paint.resize(bargeboard[:rope_rows], size, rope_rows * 2)
    strips = [
        ('gilded', band_rows(trim, bands, 'gilded')),
        ('bargeboard', bargeboard),
        ('rope', rope),
        ('iron', iron_strip(trim, bands)),
    ]
    for name, strip in strips:
        if strip.shape[1] != size:
            strip = paint.resize(strip, size, strip.shape[0])
        strip = paint.wrap_edges(strip, band=6)[..., :3]
        hgt = strip.shape[0]
        atlas[y : y + gutter] = strip[0]
        atlas[y + gutter : y + gutter + hgt] = strip
        atlas[y + gutter + hgt : y + 2 * gutter + hgt] = strip[-1]
        top, bottom = y + gutter + 1, y + gutter + hgt - 1
        layout['bands'][name] = [round(1.0 - bottom / size, 5), round(1.0 - top / size, 5),
                                 round(size / (bottom - top), 4)]
        if name == 'iron':
            layout['iron_mean_linear'] = mean_linear(strip)
        y += hgt + 2 * gutter
    # the gilded figurehead, cut out of its sheet; the unpainted ground inside its box takes a
    # deep gilt so a filtered edge never pulls in black
    spec = paint.CROPS['figurehead']
    sheet = paint.crisp_alpha(paint.key_out(paint.load(os.path.join(paint.PAINT, f"{spec['sheet']}.png"))))
    sprite = paint.cut({spec['sheet']: sheet}, spec)
    room = size - y - 2 * gutter
    scale = min(1.0, room / sprite.shape[0])
    sprite = paint.resize(sprite, int(sprite.shape[1] * scale), int(sprite.shape[0] * scale))
    loops = paint.outline(sprite, cells=90, tolerance=1.0)
    outer = max(loops, key=len)
    reach = 14
    filled = paint.bleed(sprite, rounds=reach)
    near = sprite[..., 3] > 0.5
    for _ in range(reach):
        near = near | np.roll(near, 1, 0) | np.roll(near, -1, 0) | np.roll(near, 1, 1) | np.roll(near, -1, 1)
    ground = np.array([0.42, 0.27, 0.08])
    rgb = np.where(near[..., None], filled[..., :3], ground)
    hgt, wid = rgb.shape[:2]
    x0, y0 = gutter, y + gutter
    atlas[y:, :] = ground
    atlas[y0 : y0 + hgt, x0 : x0 + wid] = rgb
    layout['parts']['figurehead'] = {
        'uv': [round(x0 / size, 5), round(1.0 - (y0 + hgt) / size, 5), round((x0 + wid) / size, 5),
               round(1.0 - y0 / size, 5)],
        'aspect': round(wid / hgt, 4),
        'loop': [[round(fx, 4), round(fy, 4)] for fx, fy, _nx, _ny in outer],
    }
    # the rest of that shelf: plain gilt (the scrollwork's flat border, course on course) for
    # carved work with no painting of its own
    gx0 = x0 + wid + 3 * gutter
    border = band_rows(trim, bands, 'gilded')[5:25, : size - gx0 - gutter]
    course = np.concatenate([border, border[::-1]], axis=0)
    reps = int(math.ceil((size - y0 - gutter) / course.shape[0]))
    gilt = np.concatenate([np.roll(course, k * 157, axis=1) for k in range(reps)], axis=0)[: size - y0 - gutter]
    atlas[y0 : y0 + gilt.shape[0], gx0 : gx0 + gilt.shape[1]] = gilt[..., :3]
    layout['parts']['gilt'] = {
        'uv': [round((gx0 + 4) / size, 5), round(1.0 - (y0 + gilt.shape[0] - 4) / size, 5),
               round((gx0 + gilt.shape[1] - 4) / size, 5), round(1.0 - (y0 + 4) / size, 5)],
        'aspect': round(gilt.shape[1] / gilt.shape[0], 4),
    }
    return np.clip(atlas, 0.0, 1.0), layout


def main():
    os.makedirs(OUT, exist_ok=True)
    layout = {}
    wood, ratio = wood_tile()
    lines, courses = plank_courses(ratio)
    paint.save(os.path.join(OUT, 'ferry_wood.png'), wood)
    layout['wood'] = {'tile': 2.8, 'mean_linear': mean_linear(wood), 'courses': courses}
    print('WOOD mean', round(float(luma(wood).mean()), 3), 'course lines', lines)
    trim = paint.resize(paint.load(os.path.join(paint.PAINT, 'trim.png'))[..., :3], 1024, 1024)
    bands = paint.find_bands(trim)
    cloth = cloth_tile(trim, bands)
    paint.save(os.path.join(OUT, 'ferry_cloth.png'), cloth)
    layout['cloth'] = {'tile': 5.0, 'mean_linear': mean_linear(cloth)}
    print('CLOTH mean', round(float(luma(cloth).mean()), 3))
    atlas, fit = fittings_atlas(trim, bands)
    paint.save(os.path.join(OUT, 'ferry_fittings.png'), atlas)
    layout['fittings'] = fit
    stone = stone_tile()
    paint.save(os.path.join(OUT, 'harbour_stone.png'), stone)
    layout['stone'] = {'tile': 4.0, 'mean_linear': mean_linear(stone)}
    print('STONE mean', round(float(luma(stone).mean()), 3))
    print('FITTINGS', json.dumps({k: v for k, v in fit['bands'].items()}))
    with open(os.path.join(ROOT, LAYOUT_JSON), 'w', encoding='utf-8') as fh:
        json.dump(layout, fh, indent=1, sort_keys=True)
        fh.write('\n')
    # the layout is checked in and fingerprinted: keep it in the repo formatter's layout, so a
    # rerun that changes nothing leaves the file (and every model's fingerprint) byte for byte
    command = ['npx', '@biomejs/biome', 'format', '--write', LAYOUT_JSON]
    print('$', ' '.join(command))
    subprocess.run(command, cwd=ROOT, check=True)
    print('WROTE', OUT)


if __name__ == '__main__':
    main()
