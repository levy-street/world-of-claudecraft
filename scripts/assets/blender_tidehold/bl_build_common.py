# Building assembly toolkit for the medieval_village_v2 kit.
# Loaded via exec() after bl_helpers.py. Coordinates: BLENDER space while
# assembling (X/Y ground plane, +Z up). Rotation rz in RADIANS about +Z.
# finalize() exports a GLB (glTF Y-up) plus a JSON with collision boxes,
# ramps and interior volumes converted to glTF/model space and scaled.
import json as _json
import math as _math

import numpy as _np

_TEMPLATES = {}  # rel -> list[(mesh, name)] joined LOD0 mesh datas
_CANON = {}  # material base name -> canonical material
COLS = []  # dicts in Blender space: {cx,cy,cz,hx,hy,hz,rz}
RAMPS = []  # {cx,cy,hx,hy,rz,z0,z1} deck rises along local +X
INTERIORS = []  # {x0,x1,y0,y1,z0,z1} player-inside test volumes (storey boxes)
_GROUPS = {}
_ROOT = None


def _sel(objs, active=None):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    ov = win_override()
    bpy.context.view_layer.objects.active = active or objs[0]
    return ov


def load_template(rel):
    """Import a kit GLB once; keep LOD0 meshes only; join to ONE mesh."""
    if rel in _TEMPLATES:
        return _TEMPLATES[rel]
    new = import_glb(PACK + '/' + rel + '.glb')
    all_objs = set()
    for o in new:
        all_objs.add(o)
        for c in o.children_recursive:
            all_objs.add(c)
    # The castle/church families ship modelled bricks in LOD0 (928 tris for a
    # plain 2.5x5 wall); their LOD1/LOD2 are the FLAT walls with the same
    # windows and openings. Keep the flat LOD for those and skin it with the
    # Warden cobble below (cobblify); everything else keeps LOD0.
    fam = rel.split('/')[-1].rsplit('_', 1)[0]
    want = LOD_PICK.get(fam, 'LOD0')
    names = {m.name for m in all_objs if m.type == 'MESH'}
    if want != 'LOD0' and not any(n.endswith(want) for n in names):
        want = 'LOD1' if any(n.endswith('LOD1') for n in names) else 'LOD0'
    doomed = [
        m for m in all_objs if m.type == 'MESH' and '_LOD' in m.name and not m.name.endswith(want)
    ]
    meshes = [m for m in all_objs if m.type == 'MESH' and m not in doomed]
    empties = [o for o in all_objs if o.type != 'MESH']
    for m in doomed:
        bpy.data.objects.remove(m, do_unlink=True)
    # Clear parenting (keep world transform), then join into one object.
    for m in meshes:
        mw = m.matrix_world.copy()
        m.parent = None
        m.matrix_world = mw
    if len(meshes) > 1:
        ov = _sel(meshes, meshes[0])
        with bpy.context.temp_override(**ov):
            bpy.ops.object.join()
    base = meshes[0]
    # Canonicalize materials: every kit GLB embeds its own copy of the shared
    # atlas material; remap to one canonical per base name so joins merge and
    # the export carries a handful of materials instead of one per piece.
    for i, slot in enumerate(base.material_slots):
        m = slot.material
        if m is None:
            continue
        base_name = m.name.split('.')[0]
        canon = _CANON.get(base_name)
        if canon is None:
            _CANON[base_name] = m
        elif m is not canon:
            base.data.materials[i] = canon
    if fam == 'CastleFence':
        # Troy 2026-09-07: the gallery balustrade is a dark solid, not stone
        # brick (the cobble tile smeared across its little balusters).
        solidify_dark(base)
    elif fam.startswith(('Castle', 'Church')) and fam not in ('ChurchRoof',):
        cobblify(base, rel)
    # Remove leftover empties from the import.
    for o in empties:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass
    # Bake the import transform (Y-up conversion) into the mesh so linked
    # copies can use clean transforms.
    base.data.transform(base.matrix_world)
    base.matrix_world.identity()
    base.name = 'TPL_' + rel.replace('/', '_')
    base.data.name = base.name
    # Wood-plank pass: the house kit's cream plaster reads flat; Troy wants
    # planks. Only the HouseWall family, stone castle/church walls keep stone.
    # The roof pieces' closed gables are the same cream plaster: plank them
    # too, BEFORE any retint, or the slate hue-shift turns the gable infill
    # into a pale steel-blue panel that reads as glass (house audit C4).
    if rel.startswith(('buildings/HouseWall', 'buildings/HouseRoof')):
        try:
            plankify(base)
        except Exception as e:
            print('plankify failed for', rel, e)
    # The kit ships a duplicate TEXCOORD_1 and three vertex-colour layers on
    # every piece; only the first UV and COLOR_0 are read. Dropping the rest
    # here takes ~25% off every exported file (house audit C6).
    try:
        me = base.data
        if len(me.uv_layers) > 1:
            me.uv_layers.active_index = 0
            while len(me.uv_layers) > 1:
                me.uv_layers.remove(me.uv_layers[-1])
        extra = list(me.color_attributes)[1:]
        for ca in extra:
            me.color_attributes.remove(ca)
    except Exception as e:
        print('attribute strip failed for', rel, e)
    # Park the template out of sight of renders/exports.
    base.location = (0, 0, -500)
    _TEMPLATES[rel] = base
    return base


def group(name):
    global _ROOT
    if _ROOT is None:
        _ROOT = bpy.data.objects.new('BLDG', None)
        bpy.context.scene.collection.objects.link(_ROOT)
    if name not in _GROUPS:
        g = bpy.data.objects.new('G_' + name, None)
        g.parent = _ROOT
        bpy.context.scene.collection.objects.link(g)
        _GROUPS[name] = g
    return _GROUPS[name]


_COUNTER = [0]


_TPL_MINZ = {}


def use(rel, x, y, z=0.0, rz=0.0, grp='L0', s=1.0, sx=None, sy=None, sz=None, snap_ground=False):
    """Place a linked copy of a kit piece. rz radians CCW about +Z.
    snap_ground lifts the piece so its lowest vertex sits at z: the ivies and a
    few props are authored 0.13-0.51 below their own origin (house audit C7).
    Roof-family pieces are always retinted to slate here, so a dormer or
    lean-to placed with a bare use() can no longer ship terracotta (B1)."""
    tpl = load_template(rel)
    _COUNTER[0] += 1
    o = bpy.data.objects.new(f"P{_COUNTER[0]:03d}_{rel.split('/')[-1]}", tpl.data)
    zz = z
    if snap_ground:
        if rel not in _TPL_MINZ:
            _TPL_MINZ[rel] = min(v.co.z for v in tpl.data.vertices)
        zz = z - _TPL_MINZ[rel] * (sz or s)
    o.location = (x, y, zz)
    o.rotation_euler = (0, 0, rz)
    o.scale = (sx or s, sy or s, sz or s)
    o['woc_piece'] = rel   # a kit piece: the parts export keeps it as its own node
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    if rel.startswith(('buildings/HouseRoof', 'buildings/TerraceRoof', 'buildings/ChurchRoof', 'buildings/CastleRoof')):
        retint_roof([o])
    if rel.startswith('nature/Ivy'):
        retint_ivy([o])
    if rel.startswith('props/Lantern'):
        glow_lantern([o])
    return o


def col(cx, cy, cz, hx, hy, hz, rz=0.0):
    """Collision box, CENTER (cx,cy,cz) half extents, Blender space."""
    COLS.append(dict(cx=cx, cy=cy, cz=cz, hx=hx, hy=hy, hz=hz, rz=rz))


