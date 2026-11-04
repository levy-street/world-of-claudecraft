"""The Islands of the Wind laid out for review in Blender (the AAA pass of
2026-11-03): both isles side by side as they hang off the Cornice (B to the
west of A), a drifting stone by them, a 2 yd figure on A's walk for scale,
under the Breath's storm light with the cloud sea's cool bounce from below
(the runtime's isle fill, src/render/smith_heart/heart_isle_fill.ts).

Run (background renders, then the scene saved for the owner to open):
  blender -b --factory-startup --python open_isles_in_blender.py -- \\
      --out DIR [--save scene.blend]
Writes DIR/isles_<view>.png for the views below.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
from build_smith_heart_breath_kit import build_breath_kit, setup_storm_render  # noqa: E402
from build_smith_heart_hammer_kit import camera, look, preview_materials, scale_figure  # noqa: E402

# Both isles in one frame, B 59 yd west of A and 4 higher (BREATH_ISLES).
B_AT = (-59.0, -3.0, 4.0)
VIEWS = {
    # From the Cornice's rim, looking up and south at both.
    'debajo': ((-29.0, -62.0, -34.0), (-29.0, 0.0, -6.0), 28),
    # Level with them, from the side, at a distance.
    'lado': ((-29.0, -95.0, -6.0), (-29.0, 0.0, -8.0), 35),
    # Close under A's hang.
    'debajo_A': ((6.0, -30.0, -36.0), (0.0, 0.0, -12.0), 24),
    # Over A's walk, a three-quarter look down.
    'encima_A': ((14.0, -22.0, 13.0), (0.0, 0.0, -1.0), 30),
    # Over B's walk.
    'encima_B': ((B_AT[0] - 16.0, B_AT[1] - 20.0, B_AT[2] + 13.0), (B_AT[0], B_AT[1], B_AT[2] - 1.0), 30),
    # Straight down on each walk (its organic outline, its ledges).
    'cenital_A': ((0.0, -0.01, 42.0), (0.0, 0.0, 0.0), 32),
    'cenital_B': ((B_AT[0], B_AT[1] - 0.01, B_AT[2] + 42.0), (B_AT[0], B_AT[1], B_AT[2]), 32),
    # Down onto a bay's lip and A's ledge, close.
    'borde_A': ((9.0, 9.0, 4.0), (3.0, 4.0, -1.5), 30),
    'repisa_A': ((2.0, -1.0, 3.2), (9.5, -1.0, 0.2), 28),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    out = arg('--out') or HERE
    os.makedirs(out, exist_ok=True)
    parts, materials = build_breath_kit('SmithHeartIsles_ROOT', ['WindIsleA', 'WindIsleB', 'IsleShard'])
    preview_materials(materials)
    by = {o.name: o for o in parts}
    by['Kit_WindIsleB'].location = B_AT
    by['Kit_IsleShard'].location = (19.0, -6.0, 3.0)
    scene = setup_storm_render('', res=(1600, 1000))
    # The warm key a little warmer (the painted world's L1), the cloud sea's
    # cool bounce from below (the runtime's isle fill).
    key = bpy.data.objects.get('StormKey')
    if key:
        key.data.color = (1.0, 0.93, 0.82)
        key.data.energy = 4.0
    if not bpy.data.objects.get('CloudBounce'):
        bounce = bpy.data.objects.new('CloudBounce', bpy.data.lights.new('CloudBounce', 'SUN'))
        bounce.data.energy = 1.6
        bounce.data.color = (0.72, 0.8, 1.0)
        bounce.rotation_euler = (math.pi, 0.0, 0.0)
        bpy.context.scene.collection.objects.link(bounce)
    world = scene.world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.6, 0.66, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    figure = scale_figure()
    figure.location = (-2.8, 1.4, 1.0)
    cam = camera('isles', lens=30)
    scene.camera = cam
    only = arg('--views')
    for name, (eye, at, lens) in VIEWS.items():
        if only and name not in only.split(','):
            continue
        cam.data.lens = lens
        look(cam, Vector(eye), Vector(at))
        scene.render.filepath = os.path.join(out, f'isles_{name}.png')
        bpy.ops.render.render(write_still=True)
    # Leave the scene on the look down onto A's walk.
    eye, at, lens = VIEWS['encima_A']
    cam.data.lens = lens
    look(cam, Vector(eye), Vector(at))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
