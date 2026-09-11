# Remove the bake leftovers ONLY. Touches nothing under the real BLDG root, so
# every hand edit survives.
import bpy, re, traceback
try:
    pat_join = re.compile(r'^(L0|H1|H2)_\d+(\.\d+)?$')
    real_groups = set()
    bldg = bpy.data.objects.get('BLDG')
    if bldg:
        real_groups = {c.name for c in bldg.children}
    doomed = []
    for o in bpy.data.objects:
        if o.name.startswith('BAKE_TMP'):
            doomed.append(o)
        elif pat_join.match(o.name):
            doomed.append(o)                       # finalize() join output
        elif o.name.startswith('G_') and o.name not in real_groups and o.parent is None:
            doomed.append(o)                       # orphaned duplicate group
    print('deleting', len(doomed), 'leftovers:', [o.name for o in doomed])
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    n_mesh = 0
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m); n_mesh += 1
    n_mat = 0
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m); n_mat += 1
    print(f'purged {n_mesh} orphan meshes, {n_mat} orphan materials')
    kept = sum(1 for o in bpy.data.objects if re.match(r'^(L0|H1|H2)\.\d{3}\.', o.name))
    print('authored pieces still in scene:', kept)
    if bldg:
        print('BLDG children:', [(c.name, len(c.children)) for c in bldg.children])
except Exception:
    print(traceback.format_exc())
