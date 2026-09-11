# Lightening pass for exterior-only buildings (house audit, 2026-09-03). Runs on
# the un-joined scene, BEFORE finalize():
#   flatten_tiles()   every Tile_01 step slab -> a 12-tri box with the cobble UV
#   dark_box()        a near-black box inside each storey so windows read as
#                     shadow and the walls' inner faces are never needed
#   cull_hidden()     delete every face no outside/above-ground viewer can see
#                     (BVH ray escape test, the audit's own criterion)
#   decimate_slabs()  collapse-decimate the big slab families (roofs, boards);
#                     thin swept pieces (walls, door, corners) are left alone
#   material_flags()  back-face culling on the opaque materials
import bmesh
from mathutils.bvhtree import BVHTree


def _win():
    return win_override()


def _tris(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def _placed():
    return [o for o in _ROOT.children_recursive if o.type == 'MESH' and o.data]


def _piece(o):
    return o.name.split('_', 1)[1] if '_' in o.name else o.name


def dark_material():
    name = 'WocInteriorDark'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.03, 0.028, 0.025, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.0
    return mat


def dark_box(hx, hy, z0, z1, grp='L0'):
    name = f'dark_{len(bpy.data.meshes)}'
    me = bpy.data.meshes.new(name)
    vs = []
    for dx in (-hx, hx):
        for dy in (-hy, hy):
            for dz in (z0, z1):
                vs.append((dx, dy, dz))
    fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)]
    me.from_pydata(vs, [], fs)
    me.update()
    _recalc_outward(me)
    me.materials.append(dark_material())
    uv = me.uv_layers.new()
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = (0.5, 0.5)
    o = bpy.data.objects.new(name, me)
    o.parent = group(grp)
    bpy.context.scene.collection.objects.link(o)
    return o


def flatten_tiles(log=print):
    """Every kit Tile_* / Floor_* template becomes a 12-tri box carrying the
    UV rectangle of its top faces (the shipped tavern did the same by hand as
    the *_BAKED floors: Floor_04 alone is 70k vertices of modelled grout)."""
    total = 0
    for src in [m for m in bpy.data.meshes if (m.name.startswith('TPL_environment_Tile_') or m.name.startswith('TPL_buildings_Floor_')) and 'FLAT' not in m.name and m.users > 0]:
        total += _flatten_one(src, log)
    log(f'  flatten_tiles: {total} objects now on 12-tri slabs')


FLOOR_TILE_JPG = '/Users/troy/Documents/woc/carve/scripts/assets/blender_tidehold/FloorTile_Color.jpg'  # Troy's Tiles224_09, neutralised


def floor_tile_material():
    """The building's floor set (bl_build_common.floor_material): tiles by
    default, planks where the script sets FLOOR_DEFAULT = 'planks'."""
    return floor_material()


