# The Tidehold town kit v2 toolkit: WoW-style parametric architecture.
#
# exec()'d by bl_town.py (which sets ROOT first). Everything is authored in
# YARDS, Blender Z-up, the building's origin at its footprint centre on the
# GROUND line, the front (door side) facing +Y (= -Z in the GLB, the
# convention every Tidehold building and interior_reveal.ts share).
#
# The look (SPACEY, 2026-09-26: "more like world of warcraft more artistic and
# less basic square ... up to blizzards standards ... keeping the poly count
# down ... a bit of variation in the textures use some texture atlases"):
#   - chunky stone plinths, battered, with dressed quoins at every corner;
#   - half-timbered upper storeys (cream plaster, dark oak frame, braces)
#     jettied out over carved brackets, or teal / blue painted boards;
#   - steep slate roofs with a BELL-CAST kick at the eaves, a sagging ridge,
#     stepped shingle rows, thick bargeboards and gold finials;
#   - dormers, chimneys, turrets, arched doors and leaded windows from the
#     detail atlas (town_tex/TownAtlas_*), hanging signs, lanterns;
#   - variation: per-element UV offsets into the tiling maps and per-face
#     vertex tints (COLOR_0, which three multiplies over the albedo), with a
#     ground-up darkening and a baked ambient-occlusion pass.
import bpy
import bmesh
import math
import os
import json
import random
from mathutils import Vector, Matrix

TAU = math.pi * 2
# the texture set: v2 = the hand-painted procedural set (town_tex_v2/, painted
# by paint_town.py + paint_atlas.py); TOWN_TEX=v1 builds with the original
# pack-derived set (town_tex/) to revert
TEX_SET = os.environ.get('TOWN_TEX', 'v2')
TEX = ROOT + '/scripts/assets/blender_tidehold/' + ('town_tex' if TEX_SET == 'v1' else 'town_tex_v2')
KIT = ROOT + '/public/models/medieval_village_v2'
RNG = random.Random(1926)


def srgb(hexv):
    def c(u):
        u = u / 255.0
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
    return (c((hexv >> 16) & 255), c((hexv >> 8) & 255), c(hexv & 255), 1.0)


# =============================================================================
#  MATERIALS
# =============================================================================
def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    out.location = (600, 0)
    bsdf.location = (300, 0)
    return nt, bsdf


def _img(fn, noncolor=False):
    im = bpy.data.images.load(TEX + '/' + fn, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im


PREVIEW_VCOL = False      # the GUI multiplies the vertex tint in for SPACEY's view


def tex_mat(name, color_fn, normal_fn=None, rough=0.8, metal=0.0, nstr=0.8,
            emit_fn=None, emit_rgb=None, emit_strength=1.0, orm_fn=None):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = _img(color_fn)
    t.location = (-600, 250)
    if PREVIEW_VCOL:
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(t.outputs['Color'], mix.inputs[6])
        nt.links.new(vc.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if normal_fn:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = _img(normal_fn, True)
        tn.location = (-800, -260)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.location = (-300, -260)
        nm.inputs['Strength'].default_value = nstr
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emit_fn:
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = _img(emit_fn)
        te.location = (-600, -520)
        nt.links.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    elif emit_rgb is not None:
        bsdf.inputs['Emission Color'].default_value = emit_rgb
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if orm_fn:
        # glTF metallicRoughness: G -> roughness, B -> metalness (the
        # exporter recognises exactly this Separate Color wiring)
        to = nt.nodes.new('ShaderNodeTexImage')
        to.image = _img(orm_fn, True)
        to.location = (-800, 0)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        sep.location = (-400, 0)
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    return mat


def flat_mat(name, rgb, rough=0.8, metal=0.0, emit=None, strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    bsdf.inputs['Base Color'].default_value = rgb
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = emit
        bsdf.inputs['Emission Strength'].default_value = strength
    return mat


(M_STONE, M_PLASTER, M_TIMBER, M_TEAL, M_BLUE, M_ROOF, M_GOLD, M_ATLAS,
 M_FLOOR, M_FLAG, M_IRON, M_GLOW, M_RUNE, M_DARK, M_CLOTH, M_DRESSED, M_GLASS) = range(17)


def town_mats():
    mats = [
        tex_mat('town_stone', 'TownStone_Color.jpg', 'TownStone_Normal.jpg', rough=0.9, nstr=1.0),
        tex_mat('town_plaster', 'TownPlaster_Color.jpg', 'TownPlaster_Normal.jpg', rough=0.92, nstr=0.6),
        tex_mat('town_timber', 'TownTimber_Color.jpg', 'TownTimber_Normal.jpg', rough=0.85, nstr=0.9),
        tex_mat('town_teal', 'TownTeal_Color.jpg', 'TownTeal_Normal.jpg', rough=0.8, nstr=0.9),
        tex_mat('town_blue', 'TownBlue_Color.jpg', 'TownBlue_Normal.jpg', rough=0.8, nstr=0.9),
        tex_mat('town_roof', 'TownRoof_Color.jpg', 'TownRoof_Normal.jpg', rough=0.62, nstr=1.4),
        tex_mat('town_gold', 'TownGold_Color.jpg', 'TownGold_Normal.jpg', rough=0.3, metal=0.8, nstr=0.5,
                emit_rgb=(1.0, 0.78, 0.4, 1.0), emit_strength=0.06),
        tex_mat('town_atlas', 'TownAtlas_Color.jpg', None, rough=0.78,     # doors + signs: painted wood, no sky sheen
                emit_fn='TownAtlas_Emissive.jpg', emit_strength=1.0),
        tex_mat('town_floor', 'TownFloor_Color.jpg', 'TownFloor_Normal.jpg', rough=0.8, nstr=0.8),
        tex_mat('town_flag', 'TownFlag_Color.jpg', 'TownFlag_Normal.jpg', rough=0.85, nstr=0.8),
        flat_mat('town_iron', (0.05, 0.05, 0.055, 1.0), rough=0.5, metal=0.6),
        flat_mat('town_glow', (0.9, 0.55, 0.2, 1.0), rough=0.4, emit=srgb(0xffb45a), strength=2.2),
        flat_mat('town_rune', (0.02, 0.12, 0.17, 1.0), rough=0.3, emit=srgb(0x1cb6ea), strength=2.4),
        flat_mat('town_dark', (0.012, 0.01, 0.009, 1.0), rough=1.0),
        tex_mat('town_cloth', 'TownBlue_Color.jpg' if TEX_SET == 'v1' else 'TownCloth_Color.jpg', None, rough=0.95),
        tex_mat('town_dressed', 'TownDressed_Color.jpg', 'TownDressed_Normal.jpg', rough=0.85, nstr=0.8),
        # the window glass: the SAME atlas (one image in the GLB) with a
        # roughness/metal map, so panes catch the sky IBL as a cheap gloss
        tex_mat('town_glass', 'TownAtlas_Color.jpg', None, emit_fn='TownAtlas_Emissive.jpg', emit_strength=1.0,
                orm_fn='TownAtlas_ORM.png'),
    ]
    # the one material that exports ONE-sided (glTF doubleSided false): each
    # pane's street face and inward face are separate (glass_face)
    mats[M_GLASS].use_backface_culling = True
    return mats


# yards per repeat of each tiling map
K = {M_STONE: 5.4, M_PLASTER: 4.0, M_TIMBER: 2.2, M_TEAL: 2.6, M_BLUE: 2.6, M_ROOF: 3.0,
     M_GOLD: 1.6, M_FLOOR: 3.0, M_FLAG: 2.4, M_CLOTH: 2.0, M_DRESSED: 2.4}

# the detail atlas: 4 x 4 cells, (column, row) from the TOP-left in the image;
# UV v runs bottom-up in Blender, so a cell's v0 = 1 - (row + 1) / 4. A third
# entry q = 0..3 names a 256 quarter of the cell (0 top-left, 1 top-right, 2
# bottom-left, 3 bottom-right in the image): since 2026-09-26 the shop signs
# and the small rose windows, to make room for one rose pattern per building
# (town_tex_v2/paint_atlas.py paints the same layout)
CELL = {
    'win_arch_lit': (0, 0), 'win_square_lit': (1, 0), 'win_arch_dark': (2, 0), 'win_square_dark': (3, 0),
    'door_teal': (0, 1), 'door_oak': (1, 1), 'rose_hall': (2, 1), 'lancet': (3, 1),
    'sign_tankard': (0, 2, 0), 'sign_anvil': (0, 2, 1), 'sign_potion': (0, 2, 2), 'sign_sack': (0, 2, 3),
    'sign_coin': (1, 2, 0), 'sign_bell': (1, 2, 1), 'sign_gavel': (1, 2, 2), 'rose': (1, 2, 3),
    'rose_market': (2, 2), 'rose_bank': (3, 2),
    'rose_tavern': (0, 3), 'rose_tavern_b': (1, 3), 'crest': (2, 3),
    'rose_house_b': (3, 3, 0), 'rose_house_e': (3, 3, 1), 'rose_shop_a': (3, 3, 2), 'rose_shop_b': (3, 3, 3),
}

# the rose window a gable_window draws: set per building by the build loop
# ('rose_' + key when the atlas has one, else the shared v2 'rose')
ROSE = {'cell': 'rose'}


def cell_uv(name, u, v, sub=None):
    """(u, v) in 0..1 inside a named atlas cell -> atlas UV. `sub` = (u0, v0,
    u1, v1) picks a sub-rectangle of the cell (the lancets are two per cell)."""
    ent = CELL[name]
    ci, cj = ent[0], ent[1]
    if sub:
        u = sub[0] + (sub[2] - sub[0]) * u
        v = sub[1] + (sub[3] - sub[1]) * v
    s, u0, v0 = 1.0, 0.0, 0.0
    if len(ent) > 2:
        s, u0, v0 = 0.5, 0.5 * (ent[2] % 2), 0.5 * (1 - ent[2] // 2)
    u, v = u0 + s * u, v0 + s * v
    pad = 2.0 / 2048.0
    uu = (ci + u) / 4.0
    vv = 1.0 - (cj + 1.0 - v) / 4.0
    return (min(max(uu, (ci + u0) / 4.0 + pad), (ci + u0 + s) / 4.0 - pad),
            min(max(vv, 1.0 - (cj + 1.0 - v0) / 4.0 + pad), 1.0 - (cj + 1.0 - v0 - s) / 4.0 - pad))


# =============================================================================
#  PARTS: one bmesh per architectural element, joined at export
# =============================================================================
class Part:
    def __init__(self, name, grp='L0', piece=True, origin=(0, 0, 0), rot=0.0):
        self.name = name
        self.grp = grp          # L0 shell / H1 upper storey / H2 roof (interior_reveal)
        self.piece = piece      # exported as its own node in the parts twin
        self.origin = origin
        self.rot = rot
        self.bm = bmesh.new()
        # 'UVMap', the kit props' name: a join matches UV layers BY NAME, and a
        # mismatch (bmesh's default 'Float2') left every joined prop sampling
        # one texel of its atlas (white furniture in game)
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.tint = (1.0, 1.0, 1.0)


PARTS = []
PROPS = []       # imported kit props: (object, grp, piece name)
FLAMES = []      # fire emitters: (id, style, x, y, z, scale) in Blender yards
COLL = {'boxes': [], 'ramps': []}


def reset_build():
    ENV.clear()
    MOVERS.clear()
    PARTS.clear()
    PROPS.clear()
    FLOWERS.clear()
    SIGNS.clear()
    COLL['boxes'].clear()
    COLL['ramps'].clear()
    FLAMES.clear()


def part(name, grp='L0', piece=True, origin=(0, 0, 0), rot=0.0):
    p = Part(name, grp, piece, origin, rot)
    PARTS.append(p)
    return p


# =============================================================================
#  FAR-LOD ENVELOPE: the coarse exterior hull of the 200-300 yd twin
# =============================================================================
# SPACEY (2026-09-26): "create low poly ... versions for 300yd and beyond insure
# the buildings all look the same at that far distance ... cook them neatly".
# While a building is made, the primitives record a COARSE twin of what they
# build (a wall is ONE quad, a roof a 3 x 3 slab, a drum 6 sides), skipping
# interiors, props, stalls and the door clutter ("dont render any of the extra
# indoors or bonus assets"). lod_bake() turns ENV into a mesh and bakes the
# full building's look onto it (one material, one texture).
ENV = []
ENV_STATE = {'skip': 0}
ENV_NOT = ('furniture', 'vault', 'stall', 'stalls', 'entry', 'flowers', 'awning', 'furniture2')


def env_live(P):
    return (ENV_STATE['skip'] == 0 and P is not None and not P.grp.startswith('INT')
            and P.name.split('.')[0] not in ENV_NOT)


class env_off:
    """`with env_off():` builds without recording (a primitive that records
    its own coarse shape, or an interior partition)."""
    def __enter__(self):
        ENV_STATE['skip'] += 1

    def __exit__(self, *a):
        ENV_STATE['skip'] -= 1


def env_poly(P, pts, normal=None, force=False):
    if not force and not env_live(P):
        return
    pts = [Vector(p) for p in pts]
    if len(pts) < 3:
        return
    if normal is not None:
        n = Vector((0, 0, 0))
        for i in range(len(pts)):                     # Newell: robust for any polygon
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if n.dot(Vector(normal)) < 0:
            pts = pts[::-1]
    ENV.append(pts)


def env_box(P, center, size, rot=None, force=False):
    if not force and not env_live(P):
        return
    M = rot if rot is not None else Matrix.Identity(3)
    C = Vector(center)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    def c(ix, iy, iz):
        return C + M @ Vector((ix * hx, iy * hy, iz * hz))
    faces = [((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, 0, 0)),
             ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1), (1, 0, 0)),
             ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1), (0, -1, 0)),
             ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1), (0, 1, 0)),
             ((-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (0, 0, -1)),
             ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1), (0, 0, 1))]
    for f in faces:
        env_poly(P, [c(*f[0]), c(*f[1]), c(*f[2]), c(*f[3])], normal=M @ Vector(f[4]), force=True)


def env_lathe(P, profile, center, segs=6, force=False, cap_bottom=False):
    """A coarse surface of revolution: at most 4 rings of the profile."""
    if not force and not env_live(P):
        return
    prof = list(profile)
    if len(prof) > 4:
        idx = sorted({0, len(prof) // 3, (2 * len(prof)) // 3, len(prof) - 1})
        prof = [prof[i] for i in idx]
    cx, cy, cz = center
    rings = [[Vector((cx + math.cos(TAU * i / segs) * r, cy + math.sin(TAU * i / segs) * r, cz + z))
              for i in range(segs)] for (r, z) in prof]
    for j in range(len(rings) - 1):
        for i in range(segs):
            a, b = rings[j][i], rings[j][(i + 1) % segs]
            c_, d = rings[j + 1][(i + 1) % segs], rings[j + 1][i]
            mid = (a + b + c_ + d) / 4
            out = Vector((mid.x - cx, mid.y - cy, 0))
            if prof[j][0] < 1e-6 and prof[j + 1][0] < 1e-6:
                continue
            if prof[j + 1][0] < 1e-6:
                env_poly(P, [a, b, c_], normal=out, force=True)          # to a point
            elif prof[j][0] < 1e-6:
                env_poly(P, [a, c_, d], normal=out, force=True)
            else:
                env_poly(P, [a, b, c_, d], normal=out, force=True)
    if prof[-1][0] > 1e-6:
        env_poly(P, rings[-1], normal=(0, 0, 1), force=True)
    if cap_bottom and prof[0][0] > 1e-6:
        env_poly(P, rings[0], normal=(0, 0, -1), force=True)


def _set_face(P, f, mat, uvs, tint=None):
    f.material_index = mat
    t = tint or P.tint
    t = (min(1.0, t[0]), min(1.0, t[1]), min(1.0, t[2]))
    for lp, uv in zip(f.loops, uvs):
        lp[P.uv].uv = uv
        lp[P.col] = (t[0], t[1], t[2], 1.0)


def quad(P, pts, mat, uvs=None, tint=None, smooth=False):
    """A face from world points. uvs None = world-yard box projection."""
    vs = [P.bm.verts.new(Vector(p)) for p in pts]
    try:
        f = P.bm.faces.new(vs)
    except ValueError:
        return None
    f.smooth = smooth
    if uvs is None:
        f.normal_update()
        uvs = box_uvs(pts, f.normal, K.get(mat, 3.0), P)
    _set_face(P, f, mat, uvs, tint)
    return f


def box_uvs(pts, n, k, P=None, off=None):
    """World-yard projection on the dominant axis of the face normal."""
    ox, oy = off if off is not None else getattr(P, 'uvoff', (0.0, 0.0))
    ax = max(range(3), key=lambda i: abs(n[i]))
    out = []
    for p in pts:
        x, y, z = p
        if ax == 2:
            out.append((x / k + ox, y / k + oy))
        elif ax == 0:
            out.append(((y if n[0] > 0 else -y) / k + ox, z / k + oy))
        else:
            out.append(((-x if n[1] > 0 else x) / k + ox, z / k + oy))
    return out


def poly_along(P, pts, mat, origin, au, av, k=None, off=(0.0, 0.0), tint=None, smooth=False):
    """A face whose UVs run along explicit axes (beams, boards, roofs)."""
    k = k or K.get(mat, 3.0)
    o = Vector(origin)
    au, av = Vector(au), Vector(av)
    uvs = [((Vector(p) - o).dot(au) / k + off[0], (Vector(p) - o).dot(av) / k + off[1]) for p in pts]
    vs = [P.bm.verts.new(Vector(p)) for p in pts]
    try:
        f = P.bm.faces.new(vs)
    except ValueError:
        return None
    f.smooth = smooth
    _set_face(P, f, mat, uvs, tint)
    return f


def cuboid(P, center, size, mat, rot=None, uv='box', tint=None, faces='all', off=None):
    """A box. rot = 3x3 Matrix. uv 'box' (world projection) or 'along' (U
    down the longest local axis - beams). faces: 'all' or a set of names from
    {'-x','+x','-y','+y','-z','+z'} to KEEP."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    M = rot if rot is not None else Matrix.Identity(3)
    C = Vector(center)
    if uv != 'along' and max(size) >= 0.9 and min(size) >= 0.4:
        env_box(P, center, size, rot)            # a buttress, a chimney, a podium, a step block
    corners = {}
    for ix in (-1, 1):
        for iy in (-1, 1):
            for iz in (-1, 1):
                corners[(ix, iy, iz)] = C + M @ Vector((ix * sx, iy * sy, iz * sz))
    F = {
        '-x': [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)],
        '+x': [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)],
        '-y': [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],
        '+y': [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)],
        '-z': [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)],
        '+z': [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)],
    }
    long_ax = max(range(3), key=lambda i: size[i])
    out = []
    o = off if off is not None else (RNG.random() * 4, RNG.random() * 4)
    # a mirrored basis (beam()'s and every (u, n, up) wall frame are
    # left-handed) turns the box inside out: wind the faces back outward
    flip = M.determinant() < 0
    for key, cs in F.items():
        if faces != 'all' and key not in faces:
            continue
        pts = [tuple(corners[c]) for c in (cs[::-1] if flip else cs)]
        if uv == 'along':
            au = M.col[long_ax]
            nrm = {'-x': 0, '+x': 0, '-y': 1, '+y': 1, '-z': 2, '+z': 2}[key]
            others = [i for i in range(3) if i != nrm and i != long_ax]
            av = M.col[others[0]] if others else M.col[(long_ax + 1) % 3]
            f = poly_along(P, pts, mat, C, au, av, off=o, tint=tint)
        else:
            f = quad(P, pts, mat, tint=tint)
            if f is not None and o is not None:
                for lp in f.loops:
                    lp[P.uv].uv = (lp[P.uv].uv[0] + o[0] * 0.37, lp[P.uv].uv[1] + o[1] * 0.37)
        out.append(f)
    return out


def beam(P, a, b, w, d, mat=M_TIMBER, up=None, tint=None, caps=True):
    """A squared timber from point a to point b (w across, d deep), UV along
    its length. `up` fixes its roll (default: world Z, or X for vertical)."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    if L < 1e-5:
        return []
    t = (b - a) / L
    up = Vector(up) if up is not None else (Vector((1, 0, 0)) if abs(t.z) > 0.9 else Vector((0, 0, 1)))
    side = t.cross(up).normalized()
    up2 = side.cross(t).normalized()
    M = Matrix((t, side, up2)).transposed()
    return cuboid(P, (a + b) / 2, (L, w, d), mat, rot=M, uv='along', tint=tint,
                  faces='all' if caps else {'-y', '+y', '-z', '+z'})


def lathe(P, profile, center, segs=12, mat=M_STONE, cap_top=True, cap_bottom=False, k=None,
          tint=None, smooth=True, phase=0.0):
    """Revolve (r, z) about +Z at `center`, UVs cylindrical (u round, v up)."""
    cx, cy, cz = center
    k = k or K.get(mat, 3.0)
    if max(r for (r, _z) in profile) >= 0.2 and (max(z for (_r, z) in profile) - min(z for (_r, z) in profile)) >= 1.5:
        env_lathe(P, profile, center)            # a column, a porch post, a drum
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs + 1):
            a = phase + TAU * i / segs
            ring.append((cx + math.cos(a) * r, cy + math.sin(a) * r, cz + z))
        rings.append(ring)
    circ = [TAU * max(r, 0.05) for (r, _z) in profile]
    for j in range(len(rings) - 1):
        for i in range(segs):
            pts = [rings[j][i], rings[j][i + 1], rings[j + 1][i + 1], rings[j + 1][i]]
            u0, u1 = i / segs, (i + 1) / segs
            cavg = (circ[j] + circ[j + 1]) / 2
            z0, z1 = profile[j][1], profile[j + 1][1]
            uvs = [(u0 * cavg / k, z0 / k), (u1 * cavg / k, z0 / k), (u1 * cavg / k, z1 / k), (u0 * cavg / k, z1 / k)]
            if profile[j][0] < 1e-6 and profile[j + 1][0] < 1e-6:
                continue
            vs = [P.bm.verts.new(Vector(p)) for p in pts]
            try:
                f = P.bm.faces.new(vs)
            except ValueError:
                continue
            f.smooth = smooth
            _set_face(P, f, mat, uvs, tint)
    if cap_top and profile[-1][0] > 1e-6:
        pts = [rings[-1][i] for i in range(segs)]
        quad(P, pts, mat, tint=tint)
    if cap_bottom and profile[0][0] > 1e-6:
        pts = [rings[0][i] for i in range(segs)][::-1]
        quad(P, pts, mat, tint=tint)


def finial(P, x, y, z, h=1.6, r=0.18, mat=M_GOLD):
    """A gold spike: a collar, a bulb and a point."""
    with env_off():
        _finial(P, x, y, z, h, r, mat)


def _finial(P, x, y, z, h, r, mat):
    lathe(P, [(r * 1.4, 0.0), (r * 1.4, 0.12), (r * 0.6, 0.22), (r * 0.6, h * 0.35), (r * 1.3, h * 0.48),
              (r * 1.1, h * 0.6), (r * 0.4, h * 0.7), (0.0, h)], (x, y, z), segs=8, mat=mat)


# =============================================================================
#  COLLISION (glTF frame: gx = bx, gy = bz, gz = -by)
# =============================================================================
def r4(v):
    return round(float(v), 4)


def col_box(cx, cy, cz, hx, hy, hz, ry=0.0):
    b = {"x": r4(cx), "y": r4(cz), "z": r4(-cy), "hx": r4(hx), "hy": r4(hz), "hz": r4(hy)}
    if abs(ry) > 1e-6:
        b["ry"] = r4(ry)
    COLL['boxes'].append(b)
    return b


def col_ramp(cx, cy, hx, hy, y0, y1, ry=0.0):
    """A walkable deck; the floor rises along the deck's local +X (Blender)."""
    d = {"x": r4(cx), "z": r4(-cy), "hx": r4(hx), "hz": r4(hy), "y0": r4(y0), "y1": r4(y1)}
    if abs(ry) > 1e-6:
        d["ry"] = r4(ry)
    COLL['ramps'].append(d)
    return d


def col_wall(ax, ay, bx, by, z0, z1, t, gaps=()):
    """Wall collision from (ax, ay) to (bx, by), thickness t, with openings
    `gaps` = [(s0, s1, head_z)] measured along the wall from a: each leaves
    the full height open up to head_z and closes above it."""
    L = math.hypot(bx - ax, by - ay)
    if L < 1e-4:
        return
    ux, uy = (bx - ax) / L, (by - ay) / L
    ry = math.atan2(uy, ux)
    cuts = sorted(gaps)
    spans, cur = [], 0.0
    for (s0, s1, head) in cuts:
        if s0 > cur:
            spans.append((cur, s0))
        if head < z1 - 0.05:
            s_mid = (s0 + s1) / 2
            col_box(ax + ux * s_mid, ay + uy * s_mid, (head + z1) / 2, (s1 - s0) / 2, t / 2, (z1 - head) / 2, ry)
        cur = s1
    if cur < L:
        spans.append((cur, L))
    for (s0, s1) in spans:
        s_mid = (s0 + s1) / 2
        col_box(ax + ux * s_mid, ay + uy * s_mid, (z0 + z1) / 2, (s1 - s0) / 2, t / 2, (z1 - z0) / 2, ry)


# =============================================================================
#  STONE PLINTH + QUOINS
# =============================================================================
def plinth(P, x0, x1, y0, y1, z_top, z_bot=-1.0, flare=0.35, cap=True, skip_front=None, band=0.55):
    """A battered stone base under the footprint: the sides lean out toward
    the ground, a dressed cap band runs round the top. Buried below 0 so it
    meets sloping ground; the building seats on its LOWEST vertex (-1)."""
    P.tint = (1.0, 1.0, 1.0)
    o = flare
    top = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    bot = [(x0 - o, y0 - o), (x1 + o, y0 - o), (x1 + o, y1 + o), (x0 - o, y1 + o)]
    for i in range(4):
        a, b = top[i], top[(i + 1) % 4]
        c, d = bot[(i + 1) % 4], bot[i]
        quad(P, [(d[0], d[1], z_bot), (c[0], c[1], z_bot), (b[0], b[1], z_top), (a[0], a[1], z_top)], M_STONE,
             tint=(0.82, 0.82, 0.82))
        mid = ((a[0] + b[0]) / 2 - (x0 + x1) / 2, (a[1] + b[1]) / 2 - (y0 + y1) / 2, 0.0)
        env_poly(P, [(d[0], d[1], z_bot), (c[0], c[1], z_bot), (b[0], b[1], z_top), (a[0], a[1], z_top)], normal=mid)
    if cap:
        # a dressed band round the top, only under the wall line: a full slab
        # would cover the interior floor (it sits a hair above it)
        e = 0.16
        zc = z_top - 0.08
        for (cx, cy, sx, sy) in (((x0 + x1) / 2, y0 - e / 2 + band / 2, x1 - x0 + 2 * e, band + e),
                                 ((x0 + x1) / 2, y1 + e / 2 - band / 2, x1 - x0 + 2 * e, band + e),
                                 (x0 - e / 2 + band / 2, (y0 + y1) / 2, band + e, y1 - y0 + 2 * e - 2 * (band + e) + 0.02),
                                 (x1 + e / 2 - band / 2, (y0 + y1) / 2, band + e, y1 - y0 + 2 * e - 2 * (band + e) + 0.02)):
            cuboid(P, (cx, cy, zc), (sx, sy, 0.22), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})


