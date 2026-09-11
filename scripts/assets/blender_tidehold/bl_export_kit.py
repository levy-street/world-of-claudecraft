# Export the three hand-duplicated wall pieces as standalone placeable assets.
# Each is recentred (origin at footprint centre, base at z=0), scaled by S and
# written with a collision sidecar derived from its own geometry.
import bpy, json, traceback
from mathutils import Vector

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    S = 1.35
    clusters = json.load(open(SCRATCH + '/kit_clusters.json'))
    NAMES = {0: 'wall_gatehouse', 1: 'wall_tower', 2: 'wall_section'}

    def bounds(objs):
        lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
        for o in objs:
            for b in o.bound_box:
                w = o.matrix_world @ Vector(b)
                lo = Vector((min(lo[i], w[i]) for i in range(3)))
                hi = Vector((max(hi[i], w[i]) for i in range(3)))
        return lo, hi

    def family(o):
        n = (o.data.name if o.data else '')
        if 'Tile_01' in n: return 'walk'
        if 'CastleRoof' in n: return 'parapet'
        if 'ChurchTower' in n: return 'spire'
        return 'body'

    report = {}
    for c in clusters:
        name = NAMES.get(c['i'])
        if not name: continue
        objs = [bpy.data.objects[n] for n in c['names'] if n in bpy.data.objects]
        lo, hi = bounds(objs)
        # Origin: footprint centre, base at z=0. The root also carries the export
        # scale, and a child ends at location + S*p, so the offset must be
        # PRE-SCALED (-S*centre) or the piece lands S*centre away from origin.
        off = Vector((-S * (lo.x + hi.x) / 2, -S * (lo.y + hi.y) / 2, -S * lo.z))

        root = bpy.data.objects.new(f'KIT_{name}', None)
        root['_kittmp'] = 1
        bpy.context.scene.collection.objects.link(root)
        copies = []
        for o in objs:
            cp = o.copy(); cp.data = o.data
            cp['_kittmp'] = 1
            cp.parent = root
            cp.matrix_local = o.matrix_local.copy()
            bpy.context.scene.collection.objects.link(cp)
            copies.append(cp)
        root.location = off
        root.scale = (S, S, S)
        bpy.context.view_layer.update()

        # per-family bounds in FINAL model yards, for the collision sidecar
        fam = {}
        for f in ('body', 'walk', 'parapet', 'spire'):
            sel = [cp for cp in copies if family(cp) == f]
            if sel:
                l, h = bounds(sel)
                fam[f] = dict(lo=[round(v, 3) for v in l], hi=[round(v, 3) for v in h])

        # join per material and export
        by_mat = {}
        for o in copies:
            key = tuple(sorted(sl.material.name if sl.material else '' for sl in o.material_slots))
            by_mat.setdefault(key, []).append(o)
        joined = []
        for objs2 in by_mat.values():
            for o in objs2:
                o.data = o.data.copy()
            if len(objs2) > 1:
                ov = win_override()
                for x in bpy.data.objects: x.select_set(False)
                for x in objs2: x.select_set(True)
                bpy.context.view_layer.objects.active = objs2[0]
                with bpy.context.temp_override(**ov):
                    bpy.ops.object.join()
            joined.append(objs2[0])
        exportables = [root] + joined
        ov = win_override()
        for x in bpy.data.objects: x.select_set(False)
        for x in exportables:
            if x.name in bpy.context.view_layer.objects: x.select_set(True)
        bpy.context.view_layer.objects.active = root
        out = f'{SCRATCH}/out/{name}.glb'
        with bpy.context.temp_override(**ov):
            bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format='GLB',
                                      export_yup=True, export_apply=True, export_animations=False)
        l2, h2 = bounds(joined)
        report[name] = dict(size=[round(h2[i] - l2[i], 3) for i in range(3)],
                            lo=[round(v, 3) for v in l2], hi=[round(v, 3) for v in h2],
                            families=fam)
        print(f'{name}: size {report[name]["size"]} yd  -> {out}')
        for f, b in fam.items():
            print(f'    {f:8s} x {b["lo"][0]:7.2f}..{b["hi"][0]:7.2f}  y {b["lo"][1]:7.2f}..{b["hi"][1]:7.2f}  z {b["lo"][2]:6.2f}..{b["hi"][2]:6.2f}')
        for o in [o for o in bpy.data.objects if o.get('_kittmp')]:
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    json.dump(report, open(SCRATCH + '/kit_report.json', 'w'), indent=1)
    print('KIT EXPORT DONE')
except Exception:
    print(traceback.format_exc())
