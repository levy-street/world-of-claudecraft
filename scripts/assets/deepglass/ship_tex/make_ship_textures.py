# Texture set for the Tidehold galleon (dg_galleon.py), hand-painted to sit
# with SPACEY's packs:
#   ShipSail_Color.jpg      - weathered canvas: panel seams + stitching, reef
#                              bands with points, bolt-rope edge, two patches,
#                              grime at the foot (made here, no source image)
#   ShipSailCrest_Color.jpg - the same canvas carrying the Tidehold crest: a
#                              Warden teal lozenge, brass border, tower + waves
#   ShipPennant_Color.jpg   - the same canvas dyed Warden blue for the three
#                              masthead pennants (dyed HERE: the glTF export
#                              drops a Blender multiply-tint node)
#   ShipRopeNet.png          - RGBA rope net for the shrouds/ratlines (alpha
#                              cut-out: the glTF material is MASK, double-sided)
#   ShipHull_Color/Normal    - Planks85_04 long strakes, warmed for a hull
#   ShipBand_Color/Normal    - Wood189_17 boards hue-shifted to a royal blue
#                              band (the WoW Alliance hull colour), turned so
#                              the boards run along the ship
#   python3 scripts/assets/deepglass/ship_tex/make_ship_textures.py <your texture folder>
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
# The source texture pack (the "WOC Asset Textures compressed 1K" folder) lives
# outside the repo: pass its path as the first argument or set WOC_TEXTURE_PACK.
PACK = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('WOC_TEXTURE_PACK', ''))
rng = np.random.default_rng(4217)


def noise(size, scale, octaves=4):
    """Smooth value noise in [0, 1] (bilinear upsampled random grids)."""
    out = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = max(2, int(size / scale * 2 ** o))
        g = rng.random((n, n)).astype(np.float32)
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)
        out += amp * np.asarray(img, np.float32) / 255.0
        tot += amp
        amp *= 0.5
    return out / tot


def canvas(size=1024):
    base = np.array([228, 216, 186], np.float32)
    mott = noise(size, 256) - 0.5
    fibre = noise(size, 12, 2) - 0.5
    img = np.ones((size, size, 3), np.float32) * base
    img *= (1.0 + 0.10 * mott[..., None] + 0.05 * fibre[..., None])
    # top-lit shading and grime settling toward the foot
    y = np.linspace(0, 1, size, dtype=np.float32)[:, None, None]
    img *= 1.04 - 0.1 * y
    grime = np.clip((y - 0.72) / 0.28, 0, 1) * (0.55 + 0.45 * noise(size, 96)[..., None])
    img = img * (1 - 0.22 * grime) + np.array([110, 96, 70], np.float32) * 0.22 * grime
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    panels = 8
    pw = size / panels
    for k in range(1, panels):
        x = int(k * pw)
        d.line([(x - 1, 0), (x - 1, size)], fill=(150, 136, 108), width=3)
        d.line([(x + 2, 0), (x + 2, size)], fill=(242, 234, 210), width=2)
        for yy in range(6, size, 18):
            d.line([(x - 5, yy), (x - 5, yy + 8)], fill=(168, 152, 120), width=1)
            d.line([(x + 6, yy + 9), (x + 6, yy + 17)], fill=(168, 152, 120), width=1)
    # reef bands with reef points
    for yy in (int(size * 0.2), int(size * 0.36)):
        d.rectangle([0, yy - 7, size, yy + 7], fill=None, outline=None)
        d.line([(0, yy - 7), (size, yy - 7)], fill=(160, 146, 116), width=2)
        d.line([(0, yy + 7), (size, yy + 7)], fill=(160, 146, 116), width=2)
        for xx in range(int(pw / 2), size, int(pw / 2)):
            d.ellipse([xx - 4, yy - 4, xx + 4, yy + 4], fill=(120, 104, 78))
            d.line([(xx, yy + 4), (xx + 3, yy + 22)], fill=(170, 150, 110), width=3)
    # doubled head and foot bands + the bolt rope round the edge
    for (y0, y1) in ((0, 34), (size - 40, size)):
        band = Image.new('RGBA', (size, y1 - y0), (120, 100, 70, 38))
        im.paste(band, (0, y0), band)
        d.line([(0, y1 if y0 == 0 else y0), (size, y1 if y0 == 0 else y0)], fill=(146, 130, 100), width=2)
    d.rectangle([0, 0, size - 1, size - 1], outline=(126, 108, 78), width=7)
    # two patches, stitched on
    for (px, py, w, h) in ((int(size * 0.14), int(size * 0.58), 120, 96), (int(size * 0.7), int(size * 0.27), 88, 110)):
        patch = Image.new('RGB', (w, h), (214, 198, 160))
        pa = np.asarray(patch, np.float32) * (1 + 0.08 * (noise(max(w, h), 40, 2)[:h, :w, None] - 0.5))
        im.paste(Image.fromarray(np.clip(pa, 0, 255).astype(np.uint8)), (px, py))
        d.rectangle([px, py, px + w, py + h], outline=(140, 122, 92), width=2)
        for t in range(0, w, 10):
            d.line([(px + t, py + 4), (px + t + 5, py + 4)], fill=(120, 100, 72), width=1)
            d.line([(px + t, py + h - 4), (px + t + 5, py + h - 4)], fill=(120, 100, 72), width=1)
        for t in range(0, h, 10):
            d.line([(px + 4, py + t), (px + 4, py + t + 5)], fill=(120, 100, 72), width=1)
            d.line([(px + w - 4, py + t), (px + w - 4, py + t + 5)], fill=(120, 100, 72), width=1)
    return im.filter(ImageFilter.GaussianBlur(0.6))


