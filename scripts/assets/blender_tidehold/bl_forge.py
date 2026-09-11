# Custom smithy furniture (2026-09-04): a masonry forge with an ember hearth,
# iron hood and stack, a bellows, a quench trough and timber framing for the
# porch roof. All bmesh boxes/frustums on flat atlas texels (stone = the castle
# stone texel, wood = the house trim texel) plus three flat-colour materials
# (WocIron, WocEmber emissive, WocWater). Kit units; exec after bl_build_common.
import bmesh as _bmesh


def _flat_mat(name, rgb, rough=0.8, metallic=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metallic
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def iron_material():
    return _flat_mat('WocIron', (0.045, 0.045, 0.055), rough=0.5, metallic=0.75)


BRICK_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/Bricks076A_Color.jpg'
BRICK_UV_K = 0.55  # one texture repeat per ~1.8 kit units: brick courses read at forge scale
# Forge masonry style: 'brick' or 'brimstone' (charred rock with glowing
# sulfur cracks, authored by make_brimstone.py: a colour map and an emissive
# crack map). Brimstone repeats every ~2.9 units so the cracks read as veins.
FORGE_STYLE = 'tile'
# 'tile': one of Troy's own tile textures, darkened (TILE_GAIN) for the forge.
TILE_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/ForgeTile_Color.jpg'
TILE_GAIN = 0.7
TILE_UV_K = 0.6
BRIMSTONE_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/Brimstone_Color.jpg'
BRIMSTONE_EMIS_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/Brimstone_Emissive.jpg'
BRIMSTONE_UV_K = 0.35


def brimstone_material():
    name = 'WocBrimstone'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    col = bpy.data.images.load(BRIMSTONE_JPG)
    col.pack()
    emi = bpy.data.images.load(BRIMSTONE_EMIS_JPG)
    emi.pack()
    tc = m.node_tree.nodes.new('ShaderNodeTexImage')
    tc.image = col
    te = m.node_tree.nodes.new('ShaderNodeTexImage')
    te.image = emi
    m.node_tree.links.new(tc.outputs['Color'], b.inputs['Base Color'])
    m.node_tree.links.new(te.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 2.5
    b.inputs['Roughness'].default_value = 0.85
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = 0.15
    return m


def tile_material():
    name = 'WocForgeTile'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(TILE_JPG)
    px = _np.array(img.pixels[:], dtype=_np.float32).reshape(-1, 4)
    px[:, :3] = _np.clip(px[:, :3] * TILE_GAIN, 0, 1)
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = 0.1
    return m


def masonry_material():
    return {'brimstone': brimstone_material, 'tile': tile_material}.get(FORGE_STYLE, brick_material)()


def masonry_uv_k():
    return {'brimstone': BRIMSTONE_UV_K, 'tile': TILE_UV_K}.get(FORGE_STYLE, BRICK_UV_K)


def brick_material():
    name = 'WocForgeBrick'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(BRICK_JPG)
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = 0.1
    return m


def ember_material():
    return _flat_mat('WocEmber', (0.55, 0.12, 0.02), rough=1.0, emit=(1.0, 0.30, 0.05), strength=3.0)


LAVA_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/ForgeLava_Color.jpg'  # Troy's Lava76_09
COAL_UV_K = 0.9  # one lava tile per ~1.1 kit units: a few molten cells across the bed


def coal_material():
    # molten coals: Troy's Lava76_09 as colour AND emission, so the heap
    # glows through its cracks instead of reading as one flat yellow slab
    name = 'WocCoal'
    m = bpy.data.materials.get(name)
    if m:
        return m
    img = bpy.data.images.load(LAVA_JPG)
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 2.6
    b.inputs['Roughness'].default_value = 0.85
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = 0.1
    return m


def coal_heap(x, y, z0, hx, hy, facing=0.0, n=14, grp='L0', seed=3):
    """A mound of glowing coals: n small irregular lumps piled over the bed,
    denser and taller toward the middle, each a randomly turned box."""
    import random as _r, math as _m
    rng = _r.Random(seed)
    c, s_ = _m.cos(facing), _m.sin(facing)
    for i in range(n):
        u, v = rng.uniform(-1, 1), rng.uniform(-1, 1)
        r2 = u * u + v * v
        if r2 > 1.0:
            u, v = u * 0.7, v * 0.7
        dx, dy = u * hx * 0.85, v * hy * 0.8
        h = 0.10 + 0.16 * max(0.0, 1.0 - r2) + rng.uniform(0, 0.05)
        w = rng.uniform(0.09, 0.16)
        rz = facing + rng.uniform(0, _m.pi)
        wx, wy = x + dx * c - dy * s_, y + dx * s_ + dy * c
        lump = _box_mesh(f'coal_{len(bpy.data.meshes)}', wx, wy, z0, z0 + h, w, w * rng.uniform(0.7, 1.3),
                         coal_material(), None, rz, taper=rng.uniform(0.5, 0.8))
        # top-projected UVs in the bed's frame so the lava reads as one
        # continuous molten surface across the lumps
        me = lump.data
        uvl = me.uv_layers.active or me.uv_layers.new()
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvl.data[li].uv = (co.x * COAL_UV_K, co.y * COAL_UV_K)
        _link(lump, grp)


def water_material():
    return _flat_mat('WocWater', (0.16, 0.27, 0.34), rough=0.15)


def _box_mesh(name, x, y, z0, z1, hx, hy, mat, uv=None, rz=0.0, taper=1.0):
    """Axis box (or a frustum when taper != 1: top footprint = taper * bottom)
    centred on (x, y) from z0 to z1, one flat UV for every face."""
    me = bpy.data.meshes.new(name)
    vs = []
    for k, z in ((1.0, z0), (taper, z1)):
        for dx in (-hx * k, hx * k):
            for dy in (-hy * k, hy * k):
                vs.append((dx, dy, z))
    # indices: bottom 0..3 (dx-,dy-),(dx-,dy+),(dx+,dy-),(dx+,dy+); top 4..7
    fs = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    me.from_pydata(vs, [], fs)
    me.update()
    _recalc_outward(me)
    me.materials.append(mat)
    uvl = me.uv_layers.new()
    if uv == 'planar':
        # world-planar brick courses: project each face along its normal
        import math as _m
        c, s_ = _m.cos(rz), _m.sin(rz)
        for p in me.polygons:
            n = p.normal
            # choose the projection axes from the WORLD normal (the box may be
            # rotated), and project the world coordinates
            nwx, nwy = n.x * c - n.y * s_, n.x * s_ + n.y * c
            for li in p.loop_indices:
                lx, ly, lz = me.vertices[me.loops[li].vertex_index].co
                wx, wy = x + lx * c - ly * s_, y + lx * s_ + ly * c
                k = masonry_uv_k()
                if abs(n.z) > 0.7:
                    uvl.data[li].uv = (wx * k, wy * k)
                elif abs(nwx) > abs(nwy):
                    uvl.data[li].uv = (wy * k, lz * k)
                else:
                    uvl.data[li].uv = (wx * k, lz * k)
    else:
        u = uv or (0.5, 0.5)
        for p in me.polygons:
            for li in p.loop_indices:
                uvl.data[li].uv = u
    o = bpy.data.objects.new(name, me)
    o.location = (x, y, 0)
    o.rotation_euler = (0, 0, rz)
    return o


def _link(o, grp='L0'):
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    return o


def stone_box(x, y, z0, z1, hx, hy, rz=0.0, grp='L0'):
    return _link(_box_mesh(f'stone_{len(bpy.data.meshes)}', x, y, z0, z1, hx, hy,
                           _CANON.get('CartoonTown_01'), _stone_uv(), rz), grp)


def brick_box(x, y, z0, z1, hx, hy, rz=0.0, grp='L0'):
    """Forge masonry in the current FORGE_STYLE (brick or brimstone)."""
    return _link(_box_mesh(f'brick_{len(bpy.data.meshes)}', x, y, z0, z1, hx, hy,
                           masonry_material(), 'planar', rz), grp)


def masonry_frustum(x, y, z0, z1, hx, hy, rz=0.0, taper=1.0, grp='L0'):
    return _link(_box_mesh(f'brick_{len(bpy.data.meshes)}', x, y, z0, z1, hx, hy,
                           masonry_material(), 'planar', rz, taper), grp)


def wood_box(x, y, z0, z1, hx, hy, rz=0.0, grp='L0'):
    return _link(_box_mesh(f'wood_{len(bpy.data.meshes)}', x, y, z0, z1, hx, hy,
                           _CANON.get('CartoonTown_01'), _trim_uv(), rz), grp)


def iron_box(x, y, z0, z1, hx, hy, rz=0.0, taper=1.0, grp='L0'):
    return _link(_box_mesh(f'iron_{len(bpy.data.meshes)}', x, y, z0, z1, hx, hy,
                           iron_material(), None, rz, taper), grp)


def flat_quad(name, x, y, z, hx, hy, mat, rz=0.0, grp='L0'):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0)], [], [(0, 1, 2, 3)])
    me.update()
    me.materials.append(mat)
    uvl = me.uv_layers.new()
    for p in me.polygons:
        for li in p.loop_indices:
            uvl.data[li].uv = (0.5, 0.5)
    o = bpy.data.objects.new(name, me)
    o.location = (x, y, z)
    o.rotation_euler = (0, 0, rz)
    return _link(o, grp)


