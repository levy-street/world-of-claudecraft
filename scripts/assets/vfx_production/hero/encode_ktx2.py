"""Encode packed beauty atlases for the existing KTX2 loader. Requires Pillow and KTX 4.4.2.
Usage: python encode_ktx2.py /path/to/masters /path/to/runtime --ktx /path/to/ktx
The vertical flip is baked because CompressedTexture cannot flip pixels on upload.
"""
from pathlib import Path
from PIL import Image
import argparse, subprocess, tempfile
p=argparse.ArgumentParser();p.add_argument('masters',type=Path);p.add_argument('output',type=Path);p.add_argument('--ktx',default='ktx');a=p.parse_args()
a.output.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='woc-hero-ktx-') as scratch:
    for effect in ['pyroblast','frost_nova','chain_heal']:
        flipped=Path(scratch)/(effect+'.png')
        Image.open(a.masters/(effect+'_atlas_master.png')).transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(flipped)
        subprocess.run([a.ktx,'create','--format','R8G8B8A8_SRGB','--encode','basis-lz','--qlevel','255','--clevel','2','--threads','4','--assign-tf','srgb',str(flipped),str(a.output/(effect+'.ktx2'))],check=True)