def quoins(P, x, y, z0, z1, sx, sy, size=0.9, proud=0.07, depth=None):
    """Dressed corner stones up a wall corner at (x, y): alternating long and
    short blocks on the two faces (sx, sy = which way each face runs, +-1).
    `depth` (an ENTERABLE storey's wall thickness, less a margin): each block
    becomes an L of two slabs that stop short of the inner plaster face (a
    solid block runs 1.1 yd in: through the wall into the room)."""
    z = z0
    i = 0
    h = size * 0.62
    while z < z1 - 0.05:
        hh = min(h, z1 - z)
        long_x = (i % 2 == 0)
        lx = size * (1.25 if long_x else 0.7)
        ly = size * (0.7 if long_x else 1.25)
        t = 1.0 + RNG.uniform(-0.06, 0.06)
        if depth is None:
            cx = x - sx * (lx / 2 - proud)
            cy = y - sy * (ly / 2 - proud)
            cuboid(P, (cx, cy, z + hh / 2), (lx, ly, hh - 0.04), M_DRESSED, tint=(t, t, t),
                   faces={'-x', '+x', '-y', '+y', '+z', '-z'})
        else:
            # A: the whole corner and the face along x, `depth` deep
            ax0, ax1 = x + sx * proud, x - sx * (lx - proud)
            ay0, ay1 = y + sy * proud, y - sy * depth
            cuboid(P, ((ax0 + ax1) / 2, (ay0 + ay1) / 2, z + hh / 2), (abs(ax1 - ax0), abs(ay1 - ay0), hh - 0.04),
                   M_DRESSED, tint=(t, t, t))
            # B: the rest of the face along y, butting on A (no shared outer plane)
            bx0, bx1 = x + sx * proud, x - sx * depth
            by0, by1 = y - sy * depth, y - sy * (ly - proud)
            cuboid(P, ((bx0 + bx1) / 2, (by0 + by1) / 2, z + hh / 2), (abs(bx1 - bx0), abs(by1 - by0), hh - 0.04),
                   M_DRESSED, tint=(t, t, t))
        z += hh
        i += 1


# =============================================================================
#  WALLS WITH OPENINGS
# =============================================================================
# A wall runs along a straight line from A to B (the OUTER face), facing out
# along n. An opening: dict(s=centre along the wall, w=width, z0=sill,
# z1=head (spring of the arch if arched), arch=True/False, kind='door' |
# 'window', ...). The wall face is cut round each opening; reveals line it.
def _wall_frame(ax, ay, bx, by):
    L = math.hypot(bx - ax, by - ay)
    u = Vector(((bx - ax) / L, (by - ay) / L, 0.0))
    n = Vector((u.y, -u.x, 0.0))      # outward = right of travel (walls run CCW seen from above)
    return L, u, n


def wall(P, ax, ay, bx, by, z0, z1, mat, openings=(), t=0.45, inner=False, inner_mat=None,
         reveal_mat=None, tint=None, uvoff=None, arch_segs=8):
    """Build one wall face (outer at the A-B line, inner offset by t) with
    holes for `openings`. Returns (L, u, n)."""
    L, u, n = _wall_frame(ax, ay, bx, by)
    A = Vector((ax, ay, 0.0))
    B_ = A + u * L
    env_poly(P, [(A.x, A.y, z0), (B_.x, B_.y, z0), (B_.x, B_.y, z1), (A.x, A.y, z1)], normal=n)
    uvoff = uvoff if uvoff is not None else (RNG.random() * 3, RNG.random() * 3)
    rev = reveal_mat if reveal_mat is not None else mat
    ops = sorted(openings, key=lambda o: o['s'])

    def pt(s, z, depth=0.0):
        p = A + u * s - n * depth
        return (p.x, p.y, z)

    def face(pts, m, depth, flip, tn=None):
        pp = [pt(s, z, depth) for (s, z) in pts]
        if flip:
            pp = pp[::-1]
        k = K.get(m, 3.0)
        uvs = [((s if not flip else s) / k + uvoff[0], z / k + uvoff[1]) for (s, z) in (pts[::-1] if flip else pts)]
        vs = [P.bm.verts.new(Vector(p)) for p in pp]
        try:
            f = P.bm.faces.new(vs)
        except ValueError:
            return None
        _set_face(P, f, m, uvs, tn or tint)
        return f

    # openings whose along-wall spans overlap (a window stacked under a
    # belfry arch) form one COLUMN, built bottom-up so no two wall pieces
    # ever cover the same patch (they used to: a z-fight up the whole tower)
    cols = []
    for o in ops:
        s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
        if cols and s0 < cols[-1][1] - 1e-4:
            cols[-1] = (cols[-1][0], max(cols[-1][1], s1), cols[-1][2] + [o])
        else:
            cols.append((s0, s1, [o]))

    def side(depth, m, flip):
        # spans between columns, full height
        cur = 0.0
        for (c0, c1, grp) in cols:
            if c0 > cur + 1e-4:
                face([(cur, z0), (c0, z0), (c0, z1), (cur, z1)], m, depth, flip)
            prev = z0
            for o in sorted(grp, key=lambda q: q['z0']):
                s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
                top = o['z1'] + (o['w'] / 2 if o.get('arch') else 0.0)
                if o['z0'] > prev + 1e-4:            # under this opening, column wide
                    face([(c0, prev), (c1, prev), (c1, o['z0']), (c0, o['z0'])], m, depth, flip)
                if s0 > c0 + 1e-4:                   # beside a narrower opening
                    face([(c0, o['z0']), (s0, o['z0']), (s0, top), (c0, top)], m, depth, flip)
                if s1 < c1 - 1e-4:
                    face([(s1, o['z0']), (c1, o['z0']), (c1, top), (s1, top)], m, depth, flip)
                _arch_spandrels(o, m, depth, flip)
                prev = max(prev, top)
            if prev < z1 - 1e-4:
                face([(c0, prev), (c1, prev), (c1, z1), (c0, z1)], m, depth, flip)
            cur = c1
        if cur < L - 1e-4:
            face([(cur, z0), (L, z0), (L, z1), (cur, z1)], m, depth, flip)

    def _arch_spandrels(o, m, depth, flip):
        if o.get('arch'):
            hw = o['w'] / 2
            cs = o['s']
            sp = o['z1']
            for i in range(arch_segs):
                th0, th1 = math.pi * i / arch_segs, math.pi * (i + 1) / arch_segs
                p0 = (cs + hw * math.cos(th0), sp + hw * math.sin(th0))
                p1 = (cs + hw * math.cos(th1), sp + hw * math.sin(th1))
                c0 = (cs + hw if math.cos(th0) > 1e-6 else (cs - hw if math.cos(th0) < -1e-6 else p0[0]), sp + hw)
                c1 = (cs + hw if math.cos(th1) > 1e-6 else (cs - hw if math.cos(th1) < -1e-6 else p1[0]), sp + hw)
                # the corner the arch pulls away from, clamped to the box
                q = [p0, p1, (p1[0], sp + hw), (p0[0], sp + hw)]
                face(q, m, depth, flip)

    side(0.0, mat, False)
    if inner:
        side(t, inner_mat if inner_mat is not None else mat, True)
    # reveals: jambs, sill, head / arch soffit (a hole shows the wall's thickness)
    rd = t if inner else min(t, 0.3)
    for o in ops:
        s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
        oz0, sp = o['z0'], o['z1']
        for (s, fl) in ((s0, True), (s1, False)):
            pp = [pt(s, oz0, 0.0), pt(s, sp, 0.0), pt(s, sp, rd), pt(s, oz0, rd)]
            if fl:
                pp = pp[::-1]
            quad(P, pp, rev, tint=tint)
        if oz0 > z0 + 1e-4:
            quad(P, [pt(s0, oz0, 0.0), pt(s0, oz0, rd), pt(s1, oz0, rd), pt(s1, oz0, 0.0)], rev, tint=tint)
        if o.get('arch'):
            hw = o['w'] / 2
            prev = None
            for i in range(arch_segs + 1):
                th = math.pi * i / arch_segs
                s = o['s'] + hw * math.cos(th)
                z = sp + hw * math.sin(th)
                cur = (pt(s, z, 0.0), pt(s, z, rd))
                if prev:
                    quad(P, [prev[0], prev[1], cur[1], cur[0]], rev, tint=tint)
                prev = cur
        else:
            quad(P, [pt(s0, sp, 0.0), pt(s1, sp, 0.0), pt(s1, sp, rd), pt(s0, sp, rd)], rev, tint=tint)
    return L, u, n


# =============================================================================
#  OPENING DRESSING: windows, doors
# =============================================================================
# The glass is ONE-SIDED since 2026-09-26 (SPACEY: "when ur inside the
# buildings the glass should be the standard unlit color dark blue shiny as
# only ouside should the windows be glowing yellow"): every pane is a pair,
# the street face wearing its cell and, 1.2 cm behind it, an inward face
# wearing the unlit dark-blue cell. Stained glass (the roses, the lancets)
# keeps its pattern both ways; it is daylight through coloured glass.
GLASS_INSIDE = {'win_arch_lit': 'win_arch_dark', 'win_square_lit': 'win_square_dark'}
GLASS_GAP = 0.012


def glass_face(P, pts, uvs, outward, uvs_in=None, mat=M_GLASS):
    """A glass pane from `pts` (+ their uvs) facing `outward`, and its inward
    twin 1.2 cm behind it (uvs_in, default the same uvs)."""
    V = [Vector(p) for p in pts]
    nrm = Vector((0, 0, 0))
    for i in range(len(V)):
        a, b = V[i], V[(i + 1) % len(V)]
        nrm += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    order = list(range(len(V)))
    out_n = Vector(outward).normalized()
    if nrm.dot(out_n) < 0:
        order = order[::-1]
    quad(P, [tuple(V[i]) for i in order], mat, uvs=[uvs[i] for i in order], tint=(1, 1, 1))
    ui = uvs_in if uvs_in is not None else uvs
    back = order[::-1]
    quad(P, [tuple(V[i] - out_n * GLASS_GAP) for i in back], mat, uvs=[ui[i] for i in back], tint=(1, 1, 1))


def window_glass(P, A, u, n, o, depth, cell=None, lit=True, mat=None, outward=None):
    """The leaded glass quad set `depth` into the reveal, UV'd to the atlas
    (the atlas cell's arch matches an arched opening). `outward` = the
    street side when `n` is not it (the turret passes its inward normal)."""
    arched = o.get('arch')
    cell = cell or (('win_arch_lit' if lit else 'win_arch_dark') if arched else
                    ('win_square_lit' if lit else 'win_square_dark'))
    sub = o.get('sub')
    # glass cells draw with the glossy glass material, door cells stay matte
    gm = mat if mat is not None else (M_ATLAS if cell.startswith('door') else M_GLASS)

    def cuv(name, u, v):
        return cell_uv(name, u, v, sub)
    s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
    z0 = o['z0']
    top = o['z1'] + (o['w'] / 2 if arched else 0.0)

    def pt(s, z):
        p = A + u * s - n * depth
        return (p.x, p.y, z)
    out_n = Vector(outward) if outward is not None else Vector(n)
    inner = GLASS_INSIDE.get(cell, cell)

    def pane(pts, uv_pts):
        """uv_pts: (u, v) in the cell per point."""
        if gm == M_GLASS:
            glass_face(P, pts, [cuv(cell, a, b) for (a, b) in uv_pts], out_n,
                       [cuv(inner, a, b) for (a, b) in uv_pts])
        else:
            quad(P, pts, gm, uvs=[cuv(cell, a, b) for (a, b) in uv_pts], tint=(1, 1, 1))
    # the cell's arch spans its full width and springs at its middle: squash
    # the cell so its spring line lands on the opening's
    if arched:
        # draw the lower rectangle and the arch as fans that sample the cell
        rect_v = 0.5
        pane([pt(s0, z0), pt(s1, z0), pt(s1, o['z1']), pt(s0, o['z1'])],
             [(0, 0), (1, 0), (1, rect_v), (0, rect_v)])
        hw = o['w'] / 2
        segs = 8
        c = pt(o['s'], o['z1'])
        for i in range(segs):
            th0, th1 = math.pi * i / segs, math.pi * (i + 1) / segs
            p0 = pt(o['s'] + hw * math.cos(th0), o['z1'] + hw * math.sin(th0))
            p1 = pt(o['s'] + hw * math.cos(th1), o['z1'] + hw * math.sin(th1))
            pane([c, p0, p1], [(0.5, rect_v), (0.5 + 0.5 * math.cos(th0), rect_v + 0.5 * math.sin(th0)),
                               (0.5 + 0.5 * math.cos(th1), rect_v + 0.5 * math.sin(th1))])
    else:
        pane([pt(s0, z0), pt(s1, z0), pt(s1, top), pt(s0, top)], [(0, 0), (1, 0), (1, 1), (0, 1)])


# Shutter boards: stained oak everywhere; the painted blues are a rare accent
# a builder has to ask for by name (SPACEY, 2026-09-26: "only use blue stained
# wood in super rare cases").
SHUTTER_MAT = {'oak': None, 'teal': M_TEAL, 'blue': M_BLUE}
OAK_BOARD_TINT = (0.78, 0.6, 0.44)
FW = 0.16          # window frame member width
SHUTTER_REACH = 0.08   # how far past the frame a shutter's hinge sits


def shutter_span(o, fw=FW):
    """Along-wall extent of a window WITH its open shutters (for clash tests)."""
    return (o['s'] - o['w'] / 2 - fw - SHUTTER_REACH - o['w'] / 2,
            o['s'] + o['w'] / 2 + fw + SHUTTER_REACH + o['w'] / 2)


def frame_span(o, fw=FW):
    return (o['s'] - o['w'] / 2 - fw, o['s'] + o['w'] / 2 + fw)


def arch_band(P, C, u, n, ri, ro, d0, d1, mat=M_TIMBER, segs=18, tint=None, back=False):
    """A semicircular band (an arch frame): centre C on the spring line, `u`
    along the wall, `n` out of it, radii ri..ro, from d0 to d1 off the wall.
    Front, extrados and soffit are continuous surfaces (smooth-shaded round
    the curve) with the grain running ALONG the arch; the back (against the
    wall) only when asked. The ends sit flush on the jambs' tops."""
    C = Vector(C)
    up = Vector((0, 0, 1))
    k = K.get(mat, 3.0)
    ou, ov = RNG.random() * 4, RNG.random() * 4

    def pt(r, th, d):
        return C + u * (r * math.cos(th)) + up * (r * math.sin(th)) + n * d

    def face(pts, uvs, want, smooth):
        a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[2])
        if (b - a).cross(c - a).dot(want) < 0:
            pts, uvs = pts[::-1], uvs[::-1]
        vs = [P.bm.verts.new(Vector(p)) for p in pts]
        try:
            f = P.bm.faces.new(vs)
        except ValueError:
            return
        f.smooth = smooth
        _set_face(P, f, mat, [(x + ou, y + ov) for (x, y) in uvs], tint)
    rm = (ri + ro) / 2
    for i in range(segs):
        t0, t1 = math.pi * i / segs, math.pi * (i + 1) / segs
        tm = (t0 + t1) / 2
        radial = u * math.cos(tm) + up * math.sin(tm)
        # arc length along the band (U) against radius or depth (V)
        a0, a1 = rm * t0 / k, rm * t1 / k
        face([pt(ri, t0, d1), pt(ro, t0, d1), pt(ro, t1, d1), pt(ri, t1, d1)],
             [(a0, ri / k), (a0, ro / k), (a1, ro / k), (a1, ri / k)], n, False)
        if back:
            face([pt(ri, t0, d0), pt(ro, t0, d0), pt(ro, t1, d0), pt(ri, t1, d0)],
                 [(a0, ri / k), (a0, ro / k), (a1, ro / k), (a1, ri / k)], -n, False)
        e0, e1 = ro * t0 / k, ro * t1 / k
        face([pt(ro, t0, d0), pt(ro, t1, d0), pt(ro, t1, d1), pt(ro, t0, d1)],
             [(e0, d0 / k), (e1, d0 / k), (e1, d1 / k), (e0, d1 / k)], radial, True)
        s0_, s1_ = ri * t0 / k, ri * t1 / k
        face([pt(ri, t0, d0), pt(ri, t1, d0), pt(ri, t1, d1), pt(ri, t0, d1)],
             [(s0_, d0 / k), (s1_, d0 / k), (s1_, d1 / k), (s0_, d1 / k)], -radial, True)