def forge(x, y, facing=0.0, grp='L0'):
    """A masonry forge with some architecture to it: footing course, corner
    pilasters, a dark firebox niche with an iron grate on the smith's side, a
    cornice course under the hearth, the hearth rim around an emissive ember
    bed, side tool ledges, a back wall with a stepped lintel, a two-stage hood
    with iron straps and a collar, a tapered stack with a corbelled cap and an
    iron plate, and a tuyere pipe from the back into the bed. Footprint about
    2.0 x 1.7 at the footing, hearth top 1.22, stack to 5.75. `facing` is the
    direction the smith stands (0 = +y). Returns the ember bed centre."""
    import math as _m
    c, s_ = _m.cos(facing), _m.sin(facing)
    B, D = 0.85, 0.70

    def R(dx, dy):
        return (x + dx * c - dy * s_, y + dx * s_ + dy * c)

    def M(dx, dy, z0, z1, hx, hy, taper=1.0):
        return masonry_frustum(*R(dx, dy), z0, z1, hx, hy, facing, taper, grp)

    def I(dx, dy, z0, z1, hx, hy, taper=1.0):
        return iron_box(*R(dx, dy), z0, z1, hx, hy, facing, taper, grp)

    # footing, body, pilasters
    M(0, 0, 0.0, 0.16, B + 0.14, D + 0.14)
    M(0, 0, 0.16, 0.96, B, D)
    for px in (-1, 1):
        for py in (-1, 1):
            M(px * (B - 0.10), py * (D - 0.10), 0.16, 1.06, 0.16, 0.16)
    # firebox niche on the smith's side with three grate bars
    I(0, D - 0.04, 0.24, 0.66, 0.34, 0.06)
    for gx in (-0.20, 0.0, 0.20):
        I(gx, D + 0.01, 0.26, 0.64, 0.025, 0.02)
    # cornice course and hearth rim around the ember bed
    M(0, 0, 0.96, 1.06, B + 0.08, D + 0.08)
    # a low rim so the coal heap shows above it from standing height
    M(0, -0.60, 1.06, 1.15, B, 0.10)
    M(0, 0.60, 1.06, 1.15, B, 0.10)
    M(-0.72, 0, 1.06, 1.15, 0.13, D)
    M(0.72, 0, 1.06, 1.15, 0.13, D)
    bed = flat_quad(f'ember_{len(bpy.data.meshes)}', *R(0, 0), 1.075, 0.58, 0.50, coal_material(), facing, grp)
    # the bed wears the same lava as the lumps (top-projected), so the heap
    # sits in a molten pool instead of on a flat slab
    if bed is not None and getattr(bed, 'data', None) is not None:
        me = bed.data
        uvl = me.uv_layers.active or me.uv_layers.new()
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvl.data[li].uv = (co.x * COAL_UV_K, co.y * COAL_UV_K)
    coal_heap(*R(0, 0), 1.07, 0.55, 0.46, facing, grp=grp)
    # side tool ledges
    for sx in (-1, 1):
        M(sx * (B + 0.26), -0.05, 0.90, 1.00, 0.24, 0.42)
    # back wall and stepped lintel
    M(0, -0.62, 1.15, 1.90, B, 0.12)
    M(0, -0.58, 1.90, 2.04, B + 0.08, 0.17)
    # two-stage hood: masonry frustum, iron collar, upper frustum into the stack
    M(0, -0.10, 1.86, 2.32, B - 0.04, 0.62, taper=0.62)
    for sy in (-1, 1):
        I(0, -0.10 + sy * 0.62, 1.84, 1.93, B - 0.02, 0.035)
    for sx in (-1, 1):
        I(sx * (B - 0.04), -0.10, 1.84, 1.93, 0.035, 0.64)
    I(0, -0.10, 2.30, 2.38, 0.53, 0.42)
    M(0, -0.10, 2.38, 2.78, 0.50, 0.39, taper=0.70)
    # tapered stack, corbelled cap, iron plate and flue
    M(0, -0.10, 2.74, 5.30, 0.35, 0.29, taper=0.86)
    M(0, -0.10, 5.30, 5.44, 0.36, 0.30)
    M(0, -0.10, 5.44, 5.60, 0.42, 0.36)
    I(0, -0.10, 5.60, 5.67, 0.31, 0.25)
    I(0, -0.10, 5.67, 5.78, 0.20, 0.16)
    # tuyere: an iron pipe from the back wall into the bed
    I(0, -0.36, 1.20, 1.28, 0.06, 0.26)
    return R(0, 0)


