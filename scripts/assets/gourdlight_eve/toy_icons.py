# Hester's toys (round 9, the cauldron round 10): the icons of the five toys on her shelf
# (src/sim/content/gourdlight_eve.ts GOURDLIGHT_TOYS), built for icons.py the way
# daily_icons.py builds the errand items:
#   prankers_pumpkin         a small carved pumpkin with a cheeky fanged grin, lit inside,
#                            a ribbon bow on its stem and a drip of pulp off its chin
#   wanderwisp_lantern       a little square iron lantern, its pale glass lit by a tiny
#                            ghost curled inside, wisps leaking from its cap
#   sack_of_startled_bats    a burlap sack, its drawstring open, three bats bursting out
#   murmurwick_candle        three grey-green candles on an iron dish, cold green flames,
#                            a curl of green mist round the dish
#   gurglegreen_cauldron     a squat iron cauldron brimming with a glowing green brew,
#                            bubbles on its surface, steam curling up, embers beneath
#
# Each builder takes (col, principled, obj_from_bm, tube, lathe, model) from icons.py and
# returns the subject's root empty. Deterministic: no clock, no `random`.

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2.0


def _root(col, name):
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    return root


def _glow(col, root, name, color, energy, loc):
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, "POINT"))
    light.data.energy = energy
    light.data.color = color
    light.data.shadow_soft_size = 0.15
    light.location = loc
    col.objects.link(light)
    light.parent = root


def build_prank_pumpkin(col, principled, obj_from_bm, tube, lathe, model):
    root = _root(col, "prank_pumpkin")
    body = model.carved_pumpkin("prank_pumpkin_body", "prank-pumpkin", col, 0.42, 0.5, 9, "fang",
                                40, 22, model.PALETTE_ORANGE)
    body.parent = root
    ribbon = principled("PrankRibbon", (0.05, 0.6, 0.12), rough=0.4)
    pulp = principled("PrankPulp", (1.0, 0.62, 0.12), rough=0.25, emit=(1.0, 0.5, 0.08), emit_strength=0.6)
    seed = principled("PrankSeed", (0.95, 0.88, 0.62), rough=0.4)
    # a green bow tied round the stem: two loops and two tails
    rbm = bmesh.new()
    for side in (-1, 1):
        loop = [Vector((side * (0.02 + 0.16 * math.sin(k / 16 * math.pi)), 0.04 * math.cos(k / 16 * TAU),
                        0.3 + 0.09 * math.sin(k / 16 * TAU))) for k in range(17)]
        tube(rbm, loop, 0.02, 6)
        tail = [Vector((side * (0.03 + 0.06 * k), -0.05, 0.28 - 0.05 * k)) for k in range(4)]
        tube(rbm, tail, 0.016, 6)
    bmesh.ops.create_icosphere(rbm, subdivisions=2, radius=0.04, matrix=Matrix.Translation((0, -0.02, 0.3)))
    obj_from_bm("prank_ribbon", rbm, ribbon, col).parent = root
    # a drip of pulp off its chin and seeds flying
    pbm = bmesh.new()
    for k, (x, z, r) in enumerate(((0.12, 0.06, 0.07), (0.2, 0.0, 0.05), (0.15, -0.06, 0.04), (0.17, -0.12, 0.03))):
        bmesh.ops.create_icosphere(pbm, subdivisions=2, radius=r,
                                   matrix=Matrix.Translation((x, -0.4 + 0.02 * k, z)) @ Matrix.Diagonal((1.3, 0.6, 1.0, 1)))
    obj_from_bm("prank_pulp", pbm, pulp, col).parent = root
    sbm = bmesh.new()
    for k in range(7):
        a = k / 7 * TAU + 0.4
        m = Matrix.Translation((math.cos(a) * 0.62, -0.25 + 0.1 * math.sin(a * 2), 0.1 + 0.32 * math.sin(a))) @ \
            Matrix.Rotation(a, 4, "Y") @ Matrix.Diagonal((0.035, 0.012, 0.055, 1))
        bmesh.ops.create_icosphere(sbm, subdivisions=1, radius=1.0, matrix=m)
    obj_from_bm("prank_seeds", sbm, seed, col).parent = root
    _glow(col, root, "prank_glow", (1.0, 0.55, 0.15), 18, (0.0, -0.5, 0.05))
    root.rotation_euler = (0.1, 0.0, -0.3)
    return root


