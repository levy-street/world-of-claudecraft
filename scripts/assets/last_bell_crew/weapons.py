"""Bespoke held weapons for The Last Bell's cast.

A shipped KayKit weapon is a fine prop until a figure's palette argues with it.
Sergeant Marsh is the case that forced this module: his authored palette allows
exactly ONE bright accent (bell bronze), and `weapons/halberd.glb` carries
saturated star-glass crystal petals at both ends, which read as an enchanted
weapon on the one man whose entire characterisation is that his kit is cheap.

So he gets his own polearm, derived FROM that model rather than modelled fresh:
the petals are removed, the oversized crescent is drawn back toward the haft, and
the whole thing is re-UV'd onto his palette atlas. The shared `halberd.glb` is left
untouched, because players can equip it.

The blade shrink is not cosmetic. At 1.29 units wide on a 2.34 tall man, no rigid
single-bone grip could keep that crescent out of his own head: a sweep over grip
direction, grip point, scale and roll against real body penetration bottomed out at
a 41-degree shouldered tilt, and every upright carry drove the blade through his
skull. Narrowing the head is what made the authored "grounded and vertical at his
post" silhouette reachable at all.

Deterministic: same inputs -> same GLB. No randomness, no time.
"""

import bmesh
import bpy
import colorsys
import math
import os

from mathutils import Vector

import atlas

# The source model's own extent along its +Z, before any edit.
SRC_LO, SRC_HI = -0.9322, 1.8146

# Where the hand takes the haft, in the SOURCE model's units. Baked into the
# exported model's origin so both grip systems (the Blender plate factory and the
# engine's variant-grip path) can treat origin-at-grip as true.
GRIP_AT = -0.15


def _face_colours(obj):
    """Sample the source texture once per face, so parts can be found by COLOUR.

    The KayKit weapon is one mesh on one baked atlas: no material or island split
    separates the crystal petals from the blade, but the texture does.
    """
    me = obj.data
    img = next(n.image for n in me.materials[0].node_tree.nodes
               if n.type == "TEX_IMAGE" and n.image)
    w, h = img.size
    px = list(img.pixels[:])
    uvl = me.uv_layers.active.data
    out = {}
    for p in me.polygons:
        us = [uvl[li].uv for li in p.loop_indices]
        cu = sum(a[0] for a in us) / len(us)
        cv = sum(a[1] for a in us) / len(us)
        x = min(w - 1, max(0, int(cu * w)))
        y = min(h - 1, max(0, int(cv * h)))
        i = (y * w + x) * 4
        r, g, b = px[i], px[i + 1], px[i + 2]
        out[p.index] = (r, g, b) + colorsys.rgb_to_hsv(r, g, b)
    return out


def _is_crystal(c):
    """Saturated blue: the star-glass petals, and the weapon's only magic tell."""
    return c[4] > 0.60 and 0.48 < c[3] < 0.64


def militia_halberd(name="Marsh_Halberd", src="weapons/halberd.glb", repo=None,
                    blade_k=0.56, blade_r0=0.17, head_z=(0.36, 1.40),
                    shaft_r=0.12, shaft_z=(-0.60, 0.45), pale_v=0.45, band=0.085,
                    material=None, cells=None):
    """Import the shared halberd and rebuild it as a town sergeant's issued polearm.

    Returns the object, with its origin moved to the grip so `parts.held` (and the
    engine's origin-at-grip variant path) need no extra term.
    """
    repo = repo or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    cells = cells or {"steel": ("spare_b", 0.30), "haft": ("trim", 0.34),
                      "wrap": ("leather", 0.32), "band": ("bronze", 0.30)}

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f"{repo}/public/models/{src}")
    fresh = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in fresh if o.type == "MESH"]
    for o in fresh:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    obj = meshes[0]
    obj.name = name
    me = obj.data

    cols = _face_colours(obj)
    kill = [p.index for p in me.polygons if _is_crystal(cols[p.index])]
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()

    # draw the crescent in toward the haft. Radial about the haft axis and ramped
    # in from `blade_r0`, so the socket and the shaft are untouched and the blade
    # stays welded to them.
    lo, hi = head_z
    for v in me.vertices:
        if not (lo <= v.co.z <= hi):
            continue
        r = math.hypot(v.co.x, v.co.y)
        if r <= blade_r0:
            continue
        t = min(1.0, (r - blade_r0) / 0.22)
        nr = blade_r0 + (r - blade_r0) * (1.0 + (blade_k - 1.0) * t)
        v.co.x *= nr / r
        v.co.y *= nr / r

    # onto his palette: iron head, dark wood haft, hemp binding, and ONE bronze band
    # at the top of the grip, which is the sergeant's mark carried on the badge of
    # rank itself. Split by GEOMETRY plus brightness, not hue: the binding and the
    # shaft under it are the same warm family, and a hue cut put both on one cell,
    # which left the grip reading as bare iron.
    cols = _face_colours(obj)
    uvl = me.uv_layers.active.data

    def f_r(p):
        return max(math.hypot(me.vertices[v].co.x, me.vertices[v].co.y) for v in p.vertices)

    def f_z(p):
        return sum(me.vertices[v].co.z for v in p.vertices) / len(p.vertices)

    def on_shaft(p):
        return f_r(p) < shaft_r and shaft_z[0] <= f_z(p) <= shaft_z[1]

    wrap = [p.index for p in me.polygons if on_shaft(p) and cols[p.index][5] > pale_v]
    band_lo = (max(f_z(me.polygons[i]) for i in wrap) - band) if wrap else 9e9
    wrap = set(wrap)
    for p in me.polygons:
        if p.index in wrap:
            kind = "band" if f_z(p) >= band_lo else "wrap"
        elif on_shaft(p):
            kind = "haft"
        else:
            kind = "steel"
        slot, shade = cells[kind]
        uv = atlas.cell_uv(slot, shade)
        for li in p.loop_indices:
            uvl[li].uv = uv

    me.materials.clear()
    if material is not None:
        me.materials.append(material)

    for v in me.vertices:              # origin to the grip
        v.co.z -= GRIP_AT
    me.update()
    return obj


def export(obj, out_path):
    """Write one weapon GLB: this object only, no rig, no clips."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=False,
        export_yup=True,
    )
    return out_path
