"""The hand-painted finish of the Heart's formations (landmark_pieces.py, the roots and
the Anvil, heart_pieces.py), after the raid's Painted World brief: big simple masses,
colour that drifts inside a material, warm lit tops over cool shadows, worn pale edges,
never one colour per block and never black.

A sculpt is meshed once and shaded smooth with its hard breaks kept (`hand_sculpt`), then
every corner takes a colour from its position and its normal (`paint_faces`): each
formation is a small function from (position, normal, convexity) to an sRGB colour, so one
rock never reads as a patchwork of its parts. The piece's own ambient occlusion lays its
soft shadow over that (shkit.SPiece.finish); the faces are the PAINT kind, so its
weathering stays a light drift.

Also here: the lines of light that lie ON a surface (`surface_ribbon`: found by rays, so
no line ever hangs in the air) and the frozen fall as one sheet (`ice_sheet`).

Deterministic: every noise is seeded, nothing reads the clock.
"""
import math

from mathutils import Vector

import gravewyrm_sculpt as gs
from gwkit import add_sculpt, mix, sstep
from hckit import GLOW, _fbm
from shkit import PAINT


def _facing(p, faces, kind):
    for fc in faces:
        fc[p.kind] = kind


def hand_sculpt(bpy, p, f, name, target, sharp=52.0, colours=None, kinds=None):
    """Mesh a field and hand it to the piece shaded smooth, its edges past `sharp`
    degrees kept hard (a broken ledge stays a break, a worn shoulder rolls). Returns its
    faces, all of the PAINT kind."""
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    made = add_sculpt(p, f, verts, faces, colours, kinds, smooth=True)
    _facing(p, made, PAINT)
    limit = math.radians(sharp)
    edges = {e for fc in made for e in fc.edges}
    for e in edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > limit:
            e.smooth = False
    p.bm.normal_update()
    return made


def convexity(p, faces):
    """Each vertex's local convexity (-1 a crevice, +1 a crest), measured over its ring
    twice smoothed, so a wear line follows the form and never one triangle."""
    verts = {v for fc in faces for v in fc.verts}
    raw = {}
    for v in verts:
        if not v.link_edges:
            raw[v] = 0.0
            continue
        mean = Vector()
        length = 0.0
        for e in v.link_edges:
            mean += e.other_vert(v).co
            length += e.calc_length()
        n = len(v.link_edges)
        mean /= n
        length = max(1e-3, length / n)
        raw[v] = max(-1.0, min(1.0, (v.co - mean).dot(v.normal) / length * 1.7))
    for _ in range(2):
        nxt = {}
        for v in verts:
            s = raw[v] * 2.0
            w = 2.0
            for e in v.link_edges:
                o = e.other_vert(v)
                if o in raw:
                    s += raw[o]
                    w += 1.0
            nxt[v] = s / w
        raw = nxt
    return raw


def paint_faces(p, faces, shade):
    """Every corner of `faces` from `shade(pos, normal, conv)` (sRGB). A corner on a hard
    break takes its own face's normal, so a lit top meets a shaded wall on a clean line."""
    conv = convexity(p, faces)
    for fc in faces:
        fn = fc.normal
        for loop in fc.loops:
            v = loop.vert
            hard = any(not e.smooth for e in v.link_edges)
            n = (fn if hard else v.normal)
            c = shade(v.co, n, conv.get(v, 0.0))
            loop[p.col] = (min(1.0, max(0.0, c[0])), min(1.0, max(0.0, c[1])), min(1.0, max(0.0, c[2])), 1.0)


def drift(q, scale=0.09, salt=0.0):
    """A broad soft value drift (about 0 to 1) over a formation."""
    return _fbm(q.x * scale + 3.1 + salt, q.y * scale - 1.7, q.z * scale + salt * 0.5)


def brush(q, scale=0.5, stretch=0.35):
    """A brush stroke's value: long across the slope, short up it (about 0 to 1)."""
    return _fbm(q.x * scale * stretch + 7.3, q.y * scale * stretch - 2.1, q.z * scale * 1.5)