def window_frame(P, A, u, n, o, mat=M_TIMBER, fw=FW, proud=0.1, sill=True, shutters=None, box=False,
                 framed=False):
    """A chunky frame round the opening, a sill, and (optionally) a pair of
    open board shutters and a flower box.

    framed=True: the window sits in a half-timbered wall whose frame_wall()
    already put a post down each side and rails above and below, so only a
    thin oak sill ledge is added here (a second jamb on top of a post
    z-fights and reads as a clipped double frame)."""
    s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
    z0, sp = o['z0'], o['z1']
    arched = o.get('arch')
    up = Vector((0, 0, 1))
    R = Matrix((u, n, up)).transposed()

    def P3(s, z, d=0.0):
        p = A + u * s + n * d
        return Vector((p.x, p.y, z))
    if framed:
        if sill:
            cuboid(P, tuple(P3(o['s'], z0 - 0.02, 0.13)), (o['w'] - 0.02, 0.26, 0.1), M_TIMBER, rot=R,
                   tint=(0.9, 0.86, 0.82), faces={'+z', '+y', '-x', '+x', '-z'})
    else:
        # jambs
        for s in (s0 - fw / 2, s1 + fw / 2):
            beam(P, P3(s, z0 - (0.05 if sill else 0), proud / 2), P3(s, sp + (0 if arched else fw), proud / 2), fw,
                 proud, mat=mat, up=n)
        if arched:
            # ONE solid curved band springing off the jambs (SPACEY: "a solid
            # rounded arch not a bunch of split rectangles"; seven straight
            # beams left notches at every joint)
            arch_band(P, P3(o['s'], sp, 0.0), u, n, o['w'] / 2, o['w'] / 2 + fw, 0.0, proud, mat=mat)
        else:
            beam(P, P3(s0 - fw, sp + fw / 2, proud / 2), P3(s1 + fw, sp + fw / 2, proud / 2), fw * 1.3, proud * 1.2,
                 mat=mat, up=n)
        if sill:
            cuboid(P, tuple(P3(o['s'], z0 - 0.07, 0.11)), (o['w'] + 2 * fw + 0.16, 0.3, 0.14), M_DRESSED, rot=R)
    if shutters:
        m = SHUTTER_MAT.get(shutters)
        tint = None
        if m is None:
            m, tint = M_FLOOR, OAK_BOARD_TINT
        hgt = (sp + (o['w'] / 2 if arched else 0)) - z0
        sw = o['w'] / 2
        sh = min(hgt, o['w'] * 1.5)
        for sgn, s_h in ((-1, s0 - fw - SHUTTER_REACH), (1, s1 + fw + SHUTTER_REACH)):
            # hinged just past the frame, folded back flat against the wall
            ang = math.radians(4)
            d = Vector(u * sgn * math.cos(ang) + n * math.sin(ang))
            base = P3(s_h, z0 + 0.05, 0.04)
            p0 = base
            p1 = base + d * sw
            pts = [tuple(p0), tuple(p1), tuple(p1 + up * sh), tuple(p0 + up * sh)]
            if sgn < 0:
                pts = pts[::-1]
            # boards run vertically
            # one face: the town materials export double-sided, and a mirrored
            # back face on the same plane z-fights (different UV offsets)
            poly_along(P, pts, m, tuple(p0), up, d, off=(RNG.random(), RNG.random()), tint=tint)
            # two iron strap hinges across the boards
            for zz in (0.25, sh - 0.25):
                beam(P, p0 + up * zz + n * 0.02, p0 + up * zz + d * (sw * 0.8) + n * 0.02, 0.06, 0.02, mat=M_IRON, up=n)
    if box:
        # a flower box on two oak brackets, standing proud of the sill (and of
        # any frame member) so nothing passes through it
        bw_ = o['w'] + (0.1 if framed else 0.2)
        c = P3(o['s'], z0 - 0.33, 0.48)
        # an open planter: the box without a lid, a rim round its mouth and
        # the soil flush inside it (a solid lid read as a crate with a mat)
        cuboid(P, tuple(c), (bw_, 0.4, 0.34), M_FLOOR, rot=R, tint=OAK_BOARD_TINT,
               faces={'-x', '+x', '-y', '+y', '-z'})
        # (the side rails sit a hair lower than the long ones: no shared
        # top or bottom plane where they cross at the corners)
        # (the long rails stand 2.5 cm proud of the box's faces and 2 cm past
        # the stiles' outer faces, the stiles 1.8 cm past the box's ends: no
        # shared planes anywhere)
        for (du, dn, lu, ln_, zc, hz) in ((0.0, 0.19, bw_ + 0.08, 0.07, 0.19, 0.06),
                                          (0.0, -0.19, bw_ + 0.08, 0.07, 0.19, 0.06),
                                          (bw_ / 2 - 0.017, 0.0, 0.07, 0.28, 0.1885, 0.047),
                                          (-(bw_ / 2 - 0.017), 0.0, 0.07, 0.28, 0.1885, 0.047)):
            cuboid(P, tuple(c + u * du + n * dn + up * zc), (lu, ln_, hz), M_FLOOR, rot=R,
                   tint=(0.62, 0.48, 0.35))
        blooms = [(1.0, 0.45, 0.62), (0.75, 0.45, 1.0), (1.0, 0.85, 0.35), (1.0, 0.55, 0.7), (0.6, 0.5, 1.0)]
        # the soil, flush with the box's top edge inside the rim
        soil = [c + u * (sa * (bw_ / 2 - 0.05)) + n * (sb * 0.16) + up * 0.17
                for (sa, sb) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        if (soil[1] - soil[0]).cross(soil[2] - soil[0]).z < 0:        # the wall frames are left-handed
            soil = soil[::-1]
        quad(P, [tuple(v) for v in soil], M_PLASTER, tint=(0.26, 0.19, 0.13))
        for sgn in (-1, 1):
            at = P3(o['s'] + sgn * (bw_ / 2 - 0.15), z0 - 0.5, 0.0)
            beam(P, at + up * -0.35 + n * 0.05, at + n * 0.62, 0.1, 0.1, up=u)
        # the undergrowth kit's flowering mounds and heather, packed along the
        # box, squashed across it so nothing reaches back into the sill
        k_ = max(3, int(round((bw_ - 0.1) / 0.28)))
        base_rz = math.atan2(-n.x, n.y)
        placed = 0
        for i in range(k_):
            f = (i + 0.5) / k_ - 0.5
            cc = c + u * (f * (bw_ - 0.3) + RNG.uniform(-0.03, 0.03)) + up * 0.15 + n * RNG.uniform(-0.03, 0.02)
            kind = FLOWER_KINDS[(i + RNG.randint(0, 1)) % 2]
            hgt = (0.5 if kind == 'shrub_bloom' else 0.44) * RNG.uniform(0.88, 1.1)
            if flower(kind, tuple(cc), base_rz + math.pi * RNG.randint(0, 1) + RNG.uniform(-0.35, 0.35), hgt,
                      P.grp, squash=0.62) is not None:
                placed += 1
        if not placed:
            for i in range(6):
                f = (i + 0.5) / 6 - 0.5
                cc = c + u * f * (bw_ - 0.25) + up * 0.2 + n * RNG.uniform(-0.05, 0.05)
                lathe(P, [(0.0, 0.0), (0.15, 0.05), (0.13, 0.17), (0.0, 0.23)], tuple(cc), segs=6, mat=M_PLASTER,
                      tint=blooms[i % 5])


DOOR_THICK = 0.1


def _door_slab(P, xf, prof, thick, cell, uv_of, strap_zs, ring_at, a_span):
    """One plank door leaf as a closed solid. `prof` is its outline in leaf
    coordinates (a = across the leaf, z = height); xf(a, z, t) maps a leaf
    point (t = through the thickness, + is the face that shows the street)
    to world. The face carries the atlas door art; the edges are end grain;
    the iron straps, their rivets and the ring pull are geometry on the face."""
    F = [xf(a, z, thick / 2) for (a, z) in prof]
    B = [xf(a, z, -thick / 2) for (a, z) in prof]
    ctr = sum(F + B, Vector()) / (2 * len(prof))
    uvs = [cell_uv(cell, *uv_of(a, z)) for (a, z) in prof]

    def out(pts, uv=None):
        a, b, c = pts[0], pts[1], pts[2]
        fc = sum(pts, Vector()) / len(pts)
        if (b - a).cross(c - a).dot(fc - ctr) > 0:
            return pts, uv
        return pts[::-1], (uv[::-1] if uv else None)
    q, uq = out(F, uvs)
    quad(P, [tuple(v) for v in q], M_ATLAS, uvs=uq, tint=(1, 1, 1))
    q, uq = out(B, uvs)
    quad(P, [tuple(v) for v in q], M_ATLAS, uvs=uq, tint=(0.8, 0.78, 0.76))
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        q, _ = out([B[i], B[j], F[j], F[i]])
        quad(P, [tuple(v) for v in q], M_TIMBER, tint=(0.6, 0.55, 0.5))
    # ironwork, on both faces
    a0, a1 = a_span
    for side in (1, -1):
        tf = side * (thick / 2 + 0.015)
        for zs in strap_zs:
            pa, pb = xf(a0 + 0.04, zs, tf), xf(a1 - 0.04, zs, tf)
            nrm = (xf(0, zs, 1.0) - xf(0, zs, 0.0)).normalized()
            beam(P, pa, pb, 0.13, 0.03, mat=M_IRON, up=nrm)
            for k in range(4):
                f = (k + 0.5) / 4
                rv = pa + (pb - pa) * f + nrm * (side * 0.02)
                cuboid(P, tuple(rv), (0.05, 0.05, 0.05), M_GOLD, tint=(0.55, 0.5, 0.45))
        if ring_at is not None and side > 0:
            ra, rz = ring_at
            c = xf(ra, rz, tf + 0.02)
            nrm = (xf(0, rz, 1.0) - xf(0, rz, 0.0)).normalized()
            lat = (xf(1.0, rz, 0.0) - xf(0.0, rz, 0.0)).normalized()
            prev = None
            for k in range(9):
                th = TAU * k / 8
                p = c + lat * (math.cos(th) * 0.12) + Vector((0, 0, math.sin(th) * 0.12 - 0.1))
                if prev is not None:
                    beam(P, prev, p, 0.035, 0.035, mat=M_GOLD, up=nrm)
                prev = p
            cuboid(P, tuple(c + Vector((0, 0, 0.03))), (0.1, 0.06, 0.1), M_IRON,
                   rot=Matrix((lat, nrm, Vector((0, 0, 1)))).transposed())


def door_leaf(P, A, u, n, o, depth, cell='door_oak', open_=False, swing=168.0, thick=DOOR_THICK):
    """Real door leaves (SPACEY, 2026-09-26: "these doors shouldn't be flat
    planes"). Closed: ONE arched plank slab filling the opening, `depth` into
    the reveal. Open: TWO leaves (a double door, each half the width, its top
    the half-arch it closes) hinged at the inner corners of the reveal and
    folded back `swing` degrees against the inner wall face (`depth` = the
    wall's thickness), clear of the doorway."""
    s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
    z0, sp = o['z0'], o['z1']
    hw = o['w'] / 2
    cs = o['s']
    g = 0.03                                  # the gap round a leaf
    arched = o.get('arch', True)
    up = Vector((0, 0, 1))

    def top_at(sv):
        if not arched:
            return sp - g
        dx = min(hw - g, abs(sv - cs))
        return sp + math.sqrt(max(0.0, (hw - g) ** 2 - dx * dx))

    def uv_of_s(sv, z):
        uu = (sv - (cs - hw)) / (2 * hw)
        if z <= sp or not arched:
            vv = 0.5 * (z - z0) / max(1e-3, sp - z0)
        else:
            vv = 0.5 + 0.5 * (z - sp) / hw
        return (min(1.0, max(0.0, uu)), min(1.0, max(0.0, vv)))

    def outline(sa, sb, segs=8):
        """Leaf outline between along-wall sa < sb, in (s, z), CCW seen from
        the street."""
        pts = [(sa, z0 + 0.03), (sb, z0 + 0.03)]
        for k in range(segs + 1):
            sv = sb + (sa - sb) * k / segs
            pts.append((sv, top_at(sv)))
        # drop points that collapse onto each other at a jamb
        out = [pts[0]]
        for q in pts[1:]:
            if (q[0] - out[-1][0]) ** 2 + (q[1] - out[-1][1]) ** 2 > 1e-6:
                out.append(q)
        return out
    strap_zs = [z0 + 0.22 * (sp - z0), z0 + 0.8 * (sp - z0)]
    if not open_:
        dmid = depth                          # the slab's centre plane, in from the wall face

        def xf(sv, z, t):
            p = A + u * sv - n * (dmid - t)
            return Vector((p.x, p.y, z))
        prof = outline(s0 + g, s1 - g, 12)
        _door_slab(P, xf, prof, thick, cell, lambda sv, z: uv_of_s(sv, z), strap_zs,
                   (cs + hw * 0.48, z0 + 0.52 * (sp - z0)), (s0 + g, s1 - g))
        return
    # the open double door
    hinge_d = depth + thick / 2 + 0.03       # just inside the room, off the inner wall face
    for sgn, s_h in ((-1, s0), (1, s1)):
        phi = math.radians(swing) * (1 if sgn < 0 else -1)
        Rz = Matrix.Rotation(phi, 3, 'Z')
        H = A + u * s_h - n * hinge_d

        def xf(sv, z, t, H=H, Rz=Rz):
            # the leaf as if closed at the hinge line (t + toward the street),
            # then turned about the hinge's vertical axis into the room
            p = u * (sv - s_h) + n * t
            p = Rz @ p
            return Vector((H.x + p.x, H.y + p.y, z))
        sa, sb = (s0 + g, cs - g / 2) if sgn < 0 else (cs + g / 2, s1 - g)
        prof = outline(sa, sb, 8)
        ring = (cs - 0.25, z0 + 0.52 * (sp - z0)) if sgn < 0 else None
        _door_slab(P, xf, prof, thick, cell, lambda sv, z: uv_of_s(sv, z), strap_zs, ring, (sa, sb))


DOOR_RING = 0.38      # voussoir ring depth (radial), = the short jamb block


def door_surround_reach(o):
    """(along-wall half extent from the door centre, top z) of door_surround,
    for clash tests and head-room checks."""
    return o['w'] / 2 + DOOR_RING * 1.4, o['z1'] + o['w'] / 2 + DOOR_RING * 1.55


def door_surround(P, A, u, n, o, voussoirs=9, depth=0.24, mat=M_DRESSED):
    """A dressed stone arch round an arched door. The jambs alternate a long
    and a short block whose short face is flush with the voussoir ring, so the
    ring lands squarely on the jamb; a wider impost block marks the spring; a
    proud keystone closes the crown. Every stone is a closed block with a
    small joint to its neighbours."""
    s0, s1 = o['s'] - o['w'] / 2, o['s'] + o['w'] / 2
    z0, sp = o['z0'], o['z1']
    hw = o['w'] / 2
    up = Vector((0, 0, 1))
    R = Matrix((u, n, up)).transposed()
    bw = DOOR_RING
    J = 0.025                     # joint

    def P3(s, z, d):
        p = A + u * s + n * d
        return Vector((p.x, p.y, z))
    # jambs, up to the impost
    z_imp = sp - 0.26
    z = z0 - 0.02
    i = 0
    rows = max(2, round((z_imp - z) / 0.7))
    h = (z_imp - z) / rows
    for i in range(rows):
        wv = bw * (1.4 if i % 2 == 0 else 1.0)
        t = 1.0 + RNG.uniform(-0.05, 0.04)
        for sgn, s in ((-1, s0), (1, s1)):
            cuboid(P, tuple(P3(s + sgn * wv / 2, z + h / 2, depth / 2)), (wv, depth, h - J), mat, rot=R,
                   tint=(t, t, t))
        z += h
    # impost blocks at the spring, a touch proud
    for sgn, s in ((-1, s0), (1, s1)):
        # flush with the opening (an impost poking into the doorway reads as
        # a chip on the arch from inside)
        cuboid(P, tuple(P3(s + sgn * (bw * 1.5 / 2), z_imp + 0.13, depth / 2 + 0.03)),
               (bw * 1.5, depth + 0.06, 0.26 - J), mat, rot=R, tint=(1.04, 1.03, 1.0))
    # voussoirs: closed wedges, the crown one left for the keystone
    kc = voussoirs // 2
    for k in range(voussoirs):
        if k == kc:
            continue
        th0 = math.pi * k / voussoirs + J / (2 * hw)
        th1 = math.pi * (k + 1) / voussoirs - J / (2 * hw)
        ri, ro = hw, hw + bw
        t = 1.0 + RNG.uniform(-0.05, 0.04)
        _wedge(P, P3, o['s'], sp, ri, ro, th0, th1, 0.0, depth, mat, (t, t, t))
    # the keystone: taller and prouder than the ring
    th0 = math.pi * kc / voussoirs + J / (2 * hw)
    th1 = math.pi * (kc + 1) / voussoirs - J / (2 * hw)
    _wedge(P, P3, o['s'], sp, hw - 0.04, hw + bw * 1.55, th0 - 0.03, th1 + 0.03, 0.0, depth + 0.07, mat,
           (1.08, 1.06, 1.02))


def _wedge(P, P3, cs, sp, ri, ro, th0, th1, d0, d1, mat, tint):
    """A closed arch stone between radii ri..ro and angles th0..th1, from
    wall-depth d0 (0 = the wall face) out to d1."""
    pi_ = [P3(cs + ri * math.cos(th), sp + ri * math.sin(th), 0.0) for th in (th0, th1)]
    po_ = [P3(cs + ro * math.cos(th), sp + ro * math.sin(th), 0.0) for th in (th0, th1)]
    n = (P3(0, 0, 1.0) - P3(0, 0, 0.0))
    F = [v + n * d1 for v in (pi_[0], po_[0], po_[1], pi_[1])]
    B = [v + n * d0 for v in (pi_[0], po_[0], po_[1], pi_[1])]
    quad(P, [tuple(v) for v in F[::-1]], mat, tint=tint)                 # face
    quad(P, [tuple(B[1]), tuple(B[2]), tuple(F[2]), tuple(F[1])], mat, tint=tint)   # outer (extrados)
    quad(P, [tuple(B[3]), tuple(B[0]), tuple(F[0]), tuple(F[3])], mat, tint=(tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9))
    quad(P, [tuple(B[0]), tuple(B[1]), tuple(F[1]), tuple(F[0])], mat, tint=tint)   # joint faces
    quad(P, [tuple(B[2]), tuple(B[3]), tuple(F[3]), tuple(F[2])], mat, tint=tint)


def steps(P, cx, cy, face_n, width, z_top, n_steps=2, run=0.42, mat=M_STONE):
    """Stone steps up to a door: `face_n` the outward direction (unit xy)."""
    n = Vector((face_n[0], face_n[1], 0.0)).normalized()
    u = Vector((-n.y, n.x, 0.0))
    R = Matrix((u, n, Vector((0, 0, 1)))).transposed()
    rise = z_top / n_steps
    for i in range(n_steps):
        top = rise * (i + 1)
        depth = run * (n_steps - i)
        c = Vector((cx, cy, 0.0)) + n * (depth / 2)
        cuboid(P, (c.x, c.y, (top - 0.6) / 2), (width + 0.3 - i * 0.12, depth, top + 0.6),
               M_DRESSED, rot=R, faces={'-x', '+x', '+y', '+z'})          # none against the wall
    # the walkable ramp over them (nosing line), rising toward the door
    ramp_len = run * n_steps
    c = Vector((cx, cy, 0)) + n * (ramp_len / 2)
    ry = math.atan2(-n.y, -n.x)
    col_ramp(c.x, c.y, ramp_len / 2 + 0.02, width / 2 + 0.1, 0.0, z_top, ry=ry)


# =============================================================================
#  TIMBER FRAMING
# =============================================================================
def frame_wall(P, ax, ay, bx, by, z0, z1, openings=(), proud=0.1, w=0.26, braces=True, post_every=2.2):
    """Oak framing over a plaster wall face: sill and top plates, corner and
    intermediate posts, jambs at openings, diagonal braces in the blank bays."""
    L, u, n = _wall_frame(ax, ay, bx, by)
    A = Vector((ax, ay, 0.0))

    def P3(s, z, d=proud / 2):
        p = A + u * s + n * d
        return Vector((p.x, p.y, z))
    # sole and head plates (a touch prouder than the posts, so the post ends
    # die into them instead of sharing their face)
    # Corners: the walls running along x OWN them (their plates and corner
    # posts reach past the corner by their own depth, covering the end of the
    # crossing wall's members); the y walls stop at the corner line. Two
    # members reaching past the same corner would put two outward faces on
    # one plane there: a z-fight on every corner.
    own = abs(u.x) > abs(u.y)
    pd = proud * 1.3
    ext = pd if own else 0.0
    beam(P, P3(-ext, z0 + w * 0.6, pd / 2), P3(L + ext, z0 + w * 0.6, pd / 2), w * 1.2, pd, up=n)
    beam(P, P3(-ext, z1 - w * 0.6, pd / 2), P3(L + ext, z1 - w * 0.6, pd / 2), w * 1.2, pd, up=n)
    zl, zh = z0 + w, z1 - w                     # the posts die into the (prouder) plates
    # every opening gets a post hard against each side (its inner face ON the
    # opening's edge: the wall reveal carries on inward from there, nothing
    # overlaps), and window openings a head and a sill rail between them
    spans = []
    cpost = (w / 2 - proud) if own else w / 2
    posts = [cpost, L - cpost]
    for o in openings:
        a = o['s'] - o['w'] / 2 - w / 2
        b = o['s'] + o['w'] / 2 + w / 2
        posts += [a, b]
        spans.append((a - w / 2, b + w / 2))
        top = o['z1'] + (o['w'] / 2 if o.get('arch') else 0.0)
        # rails run post face to post face (their ends die on the posts' sides:
        # a rail end INSIDE a post puts two front faces a centimetre apart)
        if top + w * 1.5 < zh:
            beam(P, P3(a + w / 2, top + w / 2, proud * 0.5), P3(b - w / 2, top + w / 2, proud * 0.5), w, proud * 0.8, up=n)
        if o.get('kind') != 'door' and o['z0'] - w * 1.5 > zl:
            beam(P, P3(a + w / 2, o['z0'] - w / 2, proud * 0.5), P3(b - w / 2, o['z0'] - w / 2, proud * 0.5), w,
                 proud * 0.8, up=n)

    def blocked(s, pad=0.0):
        return any(a0 - pad < s < b0 + pad for (a0, b0) in spans)
    # fill posts in the blank bays
    base = sorted(set(round(p, 3) for p in posts))
    fill = []
    for a, b in zip(base[:-1], base[1:]):
        if blocked((a + b) / 2):
            continue
        if b - a > post_every * 1.3:
            k = int((b - a) / post_every)
            for i in range(1, k + 1):
                s = a + (b - a) * i / (k + 1)
                if not blocked(s, w):
                    fill.append(s)
    posts = sorted(set(round(p, 3) for p in base + fill))
    for s in posts:
        beam(P, P3(s, zl), P3(s, zh), w, proud, up=n)
    if braces:
        for a, b in zip(posts[:-1], posts[1:]):
            if blocked((a + b) / 2) or b - a < 0.9:
                continue
            _brace(P, P3, a + w / 2, b - w / 2, z0 + w * 1.1, z1 - w * 1.1, RNG.random() < 0.5, w * 0.8,
                   0.005, proud * 0.85)
    return L, u, n


def _brace(P, P3, s0, s1, z0, z1, rising, bw, d0, d1):
    """A diagonal brace as a prism CUT to the bay: vertical ends on the two
    post faces (s0, s1), horizontal ends on the plates (z0, z1), front at wall
    depth d1, nothing of it overlaps a post or plate face."""
    L = s1 - s0
    H = z1 - z0
    if L < 0.3 or H < 0.3:
        return
    hv = bw * math.hypot(L, H) / L            # its vertical thickness
    if rising:
        pts = [(s0, z0), (s0, z0 + hv), (s1, z1), (s1, z1 - hv)]
    else:
        pts = [(s0, z1 - hv), (s0, z1), (s1, z0 + hv), (s1, z0)]
    # keep inside the bay (the thick end would poke past the plates)
    pts = [(sv, min(z1, max(z0, zv))) for (sv, zv) in pts]
    F = [tuple(P3(sv, zv, d1)) for (sv, zv) in pts]
    B = [tuple(P3(sv, zv, d0)) for (sv, zv) in pts]
    ctr = sum((Vector(p) for p in F + B), Vector()) / 8

    def out(q):
        # wind the face so its normal points away from the prism's centre
        a, b, c = Vector(q[0]), Vector(q[1]), Vector(q[2])
        fc = sum((Vector(p) for p in q), Vector()) / len(q)
        return q if (b - a).cross(c - a).dot(fc - ctr) > 0 else q[::-1]
    quad(P, out(F), M_TIMBER)
    for i in range(4):
        j = (i + 1) % 4
        quad(P, out([B[i], B[j], F[j], F[i]]), M_TIMBER, tint=(0.85, 0.83, 0.8))


def jetty(P, x0, x1, y0, y1, z, out, sides='nesw', joists=True, brackets=True, w=0.3, avoid=None):
    """The jettied overhang: a soffit under the upper storey's outset, joist
    ends along the edge, curved brackets back to the storey below."""
    # soffits
    edges = {
        's': ((x0, y0), (x1, y0), (0, -1)),
        'n': ((x1, y1), (x0, y1), (0, 1)),
        'e': ((x1, y0), (x1, y1), (1, 0)),
        'w': ((x0, y1), (x0, y0), (-1, 0)),
    }
    for key in sides:
        (ax, ay), (bx, by), (nx, ny) = edges[key]
        a = Vector((ax, ay, z))
        b = Vector((bx, by, z))
        nn = Vector((nx, ny, 0)) * out
        quad(P, [tuple(a), tuple(a + nn), tuple(b + nn), tuple(b)][::-1], M_TIMBER, tint=(0.75, 0.75, 0.75))
        env_poly(P, [a, a + nn, b + nn, b], normal=(0, 0, -1))
        L = (b - a).length
        u = (b - a) / L
        placed = []
        if brackets:
            # `avoid` = {side: [(s0, s1), ...]}: stretches of the wall below
            # (along the same s as wall_ends) that a bracket must not hang in
            # front of: doors with their surrounds, windows with their
            # shutters, lanterns, signs. A clashing bracket slides to the
            # nearer clear edge, or is dropped.
            bad = sorted((avoid or {}).get(key, []))
            clear = w * 0.5 + 0.12

            def free(sv):
                return 0.25 < sv < L - 0.25 and all(not (a0 - clear < sv < b0 + clear) for (a0, b0) in bad)
            k = max(1, int(L / 2.6))
            for i in range(k + 1):
                f = (i + 0.0) / k if k else 0.5
                sv = L * (0.08 + 0.84 * f)
                if not free(sv):
                    cands = []
                    for (a0, b0) in bad:
                        cands += [a0 - clear - 0.02, b0 + clear + 0.02]
                    cands = [c for c in cands if free(c)]
                    if not cands:
                        continue
                    sv = min(cands, key=lambda c: abs(c - sv))
                if any(abs(sv - q) < 1.2 for q in placed):
                    continue
                placed.append(sv)
                base = a + u * sv
                p_low = base + Vector((0, 0, -1.3))
                p_mid = base + nn * 0.45 + Vector((0, 0, -0.55))
                p_top = base + nn * 0.95 + Vector((0, 0, -0.1))
                beam(P, p_low, p_mid, w * 0.8, w * 0.8, up=u.cross(Vector((0, 0, 1))))
                beam(P, p_mid, p_top, w * 0.8, w * 0.8, up=u.cross(Vector((0, 0, 1))))
        if joists:
            # joist ends along the edge, skipping the bracket heads (a joist
            # cube on a bracket shares its side faces)
            k = max(2, int(L / 0.9))
            for i in range(k + 1):
                sv = L * i / k
                if any(abs(sv - q) < 0.45 for q in placed):
                    continue
                p = a + u * sv + nn * 1.0 + Vector((0, 0, -0.14))
                cuboid(P, tuple(p + Vector((nx, ny, 0)) * 0.02), (0.26, 0.26, 0.26), M_TIMBER,
                       rot=Matrix((u, Vector((nx, ny, 0)), Vector((0, 0, 1)))).transposed(), tint=(0.9, 0.85, 0.8))


# =============================================================================
#  ROOFS
# =============================================================================
def _bell(t, k=0.35):
    """Height fraction at fraction t of the run from the eave (0) to the
    ridge (1): steep at the ridge, kicking out flatter at the eave."""
    return t * (1 - k) + k * (1 - (1 - t) ** 2)


def sweep(P, path, out, h0, h1, d0, d1, mat=M_TIMBER, tint=None, across=None, caps=(True, True), back=True):
    """A member swept along a polyline `path` (world points), continuous
    through every joint (no stack of split boxes). Its section spans h0..h1
    ACROSS the path (perpendicular to it in the plane normal to `out`, or
    along a fixed `across` vector, e.g. world Z for a board that must cover a
    constant height) and d0..d1 along `out`. h0 / h1 may be per-point lists
    (a haunched foot). UVs run along the member."""
    out = Vector(out).normalized()
    pts = [Vector(p) for p in path]
    n = len(pts)
    if n < 2:
        return
    H0 = list(h0) if isinstance(h0, (list, tuple)) else [h0] * n
    H1 = list(h1) if isinstance(h1, (list, tuple)) else [h1] * n
    k = K.get(mat, 3.0)
    ou, ov = RNG.random() * 4, RNG.random() * 4
    tans, acr = [], []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        tans.append(t)
        if across is not None:
            acr.append(Vector(across).normalized())
        else:
            a = out.cross(t)
            if a.z < 0:
                a = -a
            acr.append(a.normalized())
    run = [0.0]
    for i in range(1, n):
        run.append(run[-1] + (pts[i] - pts[i - 1]).length)

    def c(i, hh, dd):
        return pts[i] + acr[i] * (H0[i] if hh == 0 else H1[i]) + out * dd

    def face(q, uvs, want):
        a, b, cc = q[0], q[1], q[2]
        if (b - a).cross(cc - a).dot(want) < 0:
            q, uvs = q[::-1], uvs[::-1]
        vs = [P.bm.verts.new(v) for v in q]
        try:
            f = P.bm.faces.new(vs)
        except ValueError:
            return
        _set_face(P, f, mat, [(x + ou, y + ov) for (x, y) in uvs], tint)
    for i in range(n - 1):
        u0, u1 = run[i] / k, run[i + 1] / k
        mid_a = (acr[i] + acr[i + 1]).normalized()
        a0, a1, b0, b1 = H0[i] / k, H0[i + 1] / k, H1[i] / k, H1[i + 1] / k
        face([c(i, 0, d1), c(i + 1, 0, d1), c(i + 1, 1, d1), c(i, 1, d1)],
             [(u0, a0), (u1, a1), (u1, b1), (u0, b0)], out)
        if back:
            face([c(i, 0, d0), c(i + 1, 0, d0), c(i + 1, 1, d0), c(i, 1, d0)],
                 [(u0, a0), (u1, a1), (u1, b1), (u0, b0)], -out)
        face([c(i, 1, d0), c(i + 1, 1, d0), c(i + 1, 1, d1), c(i, 1, d1)],
             [(u0, d0 / k), (u1, d0 / k), (u1, d1 / k), (u0, d1 / k)], mid_a)
        face([c(i, 0, d0), c(i + 1, 0, d0), c(i + 1, 0, d1), c(i, 0, d1)],
             [(u0, d0 / k), (u1, d0 / k), (u1, d1 / k), (u0, d1 / k)], -mid_a)
    for (i, sgn, on) in ((0, -1, caps[0]), (n - 1, 1, caps[1])):
        if on:
            hh = H1[i] - H0[i]
            face([c(i, 0, d0), c(i, 1, d0), c(i, 1, d1), c(i, 0, d1)],
                 [(0, 0), (hh, 0), (hh, d1 - d0), (0, d1 - d0)], tans[i] * sgn)


def gable_roof(P, cx, cy, length, span, z_eave, rise, axis='x', eave_over=0.9, gable_over=0.7,
               flare=0.35, sag=0.25, rows=10, thick=0.32, **kw):
    """A slate gable roof (_gable_roof_body): its coarse envelope for the LOD
    twin is recorded first, then the detailed roof is built unrecorded."""
    if env_live(P):
        _env_gable(P, cx, cy, length, span, z_eave, rise, axis, eave_over, gable_over, flare, sag, thick,
                   kw.get('sides', (-1, 1)), kw.get('closed_ends', (-1, 1)), kw.get('both_ends_closed', True),
                   kw.get('wall_half'))
    with env_off():
        return _gable_roof_body(P, cx, cy, length, span, z_eave, rise, axis=axis, eave_over=eave_over,
                                gable_over=gable_over, flare=flare, sag=sag, rows=rows, thick=thick, **kw)


def _env_gable(P, cx, cy, length, span, z_eave, rise, axis, eave_over, gable_over, flare, sag, thick, sides,
               closed_ends, both_closed, wall_half):
    """The roof as the twin sees it: each slope a 2 x 3 grid of the SAME bell-
    cast, sagging surface the slates follow (5 cm over them), the soffit a
    slab under it, the eave and rake edges closed, and the gable walls as one
    polygon each up to the roof's underside."""
    hl = length / 2 + gable_over
    hw = span / 2 + eave_over
    wall_half = wall_half if wall_half is not None else span / 2
    if axis == 'x':
        A, B = Vector((1, 0, 0)), Vector((0, 1, 0))
    else:
        A, B = Vector((0, 1, 0)), Vector((-1, 0, 0))
    C = Vector((cx, cy, 0.0))
    z_ridge = z_eave + rise
    slope = rise / (span / 2)
    z_lip = z_eave - eave_over * slope * 0.55

    def surf(a, t, side):             # _gable_roof_body's surf, verbatim
        sagz = sag * (1 - a * a) * (0.35 + 0.65 * t)
        z = z_lip + (z_ridge - z_lip) * _bell(t, flare) - sagz
        z += 0.18 * (a * a) * (1 - t) ** 3
        p = C + A * (a * hl) + B * (side * hw * (1 - t))
        return Vector((p.x, p.y, z))
    As = (-1.0, 0.0, 1.0)
    Ts = (0.0, 0.25, 0.55, 1.0)
    up = Vector((0, 0, 0.05))
    dn = Vector((0, 0, -thick))
    for side in sides:
        n_top = B * side + Vector((0, 0, 1.5))
        for i in range(2):
            for j in range(3):
                q = [surf(As[i], Ts[j], side), surf(As[i + 1], Ts[j], side), surf(As[i + 1], Ts[j + 1], side),
                     surf(As[i], Ts[j + 1], side)]
                env_poly(P, [v + up for v in q], normal=n_top, force=True)
                env_poly(P, [v + dn for v in q], normal=(0, 0, -1), force=True)
            # the eave edge
            a0, a1 = surf(As[i], 0.0, side), surf(As[i + 1], 0.0, side)
            env_poly(P, [a0 + dn, a1 + dn, a1 + up, a0 + up], normal=B * side, force=True)
        # the rake edges
        for ea in (-1.0, 1.0):
            for j in range(3):
                p0, p1 = surf(ea, Ts[j], side), surf(ea, Ts[j + 1], side)
                env_poly(P, [p0 + dn, p1 + dn, p1 + up, p0 + up], normal=A * ea, force=True)
    if not both_closed:
        return
    wa = length / 2
    t_w = max(0.0, 1.0 - wall_half / hw)
    for ea in closed_ends:
        E = C + A * (ea * wa)
        a_w = ea * wa / hl
        lo_, hi_ = E + B * (-wall_half), E + B * wall_half
        outline = [Vector((lo_.x, lo_.y, z_eave)), Vector((hi_.x, hi_.y, z_eave))]
        tm = t_w + (1.0 - t_w) * 0.45
        for (t, sd) in ((t_w, 1), (tm, 1), (1.0, 1), (tm, -1), (t_w, -1)):
            q = surf(a_w, t, sd) + Vector((0, 0, -thick * 0.5))
            if q.z > z_eave + 0.02:
                outline.append(q)
        env_poly(P, outline, normal=A * ea, force=True)


def _gable_roof_body(P, cx, cy, length, span, z_eave, rise, axis='x', eave_over=0.9, gable_over=0.7,
                     flare=0.35, sag=0.25, rows=10, thick=0.32, mat=M_ROOF, gable_ends=('both',),
               gable_mat=M_PLASTER, gable_frame=True, barge=True, finials=True, cap=True, wall_half=None,
               gable_window=None, both_ends_closed=True, uv_off=None, closed_ends=(-1, 1),
               finial_ends=(-1, 1), sides=(-1, 1), tie_beam=False):
    """A slate gable roof over a (length along `axis`) x (span across) box.

    Ridge at z_eave + rise, sagging `sag` in the middle; the eaves kick out
    (bell-cast); stepped shingle rows; soffit; bargeboards; ridge roll; gold
    finials; the triangular gable walls (plaster + oak frame) closing the ends
    under the roof. Returns a function height(x, y) of the roof surface."""
    hl = length / 2 + gable_over
    hw = span / 2 + eave_over
    wall_half = wall_half if wall_half is not None else span / 2
    # frame: a along the ridge, b across it
    if axis == 'x':
        A = Vector((1, 0, 0))
        B = Vector((0, 1, 0))
    else:
        A = Vector((0, 1, 0))
        B = Vector((-1, 0, 0))
    C = Vector((cx, cy, 0.0))
    z_ridge = z_eave + rise
    # the eave line sits eave_over OUT from the wall; drop it by the slope so
    # the roof plane passes through the wall top at the wall line
    slope = rise / (span / 2)
    z_lip = z_eave - eave_over * slope * 0.55
    nA = 6

    def surf(a, t, side):
        """a: -1..1 along the ridge, t: 0 eave -> 1 ridge, side +-1."""
        sagz = sag * (1 - a * a) * (0.35 + 0.65 * t)
        z = z_lip + (z_ridge - z_lip) * _bell(t, flare) - sagz
        # the eave corners kick up a touch (WoW's whimsy)
        z += 0.18 * (a * a) * (1 - t) ** 3
        p = C + A * (a * hl) + B * (side * hw * (1 - t))
        return Vector((p.x, p.y, z))

    off = uv_off or (RNG.random(), RNG.random())
    row_step = 0.09
    for side in sides:
        # stepped rows: each row's lower edge lifted by row_step
        for r in range(rows):
            t0, t1 = r / rows, (r + 1) / rows
            for i in range(nA):
                a0, a1 = -1 + 2 * i / nA, -1 + 2 * (i + 1) / nA
                p00, p10 = surf(a0, t0, side), surf(a1, t0, side)
                p01, p11 = surf(a0, t1, side), surf(a1, t1, side)
                lift = Vector((0, 0, row_step)) + B * (side * row_step * 0.3)
                q = [p00 + lift, p10 + lift, p11, p01]
                if side < 0:
                    q = q[::-1]
                sl_len = hw * 1.1
                uv_u = lambda a: (a * hl) / K[mat] + off[0]
                vv0 = (t0 * sl_len) / K[mat] + off[1]
                vv1 = (t1 * sl_len) / K[mat] + off[1]
                uvs = [(uv_u(a0), vv0), (uv_u(a1), vv0), (uv_u(a1), vv1), (uv_u(a0), vv1)]
                if side < 0:
                    uvs = uvs[::-1]
                vs = [P.bm.verts.new(v) for v in q]
                f = P.bm.faces.new(vs)
                shade = 0.9 + 0.2 * RNG.random()
                _set_face(P, f, mat, uvs, (shade, shade, shade))
                # the step face (the row's butt edge)
                q2 = [p00, p10, p10 + lift, p00 + lift]
                if side < 0:
                    q2 = q2[::-1]
                quad(P, [tuple(v) for v in q2], mat, tint=(0.55, 0.55, 0.6))
        # soffit (underside): it follows the bell curve row by row, one
        # slab thickness under the slates. (A single eave-to-ridge strip was a
        # straight CHORD under a curved roof: the gable end's edge strip
        # stopped short of it and left a crescent hole along each rake.)
        for i in range(nA):
            a0, a1 = -1 + 2 * i / nA, -1 + 2 * (i + 1) / nA
            lo0, lo1 = surf(a0, 0.0, side), surf(a1, 0.0, side)
            d = Vector((0, 0, -thick))
            for r in range(rows):
                t0, t1 = r / rows, (r + 1) / rows
                q = [surf(a0, t0, side) + d, surf(a0, t1, side) + d, surf(a1, t1, side) + d, surf(a1, t0, side) + d]
                if side < 0:
                    q = q[::-1]
                quad(P, [tuple(v) for v in q], M_TIMBER, tint=(0.55, 0.52, 0.5))
            # eave fascia
            q = [lo0 + d, lo1 + d, lo1 + Vector((0, 0, row_step)), lo0 + Vector((0, 0, row_step))]
            if side < 0:
                q = q[::-1]
            quad(P, [tuple(v) for v in q], M_TIMBER, tint=(0.9, 0.85, 0.8))
    # gable edges: close the slab thickness at both ends
    for ea in (-1, 1):
        for side in sides:
            pts_top = [surf(ea, r / rows, side) for r in range(rows + 1)]
            for r in range(rows):
                a0, a1 = pts_top[r], pts_top[r + 1]
                d = Vector((0, 0, -thick))
                q = [a0 + d, a1 + d, a1, a0]
                if (side * ea) > 0:
                    q = q[::-1]
                quad(P, [tuple(v) for v in q], M_TIMBER, tint=(0.7, 0.68, 0.65))
    # bargeboards along the rakes, chunky, with a gold end cap
    if barge:
        for ea in (-1, 1):
            if ea not in closed_ends and ea not in finial_ends:
                continue
            for side in sides:
                # ONE curved board following the rake exactly (four straight
                # beams cut the chords through the slates and notched at every
                # joint): its inner face tucked 3 cm into the slab end, its
                # height covering the soffit to the stepped slates, so the
                # slab's edge is capped cleanly. The two rakes cross at the
                # apex at different depths (never a shared plane).
                nrk = rows * 2
                path = [surf(ea * 1.0, r / nrk, side) for r in range(nrk + 1)]
                d_out = 0.14 + (0.025 if side > 0 else 0.0)
                sweep(P, path, A * ea, -thick - 0.08, row_step + 0.06, -0.03 - (0.012 if side > 0 else 0.0), d_out,
                      across=Vector((0, 0, 1)))
                cuboid(P, tuple(path[0] + A * (ea * d_out * 0.5) + Vector((0, 0, -thick * 0.5))),
                       (0.3, 0.3, 0.3), M_GOLD)
    # ridge roll
    if cap and len(sides) == 2:
        prev = None
        for i in range(nA + 1):
            a = -1 + 2 * i / nA
            p = surf(a, 1.0, 1) + Vector((0, 0, 0.1))
            if prev is not None:
                beam(P, prev, p, 0.34, 0.3, mat=M_TIMBER, up=Vector((0, 0, 1)))
            prev = p
    if finials:
        for ea in finial_ends:
            p = surf(ea, 1.0, 1)
            finial(P, p.x, p.y, p.z + 0.1, h=1.5)
    # gable walls under the roof at the wall line (a -> the wall end)
    wa = length / 2
    for ea in closed_ends:
        if not both_ends_closed:
            continue
        base_z = z_eave
        E = C + A * (ea * wa)
        pts = [E + B * (-wall_half), E + B * wall_half]
        # the gable's top edge is the roof's own underside at the wall line
        # (the roof bell-casts and sags: a straight-edged triangle left a hole
        # either side), lifted half a slab into the slab so no crack shows
        a_w = ea * wa / hl
        t_w = max(0.0, 1.0 - wall_half / hw)
        nt = rows * 2
        ts = [t_w + (1.0 - t_w) * i / nt for i in range(nt + 1)]
        under = {sd: [surf(a_w, t, sd) - Vector((0, 0, thick)) for t in ts] for sd in (-1, 1)}
        apex = under[1][-1].z
        outline = [Vector((pts[0].x, pts[0].y, base_z)), Vector((pts[1].x, pts[1].y, base_z))]
        for q in under[1]:
            if q.z + thick * 0.5 > base_z + 0.02:
                outline.append(Vector((q.x, q.y, q.z + thick * 0.5)))
        for q in under[-1][::-1][1:]:
            if q.z + thick * 0.5 > base_z + 0.02:
                outline.append(Vector((q.x, q.y, q.z + thick * 0.5)))
        poly = [tuple(v) for v in outline]
        if ea < 0:
            poly = poly[::-1]
        quad(P, poly, gable_mat, tint=(1.0, 0.98, 0.95))
        if gable_frame:
            # from the gable's own corners, NOT from a reversed outline (that
            # used to hand the far end a tie beam, one rafter and a king post
            # running corner to corner)
            Pl = Vector((pts[0].x, pts[0].y, base_z)) + A * (ea * 0.06)
            Pr = Vector((pts[1].x, pts[1].y, base_z)) + A * (ea * 0.06)
            Pa = Vector((E.x, E.y, apex - 0.26)) + A * (ea * 0.06)
            # every member at its own depth, 2+ cm apart and clear of the
            # storey head below (a timber head plate's front is 0.13 out, a
            # stone course's 0.15): rafters 0.175 / 0.2, king post 0.105,
            # struts 0.085, the door-hood tie beam 0.17. Members that cross
            # never share a face plane.
            dA = A * ea
            if tie_beam:     # only where no storey head course/plate already runs along the gable's foot
                # (5 cm past the corners: its ends clear the rafters' square-cut feet)
                ext_ = (Pr - Pl).normalized() * 0.05
                beam(P, Pl - ext_ + dA * 0.03, Pr + ext_ + dA * 0.03, 0.28, 0.16, up=A)
            # the rafters: continuous curved members tucked 2 cm under the
            # roof's underside, from the wall corner to the apex. Vertical
            # sections (a square-cut foot plumb over the corner) of a constant
            # SQUARE depth; the foot haunches down to sit on the wall plate
            # (the underside at the corner stands above it: a plaster wedge)
            for sd, dd in ((-1, 0.045), (1, 0.07)):
                path = [q + A * (ea * 0.06) - Vector((0, 0, 0.02)) for q in under[sd]]
                m = len(path)
                runs = [0.0]
                for i in range(1, m):
                    runs.append(runs[-1] + (path[i] - path[i - 1]).length)
                std = []
                for i in range(m):
                    tv = path[min(i + 1, m - 1)] - path[max(i - 1, 0)]
                    cosv = math.hypot(tv.x, tv.y) / max(tv.length, 1e-6)
                    std.append(0.24 / max(cosv, 0.35))
                foot = max(path[0].z - base_z, 0.12)
                reach = runs[-1] * 0.22
                hv = [std[i] + (foot - std[0]) * max(0.0, 1.0 - runs[i] / reach) ** 1.5 for i in range(m)]
                sweep(P, path, dA, [-h for h in hv], 0.0, dd, dd + 0.14, mat=M_TIMBER, across=Vector((0, 0, 1)))
            mid = (Pl + Pr) / 2
            if not gable_window:
                beam(P, mid - dA * 0.015, Pa - dA * 0.015, 0.24, 0.12, up=A)
                beam(P, mid + (Pl - mid) * 0.55 - dA * 0.025, (mid + Pa) / 2 + (Pl - mid) * 0.02 - dA * 0.025, 0.2,
                     0.1, up=A)
                beam(P, mid + (Pr - mid) * 0.55 - dA * 0.025, (mid + Pa) / 2 + (Pr - mid) * 0.02 - dA * 0.025, 0.2,
                     0.1, up=A)
            else:
                # short posts from the tie beam and from the apex to the ring
                ctr_f = Vector((mid.x, mid.y, base_z + (apex - base_z) * 0.42))
                rr = gable_window + 0.13
                beam(P, mid - dA * 0.015, ctr_f - Vector((0, 0, rr)) - dA * 0.015, 0.22, 0.12, up=A)
                beam(P, ctr_f + Vector((0, 0, rr)) - dA * 0.015, Pa - dA * 0.015, 0.22, 0.12, up=A)
        if gable_window:
            gw = gable_window
            ctr = E + Vector((0, 0, base_z + (apex - base_z) * 0.42)) + A * (ea * 0.08)
            r = gw
            segs = 12
            prev = None
            cell = ROSE['cell']
            cpt = tuple(ctr)
            ru = 0.47                   # the painted disk fills 0.94 of its cell
            for i in range(segs + 1):
                th = TAU * i / segs
                q = ctr + B * (math.cos(th) * r) + Vector((0, 0, math.sin(th) * r))
                if prev is not None:
                    uv0 = cell_uv(cell, 0.5 + ru * math.cos(TAU * (i - 1) / segs), 0.5 + ru * math.sin(TAU * (i - 1) / segs))
                    uv1 = cell_uv(cell, 0.5 + ru * math.cos(th), 0.5 + ru * math.sin(th))
                    glass_face(P, [cpt, tuple(prev), tuple(q)], [cell_uv(cell, 0.5, 0.5), uv0, uv1], A * ea)
                prev = q
            rr = r + 0.07
            prev = None
            for i in range(segs + 1):
                th = TAU * i / segs
                q = ctr + B * (math.cos(th) * rr) + Vector((0, 0, math.sin(th) * rr)) + A * (ea * 0.04)
                if prev is not None:
                    beam(P, prev, q, 0.16, 0.14, up=A)
                prev = q

    def height(x, y):
        return z_ridge
    return z_ridge


def cone_roof(P, cx, cy, z_base, radius, rise, segs=12, flare=0.4, over=0.45, mat=M_ROOF, finial_h=2.0, rows=6):
    """A turret's conical roof with a bell-cast skirt and a gold finial (its
    envelope recorded first: the bell-cast cone in three bands, the skirt
    edge, the soffit)."""
    if env_live(P):
        R = radius + over
        zc = [(R * (1 - t), z_base - over * 0.45 + rise * _bell(t, flare) + 0.05) for t in (0.0, 0.3, 0.65, 1.0)]
        env_lathe(P, zc, (cx, cy, 0.0), segs=8, force=True)
        env_lathe(P, [(R, zc[0][1] - 0.3), (R, zc[0][1])], (cx, cy, 0.0), segs=8, force=True, cap_bottom=True)
    with env_off():
        _cone_roof_body(P, cx, cy, z_base, radius, rise, segs, flare, over, mat, finial_h, rows)


def _cone_roof_body(P, cx, cy, z_base, radius, rise, segs, flare, over, mat, finial_h, rows):
    prof = []
    R = radius + over
    for i in range(rows + 1):
        t = i / rows
        r = R * (1 - t)
        z = z_base - over * 0.45 + rise * _bell(t, flare)
        prof.append((r, z))
    # rows as rings with a small step
    for i in range(rows):
        r0, z0 = prof[i]
        r1, z1 = prof[i + 1]
        lathe(P, [(r0 + 0.06, z0 + 0.07), (r1, z1)], (cx, cy, 0.0), segs=segs, mat=mat, cap_top=False, smooth=True)
        lathe(P, [(r0, z0), (r0 + 0.06, z0 + 0.07)], (cx, cy, 0.0), segs=segs, mat=mat, cap_top=False,
              tint=(0.55, 0.55, 0.6), smooth=True)
    lathe(P, [(prof[0][0], prof[0][1] - 0.25), (prof[0][0], prof[0][1])], (cx, cy, 0.0), segs=segs, mat=M_TIMBER,
          cap_top=False, smooth=False)
    # soffit
    quad(P, [(cx + math.cos(TAU * i / segs) * prof[0][0], cy + math.sin(TAU * i / segs) * prof[0][0],
              prof[0][1] - 0.25) for i in range(segs)][::-1], M_TIMBER, tint=(0.5, 0.48, 0.45))
    finial(P, cx, cy, z_base + rise - 0.3, h=finial_h, r=0.2)


# =============================================================================
#  CHIMNEY, DORMER, TURRET
# =============================================================================
def chimney(P, x, y, z0, z1, w=1.0, d=1.0):
    cuboid(P, (x, y, (z0 + z1) / 2), (w, d, z1 - z0), M_STONE, tint=(0.95, 0.94, 0.92),
           faces={'-x', '+x', '-y', '+y'})
    cuboid(P, (x, y, z1 + 0.12), (w + 0.28, d + 0.28, 0.24), M_DRESSED)
    cuboid(P, (x, y, z1 + 0.42), (w - 0.1, d - 0.1, 0.36), M_STONE, tint=(0.92, 0.9, 0.88),
           faces={'-x', '+x', '-y', '+y'})
    cuboid(P, (x, y, z1 + 0.66), (w + 0.12, d + 0.12, 0.14), M_DRESSED)
    quad(P, [(x - w / 2 + 0.1, y - d / 2 + 0.1, z1 + 0.62), (x + w / 2 - 0.1, y - d / 2 + 0.1, z1 + 0.62),
             (x + w / 2 - 0.1, y + d / 2 - 0.1, z1 + 0.62), (x - w / 2 + 0.1, y + d / 2 - 0.1, z1 + 0.62)],
         M_DARK, tint=(1, 1, 1))
    # two pots
    for dx in (-0.2, 0.22):
        lathe(P, [(0.16, 0.0), (0.14, 0.4), (0.19, 0.46), (0.12, 0.5)], (x + dx, y, z1 + 0.73), segs=6,
              mat=M_STONE, tint=(0.85, 0.6, 0.45), cap_top=True)


def dormer(P, x, y, z_base, w, depth, face, wall_h=1.7, rise=1.3, mat_wall=M_PLASTER, lit=True, sag=0.08):
    """A dormer on a roof slope: its front wall faces `face` (+-1 along y in
    the roof's frame, the building's y), a leaded window, a small gable roof."""
    n = Vector((0, face, 0))
    u = Vector((face, 0, 0))
    fy = y + face * depth / 2
    A = Vector((x + face * w / 2, fy, 0.0))            # runs so its outward normal is +face (wall() convention)
    # front wall with a window opening
    ww = min(1.0, w * 0.45)
    # the arch's crown plus its frame stays 0.3 under the dormer's wall top
    # (the roof's soffit hangs there: an arch reaching it clipped through)
    o = dict(s=w / 2, w=ww, z0=z_base + 0.4, z1=z_base + wall_h - ww / 2 - 0.13 - 0.3, arch=True)
    wall(P, A.x, A.y, A.x - face * w, A.y, z_base, z_base + wall_h, mat_wall, [o], t=0.25)
    L, uu, nn = _wall_frame(A.x, A.y, A.x - face * w, A.y)
    window_glass(P, A, uu, nn, o, 0.2, lit=lit)
    window_frame(P, A, uu, nn, o, sill=True, proud=0.08, fw=0.13)
    # side cheeks
    for sgn in (-1, 1):
        sx = x + sgn * w / 2
        cheek = [(sx, fy, z_base), (sx, y - face * depth / 2, z_base), (sx, y - face * depth / 2, z_base + wall_h),
                 (sx, fy, z_base + wall_h)]
        quad(P, cheek[:: (1 if sgn * face > 0 else -1)], mat_wall)
        env_poly(P, cheek, normal=(sgn, 0, 0))
    gable_roof(P, x, y, depth, w, z_base + wall_h, rise, axis='y', eave_over=0.35, gable_over=0.35,
               flare=0.25, sag=sag, rows=4, thick=0.2, gable_frame=False, finials=False, cap=True,
               both_ends_closed=True, gable_mat=mat_wall)


def turret(P, cx, cy, z0, z_body, radius, segs=10, stone_h=None, cone_rise=None, windows=3, face=0.0,
           mat_upper=M_PLASTER):
    """A round corner turret: stone lower drum, a corbel ring, a plastered
    upper drum banded in oak, leaded windows, a flared slate cone."""
    stone_h = stone_h if stone_h is not None else (z_body - z0) * 0.55
    zs = z0 + stone_h
    ru = radius + 0.2
    if env_live(P):
        # the drum as the twin sees it: the battered foot, the stone drum, the
        # corbel out to the upper drum (no gap where the corbel ring is short)
        env_lathe(P, [(radius + 0.35, z0 - 1.0), (radius, z0 + 1.0), (radius + 0.28, zs + 0.45), (ru, z_body)],
                  (cx, cy, 0.0), segs=8, force=True)
    with env_off():
        _turret_body(P, cx, cy, z0, z_body, radius, segs, zs, ru, windows, face, mat_upper)
    cone_roof(P, cx, cy, z_body, ru, (cone_rise or ru * 3.4), segs=segs)


def _turret_body(P, cx, cy, z0, z_body, radius, segs, zs, ru, windows, face, mat_upper):
    lathe(P, [(radius + 0.35, z0 - 1.0), (radius + 0.12, z0 + 0.6), (radius, z0 + 1.0), (radius, zs)],
          (cx, cy, 0.0), segs=segs, mat=M_STONE, cap_top=False, smooth=False)
    # corbel ring
    lathe(P, [(radius, zs), (radius + 0.28, zs + 0.35), (radius + 0.28, zs + 0.55)], (cx, cy, 0.0), segs=segs,
          mat=M_STONE, cap_top=False, smooth=False, tint=(1.1, 1.08, 1.03))
    lathe(P, [(ru, zs + 0.55), (ru, z_body)], (cx, cy, 0.0), segs=segs, mat=mat_upper, cap_top=False, smooth=False)
    # oak bands and posts
    for zb in (zs + 0.6, z_body - 0.2):
        lathe(P, [(ru + 0.06, zb - 0.14), (ru + 0.06, zb + 0.14)], (cx, cy, 0.0), segs=segs, mat=M_TIMBER,
              cap_top=False, smooth=False)
    win_as = [face + (k - (windows - 1) / 2) * (TAU / segs) * 1.5 for k in range(windows)]
    ww = 0.8
    half_a = (ww / 2 + 0.12 + 0.18) / ru          # window + frame + half a post, as an angle
    for i in range(segs):
        a = TAU * i / segs
        if any(abs(math.atan2(math.sin(a - wa), math.cos(a - wa))) < half_a for wa in win_as):
            continue                               # never down the middle of a window
        p0 = Vector((cx + math.cos(a) * (ru + 0.05), cy + math.sin(a) * (ru + 0.05), zs + 0.6))
        beam(P, p0, p0 + Vector((0, 0, z_body - zs - 0.8)), 0.2, 0.1, up=Vector((math.cos(a), math.sin(a), 0)))
    # windows on the upper drum, facing out round `face`
    for a in win_as:
        c = Vector((cx + math.cos(a) * (ru + 0.08), cy + math.sin(a) * (ru + 0.08), 0))
        uu = Vector((-math.sin(a), math.cos(a), 0))
        nn = Vector((math.cos(a), math.sin(a), 0))
        zw0, zw1 = zs + 1.0, min(z_body - 0.7, zs + 2.2)
        o = dict(s=0.0, w=ww, z0=zw0, z1=zw1 - ww / 2, arch=True)
        A = c - uu * 0.0
        window_glass(P, A, uu, -nn, o, -0.02, outward=nn)
        window_frame(P, A, uu, -nn * -1, o, fw=0.12, proud=0.08, sill=False)


# =============================================================================
#  SIGN, LANTERN, BANNER
# =============================================================================
SIGNS = []       # deferred hanging signs, placed last by place_signs()
SCENE_LABELS = []   # what each scene-BVH face belongs to (debug)
SIGN_WHY = []
WALL_MATS = (M_STONE, M_PLASTER, M_TEAL, M_BLUE)


def hanging_sign(P, x, y, z, face, cell, size=1.3, door=None, only_side=None):
    """A shop sign: an iron bracket off a wall plate and a board hung on
    chains. DEFERRED (SPACEY, 2026-09-26: "make sure the shop signs sit nicely
    connected near the front door and doesnt float or get clipped by any
    other assets"): (x, y) is the preferred spot ON the wall line, `face` the
    wall's outward normal, `door` = (cx, cy, width, arch_top_z, floor_z) of
    the door it belongs to. place_signs() runs once the whole building (and
    its awnings, porches, props, planters) exists and picks the nearest clear
    spot beside that door."""
    SIGNS.append(dict(P=P, at=Vector((x, y, z)), face=face, cell=cell, size=size, door=door, only_side=only_side))


def _build_sign(P, base, n, cell, size, plate=True, root=0.03):
    """The sign's geometry, its bracket rooted on the wall at `base` (a
    point ON the wall face at the bracket's height)."""
    u = Vector((-n.y, n.x, 0))
    up = Vector((0, 0, 1))
    R = Matrix((u, n, up)).transposed()
    if plate:
        # the iron wall plate the bracket and its strut are bolted to
        cuboid(P, tuple(base + n * 0.019 + up * -0.28), (0.22, 0.03, 0.78), M_IRON, rot=R)
        for dz in (0.02, -0.58):
            cuboid(P, tuple(base + n * 0.045 + up * dz), (0.05, 0.03, 0.05), M_GOLD, rot=R, tint=(0.55, 0.5, 0.45))
    b0 = base + n * root
    arm_end = b0 + n * (size + 0.42)
    # every member a different section, and each one ENDS inside the one it
    # meets: no two faces share a plane (the old rim was exactly as thick as
    # the board, and its four rails overlapped at the corners)
    beam(P, b0, arm_end, 0.09, 0.12, mat=M_IRON, up=up)
    beam(P, b0 + up * -0.55, b0 + n * (size * 0.6) + up * -0.03, 0.055, 0.055, mat=M_IRON, up=u)
    for k in (0.35, 0.8):
        lathe(P, [(0.0, -0.06), (0.07, 0.0), (0.0, 0.06)], tuple(b0 + n * (size * k + 0.2)), segs=6, mat=M_GOLD)
    c = b0 + n * (size / 2 + 0.3) + up * (-0.35 - size / 2)
    half = size / 2
    rim_w = 0.08                       # the frame's face width round the board
    for sgn in (-1, 1):
        beam(P, b0 + n * (size / 2 + 0.3 + sgn * size * 0.38) + up * -0.03,
             c + n * (sgn * size * 0.38) + up * (half + rim_w / 2 - 0.01), 0.035, 0.035, mat=M_IRON, up=u)
    thick = 0.08
    pts = [c - n * half - up * half, c + n * half - up * half, c + n * half + up * half, c - n * half + up * half]
    for sgn in (-1, 1):
        off = u * (sgn * thick / 2)
        q = [tuple(p + off) for p in pts]
        uvs = [cell_uv(cell, 0, 0), cell_uv(cell, 1, 0), cell_uv(cell, 1, 1), cell_uv(cell, 0, 1)]
        if sgn < 0:
            q = q[::-1]
            uvs = [cell_uv(cell, 1, 0), cell_uv(cell, 0, 0), cell_uv(cell, 0, 1), cell_uv(cell, 1, 1)][::-1]
        quad(P, q, M_ATLAS, uvs=uvs, tint=(1, 1, 1))
    # the frame: head and foot rails run the full width (over the corners),
    # the stiles butt between them, a hair thinner; all stand proud of the
    # board's faces (0.12 against its 0.08)
    ext = n * (rim_w / 2)
    beam(P, pts[0] - ext, pts[1] + ext, rim_w, 0.12, mat=M_TIMBER, up=u)
    beam(P, pts[3] - ext, pts[2] + ext, rim_w, 0.12, mat=M_TIMBER, up=u)
    rise = up * (rim_w / 2)
    beam(P, pts[1] + rise, pts[2] - rise, rim_w - 0.012, 0.11, mat=M_TIMBER, up=u)
    beam(P, pts[0] + rise, pts[3] - rise, rim_w - 0.012, 0.11, mat=M_TIMBER, up=u)


def _scene_bvh():
    """Every triangle built so far (parts, kit props, window-box plants) in
    the building frame, with its material index (-1 for objects)."""
    from mathutils.bvhtree import BVHTree
    verts, polys, mats = [], [], []
    SCENE_LABELS.clear()
    for Pp in PARTS:
        bm = Pp.bm
        bm.verts.index_update()
        o = len(verts)
        verts.extend(v.co.copy() for v in bm.verts)
        for f in bm.faces:
            polys.append([o + v.index for v in f.verts])
            mats.append(f.material_index)
            SCENE_LABELS.append(f'{Pp.name}:{f.material_index}')
    bpy.context.view_layer.update()
    for ob in [p_[0] for p_ in PROPS] + [f_[0] for f_ in FLOWERS]:
        mw = ob.matrix_world
        o = len(verts)
        verts.extend(mw @ v.co for v in ob.data.vertices)
        for pl in ob.data.polygons:
            polys.append([o + i for i in pl.vertices])
            mats.append(-1)
            SCENE_LABELS.append(ob.name)
    return BVHTree.FromPolygons(verts, polys, all_triangles=False), mats


def _sign_clear(tree, base, n, cell, size):
    """True when a sign rooted at `base` touches nothing but its own wall:
    no intersection and 6 cm of air round every vertex away from the root."""
    from mathutils.bvhtree import BVHTree
    T = Part('sign_test')
    _build_sign(T, base, n, cell, size, plate=False, root=0.06)
    # the plate's own volume, just off the wall face
    u = Vector((-n.y, n.x, 0))
    R = Matrix((u, n, Vector((0, 0, 1)))).transposed()
    cuboid(T, tuple(base + n * 0.025 + Vector((0, 0, -0.28))), (0.26, 0.036, 0.82), M_IRON, rot=R)
    bvh = BVHTree.FromBMesh(T.bm)
    hit = bvh.overlap(tree)
    if hit:
        SIGN_WHY[:] = [f'intersects {SCENE_LABELS[hit[0][1]] if hit[0][1] < len(SCENE_LABELS) else "?"}']
        T.bm.free()
        return False
    for v in T.bm.verts:
        rel = v.co - base
        if rel.dot(n) < 0.1:
            continue                     # the root and the plate: on the wall by design
        loc, _nrm, _i, dist = tree.find_nearest(v.co, 0.06)
        if loc is not None:
            SIGN_WHY[:] = [f'within 6 cm of {SCENE_LABELS[_i] if _i is not None and _i < len(SCENE_LABELS) else "?"}']
            T.bm.free()
            return False
    T.bm.free()
    # a KEEP-OUT slab either side of the sign: nothing that stands off the
    # wall (a lantern, a jetty bracket, a planter, an awning) within 0.35 yd
    # of it sideways, or it reads as overlapping from most of the street
    # (0.3 yd off the wall and out: door surrounds and window frames are
    # flatter than that and may sit closer)
    up = Vector((0, 0, 1))
    step, rad = 0.1, 0.06                  # a 10 cm grid, each point sees 6 cm: the slab's edge is exact
    side = 0.25 - rad
    # sideways only: from the board's foot up to the arm's underside (an
    # eave or jetty ABOVE the arm is the 6 cm vertex test's business)
    z_top, z_bot = base.z - 0.06 - rad, base.z - 0.35 - size - 0.05 + rad
    n_lo, n_hi = 0.36 + rad, size + 0.5
    nu = int(2 * side / step) + 1
    for iu in range(nu + 1):
        du = -side + 2 * side * iu / nu
        for iz in range(int((z_top - z_bot) / step) + 2):
            zz = min(z_bot + iz * step, z_top)
            for i_n in range(int((n_hi - n_lo) / step) + 2):
                nn = min(n_lo + i_n * step, n_hi)
                pt = base + u * du + n * nn + up * (zz - base.z)
                loc, _nrm, _i, dist = tree.find_nearest(pt, rad)
                if loc is not None:
                    SIGN_WHY[:] = [f'keep-out {SCENE_LABELS[_i] if _i is not None and _i < len(SCENE_LABELS) else "?"} '
                                   f'du{du:+.2f} n{nn:.2f} z{zz:.2f}']
                    return False
    return True


def _wall_hit(tree, mats, line_pt, n, s_along, z):
    """The wall face at (s, z) by a ray from outside: the hit point when it
    is a wall surface within 3 cm of the wall line, else None."""
    u = Vector((-n.y, n.x, 0))
    org = Vector((line_pt.x, line_pt.y, z)) + u * s_along + n * 1.5
    loc, nrm, idx, dist = tree.ray_cast(org, -n, 3.0)
    if loc is None or idx is None:
        return None
    if mats[idx] not in WALL_MATS or abs(nrm.dot(n)) < 0.9:
        return None
    if abs((loc - Vector((line_pt.x, line_pt.y, z))).dot(n)) > 0.03:
        return None
    return loc


def place_signs():
    """Place every deferred sign at the nearest clear spot beside its door:
    each side of the door, walking out from the door surround, a few heights
    round the requested one (the board's foot at least 2.25 yd over the
    floor), shrinking the board if it must. The bracket roots on a flat
    stretch of wall (checked by rays at the arm, the strut foot and the plate
    top), and the sign clears everything built so far by 6 cm."""
    placed = 0
    for sg in SIGNS:
        tree, mats = _scene_bvh()
        n = Vector((sg['face'][0], sg['face'][1], 0)).normalized()
        u = Vector((-n.y, n.x, 0))
        at = sg['at']
        size0 = sg['size']
        if sg['door'] is not None:
            dcx, dcy, dwid, dtop, dfloor = sg['door']
            dctr = Vector((dcx, dcy, 0))
            reach = dwid / 2 + DOOR_RING * 1.4 + 0.15
        else:
            dctr, reach, dtop, dfloor = Vector((at.x, at.y, 0)), 0.0, at.z - 1.0, at.z - 3.7
        line_pt = Vector((at.x, at.y, 0))
        s_pref = (Vector((at.x, at.y, 0)) - dctr).dot(u)
        side_pref = 1 if s_pref >= 0 else -1
        # only_side: +1 = the right of the door as seen from the street (the
        # wall frame's u runs to a viewer's right), -1 = the left
        sides = (sg['only_side'],) if sg.get('only_side') else (side_pref, -side_pref)
        if sg.get('only_side'):
            side_pref = sg['only_side']
        cands = []
        for sz_i, size in enumerate((size0, size0 * 0.85, size0 * 0.72)):
            z_min = dfloor + 2.25 + 0.35 + size
            for side in sides:
                for k in range(16):
                    s = side * (reach + 0.12 + 0.2 * k) if sg['door'] is not None else s_pref + side * 0.2 * k
                    for dz in (0.0, -0.25, 0.25, -0.5, 0.5, 0.8):
                        z = max(at.z + dz, z_min)
                        cost = 0.2 * k + 0.9 * abs(z - at.z) + (0.35 if side != side_pref else 0.0) + 0.9 * sz_i
                        cands.append((cost, s, z, size))
        cands.sort(key=lambda c_: c_[0])
        done = set()
        ok = None
        for (cost, s, z, size) in cands:
            key = (round(s, 2), round(z, 2), round(size, 2))
            if key in done:
                continue
            done.add(key)
            s_line = s + (dctr - line_pt).dot(u)
            hits = [_wall_hit(tree, mats, line_pt, n, s_line, zz) for zz in (z + 0.08, z - 0.6)]
            hits += [_wall_hit(tree, mats, line_pt, n, s_line + du, z - 0.28) for du in (-0.13, 0.13)]
            if any(h_ is None for h_ in hits):
                if globals().get('SIGN_DEBUG') and len(done) < 60:
                    log(f"    {sg['cell']} s{s:+.2f} z{z:.2f} b{size:.2f}: wall rays {[h_ is not None for h_ in hits]}")
                continue
            base = Vector((hits[0].x, hits[0].y, z))
            if _sign_clear(tree, base, n, sg['cell'], size):
                ok = (base, size)
                break
            if globals().get('SIGN_DEBUG') and len(done) < 60:
                log(f"    {sg['cell']} s{s:+.2f} z{z:.2f} b{size:.2f}: {SIGN_WHY[0] if SIGN_WHY else 'clash'}")
        if ok is None:
            log(f"  sign {sg['cell']}: NO clear spot beside the door; at the requested spot")
            ok = (Vector((at.x, at.y, at.z)), size0)
        else:
            placed += 1
            b_, sz_ = ok
            log(f"  sign {sg['cell']}: {(b_ - dctr).dot(u):+.2f} yd from the door, bracket z {b_.z:.2f}, "
                f"board {sz_:.2f}")
        _build_sign(sg['P'], ok[0], n, sg['cell'], ok[1])
    SIGNS.clear()
    return placed


def wall_lantern(P, x, y, z, face, glow=M_GLOW):
    """An iron bracket lantern with a glowing core."""
    n = Vector((face[0], face[1], 0)).normalized()
    u = Vector((-n.y, n.x, 0))
    base = Vector((x, y, z))
    beam(P, base, base + n * 0.55, 0.07, 0.07, mat=M_IRON, up=Vector((0, 0, 1)))
    # the strut ends INSIDE the arm (its end on the arm's centre line shared
    # planes with it: an iron-on-iron flicker)
    beam(P, base + Vector((0, 0, -0.3)), base + n * 0.4 + Vector((0, 0, -0.018)), 0.045, 0.045, mat=M_IRON, up=u)
    c = base + n * 0.6 + Vector((0, 0, -0.35))
    lathe(P, [(0.0, 0.52), (0.22, 0.4), (0.16, 0.34)], tuple(c), segs=6, mat=M_IRON)
    lathe(P, [(0.13, -0.26), (0.15, 0.3)], tuple(c), segs=6, mat=glow, cap_top=False, smooth=False)
    lathe(P, [(0.18, -0.34), (0.18, -0.26), (0.0, -0.24)], tuple(c), segs=6, mat=M_IRON)
    for i in range(4):
        a = TAU * i / 4 + TAU / 8
        p = c + Vector((math.cos(a) * 0.17, math.sin(a) * 0.17, 0))
        beam(P, p + Vector((0, 0, -0.3)), p + Vector((0, 0, 0.36)), 0.035, 0.035, mat=M_IRON)


def banner(P, origin, right, normal, W, H, sway=0.18, sigil=True):
    """A hanging Tidehold drop: a gold rod, blue cloth with a soft belly, a
    gold hem, the crest on its face (atlas)."""
    O, R, Nn = Vector(origin), Vector(right).normalized(), Vector(normal).normalized()
    NW, NH = 4, 6
    rows = []
    for j in range(NH + 1):
        v = j / NH
        row = []
        for i in range(NW + 1):
            uu = i / NW
            belly = sway * math.sin(uu * math.pi) * (v ** 1.2)
            row.append(O + R * ((uu - 0.5) * W) - Vector((0, 0, H * v)) + Nn * (0.05 + belly))
        rows.append(row)
    for j in range(NH):
        for i in range(NW):
            q = [rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]
            u0, u1 = i / NW, (i + 1) / NW
            v0, v1 = 1 - j / NH, 1 - (j + 1) / NH
            if sigil and 0.18 < (j + 0.5) / NH < 0.7:
                cv0 = (v0 - 0.3) / 0.52
                cv1 = (v1 - 0.3) / 0.52
                uvs = [cell_uv('crest', u0, cv0), cell_uv('crest', u1, cv0), cell_uv('crest', u1, cv1),
                       cell_uv('crest', u0, cv1)]
                quad(P, [tuple(v) for v in q[::-1]], M_ATLAS, uvs=uvs[::-1], tint=(1, 1, 1))
                quad(P, [tuple(v) for v in q], M_CLOTH, tint=(0.8, 0.8, 0.8))
            else:
                quad(P, [tuple(v) for v in q[::-1]], M_CLOTH, tint=(1, 1, 1))
                quad(P, [tuple(v) for v in q], M_CLOTH, tint=(0.8, 0.8, 0.8))
    beam(P, O - R * (W / 2 + 0.2) + Nn * 0.05, O + R * (W / 2 + 0.2) + Nn * 0.05, 0.08, 0.08, mat=M_GOLD, up=Nn)
    hem = rows[-1]
    for i in range(NW):
        beam(P, hem[i], hem[i + 1], 0.1, 0.06, mat=M_GOLD, up=Nn)


def rope_line(P, pts, z_floor, collide=True, h=1.6):
    """Brass stanchions at `pts` (x, y) and a sagging red rope between each
    pair (the auction house's), with a collision fence along it `h` tall (a
    1-yd box would be a step the mover climbs)."""
    for (x, y) in pts:
        lathe(P, [(0.2, z_floor), (0.2, z_floor + 0.06), (0.06, z_floor + 0.12), (0.05, z_floor + 0.95),
                  (0.09, z_floor + 1.0), (0.0, z_floor + 1.1)], (x, y, 0.0), segs=8, mat=M_GOLD, cap_top=False)
    for (a, b) in zip(pts, pts[1:]):
        prev = None
        for k in range(7):
            f = k / 6
            q = Vector((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, z_floor + 0.92 - 0.22 * math.sin(math.pi * f)))
            if prev is not None:
                beam(P, prev, q, 0.05, 0.05, mat=M_PLASTER, tint=(0.62, 0.08, 0.07))
            prev = q
        if collide:
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            col_box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (z_floor + h) / 2, L / 2 + 0.12, 0.12, (z_floor + h) / 2,
                    math.atan2(b[1] - a[1], b[0] - a[0]))


