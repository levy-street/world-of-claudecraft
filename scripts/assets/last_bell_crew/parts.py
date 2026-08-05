"""Bespoke geometry for The Last Bell's cast, built onto the KayKit rigs.

THE RULE, learned the hard way: when adding something to an existing body, DERIVE IT
FROM THE HOST'S OWN GEOMETRY. Do not build a shape from numbers and fit it over the
model. `grow_patch` is the primitive for that: it copies the host's own faces and
swells them along their normals, tapering to zero at the patch rim, so the addition
matches the surface BY CONSTRUCTION and its edges stay welded flush.

Ewald's beard was attempted twice the wrong way, first as a revolved profile and then
as a lofted ray-cast shell, and both were rejected as reading like a dark panel taped
to his cheek. The failure is structural, not parametric: a shell is unrelated to the
surface it sits on, so it lands as a slab with a hard rim however it is tuned. The
second attempt even hugged the surface with ray casts and still failed, because
hugging a surface with a separate object is not the same as being that surface. If a
result reads as a slab and small parameter changes do not improve it, change the
method rather than the numbers.

Exploratory work belongs in the LIVE Blender session through the MCP, editing the real
mesh with real modelling operations and rendering between steps; the settled operation
is then baked back into this module so the pipeline stays re-runnable. Always re-render
the HEADLESS output afterwards to confirm it matches what the session showed: the two
diverged once, over a subdivide flag added on the way into the script.

The revolve-and-loft helpers below (`hug_profile`, `hug_band`, `comb_crest`,
`souwester`, `lames`) are still the right tool for HARD props that are genuinely
separate objects and read as manufactured: a bronze circlet, a helm crest, an oilskin
hat, a stack of pauldron lames. They are the wrong tool for anything organic or
anything that should look continuous with the body.

Every builder here returns a mesh object that is:

  * authored in BIND space (the rigs import with an identity world matrix, so bind
    space and world space are the same thing),
  * rigidly skinned to ONE bone (a hard prop on a stylized character does not want
    spread weights), and
  * UV'd into a single cell of the character's palette atlas, so the part joins the
    body's one material and the character still costs one draw.

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
def mesh_from(name, verts, faces, cell, shade_t=0.35, material=None, smooth=False):
    """Build a mesh whose every loop samples one point of one palette cell.

    `smooth` shades the result smooth, which ORGANIC additions want (a beard built
    from stacked rows reads as horizontal ribbing when flat-shaded) while hard props
    such as a crest, a name-plate or a buckle want the default faceted look that
    matches the KayKit kit.
    """
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
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


def cell_verts(host, cells, slots=None):
    """Indices of a host's vertices that sample any of `cells`."""
    if isinstance(cells, str):
        cells = (cells,)
    table = slots or atlas.active_slots()
    want = {(int(a[1]), int(a[3])) for a in (table.get(c, c) for c in cells)}
    uvl = host.data.uv_layers.active.data
    found = set()
    for poly in host.data.polygons:
        for li in poly.loop_indices:
            u, v = uvl[li].uv
            if (int((1.0 - v) * atlas.ROWS), int(u * atlas.COLS)) in want:
                found.update(poly.vertices)
                break
    return found


