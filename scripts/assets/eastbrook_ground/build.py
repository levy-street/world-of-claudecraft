# Builds the PAINTED ground set for the overworld terrain from the ChatGPT paintings in
# paint/: for each layer a 1024 colour JPG, a normal map lifted from
# the painting's own light and shade, and one packed relief texture whose channels keep the
# exact mean and spread of the shipped GroundAO_Packed.png, because the terrain shader has
# those statistics baked in as constants.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/eastbrook_ground/build.py [-- --out public/textures/terrain]
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "eastbrook_houses"))
import paint  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.join(ROOT, ARGS[ARGS.index("--out") + 1]) if "--out" in ARGS else os.path.join(ROOT, "tmp", "eastbrook_ground")
TERRAIN = os.path.join(ROOT, "public", "textures", "terrain")
SIZE = 1024
# painting -> (file stem, channel of the packed relief texture it drives, the shipped photo
# layer it replaces, how bright it sits against that layer). The terrain shader and every
# zone palette were tuned round the photo layers' brightness, so each painting is brought
# to its layer's mean brightness times this gain and keeps its own hue and contrast.
# Per layer: saturation, then a gain per colour channel. In the game's noon light a fully
# saturated red earth reads as pink clay, so the
# shipped set pulls the earth to a warm brown. (A first, redder
# attempt was compared against it in the game and dropped; only "Painted" ships, and
# src/render/ground_set_core.ts lists the sets the `?ground=` switch will take.)
LAYERS = {
    "earth": ("Earth", 1, "Ground023_Color.jpg", 0.92, 0.62, (0.884, 1.0, 0.859)),
    "meadow": ("Meadow", 0, "Grass001_Color.jpg", 1.2, 1.0, (1.0, 1.0, 1.0)),
    "rock": ("Rock", 2, "Rock026_Color.jpg", 0.9, 0.8, (1.07, 1.0, 0.9)),
}
# A set may override a layer's (gain, saturation, channel gains).
SETS = {"Painted": {}}
# How far each layer's tones are pushed apart round its own mean after the brightness match
# (1 leaves the painting as it is). The rock painting is pale and soft: on a cliff in the
# game's noon light its planes and cracks washed out to one cream wall with nothing on it,
# so its darks are deepened and it sits a little under the photo rock's brightness. Its
# lavender is also pulled toward a warm grey (the saturation and channel gains in LAYERS):
# flat rock ground is lit mostly by the blue sky fill and came out slate blue.
CONTRAST = {"rock": 1.6}

def save_jpeg(path, rgb, quality=93):
    h, w = rgb.shape[:2]
    image = bpy.data.images.new("out", w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0.0, 1.0)
    image.pixels.foreach_set(rgba[::-1].ravel())
    image.filepath_raw = path
    image.file_format = "JPEG"
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = quality
    scene.view_settings.view_transform = "Standard"
    image.save_render(path, scene=scene)
    bpy.data.images.remove(image)


def blur(a, rounds):
    for _ in range(rounds):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5.0
    return a


def normal_map(rgb, strength=2.2):
    lum = blur(rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11, 2)
    dx = (np.roll(lum, -1, axis=1) - np.roll(lum, 1, axis=1)) * strength
    dy = (np.roll(lum, -1, axis=0) - np.roll(lum, 1, axis=0)) * strength
    length = np.sqrt(dx * dx + dy * dy + 1.0)
    return np.stack([-dx / length, dy / length, 1.0 / length], axis=-1) * 0.5 + 0.5


def main():
    os.makedirs(OUT, exist_ok=True)
    packed = paint.load(os.path.join(TERRAIN, "GroundAO_Packed.png"))
    packed = paint.resize(packed, SIZE, SIZE) if packed.shape[0] != SIZE else packed
    for prefix, overrides in SETS.items():
        build_set(prefix, overrides, packed)
    print("WROTE", OUT)


def build_set(prefix, overrides, packed):
    relief = packed.copy()
    for name, (part, channel, shipped, gain, saturation, channels) in LAYERS.items():
        stem = f"{prefix}_{part}"
        gain, saturation, channels = overrides.get(name, (gain, saturation, channels))
        source = os.path.join(HERE, "paint", f"{name}.png")
        if not os.path.exists(source):
            print("MISSING", name)
            continue
        rgb = paint.wrap_edges(paint.resize(paint.load(source)[..., :3], SIZE, SIZE))
        photo = paint.load(os.path.join(TERRAIN, shipped))[..., :3]
        weights = np.array([0.3, 0.59, 0.11])
        target = float((photo.reshape(-1, 3).mean(axis=0) * weights).sum()) * gain
        # a gamma curve, not a multiply: it moves the mean without clipping the painted lights
        lo, hi = 0.2, 3.0
        for _ in range(40):
            tone = (lo + hi) / 2
            if float((np.clip(rgb, 0.0, 1.0) ** tone).reshape(-1, 3).mean(axis=0).dot(weights)) > target:
                lo = tone
            else:
                hi = tone
        rgb = np.clip(rgb, 0.0, 1.0) ** tone
        contrast = CONTRAST.get(name, 1.0)
        if contrast != 1.0:
            middle = rgb.reshape(-1, 3).mean(axis=0)
            rgb = np.clip(middle + (rgb - middle) * contrast, 0.0, 1.0)
        grey = (rgb * weights).sum(axis=-1, keepdims=True)
        rgb = (grey + (rgb - grey) * saturation) * np.array(channels)
        save_jpeg(os.path.join(OUT, f"{stem}_Color.jpg"), rgb)
        # The game draws the painted ground with flat detail normals (render/terrain.ts
        # buildSplatNormalArray), so only the meadow's map ships: the Wildheart Basin floor
        # reads that one (terrainSplatTexture). `-- --normals` writes all three, for a look
        # review of the ground with real detail normals.
        if part == "Meadow" or "--normals" in sys.argv:
            paint.save(os.path.join(OUT, f"{stem}_NormalGL.png"), normal_map(rgb))
        # the painting's own shade as the relief signal, moved onto the shipped channel's statistics
        lum = blur(rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11, 1)
        old = packed[..., channel]
        new = (lum - lum.mean()) / (lum.std() + 1e-6) * old.std() + old.mean()
        relief[..., channel] = np.clip(new, 0.0, 1.0)
        mean = rgb.reshape(-1, 3).mean(axis=0)
        print("LAYER", name, stem, "tone", round(tone, 3), "mean rgb", [round(float(v), 3) for v in mean], "relief mean/sd", round(float(relief[..., channel].mean()), 4), round(float(relief[..., channel].std()), 4), "shipped", round(float(old.mean()), 4), round(float(old.std()), 4))
    paint.save(os.path.join(OUT, f"GroundAO_Packed_{prefix}.png"), relief)


main()
