"""The Wyrmwatch harbormaster's sea gear: a naval tricorne with a clay pipe, and a brass spyglass.

  blender --background --python scripts/assets/harbormaster_gear/build_harbormaster_gear.py -- \
      [--preview OUT_DIR] [--save FILE.blend] [--reference DIR]

Writes harbormaster_tricorne_source.glb and harbormaster_spyglass_source.glb beside this file.
`node scripts/assets/harbormaster_gear/build.mjs` ships them (validate, fingerprint, meshopt) to
public/models/chars/npc_gear/, and the harbormaster's composed body wears them as fixed attaches
(the `harbormaster` prop set: src/render/characters/manifest.ts NPC_MODULAR_PROP_ATTACH).

Frames. Each model is authored in the BIND-pose frame of the bone it rides, in the modular body's
own units (public/models/chars/modular/warrior_modular.glb): +y up the bone, +z the way the
character faces, +x the character's LEFT. The game parents the model to that bone with an
identity transform, so these coordinates ARE where the piece sits on her; the body's
normalization scale reaches it through the bone. The numbers below were measured off the body
with extract_reference.mjs (its printed bounds; the head is about 0.91 wide and 0.83 tall, the
warriorbraid crest peaks 0.94 over the head bone) and are constants here, so an export never
depends on anything outside this directory and shiplib.

  HarbormasterTricorne_ROOT   head bone
    Tricorne                  navy felt, three sides cocked up, brass lace on the rims, a black
                              ribbon cockade with a brass anchor on the left front side
    Pipe                      a short briar pipe in the right corner of her mouth
  HarbormasterSpyglass_ROOT   hips bone
    Spyglass                  a collapsed brass spyglass in a leather sleeve, hung from the coat
                              belt on her left hip by a leather frog

Everything is original procedural work for this project, vertex coloured and texture free. The
palette is the ferry's (scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py PAL): its brass,
its dark warm wood, and the navy the harbor house and the route marker already carry.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_ferry'))
sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from shiplib import EDGE, FLAT, P, Piece, empty, rot_matrix, scale_color, triangles  # noqa: E402

# material slots (shiplib paints by index)
FELT, BRASS, LEATHER, WOODM = 0, 1, 2, 3
MATERIAL_SPECS = (
    # name, roughness, metallic
    ('GearFelt', 0.95, 0.0),
    ('GearBrass', 0.38, 0.75),
    ('GearLeather', 0.72, 0.0),
    ('GearWood', 0.6, 0.0),
)

PAL = dict(
    navy=(0.17, 0.23, 0.42),
    navy_hi=(0.22, 0.29, 0.5),
    navy_dark=(0.11, 0.15, 0.28),
    ribbon=(0.08, 0.08, 0.1),
    brass=(0.82, 0.63, 0.32),
    brass_hi=(0.93, 0.78, 0.46),
    brass_dark=(0.6, 0.43, 0.2),
    leather=(0.34, 0.2, 0.12),
    leather_dark=(0.24, 0.14, 0.08),
    briar=(0.62, 0.36, 0.18),
    briar_dark=(0.42, 0.24, 0.11),
    stem=(0.12, 0.1, 0.09),
    ash=(0.3, 0.27, 0.25),
    glass=(0.55, 0.66, 0.72),
)

# ---------------------------------------------------------------------------
# The tricorne (head bone frame)
# ---------------------------------------------------------------------------
Y0 = 0.6            # the brim's floor at the crown, just clear of her brows
CROWN_CZ = -0.03    # the crown sits a touch back, over the braid's root
CROWN_RX, CROWN_RZ = 0.48, 0.54
# (height over the head bone, radius factor): the crown clears the warriorbraid crest (0.94)
CROWN_PROFILE = ((Y0 - 0.015, 1.0), (0.7, 0.985), (0.81, 0.95), (0.9, 0.88), (0.96, 0.75),
                 (1.0, 0.54), (1.022, 0.27))
CROWN_TOP = 1.03
BAND_TOP = 0.69     # the ribbon band round the crown's foot
BRIM_RI = 0.53      # the fold line's distance at the middle of each cocked side
BRIM_POW = 0.8      # how far the corners stretch (the fold line is Ri / cos(d)^pow)
WALL_H = 0.37       # the cocked side's height at its middle
WALL_HC = 0.13      # ...and at the corners, where two sides meet in a point
WALL_LEAN = 0.05    # the sides lean out this far at the rim
FELT_T = 0.035
LACE = 0.045        # the brass lace band's depth down the outside of each rim
THETA_STEPS = 60    # samples round the hat (a multiple of 6 lands a sample on every corner)
TILT_DEG = 6.0      # worn tipped back, the front point lifted clear of the brows
TILT_PIVOT = (0.0, 0.45, 0.0)
COCKADE_THETA = 60.0  # the cockade sits on the left front side (+x is her left)


def side_delta(theta_deg):
    """Degrees from the nearest cocked side's middle (the sides face 60, 180 and 300 degrees,
    theta 0 being the front point); 60 at a corner."""
    t = theta_deg % 120.0
    return abs(t - 60.0)


def fold_radius(theta_deg):
    return BRIM_RI / math.cos(math.radians(side_delta(theta_deg))) ** BRIM_POW


def wall_height(theta_deg):
    d = side_delta(theta_deg)
    return WALL_HC + (WALL_H - WALL_HC) * math.cos(math.radians(d * 1.5))


def around(theta_deg, r, y):
    """A point at `r` from the crown axis toward theta (0 = +z, 90 = +x)."""
    a = math.radians(theta_deg)
    return (math.sin(a) * r, y, CROWN_CZ + math.cos(a) * r)


def crown_radius(theta_deg, k):
    a = math.radians(theta_deg)
    # an ellipse: rx across, rz front to back
    rx, rz = CROWN_RX * k, CROWN_RZ * k
    return 1.0 / math.sqrt((math.sin(a) / rx) ** 2 + (math.cos(a) / rz) ** 2)


def build_tricorne():
    p = Piece('Tricorne', wear=0.05, gradient=0.12)
    mark = p.mark()
    thetas = [360.0 * j / THETA_STEPS for j in range(THETA_STEPS + 1)]

    # the brim: one closed felt profile swept round the hat. Per theta: the underside from the
    # crown out to the fold, up the outside of the cocked side to the rim, over the rim, and
    # back down the inside to the crown.
    def profile(th):
        rc = crown_radius(th, 1.0)
        rf = fold_radius(th)
        h = wall_height(th)
        top = rf + WALL_LEAN
        return [
            around(th, rc - 0.01, Y0 - 0.004),                       # 0 underside at the crown
            around(th, rf + FELT_T * 0.6, Y0 - 0.014),               # 1 underside at the fold
            around(th, top + FELT_T - WALL_LEAN * LACE / h, Y0 + h - LACE),  # 2 lace starts
            around(th, top + FELT_T, Y0 + h),                        # 3 rim, outside
            around(th, top, Y0 + h + 0.006),                         # 4 rim, inside
            around(th, rf - FELT_T * 0.4, Y0 + FELT_T),              # 5 inside at the fold
            around(th, rc - 0.01, Y0 + FELT_T * 0.6),                # 6 brim top at the crown
            around(th, rc - 0.01, Y0 - 0.004),                       # 7 closes onto 0
        ]

    cols = [profile(th) for th in thetas]
    rows = [[cols[j][i] for j in range(len(thetas))] for i in range(len(cols[0]))]

    def brim_color(i, j):
        if i in (2, 3):
            return (PAL['brass_hi'] if i == 3 else PAL['brass'], BRASS)
        if i == 1:
            return (PAL['navy_hi'], FELT)
        if i == 0 or i == 6:
            return (PAL['navy_dark'], FELT)
        return (PAL['navy'], FELT)

    # a closed felt tube: finish() orients it outward along with everything else closed
    p.closed.extend(p.surface(rows, brim_color, mat=FELT))

    # the crown: a soft dome over the head and the braid's crest, a black ribbon band at its foot
    rings = []
    for y, k in CROWN_PROFILE:
        rings.append([around(th, crown_radius(th, k), y) for th in thetas[:-1]])
    band_rows = sum(1 for y, _ in CROWN_PROFILE if y < BAND_TOP)

    def crown_color(i, _k):
        if i < band_rows:
            return PAL['ribbon']
        return PAL['navy'] if i < len(CROWN_PROFILE) - 3 else PAL['navy_hi']

    # capped underneath (hidden by the head) so the crown is a closed shell: finish() can
    # only orient a closed shell's faces outward reliably, and an inside-out dome is culled
    p.loft(rings, crown_color, mat=FELT, cap0=True, cap1=False)
    # the crown's top: a fan to the apex
    top = p.bm.verts.new(P(0.0, CROWN_TOP, CROWN_CZ))
    last = [p.bm.verts.new(P(*q)) for q in rings[-1]]
    n = len(last)
    fan = []
    for k in range(n):
        f = p.bm.faces.new((last[k], last[(k + 1) % n], top))
        f[p.soft] = 1
        fan.append(f)
    p.paint(fan, PAL['navy_hi'], FELT)
    p.closed.extend(fan)
    bmesh.ops.remove_doubles(p.bm, verts=list(p.bm.verts), dist=1e-5)

    build_cockade(p)
    # worn tipped back about the head's middle, front point up
    pivot = P(*TILT_PIVOT)
    tilt = (Matrix.Translation(pivot) @ rot_matrix(pitch=-math.radians(TILT_DEG))
            @ Matrix.Translation(-pivot))
    p.turn(mark - 1, tilt)
    return p


def build_cockade(p):
    """A pleated black ribbon rosette with a brass anchor, on the left front side."""
    mark = p.mark()
    r = 0.1
    # the rosette, built facing +z at the origin: a ring of pleats round a disc
    p.cylinder((0, 0, -0.012), (0, 0, 0.012), r * 0.7, PAL['ribbon'], FELT, sides=12, soft=False)
    for k in range(10):
        a = math.tau * k / 10
        c = (math.sin(a) * r * 0.72, math.cos(a) * r * 0.72, 0.004)
        p.box(c, (0.06, 0.05, 0.022), scale_color(PAL['ribbon'], 1.35 if k % 2 else 1.0), FELT,
              yaw=0.0, roll=-a)
    # the anchor: shank, stock, ring and a curved arm with flukes, brass, standing proud
    z0 = 0.016
    zc = z0 + 0.012
    p.box((0, -0.004, zc), (0.018, 0.1, 0.022), PAL['brass'], BRASS)
    p.box((0, 0.034, zc), (0.07, 0.016, 0.022), PAL['brass_hi'], BRASS)
    p.ring((0, 0.058, zc), 0.014, 0.012, PAL['brass'], segments=8, axis=(0, 0, 1), mat=BRASS,
           depth=0.02)
    arc = []
    for k in range(9):
        a = math.radians(200 + 140 * k / 8)
        arc.append((math.cos(a) * 0.05, -0.014 + math.sin(a) * 0.05, zc))
    p.beam(arc, 0.016, 0.022, PAL['brass'], BRASS, up=(0, 0, 1))
    for end in (arc[0], arc[-1]):
        p.box(end, (0.026, 0.026, 0.022), PAL['brass_hi'], BRASS, taper=0.4, roll=math.radians(45))
    # stand it on the side: yaw to the side's middle, lean with the felt, lift to mid height
    th = COCKADE_THETA
    rf = fold_radius(th)
    h = wall_height(th)
    lean = math.atan2(WALL_LEAN, h)
    at = around(th, rf + WALL_LEAN * 0.55 + FELT_T + 0.004, Y0 + h * 0.52)
    place = (Matrix.Translation(P(*at)) @ rot_matrix(yaw=math.radians(th))
             @ rot_matrix(pitch=lean))
    p.turn(mark, place)


# ---------------------------------------------------------------------------
# The pipe (head bone frame): stem in the right corner of her mouth, bowl forward and down
# ---------------------------------------------------------------------------
MOUTH = (-0.1, 0.165, 0.405)     # the stem's end, just inside her lips (the mouth is at z 0.43)
BOWL = (-0.2, 0.07, 0.64)        # the bowl's foot


def build_pipe():
    p = Piece('Pipe', wear=0.05, gradient=0.1)
    # the stem: dark vulcanite, a gentle bend down and out
    stem = [MOUTH, (-0.13, 0.14, 0.5), (-0.17, 0.1, 0.58), (BOWL[0] + 0.012, BOWL[1] + 0.03, BOWL[2] - 0.02)]
    p.sweep(stem, 0.016, 0.022, PAL['stem'], sides=6, mat=WOODM)
    # a brass band where the stem meets the shank
    p.cylinder((-0.155, 0.112, 0.555), (-0.168, 0.1, 0.578), 0.027, PAL['brass'], BRASS, sides=8)
    # the briar bowl, a little barrel, and the ash in it
    base = Vector(BOWL)
    p.cylinder(tuple(base), tuple(base + Vector((0, 0.12, 0.01))), 0.05, PAL['briar'], WOODM,
               sides=10, r1=0.056, soft=True)
    p.cylinder(tuple(base + Vector((0, -0.012, 0))), tuple(base), 0.036, PAL['briar_dark'], WOODM,
               sides=10, r1=0.05, soft=True)
    p.cylinder(tuple(base + Vector((0, 0.106, 0.009))), tuple(base + Vector((0, 0.122, 0.01))), 0.043,
               PAL['ash'], WOODM, sides=10, soft=False)
    return p


# ---------------------------------------------------------------------------
# The spyglass (hips bone frame): on her left hip, hung from the coat belt, clear of the skirt
# ---------------------------------------------------------------------------
GLASS_TOP = Vector((0.43, 0.27, 0.13))     # the eyepiece end, up by the belt
GLASS_BOTTOM = Vector((0.555, -0.16, 0.2))  # the objective end, out past the flared skirt
BELT_HOOK = Vector((0.36, 0.33, 0.11))     # where the frog loops over the coat belt


def build_spyglass():
    p = Piece('Spyglass', wear=0.05, gradient=0.08)
    axis = (GLASS_BOTTOM - GLASS_TOP).normalized()
    length = (GLASS_BOTTOM - GLASS_TOP).length

    def at(t):
        return GLASS_TOP + axis * (length * t)

    # eyepiece draw tube (thin brass), then the next draw, then the leather-wrapped barrel
    p.cylinder(tuple(at(0.0)), tuple(at(0.1)), 0.03, PAL['brass'], BRASS, sides=10)
    p.cylinder(tuple(at(-0.015)), tuple(at(0.0)), 0.036, PAL['brass_hi'], BRASS, sides=10)
    p.cylinder(tuple(at(0.1)), tuple(at(0.22)), 0.04, PAL['brass_hi'], BRASS, sides=10)
    p.cylinder(tuple(at(0.22)), tuple(at(0.25)), 0.05, PAL['brass_dark'], BRASS, sides=10)
    p.cylinder(tuple(at(0.25)), tuple(at(0.86)), 0.052, PAL['leather'], LEATHER, sides=10, r1=0.056)
    # stitched seam bands on the leather
    for t in (0.42, 0.66):
        p.cylinder(tuple(at(t)), tuple(at(t + 0.025)), 0.058, PAL['leather_dark'], LEATHER, sides=10)
    # the objective: a flared brass hood and the lens
    p.cylinder(tuple(at(0.86)), tuple(at(0.93)), 0.058, PAL['brass'], BRASS, sides=10, r1=0.066)
    p.cylinder(tuple(at(0.93)), tuple(at(1.0)), 0.066, PAL['brass_hi'], BRASS, sides=10)
    p.cylinder(tuple(at(0.999)), tuple(at(1.004)), 0.05, PAL['glass'], BRASS, sides=10)
    # the frog: a leather loop round the barrel's top and a strap up over the belt
    p.cylinder(tuple(at(0.3)), tuple(at(0.38)), 0.063, PAL['leather_dark'], LEATHER, sides=10)
    strap_top = BELT_HOOK
    strap = [tuple(at(0.34) + Vector((-0.05, 0.0, 0.0))), tuple((at(0.34) + strap_top) / 2 + Vector((-0.012, 0, 0))),
             tuple(strap_top)]
    p.beam(strap, 0.045, 0.016, PAL['leather'], LEATHER, up=(1, 0, 0))
    # a brass buckle on the strap, and the loop's rivet
    mid = (at(0.34) + strap_top) / 2
    p.box(tuple(mid + Vector((0.012, 0.0, 0.0))), (0.016, 0.05, 0.05), PAL['brass'], BRASS, bevel=0.004)
    p.box(tuple(at(0.34) + Vector((0.06, 0.0, 0.0))), (0.018, 0.022, 0.022), PAL['brass_hi'], BRASS)
    return p


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
def make_materials():
    mats = []
    for name, rough, metal in MATERIAL_SPECS:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        mat.use_backface_culling = True
        mats.append(mat)
    return mats


MODELS = (
    # root, bone, file, builders
    ('HarbormasterTricorne_ROOT', 'head', 'harbormaster_tricorne_source.glb', (build_tricorne, build_pipe)),
    ('HarbormasterSpyglass_ROOT', 'hips', 'harbormaster_spyglass_source.glb', (build_spyglass,)),
)


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    models = []
    for root_name, bone, filename, builders in MODELS:
        root = empty(root_name, None, display='ARROWS', size=0.3)
        root['harbormasterGear'] = {'bone': bone, 'up': [0, 1, 0], 'front': [0, 0, 1], 'left': [1, 0, 0]}
        pieces = {}
        for build in builders:
            piece = build()
            pieces[piece.name] = piece.finish(mats, root)
        models.append(dict(root=root, bone=bone, file=filename, pieces=pieces))
    return dict(models=models, mats=mats)


def report(objs):
    for model in objs['models']:
        total = 0
        for name, obj in model['pieces'].items():
            n = triangles(obj)
            total += n
            print(f'PIECE {name} triangles {n}')
            lo = Vector((1e9, 1e9, 1e9))
            hi = Vector((-1e9, -1e9, -1e9))
            for corner in obj.bound_box:
                w = obj.matrix_world @ Vector(corner)
                lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
                hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
            print(f'BOUNDS {name} x {lo.x:.3f}..{hi.x:.3f} y {lo.z:.3f}..{hi.z:.3f} z {-hi.y:.3f}..{-lo.y:.3f}')
        print(f'TRIANGLES {model["root"].name} {total}')


def export(path, root):
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_morph=False,
    )
    print('WROTE', path)


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


if __name__ == '__main__':
    objs = build_scene()
    report(objs)
    for model in objs['models']:
        export(os.path.join(HERE, model['file']), model['root'])
    out_dir = arg('--preview')
    if out_dir or arg('--save'):
        import gear_preview  # noqa: E402

        gear_preview.stage(objs, arg('--reference', os.path.join(HERE, '..', '..', '..', 'tmp',
                                                                 'harbormaster_gear')))
        if out_dir:
            gear_preview.render_all(out_dir)
        if arg('--save'):
            gear_preview.save(arg('--save'))