def outside_shell(host, verts, shell, z_floor, margin=0.004):
    """Which of `verts` poke OUT of `shell` above `z_floor`.

    RAY CAST, not binning. The first version of this binned the shell's vertices
    into (angle, height) cells and compared radii, which is wrong for a shell built
    from a handful of discrete rings: a sou'wester has geometry at five heights
    only, so four of eight height bands came back empty, reported radius zero, and
    flagged every vertex in the gaps. It condemned the model for a defect in the
    measurement.

    The honest test asks the geometry directly. For each vertex, cast a ray from the
    host's centre axis outward through the vertex; if the shell is hit BEYOND the
    vertex, the shell encloses it. Returns (above_top, outside_side).
    """
    pts = [shell.matrix_world @ v.co for v in shell.data.vertices]
    z_hi = max(p.z for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    to_local = shell.matrix_world.inverted()

    above, outside = [], []
    for idx in verts:
        p = host.matrix_world @ host.data.vertices[idx].co
        if p.z <= z_floor:
            continue
        if p.z > z_hi + margin:
            above.append(idx)
            continue
        axis = Vector((cx, cy, p.z))
        out = Vector((p.x, p.y, p.z)) - axis
        reach = out.length
        if reach < 1e-5:
            continue
        direction = out / reach
        hit, loc, _n, _i = shell.ray_cast(to_local @ axis, to_local.to_3x3() @ direction)
        if not hit or ((shell.matrix_world @ loc) - axis).length < reach - margin:
            outside.append(idx)
    return above, outside


def tuck_under_hat(host, cells, z_floor, shrink=0.80, ease=0.55, drop=0.02,
                   z_ceiling=None, base=1.0, slots=None):
    """Pull a host's HAIR vertices in under a hat, in place.

    Surgical on purpose. The alternative fix, re-UV'ing the hair to the hat's
    colour, hides the poke-through by recolouring it: the geometry still breaks
    the hat's silhouette, it just stops being a different colour. This moves the
    offending vertices instead, so the hat's outline is the hat's outline.

    Only vertices ABOVE `z_floor` (the brim line) and only those whose UVs sit in
    one of `cells` are touched, so anything below the brim, at the ears and the
    nape, is left exactly as authored. Pass the SKIN cell as well as the hair:
    above the brow the scalp and ear tops belong under the hat too, and four skin
    vertices at the ear tops were the last thing breaking the crown wall. The shrink ramps in with height (`ease`), because a
    hat narrows toward the crown and so must the tuck; `drop` settles the crown
    hair a little as it comes in, which keeps it from tenting the hat's top.

    Returns the number of vertices moved, so a build can assert it did something.
    """
    mesh = host.data
    hair = cell_verts(host, cells, slots)
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
        # `base` is the shrink AT the brim and `shrink` the shrink at the crown.
        # Starting from 1.0 leaves the hair just above the brim untouched, which is
        # precisely where the crown wall is tightest, so that band poked through.
        factor = base - (base - shrink) * t
        world.x = cx + (world.x - cx) * factor
        world.y = cy + (world.y - cy) * factor
        world.z -= drop * t
        # A relative drop is not a guarantee. `z_ceiling` is: nothing hairy ends up
        # above it, which is how the skull stops bursting through the crown.
        if z_ceiling is not None and world.z > z_ceiling:
            world.z = z_ceiling
        mesh.vertices[idx].co = inv @ world
        moved += 1
    return moved


def grow_patch(name, host, keep, cell, pad=0.05, shade_t=0.4, material=None,
               subdivide=0, ramp=0.85, smooth=True, exclude_cells=(), slots=None):
    """Grow a mass OUT OF the host's own surface: hair, a beard, a swollen callus.

    This is the primitive that finally made Ewald's beard match his face, after two
    attempts that built a shell from numbers. Those failed for a structural reason,
    not a bad parameter: a revolved or lofted shell is unrelated to the geometry it
    sits on, so it lands as a slab with a hard rim, no matter how it is tuned.

    Here the mass IS the face. The host's own faces are selected by `keep(centre,
    normal)`, copied, and displaced along their normals, with the displacement
    TAPERED TO ZERO at the patch boundary (measured in edge hops inward). So the
    edges stay welded flush to the head and only the interior swells, which is what
    removes the panel edge. No inner shell is needed either: the head itself is the
    back face.

    `exclude_cells` drops faces that already sample a given palette cell. Growing a
    beard off a jaw that already carries a moustache swells the moustache too, along
    its own wild normals, and the result crumples; excluding the hair cell grows the
    mass from the SKIN and leaves the shipped facial hair sitting proud on top.

    `subdivide` refines the patch first, but defaults OFF: subdividing a triangle
    patch and then displacing along per-vertex normals makes the surface lumpy, which
    is worse than the coarse taper it was meant to fix.
    """
    src = bmesh.new()
    src.from_mesh(host.data)
    src.faces.ensure_lookup_table()
    mw = host.matrix_world

    skip = set()
    if exclude_cells:
        table = slots or atlas.active_slots()
        addrs = {(int(a[1]), int(a[3])) for a in (table.get(c, c) for c in exclude_cells)}
        uv_layer = src.loops.layers.uv.active
        if uv_layer is not None:
            for f in src.faces:
                for loop in f.loops:
                    u, v = loop[uv_layer].uv
                    if (int((1.0 - v) * atlas.ROWS), int(u * atlas.COLS)) in addrs:
                        skip.add(f.index)
                        break

    chosen = [f for f in src.faces
              if f.index not in skip and keep(mw @ f.calc_center_median(), f.normal)]
    if not chosen:
        src.free()
        raise ValueError(f"{name}: no host faces matched the patch predicate")

    bm = bmesh.new()
    vmap = {}
    for f in chosen:
        verts = []
        for v in f.verts:
            if v not in vmap:
                vmap[v] = bm.verts.new(v.co)
            verts.append(vmap[v])
        try:
            bm.faces.new(verts)
        except ValueError:
            pass                      # duplicate face, already added
    src.free()
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    if subdivide > 0:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=subdivide,
                                  use_grid_fill=True)
        bm.verts.ensure_lookup_table()
    bm.normal_update()

    # hops inward from the open boundary: 0 on the rim, rising toward the middle
    boundary = {v for e in bm.edges if len(e.link_faces) < 2 for v in e.verts}
    hops = {v: 0 for v in boundary}
    frontier = list(boundary)
    while frontier:
        nxt = []
        for v in frontier:
            for e in v.link_edges:
                other = e.other_vert(v)
                if other not in hops:
                    hops[other] = hops[v] + 1
                    nxt.append(other)
        frontier = nxt
    deepest = max(hops.values()) if hops else 1

    for v in bm.verts:
        t = hops.get(v, 0) / max(deepest, 1)
        v.co += v.normal * (pad * math.sin(min(1.0, t) * math.pi * 0.5) ** ramp)

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    uv = me.uv_layers.new(name="UVMap")
    u, v_ = cell_uv(cell, shade_t)
    for loop in me.loops:
        uv.data[loop.index].uv = (u, v_)
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    if material is not None:
        ob.data.materials.append(material)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def souwester(name, host, cell, shade_t=0.30, material=None, sides=20,
              crown_z=2.16, brim_z=1.92, pad=0.055, brim=0.30, tail=0.55,
              flat=0.55):
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

    ring_inner, ring_outer, ring_crown, ring_top, ring_flat = [], [], [], [], []
    for si, (ang, r) in enumerate(prof_brim):
        c, s = math.cos(ang), math.sin(ang)
        ring_inner.append((cu + c * r, cv + s * r, brim_z + 0.03))
        reach = r * (1.0 + brim_reach(ang))
        ring_outer.append((cu + c * reach, cv + s * reach, brim_z - 0.085))
    for si, (ang, r) in enumerate(prof_crown):
        c, s = math.cos(ang), math.sin(ang)
        ring_crown.append((cu + c * r, cv + s * r, brim_z + 0.05))
        ring_top.append((cu + c * r * 0.90, cv + s * r * 0.90, crown_z - 0.045))
        # A flat top ring, not a single apex: a fan straight to a point builds a
        # CONE, which is what made the crown read as having no top at all.
        ring_flat.append((cu + c * r * flat, cv + s * r * flat, crown_z))

    for ring in (ring_inner, ring_outer, ring_crown, ring_top, ring_flat):
        verts.extend(ring)
    n = sides
    I, O, C, T, F = 0, n, 2 * n, 3 * n, 4 * n
    for si in range(n):
        j = (si + 1) % n
        faces.append((I + si, I + j, O + j, O + si))      # brim, upper face
        faces.append((O + si, O + j, C + j, C + si))      # brim, under face
        faces.append((C + si, C + j, T + j, T + si))      # crown wall
        faces.append((T + si, T + j, F + j, F + si))      # crown shoulder
    cap = len(verts)
    verts.append((cu, cv, crown_z + 0.012))
    for si in range(n):
        faces.append((cap, F + (si + 1) % n, F + si))     # the top itself
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
    return mount(prop, rig, bone, rot=rot, offset=offset, scale=scale, grip_at=grip_at)


