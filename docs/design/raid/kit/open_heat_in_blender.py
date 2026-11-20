"""The Smith's Heart's Heat kit laid out for review in Blender (phase 2I): the
Hearth (the Heat, never a forge): its mouth in a wall of the mountain's
basalt, the altar-stone before it, the ember boulders and crystal clusters
round it, the column bundles at the hall's corners and the low walls along
its lip; and apart, a stretch of the casting floor with the wellspring, the
Pour Channel run down to its spill at the floor's lip, under the Hearth's own
light, a 2 yd figure for scale.

Run (background renders, then the scene saved for the owner to open):
  blender -b --factory-startup --python open_heat_in_blender.py -- \
      --out DIR [--save scene.blend]
Writes DIR/blender_hogar_fase2i.png and DIR/blender_colada_fase2i.png.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401
from build_smith_heart_hammer_kit import camera, look, scale_figure  # noqa: E402
from build_smith_heart_heat_kit import BUILDERS, build_heat_kit, preview_materials, setup_hearth_render  # noqa: E402


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


def plane(name, size, loc, colour, rough):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    g = bpy.context.active_object
    g.name = name
    g.scale = (size[0], size[1], 1)
    mat = bpy.data.materials.new(name + 'Mat')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = rough
    g.data.materials.append(mat)
    return g


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    out = arg('--out') or HERE
    os.makedirs(out, exist_ok=True)
    parts, materials = build_heat_kit('SmithHeartHeatKit_ROOT', list(BUILDERS))
    preview_materials(materials)
    for o in parts:
        o.hide_render = True
        o.hide_set(True)
    # ---- the Hearth: the floor, the mouth, the altar-stone -----------------------------------
    plane('HearthFloor', (64, 52), (0, 4, 0), (0.06, 0.055, 0.052), 0.86)
    place('HearthMouth', (0, 34, 0))
    place('AltarStone', (0, 12, 0), rz=math.pi / 2)
    for s in (-1, 1):
        place('EmberBoulder', (s * 22, 22, 0), rz=s * 0.5)
        place('FireCrystalA' if s < 0 else 'FireCrystalB', (s * 18, -6, 0), rz=1.1 * s)
        place('FireCrystalB' if s < 0 else 'FireCrystalA', (s * 27, 6, 0), rz=2.3 * s)
        place('HearthPillar', (s * 35, -16, 0), rz=0.7 * s)
        place('HearthPillar', (s * 37, 16, 0), rz=2.1 * s, scale=(0.95, 0.95, 0.95))
    for i, x in enumerate(range(-27, 28, 6)):
        place('HeatWallB' if i % 4 == 2 else 'HeatWallA', (x, -22, 0))
        if i % 3 == 0:
            place('AshDriftA', (x + 1.0, -20.4, 0.0), rz=0.05)
    place('FireCrackA', (-9, -2, 0.01), rz=0.3)
    place('FireCrackB', (11, 0, 0.01), rz=1.2)
    place('FireCrackA', (8, -14, 0.01), rz=2.4)
    fig = scale_figure()
    fig.location = (-3, -4, 1.0)
    # ---- the casting floor: the wellspring, the Pour Channel, its spill ----------------------
    plane('CastingFloor', (30, 40), (140, 0, 0), (0.06, 0.055, 0.052), 0.86)
    place('Wellspring', (140, 16, 0), rz=0.0)
    for k in range(5):
        place('PourChannel', (140, 9.4 - k * 6, 0.002), rz=math.pi / 2)
    place('PourSpill', (140, -20, 0))
    for x in (128, 134, 146, 152):
        place('HeatWallA', (x, -20, 0))
    fig2 = scale_figure().copy()
    bpy.context.scene.collection.objects.link(fig2)
    fig2.location = (136, 2, 1.0)
    scene = setup_hearth_render('', res=(1600, 1000))
    cam = camera('HeatCam', lens=30)
    scene.camera = cam
    look(cam, Vector((26, -52, 20)), Vector((0, 16, 9)))
    scene.render.filepath = os.path.join(out, 'blender_hogar_fase2i.png')
    bpy.ops.render.render(write_still=True)
    look(cam, Vector((166, -42, 10)), Vector((140, -6, -2)))
    scene.render.filepath = os.path.join(out, 'blender_colada_fase2i.png')
    bpy.ops.render.render(write_still=True)
    # Leave the review camera on the Hearth.
    look(cam, Vector((26, -52, 20)), Vector((0, 16, 9)))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
