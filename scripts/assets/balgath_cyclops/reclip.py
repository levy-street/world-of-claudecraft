"""Re-author Balgath's clips on an already built .blend (no re-sculpt, no re-bake).

  blender -b balgath_cyclops.blend --python reclip.py -- <out.glb> [--form form.glb]
          [--blend out.blend] [--stats stats.json] [--clips A,B] [--report-only]

The mesh, the UV atlas, the baked maps and the rig are the .blend's own (build.py
saved them with --blend); only the clips are thrown away and keyed again from
clips.py and clip_library.py, then the boss GLB (and, with --form, the Knucklebone
form) is exported exactly as build.py exports it. A clip edit costs the clip pass, not
the hour of sculpting and baking; --clips re-keys only the named ones and keeps the
rest of the .blend's. Every clip is measured for arm tremor (jitter.py) and the
export is refused if one shakes.
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clips as C  # noqa: E402
import jitter as J  # noqa: E402
import rig as R  # noqa: E402
from build import export, log  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


scene = bpy.context.scene
scene.render.fps = R.FPS
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Balgath'))
body = next(o for o in scene.objects if o.type == 'MESH' and o.parent == arm and o.name == 'Balgath')
only = opt('--clips').split(',') if opt('--clips') else None
old = [a for a in bpy.data.actions if a.get('duration') is not None and (only is None or a.name in only)]
arm.animation_data_create()
arm.animation_data.action = None
for a in old:
    bpy.data.actions.remove(a)
log('removed', len(old), 'clips')
C.make_clips(arm, only)
names = sorted(a.name for a in bpy.data.actions if a.get('duration') is not None)
log('clips', len(names))


def tremor_gate(label):
    bad = []
    for n in sorted(a.name for a in bpy.data.actions if a.get('duration') is not None or a.name in ('Walk', 'Run')):
        w = J.clip_jitter(scene, arm, bpy.data.actions[n])
        flag = 'FAIL' if w['tremor'] > J.TREMOR_LIMIT else 'ok  '
        print(f"JITTER {label} {n:22s} {flag} tremor={w['tremor']:.2f}@{w['bone'] or '-'}@{w['t']:.2f} "
              f"maxAccel={w['max_accel']:.1f}", flush=True)
        if w['tremor'] > J.TREMOR_LIMIT:
            bad.append(n)
    return bad


REPORT_ONLY = '--report-only' in argv
bad = tremor_gate('boss')
if bad and not REPORT_ONLY:
    raise SystemExit(f'arm tremor over {J.TREMOR_LIMIT} in {bad}')
R.set_action(arm, bpy.data.actions['Idle'])
scene.frame_set(13)
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
stats = {'idle_height': max(zs) - min(zs), 'idle_minz': min(zs),
         'clips': {n: round(float(bpy.data.actions[n].get('duration', 0)), 3) for n in names}}
log('IDLE_HEIGHT', round(stats['idle_height'], 3), 'MINZ', round(stats['idle_minz'], 3))
export(out, arm)
if opt('--stats'):
    with open(opt('--stats'), 'w') as f:
        json.dump(stats, f, indent=1)
if opt('--blend'):
    R.set_action(arm, bpy.data.actions['Idle'])
    bpy.ops.wm.save_as_mainfile(filepath=opt('--blend'))
    log('saved blend')
if opt('--form'):
    import form
    form.build_form(body, arm, opt('--form'))
    fbad = tremor_gate('form')
    if fbad and not REPORT_ONLY:
        raise SystemExit(f'form arm tremor over {J.TREMOR_LIMIT} in {fbad}')
log('DONE')
