# Re-import a template at full density (or at a gentler decimate ratio) and
# repoint every user at it. Used to walk back decimation that tore thin
# geometry, window tracery collapses long before plain walls do.
#   RESTORE = [('buildings/CastleWall_05', None), ('buildings/CastleWall_04', 0.7)]
import bpy, traceback
try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    def tris(me): return sum(len(p.vertices) - 2 for p in me.polygons)

    for rel, ratio in globals().get('RESTORE', []):
        cat, base = rel.split('/')
        tag = f'{cat}_{base}'
        users = [o for o in bpy.data.objects if o.type == 'MESH' and o.data and tag in o.data.name]
        if not users:
            print(f'  {rel}: no users, skipped'); continue
        was = tris(users[0].data)

        new = import_glb(PACK + '/' + rel + '.glb')
        allo = set()
        for o in new: allo.add(o); allo.update(o.children_recursive)
        meshes = [m for m in allo if m.type == 'MESH' and not ('_LOD' in m.name and '_LOD0' not in m.name)]
        for m in [m for m in allo if m.type == 'MESH' and m not in meshes]:
            bpy.data.objects.remove(m, do_unlink=True)
        for m in meshes:
            mw = m.matrix_world.copy(); m.parent = None; m.matrix_world = mw
        if len(meshes) > 1:
            ov = win_override()
            for x in bpy.data.objects: x.select_set(False)
            for x in meshes: x.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            with bpy.context.temp_override(**ov): bpy.ops.object.join()
        src = meshes[0]
        src.data.transform(src.matrix_world); src.matrix_world.identity()
        for i, sl in enumerate(src.material_slots):
            if sl.material:
                canon = bpy.data.materials.get(sl.material.name.split('.')[0])
                if canon and canon is not sl.material: src.data.materials[i] = canon
        fresh = tris(src.data)
        if ratio:
            ov = win_override()
            mod = src.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio
            for x in bpy.data.objects: x.select_set(False)
            bpy.context.view_layer.objects.active = src
            with bpy.context.temp_override(**ov): bpy.ops.object.modifier_apply(modifier='dec')
        src.data.name = f'TPL_{tag}' + ('_DEC' if ratio else '')
        src.data['_opt'] = 1
        for o in users: o.data = src.data
        src.location = (0, 0, -500)
        print(f'  {rel}: was {was} -> now {tris(src.data)} (fresh {fresh}) on {len(users)} objects')

    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    b = bpy.data.objects.get('BLDG'); total = 0
    for g in b.children:
        for o in g.children:
            if o.type == 'MESH': total += tris(o.data)
    print(f'castle scene now ~{total:,} tris (pre-join)')
except Exception:
    print(traceback.format_exc())
