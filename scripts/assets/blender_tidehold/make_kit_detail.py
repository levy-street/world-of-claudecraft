# Detail maps for the medieval kit's FLAT palette colours (SPACEY, 2026-09-22:
# "a lot of the assets are missing textures and just have a solid look").
#
#   python3 scripts/assets/blender_tidehold/make_kit_detail.py
#
# Writes beside itself:
#   KitTimber_Detail.jpg  KitTimber_Normal.jpg
#   KitStone_Detail.jpg   KitStone_Normal.jpg
#
# WHY A DETAIL MAP AND NOT A TEXTURE. `CartoonTown_Texture_01` is a PALETTE,
# not a texture: its bottom half is a grid of flat swatches and a kit face's
# whole UV footprint is a tenth of a texel (measured: p50 = 0.1 texel on a 1K
# atlas). So there is nothing to sharpen, every brown beam and grey plinth in
# the city samples ONE constant colour. Painting grain into the swatch cells
# cannot work either: with a sub-texel footprint a face would still read one
# flat value, and tiling within a 64 px cell needs UVs that wrap, which a
# per-vertex planar projection cannot do.
#
# What does work is to keep the palette and multiply a tiling detail map over
# it: the face moves to a WocTimber / WocKitStone material with planar UVs, and
# its original swatch colour rides along in the COLOR_0 vertex attribute, which
# three multiplies over the albedo (the same channel `_weather_stone` already
# uses). Result = swatch colour x grain: the city's palette is untouched and
# every one of those surfaces gains relief.
#
# The map is therefore a HIGH-PASS of a real photo-sourced tile, normalised so
# its LINEAR mean is 1.0, dividing the source by a blurred copy of itself
# keeps the grain, knots and mortar lines and throws away the source's own hue
# and its plank-to-plank value steps (which would fight the swatch). Values
# above 1 cannot be stored in an 8-bit image, so the map is divided by
# DETAIL_HEADROOM on the way out and bl_build_common multiplies the vertex
# tint by the same number to put the mean back.
import os

import numpy as np
from PIL import Image
# Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))

HERE = os.path.dirname(os.path.abspath(__file__))
STRUCT = os.path.join(REPO_ROOT, 'public/textures/structures')

# Headroom: the stored map is detail/HEADROOM so a +45% highlight still fits in
# 8 bits. bl_build_common.DETAIL_HEADROOM must match.
DETAIL_HEADROOM = 1.45
SRC_SIZE = 1024
# The maps are MODULATION, not albedo, and they are embedded in all thirteen
# building GLBs, at 1024 the derived normals alone were 1.6 MB a building
# (webp cannot pack single-pixel gradient noise). 512 costs nothing visible at
# the scale these tile: one wood tile spans ~3 yd, one stone tile ~4.6 yd.
OUT_SIZE = 512


def srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def box_blur_wrap(a, r):
    """Separable box blur with WRAP edges, the sources are seamless tiles and
    a clamped blur would lift the high-pass at all four borders into a visible
    frame every repeat."""
    if r < 1:
        return a
    k = 2 * r + 1
    for axis in (0, 1):
        pad = np.concatenate([a[-r:], a, a[:r]], axis=0) if axis == 0 else a
        if axis == 1:
            pad = np.concatenate([a[:, -r:], a, a[:, :r]], axis=1)
        c = np.cumsum(pad, axis=axis, dtype=np.float64)
        zero = np.zeros_like(np.take(c, [0], axis=axis))
        c = np.concatenate([zero, c], axis=axis)
        hi = np.take(c, range(k, c.shape[axis]), axis=axis)
        lo = np.take(c, range(0, c.shape[axis] - k), axis=axis)
        a = (hi - lo) / k
    return a


def gauss_wrap(a, sigma):
    """Three box blurs approximate a gaussian well enough for a low-pass."""
    r = max(1, int(round(sigma * 0.85)))
    for _ in range(3):
        a = box_blur_wrap(a, r)
    return a


