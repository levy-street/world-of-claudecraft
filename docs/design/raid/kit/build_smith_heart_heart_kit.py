"""The Smith's Heart raid's Heart kit (phase 2J): the final room's platform
(the Anvil of the World, its walk, balustrade and keel), the Arrival Terrace
and its return portal, the Heart Bridge, the four altars, the roots of the
mountain that hold the platform, the heart and its bed deep in the chasm,
the colossus's rock pieces and the floor marks they leave (heart_pieces.py).

Run (background, one scene):
  blender -b --factory-startup --python build_smith_heart_heart_kit.py -- \
      [--closeups DIR] [--views front,top] [--pieces A,B] [--save out.blend]

Writes smith_heart_heart_kit_components.glb next to this file (a full build
only; `--pieces` builds a subset for review renders and writes nothing); the
shipping build (scripts/assets/smith_heart_heart_kit/build.mjs) validates,
fingerprints and meshopts it into public/models/props/smith_heart_heart_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, heart_kit.ts) on the
kit's three slots: KitStone (lit: the granite, the basalt, the frost stone),
KitGlow (the crystal: the tinted veins pale grey, the fixed crystal its own
emitted colour) and KitIce (the Quench altar's mantle).
"""
import os
import sys
import time

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
import heart_pieces as hp  # noqa: E402
from build_smith_heart_hammer_kit import camera, look, scale_figure  # noqa: E402
from hckit import export_kit  # noqa: E402

BUILDERS = {
    'AnvilFloor': lambda: hp.anvil_floor(bpy),
    'AnvilKeel': lambda: hp.anvil_keel(bpy),
    'TerraceFloor': lambda: hp.terrace_floor(bpy),
    'TerraceKeel': lambda: hp.terrace_keel(bpy),
    'HeartBridge': lambda: hp.heart_bridge(bpy),
    'AltarHammer': lambda: hp.altar(bpy, 'hammer'),
    'AltarBreath': lambda: hp.altar(bpy, 'breath'),
    'AltarQuench': lambda: hp.altar(bpy, 'quench'),
    'AltarHeat': lambda: hp.altar(bpy, 'heat'),
    'HeartRoot': lambda: hp.heart_root(bpy),
    'HeartCrystal': lambda: hp.heart_crystal(bpy),
    'CoreBed': lambda: hp.core_bed(bpy),
    'ColTorso': lambda: hp.col_torso(bpy),
    'ColHip': lambda: hp.col_hip(bpy),
    'ColHead': lambda: hp.col_head(bpy),
    'ColShoulder': lambda: hp.col_shoulder(bpy),
    'ColUpperArm': lambda: hp.col_upper_arm(bpy),
    'ColForearm': lambda: hp.col_forearm(bpy),
    'ColFist': lambda: hp.col_fist(bpy),
    'ColShardA': lambda: hp.col_shard(bpy, 'A'),
    'ColShardB': lambda: hp.col_shard(bpy, 'B'),
    'ColShardC': lambda: hp.col_shard(bpy, 'C'),
    'TornSocket': lambda: hp.torn_socket(bpy),
    'RubbleScatter': lambda: hp.rubble_scatter(bpy),
    # Mythic's Walking Slab (the Slabwright's soul dragging its pillar).
    'SlabClaw': lambda: hp.slab_claw(bpy),
    'SlabCollar': lambda: hp.slab_collar(bpy),
    'SlabFace': lambda: hp.slab_face(bpy),
}


def build_heart_kit(root_name, names):
    """The kit's two slots, every named piece under one root, a triangle and
    bounds report per piece."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, rough in (('KitStone', 0.0, 0.88), ('KitGlow', 4.0, 0.85), ('KitIce', 0.0, 0.25)):
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


def preview_materials(materials, tint=(1.0, 0.88, 0.62)):
    """Swap the glow material's nodes for review renders: emissive as the
    runtime draws it (unlit, its pale facets tinted the heart's white-gold;
    the fixed crystal a touch over its own colour)."""
    _stone, glow, _ice = materials
    nt = glow.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(col.outputs['Color'], mul.inputs['A'])
    mul.inputs['B'].default_value = (*tint, 1.0)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(mul.outputs['Result'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 2.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])


def setup_render(path, res=(1400, 1000)):
    """EEVEE under a neutral raid light: a warm key low from the south-west,
    a cool grey sky fill."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = path
    for attr, value in (('taa_render_samples', 24), ('use_shadows', True), ('use_raytracing', True),
                        ('use_fast_gi', True), ('use_bloom', True)):
        try:
            setattr(scene.eevee, attr, value)
        except (AttributeError, TypeError):
            pass
    world = bpy.data.worlds.get('Heart') or bpy.data.worlds.new('Heart')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.16, 0.13, 0.2, 1)
    bg.inputs['Strength'].default_value = 0.9
    scene.world = world
    if not bpy.data.objects.get('HeartKey'):
        sun = bpy.data.objects.new('HeartKey', bpy.data.lights.new('HeartKey', 'SUN'))
        sun.data.energy = 2.6
        sun.data.color = (1.0, 0.89, 0.72)
        sun.rotation_euler = (0.75, -0.35, -0.6)
        bpy.context.scene.collection.objects.link(sun)
        under = bpy.data.objects.new('HeartUnder', bpy.data.lights.new('HeartUnder', 'SUN'))
        under.data.energy = 1.2
        under.data.color = (1.0, 0.74, 0.4)
        under.rotation_euler = (3.0, 0.2, 0.4)
        bpy.context.scene.collection.objects.link(under)
    return scene


def render_closeups(parts, folder, views=('front',)):
    os.makedirs(folder, exist_ok=True)
    scene = setup_render('', res=(1000, 1000))
    cam = camera('closeup', lens=35)
    scene.camera = cam
    figure = scale_figure()
    dirs = {'front': Vector((-0.35, -1.2, 0.45)), 'side': Vector((-1.2, -0.35, 0.4)),
            'low': Vector((-0.25, -1.2, 0.08)), 'inner': Vector((1.2, -0.45, 0.45)), 'top': Vector((-0.2, -0.45, 1.2))}
    for obj in parts:
        for o in parts:
            o.hide_render = o is not obj
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = max(3.0, (hi - lo).length)
        figure.location = (centre.x + (hi.x - lo.x) * 0.3, lo.y - 0.8, 1.0)
        for view in views:
            look(cam, centre + dirs[view].normalized() * size * 1.05, centre)
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
    parts, materials = build_heart_kit('SmithHeartHeartKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'smith_heart_heart_kit_components.glb'))
    preview_materials(materials)
    if arg('--closeups'):
        render_closeups(parts, arg('--closeups'), (arg('--views') or 'front').split(','))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
