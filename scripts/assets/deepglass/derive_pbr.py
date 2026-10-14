# Derive normal / roughness / AO from a flat COLOUR map (SPACEY, 2026-09-20:
# "some baked details on em have some depth and pbr").
#
#   python3 scripts/assets/deepglass/derive_pbr.py <in.png> [more.png ...]
#
# Writes, next to each input:  <stem>_color.png  <stem>_normal.png  <stem>_orm.png
#
# WHY DERIVE RATHER THAN GENERATE. An image model cannot produce a usable
# normal map, the channels have to encode a real surface gradient and a
# generated one does not, so it lights wrong from every angle. Hand-painted
# bark, though, already carries its depth information in its VALUE: the dark
# pixels are the furrows and the light ones are the ridges. So luminance IS a
# height field, and everything else falls out of it.
#
# glTF packing (what the loaders expect):
#   occlusionTexture     -> R
#   metallicRoughness    -> G roughness, B metallic
# so one ORM image serves both slots and costs one texture instead of two.
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

# How pronounced the derived relief is. Higher = deeper furrows. Past about 3
# the normals start to read as embossed plastic rather than bark.
NORMAL_STRENGTH = float(os.environ.get('PBR_NORMAL_STRENGTH', '2.0'))
# Bark is never glossy; this is the window the derived roughness is mapped into.
ROUGH_MIN, ROUGH_MAX = 0.62, 0.96
# How much darker a deep crevice gets in the AO pass.
AO_DEPTH = 0.55
SIZE = int(os.environ.get('PBR_SIZE', '512'))


def make_seamless(a, frac=float(os.environ.get('PBR_SEAM', '0.30'))):
    """Cross-fade opposite edges so the tile actually repeats.

    Image models do not produce seamless tiles however firmly you ask, these
    came back with a ~23/255 mismatch between left and right edges, which shows
    as a hard vertical line every tile on the trunk. Blend a band of each edge
    onto its opposite and drop the duplicated strip. Cheap, and for organic
    bark it is invisible; it would not survive on a texture with structure that
    has to line up (brickwork, panelling).
    """
    for axis in (1, 0):
        a = np.moveaxis(a, axis, 1)
        h, w = a.shape[0], a.shape[1]
        ov = max(4, int(w * frac))
        ramp = np.linspace(0.0, 1.0, ov)[None, :, None]
        head = a[:, :ov] * ramp + a[:, w - ov:] * (1.0 - ramp)
        a = np.concatenate([head, a[:, ov:w - ov]], axis=1)
        a = np.moveaxis(a, 1, axis)
    return a


def edge_mismatch(a):
    """Mean |difference| between opposite edges, the seam, in 0-255."""
    lr = np.abs(a[:, :6].mean(axis=1) - a[:, -6:].mean(axis=1)).mean()
    tb = np.abs(a[:6].mean(axis=0) - a[-6:].mean(axis=0)).mean()
    return float(lr), float(tb)


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def height_field(rgb):
    """Value as height, flattened so one bright plate does not dominate.

    A light blur first: single-pixel paint speckle is not relief, and left in
    it turns the normal map into noise that sparkles as the camera moves.
    """
    lum = luminance(rgb)
    h = np.asarray(Image.fromarray((lum * 255).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(1.1))).astype(np.float32) / 255
    lo, hi = np.percentile(h, 2), np.percentile(h, 98)
    return np.clip((h - lo) / max(1e-4, hi - lo), 0, 1)


def normal_map(h):
    """Sobel gradient -> tangent-space normal, +Y up (OpenGL / NormalGL).

    The repo ships NormalGL elsewhere, so match it: a DirectX-convention map
    (green inverted) lights its bumps inside-out against these.
    """
    # np.roll wraps, which is exactly right for a tile: the gradient is
    # continuous across the seam instead of stopping at the edge.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * NORMAL_STRENGTH
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * NORMAL_STRENGTH
    nz = np.ones_like(h)
    ln = np.sqrt(dx * dx + dy * dy + nz * nz)
    n = np.stack([-dx / ln, dy / ln, nz / ln], axis=-1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def orm_map(h):
    """R = AO, G = roughness, B = metallic (0). One image, two glTF slots."""
    # AO: how much LOWER this pixel is than its neighbourhood. A crevice is
    # occluded; a ridge is not.
    wide = np.asarray(Image.fromarray((h * 255).astype(np.uint8))
                      .filter(ImageFilter.GaussianBlur(7))).astype(np.float32) / 255
    cavity = np.clip((h - wide) * 2.0 + 0.5, 0, 1)
    ao = np.clip(1.0 - (1.0 - cavity) * AO_DEPTH, 0, 1)
    # Roughness: the recesses hold dust and are rougher; ridges are worn smoother.
    rough = ROUGH_MAX - (ROUGH_MAX - ROUGH_MIN) * h
    return (np.stack([ao, rough, np.zeros_like(h)], axis=-1) * 255).astype(np.uint8)


def main(paths):
    if not paths:
        sys.exit('usage: derive_pbr.py <colour.png> [...]')
    for p in paths:
        im = Image.open(p).convert('RGB')
        # square it off a centre crop, then size: a tile must be square or it
        # stretches on the trunk
        s = min(im.size)
        im = im.crop(((im.width - s) // 2, (im.height - s) // 2,
                      (im.width + s) // 2, (im.height + s) // 2))
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        arr = np.asarray(im).astype(np.float32)
        before = edge_mismatch(arr)
        arr = make_seamless(arr)
        arr = np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
                         .resize((SIZE, SIZE), Image.LANCZOS)).astype(np.float32)
        after = edge_mismatch(arr)
        print(f'  seam L-R/T-B {before[0]:.0f}/{before[1]:.0f} -> '
              f'{after[0]:.0f}/{after[1]:.0f}')
        im = Image.fromarray(arr.astype(np.uint8))
        rgb = arr / 255
        h = height_field(rgb)
        stem = os.path.splitext(p)[0]
        im.save(f'{stem}_color.png')
        # Normal and ORM at HALF the colour map's size. They carry low-frequency
        # information, a gradient and two masks, so they lose nothing visible
        # at half res, and they are the cheapest 4x VRAM saving available here.
        half = max(128, SIZE // 2)
        Image.fromarray(normal_map(h)).resize((half, half), Image.LANCZOS).save(
            f'{stem}_normal.png')
        Image.fromarray(orm_map(h)).resize((half, half), Image.LANCZOS).save(
            f'{stem}_orm.png')
        rel = np.percentile(h, 90) - np.percentile(h, 10)
        print(f'{os.path.basename(stem)}: {SIZE}x{SIZE}, relief range {rel:.2f} '
              f'-> _color _normal _orm')
        if rel < 0.25:
            print('  NOTE low relief range: this colour map is flat, so the '
                  'derived normal will be subtle. That is honest, not a bug.')


main(sys.argv[1:])
