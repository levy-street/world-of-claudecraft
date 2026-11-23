"""The Gravewyrm Sanctum's interior AAA pass: the second kit.

Run (background, one scene):
  blender -b --factory-startup --python build_gravewyrm_sanctum_interior.py -- \
      --out tmp/asset_src/gravewyrm_sanctum_interior [--pieces A,B] [--renders DIR] [--save out.blend]

Writes <out>/glb_raw/gravewyrm_sanctum_interior.glb (a full build only;
`--pieces` builds a subset for review and writes nothing); the shipping build
(scripts/assets/gravewyrm_sanctum_interior/build.mjs) validates, fingerprints
and meshopts it into public/models/props/gravewyrm_sanctum_interior.glb.

The pieces share the first kit's contract (build_gravewyrm_sanctum_kit.py):
named Kit_*, game yards, +Z up, front -Y (the game's +Z after the glTF
export), origin where the runtime stands it, the three slots KitStone (lit),
KitGlow (the dim runes) and KitGlass (clear ice shells). The runtime bakes
them into the same slot materials as the first kit (src/render/
gravewyrm_sanctum/sanctum_kit.ts), so they cost no new program.

  Kit_LockSpur                 the Lock Terrace's rock pedestal (origin the
                               terrace's centre on its floor)
  Kit_LockCurb                 the terrace's rim kerb (same origin)
  Kit_SealPillarV2_<Tool>      the four seal pillars, and their cracked
  Kit_SealPillarCrackedV2_<T>  variants (origin the base centre, front toward
                               Korgath; drawn at the chains' PILLAR_SCALE)
  Kit_LipRockA..C              lip modules hanging under a walkway's edge
                               (origin on the lip, along local X, drop +Z)
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'entrance'))
import entrance_common as ec  # noqa: E402
import gravewyrm_interior_sculpt as gi  # noqa: E402
import gravewyrm_paths_sculpt as gp  # noqa: E402
import gravewyrm_vault_sculpt as gv  # noqa: E402
import sanctum_gate_sculpt as sg  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


OUT = arg('--out', os.path.join(HERE, 'out_interior'))
ONLY = [p for p in (arg('--pieces', '') or '').split(',') if p]
RENDERS = arg('--renders')
SAVE = arg('--save')
ROOT_NAME = 'GravewyrmSanctumInterior_ROOT'
TOOLS = ('Hammer', 'Tongs', 'Anvil', 'Bellows')
STATS = {}


class Piece:
    """A bmesh with a loop colour layer (authored sRGB, the exporter
    linearises) and per-face material slots."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')

    def finish(self, mats, parent):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in mats:
            mesh.materials.append(m)
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        sg.sharpen(obj, 40.0)
        STATS[self.name] = ec.count_tris([obj])
        return obj


def wanted(name):
    return not ONLY or any(name.startswith(o) for o in ONLY)


def make_materials():
    return [ec.vertex_color_material('KitStone', rough=0.62),
            ec.vertex_color_material('KitGlow', rough=0.85, emission=1.4),
            ec.vertex_color_material('KitGlass', rough=0.08, alpha=0.32)]


# ------------------------------------------------------------------ pieces
def lock_spur():
    rng = np.random.default_rng(2201)
    f = gi.lock_spur_field(rng)
    p = Piece('Kit_LockSpur')
    sg.add_sculpt(p, f, 'LockSpur', 24000, gi.rock_paint(f, 2203), mat=gi.STONE)
    return p


def lock_curb():
    rng = np.random.default_rng(2301)
    f = gi.lock_curb_field(rng)
    p = Piece('Kit_LockCurb')
    sg.add_sculpt(p, f, 'LockCurb', 6000, gi.curb_paint(f), mat=gi.STONE)
    return p


def seal_pillar(tool, cracked):
    rng = np.random.default_rng(2400 + gi.TOOL_GLYPH[tool] * 13)
    f, info = gi.seal_pillar_field(tool, rng, cracked=cracked)
    name = ('Kit_SealPillarCrackedV2_' if cracked else 'Kit_SealPillarV2_') + tool
    p = Piece(name)
    sg.add_sculpt(p, f, name, 6500, gi.pillar_paint(f, cracked, info['frame']), mat=gi.STONE)
    # the rune inlays on the channel floors: dim blue on an intact pillar, dead
    # on a cracked one (the lit slot only while the seal holds)
    fr = info['frame']
    quads = []
    for st in info['strokes']:
        quads += sg.inlay_quads(fr, st, 0.075, -0.04)
    facing = tuple(float(v) for v in fr.W)
    if cracked:
        sg.add_quads(p, quads, gi.RUNE_DEAD, gi.STONE, facing=facing)
    else:
        sg.add_quads(p, quads, gi.RUNE, gi.GLOW, facing=facing)
    return p


