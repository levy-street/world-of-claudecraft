"""Review renders for the reward chest. Art review only: nothing here ships.

    blender --background --python docs/design/reward-chest/preview.py -- <out_dir>

Writes hero.png (close three-quarter view, lid at its idle gap) and
gameplay_dark.png / gameplay_light.png (the rarities side by side from roughly
the WoC chase-camera distance and pitch, on a dark and on a light floor).
The glow here is only emission: the real light leak, rays, motes and the spawn
are runtime effects (src/render/hoard_reward_chest.ts).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_chest as chest  # noqa: E402

OUT_DIR = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.dirname(__file__)
LID_IDLE_DEG = 5.0

RARITIES = [
    ('common', (0.55, 1.0, 0.62), 0.8),
    ('rare', (0.25, 0.55, 1.0), 1.0),
    ('epic', (0.72, 0.3, 1.0), 1.25),
    ('legendary', (1.0, 0.72, 0.2), 1.5),
]


def tinted_materials(color, intensity):
    mats = chest.make_materials()
    for mat in mats:
        if mat.name.split('.')[0] in ('Glow', 'InnerGlow'):
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = (*color, 1)
            bsdf.inputs['Emission Color'].default_value = (*color, 1)
            boost = 5.0 if mat.name.startswith('InnerGlow') else 2.2
            bsdf.inputs['Emission Strength'].default_value = boost * intensity
    return mats


def place(x, color, intensity, lid_deg=LID_IDLE_DEG, yaw=0.0):
    mats = tinted_materials(color, intensity)
    root = bpy.data.objects.new('ClueRewardChest_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    root.location = (x, 0, 0)
    root.rotation_euler = (0, 0, yaw)
    chest.build_base(mats, root)
    lid = chest.build_lid(mats, root)
    chest.build_lock(mats, root)
    chest.build_inner_glow(mats, root)
    lid.rotation_euler = (-math.radians(lid_deg), 0, 0)
    # A point light inside stands in for the runtime light leak.
    light = bpy.data.lights.new('leak', 'POINT')
    light.color = color
    light.energy = 14 * intensity
    light.shadow_soft_size = 0.1
    lamp = bpy.data.objects.new('leak', light)
    bpy.context.scene.collection.objects.link(lamp)
    lamp.parent = root
    lamp.location = (0, -0.25, chest.BASE_HEIGHT + 0.04)
    return root


def ground(color):
    bpy.ops.mesh.primitive_plane_add(size=80)
    plane = bpy.context.object
    mat = bpy.data.materials.new('Ground')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.95
    plane.data.materials.append(mat)
    return plane


def lights(strength):
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = strength
    sun.angle = math.radians(12)
    obj = bpy.data.objects.new('sun', sun)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_euler = (math.radians(52), 0, math.radians(38))
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.2, 0.24, 0.32, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.55
    bpy.context.scene.world = world


def camera(location, target, lens=50):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    obj = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = [t - l for t, l in zip(target, location)]
    from mathutils import Vector

    obj.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = obj


def render(name, width=1600, height=900):
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in type(scene.view_settings).bl_rna.properties['view_transform'].enum_items] else 'AgX'
    scene.render.filepath = os.path.join(OUT_DIR, name)
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)


def scene_reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    which = os.environ.get('CHEST_VIEWS', 'hero,back,open,gameplay_dark,gameplay_light').split(',')

    if 'hero' in which:
        scene_reset()
        ground((0.12, 0.13, 0.12))
        lights(2.4)
        place(0, RARITIES[3][1], RARITIES[3][2], yaw=math.radians(-18))
        camera((2.3, -3.3, 1.9), (0, 0, 0.55), lens=55)
        render('hero.png')

    if 'back' in which:
        scene_reset()
        ground((0.12, 0.13, 0.12))
        lights(3.2)
        place(0, RARITIES[1][1], RARITIES[1][2], yaw=math.radians(155))
        camera((2.3, -3.3, 1.9), (0, 0, 0.55), lens=55)
        render('back.png')

    if 'open' in which:
        scene_reset()
        ground((0.12, 0.13, 0.12))
        lights(3.2)
        place(0, RARITIES[2][1], RARITIES[2][2], lid_deg=105, yaw=math.radians(28))
        camera((2.3, -3.3, 2.2), (0, 0, 0.7), lens=50)
        render('open.png')

    for name, floor, sun in (
        ('gameplay_dark', (0.05, 0.06, 0.07), 1.4),
        ('gameplay_light', (0.78, 0.8, 0.82), 3.4),
    ):
        if name not in which:
            continue
        scene_reset()
        ground(floor)
        lights(sun)
        for index, (_rarity, color, intensity) in enumerate(RARITIES):
            place((index - 1.5) * 3.4, color, intensity, yaw=math.radians(12))
        # Roughly the chase camera: ~50 degrees down, a dozen metres back.
        camera((0, -9.5, 11), (0, 0.4, 0.4), lens=42)
        render(f'{name}.png')