def col_wall(x0, y0, x1, y1, z0, z1, half_t=0.18):
    """Wall segment from (x0,y0) to (x1,y1) on the ground plane."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = x1 - x0, y1 - y0
    length = _math.hypot(dx, dy)
    rz = _math.atan2(dy, dx)
    COLS.append(
        dict(cx=cx, cy=cy, cz=(z0 + z1) / 2, hx=length / 2, hy=half_t, hz=(z1 - z0) / 2, rz=rz)
    )


def ramp(cx, cy, hx, hy, rz, z0, z1):
    """Walkable deck. Rises along the deck's local +X (z0 at -hx, z1 at +hx).
    rz rotates the deck within the model frame (Blender CCW about up)."""
    RAMPS.append(dict(cx=cx, cy=cy, hx=hx, hy=hy, rz=rz, z0=z0, z1=z1))


def interior(x0, x1, y0, y1, z0, z1):
    INTERIORS.append(dict(x0=x0, x1=x1, y0=y0, y1=y1, z0=z0, z1=z1))


def roof_material():
    """Slate-blue copy of the cartoon atlas for roof meshes."""
    name = 'CartoonTown_Roof'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    src = bpy.data.materials.get('CartoonTown_01')
    if src is None:
        for m in bpy.data.materials:
            if 'CartoonTown' in m.name:
                src = m
                break
    mat = src.copy()
    mat.name = name
    # Duplicate + recolor the atlas image.
    node = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    img = node.image.copy()
    img.name = 'CartoonTown_RoofBlue'
    px = _np.array(img.pixels[:], dtype=_np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    mx = rgb.max(axis=1)
    mn = rgb.min(axis=1)
    delta = mx - mn
    sat = _np.where(mx > 1e-5, delta / _np.maximum(mx, 1e-5), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    # hue in [0,6)
    hue = _np.zeros_like(mx)
    m_r = (mx == r) & (delta > 1e-5)
    m_g = (mx == g) & (delta > 1e-5) & ~m_r
    m_b = (mx == b) & (delta > 1e-5) & ~m_r & ~m_g
    hue[m_r] = ((g - b)[m_r] / delta[m_r]) % 6
    hue[m_g] = (b - r)[m_g] / delta[m_g] + 2
    hue[m_b] = (r - g)[m_b] / delta[m_b] + 4
    # Orange-ish saturated pixels -> deep slate blue, keeping value shape.
    warm = (sat > 0.25) & ((hue < 1.4) | (hue > 5.6))
    v = mx * 0.72  # darken a touch
    s2 = _np.clip(sat * 0.55, 0, 0.5)
    h2 = 3.72  # ~223 deg: stormwind slate blue
    c = v * s2
    x2 = c * (1 - _np.abs((h2 % 2) - 1))
    m2 = v - c
    nr, ng, nb = x2 * 0 + m2, x2 + m2, c + m2  # h2 in [3,4): (0,x,c)
    rgb2 = rgb.copy()
    rgb2[warm, 0] = nr[warm]
    rgb2[warm, 1] = ng[warm]
    rgb2[warm, 2] = nb[warm]
    px[:, :3] = rgb2
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    node2 = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    node2.image = img
    return mat


def gild_spire(objs, z_from):
    """Paint the metalwork ABOVE a slate cone, mast, collars and the star
    finial, in the wall's brass instead of the roof atlas's slate.

    Troy, 2026-09-09: "on the castle the roofs make the ornaments shiny solid
    gold instead of brick, the same colour as the gold trim." The ornament is
    not its own object in the kit (ChurchTower_03 is one mesh from eave to
    star), so the split is by HEIGHT in the piece's own local z, independent
    of where the spire was seated or how it was scaled. finalize() gives every
    WocBrassCourse face world-planar UVs, so there is no UV work here.
    """
    mat = brass_material()
    n = 0
    for o in objs:
        if o.type != 'MESH' or not o.data:
            continue
        o.data = o.data.copy()  # never gild the shared kit template
        me = o.data
        slot = next(
            (i for i, m in enumerate(me.materials) if m and m.name.startswith('WocBrassCourse')),
            None,
        )
        if slot is None:
            me.materials.append(mat)
            slot = len(me.materials) - 1
        for poly in me.polygons:
            if poly.center.z > z_from:
                poly.material_index = slot
                n += 1
    return n


def lantern_material():
    """The kit lanterns with a real EMISSION MAP: their amber pane lights up,
    the iron frame does not.

    Troy, 2026-09-09: "add an emission map to these lanterns on the map so they
    glow like the mushroom street lamps." The streetlamp does it with a plain
    emissiveFactor because it has its own LAMP_GLASS material; a kit lantern
    shares ONE atlas with every wall, roof and barrel in the village, so an
    emissive factor there would set the whole town alight. The map is the
    answer: a copy of the atlas that is black everywhere except the warm, bright
    texels, the pane, and it is only ever assigned to lantern objects, so a
    torch flame elsewhere on the sheet can never reach any other mesh.
    """
    name = 'CartoonTown_Lantern'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    src = bpy.data.materials.get('CartoonTown_01')
    if src is None:
        for m in bpy.data.materials:
            if 'CartoonTown' in m.name:
                src = m
                break
    mat = src.copy()
    mat.name = name
    nt = mat.node_tree
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    img = tex.image.copy()
    img.name = 'CartoonTown_LanternEmit'
    px = _np.array(img.pixels[:], dtype=_np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    mx = rgb.max(axis=1)
    mn = rgb.min(axis=1)
    sat = _np.where(mx > 1e-5, (mx - mn) / _np.maximum(mx, 1e-5), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    # The pane: bright, saturated, and warm (red over green over blue). The
    # frame is near-black iron and the chain is grey, so both fail on value.
    # Saturation is what separates the pane from the bracket: the amber glass
    # runs about 0.65 saturated, the lantern's tan WOOD about 0.45, and at the
    # first cut (0.35) the mounting blocks lit up like little lamps of their
    # own. Value alone cannot split them, the wood is bright too.
    lit = (mx > 0.5) & (sat > 0.58) & (r > g) & (g >= b)
    out = _np.zeros_like(rgb)
    out[lit] = rgb[lit]
    px[:, :3] = out
    px[:, 3] = 1.0
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    etex = nt.nodes.new('ShaderNodeTexImage')
    etex.image = img
    etex.location = (tex.location.x, tex.location.y - 320)
    bsdf = nt.nodes['Principled BSDF']
    nt.links.new(etex.outputs['Color'], bsdf.inputs['Emission Color'])
    # Bright enough to read as a lit lamp at night without blowing the pane out
    #, the veiled-crystal streetlamp sits at an emissive factor near 0.9/0.35/
    # 0.18 with no strength multiplier, and this map carries the same colour.
    bsdf.inputs['Emission Strength'].default_value = 1.6
    return mat


def glow_lantern(objs):
    """Swap a placed lantern onto the emissive copy of the atlas. Called from
    use() for every props/Lantern_* piece, so a building cannot hang a dead
    lamp by forgetting to ask."""
    mat = lantern_material()
    for o in objs:
        if o.type != 'MESH' or not o.data:
            continue
        o.data = o.data.copy()  # single-user so the kit template stays unlit
        for i, slot in enumerate(o.material_slots):
            if slot.material and 'CartoonTown' in slot.material.name:
                o.data.materials[i] = mat


def retint_roof(objs):
    mat = roof_material()
    for o in objs:
        if o.type != 'MESH':
            continue
        o.data = o.data.copy()  # single-user so the template stays terracotta
        for i, slot in enumerate(o.material_slots):
            if slot.material and 'CartoonTown' in slot.material.name:
                o.data.materials[i] = mat


def ivy_material():
    """Purple ivy: a copy of the cartoon atlas whose GREEN leaf pixels turn a
    violet-purple, except for blotches (low-frequency noise over the atlas)
    that stay green, so a vine reads as purple ivy with green bits."""
    name = 'CartoonTown_Ivy'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    src = bpy.data.materials.get('CartoonTown_01')
    if src is None:
        for m in bpy.data.materials:
            if 'CartoonTown' in m.name:
                src = m
                break
    mat = src.copy()
    mat.name = name
    node = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    img = node.image.copy()
    img.name = 'CartoonTown_IvyPurple'
    w, h = img.size
    px = _np.array(img.pixels[:], dtype=_np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    mx = rgb.max(axis=1)
    mn = rgb.min(axis=1)
    delta = mx - mn
    sat = _np.where(mx > 1e-5, delta / _np.maximum(mx, 1e-5), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    green = (sat > 0.2) & (g > r * 1.05) & (g > b * 1.05)
    # keep-green blotches: value noise over the atlas (cells ~40 px), ~28% of area
    ys, xs = _np.divmod(_np.arange(w * h), w)
    rng = _np.random.RandomState(17)
    cells = 40
    grid = rng.rand(h // cells + 2, w // cells + 2)
    gy, gx = ys // cells, xs // cells
    fy, fx = (ys % cells) / cells, (xs % cells) / cells
    n00 = grid[gy, gx]; n10 = grid[gy, gx + 1]; n01 = grid[gy + 1, gx]; n11 = grid[gy + 1, gx + 1]
    noise = (n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy
    keep = noise > 0.62
    purple = green & ~keep
    v = mx * 0.92
    s2 = _np.clip(sat * 1.05, 0.35, 0.85)
    h2 = 4.75  # ~285 deg: violet
    c = v * s2
    x2 = c * (1 - _np.abs((h2 % 2) - 1))
    m2 = v - c
    nr, ng, nb = x2 + m2, m2, c + m2  # h2 in [4,5): (x,0,c)
    rgb2 = rgb.copy()
    rgb2[purple, 0] = nr[purple]
    rgb2[purple, 1] = ng[purple]
    rgb2[purple, 2] = nb[purple]
    px[:, :3] = rgb2
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    node.image = img
    return mat


def retint_ivy(objs):
    mat = ivy_material()
    for o in objs:
        if o.type != 'MESH':
            continue
        o.data = o.data.copy()
        for i, slot in enumerate(o.material_slots):
            if slot.material and 'CartoonTown' in slot.material.name:
                o.data.materials[i] = mat


DECAL_PNGS = {
    'grime': '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/DecalGrime.png',
    'moss': '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/DecalMoss.png',
}


def decal_material(kind):
    name = 'WocDecal_' + kind
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(DECAL_PNGS[kind])
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat.node_tree.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.95
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.0
    mat.blend_method = 'BLEND'
    try:
        mat.surface_render_method = 'BLENDED'
    except Exception:
        pass
    mat.use_backface_culling = True
    return mat


def decal(x, y, z, w, h, rz, kind='grime', grp='L0', flip=False):
    """A weathering decal: a w x h alpha quad whose face normal is local +Y
    rotated by rz (so rz=0 faces +Y, pi faces -Y, pi/2 faces -X), centred on
    (x, y, z) which should sit ~0.03 off the wall surface."""
    if kind == 'moss':
        return None  # Troy: the green blobs looked crap; keep the drips only
    name = f'decal_{kind}_{len(bpy.data.meshes)}'
    me = bpy.data.meshes.new(name)
    hw, hh = w / 2, h / 2
    verts = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.update()
    me.materials.append(decal_material(kind))
    uv = me.uv_layers.new()
    corner = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for poly in me.polygons:
        for li in poly.loop_indices:
            u, v = corner[me.loops[li].vertex_index]
            uv.data[li].uv = (1 - u if flip else u, v)
    o = bpy.data.objects.new(name, me)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, rz)
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    return o


def _building_bbox():
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for g in _GROUPS.values():
        for o in g.children:
            if o.type != 'MESH':
                continue
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                for i in range(3):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
    return lo, hi


def _stone_world_uvs(me, lo, hi):
    """Map every WocCobbleWall face across the WHOLE building in kit space:
    u runs along the facade (x for +-Y faces, y for +-X faces), v up the full
    height. One non-tiling stonewash then spans each facade continuously,     no per-module restarts, no seams. Call after the mesh is single-user
    and in world (kit) coordinates."""
    slot = None
    for i, m in enumerate(me.materials):
        if m and m.name.startswith('WocCobbleWall'):
            slot = i
    if slot is None or not me.uv_layers.active:
        return
    uvl = me.uv_layers.active.data
    wx = max(hi[0] - lo[0], 1e-3)
    wy = max(hi[1] - lo[1], 1e-3)
    wz = max(hi[2] - lo[2], 1e-3)
    # keep texel density similar on every axis: the long axis spans 0..1,
    # the others scale by their length so the mottle is not stretched
    longest = max(wx, wy, wz)
    for poly in me.polygons:
        if poly.material_index != slot:
            continue
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.y) > 0.7:
                u = (co.x - lo[0]) / longest
            elif abs(n.x) > 0.7:
                u = (co.y - lo[1]) / longest + 0.37   # offset so sides do not mirror the front
            else:
                u = (co.x - lo[0]) / longest
            v = (co.z - lo[2]) / longest
            uvl[li].uv = (u % 1.0, v % 1.0)


BRASS_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/BrassCourse_Color.jpg'  # dg_lib mat_brass baked: the towers' gold
BRASS_UV_K = 0.5
BRASS_METALLIC = 0.82   # dg_lib mat_brass default: the wall/tower brass
STUD_STEP = 0.72   # the spire straps' studs: 0.11 cubes, evenly spaced
STUD = 0.11


BRASS_NRM = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/BrassCourse_Normal.jpg'
BRASS_ORM = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/BrassCourse_ORM.png'


def brass_material():
    """The Warden wall's brass, exactly: dg_lib mat_brass baked (colour with
    patina, its relief) and shipped as REAL metal with the kit's roughness
    band, dark gold in shade, bright specular in the sun. Troy's reference
    is the wall course in game; 12% darker in the colour map."""
    name = 'WocBrassCourse'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    img = bpy.data.images.load(BRASS_JPG); img.pack()
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nimg = bpy.data.images.load(BRASS_NRM); nimg.colorspace_settings.name = 'Non-Color'; nimg.pack()
    ntex = nt.nodes.new('ShaderNodeTexImage'); ntex.image = nimg
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.35
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    oimg = bpy.data.images.load(BRASS_ORM); oimg.colorspace_settings.name = 'Non-Color'; oimg.pack()
    otex = nt.nodes.new('ShaderNodeTexImage'); otex.image = oimg
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(otex.outputs['Color'], sep.inputs['Color'])
    mr = nt.nodes.new('ShaderNodeMath'); mr.operation = 'MULTIPLY_ADD'
    mr.inputs[1].default_value = 0.8; mr.inputs[2].default_value = 0.16   # rough 0.16..0.5: shinier than the wall's 0.22..0.55
    nt.links.new(sep.outputs['Green'], mr.inputs[0])
    nt.links.new(mr.outputs['Value'], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = BRASS_METALLIC
    bsdf.inputs['Emission Strength'].default_value = 0.0
    return mat


def iron_material():
    """Dark metal for the window frames and door arches (the kit's surround
    swatches): near-black steel with the brass relief for a little grain,
    low-metal so it does not go pure black under the game's env light."""
    name = 'WocDarkIron'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.062, 0.046, 0.032, 1)   # dark bronze, 20% under the old steel
    bsdf.inputs['Metallic'].default_value = 0.5
    nimg = bpy.data.images.load(BRASS_NRM); nimg.colorspace_settings.name = 'Non-Color'; nimg.pack()
    ntex = nt.nodes.new('ShaderNodeTexImage'); ntex.image = nimg
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.35
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    oimg = bpy.data.images.load(BRASS_ORM); oimg.colorspace_settings.name = 'Non-Color'; oimg.pack()
    otex = nt.nodes.new('ShaderNodeTexImage'); otex.image = oimg
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(otex.outputs['Color'], sep.inputs['Color'])
    mr = nt.nodes.new('ShaderNodeMath'); mr.operation = 'MULTIPLY_ADD'
    mr.inputs[1].default_value = 0.5; mr.inputs[2].default_value = 0.3   # rough 0.3..0.58
    nt.links.new(sep.outputs['Green'], mr.inputs[0])
    nt.links.new(mr.outputs['Value'], bsdf.inputs['Roughness'])
    bsdf.inputs['Emission Color'].default_value = (0.05, 0.036, 0.022, 1)
    bsdf.inputs['Emission Strength'].default_value = 0.2
    return mat


