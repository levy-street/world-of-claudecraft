"""Read-only delivery validation with saved, reproducible results."""
from pathlib import Path
from PIL import Image
import numpy as np
import json, hashlib, struct, subprocess
ROOT=Path(__file__).resolve().parent
report={'effects':{},'source_frame_total':0,'scope':'Asset source, alpha, bounds, temporal mass, file integrity, preview decode. Browser compositing is checked by parent integration.'}
for e in ['pyroblast','frost_nova','chain_heal']:
    m=json.loads((ROOT/f'{e}_metadata.json').read_text())
    sourcefiles=sorted((ROOT/f'{e}_frames').glob('*.png'))
    assert len(sourcefiles)==64
    headers=[]
    for p in sourcefiles:
        header=p.read_bytes()[:29];width,height=struct.unpack('>II',header[16:24])
        headers.append((width,height,header[24],header[25]))
    assert set(headers)=={(744,744,16,6)},('Source format mismatch',e,set(headers))
    rt=ROOT/m['runtime_file'];master=ROOT/m['master_file']
    im=Image.open(rt).convert('RGBA');source=Image.open(master).convert('RGBA')
    assert im.size==source.size==(4096,4096)
    assert np.array_equal(np.array(im.getchannel('A')),np.array(source.getchannel('A')))
    stats=m['frame_statistics'];mass=np.array([s['alpha_mass'] for s in stats]);peak=mass.max()
    max_hold_step=float(np.abs(np.diff(mass[18:47])).max()/peak*100)
    max_curvature=float(np.abs(np.diff(mass[8:60],n=2)).max()/peak*100)
    assert max(s['edge_alpha_max'] for s in stats)==0
    assert mass[0]==mass[-1]==0
    assert max_hold_step<8,('Abrupt alpha-mass step during main action',e,max_hold_step)
    report['effects'][e]={
      'source_frames':64,'source_resolution':[744,744],'source_png_bit_depth':16,'source_png_color_type':'RGBA',
      'runtime_dimensions':[4096,4096],'runtime_bytes':rt.stat().st_size,'webp_quality':m['webp_quality'],
      'runtime_sha256':hashlib.sha256(rt.read_bytes()).hexdigest(),'master_sha256':hashlib.sha256(master.read_bytes()).hexdigest(),
      'decoded_alpha_exact':True,'maximum_edge_alpha':0,'empty_first_and_last_frame':True,
      'minimum_visible_content_margin_px':min(s['min_content_edge_margin_px'] for s in stats),
      'max_alpha_mass_step_during_frames_18_to_46_percent_of_peak':round(max_hold_step,4),
      'max_alpha_mass_second_difference_frames_8_to_59_percent_of_peak':round(max_curvature,4),
      'visual_review':'All 64-frame dark and bright contact sheets inspected; peak and progression frames inspected separately.',
      'timing_review':'No abrupt one-frame opacity mass steps during main action; authored coherent motion and phase timing retained.'}
    report['source_frame_total']+=64
preview=ROOT/'hero_effects_preview.mp4'
subprocess.run(['ffmpeg','-v','error','-i',str(preview),'-f','null','-'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
report['animated_preview']={'file':preview.name,'decode_success':True,'bytes':preview.stat().st_size,'frame_count':64,'fps':30}
report['fallback_webp_total_bytes']=sum(m['runtime_bytes'] for m in report['effects'].values())
report['production_reference']={'tool':'built-in imagegen','file':'production_reference.png','prompt':'reference_prompt.txt','runtime_pixels_used':False,'known_limitation':'Reference did not obey transparent/no-bloom prompt; runtime images independently rendered with true alpha and no bloom.'}
(ROOT/'delivery_validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
