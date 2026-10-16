# Z-fight audit for whatever town pieces are built in the open Blender scene
# (bl_town.py, GUI or headless). Finds every pair of faces that lie on the
# same plane (within TOL yards), face the SAME way and overlap by more than
# MIN_AREA square yards, the pairs a depth buffer cannot order, which
# shimmer in game. Opposite-facing coplanar pairs are counted separately:
# the town materials export double-sided, so a sheet with a mirrored twin
# on its plane fights too, but a solid's face against a wall it touches is
# hidden by the solid itself and is only noise.
#
#   python3 ~/.claude/tools/blender_bridge.py run scripts/assets/blender_tidehold/town_zfight.py
#   (or exec() it at the end of a headless bl_town.py run)
#
# Kit props are included against the building's own parts, never against
# themselves (their internal geometry is the kit's).
import math
import traceback
from collections import defaultdict
ZLOG = []
try:
    import bpy
    from mathutils import Vector
    TOL = globals().get('ZF_TOL', 0.015)
    MIN_AREA = globals().get('ZF_MIN_AREA', 0.0025)
    ANG = 0.9995

    def world_faces(ob):
        me = ob.data
        mw = ob.matrix_world
        nm = mw.to_3x3().inverted_safe().transposed()
        mats = [m.name if m else '' for m in me.materials]
        out = []
        for p in me.polygons:
            vs = [mw @ me.vertices[i].co for i in p.vertices]
            n = (nm @ p.normal).normalized()
            if n.length < 0.5:
                continue
            out.append((vs, n, mats[p.material_index] if p.material_index < len(mats) else ''))
        return out

    def basis(n):
        a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
        u = n.cross(a).normalized()
        v = n.cross(u)
        return u, v

    def clip(subject, clipper):
        """Sutherland-Hodgman: subject polygon clipped by a convex clipper
        (both CCW 2D lists)."""
        def inside(p, a, b):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9

        def inter(p, q, a, b):
            x1, y1, x2, y2 = p[0], p[1], q[0], q[1]
            x3, y3, x4, y4 = a[0], a[1], b[0], b[1]
            den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(den) < 1e-12:
                return q
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
        out = subject
        for i in range(len(clipper)):
            a, b = clipper[i], clipper[(i + 1) % len(clipper)]
            inp = out
            out = []
            if not inp:
                break
            s = inp[-1]
            for e in inp:
                if inside(e, a, b):
                    if not inside(s, a, b):
                        out.append(inter(s, e, a, b))
                    out.append(e)
                elif inside(s, a, b):
                    out.append(inter(s, e, a, b))
                s = e
        return out

    def area(poly):
        return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                         for i in range(len(poly)))

    def ccw(poly):
        return poly if area(poly) >= 0 else poly[::-1]

    def tag_of(ob):
        return ob.name.split('__')[0] if '__' in ob.name else None

    # which building does each object belong to? parts carry "<tag>__", props
    # are matched to the building whose parts' bounds contain them
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.visible_get()]
    boxes = {}
    for o in obs:
        t = tag_of(o)
        if not t:
            continue
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = boxes.setdefault(t, [Vector((1e9,) * 3), Vector((-1e9,) * 3)])
        for v in bb:
            lo[0] = Vector(map(min, lo[0], v))
            lo[1] = Vector(map(max, lo[1], v))
    faces = []            # (vs, n, mat, obj name, is_prop, building)
    for o in obs:
        t = tag_of(o)
        is_prop = t is None
        if is_prop:
            c = o.matrix_world.translation
            t = next((k for k, (a, b) in boxes.items() if a.x - 1 <= c.x <= b.x + 1 and a.y - 1 <= c.y <= b.y + 1), '?')
        for (vs, n, m) in world_faces(o):
            faces.append((vs, n, m, o.name, is_prop, t))
    # visibility: an overlap only shimmers if there is open air in front of
    # it. Cast a short ray off its centre, both ways (the materials are
    # double-sided); a face sealed against another solid (a post's back on
    # the wall, a box end buried in a beam) finds geometry within CLEAR.
    from mathutils.bvhtree import BVHTree
    CLEAR = globals().get('ZF_CLEAR', 1.0)
    V, Fi = [], []
    for (vs, n, m, on, isp, t) in faces:
        k = len(V)
        V.extend(vs)
        Fi.append(list(range(k, k + len(vs))))
    BVH = BVHTree.FromPolygons(V, Fi, all_triangles=False, epsilon=0.0)

    ENTERABLE = set(globals().get('ZF_ENTERABLE', ('tavern', 'tavern_b', 'smithy', 'market', 'hall')))

    def visible(c, n, lift, tag=None):
        """Can anyone see this point from the side it faces? From OUTSIDE:
        one of five rays (the normal and four 50-degree tilts) escapes to open
        sky. From INSIDE an enterable building: the normal ray crosses at
        least CLEAR of open room. Back faces of members laid on a wall face
        into the wall and do neither."""
        o = c + n * (lift + 0.004)
        a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
        t1 = n.cross(a).normalized()
        t2 = n.cross(t1)
        k = math.tan(math.radians(50))
        for d in (n, (n + t1 * k).normalized(), (n - t1 * k).normalized(), (n + t2 * k).normalized(),
                  (n - t2 * k).normalized()):
            if BVH.ray_cast(o, d, 80.0)[0] is None:
                return True
        if tag in ENTERABLE:
            return BVH.ray_cast(o, n, CLEAR)[0] is None
        return False
    buckets = defaultdict(list)
    for i, (vs, n, m, on, isp, t) in enumerate(faces):
        s = 1
        for c in (n.x, n.y, n.z):
            if abs(c) > 1e-6:
                s = 1 if c > 0 else -1
                break
        nc = n * s
        d = nc.dot(vs[0])
        key = (t, round(nc.x * 30), round(nc.y * 30), round(nc.z * 30), math.floor(d / TOL))
        buckets[key].append((i, nc, d, s))
    same = defaultdict(lambda: [0.0, 0, None, []])
    opp = defaultdict(lambda: [0.0, 0, None, []])
    seen = set()
    for key, items in buckets.items():
        t, a, b, c, db = key
        cand = list(items)
        for dd in (1,):
            cand_next = buckets.get((t, a, b, c, db + dd), [])
            pairs = [(x, y) for x in items for y in cand_next]
        pairs += [(items[i], items[j]) for i in range(len(items)) for j in range(i + 1, len(items))]
        for (x, y) in pairs:
            i, ni, di, si = x
            j, nj, dj, sj = y
            if (i, j) in seen:
                continue
            seen.add((i, j))
            if abs(di - dj) > TOL or ni.dot(nj) < ANG:
                continue
            fi, fj = faces[i], faces[j]
            if fi[4] and fj[4] and fi[3] == fj[3]:
                continue                       # inside one kit prop
            if fi[4] and fj[4]:
                continue                       # prop vs prop: the kit's business
            u, v = basis(ni)
            P1 = ccw([(p.dot(u), p.dot(v)) for p in fi[0]])
            P2 = ccw([(p.dot(u), p.dot(v)) for p in fj[0]])
            if len(P1) < 3 or len(P2) < 3:
                continue
            ov = clip(P1, P2)
            ar = abs(area(ov)) if len(ov) >= 3 else 0.0
            if ar < MIN_AREA:
                continue
            # a few points of the overlap (its centroid and toward each corner)
            cx2 = sum(q[0] for q in ov) / len(ov)
            cy2 = sum(q[1] for q in ov) / len(ov)
            probes = [(cx2, cy2)] + [((cx2 + q[0]) / 2, (cy2 + q[1]) / 2) for q in ov[:4]]
            lift = abs(di - dj)
            if si == sj:
                fn = ni * si                          # the way both face
                base_pt = ni * (max(di, dj) if si > 0 else min(di, dj))
                if not any(visible(base_pt + u * a + v * b, fn, lift, t) for (a, b) in probes):
                    continue
            else:
                base_pt = ni * max(di, dj)
                if not any(visible(base_pt + u * a + v * b, ni, lift, t) or
                           visible(base_pt - ni * lift + u * a + v * b, -ni, lift, t) for (a, b) in probes):
                    continue
            k = (t, fi[3], fi[2], fj[3], fj[2]) if fi[3] <= fj[3] else (t, fj[3], fj[2], fi[3], fi[2])
            rec = same[k] if si == sj else opp[k]
            rec[0] += ar
            rec[1] += 1
            if rec[2] is None:
                cc = sum((p for p in fi[0]), Vector()) / len(fi[0])
                rec[2] = (round(cc.x, 2), round(cc.y, 2), round(cc.z, 2), round(abs(di - dj), 4))
            if len(rec[3]) < 4:
                def desc(f):
                    c = sum((p for p in f[0]), Vector()) / len(f[0])
                    lo = Vector(map(min, *f[0])) if len(f[0]) > 1 else f[0][0]
                    hi = Vector(map(max, *f[0])) if len(f[0]) > 1 else f[0][0]
                    return f'c({c.x:.2f},{c.y:.2f},{c.z:.2f}) n({f[1].x:.2f},{f[1].y:.2f},{f[1].z:.2f}) ' \
                           f'ext({hi.x - lo.x:.2f},{hi.y - lo.y:.2f},{hi.z - lo.z:.2f})'
                rec[3].append(desc(fi) + '  |  ' + desc(fj))
    ZLOG.append(f'faces {len(faces)}  same-facing overlaps: {len(same)} groups  opposite: {len(opp)} groups')
    for (label, dct) in (('SAME', same), ('OPP', opp)):
        rows = sorted(dct.items(), key=lambda kv: -kv[1][0])
        for (k, (ar, cnt, at, smp)) in rows[:globals().get('ZF_TOP', 60)]:
            ZLOG.append(f'{label} {k[0]:9s} {ar:7.3f}yd2 x{cnt:<4d} {k[1]}[{k[2]}] vs {k[3]}[{k[4]}] at {at}')
            if label == 'SAME' and globals().get('ZF_DETAIL'):
                for d_ in smp:
                    ZLOG.append('        ' + d_)
    ZF_RESULT = {'same': {str(k): v[:2] for k, v in same.items()}, 'opp': len(opp)}
    ZLOG.append(f'SAME total {sum(v[0] for v in same.values()):.2f} yd2 in {len(same)} groups')
except Exception:
    ZLOG.append(traceback.format_exc())
print('\n'.join(ZLOG))
