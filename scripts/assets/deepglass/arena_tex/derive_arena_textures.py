# Tiling texture set for the Deepglass arena kit v2 (bl_dg_arena.py).
#
# The v1 kit baked each 39-yd wedge into one 2048 atlas (~42 px per yard), which
# read soft up close. v2 ships TILING maps instead, like the Warden wharf kit:
# every face carries world-yard UVs, so a 1024 tile at 6 yd per repeat is ~170
# px per yard on every surface however big the piece is.
#
# All sources are project textures already shipping in Tidehold / the wharf:
#   GreyStone (the Tidehold ashlar the arena already wore, SPACEY 2026-09-22),
#   BrassCourse (Tidehold brass), FloorTile / FloorStone / Tiles224_01 (the WOC
#   Terrain Textures pack flagstones Tidehold's floors use) and Shingle (the
#   city's blue roofs). Dyes are baked into the IMAGE here, never done with a
#   Blender tint node: the glTF exporter drops those and ships the raw map.
#
#   python3 scripts/assets/deepglass/arena_tex/derive_arena_textures.py
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TH = os.path.normpath(os.path.join(HERE, '..', '..', 'blender_tidehold'))
N = 1024


def load(fn, size=N):
    im = Image.open(os.path.join(TH, fn)).convert('RGB')
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save(arr, fn, q=92):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(
        os.path.join(HERE, fn), quality=q)
    print('wrote', fn)


def dye(c, mul):
    """Multiply in LINEAR light, so a dye darkens the way a lamp would."""
    return to_srgb(to_lin(c) * np.array(mul, dtype=np.float32))


def normal_from_height(h, strength=2.2):
    """Tileable normal (OpenGL convention: +Y up) from a 0..1 height field."""
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx, ny = -gx * strength * N / 64.0, gy * strength * N / 64.0
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=-1)


def lum(c):
    return c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114


def blur(h, r):
    """Wrap-around Gaussian blur (FFT), so a blurred tile still tiles."""
    n0, n1 = h.shape
    fy = np.fft.fftfreq(n0)[:, None]
    fx = np.fft.fftfreq(n1)[None, :]
    k = np.exp(-2.0 * (np.pi * r) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(h) * k)).astype(np.float32)


# --- walls: the ashlar, warmed toward the city's pale Warden stone and with the
# mortar's contrast eased (full-contrast joints turned the bowl into a noise
# field at range)
ash = load('GreyStone_Color.jpg')
la = lum(ash)[..., None]
ash_soft = la.mean() + (ash - la.mean()) * 0.72 + (ash - la) * 0.25
save(dye(np.clip(ash_soft, 0, 1), (1.06, 1.03, 0.98)), 'ArenaAshlar_Color.jpg')
save(dye(np.clip(ash_soft, 0, 1), (0.50, 0.51, 0.54)), 'ArenaAshlarDark_Color.jpg')
Image.open(os.path.join(TH, 'GreyStone_Normal.jpg')).convert('RGB').resize((N, N), Image.LANCZOS).save(
    os.path.join(HERE, 'ArenaAshlar_Normal.jpg'), quality=94)
print('wrote ArenaAshlar_Normal.jpg')

