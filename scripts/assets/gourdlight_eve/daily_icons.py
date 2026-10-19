# Gourdlight Eve's rotating dailies: the icons of their three errand items
# (src/sim/content/gourdlight_eve_dailies.ts), built for icons.py the way candies.py
# builds Hester's sweets: a stray pumpkin from Old Thatchgrin's patch, a cursed candle
# stub and a Gourdlight crow's feather.
#
# Each builder takes (col, principled, obj_from_bm, tube, lathe, model) from icons.py and
# returns the subject's root empty. Deterministic: no clock, no `random`.

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2.0


def build_patch_pumpkin(col, principled, obj_from_bm, tube, lathe, model):
    """A stray pumpkin from Old Thatchgrin's patch: the factory's own ribbed gourd in a
    deep harvest orange, its vine curling off the stem with a leaf and a tendril, a few
    stalks of his straw caught under it."""
    root = bpy.data.objects.new("patch_pumpkin", None)
    col.objects.link(root)
    model.plain_gourd("patch_pumpkin_body", "patch-pumpkin-icon", col, 0.42, 0.5, 10,
                      model.PALETTE_ORANGE, (0.0, 0.0, 0.25), segs=40, rings=20)
    bpy.data.objects["patch_pumpkin_body"].parent = root
    vine = principled("PatchVine", (0.22, 0.3, 0.08), rough=0.7)
    leaf = principled("PatchLeaf", (0.3, 0.42, 0.1), rough=0.6)
    straw = principled("PatchStraw", (0.82, 0.62, 0.3), rough=0.9)
    vbm = bmesh.new()
    pts = [Vector((0.04 + 0.06 * k, -0.02 * k, 0.62 + 0.05 * math.sin(k * 0.9) - 0.02 * k)) for k in range(9)]
    tube(vbm, pts, 0.018)
    curl = [Vector((0.5 + 0.08 * math.cos(k * 0.6), -0.18 + 0.08 * math.sin(k * 0.6), 0.5 + 0.006 * k))
            for k in range(14)]
    tube(vbm, curl, 0.006)
    obj_from_bm("patch_vine", vbm, vine, col).parent = root
    lbm = model.leaf_bm("patch-leaf", 0.22, (0.36, -0.12, 0.6), 0.6, 0.06)
    obj_from_bm("patch_leaf", lbm, leaf, col).parent = root
    sbm = bmesh.new()
    for k in range(9):
        a = k / 9 * TAU + 0.3
        base = Vector((math.cos(a) * 0.36, math.sin(a) * 0.36, 0.03))
        tip = base + Vector((math.cos(a + 0.4) * 0.28, math.sin(a + 0.4) * 0.28, 0.02))
        tube(sbm, [base, (base + tip) / 2 + Vector((0, 0, 0.02)), tip], 0.008, 5)
    obj_from_bm("patch_straw", sbm, straw, col).parent = root
    root.rotation_euler = (0.0, 0.0, 0.5)
    return root


def build_cursed_candle(col, principled, obj_from_bm, tube, lathe, model):
    """A cursed candle stub: a squat stub of grey-green wax, drips frozen down its sides
    and pooled on an old iron dish, its wick burning a cold green flame."""
    wax = principled("CursedWax", (0.52, 0.56, 0.44), rough=0.55, emit=(0.2, 0.9, 0.35), emit_strength=0.08)
    iron = principled("CursedDish", (0.09, 0.08, 0.075), rough=0.45, metal=0.8)
    wick = principled("CursedWick", (0.04, 0.035, 0.03), rough=0.9)
    flame = principled("CursedFlame", (0.4, 1.0, 0.5), emit=(0.25, 1.0, 0.45), emit_strength=14.0)
    core = principled("CursedFlameCore", (0.9, 1.0, 0.85), emit=(0.85, 1.0, 0.8), emit_strength=22.0)
    root = bpy.data.objects.new("cursed_candle", None)
    col.objects.link(root)
    dbm = bmesh.new()
    lathe(dbm, [(0.0, 0.0), (0.34, 0.0), (0.38, 0.04), (0.36, 0.07), (0.3, 0.05), (0.0, 0.05)], 32)
    obj_from_bm("cursed_dish", dbm, iron, col).parent = root
    wbm = bmesh.new()
    lathe(wbm, [(0.0, 0.05), (0.2, 0.05), (0.17, 0.08), (0.16, 0.36), (0.15, 0.43), (0.12, 0.46), (0.0, 0.45)], 28)
    for k in range(7):
        a = k / 7 * TAU + 0.4
        ln = 0.12 + 0.2 * ((k * 37) % 7) / 7
        top = Vector((math.cos(a) * 0.155, math.sin(a) * 0.155, 0.43))
        mid = top + Vector((math.cos(a) * 0.012, math.sin(a) * 0.012, -ln * 0.5))
        end = top + Vector((math.cos(a) * 0.02, math.sin(a) * 0.02, -ln))
        tube(wbm, [top, mid, end], 0.022, 6)
        bmesh.ops.create_icosphere(wbm, subdivisions=1, radius=0.028, matrix=Matrix.Translation(end))
    lathe(wbm, [(0.0, 0.05), (0.27, 0.05), (0.25, 0.07), (0.0, 0.075)], 28)
    obj_from_bm("cursed_wax", wbm, wax, col).parent = root
    kbm = bmesh.new()
    tube(kbm, [Vector((0, 0, 0.44)), Vector((0.01, 0, 0.5)), Vector((0.02, 0.0, 0.53))], 0.008, 5)
    obj_from_bm("cursed_wick", kbm, wick, col).parent = root
    fbm = bmesh.new()
    bmesh.ops.create_uvsphere(fbm, u_segments=16, v_segments=10, radius=1.0)
    for v in fbm.verts:
        x, y, z = v.co
        sh = 1.0 - 0.75 * max(0.0, z)
        v.co = Vector((x * 0.055 * sh, y * 0.055 * sh, 0.6 + z * 0.12 + 0.03 * z * z))
    obj_from_bm("cursed_flame", fbm, flame, col).parent = root
    cbm = bmesh.new()
    bmesh.ops.create_icosphere(cbm, subdivisions=2, radius=0.028, matrix=Matrix.Translation((0.0, 0.0, 0.57)))
    obj_from_bm("cursed_flame_core", cbm, core, col).parent = root
    light = bpy.data.objects.new("cursed_glow", bpy.data.lights.new("cursed_glow", "POINT"))
    light.data.energy = 30
    light.data.color = (0.35, 1.0, 0.5)
    light.data.shadow_soft_size = 0.1
    light.location = (0.0, -0.2, 0.62)
    col.objects.link(light)
    light.parent = root
    root.rotation_euler = (0.0, 0.0, 0.3)
    return root


