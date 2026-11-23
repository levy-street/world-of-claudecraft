"""Tidehold town kit v2: the INTERIOR PROP detail maps (SPACEY, 2026-09-26:
"build out aaa qul textures for all of the small assets inside the buildings
like cuboards etc..").

The medieval_village_v2 props are palette-mapped: a face's whole UV footprint
is a tenth of a texel of CartoonTown_Texture_01, so a cupboard is flat brown
(see the README's kit-palette section). bl_town_lib.detail_prop_template()
moves each flat face onto one of four TILING detail materials with box UVs
and carries its ORIGINAL swatch in the 'Col' vertex colour, which three
multiplies over the map. So these maps are DETAIL, not colour: luminance
high passes normalised to a linear mean of 1.0 and stored divided by
HEADROOM (the vertex tint is multiplied by the same number), so
swatch x detail averages back to the swatch and the kit's palette is kept.

  TownPropWood   oak grain from the v1 timber source (Wood187_09, the wood
                 SPACEY asked to keep), its plank seams cut out and the boards
                 cross-faded: the geometry already makes the boards.
  TownPropMetal  hammered iron: dimples with painted light, scratches, pits,
                 rust (scalar roughness/metal: an ORM map would be merged
                 with the smart mask by the glTF exporter).
  TownPropStone  the jointless dressed limestone, high-passed (forge, lecterns).
  TownPropCloth  plain weave with slubbed threads, fuzz, soft stains.

Run: python3 paint_props.py            (writes into this folder)
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forge as fg  # noqa: E402

F = np.float32
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'town_tex', 'src')
N = 1024
NORMAL_SIZE = 512      # as the building maps
HEADROOM = 1.45        # bl_town_lib.PROP_HEADROOM multiplies the vertex tint by this


def out(name):
    return os.path.join(HERE, name)


def load(path, n=N):
    im = Image.open(path).convert('RGB')
    if im.size != (n, n):
        im = im.resize((n, n), Image.LANCZOS)
    return np.asarray(im).astype(F) / 255.0


def lum_lin(rgb_srgb):
    lin = fg.srgb_to_lin(rgb_srgb)
    return (0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]).astype(F)


def save_detail(name, detail_lin, tint=(1.0, 1.0, 1.0)):
    """detail_lin: linear multiplier field (mean ~1). Store / HEADROOM in sRGB."""
    d = detail_lin / max(float(detail_lin.mean()), 1e-4)
    rgb = np.clip(d[..., None] * np.array(tint, F)[None, None, :] / HEADROOM, 0, 1)
    fg.save_rgb(fg.lin_to_srgb(rgb), out(f'TownProp{name}_Color.jpg'))
    over = float((d * max(tint) > HEADROOM).mean())
    print(f'  {name}: detail mean {d.mean():.3f}  range {d.min():.2f}..{d.max():.2f}  clipped {over * 100:.2f}%')
    return d


def preview(name, d, swatch):
    """A 512 px look at the map on a typical swatch (what the game shows)."""
    sw = fg.srgb_to_lin(np.array(fg.hexc(swatch), F))
    rgb = fg.lin_to_srgb(np.clip(d[..., None] * sw[None, None, :], 0, 1))
    Image.fromarray((rgb[:512, :512] * 255).astype(np.uint8)).save(out(f'_preview_prop_{name.lower()}.jpg'), quality=90)


# =============================================================================
#  WOOD: v1 oak, seams removed
# =============================================================================
def seamless_boards(img, seams, trim=7, fade=28):
    """Cut the boards out between the seams and cross-fade them back into one
    continuous, tileable field of grain (then resample to N wide)."""
    n = img.shape[1]
    seams = sorted(seams)
    strips = []
    for i, s0 in enumerate(seams):
        s1 = seams[(i + 1) % len(seams)]
        a, b = s0 + trim, s1 - trim
        if b <= a:
            b += n
        idx = np.arange(a, b) % n
        strips.append(img[:, idx])
    outw = sum(s.shape[1] for s in strips) - fade * len(strips)
    acc = np.zeros((img.shape[0], outw + fade) + img.shape[2:], F)
    wsum = np.zeros((1, outw + fade) + (1,) * (img.ndim - 2), F)
    x = 0
    for s in strips:
        w = s.shape[1]
        ramp = np.ones(w, F)
        ramp[:fade] = np.linspace(0, 1, fade, dtype=F)
        ramp[-fade:] = np.linspace(1, 0, fade, dtype=F)
        r = ramp.reshape((1, w) + (1,) * (img.ndim - 2))
        acc[:, x:x + w] += s * r
        wsum[:, x:x + w] += r
        x += w - fade
    # wrap the tail's fade onto the head so the tile repeats
    acc[:, :fade] += acc[:, outw:outw + fade]
    wsum[:, :fade] += wsum[:, outw:outw + fade]
    field = acc[:, :outw] / np.maximum(wsum[:, :outw], 1e-4)
    im = Image.fromarray((np.clip(field, 0, 1) * 255).astype(np.uint8)) if field.ndim == 3 else None
    return np.asarray(im.resize((n, img.shape[0]), Image.LANCZOS)).astype(F) / 255.0


def wood():
    seams = [126, 337, 588, 715, 961]        # measured: column minima of the high-passed profile
    col = seamless_boards(load(os.path.join(SRC, 'Wood187_09_Color.jpg')), seams)
    nrm = seamless_boards(load(os.path.join(SRC, 'Wood187_09_NormalGL.jpg')), seams)
    L = lum_lin(col)
    d = L / fg.blur(L, 44)
    d = np.power(np.clip(d, 1e-3, None), 0.85)           # the source's grain (dark swatches swallow a softer one)
    # a whisper of broad tonal drift so a big tabletop is not uniform
    d = d * (0.94 + 0.12 * fg.fbm(N, 2, 3, 71))
    d = save_detail('Wood', d)
    v = nrm * 2 - 1
    v[..., 2] = np.maximum(v[..., 2], 0.05)
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    fg.save_normal(v, out('TownPropWood_Normal.jpg'), NORMAL_SIZE)
    preview('Wood', d, '#6a422a')
    Image.fromarray((col[:512, :512] * 255).astype(np.uint8)).save(out('_preview_prop_wood_src.jpg'), quality=90)


# =============================================================================
#  METAL: hammered, scratched, a little rust
# =============================================================================
def metal():
    s = 3100
    px, py = fg.uv(N)
    wx = (fg.fbm(N, 6, 3, s + 1) - 0.5) * 18
    wy = (fg.fbm(N, 6, 3, s + 2) - 0.5) * 18
    v = fg.voronoi(N, 16, s + 3, jitter=0.95, warp=(wx, wy))
    # peen dimples: shallow dishes over each cell, rims where cells meet
    r = np.clip(v['f1'] / (N / 16 * 0.75), 0, 1)
    dimple = -(1 - r * r) * 0.5
    h = dimple * 0.6 + 0.25 * (fg.fbm(N, 12, 4, s + 4) - 0.5)
    # scratches: thin dragged lines at a few angles, sparse
    scr = np.zeros((N, N), F)
    for k, a in enumerate((0.3, -0.9, 1.35, 2.2)):
        line = fg.norm01(fg.dir_blur(fg.white(N, s + 10 + k), 40, 0.6, a))
        scr = np.maximum(scr, fg.sstep(0.8, 0.92, line) * fg.sstep(0.55, 0.75, fg.fbm(N, 5, 3, s + 20 + k)))
    pits = fg.sstep(0.9, 0.97, fg.white(N, s + 30) * 0.4 + fg.fbm(N, 50, 2, s + 31) * 0.6)
    rust = fg.sstep(0.6, 0.78, fg.fbm(N, 5, 5, s + 32) * 0.75 + fg.fbm(N, 30, 3, s + 33) * 0.25)
    h = h - 0.25 * pits - 0.06 * scr + 0.05 * rust * fg.fbm(N, 60, 2, s + 34)
    h = fg.blur(h, 1.0)
    L = fg.light(h, 30.0, wrap=0.45)
    d = 0.55 + 0.9 * L                                   # painted highlights on the dimple rims
    d = d * (1 + 0.55 * scr) * (1 - 0.45 * pits)
    d = d * (0.9 + 0.2 * fg.fbm(N, 3, 4, s + 35))
    lum = d / d.mean()
    # rust: warm and dull in the colour (a tint, so the map is RGB here)
    rust_rgb = np.array([1.35, 0.92, 0.62], F)
    rgb = lum[..., None] * (1 + rust[..., None] * 0.9 * (rust_rgb[None, None, :] - 1))
    rgb = rgb / rgb.reshape(-1, 3).mean(0).mean()
    fg.save_rgb(fg.lin_to_srgb(np.clip(rgb / HEADROOM, 0, 1)), out('TownPropMetal_Color.jpg'))
    print(f'  Metal: detail mean {rgb.mean():.3f} range {rgb.min():.2f}..{rgb.max():.2f}')
    fg.save_normal(fg.normal(h, 16.0), out('TownPropMetal_Normal.jpg'), NORMAL_SIZE)
    sw = fg.srgb_to_lin(np.array(fg.hexc('#444a4e'), F))
    prev = fg.lin_to_srgb(np.clip(rgb[:512, :512] * sw * 1.0, 0, 1))
    Image.fromarray((prev * 255).astype(np.uint8)).save(out('_preview_prop_metal.jpg'), quality=90)


# =============================================================================
#  STONE: the dressed limestone, jointless
# =============================================================================
def stone():
    col = load(out('TownDressed_Color.jpg'))
    L = lum_lin(col)
    d = L / fg.blur(L, 36)
    d = np.power(np.clip(d, 1e-3, None), 1.35)          # dark stone wants more bite
    d = d * (0.9 + 0.2 * fg.fbm(N, 3, 4, 91))
    d = save_detail('Stone', d)
    Image.open(out('TownDressed_Normal.jpg')).convert('RGB').save(out('TownPropStone_Normal.jpg'), quality=94)
    preview('Stone', d, '#444a4e')


# =============================================================================
#  CLOTH: plain weave
# =============================================================================
def cloth():
    s = 4100
    y, x = np.mgrid[0:N, 0:N].astype(F)
    pitch = N / 84.0                                     # 84 threads a tile, a whole number so it tiles (finer mips to flat)
    # threads wander a little and vary in thickness along their length (slubs)
    wob_x = (fg.fbm(N, 8, 3, s + 1) - 0.5) * 3.0
    wob_y = (fg.fbm(N, 8, 3, s + 2) - 0.5) * 3.0
    xx, yy = x + wob_x, y + wob_y
    col_id = np.floor(xx / pitch).astype(np.int64) % int(round(N / pitch))
    row_id = np.floor(yy / pitch).astype(np.int64) % int(round(N / pitch))
    fx = (xx / pitch) % 1.0
    fy = (yy / pitch) % 1.0
    warp_prof = np.sin(np.pi * fx) ** 0.7                # a round warp thread across x
    weft_prof = np.sin(np.pi * fy) ** 0.7
    over = ((col_id + row_id) % 2 == 0)                  # plain weave: alternate which is on top
    # the thread on top bulges along its float
    warp_h = warp_prof * (0.55 + 0.45 * np.sin(np.pi * fy)) * np.where(over, 1.0, 0.55)
    weft_h = weft_prof * (0.55 + 0.45 * np.sin(np.pi * fx)) * np.where(over, 0.55, 1.0)
    h = np.maximum(warp_h, weft_h)
    top_is_warp = warp_h >= weft_h
    slub_w = fg.cell_table(int(round(N / pitch)), s + 3, 0.86, 1.12)[col_id]
    slub_f = fg.cell_table(int(round(N / pitch)), s + 4, 0.86, 1.12)[row_id]
    thread_val = np.where(top_is_warp, slub_w, slub_f)
    along = np.where(top_is_warp, fg.fbm(N, 40, 2, s + 5), fg.fbm(N, 40, 2, s + 6))
    fuzz = fg.fbm(N, 180, 2, s + 7)
    stain = fg.fbm(N, 3, 4, s + 8)
    h = h * (0.85 + 0.3 * along) + 0.08 * (fuzz - 0.5)
    L = fg.light(fg.blur(h, 0.6), 7.0, wrap=0.6)
    d = (0.68 + 0.45 * L) * (1 + (thread_val - 1) * 0.8) * (0.93 + 0.14 * along)
    d = d * (0.95 + 0.08 * fuzz) * (0.88 + 0.24 * stain)
    d = save_detail('Cloth', d)
    fg.save_normal(fg.normal(fg.blur(h, 0.5), 5.0), out('TownPropCloth_Normal.jpg'), NORMAL_SIZE)
    preview('Cloth', d, '#cc8256')


ALL = {'wood': wood, 'metal': metal, 'stone': stone, 'cloth': cloth}

if __name__ == '__main__':
    for k in (sys.argv[1:] or list(ALL)):
        ALL[k]()
        print('painted prop', k)