def _brass_world_uvs(me):
    slot = None
    for i, m in enumerate(me.materials):
        if m and m.name.startswith(('WocBrassCourse', 'WocDarkIron')):
            slot = i
    if slot is None or not me.uv_layers.active:
        return
    metal_slots = {i for i, m in enumerate(me.materials) if m and m.name.startswith(('WocBrassCourse', 'WocDarkIron'))}
    uvl = me.uv_layers.active.data
    k = BRASS_UV_K
    for poly in me.polygons:
        if poly.material_index not in metal_slots:
            continue
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                uvl[li].uv = (co.x * k, co.y * k)
            elif abs(n.y) > 0.7:
                uvl[li].uv = (co.x * k, co.z * k)
            else:
                uvl[li].uv = (co.y * k, co.z * k)


def _solid_box(cx, cy, cz, hx, hy, hz, mat, grp='L0', rz=0.0):
    name = f'brass_{len(bpy.data.meshes)}'
    me = bpy.data.meshes.new(name)
    vs = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
          (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(vs, [], fs)
    me.update()
    me.materials.append(mat)
    uv = me.uv_layers.new()
    for p in me.polygons:
        for li in p.loop_indices:
            uv.data[li].uv = (0.5, 0.5)
    o = bpy.data.objects.new(name, me)
    o.location = (cx, cy, cz)
    o.rotation_euler = (0, 0, rz)
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    return o


def brass_run(x0, y0, x1, y1, z, out=0.0, grp='L0', rivets=True, h=0.16, t=0.10):
    """A studded brass string course along the wall line (x0,y0)->(x1,y1)
    at height z, pushed `out` along the line's left-hand normal so it stands
    proud of the face (pass the outward side's sign). Studs are the spire
    towers' 0.11 cubes, STUD_STEP apart, standing proud of the band."""
    dx, dy = x1 - x0, y1 - y0
    L = _math.hypot(dx, dy)
    if L < 1e-6:
        return
    ang = _math.atan2(dy, dx)
    nx, ny = -dy / L, dx / L
    cx, cy = (x0 + x1) / 2 + nx * out, (y0 + y1) / 2 + ny * out
    mat = brass_material()
    _solid_box(cx, cy, z, L / 2 + t, t / 2, h / 2, mat, grp, ang)
    if rivets:
        n = max(1, int(round(L / STUD_STEP)))
        for i in range(n):
            f = (i + 0.5) / n
            px, py = x0 + dx * f + nx * (out + t / 2), y0 + dy * f + ny * (out + t / 2)
            _solid_box(px, py, z, STUD / 2, STUD / 2, STUD / 2, mat, grp, ang)


# ---- the Warden kit's cyan rune conduit, for the castle (Troy, 2026-09-10:
# "add some glowing decals like the walls and towers so the design of the
# castle looks like the walls"). dg_lib.mat_rune is a noise-modulated
# procedural that only survives a BAKE (the wall/tower kits bake to
# *_emis maps); the castle pipeline exports Principled materials as they are,
# so this is the same colour and strength as a flat emissive. The renderer
# lifts any authored emissive to its 2.2 floor (placed_assets.ts
# MIN_NATIVE_EMISSIVE_INTENSITY), which is exactly what the baked wall map
# gets, so the two glow alike in game.
RUNE_CYAN_LIN = (0.114, 0.630, 0.807)   # dg_lib RUNE_CYAN 0x5fd0e8, linear
RUNE_T = 0.08          # conduit section (kit), the wall's tube is 0.08-0.12
RUNE_CELL = 2.5        # one sigil per kit module, like the wall panel
RUNE_SIGIL = 0.30      # the lozenge, 0.30 square like the wall's
RUNE_GAP = 0.34        # the conduit stops this short of a sigil's centre
RUNE_END = 0.18        # ...and of a module's ends
# The conduit is an INLAY: the tube sits in the stone with only its front
# RUNE_PROUD past the module's nominal face, the lozenge a hair more. Troy,
# 2026-09-10: "make sure the ivy goes over top of the glowing lights", a tube
# standing 0.13 proud ran THROUGH the ivy's leaf volume and shone between the
# leaves. Sunk to an inlay, every leaf of an ivy seated IVY_OFF off the face
# is in front of it, and it is what the Warden wall's channel is anyway: a
# conduit cut into the panel.
#
# Why 0.075 and not flush: the stone is NOT flat. cobblify's relief puts the
# wall surface anywhere within +-0.05 of the module's nominal face (measured
# by ray-cast on the built castle, 12.875..12.970 on a face nominally at
# 12.92), and a 0.012 inlay vanished into the peaks along the side walls
# while the gate wall, sampled in troughs, showed it whole.
RUNE_PROUD = 0.075
SIGIL_PROUD = 0.09
SIGIL_HALF_T = 0.035
IVY_OFF = 0.11        # ivy seat off a nominal face: past the lozenge front
DECAL_OFF = 0.06      # weathering decals: past the relief peaks, under the inlay


def rune_material():
    name = 'WocRune'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    c = RUNE_CYAN_LIN
    # dark cyan base so an unlit engine still reads a channel (mat_rune's rule)
    bsdf.inputs['Base Color'].default_value = (c[0] * 0.25, c[1] * 0.25, c[2] * 0.25, 1)
    bsdf.inputs['Emission Color'].default_value = (c[0], c[1], c[2], 1)
    bsdf.inputs['Emission Strength'].default_value = 1.2   # the wall kit's mat_rune strength
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def _rune_diamond(cx, cy, cz, tang, grp='L0'):
    """The lozenge sigil: a square stood on its corner in the face plane.
    `tang` is the face's tangent bearing (the run direction); the 45-degree
    tilt is about the box's local Y, which is the face normal before the yaw
    (Blender XYZ Euler applies Y before Z)."""
    o = _solid_box(cx, cy, cz, RUNE_SIGIL / 2, SIGIL_HALF_T, RUNE_SIGIL / 2, rune_material(), grp, tang)
    o.rotation_euler = (0.0, _math.radians(45), tang)
    return o


def rune_run(x0, y0, x1, y1, z, face=0.0, grp='L0'):
    """A rune conduit inlaid along the wall line (x0,y0)->(x1,y1) at height z.
    `face` is where the wall's FACE is, signed along the line's left-hand
    normal (brass_run's convention for `out`); the tube is sunk so only
    RUNE_PROUD of it stands past that face. Laid per RUNE_CELL from (x0,y0):
    a tube either side of a lozenge sigil at each module's centre, so start
    it at a module boundary (a tower face) and the sigils land on the
    modules."""
    dx, dy = x1 - x0, y1 - y0
    L = _math.hypot(dx, dy)
    if L < 0.5:
        return
    ang = _math.atan2(dy, dx)
    ux, uy = dx / L, dy / L
    nx, ny = -dy / L, dx / L
    sgn = 1.0 if face >= 0 else -1.0
    tube = face + sgn * (RUNE_PROUD - RUNE_T / 2)
    sig = face + sgn * (SIGIL_PROUD - SIGIL_HALF_T)
    mat = rune_material()

    def seg(a, b):
        if b - a < 0.25:
            return
        m = (a + b) / 2
        _solid_box(x0 + ux * m + nx * tube, y0 + uy * m + ny * tube, z,
                   (b - a) / 2, RUNE_T / 2, RUNE_T / 2, mat, grp, ang)

    s = 0.0
    while s + RUNE_CELL <= L + 1e-6:
        c = s + RUNE_CELL / 2
        seg(s + RUNE_END, c - RUNE_GAP)
        seg(c + RUNE_GAP, s + RUNE_CELL - RUNE_END)
        _rune_diamond(x0 + ux * c + nx * sig, y0 + uy * c + ny * sig, z, ang, grp)
        s += RUNE_CELL
    if L - s > 0.8:   # a trailing part-module: plain conduit
        seg(s + RUNE_END, L - RUNE_END)


def rune_post(fx, fy, nx, ny, spans, sigil_z, face=0.14, grp='L0'):
    """The Warden tower's vertical conduit inlaid on one tower face: (fx,fy)
    on the face's wall line, (nx,ny) its outward unit normal, `face` the
    module's half-thickness (where the stone face is), `spans` the (z0,z1)
    runs between the brass straps, and one lozenge at sigil_z."""
    mat = rune_material()
    tube = face + RUNE_PROUD - RUNE_T / 2
    cx, cy = fx + nx * tube, fy + ny * tube
    for z0, z1 in spans:
        _solid_box(cx, cy, (z0 + z1) / 2, RUNE_T / 2, RUNE_T / 2, (z1 - z0) / 2, mat, grp, 0.0)
    tang = _math.atan2(ny, nx) + _math.pi / 2
    sig = face + SIGIL_PROUD - SIGIL_HALF_T
    _rune_diamond(fx + nx * sig, fy + ny * sig, sigil_z, tang, grp)


def brass_ring(cx, cy, hx, hy, z, out=0.22, grp='L0'):
    """Courses around a rectangle (hx, hy half extents) centred on (cx, cy)."""
    brass_run(cx - hx, cy + hy, cx + hx, cy + hy, z, out, grp)   # +Y face
    brass_run(cx + hx, cy - hy, cx - hx, cy - hy, z, out, grp)   # -Y face
    brass_run(cx + hx, cy + hy, cx + hx, cy - hy, z, out, grp)   # +X face
    brass_run(cx - hx, cy - hy, cx - hx, cy + hy, z, out, grp)   # -X face


DG_LIB = '/Users/troy/Documents/woc/carve/scripts/assets/deepglass/dg_lib.py'
BAKE_STONE = True
STONE_BAKE_SIZE = 2048
_DG = {}


def _dg():
    """dg_lib (the warden kit's material + bake helpers) in its own namespace,
    so its reset_scene/render_preview never shadow bl_helpers'."""
    if not _DG:
        exec(open(DG_LIB).read(), _DG)
    return _DG


def _bake_stone_walls(name, out_dir):
    """Every WocCobbleWall face of the joined building becomes its own
    object skinned with the warden kit's PROCEDURAL stonewash, smart-UV'd and
    baked (colour x ambient occlusion) into one 2048 map for this building,     continuous, seam-free, full texel density, just like the towers."""
    dg = _dg()
    stone_objs = []
    fam_of = {}   # baked object -> 'stone' | 'plaster'
    for g in _GROUPS.values():
      for fam, prefix in (('stone', 'WocCobbleWall'),):
        for o in list(g.children):
            if o.type != 'MESH':
                continue
            me = o.data
            slot = None
            for i, m in enumerate(me.materials):
                if m and m.name.startswith(prefix):
                    slot = i
            if slot is None:
                continue
            bm = bmesh.new()
            bm.from_mesh(me)
            stone_faces = [f for f in bm.faces if f.material_index == slot]
            if not stone_faces:
                bm.free()
                continue
            # copy the stone faces into a new mesh, drop them from the original
            nb = bmesh.new()
            vmap = {}
            vl = bm.faces.layers.int.get('woc_var')
            nvl = nb.faces.layers.int.new('woc_var')
            for f in stone_faces:
                vs = []
                for v in f.verts:
                    if v.index not in vmap:
                        vmap[v.index] = nb.verts.new(v.co)
                    vs.append(vmap[v.index])
                try:
                    nf = nb.faces.new(vs)
                    nf.smooth = False
                    nf[nvl] = f[vl] if vl else 0
                except ValueError:
                    pass
            nb.normal_update()
            sme = bpy.data.meshes.new(o.name + '_stone')
            nb.to_mesh(sme)
            nb.free()
            bmesh.ops.delete(bm, geom=stone_faces, context='FACES')
            bm.to_mesh(me)
            bm.free()
            so = bpy.data.objects.new(o.name + '_' + fam, sme)
            so.parent = o.parent
            bpy.context.scene.collection.objects.link(so)
            stone_objs.append(so)
            fam_of[so.name] = fam
    tiled = [so for so in stone_objs if fam_of.get(so.name) != 'plaster']
    for so in tiled:
        so.data.materials.clear()
        so.data.materials.append(stone_tiled_material())
        _planar_uvs_var(so.data, STONE_IMG_K)
        _weather_stone(so)
    stone_objs = [so for so in stone_objs if fam_of.get(so.name) == 'plaster']
    if not stone_objs:
        return
    n_faces = sum(len(so.data.polygons) for so in stone_objs)
    # island count tracks face count (every kit stone patch is its own
    # island); above ~12k faces a 2048 map is all margin, so bake bigger and
    # thinner-margined (the installer ships the stone at 2048 either way).
    # 4K only where the island count needs it (the keep); a house's few
    # hundred faces get full density at 2K and bake in a third of the time
    size = 4096 if n_faces > 12000 else 2048
    margin = 0.0008 if size == 4096 else 0.0015
    print(f'  stone bake: {n_faces} faces -> {size}px, margin {margin}')
    mat = _stone_image_material()
    # plaster: a soft cream mottle with a fine grain, no chips to speak of
    pmat = dg['mat_stone']('WocPlasterProc', dg['srgb'](0xe3dccd), dg['srgb'](0xc4bbaa), scale=0.35,
                           rough=(0.75, 0.95), bump=0.12)
    for so in stone_objs:
        so.data.materials.clear()
        so.data.materials.append(pmat if fam_of.get(so.name) == 'plaster' else mat)
    # smart-project, then PACK the islands of every stone object together:
    # packed per object they overlap in the shared map and later bakes punch
    # black rectangles into earlier ones (the keep's 5 wall groups did).
    with bpy.context.temp_override(**dg['ctx_override']()):
        dg['activate'](stone_objs)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=_math.radians(66), island_margin=margin,
                                 correct_aspect=True, scale_to_bounds=False)
        try:
            bpy.ops.uv.pack_islands(rotate=True, margin=margin * 1.5)
        except Exception as e:
            print('  pack_islands failed:', e)
        bpy.ops.object.mode_set(mode='OBJECT')
    base = dg['_img'](name + '_stone_base', size)
    ao = dg['_img'](name + '_stone_ao', size, is_data=True, fill=(1, 1, 1, 1))
    norm = dg['_img'](name + '_stone_norm', size, is_data=True, fill=(0.5, 0.5, 1.0, 1))
    dg['bake_value'](stone_objs, base, lambda b: b.inputs['Base Color'], samples=6)
    dg['bake_pass'](stone_objs, ao, 'AO', 20)
    # the procedural bump (chip grain) as a tangent normal map, so the stone
    # keeps its micro-relief and the proud blocks catch the light
    dg['bake_pass'](stone_objs, norm, 'NORMAL', 8)
    dg['multiply_ao'](base, ao, 0.55)
    path = dg['save_img'](base, f"{out_dir}/{name}_stone.png", 'sRGB')
    norm.scale(size // 2, size // 2)
    npath = dg['save_img'](norm, f"{out_dir}/{name}_stone_norm.png", 'Non-Color')
    img = bpy.data.images.load(path)
    img.pack()
    nimg = bpy.data.images.load(npath)
    nimg.colorspace_settings.name = 'Non-Color'
    nimg.pack()
    baked = bpy.data.materials.new('WocStoneBaked')
    baked.use_nodes = True
    bsdf = baked.node_tree.nodes['Principled BSDF']
    tex = baked.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    baked.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    ntex = baked.node_tree.nodes.new('ShaderNodeTexImage')
    ntex.image = nimg
    nmap = baked.node_tree.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 1.0
    baked.node_tree.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    baked.node_tree.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.82
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    for so in stone_objs:
        so.data.materials.clear()
        so.data.materials.append(baked)
    print(f'  stone bake: {len(stone_objs)} wall objects -> {path}')


FLOOR_TILE_UV_K = 0.4  # one tile repeat per 2.5 kit units, in WORLD space


def _link_roughness_map(nt, bsdf, path):
    """A greyscale roughness image on the Roughness socket through the G
    channel, the way the glTF exporter packs it into metallicRoughness."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    img.pack()
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tex.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    return tex


# The two floor sets (Troy, 2026-09-10: "change the floors of the enterable
# buildings to planks85_01 with its 3 extra maps; tiles224_01 for the harder
# floors like the castle grounds and the forge"). Each ships colour x AO,
# the GL normal map and a roughness map derived from the displacement.
# FLOOR_DEFAULT is the building's floor; FLOOR_PICK (x, y, z) -> kind lets
# one building mix them (the castle: stone below, planks on the upper floors).
FLOOR_DIR = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold'
FLOOR_SETS = {
    'tiles': ('WocFloorTile', 'Tiles224_01'),
    'planks': ('WocFloorPlanks', 'Planks85_01'),
}
FLOOR_DEFAULT = 'tiles'
FLOOR_PICK = None


def floor_material(kind=None):
    kind = kind or FLOOR_DEFAULT
    name, stem = FLOOR_SETS[kind]
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(f'{FLOOR_DIR}/{stem}_ColorAO.jpg')
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nimg = bpy.data.images.load(f'{FLOOR_DIR}/{stem}_NormalGL.jpg')
    nimg.colorspace_settings.name = 'Non-Color'
    nimg.pack()
    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = nimg
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 1.6
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.8
    _link_roughness_map(nt, bsdf, f'{FLOOR_DIR}/{stem}_Rough.jpg')
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25 if kind == 'tiles' else 0.2
    return mat


def _floor_world_uvs(me):
    """Re-map every WocFloor* face in world (kit) space: tops by (x, y),
    risers by (along, z). The per-slab 0..1 map squashed a 0.5-deep stair
    tread into stripes and gave riser faces a constant coordinate. With a
    FLOOR_PICK set, each face is first dealt its floor set by position."""
    slots = {i for i, m in enumerate(me.materials) if m and m.name.startswith('WocFloor')}
    if not slots or not me.uv_layers.active:
        return
    pick = globals().get('FLOOR_PICK')
    idx = {}
    if pick:
        for kind in FLOOR_SETS:
            m = floor_material(kind)
            if m.name not in [mm.name for mm in me.materials if mm]:
                me.materials.append(m)
            idx[kind] = [i for i, mm in enumerate(me.materials) if mm and mm.name == m.name][0]
        slots = slots | set(idx.values())
    uvl = me.uv_layers.active.data
    k = FLOOR_TILE_UV_K
    for poly in me.polygons:
        if poly.material_index not in slots:
            continue
        if pick:
            c = poly.center
            poly.material_index = idx[pick(c.x, c.y, c.z)]
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                uvl[li].uv = (co.x * k, co.y * k)
            elif abs(n.y) > 0.7:
                uvl[li].uv = (co.x * k, co.z * k)
            else:
                uvl[li].uv = (co.y * k, co.z * k)


SLAB_UV_K = 0.42  # the painted ashlar, same course size as the walls, world-planar


def slab_material():
    """Plain stonewash for hand-rolled slabs (stair masses, dais, plinths):
    the same non-tiling warden stone image as the walls once used, mapped in
    world space in finalize. Kept OUT of the AO bake, stacked stair masses
    share coplanar faces and bake black."""
    name = 'WocSlabStone'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(GREY_STONE_DARK_JPG)
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.82
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    return mat


def _slab_world_uvs(me):
    slot = None
    for i, m in enumerate(me.materials):
        if m and m.name.startswith('WocSlabStone'):
            slot = i
    if slot is None or not me.uv_layers.active:
        return
    uvl = me.uv_layers.active.data
    k = SLAB_UV_K
    for poly in me.polygons:
        if poly.material_index != slot:
            continue
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                uvl[li].uv = (co.x * k, co.y * k)
            elif abs(n.y) > 0.7:
                uvl[li].uv = (co.x * k, co.z * k)
            else:
                uvl[li].uv = (co.y * k, co.z * k)


GREY_STONE_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/GreyStone_Color.jpg'  # T_Bricks12 (2K) regraded to ashlar grey
STONE_IMG_K = 0.2100   # 2x bricks (Troy, 2026-09-10: "make this brick tile 2x bigger"); was 0.42


def _stone_image_material():
    """Troy's hand-painted ashlar (T_Bricks12, regraded grey), box-projected in
    OBJECT space so it wraps every wall continuously, with a bump derived from
    its own luminance. The per-building bake then captures colour x AO and
    the block relief as a normal map."""
    name = 'WocStoneImgProc'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(GREY_STONE_JPG)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (STONE_IMG_K, STONE_IMG_K, STONE_IMG_K)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.projection = 'BOX'
    tex.projection_blend = 0.15
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35
    bump.inputs['Distance'].default_value = 0.05
    nt.links.new(tex.outputs['Color'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.8
    return mat


GREY_STONE_NRM = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/GreyStone_Normal.jpg'
GREY_STONE_DARK_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/GreyStone_ColorDark.jpg'  # x0.82: Troy, "make the stone brick wall texture a bit darker"
GREY_STONE_ROUGH = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/GreyStone_Rough.jpg'  # from the colour's luminance: block faces smoother than mortar


def stone_tiled_material():
    """The painted ashlar TILED at full 2K density (one repeat per ~2.4 kit
    units) with the pack's normal map, the per-building bake spread the
    same image over a whole keep and every block dropped to a few texels."""
    name = 'WocStoneTiled'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(GREY_STONE_DARK_JPG)
    img.pack()
    nimg = bpy.data.images.load(GREY_STONE_NRM)
    nimg.colorspace_settings.name = 'Non-Color'
    nimg.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = nimg
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 2.2   # the pack's normal is shallow (B ~0.996): Troy, "the bricks still look flat"
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.82
    _link_roughness_map(nt, bsdf, GREY_STONE_ROUGH)
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    return mat


def _planar_uvs(me, k):
    uv = me.uv_layers.active or me.uv_layers.new()
    uvl = uv.data
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                uvl[li].uv = (co.x * k, co.y * k)
            elif abs(n.y) > 0.7:
                uvl[li].uv = (co.x * k, co.z * k)
            else:
                uvl[li].uv = (co.y * k, co.z * k)


def gable(pos, z_eave, z_ridge, half_at_eave, rz, grp='H2', bands=4,
          piece='buildings/HouseWall_01', axis='x', ph=3.0):
    """Stepped infill closing a gable triangle. axis='x': bands run along Y at
    x=pos (rz should be pi/2); axis='y': bands along X at y=pos (rz=0).
    ph = source piece height (3 for house walls, 5 for castle walls)."""
    bh = (z_ridge - z_eave) / bands
    for i in range(bands):
        z = z_eave + i * bh
        # Width from the band's BOTTOM plus a tuck margin: the top corners then
        # overlap INTO the roof shell, so no sky sliver opens at any step.
        half = max(0.35, half_at_eave * (z_ridge - z) / (z_ridge - z_eave) + 0.14)
        px, py = (pos, 0.0) if axis == 'x' else (0.0, pos)
        use(piece, px, py, z, rz, grp, sx=(half * 2) / 2.5, sz=bh / ph)


def steps(x, y, rz, width, treads, y_top, y_low=-0.02, depth=0.42, grp='L0',
          piece='environment/Tile_01'):
    """Custom entry steps: stacked cobble slabs descending OUTWARD (local +Y
    rotated by rz) from (x, y) at the building face. Tread i's top sits at
    y_top - i*rise; total run = treads*depth. Adds one walkable deck over the
    whole run (high at the building, y_low at the outer edge).
    The kit's ChurchStairs read broken at arbitrary scales; these stay crisp."""
    rise = (y_top - max(0.0, y_low)) / treads
    ux, uy = -_math.sin(rz), _math.cos(rz)  # outward unit
    for i in range(treads):
        top = y_top - i * rise
        cx = x + ux * (depth / 2 + i * depth)
        cy = y + uy * (depth / 2 + i * depth)
        # Tile_01 is 2.5 x 2.5 x ~0.17 with top at 0.166: scale so the slab
        # spans ground..top (chunky solid treads, no floating strata).
        sz = top / 0.166
        use(piece, cx, cy, 0.0, rz, grp, sx=width / 2.5, sy=(depth + 0.06) / 2.5, sz=sz)
    run = treads * depth
    ramp(x + ux * run / 2, y + uy * run / 2, run / 2 + 0.1, width / 2, rz + _math.pi / 2,
         y_top, y_low)


def _planar_uvs_slot(me, slot, k):
    """_planar_uvs for the faces of ONE material slot (piece-local frame)."""
    uv = me.uv_layers.active or me.uv_layers.new()
    uvl = uv.data
    for poly in me.polygons:
        if poly.material_index != slot:
            continue
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                uvl[li].uv = (co.x * k, co.y * k)
            elif abs(n.y) > 0.7:
                uvl[li].uv = (co.x * k, co.z * k)
            else:
                uvl[li].uv = (co.y * k, co.z * k)


def _parts_styled_copy(me):
    """A piece-local copy of a kit template mesh carrying the building's
    finished look: the cobble slot becomes the tiled grey stone (what
    _bake_stone_walls does to the joined building), metal trim and floor
    tiles get their planar UVs in the piece's own frame."""
    pme = me.copy()
    for i, m in enumerate(pme.materials):
        if m and m.name.startswith('WocCobbleWall'):
            pme.materials[i] = stone_tiled_material()
            _planar_uvs_slot(pme, i, STONE_IMG_K)
    _floor_world_uvs(pme)
    _brass_world_uvs(pme)
    return pme


EXPORT_PARTS = True


def _export_parts(name, out_dir, S, pieces):
    """`<name>.parts.glb`: every kit piece as its OWN node (name P###_<Kit>,
    world matrix = the kit placement under the root scale) plus the joined
    hand-built geometry as `shell_*` nodes. Studio's "Edit pieces" splits a
    placed building into these (src/editor/prefab_pieces_core.ts); the
    installer measures each node into data/prefab_pieces/<name>.json."""
    styled = {}
    orig = {}
    for o in pieces:
        me = o.data
        if me not in styled:
            styled[me] = _parts_styled_copy(me)
        orig[o] = me
        o.data = styled[me]
    _ROOT.scale = (S, S, S)
    bpy.context.view_layer.update()
    shell = [o for g in _GROUPS.values() for o in g.children if o.type == 'MESH' and not o.get('woc_piece')]
    sel = [o for o in shell + pieces if o.name in bpy.context.view_layer.objects]
    ov = _sel(sel, _ROOT)
    glb = f'{out_dir}/{name}.parts.glb'
    with bpy.context.temp_override(**ov):
        bpy.ops.export_scene.gltf(
            filepath=glb,
            use_selection=True,
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            export_tangents=False,
            export_animations=False,
        )
    side = {}
    for o in pieces:
        side[o.name] = dict(kit=o['woc_piece'], x=round(o.location.x, 4), y=round(o.location.y, 4),
                            z=round(o.location.z, 4), rz=round(o.rotation_euler.z, 4),
                            s=[round(v, 4) for v in o.scale])
    with open(f'{out_dir}/{name}.parts.json', 'w') as f:
        _json.dump(dict(name=name, scale=S, pieces=side), f, indent=1)
    for o, me in orig.items():
        o.data = me
    for pme in styled.values():
        if pme.users == 0:
            bpy.data.meshes.remove(pme)
    _ROOT.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    print(f'PARTS -> {glb} ({len(pieces)} pieces, {len(shell)} shell nodes)')


# Stone variation (Troy 2026-09-07: "castle/church exterior looks very
# repetitive"). Every kit PANEL gets its own variant of the one stone tile, # mirrored, flipped, shifted by whole courses, chosen from a hash of where it
# stands, and the joined stone gets baked vertex-colour weathering (damp
# plinth, low-frequency tone patches, lighter upper storeys). No new textures,
# no runtime cost: the variant is UVs, the weathering is COLOR_0.
STONE_ROW_V = 193.3 / 2048.0   # one course of the GreyStone tile in UV


def _tag_variant(o):
    """Face attribute 'woc_var' = this piece's stone variant code (survives
    the join; hand-built shell faces read 0 = the plain tile)."""
    me = o.data
    x, y, z = (round(float(v), 2) for v in o.matrix_world.translation)
    h = (int(x * 100) * 73856093) ^ (int(y * 100) * 19349663) ^ (int(z * 100) * 83492791)
    h = (h ^ (h >> 13)) & 0x7fffffff
    code = 1 + (h % 31)   # 1..31: bits 0/1 mirror u / flip v, bits 2-4 course shift
    attr = me.attributes.get('woc_var') or me.attributes.new('woc_var', 'INT', 'FACE')
    for d in attr.data:
        d.value = code


def _planar_uvs_var(me, k):
    """Planar stone UVs (as _planar_uvs) with the per-panel variant applied."""
    uv = me.uv_layers.active or me.uv_layers.new()
    uvl = uv.data
    var = me.attributes.get('woc_var')
    for poly in me.polygons:
        code = var.data[poly.index].value if var else 0
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(n.z) > 0.7:
                u, v = co.x * k, co.y * k
            elif abs(n.y) > 0.7:
                u, v = co.x * k, co.z * k
            else:
                u, v = co.y * k, co.z * k
            if code & 1:
                u = -u
            if code & 2:
                v = -v
            v += STONE_ROW_V * ((code >> 2) & 7)
            uvl[li].uv = (u, v)


def _weather_stone(so):
    """Subdivide the big flat panels (so a gradient has vertices to live on)
    and bake weathering into a POINT colour attribute, exported as COLOR_0:
    three multiplies it over the stone albedo."""
    from mathutils import noise as _noise
    me = so.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # No grid fill: the kit's window walls are n-gons wrapped round the
    # opening, and grid-filling their cut edges bridged straight across the
    # window (Troy: "the windows are covered up"). Extra verts along the
    # edges are enough for the colour gradient; the n-gons stay n-gons.
    # The kit's window walls are n-gons wrapped round the opening (not even
    # simple polygons: ear-clipping them still bridged the hole). They are
    # left exactly as authored, the glTF exporter triangulates them the way
    # it always did, and only edges whose faces are all quads/tris get the
    # gradient verts. (subdivide_edges splits a face between its new verts;
    # on a concave face those cuts crossed the window.)
    # an AO bake wants vertices where the shading changes: one more pass
    for cuts, longer in ((2, 3.0), (1, 1.4)) + (((1, 0.8),) if globals().get('AO_BAKE') else ()):
        edges = [e for e in bm.edges
                 if (e.verts[0].co - e.verts[1].co).length > longer
                 and all(len(f.verts) <= 4 for f in e.link_faces)]
        if edges:
            bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=False)
    bm.to_mesh(me)
    bm.free()
    me.update()
    ca = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    lo_z = min(v.co.z for v in me.vertices) if me.vertices else 0.0
    clamp = lambda v, a=0.0, b=1.0: max(a, min(b, v))
    for i, v in enumerate(me.vertices):
        p = v.co
        t = clamp((p.z - lo_z) / 2.2)                     # 0 at the plinth, 1 above 2.2 units
        damp = 0.68 + 0.32 * t * t * (3 - 2 * t)          # smoothstep up out of the damp
        n1 = _noise.noise(Vector((p.x * 0.09 + 3.1, p.y * 0.09, p.z * 0.09)))   # -1..1, ~11-unit patches
        n2 = _noise.noise(Vector((p.x * 0.45 + 7.7, p.y * 0.45 + 2.2, p.z * 0.45)))
        tone = 1.0 + 0.10 * n1 + 0.05 * n2
        upper = 1.0 + 0.05 * clamp((p.z - 5.0) / 3.0)     # upper storeys catch more light
        f = damp * tone * upper
        wet = 1.0 - t
        r = f * (1.0 - 0.06 * wet + 0.03 * n1)
        g = f * (1.0 + 0.015 * wet)
        b = f * (1.0 + 0.035 * wet - 0.03 * n1)
        ca.data[i].color = (clamp(r, 0.0, 1.5), clamp(g, 0.0, 1.5), clamp(b, 0.0, 1.5), 1.0)
    me.color_attributes.active_color = ca


