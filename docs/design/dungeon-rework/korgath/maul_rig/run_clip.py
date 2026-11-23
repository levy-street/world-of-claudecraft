"""Korgath the Bound's one-handed maul clips: build, bake, check, render, export.

The pipeline (Blender 5.2 background, from the repo root; working files in
tmp/korgath_aaa/):

  1. The body as Blender reads it (textures decoded, quantization off; KTX-Software's
     `ktx` on PATH or in KTX_BIN):
       node docs/design/dungeon-rework/korgath/maul_rig/decode_tex.mjs \\
         public/models/creatures/woc_sanctum_korgath.glb tmp/korgath_aaa/korgath_tex.glb
  2. The clips (spec_slam.py, spec_sweep.py: authored; spec_left.py: MaulArc,
     ThresholdCharge and its run loop with only the left arm re-solved off the
     haft; spec_all builds every one):
       blender -b --python docs/design/dungeon-rework/korgath/maul_rig/run_clip.py -- spec_all <review dir> \\
         --export tmp/korgath_aaa/korgath_aaa_clips.glb [--save x.blend] [--render 0]
  3. The clip donor and the media manifest:
       node docs/design/dungeon-rework/korgath/ship_korgath_clip_fixes.mjs tmp/korgath_aaa/korgath_aaa_clips.glb
       node scripts/build_media_manifest.mjs generate

Options: --views a,b (rlib.VIEWS) --frames 0,4,8 --dist 21 --anim <view>
(every frame, for a video) --grips 6,11 (hand close-ups) --render 0.
"""
import os
import bpy, sys, math, importlib
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, '..', '..', '..', '..', '..', 'tmp', 'korgath_aaa')
sys.path.insert(0, HERE)
import rlib, kanim, kclip

argv = sys.argv[sys.argv.index('--') + 1:]
SPEC, OUT = argv[0], argv[1]


def opt(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


os.makedirs(OUT, exist_ok=True)
rlib.reset()
arm = rlib.load_body(os.path.join(TMP, 'korgath_tex.glb'))
rig = kanim.Rig(arm)
specs = importlib.import_module(SPEC).build(rig)
acts = {}
for name, spec in specs.items():
    kclip.choose_phi(rig, spec)
    frames, rep = kclip.evaluate(rig, spec)
    act = kclip.bake(rig, frames, spec, name)
    acts[name] = (act, frames, spec)
    # checks: the baked action reproduces the solve; the fist stays on its haft
    # point; the left hand stays off the haft
    rig.use(act)
    worst = 0.0
    near = 99.0
    for f in range(0, spec['length'] + 1):
        bpy.context.scene.frame_set(f)
        P = frames[f]
        for n in ('hand.r', 'hand.l', 'foot.l', 'foot.r', 'head', 'hammer'):
            worst = max(worst, ((rig.W @ arm.pose.bones[n].matrix).translation - P[n].translation).length)
        H = rig.W @ arm.pose.bones['hammer'].matrix
        lw = (rig.W @ arm.pose.bones['hand.l'].matrix).translation - H.translation
        axis = (H.to_3x3() @ Vector((0, 1, 0))).normalized()
        along = lw.dot(axis) / rig.S
        if -0.25 < along < 1.1:
            near = min(near, (lw - axis * lw.dot(axis)).length)
    print('CHECK', name, 'bake vs solve worst %.4f yd' % worst, 'left wrist nearest the haft %.2f yd' % near)

if opt('--export'):
    ad = arm.animation_data
    ad.action = None
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    for name, (act, frames, spec) in acts.items():
        tr = ad.nla_tracks.new(); tr.name = name
        tr.strips.new(name, 0, act)
    for o in bpy.data.objects:
        o.select_set(False)
    arm.select_set(True)
    for c in arm.children:
        c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=opt('--export'), export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS',
                              export_force_sampling=True, export_frame_step=1, export_cameras=False,
                              export_lights=False, export_materials='NONE', export_all_influences=False)
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    print('EXPORTED', opt('--export'))

if opt('--save'):
    for a in bpy.data.actions:
        a.use_fake_user = True
    first = next(iter(acts.values()))
    rig.use(first[0])
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = first[2]['length']
    bpy.context.scene.render.fps = 30
    bpy.ops.wm.save_as_mainfile(filepath=opt('--save'))

if opt('--render', '1') == '1':
    rlib.setup_bench((520, 520))
    rlib.floor()
    views = opt('--views', 'frente,lado_der,tres_cuartos_der').split(',')
    dist = float(opt('--dist', '21'))
    for name, (act, frames, spec) in acts.items():
        rig.use(act)
        fl = [int(x) for x in opt('--frames', ','.join(str(x) for x in spec.get('sheet', [0, 9, 17, 30]))).split(',')]
        for v in views:
            for f in fl:
                bpy.context.scene.frame_set(min(f, spec['length']))
                cam = rlib.view_cam('c', v, Vector((0, -2.0, 5.2)), dist, lens=35)
                rlib.render(cam, os.path.join(OUT, '%s_%s_%02d.png' % (name, v, f)))
        if opt('--anim'):
            av = opt('--anim')
            for f in range(0, spec['length'] + 1):
                bpy.context.scene.frame_set(f)
                cam = rlib.view_cam('c', av, Vector((0, -2.0, 5.2)), dist, lens=35)
                rlib.render(cam, os.path.join(OUT, 'anim_%s_%s_%03d.png' % (name, av, f)))
