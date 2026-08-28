#!/usr/bin/env python3
"""Generate the Xbox/MSIX tile set from the site's own icon art.

The console package needs eight fixed sizes. Generating them keeps the shell's
Assets folder reproducible from one source image instead of being a pile of
hand-exported PNGs that quietly drift from the site's branding.

Square tiles keep their alpha so the manifest BackgroundColor shows through and
the logo is not boxed on a mismatched square. The wide tile and the splash are
letterboxed onto that same background, because those two are always drawn
opaque and a transparent one renders as a black slab on the dashboard.

Requires Pillow. Usage, from the repository root:

    python xbox/build_tiles.py
"""

import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "xbox", "WorldOfClaudecraft.Shell", "Assets")
LOGO = os.path.join(ROOT, "public", "icon-512.png")
BG = (5, 5, 9, 255)  # #050509, matches Package.appxmanifest BackgroundColor

# name -> edge length. The alpha-preserving square set.
SQUARE = {
    "StoreLogo.png": 50,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square150x150Logo.png": 150,
    "Square310x310Logo.png": 310,
    "Square480x480Logo.png": 480,
}
# name -> (width, height). The two that are always drawn opaque.
WIDE = {
    "Wide310x150Logo.png": (310, 150),
    "SplashScreen.png": (620, 300),
}


def fit(img, box_w, box_h, pad=0.86):
    """Scale to fit inside the box, preserving aspect, with breathing room."""
    w, h = img.size
    scale = min(box_w * pad / w, box_h * pad / h)
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def main():
    if not os.path.isfile(LOGO):
        raise SystemExit("missing source art: " + LOGO)
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(LOGO).convert("RGBA")

    made = []
    for name, size in SQUARE.items():
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        art = fit(src, size, size)
        canvas.paste(art, ((size - art.width) // 2, (size - art.height) // 2), art)
        canvas.save(os.path.join(OUT, name), "PNG", optimize=True)
        made.append((name, size, size))

    for name, (w, h) in WIDE.items():
        canvas = Image.new("RGBA", (w, h), BG)
        art = fit(src, w, h)
        canvas.paste(art, ((w - art.width) // 2, (h - art.height) // 2), art)
        canvas.save(os.path.join(OUT, name), "PNG", optimize=True)
        made.append((name, w, h))

    for name, w, h in made:
        path = os.path.join(OUT, name)
        print("  {0:<26} {1}x{2}  {3:,} B".format(name, w, h, os.path.getsize(path)))
    print("{0} tiles written to {1}".format(len(made), OUT))


if __name__ == "__main__":
    main()