# --- dressed stone for the seating: the city's smooth Warden stonewash, so the
# rows read as cut limestone rather than a staircase of bricks; and the bench
# tops painted Tidehold blue
ws = load('WardenStone_Color.jpg')
lw = lum(ws)[..., None]
ws_calm = lw.mean() + (ws - lw.mean()) * 0.55          # half the mottle: cut stone, not sand
# cut blocks: a joint every quarter tile along u (1 yd at the kit's 4-yd
# repeat) and one across at mid-height, each block a touch its own shade
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
bw = N / 4.0
jx = np.minimum((xx % bw), bw - (xx % bw))
jy = np.minimum((yy % (N / 2.0)), N / 2.0 - (yy % (N / 2.0)))
joint = np.clip(1.0 - np.minimum(jx, jy) / 3.0, 0.0, 1.0)
rng_d = np.random.default_rng(29)
shade = rng_d.uniform(0.93, 1.06, size=(2, 4)).astype(np.float32)
blk = shade[(yy // (N / 2.0)).astype(int) % 2, (xx // bw).astype(int) % 4][..., None]
dressed = ws_calm * blk * (1.0 - 0.32 * joint[..., None])
save(dye(np.clip(dressed, 0, 1), (0.98, 1.0, 1.04)), 'ArenaDressed_Color.jpg')
hw = blur(lum(ws_calm), 2.0) * 0.4 - joint * 0.6
save(normal_from_height(hw, 1.4), 'ArenaDressed_Normal.jpg')
save(to_srgb(to_lin(ws_calm) * np.array([0.30, 0.48, 1.05])), 'ArenaSeat_Color.jpg')

# --- gold: Tidehold's brass course pushed to a clean, warm, WIDE-range gold
# (#8a5a14 -> #ffe7a0), with a brushed normal so it catches light as metal
br = load('BrassCourse_Color.jpg')
l = lum(br)
l = np.clip((l - l.mean()) * 1.4 + 0.55, 0, 1)
gold_lo = np.array([0x8a, 0x5a, 0x14]) / 255.0
gold_hi = np.array([0xff, 0xe7, 0xa0]) / 255.0
g = gold_lo + (gold_hi - gold_lo) * (l[..., None] ** 1.1)
save(g, 'ArenaGold_Color.jpg')
rng_b = np.random.default_rng(71)
streak = rng_b.random((N, N)).astype(np.float32)
streak = blur(streak, 0.8)
# brush strokes run along u: smear hard along x, barely along y
streak = np.real(np.fft.ifft2(np.fft.fft2(streak) *
                np.exp(-2.0 * (np.pi * 24) ** 2 * (np.fft.fftfreq(N)[None, :] ** 2)))).astype(np.float32)
streak = (streak - streak.min()) / (streak.max() - streak.min() + 1e-6)
save(normal_from_height(streak * 0.5 + blur(l, 3.0) * 0.5, 0.9), 'ArenaGold_Normal.jpg')

# --- floors -------------------------------------------------------------------
pav = load('FloorTile_Color.jpg')           # pale square setts, 4 x 4 per tile
save(dye(pav, (1.00, 1.01, 1.03)), 'ArenaPaving_Color.jpg')
hp = lum(pav)
save(normal_from_height(blur(hp, 1.2), 2.0), 'ArenaPaving_Normal.jpg')

sl = load('FloorStone_Color.jpg')           # dark slate flags, brass corner studs
save(dye(sl, (1.25, 1.25, 1.30)), 'ArenaSlate_Color.jpg')
save(normal_from_height(blur(lum(sl), 1.0), 2.4), 'ArenaSlate_Normal.jpg')

te = load('Tiles224_01_ColorAO.jpg')        # teal slate, brass studs
save(te, 'ArenaTeal_Color.jpg')
Image.open(os.path.join(TH, 'Tiles224_01_NormalGL.jpg')).convert('RGB').resize((N, N), Image.LANCZOS).save(
    os.path.join(HERE, 'ArenaTeal_Normal.jpg'), quality=94)
print('wrote ArenaTeal_Normal.jpg')

# the concourse ring: the same setts a shade down and cooler, so the floor reads
# as one pavement with a darker border rather than a black track round it
save(dye(pav, (0.66, 0.70, 0.78)), 'ArenaPavingDark_Color.jpg')

# --- roofs: a painted scalloped slate in the city's blue. The repository's
# Shingle map is nearly featureless at range (a few sparse triangles), and the
# city spire bake is laid out for one cone, so this one is painted here: rows
# of round-bottomed slates, every other row offset half a slate, each with its
# own shade, a darker overlap shadow and a lip that catches the light.
ROWS_S, COLS_S = 8, 8
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
rh = N / ROWS_S
cw = N / COLS_S
row = np.floor(yy / rh)
fy = (yy - row * rh) / rh                   # 0 at a row's top, 1 at its bottom
xo = xx + (row % 2) * cw * 0.5
col = np.floor(xo / cw) % COLS_S
fx = (xo / cw) - np.floor(xo / cw)          # 0..1 across a slate
# the scalloped lower edge: a slate is shorter at its sides
edge = 1.0 - 0.28 * (2.0 * np.abs(fx - 0.5)) ** 2
inside = fy < edge
hgt = np.where(inside, fy / edge, 0.0)      # rises toward the lip
rng_s = np.random.default_rng(3)
shade_tab = rng_s.uniform(0.82, 1.12, size=(ROWS_S, COLS_S)).astype(np.float32)
shade = shade_tab[row.astype(int) % ROWS_S, col.astype(int)]
base_blue = np.array([0.02, 0.075, 0.36])
side = np.clip(1.0 - (2.0 * np.abs(fx - 0.5)) ** 6, 0, 1)
tone = (0.62 + 0.38 * hgt) * shade * (0.8 + 0.2 * side)
tone = np.where(inside, tone, 0.35)         # the dark gap between slates
grain = blur(rng_s.random((N, N)).astype(np.float32), 1.5)
grain = (grain - grain.mean()) / (grain.std() + 1e-6)
roof = base_blue[None, None, :] * (tone * (1.0 + 0.05 * grain))[..., None]
save(to_srgb(roof * 1.0), 'ArenaRoof_Color.jpg')
save(normal_from_height(blur(hgt + 0.02 * grain, 1.0), 3.0), 'ArenaRoof_Normal.jpg')
print('wrote ArenaRoof_Color.jpg / ArenaRoof_Normal.jpg')
# the bowl's awning ring: the same slates weathered to slate-blue (half the
# saturation, a stop down): 40 yd of roof in one sweep reads as a plastic band
# in the towers' full city blue
roof_l = lum(to_srgb(roof * 1.0))[..., None]
roof_s = to_srgb(roof * 1.0)
save(to_srgb(to_lin(roof_l + (roof_s - roof_l) * 0.45) * np.array([0.62, 0.68, 0.8])),
     'ArenaRoofSlate_Color.jpg')

# --- the backing behind rune tracery: a dark sea-slate, faintly veined, so a
# panel reads as deep glass with light lines on it rather than a flat card
bk = blur(np.random.default_rng(11).random((N, N)).astype(np.float32), 18)
bk = (bk - bk.min()) / (bk.max() - bk.min() + 1e-6)
back = np.array([0x0e, 0x22, 0x30]) / 255.0
save(back[None, None, :] * (0.8 + 0.4 * bk[..., None]), 'ArenaRuneBack_Color.jpg')

# --- cloth: Warden blue, a soft woven grain ------------------------------------
rng = np.random.default_rng(20260925)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
weave = 0.5 + 0.25 * np.sin(xx * np.pi * 2 / 8) * np.sin(yy * np.pi * 2 / 8)
noise = blur(rng.random((N, N)).astype(np.float32), 6)
noise = (noise - noise.min()) / (noise.max() - noise.min() + 1e-6)
v = 0.78 + 0.14 * noise + 0.08 * weave
blue = np.array([0.07, 0.20, 0.52])
save(to_srgb(blue[None, None, :] * v[..., None] * 1.0), 'ArenaCloth_Color.jpg')
