# The spires got decimated twice (13562 -> 1898 -> 265) and now read as faceted
# junk. Re-import the source piece, decimate ONCE, and repoint every spire at it.
import bpy, traceback
try:
    SCRATCH='/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    def tris(me): return sum(len(p.vertices)-2 for p in me.polygons)
    spire_objs=[o for o in bpy.data.objects if o.type=='MESH' and o.data and 'ChurchTower_03' in o.data.name]
    print('spire objects:', len(spire_objs), 'current tris', tris(spire_objs[0].data) if spire_objs else 0)
    before=set(bpy.data.objects)
    new=import_glb(PACK + '/buildings/ChurchTower_03.glb')
    allo=set()
    for o in new: allo.add(o); allo.update(o.children_recursive)
    meshes=[m for m in allo if m.type=='MESH' and not ('_LOD' in m.name and '_LOD0' not in m.name)]
    doomed=[m for m in allo if m.type=='MESH' and m not in meshes]
    for m in doomed: bpy.data.objects.remove(m, do_unlink=True)
    for m in meshes:
        mw=m.matrix_world.copy(); m.parent=None; m.matrix_world=mw
    if len(meshes)>1:
        ov=win_override()
        for x in bpy.data.objects: x.select_set(False)
        for x in meshes: x.select_set(True)
        bpy.context.view_layer.objects.active=meshes[0]
        with bpy.context.temp_override(**ov): bpy.ops.object.join()
    src=meshes[0]
    src.data.transform(src.matrix_world); src.matrix_world.identity()
    # canonicalise the material so it merges with the rest of the build
    for i,sl in enumerate(src.material_slots):
        if sl.material:
            canon=bpy.data.materials.get(sl.material.name.split('.')[0])
            if canon and canon is not sl.material: src.data.materials[i]=canon
    b=tris(src.data)
    ov=win_override()
    mod=src.modifiers.new('dec','DECIMATE'); mod.ratio=0.14
    for x in bpy.data.objects: x.select_set(False)
    bpy.context.view_layer.objects.active=src
    with bpy.context.temp_override(**ov): bpy.ops.object.modifier_apply(modifier='dec')
    src.data.name='TPL_buildings_ChurchTower_03_DEC'
    print(f'fresh spire {b} -> {tris(src.data)} tris')
    for o in spire_objs:
        o.data=src.data
    src.location=(0,0,-500)      # park the donor out of sight
    print('repointed', len(spire_objs), 'spires')
    for m in list(bpy.data.meshes):
        if m.users==0: bpy.data.meshes.remove(m)
except Exception:
    print(traceback.format_exc())