def mount(prop, rig, bone, rot=(90, 0, 0), offset=(0, 0, 0), scale=1.0,
          grip_at="head"):
    """Seat an already-built prop on a hand slot and rigid-bind it.

    Split out of `held` so a BESPOKE weapon (built in-scene, sharing the figure's
    palette atlas) mounts through exactly the same math as an imported one, and the
    plates cannot show a different grip from the shipping model.
    """
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


def bvh_of(obj):
    """A BVH over an object's CURRENT bind geometry, for clearance queries."""
    from mathutils.bvhtree import BVHTree
    me = obj.data
    verts = [obj.matrix_world @ v.co for v in me.vertices]
    faces = []
    for p in me.polygons:
        vs = list(p.vertices)
        for i in range(1, len(vs) - 1):
            faces.append((vs[0], vs[i], vs[i + 1]))
    return BVHTree.FromPolygons(verts, faces)


def clear_of_host(obj, host, clear=0.026, above=None, iters=2):
    """Push a shell's vertices off the surface it rides, measured on the real host.

    Nearest-surface only: catches a shell sunk into the body. Pair it with
    `radial_clear`, which catches the other failure, a spike passing BETWEEN two
    vertices and piercing the face between them.
    """
    bvh = bvh_of(host)
    me = obj.data
    moved = 0
    inv = obj.matrix_world.inverted()
    for _ in range(iters):
        for v in me.vertices:
            p = obj.matrix_world @ v.co
            if above is not None and p.z < above:
                continue
            loc, nor, idx, dist = bvh.find_nearest(p)
            if loc is None:
                continue
            d = p - loc
            inside = d.dot(nor) < 0.0
            if (-d.length if inside else d.length) < clear:
                push = nor if (inside or d.length < 1e-6) else d.normalized()
                v.co = inv @ (loc + push * clear)
                moved += 1
    me.update()
    return moved


