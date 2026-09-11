# Optimisation pass, in place on the live scene:
#   1. every Tile_01 becomes a 12-tri box with the cobble baked on its top face
#   2. the church spire is decimated
# Both are DATA swaps / modifier applications on the shared template meshes, so
# every user of them (the castle AND the three kit pieces) benefits at once and
# no object transform changes.
import bpy, bmesh, traceback
from mathutils import Vector

try:
    def tri_count(me):
        return sum(len(p.vertices) - 2 for p in me.polygons)

    # ---------- 1. flat cobble tile ----------
    src = None
    for m in bpy.data.meshes:
        if m.name.startswith('TPL_environment_Tile_01'):
            src = m; break
    if src is None:
        raise RuntimeError('Tile_01 template mesh not found')
    before_tile = tri_count(src)

    # the UV rectangle the tile's TOP faces occupy, so the flat top keeps the
    # cobble look instead of a flat grey texel
    uvl = src.uv_layers.active.data
    us, vs, side = [], [], []
    for p in src.polygons:
        for li in p.loop_indices:
            (us if p.normal.z > 0.7 else side).append(uvl[li].uv.x)
            if p.normal.z > 0.7:
                vs.append(uvl[li].uv.y)
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    # local bounds of the original, so the swap is transform-transparent
    lo = Vector((min(v.co.x for v in src.vertices), min(v.co.y for v in src.vertices),
                 min(v.co.z for v in src.vertices)))
    hi = Vector((max(v.co.x for v in src.vertices), max(v.co.y for v in src.vertices),
                 max(v.co.z for v in src.vertices)))

    flat = bpy.data.meshes.new('TPL_environment_Tile_01_FLAT')
    vs8 = [(lo.x, lo.y, lo.z), (hi.x, lo.y, lo.z), (hi.x, hi.y, lo.z), (lo.x, hi.y, lo.z),
           (lo.x, lo.y, hi.z), (hi.x, lo.y, hi.z), (hi.x, hi.y, hi.z), (lo.x, hi.y, hi.z)]
    fs = [(4, 5, 6, 7), (0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    flat.from_pydata(vs8, [], fs)
    flat.update()
    for mat in src.materials:
        flat.materials.append(mat)
    uv = flat.uv_layers.new()
    # top face gets the cobble rect; the sides get a thin strip of it so the
    # edge reads as the same stone rather than a flat colour
    corner = {4: (u0, v0), 5: (u1, v0), 6: (u1, v1), 7: (u0, v1)}
    for p in flat.polygons:
        for li in p.loop_indices:
            vi = flat.loops[li].vertex_index
            if vi in corner:
                uv.data[li].uv = corner[vi]
            else:
                uv.data[li].uv = (u0 + (u1 - u0) * 0.5, v0 + (v1 - v0) * 0.06)
    swapped = 0
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.data and o.data.name.startswith('TPL_environment_Tile_01') \
                and o.data is not flat:
            o.data = flat
            swapped += 1
    print(f'Tile_01: {before_tile} -> {tri_count(flat)} tris, swapped on {swapped} objects')

    # ---------- 2. decimate the spire ----------
    spire = None
    for m in bpy.data.meshes:
        if m.name.startswith('TPL_buildings_ChurchTower_03'):
            spire = m; break
    if spire is not None:
        before_sp = tri_count(spire)
        holder = None
        for o in bpy.data.objects:
            if o.data is spire:
                holder = o; break
        if holder is None:
            holder = bpy.data.objects.new('SPIRE_TMP', spire)
            bpy.context.scene.collection.objects.link(holder)
        ov = None
        win = bpy.context.window_manager.windows[0]
        area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
        region = next(r for r in area.regions if r.type == 'WINDOW')
        ov = dict(window=win, screen=win.screen, area=area, region=region)
        mod = holder.modifiers.new('dec', 'DECIMATE')
        mod.ratio = 0.14
        for o in bpy.data.objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = holder
        with bpy.context.temp_override(**ov):
            bpy.ops.object.modifier_apply(modifier='dec')
        print(f'ChurchTower_03: {before_sp} -> {tri_count(holder.data)} tris')

    # ---------- 3. report ----------
    bldg = bpy.data.objects.get('BLDG')
    tot = 0
    for g in bldg.children:
        for o in g.children:
            if o.type == 'MESH' and o.data:
                tot += tri_count(o.data)
    print(f'castle scene total now ~{tot} tris (pre-join)')
except Exception:
    print(traceback.format_exc())