def _join_members(members, bbox):
    """Join `members` per material set (the export carries a handful of
    materials, not one per piece), baking each object's transform into its
    own mesh copy first so the accessor bounds stay true."""
    by_mat = {}
    for o in members:
        key = tuple(sorted(sl.material.name if sl.material else '' for sl in o.material_slots))
        by_mat.setdefault(key, []).append(o)
    joined = []
    for key, objs in by_mat.items():
        for o in objs:
            o.data = o.data.copy()
            if o.get('woc_piece'):
                _tag_variant(o)
            o.data.transform(o.matrix_world)
            o.matrix_world.identity()
            _stone_world_uvs(o.data, bbox[0], bbox[1])
            _floor_world_uvs(o.data)
            _slab_world_uvs(o.data)
            _brass_world_uvs(o.data)
        if len(objs) > 1:
            ov = _sel(objs, objs[0])
            with bpy.context.temp_override(**ov):
                bpy.ops.object.join()
        joined.append(objs[0])
    return joined


# Ambient occlusion baked into every mesh's POINT colour attribute (over the
# stone's weathering), shipped as COLOR_0 for three to multiply over the
# albedo (Troy, 2026-09-10: "bake in some ambient occlusion lighting to this
# castle so it doesn't look so flat"). Kit pieces lose their junk colour
# attributes first, so the installer can keep COLOR_0 on the whole building.
AO_BAKE = False
AO_DIST = 5.0      # kit units the occlusion reaches (a room corner, an eave)
AO_SAMPLES = 32
AO_FLOOR = 0.22    # the darkest a fully occluded vertex gets
AO_GAMMA = 1.3     # >1 deepens the mid-tones: reveals and corners read as shadow