def detail_map(src, sigma, amp, colour_keep, name, normal_strength):
    img = Image.open(src).convert('RGB')
    if img.size != (SRC_SIZE, SRC_SIZE):
        img = img.resize((SRC_SIZE, SRC_SIZE), Image.LANCZOS)
    lin = srgb_to_linear(np.asarray(img, dtype=np.float64) / 255.0)

    # High pass: what the source has that a blurred copy of itself does not.
    low = np.stack([gauss_wrap(lin[:, :, c], sigma) for c in range(3)], axis=2)
    d = lin / np.maximum(low, 1e-4)

    # Pull most of the way to neutral: the swatch owns the hue, the map owns
    # the light. Keeping a little per-channel drift lets knots read warm.
    lum = (0.2126 * d[:, :, 0] + 0.7152 * d[:, :, 1] + 0.0722 * d[:, :, 2])[:, :, None]
    d = colour_keep * d + (1.0 - colour_keep) * lum

    d = np.clip(d, 1.0 - amp, 1.0 + amp)
    d /= d.mean()                      # exact linear mean of 1.0
    d = np.clip(d, 0.0, DETAIL_HEADROOM)

    # Down to the shipped size before anything is written, so the normal is
    # derived from the pixels the game actually samples.
    d = np.asarray(Image.fromarray(
        np.clip(d / DETAIL_HEADROOM * 65535.0, 0, 65535).astype(np.uint16).reshape(SRC_SIZE, SRC_SIZE * 3),
    ).resize((OUT_SIZE * 3, OUT_SIZE), Image.LANCZOS), dtype=np.float64
    ).reshape(OUT_SIZE, OUT_SIZE, 3) / 65535.0 * DETAIL_HEADROOM
    d /= d.mean()
    d = np.clip(d, 0.0, DETAIL_HEADROOM)

    out = (linear_to_srgb(d / DETAIL_HEADROOM) * 255.0 + 0.5).astype(np.uint8)
    Image.fromarray(out).save(f'{HERE}/{name}_Detail.jpg', quality=92, subsampling=0)

    # Normal from the same signal: on a photo tile the dark pixels ARE the
    # furrows (derive_pbr.py's argument), and the high-pass is that signal with
    # the source's own lighting gradient already divided out.
    h = (0.2126 * d[:, :, 0] + 0.7152 * d[:, :, 1] + 0.0722 * d[:, :, 2])
    h = (h - h.min()) / max(1e-6, h.max() - h.min())
    # One box pass first: a per-pixel gradient of an unfiltered photo is mostly
    # sensor noise, which reads as sparkle in game and is what made the webp
    # enormous. This keeps the grooves and drops the grit.
    h = box_blur_wrap(h, 1)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * normal_strength * OUT_SIZE / 256.0
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * normal_strength * OUT_SIZE / 256.0
    nz = np.ones_like(h)
    ln = np.sqrt(dx * dx + dy * dy + nz * nz)
    # OpenGL convention (green UP): the game samples green-up, and +v runs down
    # the image, so the y gradient is negated.
    nrm = np.stack([(-dx / ln) * 0.5 + 0.5, (dy / ln) * 0.5 + 0.5, (nz / ln) * 0.5 + 0.5], axis=2)
    Image.fromarray((nrm * 255.0 + 0.5).astype(np.uint8)).save(
        f'{HERE}/{name}_Normal.jpg', quality=90, subsampling=0)

    print(f'{name}: mean(linear)={d.mean():.4f} p01={np.percentile(d, 1):.3f} '
          f'p99={np.percentile(d, 99):.3f} <- {os.path.basename(src)}')


if __name__ == '__main__':
    # Wood184_12 is the kit-matched hand-painted grain (knots, long fibres);
    # sigma 26 keeps a little of the board-to-board value step so a run of
    # timber trim is not one even tone.
    detail_map(f'{HERE}/Wood184_12_Color.jpg', sigma=26, amp=0.45,
               colour_keep=0.35, name='KitTimber', normal_strength=1.7)
    # Bricks076B is the game's own structures stone. sigma 18 is under one
    # course, so the block faces flatten and the mortar lines survive.
    detail_map(f'{STRUCT}/Bricks076B_Color.jpg', sigma=18, amp=0.40,
               colour_keep=0.25, name='KitStone', normal_strength=2.3)
