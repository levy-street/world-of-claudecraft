"""The Smith's Heart raid's mountain rock kit (phase 2E): the sculpted faces,
ribs and crests that skin the raid's mountain (every room's), and the
boulders fallen from them.

Run (background, one scene):
  blender -b --factory-startup --python build_smith_heart_rock_kit.py -- \
      [--preview out.png] [--closeups DIR] [--views front,side] [--pieces A,B] [--save out.blend]

Writes smith_heart_rock_kit_components.glb next to this file (a full build
only; `--pieces` builds a subset for review renders and writes nothing); the
shipping build (scripts/assets/smith_heart_rock_kit/build.mjs) validates,
fingerprints and meshopts it into public/models/props/smith_heart_rock_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, heart_kit.ts) on the
kit's slots (KitStone lit, KitGlow emissive, KitGlass unused). Game yards,
+Z up, front -Y (the game's +Z after the glTF export). Origins:
  - Kit_RockFace*, Kit_RockTall*, Kit_RockButtress, Kit_RockCrest*: on the
    FRONT plane at the foot's centre; nothing stands in front of y = 0, the
    body runs back to +Y (rock_sculpt.py);
  - Kit_RockLipA, B: on a walk's lip (z 0, nothing above -0.05), hanging
    40 yd, the face leaning out over the void (toward -Y) as it falls;
  - Kit_Boulder*: the foot's centre.
Deterministic: every random draw is seeded, nothing reads the clock.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
import rock_sculpt as rs  # noqa: E402
from build_smith_heart_hammer_kit import camera, look, preview_materials, scale_figure, setup_render  # noqa: E402
from hckit import export_kit  # noqa: E402


# Each band piece (phase 2G, the calm mountain: rock_sculpt.rock_wall):
# (name, seed, W, H, D, options). The near build of every one, then the far
# build of each the runtime draws high up the mountain. Every H is a whole
# number of rock_sculpt.ROCK_LIFT lifts (the beds line up piece to piece).
WALL_SPECS = [
    # The great faces of the first bands: columns, clefts, beds.
    ('RockWallA', 601, 48.0, 72.0, 30.0, dict(cols=2, clefts=[1.0], crown='shoulder', detail=1)),
    ('RockWallB', 607, 40.0, 60.0, 28.0, dict(cols=2, clefts=[0.7], crown='tower', detail=1, lip=(0.7, 1.2))),
    ('RockWallC', 613, 56.0, 84.0, 32.0, dict(cols=3, clefts=[0.0, 1.0], crown='shoulder', detail=1)),
    # The mountain's upper body (seen from fifty yards and more).
    ('RockMassA', 619, 64.0, 48.0, 40.0, dict(cols=2, clefts=[0.5], crown='dome', fall=0.5, setback=(1.0, 2.2))),
    ('RockMassB', 631, 52.0, 60.0, 36.0, dict(cols=2, clefts=[0.6], crown='tower', setback=(0.9, 2.0))),
    # A buttress standing out of the face where the eye goes (the vein
    # mouths, the stair heads): the detail clusters on it.
    ('RockProw', 641, 30.0, 72.0, 26.0, dict(cols=3, clefts=[0.7, 1.0], prow=0.5, detail=2, crown='tower')),
]


def wall(name, seed, W, H, D, far=False, **kw):
    def make():
        pn = name + ('Far' if far else '')
        p = rs.RP(pn, seed=seed, ao_dist=7.0)
        args = dict(kw)
        args['target'] = 1100 if far else 3000
        args['scree_n'] = 0 if far else 3
        return rs.rock_wall(bpy, p, pn, seed, W, H, D, key=name, **args)
    return make


def lip(name, seed, W, H, D, out, target=1100):
    def make():
        p = rs.RP(name, seed=seed, ao_dist=4.0)
        return rs.rock_lip_calm(bpy, p, name, seed, W, H, D, out=out, target=target)
    return make


def stone(name, seed, size):
    def make():
        p = rs.RP(name, seed=seed, ao_dist=1.5)
        return rs.boulder(bpy, p, name, seed, size)
    return make


BUILDERS = {}
for (n, seed, W, H, D, kw) in WALL_SPECS:
    BUILDERS[n] = wall(n, seed, W, H, D, **kw)
for (n, seed, W, H, D, kw) in WALL_SPECS:
    BUILDERS[n + 'Far'] = wall(n, seed, W, H, D, far=True, **kw)
# The walks' sides where they fall into the chasm.
BUILDERS['RockLipA'] = lip('RockLipA', 581, 12.0, 40.0, 4.0, 0.38)
BUILDERS['RockLipB'] = lip('RockLipB', 587, 12.0, 40.0, 4.0, 0.38)
# The crest's needles (phase 2F): the skyline's landmarks.
BUILDERS['RockNeedleA'] = lambda: rs.needle(bpy, rs.RP('RockNeedleA', seed=591, ao_dist=6.0), 'RockNeedleA', 591,
                                            18.0, 72.0)
BUILDERS['RockNeedleB'] = lambda: rs.needle(bpy, rs.RP('RockNeedleB', seed=597, ao_dist=6.0), 'RockNeedleB', 597,
                                            24.0, 58.0, twin=True)
# Boulders.
BUILDERS['BoulderA'] = stone('BoulderA', 561, (3.6, 2.8, 2.4))
BUILDERS['BoulderB'] = stone('BoulderB', 563, (5.2, 3.8, 3.0))
BUILDERS['BoulderC'] = stone('BoulderC', 569, (2.2, 1.8, 1.6))


# ===================================================================== build
def build_rock_kit(root_name, names):
    """The kit's three slots, every named piece under one root, a triangle
    and bounds report per piece."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, alpha in (('KitStone', 0.0, 1.0), ('KitGlow', 4.0, 1.0), ('KitGlass', 0.0, 0.4)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.9
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
    for n in names:
        obj = BUILDERS[n]().finish(materials, root)
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