def bake_vertex_ao(log=print):
    import numpy as np
    scene = bpy.context.scene
    objs = [o for o in _ROOT.children_recursive
            if o.type == 'MESH' and o.name in bpy.context.view_layer.objects and len(o.data.polygons)]
    seen, uniq = set(), []
    for o in objs:
        if o.data.name in seen:
            continue
        seen.add(o.data.name)
        uniq.append(o)
    for o in uniq:
        me = o.data
        keep = me.color_attributes.get('Col') if o.name.endswith('_stone') else None
        for ca in list(me.color_attributes):
            if ca.name != 'Col' or keep is None:
                me.color_attributes.remove(ca)
        if me.color_attributes.get('Col') is None:
            col = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
            col.data.foreach_set('color', [1.0] * (len(me.vertices) * 4))
        tmp = me.color_attributes.new(name='AOtmp', type='FLOAT_COLOR', domain='POINT')
        tmp.data.foreach_set('color', [1.0] * (len(me.vertices) * 4))
        me.color_attributes.active_color = tmp
        me.color_attributes.active_color_index = me.color_attributes.find('AOtmp')
    if scene.world is None:
        scene.world = bpy.data.worlds.new('AOWorld')
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = AO_SAMPLES
    scene.cycles.use_denoising = False
    try:
        scene.world.light_settings.distance = AO_DIST
    except Exception:
        pass
    scene.render.bake.target = 'VERTEX_COLORS'
    scene.render.bake.use_selected_to_active = False
    for o in scene.objects:
        o.hide_render = not (o in objs or o == _ROOT)
    dg = _dg()
    with bpy.context.temp_override(**dg['ctx_override']()):
        dg['activate'](uniq)
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    nv = 0
    for o in uniq:
        me = o.data
        n = len(me.vertices)
        nv += n
        col, tmp = me.color_attributes['Col'], me.color_attributes['AOtmp']
        a = np.empty(n * 4, np.float32)
        tmp.data.foreach_get('color', a)
        c = np.empty(n * 4, np.float32)
        col.data.foreach_get('color', c)
        a = a.reshape(n, 4)
        c = c.reshape(n, 4)
        f = AO_FLOOR + (1.0 - AO_FLOOR) * np.clip(a[:, :1], 0.0, 1.0) ** AO_GAMMA
        c[:, :3] *= f
        col.data.foreach_set('color', c.ravel())
        me.color_attributes.remove(tmp)
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.active_color_index = me.color_attributes.find('Col')
    log(f'  vertex AO: {len(uniq)} meshes, {nv} vertices, dist {AO_DIST}, {AO_SAMPLES} samples')


