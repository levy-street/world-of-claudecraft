# Builds the Tree Generator's foundation trunks in Blender and exports them as
# GLBs, plus a JSON of their dimensions and branch sockets.
#
# Run through the addon socket:
#   python3 ~/.claude/tools/blender_bridge.py run scripts/assets/build_trunks.py
#
# Everything is built inside a temporary collection and deleted afterwards, so
# whatever else is open in Blender is left alone.
#
# A trunk is a set of lofted tubes: a centre path with a radius at every step,
# swept with parallel-transport frames so the rings never twist. Bark comes from
# Perlin displacement plus vertical grooves; buttress roots come from an angular
# flare term that decays with height. Each archetype also records SOCKETS - the
# tip of every limb, with its direction and girth - which is what the procedural
# side grows its finer branches and canopy volumes from.
#
# Blender is Z-up; the JSON converts to the glTF/three convention (y up).

import json
import math
import os
import random
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

OUT_DIR = "/Users/troy/Documents/woc/dryrun/public/models/foliage/trunks"
JSON_OUT = "/Users/troy/Documents/woc/dryrun/tmp/trunks.json"
COLL_NAME = "_woc_trunk_build"
# Yards per bark-texture repeat.
UV_TILE = 1.15

log = []


# ------------------------------------------------------------------ geometry

def frames_along(pts):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    n = len(pts)
    tangents = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        if t.length < 1e-9:
            t = Vector((0.0, 0.0, 1.0))
        tangents.append(t.normalized())
    out = []
    prev_n = None
    for i, t in enumerate(tangents):
        if prev_n is None:
            up = Vector((0.0, 0.0, 1.0)) if abs(t.z) < 0.9 else Vector((1.0, 0.0, 0.0))
            nrm = up.cross(t)
            if nrm.length < 1e-6:
                nrm = Vector((1.0, 0.0, 0.0)).cross(t)
        else:
            axis = tangents[i - 1].cross(t)
            nrm = prev_n.copy()
            if axis.length > 1e-8:
                ang = math.acos(max(-1.0, min(1.0, tangents[i - 1].dot(t))))
                nrm.rotate(Matrix.Rotation(ang, 4, axis.normalized()))
        nrm = nrm - t * nrm.dot(t)
        if nrm.length < 1e-6:
            nrm = Vector((1.0, 0.0, 0.0)) - t * t.x
        nrm.normalize()
        out.append((t, nrm, t.cross(nrm).normalized()))
        prev_n = nrm
    return out


