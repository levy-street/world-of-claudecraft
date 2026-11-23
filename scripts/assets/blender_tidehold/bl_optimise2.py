# Catch every COPY of a heavy mesh, not just the TPL_ original: hand-duplicated
# objects carry meshes named 'Tile_01.004', 'ChurchTower_03.001' etc. with no
# TPL_ prefix, so a prefix match silently skips all of them.
import bpy, traceback
try:
    def tris(me): return sum(len(p.vertices) - 2 for p in me.polygons)
    flat = bpy.data.meshes.get('TPL_environment_Tile_01_FLAT')
    if flat is None: raise RuntimeError('run bl_optimise.py first')

    # --- every Tile_01 variant -> the flat 12-tri box
    swapped = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.data: continue
        if 'Tile_01' in o.data.name and o.data is not flat and 'FLAT' not in o.data.name:
            o.data = flat; swapped += 1
    print(f'flat-tile swap: {swapped} more objects')

    # --- decimate every remaining heavy mesh family, once per datablock
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    ov = dict(window=win, screen=win.screen, area=area, region=region)

    TARGETS = [('ChurchTower_03', 0.14), ('Fountain_01', 0.3)]
    done = {}
    for fam, ratio in TARGETS:
        for me in list(bpy.data.meshes):
            if fam not in me.name or me.name in done or me.users == 0: continue
            # Idempotence guard: a second pass over an already-decimated mesh
            # compounds (13562 -> 1898 -> 265) and shreds the silhouette.
            if tris(me) < 4000 or 'DEC' in me.name: continue
            users = [o for o in bpy.data.objects if o.data is me]
            if not users: continue
            holder = users[0]
            if len(users) > 1:
                # a modifier cannot be applied to multi-user data; give the
                # holder its own copy, decimate that, then point the rest at it
                holder.data = me.copy()
                me2 = holder.data
            b = tris(me)
            m = holder.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio
            for o in bpy.data.objects: o.select_set(False)
            bpy.context.view_layer.objects.active = holder
            with bpy.context.temp_override(**ov):
                bpy.ops.object.modifier_apply(modifier='dec')
            if len(users) > 1:
                for o in users[1:]:
                    o.data = holder.data
            done[me.name] = (b, tris(holder.data))
            print(f'   decimated {me.name}: {b} -> {tris(holder.data)}')
    bldg = bpy.data.objects.get('BLDG')
    tot = sum(tris(o.data) for g in bldg.children for o in g.children if o.type == 'MESH' and o.data)
    print(f'castle scene ~{tot} tris')
except Exception:
    print(traceback.format_exc())