def finalize(name, out_dir, S, no_join=()):
    """Join per group, scale by S, export GLB + collision JSON (+ the parts GLB)."""
    _BBOX = _building_bbox()
    # 1. the hand-built shell joins first; kit pieces stay whole for the parts export
    pieces_all = []
    for gname, g in _GROUPS.items():
        members = [c for c in g.children if c.type == 'MESH']
        shell = [o for o in members if not o.get('woc_piece')]
        pieces_all += [o for o in members if o.get('woc_piece')]
        if shell:
            for i, o in enumerate(_join_members(shell, _BBOX)):
                o.name = f'shell_{gname}_{i}'
    if EXPORT_PARTS and pieces_all:
        _export_parts(name, out_dir, S, pieces_all)
    # 2. the shipped building: everything joined per group + material set
    for gname, g in _GROUPS.items():
        members = [c for c in g.children if c.type == 'MESH']
        if not members:
            continue
        for i, o in enumerate(_join_members(members, _BBOX)):
            o.name = f'{gname}_{i}'
    if BAKE_STONE:
        _bake_stone_walls(name, out_dir)
    if globals().get('AO_BAKE'):
        bake_vertex_ao()
    _ROOT.scale = (S, S, S)
    bpy.context.view_layer.update()
    # Export: everything under root.
    exportables = [_ROOT] + [o for o in _ROOT.children_recursive]
    ov = _sel([o for o in exportables if o.name in bpy.context.view_layer.objects], _ROOT)
    glb = f'{out_dir}/{name}.glb'
    # The stone weathering lives in the active colour attribute; 'ACTIVE'
    # ships it as COLOR_0 whether or not the material graph reads it
    # (older exporters lack the option: fall back to their default).
    with bpy.context.temp_override(**ov):
        try:
            bpy.ops.export_scene.gltf(
                filepath=glb, use_selection=True, export_format='GLB', export_yup=True,
                export_apply=True, export_tangents=False, export_animations=False,
                export_vertex_color='ACTIVE',
            )
            glb_done = True
        except TypeError:
            glb_done = False
    if not glb_done:
      with bpy.context.temp_override(**ov):
        bpy.ops.export_scene.gltf(
            filepath=glb,
            use_selection=True,
            export_format='GLB',
            export_yup=True,
            export_apply=True,
            # The baked floor tile carries a tangent-space normal map; ship real
            # tangents rather than leaning on the renderer's derivative fallback.
            # No normal maps ship on these materials, so tangents are 16 bytes
            # per vertex of nothing (the shipped files carry none either).
            export_tangents=False,
            export_animations=False,
        )
    # Collision JSON in glTF model space (post-scale): (x,y,z)_b -> (x,z,-y)_g
    boxes = []
    for c in COLS:
        boxes.append(
            dict(
                x=round(c['cx'] * S, 4),
                y=round(c['cz'] * S, 4),
                z=round(-c['cy'] * S, 4),
                hx=round(c['hx'] * S, 4),
                hy=round(c['hz'] * S, 4),
                hz=round(c['hy'] * S, 4),
                **({'ry': round(c['rz'], 4)} if abs(c['rz']) > 1e-4 else {}),
            )
        )
    ramps_out = []
    for r in RAMPS:
        ramps_out.append(
            dict(
                x=round(r['cx'] * S, 4),
                z=round(-r['cy'] * S, 4),
                hx=round(r['hx'] * S, 4),
                hz=round(r['hy'] * S, 4),
                **({'ry': round(r['rz'], 4)} if abs(r['rz']) > 1e-4 else {}),
                y0=round(r['z0'] * S, 4),
                y1=round(r['z1'] * S, 4),
            )
        )
    ints = []
    for i in INTERIORS:
        ints.append(
            dict(
                x0=round(i['x0'] * S, 4),
                x1=round(i['x1'] * S, 4),
                z0=round(-i['y1'] * S, 4),
                z1=round(-i['y0'] * S, 4),
                y0=round(i['z0'] * S, 4),
                y1=round(i['z1'] * S, 4),
            )
        )
    meta = dict(name=name, scale=S, boxes=boxes, ramps=ramps_out, interiors=ints)
    with open(f'{out_dir}/{name}.collision.json', 'w') as f:
        _json.dump(meta, f, indent=1)
    print(f'FINALIZED {name}: {len(boxes)} boxes, {len(ramps_out)} ramps, {len(ints)} interiors')
    print('GLB ->', glb)