def _flatten_one(src, log):
    uvl = src.uv_layers.active.data
    us, vs = [], []
    for p in src.polygons:
        if p.normal.z > 0.7:
            for li in p.loop_indices:
                us.append(uvl[li].uv.x)
                vs.append(uvl[li].uv.y)
    if not us:
        return 0
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    lo = [min(v.co[i] for v in src.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in src.vertices) for i in range(3)]
    # The slab's top is the kit piece's WALKING surface (area-median height of
    # its upward faces), not its bounding box: Floor_06's grout ridges reach
    # 0.13 while the tiles sit at 0.11, and a bbox-high slab buried every prop
    # standing on the kit height (Troy: "stuck in the tiles").
    tops = sorted((p.center.z, p.area) for p in src.polygons if p.normal.z > 0.8)
    if tops:
        total = sum(a for _, a in tops)
        acc = 0.0
        for z, a in tops:
            acc += a
            if acc >= total * 0.5:
                hi[2] = z
                break
    flat = bpy.data.meshes.new(src.name + '_FLAT')
    vs8 = [(lo[0], lo[1], lo[2]), (hi[0], lo[1], lo[2]), (hi[0], hi[1], lo[2]), (lo[0], hi[1], lo[2]),
           (lo[0], lo[1], hi[2]), (hi[0], lo[1], hi[2]), (hi[0], hi[1], hi[2]), (lo[0], hi[1], hi[2])]
    fs = [(4, 5, 6, 7), (0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    flat.from_pydata(vs8, [], fs)
    flat.update()
    for mat in src.materials:
        flat.materials.append(mat)
    uv = flat.uv_layers.new()
    # the slab wears the clean floor tile, planar in its own frame: one
    # repeat per module edge, so neighbouring modules continue the grid
    flat.materials.clear()
    flat.materials.append(floor_tile_material())
    kx = 1.0 / max(hi[0] - lo[0], 1e-3)
    ky = 1.0 / max(hi[1] - lo[1], 1e-3)
    for p in flat.polygons:
        for li in p.loop_indices:
            co = flat.vertices[flat.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x - lo[0]) * kx, (co.y - lo[1]) * ky)
    n = 0
    for o in _placed():
        if o.data is src:
            o.data = flat
            n += 1
    return n


def _fib_dirs(n):
    out = []
    ga = _math.pi * (3 - _math.sqrt(5))
    for i in range(n):
        y = 1 - (i / (n - 1)) * 2
        r = _math.sqrt(max(0.0, 1 - y * y))
        t = ga * i
        out.append(Vector((_math.cos(t) * r, y, _math.sin(t) * r)))
    return out


def cull_hidden(n_dirs=128, near=2.0, log=print):
    """A face is culled only when EVERY sampled view direction is blocked
    within `near` units: interior faces sit against the dark box or the far
    wall, while a face that is only blocked by something distant is usually
    visible through a gap at some angle. The first cut (48 rays, any hit at
    any range) shredded eaves and corners into see-through slivers."""
    objs = _placed()
    all_v, all_f = [], []
    per = []
    for o in objs:
        me = o.data
        mw = o.matrix_world
        base = len(all_v)
        all_v.extend([mw @ v.co for v in me.vertices])
        me.calc_loop_triangles()
        all_f.extend([tuple(i + base for i in t.vertices) for t in me.loop_triangles])
        per.append((o, mw))
    G = BVHTree.FromPolygons(all_v, all_f, all_triangles=True)
    dirs = _fib_dirs(n_dirs)
    # The house's centre at mid height: an outward-facing, roughly vertical
    # face (a wall's street side) is never culled, whatever trims, kerbs or
    # props stand in front of it; only faces looking INTO the house are put to
    # the ray test.
    lo = Vector((min(v.x for v in all_v), min(v.y for v in all_v), min(v.z for v in all_v)))
    hi = Vector((max(v.x for v in all_v), max(v.y for v in all_v), max(v.z for v in all_v)))
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))
    before = sum(_tris(o.data) for o in objs)
    removed = 0
    # Objects sharing a mesh datablock: decide per object but cut per datablock
    # (the first object of each datablock decides; the rest ride along).
    seen = set()
    for o, mw in per:
        me = o.data
        if me.name in seen or o.name.startswith('dark_'):
            continue
        seen.add(me.name)
        n3 = mw.to_3x3()
        doomed = []
        for poly in me.polygons:
            nrm0 = (n3 @ poly.normal)
            if nrm0.length < 1e-9:
                continue
            nrm0.normalize()
            vis = False
            if abs(nrm0.z) < 0.5:
                out = (mw @ poly.center) - centre
                out.z = 0
                # Any outward component counts: on a long house the faces near
                # the front corners see the centre at a shallow angle, and the
                # old 0.5 cosine gate let the sill-to-beam plaster there be ray
                # tested and culled (black wedges under house_e's windows).
                if out.length > 1e-6 and abs(nrm0.dot(out.normalized())) > 0.15:
                    continue  # a wall face seen from the street: keep both sides
            # Two-sided: the kit's materials ship double-sided and some wall
            # faces have inward normals, so a face counts as visible if EITHER
            # side can see out.
            for side in (1.0, -1.0):
                nrm = nrm0 * side
                cen = mw @ poly.center + nrm * 0.01
                # A face looking DOWN from high up (a roof underside, a floor of
                # the attic) is only ever seen from inside: give it a long
                # block distance so the interior box or the far slope catches
                # it. A soffit outside the wall line still has free rays
                # sideways and down to the ground, so it survives.
                lim0 = 5.0 if nrm.z < -0.3 else near
                for d in dirs:
                    if nrm.dot(d) < 0.03 or d.z < -0.6:
                        continue
                    if d.z < 0:
                        tg = cen.z / (-d.z)
                        if tg < 0.05:
                            continue
                        lim = min(lim0, tg)
                    else:
                        lim = lim0
                    loc, _n, _i, _d = G.ray_cast(cen, d, lim)
                    if loc is None:
                        vis = True
                        break
                if vis:
                    break
            if not vis:
                doomed.append(poly.index)
        if not doomed:
            continue
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        faces = [bm.faces[i] for i in doomed]
        bmesh.ops.delete(bm, geom=faces, context='FACES')
        bm.to_mesh(me)
        bm.free()
        me.update()
        removed += len(doomed)
    after = sum(_tris(o.data) for o in objs)
    log(f'  cull_hidden: {before} -> {after} tris ({removed} hidden polygons removed)')
    fam = {}
    for o in objs:
        k = _piece(o)
        fam[k] = fam.get(k, 0) + _tris(o.data)
    top = sorted(fam.items(), key=lambda kv: -kv[1])[:14]
    log('  remaining by piece: ' + ', '.join(f'{k} {v}' for k, v in top))