def add_tube(bm, uv_layer, col_layer, pts, radii, segs, opt):
    """Loft one tube and return its ring vertex lists."""
    seed = Vector(opt.get("seed", (0.0, 0.0, 0.0)))
    bark = opt.get("bark", 0.05)
    bark_freq = opt.get("bark_freq", 2.2)
    grooves = opt.get("grooves", 0)
    groove_depth = opt.get("groove_depth", 0.0)
    flare = opt.get("flare", 0.0)
    flare_lobes = opt.get("flare_lobes", 6)
    flare_height = opt.get("flare_height", 1.4)
    flare_phase = opt.get("flare_phase", 0.0)
    shade_base = opt.get("shade_base", 0.55)

    frames = frames_along(pts)
    rings = []
    arc = 0.0
    for i, (p, r) in enumerate(zip(pts, radii)):
        if i > 0:
            arc += (pts[i] - pts[i - 1]).length
        t, n, b = frames[i]
        ring = []
        # Physical UVs: u wraps the girth, v climbs the length, both in yards.
        v = arc / UV_TILE
        for k in range(segs):
            th = (k / segs) * math.tau
            radial = n * math.cos(th) + b * math.sin(th)
            rr = r
            # Buttress flare: lobes at the foot that fade out with height.
            if flare > 0.0 and p.z < flare_height:
                fade = 1.0 - (p.z / flare_height)
                lobe = max(0.0, math.cos(th * flare_lobes + flare_phase))
                rr *= 1.0 + flare * fade * fade * (lobe ** 1.6)
            # Vertical grooves down the bark.
            if grooves:
                rr *= 1.0 + groove_depth * math.cos(th * grooves + p.z * 0.4)
            # Perlin bark relief.
            if bark > 0.0:
                q = (p + radial * r) * bark_freq + seed
                rr *= 1.0 + bark * noise.noise(q)
            vert = bm.verts.new(p + radial * rr)
            ring.append((vert, (k / segs) * (math.tau * max(r, 0.05)) / UV_TILE, v))
        rings.append(ring)

    height_span = max(1e-4, max(p.z for p in pts))
    for i in range(len(rings) - 1):
        a = rings[i]
        c = rings[i + 1]
        for k in range(segs):
            k2 = (k + 1) % segs
            try:
                f = bm.faces.new((a[k][0], a[k2][0], c[k2][0], c[k][0]))
            except ValueError:
                continue  # duplicate face where two rings coincide
            f.smooth = True
            loops = f.loops
            src = [a[k], a[k2], c[k2], c[k]]
            for loop, s in zip(loops, src):
                # Seam fix: the last quad in the ring must not wrap u back to 0.
                u = s[1] if k2 != 0 else (s[1] if s is a[k] or s is c[k] else
                                          (math.tau * max(radii[i], 0.05)) / UV_TILE)
                loop[uv_layer].uv = (u, s[2])
                # Bark relief and the root flare push verts below z=0, and a
                # negative base to a fractional power is complex in Python.
                z = max(0.0, loop.vert.co.z)
                shade = shade_base + (1.0 - shade_base) * min(1.0, (z / height_span) ** 0.6)
                loop[col_layer] = (shade, shade, shade, 1.0)
    return rings


def cap_ring(bm, uv_layer, col_layer, ring, center, shade):
    """Close a tube end with a triangle fan."""
    cv = bm.verts.new(center)
    n = len(ring)
    for k in range(n):
        k2 = (k + 1) % n
        try:
            f = bm.faces.new((ring[k][0], ring[k2][0], cv))
        except ValueError:
            continue
        f.smooth = True
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x / UV_TILE, loop.vert.co.y / UV_TILE)
            loop[col_layer] = (shade, shade, shade, 1.0)


def limb_path(base, azimuth, tilt0, tilt1, length, steps=9, wobble=0.0, rnd=None):
    """A limb arc leaving `base`, tilting from tilt0 to tilt1 off vertical."""
    pts = [Vector(base)]
    p = Vector(base)
    az = azimuth
    for i in range(steps):
        t = (i + 0.5) / steps
        tilt = tilt0 + (tilt1 - tilt0) * t
        if wobble and rnd:
            az += rnd.uniform(-wobble, wobble)
            tilt += rnd.uniform(-wobble, wobble) * 0.6
        d = Vector((math.cos(az) * math.sin(tilt), math.sin(az) * math.sin(tilt), math.cos(tilt)))
        p = p + d * (length / steps)
        pts.append(p.copy())
    return pts


def taper(r0, r1, n, power=1.35):
    """n radii falling from r0 to r1, thicker near the base than a straight lerp."""
    return [r1 + (r0 - r1) * ((1.0 - i / (n - 1)) ** power) for i in range(n)]


def trunk_path(height, steps, lean=0.0, wobble=0.0, wobble_freq=1.0, rnd=None):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        z = t * height
        x = lean * height * t * t
        y = 0.0
        if wobble:
            x += math.sin(t * math.pi * wobble_freq) * wobble * height * 0.12
            y += math.cos(t * math.pi * wobble_freq * 0.7 + 1.1) * wobble * height * 0.1
        if rnd:
            x += rnd.uniform(-0.02, 0.02) * height * 0.1
            y += rnd.uniform(-0.02, 0.02) * height * 0.1
        pts.append(Vector((x, y, z)))
    return pts


# ------------------------------------------------------------------ archetypes
# Each returns (segments, sockets, meta). A segment is a tube; a socket is where
# the procedural side takes over: position, outward direction, and girth.