def stone_shader(low, mid, high, cool, *, cap=None, cap_at=(0.5, 0.9), bed=None, bed_scale=2.2, edge=0.55,
                 z_span=(-6.0, 24.0), hollow=0.75, extra=None):
    """A rock's painted light: value climbs from `low` to `high` up the formation and with
    the broad drift; faces that turn down or into a crevice sink into the `cool` shadow
    (a colour, never black); worn crests take a pale edge; `bed`, if given, its sedimentary
    bands of colour (a noise-warped height); `cap` a colour settling on the upward faces
    (dust, snow); `extra` a last pass (colour, pos, normal, conv) -> colour."""
    z0, z1 = z_span

    def shade(q, n, c):
        t = max(0.0, min(1.0, (q.z - z0) / (z1 - z0)))
        d = drift(q)
        v = max(0.0, min(1.0, t * 0.55 + (d - 0.25) * 0.9))
        col = mix(low, mid, sstep(0.0, 0.5, v))
        col = mix(col, high, sstep(0.5, 1.0, v))
        if bed is not None:
            w = drift(q, 0.05, 9.0) * 5.0
            b = 0.5 + 0.5 * math.sin((q.z + w) * bed_scale)
            col = mix(col, bed, 0.55 * b * b * b)
        s = brush(q)
        col = tuple(ch * (0.9 + 0.2 * s) for ch in col)
        # The shade: under the overhangs and in the hollows, a colour of its own.
        under = sstep(-0.05, -0.6, n.z)
        col = mix(col, cool, min(1.0, under * 0.75 + max(0.0, -c) * hollow))
        # The worn edge: crests paler, a painter's highlight along the form.
        col = mix(col, tuple(min(1.0, ch * 1.42 + 0.05) for ch in col), max(0.0, c) * edge)
        if cap is not None:
            k = sstep(cap_at[0], cap_at[1], n.z + (s - 0.5) * 0.35)
            col = mix(col, cap, k)
        if extra is not None:
            col = extra(col, q, n, c)
        return col

    return shade


def surface_ribbon(p, tree, pts, w, shade, slot=GLOW, lift=0.05, reach=9.0, gap=1.5):
    """A thin line of light laid on a surface: `pts` are (from, to) rays (each from
    outside the rock toward it); where one hits, the ribbon has a point there, turned to
    the surface; a ray that misses or jumps more than `gap` yards breaks the line, so no
    stretch of it ever hangs in the air. Single sided, facing out."""
    bm = p.bm
    run = []

    def flush():
        if len(run) < 2:
            run.clear()
            return
        rows = []
        for k, (q, n) in enumerate(run):
            d = (run[min(k + 1, len(run) - 1)][0] - run[max(k - 1, 0)][0])
            side = d.cross(n)
            if side.length < 1e-4:
                side = Vector((1.0, 0.0, 0.0))
            ww = w * 0.5 * (0.35 + 0.65 * math.sin(math.pi * (k + 0.5) / len(run)))
            side = side.normalized() * ww
            base = q + n * lift
            rows.append((bm.verts.new(base - side), bm.verts.new(base + side)))
        faces = []
        for k in range(len(rows) - 1):
            a, b = rows[k], rows[k + 1]
            fc = bm.faces.new((a[0], a[1], b[1], b[0]))
            fc.normal_update()
            if fc.normal.dot(run[k][1]) < 0:
                fc.normal_flip()
            fc[p.keep] = 1
            faces.append(fc)
        p._paint(faces, (shade, shade, shade), slot)
        run.clear()

    for (a, b) in pts:
        o = Vector(a)
        d = Vector(b) - o
        hit = tree.ray_cast(o, d.normalized(), min(reach, d.length + 2.0))
        if hit[0] is None:
            flush()
            continue
        if run and (hit[0] - run[-1][0]).length > gap:
            flush()
        run.append((hit[0].copy(), hit[1].copy()))
    flush()


