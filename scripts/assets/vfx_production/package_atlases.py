"""Pack original Blender RGBA renders into runtime atlases with real gutters.

Requires Pillow. Resizing is premultiplied-alpha (Pillow RGBa) to avoid fringes.
No effects are painted or invented here: all image structure comes from Blender.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json, math, os

ROOT=Path(__file__).resolve().parent
TILE=256
GUTTER=4
CONTENT=248
GRID=8
FRAME_COUNT=64
FPS=30

def clean_frame(path):
    im=Image.open(path).convert('RGBA')
    if im.size!=(CONTENT,CONTENT):
        im=im.convert('RGBa').resize((CONTENT,CONTENT),Image.Resampling.LANCZOS).convert('RGBA')
    # Film alpha is preserved; zero values are canonical transparent black.
    # Force neutral grayscale to make RGB tint predictable on any runtime.
    rgb=im.convert('RGB').convert('L')
    alpha=im.getchannel('A')
    alpha=alpha.point(lambda a:0 if a<2 else a)
    grey=Image.merge('RGBA',(rgb,rgb,rgb,alpha))
    pixels=grey.load()
    for y in range(CONTENT):
        for x in range(CONTENT):
            if pixels[x,y][3]==0:pixels[x,y]=(0,0,0,0)
    return grey

def checker(size,cell=12):
    bg=Image.new('RGBA',size,(22,27,36,255))
    dr=ImageDraw.Draw(bg)
    for y in range(0,size[1],cell):
        for x in range(0,size[0],cell):
            if (x//cell+y//cell)%2:dr.rectangle((x,y,x+cell-1,y+cell-1),fill=(28,33,42,255))
    return bg

def build(effect):
    paths=[ROOT/f'{effect}_frames'/f'{effect}_{i:03d}.png' for i in range(1,65)]
    assert all(p.exists() for p in paths), f'Missing renders for {effect}'
    frames=[clean_frame(p) for p in paths]
    atlas=Image.new('RGBA',(2048,2048),(0,0,0,0))
    stats=[]
    for i,im in enumerate(frames):
        x=(i%8)*TILE+GUTTER;y=(i//8)*TILE+GUTTER
        atlas.paste(im,(x,y))
        alpha=im.getchannel('A');h=alpha.histogram()
        stats.append({'frame':i,'alpha_bbox':alpha.getbbox(),'max_alpha':max(k for k,v in enumerate(h) if v),'coverage':round(1-h[0]/CONTENT**2,5)})
    atlas.save(ROOT/f'{effect}_atlas.png',optimize=True)
    quality=86
    webp=ROOT/f'{effect}_atlas.webp'
    while True:
        atlas.save(webp,format='WEBP',quality=quality,method=6,exact=True)
        if webp.stat().st_size<600_000 or quality<=42:break
        quality-=4
    cs=checker((8*104,8*116))
    dr=ImageDraw.Draw(cs)
    for i,im in enumerate(frames):
        thumb=im.convert('RGBa').resize((100,100),Image.Resampling.LANCZOS).convert('RGBA')
        x=(i%8)*104+2;y=(i//8)*116+2
        cs.alpha_composite(thumb,(x,y));dr.text((x+3,y+101),f'{i:02d}',fill=(143,160,178,255))
    cs.convert('RGB').save(ROOT/f'{effect}_contact_sheet.png',optimize=True)
    smoke_pivot=(4+248*(.5+(2.65*14/math.sqrt(14**2+.95**2))/6.85))/256
    pivot=[.5,smoke_pivot] if effect=='smoke' else [.5,.5]
    m={
        'name':effect,'version':1,
        'runtime_file':f'{effect}_atlas.webp','master_file':f'{effect}_atlas.png',
        'source_blend':f'{effect}.blend','source_script':'bake_assets.py',
        'dimensions_px':[2048,2048],'frame_count':64,'fps':30,'duration_seconds':64/30,
        'grid':{'columns':8,'rows':8,'order':'row-major, left-to-right, top-to-bottom'},
        'tile_px':[256,256],'content_px':[248,248],'gutter_px':4,
        'uv_rect_formula':{'u0':'((frame % 8)*256+4)/2048','v0_top_origin':'(floor(frame/8)*256+4)/2048','du':'248/2048','dv':'248/2048'},
        'pivot_uv_tile_top_origin':pivot,
        'color_space':'sRGB RGB; linear alpha','alpha':'straight / unassociated','channels':'neutral grayscale RGB for tinting; opacity in A',
        'film_transparent':True,'bloom_baked':False,'loop':False,
        'runtime_filter':'linear; clamp; disable atlas mipmaps to prevent cross-frame bleed',
        'intended_blend':'premultiply in shader once, then premultiplied-alpha over; straight-alpha over also valid with matching blend factors',
        'webp_quality':quality,'runtime_bytes':webp.stat().st_size,
        'rendering':{'application':'Blender 5.2.1','engine':'EEVEE','samples':32,'supersampled_frame_px':[496,496],
            'density':'Animated analytic volume with advected multiscale procedural turbulence','lighting':'Three white area lights; volumetric self-shadowing'},
        'frame_statistics':stats,
    }
    (ROOT/f'{effect}_metadata.json').write_text(json.dumps(m,indent=2))
    print(effect,'bytes',webp.stat().st_size,'quality',quality,'alpha max',max(s['max_alpha'] for s in stats),'last',stats[-1],flush=True)
    return frames,m

def enforce_runtime_budget(metadata, target_bytes=775000):
    """Keep alpha lossless while fitting the parent game's hosting allowance."""
    glb=(ROOT/'shard_library.glb').stat().st_size
    def total():return glb+sum((ROOT/f'{name}_atlas.webp').stat().st_size for name in metadata)
    quality=min(m['webp_quality'] for m in metadata.values())
    while total()>target_bytes and quality>50:
        quality-=8
        for name,m in metadata.items():
            master=Image.open(ROOT/f'{name}_atlas.png')
            runtime=ROOT/f'{name}_atlas.webp'
            master.save(runtime,format='WEBP',quality=quality,method=6,exact=True)
            m['webp_quality']=quality;m['runtime_bytes']=runtime.stat().st_size
            (ROOT/f'{name}_metadata.json').write_text(json.dumps(m,indent=2))
        print('Runtime budget',quality,total(),flush=True)
    assert total()<=target_bytes,('Runtime budget exceeded',total())

