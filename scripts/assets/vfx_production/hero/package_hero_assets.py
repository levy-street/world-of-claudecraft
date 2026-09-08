"""Pack original Blender frames; premultiplied resampling, alpha-safe RGB bleed.
No painted content. Source renders are 16-bit PNG; runtime is RGBA8 WebP.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import numpy as np
import json, argparse, subprocess

ROOT=Path(__file__).resolve().parent
EFFECTS=['pyroblast','frost_nova','chain_heal']
TILE=512;GUTTER=8;CONTENT=496;GRID=8;FPS=30;QUALITY=90

def save_runtime(atlas,path,quality):
    temporary=path.with_name(path.stem+'.pending.webp')
    atlas.save(temporary,format='WEBP',quality=quality,method=6,exact=True)
    temporary.replace(path)

def reencode(effect,quality=QUALITY):
    meta_path=ROOT/f'{effect}_metadata.json';m=json.loads(meta_path.read_text())
    master=Image.open(ROOT/m['master_file']);path=ROOT/m['runtime_file']
    save_runtime(master,path,quality)
    assert np.array_equal(np.array(Image.open(path).getchannel('A')),np.array(master.getchannel('A'))),'Recompressed alpha differs'
    m['webp_quality']=quality;m['runtime_bytes']=path.stat().st_size
    meta_path.write_text(json.dumps(m,indent=2));print('REENCODED',effect,quality,m['runtime_bytes'],flush=True)

def rgba_frame(path):
    im=Image.open(path).convert('RGBA')
    if im.size!=(CONTENT,CONTENT):im=im.convert('RGBa').resize((CONTENT,CONTENT),Image.Resampling.LANCZOS).convert('RGBA')
    a=np.array(im)
    # Numerical dust is discarded only below one half of a percent opacity.
    a[a[:,:,3]<2,3]=0
    mask=a[:,:,3]>0
    if mask.any():
        known=mask.copy()
        for step in range(4):
            old=known.copy();colors=a[:,:,:3].copy()
            for dy,dx in [(0,1),(0,-1),(1,0),(-1,0),(1,1),(-1,-1),(1,-1),(-1,1)]:
                neighbor=np.roll(old,(dy,dx),(0,1));color=np.roll(colors,(dy,dx),(0,1))
                if dy==1:neighbor[0]=False
                if dy==-1:neighbor[-1]=False
                if dx==1:neighbor[:,0]=False
                if dx==-1:neighbor[:,-1]=False
                fill=(~known)&neighbor;a[fill,:3]=color[fill];known[fill]=True
        a[~known,:3]=0
    else:a[:]=0
    return Image.fromarray(a)

def background(size,bright=False):
    base=(222,228,226,255) if bright else (12,17,24,255)
    alt=(234,238,235,255) if bright else (18,25,34,255)
    im=Image.new('RGBA',size,base);d=ImageDraw.Draw(im)
    for y in range(0,size[1],16):
        for x in range(0,size[0],16):
            if (x//16+y//16)%2:d.rectangle((x,y,x+15,y+15),fill=alt)
    return im

def thumb(im,size):return im.convert('RGBa').resize((size,size),Image.Resampling.LANCZOS).convert('RGBA')

def build(effect):
    paths=[ROOT/f'{effect}_frames'/f'{effect}_{i:03d}.png' for i in range(1,65)]
    assert all(p.exists() for p in paths),f'Missing frames: {effect}'
    frames=[rgba_frame(p) for p in paths]
    atlas=Image.new('RGBA',(4096,4096),(0,0,0,0));stats=[]
    for i,im in enumerate(frames):
        atlas.paste(im,((i%8)*TILE+8,(i//8)*TILE+8))
        a=np.array(im.getchannel('A'));mask=a>4;ys,xs=np.where(mask)
        bbox=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None
        margin=min(bbox[0],bbox[1],CONTENT-bbox[2],CONTENT-bbox[3]) if bbox else CONTENT
        stats.append({'frame':i,'alpha_bbox_above_4':bbox,'min_content_edge_margin_px':margin,
          'edge_alpha_max':int(max(a[0].max(),a[-1].max(),a[:,0].max(),a[:,-1].max())),
          'alpha_coverage':round(float((a>0).mean()),6),'alpha_mass':round(float(a.sum()/255),3),
          'alpha_max':int(a.max()),'intermediate_alpha_pixels':int(((a>0)&(a<255)).sum())})
    atlas.save(ROOT/f'{effect}_atlas_master.png',optimize=True)
    runtime=ROOT/f'{effect}_atlas.webp';save_runtime(atlas,runtime,QUALITY)
    for bright in [False,True]:
        cs=background((8*144,8*160),bright);d=ImageDraw.Draw(cs)
        color=(28,47,48,255) if bright else (171,197,211,255)
        for i,im in enumerate(frames):
            x=(i%8)*144+4;y=(i//8)*160+2
            cs.alpha_composite(thumb(im,136),(x,y));d.text((x+4,y+140),f'{effect}  {i:02d}',fill=color)
        cs.convert('RGB').save(ROOT/f'{effect}_contact_{"bright" if bright else "dark"}.png',optimize=True)
    source=json.loads((ROOT/f'{effect}_source.json').read_text())
    src_scale=source['camera']['ortho_scale']
    bounds=[min(s['alpha_bbox_above_4'][0] for s in stats if s['alpha_bbox_above_4']),
            min(s['alpha_bbox_above_4'][1] for s in stats if s['alpha_bbox_above_4']),
            max(s['alpha_bbox_above_4'][2] for s in stats if s['alpha_bbox_above_4']),
            max(s['alpha_bbox_above_4'][3] for s in stats if s['alpha_bbox_above_4'])]
    pivot=source['pivot_uv_content_top_origin']
    meta={**source,'version':2,'runtime_file':runtime.name,'master_file':f'{effect}_atlas_master.png',
      'source_frame_format':'744x744 RGBA16 PNG in '+effect+'_frames; retained unmodified',
      'reference':'production_reference.png (visual guidance only; not used in runtime pixels)',
      'reference_prompt':'reference_prompt.txt','authoring_script':'bake_hero_assets.py','packaging_script':'package_hero_assets.py',
      'dimensions_px':[4096,4096],'tile_px':[512,512],'content_px':[496,496],'gutter_px':8,
      'grid':{'columns':8,'rows':8,'order':'row-major left-to-right top-to-bottom'},
      'frame_count':64,'fps':30,'duration_seconds':64/30,'loop':False,
      'uv_rect_formula':{'u0':'((frame % 8)*512+8)/4096','v0_top_origin':'(floor(frame/8)*512+8)/4096','du':'496/4096','dv':'496/4096'},
      'color_space':'sRGB color / linear alpha','alpha':'straight, unassociated; lossless WebP alpha',
      'channels':'RGB rendered color and lighting, including localized authored emission; A geometric/volumetric opacity',
      'intended_blend':'Premultiply once in shader, then ONE / ONE_MINUS_SRC_ALPHA; straight-alpha blending also valid when matched correctly',
      'runtime_filter':'Linear, clamp, no atlas mipmaps; 8px gutters; zero-alpha RGB dilated 4px to prevent dark fringes',
      'bloom_baked':False,'normal_atlas':None,'lighting_atlas':None,'motion_vector_atlas':None,
      'auxiliary_encoding':'No auxiliary maps supplied. Do not infer normal or motion data from beauty RGB.',
      'union_content_alpha_bounds_px':bounds,
      'camera_plane_bounds_relative_to_origin_world':[(bounds[0]/496-pivot[0])*src_scale,(pivot[1]-bounds[3]/496)*src_scale,(bounds[2]/496-pivot[0])*src_scale,(pivot[1]-bounds[1]/496)*src_scale],
      'runtime_bytes':runtime.stat().st_size,'webp_quality':QUALITY,'frame_statistics':stats,
      'validation':{'frames':64,'edge_alpha_max':max(s['edge_alpha_max'] for s in stats),
         'min_visible_content_margin_px':min(s['min_content_edge_margin_px'] for s in stats),
         'first_alpha_mass':stats[0]['alpha_mass'],'last_alpha_mass':stats[-1]['alpha_mass']}}
    decoded=np.array(Image.open(runtime).convert('RGBA'))
    original=np.array(atlas)
    meta['validation']['webp_alpha_exact']=bool(np.array_equal(decoded[:,:,3],original[:,:,3]))
    assert meta['validation']['webp_alpha_exact'],'WebP alpha changed'
    assert meta['validation']['edge_alpha_max']<=2,('Clipped silhouette',effect,meta['validation'])
    assert stats[0]['alpha_mass']<.1 and stats[-1]['alpha_mass']<.1,('Nonempty endpoints',effect)
    (ROOT/f'{effect}_metadata.json').write_text(json.dumps(meta,indent=2))
    print(effect,meta['runtime_bytes'],meta['validation'],flush=True)
    return frames,meta

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--budget-bytes',type=int,default=0)
    args=parser.parse_args()
    frames={};metadata={}
    for e in EFFECTS:
        cached=ROOT/f'{e}_metadata.json'
        sourcefiles=list((ROOT/f'{e}_frames').glob('*.png'))
        if cached.exists() and len(sourcefiles)==64 and cached.stat().st_mtime>max(p.stat().st_mtime for p in sourcefiles):
            metadata[e]=json.loads(cached.read_text())
            frames[e]=[rgba_frame(ROOT/f'{e}_frames'/f'{e}_{i:03d}.png') for i in range(1,65)]
            print('REUSE_VALIDATED_ATLAS',e,flush=True)
        else:frames[e],metadata[e]=build(e)
    total=sum(m['runtime_bytes'] for m in metadata.values())
    quality=min(m['webp_quality'] for m in metadata.values())
    while args.budget_bytes and total>args.budget_bytes and quality>74:
        quality-=4
        for e,m in metadata.items():
            path=ROOT/m['runtime_file'];save_runtime(Image.open(ROOT/m['master_file']),path,quality)
            assert np.array_equal(np.array(Image.open(path).getchannel('A')),np.array(Image.open(ROOT/m['master_file']).getchannel('A'))),'Recompressed alpha differs'
            m['webp_quality']=quality;m['runtime_bytes']=path.stat().st_size
            (ROOT/f'{e}_metadata.json').write_text(json.dumps(m,indent=2))
        total=sum(m['runtime_bytes'] for m in metadata.values())
    if args.budget_bytes:assert total<=args.budget_bytes,('Runtime exceeds budget',total)
    anim=[];previewdir=ROOT/'preview_frames';previewdir.mkdir(exist_ok=True)
    for i in range(64):
        im=background((960,348));d=ImageDraw.Draw(im)
        for j,e in enumerate(EFFECTS):
            im.alpha_composite(thumb(frames[e][i],312),(j*320+4,5))
            d.text((j*320+14,326),f'{e.upper()}  {i:02d}/63',fill=(193,212,223,255))
        rgb=im.convert('RGB');rgb.save(previewdir/f'frame_{i:03d}.png');anim.append(rgb)
    anim[0].save(ROOT/'hero_effects_preview.webp',save_all=True,append_images=anim[1:],duration=33,loop=0,quality=82,method=6)
    subprocess.run(['ffmpeg','-y','-framerate','30','-i',str(previewdir/'frame_%03d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',str(ROOT/'hero_effects_preview.mp4')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    overview=background((1200,840));d=ImageDraw.Draw(overview)
    for row,e in enumerate(EFFECTS):
        for col,idx in enumerate([10,23,38,52]):
            im=thumb(frames[e][idx],260);overview.alpha_composite(im,(col*300+20,row*280))
            d.text((col*300+25,row*280+260),f'{e} / frame {idx:02d}',fill=(184,207,220,255))
    overview.convert('RGB').save(ROOT/'hero_effects_overview.png',optimize=True)
    manifest={'version':2,'runtime_total_bytes':total,'runtime_budget_bytes':args.budget_bytes or None,
      'budget_note':'Quality90 WebP fallbacks retained by integration request. Parent integration produces KTX2 runtime textures from lossless masters.',
      'effects':{e:{k:v for k,v in m.items() if k!='frame_statistics'} for e,m in metadata.items()},
      'sources':'Original Blender authoring and built-in ImageGen reference; no external assets or credentials',
      'preview':'hero_effects_preview.mp4'}
    (ROOT/'hero_asset_manifest.json').write_text(json.dumps(manifest,indent=2))
    print('TOTAL_RUNTIME_BYTES',total,flush=True)