def thaw_pyre_v2():
    """The Ritual Vault's thaw pyre (origin the pool's centre on the vault
    floor): the rim, the pyre and its tithe, three standards on the rim."""
    rng = np.random.default_rng(3001)
    p = Piece('Kit_ThawPyreV2')
    rim = gv.pyre_rim_field(rng)
    sg.add_sculpt(p, rim, 'PyreRim', 3200, gv.vault_paint(rim), mat=gi.STONE)
    core = gv.pyre_core_field(rng)
    sg.add_sculpt(p, core, 'PyreCore', 5200, gv.vault_paint(core), mat=gi.STONE)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5
        ban = gv.banner_field(rng, 1 if k % 2 else -1)
        before = set(p.bm.verts)
        sg.add_sculpt(p, ban, 'PyreBanner%d' % k, 1300, gv.vault_paint(ban), mat=gi.STONE)
        # stand the standard on the rim, its banner's face toward the centre
        x, y = math.cos(a) * 7.7, math.sin(a) * 7.7
        yaw = math.atan2(-y, -x) - math.pi / 2
        c, sn = math.cos(yaw), math.sin(yaw)
        for v in p.bm.verts:
            if v in before:
                continue
            vx, vy = v.co.x, v.co.y
            v.co.x = x + vx * c - vy * sn
            v.co.y = y + vx * sn + vy * c
    return p


def lip_ice(variant):
    rng = np.random.default_rng(2600 + variant * 11)
    f = gv.lip_ice_field(variant, rng)
    p = Piece('Kit_LipIce' + 'AB'[variant])
    sg.add_sculpt(p, f, 'LipIce%d' % variant, 1500, gv.ice_paint(f, 2610 + variant), mat=gi.STONE)
    return p


def bone_heap():
    rng = np.random.default_rng(2701)
    f = gv.bone_heap_field(rng)
    p = Piece('Kit_BoneHeap')
    sg.add_sculpt(p, f, 'BoneHeap', 2400, gv.vault_paint(f), mat=gi.STONE)
    return p


def edge_rubble(variant, icy):
    rng = np.random.default_rng(4000 + variant * 13 + (7 if icy else 0))
    f = gp.edge_rubble_field(variant, rng, icy)
    name = ('Kit_EdgeRubbleIce' if icy else 'Kit_EdgeRubble') + 'AB'[variant]
    p = Piece(name)
    sg.add_sculpt(p, f, name, 1000, gp.path_paint(f, 4050 + variant, icy), mat=gi.STONE)
    return p


def drift(variant):
    rng = np.random.default_rng(4300 + variant * 17)
    f = gp.drift_field(variant, rng)
    p = Piece('Kit_Drift' + 'AB'[variant])
    sg.add_sculpt(p, f, 'Drift%d' % variant, 700, gp.path_paint(f, 4350 + variant, True), mat=gi.STONE)
    return p


def lip_rock(variant):
    rng = np.random.default_rng(2500 + variant * 7)
    f = gi.lip_rock_field(variant, rng)
    p = Piece('Kit_LipRock' + 'ABC'[variant])
    sg.add_sculpt(p, f, 'LipRock%d' % variant, 1500, gi.rock_paint(f, 2510 + variant), mat=gi.STONE)
    return p


# ------------------------------------------------------------------ review renders
def preview_scene(objs, mats):
    """The Lock Terrace laid out as in game (the floor disc, the pillars at
    the chains' scale on the diagonals, two knights for scale) beside the
    exported pieces, in a 'Review' collection that never ships."""
    coll = bpy.data.collections.new('Review')
    bpy.context.scene.collection.children.link(coll)

    def link(o):
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)

    # the terrace floor (slate, the walked disc)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=22.0, depth=0.6, location=(0, 0, -0.3))
    floor = bpy.context.active_object
    floor.name = 'Review_TerraceFloor'
    fm = bpy.data.materials.new('ReviewSlate')
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.11, 0.13, 0.17, 1)
    fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    floor.data.materials.append(fm)
    link(floor)
    by = {o.name: o for o in objs}
    if 'Kit_LockSpur' in by:
        pass
    for i, tool in enumerate(TOOLS):
        src = by.get('Kit_SealPillarV2_' + tool) or by.get('Kit_SealPillarCrackedV2_' + tool)
        if src is None:
            continue
        ux = -math.sqrt(0.5) if i in (0, 3) else math.sqrt(0.5)
        uz = math.sqrt(0.5) if i in (0, 1) else -math.sqrt(0.5)
        inst = bpy.data.objects.new('Review_Pillar_' + tool, src.data)
        inst.location = gi.G(ux * 18, uz * 18, 0.0)
        inst.scale = (0.82, 0.82, 0.82)
        # front (game +lz, Blender -Y) toward the centre
        yaw = math.atan2(-ux, -uz)
        inst.rotation_euler = (0, 0, yaw)
        coll.objects.link(inst)
    old = bpy.data.objects
    ec.import_knight(type('GR', (), {'walk': staticmethod(lambda x, z: 0.0)})(), 0.0, -6.0, yaw_deg=0, name='Knight_Terrace')
    ec.import_knight(type('GR', (), {'walk': staticmethod(lambda x, z: 0.0)})(), -15.0, 12.0, yaw_deg=30,
                     name='Knight_Pillar')
    for o in list(old):
        if o.name.startswith('Knight'):
            pass
    return coll


