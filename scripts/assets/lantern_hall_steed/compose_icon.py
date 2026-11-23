"""Paint the woc-item-icon-v1 ground under a transparent subject render and save the opaque
512 master (docs/design/item-icon-art-style.md): a low-key radial vignette, navy at the heart
easing to umber-black at the corners, a little painted grain, a soft contact glow under the
subject, and a light brush pass over the whole square so it does not read as a raw 3D thumbnail.

  python scripts/assets/lantern_hall_steed/compose_icon.py <subject.png> <out.png> [r,g,b] [--bloom]

--bloom adds the game's bloom to a lit subject: its brightest texels blurred and screened back
over it (the Armory card's lantern-fire).

Original work for this project.
"""
import random
import sys

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

subject_path, out_path = sys.argv[1], sys.argv[2]
args = [a for a in sys.argv[3:] if not a.startswith('--')]
BLOOM = '--bloom' in sys.argv
heart = tuple(int(c) for c in args[0].split(',')) if args else (34, 40, 66)
SIZE = 512
rim = (10, 9, 12)

ground = Image.new('RGB', (SIZE, SIZE))
px = ground.load()
rng = random.Random(20261016)
for y in range(SIZE):
    for x in range(SIZE):
        dx, dy = (x - SIZE * 0.46) / SIZE, (y - SIZE * 0.42) / SIZE
        d = min(1.0, (dx * dx + dy * dy) ** 0.5 / 0.62)
        t = d * d * (3 - 2 * d)
        grain = rng.uniform(-4, 4)
        px[x, y] = tuple(max(0, min(255, int(h + (r - h) * t + grain))) for h, r in zip(heart, rim))
ground = ground.filter(ImageFilter.GaussianBlur(2))

subject = Image.open(subject_path).convert('RGBA')
# a warm glow pooled behind the subject, from its own alpha
glow = subject.split()[3].filter(ImageFilter.GaussianBlur(28))
warm = Image.new('RGB', (SIZE, SIZE), (120, 72, 30))
ground = Image.composite(ImageChops.screen(ground, warm), ground, glow.point(lambda a: int(a * 0.35)))
ground.paste(subject, (0, 0), subject)
if BLOOM:
    lum = ground.convert('L').point(lambda v: 255 if v > 200 else int(max(0, v - 150) * 5))
    hot = Image.composite(ground, Image.new('RGB', ground.size), lum)
    for radius, k in ((6, 0.9), (18, 0.7), (40, 0.5)):
        halo = hot.filter(ImageFilter.GaussianBlur(radius)).point(lambda v, k=k: int(v * k))
        ground = ImageChops.screen(ground, halo)
# the brush pass: a mild mode filter softens the render's hard facets into strokes, then a light
# unsharp mask restores the focal edges
painted = ground.filter(ImageFilter.ModeFilter(3)).filter(
    ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2)
)
painted = ImageEnhance.Color(painted).enhance(1.08)
painted.save(out_path)
print('COMPOSED', out_path)
