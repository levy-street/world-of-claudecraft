"""Pack reviewed Blender frames; retain the lossless master and verify alpha.

python package_warrior_power.py --input-dir tmp/warrior-power-plume-final
No public assets are replaced by this command.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from package_atlases import clean_frame


def package(directory):
    metadata = json.loads((directory / 'metadata.json').read_text(encoding='utf-8'))
    atlas = Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))
    statistics = []
    for frame in range(64):
        source = directory / 'warrior_power_frames' / ('warrior_power_%03d.png' % (frame+1))
        content = clean_frame(source)
        alpha = content.getchannel('A')
        bounds = alpha.getbbox()
        if bounds:
            assert min(bounds[:2]) >= 4 and max(bounds[2:]) <= 244, ('Clipped frame', frame, bounds)
        if frame in (0, 63):
            assert bounds is None, ('Animation must enter and leave transparent', frame)
        atlas.paste(content, ((frame % 8)*256+4, (frame//8)*256+4))
        statistics.append({'frame': frame, 'alpha_bbox': bounds, 'max_alpha': alpha.getextrema()[1]})
    master = directory / 'warrior_power_atlas.png'
    runtime = directory / 'warrior_power.webp'
    atlas.save(master, optimize=True)
    atlas.save(runtime, format='WEBP', quality=94, method=6, exact=True)
    decoded = Image.open(runtime).convert('RGBA')
    assert decoded.size == (2048, 2048)
    assert decoded.getchannel('A').tobytes() == atlas.getchannel('A').tobytes(), 'WebP alpha changed'
    metadata.update({'dimensions_px': [2048, 2048], 'content_px': 248,
                     'gutter_px': 4, 'quality': 94, 'runtime_bytes': runtime.stat().st_size,
                     'runtime_sha256': hashlib.sha256(runtime.read_bytes()).hexdigest(),
                     'frame_statistics': statistics})
    (directory / 'packed_metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps({key: metadata[key] for key in ('runtime_bytes', 'runtime_sha256')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', required=True)
    args = parser.parse_args()
    package(Path(args.input_dir).resolve())
