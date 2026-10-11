"""Directional braided pressure plume, authored in Blender as a coherent volume.
Preview first; --full renders the 64-frame neutral sheet for crimson tinting.
"""
import argparse
import json
import math
from pathlib import Path
import runpy
import sys
import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
parser.add_argument('--full', action='store_true')
parser.add_argument('--samples', type=int, default=16)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output_dir).resolve()
output.mkdir(parents=True, exist_ok=True)
sys.argv = [sys.argv[0], '--', '--mode', 'library', '--engine', 'CYCLES',
            '--samples', str(args.samples), '--resolution', '248']
lib = runpy.run_path(str(Path(__file__).with_name('bake_assets.py')))
scene = lib['reset']('Warrior_braided_pressure', (1.45, 0, .8), (1.45, -12, .8), 5.6)
g = lib['Graph']('WARRIOR_POWER__torn_directional_pressure')
position, flow = g.warped_position(.34, 4.7)
lobes = []
field = 0
for braid in range(3):
    for knot in range(25):
        center = g.vector('Braid_%d_%d' % (braid, knot), (0, 0, 0))
        radius = g.val('Radius_%d_%d' % (braid, knot), .01)
        weight = g.val('Density_%d_%d' % (braid, knot), 0)
        distance = g.math('DIVIDE', g.vec('DISTANCE', position, center.outputs[0]), radius)
        envelope = g.clamp(g.math('MULTIPLY', g.math('SUBTRACT', 1, distance), 2.2))
        field = g.math('MAXIMUM', field, g.math('MULTIPLY', envelope, weight))
        lobes.append((braid, knot, center, radius, weight))
noise = g.noise(flow, 8.5, 5, .7, .2, 'Fine_torn_edges')
detail = g.clamp(g.math('MULTIPLY', g.math('SUBTRACT', noise.outputs['Fac'], .43), 7.5))
breakup = g.noise(flow, 3.7, 3, .65, .3, 'Torn_pressure_gaps')
gaps = g.clamp(g.math('MULTIPLY', g.math('SUBTRACT', breakup.outputs['Fac'], .37), 6))
density = g.math('MULTIPLY', field, g.math('MULTIPLY', g.math('MULTIPLY', detail, gaps), 8))
g.volume(density)
g.l.new(g.math('MULTIPLY', density, .06), g.n.get('Physically_lit_neutral_smoke').inputs['Emission Strength'])
lib['volume_box'](g.mat, 'BRAIDED_PRESSURE_VOLUME', (-.75, -1.1, -.7), (4.15, 1.1, 2.5))
for frame in range(1, 65):
    t = (frame - 1) / 63
    lib['key_vec'](g.adv, (-1.4*t, .2*t, -.35*t), frame)
    for braid, knot, center, radius, weight in lobes:
        u = knot / 24
        q = max(0, min(1, (t - u*.08 - braid*.012)/.28))
        grow = 1 - (1-q)**3
        x = (.15 + 3.25*u) * grow + .3*t
        z = (.12 + (braid-1)*.73*u + math.sin(u*5.9+braid*.6)*(.24+.4*u))*grow
        y = math.sin(u*7.5 + braid*2.1 + t*2.2)*.26
        size = (.17 + math.sin(u*math.pi)*.13)*(1-.32*u)*grow*(1+.32*t)
        size *= (1 if braid == 1 else .8) * (1 + .18*math.sin(knot*2.3+braid))
        fade = max(0, 1-max(0,(t-.35)/.65))**1.5
        lib['key_vec'](center, (x,y,z), frame)
        lib['key_val'](radius, max(.002,size), frame)
        lib['key_val'](weight, min(1,q/.08)*fade, frame)
scene['simulation'] = 'Authored advected volume, not Mantaflow'
bpy.ops.wm.save_as_mainfile(filepath=str(output/'warrior_power.blend'))
metadata = {'frames':64,'columns':8,'rows':8,'content_px':248,'gutter_px':4,
            'alpha':'straight','frame_order':'left to right, top to bottom',
            'pivot_content_top_origin':[.5-1.45/5.6,.5+.8/5.6],
            'source':'Blender Cycles coherent directional volume','baked_bloom':False}
(output/'metadata.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
frames=output/'warrior_power_frames'
frames.mkdir(exist_ok=True)
for frame in (range(1,65) if args.full else [12,25,40,53]):
    scene.frame_set(frame)
    scene.render.filepath=str(frames/('warrior_power_%03d.png'%frame))
    bpy.ops.render.render(write_still=True)
    print('BAKED_WARRIOR_POWER',frame,flush=True)
