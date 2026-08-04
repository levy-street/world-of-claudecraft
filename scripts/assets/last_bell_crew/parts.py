"""Bespoke geometry for The Last Bell's cast, built onto the KayKit rigs.

Every builder here returns a mesh object that is:

  * authored in BIND space (the rigs import with an identity world matrix, so
    bind space and world space are the same thing and a part can be placed from
    measured numbers rather than by eye),
  * rigidly skinned to ONE bone (a hard prop on a stylized character does not
    want spread weights), and
  * UV'd into a single cell of the character's palette atlas, so the part joins
    the body's one material and the character still costs one draw.

`hug_profile` is why the parts sit ON the surface: it measures the host mesh's
radius per angle at the band's height, so a circlet follows the real skull
instead of floating off a guessed cylinder.

Deterministic: same inputs -> same GLB. No randomness, no time.
"""

import bmesh
import bpy
import math
from mathutils import Matrix, Vector

import atlas
from atlas import cell_uv

TAU = math.tau


# --------------------------------------------------------------------- helpers
def mesh_from(name, verts, faces, cell, shade_t=0.35, material=None):
    """Build a mesh whose every loop samples one point of one palette cell."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    uv = me.uv_layers.new(name="UVMap")
    u, v = cell_uv(cell, shade_t)
    for loop in me.loops:
        uv.data[loop.index].uv = (u, v)
    ob = bpy.data.objects.new(name, me)
    if material is not None:
        ob.data.materials.append(material)
    # scene.collection, not context.collection: the latter is None in --background
    # once the active collection has been wiped.
    bpy.context.scene.collection.objects.link(ob)
    return ob


def skin(ob, rig, bone):
    """Rigid-bind `ob` to one bone so it rides the shipped clips unchanged."""
    group = ob.vertex_groups.new(name=bone)
    group.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
    ob.parent = rig
    # Keep the world transform across parenting. Several creature rigs carry a
    # 100x scale on the armature OBJECT, and parenting without the inverse
    # multiplied every added part by it (the Tidemill Stalker's roof ended up a
    # hundred times the size of the island).
    ob.matrix_parent_inverse = rig.matrix_world.inverted()
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return ob


def hug_profile(host, sides, axis="z", coord=0.0, band=0.09, centre=None, pad=0.0):
    """Radius per angle of `host` at a slice, so a band can follow the surface.

    Returns a list of (angle, radius) with `sides` entries. Angles with no
    sampled geometry inherit the nearest measured radius, which keeps a ring
    closed over the sparse low-poly regions of a KayKit head.
    """
    ai = "xyz".index(axis)
    u_i, v_i = [i for i in range(3) if i != ai]
    pts = [host.matrix_world @ vert.co for vert in host.data.vertices]
    band_pts = [p for p in pts if abs(p[ai] - coord) <= band]
    if not band_pts:
        band_pts = pts
    if centre is None:
        cu = (min(p[u_i] for p in band_pts) + max(p[u_i] for p in band_pts)) / 2
        cv = (min(p[v_i] for p in band_pts) + max(p[v_i] for p in band_pts)) / 2
    else:
        cu, cv = centre
    buckets = [0.0] * sides
    for p in band_pts:
        du, dv = p[u_i] - cu, p[v_i] - cv
        r = math.hypot(du, dv)
        if r < 1e-6:
            continue
        idx = int((math.atan2(dv, du) % TAU) / TAU * sides) % sides
        buckets[idx] = max(buckets[idx], r)
    known = [i for i, r in enumerate(buckets) if r > 0]
    if not known:
        raise ValueError(f"no profile for {host.name} at {axis}={coord}")
    for i in range(sides):
        if buckets[i] <= 0:
            j = min(known, key=lambda k: min(abs(k - i), sides - abs(k - i)))
            buckets[i] = buckets[j]
    return [(TAU * i / sides, buckets[i] + pad) for i in range(sides)], (cu, cv)


def _to3(axis, coord, u, v):
    return {"x": (coord, u, v), "y": (u, coord, v), "z": (u, v, coord)}[axis]


def hug_band(name, host, z0, z1, cell, sides=20, pad=0.012, shade_t=0.3,
             material=None, taper=1.0, axis="z"):
    """A closed band that follows the host surface between two heights."""
    prof_lo, centre = hug_profile(host, sides, axis=axis, coord=z0, pad=pad)
    prof_hi, _ = hug_profile(host, sides, axis=axis, coord=z1, pad=pad, centre=centre)
    cu, cv = centre
    verts, faces = [], []
    for prof, coord, scale in ((prof_lo, z0, 1.0), (prof_hi, z1, taper)):
        for ang, r in prof:
            verts.append(_to3(axis, coord, cu + math.cos(ang) * r * scale,
                              cv + math.sin(ang) * r * scale))
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    # cap the rim so the band reads as a solid casting from any angle
    inner = len(verts)
    for prof, coord, scale in ((prof_lo, z0, 1.0), (prof_hi, z1, taper)):
        for ang, r in prof:
            rr = max(r - 0.035, r * 0.72)
            verts.append(_to3(axis, coord, cu + math.cos(ang) * rr * scale,
                              cv + math.sin(ang) * rr * scale))
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((inner + j, inner + i, inner + sides + i, inner + sides + j))
        faces.append((i, inner + i, inner + j, j))                     # bottom rim
        faces.append((sides + j, inner + sides + j, inner + sides + i, sides + i))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def surface_top(host, y, x_tol=0.11, y_tol=0.07):
    """Highest point of `host` near a fore-aft station, for seating a crest."""
    best = None
    for vert in host.data.vertices:
        p = host.matrix_world @ vert.co
        if abs(p.x) <= x_tol and abs(p.y - y) <= y_tol:
            best = p.z if best is None else max(best, p.z)
    return best


def surface_front(host, z, x=0.0, x_tol=0.13, z_tol=0.07):
    """The frontmost (most -Y) point of `host` at a height, so a strap or apron
    can be laid on the real torso instead of a guessed one.

    The rigs differ across the chest (a robe is not a cuirass), so straps derive
    their depth from this rather than carrying per-rig magic numbers.
    """
    best = None
    for vert in host.data.vertices:
        p = host.matrix_world @ vert.co
        if abs(p.x - x) <= x_tol and abs(p.z - z) <= z_tol:
            best = p.y if best is None else min(best, p.y)
    return best


def sash_path(host, from_x, to_x, z_hi=1.232, z_lo=0.632, steps=6, lift=0.006):
    """A shoulder-to-hip path laid on a torso's real front surface.

    Runs from the `from_x` shoulder down across the chest to the `to_x` hip, with
    each station's depth measured off the body so the strap never floats or sinks.
    """
    pts = []
    for i in range(steps):
        t = i / (steps - 1)
        z = z_hi + (z_lo - z_hi) * t
        x = from_x + (to_x - from_x) * (t ** 0.86)
        # the ends sit on the shoulder top and the hip, where the body turns away
        edge = min(t, 1.0 - t) / 0.5
        y_front = surface_front(host, z, x=x)
        if y_front is None:
            y_front = surface_front(host, z) or -0.30
        pts.append((x, y_front - lift - 0.030 * min(edge, 1.0), z))
    return pts


def dome_seat(host, half, x_tol=0.075):
    """A SMOOTH parabolic stand-in for the host's crown, for seating a crest.

    Sampling the surface per station and using it directly follows every facet
    of a low-poly helm, and the crest then dives in and out of the dome in
    fragments. Fitting one parabola through the crown and the two ends gives a
    base that reads as a single casting sitting on the skull.

    Returns (seat_fn, crown_z).
    """
    pts = [host.matrix_world @ v.co for v in host.data.vertices if abs((host.matrix_world @ v.co).x) <= x_tol]
    if not pts:
        raise ValueError(f"no crown samples for {host.name}")
    crown = max(pts, key=lambda p: p.z)
    y_c, z_c = crown.y, crown.z
    edges = []
    for sign in (-1, 1):
        z_edge = surface_top(host, y_c + sign * half * 0.9, x_tol=x_tol, y_tol=0.09)
        if z_edge is not None:
            edges.append(z_edge)
    drop = max(z_c - (sum(edges) / len(edges)), 0.02) if edges else half * 0.35

    def seat(y):
        t = (y - y_c) / max(half, 1e-6)
        return z_c - drop * min(t * t, 1.0)

    return seat, z_c


def comb_crest(name, cell, centre, length, rise, thick, sink, cell_shade=0.28,
               material=None, steps=11, skew=0.18, host=None):
    """The warden's crest: a fore-and-aft cast comb over the skull.

    Deliberately the same silhouette as the crest on Warden Hale's memorial
    figure (`scripts/assets/warden_hale_statue/model.py`): every warden on this
    island grew up beneath that bronze, and the living watch wears its motif.
    A sampled sine arc, so it reads as one casting rather than a shard, with the
    crown pushed slightly aft of centre.
    """
    cx, cy, cz = centre
    half = length * 0.5
    seat_fn = None
    if host is not None:
        seat_fn, _ = dome_seat(host, half)
    prof = []
    for i in range(steps):
        t = i / (steps - 1)
        y = -half + 2 * half * t
        arc = math.sin(t * math.pi) ** 0.75
        seat = cz if seat_fn is None else seat_fn(cy + y)
        # skew pushes the crown slightly AFT, the way a cast crest is weighted
        prof.append((y, seat, rise * arc * (1.0 + skew * (t - 0.5))))
    verts, faces = [], []
    for y, seat, dz in prof:
        verts.append((cx - thick, cy + y, seat + dz))
        verts.append((cx + thick, cy + y, seat + dz))
    base0 = len(verts)
    for y, seat, _ in prof:
        verts.append((cx - thick, cy + y, seat - sink))
        verts.append((cx + thick, cy + y, seat - sink))
    n = len(prof)
    for i in range(n - 1):
        a, b = 2 * i, 2 * i + 1
        c, d = 2 * (i + 1), 2 * (i + 1) + 1
        faces.append((a, c, d, b))                                  # crest top
        e, f = base0 + 2 * i, base0 + 2 * i + 1
        g, h = base0 + 2 * (i + 1), base0 + 2 * (i + 1) + 1
        faces.append((f, h, g, e))                                  # underside
        # The flanks run ALONG the crest at constant x. Spanning them across the
        # crest instead walls off every station, which renders as comb teeth.
        faces.append((a, e, g, c))                                  # -x flank
        faces.append((b, d, h, f))                                  # +x flank
    faces.append((0, 1, base0 + 1, base0))
    faces.append((2 * (n - 1) + 1, 2 * (n - 1), base0 + 2 * (n - 1), base0 + 2 * (n - 1) + 1))
    return mesh_from(name, verts, faces, cell, cell_shade, material)


def hood(name, host, cell, shade_t=0.34, material=None, sides=18, rings=5,
         pad=0.055, z_lo=1.34, z_hi=2.30, open_front=0.30, drape=0.10):
    """A hood over a head, following the real skull.

    Built because the KayKit mage body wears long loose hair, which reads female
    at a glance; a hood keeps the scholar silhouette and settles the question
    without touching the shipped head mesh. The front is left OPEN by pulling the
    forward arc's radius in, so the face still carries the performance.
    """
    verts, faces = [], []
    centre = None
    for ri in range(rings + 1):
        t = ri / rings
        z = z_lo + (z_hi - z_lo) * t
        # A hood is WIDEST at the shoulders and CLOSES at the crown. Growing the
        # radius upward instead (the first attempt) builds an inverted funnel that
        # reads as a mortarboard, which is what it did.
        squash = 1.0 + drape * (1.0 - t) - 0.72 * (t ** 1.7)
        prof, centre = hug_profile(host, sides, axis="z", coord=z,
                                   pad=pad, centre=centre)
        cu, cv = centre
        for si, (ang, r) in enumerate(prof):
            # the face opening: -Y is forward on these rigs, so pull the forward
            # arc in over the middle band and leave the face clear
            facing = max(0.0, math.sin(ang + math.pi / 2) * -1.0)
            window = max(0.0, 1.0 - abs(t - 0.42) * 2.4)
            rr = max(r * squash * (1.0 - open_front * facing * window), 0.02)
            verts.append((cu + math.cos(ang) * rr, cv + math.sin(ang) * rr, z))
    for ri in range(rings):
        for si in range(sides):
            a0 = ri * sides + si
            a1 = ri * sides + (si + 1) % sides
            faces.append((a0, a1, a1 + sides, a0 + sides))
    # close the crown, or the hood reads as an open tube from above
    cap = len(verts)
    verts.append((centre[0], centre[1], z_hi + 0.02))
    top = rings * sides
    for si in range(sides):
        faces.append((cap, top + (si + 1) % sides, top + si))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def tuck_under_hat(host, cell, z_floor, shrink=0.80, ease=0.55, drop=0.02,
                   slots=None):
    """Pull a host's HAIR vertices in under a hat, in place.

    Surgical on purpose. The alternative fix, re-UV'ing the hair to the hat's
    colour, hides the poke-through by recolouring it: the geometry still breaks
    the hat's silhouette, it just stops being a different colour. This moves the
    offending vertices instead, so the hat's outline is the hat's outline.

    Only vertices ABOVE `z_floor` (the brim line) and only those whose UVs sit in
    `cell` are touched, so the hair below the brim, at the ears and the nape, is
    left exactly as authored. The shrink ramps in with height (`ease`), because a
    hat narrows toward the crown and so must the tuck; `drop` settles the crown
    hair a little as it comes in, which keeps it from tenting the hat's top.

    Returns the number of vertices moved, so a build can assert it did something.
    """
    mesh = host.data
    addr = (slots or atlas.active_slots()).get(cell, cell)
    row, col = int(addr[1]), int(addr[3])
    uvl = mesh.uv_layers.active.data

    # Which vertices belong to the hair? A vertex is hair if any loop on it
    # samples the hair cell.
    hair = set()
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            u, v = uvl[li].uv
            if int(u * atlas.COLS) == col and int((1.0 - v) * atlas.ROWS) == row:
                hair.update(poly.vertices)
                break

    pts = [host.matrix_world @ vert.co for vert in mesh.vertices]
    top = max(p.z for p in pts)
    if top <= z_floor:
        return 0
    inv = host.matrix_world.inverted()
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2

    moved = 0
    for idx in hair:
        world = host.matrix_world @ mesh.vertices[idx].co
        if world.z <= z_floor:
            continue
        # 0 at the brim, 1 at the crown, eased so the tuck comes in gently
        t = min(1.0, (world.z - z_floor) / max(top - z_floor, 1e-6)) ** ease
        factor = 1.0 - (1.0 - shrink) * t
        world.x = cx + (world.x - cx) * factor
        world.y = cy + (world.y - cy) * factor
        world.z -= drop * t
        mesh.vertices[idx].co = inv @ world
        moved += 1
    return moved


def souwester(name, host, cell, shade_t=0.30, material=None, sides=20,
              crown_z=2.16, brim_z=1.92, pad=0.055, brim=0.30, tail=0.55):
    """A sailor's oilskin hat: low crown, brim turned down, longer at the back.

    The single most legible way to say SAILOR at gameplay distance. Sized off the
    real skull, and the back tail is what separates it from a farmer's hat.
    """
    verts, faces = [], []
    prof_brim, centre = hug_profile(host, sides, axis="z", coord=brim_z, pad=pad)
    cu, cv = centre
    prof_crown, _ = hug_profile(host, sides, axis="z", coord=crown_z, pad=pad * 0.7,
                                centre=centre)

    def brim_reach(ang):
        # +Y is behind the face on these rigs, so the tail grows toward +Y
        back = max(0.0, math.sin(ang - math.pi / 2) * -1.0)
        return brim + tail * brim * back

    ring_inner, ring_outer, ring_crown, ring_top = [], [], [], []
    for si, (ang, r) in enumerate(prof_brim):
        c, s = math.cos(ang), math.sin(ang)
        ring_inner.append((cu + c * r, cv + s * r, brim_z + 0.03))
        reach = r * (1.0 + brim_reach(ang))
        ring_outer.append((cu + c * reach, cv + s * reach, brim_z - 0.085))
    for si, (ang, r) in enumerate(prof_crown):
        c, s = math.cos(ang), math.sin(ang)
        ring_crown.append((cu + c * r, cv + s * r, brim_z + 0.05))
        ring_top.append((cu + c * r * 0.86, cv + s * r * 0.86, crown_z))

    for ring in (ring_inner, ring_outer, ring_crown, ring_top):
        verts.extend(ring)
    n = sides
    I, O, C, T = 0, n, 2 * n, 3 * n
    for si in range(n):
        j = (si + 1) % n
        faces.append((I + si, I + j, O + j, O + si))      # brim, upper face
        faces.append((O + si, O + j, C + j, C + si))      # brim, under face
        faces.append((C + si, C + j, T + j, T + si))      # crown wall
    cap = len(verts)
    verts.append((cu, cv, crown_z + 0.02))
    for si in range(n):
        faces.append((cap, T + (si + 1) % n, T + si))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def spines(name, host, cell, count=7, shade_t=0.22, material=None,
           length=0.26, base=0.055, along=(0.18, 0.82), lift=0.0):
    """A row of shards standing off a back: star-glass growing through a body.

    Placed on the host's measured dorsal crest, so it works on a quadruped or a
    carapace without per-creature numbers.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    ev = host.evaluated_get(dg)
    mesh = ev.to_mesh()
    pts = [ev.matrix_world @ v.co for v in mesh.vertices]
    ev.to_mesh_clear()
    y_lo, y_hi = min(p.y for p in pts), max(p.y for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    depth = y_hi - y_lo
    verts, faces = [], []
    for i in range(count):
        t = along[0] + (along[1] - along[0]) * (i / max(count - 1, 1))
        y = y_lo + depth * t
        band = [p for p in pts if abs(p.y - y) <= depth * 0.06 and abs(p.x - cx) <= depth * 0.10]
        z = (max(p.z for p in band) if band else max(p.z for p in pts)) + lift
        # taper from the tallest shard at the shoulders to the smallest at the tail
        scale = 1.0 - 0.45 * abs(t - along[0]) / max(along[1] - along[0], 1e-6)
        h = length * (0.55 + 0.45 * scale)
        b = base * (0.6 + 0.4 * scale)
        lean = -0.35 * h                      # raked back, never vertical
        k = len(verts)
        verts.extend([
            (cx - b, y - b, z), (cx + b, y - b, z),
            (cx + b, y + b, z), (cx - b, y + b, z),
            (cx, y + lean, z + h),
        ])
        faces.extend([(k, k + 1, k + 2, k + 3), (k, k + 4, k + 1),
                      (k + 1, k + 4, k + 2), (k + 2, k + 4, k + 3), (k + 3, k + 4, k)])
    return mesh_from(name, verts, faces, cell, shade_t, material)


def strap(name, path, width, thick, cell, shade_t=0.4, material=None, up=(0, 0, 1)):
    """A flat leather strap swept along a polyline, ribbon-oriented so it lies
    against the body rather than edge-on to the camera."""
    up = Vector(up)
    verts, faces = [], []
    pts = [Vector(p) for p in path]
    for i, p in enumerate(pts):
        fwd = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        if fwd.length < 1e-6:
            fwd = Vector((0, 0, 1))
        fwd.normalize()
        side = fwd.cross(up)
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        out = side.cross(fwd).normalized()
        for su, sv in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
            verts.append(p + side * (width / 2 * su) + out * (thick / 2 * sv))
    for i in range(len(pts) - 1):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(4):
            faces.append((a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k))
    faces.append((0, 3, 2, 1))
    last = 4 * (len(pts) - 1)
    faces.append((last, last + 1, last + 2, last + 3))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def tag_row(name, path, count, cell, width=0.052, drop=0.075, thick=0.012,
            shade_t=0.25, material=None, lengths=None, offset=(0, 0, 0),
            side_dir=(1, 0, 0), out_dir=(0, -1, 0), span=(0.06, 0.94)):
    """A row of small plates hanging off a strap: Coalfast's roll of names.

    The plates hang VERTICALLY on explicit axes rather than rotating with the
    strap: tags on a body follow gravity, and letting them tilt with a diagonal
    bandolier merged the row into one sawtooth ribbon.

    Lengths vary along the row from a fixed pattern (never a random draw), so the
    strap reads as tags added one at a time over a career rather than as a
    manufactured set. `span` insets the row so the end tags do not sit on the
    strap's buckles.
    """
    pts = [Vector(p) for p in path]
    lengths = lengths or (1.0, 0.74, 1.18, 0.88, 1.32, 0.8, 1.08)
    side = Vector(side_dir).normalized()
    out = Vector(out_dir).normalized()
    lift = Vector(offset)
    verts, faces = [], []
    lo, hi = span
    for i in range(count):
        t = lo + (hi - lo) * ((i + 0.5) / count)
        seg = t * (len(pts) - 1)
        k = min(int(seg), len(pts) - 2)
        p = pts[k].lerp(pts[k + 1], seg - k) + lift
        dz = drop * lengths[i % len(lengths)]
        base = len(verts)
        for sx, sz in ((-1, 0), (1, 0), (1, -1), (-1, -1)):
            for so in (-1, 1):
                verts.append(p + side * (width / 2 * sx)
                             + Vector((0, 0, dz * sz)) + out * (thick / 2 * so))
        # 8 verts as (corner, out) pairs, corners ordered top-l, top-r, bot-r, bot-l
        for quad in ((0, 2, 4, 6), (7, 5, 3, 1), (0, 1, 3, 2),
                     (2, 3, 5, 4), (4, 5, 7, 6), (6, 7, 1, 0)):
            faces.append(tuple(base + q for q in quad))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def lames(name, centre, axis_dir, count, radius, width, spread, cell,
          shade_t=0.3, material=None, sides=9, arc=0.5, grow=0.1, up=(0, 0, 1)):
    """Overlapping shoulder plates (a pauldron), arched over an arm axis.

    The sweep is CENTRED on `up` and runs front-over-back, so the plates cap the
    shoulder like real lames. Sweeping around the arm axis instead just makes
    concentric rings that read as a bracelet.
    """
    c = Vector(centre)
    d = Vector(axis_dir).normalized()
    # the up axis, made perpendicular to the arm so the arch stays square to it
    a1 = (Vector(up) - d * Vector(up).dot(d))
    a1 = a1.normalized() if a1.length > 1e-6 else Vector((0, 0, 1))
    a2 = d.cross(a1).normalized()
    verts, faces = [], []
    for li in range(count):
        r = radius * (1.0 + grow * li)
        offs = c + d * (spread * li)
        start = -arc * math.pi
        base = len(verts)
        for si in range(sides + 1):
            ang = start + (2 * arc * math.pi) * si / sides
            n = a1 * math.cos(ang) + a2 * math.sin(ang)
            verts.append(offs + n * r)
            verts.append(offs + d * width + n * (r * 0.94))
            verts.append(offs + n * (r * 0.84))
            verts.append(offs + d * width + n * (r * 0.80))
        for si in range(sides):
            q = base + si * 4
            n = q + 4
            faces.append((q, n, n + 1, q + 1))          # outer shell
            faces.append((q + 3, n + 3, n + 2, q + 2))  # inner shell
            faces.append((q, q + 2, n + 2, n))          # leading rim
            faces.append((q + 1, n + 1, n + 3, q + 3))  # trailing rim
        e = base + sides * 4
        faces.append((base, base + 1, base + 3, base + 2))
        faces.append((e + 2, e + 3, e + 1, e))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def plate(name, centre, normal, w, h, thick, cell, shade_t=0.3, material=None,
          bevel=0.0, up=(0, 0, 1)):
    """A flat quad plate standing off a surface: gorget, badge, buckle, sigil."""
    c = Vector(centre)
    n = Vector(normal).normalized()
    u = Vector(up)
    side = n.cross(u)
    side = side.normalized() if side.length > 1e-6 else Vector((1, 0, 0))
    top = side.cross(n).normalized()
    verts, faces = [], []
    for depth in (0.0, thick):
        s = 1.0 - bevel * (depth / max(thick, 1e-6))
        for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(c + n * depth + side * (w / 2 * su * s) + top * (h / 2 * sv * s))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return mesh_from(name, verts, faces, cell, shade_t, material)


def tube(name, a, b, r, cell, sides=10, shade_t=0.32, material=None, r2=None):
    """A capped cylinder: hafts, strikers, rungs, pins."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    length = d.length
    d = d / max(length, 1e-9)
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    a1 = d.cross(ref).normalized()
    a2 = d.cross(a1).normalized()
    r2 = r if r2 is None else r2
    verts, faces = [], []
    for end, rad in ((a, r), (b, r2)):
        for si in range(sides):
            ang = TAU * si / sides
            verts.append(end + (a1 * math.cos(ang) + a2 * math.sin(ang)) * rad)
    for si in range(sides):
        j = (si + 1) % sides
        faces.append((si, j, sides + j, sides + si))
    ca, cb = len(verts), len(verts) + 1
    verts.append(a)
    verts.append(b)
    for si in range(sides):
        j = (si + 1) % sides
        faces.append((ca, j, si))
        faces.append((cb, sides + si, sides + j))
    return mesh_from(name, verts, faces, cell, shade_t, material)


def held(name, glb, rig, bone, rot=(90, 0, 0), offset=(0, 0, 0), scale=1.0,
         grip_at="head"):
    """Import a weapon/tool GLB and rigid-bind it to a hand slot.

    Every KayKit weapon and tool runs its length along +Z with the grip at the
    origin, so the default `rot` maps +Z onto the hand slot's -Y (the direction
    the slot bone points) and the prop reads as held rather than skewered.

    Bound the same way as the bespoke parts (one vertex group, weight 1) instead
    of Blender bone-parenting: the prop then rides the shipped clips through the
    same armature modifier as everything else, with no parent-inverse bookkeeping.

    These are PRESENTATION props for the concept plates. The shipping GLBs leave
    hands empty and let `VisualDef.attach` mount the same models at runtime, so
    the game can still swap a defender's weapon.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    fresh = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in fresh if o.type == "MESH"]
    for o in fresh:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if not meshes:
        raise ValueError(f"no geometry in {glb}")
    prop = join(meshes, name) if len(meshes) > 1 else meshes[0]
    prop.name = name

    # Placed in the BONE's own rest frame, not in world space. A world-space
    # placement only looks right in the bind pose: the moment a clip rolls the
    # forearm, the prop rolls with it about the wrong axis, which is what laid
    # Coalfast's shield flat across his chest like a tray during Block. In bone
    # space one tuning holds across all 22 clips.
    bone_data = rig.data.bones[bone]
    frame = rig.matrix_world @ bone_data.matrix_local
    if grip_at != "head":
        frame = frame @ Matrix.Translation((0, bone_data.length, 0))
    basis = (frame
             @ Matrix.Translation(offset)
             @ Matrix.Rotation(math.radians(rot[2]), 4, "Z")
             @ Matrix.Rotation(math.radians(rot[1]), 4, "Y")
             @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
             @ Matrix.Diagonal((scale, scale, scale, 1.0)))
    # The importer already carries its own Y-up to Z-up rotation, so COMPOSE onto
    # the existing world matrix; assigning rotation_euler would throw that away
    # and lay the prop flat (the same trap the memorial exporter documents).
    prop.matrix_world = basis @ prop.matrix_world
    return skin(prop, rig, bone)


def join(objs, name):
    """Weld a character's bespoke parts into one object per material."""
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined
