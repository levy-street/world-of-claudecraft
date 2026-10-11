"""Bake a low, rolling Warrior pressure wake into an explicit scratch directory.

Blender --background --python bake_shout_dust.py -- --output-dir tmp/shout-dust
Preview first; --full writes all 64 frames. Reuses the production volume graph.
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
parser.add_argument('--samples', type=int, default=24)
parser.add_argument('--resolution', type=int, default=248)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output_dir).resolve()
output.mkdir(parents=True, exist_ok=True)
sys.argv = [sys.argv[0], '--', '--mode', 'library', '--engine', 'CYCLES',
            '--samples', str(args.samples), '--resolution', str(args.resolution)]
lib = runpy.run_path(str(Path(__file__).with_name('bake_assets.py')))
reset, Graph = lib['reset'], lib['Graph']
key_vec, key_val = lib['key_vec'], lib['key_val']
scene = reset('Warrior_rolling_pressure_dust', (0, 0, 1.25), (0, -12, 1.25), 5.6)
scene.cycles.use_denoising = True
for obj in bpy.data.objects:
    if obj.type == 'LIGHT':
        obj.data.energy *= 0.85
g = Graph('SHOUT_DUST__rolling_curls_and_entrained_grit')
position, flow = g.warped_position(.72, 2.1)
centers, radii, weights = [], [], []
field = 0
# Three overlapping rolls, with individual knots along each rolling crest.
lobes = []
for roll in range(3):
    for knot in range(5):
        angle = -.9 + knot * .56
        lobes.append((roll, knot, angle))
        center = g.vector('Roll_%d_knot_%d' % (roll, knot), (0, 0, .15))
        radius = g.val('Knot_radius_%d_%d' % (roll, knot), .01)
        weight = g.val('Knot_density_%d_%d' % (roll, knot), 0)
        distance = g.vec('DISTANCE', position, center.outputs[0])
        distance = g.math('DIVIDE', distance, radius)
        envelope = g.clamp(g.math('MULTIPLY', g.math('SUBTRACT', 1, distance), 1.8))
        envelope = g.math('MULTIPLY', envelope, envelope)
        field = g.math('MAXIMUM', field, g.math('MULTIPLY', envelope, weight))
        centers.append(center)
        radii.append(radius)
        weights.append(weight)
noise = g.noise(flow, 5.2, 5, .67, .24, 'Eroding_curl_surface')
detail = g.clamp(g.math('MULTIPLY', g.math('SUBTRACT', noise.outputs['Fac'], .39), 4.8))
density = g.math('MULTIPLY', field, g.math('POWER', detail, 1.25))
g.volume(g.math('MULTIPLY', density, 8.5))
lib['volume_box'](g.mat, 'ROLLING_DUST_VOLUME', (-2.7, -1.6, -.5), (2.7, 1.6, 3.4))
for frame in range(1, 65):
    t = (frame - 1) / 63
    key_vec(g.adv, (-.85*t, .23*t, -.42*t), frame)
    for i, (roll, knot, angle) in enumerate(lobes):
        delay = roll * .035 + knot * .006
        q = max(0, min(1, (t - delay) / .48))
        growth = 1 - (1 - q) ** 2.2
        curl = angle + .8*t + roll*.41
        spread = (roll - 1) * 1.1
        roll_scale = [.86, 1.26, 1.04][roll]
        x = spread*growth + math.sin(curl)*(.45+.2*t)*growth*roll_scale + .32*t
        z = .12 + (.45 + math.cos(curl)*.63)*growth*roll_scale + .24*t
        y = (roll % 2 - .5)*.3 + .1*math.sin(knot*2.1 + t)
        radius = (.25 + .12*math.sin(i*2.399)**2)*roll_scale * growth * (1 + .8*t)
        dissipate = max(0, 1 - max(0, (t-.42)/.58)) ** 1.6
        key_vec(centers[i], (x, y, z), frame)
        key_val(radii[i], max(.004, radius), frame)
        key_val(weights[i], min(1, q/.08) * dissipate, frame)
scene['effect'] = 'Authored advected rolling dust, three overlapping vortical curls'
scene['simulation'] = 'Procedural coherent volume, not Mantaflow'
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'shout_dust.blend'))
metadata = {'frames': 64, 'columns': 8, 'rows': 8, 'content_px': args.resolution,
            'gutter_px': 4, 'alpha': 'straight', 'frame_order': 'left to right, top to bottom',
            'pivot_content_top_origin': [.5, .5 + 1.25/5.6],
            'source': 'Blender Cycles procedural volume', 'baked_bloom': False}
(output / 'metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
for frame in (range(1, 65) if args.full else [12, 25, 40, 53]):
    scene.frame_set(frame)
    frame_dir = output / 'shout_dust_frames'
    frame_dir.mkdir(exist_ok=True)
    scene.render.filepath = str(frame_dir / ('shout_dust_%03d.png' % frame))
    bpy.ops.render.render(write_still=True)
    print('BAKED_SHOUT_DUST', frame, flush=True)