# =============================================================================
#  THE VAULT DOOR (the bank; SPACEY, 2026-09-26: "have a massive vault door in
#  the building that opens when you click on it", after WoW's lion-head vault
#  door: "mix up the design and make it look super aaa")
# =============================================================================
# Parts whose names start G_MOV_ export as their own nodes, origin on their
# pivot, never merged at runtime (placed_assets STOREY_GROUP_NAMES 'G_MOV*'):
# render/placed_movers.ts swings / spins / slides them. MOVERS[name] = (pivot,
# parent mover name or None, motion) - the motion rides as the node's glTF
# extras `wocMover` ({kind: swing|spin|slide, axis, angle | dist}, glTF frame).
MOVERS = {}
VAULT_BRONZE = (0.36, 0.25, 0.18)         # the gold map tinted down to dark bronze
VAULT_GILT = (1.0, 0.92, 0.75)
VAULT_IRON = (0.34, 0.3, 0.28)


def ring_y(P, cx, y, cz, prof, face, segs=16, mat=M_GOLD, tint=None, phase=0.0, smooth=True, uv_fn=None):
    """Revolve (r, d) about the axis through (cx, cz) along y: `d` is the
    height off the plane y toward `face` (+-1); a ring at r=0 closes to a point."""
    rings = [[Vector((cx + math.cos(phase + TAU * i / segs) * r, y + face * d, cz + math.sin(phase + TAU * i / segs) * r))
              for i in range(segs)] for (r, d) in prof]
    for j in range(len(prof) - 1):
        for i in range(segs):
            a, b = rings[j][i], rings[j][(i + 1) % segs]
            c, d_ = rings[j + 1][(i + 1) % segs], rings[j + 1][i]
            if prof[j][0] < 1e-6 and prof[j + 1][0] < 1e-6:
                continue
            pts = [a, b, c] if prof[j + 1][0] < 1e-6 else ([a, c, d_] if prof[j][0] < 1e-6 else [a, b, c, d_])
            if face < 0:
                pts = pts[::-1]
            quad(P, [tuple(v) for v in pts], mat, tint=tint, smooth=smooth,
                 uvs=[uv_fn(v) for v in pts] if uv_fn else None)


