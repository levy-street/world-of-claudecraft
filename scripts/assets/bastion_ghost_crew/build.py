"""Reproducible drowned spectral crew, using the Bastion SDF/bake kit.

blender -b --factory-startup --python build.py -- out.glb --variant captain --bake 2048
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index('--') + 1:]
work = os.path.abspath(args[0]) + '.work'
os.environ['GHOST_BUILD_WORK'] = work
if '--work' not in args:
    sys.argv.extend(['--work', work])
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.abspath(os.path.join(HERE, '..', 'sunken_bastion_drowned', 'kit')))
import anatomy as A
import dressing as D
import shading as SH
import clips as C
import build_core
import stage

# Report device selection immediately; Blender buffers bake pass output otherwise.
_device = stage.use_gpu
def bake_device(scene):
    chosen = _device(scene)
    print('GHOST_BAKE_DEVICE', chosen, flush=True)
    return chosen
stage.use_gpu = bake_device

_glows = build_core.glow_materials
def ghost_glows(spec):
    materials = _glows(spec)
    for key in ('glow_soul','glow_wisp'):
        mat = materials[key]
        mat.surface_render_method = 'BLENDED'
        mat.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = .62 if key=='glow_soul' else .28
    return materials
build_core.glow_materials = ghost_glows
build_core.run(A, D, SH, C)