def radial_clear(obj, host, centre, clear=0.03, above=None):
    """Ride a dome out along rays from a centre until it clears the host.

    Cast from the skull centre THROUGH each dome vertex, so the host is measured
    along the same ray the dome sits on. That is the direction a poke-through
    actually happens in, and it is what nearest-surface alone keeps missing: the
    kettle hat still had a lock of hair through its crown after two nearest passes.
    """
    bvh = bvh_of(host)
    c = Vector(centre)
    me = obj.data
    inv = obj.matrix_world.inverted()
    moved = 0
    for v in me.vertices:
        p = obj.matrix_world @ v.co
        if above is not None and p.z < above:
            continue
        u = p - c
        if u.length < 1e-6:
            continue
        u.normalize()
        hit, nor, idx, dist = bvh.ray_cast(c, u, 4.0)
        if hit is None:
            continue
        if (p - c).length < dist + clear:
            v.co = inv @ (c + u * (dist + clear))
            moved += 1
    me.update()
    return moved


def pokes_through(shell, host, above):
    """Host vertices sitting OUTSIDE the shell meant to cover them. Zero, or fix it."""
    bvh = bvh_of(shell)
    out = 0
    for v in host.data.vertices:
        p = host.matrix_world @ v.co
        if p.z < above:
            continue
        loc, nor, idx, dist = bvh.find_nearest(p)
        if loc is not None and (p - loc).dot(nor) > 0.0:
            out += 1
    return out


def _boundary_loops(bm, only=None):
    """Every boundary edge loop, as vertex lists ordered AROUND the loop.

    Ordering is the whole point. A brim ring is an extruded boundary, and the two
    things living on that boundary have to be told apart: the cut's per-face jitter
    is high frequency along the loop, and the hat's real ovality is low frequency.
    Nothing can separate them without walking the loop in order.
    """
    adj = {}
    for e in bm.edges:
        if not e.is_boundary:
            continue
        a, b = e.verts
        if only is not None and (a not in only or b not in only):
            continue
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    loops, closed = [], set()
    for start in adj:
        if start in closed:
            continue
        loop, cur, prev = [], start, None
        while cur is not None and cur not in closed:
            closed.add(cur)
            loop.append(cur)
            nxt = next((n for n in adj[cur] if n is not prev and n not in closed), None)
            prev, cur = cur, nxt
        if len(loop) >= 6:
            loops.append(loop)
    return loops


def _relax_ring(loop, centre, amount, window=2, passes=2):
    """Angular low-pass one boundary loop's radius and height, in place.

    Why the brim came out zigzagged: the cut that makes it is a face-CENTRE test,
    so the rim it leaves steps by up to a whole face in BOTH radius and z, and then
    every ring is extruded off that rim. A radial push moves each vertex along its
    OWN direction, so the sawtooth is not merely inherited, it is amplified, and a
    uniform `dz` per ring preserves the height stagger exactly.

    Averaging r and z ALONG the loop removes the per-face jitter and keeps the hat's
    genuine low-frequency shape, which is why this is a filter and not a circle fit:
    the dome is offset and slightly oval, and snapping it to a circle would trade a
    sawtooth for a tin lid.
    """
    if amount <= 0.0 or len(loop) < 6:
        return
    cx, cy = centre
    n = len(loop)
    flat = [Vector((v.co.x - cx, v.co.y - cy, 0.0)) for v in loop]
    rs = [f.length for f in flat]
    zs = [v.co.z for v in loop]
    span = range(-window, window + 1)
    for _ in range(max(1, passes)):
        rs = [sum(rs[(i + k) % n] for k in span) / (2 * window + 1) for i in range(n)]
        zs = [sum(zs[(i + k) % n] for k in span) / (2 * window + 1) for i in range(n)]
    for v, f, r, z in zip(loop, flat, rs, zs):
        u = f.normalized() if f.length > 1e-6 else Vector((0.0, 1.0, 0.0))
        v.co.x += (cx + u.x * r - v.co.x) * amount
        v.co.y += (cy + u.y * r - v.co.y) * amount
        v.co.z += (z - v.co.z) * amount


