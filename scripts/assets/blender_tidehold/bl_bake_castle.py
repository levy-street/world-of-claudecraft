BUILDING='castle'
# BAKE, take whatever is in the Blender scene right now (after your nudges in
# author mode) and produce the game asset: joined, scaled by S, exported GLB
# plus the collision JSON. Reports every object you moved, and flags the
# structural ones whose colliders may need to move with them.
#
#   BUILDING='castle'
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    BUILDING = globals().get('BUILDING', 'castle')
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    import bpy, json, math

    side = json.load(open(f'{SCRATCH}/author_{BUILDING}.json'))
    S = side['scale']

    # Recover the group structure from the scene (author mode left it intact).
    root = bpy.data.objects.get('BLDG')
    if root is None:
        raise RuntimeError('no BLDG root in the scene, run bl_author.py first')
    _ROOT = root
    _GROUPS.clear()
    for child in root.children:
        if child.name.startswith('G_'):
            _GROUPS[child.name[2:]] = child

    # ---- what moved
    baseline = side['baseline']
    moved, gone, added = [], [], []
    live = {}
    for g in _GROUPS.values():
        for o in g.children:
            live[o.name] = o
    for name, (loc, rot, scl) in baseline.items():
        o = live.get(name)
        if o is None:
            gone.append(name)
            continue
        d = math.dist(loc, list(o.location))
        dr = max(abs(a - b) for a, b in zip(rot, o.rotation_euler))
        ds = max(abs(a - b) for a, b in zip(scl, o.scale))
        if d > 1e-4 or dr > 1e-4 or ds > 1e-4:
            moved.append((name, round(d, 3), round(math.degrees(dr), 1), round(ds, 3),
                          [round(v, 3) for v in o.location]))
    added = [n for n in live if n not in baseline]

    print(f'=== CHANGES vs the authored build ({BUILDING})')
    print(f'  moved: {len(moved)}   deleted: {len(gone)}   added: {len(added)}')
    for name, d, dr, ds, loc in sorted(moved, key=lambda m: -m[1])[:60]:
        tag = ''
        low = name.lower()
        if any(k in low for k in ('wall', 'floor', 'corner', 'stairs', 'slab', 'tile', 'roof', 'fence')):
            tag = '   <-- STRUCTURAL: its collider does not follow, needs a look'
        print(f'    {name:34s} moved {d:6.3f} kit  rot {dr:5.1f}d  scale {ds:5.3f}  -> {loc}{tag}')
    for n in gone:
        print(f'    DELETED  {n}')
    for n in added:
        print(f'    ADDED    {n}')

    COLS.clear(); COLS.extend(side['cols'])
    RAMPS.clear(); RAMPS.extend(side['ramps'])
    INTERIORS.clear(); INTERIORS.extend(side['interiors'])
    # Collision for geometry built BY HAND in Blender, which the build script
    # knows nothing about. Kept in its own file so it can be merged without
    # re-authoring, re-authoring rebuilds the scene and would discard the very
    # edits this collision exists for.
    import os
    extra_path = f'{SCRATCH}/{BUILDING}_extra_collision.json'
    if os.path.exists(extra_path):
        extra = json.load(open(extra_path))
        COLS.extend(extra.get('cols', []))
        RAMPS.extend(extra.get('ramps', []))
        print(f"  merged {len(extra.get('cols', []))} hand-built collision boxes"
              f" + {len(extra.get('ramps', []))} ramps")

    # Bake a THROWAWAY COPY: finalize() joins per group and scales the root, so
    # baking the live scene would destroy the very objects you are editing.
    # Duplicate, finalize the duplicate, delete it, your scene is untouched and
    # you can keep nudging and re-baking without re-running author mode.
    tmp_root = bpy.data.objects.new('BAKE_TMP', None)
    tmp_root['_baketmp'] = 1
    bpy.context.scene.collection.objects.link(tmp_root)
    tmp_groups = {}
    for gname, g in _GROUPS.items():
        tg = bpy.data.objects.new('G_' + gname, None)
        tg['_baketmp'] = 1
        tg.parent = tmp_root
        bpy.context.scene.collection.objects.link(tg)
        tmp_groups[gname] = tg
        for o in g.children:
            if o.type != 'MESH':
                continue
            c = o.copy()
            c.data = o.data          # finalize() makes it single-user itself
            c['_baketmp'] = 1
            c.parent = tg
            c.matrix_local = o.matrix_local.copy()
            bpy.context.scene.collection.objects.link(c)
    real_root, real_groups = _ROOT, dict(_GROUPS)
    globals()['_ROOT'] = tmp_root
    _GROUPS.clear(); _GROUPS.update(tmp_groups)
    try:
        finalize(f'tidehold_{BUILDING}', SCRATCH + '/out', S)
    finally:
        # Delete by TAG, never by name or parent. finalize() renames the joined
        # survivors (L0_0, H1_0, ...) and removing the temp root first orphans
        # its children, so a name/parent sweep leaves full merged CLONES of the
        # building sitting on top of the real one. The custom property survives
        # both the rename and the join.
        left = [o for o in bpy.data.objects if o.get('_baketmp')]
        for o in left:
            bpy.data.objects.remove(o, do_unlink=True)
        for m in list(bpy.data.meshes):
            if m.users == 0:
                bpy.data.meshes.remove(m)
        for m in list(bpy.data.materials):
            if m.users == 0:
                bpy.data.materials.remove(m)
        globals()['_ROOT'] = real_root
        _GROUPS.clear(); _GROUPS.update(real_groups)
        stray = [o.name for o in bpy.data.objects if o.get('_baketmp')]
        print(f'  cleaned {len(left)} bake temporaries'
              + (f', STRAY LEFT: {stray}' if stray else ''))
    print('BAKED, your editable scene is untouched; re-bake as often as you like.')
except Exception:
    print(traceback.format_exc())
