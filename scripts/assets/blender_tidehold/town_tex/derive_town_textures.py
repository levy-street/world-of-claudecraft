# Texture set for the Tidehold town kit v2 (bl_town.py).
#
# Two kinds of map:
#   - TILING surfaces, one image each (world-yard UVs in the builder): the
#     fieldstone plinths, cream plaster, dark beams, teal/blue painted boards,
#     blue slate, gold, floor planks and flagstones. Sources are SPACEY's own
#     hand-painted packs (src/, copied from "WOC Asset/Terrain Textures
#     compressed 1K") and the game's Plaster007; each is regraded here toward
#     the city palette (pale Warden stone, cream, blue slate, gold).
#   - the DETAIL ATLAS (TownAtlas_Color/_Emissive, 2048, a 4x4 grid of 512
#     cells): leaded windows lit and unlit, the rose and lancet stained glass,
#     plank doors, shop and inn signs, the Tidehold crest. Painted here in
#     numpy/PIL so the whole kit rebuilds from a clean clone.
#
#   python3 scripts/assets/blender_tidehold/town_tex/derive_town_textures.py
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
N = 1024
RNG = np.random.default_rng(20260926)


def load(fn, size=N):
    im = Image.open(os.path.join(SRC, fn)).convert('RGB')
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save(arr, fn, q=92):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(HERE, fn), quality=q)
    print('wrote', fn)


