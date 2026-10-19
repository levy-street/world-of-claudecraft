# Hester's candy shelf (Gourdlight Eve phase 5), built for their item icons only:
# one sweet per primary stat, each a distinct silhouette and colour so the five
# read apart at bag size. Imported by icons.py, which owns the scene, the painted
# ground, the camera and the render; these builders only make the subject.
#
#   hearthroot_toffee  three glossy amber toffee blocks on a twist of red paper
#   gourdseed_brittle  a jagged slab of clear amber brittle set with pumpkin seeds
#   crabapple_chew     a red crabapple dipped in caramel, on a twig, a leaf at its crown
#   owlwatch_fudge     a square of dark fudge piped with a cream owl face, amber eyes
#   lantern_mint_drop  a glassy green hard-candy drop lit from within, a white swirl

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2.0


def _merge(dst, src):
    me = bpy.data.meshes.new("tmp")
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)


def rounded_box(size, bevel=0.05, segs=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect="EDGES", profile=0.5)
    return bm


def crumpled_paper(size, z, curl, seg=12):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=seg, y_segments=seg, size=size)
    for v in bm.verts:
        x, y, _ = v.co
        v.co.z = z + curl * (x * x + y * y) + 0.035 * math.sin(x * 9.0) * math.cos(y * 7.0)
    return bm


def build_toffee(col, P, obj_from_bm, tube):
    toffee = P("ToffeeAmber", (0.45, 0.17, 0.03), rough=0.08, emit=(0.7, 0.3, 0.04), emit_strength=0.15)
    paper = P("ToffeePaper", (0.55, 0.04, 0.03), rough=0.35)
    drizzle = P("ToffeeDrizzle", (0.3, 0.12, 0.03), rough=0.1)
    root = bpy.data.objects.new("toffee", None)
    col.objects.link(root)
    bm = bmesh.new()
    for c, r in (((-0.3, 0.0, 0.0), 0.1), ((0.3, 0.05, 0.0), -0.12), ((0.0, 0.0, 0.44), 0.25)):
        b = rounded_box((0.56, 0.5, 0.42), 0.07)
        bmesh.ops.rotate(b, verts=b.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(r, 3, "Z"))
        bmesh.ops.translate(b, verts=b.verts, vec=c)
        _merge(bm, b)
    obj_from_bm("toffee_blocks", bm, toffee, col).parent = root
    pap = obj_from_bm("toffee_paper", crumpled_paper(0.8, -0.22, 0.14), paper, col)
    pap.modifiers.new("s", "SOLIDIFY").thickness = 0.015
    pap.parent = root
    dbm = bmesh.new()
    pts = [
        Vector((math.cos(t * 5.0) * 0.18 * (1 - t * 0.5), math.sin(t * 5.0) * 0.15, 0.66 + 0.015 * math.sin(t * 13)))
        for t in [i / 30 for i in range(31)]
    ]
    tube(dbm, pts, 0.03)
    obj_from_bm("toffee_drizzle", dbm, drizzle, col).parent = root
    root.rotation_euler = (0.35, 0.0, 0.5)
    return root


def _slab(name, pts, depth, mat, col, obj_from_bm):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, 0, depth))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.015, segments=2, affect="EDGES")
    return obj_from_bm(name, bm, mat, col)


def build_brittle(col, P, obj_from_bm, tube):
    amber = P("BrittleAmber", (0.62, 0.27, 0.03), rough=0.06, emit=(0.9, 0.38, 0.05), emit_strength=0.25)
    seed = P("BrittleSeed", (0.82, 0.78, 0.58), rough=0.6)
    root = bpy.data.objects.new("brittle", None)
    col.objects.link(root)
    outline = [(-0.7, -0.35), (-0.2, -0.5), (0.35, -0.42), (0.72, -0.1), (0.6, 0.38), (0.05, 0.5), (-0.45, 0.42), (-0.78, 0.05)]
    _slab("brittle_slab", outline, 0.12, amber, col, obj_from_bm).parent = root
    shard = _slab("brittle_shard", [(-0.2, -0.15), (0.25, -0.2), (0.15, 0.22), (-0.22, 0.12)], 0.1, amber, col, obj_from_bm)
    shard.location = (0.62, -0.42, 0.2)
    shard.rotation_euler = (0.9, 0.3, 0.6)
    shard.parent = root
    sbm = bmesh.new()
    k = 0
    for gx in range(-3, 4):
        for gy in range(-2, 3):
            h = math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453
            h -= math.floor(h)
            if h < 0.3:
                continue
            x = gx * 0.19 + (h - 0.5) * 0.08
            y = gy * 0.17 + (h - 0.6) * 0.06
            if abs(x) > 0.6 or abs(y) > 0.36:
                continue
            g = bmesh.new()
            bmesh.ops.create_uvsphere(g, u_segments=12, v_segments=8, radius=1.0)
            for v in g.verts:
                v.co = Vector((v.co.x * 0.075, v.co.y * 0.042, v.co.z * 0.02))
            bmesh.ops.rotate(g, verts=g.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(h * TAU, 3, "Z"))
            bmesh.ops.translate(g, verts=g.verts, vec=(x, y, 0.07 + 0.05 * (k % 2)))
            _merge(sbm, g)
            k += 1
    obj_from_bm("brittle_seeds", sbm, seed, col).parent = root
    root.rotation_euler = (1.05, 0.0, 0.35)
    return root


