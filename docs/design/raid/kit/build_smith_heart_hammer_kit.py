"""The Smith's Heart raid's Hammer vein kit: the Cleft, the Hammer Gallery,
the Smith's Quarry, the Slab and the Balcony lookout.

Run (background, one scene):
  blender -b --factory-startup --python build_smith_heart_hammer_kit.py -- \
      [--preview out.png] [--closeups DIR] [--pieces A,B] [--save out.blend]

Writes smith_heart_hammer_kit_components.glb next to this file (a full build
only; `--pieces` builds a subset for review renders and writes nothing); the
shipping build (scripts/assets/smith_heart_hammer_kit/build.mjs) validates,
fingerprints and meshopts it into public/models/props/smith_heart_hammer_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name,
src/render/smith_heart/heart_kit.ts). Game yards, +Z up, front -Y (the game's
+Z after the glTF export), origin at the base centre where the runtime stands
it, on three material slots: KitStone (lit: rock, the carving, timber,
bronze, iron, rope), KitGlow (emissive: the Hammer's ochre vein light, the
geodes, the runes), KitGlass (unused by this kit, kept for the slot set).
Edge pieces run along X with their OUTER (drop) side toward -Y.

Exceptions to "origin at the base centre", by design:
  - Kit_QuarryFaceA to C: origin on the lip (z 0), the face drops 7 yd to
    -7 toward -Y, its body behind the lip (+Y);
  - Kit_WalkCurbA, B and Kit_WalkRail: origin on the walk's lip, the drop
    toward -Y (walk_pieces.py);
  - Kit_SlabHalfL and R: both in the shut slab's frame (its base centre), so
    the gate painter moves them from one origin;
  - Kit_SlabChunkA to C: origin at the chunk's middle (the runtime tumbles it);
  - Kit_ChainHoist: origin where its beam meets the rock;
  - Kit_CollapseOverhang: origin on the gallery rim under the overhang's lip.

Palette (docs/design/raid/smith_heart.md, section 1): the Hammer's ochre
#C8903C as LIGHT (the seams, the geodes), warm ochre granite, the Smith's
bronze, sun-greyed timber, the masons' red ochre. Decoration never out-glows
a telegraph: the vein light is a deep amber, the geodes' hearts small.

Weathering is per vertex and per face kind (shkit.SPiece.finish); the
colossi and the rough statues are SDF sculpts (hammer_sculpt.py).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shkit  # noqa: E402,F401  (puts the shared dungeon kit on the path)
import hammer_pieces as hp  # noqa: E402
import hammer_sculpt as hs  # noqa: E402
import walk_pieces as wp  # noqa: E402
from hckit import export_kit  # noqa: E402
from shkit import PAINT, SP, TAU  # noqa: E402


# ===================================================================== the colossi
def colossus_vigil():
    p = SP('ColossusVigil', seed=71, ao_dist=4.0)
    return hs.colossus_vigil(bpy, p)


def colossus_waking():
    p = SP('ColossusWaking', seed=73, ao_dist=4.0)
    return hs.colossus_waking(bpy, p)


def colossus_bearer():
    p = SP('ColossusBearer', seed=79, ao_dist=4.0)
    return hs.colossus_bearer(bpy, p)


# ===================================================================== the Gallery
def amber_crystal(p, base, direction, h, r, core=True):
    """One geode crystal: a six-sided prism with a pointed tip, amber and lit
    (it shades by its facets), a small glowing heart inside its root and a
    pale glowing tip (the glow slot: never a light)."""
    from gwkit import hull
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    b = Vector(base)
    pts = []
    for (t, rr) in ((0.0, 1.0), (0.72, 0.9)):
        for k in range(6):
            a = TAU * k / 6 + p.rng.uniform(-0.12, 0.12)
            pts.append(b + d * (h * t) + (side * math.cos(a) + up * math.sin(a)) * r * rr)
    pts.append(b + d * h)
    with p.as_kind(PAINT):
        hull(p, pts, p.vary(shkit.GEODE_BODY, 0.08))
        if core:
            tip = [b + d * (h * 0.78) + (side * math.cos(TAU * k / 6) + up * math.sin(TAU * k / 6)) * r * 0.55
                   for k in range(6)] + [b + d * (h * 1.015)]
            hull(p, tip, shkit.GEODE_TIP, mat=shkit.GLOW)
            root = [b + d * (h * 0.05) + (side * math.cos(TAU * k / 5) + up * math.sin(TAU * k / 5)) * r * 0.6
                    for k in range(5)] + [b + d * (h * 0.45)]
            hull(p, root, shkit.GEODE_HEART, mat=shkit.GLOW)


def geode(variant):
    p = SP('Geode' + variant, seed=107 + ord(variant), ao_dist=1.2)
    hs.geode_rock(bpy, p, variant)
    rng = p.rng
    if variant == 'A':
        spots = [((0.0, 0.3, 0.6), (0.1, -0.3, 1.0), 2.0, 0.34), ((-0.8, 0.5, 0.7), (-0.5, -0.3, 1.0), 1.6, 0.28),
                 ((0.8, 0.4, 0.7), (0.5, -0.4, 1.0), 1.7, 0.3), ((-0.3, 0.9, 0.9), (-0.1, -0.1, 1.0), 1.3, 0.24),
                 ((0.4, -0.2, 0.5), (0.2, -0.8, 0.7), 1.2, 0.22), ((-0.6, -0.1, 0.5), (-0.4, -0.8, 0.6), 1.1, 0.2),
                 ((0.2, 0.9, 1.1), (0.0, 0.2, 1.0), 1.0, 0.18)]
    else:
        spots = [((0.0, 0.0, 1.0), (0.1, -0.1, 1.0), 2.8, 0.42), ((-0.6, 0.1, 1.0), (-0.5, 0.0, 1.0), 2.2, 0.34),
                 ((0.7, -0.1, 1.0), (0.6, -0.2, 1.0), 2.0, 0.32), ((-1.1, -0.2, 0.9), (-0.9, -0.5, 0.8), 1.4, 0.24),
                 ((1.1, 0.2, 0.9), (0.8, 0.3, 0.9), 1.5, 0.26), ((0.3, 0.3, 1.0), (0.2, 0.6, 1.0), 1.7, 0.28)]
    for (b, d, h, r) in spots:
        amber_crystal(p, b, d, h * rng.uniform(0.9, 1.1), r)
    return p


def rough_statue(variant):
    p = SP('RoughStatue' + variant, seed=83 + ord(variant), marks=True, ao_dist=2.0)
    hs.rough_statue(bpy, p, variant)
    # Two scaffold poles and a plank against him, the masons' tools on it.
    from hammer_pieces import pole, rope
    pole(p, (-2.6, 1.2, 0), (-2.4, 1.1, 9.6), 0.11)
    pole(p, (2.6, 1.2, 0), (2.4, 1.1, 9.6), 0.11)
    pole(p, (-2.8, 1.1, 6.2), (2.8, 1.1, 6.2), 0.09)
    rope(p, (-2.4, 1.1, 9.4), (2.4, 1.1, 9.4), 0.05, sag=0.5)
    return p


def lookout_statue():
    p = SP('LookoutStatue', seed=89, ao_dist=1.6)
    return hs.lookout_statue(bpy, p)


def cleft_gate():
    """The Cleft's gate (hammer_sculpt.cleft_gate), lit for the raid's first
    image (phase 2C): two braziers of the Smith's flanking the doorway's
    steps, and clusters of the vein's amber crystals breaking out of the
    flanks' foot either side of the landing, glowing."""
    p = SP('CleftGate', seed=97, ao_dist=6.0, dust=0.8)
    hs.cleft_gate(bpy, p)
    for s in (-1, 1):
        hp.brazier(p, (s * 6.4, -5.0, 0.0))
    rng = p.rng
    for (cx, cy, cz, n) in ((-10.5, -3.6, 0.2, 6), (11.5, -2.8, 0.4, 7), (-14.5, -1.2, 1.5, 4), (15.8, -0.4, 2.2, 4)):
        for k in range(n):
            a = rng.uniform(0, TAU)
            d = Vector((math.cos(a) * 0.5, -0.6 - rng.uniform(0, 0.4), 1.0)).normalized()
            base = (cx + math.cos(a) * rng.uniform(0, 0.9), cy + math.sin(a) * rng.uniform(0, 0.5), cz)
            amber_crystal(p, base, d, rng.uniform(0.9, 2.2), rng.uniform(0.16, 0.32))
    return p