def reset_build():
    global _ROOT
    clear_scene()
    _TEMPLATES.clear()
    _CANON.clear()
    COLS.clear()
    RAMPS.clear()
    INTERIORS.clear()
    _GROUPS.clear()
    _ROOT = None
    ensure_sun()


# ---------------------------------------------------------------------------
# Wood-plank walls + solid half-timber gables (audit round 3)
# ---------------------------------------------------------------------------
_ATLAS_PX = {'arr': None, 'w': 0, 'h': 0}
PLANK_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/Planks85_08_Color.jpg'
PLANK_UV_K = 0.6  # texture repeats every ~1.7 kit units on walls (denser: the 1K planks blurred at 2.4)
# Wall style for the CREAM plaster faces of the house kit: 'planks' (the
# tavern's dark Planks85_08, the original ask) or 'plaster' (Plaster007, a soft
# warm off-white that sits with the slate roofs; the filler houses since the
# 2026-09-03 round). A build script sets WALL_STYLE before its first use().
WALL_STYLE = 'planks'
PLASTER_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/Plaster007_Color.jpg'
PLASTER_UV_K = 0.6  # one repeat per ~1.7 kit units: 1K plaster at ~600 px/unit, no bake
PLASTER_TINT = (1.0, 0.965, 0.90)  # a touch of cream against the blue
PLASTER_NRM = '/Users/troy/Documents/woc/carve/public/textures/structures/Plaster007_NormalGL.jpg'  # the game plaster's own normal


def _atlas_pixels():
    if _ATLAS_PX['arr'] is None:
        src = _CANON.get('CartoonTown_01')
        node = next(n for n in src.node_tree.nodes if n.type == 'TEX_IMAGE')
        img = node.image
        _ATLAS_PX['w'], _ATLAS_PX['h'] = img.size
        _ATLAS_PX['arr'] = _np.array(img.pixels[:], dtype=_np.float32).reshape(
            _ATLAS_PX['h'], _ATLAS_PX['w'], 4
        )
    return _ATLAS_PX


def _atlas_sample(u, v):
    a = _atlas_pixels()
    x = int(max(0, min(a['w'] - 1, (u % 1.0) * a['w'])))
    y = int(max(0, min(a['h'] - 1, (v % 1.0) * a['h'])))
    return a['arr'][y, x][:3]


def _is_cream(c):
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    return r > 0.62 and g > 0.52 and b > 0.42 and r >= g >= b and (r - b) < 0.35 and g > 0.5


TRIM_UV = [None]  # cached flat UV of the brown trim, sampled from HouseWall_02


def _trim_uv():
    if TRIM_UV[0] is None:
        tpl = load_template('buildings/HouseWall_02')
        me = tpl.data
        uvl = me.uv_layers.active.data
        best = None
        for poly in me.polygons:
            us = [uvl[li].uv for li in poly.loop_indices]
            cu = sum(u.x for u in us) / len(us)
            cv = sum(u.y for u in us) / len(us)
            c = _atlas_sample(cu, cv)
            # brown trim: dark warm
            if c[0] < 0.45 and c[0] > 0.12 and c[0] > c[2] and abs(float(c[0]) - float(c[1])) < 0.25:
                if best is None or poly.area > best[0]:
                    best = (poly.area, (cu, cv))
        TRIM_UV[0] = best[1] if best else (0.5, 0.5)
    return TRIM_UV[0]


def plank_material():
    plaster = WALL_STYLE == 'plaster'
    name = 'WocPlasterWall' if plaster else 'WocPlankWall'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(PLASTER_JPG if plaster else PLANK_JPG)
    px = _np.array(img.pixels[:], dtype=_np.float32)
    rgb = px.reshape(-1, 4)
    if plaster:
        rgb[:, :3] = _np.clip(rgb[:, :3] * _np.array(PLASTER_TINT, dtype=_np.float32), 0, 1)
    else:
        rgb[:, :3] = _np.clip(rgb[:, :3] * 1.38, 0, 1)  # dusk albedo gain, baked in
    img.pixels.foreach_set(rgb.reshape(-1))
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.1
    if plaster:
        nimg = bpy.data.images.load(PLASTER_NRM)
        nimg.colorspace_settings.name = 'Non-Color'
        nimg.pack()
        ntex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        ntex.image = nimg
        nmap = mat.node_tree.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 0.5
        mat.node_tree.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        mat.node_tree.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def plankify(base):
    """Replace the CREAM plaster faces of a house-wall template with the wood
    plank material, planar-UV'd in the piece's local frame. Trim, windows,
    stone bases keep the atlas."""
    me = base.data
    if not me.uv_layers.active:
        return
    pm = plank_material()
    slot = None
    for i, m in enumerate(me.materials):
        if m is pm:
            slot = i
    if slot is None:
        me.materials.append(pm)
        slot = len(me.materials) - 1
    uvl = me.uv_layers.active.data
    verts = me.vertices
    k = PLASTER_UV_K if WALL_STYLE == 'plaster' else PLANK_UV_K
    for poly in me.polygons:
        us = [uvl[li].uv for li in poly.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        if not _is_cream(_atlas_sample(cu, cv)):
            continue
        poly.material_index = slot
        n = poly.normal
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index].co
            if abs(n.y) > 0.7:  # wall face: planks run with x/z
                uvl[li].uv = (co.x * k, co.z * k)
            elif abs(n.x) > 0.7:
                uvl[li].uv = (co.y * k, co.z * k)
            else:  # top/bottom slivers
                uvl[li].uv = (co.x * k, co.y * k)


LOD_PICK = {
    'CastleWall': 'LOD2', 'CastleBase': 'LOD2', 'CastlePart': 'LOD2', 'CastleBalcony': 'LOD2',
    'CastleFence': 'LOD2', 'CastleStairs': 'LOD2', 'CastleCorner': 'LOD1', 'CastleDoor': 'LOD1',
    'CastleRoof': 'LOD1', 'ChurchTower': 'LOD1', 'ChurchWall': 'LOD1', 'ChurchCorner': 'LOD1',
    'ChurchDoor': 'LOD1', 'ChurchStairs': 'LOD2',
}
COBBLE_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/WardenStone_Color.jpg'  # the towers' stonewash, tiled, brass course at the head
COBBLE_UV_K = 0.2  # one repeat per 5 kit units = one wall course; the brass band rides the head of each


def cobble_material():
    name = 'WocCobbleWall'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(COBBLE_JPG)
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.8
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    return mat


def _is_castle_stone(c):
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    v = (r + g + b) / 3
    return 0.12 < v < 0.82 and max(r, g, b) - min(r, g, b) < 0.09