def build_wanderwisp_lantern(col, principled, obj_from_bm, tube, lathe, model):
    root = _root(col, "wanderwisp_lantern")
    iron = principled("WispIron", (0.07, 0.065, 0.075), rough=0.4, metal=0.85)
    glass = principled("WispGlass", (0.45, 0.7, 0.95), rough=0.05, emit=(0.3, 0.6, 1.0), emit_strength=0.35, alpha=0.22)
    ghost = principled("WispGhost", (0.75, 0.9, 1.0), rough=0.3, emit=(0.45, 0.8, 1.0), emit_strength=4.0)
    puff = principled("WispPuff", (0.6, 0.85, 1.0), rough=0.5, emit=(0.4, 0.75, 1.0), emit_strength=1.5, alpha=0.4)
    eye = principled("WispEye", (0.01, 0.02, 0.05), rough=0.6)
    ibm = bmesh.new()
    bmesh.ops.create_cube(ibm, size=1.0, matrix=Matrix.Translation((0, 0, 0.03)) @ Matrix.Diagonal((0.62, 0.62, 0.06, 1)))
    bmesh.ops.create_cube(ibm, size=1.0, matrix=Matrix.Translation((0, 0, 0.09)) @ Matrix.Diagonal((0.5, 0.5, 0.06, 1)))
    for x, y in ((-0.24, -0.24), (0.24, -0.24), (-0.24, 0.24), (0.24, 0.24)):
        tube(ibm, [Vector((x, y, 0.1)), Vector((x, y, 0.82))], 0.025, 6)
    bmesh.ops.create_cube(ibm, size=1.0, matrix=Matrix.Translation((0, 0, 0.84)) @ Matrix.Diagonal((0.56, 0.56, 0.05, 1)))
    bmesh.ops.create_cone(ibm, cap_ends=True, segments=4, radius1=0.42, radius2=0.04, depth=0.3,
                          matrix=Matrix.Translation((0, 0, 1.01)) @ Matrix.Rotation(math.pi / 4, 4, "Z"))
    ring = [Vector((0.12 * math.cos(k / 20 * TAU), 0, 1.28 + 0.12 * math.sin(k / 20 * TAU))) for k in range(21)]
    tube(ibm, ring, 0.02, 6)
    obj_from_bm("wisp_iron", ibm, iron, col).parent = root
    gbm = bmesh.new()
    bmesh.ops.create_cube(gbm, size=1.0, matrix=Matrix.Translation((0, 0, 0.46)) @ Matrix.Diagonal((0.44, 0.44, 0.7, 1)))
    obj_from_bm("wisp_glass", gbm, glass, col).parent = root
    # the tiny ghost curled inside: a round head over a tapering, curling tail
    hbm = bmesh.new()
    bmesh.ops.create_uvsphere(hbm, u_segments=20, v_segments=12, radius=0.13, matrix=Matrix.Translation((0, 0, 0.6)))
    tail = [Vector((0.05 * math.sin(k * 0.8), 0.03 * math.cos(k * 0.8), 0.52 - 0.045 * k)) for k in range(7)]
    prev = None
    for k, c in enumerate(tail):
        w = 0.1 * (1 - k / 7) + 0.015
        ringv = [hbm.verts.new(c + Vector((math.cos(a / 10 * TAU) * w, math.sin(a / 10 * TAU) * w, 0))) for a in range(10)]
        if prev:
            for a in range(10):
                hbm.faces.new((prev[a], prev[(a + 1) % 10], ringv[(a + 1) % 10], ringv[a]))
        prev = ringv
    obj_from_bm("wisp_ghost", hbm, ghost, col).parent = root
    ebm = bmesh.new()
    for x in (-0.04, 0.04):
        bmesh.ops.create_icosphere(ebm, subdivisions=1, radius=0.022, matrix=Matrix.Translation((x, -0.1, 0.6)))
    obj_from_bm("wisp_eyes", ebm, eye, col).parent = root
    # wisps curling up off the cap
    wbm = bmesh.new()
    for k in range(6):
        loc = (0.12 * math.sin(k * 1.3) + 0.03 * k, -0.05, 1.18 + 0.1 * k)
        bmesh.ops.create_icosphere(wbm, subdivisions=2, radius=0.07 - 0.008 * k, matrix=Matrix.Translation(loc))
    obj_from_bm("wisp_trail", wbm, puff, col).parent = root
    _glow(col, root, "wisp_light", (0.5, 0.8, 1.0), 14, (0.0, -0.45, 0.55))
    root.rotation_euler = (0.0, 0.0, 0.35)
    return root