def collapse_overhang():
    """The rock (hammer_sculpt.collapse_overhang), then the masons' work on
    it: iron straps pinned across the crack, two chains run back to rings in
    the mountain, red-ochre warning chevrons cut on its face."""
    from gwkit import chain_run, rivets
    p = SP('CollapseOverhang', seed=101, ao_dist=5.0, marks=True)
    hs.collapse_overhang(bpy, p)
    with p.as_kind(shkit.METAL):
        for x in (-8.0, -1.0, 6.0):
            p.box((x, 6.6, 8.5), (0.6, 4.6, 0.3), shkit.IRON_DARK, pitch=0.3, bevel=0.04)
            rivets(p, [(x, y, 8.5 + (y - 6.6) * 0.3) for y in (4.6, 6.6, 8.6)], 0.14, color=shkit.IRON)
    for x in (-5.0, 4.0):
        chain_run(p, (x, 0.5, 15.5), (x * 1.2, 13.0, 19.0), 0.8, 0.36, 0.1, color=(0.25, 0.235, 0.22), sag=0.6)
    with p.as_kind(shkit.PAINT):
        for k in range(3):
            x = -4.0 + k * 3.5
            for s in (-1, 1):
                p.box((x + s * 0.45, -6.7, 11.4), (1.2, 0.08, 0.22), shkit.MASON_RED, roll=s * 0.75)
    return p


