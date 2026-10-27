"""The Smith's Heart raid's Breath kit (phase 2G): the lightning rods, the
wind-horns, the bridge's shelters and its natural arch, the low walls along
every Breath walk over the void, the wind channels' cheek stones, the
cracked plateau's fissures, the strikes' scars and the landings' standing
stones (breath_pieces.py).

Run (background, one scene):
  blender -b --factory-startup --python build_smith_heart_breath_kit.py -- \
      [--closeups DIR] [--views front,top] [--pieces A,B] [--save out.blend]

Writes smith_heart_breath_kit_components.glb next to this file (a full
build only; `--pieces` builds a subset for review renders and writes
nothing); the shipping build (scripts/assets/smith_heart_breath_kit/build.mjs)
validates, fingerprints and meshopts it into
public/models/props/smith_heart_breath_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, heart_kit.ts) on the
kit's slots: KitStone (lit: the storm granite), KitGlow (emissive: the
vein's crystal), KitGlass (unused, kept for the slot set).
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
import breath_pieces as bp  # noqa: E402
from build_smith_heart_hammer_kit import camera, look, preview_materials, scale_figure  # noqa: E402
from hckit import export_kit  # noqa: E402

BUILDERS = {
    'StormRod': lambda: bp.storm_rod(bpy),
    'WindHorn': lambda: bp.wind_horn(bpy),
    'WindShelter': lambda: bp.wind_shelter(bpy),
    'WindBridge': lambda: bp.wind_bridge(bpy),
    'BreathWallA': lambda: bp.breath_wall('A'),
    'BreathWallB': lambda: bp.breath_wall('B'),
    'ChannelJamb': lambda: bp.channel_jamb(bpy),
    'StormStone': lambda: bp.storm_stone(bpy),
    'PlateauCrackA': lambda: bp.plateau_crack('A'),
    'PlateauCrackB': lambda: bp.plateau_crack('B'),
    'StrikeScar': bp.strike_scar,
    'WindGroove': bp.wind_groove,
}


def build_breath_kit(root_name, names):
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


def setup_storm_render(path, res=(1400, 1000)):
    """EEVEE under the Breath's intended light: a cold teal-white key high
    through the storm, a slate-blue sky fill, a pale rim."""
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
    world = bpy.data.worlds.get('Storm') or bpy.data.worlds.new('Storm')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.2, 0.26, 0.33, 1)
    bg.inputs['Strength'].default_value = 0.7
    scene.world = world
    if not bpy.data.objects.get('StormKey'):
        sun = bpy.data.objects.new('StormKey', bpy.data.lights.new('StormKey', 'SUN'))
        sun.data.energy = 3.2
        sun.data.color = (0.86, 0.95, 1.0)
        sun.rotation_euler = (0.75, 0.1, 2.3)
        bpy.context.scene.collection.objects.link(sun)
        rim = bpy.data.objects.new('StormRim', bpy.data.lights.new('StormRim', 'SUN'))
        rim.data.energy = 1.1
        rim.data.color = (0.7, 0.85, 1.0)
        rim.rotation_euler = (1.2, 0.0, -0.9)
        bpy.context.scene.collection.objects.link(rim)
    return scene


def render_closeups(parts, folder, views=('front',)):
    """One framed render per piece and view (a 2 yd figure beside it)."""
    os.makedirs(folder, exist_ok=True)
    scene = setup_storm_render('', res=(1100, 1100))
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
    parts, materials = build_breath_kit('SmithHeartBreathKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'smith_heart_breath_kit_components.glb'))
    preview_materials(materials)
    if arg('--closeups'):
        render_closeups(parts, arg('--closeups'), (arg('--views') or 'front').split(','))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