def build_crow_feather(col, principled, obj_from_bm, tube, lathe, model):
    """A Gourdlight crow's flight feather: a long glossy black vane on a pale quill,
    curving as it lies, a blue-green sheen on its barbs, an ember caught at its tip."""
    vane = principled("CrowVane", (0.02, 0.02, 0.025), rough=0.32, metal=0.15)
    sheen = principled("CrowSheen", (0.03, 0.08, 0.09), rough=0.25, metal=0.4)
    quill = principled("CrowQuill", (0.62, 0.58, 0.5), rough=0.5)
    ember = principled("CrowEmber", (1.0, 0.35, 0.05), emit=(1.0, 0.4, 0.06), emit_strength=6.0)
    root = bpy.data.objects.new("crow_feather", None)
    col.objects.link(root)
    n = 26
    spine = []
    for i in range(n + 1):
        t = i / n
        spine.append(Vector((0.12 * math.sin(t * 1.4), 0.03 * math.sin(t * math.pi), -0.55 + 1.1 * t)))
    qbm = bmesh.new()
    tube(qbm, spine, 0.012, 6)
    obj_from_bm("crow_quill", qbm, quill, col).parent = root
    layers = (("crow_vane_a", vane, 1, 0.0, 1.0), ("crow_vane_b", vane, -1, 0.0, 1.0),
              ("crow_sheen_a", sheen, 1, 0.004, 0.55), ("crow_sheen_b", sheen, -1, 0.004, 0.55))
    for name, mat, side, lift, width_scale in layers:
        vbm = bmesh.new()
        prev = None
        for i in range(4, n + 1):
            t = i / n
            span = min(1.0, (t - 0.12) / 0.88)
            w = (0.16 if side > 0 else 0.11) * math.sin(span * math.pi * 0.92) * width_scale
            base = spine[i]
            drop = -0.1 * w if i % 5 == 0 else -0.07 * w
            reach = 0.82 if i % 5 == 0 else 1.0
            v0 = vbm.verts.new(base + Vector((0, -lift, 0)))
            v1 = vbm.verts.new(base + Vector((side * w * reach, -0.02 - lift, drop)))
            if prev:
                if side > 0:
                    vbm.faces.new((prev[0], v0, v1, prev[1]))
                else:
                    vbm.faces.new((prev[1], v1, v0, prev[0]))
            prev = (v0, v1)
        obj = obj_from_bm(name, vbm, mat, col)
        obj.parent = root
        sol = obj.modifiers.new("thick", "SOLIDIFY")
        sol.thickness = 0.006
    ebm = bmesh.new()
    for dx, dz, r in ((0.02, 0.0, 0.03), (-0.03, -0.04, 0.02), (0.05, -0.07, 0.016)):
        bmesh.ops.create_icosphere(ebm, subdivisions=2, radius=r,
                                   matrix=Matrix.Translation(spine[-1] + Vector((dx, -0.03, dz))))
    obj_from_bm("crow_ember", ebm, ember, col).parent = root
    glow = bpy.data.objects.new("crow_glow", bpy.data.lights.new("crow_glow", "POINT"))
    glow.data.energy = 8
    glow.data.color = (1.0, 0.5, 0.15)
    glow.location = spine[-1] + Vector((0.0, -0.2, 0.0))
    col.objects.link(glow)
    glow.parent = root
    root.rotation_euler = (0.0, -0.7, 0.0)
    return root


BUILDERS = {
    "thatchgrin_patch_pumpkin": build_patch_pumpkin,
    "cursed_candle_stub": build_cursed_candle,
    "gourdlight_crow_feather": build_crow_feather,
}