# ===================================================================== registry
BUILDERS = {
    'ColossusVigil': colossus_vigil,
    'ColossusWaking': colossus_waking,
    'ColossusBearer': colossus_bearer,
    # The quarry.
    'PitColumn': hp.pit_column,
    'PitColumnSocket': hp.pit_column_socket,
    'CutBlockA': lambda: hp.cut_block('A'),
    'CutBlockB': lambda: hp.cut_block('B'),
    'Derrick': hp.derrick,
    'Scaffold': hp.scaffold,
    'ChainHoist': hp.chain_hoist,
    'QuarryFaceA': lambda: hp.quarry_face('A'),
    'QuarryFaceB': lambda: hp.quarry_face('B'),
    'QuarryFaceC': lambda: hp.quarry_face('C'),
    'QuarryRimA': lambda: hp.quarry_rim('A'),
    'QuarryRimB': lambda: hp.quarry_rim('B'),
    'GreatCliffA': lambda: hp.great_cliff('A'),
    'GreatCliffB': lambda: hp.great_cliff('B'),
    'GreatCliffC': lambda: hp.great_cliff('C'),
    'RubblePile': hp.rubble_pile,
    'ChipScatter': hp.chip_scatter,
    'FloorCrackA': lambda: hp.floor_crack('A'),
    'FloorCrackB': lambda: hp.floor_crack('B'),
    # The Cleft and the Gallery.
    'CleftGate': cleft_gate,
    'RoughStatueA': lambda: rough_statue('A'),
    'RoughStatueB': lambda: rough_statue('B'),
    'GeodeA': lambda: geode('A'),
    'GeodeB': lambda: geode('B'),
    'CollapseOverhang': collapse_overhang,
    'LookoutStatue': lookout_statue,
    # The Gallery's walk (phase 2E).
    'WalkCurbA': lambda: wp.walk_curb('A'),
    'WalkCurbB': lambda: wp.walk_curb('B'),
    'WalkRail': wp.walk_rail,
    'FallenBlockA': lambda: wp.fallen_block('A'),
    'FallenBlockB': lambda: wp.fallen_block('B'),
    # The Slab.
    'SlabFrame': hp.slab_frame,
    'SlabHalfL': lambda: hp.slab_half(-1),
    'SlabHalfR': lambda: hp.slab_half(1),
    'SlabChunkA': lambda: hp.slab_chunk('A'),
    'SlabChunkB': lambda: hp.slab_chunk('B'),
    'SlabChunkC': lambda: hp.slab_chunk('C'),
}