def spec_oak():
    rnd = random.Random(11)
    h = 5.0
    pts = trunk_path(h, 10, lean=0.02, wobble=0.35, wobble_freq=0.8, rnd=rnd)
    segs = [{
        "pts": pts, "radii": taper(0.92, 0.46, len(pts), 1.5), "segs": 16,
        "opt": {"bark": 0.055, "bark_freq": 2.4, "grooves": 9, "groove_depth": 0.035,
                "flare": 0.55, "flare_lobes": 6, "flare_height": 1.5, "seed": (3.1, 0.0, 0.0)},
    }]
    sockets = []
    top = pts[-1]
    n_limbs = 4
    for i in range(n_limbs):
        az = (i / n_limbs) * math.tau + 0.35
        length = 3.3 + rnd.uniform(-0.4, 0.5)
        lp = limb_path(top - Vector((0, 0, 0.35)), az, 0.95, 0.42, length, 9, 0.07, rnd)
        r0 = 0.34 + rnd.uniform(-0.03, 0.04)
        segs.append({
            "pts": lp, "radii": taper(r0, 0.09, len(lp), 1.2), "segs": 10,
            "opt": {"bark": 0.06, "bark_freq": 3.0, "grooves": 6, "groove_depth": 0.03,
                    "seed": (i * 5.7, 2.0, 0.0), "shade_base": 0.72},
        })
        d = (lp[-1] - lp[-2]).normalized()
        sockets.append({"p": lp[-1], "d": d, "r": 0.09})
        # A second-order fork halfway out gives the crown its bushy read.
        mid = lp[5]
        for s in (-1, 1):
            fp = limb_path(mid, az + s * 0.75, 0.85, 0.5, length * 0.55, 6, 0.06, rnd)
            segs.append({
                "pts": fp, "radii": taper(0.16, 0.05, len(fp), 1.2), "segs": 8,
                "opt": {"bark": 0.06, "bark_freq": 3.4, "seed": (i * 3.3 + s, 4.0, 0.0),
                        "shade_base": 0.78},
            })
            sockets.append({"p": fp[-1], "d": (fp[-1] - fp[-2]).normalized(), "r": 0.05})
    meta = {"crown_z": 6.4, "crown_r": 3.5, "collide_r": 0.95, "collide_h": 5.2,
            "kind": "broadleaf"}
    return segs, sockets, meta


def spec_pine():
    rnd = random.Random(23)
    h = 13.0
    pts = trunk_path(h, 16, lean=0.005, wobble=0.1, wobble_freq=1.3, rnd=rnd)
    segs = [{
        "pts": pts, "radii": taper(0.62, 0.05, len(pts), 1.15), "segs": 14,
        "opt": {"bark": 0.05, "bark_freq": 2.6, "grooves": 12, "groove_depth": 0.05,
                "flare": 0.3, "flare_lobes": 7, "flare_height": 1.1, "seed": (7.7, 0.0, 0.0)},
    }]
    sockets = []
    whorls = 7
    for w in range(whorls):
        f = w / (whorls - 1)
        z = 2.6 + f * (h - 3.6)
        idx = min(len(pts) - 1, int(round(z / h * (len(pts) - 1))))
        base = pts[idx]
        per = 5 if f < 0.7 else 4
        # Lower whorls are long and droop; the top ones are short and lift.
        length = 2.5 * (1.0 - f) ** 0.8 + 0.55
        tilt = 1.5 - 0.55 * f
        for i in range(per):
            az = (i / per) * math.tau + w * 0.6
            lp = limb_path(base, az, tilt, tilt - 0.25, length, 6, 0.05, rnd)
            segs.append({
                "pts": lp, "radii": taper(0.11 * (1.2 - f), 0.02, len(lp), 1.2), "segs": 7,
                "opt": {"bark": 0.05, "bark_freq": 3.6, "seed": (w * 2.2 + i, 3.0, 0.0),
                        "shade_base": 0.74},
            })
            sockets.append({"p": lp[-1], "d": (lp[-1] - lp[-2]).normalized(), "r": 0.03,
                            "tier": f})
    meta = {"crown_z": 8.0, "crown_r": 3.0, "collide_r": 0.65, "collide_h": 13.0,
            "kind": "conifer"}
    return segs, sockets, meta


