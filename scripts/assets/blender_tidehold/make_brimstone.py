# Tileable brimstone: charred rock, Voronoi crack network glowing orange->yellow,
# sulfur crust near the cracks. Writes Brimstone_Color.jpg + Brimstone_Emissive.jpg.
import numpy as np
from PIL import Image
N = 1024
rng = np.random.default_rng(7)
OUT = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/'

def periodic_noise(cells, octaves=4, persistence=0.5):
    acc = np.zeros((N, N), np.float32); amp = 1.0; total = 0.0
    for o in range(octaves):
        n = cells * (2 ** o)
        g = rng.random((n, n)).astype(np.float32)
        g3 = np.tile(g, (3, 3))
        im = Image.fromarray((g3 * 255).astype(np.uint8)).resize((N * 3, N * 3), Image.BICUBIC)
        a = np.asarray(im, dtype=np.float32)[N:2 * N, N:2 * N] / 255.0
        acc += a * amp; total += amp; amp *= persistence
    return acc / total

def voronoi_edges(npts):
    pts = rng.random((npts, 2)).astype(np.float32)
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float32) / N
    d1 = np.full((N, N), 9.0, np.float32); d2 = np.full((N, N), 9.0, np.float32)
    for px, py in pts:
        dx = np.abs(xs - px); dx = np.minimum(dx, 1 - dx)
        dy = np.abs(ys - py); dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        d1 = np.where(closer, d, d1)
    return d2 - d1  # ~0 on cell borders

edge = voronoi_edges(95)
wob = periodic_noise(16, 3) - 0.5
edge = np.clip(edge + wob * 0.02, 0, 1)
# thin fissures: bright only on the core, a soft dark-red heat halo around them,
# and about a third of the network cold (sealed cracks) so it is not a grid
alive = np.clip((periodic_noise(5, 2) - 0.32) * 5, 0, 1)
crack = np.clip(1.0 - edge / 0.009, 0, 1) ** 1.3 * alive
halo = np.clip(1.0 - edge / 0.045, 0, 1) ** 2.5 * alive
grain = periodic_noise(64, 4, 0.55)
rock = periodic_noise(8, 5, 0.55)
# base charred rock: near-black with warm brown mottling
base = np.stack([0.025 + 0.07 * rock + 0.035 * grain, 0.020 + 0.045 * rock + 0.025 * grain, 0.018 + 0.03 * rock + 0.02 * grain], -1)
# sulfur crust: yellow patches where a low noise is high and near cracks
crust_fine = periodic_noise(48, 3, 0.6)
crust_mask = np.clip((periodic_noise(10, 3) - 0.60) * 7, 0, 1) * np.clip(halo * 2.5 + 0.25, 0, 1) * np.clip((crust_fine - 0.35) * 2.2, 0, 1)
sulfur = np.stack([0.72 + 0.20 * grain, 0.62 + 0.16 * grain, 0.10 + 0.08 * grain], -1)
col = base * (1 - crust_mask[..., None]) + sulfur * crust_mask[..., None]
# crack glow: dark red halo -> orange -> yellow-white core
glow = np.stack([np.clip(0.45 * halo + 0.55 * crack, 0, 1), np.clip(0.04 * halo + 0.50 * crack ** 1.4, 0, 1), np.clip(0.12 * crack ** 4, 0, 1)], -1)
glow_amt = np.clip(halo * 0.35 + crack, 0, 1)[..., None]
col = col * (1 - glow_amt) + glow * glow_amt
emis = glow * np.clip(halo * 0.25 + crack, 0, 1)[..., None]
Image.fromarray((np.clip(col, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(OUT + 'Brimstone_Color.jpg', quality=90)
Image.fromarray((np.clip(emis, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(OUT + 'Brimstone_Emissive.jpg', quality=90)
print('crack coverage', float((crack > 0.5).mean()), 'crust', float((crust_mask > 0.3).mean()))