def ice_sheet(p, tree, path, across, width, rows_col, tips, deep, body, pale, mat, thick=0.5, seed=0.0):
    """A frozen fall as ONE flowing sheet: `path(t, s)` gives the surface point the sheet
    follows at `t` (0 the brow, 1 the lip's foot) and `s` (-1 to 1 across it); the sheet
    lies on it, swollen in long ribs of flow, and past t = 1 hangs in icicles of every
    length (`tips(s)` yards). Its colour runs deep in the folds, pale along the ribs."""
    bm = p.bm
    cols, rows = rows_col
    grid = []
    for j in range(cols + 1):
        s = -1.0 + 2.0 * j / cols
        col = []
        rib = math.sin(j * 1.9 + seed) * 0.5 + 0.5
        edge = 1.0 - s * s
        for k in range(rows + 1):
            t = k / rows
            q, n = path(t, s)
            bulge = thick * (0.25 + 0.75 * edge) * (0.5 + 0.5 * rib) * (0.75 + 0.25 * math.sin(t * 7.0 + seed + j))
            col.append((q + n * bulge, n, rib, t))
        # The icicle below the lip.
        last_q, last_n, _, _ = col[-1]
        L = tips(s)
        for k in range(1, 4):
            f = k / 3.0
            pinch = 1.0 - f * f
            col.append((last_q + Vector((0.0, 0.0, -L * f)) + last_n * 0.12 * pinch * (1.0 - f), last_n, rib, 1.0 + f))
        grid.append(col)
    verts = [[bm.verts.new(c[0]) for c in col] for col in grid]
    faces = []
    tone = {}
    for j, col in enumerate(grid):
        for k, c in enumerate(col):
            tone[verts[j][k]] = (c[2], c[3])
    for j in range(cols):
        for k in range(len(grid[j]) - 1):
            # Each icicle comes to its own point between two columns.
            pick = (verts[j][k], verts[j + 1][k], verts[j + 1][k + 1], verts[j][k + 1])
            try:
                fc = bm.faces.new(pick)
            except ValueError:
                continue
            fc.smooth = True
            faces.append(fc)
    p._paint(faces, body, mat)
    for fc in faces:
        fc.normal_update()
        v0 = fc.verts[0]
        want = grid[0][0][1]
        for j, row in enumerate(verts):
            if v0 in row:
                want = grid[j][row.index(v0)][1]
                break
        if fc.normal.dot(want) < 0:
            fc.normal_flip()
        fc[p.keep] = 1
    for fc in faces:
        for loop in fc.loops:
            rib, t = tone[loop.vert]
            col = mix(deep, body, 0.25 + 0.75 * rib)
            col = mix(col, pale, sstep(0.55, 1.0, rib) * (0.55 + 0.45 * math.sin(t * 5.0 + rib * 9.0)))
            # Its head: still half snow where it seeps out.
            col = mix(col, pale, max(0.0, 1.0 - t / 0.16))
            if t > 1.0:
                col = mix(col, pale, (t - 1.0) * 0.8)
            loop[p.col] = (*col, 1.0)
    return faces


def crystal_grade(p, faces, base, direction, h, lo=0.22, hi=1.0, facet=0.28):
    """A crystal painted from inside: dark and deep where it leaves the rock, climbing
    to its pale tip, each facet its own value on top (the tinted glow slot reads the grey
    as the light inside)."""
    b = Vector(base)
    d = Vector(direction).normalized()
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(Vector((0.35, -0.55, 0.76)).normalized())
        for loop in fc.loops:
            t = max(0.0, min(1.0, (loop.vert.co - b).dot(d) / max(1e-3, h)))
            g = lo + (hi - lo) * t * t * (3 - 2 * t) * (1.0 - facet) + facet * k
            g = min(1.0, g)
            loop[p.col] = (g, g, g, 1.0)