# ===================================================================== build
def build_hammer_kit(root_name, names):
    """The kit's three slots (stone, glow, glass), every named piece under one
    root, a triangle report per piece."""
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
    for n in names:
        obj = BUILDERS[n]().finish(materials, root)
        parts.append(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        tris = len(mesh.loop_triangles)
        total += tris
        bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = [round(min(v[i] for v in bb), 1) for i in range(3)]
        hi = [round(max(v[i] for v in bb), 1) for i in range(3)]
        print(f'PIECE {obj.name} triangles {tris} min {lo} max {hi}')
    print('KIT_TRIANGLES', total)
    return parts, materials


# ==================================================================== review
def preview_materials(materials):
    """Swap the export materials' nodes for review renders: glow emissive as
    the runtime draws it (unlit), stone lit."""
    _stone, glow, _glass = materials
    nt = glow.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col.outputs['Color'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 2.2
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])


def setup_render(path, res=(1400, 1000)):
    """EEVEE with the Hammer's intended light: a warm low key from the
    south-west (the dusk through the fissure), a dusty amber sky, a warm rim
    from behind."""
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
    world = bpy.data.worlds.get('Quarry') or bpy.data.worlds.new('Quarry')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.42, 0.33, 0.24, 1)
    bg.inputs['Strength'].default_value = 0.45
    scene.world = world
    if not bpy.data.objects.get('KeySun'):
        sun = bpy.data.objects.new('KeySun', bpy.data.lights.new('KeySun', 'SUN'))
        sun.data.energy = 3.4
        sun.data.color = (1.0, 0.86, 0.66)
        sun.rotation_euler = (math.radians(58), 0, math.radians(-50))
        scene.collection.objects.link(sun)
        rim = bpy.data.objects.new('RimSun', bpy.data.lights.new('RimSun', 'SUN'))
        rim.data.energy = 2.0
        rim.data.color = (1.0, 0.72, 0.4)
        rim.rotation_euler = (math.radians(75), 0, math.radians(160))
        scene.collection.objects.link(rim)
    return scene


def camera(name, lens=40):
    cam = bpy.data.objects.get(name)
    if cam:
        return cam
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_end = 4000
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    return cam


def look(cam, loc, target):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def scale_figure():
    """A 2 yd figure (the player's size) for scale."""
    fig = bpy.data.objects.get('ScaleFigure')
    if fig:
        return fig
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=2.0, location=(0, 0, 1.0))
    fig = [o for o in bpy.context.scene.objects if o.name.startswith('Cylinder')][-1]
    fig.name = 'ScaleFigure'
    mat = bpy.data.materials.new('FigureMat')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 0.25, 0.6, 1)
    fig.data.materials.append(mat)
    return fig


def render_closeups(parts, folder, views=('front',), focus=None):
    """One framed render per piece and view (a 2 yd figure beside it)."""
    os.makedirs(folder, exist_ok=True)
    scene = setup_render('', res=(1100, 1100))
    cam = camera('closeup')
    scene.camera = cam
    figure = scale_figure()
    dirs = {'front': Vector((-0.45, -1.2, 0.35)), 'side': Vector((-1.2, -0.3, 0.3)),
            'low': Vector((-0.3, -1.2, 0.05)), 'pit': Vector((-0.25, -1.0, -0.3)), 'back': Vector((0.6, 1.1, 0.5))}
    for obj in parts:
        for o in parts:
            o.hide_render = o is not obj
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = max(4.0, (hi - lo).length)
        if focus:
            centre, size = Vector(focus[:3]), focus[3]
        figure.location = (lo.x - 1.2, lo.y - 0.6, 1.0 + max(0.0, lo.z))
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

    closeups = arg('--closeups')
    views = (arg('--views') or 'front').split(',')
    save = arg('--save')
    only = arg('--pieces')
    names = list(BUILDERS)
    if only:
        want = only.split(',')
        names = [n for n in names if n in want]
    parts, materials = build_hammer_kit('SmithHeartHammerKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'smith_heart_hammer_kit_components.glb'))
    if closeups:
        preview_materials(materials)
        focus = [float(v) for v in arg('--focus').split(',')] if arg('--focus') else None
        render_closeups(parts, closeups, views, focus)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save)


if __name__ == '__main__':
    main()
