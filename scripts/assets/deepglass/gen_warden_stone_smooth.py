# The smooth Warden stonewash for built models (library set 'WardenStone').
#
# SPACEY, 2026-09-23: the first WardenStone (WardenStoneTile_Color, the tower
# spire's bake source) "looks way to noisy and pixelated - make it look smooth
# like the walls". Measured: that tile's grain correlates over ~0.05 yd (13 px
# at 2048 per 7 yd), 5-8x finer than the wall bake's own mottle (~0.2-0.4 yd),
# and grain that fine aliases into speckle past a few yards.
#
# This is a band-limited cloud field instead: random Fourier components on
# integer wave numbers only (so it tiles exactly), 2..MAX_K cycles per tile
# with a power-law falloff and a Gaussian roll-off, so nothing is finer than
# ~0.3 yd at the 7 yd tile. Luminance spread matches the wall's pale panels.
# The normal is a gentle emboss of the same field.
#
# Colour, second pass (SPACEY: "make the color hue of the grey the same as the
# tiles at the bottom of the steps"): in his in-game shot the foot paving
# rendered 161,169,157 and the steps 171,169,151 - level in brightness, too warm
# in hue. The linear-light ratio (R x0.875, G x1.0, B x1.089) moved the old
# warm mean 154,147,138 to the cool 145,147,143. Checked in game from the
# foot of the (0,392) flight: risers (skylit) read a touch cool, the sunlit
# rail tops a touch bright, so the whole mean came down 7% (linear) as well.
#
#   python3 scripts/assets/deepglass/gen_warden_stone_smooth.py
import numpy as np
from PIL import Image

N = 1024
SEED = 20260923
MAX_K = 13  # cycles per tile at the Gaussian roll-off (7 yd tile: ~0.55 yd)
BETA = 1.6  # amplitude ~ k^-BETA: big soft clouds dominate
MEAN_RGB = np.array([140.4, 141.8, 138.4])  # matched to the foot paving (see above)
LUM_SD = 10.0  # the wall's pale panels read 10.5-13.6; softer, per SPACEY's sample
WARM_COOL = 0.05  # a faint warm/cool drift with brightness (the paving is cool throughout)
NORMAL_STRENGTH = 2.2

rng = np.random.default_rng(SEED)
kx = np.fft.fftfreq(N, d=1.0 / N)
ky = np.fft.fftfreq(N, d=1.0 / N)
KX, KY = np.meshgrid(kx, ky)
K = np.hypot(KX, KY)
amp = np.zeros_like(K)
band = K >= 2.0
amp[band] = K[band] ** -BETA * np.exp(-((K[band] / MAX_K) ** 2))
phase = rng.uniform(0, 2 * np.pi, K.shape)
spectrum = amp * np.exp(1j * phase)
field = np.real(np.fft.ifft2(spectrum))
field = (field - field.mean()) / field.std()

LUM_W = np.array([0.2126, 0.7152, 0.0722])
lum_scale = LUM_SD / float(MEAN_RGB @ LUM_W)  # fraction of the mean per unit field
rgb = MEAN_RGB[None, None, :] * (1.0 + field[..., None] * lum_scale)
# brighter patches drift a touch warm, darker a touch cool
drift = field * WARM_COOL * lum_scale
rgb[..., 0] *= 1.0 + drift
rgb[..., 2] *= 1.0 - drift
rgb = np.clip(rgb, 0, 255)

# Gentle emboss of the same field, OpenGL convention (green = +v = up).
h = field
dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
s = NORMAL_STRENGTH * 0.05
n = np.stack([-dx * s * N / 64, dy * s * N / 64, np.ones_like(h)], axis=-1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
nrm = np.clip((n * 0.5 + 0.5) * 255, 0, 255)

Image.fromarray(rgb.astype(np.uint8)).save('public/textures/terrain/WardenStone_Color.jpg', quality=92)
Image.fromarray(nrm.astype(np.uint8)).save('public/textures/terrain/WardenStone_NormalGL.jpg', quality=92)
lum = rgb[..., 0] * LUM_W[0] + rgb[..., 1] * LUM_W[1] + rgb[..., 2] * LUM_W[2]
l = lum - lum.mean()
ac = [(l[:, :-d] * l[:, d:]).mean() / l.var() for d in range(1, 200)]
half = next((d + 1 for d, a in enumerate(ac) if a < 0.5), None)
print('mean', rgb.reshape(-1, 3).mean(0).round(1), 'lum sd', round(float(lum.std()), 1),
      'ac-half px', half, f'(~{half * 7 / N:.2f} yd at the 7 yd tile)')
print('normal mean', nrm.reshape(-1, 3).mean(0).round(1))
