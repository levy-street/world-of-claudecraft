"""The Smith's Heart's Quench kit laid out for review in Blender (phase 2H): a
stretch of the Quench Basin's shelf (a fire bowl, a vent, the low walls
along its rim with snow banked at their foot, a frost stone) at the edge of
the Frozen Lake (a sheet of dark ice, a great blade sunk in it, the Singing
Ice's cracks and a cluster of its blades), the old ice heaped against a
wall of rock past the rim with a frozen fall hanging on it, under the
Quench's own cold light, a 2 yd figure for scale.

Run (background renders, then the scene saved for the owner to open):
  blender -b --factory-startup --python open_quench_in_blender.py -- \
      --out DIR [--save scene.blend]
Writes DIR/blender_lago_fase2h.png and DIR/blender_cascada_fase2h.png.
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401
from build_smith_heart_hammer_kit import camera, look, scale_figure  # noqa: E402
from build_smith_heart_quench_kit import BUILDERS, build_quench_kit, preview_materials, setup_cold_render  # noqa: E402


def place(name, loc, rz=0.0, scale=(1.0, 1.0, 1.0)):
    """A linked copy of a built piece at `loc` (Blender frame), turned rz."""
    src = bpy.data.objects[f'Kit_{name}']
    obj = src.copy()
    obj.parent = None
    obj.location = loc
    obj.rotation_euler = (0.0, 0.0, rz)
    obj.scale = scale
    bpy.context.scene.collection.objects.link(obj)
    obj.hide_render = False
    obj.hide_set(False)
    return obj


def plane(name, size, loc, colour, rough, rot=0.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    g = bpy.context.active_object
    g.name = name
    g.scale = (size[0], size[1], 1)
    g.rotation_euler = (0.0, 0.0, rot)
    mat = bpy.data.materials.new(name + 'Mat')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = rough
    g.data.materials.append(mat)
    return g


def rock_wall(name, loc, size, colour):
    """A plain block of frosted granite standing for the mountain's rock."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    w = bpy.context.active_object
    w.name = name
    w.scale = size
    mat = bpy.data.materials.new(name + 'Mat')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = 0.9
    w.data.materials.append(mat)
    return w


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    out = arg('--out') or HERE
    os.makedirs(out, exist_ok=True)
    parts, materials = build_quench_kit('SmithHeartQuenchKit_ROOT', list(BUILDERS))
    preview_materials(materials)
    for o in parts:
        o.hide_render = True
        o.hide_set(True)
    # ---- the shelf (rime) and the lake (dark ice) ------------------------------------------
    plane('ShelfRime', (52, 18), (0, -14, 0), (0.42, 0.46, 0.52), 0.85)
    plane('LakeIce', (52, 34), (0, 12, 0.005), (0.04, 0.11, 0.17), 0.22)
    # The shelf's rim over the void (toward -Y), its walls and their drifts.
    for i, x in enumerate(range(-24, 27, 6)):
        place('QuenchWallB' if i % 4 == 2 else 'QuenchWallA', (x, -23, 0))
        if i % 2 == 0:
            place('SnowDriftA', (x + 1.0, -21.4, 0.0), rz=0.05)
    place('LakeBrazier', (-9, -10, 0), rz=0.4)
    place('LakeBrazier', (16, -12, 0), rz=1.7)
    place('SteamVent', (4, -15, 0.0), rz=0.3)
    place('FrostStone', (-20, -17, 0), rz=-0.5)
    # Drifts along the lake's edge.
    for i, x in enumerate(range(-22, 24, 8)):
        place('SnowDriftB' if i % 3 == 0 else 'SnowDriftA', (x, -4.6, 0.01), rz=0.1 * (i % 3))
    # The lake: a great blade sunk in it, the Singing Ice's cracks and blades.
    place('SunkBlade', (2, 10, 0), rz=0.6)
    place('SunkBlade', (-14, 20, 0), rz=2.4, scale=(0.9, 0.9, 0.9))
    place('IceCrackB', (9, 4, 0.01), rz=0.8)
    place('IceCrackA', (-6, 6, 0.01), rz=0.3)
    place('IceCrackA', (14, 15, 0.01), rz=1.9)
    place('IceBlade', (-2, 2, 0), rz=1.1)
    # ---- past the lake: the old ice heaped against the mountain, a fall on it ---------------
    rock_wall('MountainRock', (0, 46, 18), (70, 12, 52), (0.46, 0.5, 0.57))
    place('IceShelfA', (-12, 36, 0), rz=0.0)
    place('IceShelfB', (13, 37, 0), rz=0.15)
    place('FrozenFallA', (24, 40.4, 22), rz=0.0)
    place('FrozenFallB', (-28, 40.4, 15), rz=0.0)
    fig = scale_figure()
    fig.location = (-4, -8, 1.0)
    scene = setup_cold_render('', res=(1600, 1000))
    world = scene.world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.57, 0.66, 1)
    cam = camera('QuenchCam', lens=30)
    scene.camera = cam
    look(cam, Vector((-30, -46, 22)), Vector((0, 8, 4)))
    scene.render.filepath = os.path.join(out, 'blender_lago_fase2h.png')
    bpy.ops.render.render(write_still=True)
    look(cam, Vector((34, 2, 16)), Vector((16, 38, 12)))
    scene.render.filepath = os.path.join(out, 'blender_cascada_fase2h.png')
    bpy.ops.render.render(write_still=True)
    # Leave the review camera on the lake's shelf.
    look(cam, Vector((-30, -46, 22)), Vector((0, 8, 4)))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