def copy_normal(fn, out, size=N, rot=0):
    im = Image.open(os.path.join(SRC, fn)).convert('RGB').resize((size, size), Image.LANCZOS)
    if rot:
        # rotating a tangent-space normal map by 90 degrees swaps and flips X/Y
        a = np.asarray(im).astype(np.float32) / 255.0
        a = np.rot90(a, k=rot // 90)
        x, y = a[..., 0].copy(), a[..., 1].copy()
        for _ in range((rot // 90) % 4):
            x, y = 1.0 - y, x
        a = np.stack([x, y, a[..., 2]], axis=-1)
        save(a, out, q=94)
        return
    im.save(os.path.join(HERE, out), quality=94)
    print('wrote', out)


def lum(c):
    return c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114


def blur(h, r):
    """Wrap-around Gaussian blur (FFT), so a blurred tile still tiles."""
    n0, n1 = h.shape
    fy = np.fft.fftfreq(n0)[:, None]
    fx = np.fft.fftfreq(n1)[None, :]
    k = np.exp(-2.0 * (np.pi * r) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(h) * k)).astype(np.float32)


def tile_noise(r, seed):
    g = np.random.default_rng(seed).random((N, N)).astype(np.float32)
    g = blur(g, r)
    return (g - g.min()) / (g.max() - g.min() + 1e-6)


def normal_from_height(h, strength=2.0):
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx, ny = -gx * strength * N / 64.0, gy * strength * N / 64.0
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=-1)


def regrade(c, target_mean, target_contrast=1.0, tint=(1, 1, 1)):
    """Move an sRGB tile to a target mean colour (sRGB 0..1), keeping its
    detail, in linear light."""
    lc = to_lin(c)
    m = lc.reshape(-1, 3).mean(axis=0)
    t = to_lin(np.array(target_mean, dtype=np.float32))
    out = (lc - m) * target_contrast + m
    out = out * (t / np.maximum(m, 1e-4)) * np.array(tint, dtype=np.float32)
    return to_srgb(out)


# =============================================================================
#  TILING SURFACES
# =============================================================================
# Fieldstone: Cobblestone259_06 (flat irregular stones), lifted to the pale
# Warden grey with a little warmth so it sits with the city's stone.
fs = load('Cobblestone259_06_Color.jpg')
# the source is blue-violet: desaturate it by half first, then regrade
lf = lum(fs)[..., None]
fs = lf + (fs - lf) * 0.4
save(regrade(fs, (0.63, 0.615, 0.59), 1.3), 'TownStone_Color.jpg')
copy_normal('Cobblestone259_06_NormalGL.jpg', 'TownStone_Normal.jpg')

# Plaster: the game's Plaster007, warmed to cream, with big soft weather
# stains and a faint cool wash so one wall is never a flat card.
pl = load('Plaster007_Color.jpg')
pl = regrade(pl, (0.86, 0.81, 0.70), 1.1)
stain = tile_noise(40, 1)
wash = tile_noise(90, 2)
pl = pl * (0.9 + 0.12 * stain[..., None]) * (1.0 - 0.06 * (wash[..., None] > 0.6))
pl = pl * np.array([1.0, 0.995, 0.985]) - 0.04 * (1 - stain[..., None]) * np.array([0.3, 0.6, 1.0]) * 0.3
save(np.clip(pl, 0, 1), 'TownPlaster_Color.jpg')
copy_normal('Plaster007_NormalGL.jpg', 'TownPlaster_Normal.jpg')

# Beams: Wood187_09, dark oiled oak; the grain runs along U (rotated 90 deg:
# the source boards stand vertical) so a beam maps along its length.
tb = load('Wood187_09_Color.jpg')
tb = np.rot90(regrade(tb, (0.30, 0.20, 0.13), 1.15), k=1)
save(tb, 'TownTimber_Color.jpg')
copy_normal('Wood187_09_NormalGL.jpg', 'TownTimber_Normal.jpg', rot=90)

# Painted boards: the teal Kul Tiras cladding for doors, shutters and
# accents, and the blue railed boards for a second house colour.
save(regrade(load('Wood189_17_Color.jpg'), (0.20, 0.45, 0.47), 1.05), 'TownTeal_Color.jpg')
copy_normal('Wood189_17_NormalGL.jpg', 'TownTeal_Normal.jpg')
save(regrade(load('Wood189_14_Color.jpg'), (0.20, 0.33, 0.55), 1.05), 'TownBlue_Color.jpg')
copy_normal('Wood189_14_NormalGL.jpg', 'TownBlue_Normal.jpg')

# Interior floors: planks and pale flagstones.
save(regrade(load('Planks85_02_Color.jpg'), (0.42, 0.29, 0.19), 1.05), 'TownFloor_Color.jpg')
copy_normal('Planks85_02_NormalGL.jpg', 'TownFloor_Normal.jpg')
save(regrade(load('Tiles224_09_Color.jpg'), (0.62, 0.64, 0.66), 1.0), 'TownFlag_Color.jpg')
copy_normal('Tiles224_09_NormalGL.jpg', 'TownFlag_Normal.jpg')

# Slate: painted scalloped rows in the city blue (the arena's recipe, finer):
# every other row offset half a slate, a shade per slate, a lip catching the
# light and a dark gap. 10 rows x 8 slates per tile.
ROWS_S, COLS_S = 10, 8
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
rh, cw = N / ROWS_S, N / COLS_S
row = np.floor(yy / rh)
fy = (yy - row * rh) / rh
xo = xx + (row % 2) * cw * 0.5
col = np.floor(xo / cw) % COLS_S
fx = (xo / cw) - np.floor(xo / cw)
edge = 1.0 - 0.3 * (2.0 * np.abs(fx - 0.5)) ** 2
inside = fy < edge
hgt = np.where(inside, fy / edge, 0.0)
shade_tab = RNG.uniform(0.8, 1.15, size=(ROWS_S, COLS_S)).astype(np.float32)
hue_tab = RNG.uniform(-1, 1, size=(ROWS_S, COLS_S)).astype(np.float32)
shade = shade_tab[row.astype(int) % ROWS_S, col.astype(int)]
hue = hue_tab[row.astype(int) % ROWS_S, col.astype(int)]
side = np.clip(1.0 - (2.0 * np.abs(fx - 0.5)) ** 6, 0, 1)
tone = (0.58 + 0.42 * hgt) * shade * (0.82 + 0.18 * side)
tone = np.where(inside, tone, 0.3)
grain = blur(RNG.random((N, N)).astype(np.float32), 1.2)
grain = (grain - grain.mean()) / (grain.std() + 1e-6)
base_blue = np.array([0.03, 0.10, 0.40])
teal_shift = np.array([0.0, 0.035, -0.02])
roof = (base_blue[None, None, :] + teal_shift[None, None, :] * hue[..., None]) * (tone * (1.0 + 0.05 * grain))[..., None]
save(to_srgb(roof * 1.15), 'TownRoof_Color.jpg')
save(normal_from_height(blur(hgt + 0.02 * grain, 1.0), 3.0), 'TownRoof_Normal.jpg')

# Dressed stone for quoins, jambs, sills and caps: the arena's cut limestone
# (smooth Warden stonewash with block joints), a touch warmer and brighter so
# the dressed work pops against the fieldstone.
ad = os.path.join(HERE, '..', '..', 'deepglass', 'arena_tex')
dr = np.asarray(Image.open(os.path.join(ad, 'ArenaDressed_Color.jpg')).convert('RGB').resize((N, N), Image.LANCZOS)).astype(np.float32) / 255.0
save(regrade(dr, (0.74, 0.72, 0.68), 1.2), 'TownDressed_Color.jpg')
Image.open(os.path.join(ad, 'ArenaDressed_Normal.jpg')).convert('RGB').resize((N, N), Image.LANCZOS).save(
    os.path.join(HERE, 'TownDressed_Normal.jpg'), quality=94)
print('wrote TownDressed_Normal.jpg')

# Gold: the arena kit's brushed gold (copied so the town builds on its own).
ag = os.path.join(HERE, '..', '..', 'deepglass', 'arena_tex')
for fn in ('ArenaGold_Color.jpg', 'ArenaGold_Normal.jpg'):
    Image.open(os.path.join(ag, fn)).convert('RGB').resize((512, 512), Image.LANCZOS).save(
        os.path.join(HERE, fn.replace('Arena', 'Town')), quality=92)
    print('wrote', fn.replace('Arena', 'Town'))

# =============================================================================
#  DETAIL ATLAS: 4 x 4 cells of 512
# =============================================================================
A = 2048
C = 512
atlas = Image.new('RGB', (A, A), (20, 16, 12))
emis = Image.new('RGB', (A, A), (0, 0, 0))
# glTF metallicRoughness for the GLASS material (bl_town_lib M_GLASS, which
# samples this same atlas): G = roughness, B = metalness. Only the glass
# cells are ever drawn with it; the rest stays matte. Smooth panes pick up
# the scene's sky IBL as a cheap reflection; the lead cames are matte metal.
orm = np.zeros((A, A, 3), np.float32)
orm[..., 0] = 1.0
orm[..., 1] = 0.85
GLASS_R, LEAD_R, FRAME_R = 0.07, 0.45, 0.8


def orm_put(x0, y0, rough, metal):
    h, w = rough.shape
    orm[y0:y0 + h, x0:x0 + w, 1] = rough
    orm[y0:y0 + h, x0:x0 + w, 2] = metal


def cell_box(ci, cj):
    return (ci * C, cj * C, ci * C + C, cj * C + C)


def arch_mask(w, h, spring):
    """1 inside an arched opening (rect up to `spring` px from the top, a
    half-circle over it), 0 outside."""
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    r = w / 2
    d.rectangle((0, spring, w, h), fill=255)
    d.ellipse((0, spring - r, w, spring + r), fill=255)
    return m


def leaded(w, h, pitch, lit=True, seed=0):
    """Diamond-leaded glass: warm lamplight behind small panes (lit) or dark
    blue night glass with a sky gleam (unlit). Returns (colour, glow) arrays."""
    rng = np.random.default_rng(seed)
    yy_, xx_ = np.mgrid[0:h, 0:w].astype(np.float32)
    u = (xx_ + yy_) / pitch
    v = (xx_ - yy_) / pitch
    du = np.abs(u - np.round(u))
    dv = np.abs(v - np.round(v))
    lead = np.clip(1.0 - np.minimum(du, dv) * pitch / 2.2, 0, 1) ** 1.5
    pane_id = (np.floor(u) * 7 + np.floor(v) * 13).astype(int)
    jitter = (np.sin(pane_id * 12.9898) * 43758.5453) % 1.0
    cy = (yy_ / h)
    cx = (xx_ / w - 0.5)
    if lit:
        glow = np.clip(1.15 - (cx * 1.4) ** 2 - (cy - 0.55) ** 2 * 1.6, 0.25, 1.0)
        warm = np.stack([1.0 * glow, 0.72 * glow ** 1.2, 0.32 * glow ** 1.6], axis=-1)
        warm *= (0.85 + 0.3 * jitter)[..., None]
        col = warm * (1 - lead[..., None]) + np.array([0.08, 0.06, 0.05]) * lead[..., None]
        g = warm * (1 - lead[..., None]) * 0.95
    else:
        sky = np.clip(0.9 - cy * 0.7, 0.2, 1.0)
        base = np.stack([0.10 + 0.08 * sky, 0.17 + 0.12 * sky, 0.26 + 0.16 * sky], axis=-1)
        gleam = np.clip(1.0 - np.abs((xx_ - yy_ * 0.6) / w - 0.25) * 9.0, 0, 1) * 0.35
        base = base * (0.85 + 0.3 * jitter)[..., None] + gleam[..., None]
        col = base * (1 - lead[..., None]) + np.array([0.05, 0.05, 0.06]) * lead[..., None]
        g = col * 0.0
    return np.clip(col, 0, 1), np.clip(g, 0, 1), lead


def paste_arr(img, arr, xy, mask=None):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    img.paste(im, xy, mask)


FRAME = np.array([0.16, 0.11, 0.07])     # dark oak behind the cutouts


def window_cell(ci, cj, lit, arched, seed):
    x0, y0, _, _ = cell_box(ci, cj)
    bg = np.ones((C, C, 3), np.float32) * FRAME
    paste_arr(atlas, bg, (x0, y0))
    col, g, lead = leaded(C, C, 46, lit, seed)
    m = arch_mask(C, C, C // 2 if arched else 0) if arched else Image.new('L', (C, C), 255)
    # an inner frame border and a mullion cross in dark oak
    mm = np.asarray(m).astype(np.float32) / 255.0
    er = np.asarray(m.filter(ImageFilter.MinFilter(33))).astype(np.float32) / 255.0
    bar = np.zeros((C, C), np.float32)
    bar[:, C // 2 - 9:C // 2 + 9] = 1
    bar[int(C * 0.62) - 9:int(C * 0.62) + 9, :] = 1
    glassm = er * (1 - bar)
    colf = col * glassm[..., None] + FRAME * (1 - glassm[..., None])
    paste_arr(atlas, colf, (x0, y0))
    paste_arr(emis, g * glassm[..., None], (x0, y0))
    pane_metal = 0.12 if lit else 0.32          # dark glass mirrors the sky harder
    rough = FRAME_R * (1 - glassm) + glassm * (GLASS_R * (1 - lead) + LEAD_R * lead)
    metal = glassm * (pane_metal * (1 - lead) + 0.55 * lead)
    orm_put(x0, y0, rough, metal)


def rose_cell(ci, cj):
    """Round stained glass: gold tracery, cyan and deep blue panes, a gold
    star in the middle. Lit from within."""
    x0, y0, _, _ = cell_box(ci, cj)
    yy_, xx_ = np.mgrid[0:C, 0:C].astype(np.float32)
    dx, dy = (xx_ - C / 2) / (C / 2), (yy_ - C / 2) / (C / 2)
    r = np.sqrt(dx * dx + dy * dy)
    a = np.arctan2(dy, dx)
    petals = 12
    seg = (a / (2 * np.pi) * petals) % 1.0
    ring = np.floor(r * 4).astype(int)
    pane = np.where(ring % 2 == 0, 0, 1)
    cyan = np.array([0.20, 0.75, 0.95])
    deep = np.array([0.08, 0.22, 0.62])
    gold = np.array([0.95, 0.72, 0.28])
    colr = np.where(pane[..., None] == 0, cyan, deep) * (0.75 + 0.25 * np.cos(seg * 2 * np.pi))[..., None]
    lead = (np.abs(seg - 0.5) > 0.46) | (np.abs(r * 4 - np.round(r * 4)) < 0.045)
    colr = np.where(lead[..., None], np.array([0.08, 0.06, 0.05]), colr)
    star = r < (0.16 + 0.09 * np.cos(a * 8))
    colr = np.where(star[..., None], gold, colr)
    rim = (r > 0.93) & (r < 1.0)
    colr = np.where(rim[..., None], gold * 0.85, colr)
    outside = r >= 1.0
    colr = np.where(outside[..., None], FRAME, colr)
    glow = np.where((outside | lead | rim)[..., None], 0.0, colr * 0.8)
    paste_arr(atlas, colr, (x0, y0))
    paste_arr(emis, glow, (x0, y0))
    gildm = rim | star
    rough = np.where(outside, FRAME_R, np.where(gildm, 0.3, np.where(lead, LEAD_R, GLASS_R + 0.02)))
    metal = np.where(outside, 0.0, np.where(gildm, 0.85, np.where(lead, 0.55, 0.22)))
    orm_put(x0, y0, rough, metal)


def lancet_cell(ci, cj):
    """A tall pointed lancet of stained glass (two per cell, 256 wide)."""
    x0, y0, _, _ = cell_box(ci, cj)
    for k in range(2):
        w, h = C // 2, C
        yy_, xx_ = np.mgrid[0:h, 0:w].astype(np.float32)
        # pointed arch: two arcs meeting at the top centre
        rr = w * 0.9
        left = ((xx_ - (w - rr)) ** 2 + (yy_ - w * 0.95) ** 2) <= rr * rr
        right = ((xx_ - rr) ** 2 + (yy_ - w * 0.95) ** 2) <= rr * rr
        inside = (yy_ > w * 0.95) | (left & right)
        inset = (xx_ > 14) & (xx_ < w - 14) & (yy_ > 14) & (yy_ < h - 14)
        cells = (np.floor(yy_ / 38) + np.floor(xx_ / 42)) % 3
        pal = np.array([[0.18, 0.66, 0.9], [0.10, 0.28, 0.66], [0.85, 0.66, 0.26]])
        col = pal[cells.astype(int)]
        lead = (np.abs((yy_ / 38) - np.round(yy_ / 38)) < 0.07) | (np.abs((xx_ / 42) - np.round(xx_ / 42)) < 0.06)
        col = np.where(lead[..., None], np.array([0.07, 0.06, 0.05]), col)
        ok = inside & inset
        col = np.where(ok[..., None], col, FRAME)
        glow = np.where((ok & ~lead)[..., None], col * 0.75, 0.0)
        paste_arr(atlas, col, (x0 + k * w, y0))
        paste_arr(emis, glow, (x0 + k * w, y0))
        rough = np.where(ok, np.where(lead, LEAD_R, GLASS_R + 0.02), FRAME_R)
        metal = np.where(ok, np.where(lead, 0.55, 0.22), 0.0)
        orm_put(x0 + k * w, y0, rough, metal)


def door_cell(ci, cj, src, straps=True, seed=0):
    """An arched plank door: painted boards (vertical), iron straps with
    rivets, a ring pull; dark outside the arch (the frame is geometry)."""
    x0, y0, _, _ = cell_box(ci, cj)
    boards = load(src, C)
    boards = boards * 0.95
    img = boards.copy()
    yy_, xx_ = np.mgrid[0:C, 0:C].astype(np.float32)
    if straps:
        for sy in (0.3, 0.72):
            band = np.abs(yy_ / C - sy) < 0.028
            img = np.where(band[..., None], np.array([0.12, 0.12, 0.13]), img)
            for rx in np.linspace(0.12, 0.88, 7):
                riv = ((xx_ / C - rx) ** 2 + (yy_ / C - sy) ** 2) < 0.00012
                img = np.where(riv[..., None], np.array([0.42, 0.40, 0.36]), img)
    # ring pull (the building kit models its own ironwork: straps=False)
    if straps:
        rp = np.abs(np.sqrt((xx_ / C - 0.74) ** 2 + (yy_ / C - 0.55) ** 2) - 0.035) < 0.007
        img = np.where(rp[..., None], np.array([0.78, 0.6, 0.25]), img)
    m = np.asarray(arch_mask(C, C, C // 2)).astype(np.float32) / 255.0
    img = img * m[..., None] + FRAME * (1 - m[..., None])
    paste_arr(atlas, img, (x0, y0))


def sign_cell(ci, cj, icon):
    """A hanging sign: dark oak board with a gold border and a painted icon."""
    x0, y0, _, _ = cell_box(ci, cj)
    board = load('Wood182_07_Color.jpg', C)
    board = np.rot90(regrade(board, (0.34, 0.23, 0.15), 1.0), k=1).copy()
    im = Image.fromarray((board * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    gold = (232, 184, 84)
    d.rectangle((14, 14, C - 14, C - 14), outline=gold, width=12)
    d.rectangle((34, 34, C - 34, C - 34), outline=(120, 86, 40), width=4)
    ink, hi = (236, 226, 204), (250, 206, 110)
    cx, cy = C // 2, C // 2
    if icon == 'tankard':
        d.rounded_rectangle((cx - 90, cy - 80, cx + 70, cy + 120), 18, fill=(150, 104, 58), outline=ink, width=8)
        for yb in (cy - 40, cy + 60):
            d.rectangle((cx - 90, yb, cx + 70, yb + 16), fill=hi)
        d.arc((cx + 30, cy - 50, cx + 150, cy + 80), -90, 90, fill=ink, width=18)
        d.ellipse((cx - 110, cy - 130, cx + 90, cy - 60), fill=(245, 240, 225), outline=ink, width=6)
    elif icon == 'anvil':
        d.polygon([(cx - 150, cy - 40), (cx + 120, cy - 40), (cx + 160, cy - 80), (cx + 60, cy - 80),
                   (cx + 40, cy - 100), (cx - 170, cy - 100)], fill=(70, 74, 82), outline=ink)
        d.rectangle((cx - 60, cy - 40, cx + 40, cy + 40), fill=(70, 74, 82))
        d.polygon([(cx - 110, cy + 110), (cx + 90, cy + 110), (cx + 40, cy + 40), (cx - 60, cy + 40)],
                  fill=(70, 74, 82), outline=ink)
        d.line((cx - 30, cy - 180, cx + 110, cy - 110), fill=(150, 104, 58), width=22)
        d.rectangle((cx - 80, cy - 205, cx + 10, cy - 160), fill=(190, 194, 200), outline=ink)
    elif icon == 'potion':
        d.ellipse((cx - 110, cy - 30, cx + 110, cy + 170), fill=(60, 190, 220), outline=ink, width=8)
        d.rectangle((cx - 36, cy - 140, cx + 36, cy - 20), fill=(60, 190, 220), outline=ink, width=8)
        d.rectangle((cx - 50, cy - 170, cx + 50, cy - 136), fill=(150, 104, 58), outline=ink, width=6)
        d.ellipse((cx - 60, cy + 10, cx - 10, cy + 60), fill=(200, 245, 255))
    elif icon == 'sack':
        d.polygon([(cx - 120, cy + 150), (cx + 120, cy + 150), (cx + 100, cy - 40), (cx + 40, cy - 110),
                   (cx - 40, cy - 110), (cx - 100, cy - 40)], fill=(196, 160, 104), outline=ink)
        d.rectangle((cx - 50, cy - 130, cx + 50, cy - 100), fill=(120, 80, 40))
        for k in range(3):
            d.ellipse((cx - 90 + k * 55, cy + 20 - (k % 2) * 30, cx - 40 + k * 55, cy + 70 - (k % 2) * 30), fill=hi, outline=(150, 110, 40))
    elif icon == 'scroll':
        d.rectangle((cx - 120, cy - 120, cx + 120, cy + 120), fill=(236, 220, 180), outline=ink, width=6)
        for yl in range(-80, 100, 36):
            d.line((cx - 90, cy + yl, cx + 90, cy + yl), fill=(120, 90, 60), width=8)
        d.ellipse((cx + 40, cy + 60, cx + 110, cy + 130), fill=(190, 40, 40))
    elif icon == 'bell':
        d.polygon([(cx - 120, cy + 110), (cx + 120, cy + 110), (cx + 80, cy - 10), (cx + 60, cy - 110),
                   (cx - 60, cy - 110), (cx - 80, cy - 10)], fill=hi, outline=ink)
        d.ellipse((cx - 22, cy + 100, cx + 22, cy + 144), fill=hi, outline=ink, width=4)
    paste_arr(atlas, np.asarray(im).astype(np.float32) / 255.0, (x0, y0))


def crest_cell(ci, cj):
    """The Tidehold crest: a gold eight-point star over three waves on blue."""
    x0, y0, _, _ = cell_box(ci, cj)
    im = Image.new('RGB', (C, C), (22, 52, 128))
    d = ImageDraw.Draw(im)
    gold = (236, 188, 84)
    d.rectangle((10, 10, C - 10, C - 10), outline=gold, width=14)
    cx, cy = C // 2, C // 2 - 40
    pts = []
    for k in range(16):
        a = math.pi / 2 + k * math.pi / 8
        rr = 150 if k % 2 == 0 else 58
        pts.append((cx + math.cos(a) * rr, cy - math.sin(a) * rr))
    d.polygon(pts, fill=gold)
    for w in range(3):
        yw = C // 2 + 110 + w * 40
        d.line([(60 + x, yw + 16 * math.sin(x / 34)) for x in range(0, C - 120, 6)], fill=(120, 214, 236), width=14)
    paste_arr(atlas, np.asarray(im).astype(np.float32) / 255.0, (x0, y0))
    g = np.zeros((C, C, 3), np.float32)
    paste_arr(emis, g, (x0, y0))


def rune_cell(ci, cj):
    """Rune panel: cyan lines on dark sea-slate (the city's rune language)."""
    x0, y0, _, _ = cell_box(ci, cj)
    im = Image.new('RGB', (C, C), (14, 34, 48))
    gl = Image.new('RGB', (C, C), (0, 0, 0))
    for canvas in (im, gl):
        d = ImageDraw.Draw(canvas)
        cyan = (40, 190, 236)
        d.rectangle((30, 30, C - 30, C - 30), outline=cyan, width=10)
        d.polygon([(C // 2, 80), (C - 120, C // 2), (C // 2, C - 80), (120, C // 2)], outline=cyan, width=10)
        d.line((C // 2, 40, C // 2, C - 40), fill=cyan, width=8)
    atlas.paste(im, (x0, y0))
    emis.paste(gl, (x0, y0))


# Layout (column, row):
window_cell(0, 0, lit=True, arched=True, seed=1)     # W_ARCH_LIT
window_cell(1, 0, lit=True, arched=False, seed=2)    # W_SQUARE_LIT
window_cell(2, 0, lit=False, arched=True, seed=3)    # W_ARCH_DARK
window_cell(3, 0, lit=False, arched=False, seed=4)   # W_SQUARE_DARK
door_cell(0, 1, 'Wood189_17_Color.jpg', straps=False)   # DOOR_TEAL (straps + ring are geometry)
door_cell(1, 1, 'Wood187_09_Color.jpg', straps=False)   # DOOR_OAK
rose_cell(2, 1)                                      # ROSE
lancet_cell(3, 1)                                    # LANCET (two)
sign_cell(0, 2, 'tankard')
sign_cell(1, 2, 'anvil')
sign_cell(2, 2, 'potion')
sign_cell(3, 2, 'sack')
sign_cell(0, 3, 'scroll')
sign_cell(1, 3, 'bell')
crest_cell(2, 3)
rune_cell(3, 3)
atlas.save(os.path.join(HERE, 'TownAtlas_Color.jpg'), quality=93)
emis.save(os.path.join(HERE, 'TownAtlas_Emissive.jpg'), quality=93)
Image.fromarray((np.clip(orm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(HERE, 'TownAtlas_ORM.png'))
print('wrote TownAtlas_Color.jpg / TownAtlas_Emissive.jpg / TownAtlas_ORM.png')


# =============================================================================
#  NORMAL MAPS AT 512
# =============================================================================
# The kit's normals ship as UASTC (the KTX2 step keeps normal slots on the
# quality codec): at 1024 they were 4.5 MB of every building GLB, and every
# building embeds its own copy for the download. The maps repeat every 2.4-4
# yards, so 512 is still ~150 px a yard of relief; the colour stays at 1024.
NORMAL_SIZE = 512
for fn in sorted(os.listdir(HERE)):
    if not (fn.startswith('Town') and fn.endswith('_Normal.jpg')):
        continue
    im = Image.open(os.path.join(HERE, fn)).convert('RGB')
    if im.size[0] <= NORMAL_SIZE:
        continue
    a = np.asarray(im.resize((NORMAL_SIZE, NORMAL_SIZE), Image.LANCZOS)).astype(np.float32) / 255.0
    v = a * 2.0 - 1.0
    v /= np.maximum(1e-6, np.linalg.norm(v, axis=-1, keepdims=True))
    Image.fromarray(((v * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)).save(os.path.join(HERE, fn), quality=94)
    print('normal ->', NORMAL_SIZE, fn)
