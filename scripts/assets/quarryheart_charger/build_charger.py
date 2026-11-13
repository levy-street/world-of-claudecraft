# The Quarryheart Charger: the Smith's Heart raid's reward mount (src/sim/content/mounts.ts
# 'quarryheart_charger'). A deterministic Blender factory: one rigged, animated, textured GLB,
# procedural from end to end. Original work for this project (no imported meshes, no reference
# art).
#
# CONCEPT. A war-steed of the Heart, the raid's elemental forge-heart of stone, wind, frost and
# fire, read at a glance from a player's camera:
#   - a body of FLOATING QUARRY-STONE PLATES, gold-veined and chipped, each hanging a hand's
#     breadth off a body of living fire, with real gaps between them where the fire shows;
#   - the HEART: a white-hot core in the chest, bared on both flanks behind gold cage ribs;
#   - ICE-CRYSTAL HORNS sweeping back from the brow over a small crystal crown;
#   - a MANE and TAIL of swirling wind ribbons (their own material, waved and lit by the
#     renderer), stone crest fins down the neck, wind wisps at the fetlocks;
#   - heavy stone hooves banded in forge gold; a basalt saddle with a gold rim;
#   - eyes and nostrils of white-gold fire.
# It stands well over its rider (the manifest height is the Idle's own height, printed in
# CHARGER_REPORT), bigger than a destrier and still rideable.
#
# RUNTIME CONTRACT (src/render/quarryheart_charger_fx.ts reads these by name):
#   material QuarryheartStone  every solid surface: base atlas x vertex shading, emissive atlas
#   material QuarryheartWind   the mane, tail and fetlock ribbons (uv.x runs root to tip)
#   attributes _DIR, _CEN, _KIND (charger_body.py) for the plate float and the summon assembly
#   bones saddle (the rider's seat), chest (the heart's halo), hoof{F,H}.{L,R} (hoofprints)
#
#   blender --background --factory-startup --python scripts/assets/quarryheart_charger/build_charger.py \
#     -- --out <glb> [--blend <file>]

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import charger_atlas as A  # noqa: E402
import charger_body as B  # noqa: E402
import charger_rig as R  # noqa: E402

MAT_STONE = 0
MAT_WIND = 1


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------