def star_y(P, cx, y, cz, ro, ri, d0, d1, face, points=8, mat=M_GOLD, tint=None, rot=0.0):
    """A pointed star standing off the plane y (d0..d1 toward `face`): each
    point a convex kite on top, its edges closed down to d0."""
    n = points
    outer = [(cx + math.cos(rot + TAU * k / n) * ro, cz + math.sin(rot + TAU * k / n) * ro) for k in range(n)]
    inner = [(cx + math.cos(rot + TAU * (k + 0.5) / n) * ri, cz + math.sin(rot + TAU * (k + 0.5) / n) * ri) for k in range(n)]

    def v(p, d):
        return (p[0], y + face * d, p[1])
    ctr = (cx, cz)
    for k in range(n):
        a, b, c = inner[k - 1], outer[k], inner[k]
        kite = [v(ctr, d1 + 0.012), v(a, d1), v(b, d1), v(c, d1)]
        quad(P, kite if face > 0 else kite[::-1], mat, tint=tint)
        for (p0, p1) in ((a, b), (b, c)):
            side = [v(p0, d0), v(p1, d0), v(p1, d1), v(p0, d1)]
            quad(P, side if face > 0 else side[::-1], mat, tint=tint)


def ingot_y(P, x, y, z, face, w0=0.4, w1=0.28, h=0.15, depth=0.2, mat=M_GOLD, tint=None):
    """A gold ingot seen end-on from `face`: a trapezoid (w0 at the foot, w1
    at the top, h high) run `depth` back from the plane y."""
    prof = [(-w0 / 2, 0.0), (w0 / 2, 0.0), (w1 / 2, h), (-w1 / 2, h)]
    fr = [(x + a, y, z + b) for (a, b) in prof]
    bk = [(x + a * 0.92, y - face * depth, z + b * 0.96) for (a, b) in prof]
    quad(P, fr if face > 0 else fr[::-1], mat, tint=tint)
    for i in range(4):
        q = [fr[i], bk[i], bk[(i + 1) % 4], fr[(i + 1) % 4]]
        quad(P, q if face > 0 else q[::-1], mat, tint=tint)


def ingot_flat(P, x, y, z, rz=0.0, L=0.42, W=0.2, h=0.12, mat=M_GOLD, tint=None):
    """A gold ingot lying flat (a stack's brick), its long axis at `rz`."""
    c, s_ = math.cos(rz), math.sin(rz)

    def at(a, b, zz):
        return (x + a * c - b * s_, y + a * s_ + b * c, z + zz)
    bot = [at(-L / 2, -W / 2, 0), at(L / 2, -W / 2, 0), at(L / 2, W / 2, 0), at(-L / 2, W / 2, 0)]
    top = [at(-L / 2 * 0.8, -W / 2 * 0.72, h), at(L / 2 * 0.8, -W / 2 * 0.72, h), at(L / 2 * 0.8, W / 2 * 0.72, h),
           at(-L / 2 * 0.8, W / 2 * 0.72, h)]
    quad(P, top, mat, tint=tint)
    for i in range(4):
        quad(P, [bot[i], bot[(i + 1) % 4], top[(i + 1) % 4], top[i]], mat, tint=tint)


def ingot_stack(P, x, y, z, rows=3, rz=0.0, tint=VAULT_GILT):
    """A pyramid of ingots, crosswise course on course."""
    for r in range(rows):
        n = rows - r
        rot = rz + (math.pi / 2 if r % 2 else 0.0)
        for i in range(n):
            off = (i - (n - 1) / 2) * 0.23
            ingot_flat(P, x - math.sin(rot) * off, y + math.cos(rot) * off, z + r * 0.12, rot, tint=tint)


def coin_heap(P, cx, cy, z, R=0.95, H=0.5, n=170, seed=7):
    """A heap of loose coins (SPACEY, 2026-09-26: "make the gold pile coins
    only"): `n` flat six-sided coins laid over a low mound on a golden-angle
    spiral, each tilted to the slope with a little jitter and overlapping its
    neighbours; the mound under them is a darker gold, only seen in the gaps
    as more coin in shadow."""
    rng = random.Random(seed)
    k = 0.8

    def h(r):
        return H * max(0.0, 1.0 - (r / R) ** 2) ** k
    lathe(P, [((1.0 - i / 6) * R * 0.94, h((1.0 - i / 6) * R) * 0.9) for i in range(7)], (cx, cy, z), segs=12,
          mat=M_GOLD, tint=(0.62, 0.5, 0.34), cap_top=False)
    for i in range(n):
        t = math.sqrt((i + 0.5) / n)
        a = i * 2.399963
        r = t * R * 0.98
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
        # the slope's normal, jittered
        dr = 0.01
        g = (h(r + dr) - h(max(r - dr, 0.0))) / (2 * dr)
        nrm = Vector((-g * math.cos(a), -g * math.sin(a), 1.0)).normalized()
        nrm = (nrm + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0.0))).normalized()
        u = nrm.cross(Vector((0.0, 0.0, 1.0)) if abs(nrm.z) < 0.99 else Vector((1.0, 0.0, 0.0))).normalized()
        spin = rng.uniform(0, TAU)
        u = (u * math.cos(spin) + nrm.cross(u) * math.sin(spin)).normalized()
        v = nrm.cross(u)
        cr = rng.uniform(0.085, 0.11)
        c = Vector((x, y, z + h(r) + 0.012))
        top = [c + nrm * 0.012 + (u * math.cos(TAU * j / 6) + v * math.sin(TAU * j / 6)) * cr for j in range(6)]
        bot = [p - nrm * 0.024 for p in top]
        tint = tuple(q * rng.uniform(0.88, 1.08) for q in VAULT_GILT)
        quad(P, [tuple(p) for p in top], M_GOLD, tint=tint)
        for j in range(6):
            quad(P, [tuple(bot[j]), tuple(bot[(j + 1) % 6]), tuple(top[(j + 1) % 6]), tuple(top[j])], M_GOLD,
                 tint=(tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8))


def coin_stack(P, x, y, z, n=4, r=0.13, tint=None):
    """A stack of `n` coins as one eight-sided piece with a bevelled top."""
    hh = n * 0.036
    lathe(P, [(r, 0.0), (r, hh), (r * 0.88, hh + 0.01), (0.0, hh + 0.01)], (x, y, z), segs=8, mat=M_GOLD, tint=tint,
          cap_top=False, smooth=False)


def _scroll_y(P, cx, y, cz, r0, sx, sz, face, turns=1.3, mat=M_GOLD, tint=VAULT_GILT):
    """A gilt scroll on the plane y: a spiral from r0 in to the eye, opening
    toward (sx, sz) (the panel's corner), in short square beams."""
    pts = []
    n = 22
    a0 = math.atan2(sz, sx)
    for i in range(n + 1):
        t = i / n
        r = r0 * (1 - 0.8 * t)
        a = a0 + t * turns * TAU * (1 if sx * sz > 0 else -1)
        pts.append(Vector((cx + math.cos(a) * r, y + face * 0.02, cz + math.sin(a) * r)))
    for i in range(n):
        beam(P, pts[i], pts[i + 1] + (pts[i + 1] - pts[i]) * 0.15, 0.05, 0.045, mat=mat, up=Vector((0, face, 0)), tint=tint)
    ring_y(P, pts[-1].x, y, pts[-1].z, [(0.05, 0.02), (0.035, 0.05), (0.0, 0.055)], face, segs=8, mat=mat, tint=tint)


