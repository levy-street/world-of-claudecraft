"""The Knucklebone of Balgath's form (Shape of the Foreman): his own body at a
player's scale, decimated, with gaits authored for a player's speed.

Twenty of these can stand in one pull, so the body is cut to about a quarter of the
boss's triangles and its maps to 1024. The skeleton and every combat clip are the
boss's own (the form wears his punches, his hammer, his stomp and his glare); the
two gaits are its own, because a giant's lumber played at 3.7x to keep up with a
player reads as a frantic jog in place:

  Walk  a brisk heavy stride, 0.9 s a cycle
  Run   a bounding run with a flight phase, 0.6 s a cycle, fists pumping

Called from build.py (--form out.glb) after the boss is exported.
"""
import math

import bpy
import numpy as np

import clip_library as LIB
import rig as R
from clips import keys_of

FORM_CLIPS = ('Idle', 'Balgath_Swipe', 'Balgath_Punch', 'Balgath_Clobber', 'Balgath_Barrowsweep', 'Balgath_Hammer',
              'Balgath_Stomp', 'Balgath_Smash', 'Balgath_EyeFlare', 'Balgath_Roar', 'Hit', 'Jump')
FORM_WALK = (0.9, 6.0)     # period s, stride yards per cycle
FORM_RUN = (0.6, 15.0)


def form_walk(rig):
    period, stride = FORM_WALK
    nfr = int(round(period * 24))
    half = stride * 0.6 / 2
    return keys_of([(i / 24, LIB.walk_body(rig, (i / nfr) % 1.0, half), 'linear') for i in range(nfr + 1)], loop=True)


def form_run(rig):
    period, stride = FORM_RUN
    nfr = int(round(period * 24))
    half = stride * 0.32 / 2
    keys = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        b = LIB.run_body(rig, ph, half)
        fl, dl, tl = LIB.gait_foot(ph, 0.32, -half - 0.3, half - 0.3, 3.0, 1, toe_off=0.7)
        fr, dr, tr = LIB.gait_foot((ph + 0.5) % 1.0, 0.32, -half - 0.3, half - 0.3, 3.0, -1, toe_off=0.7)
        bob = -0.95 + 0.6 * math.cos(2 * math.tau * (ph - 0.42))
        b = b.but(foot_l=fl, foot_r=fr, foot_dir_l=dl, foot_dir_r=dr, toe_l=tl, toe_r=tr, lean=30,
                  pelvis=(b.p['pelvis'][0], 0.5, bob))
        keys.append((i / 24, b, 'linear'))
    return keys_of(keys, loop=True)


def build_form(body, arm, path, target_tris=13000, tex=1024):
    rig = R.Rig(arm)
    keep = set(FORM_CLIPS)
    for act in list(bpy.data.actions):
        if act.name not in keep:
            if act.name == 'Balgath_Death':
                act.name = 'Death'
                continue
            bpy.data.actions.remove(act)
    for name, fn, wind in (('Walk', form_walk, 4.0), ('Run', form_run, 8.0)):
        act = R.make_clip(arm, name, fn(rig))
        R.follow_through(arm, act, loop=True, wind=wind)
    # decimate the skinned body (vertex groups follow the collapse)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    mod = body.modifiers.new('formdec', 'DECIMATE')
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    # the armature modifier must stay last and unapplied
    bpy.ops.object.modifier_move_to_index(modifier='formdec', index=0)
    bpy.ops.object.modifier_apply(modifier='formdec')
    for img in bpy.data.images:
        if img.size[0] > tex and img.name.startswith('Balgath'):
            img.scale(tex, tex)
    from build import export, log
    export(path, arm)
    log('FORM', path, sum(len(p.vertices) - 2 for p in body.data.polygons), 'tris')
