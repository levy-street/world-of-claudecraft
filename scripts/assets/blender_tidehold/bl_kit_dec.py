# Decimate a kit GLB. The exported geometry arrives SHATTERED, ~11k
# single-triangle islands for 19k triangles, because the glTF vertices are
# split per face. Nothing can collapse across a gap, which is why both
# meshopt's simplifier and a naive decimate produced ragged merlons rather than
# a clean reduction. Merging by distance first restores connectivity; UVs and
# normals live on loops, so the atlas mapping survives the weld.
import bpy, traceback
try:
    SRC = globals()['SRC']; DST = globals()['DST']; RATIO = globals().get('RATIO', 0.45)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SRC)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']

    def tris(me):
        me.calc_loop_triangles(); return len(me.loop_triangles)
    t0 = sum(tris(o.data) for o in meshes); v0 = sum(len(o.data.vertices) for o in meshes)

    WELD = globals().get('WELD', True)
    for o in meshes:
        if o.data.users > 1: o.data = o.data.copy()
        if not WELD: continue
        for x in bpy.data.objects: x.select_set(False)
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.0002)
        bpy.ops.object.mode_set(mode='OBJECT')
    v1 = sum(len(o.data.vertices) for o in meshes); t1 = sum(tris(o.data) for o in meshes)

    if RATIO < 1.0:
        for o in meshes:
            for x in bpy.data.objects: x.select_set(False)
            o.select_set(True); bpy.context.view_layer.objects.active = o
            m = o.modifiers.new('DEC', 'DECIMATE')
            m.decimate_type = 'COLLAPSE'; m.ratio = RATIO; m.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=m.name)
    t2 = sum(tris(o.data) for o in meshes)

    for x in bpy.data.objects: x.select_set(False)
    for o in new: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True,
                              export_apply=False, export_yup=True)
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    print(f'{SRC.split("/")[-1]:20s} verts {v0:>6,}->{v1:>6,}   tris {t0:>6,} -> weld {t1:>6,} -> dec {t2:>6,}  (ratio {RATIO})')
except Exception:
    print(traceback.format_exc())
