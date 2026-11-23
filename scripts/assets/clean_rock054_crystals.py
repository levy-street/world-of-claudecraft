# Remove the purple crystal blobs baked into Rock054's COLOUR map.
#
#   python3 scripts/assets/clean_rock054_crystals.py [--check]
#
# SPACEY, 2026-09-22, with a screenshot of painted ground: "the bug with the
# weird pixels on our textures is back". They are not a shader artifact and
# never were, `Rock054_Color.jpg` ships ~7,500 violet pixels in little
# lozenge shapes scattered over the sandstone, and Rock054 is a
# `paintDefault` swatch ("Sandstone Face", terrain_texture_sets.ts) used by
# Thornhollow, so it turns up wherever that swatch is painted. The reason it reads as "back" is that the painted-ground
# relief work makes near-field surface detail far more legible.
#
# COLOUR ONLY. Measured against the mask, the blobs move the sibling maps by
# under 2% of range (AO -5.5/255, normal +2.4, roughness +5.2), i.e. they are
# not modelled in the relief, so cleaning the albedo leaves no ghost bumps
# and the other three sheets are left alone.
#
# The fill is a push-pull pyramid seeded from the surrounding stone followed
# by Jacobi diffusion, both with WRAP edges: these are seamless tiles and
# blobs sit within 6 px of all four borders, so a clamped fill would pull a
# smear into the seam.
import sys

import numpy as np
from PIL import Image

TARGETS = [
    'public/textures/terrain/Rock054_Color.jpg',
    'public/textures/battleground/Rock054.jpg',   # same sheet, second home
]


def violet_seeds(a):
    """The saturated CORES of the crystals."""
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0.0)
    return (b > g + 18) & (r > g + 6) & (sat > 0.16) & (mx > 40)


def violet_mask(a):
    """Whole crystals, not just their cores. Filling only the saturated part
    leaves a grey lozenge exactly where the purple was, the blob's rim
    desaturates before it ends, so the shape survives the hue test.

    The separator that works: this sandstone is uniformly WARM. Only 1.8% of
    the sheet has b > g at all, and that 1.8% IS the crystals. So take the
    saturated cores as seeds and grow them, by morphological reconstruction,
    through every cool-shifted pixel they touch (b > g - 3, which reaches the
    neutral rim). Nothing of the rock is cool enough to be swept in, and an
    isolated cool pixel with no crystal in it is never reached."""
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    loose = b > g - 3
    m = violet_seeds(a) & loose
    while True:
        grown = m | (dilate_wrap(m, 1) & loose)
        if grown.sum() == m.sum():
            return grown
        m = grown


def dilate_wrap(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r:
                continue
            out |= np.roll(np.roll(m, dy, axis=0), dx, axis=1)
    return out


def inpaint_wrap(img, mask, jacobi=180):
    """Fill `mask` from the rest of `img`. Pyramid first so the fill starts
    from the right local tone even in the middle of a blob, then diffusion to
    take the blockiness out."""
    valid = (~mask).astype(np.float64)
    pyr = [(img * valid[:, :, None], valid)]
    while min(pyr[-1][1].shape) > 4:
        c, v = pyr[-1]
        h, w = (c.shape[0] // 2) * 2, (c.shape[1] // 2) * 2
        c, v = c[:h, :w], v[:h, :w]
        pyr.append((c[0::2, 0::2] + c[1::2, 0::2] + c[0::2, 1::2] + c[1::2, 1::2],
                    v[0::2, 0::2] + v[1::2, 0::2] + v[0::2, 1::2] + v[1::2, 1::2]))
    c, v = pyr[-1]
    out = np.where(v[:, :, None] > 0, c / np.maximum(v, 1e-9)[:, :, None], 0.0)
    for lvl in range(len(pyr) - 2, -1, -1):
        c, v = pyr[lvl]
        up = np.repeat(np.repeat(out, 2, axis=0), 2, axis=1)
        up = up[:c.shape[0], :c.shape[1]]
        have = (v[:, :, None] > 0)
        out = np.where(have, np.where(have, c / np.maximum(v, 1e-9)[:, :, None], 0.0), up)
    filled = np.where(mask[:, :, None], out, img)
    for _ in range(jacobi):
        nb = (np.roll(filled, 1, 0) + np.roll(filled, -1, 0)
              + np.roll(filled, 1, 1) + np.roll(filled, -1, 1)) * 0.25
        filled = np.where(mask[:, :, None], nb, img)
    return filled


def main():
    check = '--check' in sys.argv
    for path in TARGETS:
        im = Image.open(path).convert('RGB')
        a = np.asarray(im, dtype=np.int16)
        m = violet_mask(a)
        if check:
            print(f'{path}: {int(violet_seeds(a).sum())} core px, {int(m.sum())} whole-crystal px')
            continue
        if not m.any():
            print(f'{path}: already clean')
            continue
        # The blobs carry a soft halo a pixel or two wide that survives the
        # strict hue test; fill that too or every crystal leaves a ring.
        fill = dilate_wrap(m, 2)
        out = inpaint_wrap(np.asarray(im, dtype=np.float64), fill)
        res = np.clip(out + 0.5, 0, 255).astype(np.uint8)
        Image.fromarray(res).save(path, quality=95, subsampling=0)
        left = int(violet_mask(np.asarray(Image.open(path).convert('RGB'), dtype=np.int16)).sum())
        print(f'{path}: filled {int(fill.sum())} px ({int(m.sum())} violet + halo), '
              f'{left} violet px left')


if __name__ == '__main__':
    main()