def crest(sail):
    """Paint the Tidehold crest onto a sail, modulated by the canvas so it reads
    as paint on cloth: teal lozenge, brass border, a Warden tower over waves."""
    size = sail.size[0]
    cx, cy = size // 2, int(size * 0.56)
    hx, hy = int(size * 0.27), int(size * 0.33)
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    diamond = lambda sx, sy: [(cx, cy - sy), (cx + sx, cy), (cx, cy + sy), (cx - sx, cy)]
    d.polygon(diamond(hx + 22, hy + 26), fill=(214, 162, 78, 255))            # brass border
    d.polygon(diamond(hx + 6, hy + 8), fill=(88, 60, 26, 255))                  # dark keyline
    d.polygon(diamond(hx, hy), fill=(29, 108, 120, 255))                        # Warden teal
    d.polygon(diamond(hx - 26, hy - 30), outline=(95, 208, 232, 255), width=5)  # rune glow line
    # the tower: shaft, crenellations, gate, a rune window
    tw, th = int(size * 0.09), int(size * 0.24)
    tx0, ty0 = cx - tw // 2, cy - th // 2 - 20
    d.rectangle([tx0, ty0, tx0 + tw, ty0 + th], fill=(236, 222, 186, 255))
    mw = tw // 5
    for i in range(3):
        mx = tx0 - mw // 2 + i * (tw // 2)
        d.rectangle([mx, ty0 - mw, mx + mw + 4, ty0 + 2], fill=(236, 222, 186, 255))
    d.rectangle([tx0 - 10, ty0 + th - 18, tx0 + tw + 10, ty0 + th], fill=(236, 222, 186, 255))
    d.pieslice([cx - 16, ty0 + th - 46, cx + 16, ty0 + th - 14], 180, 360, fill=(29, 108, 120, 255))
    d.rectangle([cx - 16, ty0 + th - 30, cx + 16, ty0 + th], fill=(29, 108, 120, 255))
    d.polygon([(cx, ty0 + 30), (cx + 10, ty0 + 44), (cx, ty0 + 58), (cx - 10, ty0 + 44)], fill=(95, 208, 232, 255))
    # waves under the tower
    for k, yy in enumerate((cy + th // 2 + 10, cy + th // 2 + 38)):
        pts = []
        half = (hx - 30) * (1 - (yy - cy) / hy)   # the lozenge's half-width at this height
        for i in range(0, int(2 * half), 6):
            x = cx - half + i
            pts.append((x, yy + 9 * np.sin(i / 22.0 + k)))
        d.line(pts, fill=(214, 162, 78, 255), width=7)
    layer = layer.filter(ImageFilter.GaussianBlur(1.2))
    sa = np.asarray(sail, np.float32)
    la = np.asarray(layer, np.float32)
    alpha = la[..., 3:4] / 255.0
    lum = (sa.mean(axis=2, keepdims=True) / 210.0).clip(0.7, 1.15)
    out = sa * (1 - alpha * 0.92) + la[..., :3] * lum * alpha * 0.92
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def rope_net(size=512):
    """Shroud net tile: 4 shrouds (vertical) x 8 ratlines (sagging), alpha cut."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rope = (188, 158, 104, 255)
    dark = (120, 96, 60, 255)
    cols = [size * (k + 0.5) / 4 for k in range(4)]
    rows = [size * (k + 0.5) / 8 for k in range(8)]
    for x in cols:
        d.line([(x, 0), (x, size)], fill=dark, width=12)
        d.line([(x - 1, 0), (x - 1, size)], fill=rope, width=8)
        for y in range(0, size, 14):
            d.line([(x - 4, y), (x + 4, y + 7)], fill=dark, width=2)
    for y in rows:
        pts = []
        for i in range(0, size + 1, 8):
            k = (i % (size // 4)) / (size / 4)
            pts.append((i, y + 5 * np.sin(np.pi * k)))
        d.line(pts, fill=dark, width=7)
        d.line([(p[0], p[1] - 1) for p in pts], fill=rope, width=4)
    return im


def board_set(src, out_color, out_normal, size, tint=None, hue=None, rot=False, lift=1.0, gamma=1.0):
    """`gamma` < 1 lifts the midtones the way a linear `lift` cannot: a 1.7x
    lift to reach the hull's colour clips every highlight flat, a 0.62 gamma
    gets the same average with the grain intact (p99 stays under 160)."""
    c = Image.open(src + '_Color.jpg').convert('RGB')
    a = Image.open(src + '_AmbientOcclusion.jpg').convert('L').resize(c.size)
    n = Image.open(src + '_NormalGL.jpg').convert('RGB')
    if rot:
        c, a = c.rotate(90, expand=True), a.rotate(90, expand=True)
        # a 90-degree turn swaps the tangent axes: rotate the normal map's
        # vectors with the image (x' = y, y' = -x in tangent space)
        n = n.rotate(90, expand=True)
        na = np.asarray(n, np.float32) / 127.5 - 1.0
        na = np.stack([na[..., 1], -na[..., 0], na[..., 2]], axis=-1)
        n = Image.fromarray(np.clip((na + 1.0) * 127.5, 0, 255).astype(np.uint8))
    if hue is not None:
        # repaint every PAINTED board one colour (hue = target, 0..255 PIL
        # scale); the unpainted brown wood between boards (low saturation or
        # a brown hue) keeps its own colour
        hsv = np.asarray(c.convert('HSV'), np.int16).copy()
        painted = (hsv[..., 1] > 70) & ((hsv[..., 0] > 40) & (hsv[..., 0] < 200))
        hsv[..., 0] = np.where(painted, hue, hsv[..., 0])
        hsv[..., 1] = np.where(painted, (hsv[..., 1] * 0.62).astype(np.int16), hsv[..., 1])
        hsv[..., 2] = np.where(painted, np.minimum(255, hsv[..., 2] * 1.12).astype(np.int16), hsv[..., 2])
        c = Image.fromarray(hsv.astype(np.uint8)).convert('RGB') if False else Image.merge(
            'HSV', [Image.fromarray(hsv[..., i].astype(np.uint8)) for i in range(3)]).convert('RGB')
    arr = np.asarray(c, np.float32) * (0.62 + 0.38 * np.asarray(a, np.float32)[..., None] / 255.0) * lift
    arr = 255.0 * (np.clip(arr, 0, 255) / 255.0) ** gamma
    if tint is not None:
        arr *= np.array(tint, np.float32)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS).save(out_color, quality=90)
    n.resize((size // 2, size // 2), Image.LANCZOS).save(out_normal, quality=90)


def lifted(src_color, out_color, gamma, tint):
    """A lighter, warmer twin of a finished wharf colour map (the deck planks
    and mast timber the galleon shares with the docks). The ship keeps the
    wharf's NORMAL maps - only the colour is re-graded, so the docks stay their
    weathered dark and the ship reads as the lighter honey wood of a WoW boat
    moored against them."""
    arr = np.asarray(Image.open(src_color).convert('RGB'), np.float32) / 255.0
    arr = 255.0 * arr ** gamma * np.array(tint, np.float32)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(out_color, quality=90)


def pennant(sail, rgb=(0.20, 0.42, 0.86)):
    """The mastheads' Warden-blue pennant cloth: the same woven canvas dyed.
    It is a SEPARATE texture on purpose - the glTF exporter drops a Blender
    multiply-tint node, so a dyed cloth has to arrive already dyed."""
    arr = np.asarray(sail).astype(np.float32) / 255.0
    lum = arr.mean(axis=2, keepdims=True)
    dyed = lum * np.array(rgb, dtype=np.float32) * 1.25
    return Image.fromarray(np.clip(dyed * 255.0, 0, 255).astype(np.uint8))


def main():
    if not PACK:
        sys.exit('usage: python3 %s <your texture folder> (or set WOC_TEXTURE_PACK)' % __file__)
    sail = canvas()
    sail.save(os.path.join(HERE, 'ShipSail_Color.jpg'), quality=90)
    crest(sail).save(os.path.join(HERE, 'ShipSailCrest_Color.jpg'), quality=90)
    pennant(sail).save(os.path.join(HERE, 'ShipPennant_Color.jpg'), quality=90)
    rope_net().save(os.path.join(HERE, 'ShipRopeNet.png'))
    # The hull, the deck and the timber all graded to the honey-brown of a WoW
    # boat (SPACEY: "lighter and more like the wow ship color wise"): the hull
    # comes up from an average of (88, 63, 45) - a near-black maroon in the
    # harbour's light - to about (139, 107, 74), by gamma rather than a linear
    # lift so the grain and the caulking lines survive.
    board_set(os.path.join(PACK, 'Planks', 'Planks85_04'), os.path.join(HERE, 'ShipHull_Color.jpg'),
              os.path.join(HERE, 'ShipHull_Normal.jpg'), 1024, tint=(1.14, 0.99, 0.74), gamma=0.62)
    wharf = os.path.join(os.path.dirname(HERE), 'wharf_tex')
    lifted(os.path.join(wharf, 'WharfPlanks_Color.jpg'), os.path.join(HERE, 'ShipDeck_Color.jpg'),
           gamma=0.66, tint=(1.08, 1.0, 0.86))
    lifted(os.path.join(wharf, 'WharfTimber_Color.jpg'), os.path.join(HERE, 'ShipTimber_Color.jpg'),
           gamma=0.70, tint=(1.10, 1.0, 0.86))
    board_set(os.path.join(PACK, 'Wood', 'Wood189_17'), os.path.join(HERE, 'ShipBand_Color.jpg'),
              os.path.join(HERE, 'ShipBand_Normal.jpg'), 512, hue=172, rot=True, lift=1.0)
    for f in sorted(os.listdir(HERE)):
        if f.endswith(('.jpg', '.png')):
            print(f, os.path.getsize(os.path.join(HERE, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