def bellows(x, y, rz=0.0, grp='L0'):
    """A leather bellows on a low frame with its lever: two wedges of wood
    (trim texel) and an iron nozzle pointing along local +y."""
    wood_box(x, y, 0.30, 0.45, 0.42, 0.28, rz, grp)                  # bottom board
    wood_box(x, y, 0.45, 0.72, 0.36, 0.24, rz, grp)                  # bag (boxy leather read)
    wood_box(x, y, 0.72, 0.80, 0.42, 0.28, rz, grp)                  # top board
    import math as _m
    c, s_ = _m.cos(rz), _m.sin(rz)
    for dx in (-0.30, 0.30):
        wood_box(x + dx * c, y + dx * s_, 0.0, 0.30, 0.05, 0.05, rz, grp)  # legs
    iron_box(x - 0.34 * s_, y + 0.34 * c, 0.50, 0.62, 0.06, 0.16, rz, grp=grp)  # nozzle
    o = wood_box(x + 0.55 * s_, y - 0.55 * c, 0.78, 0.86, 0.06, 0.45, rz, grp)  # lever
    return o


def quench_trough(x, y, rz=0.0, grp='L0'):
    wood_box(x, y, 0.0, 0.62, 0.55, 0.30, rz, grp)
    flat_quad(f'water_{len(bpy.data.meshes)}', x, y, 0.56, 0.47, 0.22, water_material(), rz, grp)
    return x, y


