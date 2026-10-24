"""Compose the reins icon: the render from render_icon.py, centred on an opaque
dark vignette with a soft contact shadow, saved as the 128 px woc-item-icon-v1
shipping WebP.

python3 compose_icon.py <dir holding icon_raw.png>   (writes reins_wobbles_slime.webp there)
"""
import os, sys
from PIL import Image, ImageDraw, ImageFilter
S = sys.argv[1]
fg = Image.open(S + '/icon_raw.png').convert('RGBA')
fg = fg.crop(fg.getbbox()); w, h = fg.size
N = 768
# dark atmospheric vignette: lighter toward the top-left key, deep at the bottom-right
g = Image.radial_gradient('L').resize((int(N * 1.9), int(N * 1.9)), Image.BICUBIC)
ox, oy = int(N * 0.38 - g.size[0] / 2), int(N * 0.36 - g.size[1] / 2)
mask = Image.new('L', (N, N), 255); mask.paste(g, (ox, oy))
c0, c1, c2 = (58, 62, 74), (24, 26, 34), (10, 11, 16)
lut = []
for v in range(256):
    t = v / 255
    a, b, k = (c0, c1, t / 0.5) if t < 0.5 else (c1, c2, (t - 0.5) / 0.5)
    lut.append(tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3)))
bg = Image.new('RGB', (N, N)); px = bg.load(); mp = mask.load()
for y in range(N):
    for x in range(N):
        px[x, y] = lut[mp[x, y]]
bg = bg.convert('RGBA')
s = N * 0.84 / max(w, h); fg = fg.resize((int(w * s), int(h * s)), Image.LANCZOS)
sh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
cx = N // 2; by = (N + fg.size[1]) // 2
d.ellipse([cx - fg.size[0] * 0.42, by - 28, cx + fg.size[0] * 0.42, by + 22], fill=(0, 0, 0, 150))
bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
bg.alpha_composite(fg, ((N - fg.size[0]) // 2, (N - fg.size[1]) // 2))
m = bg.convert('RGB'); m.save(S + '/reins_wobbles_slime_master.png')
m.resize((128, 128), Image.LANCZOS).save(S + '/reins_wobbles_slime.webp', quality=90, method=6)
m.resize((256, 256), Image.LANCZOS).save(S + '/icon_preview.png')
print(os.path.getsize(S + '/reins_wobbles_slime.webp'))
