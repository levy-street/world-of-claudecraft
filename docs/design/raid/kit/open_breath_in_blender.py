"""The Smith's Heart's Breath kit laid out for review in Blender (phase 2G):
a stretch of the Storm Cornice (a lightning rod with its strike scar, a
wind-horn, a channel's two cheek stones and its groove, a standing stone,
the plateau's cracks, the low walls along its rim) on a pale scoured floor,
and the Wind Bridge's arch with its walls and shelters, under the Breath's
own storm light, a 2 yd figure for scale.

Run (background renders, then the scene saved for the owner to open):
  blender -b --factory-startup --python open_breath_in_blender.py -- \
      --out DIR [--save scene.blend]
Writes DIR/blender_cornisa_fase2g.png and DIR/blender_puente_fase2g.png.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401
import breath_pieces as bp  # noqa: E402
from build_smith_heart_breath_kit import BUILDERS, build_breath_kit, setup_storm_render  # noqa: E402
from build_smith_heart_hammer_kit import camera, look, preview_materials, scale_figure  # noqa: E402


def place(name, loc, rz=0.0, scale=(1.0, 1.0, 1.0), shear=0.0):
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
    if shear:
        # Follow a slope: tilt about the module's length (a small ramp).
        obj.rotation_euler = (0.0, -math.atan(shear), rz)
    return obj


def ground(size, loc, colour):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    g = bpy.context.active_object
    g.scale = (size[0], size[1], 1)
    mat = bpy.data.materials.new('ScouredFloor')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = 0.85
    g.data.materials.append(mat)
    return g


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    out = arg('--out') or HERE
    os.makedirs(out, exist_ok=True)
    parts, materials = build_breath_kit('SmithHeartBreathKit_ROOT', list(BUILDERS))
    preview_materials(materials)
    for o in parts:
        o.hide_render = True
        o.hide_set(True)
    # ---- the Cornice's stretch -------------------------------------------------------
    ground((46, 34), (0, 2, 0), (0.33, 0.34, 0.36))
    place('StormRod', (2, 9, 0), rz=0.3)
    place('StrikeScar', (2, 9, 0.01), rz=1.1)
    place('WindHorn', (-9, -2, 0), rz=2.6)
    place('StormStone', (13, 5, 0), rz=-0.4, scale=(1.1, 1.1, 1.1))
    for s, x in ((-1, -18.5), (1, -11.5)):
        place('ChannelJamb', (x, 15, 0), rz=math.pi if s > 0 else 0.0)
    place('WindGroove', (-15, 8, 0.01), rz=0.0)
    place('PlateauCrackA', (6, -6, 0.01), rz=0.4)
    place('PlateauCrackB', (-2, 4, 0.01), rz=1.2)
    for i, x in enumerate(range(-21, 24, 6)):
        place('BreathWallB' if i % 4 == 2 else 'BreathWallA', (x, -15, 0))
    fig = scale_figure()
    fig.location = (5, -4, 1.0)
    # ---- the Wind Bridge, further along -----------------------------------------------
    bx = 140.0
    place('WindBridge', (bx, 0, 30))
    run, rise = bp.BRIDGE_RUN, bp.BRIDGE_RISE
    n = 9
    for i in range(n):
        t = (i + 0.5) / n
        z = 30 + rise * t
        for side in (-1, 1):
            w = place('BreathWallA' if i % 3 else 'BreathWallB',
                      (bx + run * t, side * bp.BRIDGE_HALF, z),
                      rz=0.0 if side < 0 else math.pi, scale=(run / n / 6.0, 1, 1),
                      shear=rise / run * (-side))
            w.name = f'BridgeWall{i}{side}'
    place('WindShelter', (bx + run * 0.45, 2.8, 30 + rise * 0.45), rz=0.0)
    place('WindShelter', (bx + run * 0.77, 2.6, 30 + rise * 0.77), rz=0.0)
    fig2 = fig.copy()
    fig2.location = (bx + run * 0.3, 0, 30 + rise * 0.3 + 1.0)
    bpy.context.scene.collection.objects.link(fig2)
    scene = setup_storm_render('', res=(1600, 1000))
    world = scene.world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.47, 0.53, 1)
    cam = camera('BreathCam', lens=32)
    scene.camera = cam
    look(cam, Vector((-26, -40, 20)), Vector((0, 4, 5)))
    scene.render.filepath = os.path.join(out, 'blender_cornisa_fase2g.png')
    bpy.ops.render.render(write_still=True)
    look(cam, Vector((bx + run * 0.5 + 18, -92, 30)), Vector((bx + run * 0.5, 0, 22)))
    scene.render.filepath = os.path.join(out, 'blender_puente_fase2g.png')
    bpy.ops.render.render(write_still=True)
    # Leave the review camera on the Cornice.
    look(cam, Vector((-26, -40, 20)), Vector((0, 4, 5)))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