# ==================================================================== review
def stack_preview(parts, path):
    """A stretch of mountain as the runtime stacks it (phase 2G): the great
    faces of the first band along a gentle curve, the upper body behind and
    above, a buttress, their beds on the same lift lines (every piece at the
    same height scale, its foot on the bed grid), boulders at the foot and a
    2 yd figure on a walk 8 yd out, under the Hammer's low warm key. Copies of
    the pieces (linked data), so the kit is kept."""
    by = {o.name[4:]: o for o in parts}
    lift = rs.ROCK_LIFT
    rows = [
        (0.0, -lift * 2, 0.0, ['RockWallA', 'RockWallC', 'RockProw', 'RockWallB', 'RockWallA']),
        (34.0, lift * 2, 0.06, ['RockMassB', 'RockMassA', 'RockMassB', 'RockMassA']),
    ]
    made = []
    for (yb, zb, curve, names) in rows:
        x = -78.0
        for k, n in enumerate(names):
            if n not in by:
                continue
            ob = by[n].copy()
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = None
            w = (ob.dimensions.x if ob.dimensions.x > 1 else 40.0) * 0.72
            x += w / 2
            ob.location = (x, yb + curve * x * x * 0.02 + (k % 2) * 1.5, zb)
            ob.rotation_euler = (0, 0, -x * 0.004 + (k % 3 - 1) * 0.06)
            made.append(ob)
            x += w / 2
    for (n, loc) in (('BoulderB', (-12, -9, 0.0)), ('BoulderA', (14, -8, 0.0)), ('BoulderC', (6, -10, 0.0))):
        if n in by:
            ob = by[n].copy()
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = None
            ob.location = loc
            made.append(ob)
    for o in parts:
        o.hide_render = True
    # The walk the camera stands on (8 yd out from the front plane).
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -22, -1.0))
    walk = bpy.context.active_object
    walk.scale = (160, 26, 2)
    mat = bpy.data.materials.new('WalkMat')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.29, 0.28, 1)
    walk.data.materials.append(mat)
    fig = scale_figure()
    fig.location = (0, -20, 1.0)
    scene = setup_render(path, res=(1600, 1000))
    cam = camera('stack', lens=22)
    scene.camera = cam
    look(cam, (-10, -70, 14), (0, 10, 40))
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', path)
    return made


def render_closeups(parts, folder, views=('front',)):
    os.makedirs(folder, exist_ok=True)
    scene = setup_render('', res=(1100, 1100))
    cam = camera('closeup', lens=35)
    scene.camera = cam
    figure = scale_figure()
    dirs = {'front': Vector((-0.35, -1.2, 0.25)), 'side': Vector((-1.2, -0.35, 0.3)),
            'low': Vector((-0.25, -1.2, -0.1)), 'top': Vector((-0.3, -0.6, 1.1)), 'back': Vector((0.6, 1.1, 0.5))}
    for obj in parts:
        for o in parts:
            o.hide_render = o is not obj
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = max(4.0, (hi - lo).length)
        figure.location = (lo.x - 1.2, lo.y - 1.6, 1.0 + max(0.0, lo.z))
        for view in views:
            look(cam, centre + dirs[view].normalized() * size * 1.0, centre)
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
    parts, materials = build_rock_kit('SmithHeartRockKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'smith_heart_rock_kit_components.glb'))
    preview_materials(materials)
    if arg('--closeups'):
        render_closeups(parts, arg('--closeups'), (arg('--views') or 'front').split(','))
    if arg('--preview'):
        stack_preview(parts, arg('--preview'))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