def spec_twisted():
    rnd = random.Random(37)
    h = 4.6
    pts = trunk_path(h, 12, lean=0.14, wobble=1.15, wobble_freq=2.3, rnd=rnd)
    segs = [{
        "pts": pts, "radii": taper(0.78, 0.34, len(pts), 1.4), "segs": 14,
        "opt": {"bark": 0.13, "bark_freq": 2.0, "grooves": 7, "groove_depth": 0.09,
                "flare": 0.6, "flare_lobes": 5, "flare_height": 1.3, "flare_phase": 0.7,
                "seed": (13.0, 5.0, 0.0)},
    }]
    sockets = []
    for i in range(3):
        az = (i / 3) * math.tau + 1.1
        start = pts[8 + i]
        length = 3.0 + rnd.uniform(-0.3, 0.6)
        # Strong wobble is the whole point: these limbs claw outward.
        lp = limb_path(start, az, 1.15, 0.55, length, 10, 0.19, rnd)
        segs.append({
            "pts": lp, "radii": taper(0.26, 0.06, len(lp), 1.25), "segs": 9,
            "opt": {"bark": 0.15, "bark_freq": 2.8, "grooves": 5, "groove_depth": 0.08,
                    "seed": (i * 9.1, 7.0, 0.0), "shade_base": 0.7},
        })
        sockets.append({"p": lp[-1], "d": (lp[-1] - lp[-2]).normalized(), "r": 0.06})
        fp = limb_path(lp[6], az - 0.9, 1.0, 0.7, length * 0.5, 6, 0.16, rnd)
        segs.append({
            "pts": fp, "radii": taper(0.12, 0.04, len(fp), 1.2), "segs": 7,
            "opt": {"bark": 0.16, "bark_freq": 3.2, "seed": (i * 4.4, 9.0, 0.0),
                    "shade_base": 0.76},
        })
        sockets.append({"p": fp[-1], "d": (fp[-1] - fp[-2]).normalized(), "r": 0.04})
    meta = {"crown_z": 5.4, "crown_r": 3.0, "collide_r": 0.8, "collide_h": 4.8,
            "kind": "gnarled"}
    return segs, sockets, meta


def spec_palm():
    rnd = random.Random(53)
    h = 9.5
    pts = []
    # A long bow: palms lean out over the beach rather than standing straight.
    for i in range(15):
        t = i / 14
        pts.append(Vector((1.5 * t * t, 0.35 * t * t, t * h)))
    radii = [0.46 - 0.2 * (i / 14) ** 0.7 for i in range(15)]
    # Frond scars: a shallow ripple all the way up the stem.
    for i in range(15):
        radii[i] *= 1.0 + 0.075 * math.sin(i * 2.1)
    segs = [{
        "pts": pts, "radii": radii, "segs": 14,
        "opt": {"bark": 0.045, "bark_freq": 3.4, "grooves": 0, "seed": (17.0, 2.0, 0.0),
                "flare": 0.4, "flare_lobes": 9, "flare_height": 1.0},
    }]
    d = (pts[-1] - pts[-2]).normalized()
    sockets = [{"p": pts[-1], "d": d, "r": 0.26, "crown": True}]
    meta = {"crown_z": h, "crown_r": 2.6, "collide_r": 0.5, "collide_h": 9.5,
            "kind": "palm"}
    return segs, sockets, meta