def vault_door(P_frame, cx, yf, z0, W=2.8, H=3.5, T=0.42, face=1, hs=1, grp='INT_L0', swing=90.0):
    """The vault door on the wall plane yf, its show face toward `face`: a
    heavy bronze leaf hung on three barrel hinges on the `hs` side (+1 = +x),
    a raised band studded with gilt rivets, gilt corner scrolls, the Tidehold
    crest as a medallion (a gold star and waves on blue enamel) where WoW has
    its lion, a spoked wheel, four locking bolts in the free edge and the bolt
    works on its back; a dressed stone portal with a keystone and the gold-bar
    plaque above. The leaf, its wheel and its bolts are MOVERS (their own
    nodes) carrying their motion as glTF extras: returns the leaf's pivot."""
    up = Vector((0, 0, 1))
    n = Vector((0, face, 0))
    xh, xf = cx + hs * W / 2, cx - hs * W / 2          # the hinge edge, the free edge
    pivot = Vector((xh, yf, z0))
    D = part('G_MOV_vault_door', grp=grp)
    # glTF motion: a Blender turn about +z is a turn about glTF +y; opening
    # swings the free edge out toward `face`
    MOVERS['G_MOV_vault_door'] = (pivot, None, {'kind': 'swing', 'axis': 'y',
                                               'angle': round(-hs * face * math.radians(swing), 4)})
    b = VAULT_BRONZE
    dark = (b[0] * 0.62, b[1] * 0.62, b[2] * 0.62)
    # ---- the leaf ----------------------------------------------------------
    cuboid(D, (cx, yf - face * T / 2, z0 + H / 2), (W, T, H), M_GOLD, tint=dark)
    bw = 0.28
    # the raised band: rails 10 cm proud, stiles 8 (never a shared face)
    for zc in (z0 + bw / 2, z0 + H - bw / 2):
        cuboid(D, (cx, yf + face * 0.05, zc), (W, 0.1, bw), M_GOLD, tint=b)
    for xc in (cx - W / 2 + bw / 2, cx + W / 2 - bw / 2):
        cuboid(D, (xc, yf + face * 0.04, z0 + H / 2), (bw, 0.08, H - 2 * bw + 0.02), M_GOLD, tint=b)
    stud = [(0.045, 0.0), (0.036, 0.022), (0.0, 0.032)]
    k = int((W - 0.2) / 0.28)
    for zc in (z0 + bw / 2, z0 + H - bw / 2):
        for i in range(k + 1):
            ring_y(D, cx - W / 2 + 0.1 + i * (W - 0.2) / k, yf + face * 0.1, zc, stud, face, segs=6, tint=VAULT_GILT)
    k = int((H - 2 * bw - 0.2) / 0.28)
    for xc in (cx - W / 2 + bw / 2, cx + W / 2 - bw / 2):
        for i in range(k + 1):
            ring_y(D, xc, yf + face * 0.08, z0 + bw + 0.1 + i * (H - 2 * bw - 0.2) / k, stud, face, segs=6,
                   tint=VAULT_GILT)
    # the inner gilt moulding and its corner scrolls (the wheel has the fourth)
    m = 0.46
    ix0, ix1, iz0, iz1 = cx - W / 2 + m, cx + W / 2 - m, z0 + m, z0 + H - m
    for zz in (iz0, iz1):
        beam(D, (ix0 - 0.035, yf + face * 0.03, zz), (ix1 + 0.035, yf + face * 0.03, zz), 0.07, 0.06, mat=M_GOLD,
             up=n, tint=VAULT_GILT)
    for xx in (ix0, ix1):
        beam(D, (xx, yf + face * 0.025, iz0 + 0.035), (xx, yf + face * 0.025, iz1 - 0.035), 0.07, 0.05, mat=M_GOLD,
             up=n, tint=VAULT_GILT)
    wheel_sx = -hs                                    # the wheel's corner: the free side, low
    for (sx, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        if (sx, sz) == (wheel_sx, -1):
            continue
        _scroll_y(D, (ix0 if sx < 0 else ix1) - sx * 0.3, yf, (iz0 if sz < 0 else iz1) - sz * 0.3, 0.2, sx, sz, face)
    # the medallion: a bronze rim, blue enamel, a ring of studs, the crest in gold
    mz = z0 + H * 0.6
    ring_y(D, cx, yf, mz, [(0.94, 0.0), (0.94, 0.08), (0.88, 0.12), (0.8, 0.12)], face, segs=24, tint=b)

    def enamel(p):
        return cell_uv('crest', 0.14 + 0.1 * (p.x - cx + 0.8) / 1.6, 0.74 + 0.1 * (p.z - mz + 0.8) / 1.6)
    ring_y(D, cx, yf, mz, [(0.8, 0.12), (0.76, 0.1), (0.0, 0.13)], face, segs=24, mat=M_ATLAS, tint=(1, 1, 1),
           uv_fn=enamel)
    for kk in range(16):
        a = TAU * kk / 16
        ring_y(D, cx + math.cos(a) * 0.87, yf + face * 0.12, mz + math.sin(a) * 0.87, [(0.035, 0.0), (0.028, 0.018),
               (0.0, 0.026)], face, segs=6, tint=VAULT_GILT)
    star_y(D, cx, yf, mz + 0.12, 0.5, 0.2, 0.1, 0.19, face, tint=(1.05, 0.95, 0.72), rot=math.pi / 2)
    for (kk, dz) in enumerate((-0.36, -0.5)):
        pts = [Vector((cx - 0.48 + 0.096 * i, yf + face * 0.14, mz + dz + 0.035 * math.sin(i * 1.3 + kk)))
               for i in range(11)]
        for i in range(10):
            beam(D, pts[i], pts[i + 1] + (pts[i + 1] - pts[i]) * 0.1, 0.05, 0.05, mat=M_GOLD, up=n, tint=VAULT_GILT)
    # hinge straps across the leaf from the hinge edge (knuckles on the frame)
    hz = (z0 + 0.55, z0 + H / 2, z0 + H - 0.55)
    for (z, sl) in zip(hz, (0.9, 0.45, 0.9)):           # (the middle one stops short of the medallion)
        cuboid(D, (xh - hs * sl / 2, yf + face * 0.13, z), (sl, 0.06, 0.22), M_IRON, tint=VAULT_IRON)
        cuboid(D, (xh - hs * (sl + 0.03), yf + face * 0.13, z), (0.14, 0.06, 0.34), M_IRON, tint=VAULT_IRON)
        for x in (xh - hs * 0.25, xh - hs * (sl - 0.15)):
            ring_y(D, x, yf + face * 0.16, z, [(0.04, 0.0), (0.03, 0.02), (0.0, 0.03)], face, segs=6, tint=VAULT_GILT)
    # the back (seen when it stands open): the bolt works, a gear hub, rods
    # out to the four bolts, a riveted border
    yb = yf - face * T
    ring_y(D, cx, yb, mz - 0.4, [(0.55, 0.0), (0.55, 0.08), (0.42, 0.1), (0.0, 0.12)], -face, segs=16, tint=b)
    for kk in range(12):
        a = TAU * kk / 12
        ring_y(D, cx + math.cos(a) * 0.62, yb - face * 0.0, mz - 0.4 + math.sin(a) * 0.62,
               [(0.08, 0.0), (0.08, 0.07), (0.0, 0.07)], -face, segs=6, tint=b)
    bz = (z0 + 0.6, z0 + 1.35, z0 + H - 1.35, z0 + H - 0.6)
    for z in bz:
        beam(D, (cx, yb - face * 0.07, (z + mz - 0.4) / 2), (xf + hs * 0.15, yb - face * 0.07, z), 0.1, 0.08,
             mat=M_IRON, up=n, tint=VAULT_IRON)
        ring_y(D, xf + hs * 0.15, yb, z, [(0.1, 0.0), (0.1, 0.1), (0.0, 0.1)], -face, segs=8, tint=VAULT_GILT)
    for zz in (z0 + 0.2, z0 + H - 0.2):
        beam(D, (cx - W / 2 + 0.1, yb - face * 0.03, zz), (cx + W / 2 - 0.1, yb - face * 0.03, zz), 0.16, 0.06,
             mat=M_GOLD, up=n, tint=b)
    for xx in (cx - W / 2 + 0.2, cx + W / 2 - 0.2):
        beam(D, (xx, yb - face * 0.025, z0 + 0.1), (xx, yb - face * 0.025, z0 + H - 0.1), 0.16, 0.05, mat=M_GOLD,
             up=n, tint=b)
    # ---- the wheel (spins as the door unlocks) --------------------------------
    wx, wz = cx + wheel_sx * (W / 2 - m - 0.38), z0 + m + 0.42
    Wh = part('G_MOV_vault_wheel', grp=grp)
    MOVERS['G_MOV_vault_wheel'] = (Vector((wx, yf, wz)), 'G_MOV_vault_door',
                                   {'kind': 'spin', 'axis': 'z', 'angle': round(3 * math.pi * hs, 4)})
    ring_y(D, wx, yf, wz, [(0.08, 0.0), (0.08, 0.2)], face, segs=8, tint=b)                    # the axle (on the leaf)
    ring_y(Wh, wx, yf + face * 0.19, wz, [(0.12, 0.0), (0.12, 0.08), (0.0, 0.08)], face, segs=6, tint=VAULT_GILT)
    rim = [Vector((wx + math.cos(TAU * kk / 8 + TAU / 16) * 0.38, yf + face * 0.23, wz + math.sin(TAU * kk / 8 + TAU / 16) * 0.38))
           for kk in range(8)]
    for kk in range(8):
        a_, b_ = rim[kk], rim[(kk + 1) % 8]
        beam(Wh, a_ - (b_ - a_) * 0.06, b_ + (b_ - a_) * 0.06, 0.07, 0.07, mat=M_GOLD, up=n, tint=b)
    for kk in range(4):
        a = TAU * kk / 4
        beam(Wh, (wx, yf + face * 0.225, wz), (wx + math.cos(a) * 0.36, yf + face * 0.225, wz + math.sin(a) * 0.36),
             0.05, 0.05, mat=M_GOLD, up=n, tint=b)
        ring_y(Wh, wx + math.cos(a + TAU / 16) * 0.38, yf + face * 0.26, wz + math.sin(a + TAU / 16) * 0.38,
               [(0.05, 0.0), (0.04, 0.03), (0.0, 0.04)], face, segs=6, tint=VAULT_GILT)
    # ---- the locking bolts (slide back into the leaf as it unlocks) -----------
    Bo = part('G_MOV_vault_bolts', grp=grp)
    MOVERS['G_MOV_vault_bolts'] = (Vector((xf, yf, z0)), 'G_MOV_vault_door',
                                   {'kind': 'slide', 'axis': 'x', 'dist': round(0.3 * hs, 3)})
    for z in bz:
        beam(Bo, (xf + hs * 0.12, yf - face * T / 2, z), (xf - hs * 0.26, yf - face * T / 2, z), 0.16, 0.16,
             mat=M_GOLD, up=up, tint=VAULT_GILT)
    # ---- the frame: jamb lining, hinge knuckles, the portal, the plaque ---------
    F = P_frame
    jt = 0.08
    for xx in (cx - W / 2 - 0.02 - jt / 2, cx + W / 2 + 0.02 + jt / 2):
        cuboid(F, (xx, yf - face * 0.22, z0 + (H + 0.04) / 2), (jt, 0.46, H + 0.04), M_IRON, tint=VAULT_IRON)
    cuboid(F, (cx, yf - face * 0.22, z0 + H + 0.02 + jt / 2), (W + 0.04 + 2 * jt, 0.46, jt), M_IRON, tint=VAULT_IRON)
    for z in hz:
        lathe(F, [(0.13, -0.3), (0.13, 0.3)], (xh, yf, z), segs=10, mat=M_GOLD, tint=b, cap_top=True, cap_bottom=True)
        for sgn in (-1, 1):
            lathe(F, [(0.1, 0.0), (0.07, 0.07), (0.0, 0.1)] if sgn > 0 else [(0.0, -0.1), (0.07, -0.07), (0.1, 0.0)],
                  (xh, yf, z + sgn * 0.3), segs=8, mat=M_GOLD, tint=VAULT_GILT, cap_top=False)
        cuboid(F, (xh + hs * 0.2, yf + face * 0.03, z), (0.3, 0.06, 0.24), M_IRON, tint=VAULT_IRON)
    pw, pd = 0.72, 0.34
    zl = z0 + H + 0.1
    for sgn in (-1, 1):
        px = cx + sgn * (W / 2 + 0.1 + jt + pw / 2)
        cuboid(F, (px, yf + face * (pd / 2 - 0.02), z0 + 0.2), (pw + 0.16, pd + 0.1, 0.4), M_DRESSED)
        cuboid(F, (px, yf + face * (pd / 2 - 0.02), (z0 + 0.4 + zl - 0.3) / 2), (pw, pd, zl - 0.3 - z0 - 0.4), M_DRESSED,
               faces={'-x', '+x', '-y', '+y'})
        cuboid(F, (px, yf + face * (pd / 2 - 0.02), zl - 0.15), (pw + 0.14, pd + 0.08, 0.3), M_DRESSED,
               tint=(0.95, 0.95, 0.97))
    LW = W + 2 * (0.1 + jt + pw) + 0.3
    cuboid(F, (cx, yf + face * (pd / 2 + 0.01), zl + 0.24), (LW, pd + 0.06, 0.48), M_DRESSED)
    cuboid(F, (cx, yf + face * (pd / 2 + 0.06), zl + 0.3), (0.56, pd + 0.1, 0.72), M_DRESSED, tint=(1.0, 0.98, 0.94))
    # the plaque: an iron-framed case with three gold bars on its shelf
    pz = zl + 0.62
    cuboid(F, (cx, yf + face * 0.1, pz + 0.36), (1.7, 0.2, 0.72), M_IRON, tint=VAULT_IRON)
    quad(F, [(cx - 0.72, yf + face * 0.205, pz + 0.08), (cx + 0.72, yf + face * 0.205, pz + 0.08),
             (cx + 0.72, yf + face * 0.205, pz + 0.64), (cx - 0.72, yf + face * 0.205, pz + 0.64)][:: face], M_DARK)
    cuboid(F, (cx, yf + face * 0.27, pz + 0.06), (1.5, 0.14, 0.06), M_GOLD, tint=b)
    for (x, z) in ((-0.24, pz + 0.09), (0.24, pz + 0.09), (0.0, pz + 0.26)):
        ingot_y(F, cx + x, yf + face * 0.32, z, face, w0=0.42, w1=0.3, h=0.16, depth=0.1, tint=VAULT_GILT)
    return pivot


# =============================================================================
#  SHOP FURNITURE: street stalls, counters, wall shelves
# =============================================================================
def street_stall(P, x0, x1, yw, awning_z=None, front_z=None, depth=2.7, tints=((1.0, 1.0, 1.0), (0.35, 0.45, 0.9)),
                 cell=None):
    """A market stall on the street in front of a shop's north wall (yw = the
    wall line, the street is +y). SPACEY (2026-09-26): the old counter FLOATED
    at floor height against the wall - "some1 could fit behind those stalls
    and it touches the ground". So: an awning on two timber posts that stand
    on stone pads in the street, a ledger on the wall; under it a counter on
    four legs with its back edge 1.4 yd off the wall (the stallholder's
    aisle), a lower shelf for crates, a cloth over its front edge and a
    painted price plaque. Returns (counter x0, x1, y0, y1, top z) for goods."""
    zw = awning_z if awning_z is not None else FL + 3.35
    zf = front_z if front_z is not None else FL + 2.5
    py = yw + depth - 0.2
    for px in (x0 + 0.14, x1 - 0.14):
        cuboid(P, (px, py, 0.02), (0.38, 0.38, 0.2), M_DRESSED, faces={'-x', '+x', '-y', '+y', '+z'})
        lathe(P, [(0.12, -0.35), (0.12, 0.22), (0.1, 0.3), (0.1, zf - 0.28), (0.13, zf - 0.16), (0.11, zf)],
              (px, py, 0.0), segs=8, mat=M_TIMBER, smooth=False)
        col_box(px, py, zf / 2, 0.16, 0.16, zf / 2)
    beam(P, (x0 - 0.08, py, zf), (x1 + 0.08, py, zf), 0.2, 0.2)                 # the front beam on the posts
    beam(P, (x0, yw + 0.09, zw + 0.02), (x1, yw + 0.09, zw + 0.02), 0.16, 0.2)   # the ledger on the wall
    # striped canvas from the ledger over the beam, a scalloped valance
    NS = max(4, int(round((x1 - x0) / 0.55)))
    # the canvas runs from the ledger's top edge to 2 cm over the beam
    y_led, z_led = yw + 0.17, zw + 0.13
    slope = (zf + 0.12 - z_led) / (py - y_led)
    y_edge = yw + depth
    z_edge = zf + 0.12 + slope * (y_edge - py)
    for i in range(NS):
        xa = x0 + (x1 - x0) * i / NS
        xb = x0 + (x1 - x0) * (i + 1) / NS
        tint = tints[i % 2]
        q = [(xa, y_led, z_led), (xb, y_led, z_led), (xb, y_edge, z_edge), (xa, y_edge, z_edge)]
        quad(P, q[::-1], M_PLASTER, tint=tint)
        quad(P, q, M_PLASTER, tint=tuple(c * 0.7 for c in tint))
        tri = [(xa, y_edge, z_edge), (xb, y_edge, z_edge), ((xa + xb) / 2, y_edge, z_edge - 0.4)]
        quad(P, tri[::-1], M_PLASTER, tint=tint)
        quad(P, tri, M_PLASTER, tint=tuple(c * 0.7 for c in tint))
    # the counter
    cx0, cx1 = x0 + 0.34, x1 - 0.34
    cy0, cy1 = yw + 1.4, yw + 2.05
    zt = 1.0
    for lx in (cx0 + 0.07, cx1 - 0.07):
        for ly in (cy0 + 0.07, cy1 - 0.07):
            cuboid(P, (lx, ly, (zt - 0.07 - 0.35) / 2), (0.12, 0.12, zt - 0.07 + 0.35), M_TIMBER,
                   faces={'-x', '+x', '-y', '+y'})
    cuboid(P, ((cx0 + cx1) / 2, (cy0 + cy1) / 2, zt - 0.035), (cx1 - cx0 + 0.14, cy1 - cy0 + 0.12, 0.08), M_FLOOR,
           tint=OAK_BOARD_TINT)
    cuboid(P, ((cx0 + cx1) / 2, cy1, (zt - 0.075 + 0.28) / 2), (cx1 - cx0 - 0.1, 0.04, zt - 0.075 - 0.28),
           M_FLOOR, tint=(0.62, 0.48, 0.35))                                       # front skirt, 3 cm proud of the legs
    cuboid(P, ((cx0 + cx1) / 2, (cy0 + cy1) / 2, 0.33), (cx1 - cx0 - 0.26, cy1 - cy0 - 0.26, 0.05), M_FLOOR,
           tint=(0.7, 0.55, 0.4))                                                  # lower shelf
    # a cloth over the front edge, in the awning's colour
    ct = tints[1]                          # the awning's canvas (the cloth map is blue: a red runner went navy)
    zr, yr = zt + 0.022, cy1 + 0.085          # 1.7 / 2.5 cm off the board (no shared plane)
    quad(P, [(cx0 + 0.2, cy1 - 0.35, zr), (cx1 - 0.2, cy1 - 0.35, zr),
             (cx1 - 0.2, yr, zr), (cx0 + 0.2, yr, zr)], M_PLASTER, tint=ct)
    quad(P, [(cx0 + 0.2, yr, zt - 0.32), (cx1 - 0.2, yr, zt - 0.32),
             (cx1 - 0.2, yr, zr), (cx0 + 0.2, yr, zr)][::-1], M_PLASTER, tint=ct)
    if cell:
        # the shop's own sign icon on a little board hung on the skirt
        mx = (cx0 + cx1) / 2
        cuboid(P, (mx, cy1 + 0.04, 0.47), (0.46, 0.03, 0.36), M_TIMBER, faces={'-x', '+x', '+y', '-z', '+z'})
        pq = [(mx - 0.19, cy1 + 0.072, 0.31), (mx + 0.19, cy1 + 0.072, 0.31), (mx + 0.19, cy1 + 0.072, 0.63),
              (mx - 0.19, cy1 + 0.072, 0.63)]
        puv = [cell_uv(cell, 0.12, 0.12), cell_uv(cell, 0.88, 0.12), cell_uv(cell, 0.88, 0.88), cell_uv(cell, 0.12, 0.88)]
        quad(P, pq[::-1], M_ATLAS, uvs=puv[::-1], tint=(1, 1, 1))              # facing the street
    col_box((cx0 + cx1) / 2, (cy0 + cy1) / 2, zt / 2, (cx1 - cx0) / 2 + 0.07, (cy1 - cy0) / 2 + 0.06, zt / 2)
    return cx0, cx1, cy0, cy1, zt


def shop_counter(P, x0, x1, y_front, z_floor, depth=0.8, h=1.1):
    """A shop counter across a room, its customer face toward +y: a kick
    base, a boarded front, a thick oak top with an overhang, end panels and
    a shelf behind for the shopkeeper. Returns the top z."""
    ym = y_front - depth / 2
    zt = z_floor + h
    cuboid(P, ((x0 + x1) / 2, ym + 0.03, z_floor + 0.07), (x1 - x0 - 0.06, depth - 0.12, 0.14), M_TIMBER,
           tint=(0.55, 0.5, 0.46), faces={'-x', '+x', '-y', '+y', '+z'})
    cuboid(P, ((x0 + x1) / 2, ym, z_floor + 0.14 + (h - 0.22) / 2), (x1 - x0, depth - 0.04, h - 0.22), M_FLOOR,
           tint=OAK_BOARD_TINT, faces={'-x', '+x', '-y', '+y'})
    cuboid(P, ((x0 + x1) / 2, ym + 0.02, zt - 0.045), (x1 - x0 + 0.14, depth + 0.1, 0.09), M_TIMBER)
    # framed panels on the customer face
    k = max(2, int((x1 - x0) / 1.1))
    for i in range(k + 1):
        xx = x0 + (x1 - x0) * i / k
        beam(P, (xx, y_front + 0.005, z_floor + 0.16), (xx, y_front + 0.005, zt - 0.1), 0.1, 0.05, up=Vector((0, 1, 0)))
    beam(P, (x0, y_front + 0.03, zt - 0.16), (x1, y_front + 0.03, zt - 0.16), 0.08, 0.05, up=Vector((0, 1, 0)))
    # the back shelf (the shopkeeper's side)
    cuboid(P, ((x0 + x1) / 2, y_front - depth + 0.02, z_floor + 0.55), (x1 - x0 - 0.2, 0.32, 0.05), M_FLOOR,
           tint=(0.7, 0.55, 0.4))
    col_box((x0 + x1) / 2, ym, (z_floor + zt) / 2, (x1 - x0) / 2 + 0.07, depth / 2 + 0.05, (zt - z_floor) / 2)
    return zt


def wall_shelves(P, x0, x1, y_wall, z_floor, levels=(1.0, 1.6, 2.2, 2.8), depth=0.42, face=1):
    """Plank shelves along a wall (y_wall = the wall's inner face, the room on
    the `face` side): oak uprights, boards, a top cornice. Returns the shelf
    surfaces [(z, y_centre)] for goods."""
    yf = y_wall + face * depth
    yc = y_wall + face * depth / 2
    k = max(1, int(round((x1 - x0) / 1.7)))
    top = z_floor + levels[-1] + 0.6                 # the top shelf as tall as the rest
    for i in range(k + 1):
        xx = x0 + (x1 - x0) * i / k
        cuboid(P, (xx, yc, (z_floor + top) / 2), (0.1, depth, top - z_floor), M_TIMBER, faces={'-x', '+x', '+y', '-y', '+z'})
    out = []
    for lv in levels:
        z = z_floor + lv
        cuboid(P, ((x0 + x1) / 2, yc - face * 0.005, z - 0.03), (x1 - x0 + 0.02, depth - 0.09, 0.06), M_FLOOR,
               tint=OAK_BOARD_TINT)                    # 3 cm short of the uprights' faces, front and back
        out.append((z, yc))
    cuboid(P, ((x0 + x1) / 2, yc + face * 0.03, top + 0.05), (x1 - x0 + 0.24, depth + 0.08, 0.1), M_TIMBER)
    col_box((x0 + x1) / 2, yc, (z_floor + top) / 2, (x1 - x0) / 2 + 0.06, depth / 2, (top - z_floor) / 2)
    return out


# =============================================================================
#  KIT PROPS (medieval_village_v2)
# =============================================================================
_KIT_CACHE = {}
PROP_S = 1.8          # kit units -> yards (the scale the old builds used)


# Small clutter reads the same at LOD2 (a cup is ~850 tris at LOD0); big
# furniture keeps LOD1, which is still modelled detail at room distance.
LOD2_PROPS = ('Cup_', 'Bottle_', 'Candle_', 'PlateFood_', 'Plate_', 'Book_', 'Potion_', 'Scroll_', 'Food_',
              'Spoon_', 'Ink_', 'Bag_', 'Box_', 'Firewood_', 'Pot_')


def _kit_template(rel):
    """Import a kit GLB once (the LOD that suits the prop), return its mesh."""
    if rel in _KIT_CACHE:
        return _KIT_CACHE[rel]
    base = rel.split('/')[-1]
    want = 'LOD2' if base.startswith(LOD2_PROPS) else 'LOD1'
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=KIT + '/' + rel + '.glb')
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    # every mesh of the chosen LOD: a kit prop can come in PARTS (Chest_01 is
    # its box `Chest_01_LOD*` and its lid `Chest_01_2_LOD*`; taking the first
    # alone put a bare lid on the floor - SPACEY, 2026-09-26: "fix the chests")
    keeps = [o for o in meshes if want in o.name]
    if not keeps:
        keeps = [o for o in meshes if 'LOD1' in o.name]
    if not keeps:
        keeps = [next((o for o in meshes if 'LOD1' not in o.name and 'LOD2' not in o.name), meshes[0] if meshes else None)]
    for o in new:
        if o not in keeps:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in keeps:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    keep = keeps[0]
    if len(keeps) > 1:
        for o in bpy.context.scene.objects:
            o.select_set(o in keeps)
        bpy.context.view_layer.objects.active = keep
        bpy.ops.object.join()
    # canonical kit material (every kit GLB embeds its own copy)
    for i, slot in enumerate(keep.material_slots):
        m = slot.material
        if m and m.name.startswith('CartoonTown'):
            canon = bpy.data.materials.get('town_kit') or m
            if canon is m:
                m.name = 'town_kit'
            keep.material_slots[i].material = canon
    # one UV layer named 'UVMap' and one white corner 'Col' (the parts'
    # layers): a join matches layers by name and FILLS a missing one, which
    # would multiply the kit atlas by zero; the kit's own TEXCOORD_1 and byte
    # COLOR_0/1 go
    me = keep.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for d in col.data:
        d.color = (1.0, 1.0, 1.0, 1.0)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    # its lowest point: prop() seats a prop ON it (kit origins vary: Box_02 is
    # centred, the cauldron hangs from its rim, the chest's origin is below
    # it, so a prop placed at floor height sank or floated)
    keep['minz'] = min((v.co.z for v in me.vertices), default=0.0)
    if PROP_DETAIL:
        n = detail_prop_template(keep, rel)
        if n:
            log(f'  prop detail {base}: ' + ', '.join(f'{k} {v}' for k, v in sorted(PROP_TALLY[base].items())))
    for c in list(keep.users_collection):
        c.objects.unlink(keep)
    _KIT_CACHE[rel] = keep
    return keep


# ---------------------------------------------------------------------------
#  prop detail (v2): the palette props onto tiling wood / iron / stone / cloth
# ---------------------------------------------------------------------------
# The kit's atlas is a PALETTE: a face's UV footprint is a tenth of a texel,
# so a cupboard is one flat brown. Each flat face moves onto one of four
# tiling DETAIL materials (town_tex_v2/paint_props.py: luminance high passes,
# linear mean 1.0, stored / PROP_HEADROOM) with box UVs in the template's own
# frame, and its ORIGINAL swatch goes into 'Col' x PROP_HEADROOM, which three
# multiplies over the map: the palette is kept, the surface gets grain, peen
# marks, weave. Faces UV-mapped ACROSS the atlas (the quilts, the market
# signs) and the small clutter stay on it. TOWN_TEX=v1 skips the pass.
PROP_DETAIL = TEX_SET != 'v1'
PROP_HEADROOM = 1.45
# repeats per kit unit (a prop is placed at PROP_S = 1.8 yd a unit): a wood
# tile spans 0.9 yd (a board ~0.18), iron 0.7, stone 1.6, cloth 0.6
PROP_K = {'wood': 2.0, 'metal': 2.6, 'stone': 1.1, 'cloth': 3.0}
# clutter too small for a map to read (and food, glass, pages: not these four)
PROP_SKIP = ('Food_', 'Potion_', 'Bottle_', 'Book_', 'Cup_', 'PlateFood_', 'Candle_04')
# grey is iron by default; these props' greys are masonry (the lecterns, the
# forge's ring of blocks, the furnace)
PROP_STONE = ('Altar_', 'Blacksmith_02', 'Blacksmith_03')
# families whose saturated colours are fabric (carpets, awnings, the bench
# runner, blankets, tablecloths, sacks)
PROP_CLOTH = ('Carpet_', 'Market_', 'Bed_', 'Bag_', 'Furniture_12', 'Table_')
# the kit spends these orange-tans on fabric, not timber (measured: Bed_02/03
# blanket, Table_01 cloth, Table_02 runner, the sacks)
CLOTH_SWATCH = ((204, 130, 86), (212, 136, 90), (206, 131, 86), (209, 133, 88), (171, 91, 59),
                (170, 91, 59), (168, 89, 58), (142, 98, 52))
PROP_TALLY = {}
_ATLAS_PX = {}


