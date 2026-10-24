"""Support check for a built entrance scene: nothing may float.

  blender -b --factory-startup --python support_check.py -- --blend FILE.blend --terrain HEIGHTGRID.json
          [--prefix Entrance_,Growth_] [--growth Growth_] [--water Y] [--tol 0.03] [--growth-tol 0.07]
          [--rims] [--rim-tol 0.035] [--eye-step 3] [--eye-half 30] [--out report.json]

Every mesh object whose name starts with one of the prefixes is welded (so a
block built face by face is one piece) and split into its loose islands. An
island is SUPPORTED when it touches the ground (a point of it within the
tolerance of the sim's terrain, or under it), or the standing water for a
growth island (a lily pad), or another supported island: touching means a
point of one lies within the tolerance of the other's surface, or the two
intersect. Support spreads from the ground up through whatever touches; what
is never reached floats, and is listed with where it is, how big it is and
how far it hangs from the nearest other surface. (What grows may hang a
little further off its host than stone may, --growth-tol, and never holds
stone up.)

A second list, OPEN (with --rims): the open rims of the stone. A stone built
without one of its faces is a shell; where the missing face's rim hangs in
the air (not under the ground, not against any face but the one it bounds:
a riser's foot that ends on its stone's end face is closed) a player looking
from that side sees straight through it, the way a slab with no underside
reads as loose plates over its support. A rim only counts where somebody can
see it: eyes are set on a grid over the ground (at a walker's height and at
two camera heights over it, none under a roof) and a rim point counts when a
straight line from one of them reaches it. Each row is an island with the
length of rim it leaves open and seen, a point of its longest stretch and
the eye that sees it.

Exit code 1 when either list is not empty.

Local game coords of a report row: lx = Blender X, lz = -Blender Y, y = Z
(above the door's terrain height), the builder's own frame.
"""
import json
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_common as ec  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


BLEND = arg('--blend')
TERRAIN = arg('--terrain')
PREFIXES = tuple(arg('--prefix', 'Entrance_,Growth_').split(','))
GROWTH = tuple(arg('--growth', 'Growth_').split(','))
WATER = arg('--water')
WATER = float(WATER) if WATER is not None else None
TOL = float(arg('--tol', '0.03'))
GROWTH_TOL = float(arg('--growth-tol', '0.07'))
OUT = arg('--out')
RIMS = '--rims' in argv
RIM_TOL = float(arg('--rim-tol', '0.035'))
EYE_STEP = float(arg('--eye-step', '3.0'))
EYE_HALF = float(arg('--eye-half', '30.0'))
EYE_HEIGHTS = (1.7, 4.0, 8.0)