def spec_acacia():
    rnd = random.Random(71)
    h = 2.3
    pts = trunk_path(h, 7, lean=0.05, wobble=0.3, wobble_freq=0.9, rnd=rnd)
    segs = [{
        "pts": pts, "radii": taper(0.82, 0.52, len(pts), 1.5), "segs": 14,
        "opt": {"bark": 0.07, "bark_freq": 2.6, "grooves": 8, "groove_depth": 0.045,
                "flare": 0.5, "flare_lobes": 5, "flare_height": 0.9, "seed": (23.0, 1.0, 0.0)},
    }]
    sockets = []
    n = 5
    for i in range(n):
        az = (i / n) * math.tau + 0.2
        # Rise then flatten: that is what gives an acacia its parasol crown.
        lp = limb_path(pts[-1] - Vector((0, 0, 0.15)), az, 0.75, 1.35, 3.6, 10, 0.06, rnd)
        segs.append({
            "pts": lp, "radii": taper(0.3, 0.06, len(lp), 1.3), "segs": 9,
            "opt": {"bark": 0.07, "bark_freq": 3.0, "seed": (i * 6.1, 11.0, 0.0),
                    "shade_base": 0.74},
        })
        sockets.append({"p": lp[-1], "d": (lp[-1] - lp[-2]).normalized(), "r": 0.06})
        fp = limb_path(lp[6], az + 0.6, 1.15, 1.4, 1.6, 6, 0.05, rnd)
        segs.append({
            "pts": fp, "radii": taper(0.12, 0.04, len(fp), 1.2), "segs": 7,
            "opt": {"bark": 0.07, "bark_freq": 3.4, "seed": (i * 2.9, 13.0, 0.0),
                    "shade_base": 0.8},
        })
        sockets.append({"p": fp[-1], "d": (fp[-1] - fp[-2]).normalized(), "r": 0.04})
    meta = {"crown_z": 4.2, "crown_r": 3.6, "collide_r": 0.85, "collide_h": 2.6,
            "kind": "flat-top"}
    return segs, sockets, meta


def spec_ancient():
    rnd = random.Random(97)
    h = 9.0
    pts = trunk_path(h, 14, lean=0.01, wobble=0.25, wobble_freq=0.7, rnd=rnd)
    segs = [{
        "pts": pts, "radii": taper(2.3, 0.95, len(pts), 1.6), "segs": 22,
        "opt": {"bark": 0.06, "bark_freq": 1.5, "grooves": 11, "groove_depth": 0.075,
                "flare": 0.62, "flare_lobes": 8, "flare_height": 3.6, "seed": (31.0, 3.0, 0.0)},
    }]
    sockets = []
    n = 5
    for i in range(n):
        az = (i / n) * math.tau + 0.5
        start = pts[11 + (i % 3)]
        length = 5.4 + rnd.uniform(-0.6, 0.8)
        lp = limb_path(start, az, 0.95, 0.45, length, 11, 0.06, rnd)
        segs.append({
            "pts": lp, "radii": taper(0.72, 0.14, len(lp), 1.3), "segs": 12,
            "opt": {"bark": 0.06, "bark_freq": 2.2, "grooves": 7, "groove_depth": 0.05,
                    "seed": (i * 7.3, 17.0, 0.0), "shade_base": 0.7},
        })
        sockets.append({"p": lp[-1], "d": (lp[-1] - lp[-2]).normalized(), "r": 0.14})
        for s in (-1, 1):
            fp = limb_path(lp[6], az + s * 0.8, 0.9, 0.45, length * 0.5, 7, 0.06, rnd)
            segs.append({
                "pts": fp, "radii": taper(0.3, 0.07, len(fp), 1.25), "segs": 9,
                "opt": {"bark": 0.06, "bark_freq": 2.8, "seed": (i * 3.7 + s, 19.0, 0.0),
                        "shade_base": 0.76},
            })
            sockets.append({"p": fp[-1], "d": (fp[-1] - fp[-2]).normalized(), "r": 0.07})
    meta = {"crown_z": 12.0, "crown_r": 6.0, "collide_r": 2.4, "collide_h": 9.5,
            "kind": "ancient"}
    return segs, sockets, meta


ARCHETYPES = [
    ("oak", "Oak", spec_oak),
    ("pine", "Pine", spec_pine),
    ("twisted", "Twisted", spec_twisted),
    ("palm", "Palm", spec_palm),
    ("acacia", "Acacia", spec_acacia),
    ("ancient", "Ancient", spec_ancient),
]