FLOOR_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/FloorStone_Color.jpg'
FLOOR_GAIN = 0.85
FLOOR_UV_K = 0.5  # one 2x2-flag texture per 2 kit units: flags ~1.8 yd


def floor_material():
    name = 'WocStoneFloor'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(FLOOR_JPG)
    px = _np.array(img.pixels[:], dtype=_np.float32).reshape(-1, 4)
    px[:, :3] = _np.clip(px[:, :3] * FLOOR_GAIN, 0, 1)
    img.pixels.foreach_set(px.reshape(-1))
    img.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    t = m.node_tree.nodes.new('ShaderNodeTexImage')
    t.image = img
    m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.92
    if 'Specular IOR Level' in b.inputs:
        b.inputs['Specular IOR Level'].default_value = 0.1
    return m


def stone_floors(log=print):
    """Every flattened kit floor / tile slab (run flatten_tiles first) becomes
    the flagstone material with world-planar UVs, so the flags run continuous
    across the porch and the hut floor."""
    fm = floor_material()
    n = 0
    for o in _placed():
        if not (('Tile_' in o.data.name or 'Floor_' in o.data.name) and 'FLAT' in o.data.name):
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        me = o.data
        me.materials.clear()
        me.materials.append(fm)
        mw = o.matrix_world
        n3 = mw.to_3x3()
        uvl = me.uv_layers.active.data
        for p in me.polygons:
            p.material_index = 0
            nw = (n3 @ p.normal).normalized()
            for li in p.loop_indices:
                w = mw @ me.vertices[me.loops[li].vertex_index].co
                if abs(nw.z) > 0.7:
                    uvl[li].uv = (w.x * FLOOR_UV_K, w.y * FLOOR_UV_K)
                elif abs(nw.x) > abs(nw.y):
                    uvl[li].uv = (w.y * FLOOR_UV_K, w.z * FLOOR_UV_K)
                else:
                    uvl[li].uv = (w.x * FLOOR_UV_K, w.z * FLOOR_UV_K)
        n += 1
    log(f'  stone_floors: {n} slabs -> WocStoneFloor')