def _is_window_trim(c):
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    return abs(r - 0.23) < 0.03 and abs(g - 0.25) < 0.03 and abs(b - 0.26) < 0.03


def _is_arch_crown(c):
    # the darker surround swatch the 5-wide arch (CastleWall_06) uses for its
    # crown + the doors use for their hardware; plain walls never carry it
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    return abs(r - 0.19) < 0.03 and abs(g - 0.21) < 0.03 and abs(b - 0.23) < 0.03


CROWN_PIECES = ('CastleWall_06', 'CastleDoor_02', 'CastleDoor_03')


def dark_solid_material():
    """Near-black matte stone for railings and balusters: a solid colour with
    the plaster normal for a little grain, no tile to repeat."""
    name = 'WocDarkSolid'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.055, 0.058, 0.066, 1)
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.2
    return mat


def solidify_dark(base):
    """Every face of the piece takes the dark solid (the kit's grey and trim
    swatches alike); UVs are left as they are (the material has no image)."""
    me = base.data
    dm = dark_solid_material()
    me.materials.clear()
    me.materials.append(dm)
    for poly in me.polygons:
        poly.material_index = 0


def cobblify(base, rel=''):
    """Warden cobble over the castle kit: every GREY-swatch face (the kit's
    flat castle-stone colour cells) gets the dark cobble material, planar-UV'd
    in the piece's local frame so courses run level and the brass band lands
    at the head of every 5-unit course. Doors, timber, tiles keep the atlas."""
    me = base.data
    if not me.uv_layers.active:
        return
    cm = cobble_material()
    slot = None
    for i, m in enumerate(me.materials):
        if m is cm:
            slot = i
    if slot is None:
        me.materials.append(cm)
        slot = len(me.materials) - 1
    bm_ = brass_material()
    bslot = None
    for i, m in enumerate(me.materials):
        if m is bm_:
            bslot = i
    if bslot is None:
        me.materials.append(bm_)
        bslot = len(me.materials) - 1
    im_ = iron_material()
    islot = None
    for i, m in enumerate(me.materials):
        if m is im_:
            islot = i
    if islot is None:
        me.materials.append(im_)
        islot = len(me.materials) - 1
    uvl = me.uv_layers.active.data
    verts = me.vertices
    k = COBBLE_UV_K
    crown = rel.endswith(CROWN_PIECES)
    for poly in me.polygons:
        us = [uvl[li].uv for li in poly.loop_indices]
        cu = sum(u.x for u in us) / len(us)
        cv = sum(u.y for u in us) / len(us)
        c = _atlas_sample(cu, cv)
        if _is_window_trim(c) or (crown and _is_arch_crown(c)):
            # the kit's window surround + tracery / door-arch swatches: dark
            # iron frames in the opening's own shape (world UVs from _brass_world_uvs)
            poly.material_index = islot
            continue
        if not _is_castle_stone(c):
            continue
        poly.material_index = slot
        n = poly.normal
        for li in poly.loop_indices:
            co = verts[me.loops[li].vertex_index].co
            # v is lifted so nothing wraps into the brass band by accident:
            # a sliver at z<0 (a plinth foot) or a horizontal face keyed on a
            # NEGATIVE y would otherwise sample v just under 1.0 = the band.
            if abs(n.y) > 0.7:
                uvl[li].uv = (co.x * k, (co.z + 0.25) * k)
            elif abs(n.x) > 0.7:
                uvl[li].uv = (co.y * k, (co.z + 0.25) * k)
            else:
                uvl[li].uv = (co.x * k, 0.5 + co.y * k)


def cut_local_y(o, y, keep='above'):
    """Give `o` its own mesh copy and slice it by the local plane y=`y`,
    keeping the side above (local +y) or below. For kit pieces whose far
    end must stop at a wall line (ChurchRoof_01's open A-frame end)."""
    o.data = o.data.copy()
    bm = bmesh.new(); bm.from_mesh(o.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, y, 0), plane_no=(0, 1, 0),
                           clear_inner=(keep == 'above'), clear_outer=(keep != 'above'))
    bm.to_mesh(o.data); bm.free()
    o.data.update()


def cut_local_plane(o, co, no, keep_positive=True):
    """Give `o` its own mesh copy and slice it by an arbitrary LOCAL plane
    (point `co`, normal `no`), keeping the side the normal points to (or the
    other). A wing roof loses the part buried under the main roof this way."""
    o.data = o.data.copy()
    bm = bmesh.new(); bm.from_mesh(o.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=tuple(co), plane_no=tuple(no),
                           clear_inner=keep_positive, clear_outer=not keep_positive)
    bm.to_mesh(o.data); bm.free()
    o.data.update()


def gable_solid(pos, z_eave, z_ridge, half_at_eave, axis='x', grp='H2', thick=0.34,
                ridge_off=0.0, beams=True, center=0.0):
    """A SOLID triangular gable prism that meets the roof slope exactly (no
    crow steps, no gaps), plank-textured, with half-timber beams: one base
    beam and two raking edge beams that follow the slopes."""
    name = f'gable_{len(bpy.data.meshes)}'
    me = bpy.data.meshes.new(name)
    h = z_ridge - z_eave
    hw = half_at_eave
    t = thick / 2
    # Local frame: triangle in the X-Z plane, thickness along Y.
    tri = [(-hw, z_eave), (hw, z_eave), (ridge_off, z_ridge)]
    verts = []
    for (x, z) in tri:
        verts.append((x, -t, z))
    for (x, z) in tri:
        verts.append((x, t, z))
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    beam_geo = []  # (center, half_extents, rot_about_y_axis?) -> emit boxes
    if beams:
        bt = 0.11  # beam half thickness (face) / half depth
        bd = t + 0.02
        # base beam
        beam_geo.append(('box', (0.0, 0.0, z_eave + 0.1), (hw * 0.98, bd, 0.12), 0.0))
        # center post up to the ridge
        beam_geo.append(('box', (ridge_off, 0.0, z_eave + h * 0.5), (0.1, bd, h * 0.48), 0.0))
        # raking beams along each slope
        import math as _m
        for sgn in (-1, 1):
            x0, z0 = sgn * hw, z_eave
            x1, z1 = ridge_off, z_ridge
            cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
            length = _m.hypot(x1 - x0, z1 - z0) / 2
            ang = _m.atan2(z1 - z0, x1 - x0)
            beam_geo.append(('box', (cx, 0.0, cz), (length * 0.99, bd, bt), ang))
    vi = len(verts)
    import math as _m
    for kind, (cx, cy, cz), (hx2, hy2, hz2), ang in beam_geo:
        ca, sa = _m.cos(ang), _m.sin(ang)
        corners = []
        for dx in (-hx2, hx2):
            for dy in (-hy2, hy2):
                for dz in (-hz2, hz2):
                    x = cx + dx * ca - dz * sa
                    z = cz + dx * sa + dz * ca
                    corners.append((x, cy + dy, z))
        verts.extend(corners)
        b = vi
        faces.extend([
            (b, b + 1, b + 3, b + 2), (b + 4, b + 6, b + 7, b + 5),
            (b, b + 2, b + 6, b + 4), (b + 1, b + 5, b + 7, b + 3),
            (b, b + 4, b + 5, b + 1), (b + 2, b + 3, b + 7, b + 6),
        ])
        vi = len(verts)
    me.from_pydata(verts, [], faces)
    me.update()
    _recalc_outward(me)
    pm = plank_material()
    atlas = _CANON.get('CartoonTown_01')
    me.materials.append(pm)
    me.materials.append(atlas)
    uv = me.uv_layers.new()
    tuv = _trim_uv()
    ntri = 5  # first five faces are the prism
    for pi, poly in enumerate(me.polygons):
        if pi < ntri:
            poly.material_index = 0
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv.data[li].uv = (co.x * PLANK_UV_K, co.z * PLANK_UV_K)
        else:
            poly.material_index = 1
            for li in poly.loop_indices:
                uv.data[li].uv = tuv
    o = bpy.data.objects.new(name, me)
    # `center` slides the gable along the wall it closes (a wing off-axis)
    if axis == 'x':
        o.location = (pos, center, 0)
        o.rotation_euler = (0, 0, -_m.pi / 2)
    else:
        o.location = (center, pos, 0)
        o.rotation_euler = (0, 0, 0)
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    return o


def _recalc_outward(me):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()


STONE_UV = [None]


def _stone_uv():
    if STONE_UV[0] is None:
        tpl = load_template('buildings/CastleWall_01')
        me = tpl.data
        uvl = me.uv_layers.active.data
        best = None
        for poly in me.polygons:
            us = [uvl[li].uv for li in poly.loop_indices]
            cu = sum(u.x for u in us) / len(us)
            cv = sum(u.y for u in us) / len(us)
            c = _atlas_sample(cu, cv)
            r, g, b = float(c[0]), float(c[1]), float(c[2])
            if abs(r - g) < 0.08 and abs(g - b) < 0.08 and 0.33 < g < 0.65:
                if best is None or poly.area > best[0]:
                    best = (poly.area, (cu, cv))
        STONE_UV[0] = best[1] if best else (0.5, 0.5)
    return STONE_UV[0]


def stone_slab(x, y, z, hx, hy, hz, grp='L0'):
    """A crisp flat-stone box (dais platforms, plinths): atlas material with a
    flat gray UV, no stretched bevels, no smearing."""
    name = f'slab_{len(bpy.data.meshes)}'
    me = bpy.data.meshes.new(name)
    vs = []
    for dx in (-hx, hx):
        for dy in (-hy, hy):
            for dz in (0.0, hz * 2):
                vs.append((x + dx, y + dy, z + dz))
    fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)]
    me.from_pydata(vs, [], fs)
    me.update()
    _recalc_outward(me)
    # the slab joins the building's stone bake (WocCobbleWall faces are
    # smart-UV'd and baked in finalize), so a stair riser or dais reads as
    # the same occluded stonework as the walls instead of one flat texel
    me.materials.append(slab_material())
    uv = me.uv_layers.new()
    suv = (0.5, 0.5)
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = suv
    o = bpy.data.objects.new(name, me)
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    return o
