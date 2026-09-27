"""Pack original Blender frames into the normal-alpha runtime sprite atlas.
python scripts/assets/vfx_production/package_harvest_impact.py
"""
import hashlib
import argparse
import json
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser()
parser.add_argument('--source',default='tmp/harvest-impact')
parser.add_argument('--name',default='harvest_impact')
args=parser.parse_args()
assert args.name.replace('_','').isalnum()
source=root/args.source
atlas=Image.new('RGBA',(2048,2048))
rows=[]
for i in range(64):
    frame=Image.open(source/'frames'/('%03d.png'%(i+1))).convert('RGBA')
    assert frame.size==(248,248)
    bbox=frame.getchannel('A').getbbox()
    if bbox: assert min(bbox[:2])>2 and max(bbox[2:])<246, ('Clipped frame',i,bbox)
    if i in (0,63): assert bbox is None, ('Nonempty endpoint',i)
    atlas.paste(frame,((i%8)*256+4,(i//8)*256+4))
    rows.append({'frame':i,'alpha_bounds':bbox})
atlas.save(source/(args.name+'_atlas.png'))
out=root/('public/textures/vfx/production/'+args.name+'.webp')
atlas.save(out,'WEBP',quality=96,method=6,exact=True)
decoded=Image.open(out).convert('RGBA')
assert decoded.getchannel('A').tobytes()==atlas.getchannel('A').tobytes()
metadata=json.loads((source/'metadata.json').read_text())
metadata.update({'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'frames_review':rows})
(source/'packed_metadata.json').write_text(json.dumps(metadata,indent=2))
print(json.dumps({'output':str(out),'bytes':out.stat().st_size}))