def stone_material(base_img, glow_img):
    mat = bpy.data.materials.new("QuarryheartStone")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = base_img
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Shade"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tb.outputs["Color"], mul.inputs["A"])
    nt.links.new(vc.outputs["Color"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    tg = nt.nodes.new("ShaderNodeTexImage")
    tg.image = glow_img
    nt.links.new(tg.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.82
    bsdf.inputs["Metallic"].default_value = 0.0
    mat.use_backface_culling = True
    return mat


def wind_material():
    mat = bpy.data.materials.new("QuarryheartWind")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.55, 0.85, 0.95, 1)
    bsdf.inputs["Emission Color"].default_value = (0.45, 0.85, 1.0, 1)
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Alpha"].default_value = 0.45
    bsdf.inputs["Roughness"].default_value = 0.5
    mat.use_backface_culling = False
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED"
    if hasattr(mat, "blend_method"):
        try:
            mat.blend_method = "BLEND"
        except Exception:
            pass
    return mat


# ---------------------------------------------------------------------------
# the body
# ---------------------------------------------------------------------------

TORSO = [
    # y, centre z, half-width, half-height
    (-1.44, 2.02, 0.32, 0.4),
    (-1.3, 2.02, 0.5, 0.58),
    (-1.05, 2.04, 0.61, 0.69),
    (-0.75, 2.06, 0.65, 0.7),
    (-0.42, 2.08, 0.65, 0.66),
    (-0.1, 2.12, 0.62, 0.6),
    (0.25, 2.14, 0.6, 0.58),
    (0.6, 2.17, 0.63, 0.6),
    (0.95, 2.2, 0.67, 0.64),
    (1.25, 2.22, 0.63, 0.6),
    (1.48, 2.22, 0.5, 0.5),
    (1.62, 2.2, 0.3, 0.34),
]


def torso_bone(cc):
    if cc.y < -0.55:
        return "chest"
    if cc.y < 0.2:
        return "spine"
    return "hips"


def torso_blend(y):
    """Smooth flesh weights along the spine for the fire body."""
    def tri(y, a, b, c):
        if y <= a or y >= c:
            return 0.0
        return (y - a) / (b - a) if y < b else (c - y) / (c - b)
    w = {"chest": max(0.0, min(1.0, (-0.35 - y) / 0.4)) if y < -0.35 else 0.0,
         "hips": max(0.0, min(1.0, (y - 0.0) / 0.4)) if y > 0.0 else 0.0}
    w["spine"] = max(0.0, 1.0 - w["chest"] - w["hips"])
    return {k: v for k, v in w.items() if v > 1e-4}


def in_window(cc):
    """The two flank windows that bare the heart, and the saddle's footprint on the back."""
    if abs(cc.x) > 0.36 and -1.0 < cc.y < -0.08 and 1.7 < cc.z < 2.45:
        return True
    if cc.z > 2.5 and -0.62 < cc.y < 0.42:
        return True
    return False


def build_torso(acc):
    spine = [Vector((0, y, z)) for (y, z, _, _) in TORSO]
    radii = [(rx, ry) for (_, _, rx, ry) in TORSO]
    rings, centres, _ = B.loft_rings(spine, radii, 18, "torso", jitter=0.07, phase=math.pi / 18)
    B.bricks(acc, rings, centres, MAT_STONE, lambda i, cc: torso_bone(cc), "torso", cols_per=2,
             skip=lambda cc, i, j: in_window(cc), shrink=0.87, thick=0.1, dome=0.045, lift=0.02,
             float_mag=0.02)

    def window_hole(mid):
        return abs(mid.x) > 0.28 and -0.98 < mid.y < -0.1 and 1.72 < mid.z < 2.42
    B.fire_tube(acc, rings, centres, lambda i: torso_blend(TORSO[i][0]), 0.88, MAT_STONE, "torso-fire",
                cap0=True, cap1=True, skip=window_hole)
    # the heart: a white-hot core hanging in a chamber of fire, bared through both flank windows
    B.ico(acc, B.CORE, B.CORE_R, "spine", MAT_STONE, A.R_ENERGY, "core", kind=B.KIND_CORE,
          subdiv=2, u=0.1, rough=0.12)
    B.ico(acc, B.CORE, 0.56, "spine", MAT_STONE, A.R_ENERGY, "chamber", subdiv=2, inward=True,
          u_of=lambda mid, k: 0.18 + 0.3 * B.h01("chamber", k))
    for sx in (1, -1):
        # the cage: three slim gold ribs bowed out over each window, pointed at both ends
        for k, y in enumerate((-0.82, -0.56, -0.3)):
            pts = []
            for q in range(7):
                t = q / 6
                a = 0.62 - 1.24 * t  # top of the window to the bottom, round the flank
                bow = 0.1 * math.sin(math.pi * t)
                r = 0.66 + bow
                pts.append(Vector((sx * r * math.cos(a), y + 0.04 * math.sin(math.pi * t), 2.07 + 0.74 * math.sin(a))))
            bone = "chest" if y < -0.55 else "spine"
            radii = [0.012, 0.03, 0.04, 0.042, 0.04, 0.03, 0.012]
            for q in range(6):
                B.prism(acc, pts[q], pts[q + 1], radii[q], radii[q + 1], 5, bone, MAT_STONE, A.R_GOLD,
                        f"rib-{sx}-{k}-{q}", cap0=(q == 0), cap1=(q == 5), rot=math.pi / 5)


def torso_at(y):
    """Interpolated torso section (centre z, half-width, half-height) at a y."""
    for (y0, z0, rx0, ry0), (y1, z1, rx1, ry1) in zip(TORSO, TORSO[1:]):
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            return z0 + (z1 - z0) * t, rx0 + (rx1 - rx0) * t, ry0 + (ry1 - ry0) * t
    return TORSO[-1][1], TORSO[-1][2], TORSO[-1][3]


def back_patch(y0, y1, a0, a1, rows, cols, lift):
    grid = []
    for r in range(rows + 1):
        y = y0 + (y1 - y0) * r / rows
        cz, rx, ry = torso_at(y)
        row = []
        for q in range(cols + 1):
            a = a0 + (a1 - a0) * q / cols
            row.append(Vector((rx * math.sin(a), y, cz + ry * math.cos(a)))
                       + Vector((math.sin(a), 0, math.cos(a))) * lift)
        grid.append(row)
    return grid


def build_saddle(acc):
    # a curved basalt seat over the back with a gold rim, skirts down both flanks, a gold horn
    # of a pommel and a raised cantle
    axis = Vector((0, -0.1, 2.1))
    seat = back_patch(-0.6, 0.4, -0.75, 0.75, 4, 4, 0.06)
    B.plate(acc, seat, axis, "spine", MAT_STONE, "seat", shrink=1.0, thick=0.12, dome=0.0, lift=0.0,
            region=A.R_BASALT, px_per_yd=0.2, chip=0.0, kind=B.KIND_BODY, rim_region=A.R_GOLD,
            tilt_mag=0.0, float_mag=0.0, bevel=0.02)
    for sx in (1, -1):
        skirt = back_patch(-0.5, 0.3, sx * 0.8, sx * 1.5, 3, 2, 0.1)
        B.plate(acc, skirt, axis, "spine", MAT_STONE, f"skirt{sx}", shrink=1.0, thick=0.06, dome=0.0,
                lift=0.0, region=A.R_BASALT, px_per_yd=0.2, chip=0.0, kind=B.KIND_BODY, rim_region=A.R_GOLD,
            tilt_mag=0.0, float_mag=0.0, bevel=0.02)
    cz, _, ry = torso_at(-0.62)
    top = cz + ry + 0.12
    B.prism(acc, Vector((0, -0.6, top - 0.05)), Vector((0, -0.7, top + 0.24)), 0.09, 0.03, 6, "spine",
            MAT_STONE, A.R_GOLD, "pommel", rot=math.pi / 6)
    cz, _, ry = torso_at(0.42)
    top = cz + ry + 0.1
    B.prism(acc, Vector((-0.24, 0.42, top)), Vector((0.24, 0.42, top)), 0.07, 0.07, 6, "spine", MAT_STONE,
            A.R_BASALT, "cantle", rot=math.pi / 6, squash=1.6)
    B.prism(acc, Vector((-0.27, 0.45, top + 0.06)), Vector((0.27, 0.45, top + 0.06)), 0.035, 0.035, 6, "spine",
            MAT_STONE, A.R_GOLD, "cantle-rim", rot=math.pi / 6)


NECK = [
    # point, half-width, half-depth
    ((0, -1.05, 2.42), 0.4, 0.5),
    ((0, -1.3, 2.82), 0.35, 0.44),
    ((0, -1.5, 3.2), 0.3, 0.37),
    ((0, -1.68, 3.55), 0.26, 0.31),
    ((0, -1.82, 3.84), 0.23, 0.27),
]


def neck_bone(cc):
    return "neck1" if cc.z < 3.1 else "neck2"


def neck_blend(i):
    z = NECK[i][0][2]
    t = max(0.0, min(1.0, (z - 2.9) / 0.5))
    w = {"neck1": 1 - t, "neck2": t}
    if i == 0:
        w = {"chest": 0.5, "neck1": 0.5}
    return {k: v for k, v in w.items() if v > 1e-4}


def build_neck(acc):
    spine = [Vector(p) for (p, _, _) in NECK]
    radii = [(rx, ry) for (_, rx, ry) in NECK]
    rings, centres, _ = B.loft_rings(spine, radii, 12, "neck", jitter=0.06)
    B.bricks(acc, rings, centres, MAT_STONE, lambda i, cc: neck_bone(cc), "neck", cols_per=2,
             shrink=0.88, thick=0.09, dome=0.035, lift=0.02, float_mag=0.02)
    B.fire_tube(acc, rings, centres, neck_blend, 0.86, MAT_STONE, "neck-fire")
    # the crest: stone fins down the top of the neck, raked back, the wind mane rising from them
    for k in range(5):
        s = k / 4
        p = Vector(NECK[0][0]).lerp(Vector(NECK[-1][0]), 0.1 + 0.84 * s)
        rad = 0.44 - 0.2 * s
        base = p + Vector((0, 0.16 + 0.1 * (1 - s), rad * 0.92))
        tip = base + Vector((0, 0.3 - 0.06 * s, 0.12 + 0.03 * math.sin(k)))
        bone = "neck1" if base.z < 3.1 else ("neck2" if base.z < 3.75 else "head")
        B.prism(acc, base, tip, 0.1, 0.02, 4, bone, MAT_STONE, A.R_STONE, f"fin{k}",
                rot=math.pi / 4, squash=0.35, uvv=(0.2 + 0.1 * k, 0.4 + 0.1 * k))
    return rings


HEAD = [
    ((0, -1.78, 3.9), 0.27, 0.3),
    ((0, -1.97, 3.84), 0.28, 0.31),
    ((0, -2.16, 3.73), 0.25, 0.29),
    ((0, -2.36, 3.6), 0.2, 0.25),
    ((0, -2.56, 3.47), 0.17, 0.22),
    ((0, -2.74, 3.37), 0.16, 0.19),
    ((0, -2.86, 3.31), 0.12, 0.13),
]


def build_head(acc):
    spine = [Vector(p) for (p, _, _) in HEAD]
    radii = [(rx, ry) for (_, rx, ry) in HEAD]
    rings, centres, _ = B.loft_rings(spine, radii, 12, "head", jitter=0.05, phase=math.pi / 12)

    def skip(cc, i, j):
        # the eye sockets stay open so the fire burns through them
        return i == 1 and abs(cc.x) > 0.16 and cc.z > 3.74
    B.bricks(acc, rings, centres, MAT_STONE, lambda i, cc: "head", "head", cols_per=2,
             shrink=0.9, thick=0.08, dome=0.03, lift=0.02, skip=skip, float_mag=0.015)
    B.fire_tube(acc, rings, centres, lambda i: {"head": 1.0}, 0.8, MAT_STONE, "head-fire",
                cap0=False, cap1=True)
    for sx in (1, -1):
        B.box(acc, Vector((sx * 0.065, -2.9, 3.31)), (0.03, 0.03, 0.055), Matrix.Rotation(-0.6, 3, "X"),
              "head", MAT_STONE, A.R_EYE, tag=f"nostril{sx}")
        # the eyes: white-gold fire slits under a heavy brow
        B.box(acc, Vector((sx * 0.235, -2.0, 3.86)), (0.06, 0.24, 0.06),
              Matrix.Rotation(sx * 0.28, 3, "Z") @ Matrix.Rotation(sx * 0.2, 3, "Y"), "head", MAT_STONE,
              A.R_EYE, tag=f"eye{sx}")
        B.box(acc, Vector((sx * 0.24, -1.98, 3.95)), (0.11, 0.32, 0.07),
              Matrix.Rotation(sx * 0.3, 3, "Z") @ Matrix.Rotation(-sx * 0.35, 3, "Y"), "head", MAT_STONE,
              A.R_STONE, tag=f"brow{sx}")
        # the jaw's cheek plate
        B.box(acc, Vector((sx * 0.215, -2.1, 3.62)), (0.06, 0.34, 0.24),
              Matrix.Rotation(sx * 0.14, 3, "Z") @ Matrix.Rotation(-0.3, 3, "X"), "head", MAT_STONE, A.R_STONE,
              tag=f"cheek{sx}")
        # the ice horns: sweeping up and back from the brow
        root = Vector((sx * 0.15, -1.98, 4.0))
        pts = [root,
               root + Vector((sx * 0.07, 0.12, 0.3)),
               root + Vector((sx * 0.14, 0.38, 0.55)),
               root + Vector((sx * 0.18, 0.72, 0.68)),
               root + Vector((sx * 0.17, 1.02, 0.66))]
        B.crystal_path(acc, pts, [0.11, 0.1, 0.082, 0.06, 0.04], 6, "head", MAT_STONE, f"horn{sx}",
                       twist=0.15)
        # a short spur off each horn
        sp = pts[2]
        B.crystal_path(acc, [sp, sp + Vector((sx * 0.12, 0.06, 0.16)), sp + Vector((sx * 0.2, 0.08, 0.3))],
                       [0.045, 0.035, 0.022], 5, "head", MAT_STONE, f"spur{sx}")
    # the crown: three small crystals on the forehead, the middle one tallest
    for k, (x, h) in enumerate(((-0.07, 0.2), (0.0, 0.3), (0.07, 0.2))):
        b0 = Vector((x, -2.14, 3.98))
        B.crystal_path(acc, [b0, b0 + Vector((x * 0.6, -0.04, h * 0.6)), b0 + Vector((x * 0.9, -0.03, h))],
                       [0.04, 0.032, 0.02], 5, "head", MAT_STONE, f"crown{k}")


TAIL = [
    ((0, 1.5, 2.36), 0.22, 0.24),
    ((0, 1.9, 2.24), 0.18, 0.2),
    ((0, 2.24, 2.0), 0.14, 0.15),
    ((0, 2.48, 1.68), 0.09, 0.1),
]


def build_tail(acc):
    spine = [Vector(p) for (p, _, _) in TAIL]
    radii = [(rx, ry) for (_, rx, ry) in TAIL]
    rings, centres, _ = B.loft_rings(spine, radii, 8, "tail", jitter=0.05)
    bones = ("tail1", "tail2", "tail3")
    B.bricks(acc, rings, centres, MAT_STONE, lambda i, cc: bones[min(i, 2)], "tail", cols_per=2,
             shrink=0.84, thick=0.07, dome=0.025, lift=0.02)
    B.fire_tube(acc, rings, centres, lambda i: {bones[min(i, 2)]: 1.0}, 0.78, MAT_STONE, "tail-fire",
                cap1=True)


def leg_segment(acc, a, b, ra, rb, bone, tag, n=8, rows=2):
    a, b = Vector(a), Vector(b)
    spine = [a.lerp(b, k / rows) for k in range(rows + 1)]
    radii = [(ra + (rb - ra) * k / rows, (ra + (rb - ra) * k / rows) * 1.08) for k in range(rows + 1)]
    rings, centres, _ = B.loft_rings(spine, radii, n, tag, jitter=0.08, phase=math.pi / n)
    B.bricks(acc, rings, centres, MAT_STONE, lambda i, cc: bone, tag, cols_per=2, shrink=0.87,
             thick=0.07, dome=0.03, lift=0.02, float_mag=0.015)
    B.fire_tube(acc, rings, centres, lambda i: {bone: 1.0}, 0.8, MAT_STONE, f"{tag}-fire")


def hoof(acc, fet, bone, tag):
    top = Vector(fet) + Vector((0, 0, -0.02))
    gnd = Vector((fet[0], fet[1] - 0.02, 0.0))
    B.prism(acc, top, gnd, 0.15, 0.23, 8, bone, MAT_STONE, A.R_STONE, tag, rot=math.pi / 8,
            uvv=(0.1, 0.35))
    band = top.lerp(gnd, 0.42)
    B.prism(acc, band + Vector((0, 0, 0.04)), band - Vector((0, 0, 0.04)), 0.205, 0.215, 8, bone,
            MAT_STONE, A.R_GOLD, f"{tag}-band", rot=math.pi / 8)
    B.prism(acc, gnd + Vector((0, 0, 0.05)), gnd + Vector((0, 0, 0.0)), 0.235, 0.24, 8, bone, MAT_STONE,
            A.R_BASALT, f"{tag}-sole", rot=math.pi / 8)


def build_legs(acc):
    for side, sx in (("L", 1), ("R", -1)):
        x = 0.42 * sx
        hx = 0.47 * sx
        leg_segment(acc, (x, -0.9, 2.02), (x, -1.0, 1.2), 0.25, 0.19, f"upperF.{side}", f"uf{side}", rows=2)
        leg_segment(acc, (x, -1.0, 1.1), (x, -0.95, 0.38), 0.16, 0.13, f"lowerF.{side}", f"lf{side}", rows=2)
        B.ico(acc, (x, -1.0, 1.15), 0.15, f"lowerF.{side}", MAT_STONE, A.R_ENERGY, f"kneeF{side}", u=0.45)
        B.ico(acc, (x, -0.95, 0.34), 0.12, f"hoofF.{side}", MAT_STONE, A.R_ENERGY, f"fetF{side}", u=0.55)
        hoof(acc, (x, -0.95, 0.32), f"hoofF.{side}", f"hoofF{side}")
        leg_segment(acc, (hx, 1.02, 2.28), (hx, 0.8, 1.5), 0.34, 0.24, f"thighH.{side}", f"th{side}", rows=2, n=9)
        leg_segment(acc, (hx, 0.8, 1.42), (hx, 1.13, 0.9), 0.2, 0.15, f"gaskinH.{side}", f"ga{side}", rows=2)
        leg_segment(acc, (hx, 1.15, 0.8), (hx, 1.1, 0.38), 0.14, 0.13, f"cannonH.{side}", f"ca{side}", rows=1)
        B.ico(acc, (hx, 0.79, 1.46), 0.17, f"gaskinH.{side}", MAT_STONE, A.R_ENERGY, f"stifle{side}", u=0.5)
        B.ico(acc, (hx, 1.15, 0.86), 0.14, f"cannonH.{side}", MAT_STONE, A.R_ENERGY, f"hock{side}", u=0.55)
        B.ico(acc, (hx, 1.1, 0.34), 0.12, f"hoofH.{side}", MAT_STONE, A.R_ENERGY, f"fetH{side}", u=0.6)
        hoof(acc, (hx, 1.1, 0.32), f"hoofH.{side}", f"hoofH{side}")


# ---------------------------------------------------------------------------
# wind ribbons
# ---------------------------------------------------------------------------


def ribbon(acc, pts, width, bone_of, twist=0.0, tag="r"):
    """A twisting ribbon along pts: uv.x runs 0 at the root to 1 at the tip, uv.y across."""
    n = len(pts)
    rows = []
    for i, p in enumerate(pts):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        x, y, z = B.frame_of(t)
        a = twist * i / (n - 1)
        side = x * math.cos(a) + y * math.sin(a)
        w = width * (1 - 0.75 * (i / (n - 1))) * (0.7 if i == 0 else 1.0)
        bw = bone_of(i / (n - 1))
        rows.append((acc.v(p - side * w * 0.5, bw), acc.v(p + side * w * 0.5, bw)))
    for i in range(n - 1):
        u0, u1 = i / (n - 1), (i + 1) / (n - 1)
        a0, b0 = rows[i]
        a1, b1 = rows[i + 1]
        acc.f([a0, b0, b1, a1], MAT_WIND, [(u0, 0), (u0, 1), (u1, 1), (u1, 0)], [(1, 1, 1, 1)] * 4)


def build_wind(acc):
    # the mane: six ribbons rising off the crest and streaming back in loose spirals, so the wind
    # reads as a swirl rather than a fringe of blades
    for k in range(6):
        s = k / 5
        p = Vector(NECK[0][0]).lerp(Vector(NECK[-1][0]), 0.1 + 0.84 * s)
        rad = 0.44 - 0.2 * s
        root = p + Vector((0, 0.12, rad * 0.9 + 0.04))
        pts = []
        sgn = 1 if k % 2 else -1
        # each ribbon its own length, lift and curl, so the mane reads as wind, not a comb
        reach = 1.0 + 0.55 * B.h01("mane-len", k)
        rise = 0.32 + 0.4 * B.h01("mane-rise", k)
        for i in range(16):
            u = i / 15
            ang = u * (2.8 + 1.4 * B.h01("mane-curl", k)) + k * 1.1
            r = 0.04 + (0.1 + 0.08 * B.h01("mane-r", k)) * u
            pts.append(root + Vector((sgn * r * math.cos(ang), reach * u + r * math.sin(ang) * 0.5,
                                      rise * u - 0.22 * u * u + 0.1 * r * math.sin(ang))))
        bone = "neck1" if root.z < 3.1 else ("neck2" if root.z < 3.7 else "head")
        ribbon(acc, pts, 0.4 - 0.02 * k, lambda u, b=bone: {b: 1.0}, twist=1.4 + 0.3 * k, tag=f"mane{k}")
    # the forelock: one short ribbon blown back between the horns
    root = Vector((0, -2.02, 4.0))
    pts = [root + Vector((0.07 * math.sin(u * 5), 0.62 * u, 0.2 * u - 0.05 * u * u)) for u in (i / 9 for i in range(10))]
    ribbon(acc, pts, 0.17, lambda u: {"head": 1.0}, twist=2.6, tag="forelock")
    # the tail: four ribbons spiralling off the last stone, falling the way a horse's tail falls
    tip = Vector(TAIL[-1][0])
    for k in range(4):
        ph = math.tau * k / 4
        pts = []
        for i in range(16):
            u = i / 15
            r = 0.06 + 0.2 * u
            pts.append(tip + Vector((r * math.cos(ph + u * 5.0), 0.12 + 0.62 * u + 0.12 * math.sin(ph + u * 5.0),
                                     -0.08 - 1.05 * u + 0.25 * u * u)))
        ribbon(acc, pts, 0.4, lambda u: {"tail3": 1.0}, twist=1.6, tag=f"tail{k}")
    # wind wisps trailing off each fetlock, like feathering
    for side, sx in (("L", 1), ("R", -1)):
        for fx, fy, bone in ((0.42, -0.95, f"hoofF.{side}"), (0.47, 1.1, f"hoofH.{side}")):
            root = Vector((fx * sx, fy + 0.1, 0.42))
            pts = [root + Vector((0.04 * sx * math.sin(u * 3), 0.5 * u, -0.05 * u + 0.1 * u * u)) for u in (i / 6 for i in range(7))]
            ribbon(acc, pts, 0.2, lambda u, b=bone: {b: 1.0}, twist=1.2, tag=f"wisp{side}{fy}")


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------


def to_object(acc, mats):
    me = bpy.data.meshes.new("Quarryheart")
    faces = [f for (f, _, _) in acc.faces]
    me.from_pydata([tuple(p) for p in acc.co], [], faces)
    me.update()
    for m in mats:
        me.materials.append(m)
    for poly, (_, mi, smooth) in zip(me.polygons, acc.faces):
        poly.material_index = mi
        poly.use_smooth = smooth
    uv = me.uv_layers.new(name="UVMap")
    col = me.color_attributes.new(name="Shade", type="BYTE_COLOR", domain="CORNER")
    li = 0
    for poly, uvs, cols in zip(me.polygons, acc.uv, acc.col):
        for k, loop in enumerate(poly.loop_indices):
            uv.data[loop].uv = uvs[k]
            col.data[loop].color = cols[k]
            li += 1
    me.color_attributes.active_color = col
    for name, data, kind in (("_DIR", acc.dir, "FLOAT_VECTOR"), ("_CEN", acc.cen, "FLOAT_VECTOR"),
                             ("_KIND", acc.kind, "FLOAT")):
        at = me.attributes.new(name=name, type=kind, domain="POINT")
        if kind == "FLOAT":
            at.data.foreach_set("value", list(data))
        else:
            flat = [c for v in data for c in v]
            at.data.foreach_set("vector", flat)
    obj = bpy.data.objects.new("Quarryheart", me)
    bpy.context.scene.collection.objects.link(obj)
    groups = {}
    for i, w in enumerate(acc.w):
        tot = sum(w.values())
        for bone, x in w.items():
            g = groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([i], x / tot, "REPLACE")
    return obj


def build_armature():
    arm_data = bpy.data.armatures.new("QuarryheartCharger")
    arm = bpy.data.objects.new("QuarryheartCharger", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in R.BONES:
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = tail
        b.roll = 0.0
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export(arm, body, path):
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_skins=True,
        export_def_bones=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_attributes=True,
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in props:
        kw["export_vertex_color"] = "ACTIVE"
    if "export_all_vertex_colors" in props:
        kw["export_all_vertex_colors"] = False
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})


def measure(arm, body):
    """The Idle's height on its first frame, the saddle bone's head, the gait references."""
    arm.animation_data.action = bpy.data.actions["Charger|Idle"]
    bpy.context.scene.frame_set(1)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    ys = [(ev.matrix_world @ v.co).y for v in ev.data.vertices]
    saddle = arm.matrix_world @ arm.pose.bones["saddle"].head
    return {
        "height": max(zs) - min(zs),
        "min_z": min(zs),
        "length": max(ys) - min(ys),
        "saddle": tuple(round(c, 4) for c in saddle),
        "walkRef": R.gait_ref(R.WALK),
        "runRef": R.gait_ref(R.RUN),
        "walkBackRef": R.gait_ref(R.BACK),
    }


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = R.FPS
    base_img, glow_img = A.paint()
    stone = stone_material(base_img, glow_img)
    wind = wind_material()
    acc = B.MeshAcc()
    build_torso(acc)
    build_saddle(acc)
    build_neck(acc)
    build_head(acc)
    build_tail(acc)
    build_legs(acc)
    build_wind(acc)
    body = to_object(acc, [stone, wind])
    arm = build_armature()
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    P = R.Poser(arm)
    for name, seconds, ctl in R.CLIPS:
        R.bake_clip(P, arm, name, seconds, ctl)
    return arm, body


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    blend = argv[argv.index("--blend") + 1] if "--blend" in argv else None
    arm, body = build()
    m = measure(arm, body)
    print("CHARGER_REPORT tris=%d verts=%d bones=%d height=%.4f min_z=%.4f length=%.3f saddle=%s "
          "walkRef=%.3f runRef=%.3f walkBackRef=%.3f" % (
              tri_count(body), len(body.data.vertices), len(arm.data.bones), m["height"], m["min_z"],
              m["length"], m["saddle"], m["walkRef"], m["runRef"], m["walkBackRef"]))
    if out:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        export(arm, body, out)
    arm.animation_data.action = bpy.data.actions["Charger|Idle"]
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)


if __name__ == "__main__":
    main()