def kettle_hat(helmet, z_cut=1.885, centre=(0.0, -0.025),
               rings=((0.100, -0.034), (0.024, -0.046), (-0.118, -0.014)),
               smooth_z=2.02, smooth_iters=2, smooth_a=0.5, uv=None,
               rim_relax=0.85, ring_relax=(0.92, 1.0, 1.0),
               relax_window=2, relax_passes=2):
    """Cut a KayKit bascinet down into a militia kettle hat, IN PLACE.

    Real surgery on the helmet's own mesh, not a hat fitted over it: the cheek and
    neck wrap is deleted, and the brim is extruded straight off the cut rim in three
    rings (top face, outer wall, underside) so it is the helmet's own edge carried
    outward, with genuine thickness. The four fore-and-aft crown ribs are relaxed
    away by a local Laplacian pass; they were the "spiked coronet" the review kept
    flagging, and re-UV'ing them only ever changed their colour, never their
    silhouette.

    The rim is RELAXED before anything is extruded off it, and each ring again after
    (`_relax_ring`). Without that the brim reads as a sawtooth: the cut is a
    face-centre test, so the rim it leaves is ragged in radius and in height, and the
    rings carry that jitter outward into the one edge of the hat that actually holds
    the silhouette. Relaxing at the source and letting the correction go to full
    strength by the outer ring keeps the brim welded to the helmet's own edge while
    the outline it presents to camera is clean.

    Why a kettle hat at all: a closed knight's helm over a padded cloth jack is a
    kit that contradicts itself, and it read as the brightest, coldest, largest mass
    on a figure whose whole point is that his gear is cheap. The chapel-de-fer is the
    town-watch helmet, it agrees with the jack, and it leaves his face readable,
    which the campaign needs because he is the one who tells you what his line
    cannot kill.

    The piece rides ONE bone (`head`) and samples ONE atlas cell, so extruded loops
    only need that cell's UV and a weight of 1 to be indistinguishable from the rest.
    """
    me = helmet.data
    gi = helmet.vertex_groups["head"].index
    if uv is None:
        uv = me.uv_layers.active.data[0].uv.copy()
    if "custom_normal" in me.attributes:
        me.attributes.remove(me.attributes["custom_normal"])

    cx, cy = centre
    bm = bmesh.new()
    bm.from_mesh(me)
    # the glTF import splits vertices at every normal seam, so the shell arrives as
    # 50-odd loose shards; weld first or nothing has a boundary to extrude from
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
    bmesh.ops.delete(
        bm, geom=[f for f in bm.faces if f.calc_center_median().z < z_cut],
        context="FACES")
    bm.verts.ensure_lookup_table()

    uvl = bm.loops.layers.uv.active
    dfm = bm.verts.layers.deform.active or bm.verts.layers.deform.new()

    # FIRST, relax the cut rim itself. Every ring below is extruded from this loop,
    # so a jag fixed here never reaches the silhouette at all, and fixing it here
    # costs nothing: these vertices are shared with the dome faces above, and an
    # angular filter slides them along their own rim without unwelding anything.
    for loop in _boundary_loops(bm):
        _relax_ring(loop, (cx, cy), rim_relax, relax_window, relax_passes)

    fresh = []
    edges = [e for e in bm.edges if e.is_boundary]
    for ri, (dr, dz) in enumerate(rings):
        ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
        vs = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
        seen = set(vs)
        for v in vs:
            flat = Vector((v.co.x - cx, v.co.y - cy, 0.0))
            u = flat.normalized() if flat.length > 1e-6 else Vector((0, 1, 0))
            v.co.x += u.x * dr
            v.co.y += u.y * dr
            v.co.z += dz
            v[dfm][gi] = 1.0
        # and again per ring, ramping to full by the outer ones: the radial push
        # above moves each vertex along its own direction, which re-introduces
        # angular jitter every time however clean the loop it started from was.
        amount = ring_relax[ri] if ri < len(ring_relax) else 1.0
        for loop in _boundary_loops(bm, only=seen):
            _relax_ring(loop, (cx, cy), amount, relax_window, relax_passes)
        fresh.extend(g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace))
        edges = [e for e in bm.edges
                 if e.is_boundary and e.verts[0] in seen and e.verts[1] in seen]
    for f in fresh:
        for loop in f.loops:
            loop[uvl].uv = uv

    crown = [v for v in bm.verts if v.co.z > smooth_z]
    for _ in range(smooth_iters):
        moves = {}
        for v in crown:
            nb = [e.other_vert(v) for e in v.link_edges]
            if nb:
                moves[v] = v.co.lerp(sum((n.co for n in nb), Vector()) / len(nb), smooth_a)
        for v, co in moves.items():
            v.co = co

    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    for p in me.polygons:
        p.use_smooth = False
    return helmet


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