# Collapse ratios for the prop families that survive it. Roofs are NOT here:
# the kit's tile scallops shred into shards at any collapse ratio once their
# undersides are culled (the cull alone takes them from 5-10k to ~2-4k). Ivy,
# lanterns, fences and firewood are thin cards and sweeps: left alone.
RATIOS = [
    ('SignBoard_', 0.35), ('Market_', 0.6), ('FlowerPot_', 0.5), ('Barrel_', 0.6),
    ('NoticeBoard_', 0.5), ('Furniture_', 0.6), ('Lantern_', 0.6),
]


def decimate_slabs(log=print):
    ov = _win()
    done = 0
    saved = 0
    for o in _placed():
        piece = _piece(o)
        ratio = next((r for pref, r in RATIOS if piece.startswith(pref)), None)
        if ratio is None:
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        me = o.data
        b = _tris(me)
        if b < 200:
            continue
        for x in bpy.data.objects:
            x.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('DEC', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        with bpy.context.temp_override(**ov):
            bpy.ops.object.modifier_apply(modifier=m.name)
        a = _tris(me)
        saved += b - a
        done += 1
    log(f'  decimate_slabs: {done} pieces, -{saved} tris')


def dissolve_planar(angle_deg=8.0, log=print):
    """Planar decimate on every kit piece: merges coplanar faces within one
    material (delimit MATERIAL), so the roof tiles' subdivided slabs, the
    corner posts' faceted straps and the plank walls lose their needless
    tessellation while every silhouette edge and material border stays. The
    atlas is a flat-colour palette (one texel per face), so the interpolated
    UVs of a merged n-gon cannot smear; the plank walls are planar-projected,
    which merging preserves exactly."""
    ov = _win()
    before = 0
    after = 0
    n = 0
    for o in _placed():
        piece = _piece(o)
        # Wall and door modules stay out: merging the coplanar plaster around a
        # window opening yields a concave n-gon whose tessellation throws black
        # sliver triangles under the sills (Troy's report on house_e). Their
        # planked faces are a handful of quads anyway.
        if o.name.startswith('dark_') or 'FLAT' in o.data.name or piece.startswith(('Ivy_', 'HouseWall_', 'HouseDoor_', 'HouseBase_')):
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        b = _tris(o.data)
        for x in bpy.data.objects:
            x.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('PLANAR', 'DECIMATE')
        m.decimate_type = 'DISSOLVE'
        m.angle_limit = _math.radians(angle_deg)
        m.delimit = {'MATERIAL'}
        m.use_dissolve_boundaries = False
        with bpy.context.temp_override(**ov):
            bpy.ops.object.modifier_apply(modifier=m.name)
        a = _tris(o.data)
        before += b
        after += a
        n += 1
    log(f'  dissolve_planar: {n} pieces, {before} -> {after} tris')


def material_flags():
    for name in ('CartoonTown_01', 'CartoonTown_Roof', 'WocPlankWall', 'WocPlasterWall', 'WocInteriorDark'):
        m = bpy.data.materials.get(name)
        if m is None:
            continue
        # Materials stay double-sided (no use_backface_culling): the kit has
        # inward normals on some wall faces and the game draws them that way.
        for attr, val in (('blend_method', 'OPAQUE'), ('surface_render_method', 'DITHERED')):
            try:
                setattr(m, attr, val)
            except Exception:
                pass


def lighten(log=print):
    bpy.context.view_layer.update()
    flatten_tiles(log)
    cull_hidden(log=log)
    dissolve_planar(log=log)
    decimate_slabs(log)
    material_flags()
    tot = sum(_tris(o.data) for o in _placed())
    log(f'  lighten: scene now {tot} tris')

def plaster_material():
    """Plaster007 with the cream tint, independent of WALL_STYLE (the exterior
    pass below needs it while the interiors keep WocPlankWall)."""
    name = 'WocPlasterWall'
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    img = bpy.data.images.load(PLASTER_JPG)
    px = _np.array(img.pixels[:], dtype=_np.float32)
    rgb = px.reshape(-1, 4)
    rgb[:, :3] = _np.clip(rgb[:, :3] * _np.array(PLASTER_TINT, dtype=_np.float32), 0, 1)
    img.pixels.foreach_set(rgb.reshape(-1))
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.1
    # the game plaster's own normal, so the surface has grain under light
    # (the houses get it through plank_material; this is the tavern/smithy/
    # hall/bank path)
    nimg = bpy.data.images.load('/Users/troy/Documents/woc/carve/public/textures/structures/Plaster007_NormalGL.jpg')
    nimg.colorspace_settings.name = 'Non-Color'
    nimg.pack()
    ntex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    ntex.image = nimg
    nmap = mat.node_tree.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 0.5
    bsdf_ = mat.node_tree.nodes['Principled BSDF']
    mat.node_tree.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    mat.node_tree.links.new(nmap.outputs['Normal'], bsdf_.inputs['Normal'])
    return mat


def plaster_exterior(log=print):
    """Explorable buildings: the OUTSIDE faces of every planked wall become the
    cream plaster, the inside faces keep their planks. A plank face is outside
    when its world normal is roughly horizontal and points away from the
    building's centre (the same test the hidden-face cull protects with). Runs
    per placed object on its own copy of the mesh, so a wall module's two
    faces can differ even though every instance shares one template."""
    pm = bpy.data.materials.get('WocPlankWall')
    if pm is None:
        log('  plaster_exterior: no plank material in scene')
        return
    plaster = plaster_material()
    objs = _placed()
    all_v = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = Vector((min(v.x for v in all_v), min(v.y for v in all_v), min(v.z for v in all_v)))
    hi = Vector((max(v.x for v in all_v), max(v.y for v in all_v), max(v.z for v in all_v)))
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))
    n_faces = 0
    n_obj = 0
    for o in objs:
        me = o.data
        if pm.name not in [m.name for m in me.materials if m]:
            continue
        if me.users > 1:
            o.data = me.copy()
            me = o.data
        pslot = [i for i, m in enumerate(me.materials) if m and m.name == pm.name][0]
        slot = None
        for i, m in enumerate(me.materials):
            if m is plaster:
                slot = i
        if slot is None:
            me.materials.append(plaster)
            slot = len(me.materials) - 1
        mw = o.matrix_world
        n3 = mw.to_3x3()
        uvl = me.uv_layers.active.data
        hit = 0
        for poly in me.polygons:
            if poly.material_index != pslot:
                continue
            nrm = (n3 @ poly.normal)
            if nrm.length < 1e-9:
                continue
            nrm.normalize()
            if nrm.z < -0.5:
                continue  # ceilings and soffits stay planked
            if nrm.z <= 0.5:
                out = (mw @ poly.center) - centre
                out.z = 0
                if out.length < 1e-6 or nrm.dot(out.normalized()) <= 0.15:
                    continue
            # else: an upward-facing plank plane is a roof-side gable band, exterior
            poly.material_index = slot
            # plaster UVs: planar in WORLD space at the plaster repeat
            for li in poly.loop_indices:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                if abs(nrm.y) > 0.7:
                    uvl[li].uv = (co.x * PLASTER_UV_K, co.z * PLASTER_UV_K)
                elif abs(nrm.x) > 0.7:
                    uvl[li].uv = (co.y * PLASTER_UV_K, co.z * PLASTER_UV_K)
                else:
                    uvl[li].uv = ((co.x + co.y) * PLASTER_UV_K, co.z * PLASTER_UV_K)
            hit += 1
        if hit:
            n_obj += 1
            n_faces += hit
    log(f'  plaster_exterior: {n_faces} faces on {n_obj} pieces -> WocPlasterWall')