def renders(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    ec.setup_eevee(res=(1600, 900), samples=32)
    ec.setup_world('dusk', strength=0.9, sun_dir=(0.35, 0.55, 0.55), sun_strength=3.2, sun_color=(0.82, 0.88, 1.0))
    shots = {
        'terraza_desde_seracs': ((-62.0, 40.0, 38.0), (0.0, 0.0, -8.0), 30),
        'terraza_tres_cuartos': ((38.0, 48.0, 22.0), (0.0, 0.0, -4.0), 32),
        'pedestal_desde_abajo': ((0.0, 70.0, -22.0), (0.0, 0.0, -14.0), 30),
        'pilar_cerca': ((-6.0, -2.0, 6.0), (-12.7, -12.7, 6.0), 30),
        'borde_y_bordillo': ((10.0, 4.0, 3.5), (18.0, 12.0, -1.5), 26),
    }
    for name, (loc, target, lens) in shots.items():
        cam = ec.add_camera('Cam_' + name, Vector(loc), Vector(target), lens=lens)
        ec.render(cam, os.path.join(out_dir, name + '.png'))


def studio(objs, out_dir):
    """Each piece alone, framed from its front three-quarter with a knight
    (2.6 yd) beside it for scale."""
    os.makedirs(out_dir, exist_ok=True)
    ec.setup_eevee(res=(1400, 1000), samples=32)
    ec.setup_world('dusk', strength=1.0, sun_dir=(0.45, -0.6, 0.6), sun_strength=3.0, sun_color=(0.85, 0.9, 1.0))
    gr = type('GR', (), {'walk': staticmethod(lambda x, z: 0.0)})()
    for o in objs:
        for other in objs:
            other.hide_render = other is not o
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        c = (lo + hi) / 2
        size = max((hi - lo).length, 3.0)
        k = ec.import_knight(gr, (hi.x + 1.2), -(lo.y - 1.5), yaw_deg=20, name='Knight_' + o.name)
        k.location.z = max(0.0, lo.z) if lo.z > -1 else 0.0
        for (tag, d) in (('frente', Vector((0.55, -1.0, 0.42))), ('lado', Vector((-1.0, -0.35, 0.3)))):
            d.normalize()
            cam = ec.add_camera('Cam_%s_%s' % (o.name, tag), c + d * size * 1.25, c, lens=35)
            ec.render(cam, os.path.join(out_dir, '%s_%s.png' % (o.name, tag)))
        bpy.data.objects.remove(k, do_unlink=True)
    for other in objs:
        other.hide_render = False


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    root = bpy.data.objects.new(ROOT_NAME, None)
    bpy.context.scene.collection.objects.link(root)
    builders = [('Kit_LockSpur', lock_spur), ('Kit_LockCurb', lock_curb)]
    for tool in TOOLS:
        builders.append(('Kit_SealPillarV2_' + tool, lambda t=tool: seal_pillar(t, False)))
        builders.append(('Kit_SealPillarCrackedV2_' + tool, lambda t=tool: seal_pillar(t, True)))
    for v in range(3):
        builders.append(('Kit_LipRock' + 'ABC'[v], lambda v=v: lip_rock(v)))
    builders.append(('Kit_ThawPyreV2', thaw_pyre_v2))
    for v in range(2):
        builders.append(('Kit_LipIce' + 'AB'[v], lambda v=v: lip_ice(v)))
    builders.append(('Kit_BoneHeap', bone_heap))
    for v in range(2):
        builders.append(('Kit_EdgeRubble' + 'AB'[v], lambda v=v: edge_rubble(v, False)))
        builders.append(('Kit_EdgeRubbleIce' + 'AB'[v], lambda v=v: edge_rubble(v, True)))
        builders.append(('Kit_Drift' + 'AB'[v], lambda v=v: drift(v)))
    objs = []
    for name, build in builders:
        if not wanted(name):
            continue
        print('BUILD', name, flush=True)
        objs.append(build().finish(mats, root))
    print('STATS', json.dumps(STATS), flush=True)
    os.makedirs(OUT, exist_ok=True)
    if not ONLY:
        raw = os.path.join(OUT, 'glb_raw')
        os.makedirs(raw, exist_ok=True)
        ec.export_glb([root] + objs, os.path.join(raw, 'gravewyrm_sanctum_interior.glb'))
        json.dump({'tris': STATS, 'total': sum(STATS.values())}, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
    if RENDERS:
        studio(objs, RENDERS)
    if arg('--scene'):
        preview_scene(objs, mats)
        renders(arg('--scene'))
    if SAVE:
        bpy.ops.wm.save_as_mainfile(filepath=SAVE)


if __name__ == '__main__':
    main()