def samples(a, b, c, step=0.2):
    """Points of a triangle: its corners, its centre and points along its
    edges and medians every `step` yards."""
    pts = [a, b, c, (a + b + c) / 3]
    for (p, q) in ((a, b), (b, c), (c, a), (a, (b + c) / 2), (b, (a + c) / 2), (c, (a + b) / 2)):
        n = int((q - p).length / step)
        for i in range(1, n + 1):
            pts.append(p.lerp(q, i / (n + 1)))
    return pts


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    gr = ec.Ground(TERRAIN)
    verts, tris, tri_island, islands = [], [], [], []
    rims = []            # (island, a, b): the open edges of the welded mesh
    objs = sorted((o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(PREFIXES)), key=lambda o: o.name)
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0015)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.verts.index_update()
        parent = list(range(len(bm.verts)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for f in bm.faces:
            r = find(f.verts[0].index)
            for v in f.verts[1:]:
                parent[find(v.index)] = r
        base = len(verts)
        verts.extend(v.co.copy() for v in bm.verts)
        local = {}
        for f in bm.faces:
            root = find(f.verts[0].index)
            if root not in local:
                local[root] = len(islands)
                islands.append({'object': o.name, 'growth': o.name.startswith(GROWTH), 'tris': []})
            isl = local[root]
            islands[isl]['tris'].append(len(tris))
            tris.append(tuple(base + v.index for v in f.verts))
            tri_island.append(isl)
        for e in bm.edges:
            if len(e.link_faces) == 1:
                rims.append((local[find(e.verts[0].index)], e.verts[0].co.copy(), e.verts[1].co.copy(),
                             base + e.verts[0].index, base + e.verts[1].index))
        bm.free()
    bvh = BVHTree.FromPolygons(verts, tris, all_triangles=True, epsilon=0.0)
    adj = [set() for _ in islands]
    grounded = [False] * len(islands)
    for i, isl in enumerate(islands):
        tol = GROWTH_TOL if isl['growth'] else TOL
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        gap = 1e9
        for t in isl['tris']:
            a, b, c = (verts[k] for k in tris[t])
            for p in samples(a, b, c):
                for k in range(3):
                    lo[k] = min(lo[k], p[k])
                    hi[k] = max(hi[k], p[k])
                over = p.z - gr.h(p.x, -p.y)
                gap = min(gap, over)
                if over <= tol or (isl['growth'] and WATER is not None and p.z <= WATER + tol):
                    grounded[i] = True
                for (_co, _n, idx, _d) in bvh.find_nearest_range(p, tol):
                    j = tri_island[idx]
                    if j != i:
                        adj[i].add(j)
                        adj[j].add(i)
        isl['lo'], isl['hi'], isl['ground_gap'] = lo, hi, gap
    # what passes through each other touches too
    for (ta, tb) in bvh.overlap(bvh):
        i, j = tri_island[ta], tri_island[tb]
        if i != j:
            adj[i].add(j)
            adj[j].add(i)
    # support spreads from the ground; growth never holds stone up
    supported = list(grounded)
    stack = [i for i, g in enumerate(grounded) if g]
    while stack:
        i = stack.pop()
        for j in adj[i]:
            if supported[j]:
                continue
            if islands[i]['growth'] and not islands[j]['growth']:
                continue
            supported[j] = True
            stack.append(j)
    floating = []
    for i, isl in enumerate(islands):
        if supported[i]:
            continue
        near = 1e9
        for t in isl['tris']:
            for p in (verts[k] for k in tris[t]):
                for (_co, _n, idx, d) in bvh.find_nearest_range(p, 1.5):
                    if tri_island[idx] != i and supported[tri_island[idx]]:
                        near = min(near, d)
        c = (isl['lo'] + isl['hi']) / 2
        size = isl['hi'] - isl['lo']
        floating.append({'object': isl['object'], 'lx': round(c.x, 2), 'lz': round(-c.y, 2), 'y': round(c.z, 2),
                         'size': [round(size.x, 2), round(size.y, 2), round(size.z, 2)], 'tris': len(isl['tris']),
                         'gap_to_supported': None if near > 1e8 else round(near, 3),
                         'over_ground': round(isl['ground_gap'], 3)})
    floating.sort(key=lambda r: (r['object'], -r['tris'], r['lx'], r['lz']))
    open_rims = []
    if RIMS:
        # the scene a line of sight crosses: the model and the ground
        sv, st = list(verts), list(tris)
        n = int(2 * EYE_HALF / 1.0) + 1
        gb = len(sv)
        for j in range(n):
            for i in range(n):
                x, y = -EYE_HALF + i, -EYE_HALF + j
                sv.append(Vector((x, y, gr.h(x, -y))))
        for j in range(n - 1):
            for i in range(n - 1):
                a = gb + j * n + i
                st.append((a, a + 1, a + n + 1))
                st.append((a, a + n + 1, a + n))
        scene = BVHTree.FromPolygons(sv, st, all_triangles=True, epsilon=0.0)
        eyes = []
        m = int(2 * EYE_HALF / EYE_STEP) + 1
        up = Vector((0, 0, 1))
        for j in range(m):
            for i in range(m):
                x, y = -EYE_HALF + i * EYE_STEP, -EYE_HALF + j * EYE_STEP
                for h in EYE_HEIGHTS:
                    e = Vector((x, y, gr.h(x, -y) + h))
                    if scene.ray_cast(e, up)[0] is None and scene.ray_cast(e, -up, h - 0.05)[0] is None:
                        eyes.append(e)
        print('SUPPORT eyes', len(eyes))

        def seen(p):
            for e in eyes:
                d = p - e
                ln = d.length
                if ln > 45.0 or ln < 0.3:
                    continue
                hit = scene.ray_cast(e, d / ln, ln - 0.02)
                if hit[0] is None:
                    return e
            return None

        acc = {}
        for (i, a, b, va, vb) in rims:
            if islands[i]['growth']:
                continue
            n = max(1, int((b - a).length / 0.12))
            bare, by, where = 0, None, None
            for k in range(n):
                p = a.lerp(b, (k + 0.5) / n)
                if p.z - gr.h(p.x, -p.y) <= RIM_TOL:
                    continue
                if any(va not in tris[idx] or vb not in tris[idx] for (_co, _n, idx, _d) in bvh.find_nearest_range(p, RIM_TOL)):
                    continue
                eye = seen(p)
                if eye is None:
                    continue
                bare, by, where = bare + 1, eye, p
            if bare:
                ln = (b - a).length * bare / n
                row = acc.setdefault(i, [0.0, 0.0, None, None])
                row[0] += ln
                if ln > row[1]:
                    row[1], row[2], row[3] = ln, where, by
        for i, (total, _longest, at, eye) in acc.items():
            if total < 0.1:
                continue
            isl = islands[i]
            size = isl['hi'] - isl['lo']
            open_rims.append({'object': isl['object'], 'lx': round(at.x, 2), 'lz': round(-at.y, 2), 'y': round(at.z, 2),
                              'open': round(total, 2), 'seen_from': [round(eye.x, 1), round(-eye.y, 1), round(eye.z, 1)],
                              'size': [round(size.x, 2), round(size.y, 2), round(size.z, 2)],
                              'tris': len(isl['tris'])})
        open_rims.sort(key=lambda r: (r['object'], -r['open']))
    by_obj = {}
    for isl in islands:
        by_obj[isl['object']] = by_obj.get(isl['object'], 0) + 1
    print('SUPPORT objects', len(objs), 'islands', len(islands), 'grounded', sum(grounded), 'floating', len(floating))
    print('SUPPORT islands by object', json.dumps(by_obj))
    for r in floating:
        print('FLOATING', json.dumps(r))
    if RIMS:
        print('SUPPORT open rims', len(open_rims))
        for r in open_rims:
            print('OPEN', json.dumps(r))
    if OUT:
        json.dump({'islands': len(islands), 'by_object': by_obj, 'tolerance': TOL, 'growth_tolerance': GROWTH_TOL,
                   'floating': floating, 'open_rims': open_rims}, open(OUT, 'w'), indent=1)
    sys.exit(1 if floating or open_rims else 0)


if __name__ == '__main__':
    main()
