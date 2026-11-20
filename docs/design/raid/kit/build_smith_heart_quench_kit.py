"""The Smith's Heart raid's Quench kit (phase 2H): the shelf's fire bowls, the
Smith's great blades of ice sunk in the lake, the old ice heaped against the
basin's walls, the steam vents, the Singing Ice's blades and cracks, the
landings' standing stones, the low walls along every Quench walk over the
void, the frozen falls on the vein's walls and the drifts of snow
(quench_pieces.py).

Run (background, one scene):
  blender -b --factory-startup --python build_smith_heart_quench_kit.py -- \
      [--closeups DIR] [--views front,top] [--pieces A,B] [--save out.blend]

Writes smith_heart_quench_kit_components.glb next to this file (a full
build only; `--pieces` builds a subset for review renders and writes
nothing); the shipping build (scripts/assets/smith_heart_quench_kit/build.mjs)
validates, fingerprints and meshopts it into
public/models/props/smith_heart_quench_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, heart_kit.ts) on the
kit's slots: KitStone (lit: the frost granite and the snow), KitGlow
(emissive: the vein's crystal, the braziers' coals), KitIce (lit and glossy:
the lake's ice, heart_kit.ts's ice slot).
"""
import os
import sys
import time

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
import quench_pieces as qp  # noqa: E402
from build_smith_heart_hammer_kit import camera, look, scale_figure  # noqa: E402
from hckit import export_kit  # noqa: E402

BUILDERS = {
    'LakeBrazier': lambda: qp.lake_brazier(bpy),
    'SunkBlade': lambda: qp.sunk_blade(bpy),
    'IceShelfA': lambda: qp.ice_shelf(bpy, 'A'),
    'IceShelfB': lambda: qp.ice_shelf(bpy, 'B'),
    'SteamVent': qp.steam_vent,
    'IceBlade': lambda: qp.ice_blade(bpy),
    'FrostStone': lambda: qp.frost_stone(bpy),
    'QuenchWallA': lambda: qp.quench_wall('A'),
    'QuenchWallB': lambda: qp.quench_wall('B'),
    'FrozenFallA': lambda: qp.frozen_fall(bpy, 'A'),
    'FrozenFallB': lambda: qp.frozen_fall(bpy, 'B'),
    'IceCrackA': lambda: qp.ice_crack('A'),
    'IceCrackB': lambda: qp.ice_crack('B'),
    'SnowDriftA': lambda: qp.snow_drift(bpy, 'A'),
    'SnowDriftB': lambda: qp.snow_drift(bpy, 'B'),
}


def build_quench_kit(root_name, names):
    """The kit's three slots, every named piece under one root, a triangle
    and bounds report per piece."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, rough in (('KitStone', 0.0, 0.85), ('KitGlow', 4.0, 0.85), ('KitIce', 0.0, 0.25)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = rough
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        materials.append(mat)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    parts = []
    total = 0
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


def preview_materials(materials):
    """Swap the export materials' nodes for review renders: glow emissive as
    the runtime draws it (unlit), the ice glossy with a cold sheen (the
    runtime's ice slot), the stone lit."""
    _stone, glow, ice = materials
    nt = glow.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col.outputs['Color'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 2.4
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    bsdf = ice.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.22
    try:
        bsdf.inputs['Coat Weight'].default_value = 0.4
        bsdf.inputs['Subsurface Weight'].default_value = 0.15
        bsdf.inputs['Subsurface Radius'].default_value = (0.4, 0.7, 1.0)
    except KeyError:
        pass


def setup_cold_render(path, res=(1400, 1000)):
    """EEVEE under the Quench's intended light: a pale cold sun low in the
    south-east through a thin overcast, a pale blue-grey sky fill, a cold rim."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = path
    for attr, value in (('taa_render_samples', 24), ('use_shadows', True), ('use_raytracing', True),
                        ('fast_gi_method', 'GLOBAL_ILLUMINATION'), ('use_fast_gi', True)):
        try:
            setattr(scene.eevee, attr, value)
        except (AttributeError, TypeError):
            pass
    world = bpy.data.worlds.get('Cold') or bpy.data.worlds.new('Cold')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.36, 0.43, 0.52, 1)
    bg.inputs['Strength'].default_value = 0.8
    scene.world = world
    if not bpy.data.objects.get('ColdKey'):
        sun = bpy.data.objects.new('ColdKey', bpy.data.lights.new('ColdKey', 'SUN'))
        sun.data.energy = 3.0
        sun.data.color = (0.9, 0.95, 1.0)
        sun.rotation_euler = (0.95, 0.15, 0.7)
        bpy.context.scene.collection.objects.link(sun)
        rim = bpy.data.objects.new('ColdRim', bpy.data.lights.new('ColdRim', 'SUN'))
        rim.data.energy = 1.0
        rim.data.color = (0.7, 0.86, 1.0)
        rim.rotation_euler = (1.25, 0.0, -2.4)
        bpy.context.scene.collection.objects.link(rim)
    return scene


def render_closeups(parts, folder, views=('front',)):
    """One framed render per piece and view (a 2 yd figure beside it)."""
    os.makedirs(folder, exist_ok=True)
    scene = setup_cold_render('', res=(1000, 1000))
    cam = camera('closeup', lens=35)
    scene.camera = cam
    figure = scale_figure()
    dirs = {'front': Vector((-0.35, -1.2, 0.45)), 'side': Vector((-1.2, -0.35, 0.4)),
            'low': Vector((-0.25, -1.2, 0.05)), 'top': Vector((-0.2, -0.45, 1.2)), 'back': Vector((0.6, 1.1, 0.5))}
    for obj in parts:
        for o in parts:
            o.hide_render = o is not obj
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = max(4.0, (hi - lo).length)
        figure.location = (centre.x + (hi.x - lo.x) * 0.3, lo.y - 0.8, max(0.0, lo.z) + 1.0)
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
    parts, materials = build_quench_kit('SmithHeartQuenchKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'smith_heart_quench_kit_components.glb'))
    preview_materials(materials)
    if arg('--closeups'):
        render_closeups(parts, arg('--closeups'), (arg('--views') or 'front').split(','))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
