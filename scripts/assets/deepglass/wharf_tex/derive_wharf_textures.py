# Derive the Warden wharf kit's tiling texture set (dg_wharf.py) from SPACEY's
# hand-painted packs. The engine reads no occlusion map, so AO is folded into
# the colour (colour x (0.55 + 0.45 AO)); roughness stays a material constant.
# Sizes are kept small on purpose: every wharf GLB embeds its own copy.
#
#   python3 scripts/assets/deepglass/wharf_tex/derive_wharf_textures.py <your texture folder>
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# The source texture pack (the "WOC Asset Textures compressed 1K" folder) lives
# outside the repo: pass its path as the first argument or set WOC_TEXTURE_PACK.
PACK = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('WOC_TEXTURE_PACK', ''))
TIDEHOLD = os.path.join(HERE, '..', '..', 'blender_tidehold')


def color_ao(color_path, ao_path, out, size, lift=1.0, ao_floor=0.55):
    c = np.asarray(Image.open(color_path).convert('RGB'), dtype=np.float32)
    a = np.asarray(Image.open(ao_path).convert('L').resize(Image.open(color_path).size), dtype=np.float32) / 255.0
    c *= (ao_floor + (1.0 - ao_floor) * a)[..., None] * lift
    Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS).save(out, quality=90)


def resized(src, out, size, mode='RGB'):
    Image.open(src).convert(mode).resize((size, size), Image.LANCZOS).save(out, quality=90)


def main():
    if not PACK:
        sys.exit('usage: python3 %s <your texture folder> (or set WOC_TEXTURE_PACK)' % __file__)
    planks = os.path.join(PACK, 'Planks', 'Planks85_05')
    color_ao(planks + '_Color.jpg', planks + '_AmbientOcclusion.jpg', os.path.join(HERE, 'WharfPlanks_Color.jpg'), 1024,
             lift=1.12, ao_floor=0.68)
    resized(planks + '_NormalGL.jpg', os.path.join(HERE, 'WharfPlanks_Normal.jpg'), 512)
    timber = os.path.join(PACK, 'Wood', 'Wood182_02')
    color_ao(timber + '_Color.jpg', timber + '_AmbientOcclusion.jpg', os.path.join(HERE, 'WharfTimber_Color.jpg'), 512,
             lift=1.05, ao_floor=0.62)
    resized(timber + '_NormalGL.jpg', os.path.join(HERE, 'WharfTimber_Normal.jpg'), 512)
    resized(os.path.join(TIDEHOLD, 'GreyStone_Color.jpg'), os.path.join(HERE, 'WharfStone_Color.jpg'), 512)
    resized(os.path.join(TIDEHOLD, 'GreyStone_Normal.jpg'), os.path.join(HERE, 'WharfStone_Normal.jpg'), 512)
    # The tide band: the same masonry, darkened and a little green where the
    # sea washes it (the Warden wall's dark socle, at the waterline).
    stone = np.asarray(Image.open(os.path.join(TIDEHOLD, 'GreyStone_Color.jpg')).convert('RGB'), dtype=np.float32)
    stone *= np.array([0.46, 0.52, 0.49], dtype=np.float32)
    Image.fromarray(np.clip(stone, 0, 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).save(
        os.path.join(HERE, 'WharfStoneDark_Color.jpg'), quality=90)
    resized(os.path.join(TIDEHOLD, 'BrassCourse_Color.jpg'), os.path.join(HERE, 'WharfBrass_Color.jpg'), 256)
    # the harbourmaster's shed: weathered teal boards (the Warden rune colour,
    # sun-faded) and the Tidehold roofs' shingles
    boards = os.path.join(PACK, 'Wood', 'Wood189_17')
    color_ao(boards + '_Color.jpg', boards + '_AmbientOcclusion.jpg', os.path.join(HERE, 'WharfBoards_Color.jpg'), 512,
             lift=1.08, ao_floor=0.62)
    resized(boards + '_NormalGL.jpg', os.path.join(HERE, 'WharfBoards_Normal.jpg'), 256)
    sh = np.asarray(Image.open(os.path.join(TIDEHOLD, 'Shingle_ColorAO.png')).convert('RGB'), dtype=np.float32) * 0.78
    Image.fromarray(np.clip(sh, 0, 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).save(
        os.path.join(HERE, 'WharfShingle_Color.jpg'), quality=90)
    resized(os.path.join(TIDEHOLD, 'Shingle_Normal.png'), os.path.join(HERE, 'WharfShingle_Normal.jpg'), 256)
    for f in sorted(os.listdir(HERE)):
        if f.endswith('.jpg'):
            print(f, os.path.getsize(os.path.join(HERE, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