def _bat(col, principled, name, loc, yaw, scale, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0,
                              matrix=Matrix.Diagonal((0.06, 0.05, 0.08, 1)))
    for s in (-1, 1):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.022, radius2=0.0, depth=0.06,
                              matrix=Matrix.Translation((s * 0.03, 0.0, 0.1)))
        pts = [(0.03, 0.0, 0.02), (0.16, 0.0, 0.1), (0.3, 0.0, 0.06), (0.38, 0.0, -0.02),
               (0.3, 0.0, -0.05), (0.22, 0.0, -0.02), (0.14, 0.0, -0.06), (0.04, 0.0, -0.03)]
        verts = [bm.verts.new((s * x, y, z)) for x, y, z in pts]
        bm.faces.new(verts if s > 0 else list(reversed(verts)))
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm.to_mesh(obj.data)
    obj.data.materials.append(mat)
    col.objects.link(obj)
    sol = obj.modifiers.new("t", "SOLIDIFY")
    sol.thickness = 0.01
    obj.location = loc
    obj.rotation_euler = (0.3, yaw, 0.2)
    obj.scale = (scale, scale, scale)
    return obj


def build_startled_bats(col, principled, obj_from_bm, tube, lathe, model):
    root = _root(col, "startled_bats")
    sack = principled("BatSack", (0.5, 0.37, 0.22), rough=0.92)
    cord = principled("BatCord", (0.85, 0.35, 0.06), rough=0.6)
    bat = principled("BatHide", (0.06, 0.035, 0.075), rough=0.55)
    eye = principled("BatEye", (1.0, 0.75, 0.2), emit=(1.0, 0.6, 0.1), emit_strength=8.0)
    bm = bmesh.new()
    prof = [(0.0, 0.0), (0.3, 0.02), (0.42, 0.14), (0.45, 0.32), (0.4, 0.5), (0.28, 0.62),
            (0.22, 0.68), (0.3, 0.76), (0.36, 0.8)]
    rings = []
    segs = 32
    for k, (r, z) in enumerate(prof):
        ring = []
        for a in range(segs):
            ang = a / segs * TAU
            rr = r * (1.0 + 0.05 * math.sin(ang * 5 + k) + (0.08 * math.sin(ang * 9) if z > 0.7 else 0))
            ring.append(bm.verts.new((math.cos(ang) * rr, math.sin(ang) * rr, z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for a in range(segs):
            bm.faces.new((rings[i][a], rings[i][(a + 1) % segs], rings[i + 1][(a + 1) % segs], rings[i + 1][a]))
    bm.faces.new(list(reversed(rings[0])))
    s_obj = obj_from_bm("bat_sack", bm, sack, col)
    s_obj.modifiers.new("t", "SOLIDIFY").thickness = 0.02
    s_obj.parent = root
    cbm = bmesh.new()
    loop = [Vector((0.235 * math.cos(k / 24 * TAU), 0.235 * math.sin(k / 24 * TAU), 0.66)) for k in range(25)]
    tube(cbm, loop, 0.018, 6)
    tube(cbm, [Vector((0.22, -0.08, 0.66)), Vector((0.36, -0.2, 0.5)), Vector((0.4, -0.24, 0.36))], 0.014, 6)
    obj_from_bm("bat_cord", cbm, cord, col).parent = root
    bats = [((0.05, -0.1, 1.05), 0.3, 1.25), ((-0.42, -0.15, 1.35), -0.4, 1.0), ((0.46, -0.05, 1.55), 0.7, 0.85)]
    for i, (loc, yaw, sc) in enumerate(bats):
        b = _bat(col, principled, "bat_%d" % i, loc, yaw, sc, bat)
        b.parent = root
        ebm = bmesh.new()
        for x in (-0.022, 0.022):
            bmesh.ops.create_icosphere(ebm, subdivisions=1, radius=0.012,
                                       matrix=Matrix.Translation((loc[0] + x * sc, loc[1] - 0.075 * sc, loc[2] + 0.03 * sc)))
        obj_from_bm("bat_eyes_%d" % i, ebm, eye, col).parent = root
    root.rotation_euler = (0.0, 0.0, 0.2)
    return root


def build_murmurwick_candle(col, principled, obj_from_bm, tube, lathe, model):
    root = _root(col, "murmurwick_candle")
    wax = principled("MurmurWax", (0.55, 0.6, 0.48), rough=0.5, emit=(0.2, 0.9, 0.35), emit_strength=0.06)
    iron = principled("MurmurDish", (0.08, 0.075, 0.07), rough=0.45, metal=0.8)
    wick = principled("MurmurWick", (0.04, 0.035, 0.03), rough=0.9)
    flame = principled("MurmurFlame", (0.3, 1.0, 0.45), emit=(0.15, 1.0, 0.3), emit_strength=5.0)
    mist = principled("MurmurMist", (0.25, 0.8, 0.4), rough=0.8, emit=(0.15, 0.7, 0.3), emit_strength=0.9, alpha=0.3)
    dbm = bmesh.new()
    lathe(dbm, [(0.0, 0.0), (0.5, 0.0), (0.56, 0.05), (0.54, 0.09), (0.46, 0.07), (0.0, 0.07)], 36)
    obj_from_bm("murmur_dish", dbm, iron, col).parent = root
    tops = [((0.0, 0.05), 0.62, 0.11), ((0.24, -0.12), 0.38, 0.085), ((-0.22, -0.08), 0.28, 0.08)]
    wbm = bmesh.new()
    kbm = bmesh.new()
    fbm = bmesh.new()
    for k, ((x, y), h, r) in enumerate(tops):
        prof = [(0.0, 0.07), (r, 0.07), (r * 0.95, 0.07 + h * 0.6), (r * 0.9, 0.07 + h), (0.0, 0.07 + h - 0.01)]
        rings = lathe(wbm, prof, 24)
        for ring in rings:
            for v in ring:
                v.co.x += x
                v.co.y += y
        for d in range(5):
            a = d / 5 * TAU + k
            ln = 0.08 + 0.12 * ((d * 31 + k * 7) % 5) / 5
            top = Vector((x + math.cos(a) * r * 0.95, y + math.sin(a) * r * 0.95, 0.07 + h - 0.02))
            end = top + Vector((math.cos(a) * 0.012, math.sin(a) * 0.012, -ln))
            tube(wbm, [top, (top + end) / 2, end], 0.016, 6)
            bmesh.ops.create_icosphere(wbm, subdivisions=1, radius=0.02, matrix=Matrix.Translation(end))
        tube(kbm, [Vector((x, y, 0.06 + h)), Vector((x + 0.005, y, 0.1 + h))], 0.007, 5)
        sbm = bmesh.new()
        bmesh.ops.create_uvsphere(sbm, u_segments=14, v_segments=10, radius=1.0)
        for v in sbm.verts:
            vx, vy, vz = v.co
            sh = 1.0 - 0.75 * max(0.0, vz)
            v.co = Vector((x + vx * 0.045 * sh, y + vy * 0.045 * sh, 0.2 + h + vz * 0.1 + 0.02 * vz * vz))
        sbm.to_mesh(me := bpy.data.meshes.new("murmur_flame_%d" % k))
        o = bpy.data.objects.new("murmur_flame_%d" % k, me)
        o.data.materials.append(flame)
        col.objects.link(o)
        o.parent = root
        sbm.free()
    obj_from_bm("murmur_wax", wbm, wax, col).parent = root
    obj_from_bm("murmur_wick", kbm, wick, col).parent = root
    fbm.free()
    # the mist curling round the dish
    mbm = bmesh.new()
    for k in range(14):
        a = k / 14 * TAU + 0.3
        r = 0.55 + 0.12 * math.sin(k * 2.1)
        m = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0.06 + 0.03 * math.sin(k))) @ \
            Matrix.Diagonal((0.2, 0.2, 0.07, 1))
        bmesh.ops.create_icosphere(mbm, subdivisions=2, radius=1.0, matrix=m)
    obj_from_bm("murmur_mist", mbm, mist, col).parent = root
    _glow(col, root, "murmur_glow", (0.35, 1.0, 0.5), 40, (0.0, -0.35, 0.85))
    root.rotation_euler = (0.0, 0.0, 0.25)
    return root


def build_gurglegreen_cauldron(col, principled, obj_from_bm, tube, lathe, model):
    """Round 10: a squat black iron cauldron on three claw feet, a thick rolled rim and two
    ring handles, brimming with a glowing green brew: bubbles swelling on its surface, a
    run of brew down its belly, a wooden ladle hooked over the lip, green steam curling up
    and embers glowing beneath it."""
    root = _root(col, "gurglegreen_cauldron")
    iron = principled("GurgleIron", (0.06, 0.058, 0.065), rough=0.42, metal=0.85)
    rimiron = principled("GurgleRim", (0.11, 0.105, 0.115), rough=0.35, metal=0.9)
    brew = principled("GurgleBrew", (0.1, 0.7, 0.2), rough=0.15, emit=(0.15, 0.95, 0.25), emit_strength=1.4)
    bubble = principled("GurgleBubble", (0.45, 1.0, 0.5), rough=0.05, emit=(0.4, 1.0, 0.45), emit_strength=4.5)
    drip = principled("GurgleDrip", (0.15, 0.75, 0.25), rough=0.2, emit=(0.15, 0.85, 0.25), emit_strength=1.6)
    wood = principled("GurgleLadle", (0.42, 0.26, 0.13), rough=0.6)
    steam = principled("GurgleSteam", (0.45, 0.9, 0.5), rough=0.7, emit=(0.3, 0.9, 0.4), emit_strength=0.5, alpha=0.22)
    ember = principled("GurgleEmber", (0.9, 0.25, 0.04), emit=(1.0, 0.28, 0.03), emit_strength=4.0)
    # the pot: a round belly narrowing to a rolled lip, hollow inside
    pbm = bmesh.new()
    lathe(pbm, [(0.0, 0.14), (0.3, 0.14), (0.52, 0.24), (0.64, 0.42), (0.65, 0.58), (0.58, 0.74),
                (0.5, 0.8), (0.47, 0.8), (0.44, 0.74), (0.0, 0.74)], 44)
    obj_from_bm("gurgle_pot", pbm, iron, col).parent = root
    rbm = bmesh.new()
    ring = [Vector((0.49 * math.cos(k / 48 * TAU), 0.49 * math.sin(k / 48 * TAU), 0.81)) for k in range(49)]
    tube(rbm, ring, 0.05, 10)
    for side in (-1, 1):
        loop = [Vector((side * (0.66 + 0.1 * (1 - math.cos(k / 16 * TAU))), 0.0,
                        0.66 + 0.11 * math.sin(k / 16 * TAU))) for k in range(17)]
        tube(rbm, loop, 0.022, 8)
    for k in range(3):
        a = k / 3 * TAU + 0.5
        top = Vector((math.cos(a) * 0.38, math.sin(a) * 0.38, 0.2))
        foot = Vector((math.cos(a) * 0.48, math.sin(a) * 0.48, 0.02))
        tube(rbm, [top, (top + foot) / 2 + Vector((0, 0, -0.02)), foot], 0.06, 8)
        bmesh.ops.create_icosphere(rbm, subdivisions=2, radius=0.075, matrix=Matrix.Translation(foot) @ Matrix.Diagonal((1.3, 1.3, 0.6, 1)))
    obj_from_bm("gurgle_rim", rbm, rimiron, col).parent = root
    # the brew: a domed glowing surface just under the lip, bubbles swelling on it
    bbm = bmesh.new()
    bmesh.ops.create_circle(bbm, cap_ends=True, segments=40, radius=0.46, matrix=Matrix.Translation((0, 0, 0.77)))
    obj_from_bm("gurgle_brew", bbm, brew, col).parent = root
    ubm = bmesh.new()
    for k, (x, y, r) in enumerate(((0.1, -0.12, 0.11), (-0.18, 0.05, 0.08), (0.2, 0.16, 0.07), (-0.05, 0.22, 0.06),
                                   (0.27, -0.05, 0.05), (-0.25, -0.18, 0.06), (0.02, 0.02, 0.05))):
        bmesh.ops.create_uvsphere(ubm, u_segments=16, v_segments=10, radius=r,
                                  matrix=Matrix.Translation((x, y, 0.78)) @ Matrix.Diagonal((1, 1, 0.8, 1)))
    # and a few bubbles bursting up off it
    for k, (x, y, z, r) in enumerate(((0.05, -0.1, 1.0, 0.045), (-0.12, 0.05, 1.15, 0.035), (0.16, 0.08, 1.28, 0.03))):
        bmesh.ops.create_uvsphere(ubm, u_segments=12, v_segments=8, radius=r, matrix=Matrix.Translation((x, y, z)))
    obj_from_bm("gurgle_bubbles", ubm, bubble, col).parent = root
    # a run of brew boiled over the lip and down the belly toward the camera
    dbm = bmesh.new()
    for k, (a, ln) in enumerate(((-1.75, 0.34), (-1.45, 0.22), (-2.05, 0.18))):
        pts = []
        for s in range(7):
            u = s / 6
            z = 0.8 - ln * u
            # hug the belly: the pot's own profile radius at this height, a hair outside it
            prof = ((0.8, 0.5), (0.74, 0.58), (0.58, 0.65), (0.42, 0.64), (0.24, 0.52))
            r = 0.5
            for (z0, r0), (z1, r1) in zip(prof, prof[1:]):
                if z1 <= z <= z0:
                    r = r0 + (r1 - r0) * (z0 - z) / (z0 - z1)
            r += 0.02
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
        tube(dbm, pts, 0.03 - 0.004 * k, 6)
        bmesh.ops.create_icosphere(dbm, subdivisions=1, radius=0.04, matrix=Matrix.Translation(pts[-1]))
    obj_from_bm("gurgle_drips", dbm, drip, col).parent = root
    # the ladle hooked over the back of the lip
    lbm = bmesh.new()
    tube(lbm, [Vector((0.05, 0.3, 0.7)), Vector((0.08, 0.42, 0.95)), Vector((0.1, 0.5, 1.3))], 0.025, 8)
    obj_from_bm("gurgle_ladle", lbm, wood, col).parent = root
    # green steam curling up off the brew
    sbm = bmesh.new()
    for k in range(7):
        loc = (0.12 * math.sin(k * 1.4) - 0.03 * k, 0.05 * math.cos(k * 1.1), 0.9 + 0.11 * k)
        bmesh.ops.create_icosphere(sbm, subdivisions=3, radius=0.1 - 0.008 * k, matrix=Matrix.Translation(loc))
    obj_from_bm("gurgle_steam", sbm, steam, col).parent = root
    # embers glowing in the ashes under its belly
    ebm = bmesh.new()
    for k in range(9):
        a = k * 2.4
        loc = (math.cos(a) * (0.1 + 0.03 * k), math.sin(a) * (0.1 + 0.03 * k), 0.03)
        bmesh.ops.create_icosphere(ebm, subdivisions=2, radius=0.025 + 0.008 * (k % 3), matrix=Matrix.Translation(loc))
    obj_from_bm("gurgle_embers", ebm, ember, col).parent = root
    _glow(col, root, "gurgle_light", (0.35, 1.0, 0.45), 45, (0.0, -0.4, 1.2))
    _glow(col, root, "gurgle_fire", (1.0, 0.5, 0.15), 10, (0.0, -0.3, 0.05))
    root.rotation_euler = (0.0, 0.0, 0.2)
    return root


BUILDERS = {
    "prankers_pumpkin": build_prank_pumpkin,
    "wanderwisp_lantern": build_wanderwisp_lantern,
    "sack_of_startled_bats": build_startled_bats,
    "murmurwick_candle": build_murmurwick_candle,
    "gurglegreen_cauldron": build_gurglegreen_cauldron,
}
