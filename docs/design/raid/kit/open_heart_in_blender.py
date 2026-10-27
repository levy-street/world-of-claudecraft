"""The Smith's Heart's final room laid out for review in Blender (phases 2J
and 2K): the Anvil of the World on its keel with its balustrade, its walk the
four elemental quarters round the central ring (phase 2K: each quarter's
seams lit in its vein's colour, the four ridges and their horns, the dais),
the four altars and the roots of the mountain gripping them, the Heart
Bridge down from the Arrival Terrace with its return portal and its
standing stones, the heart's bed deep in the chasm, and on the platform the
Masterless Strength's body assembled as the runtime binds it (its rock
pieces round the crystal heart, at rest), a 2 yd figure for scale.

Run (background renders, then the scene saved for the owner to open):
  blender -b --factory-startup --python open_heart_in_blender.py -- \
      --out DIR [--save scene.blend] [--label fase2l]
Writes DIR/blender_sala_cuartos_<label>.png (the room from above the
terrace) and DIR/blender_cresta_<label>.png (a ridge and its horn over the
Heat and the Breath); --label names them (fase2l by default).

Frames: the room's centre is the origin, the game's north (+Z) is Blender
-Y, a game yaw r is a Blender turn of r about +Z (heart_room_kit_plan_core.ts,
final_fx_core.ts carry the same numbers).
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
from build_smith_heart_heart_kit import BUILDERS, build_heart_kit, preview_materials, setup_render  # noqa: E402

ALTAR_RISE = 1.4
ROOT_LIFT = 4.4
BED_Y = -48.0
BED_SCALE = 2.4
TERRACE = (-49.5, 49.5, 4.0)


def place(name, loc, rz=0.0, scale=(1.0, 1.0, 1.0), tilt=(0.0, 0.0)):
    """A linked copy of a built piece at `loc` (Blender frame), turned rz."""
    src = bpy.data.objects[f'Kit_{name}']
    obj = src.copy()
    obj.parent = None
    obj.location = loc
    obj.rotation_euler = (tilt[0], tilt[1], rz)
    obj.scale = scale
    bpy.context.scene.collection.objects.link(obj)
    obj.hide_render = False
    obj.hide_set(False)
    return obj


# The quarters' vein colours for the review (SMITH_HEART_VEIN_COLORS, linear).
VEIN_TINT = {'Hammer': (0.75, 0.38, 0.08), 'Breath': (0.4, 0.26, 1.0), 'Quench': (0.15, 0.58, 1.0),
             'Heat': (1.0, 0.09, 0.007)}


def tinted_copy(obj, glow, tint):
    """Give a placed piece its own copy of the glow slot, tinted."""
    m = glow.copy()
    m.name = f'{glow.name}{obj.name}'
    for n in m.node_tree.nodes:
        if n.type == 'MIX':
            n.inputs['B'].default_value = (*tint, 1.0)
    obj.data = obj.data.copy()
    obj.data.materials[1] = m
    return obj


def g2b(x, y, z):
    """A game point (x east, y up, z north) to Blender."""
    return Vector((x, -z, y))


def arm_ik(s, w, l1, l2, pole):
    d = w - s
    dd = max(abs(l1 - l2) * 1.001, min((l1 + l2) * 0.999, d.length))
    u = d.normalized()
    wrist = s + u * dd
    a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    p = pole - u * pole.dot(u)
    p.normalize()
    return s + u * a + p * h, wrist


def colossus(at, facing):
    """The body at rest (final_fx_core.ts COLOSSUS_SLOTS / COLOSSUS_ARM), its
    feet at `at` (Blender), facing the game yaw `facing`."""
    cf, sf = math.cos(facing), math.sin(facing)

    def body(x, y, z):
        # Body frame (x, y up, z its front) to the game, then to Blender.
        gx = x * cf + z * sf
        gz = -x * sf + z * cf
        return at + g2b(gx, y + 0.4, gz)

    def put(piece, p, scale, rz=0.0, mirror=1.0):
        o = place(piece, p, rz=facing + rz, scale=(scale * mirror, scale, scale))
        return o

    put('ColTorso', body(0, 12.0, -0.6), 1.25)
    put('ColHip', body(0, 6.6, -0.3), 1.2)
    put('ColHead', body(0, 18.4, 0.4), 1.3)
    heart = place('HeartCrystal', body(0, 12.6, 2.4), rz=0.4, scale=(1.5, 1.5, 1.5))
    _ = heart
    for side in (-1, 1):
        put('ColShoulder', body(side * 6.6, 15.4, -0.5), 1.35, mirror=1.0 if side > 0 else -1.0)
        s = Vector((side * 7.4, 14.6, -0.2))
        w = Vector((side * 8.6, 3.4, 2.8))
        elbow, wrist = arm_ik(s, w, 6.8, 6.4, Vector((side * 0.6, -0.2, -1.0)))
        for piece, a, b, tm, sc in (('ColUpperArm', s, elbow, 0.5, 1.2), ('ColForearm', elbow, wrist, 0.5, 1.25),
                                    ('ColFist', elbow, wrist, 1.18, 1.45)):
            c = a + (b - a) * tm
            o = place(piece, body(c.x, c.y, c.z), scale=(sc, sc, sc))
            axis = (body(a.x, a.y, a.z) - body(b.x, b.y, b.z)).normalized()
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = axis.to_track_quat('Z', 'Y')
    for i in range(6):
        a = i / 6 * math.tau
        place(('ColShardA', 'ColShardB', 'ColShardC')[i % 3], body(math.sin(a) * 4.6, 3.2 + 0.6 * math.sin(i * 1.7),
                                                                   math.cos(a) * 4.6 - 0.3),
              rz=i * 1.3, scale=(1.0, 1.0, 1.0), tilt=(0.4 * i, 0.2))
    for j in range(4):
        a = -1.1 + j / 3 * 2.2
        place(('ColShardB', 'ColShardC')[j % 2], body(math.sin(a) * 5.4, 15.5 + 1.6 * math.cos(a * 1.3),
                                                     -math.cos(a) * 5.4 - 1.2), rz=j * 2.1, tilt=(0.3, 0.6 * j))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    out = arg('--out') or HERE
    os.makedirs(out, exist_ok=True)
    parts, materials = build_heart_kit('SmithHeartHeartKit_ROOT', list(BUILDERS))
    preview_materials(materials)
    for o in parts:
        o.hide_render = True
        o.hide_set(True)
    # ---- the platform, the terrace, the bridge, the bed ---------------------------------------
    place('AnvilFloor', (0, 0, 0))
    # Phase 2K: the four quarters, each seam in its light (phase 2L's
    # palette, heart_quarters_core.ts HEART_QUARTER_PALETTE, linear), the
    # ridges' spines and horns, the dais.
    for vein in ('Hammer', 'Breath', 'Quench', 'Heat'):
        tinted_copy(place(f'Quarter{vein}', (0, 0, 0)), materials[1], VEIN_TINT[vein])
    for k in range(4):
        place('HeartRidge', (0, 0, 0), rz=-k * math.pi / 2)
        place('HeartRidgeHorn', (0, 0, 0), rz=-k * math.pi / 2)
    place('HeartDais', (0, 0, 0))
    place('AnvilKeel', (0, 0, 0))
    place('TerraceFloor', TERRACE)
    place('TerraceKeel', TERRACE)
    place('HeartBridge', (TERRACE[0], TERRACE[1], 0.0), rz=-math.pi / 4)
    place('CoreBed', (0, 0, BED_Y), scale=(BED_SCALE, BED_SCALE, BED_SCALE))
    # ---- the altars and their roots (game positions and yaws) ----------------------------------
    for vein, gx, gz in (('Breath', 0, 36), ('Quench', 36, 0), ('Hammer', 0, -36), ('Heat', -36, 0)):
        yaw = math.atan2(-gx, -gz)
        place('Altar' + vein, g2b(gx, 0, gz), rz=yaw, scale=(1.0, 1.0, ALTAR_RISE))
        place('HeartRoot', g2b(gx, ROOT_LIFT, gz), rz=yaw)
    # ---- the body, facing the terrace ----------------------------------------------------------
    colossus(Vector((0, 0, 0)), math.atan2(-49.5, -49.5))
    fig = scale_figure()
    fig.location = (-14, 14, 1.0)
    fig2 = scale_figure().copy()
    bpy.context.scene.collection.objects.link(fig2)
    fig2.location = (TERRACE[0] + 3, TERRACE[1] - 3, 5.0)
    scene = setup_render('', res=(1600, 1000))
    cam = camera('HeartCam', lens=24)
    cam.data.clip_end = 2000
    scene.camera = cam
    look(cam, Vector((-112, 104, 58)), Vector((6, -4, -6)))
    label = arg('--label') or 'fase2l'
    look(cam, Vector((-92, 86, 70)), Vector((4, -4, -4)))
    scene.render.filepath = os.path.join(out, f'blender_sala_cuartos_{label}.png')
    bpy.ops.render.render(write_still=True)
    cam.data.lens = 32
    # A ridge (the Heat and the Breath, ridge 3) and its horn over the lip.
    look(cam, Vector((-4, -10, 7.5)), Vector((-19, -33, 2.5)))
    scene.render.filepath = os.path.join(out, f'blender_cresta_{label}.png')
    bpy.ops.render.render(write_still=True)
    # Leave the review camera on the whole room.
    cam.data.lens = 24
    look(cam, Vector((-112, 104, 58)), Vector((6, -4, -6)))
    if arg('--save'):
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))


if __name__ == '__main__':
    main()