def _kit_atlas(mat):
    """The kit palette as a numpy array (sRGB-encoded floats, rows bottom-up
    like UV v), cached per image."""
    import numpy as np
    img = next((n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None) if mat else None
    if img is None:
        return None
    if img.name not in _ATLAS_PX:
        w, h = img.size
        _ATLAS_PX[img.name] = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    return _ATLAS_PX[img.name]


def _prop_class(c, base):
    """wood / metal / stone / cloth, or None to leave the face on the atlas.
    `c` = the swatch in 0..255 sRGB."""
    r, g, b = c
    mx, mn = max(c), min(c)
    sat = (mx - mn) / mx if mx > 0 else 0.0
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    if lum < 0.13:
        return None                      # the kit's drawn line art / soot
    cloth_fam = base.startswith(PROP_CLOTH)
    if cloth_fam and any(max(abs(c[i] - s[i]) for i in range(3)) <= 4 for s in CLOTH_SWATCH):
        return 'cloth'
    if sat <= 0.2:
        if lum <= 0.62:
            return 'stone' if base.startswith(PROP_STONE) else 'metal'
        return 'cloth' if base.startswith(('Market_', 'Bed_')) else None     # awning stripes, linen
    if r >= g >= b and 0.4 <= sat <= 0.85 and (g - b) >= 0.25 * (mx - mn) and lum <= 0.62:
        return 'cloth' if base.startswith('Bag_') else 'wood'
    return 'cloth' if cloth_fam else None


def prop_mats():
    return {
        'wood': tex_mat('town_pwood', 'TownPropWood_Color.jpg', 'TownPropWood_Normal.jpg', rough=0.78, nstr=0.8),
        # no ORM map: the glTF exporter packs a metal/rough image and the
        # occlusion mask into ONE per-building image (1 MB a building), and
        # the smart shader would read its G/B as grime and edge wear
        'metal': tex_mat('town_pmetal', 'TownPropMetal_Color.jpg', 'TownPropMetal_Normal.jpg', rough=0.45,
                         metal=0.55, nstr=0.7),
        'stone': tex_mat('town_pstone', 'TownPropStone_Color.jpg', 'TownPropStone_Normal.jpg', rough=0.88, nstr=0.8),
        'cloth': tex_mat('town_pcloth', 'TownPropCloth_Color.jpg', 'TownPropCloth_Normal.jpg', rough=0.95, nstr=0.6),
    }


def _srgb8_to_lin(v):
    v = v / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def detail_prop_template(keep, rel):
    """Retexture one kit template in place (every placed copy shares it).
    Returns the number of faces moved."""
    base = rel.split('/')[-1]
    if base.startswith(PROP_SKIP):
        return 0
    me = keep.data
    if not me.materials or not me.uv_layers:
        return 0
    kit_slots = {i for i, m in enumerate(me.materials) if m and m.name == 'town_kit'}
    atlas = _kit_atlas(bpy.data.materials.get('town_kit'))
    if not kit_slots or atlas is None:
        return 0
    H, W = atlas.shape[:2]
    uvl = me.uv_layers['UVMap'].data

    def samp(u, v):
        return atlas[int((v % 1.0) * H) % H, int((u % 1.0) * W) % W]
    plan = {}
    for p in me.polygons:
        if p.material_index not in kit_slots:
            continue
        us = [uvl[li].uv for li in p.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        c = samp(cu, cv)
        # 25% in from each corner: a face UV'd ACROSS the atlas is not one swatch
        if any(max(abs(float(s) - float(t)) for s, t in zip(samp(cu + (u.x - cu) * .75, cv + (u.y - cv) * .75), c)) > 0.035
               for u in us):
            continue
        c8 = tuple(int(round(float(x) * 255)) for x in c)
        kind = _prop_class(c8, base)
        if kind:
            plan[p.index] = (kind, c8)
    if not plan:
        return 0
    mats = prop_mats()
    slot = {}
    for kind in sorted({k for k, _ in plan.values()}):
        me.materials.append(mats[kind])
        slot[kind] = len(me.materials) - 1
    col = me.color_attributes['Col']
    # a per-template offset into the tiles: two kinds of cupboard never share grain
    h = sum(ord(ch) * (i + 1) for i, ch in enumerate(base))
    ou, ov = (h % 97) / 97.0, (h % 89) / 89.0
    tally = {}
    for p in me.polygons:
        ent = plan.get(p.index)
        if ent is None:
            continue
        kind, c8 = ent
        p.material_index = slot[kind]
        tint = tuple(min(1.0, _srgb8_to_lin(x) * PROP_HEADROOM) for x in c8)
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]       # vertical faces: (x|y, z) -> z runs up V
        co = [me.vertices[me.loops[li].vertex_index].co for li in p.loop_indices]
        if kind == 'wood':
            # the grain runs down V: a member's LONG side takes V (a leg's
            # grain runs up it, a shelf's along it)
            if (max(q[a] for q in co) - min(q[a] for q in co)) > (max(q[b] for q in co) - min(q[b] for q in co)):
                a, b = b, a
        k = PROP_K[kind]
        for li, q in zip(p.loop_indices, co):
            uvl[li].uv = (q[a] * k + ou, q[b] * k + ov)
            col.data[li].color = (tint[0], tint[1], tint[2], 1.0)
        tally[kind] = tally.get(kind, 0) + 1
    PROP_TALLY[base] = tally
    lifted = _lift_decals(me, set(plan), kit_slots)
    if lifted:
        tally['decal lift'] = lifted
    return len(plan)


def _lift_decals(me, moved, kit_slots, lift=0.006):
    """Faces LEFT on the atlas that lie flat on a face the pass moved (the
    notice board's paper notes on its planks) were one draw with it: equal
    depth, stable order. Split into two materials they z-fight (SPACEY,
    2026-09-26: "this sign is z fighting make sure the notes on the sign are
    clean and visible"). Split such a face off its neighbours and lift it
    `lift` kit units (~1 cm placed) along its normal."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    movers = [f for f in bm.faces if f.index in moved]
    if not movers:
        bm.free()
        return 0

    def bounds(f):
        cs = [v.co for v in f.verts]
        return [min(c[i] for c in cs) for i in range(3)], [max(c[i] for c in cs) for i in range(3)]
    mb = [(f, f.normal.copy(), f.calc_center_median(), bounds(f)) for f in movers]
    hits = []
    for f in bm.faces:
        if f.index in moved or f.material_index not in kit_slots:
            continue
        n = f.normal
        c = f.calc_center_median()
        lo, hi = bounds(f)
        for (g, gn, gc, (glo, ghi)) in mb:
            if n.dot(gn) < 0.999 or abs((c - gc).dot(gn)) > 1e-3:
                continue
            if all(lo[i] <= ghi[i] + 1e-4 and hi[i] >= glo[i] - 1e-4 for i in range(3)):
                hits.append(f)
                break
    if hits:
        # the whole paper (its raised pen strokes too), not only its base
        seen = set(hits)
        stack = list(hits)
        while stack:
            f = stack.pop()
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen and g.index not in moved and g.material_index in kit_slots:
                        seen.add(g)
                        stack.append(g)
        hits = list(seen)
        res = bmesh.ops.split(bm, geom=hits)
        faces = [e for e in res['geom'] if isinstance(e, bmesh.types.BMFace)]
        for f in faces:
            f.normal_update()
            d = f.normal * lift
            for v in f.verts:
                v.co += d
        bm.to_mesh(me)
        me.update()
    bm.free()
    return len(hits)


# ---------------------------------------------------------------------------
#  window-box flowers: the Deepglass undergrowth kit's own plants
# ---------------------------------------------------------------------------
# SPACEY (2026-09-26): "use flowers from our generated tidehold flowers and
# shrubs on the windowsills in place of the old flowers". The plants are the
# undergrowth kit's (scripts/assets/deepglass/bl_dg_shrubs.py) shrub_bloom
# (lilac and pink flowering mounds, the bloom sheet) and shrub_heather (pink
# and purple spikes, the undergrowth sheet). The shipped GLBs are meshopt
# compressed, which Blender cannot read: town_flowers.mjs decodes them into
# FLOWER_DIR first (town_install.sh runs it). Each sheet ships at 512 inside
# a building (a window box is small) under one name per sheet, so the GPU
# dedupe shares it across the twelve GLBs. Their materials keep the kit's
# `Leaves_dg_<sheet>` names (+ `_town`): foliage_edge_fade.ts gives exactly
# those the leaves' lighting and edge fade.
FLOWER_DIR = ROOT + '/tmp/asset_src/tidehold_town/flowers'
FLOWER_KINDS = ('shrub_bloom', 'shrub_heather')
FLOWER_SHEET = {'dg_fol_bloom': 'TownFlowerBloom', 'dg_fol_under': 'TownFlowerUnder'}
FLOWERS = []            # (object, grp) - joined into their storey, one Edit piece
_FLOWER_CACHE = {}


def _flower_template(kind):
    """Import one decoded undergrowth GLB once: one 'UVMap', its vertex tint
    as a float corner 'Col' (the parts' layer names), the cutout alpha
    re-linked (Blender 5.1's importer drops it: solid quads otherwise), the
    leaf sheet renamed and scaled to 512. None if the file is missing."""
    if kind in _FLOWER_CACHE:
        return _FLOWER_CACHE[kind]
    path = f'{FLOWER_DIR}/{kind}.glb'
    if not os.path.exists(path):
        log(f'  flowers: {path} missing (run town_flowers.mjs): old blooms instead')
        _FLOWER_CACHE[kind] = None
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes[1:]:
        o.select_set(False)
    keep = meshes[0]
    if len(meshes) > 1:
        for o in bpy.context.scene.objects:
            o.select_set(o in meshes)
        bpy.context.view_layer.objects.active = keep
        bpy.ops.object.join()
    for o in new:
        if o is not keep and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    keep.parent = None
    keep.data.transform(keep.matrix_world)
    keep.matrix_world = Matrix.Identity(4)
    me = keep.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    me.uv_layers[0].name = 'UVMap'
    src = me.color_attributes.active_color or (me.color_attributes[0] if me.color_attributes else None)
    vals = None
    if src is not None:
        if src.domain == 'CORNER':
            vals = [tuple(src.data[i].color) for i in range(len(me.loops))]
        else:
            vals = [tuple(src.data[lp.vertex_index].color) for lp in me.loops]
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for i, d in enumerate(col.data):
        d.color = vals[i] if vals else (1.0, 1.0, 1.0, 1.0)
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    for slot in keep.material_slots:
        m = slot.material
        if m is None or not m.use_nodes:
            continue
        nt = m.node_tree
        tex = next((x for x in nt.nodes if x.type == 'TEX_IMAGE' and x.image), None)
        bsdf = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
        if tex is None or bsdf is None:
            continue
        stem = tex.image.name.split('.')[0]
        want = FLOWER_SHEET.get(stem)
        if want and not m.name.startswith('Leaves_dg_'):
            m.name = 'Leaves_dg_' + want[len('TownFlower'):].lower() + '_town'
            if tex.image.size[0] > 512:
                tex.image.scale(512, 512)
            tex.image.name = want
            tex.image.pack()
        # the kit lifts its leaves with the SAME sheet as an emissive map; the
        # exporter writes that as a second (RGB) copy of the sheet, and a
        # constant stand-in washed the plants out in a grey haze (SPACEY: "the
        # lighting on these flowers is cooked"). No emissive: the leaves keep
        # their kit NAME (`Leaves_dg_*`), so the loader gives them the kit's own
        # leaf lighting (dark-value lift, sky wrap) and edge-on fade.
        emi = bsdf.inputs.get('Emission Color')
        if emi is not None:
            for lk in list(emi.links):
                nt.links.remove(lk)
            emi.default_value = (0.0, 0.0, 0.0, 1.0)
            if 'Emission Strength' in bsdf.inputs:
                bsdf.inputs['Emission Strength'].default_value = 0.0
        if not bsdf.inputs['Alpha'].is_linked:
            rnd = nt.nodes.new('ShaderNodeMath')
            rnd.operation = 'ROUND'
            nt.links.new(tex.outputs['Alpha'], rnd.inputs[0])
            nt.links.new(rnd.outputs['Value'], bsdf.inputs['Alpha'])
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
        m.use_backface_culling = False
    for c in list(keep.users_collection):
        c.objects.unlink(keep)
    _FLOWER_CACHE[kind] = keep
    return keep


def flower(kind, loc, rz, height, grp, squash=1.0):
    """Place one undergrowth plant scaled to `height` yd (its depth across
    the box squashed by `squash`). Returns the object, or None."""
    tpl = _flower_template(kind)
    if tpl is None:
        return None
    zs = [v.co.z for v in tpl.data.vertices]
    h0 = max(zs) - min(zs)
    s = height / max(h0, 1e-3)
    ob = bpy.data.objects.new(kind, tpl.data)
    bpy.context.scene.collection.objects.link(ob)
    ob.scale = (s, s * squash, s)
    ob.rotation_euler = (0, 0, rz)
    ob.location = (loc[0], loc[1], loc[2] - min(zs) * s)
    FLOWERS.append((ob, grp))
    return ob


def prop(rel, x, y, z, rz=0.0, s=None, grp='L0', name=None, sx=1.0, sy=1.0, sz=1.0, interior=False):
    """Place a kit prop (kit units x PROP_S). Facing rule (measured on the
    kit): a prop's BACK is its +y side at rz = 0, so against a -y wall use
    pi, +y wall 0, -x wall +pi/2, +x wall -pi/2."""
    tpl = _kit_template(rel)
    ob = bpy.data.objects.new(name or rel.split('/')[-1], tpl.data)
    bpy.context.scene.collection.objects.link(ob)
    sc = (s or PROP_S)
    ob.scale = (sc * sx, sc * sy, sc * sz)
    ob.rotation_euler = (0, 0, rz)
    # z is the surface it stands on (wall-hung arms and shields keep their
    # pivot: they are placed by where they hang)
    lift = 0.0 if rel.split('/')[-1].startswith(('Shield_', 'Weapon_')) else -tpl.get('minz', 0.0) * sc * sz
    ob.location = (x, y, z + lift)
    ob['interior'] = bool(interior)
    PROPS.append((ob, grp, name or rel.split('/')[-1]))
    return ob


# =============================================================================
#  VERTEX COLOUR PASSES + OBJECTS + EXPORT
# =============================================================================
def ground_darken(P, z_ground=0.0, span=2.2, floor=0.72):
    """Darken the corner colours of upright faces near the ground (dirt,
    damp, contact). Floors are left alone."""
    P.bm.normal_update()
    for f in P.bm.faces:
        if abs(f.normal.z) > 0.6:
            continue
        for lp in f.loops:
            z = lp.vert.co.z
            k = min(1.0, max(0.0, (z - z_ground) / span))
            m = floor + (1 - floor) * k
            c = lp[P.col]
            lp[P.col] = (c[0] * m, c[1] * m, c[2] * m, 1.0)


def eave_shadow(P, z_eave, depth=1.2, floor=0.7):
    """Darken wall colours just under an eave line (the overhang's shade)."""
    for f in P.bm.faces:
        if abs(f.normal.z) > 0.5:
            continue
        for lp in f.loops:
            z = lp.vert.co.z
            if z_eave - depth < z <= z_eave + 0.05:
                k = (z_eave - z) / depth
                m = floor + (1 - floor) * min(1, max(0, k))
                c = lp[P.col]
                lp[P.col] = (c[0] * m, c[1] * m, c[2] * m, 1.0)


def build_objects(mats, name):
    """Turn every part into an object (materials in MATS order), link the
    props, return (parts_objs, prop_objs)."""
    objs = []
    for P in PARTS:
        if P.grp == 'L0' and not getattr(P, 'darkened', False) and TEX_SET == 'v1':
            ground_darken(P)          # v2: the baked smart mask carries the grime
        me = bpy.data.meshes.new(P.name)
        P.bm.normal_update()
        bmesh.ops.remove_doubles(P.bm, verts=P.bm.verts[:], dist=1e-4)
        P.bm.to_mesh(me)
        P.bm.free()
        if me.color_attributes:
            me.color_attributes.active_color = me.color_attributes[0]
            me.color_attributes.render_color_index = 0      # the exporter's ACTIVE colour reads THIS index
        ob = bpy.data.objects.new(f"{name}__{P.name}", me)
        for m in mats:
            ob.data.materials.append(m)
        bpy.context.scene.collection.objects.link(ob)
        ob['grp'] = P.grp
        ob['piece'] = P.piece
        objs.append(ob)
    return objs


def tris_of(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')


def write_sidecar(out_dir, tag, size, min_y, extra=None):
    side = {"size": [r4(size[0]), r4(size[1]), r4(size[2])], "minY": r4(min_y),
            "boxes": COLL['boxes'], "ramps": COLL['ramps']}
    side.update(extra or {})
    with open(f"{out_dir}/{tag}.collision.json", "w") as fh:
        json.dump(side, fh, indent=1)


def export_glb(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='JPEG',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_animations=False, export_extras=True)


def door_hood(P, cx, cy, face, width, z_base, depth=1.3, rise=1.1):
    """A little slate canopy over a door, gabled toward the street, held on
    two curved oak brackets. (cx, cy) = the door's centre ON the wall line;
    face = the wall's outward unit (one of the four axes)."""
    fx, fy = face
    n = Vector((fx, fy, 0.0))
    u = Vector((-fy, fx, 0.0))
    c = Vector((cx, cy, 0.0)) + n * (depth / 2)
    axis = 'y' if abs(fy) > 0.5 else 'x'
    front = 1 if (fx + fy) > 0 else -1
    gable_roof(P, c.x, c.y, depth, width, z_base, rise, axis=axis, eave_over=0.25, gable_over=0.12,
               flare=0.3, sag=0.06, rows=4, thick=0.18, gable_frame=False, finials=True, cap=True,
               closed_ends=(front,), finial_ends=(front,), gable_mat=M_PLASTER, tie_beam=False)
    # (no gable frame: on a 0.12 yd overhang its rafters stand in the
    # bargeboards' depth; the brackets carry the hood)
    for sgn in (-1, 1):
        at_wall = Vector((cx, cy, 0.0)) + u * (sgn * (width / 2 - 0.15))
        tip = at_wall + n * (depth - 0.2)
        # (the diagonals 0.16 wide inside the 0.22 top beam: side faces 3 cm
        # apart where they meet, not 1 cm - a flicker on every hooded door)
        beam(P, at_wall + Vector((0, 0, z_base - 1.2)), at_wall + n * 0.45 + Vector((0, 0, z_base - 0.45)), 0.2, 0.16,
             up=u)
        beam(P, at_wall + n * 0.45 + Vector((0, 0, z_base - 0.45)), tip + Vector((0, 0, z_base - 0.05)), 0.2, 0.12, up=u)
        beam(P, at_wall + Vector((0, 0, z_base - 0.05)), tip + Vector((0, 0, z_base - 0.05)), 0.22, 0.22, up=u)


def chimney_breast(P, x, y, face, width, z_eave, z_top, proj=0.9):
    """An exterior stone chimney against a wall: the breast from the ground
    to under the eave, sloped shoulders, then the stack up past the ridge.
    (x, y) = its centre ON the wall line, face = the wall's outward axis."""
    fx, fy = face
    n = Vector((fx, fy, 0.0))
    u = Vector((-fy, fx, 0.0))
    R = Matrix((u, n, Vector((0, 0, 1)))).transposed()
    base = Vector((x, y, 0.0))
    z_sh = z_eave - 0.9
    cuboid(P, tuple(base + n * (proj / 2) + Vector((0, 0, (z_sh - 1.0) / 2))), (width, proj, z_sh + 1.0), M_STONE,
           rot=R, tint=(0.92, 0.92, 0.9), faces={'-x', '+x', '+y'})
    # sloped shoulders: a frustum from the breast to the stack
    sw, sp = width * 0.58, proj * 0.8
    lo = [base + n * 0.0 + u * (-width / 2), base + n * proj + u * (-width / 2), base + n * proj + u * (width / 2),
          base + u * (width / 2)]
    hi = [base + u * (-sw / 2), base + n * sp + u * (-sw / 2), base + n * sp + u * (sw / 2), base + u * (sw / 2)]
    z_hi = z_sh + 0.8
    for i in range(4):
        a, b = lo[i], lo[(i + 1) % 4]
        c, d = hi[(i + 1) % 4], hi[i]
        quad(P, [(a.x, a.y, z_sh), (b.x, b.y, z_sh), (c.x, c.y, z_hi), (d.x, d.y, z_hi)], M_STONE, tint=(0.95, 0.95, 0.92))
    cuboid(P, tuple(base + n * (proj / 2) + Vector((0, 0, z_sh))), (width + 0.14, proj + 0.14, 0.16), M_DRESSED, rot=R,
           faces={'-x', '+x', '+y', '-y', '+z'})
    chimney(P, (base + n * (sp / 2)).x, (base + n * (sp / 2)).y, z_hi, z_top, w=sw if abs(fy) > 0.5 else sp,
            d=sp if abs(fy) > 0.5 else sw)


# =============================================================================
#  INTERIORS
# =============================================================================
def flame(fid, style, x, y, z, scale=1.0):
    FLAMES.append((fid, style, x, y, z, scale))


def floor_deck(P, x0, x1, y0, y1, z, mat=M_FLOOR, collide=True):
    """A floor surface at z with a walkable deck over it."""
    quad(P, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat)
    if collide:
        col_ramp((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, z, z)


def ceiling(P, x0, x1, y0, y1, z, joist_axis='y', pitch=1.6, skip=None):
    """The planked underside of the floor above, with chunky oak joists.
    `skip` = (x0, x1, y0, y1) leaves a stairwell open."""
    def rects():
        if not skip:
            return [(x0, x1, y0, y1)]
        sx0, sx1, sy0, sy1 = skip
        out = []
        if sx0 > x0:
            out.append((x0, sx0, y0, y1))
        if sx1 < x1:
            out.append((sx1, x1, y0, y1))
        if sy0 > y0:
            out.append((max(x0, sx0), min(x1, sx1), y0, sy0))
        if sy1 < y1:
            out.append((max(x0, sx0), min(x1, sx1), sy1, y1))
        return out
    for (a0, a1, b0, b1) in rects():
        quad(P, [(a0, b0, z), (a0, b1, z), (a1, b1, z), (a1, b0, z)], M_FLOOR, tint=(0.62, 0.6, 0.58))
    if joist_axis == 'y':
        k = max(2, int((x1 - x0) / pitch))
        for i in range(1, k):
            x = x0 + (x1 - x0) * i / k
            if skip and skip[0] - 0.2 < x < skip[1] + 0.2:
                for (b0, b1) in ((y0, skip[2]), (skip[3], y1)):
                    if b1 - b0 > 0.4:
                        beam(P, (x, b0, z - 0.2), (x, b1, z - 0.2), 0.3, 0.4)
                continue
            beam(P, (x, y0, z - 0.2), (x, y1, z - 0.2), 0.3, 0.4)
    else:
        k = max(2, int((y1 - y0) / pitch))
        for i in range(1, k):
            y = y0 + (y1 - y0) * i / k
            if skip and skip[2] - 0.2 < y < skip[3] + 0.2:
                for (a0, a1) in ((x0, skip[0]), (skip[1], x1)):
                    if a1 - a0 > 0.4:
                        beam(P, (a0, y, z - 0.2), (a1, y, z - 0.2), 0.3, 0.4)
                continue
            beam(P, (x0, y, z - 0.2), (x1, y, z - 0.2), 0.3, 0.4)


def upper_floor(P, rects, z, thick=0.32):
    """The floor you walk on upstairs: planks on top, standable slabs (boxes,
    never decks: a deck would replace the ground floor under it) topping out
    `z` - 0.02 so the stair's summit steps DOWN onto them."""
    for (x0, x1, y0, y1) in rects:
        quad(P, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], M_FLOOR)
        col_box((x0 + x1) / 2, (y0 + y1) / 2, z - 0.02 - thick / 2, (x1 - x0) / 2, (y1 - y0) / 2, thick / 2)


def railing(P, a, b, z, h=1.1, posts=1.2, collide=True):
    """An oak balustrade from a to b at floor z: posts, a top rail, balusters."""
    a, b = Vector((a[0], a[1], z)), Vector((b[0], b[1], z))
    L = (b - a).length
    if L < 0.05:
        return
    u = (b - a) / L
    n = Vector((-u.y, u.x, 0))
    beam(P, a + Vector((0, 0, h)), b + Vector((0, 0, h)), 0.2, 0.16, up=Vector((0, 0, 1)))
    beam(P, a + Vector((0, 0, 0.12)), b + Vector((0, 0, 0.12)), 0.16, 0.14, up=Vector((0, 0, 1)))
    k = max(1, int(L / posts))
    for i in range(k + 1):
        p = a + u * (L * i / k)
        beam(P, p, p + Vector((0, 0, h + 0.12)), 0.2, 0.2, up=n)
        if i < k:
            for j in range(1, 4):
                q = a + u * (L * (i + j / 4) / k)
                beam(P, q + Vector((0, 0, 0.12)), q + Vector((0, 0, h)), 0.08, 0.08, up=n)
    if collide:
        m = (a + b) / 2
        col_box(m.x, m.y, z + h / 2 + 0.1, L / 2, 0.12, h / 2 + 0.1, ry=math.atan2(u.y, u.x))


def staircase(P, x, y0, y1, width, z0, z1, side_rail=None, mat=M_TIMBER):
    """A straight timber stair along y from y0 (foot, z0) to y1 (head, z1),
    centred on x: solid stringers, planked treads with oak nosings, the
    walkable nosing-line ramp. side_rail = the x of an open side (a railing)."""
    n_steps = max(2, int(round((z1 - z0) / 0.3)))
    rise = (z1 - z0) / n_steps
    L = abs(y1 - y0)
    run = L / n_steps
    dy = 1 if y1 > y0 else -1
    hw = width / 2
    for i in range(n_steps):
        ya = y0 + dy * run * i
        yb = ya + dy * run
        zt = z0 + rise * (i + 1)
        lo, hi = min(ya, yb), max(ya, yb)
        cuboid(P, (x, (lo + hi) / 2, zt - 0.06), (width, hi - lo + 0.04, 0.12), M_FLOOR, faces={'+z', '-y', '+y'})
        # riser
        quad(P, [(x - hw, ya, zt - rise), (x + hw, ya, zt - rise), (x + hw, ya, zt), (x - hw, ya, zt)][:: (1 if dy > 0 else -1)],
             M_TIMBER, tint=(0.8, 0.78, 0.75))
    # stringers (the sides), closed down to the floor
    for sx in (x - hw - 0.1, x + hw + 0.1):
        pts = [(sx, y0, z0 - 0.02), (sx, y1, z0 - 0.02), (sx, y1, z1 + 0.18), (sx, y0, z0 + 0.3)]
        if (sx > x) == (dy > 0):
            pts = pts[::-1]
        quad(P, pts, mat)
    # the nosing-line ramp (rises along its local +X: turn it to face y1)
    ry = math.atan2(dy, 0)
    col_ramp(x, (y0 + y1) / 2, L / 2, hw, z0, z1, ry=ry)
    if side_rail is not None:
        # a raked handrail along the open side
        s = side_rail
        a = Vector((s, y0, z0 + 1.0))
        b = Vector((s, y1, z1 + 1.0))
        beam(P, a, b, 0.18, 0.16, up=Vector((0, 0, 1)))
        k = max(2, int(L / 1.1))
        for i in range(k + 1):
            f = i / k
            p = Vector((s, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f))
            beam(P, p, p + Vector((0, 0, 1.0)), 0.16 if i in (0, k) else 0.08, 0.16 if i in (0, k) else 0.08)
    return n_steps, rise, run


def fireplace(P, x, y, face, width=3.4, depth=1.2, h=4.6, z0=0.45, fid='hearth'):
    """A stone hearth against a wall, projecting `depth` into the room along
    `face` (unit, into the room): a firebox, a dressed lintel, a mantel shelf
    with a gold rim, the hood tapering to the ceiling, a glowing fire bed."""
    n = Vector((face[0], face[1], 0)).normalized()
    u = Vector((-n.y, n.x, 0))
    R = Matrix((u, n, Vector((0, 0, 1)))).transposed()
    base = Vector((x, y, 0))
    c = base + n * (depth / 2)
    # the breast: two cheeks and the lintel over a 1.8 x 1.4 firebox
    fw, fh = width * 0.55, 1.5
    cheek = (width - fw) / 2
    for sgn in (-1, 1):
        cuboid(P, tuple(c + u * (sgn * (fw / 2 + cheek / 2)) + Vector((0, 0, z0 + fh / 2))), (cheek, depth, fh),
               M_DRESSED, rot=R, faces={'-x', '+x', '+y', '+z'})          # no face on the wall
    cuboid(P, tuple(c + Vector((0, 0, z0 + fh + 0.25))), (width, depth, 0.5), M_DRESSED, rot=R,
           faces={'-x', '+x', '+y', '-z', '+z'})
    # mantel
    cuboid(P, tuple(c + n * 0.12 + Vector((0, 0, z0 + fh + 0.6))), (width + 0.4, depth + 0.24, 0.2), M_TIMBER, rot=R)
    cuboid(P, tuple(c + n * (depth / 2 + 0.24) + Vector((0, 0, z0 + fh + 0.6))), (width + 0.42, 0.06, 0.1), M_GOLD, rot=R)
    # hood up to h, tapering
    hz0 = z0 + fh + 0.7
    lo = [c + u * (-width / 2) + n * (-depth / 2), c + u * (width / 2) + n * (-depth / 2),
          c + u * (width / 2) + n * (depth / 2), c + u * (-width / 2) + n * (depth / 2)]
    hi_w, hi_d = width * 0.62, depth * 0.62
    hi = [c + n * (-(depth / 2) + 0.0) + u * (-hi_w / 2), c + n * (-(depth / 2)) + u * (hi_w / 2),
          c + n * (-depth / 2 + hi_d) + u * (hi_w / 2), c + n * (-depth / 2 + hi_d) + u * (-hi_w / 2)]
    for i in range(1, 4):                 # side 0 lies ON the wall: never drawn
        a, b = lo[i], lo[(i + 1) % 4]
        cc, d = hi[(i + 1) % 4], hi[i]
        quad(P, [(a.x, a.y, hz0), (b.x, b.y, hz0), (cc.x, cc.y, h), (d.x, d.y, h)], M_STONE, tint=(0.9, 0.9, 0.88))
    # firebox back + floor, the fire bed glowing
    back = c + n * (-depth / 2 + 0.1)
    quad(P, [tuple(back + u * (-fw / 2) + Vector((0, 0, z0))), tuple(back + u * (fw / 2) + Vector((0, 0, z0))),
             tuple(back + u * (fw / 2) + Vector((0, 0, z0 + fh))), tuple(back + u * (-fw / 2) + Vector((0, 0, z0 + fh)))],
         M_DARK)
    cuboid(P, tuple(c + Vector((0, 0, z0 + 0.12))), (fw - 0.1, depth - 0.2, 0.24), M_STONE, rot=R, tint=(0.4, 0.38, 0.36))
    for k in range(5):
        p = c + u * ((k - 2) * fw * 0.16) + n * (0.05 * ((k % 2) - 0.5)) + Vector((0, 0, z0 + 0.3))
        lathe(P, [(0.0, 0.0), (0.2, 0.05), (0.15, 0.2), (0.0, 0.24)], tuple(p), segs=5, mat=M_GLOW)
    # hearth stone in front
    cuboid(P, tuple(c + n * (depth / 2 + 0.45) + Vector((0, 0, z0 + 0.02))), (width + 0.3, 0.9, 0.1), M_DRESSED, rot=R,
           faces={'+z', '-x', '+x', '-y', '+y'})
    flame(fid, 'bonfire', (c + n * 0.1).x, (c + n * 0.1).y, z0 + 0.3, 0.75)
    fc = c
    col_box(fc.x, fc.y, h / 2, (width / 2) if abs(n.x) < 0.5 else depth / 2 + 0.1,
            (depth / 2 + 0.1) if abs(n.x) < 0.5 else width / 2, h / 2)


def chandelier(P, x, y, z, r=0.9, fid=None):
    """A wooden wheel of candles hung on iron chains from the ceiling at z."""
    zc = z - 1.6
    lathe(P, [(r, zc - 0.1), (r + 0.12, zc - 0.05), (r + 0.12, zc + 0.08), (r, zc + 0.12), (r - 0.12, zc + 0.08),
              (r - 0.12, zc - 0.05), (r, zc - 0.1)], (x, y, 0.0), segs=12, mat=M_TIMBER, cap_top=False)
    for i in range(6):
        a = TAU * i / 6
        p = Vector((x + math.cos(a) * r, y + math.sin(a) * r, zc + 0.12))
        lathe(P, [(0.07, 0.0), (0.07, 0.3), (0.0, 0.34)], tuple(p), segs=5, mat=M_PLASTER, tint=(1, 0.95, 0.85))
        lathe(P, [(0.0, 0.3), (0.05, 0.36), (0.0, 0.48)], tuple(p), segs=4, mat=M_GLOW)
        beam(P, p + Vector((0, 0, -0.02)), Vector((x, y, z - 0.3)), 0.03, 0.03, mat=M_IRON)
    beam(P, (x, y, z - 0.3), (x, y, z), 0.05, 0.05, mat=M_IRON)
    if fid:
        flame(fid, 'torch', x, y, zc + 0.35, 0.3)


def hanging_lantern(P, x, y, zc, drop=2.4):
    """An iron lantern hung on a chain from a ceiling at zc: a pierced cap, a
    glowing core in a four-bar cage, a finial underneath."""
    c = Vector((x, y, zc - drop))
    beam(P, (x, y, zc), (x, y, c.z + 0.62), 0.04, 0.04, mat=M_IRON)
    lathe(P, [(0.0, 0.62), (0.1, 0.6), (0.34, 0.42), (0.3, 0.36)], tuple(c), segs=6, mat=M_IRON)
    lathe(P, [(0.2, -0.3), (0.22, 0.34)], tuple(c), segs=6, mat=M_GLOW, cap_top=False, smooth=False)
    lathe(P, [(0.3, -0.36), (0.3, -0.3), (0.12, -0.44), (0.0, -0.62)], tuple(c), segs=6, mat=M_IRON)
    for i in range(4):
        a = TAU * i / 4 + TAU / 8
        p = c + Vector((math.cos(a) * 0.27, math.sin(a) * 0.27, 0))
        beam(P, p + Vector((0, 0, -0.33)), p + Vector((0, 0, 0.39)), 0.045, 0.045, mat=M_IRON)


def drape_frame(P, a, b, z0, z1, n, tint=(0.55, 0.75, 1.0)):
    """A booth's canopy of drapes (the Stormwind auction house): two oak posts
    from the floor at z0 to z1 at a and b with gold ball finials, a blue swag
    slung between their heads and a tail hanging down each post, gold hems.
    `n` = the side the customers see."""
    a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
    n = Vector((n[0], n[1], 0)).normalized()
    u = (b - a).normalized()
    up = Vector((0, 0, 1))
    for p in (a, b):
        lathe(P, [(0.16, z0), (0.16, z0 + 0.25), (0.11, z0 + 0.35), (0.1, z1 - 0.25), (0.14, z1 - 0.12), (0.12, z1)],
              (p.x, p.y, 0.0), segs=8, mat=M_TIMBER, smooth=False)
        lathe(P, [(0.0, 0.0), (0.2, 0.1), (0.24, 0.26), (0.18, 0.42), (0.0, 0.5)], (p.x, p.y, z1), segs=8, mat=M_GOLD)
    L = (b - a).length
    N = 10

    def strip(pts, width, off):
        """A cloth ribbon through `pts` (its top edge), `width` deep, both faces."""
        for i in range(len(pts) - 1):
            p0, p1 = pts[i] + n * off, pts[i + 1] + n * off
            q = [p0, p1, p1 - up * width, p0 - up * width]
            f = [tuple(v) for v in q]
            aa, bb, cc = Vector(f[0]), Vector(f[1]), Vector(f[2])
            if (bb - aa).cross(cc - aa).dot(n) < 0:
                f = f[::-1]
            quad(P, f, M_CLOTH, tint=tint)
            quad(P, f[::-1], M_CLOTH, tint=tuple(t * 0.7 for t in tint))
            # the hem: a gold band along the bottom edge
            beam(P, p0 - up * width, p1 - up * width, 0.06, 0.09, mat=M_GOLD, up=n)     # 4.5 cm each side of the cloth
    # the swag: a catenary between the post heads, just in front of them
    sw = [a + u * (L * i / N) + up * (z1 - 0.15 - 0.7 * math.sin(math.pi * i / N)) for i in range(N + 1)]
    strip(sw, 0.55, 0.2)
    # the tails down each post, flaring a touch
    for (p, side) in ((a, -1), (b, 1)):
        tail = [p + u * (side * (0.05 + 0.12 * (k / 5))) + up * (z1 - 0.15 - 2.8 * k / 5) for k in range(6)]
        for i in range(5):
            p0, p1 = tail[i] + n * 0.32, tail[i + 1] + n * 0.32      # 12 cm in front of the swag: hems clear it
            w0 = 0.42
            q = [p0 - u * side * w0 / 2, p0 + u * side * w0 / 2, p1 + u * side * w0 / 2, p1 - u * side * w0 / 2]
            f = [tuple(v) for v in q]
            aa, bb, cc = Vector(f[0]), Vector(f[1]), Vector(f[2])
            if (bb - aa).cross(cc - aa).dot(n) < 0:
                f = f[::-1]
            quad(P, f, M_CLOTH, tint=tint)
            quad(P, f[::-1], M_CLOTH, tint=tuple(t * 0.7 for t in tint))
        bot = tail[-1] + n * 0.32
        beam(P, bot - u * 0.23, bot + u * 0.23, 0.06, 0.09, mat=M_GOLD, up=n)


def sconce(P, x, y, z, face, fid=None):
    """A wall torch: an iron cup on a bracket, a glowing flame."""
    n = Vector((face[0], face[1], 0)).normalized()
    base = Vector((x, y, z))
    beam(P, base, base + n * 0.4 + Vector((0, 0, 0.2)), 0.06, 0.06, mat=M_IRON)
    c = base + n * 0.45 + Vector((0, 0, 0.25))
    lathe(P, [(0.05, -0.15), (0.2, 0.1), (0.2, 0.18), (0.0, 0.18)], tuple(c), segs=6, mat=M_IRON)
    lathe(P, [(0.0, 0.18), (0.12, 0.3), (0.0, 0.62)], tuple(c), segs=5, mat=M_GLOW)
    if fid:
        flame(fid, 'torch', c.x, c.y, c.z + 0.2, 0.3)


def partition(P, a, b, z0, z1, door=None, t=0.3):
    """A plaster-and-timber partition from a to b, optional door (s, w)."""
    ops = []
    if door:
        ops.append(dict(s=door[0], w=door[1], z0=z0, z1=z0 + 2.6, arch=False))
    with env_off():
        wall(P, a[0], a[1], b[0], b[1], z0, z1, M_PLASTER, ops, t=t, inner=True, inner_mat=M_PLASTER)
    frame_wall(P, a[0], a[1], b[0], b[1], z0, z1, ops, braces=False)
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = Vector(((b[1] - a[1]) / L, -(b[0] - a[0]) / L))
    mid_off = n * (t / 2)
    col_wall(a[0] - mid_off.x, a[1] - mid_off.y, b[0] - mid_off.x, b[1] - mid_off.y, z0, z1, t,
             gaps=[(door[0] - door[1] / 2, door[0] + door[1] / 2, z0 + 2.6)] if door else [])


# =============================================================================
#  EXPORT WITH STOREY GROUPS
# =============================================================================
GROUP_NODE = {'L0': None, 'H1': 'G_H1', 'H2': 'G_H2', 'H3': 'G_H3', 'INT_L0': 'G_INT_L0', 'INT_H1': 'G_INT_H1'}


def join_objects(objs, name):
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def _g(v):
    """Blender (x, y, z) -> glTF (x, z, -y)."""
    return [v[0], v[2], -v[1]]


def _mesh_bounds_gltf(me):
    """Unscaled local bounds of a mesh, in the glTF frame."""
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for vt in me.vertices:
        q = _g(vt.co)
        for i in range(3):
            lo[i] = min(lo[i], q[i])
            hi[i] = max(hi[i], q[i])
    return lo, hi


def export_town(tag, parts_objs, prop_items, out_dir, extra=None, no_int=False):
    """Export one town building:

    - <out>/tidehold_<tag>.parts.glb: the Studio "Edit pieces" twin. The
      ground shell part is node `shell_main` (the `#group:shell_` shell);
      every other hand-built part and every kit prop is its own node
      `P###_<name>`, props keeping their transforms.
    - <out>/tidehold_<tag>.pieces.json: those nodes' transforms and unscaled
      bounds (glTF frame, model yards) and each one's share of the building's
      authored collision (a box or deck goes to the smallest hand-built part
      whose bounds hold its centre, else the shell; a prop gets its bounds),
      for the installer to write data/prefab_pieces + per-piece overrides.
    - <out>/tidehold_<tag>.glb: the building, every part and prop JOINED per
      reveal group: the L0 shell at the root, G_H1 (upper storey) / G_H2
      (roof) / G_INT_L0 (ground-floor furniture) as root empties, and
      G_INT_H1 (upstairs furniture) UNDER G_H1 so it hides with its storey.
      no_int keeps every prop in its storey group (the open market: its
      stalls are its look from the street).
    - the collision sidecar (write_sidecar) with `extra` merged in."""
    base = f"{out_dir}/tidehold_{tag}"
    # ---- 1. the parts twin ------------------------------------------------
    twins = []
    pieces = []
    shell = None
    k = 0
    for o in parts_objs:
        nm = o.name.split('__')[-1]
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        if nm == 'shell':
            c.name = 'shell_main'
            shell = c
        else:
            k += 1
            c.name = f'P{k:03d}_{nm.replace(".", "_")}'
            pieces.append({'node': c.name, 'kit': f'town/{nm.split(".")[0]}', 'obj': c, 'hand': True})
        twins.append(c)
    for (o, grp, nm) in prop_items:
        k += 1
        c = o.copy()
        bpy.context.scene.collection.objects.link(c)
        c.name = f'P{k:03d}_{nm}'
        pieces.append({'node': c.name, 'kit': f'props/{nm}', 'obj': c, 'hand': False})
        twins.append(c)
    # every window-box plant as ONE piece with no collision (a box round all
    # the plants on a front would be a wall of air)
    if FLOWERS:
        fl = []
        for (o, _grp) in FLOWERS:
            c = o.copy()
            c.data = o.data.copy()
            bpy.context.scene.collection.objects.link(c)
            fl.append(c)
        for o in bpy.context.scene.objects:
            o.select_set(o in fl)
        bpy.context.view_layer.objects.active = fl[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        k += 1
        jf = join_objects(fl, f'P{k:03d}_flowers')
        pieces.append({'node': jf.name, 'kit': 'town/flowers', 'obj': jf, 'hand': False, 'nocoll': True})
        twins.append(jf)
    # hand-built bounds (model frame: their objects carry identity transforms)
    hand = [(q['obj'], q) for q in pieces if q['hand']] + ([(shell, None)] if shell else [])

    def aabb(ob):
        lo, hi = _mesh_bounds_gltf(ob.data)
        return lo, hi

    boxes_of = {id(o): [] for (o, _) in hand}
    ramps_of = {id(o): [] for (o, _) in hand}
    bounds = {id(o): aabb(o) for (o, _) in hand}

    def owner(x, y, z):
        best, vol = shell, 1e18
        for (o, q) in hand:
            lo, hi = bounds[id(o)]
            if all(lo[i] - 0.05 <= (x, y, z)[i] <= hi[i] + 0.05 for i in range(3)):
                v = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])
                if o is not shell and v < vol:
                    best, vol = o, v
        return best
    for b in COLL['boxes']:
        o = owner(b['x'], b['y'], b['z'])
        if o is not None:
            boxes_of[id(o)].append(b)
    for d in COLL['ramps']:
        o = owner(d['x'], (d['y0'] + d['y1']) / 2, d['z'])
        if o is not None:
            ramps_of[id(o)].append(d)

    def entry(q_obj, rec):
        lo, hi = _mesh_bounds_gltf(q_obj.data)
        out = dict(rec)
        out.pop('obj', None)
        out.pop('hand', None)
        nocoll = out.pop('nocoll', False)
        loc = _g(q_obj.location)
        sc = q_obj.scale
        out.update({'x': r4(loc[0]), 'y': r4(loc[1]), 'z': r4(loc[2]), 'rotY': r4(q_obj.rotation_euler.z),
                    's': r4(sc.x), 'sy': r4(sc.z / sc.x), 'sz': r4(sc.y / sc.x),
                    'maxDim': r4(max(hi[i] - lo[i] for i in range(3))),
                    'min': [r4(v) for v in lo], 'max': [r4(v) for v in hi]})
        if rec.get('hand'):
            bx, rp = boxes_of[id(q_obj)], ramps_of[id(q_obj)]
            if not bx and not rp:       # a dormer, a chimney: solid enough as its bounds
                bx = [{'x': r4((lo[0] + hi[0]) / 2), 'y': r4((lo[1] + hi[1]) / 2), 'z': r4((lo[2] + hi[2]) / 2),
                       'hx': r4((hi[0] - lo[0]) / 2), 'hy': r4((hi[1] - lo[1]) / 2), 'hz': r4((hi[2] - lo[2]) / 2)}]
            out['coll'] = {'boxes': bx, 'ramps': rp}
        elif nocoll:
            out['coll'] = {'boxes': [], 'ramps': []}
        else:
            out['coll'] = {'boxes': [{'x': r4((lo[0] + hi[0]) / 2), 'y': r4((lo[1] + hi[1]) / 2),
                                      'z': r4((lo[2] + hi[2]) / 2), 'hx': r4((hi[0] - lo[0]) / 2),
                                      'hy': r4((hi[1] - lo[1]) / 2), 'hz': r4((hi[2] - lo[2]) / 2)}],
                           'ramps': []}
        return out
    manifest = {'name': tag, 'pieces': [entry(q['obj'], q) for q in pieces]}
    if shell is not None:
        lo, hi = _mesh_bounds_gltf(shell.data)
        manifest['shell'] = {'nodes': 1, 'maxDim': r4(max(hi[i] - lo[i] for i in range(3))),
                             'min': [r4(v) for v in lo], 'max': [r4(v) for v in hi],
                             'coll': {'boxes': boxes_of[id(shell)], 'ramps': ramps_of[id(shell)]}}
    with open(base + '.pieces.json', 'w') as fh:
        json.dump(manifest, fh, indent=1)
    export_glb(twins, base + '.parts.glb')
    for c in twins:
        bpy.data.objects.remove(c, do_unlink=True)
    # ---- 2. the grouped building --------------------------------------------
    by_grp = {}
    movers = {}
    for o in parts_objs:
        nm = o.name.split('__')[-1]
        if nm in MOVERS:
            movers[nm] = o
            continue
        by_grp.setdefault(o['grp'], []).append(o)
    for (o, grp, nm) in prop_items:
        g = 'INT_' + grp if (grp in ('L0', 'H1') and o.get('interior') and not no_int) else grp
        by_grp.setdefault(g, []).append(o)
    for (o, grp) in FLOWERS:                # window boxes hang outside: their storey's group
        by_grp.setdefault(grp, []).append(o)
    empties = {}

    def empty(node):
        if node not in empties:
            e = bpy.data.objects.new(node, None)
            bpy.context.scene.collection.objects.link(e)
            empties[node] = e
        return empties[node]
    final = []
    for g in sorted(by_grp, key=lambda q: (q.startswith('INT_'), q)):
        objs = by_grp[g]
        for o in objs:
            if o.data.users > 1:
                o.data = o.data.copy()
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        j = join_objects(objs, f'{tag}_{g}')
        node = GROUP_NODE.get(g)
        if node:
            e = empty(node)
            j.parent = e
            if g == 'INT_H1':              # upstairs furniture hides with the storey
                e.parent = empty('G_H1')
        final.append(j)
    # the movers: their own nodes, origin on their pivot, under their parent
    # mover or their reveal group (render/placed_movers.ts animates them)
    for nm in sorted(movers, key=lambda q: MOVERS[q][1] is not None):
        o = movers[nm]
        pv, par, motion = MOVERS[nm]
        o.data = o.data.copy()
        o.data.transform(Matrix.Translation(-pv))
        o.name = nm
        o['wocMover'] = dict(motion, name=nm)
        if par:
            o.parent = movers[par]
            o.location = pv - MOVERS[par][0]
        else:
            node = GROUP_NODE.get(o['grp'])
            if node:
                o.parent = empty(node)
            o.location = pv
        final.append(o)
    final += list(empties.values())
    export_glb(final, base + '.glb')
    return final


def fit_furniture_boxes(max_area=20.0, min_cover=0.3):
    """Fit every FURNITURE collision box's top to the props actually standing
    in it (SPACEY, 2026-09-26: "make sure all of the collision matches nicely").

    The sim steps a grounded mover up anything within MAX_STEP_HEIGHT (1.0)
    of its feet, so a hand-sized table box that stops under the tabletop is
    a stair INTO the table: the player walked onto the smithy bench and stood
    inside it. A box counts as furniture when it is small (< max_area yd² of
    footprint) and props whose centres it holds, starting inside its height
    band, cover at least `min_cover` of it; its top then becomes their
    highest vertex. Floors, walls, decks and posts hold no such props and are
    left alone."""
    bpy.context.view_layer.update()
    boxes = []
    for (o, grp, nm) in PROPS:
        mw = o.matrix_world
        vs = [mw @ v.co for v in o.data.vertices]
        if not vs:
            continue
        lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        boxes.append((lo, hi))
    fitted = 0
    for b in COLL['boxes']:
        area = 4 * b['hx'] * b['hz']
        if area > max_area:
            continue
        bx, by = b['x'], -b['z']
        base, top = b['y'] - b['hy'], b['y'] + b['hy']
        c, s = math.cos(b.get('ry', 0.0)), math.sin(b.get('ry', 0.0))
        cover, ztop = 0.0, None
        for (lo, hi) in boxes:
            px, py = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
            dx, dy = px - bx, py - by
            lx, ly = dx * c + dy * s, -dx * s + dy * c
            if abs(lx) > b['hx'] or abs(ly) > b['hz']:
                continue
            if not (base - 0.1 <= lo.z <= top + 0.05):
                continue
            cover += (hi.x - lo.x) * (hi.y - lo.y)
            ztop = hi.z if ztop is None else max(ztop, hi.z)
        if ztop is None or cover < min_cover * area or ztop < base + 0.2:
            continue
        ztop = min(ztop + 0.02, base + 4.0)
        if abs(ztop - top) < 0.03:
            continue
        b['y'] = r4((base + ztop) / 2)
        b['hy'] = r4((ztop - base) / 2)
        fitted += 1
    return fitted


def course_band(P, rect, z, mat=M_DRESSED, out=0.15, depth_in=0.22, h=0.24):
    """A string course round a storey's head: four narrow bands (out past the
    wall face, back into the wall's thickness), NOT one slab over the whole
    footprint: a slab's underside is a flat stone ceiling across the room of
    an enterable building (it was, in the church and the smithy). The x-running
    bands own the corners; the y-running ones fit between them."""
    x0, x1, y0, y1 = rect
    d = out + depth_in
    faces = {'-x', '+x', '-y', '+y', '-z'}
    for (yy, sgn) in ((y0, -1), (y1, 1)):
        cuboid(P, ((x0 + x1) / 2, yy + sgn * (out - d / 2), z), (x1 - x0 + 2 * out, d, h), mat, faces=faces)
    for (xx, sgn) in ((x0, -1), (x1, 1)):
        cuboid(P, (xx + sgn * (out - d / 2), (y0 + y1) / 2, z), (d, y1 - y0 - 2 * depth_in, h), mat, faces=faces)


# =============================================================================
#  SMART MATERIALS: a per-building weathering mask (Substance-style)
# =============================================================================
# Every building gets its OWN mask, baked in Cycles over a unique UV set
# ('UVMask', glTF TEXCOORD_1) and shipped in the occlusion slot:
#   R = ambient occlusion (the real geometry: eaves, jetties, corners, props)
#   G = grime (a band up from the ground, cavities, world-space blotches)
#   B = convex edge wear (bevel-detected edges that are NOT occluded)
# The game's town_smart_material.ts reads it over the shared tiling albedo
# with the per-material parameters below (glTF extras -> userData.townSmart),
# so two houses on the same textures weather differently.
SMART = {
    # material: dirt colour, dirt amount, moss colour, moss amount, edge colour, edge amount, AO into diffuse
    'town_stone':   ('#3d3326', 0.62, '#4e6a2c', 0.5, '#efe6d0', 0.32, 0.65),
    'town_dressed': ('#4e4234', 0.5, '#56703a', 0.35, '#fff6e2', 0.3, 0.6),
    'town_plaster': ('#6a5439', 0.55, '#6b7a44', 0.12, '#fffaf0', 0.18, 0.6),
    'town_timber':  ('#22150c', 0.35, '#4a5e2c', 0.12, '#b98a5c', 0.32, 0.55),
    'town_roof':    ('#141c30', 0.22, '#5f7d3a', 0.14, '#b9d2f6', 0.3, 0.5),
    'town_floor':   ('#20140c', 0.45, '#20140c', 0.0, '#b08758', 0.2, 0.65),
    'town_flag':    ('#2b2620', 0.45, '#4e6a2c', 0.25, '#e8e0cc', 0.22, 0.65),
    'town_teal':    ('#1c1a14', 0.35, '#4e6a2c', 0.15, '#c8e8e0', 0.25, 0.55),
    'town_blue':    ('#1c1a14', 0.35, '#4e6a2c', 0.15, '#c8d8f0', 0.25, 0.55),
    'town_cloth':   ('#1c1a14', 0.2, '#1c1a14', 0.0, '#9fb6ee', 0.1, 0.4),
    # the interior props (detail_prop_template): a LIGHT touch. Kit props are
    # small and hard-edged, so the bevel test calls most of a plank an edge
    # (pale, washed-out furniture in game at 0.3), and a whole room is
    # occluded at the 1.1 yd AO reach (grey furniture at 0.6): contact
    # shadow, faint scuffs, never moss (a table sits in the grime band)
    'town_pwood':   ('#2a180c', 0.12, '#2a180c', 0.0, '#8a5a34', 0.06, 0.3),
    'town_pmetal':  ('#2a1c12', 0.1, '#2a1c12', 0.0, '#b8c0c8', 0.18, 0.3),
    'town_pstone':  ('#2b241c', 0.2, '#2b241c', 0.0, '#d6d0c4', 0.12, 0.35),
    'town_pcloth':  ('#2a2018', 0.1, '#2a2018', 0.0, '#fff0dc', 0.0, 0.3),
    'town_kit':     ('#20160e', 0.1, '#20160e', 0.0, '#ffffff', 0.0, 0.3),
}


def _hex01(h):
    h = h.lstrip('#')
    return [round(int(h[i:i + 2], 16) / 255.0, 4) for i in (0, 2, 4)]


def _mask_bake_material(img):
    m = bpy.data.materials.new('town_mask_bake')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    L = nt.links
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emi = nt.nodes.new('ShaderNodeEmission')
    L.new(emi.outputs['Emission'], out.inputs['Surface'])
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    neg = nt.nodes.new('ShaderNodeVectorMath')
    neg.operation = 'SCALE'
    neg.inputs['Scale'].default_value = -1.0
    L.new(geo.outputs['Normal'], neg.inputs[0])

    def two_sided_ao(samples, dist):
        # many faces are wound inward (the double-sided game materials never
        # cared): occlusion is sampled on BOTH sides and the more open side
        # wins, which is always the side a player can see
        a = nt.nodes.new('ShaderNodeAmbientOcclusion')
        b = nt.nodes.new('ShaderNodeAmbientOcclusion')
        for n in (a, b):
            n.samples = samples
            n.inputs['Distance'].default_value = dist
        L.new(geo.outputs['Normal'], a.inputs['Normal'])
        L.new(neg.outputs['Vector'], b.inputs['Normal'])
        mx = nt.nodes.new('ShaderNodeMath')
        mx.operation = 'MAXIMUM'
        L.new(a.outputs['AO'], mx.inputs[0])
        L.new(b.outputs['AO'], mx.inputs[1])
        return mx.outputs[0]
    ao_out = two_sided_ao(24, 1.1)
    ao_s_out = two_sided_ao(12, 0.25)
    bev = nt.nodes.new('ShaderNodeBevel')
    bev.samples = 8
    bev.inputs['Radius'].default_value = 0.07
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    L.new(bev.outputs['Normal'], dot.inputs[0])
    L.new(geo.outputs['Normal'], dot.inputs[1])

    def math_node(op, a=None, b=None, clamp=False):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]
    # edge = (1 - dot) * 7, kept only where the tight AO is open (convex)
    edge = math_node('MULTIPLY', math_node('SUBTRACT', 1.0, dot.outputs['Value']), 7.0, clamp=True)
    convex = math_node('MULTIPLY', edge, math_node('MULTIPLY', math_node('SUBTRACT', ao_s_out, 0.72), 4.0, clamp=True), clamp=True)
    # grime: a band up from the ground (world z of the building frame), world
    # blotches, and the cavities (1 - AO)
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Position'], sep.inputs['Vector'])
    band = math_node('SUBTRACT', 1.0, math_node('DIVIDE', sep.outputs['Z'], 2.2, clamp=True), clamp=True)
    band = math_node('POWER', band, 1.6)
    noi = nt.nodes.new('ShaderNodeTexNoise')
    noi.inputs['Scale'].default_value = 0.9
    noi.inputs['Detail'].default_value = 4.0
    L.new(geo.outputs['Position'], noi.inputs['Vector'])
    blot = math_node('MULTIPLY', math_node('SUBTRACT', noi.outputs['Fac'], 0.35), 1.8, clamp=True)
    # only the genuinely occluded (squared): broad walls and roofs stay clean
    occl = math_node('SUBTRACT', 1.0, ao_out)
    cav = math_node('MULTIPLY', math_node('MULTIPLY', occl, occl), 1.1, clamp=True)
    grime = math_node('ADD', math_node('MULTIPLY', band, math_node('ADD', 0.35, blot)), cav, clamp=True)
    grime = math_node('ADD', grime, math_node('MULTIPLY', blot, 0.18), clamp=True)
    comb = nt.nodes.new('ShaderNodeCombineColor')
    L.new(ao_out, comb.inputs[0])
    L.new(grime, comb.inputs[1])
    L.new(convex, comb.inputs[2])
    L.new(comb.outputs['Color'], emi.inputs['Color'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    return m


def _dilate_blur(img, sigma=1.4, grow=10):
    """Denoise the baked mask inside its UV islands (normalized convolution:
    never bleeds the empty gutter in), then grow the islands out over the
    gutter so mips and filtering never pull black in."""
    import numpy as np
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    cov = (px[..., 3] > 0.5).astype(np.float32)
    rgb = px[..., :3] * cov[..., None]

    def gblur(a, s):
        fy = np.fft.fftfreq(h)[:, None]
        fx = np.fft.fftfreq(w)[None, :]
        k = np.exp(-2 * (math.pi ** 2) * (s ** 2) * (fx ** 2 + fy ** 2))
        if a.ndim == 3:
            return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * k)) for c in range(a.shape[2])], -1)
        return np.real(np.fft.ifft2(np.fft.fft2(a) * k))
    num = gblur(rgb, sigma)
    den = gblur(cov, sigma)[..., None]
    sm = np.where(cov[..., None] > 0, num / np.maximum(den, 1e-4), 0)
    # grow outward a few steps
    cur, c = sm, cov.copy()
    for _ in range(grow):
        n2 = gblur(cur * c[..., None], 1.0)
        d2 = gblur(c, 1.0)[..., None]
        fill = (c[..., None] < 0.5) & (d2 > 0.05)
        cur = np.where(fill, n2 / np.maximum(d2, 1e-4), cur)
        c = np.maximum(c, (d2[..., 0] > 0.05).astype(np.float32))
    out = np.concatenate([np.clip(cur, 0, 1), np.ones((h, w, 1), np.float32)], -1)
    img.pixels[:] = out.reshape(-1)


def smart_bake(tag, part_objs, size=1024, samples=32, out_dir=None):
    """Unwrap the building's parts AND its placed props into one unique UV
    set, bake its mask, and give every textured material a per-building copy
    that wears it."""
    sc = bpy.context.scene
    part_objs = [o for o in part_objs if len(o.data.polygons) > 0]   # (an empty storey part: a one-storey house)
    # placed props share their kit template's mesh: each needs its OWN copy
    # for a unique mask UV (the tiling UVs and swatch tints come along)
    for o in part_objs:
        if o.data.users > 1:
            o.data = o.data.copy()
    # 1. a unique UV set across all the building's hand-built parts
    for o in part_objs:
        me = o.data
        uvm = me.uv_layers.get('UVMask') or me.uv_layers.new(name='UVMask')
        me.uv_layers.active = uvm
        for lay in me.uv_layers:
            lay.active_render = (lay.name == 'UVMap')
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in part_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = part_objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.003, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 2. bake the mask (every part's slots on the bake material for the bake)
    img = bpy.data.images.get(f'mask_{tag}') or bpy.data.images.new(f'mask_{tag}', size, size, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 0)
    bake_mat = _mask_bake_material(img)
    saved = {}
    for o in part_objs:
        saved[o.name] = [sl.material for sl in o.material_slots]
        for sl in o.material_slots:
            sl.material = bake_mat
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    # selected_to_active OFF, explicitly: the bake op falls back to the SCENE's
    # setting, and the LOD twin bake (bl_town_lod.py) turns it on - left on, it
    # baked every later building's mask onto one part from the others: a black
    # mask, i.e. black occlusion and grime, i.e. black buildings in game
    bpy.ops.object.bake(type='EMIT', margin=6, use_clear=True, target='IMAGE_TEXTURES', use_selected_to_active=False)
    for o in part_objs:
        for sl, m in zip(o.material_slots, saved[o.name]):
            sl.material = m
    bpy.data.materials.remove(bake_mat)
    _dilate_blur(img)
    img.pack()
    if out_dir:
        img.filepath_raw = f'{out_dir}/tidehold_{tag}.mask.png'
        img.file_format = 'PNG'
        img.save()
    # 3. per-building material copies wired to the mask (occlusion slot, UV 1)
    grp = _gltf_output_group()
    copies = {}
    for o in part_objs:
        for sl in o.material_slots:
            m = sl.material
            if m is None or m.name not in SMART:
                continue
            if m.name not in copies:
                c = m.copy()
                c.name = f'{m.name}@{tag}'
                nt = c.node_tree
                uvn = nt.nodes.new('ShaderNodeUVMap')
                uvn.uv_map = 'UVMask'
                tx = nt.nodes.new('ShaderNodeTexImage')
                tx.image = img
                nt.links.new(uvn.outputs['UV'], tx.inputs['Vector'])
                spl = nt.nodes.new('ShaderNodeSeparateColor')
                nt.links.new(tx.outputs['Color'], spl.inputs['Color'])
                g = nt.nodes.new('ShaderNodeGroup')
                g.node_tree = grp
                nt.links.new(spl.outputs['Red'], g.inputs['Occlusion'])
                d, da, mo, ma, ec, ea, aod = SMART[m.name]
                c['townSmart'] = {'dirt': _hex01(d), 'dirtAmt': da, 'moss': _hex01(mo), 'mossAmt': ma,
                                  'edge': _hex01(ec), 'edgeAmt': ea, 'aoDiffuse': aod}
                copies[m.name] = c
            sl.material = copies[m.name]
    return img


def _gltf_output_group():
    """The node group the glTF exporter reads extra outputs from (here only
    Occlusion)."""
    ng = bpy.data.node_groups.get('glTF Material Output')
    if ng is None:
        ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return ng
