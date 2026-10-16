# AUTHOR MODE, build a Tidehold building with every piece left as its OWN
# object so it can be nudged by hand in Blender, then baked back to the game
# with bl_bake.py. Nothing here is joined, scaled or exported.
#
#   BUILDING='castle'   (default; any bl_<name>.py in the scratch dir)
import traceback

try:
    import os
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    SCRATCH = os.path.join(REPO_ROOT, 'scripts/assets/blender_tidehold')
    BUILDING = globals().get('BUILDING', 'castle')
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    import bpy, json, os

    # Run the build script's body, stopping before finalize() so nothing joins.
    src = open(f'{SCRATCH}/bl_{BUILDING}.py').read()
    head = src.split(f"    finalize('tidehold_{BUILDING}'")[0]
    body = head.split('try:\n', 1)[1]
    body = '\n'.join(l[4:] if l.startswith('    ') else l for l in body.split('\n'))
    exec(body)

    # ---- readable names + one collection per storey, so the outliner is usable
    scene_coll = bpy.context.scene.collection
    made = {}
    for gname, g in _GROUPS.items():
        cname = f'{BUILDING}_{gname}'
        coll = bpy.data.collections.get(cname) or bpy.data.collections.new(cname)
        if cname not in {c.name for c in scene_coll.children}:
            scene_coll.children.link(coll)
        made[gname] = coll
        for i, o in enumerate(list(g.children)):
            base = o.data.name.replace('TPL_buildings_', '').replace('TPL_props_', '') \
                if o.type == 'MESH' and o.data and o.data.name.startswith('TPL_') else o.name.split('_', 1)[-1]
            o.name = f'{gname}.{i:03d}.{base}'
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)

    # ---- viewport: kill the relationship lines (the dotted spray over every
    #      interior shot) and show the storey collections
    for area in bpy.context.window_manager.windows[0].screen.areas:
        if area.type == 'VIEW_3D':
            for sp in area.spaces:
                if sp.type == 'VIEW_3D':
                    sp.overlay.show_relationship_lines = False
                    sp.overlay.show_extras = False

    # ---- the sidecar the bake needs: the authored collision (which is python
    #      state, not scene state) plus a baseline of every transform so the
    #      bake can report exactly what you moved.
    baseline = {}
    for g in _GROUPS.values():
        for o in g.children:
            baseline[o.name] = [list(o.location), list(o.rotation_euler), list(o.scale)]
    side = {
        'building': BUILDING,
        'scale': S,
        'cols': COLS,
        'ramps': RAMPS,
        'interiors': INTERIORS,
        'groups': list(_GROUPS.keys()),
        'baseline': baseline,
    }
    with open(f'{SCRATCH}/author_{BUILDING}.json', 'w') as f:
        json.dump(side, f)
    print(f'AUTHOR MODE READY: {BUILDING}')
    print(f'  {len(baseline)} separate objects across {len(_GROUPS)} storeys: {list(_GROUPS)}')
    print(f'  collision carried in author_{BUILDING}.json '
          f'({len(COLS)} boxes, {len(RAMPS)} ramps, {len(INTERIORS)} interiors)')
    print('  Move anything you like, then run bl_bake.py.')
except Exception:
    print(traceback.format_exc())
