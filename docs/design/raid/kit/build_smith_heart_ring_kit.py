"""The Smith's Heart raid's Ring kit (phase 2F): the Ring's paving, curb,
foot and channels, the two stairs down to the seal, the Seal Dais and the
heart seal, the crystal spires, the Ring's standing stones and cairns, and
the vein mouths' thresholds.

Run (background, one scene):
  blender -b --factory-startup --python build_smith_heart_ring_kit.py -- \
      [--closeups DIR] [--views front,top] [--pieces A,B] [--save out.blend]

Writes smith_heart_ring_kit_components.glb next to this file (a full build
only; `--pieces` builds a subset for review renders and writes nothing); the
shipping build (scripts/assets/smith_heart_ring_kit/build.mjs) validates,
fingerprints and meshopts it into public/models/props/smith_heart_ring_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, heart_kit.ts) on
the kit's slots: KitStone (lit: the granite, the dressed stone), KitGlow
(emissive: the crystal; the seal's and the spires' crystal carries a grey
facet shade the runtime's crystal shader colours, the rest its emitted
colour), KitGlass (unused, kept for the slot set). Every frame is in the
modules' docs (ring_pieces.py, ring_sculpt.py).
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
import ring_pieces as rp  # noqa: E402
import ring_sculpt as rs  # noqa: E402
from build_smith_heart_hammer_kit import build_hammer_kit as _unused  # noqa: E402,F401
from build_smith_heart_hammer_kit import camera, look, preview_materials, scale_figure, setup_render  # noqa: E402
from hckit import export_kit  # noqa: E402

BUILDERS = {
    # The Ring.
    'RingPaveA': lambda: rp.ring_pave('A'),
    'RingPaveB': lambda: rp.ring_pave('B'),
    'RingPaveC': lambda: rp.ring_pave('C'),
    'RingPaveD': lambda: rp.ring_pave('D'),
    'RingPaveStart': lambda: rp.ring_pave('Start'),
    'RingPaveEnd': lambda: rp.ring_pave('End'),
    'RingChannel': rp.ring_channel,
    'RingCurbA': lambda: rp.ring_curb('A'),
    'RingCurbB': lambda: rp.ring_curb('B'),
    'RingFootA': lambda: rp.ring_foot('A'),
    'RingFootB': lambda: rp.ring_foot('B'),
    'RingSill': rp.ring_sill,
    # The stairs.
    'StairTreadA': lambda: rp.stair_tread('A'),
    'StairTreadB': lambda: rp.stair_tread('B'),
    'StairTreadC': lambda: rp.stair_tread('C'),
    'StairTreadLongA': lambda: rp.stair_tread('A', long=True),
    'StairTreadLongB': lambda: rp.stair_tread('B', long=True),
    'StairChute': rp.stair_chute,
    'StairParapetA': lambda: rp.stair_parapet('A'),
    'StairParapetB': lambda: rp.stair_parapet('B'),
    # The seal and its dais.
    'SealDais': lambda: rs.seal_dais(bpy),
    'SealQuarter': lambda: rs.seal_quarter(bpy),
    'SealHeart': lambda: rs.seal_heart(bpy),
    'SealShardA': lambda: rs.seal_shard(bpy, 'A'),
    'SealShardB': lambda: rs.seal_shard(bpy, 'B'),
    'SealShardC': lambda: rs.seal_shard(bpy, 'C'),
    'SealSpire': lambda: rs.seal_spire(bpy),
    # The Ring's stones and the mouths.
    'RingMonolith': lambda: rs.ring_monolith(bpy),
    'RingCairnA': lambda: rs.ring_cairn(bpy, 'A'),
    'RingCairnB': lambda: rs.ring_cairn(bpy, 'B'),
    'JambHammer': lambda: rs.jamb(bpy, 'hammer'),
    'JambBreath': lambda: rs.jamb(bpy, 'breath'),
    'JambQuench': lambda: rs.jamb(bpy, 'quench'),
    'JambHeat': lambda: rs.jamb(bpy, 'heat'),
}


def build_ring_kit(root_name, names):
    """The kit's three slots, every named piece under one root, a triangle
    and bounds report per piece."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, alpha in (('KitStone', 0.0, 1.0), ('KitGlow', 4.0, 1.0), ('KitGlass', 0.0, 0.4)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.85
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        if alpha < 1.0:
            bsdf.inputs['Alpha'].default_value = alpha
        materials.append(mat)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    parts = []
    total = 0
    import time
    for n in names:
        t0 = time.time()
        obj = BUILDERS[n]().finish(materials, root)
        print(f'BUILT {n} in {time.time() - t0:.1f}s', flush=True)
        parts.append(obj)
        dg = bpy.context.evaluated_depsgraph_get()
        mesh = obj.evaluated_get(dg).to_mesh()
        mesh.calc_loop_triangles()
        tris = len(mesh.loop_triangles)
        total += tris
        bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = [round(min(v[i] for v in bb), 2) for i in range(3)]
        hi = [round(max(v[i] for v in bb), 2) for i in range(3)]
        print(f'PIECE {obj.name} triangles {tris} min {lo} max {hi}', flush=True)
    print('KIT_TRIANGLES', total)
    return parts, materials


def render_closeups(parts, folder, views=('front',)):
    """One framed render per piece and view (a 2 yd figure beside it)."""
    os.makedirs(folder, exist_ok=True)
    scene = setup_render('', res=(1100, 1100))
    cam = camera('closeup', lens=35)
    scene.camera = cam
    figure = scale_figure()
    dirs = {'front': Vector((-0.35, -1.2, 0.45)), 'side': Vector((-1.2, -0.35, 0.4)),
            'low': Vector((-0.25, -1.2, 0.05)), 'top': Vector((-0.2, -0.45, 1.2)), 'back': Vector((0.6, 1.1, 0.5)),
            'under': Vector((-0.4, -1.1, -0.55))}
    for obj in parts:
        for o in parts:
            o.hide_render = o is not obj
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = max(4.0, (hi - lo).length)
        figure.location = (centre.x + (hi.x - lo.x) * 0.25, lo.y - 0.8, max(0.0, lo.z) + 1.0)
        for view in views:
            look(cam, centre + dirs[view].normalized() * size * 0.95, centre)
            scene.render.filepath = os.path.join(folder, f'{obj.name}_{view}.png')
            bpy.ops.render.render(write_still=True)
    for o in parts:
        o.hide_render = False


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    only = arg('--pieces')
    names = list(BUILDERS)
    if only:
        want = only.split(',')
        names = [n for n in names if n in want]
    parts, materials = build_ring_kit('SmithHeartRingKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'smith_heart_ring_kit_components.glb'))
    preview_materials(materials)
    if arg('--closeups'):
        render_closeups(parts, arg('--closeups'), (arg('--views') or 'front').split(','))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
