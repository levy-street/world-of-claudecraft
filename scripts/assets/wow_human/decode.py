"""Run with Blender factory startup; SourceIO path is supplied after --.

blender -b --factory-startup --python scripts/assets/wow_human/decode.py -- /path/to/SourceIO
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys

SOURCEIO_COMMIT = '0a835d9676d839b85e291cf1d35855e56d80308b'
MDL_SHA = {
    'male': '6acec2da7b9fc4fef6241544390423fe9e4c1ff4c9c7d6d3f6db809b7e088434',
    'female': '30c1d0feb1279047161fbb844c7fb22b0efe79453cc9f5a737c0c91b0f31964b',
}
sourceio = pathlib.Path(sys.argv[sys.argv.index('--') + 1]).resolve()
revision = subprocess.check_output(['git', '-C', str(sourceio), 'rev-parse', 'HEAD'], text=True).strip()
if revision != SOURCEIO_COMMIT:
    raise ValueError('SourceIO revision differs from the reviewed decoder')
os.environ['NO_BPY'] = '1'
sys.path.insert(0, str(sourceio.parent))
from SourceIO.library.models.mdl.v49.mdl_file import MdlV49
from SourceIO.library.utils import FileBuffer

root = pathlib.Path('tmp/wow_human')
for fit in ('male', 'female'):
    path = root / fit / f'models/mailer/wow_characters/wowanim_human_{fit}.mdl'
    if hashlib.sha256(path.read_bytes()).hexdigest() != MDL_SHA[fit]:
        raise ValueError(f'{fit}: MDL checksum mismatch')
    mdl = MdlV49.from_buffer(FileBuffer(str(path)))
    short = lambda name: name.split('_bone_')[-1]
    bones = [dict(name=short(b.name), parent=b.parent_id, t=list(b.position), q=list(b.quat)) for b in mdl.bones]
    if len(mdl.anim_descs) != len(mdl.animations):
        raise ValueError('Decoder omitted animation data')
    clips = []
    for desc, animation in zip(mdl.anim_descs, mdl.animations):
        # @ sequences duplicate the source clips, or are Source driving/reference poses.
        if desc.name.startswith('@'):
            continue
        if animation is None:
            raise ValueError(f'Missing animation: {desc.name}')
        tracks = {short(name): dict(t=a['pos'].tolist(), q=a['rot'].tolist()) for name, a in animation.items()}
        clips.append(dict(name=desc.name, fps=desc.fps, frames=desc.frame_count, loop=bool(int(desc.flags) & 1), tracks=tracks))
    (root / f'{fit}-decoded.json').write_text(json.dumps(dict(bones=bones, clips=clips), separators=(',', ':')))
    print(f'{fit}: decoded {len(clips)} clips')