def build_chew(col, P, obj_from_bm, tube):
    apple = P("ChewApple", (0.62, 0.05, 0.04), rough=0.15)
    caramel = P("ChewCaramel", (0.78, 0.42, 0.1), rough=0.08)
    twig = P("ChewTwig", (0.24, 0.15, 0.08), rough=0.9)
    leaf = P("ChewLeaf", (0.18, 0.42, 0.08), rough=0.5)
    root = bpy.data.objects.new("chew", None)
    col.objects.link(root)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=28, radius=0.42)
    for v in bm.verts:
        x, y, z = v.co
        d = 1.0 - 0.2 * math.exp(-((z - 0.42) ** 2) / 0.012) - 0.1 * math.exp(-((z + 0.42) ** 2) / 0.012)
        v.co = Vector((x * d, y * d, z * 0.92))
    obj_from_bm("chew_apple", bm, apple, col).parent = root
    cbm = bmesh.new()
    bmesh.ops.create_uvsphere(cbm, u_segments=64, v_segments=48, radius=0.44)
    for v in cbm.verts:
        x, y, z = v.co
        a = math.atan2(y, x)
        # a wavy dipped line with drips; above it the coat tucks inside the apple
        edge = -0.02 + 0.06 * math.sin(a * 5.0) + 0.025 * math.sin(a * 11.0)
        k = 1.0 / (1.0 + math.exp(-(z - edge) * 60.0))
        shrink = 1.0 - 0.4 * k
        v.co = Vector((x * shrink, y * shrink, z * (0.93 - 0.35 * k)))
    obj_from_bm("chew_caramel", cbm, caramel, col).parent = root
    tbm = bmesh.new()
    tube(tbm, [Vector((0.02 * math.sin(i), 0.0, -0.3 - i * 0.12)) for i in range(9)], 0.035)
    obj_from_bm("chew_twig", tbm, twig, col).parent = root
    lbm = bmesh.new()
    vs = [lbm.verts.new((0.0, 0.0, 0.0))]
    for i in range(1, 9):
        t = i / 9
        vs.append(lbm.verts.new((t * 0.32, math.sin(t * math.pi) * 0.09, t * 0.08)))
    vs.append(lbm.verts.new((0.34, 0.0, 0.09)))
    for i in range(8, 0, -1):
        t = i / 9
        vs.append(lbm.verts.new((t * 0.32, -math.sin(t * math.pi) * 0.09, t * 0.08)))
    lbm.faces.new(vs)
    lf = obj_from_bm("chew_leaf", lbm, leaf, col)
    lf.location = (0.02, 0.0, 0.36)
    lf.rotation_euler = (0.3, -0.5, 0.4)
    lf.parent = root
    root.rotation_euler = (0.2, -0.35, 0.3)
    return root


def build_fudge(col, P, obj_from_bm, tube):
    fudge = P("FudgeDark", (0.13, 0.06, 0.03), rough=0.45)
    cream = P("FudgeCream", (0.92, 0.85, 0.7), rough=0.4)
    eye = P("FudgeEye", (1.0, 0.65, 0.1), emit=(1.0, 0.55, 0.05), emit_strength=3.0)
    root = bpy.data.objects.new("fudge", None)
    col.objects.link(root)
    obj_from_bm("fudge_block", rounded_box((0.9, 0.9, 0.36), 0.06), fudge, col).parent = root
    rbm = bmesh.new()
    for side in (-1, 1):
        pts = [
            Vector((side * 0.19 + math.cos(a / 24 * TAU) * 0.14, math.sin(a / 24 * TAU) * 0.14 + 0.06, 0.19))
            for a in range(25)
        ]
        tube(rbm, pts, 0.03)
    tube(rbm, [Vector((-0.05, -0.1, 0.19)), Vector((0.0, -0.2, 0.19)), Vector((0.05, -0.1, 0.19))], 0.025)
    for side in (-1, 1):
        tube(rbm, [Vector((side * 0.3, 0.24, 0.19)), Vector((side * 0.38, 0.38, 0.19))], 0.025)
    obj_from_bm("fudge_cream", rbm, cream, col).parent = root
    ebm = bmesh.new()
    for side in (-1, 1):
        bmesh.ops.create_uvsphere(ebm, u_segments=16, v_segments=10, radius=0.06,
                                  matrix=Matrix.Translation((side * 0.19, 0.06, 0.2)))
    obj_from_bm("fudge_eyes", ebm, eye, col).parent = root
    root.rotation_euler = (1.0, 0.0, 0.25)
    return root


def build_mint(col, P, obj_from_bm, tube):
    glass = P("MintGlass", (0.18, 0.62, 0.32), rough=0.05, emit=(0.3, 0.95, 0.45), emit_strength=0.7)
    swirl = P("MintSwirl", (0.96, 0.98, 0.95), rough=0.3)
    paper = P("MintPaper", (0.9, 0.86, 0.72), rough=0.6)
    root = bpy.data.objects.new("mint", None)
    col.objects.link(root)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=0.45)
    for v in bm.verts:
        v.co.z *= 0.62
    obj_from_bm("mint_drop", bm, glass, col).parent = root
    sbm = bmesh.new()
    for arm in range(3):
        pts = []
        for i in range(24):
            t = i / 23
            a = arm * TAU / 3 + t * 3.2
            r = 0.05 + t * 0.34
            top = 0.279 * math.sqrt(max(0.0, 1.0 - (r / 0.45) ** 2))
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, top + 0.006)))
        tube(sbm, pts, 0.025)
    obj_from_bm("mint_swirl", sbm, swirl, col).parent = root
    pap = obj_from_bm("mint_paper", crumpled_paper(0.7, -0.27, 0.1, 10), paper, col)
    pap.modifiers.new("s", "SOLIDIFY").thickness = 0.012
    pap.parent = root
    root.rotation_euler = (0.85, 0.0, 0.3)
    return root


BUILDERS = {
    "hearthroot_toffee": build_toffee,
    "gourdseed_brittle": build_brittle,
    "crabapple_chew": build_chew,
    "owlwatch_fudge": build_fudge,
    "lantern_mint_drop": build_mint,
}
