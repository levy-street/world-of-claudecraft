"""Support audit for a built entrance: which pieces hang in the air?

  blender -b <built .blend> --python support_audit.py -- --terrain DIR --out DIR
      [--tag NAME] [--prefix Entrance_] [--overlay]

Every loose mesh island of every `Entrance_*` object is one piece (a walling
stone, a voussoir, a slate, a rafter, a leaf). A piece is HELD when one of
these is true, counting only the ground and pieces that are themselves held:

- it rests: enough of its underside has the ground or a held piece directly
  under it, and its centre of mass stands over what carries it;
- it is built in: a good share of its whole surface lies against held pieces
  (a voussoir in its ring, a stone in its course), or it is a short stump
  with one end in the masonry (what is left of a snapped tracery bar);
- it spans: it touches held pieces at both of its ends (a lintel, a rafter, a
  tracery bar);
- it is fixed: timber, iron and cloth may hang or cantilever from one held
  contact (a brace, a yoke, a rope), so may a slender stone bar built in at
  one end (a tracery spoke), and a leaf from a wall or a stem;
- it is planted: a good depth of it is in the ground (a leaning headstone).

Everything else is listed with its place (door-local west, up, north), the
share of its underside that is carried, the gap under it and what it touches.
The list is the work order: fix the model until it is empty, then look from
below anyway (a piece can pass on one corner and still read as hovering). To
help that look, a second list names the held stones with the most air under
them (a corbel, a stone bridging a pocket, a cap oversailing its pier): held,
but the ones to judge by eye.

Convex pieces (stones, boxes, voussoirs) are tested as their convex hull, so
a stone's open bed and chipped corners do not count as air. `--overlay` adds
an `AUDIT_Flagged` object (red, emissive) to the scene for the review renders.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_common as ec  # noqa: E402

K_STONE, K_WOOD, K_METAL, K_LEAF, K_RAW, K_CLOTH, K_EARTH = 0, 1, 2, 3, 4, 5, 6
KIND_NAME = {0: 'stone', 1: 'timber', 2: 'iron', 3: 'leaf', 4: 'raw', 5: 'cloth', 6: 'earth'}
VOID_SLOT = 2

TOL = 0.05            # a joint: closer than this is touching
PLANTED = 0.15        # this deep in the ground a piece stands by itself
REST_MIN = 0.34       # share of the underside that must be carried to rest
BUILT_IN_MIN = 0.22   # share of the whole surface lying against held pieces
LEAF_REACH = 0.16     # a leaf this near a wall, a stem or a held leaf is held
GRID = 7              # underside samples per side
SAMPLE_STEP = 0.12    # surface sample spacing
MAX_SAMPLES = 300
AIR_GAP = 0.15        # more than this under a sample is open air, not a joint
AIR_SHARE = 0.4       # held pieces with this share of the underside over air are listed for the eye


def island_sets(bm):
    """Vertex index lists of every loose island, in first-vertex order."""
    parent = list(range(len(bm.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in bm.edges:
        a, b = find(e.verts[0].index), find(e.verts[1].index)
        if a != b:
            parent[max(a, b)] = min(a, b)
    groups = {}
    for v in bm.verts:
        groups.setdefault(find(v.index), []).append(v.index)
    return [groups[k] for k in sorted(groups)]


class Piece:
    __slots__ = ('obj', 'idx', 'kind', 'void', 'pts', 'tris', 'convex', 'planes', 'lo', 'hi', 'centroid', 'bvh',
                 'samples', 'under', 'touch', 'ground_touch', 'held', 'why', 'rest', 'built', 'balanced', 'nfaces',
                 'core', 'planted', 'growth', 'slender')


def hull_of(points):
    """(verts, tris, planes) of the convex hull, or None when degenerate."""
    hb = bmesh.new()
    vs = [hb.verts.new(p) for p in points]
    try:
        res = bmesh.ops.convex_hull(hb, input=vs)
    except Exception:
        hb.free()
        return None
    faces = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
    if len(faces) < 4:
        hb.free()
        return None
    bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context='VERTS')
    bmesh.ops.triangulate(hb, faces=hb.faces[:])
    bmesh.ops.recalc_face_normals(hb, faces=hb.faces[:])
    hb.verts.index_update()
    verts = [v.co.copy() for v in hb.verts]
    tris = [tuple(v.index for v in f.verts) for f in hb.faces]
    planes = [(f.normal.copy(), f.normal.dot(f.verts[0].co)) for f in hb.faces if f.calc_area() > 1e-9]
    hb.free()
    c = sum(verts, Vector()) / len(verts)
    if any(n.dot(c) - d > 1e-6 for (n, d) in planes):      # normals must point out
        planes = [(-n, -d) for (n, d) in planes]
    return verts, tris, planes


def surface_samples(verts, tris):
    out = [v.copy() for v in verts]
    budget = MAX_SAMPLES - len(out)
    area = 0.0
    for (a, b, c) in tris:
        area += (verts[b] - verts[a]).cross(verts[c] - verts[a]).length / 2
    step = max(SAMPLE_STEP, math.sqrt(area / max(1, budget)) if budget > 0 else 9.0)
    for (a, b, c) in tris:
        pa, pb, pc = verts[a], verts[b], verts[c]
        n = max(1, int(max((pb - pa).length, (pc - pa).length, (pc - pb).length) / step))
        for i in range(n + 1):
            for j in range(n + 1 - i):
                if (i == 0 and j == 0) or (i == n and j == 0) or (i == 0 and j == n):
                    continue
                u, v = i / n, j / n
                out.append(pa + (pb - pa) * u + (pc - pa) * v)
    return out


def load_pieces(prefix):
    pieces = []
    for obj in sorted((o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith(prefix)),
                      key=lambda o: o.name):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        kindL = bm.faces.layers.int.get('kind')
        mw = obj.matrix_world
        vert_faces = {}
        for f in bm.faces:
            vert_faces.setdefault(f.verts[0].index, []).append(f)
        owner = {}
        islands = island_sets(bm)
        for k, vs in enumerate(islands):
            for vi in vs:
                owner[vi] = k
        faces_of = [[] for _ in islands]
        for f in bm.faces:
            faces_of[owner[f.verts[0].index]].append(f)
        for k, vs in enumerate(islands):
            fs = faces_of[k]
            if not fs:
                continue
            p = Piece()
            p.obj, p.idx = obj.name, k
            kinds = {}
            for f in fs:
                kk = f[kindL] if kindL is not None else K_STONE
                kinds[kk] = kinds.get(kk, 0) + 1
            p.kind = max(sorted(kinds), key=lambda kk: kinds[kk])
            p.void = all(f.material_index == VOID_SLOT for f in fs)
            p.nfaces = len(fs)
            # a wall's dark rubble core (loose faces behind a run of stones: front,
            # back, a free end) fills a course; it carries nothing by itself
            p.core = p.kind == K_RAW and len(fs) <= 4 and not all(f.material_index == VOID_SLOT for f in fs)
            pts = [mw @ bm.verts[vi].co for vi in vs]
            local = {vi: i for i, vi in enumerate(vs)}
            mesh_tris = []
            for f in fs:
                ids = [local[v.index] for v in f.verts]
                for i in range(1, len(ids) - 1):
                    mesh_tris.append((ids[0], ids[i], ids[i + 1]))
            p.convex, p.planes = False, None
            p.pts, p.tris = pts, mesh_tris
            if p.kind != K_LEAF and len(pts) >= 4:
                h = hull_of(pts)
                if h is not None:
                    hv, ht, hp = h
                    depth = max(-max(n.dot(q) - d for (n, d) in hp) for q in pts)
                    if depth < 0.045:
                        p.convex, p.planes, p.pts, p.tris = True, hp, hv, ht
            p.growth = obj.name.endswith('Growth')
            p.lo = Vector((min(q.x for q in p.pts), min(q.y for q in p.pts), min(q.z for q in p.pts)))
            p.hi = Vector((max(q.x for q in p.pts), max(q.y for q in p.pts), max(q.z for q in p.pts)))
            p.centroid = sum(p.pts, Vector()) / len(p.pts)
            # a bar: at least 3.5 times as long as it is thick, in any direction
            e0 = max(p.pts, key=lambda q: (q - p.centroid).length_squared)
            e1 = max(p.pts, key=lambda q: (q - e0).length_squared)
            along = (e1 - e0)
            length = along.length
            if length > 1e-6:
                along = along / length
                thick = 2 * max(((q - e0) - along * (q - e0).dot(along)).length for q in p.pts)
                p.slender = length >= 3.5 * thick
            else:
                p.slender = False
            pieces.append(p)
        bm.free()
    return pieces


class Grid:
    def __init__(self, pieces, cell=1.5):
        self.cell = cell
        self.map = {}
        for i, p in enumerate(pieces):
            for key in self._keys(p.lo - Vector((TOL,) * 3), p.hi + Vector((TOL,) * 3)):
                self.map.setdefault(key, []).append(i)

    def _keys(self, lo, hi):
        c = self.cell
        for ix in range(int(math.floor(lo.x / c)), int(math.floor(hi.x / c)) + 1):
            for iy in range(int(math.floor(lo.y / c)), int(math.floor(hi.y / c)) + 1):
                for iz in range(int(math.floor(lo.z / c)), int(math.floor(hi.z / c)) + 1):
                    yield (ix, iy, iz)

    def at(self, q):
        c = self.cell
        return self.map.get((int(math.floor(q.x / c)), int(math.floor(q.y / c)), int(math.floor(q.z / c))), ())


def inside(p, q, slack=1e-4):
    return p.convex and all(n.dot(q) - d <= slack for (n, d) in p.planes)


def convex2d(points):
    pts = sorted(set((round(x, 4), round(y, 4)) for (x, y) in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for q in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(q)
    for q in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(q)
    return lower[:-1] + upper[:-1]


def over_polygon(q, poly, slack=0.06):
    """Is the 2D point q over the convex polygon (or within slack of it)?"""
    if not poly:
        return False
    if len(poly) < 3:
        return min(math.hypot(q[0] - a[0], q[1] - a[1]) for a in poly) <= slack + 0.12
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(ex, ey) or 1.0
        if ((q[0] - a[0]) * ey - (q[1] - a[1]) * ex) / ln > slack:      # outside (polygon is counter-clockwise)
            return False
    return True


def analyse(pieces, ground):
    # One BVH over every solid piece, face -> piece.
    verts, polys, face_piece = [], [], []
    for i, p in enumerate(pieces):
        if p.kind == K_LEAF or p.void:
            continue
        base = len(verts)
        verts.extend(p.pts)
        for t in p.tris:
            polys.append([base + t[0], base + t[1], base + t[2]])
            face_piece.append(i)
    world = BVHTree.FromPolygons(verts, polys, all_triangles=True, epsilon=0.0)
    keep = [k for k, j in enumerate(face_piece) if not pieces[j].core]
    carriers = BVHTree.FromPolygons(verts, [polys[k] for k in keep], all_triangles=True, epsilon=0.0)
    carrier_piece = [face_piece[k] for k in keep]
    grid = Grid(pieces, 1.5)
    solid = [i for i, p in enumerate(pieces) if p.kind != K_LEAF and not p.void]
    for i in solid:
        p = pieces[i]
        p.bvh = BVHTree.FromPolygons(p.pts, [list(t) for t in p.tris], all_triangles=True, epsilon=0.0)
        p.samples = surface_samples(p.pts, p.tris)
        p.touch = {}
        p.ground_touch = 0
        p.planted = ground(p.centroid.x, p.centroid.y) - p.lo.z >= PLANTED
        # a stem or a moss pad of the growth clings like a leaf does
        reach = LEAF_REACH if p.growth else TOL
        # --- what the whole surface lies against
        for q in p.samples:
            if q.z - ground(q.x, q.y) <= TOL:
                p.ground_touch += 1
                continue
            seen = set()
            for (_co, _n, fi, _d) in world.find_nearest_range(q, reach):
                j = face_piece[fi]
                if j != i:
                    seen.add(j)
            for j in grid.at(q):
                if j != i and j not in seen and inside(pieces[j], q):
                    seen.add(j)
            for j in seen:
                p.touch.setdefault(j, []).append(q)
        # --- what is under it
        p.under = []
        sx, sy = p.hi.x - p.lo.x, p.hi.y - p.lo.y
        for a in range(GRID):
            for b in range(GRID):
                x = p.lo.x + sx * (0.06 + 0.88 * a / (GRID - 1))
                y = p.lo.y + sy * (0.06 + 0.88 * b / (GRID - 1))
                hit = p.bvh.ray_cast(Vector((x, y, p.lo.z - 1.0)), Vector((0, 0, 1)), p.hi.z - p.lo.z + 2.0)
                if hit[0] is None:
                    continue
                u = hit[0]
                gz = ground(x, y)
                if u.z - gz <= TOL:
                    p.under.append((x, y, -1, 0.0))
                    continue
                best, gap = None, u.z - gz
                for j in grid.at(u):
                    if j != i and (p.core or not pieces[j].core) and inside(pieces[j], u, TOL * 0.5):
                        best, gap = j, 0.0
                        break
                if best is None:
                    d = carriers.ray_cast(u - Vector((0, 0, 1e-4)), Vector((0, 0, -1)), max(0.02, u.z - gz))
                    if d[0] is not None and carrier_piece[d[2]] != i and d[3] < gap:
                        best, gap = carrier_piece[d[2]], d[3]
                    elif d[0] is not None and carrier_piece[d[2]] == i:
                        # a non-convex piece over itself: look past its own lower part
                        best, gap = i, 0.0
                p.under.append((x, y, best if gap <= TOL else None, gap))
    # --- leaves: nearest solid
    leaves = [i for i, p in enumerate(pieces) if p.kind == K_LEAF]
    for i in leaves:
        p = pieces[i]
        p.touch, p.ground_touch, p.under = {}, 0, []
        for q in p.pts:
            if q.z - ground(q.x, q.y) <= LEAF_REACH:
                p.ground_touch += 1
            # a wall or a bough within reach, or its own vine (the stem is drawn
            # through every third joint, so a leaf may sit a little further off it)
            for (_co, _n, fi, d) in world.find_nearest_range(q, 2 * LEAF_REACH):
                j = face_piece[fi]
                if d <= LEAF_REACH or (pieces[j].growth and pieces[j].kind == K_WOOD):
                    p.touch.setdefault(j, []).append(q)
    return solid, leaves


def settle(pieces, solid, leaves):
    """Propagate 'held' up from the ground to a fixed point."""
    for p in pieces:
        p.held, p.why, p.rest, p.built, p.balanced = False, '', 0.0, 0.0, False
    for i in solid:      # symmetric touching
        for j, qs in list(pieces[i].touch.items()):
            if pieces[j].kind != K_LEAF and not pieces[j].void:
                pieces[j].touch.setdefault(i, [])
    changed = True
    while changed:
        changed = False
        for i in solid:
            p = pieces[i]
            if p.held:
                continue
            n = len(p.under)
            ok = [(x, y) for (x, y, j, _g) in p.under if j == -1 or j == i or (j is not None and pieces[j].held)]
            p.rest = len(ok) / n if n else 0.0
            poly = convex2d(ok)
            p.balanced = bool(ok) and over_polygon((p.centroid.x, p.centroid.y), poly)
            held_touch = [q for (j, qs) in p.touch.items() if pieces[j].held and (p.core or not pieces[j].core)
                          for q in qs]
            p.built = (len({(round(q.x, 4), round(q.y, 4), round(q.z, 4)) for q in held_touch}) + p.ground_touch) / \
                max(1, len(p.samples))
            why = ''
            ext = p.hi - p.lo
            axis = max(range(3), key=lambda a: ext[a])
            slender = p.slender
            if p.planted:
                why = 'planted'
            elif n and p.rest >= REST_MIN and p.balanced:
                why = 'rests'
            elif p.built >= BUILT_IN_MIN:
                why = 'built in'
            elif p.ground_touch and not n:
                why = 'rests'
            else:
                # spans: held contacts near both ends of its longest extent
                lo_end = [q for q in held_touch if q[axis] < p.lo[axis] + ext[axis] * 0.3]
                hi_end = [q for q in held_touch if q[axis] > p.hi[axis] - ext[axis] * 0.3]
                if lo_end and hi_end and ext[axis] > 0.2:
                    why = 'spans'
                elif (p.kind in (K_WOOD, K_METAL, K_CLOTH) or slender) and (held_touch or p.ground_touch):
                    why = 'fixed'
                elif ext[axis] <= 0.7 and (lo_end or hi_end) and p.built >= 0.12:
                    why = 'built in'      # a stump: a short piece with one end in the masonry
            if why:
                p.held, p.why = True, why
                changed = True
    # leaves hold on to held solids, then to each other
    pending = []
    for i in leaves:
        p = pieces[i]
        if p.ground_touch or any(pieces[j].held for j in p.touch):
            p.held, p.why = True, 'grows on'
        else:
            pending.append(i)
    cell = LEAF_REACH * 2
    for _ in range(40):
        if not pending:
            break
        buckets = {}
        for i in leaves:
            if pieces[i].held:
                c = pieces[i].centroid
                buckets.setdefault((int(c.x // cell), int(c.y // cell), int(c.z // cell)), []).append(c)
        rest = []
        for i in pending:
            c = pieces[i].centroid
            k = (int(c.x // cell), int(c.y // cell), int(c.z // cell))
            near = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for o in buckets.get((k[0] + dx, k[1] + dy, k[2] + dz), ()):
                            if (o - c).length <= cell:
                                near = True
                                break
            if near:
                pieces[i].held, pieces[i].why = True, 'grows on'
            else:
                rest.append(i)
        if len(rest) == len(pending):
            break
        pending = rest


def report(pieces, solid, leaves, ground, out, tag):
    rows = []
    for i in solid + leaves:
        p = pieces[i]
        if p.held:
            continue
        gaps = [g for (_x, _y, j, g) in p.under if j is None]
        size = p.hi - p.lo
        touching = sorted({f'{pieces[j].obj}#{pieces[j].idx}' for j in p.touch})
        rows.append({
            'object': p.obj, 'island': p.idx, 'kind': KIND_NAME.get(p.kind, str(p.kind)),
            'lx': round(p.centroid.x, 2), 'y': round(p.centroid.z, 2), 'lz': round(-p.centroid.y, 2),
            'above_ground': round(p.lo.z - ground(p.centroid.x, p.centroid.y), 2),
            'size': [round(size.x, 2), round(size.z, 2), round(size.y, 2)],
            'carried': round(p.rest, 2), 'built_in': round(p.built, 2), 'balanced': p.balanced,
            'gap_under': round(min(gaps), 2) if gaps else 0.0,
            'touches': touching[:6],
            'verdict': 'touches nothing' if not p.touch and not p.ground_touch else
                       ('nothing under it' if p.rest < 0.05 else ('overhangs' if not p.balanced else 'barely carried')),
        })
    rows.sort(key=lambda r: (r['object'], -r['y']))
    # held, but with a good share of the underside over open air: for the eye
    airy = []
    for i in solid:
        p = pieces[i]
        if not p.held or p.core or p.kind in (K_WOOD, K_METAL, K_CLOTH) or p.why in ('spans', 'planted', 'fixed'):
            continue
        n = len(p.under)
        air = sum(1 for (_x, _y, j, g) in p.under if j is None and g > AIR_GAP) / n if n else 0.0
        if air >= AIR_SHARE:
            size = p.hi - p.lo
            airy.append({'object': p.obj, 'island': p.idx, 'kind': KIND_NAME.get(p.kind, str(p.kind)),
                         'lx': round(p.centroid.x, 2), 'y': round(p.centroid.z, 2), 'lz': round(-p.centroid.y, 2),
                         'size': [round(size.x, 2), round(size.z, 2), round(size.y, 2)], 'air': round(air, 2),
                         'carried': round(p.rest, 2), 'built_in': round(p.built, 2), 'held_because': p.why})
    airy.sort(key=lambda r: -r['air'])
    summary = {
        'pieces': len(solid) + len(leaves), 'solid': len(solid), 'leaves': len(leaves),
        'unsupported': len(rows), 'unsupported_solid': sum(1 for r in rows if r['kind'] != 'leaf'),
        'unsupported_leaves': sum(1 for r in rows if r['kind'] == 'leaf'),
        'by_object': {}, 'held_by_rule': {},
    }
    for r in rows:
        summary['by_object'][r['object']] = summary['by_object'].get(r['object'], 0) + 1
    for i in solid + leaves:
        if pieces[i].held:
            summary['held_by_rule'][pieces[i].why] = summary['held_by_rule'].get(pieces[i].why, 0) + 1
    os.makedirs(out, exist_ok=True)
    name = f'auditoria_{tag}' if tag else 'auditoria'
    summary['held_over_air'] = len(airy)
    json.dump({'tolerance': TOL, 'rest_min': REST_MIN, 'built_in_min': BUILT_IN_MIN, 'summary': summary, 'rows': rows,
               'held_over_air': airy}, open(os.path.join(out, name + '.json'), 'w'), indent=1)
    with open(os.path.join(out, name + '.txt'), 'w', encoding='utf-8') as f:
        f.write(f'Support audit {tag}: {summary["pieces"]} pieces ({summary["solid"]} solid, {summary["leaves"]} leaves), '
                f'{summary["unsupported_solid"]} solid and {summary["unsupported_leaves"]} leaves not held\n')
        f.write('object               island kind    west    up   north  above  carried built  gap   verdict\n')
        for r in rows:
            f.write(f'{r["object"]:<20} {r["island"]:>6} {r["kind"]:<7} {r["lx"]:>6.2f} {r["y"]:>5.2f} {r["lz"]:>7.2f} '
                    f'{r["above_ground"]:>5.2f}   {r["carried"]:>4.2f}   {r["built_in"]:>4.2f}  {r["gap_under"]:>4.2f}  '
                    f'{r["verdict"]}  size {r["size"]}\n')
        f.write(f'\nHeld, but {int(AIR_SHARE * 100)} percent or more of the underside is over open air (judge by eye): '
                f'{len(airy)}\n')
        f.write('object               island kind    west    up   north   air  carried built  held because\n')
        for r in airy:
            f.write(f'{r["object"]:<20} {r["island"]:>6} {r["kind"]:<7} {r["lx"]:>6.2f} {r["y"]:>5.2f} {r["lz"]:>7.2f}  '
                    f'{r["air"]:>4.2f}   {r["carried"]:>4.2f}   {r["built_in"]:>4.2f}  {r["held_because"]}  size {r["size"]}\n')
    print('AUDIT', json.dumps(summary))
    return rows, airy


def overlay(pieces, solid, leaves, airy=()):
    old = bpy.data.objects.get('AUDIT_Flagged')
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    also = {(r['object'], r['island']) for r in airy}
    bm = bmesh.new()
    for i in solid + leaves:
        p = pieces[i]
        if p.held and (p.obj, p.idx) not in also:
            continue
        c = p.centroid
        vs = [bm.verts.new(c + (q - c) * 1.04 + Vector((0, 0, 0.004))) for q in p.pts]
        for t in p.tris:
            try:
                bm.faces.new((vs[t[0]], vs[t[1]], vs[t[2]]))
            except ValueError:
                pass
    mesh = bpy.data.meshes.new('AUDIT_Flagged')
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(ec.emissive_material('AUDIT_Red', (1.0, 0.02, 0.02), strength=6.0))
    obj = bpy.data.objects.new('AUDIT_Flagged', mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def run(terrain, out, tag='', prefix='Entrance_', with_overlay=False):
    gr = ec.Ground(os.path.join(terrain, 'crypt_heightgrid.json'))

    def ground(x, y):
        return gr.h(x, -y)

    pieces = load_pieces(prefix)
    solid, leaves = analyse(pieces, ground)
    settle(pieces, solid, leaves)
    rows, airy = report(pieces, solid, leaves, ground, out, tag)
    if with_overlay:
        overlay(pieces, solid, leaves, airy)
    return rows


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag, default=None):
        return argv[argv.index(flag) + 1] if flag in argv else default

    run(arg('--terrain'), arg('--out'), arg('--tag', ''), arg('--prefix', 'Entrance_'), '--overlay' in argv)
    if '--save' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=arg('--save'))