if __name__=='__main__':
    smoke,sm=build('smoke')
    ring,rm=build('shockwave')
    enforce_runtime_budget({'smoke':sm,'shockwave':rm})
    animation=[]
    for i in range(64):
        bg=checker((512,280),16)
        bg.alpha_composite(smoke[i],(4,8));bg.alpha_composite(ring[i],(260,8))
        d=ImageDraw.Draw(bg);d.text((12,261),'VOLUMETRIC ERUPTION',fill=(210,221,233));d.text((269,261),'TURBULENT SHOCKWAVE',fill=(210,221,233))
        animation.append(bg.convert('RGB'))
    animation[0].save(ROOT/'effects_preview.webp',save_all=True,append_images=animation[1:],duration=33,loop=0,quality=78,method=6)
    animation[0].save(ROOT/'effects_preview.gif',save_all=True,append_images=animation[2::2],duration=66,loop=0,optimize=True)
    combined=Image.new('RGB',(1000,360),(13,19,28))
    d=ImageDraw.Draw(combined)
    d.text((20,17),'ORIGINAL BLENDER VOLUME BAKES  /  64 FRAMES EACH',fill=(211,224,238))
    for k,(label,frames) in enumerate([('SMOKE',smoke),('SHOCKWAVE',ring)]):
        for j,idx in enumerate([12,26,42,55]):
            thumb=frames[idx].convert('RGBa').resize((150,150),Image.Resampling.LANCZOS).convert('RGBA')
            combined.paste(thumb,(20+j*242,42+k*154),thumb)
            d.text((178+j*242,105+k*154),f'{label}\n{idx:02d}/63',fill=(138,160,187))
    combined.save(ROOT/'effects_overview.png',optimize=True)
    summary={'smoke':{k:v for k,v in sm.items() if k!='frame_statistics'},'shockwave':{k:v for k,v in rm.items() if k!='frame_statistics'},'meshes':json.loads((ROOT/'mesh_metadata.json').read_text())}
    (ROOT/'asset_manifest.json').write_text(json.dumps(summary,indent=2))
