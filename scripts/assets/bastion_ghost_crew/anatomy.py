"""Original naval apparitions over the shared sculpted Bastion anatomy.

No legs hidden inside a translucent robe: the body ends below its belt and
authored cloth and soul streamers define the suspended lower silhouette.
"""
import importlib.util
import math
import os
import numpy as np
from sdf import Field, Ellipsoid, RoundCone, Sphere, RoundBox, rot_matrix
from build_core import Sculpt

def source(name):
    path = os.path.join(os.path.dirname(__file__), '..', 'sunken_bastion_drowned', 'revenant', name + '.py')
    spec = importlib.util.spec_from_file_location('ghost_source_' + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

BASE = source('anatomy')
for _key, _value in vars(BASE).items():
    if not _key.startswith('__'):
        globals()[_key] = _value
NAME = 'BastionGhostCaptain'
PREFIX = 'ghost_captain'
CAPTAIN = True

def set_variant(v):
    global CAPTAIN, NAME, PREFIX
    CAPTAIN = v != 'sailor'
    NAME = 'BastionGhostCaptain' if CAPTAIN else 'BastionGhostSailor'
    PREFIX = 'ghost_captain' if CAPTAIN else 'ghost_sailor'

def fields(k=1.0):
    global VOXEL_K
    VOXEL_K = k
    body = BASE.build_body(.015 * k)
    head = BASE.build_head(.006 * k)
    right = BASE.build_hand(-1, .006 * k, forearm=False)
    left = BASE.build_hand(1, .006 * k, forearm=True)
    out = [Sculpt('SpectralTorso', body, 'cloth', 3500, keep=lambda p: p.z > 2.3),
           Sculpt('Head', head, 'flesh', 4400, tau=.02),
           Sculpt('RightHand', right, 'flesh', 1300, tau=.015),
           Sculpt('LeftArm', left, 'flesh', 1900, tau=.015)]
    upper, lower = BASE.build_teeth(.0045 * k)
    out += [Sculpt('TeethUp', upper, 'tooth', 280, binding='rigid', bone='Head'),
            Sculpt('TeethLow', lower, 'tooth', 220, binding='rigid', bone='Jaw')]
    # A fitted naval coat with sculpted lapels, rolled collar and sleeve folds.
    coat = Field((-1.5, -.8, 2.22), (1.5, .8, 3.95), .011 * k)
    coat.add(Ellipsoid((0,.075,2.99),(.63,.42,.69), bone='Spine1'), .07)
    coat.sub(Ellipsoid((0,-.39,3.3),(.31,.22,.53)), .025)
    for s in (-1,1):
        sh = SHOULDER * (s,1,1)
        elbow = ELBOW * (s,1,1)
        coat.add(RoundCone(sh, elbow, .255 if CAPTAIN else .21, .19, bone=('L_' if s==1 else 'R_')+'UpperArm'), .09)
        coat.add(RoundBox((s*.255,-.375,3.26),(.105,.035,.32), rot=rot_matrix(0,s*-.23,0), radius=.02, bone='Spine2'), .025)
        coat.add(RoundBox((s*.22,.07,3.6),(.055,.24,.14),radius=.025,bone='Spine2'),.025)
    out.append(Sculpt('NavalCoat',coat,'cloth',4200,binding='transfer',allow=('Hips','Spine1','Spine2','L_UpperArm','R_UpperArm'),relax=8))
    out.append(Sculpt('Belt',BASE.build_belt(body,.012*k),'leather',650,binding='transfer',allow=('Hips','Spine1')))
    return out