# ---------------------------------------------------------------- build/export

def build_object(key, segs):
    mesh = bpy.data.meshes.new(f"trunk_{key}")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    col = bm.loops.layers.color.new("Col")
    for s in segs:
        rings = add_tube(bm, uv, col, s["pts"], s["radii"], s["segs"], s.get("opt", {}))
        if rings:
            cap_ring(bm, uv, col, rings[-1], s["pts"][-1], s.get("opt", {}).get("shade_base", 0.8))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(f"trunk_{key}", mesh)
    mat = bpy.data.materials.get("Bark") or bpy.data.materials.new("Bark")
    mat.use_nodes = True
    mesh.materials.append(mat)
    return obj


def export_glb(obj, path):
    win = bpy.context.window_manager.windows[0]
    scr = win.screen
    area = next((a for a in scr.areas if a.type == "VIEW_3D"), None)
    region = next((r for r in area.regions if r.type == "WINDOW"), None) if area else None
    ctx = {"window": win, "screen": scr}
    if area and region:
        ctx["area"] = area
        ctx["region"] = region
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_normals=True,
            export_texcoords=True,
            export_materials="EXPORT",
        )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    scene = bpy.context.scene
    old = bpy.data.collections.get(COLL_NAME)
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    coll = bpy.data.collections.new(COLL_NAME)
    scene.collection.children.link(coll)

    out = []
    made = []
    for key, label, fn in ARCHETYPES:
        segs, sockets, meta = fn()
        obj = build_object(key, segs)
        coll.objects.link(obj)
        made.append(obj)
        path = os.path.join(OUT_DIR, f"{key}.glb")
        export_glb(obj, path)
        me = obj.data
        zs = [v.co.z for v in me.vertices]
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        # Blender Z-up -> glTF/three Y-up: (x, y, z) -> (x, z, -y).
        def conv(v):
            return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
        out.append({
            "key": key,
            "label": label,
            "kind": meta["kind"],
            "height": round(max(zs), 4),
            "radiusX": round(max(abs(min(xs)), abs(max(xs))), 4),
            "radiusZ": round(max(abs(min(ys)), abs(max(ys))), 4),
            "baseRadius": round(meta["collide_r"], 4),
            "collideHeight": round(meta["collide_h"], 4),
            "crownY": round(meta["crown_z"], 4),
            "crownRadius": round(meta["crown_r"], 4),
            "tris": len(me.loop_triangles) or sum(len(p.vertices) - 2 for p in me.polygons),
            "verts": len(me.vertices),
            "sockets": [
                {
                    "p": conv(s["p"]),
                    "d": conv(s["d"]),
                    "r": round(s["r"], 4),
                    **({"tier": round(s["tier"], 3)} if "tier" in s else {}),
                    **({"crown": True} if s.get("crown") else {}),
                }
                for s in sockets
            ],
        })
        log.append(f"{key}: {len(me.vertices)} verts, {len(me.polygons)} faces, "
                   f"{len(sockets)} sockets, h={max(zs):.2f}")

    with open(JSON_OUT, "w") as f:
        json.dump(out, f, indent=1)

    if globals().get("KEEP"):
        # Leave them standing in a row for a look (scripts/assets/shot_trunks.py). Exports
        # already happened at the origin, so the offsets never reach a GLB.
        for i, o in enumerate(made):
            o.location = (i * 9.0, 0.0, 0.0)
        log.append(f"kept {len(made)} objects in {COLL_NAME}")
    else:
        # Leave Blender as we found it.
        for o in made:
            bpy.data.objects.remove(o, do_unlink=True)
        scene.collection.children.unlink(coll)
        bpy.data.collections.remove(coll)
        for m in list(bpy.data.meshes):
            if m.users == 0 and m.name.startswith("trunk_"):
                bpy.data.meshes.remove(m)
    log.append(f"wrote {JSON_OUT}")


try:
    main()
except Exception:
    log.append(traceback.format_exc())
print("\n".join(log))
