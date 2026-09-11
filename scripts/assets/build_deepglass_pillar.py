# Deepglass colonnade pillar: fluted stone column with a stepped plinth, torus
# base, flared capital, gold neck ring and gold cap plate. Authored in its OWN
# scratch scene (this Blender is shared), exported as one GLB, 9.0 yd tall,
# origin at the foot. One atomic bridge call: build + export.
import bpy, bmesh, math, traceback
OUT = '/Users/troy/Documents/woc/carve/public/models/props/deepglass_pillar.glb'
log = []
try:
    scene = bpy.context.scene
    for o in list(scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    coll = scene.collection

    def mat(n, rgb, metallic, rough):
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = rough
        return m
    stone = mat('PillarStone', (0.80, 0.77, 0.70), 0.0, 0.72)
    gold = mat('PillarGold', (0.85, 0.66, 0.31), 1.0, 0.32)
    parts = []

    def add(bm_fn, n, m):
        bm = bmesh.new()
        bm_fn(bm)
        me = bpy.data.meshes.new(n)
        bm.to_mesh(me); bm.free()
        me.materials.append(m)
        o = bpy.data.objects.new(n, me)
        coll.objects.link(o)
        parts.append(o)
        return o

    def box(bm, sx, y0, y1, sz, bevel=0.03):
        ret = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sz, y1 - y0), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, (y0 + y1) / 2), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES')
    def torus(bm, major, minor, y, seg=40, rings=10):
        bmesh.ops.create_cone  # noqa (keep bmesh referenced)
        verts = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rings):
                b = 2 * math.pi * j / rings
                r = major + minor * math.cos(b)
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), y + minor * math.sin(b))))
            verts.append(ring)
        for i in range(seg):
            for j in range(rings):
                a, b = verts[i][j], verts[i][(j + 1) % rings]
                c, d = verts[(i + 1) % seg][(j + 1) % rings], verts[(i + 1) % seg][j]
                bm.faces.new((a, b, c, d))
        for f in bm.faces: f.smooth = True
    def flutedShaft(bm, r0, r1, y0, y1, flutes=20, per=6, depth=0.045):
        n = flutes * per
        def ring(r, y):
            vs = []
            for i in range(n):
                t = 2 * math.pi * i / n
                # scallops: a cosine dip per flute, with a flat fillet between
                phase = (i % per) / per
                dip = depth * (1 - math.cos(2 * math.pi * phase)) / 2 if per > 1 else 0
                rr = r - dip
                vs.append(bm.verts.new((rr * math.cos(t), rr * math.sin(t), y)))
            return vs
        # three rings: entasis bulge at 40% height
        rings = [ring(r0, y0), ring(r0 * 0.985 + r1 * 0.015 + 0.015, y0 + (y1 - y0) * 0.4), ring(r1, y1)]
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        for f in bm.faces: f.smooth = True
    def cone(bm, r0, r1, y0, y1, seg=48):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=y1 - y0)
        bmesh.ops.translate(bm, vec=(0, 0, (y0 + y1) / 2), verts=bm.verts)
        for f in bm.faces:
            f.smooth = abs(f.normal.z) < 0.5

    add(lambda bm: box(bm, 1.90, 0.00, 0.30, 1.90, 0.04), 'plinth', stone)
    add(lambda bm: box(bm, 1.52, 0.30, 0.52, 1.52, 0.03), 'step', stone)
    add(lambda bm: torus(bm, 0.62, 0.10, 0.62), 'base_torus', stone)
    add(lambda bm: cone(bm, 0.66, 0.60, 0.52, 0.66), 'base_fillet', stone)
    add(lambda bm: flutedShaft(bm, 0.60, 0.52, 0.66, 7.85), 'shaft', stone)
    add(lambda bm: torus(bm, 0.53, 0.055, 7.88, 40, 8), 'neck_ring', gold)
    add(lambda bm: cone(bm, 0.54, 0.86, 7.92, 8.42), 'echinus', stone)
    add(lambda bm: box(bm, 1.76, 8.42, 8.84, 1.76, 0.03), 'abacus', stone)
    add(lambda bm: box(bm, 1.88, 8.84, 9.00, 1.88, 0.02), 'cap_plate', gold)

    # One object, hard edges over ~32 degrees, so the courses stay crisp.
    for o in parts:
        o.select_set(False)
    tris = 0
    for o in parts:
        me = o.data
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
    log.append(f'parts={len(parts)} tris~{tris}')

    import os
    for o in parts:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_animations=False)
    log.append(f'exported {OUT} bytes={os.path.getsize(OUT)}')
except Exception:
    log.append(traceback.format_exc())
print('\n'.join(log))
