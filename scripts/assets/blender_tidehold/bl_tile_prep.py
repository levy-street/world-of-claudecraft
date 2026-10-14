# Stage 1 of the tile bake: bring in the original high-poly Tile_01 and build a
# matching low-poly box with a clean UV layout to receive the bake.
import bpy, traceback
from mathutils import Vector
try:
    import os
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    SCRATCH=os.path.join(REPO_ROOT, 'scripts/assets/blender_tidehold')
    exec(open(SCRATCH + '/bl_helpers.py').read())
    def tris(me):
        me.calc_loop_triangles(); return len(me.loop_triangles)

    for n in ('TILE_HI', 'TILE_LO'):
        o = bpy.data.objects.get(n)
        if o: bpy.data.objects.remove(o, do_unlink=True)

    before = set(bpy.data.objects)
    new = import_glb(PACK + '/environment/Tile_01.glb')
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
    hi = meshes[0]
    hi.data.transform(hi.matrix_world); hi.matrix_world.identity()
    hi.name = 'TILE_HI'; hi.data.name = 'TILE_HI'
    for o in [o for o in bpy.data.objects if o not in before and o is not hi]:
        bpy.data.objects.remove(o, do_unlink=True)

    lo_v = Vector((1e9,)*3); hi_v = Vector((-1e9,)*3)
    for v in hi.data.vertices:
        lo_v = Vector(map(min, lo_v, v.co)); hi_v = Vector(map(max, hi_v, v.co))
    print(f'TILE_HI {tris(hi.data):,} tris  bbox {tuple(round(x,3) for x in lo_v)} .. {tuple(round(x,3) for x in hi_v)}')
    print(f'   size {tuple(round(hi_v[i]-lo_v[i],3) for i in range(3))}')
except Exception:
    print(traceback.format_exc())
