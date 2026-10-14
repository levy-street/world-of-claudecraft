# Deepglass trees, v2 (2026-09-24): WoW-style (Grizzly Hills / Howling Fjord)
# pines, cloud-pad root giants, snow-laden pines, violet-pollen pines and
# violet-blossom broadleaf trees, each under 2000 GPU triangles.
#
#   python3 scripts/assets/deepglass/paint_foliage.py
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python \
#       scripts/assets/deepglass/bl_dg_trees.py -- <out_dir> [name ...]
#   node scripts/assets/deepglass/finish_dg_trees.mjs <out_dir>
#
# History: v1 (2026-09-19..21) is in git; its lessons that still hold are in
# dg_foliage_lib.py. What v2 changes, from the harsh-critic review of v1
# (baseline ~3/10) and SPACEY's 2026-09-24 notes:
#  * A pine tier is TWO cards sharing one anchor on the trunk: a VERTICAL
#    side-view bough (the drooping Grizzly Hills silhouette at eye level) and
#    a near-horizontal plan-view bough (the tier seen from above and below).
#    v1 hung plan-view art almost vertically, and every tier read as a sheet
#    of wet seaweed.
#  * Every card is placed by its painted ANCHOR, so the woody end of a bough
#    is on the trunk, never out at the tip (SPACEY's bug).
#  * Root giants carry their foliage as domed CLOUD PADS at the ends of real
#    limbs, over chunky buttress lobes that dive into the ground.
#  * Snow trees draw only snow cells, and the snow lies ON the boughs.
#  * New: violet-pollen pines and violet-blossom trees (SPACEY: "some trees
#    with purple flowers or pollen").
# Blender Z-up, one unit = one yard, trunk foot at the origin.
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
import dg_foliage_lib as L  # noqa: E402
from dg_foliage_lib import Plant, Z, fib_dirs, refine  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
OUT_DIR = argv[0]
ONLY = set(argv[1:])
TRI_BUDGET = 2000

BARK_PINE = L.bark_material('Bark_dg_pine', 'bark_pine', 'dg_bark_pine.png')
BARK_ROOT = L.bark_material('Bark_dg_root', 'bark_root', 'dg_bark_root.png')
META = {}


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def trunk_path(rng, height, lean, wobble, n=9, bow=0.0, z0=-0.6, turns=0.0, az=None):
    """Centreline of a trunk: a lean that grows with height, a bow, a wobble,
    and optionally a helical `turns` (the WoD twist). `az` fixes the lean
    direction."""
    a = rng.uniform(0, math.tau)
    if az is not None:
        a = az
    pts = []
    for i in range(n):
        t = i / (n - 1)
        off = lean * t ** 1.6 + bow * math.sin(t * math.pi) * min(1.0, t * 3.5)
        x = math.cos(a) * off + math.sin(t * 5 + a) * wobble * t
        y = math.sin(a) * off + math.cos(t * 4 + a) * wobble * t
        if turns:
            r = wobble * 1.4 * math.sin(t * math.pi) * min(1.0, t * 3.5)
            x += math.cos(a + t * turns * math.tau) * r
            y += math.sin(a + t * turns * math.tau) * r
        pts.append(Vector((x, y, z0 + (height - z0) * t)))
    return pts


def at(path, t):
    f = clamp(t) * (len(path) - 1)
    i = min(int(f), len(path) - 2)
    return path[i].lerp(path[i + 1], f - i)


def axis_xy(path, z):
    """Trunk centre at height z."""
    for i in range(len(path) - 1):
        if path[i].z <= z <= path[i + 1].z:
            f = (z - path[i].z) / max(1e-6, path[i + 1].z - path[i].z)
            p = path[i].lerp(path[i + 1], f)
            return Vector((p.x, p.y, 0))
    p = path[-1] if z > path[-1].z else path[0]
    return Vector((p.x, p.y, 0))


def flare_roots(P, path, base_r, count, reach=(2.0, 2.8), sides=6, shade=(0.55, 0.8)):
    """Short fat toes where a pine's trunk meets the ground: each starts inside
    the bole, swells out and dives under, so the trunk never stands on a
    visible ring. Capped (bark is single-sided)."""
    rng = P.rng
    boxes = []
    for k in range(count):
        a = k / count * math.tau + rng.uniform(-0.35, 0.35)
        o = Vector((math.cos(a), math.sin(a), 0))
        r = base_r * rng.uniform(*reach)
        pts = [path[0] * 0 + o * base_r * 0.2 + Z * base_r * 1.6,
               o * r * 0.45 + Z * base_r * 0.55,
               o * r * 0.85 + Z * base_r * 0.05,
               o * r * 1.05 - Z * 0.55]
        P.tube(pts, [base_r * 0.55, base_r * 0.45, base_r * 0.3, base_r * 0.12], sides=sides, shade=shade,
               cap_start=False, tip=True)
    return boxes


# Per-bough tints: fresh olive growth, cool old growth, neutral. Vertex colour,
# so free; a tree mixes them so no two tiers read as the same card (SPACEY,
# 2026-09-24: "add a bit more variation to the leaves").
BOUGH_TINTS = ((1.06, 1.04, 0.9), (0.92, 0.99, 1.07), (1.0, 1.0, 1.0), (1.03, 1.02, 0.95), (0.96, 1.0, 1.02))


def bough_tint(rng):
    t = rng.choice(BOUGH_TINTS)
    j = rng.uniform(0.94, 1.06)
    return (t[0] * j, t[1] * j, t[2] * j)


def canopy_value(height, lo=0.54, hi=1.35):
    """Value AND hue up the tree: cool and dark at the skirt, warm and bright
    at the crown (round-1 review: "crowns match skirts")."""
    def f(p):
        k = clamp(p.z / height) ** 0.85
        v = lo + (hi - lo) * k
        return (v * (0.93 + 0.12 * k), v * (0.98 + 0.04 * k), v * (1.06 - 0.15 * k))
    return f


def pine(name, seed, height, base_r, first, whorls, per, reach, sheet='dg_fol_pine',
         sides=('side_a', 'side_b', 'side_c', 'side_d'), plans=('plan_a', 'plan_b', 'plan_c'), crown='crown',
         lean=0.0, wobble=0.15, bow=0.0, sparse=0.0, stubs=3, roots=4, pollen=0.0,
         pollen_cells=('side_pollen', 'side_pollen_b'), pollen_plans=('plan_pollen',), tint=(1, 1, 1), droop=0.3,
         woody=0, gap_every=0, dense=0.0, lean_skew=0.0, gap_sector=0.0, crown_scale=1.0, tier_droop=None,
         lean_az=None, gap_tiers=None, bottom_boost=1.0):
    """A Grizzly Hills pine: a tapering trunk with whorls of drooping boughs.

    Each bough is a side-view card (vertical, the drooping silhouette) plus a
    plan-view card (near horizontal, the tier from above/below) on ONE anchor
    at the bark. Tiers are jittered in spacing, length, droop and yaw, and
    the odd bough is missing, so the tree is not a fishbone. Lower whorls
    carry a real limb that ENDS INSIDE its bough. `dense` adds filler boughs
    between the main ones, darker and shorter, so the middle of the tree is
    solid with no sky showing through (SPACEY, 2026-09-24: "have some of the
    trees be thick in the middle so u cant see the gaps")."""
    P = Plant(name, seed, sheet, BARK_PINE, tint)
    P.height = height
    rng = P.rng
    path = trunk_path(rng, height, lean, wobble, bow=bow, az=lean_az)
    lean_dir = Vector((path[-1].x, path[-1].y, 0))
    lean_dir = lean_dir.normalized() if lean_dir.length > 1e-3 else Vector((1, 0, 0))
    radii = []
    for i in range(len(path)):
        t = i / (len(path) - 1)
        flare = 1.0 + 0.8 * max(0.0, 1 - t * 8) ** 2
        radii.append(base_r * (1 - t) ** 0.85 * flare + 0.05)
    # the leader ends just short of the top, under the crown cards
    tpath = path[:-1] + [path[-2].lerp(path[-1], 0.8)]
    lobed_trunk(P, tpath, radii, plan_roots(rng, roots), reach=(1.6, 2.0), spread=(0.4, 0.5),
                lobe_h=max(1.2, base_r * 2.4), sides=12, shade=(0.62, 1.0), twist=0.0, base=0.1, boxes=False)
    # broken stubs on the bare lower trunk: short, thick, tapered shut
    for k in range(stubs):
        t = rng.uniform(0.1, max(0.12, first - 0.05))
        p = at(path, t)
        a = rng.uniform(0, math.tau)
        o = Vector((math.cos(a), math.sin(a), rng.uniform(0.05, 0.3))).normalized()
        ln = rng.uniform(0.3, 0.6) * max(1.0, base_r * 1.2)
        r0 = base_r * (1 - t) * 0.2 + 0.04
        P.tube([p - o * r0, p + o * ln * 0.6, p + o * ln], [r0, r0 * 0.7, r0 * 0.2], sides=5, shade=(0.7, 0.85),
               tip=True, cap_start=False)

    def nfield(p):
        c = axis_xy(path, p.z)
        h = Vector((p.x - c.x, p.y - c.y, 0))
        h = h.normalized() if h.length > 1e-4 else Vector((1, 0, 0))
        f = clamp(p.z / height)
        return h * 1.0 + Z * (0.3 + 0.9 * f)

    P.nfield = nfield
    P.vfield = canopy_value(height)
    twist = rng.uniform(0, math.tau)
    gap_dir = rng.uniform(0, math.tau)
    if tier_droop is not None:
        droop = tier_droop
    zs = []
    for w in range(whorls):
        f = w / max(1, whorls - 1)
        t = first + (0.95 - first) * (1 - (1 - f) ** 1.35)
        # jitter the spacing: +-25% of a tier gap
        gap = (0.95 - first) / max(1, whorls - 1)
        if 0 < w < whorls - 1:
            t += rng.uniform(-0.25, 0.25) * gap * (0.45 if dense else 1.0)
        zs.append((w, f, t))
    for w, f, t in zs:
        p = at(path, t)
        r_here = base_r * (1 - t) ** 0.85 + 0.05
        span = max(height * 0.07, reach * (1 - f) ** 0.72 * min(1.0, 0.74 + f * 2.2))
        span *= rng.uniform(0.8, 1.2) if f < 0.85 else 1.0      # tier length +-20%
        if w < 2:
            span *= bottom_boost
        tier_droop = droop + rng.uniform(-0.1, 0.12)
        twist += 2.4 + rng.uniform(-0.6, 0.6)
        count = per if f < 0.72 else max(3, per - 1 - int(f > 0.88))
        if gap_every and w % gap_every == gap_every - 1:
            # a thinned, BROKEN tier: fewer and shorter boughs, a real gap
            count = max(2, count - 3)
            span *= 0.55
        for k in range(count):
            if sparse and rng.random() < sparse:
                continue
            # the odd missing bough, never in the crown
            if not dense and f < 0.8 and rng.random() < 0.08:
                continue
            # a one-sided GAP (wind, a fallen neighbour): boughs missing from
            # one sector on most tiers, the per-tree silhouette the round-4
            # review asked for, and what makes ragged read as weathered
            if gap_sector and 0.05 < f < 0.85:
                da = ((twist + k / count * math.tau - gap_dir + math.pi) % math.tau) - math.pi
                # gaps BUNCH on a few tiers (two missing together reads as
                # weather; one-on-one-off reads as a pattern, round-5)
                p_gap = (0.95 if w in gap_tiers else 0.25) if gap_tiers is not None else 0.8
                if abs(da) < gap_sector / 2 and rng.random() < p_gap:
                    continue
            a = twist + k / count * math.tau + rng.uniform(-0.3, 0.3)
            o = Vector((math.cos(a), math.sin(a), 0))
            skew = 1.0 - lean_skew * o.dot(lean_dir)
            ln = max(0.8, span * rng.uniform(0.84, 1.1) * skew)
            anchor = p + o * r_here * 0.4 + Z * rng.uniform(-0.2, 0.2)
            use_pollen = pollen and f > 0.35 and rng.random() < pollen * (0.6 + 0.8 * f)
            sc = rng.choice(pollen_cells if use_pollen else sides)
            pc = rng.choice(pollen_plans if (use_pollen and rng.random() < 0.6) else plans)
            tn = bough_tint(rng)
            # snow boughs are TILTED 20-30 degrees: then one face looks down and
            # shows the green twin, so no white snow rim radiates from the trunk
            # when seen from below (round-4 review, fourth round of that note)
            # (snow boughs seen from below are handled in the shader now:
            # foliage_edge_fade.ts SNOW_FROM_BELOW; tilting them hid their
            # snow from eye level too)
            rl = rng.uniform(-0.3, 0.3)
            P.side_card(anchor, o, ln, sc, droop=tier_droop + rng.uniform(-0.06, 0.08),
                        roll=rl, shade=rng.uniform(0.92, 1.06), tint=tn)
            P.plan_card(anchor + Z * 0.04 * ln, o, ln * rng.uniform(0.86, 0.98), pc,
                        droop0=rng.uniform(0.02, 0.16), droop1=rng.uniform(0.5, 0.85),
                        roll=rng.uniform(-0.22, 0.22), shade=rng.uniform(0.95, 1.08), tint=tn)
            if w < woody and k % 2 == 0:
                # a limb that ENDS INSIDE its bough (tapered to a point at 40%
                # of the card), never a cut end out in the air
                rb = r_here * 0.32 + 0.05
                P.tube([anchor - o * r_here * 0.6, anchor + o * ln * 0.22 + Z * ln * 0.01,
                        anchor + o * ln * 0.4 - Z * ln * 0.05],
                       [rb, rb * 0.6, rb * 0.15], sides=4, shade=(0.75, 0.9), tip=True, cap_start=False)
            if dense and k == 0 and f < 0.85:
                # TRUNK COVER: three short dark boughs round the bole at this
                # tier, so the trunk never shows as a stripe between tiers from
                # any side (round-5 review)
                # CURTAINS: a plan card drooping to vertical hangs as a sheet
                # facing OUTWARD, so it covers the bole from the side it faces.
                # (Radial side cards cannot: the one that would hide the trunk
                # from a view is exactly the one seen edge-on from it.)
                for j in range(4):
                    a3 = a + (j + 0.5) / 4 * math.tau
                    o3 = Vector((math.cos(a3), math.sin(a3), 0))
                    P.plan_card(p + o3 * r_here * 0.2, o3, max(1.0, gap * height * 1.3), rng.choice(plans),
                                droop0=1.15, droop1=1.45, roll=rng.uniform(-0.15, 0.15), shade=0.84, tint=tn,
                                width_mul=0.9)
            if dense and f < 0.9 and rng.random() < dense:
                # a filler bough half-way round to the next one: shorter,
                # darker, hanging deeper, the interior mass that stops the sky
                # showing through the middle of the tree
                a2 = a + math.pi / count + rng.uniform(-0.15, 0.15)
                o2 = Vector((math.cos(a2), math.sin(a2), 0))
                l2 = ln * rng.uniform(0.6, 0.75)
                an2 = p + o2 * r_here * 0.3 - Z * rng.uniform(0.1, 0.5)
                P.side_card(an2, o2, l2, rng.choice(sides), droop=tier_droop + 0.15, roll=rng.uniform(-0.3, 0.3),
                            shade=0.82, tint=tn)
                if rng.random() < 0.5:
                    P.plan_card(an2, o2, l2 * 0.9, rng.choice(plans), droop0=0.15, droop1=1.0,
                                roll=rng.uniform(-0.2, 0.2), shade=0.84, tint=tn)
    if dense:
        # THE CORE: three planes of upright crown cards stacked up the trunk
        # (0 / 60 / 120 degrees), dark, inside the tiers. Any horizontal view
        # is within 30 degrees of one plane, so the middle of the tree is
        # solid from every side, sky never shows through between the tiers
        # (SPACEY: "thick in the middle so u cant see the gaps"; round-2 review
        # measured 7-15% sky there).
        z0, z1 = at(path, first).z, at(path, 0.9).z
        n = 5
        yaw0 = rng.uniform(0, math.pi)
        for i in range(n):
            f = i / (n - 1)
            zb = z0 + (z1 - z0) * f - height * 0.03
            hgt = (z1 - z0) / (n - 1) * 1.9 * (1.1 - 0.35 * f)
            # never out through the crown: the core stays INSIDE the tiers
            hgt = min(hgt, at(path, 0.93).z - zb)
            for k in range(3):
                P.upright_card(at(path, (zb - path[0].z) / (path[-1].z - path[0].z)), hgt, crown,
                               yaw0 + k * math.pi / 3 + rng.uniform(-0.15, 0.15), shade=0.7,
                               tint=bough_tint(rng))
    top = path[-1]
    ch = max(1.4, height * 0.15 * crown_scale)
    for k in range(2):
        # snow crowns lean ~20 degrees so one face looks down and shows the
        # green twin from below (the white crown read as slivers overhead)
        lean_c = rng.uniform(-0.05, 0.05)
        P.upright_card(top - Z * ch * 0.55, ch, crown, rng.uniform(0, math.pi) + k * math.pi / 2,
                       lean=lean_c, shade=1.05)
    # the bole sinks into shadow inside the canopy: a lit trunk read as a
    # stripe through the tiers (three review rounds)
    z_can = at(path, first).z

    k_dark = 0.62 if (dense and sheet != 'dg_fol_snow') else (0.3 if sheet == 'dg_fol_snow' else 0.42)

    def wood_dark(p):
        return 1.0 - k_dark * clamp((p.z - z_can + 0.5) / 3.0)
    P.shade_wood(wood_dark)
    P.check_attached()
    META[name] = {'kind': 'pine', 'height': height, 'base_r': base_r}
    return P


def flare_base(P, path, base_r, angles, reach=(2.6, 3.4), lobe_h=3.0, sides=24, twist=0.03, trunk_scale=1.0,
               match=None, radii=None):
    """The trunk foot as ONE lofted surface whose lobes run out into the
    roots and sink into the ground (Plant.flare), plus a collision box per
    lobe. Replaces the separate root tubes the round-2 review read as
    talons and crossed logs."""
    rng = P.rng
    lobes = [(a, rng.uniform(*reach), rng.uniform(0.38, 0.5)) for a in angles]
    z1 = base_r * lobe_h

    def axis(z):
        return axis_xy(path, max(z, path[0].z)) + Z * z

    def rad(z):
        # the trunk's OWN radius at z (interpolated from the tube that rises
        # out of this foot), a touch wider below ground: any mismatch at z1
        # showed as a collar step (round-4 review)
        if radii:
            zz = max(path[0].z, min(path[-1].z, z))
            for i in range(len(path) - 1):
                if path[i].z <= zz <= path[i + 1].z:
                    f = (zz - path[i].z) / max(1e-6, path[i + 1].z - path[i].z)
                    r = radii[i] + (radii[i + 1] - radii[i]) * f
                    break
            else:
                r = radii[0]
            return r * trunk_scale * (1.0 + 0.25 * clamp(-z / 0.7))
        t = clamp((z - path[0].z) / (path[-1].z - path[0].z))
        return base_r * trunk_scale * (1 - t) ** 0.7 * (1.0 + 0.25 * clamp(-z / 0.7)) + 0.12

    # `match` = (trunk radius, trunk start z): texel density + v origin of the
    # trunk tube this foot runs into
    wraps = max(1, round(match[0] * math.tau * 0.3)) if match else None
    P.flare(axis, rad, -0.7, z1, lobes, rings=7, sides=sides, twist=twist, wraps=wraps,
            v_origin=match[1] if match else 0.0)
    boxes = []
    r0 = rad(0.0)
    for a, reach, sp in lobes:
        o = Vector((math.cos(a), math.sin(a), 0))
        ln = r0 * (reach - 1.0)
        mid = o * (r0 + ln * 0.45)
        top_ = base_r * 0.9
        boxes.append({'x': round(mid.x, 3), 'y': round(top_ * 0.5, 3), 'z': round(mid.y, 3),
                      'hx': round(max(0.3, ln * 0.5), 3), 'hy': round(top_ * 0.5, 3),
                      'hz': round(max(0.3, r0 * sp * 0.9), 3), 'ry': round(-a, 4),
                      'moveTopY': round(top_, 3)})
    return boxes


def lobed_trunk(P, path, radii, angles, reach=(2.2, 2.8), spread=(0.42, 0.52), lobe_h=3.0, sides=16,
                shade=(0.6, 1.0), twist=0.035, base=0.14, k=4, boxes=True):
    """The whole trunk as ONE tube whose foot flares into buttress lobes that
    sink into the ground (Plant.tube `lobes`), plus a collision box per lobe.
    Replaces the separate lofted flare, whose join to the trunk showed as a
    collar band (round-5 review)."""
    rng = P.rng
    lobes = [(a, rng.uniform(*reach) - 1.0, rng.uniform(*spread)) for a in angles]
    pts, rad = refine(path, radii, lobe_h * 1.05, k=k)
    # the foot stands STRAIGHT up to half the lobe height, so the flare
    # splays evenly instead of kicking toward the lean (a "boot")
    zf = lobe_h * 0.55
    ref_p = next((p for p in pts if p.z >= zf), pts[-1])
    pts = [Vector((ref_p.x, ref_p.y, p.z)) if p.z < zf else p for p in pts]
    P.tube(pts, rad, sides=sides, shade=shade, tip=True, twist=twist, cap_start=True, lobes=lobes, lobe_h=lobe_h,
           lobe_z0=pts[0].z, lobe_base=base)
    if not boxes:
        return []
    trunk_top = min(path[-1].z * 0.55, 12.0)
    return base_collision(P, P.last_rings, Vector((ref_p.x, ref_p.y, 0)),
                          [a for a, _g, _s in lobes] if boxes is True else [], trunk_top)[0]


# The base collision's shape (yd). Roots are modelled up to ROOT_TOP (above it
# the trunk's round wall takes over), each as ONE box with a sloped top; LMAX
# bounds the bark-height search.
ROOT_TOP = 2.4
LMAX = 3.0


def _disc(cx, cy, r, top):
    """A round footprint of radius r as three boxes, a cross and a square,
    every corner on or inside the circle (one square's corners stood 41%
    past it: the invisible corners round every trunk)."""
    return [{'x': cx, 'y': cy, 'hl': hl * r, 'hw': hw * r, 'yaw': 0.0, 'top': top}
            for hl, hw in ((0.92, 0.38), (0.38, 0.92), (0.7, 0.7))]


def surface_at(b, x, y):
    """The standable surface of a base box at (x, y) (Blender frame), exactly
    as sim/colliders.ts colliderTopAt samples it; None outside the box."""
    dx, dy = x - b['x'], y - b['y']
    u = dx * math.cos(b['yaw']) + dy * math.sin(b['yaw'])
    v = -dx * math.sin(b['yaw']) + dy * math.cos(b['yaw'])
    if abs(u) > b['hl'] or abs(v) > b['hw']:
        return None
    s = b.get('slope')
    if s == 'ridge':
        return max(b['eave'], min(b['top'], b['top'] - abs(v) * b['pitch'] - (u + b['hl']) * b.get('fall', 0.0)))
    if s == 'cone':
        return max(b['eave'], b['top'] - math.hypot(dx, dy) * b['pitch'])
    return b['top']


def base_collision(P, rings, c, lobe_angles, trunk_top):
    """Collision for a lobed trunk's base, fitted to the tube's own rings
    (SPACEY, 2026-09-24: "the player is just floatign cause its so far off the
    real collision make sure its spot on", after "make it so you can walk up
    the tree root collision without needing to jump").

    Below the flare the axis is vertical, so a ring IS a horizontal section
    and the bark's height at any point is the highest section containing it
    (H below). Each root is ONE box with a SLOPED top (colliders.ts TopSlope
    'ridge' + `fall`): its crest descends along the root as the highest line
    under the real crest, and its flanks fall at the steepest pitch that keeps
    them under the real flanks. So a standing player's feet are never above
    the bark (v2's flat terraces floated them up to 0.6 yd over the slope past
    each edge), and the surface is continuous from the ground up either flank
    and along the crest: walked up from any side, no jump. The trunk above is
    a round wall (a disc to `trunk_top`). Boxes in the game frame (x, height,
    z = -Blender y; yaw = +Blender angle), sloped tops in map_doc.ts
    MapHitbox terms. Returns (game boxes, raw boxes, trunk centre, trunk
    radius)."""
    V = P.verts
    secs = []
    for ring in rings:
        if len(set(ring)) < 3:
            continue
        pts = [V[i] for i in ring]
        secs.append((sum(p[2] for p in pts) / len(pts), [(p[0], p[1]) for p in pts]))
    secs.sort(key=lambda s: s[0])
    memo = {}

    def section(L):
        key = round(L, 3)
        if key in memo:
            return memo[key]
        out = secs[-1][1] if L > secs[-1][0] else secs[0][1]
        for (z0, a), (z1, b) in zip(secs, secs[1:]):
            if z0 <= L <= z1:
                t = (L - z0) / max(1e-6, z1 - z0)
                out = [(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t) for p, q in zip(a, b)]
                break
        memo[key] = out
        return out

    def inside(poly, x, y):
        hit = False
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
                hit = not hit
        return hit

    def reach(poly, o, th):
        ux, uy = math.cos(th), math.sin(th)
        best = 0.0
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
            ax, ay, ex, ey = x0 - o[0], y0 - o[1], x1 - x0, y1 - y0
            den = ux * ey - uy * ex
            if abs(den) < 1e-9:
                continue
            t, s = (ax * ey - ay * ex) / den, (ax * uy - ay * ux) / den
            if t > 0 and 0 <= s <= 1:
                best = max(best, t)
        return best

    def core(poly, o):
        return min(reach(poly, o, k / 72 * math.tau) for k in range(72))

    def H(x, y):
        # the bark's height at (x, y): the highest section containing it
        if inside(section(LMAX), x, y):
            return LMAX
        if not inside(section(0.02), x, y):
            return 0.0
        lo, hi = 0.02, LMAX
        for _ in range(10):
            m = (lo + hi) / 2
            if inside(section(m), x, y):
                lo = m
            else:
                hi = m
        return lo

    # the trunk, round, to its full height, as it stands at head height: a
    # bending or leaning trunk measured higher up stood its wall off the
    # foot, and walkers reached into the bark
    hi = section(2.0)
    tc = (sum(p[0] for p in hi) / len(hi), sum(p[1] for p in hi) / len(hi))
    tr = core(hi, tc)
    raw = _disc(tc[0], tc[1], tr, trunk_top)
    if not lobe_angles:
        return _to_game(raw), raw, tc, tr

    # each root: ONE box whose crest falls along the root as the highest
    # line under the real crest and whose flanks fall at the steepest pitch
    # under the real flanks. One box, because the kernel's slope glue only
    # follows the surface already underfoot: wherever two sloped tops meet
    # (segments of a root, a root and a cone, two roots by the trunk) a
    # walker stuck or was shoved sideways (live-Sim probe, 2026-09-24). So a
    # root's box starts where it has separated from its neighbours (no two
    # overlap) and runs to its tip at its natural width (its flanks reach the
    # ground: stepping on from the side is seamless). Between the roots by
    # the trunk there is only the trunk's wall: feet may sink into the flare
    # there, never float.
    for a in lobe_angles:
        ux, uy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        gap = min(abs((b - a + math.pi) % math.tau - math.pi) for b in lobe_angles if b != a)

        def crest(rho, ux=ux, uy=uy):
            return H(c.x + ux * rho, c.y + uy * rho)

        def extent(rho, ux=ux, uy=uy, nx=nx, ny=ny):
            # how far the bark reaches either side of the root's axis
            out = 0.05
            for sg in (-1, 1):
                v = 0.05
                while v < 4 and H(c.x + ux * rho + sg * nx * v, c.y + uy * rho + sg * ny * v) > 0.05:
                    v += 0.05
                out = max(out, v)
            return out

        tip = tr
        while crest(tip) > 0.08 and tip < 20:
            tip += 0.05
        rin = tip
        while rin > tr and crest(rin) < ROOT_TOP:
            rin -= 0.05
        # ...from where it has separated from its neighbours
        while rin < tip - 0.4 and extent(rin) > rin * math.sin(gap / 2) * 0.9:
            rin += 0.05
        if tip - rin < 0.4:
            continue
        while rin < tip - 0.4 and extent(rin) > 0 and any(
                math.hypot(c.x + ux * rin + sg * nx * extent(rin) - tc[0], c.y + uy * rin + sg * ny * extent(rin) - tc[1])
                < tr + 1.1 for sg in (-1, 1)):
            rin += 0.05
        rs = [rin + (tip - rin) * j / 40 for j in range(41)]
        cz = [crest(r) for r in rs]
        best = None
        for k in range(60):
            f = 0.02 + 0.06 * k
            T = min(z + f * (r - rin) for r, z in zip(rs, cz))
            err = sum(z - max(0.0, T - f * (r - rin)) for r, z in zip(rs, cz))
            if best is None or err < best[0]:
                best = (err, T, f)
        _, ha, fall = best
        rb = min(tip, rin + (ha - 0.05) / max(fall, 1e-6))
        if ha < 0.1 or rb - rin < 0.6:
            # a stub this short is a steep little box a body floats off the
            # edge of, for no root worth standing on
            continue
        # ...and on inward to the trunk's wall along the same line (under the
        # crest there: it climbs to the trunk faster than the line), so a
        # walker who climbs the root is not dropped into a pit at its end
        # It stops a body-radius clear of that wall: a player on the root's end
        # then leans on the trunk while still standing on the root, and the
        # two never overlap (touching, depenetration fought between them and
        # jittered or trapped a walker at the trunk)
        ra = rin
        samples = [rin + (rb - rin) * j / 6 for j in range(7)]
        w = max(extent(r) for r in samples)
        pitch = 0.2
        for r in samples:
            line = ha - fall * (r - rin)
            for j in range(1, int(w / 0.05) + 1):
                v = j * 0.05
                for sg in (-1, 1):
                    hv = H(c.x + ux * r + sg * nx * v, c.y + uy * r + sg * ny * v)
                    pitch = max(pitch, (line - hv) / v)
        m = (rin + rb) / 2
        raw.append({'x': c.x + ux * m, 'y': c.y + uy * m, 'hl': (rb - rin) / 2, 'hw': w, 'yaw': a,
                    'top': ha, 'slope': 'ridge', 'pitch': pitch, 'fall': fall, 'eave': 0.0})
        def clear_of_trunk(r, hw):
            # both inner corners a full body WIDTH (and a bit) off the trunk's
            # wall, measured from the WALL's own centre (a leaning trunk's is
            # off the foot). A narrower gap between the root's end face and the
            # trunk crushed a body that slid into it, and depenetration left it
            # inside the trunk (live-Sim trace, bloom giant)
            return all(math.hypot(c.x + ux * r + sg * nx * hw - tc[0], c.y + uy * r + sg * ny * hw - tc[1])
                       >= tr + 1.1 for sg in (-1, 1))

        def ext_w(r):
            return max(0.15, min(w, r * math.sin(gap / 2) * 0.9))

        while (ra > tr and ha + fall * (rin - ra + 0.05) <= crest(ra - 0.05) - 0.02
               and clear_of_trunk(ra - 0.05, ext_w(ra - 0.05))):
            ra -= 0.05
        if rin - ra > 0.1:
            # the inner reach as its own box: the SAME crest line and pitch
            # (one surface, so the slope glue walks straight across the seam)
            # but only as wide as the gap to the neighbouring roots allows,
            # where the full-width box overlapped them and shoved a walker
            # into the trunk
            m = (ra + rin) / 2
            raw.append({'x': c.x + ux * m, 'y': c.y + uy * m, 'hl': (rin - ra) / 2,
                        'hw': ext_w(ra), 'yaw': a,
                        'top': ha + fall * (rin - ra), 'slope': 'ridge', 'pitch': pitch, 'fall': fall, 'eave': 0.0})

    if os.environ.get('DG_COLDIAG'):
        collision_diag(P, raw, tc, tr)
    return _to_game(raw), raw, tc, tr


def _to_game(raw):
    out = []
    for b in raw:
        g = {'x': round(b['x'], 3), 'y': round(b['top'] / 2, 3), 'z': round(-b['y'], 3), 'hx': round(b['hl'], 3),
             'hy': round(b['top'] / 2, 3), 'hz': round(b['hw'], 3), 'ry': round(b['yaw'], 4)}
        if b.get('slope'):
            g.update({'slope': b['slope'], 'pitch': round(b['pitch'], 4), 'eave': round(b['eave'], 3)})
            if b.get('fall'):
                g['fall'] = round(b['fall'], 4)
        out.append(g)
    return out


def collision_diag(P, raw, tc, tr):
    """DG_COLDIAG=1: the bark's real height on a 0.1 yd grid round the foot
    (rays down from 3 yd) against the collision surface at each point, the way
    the sim samples it. OVERSHOOT = collision above the bark (a player floats
    or meets an invisible wall; must be ~0); SINK = bark above the collision
    where the root stands 0.3 yd+ (feet in the root)."""
    from mathutils.bvhtree import BVHTree
    faces = [f[0] for f in P.faces if f[1] == 0]
    bvh = BVHTree.FromPolygons([Vector(v) for v in P.verts], faces, all_triangles=False)
    over, sink, n, by = [], [], 0, {}
    R = 9.0
    steps = int(R * 2 / 0.1)
    for i in range(steps + 1):
        for j in range(steps + 1):
            x, y = tc[0] - R + i * 0.1, tc[1] - R + j * 0.1
            if math.hypot(x - tc[0], y - tc[1]) < tr * 1.02:
                continue
            loc, nrm, _i, _d = bvh.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)), 6.0)
            # a first hit facing DOWN means the ray began inside the trunk
            H = 3.0 if (loc is not None and nrm.z < 0) else (max(0.0, loc.z) if loc is not None else 0.0)
            tops = [t for t in (surface_at(b, x, y) for b in raw) if t is not None]
            T = max(tops) if tops else 0.0
            if T > 0 or H > 0:
                n += 1
            if T > H + 0.05:
                over.append((round(T - H, 2), round(x, 2), round(y, 2)))
            if 0.3 <= H < 2.9:
                sink.append(H - T)
                if os.environ.get('DG_COLDIAG') == '2':
                    who = 'none'
                    for b in raw:
                        t = surface_at(b, x, y)
                        if t is not None and abs(t - T) < 1e-9:
                            who = b.get('slope') or 'flat'
                    by.setdefault(who, []).append(H - T)
    over.sort()
    sink.sort()
    q = (lambda k: sink[min(len(sink) - 1, int(len(sink) * k))]) if sink else (lambda k: 0.0)
    for who, v in sorted(by.items()):
        v.sort()
        print('   sink under', who, 'n', len(v), 'p50 %.2f p90 %.2f' % (v[len(v) // 2], v[int(len(v) * 0.9)]))
    print('DGCOL', P.name, 'boxes', len(raw), 'overshoot pts', len(over), 'of', n,
          'p90 %.2f max %.2f' % (over[int(len(over) * 0.9)][0] if over else 0.0, over[-1][0] if over else 0.0),
          'e.g.', over[-3:] if over else '',
          '| sink p50 %.2f p90 %.2f max %.2f' % (q(0.5), q(0.9), q(1.0)))


def stone_diag(P, boxes):
    """DG_COLDIAG=1, the crag stone: the real surfaces under every stone box.
    A footprint point where the STONE is not the visible top (bare grass, or
    bark covering it) but the box stands a stride above the bark is an
    INVISIBLE BLOCKER: a wall where no stone is seen."""
    from mathutils.bvhtree import BVHTree

    def tree(slots):
        return BVHTree.FromPolygons([Vector(v) for v in P.verts], [f[0] for f in P.faces if f[1] in slots],
                                    all_triangles=False)

    stone, bark = tree((2,)), tree((0,))

    def height(bvh, x, y):
        loc, nrm, _i, _d = bvh.ray_cast(Vector((x, y, 4.0)), Vector((0, 0, -1)), 6.0)
        if loc is None:
            return 0.0
        return 4.0 if nrm.z < 0 else max(0.0, loc.z)

    bad, n, floats = [], 0, []
    for b in boxes:
        yaw, top = b.get('ry', 0.0), b['y'] + b['hy']
        cx, cy = b['x'], -b['z']
        for k in range(21):
            for j in range(21):
                u, v = (k / 10 - 1) * b['hx'], (j / 10 - 1) * b['hz']
                x = cx + u * math.cos(yaw) - v * math.sin(yaw)
                y = cy + u * math.sin(yaw) + v * math.cos(yaw)
                hs, hb = height(stone, x, y), height(bark, x, y)
                if b.get('slope') == 'cone':
                    top = max(b['eave'], b['y'] + b['hy'] - b['pitch'] * math.hypot(x - cx, y - cy))
                n += 1
                if hs < max(0.15, hb) and top > hb + 0.3:
                    bad.append((round(top - hb, 2), round(x, 2), round(y, 2)))
                if top > max(hs, hb) + 0.05:
                    floats.append(round(top - max(hs, hb), 2))
    bad.sort()
    print('DGSTONE', P.name, 'stone boxes', len(boxes), 'blocker pts (stone not the top, box > bark+0.3)', len(bad),
          'of', n, 'worst', bad[-3:], '| stands above the stone at', len(floats), 'pts, max', max(floats) if floats else 0)

def plan_roots(rng, count):
    return [(k / count * math.tau + rng.uniform(-0.3, 0.3)) for k in range(count)]


def root_lobes(P, foot, base_r, angles, reach=(3.0, 4.2), lift=1.0, sides=7, twist=0.0, trunk_r=1.0):
    """Buttress roots, one per angle, each continuing a buttress ridge of the
    lobed trunk (Plant.tube `lobes`). Flattened (wider than tall) so they
    hug the ground, and TAPERED to a point below it: round-1 review read the
    v2.0 roots as stacked logs with capped ends and upturned "feet"."""
    rng = P.rng
    boxes = []
    for a in angles:
        o = Vector((math.cos(a), math.sin(a), 0))
        sd = Vector((-o.y, o.x, 0))
        r = base_r * rng.uniform(*reach)
        rr = base_r * rng.uniform(0.6, 0.78)
        sway = rng.uniform(-1, 1) * r * 0.14
        # (along, height as a fraction of lift, radius as a fraction of rr)
        prof = ((0.0, 1.0, 1.0), (0.28, 0.62, 0.9), (0.55, 0.28, 0.72), (0.8, 0.06, 0.52),
                (0.96, -0.05, 0.3), (1.08, -0.3, 0.1))
        pts, rad = [], []
        for t, h, w in prof:
            q = foot + o * (trunk_r * 0.3 + r * t) + sd * sway * math.sin(t * 2.6) + Z * (lift * h + rr * w * 0.1)
            pts.append(q)
            rad.append(rr * w)
        P.tube(pts, rad, sides=sides, shade=(0.6, 0.66), cap_start=False, twist=twist, tip=True, flat=0.72)
        for i in range(1, len(pts) - 2):
            p0, p1 = pts[i], pts[i + 1]
            mid = (p0 + p1) * 0.5
            span = p1 - p0
            wide = max(rad[i], rad[i + 1])
            top_ = max(p0.z + rad[i] * 0.72, p1.z + rad[i + 1] * 0.72)
            boxes.append({'x': round(mid.x, 3), 'y': round(max(0.0, top_ * 0.5), 3), 'z': round(mid.y, 3),
                          'hx': round(max(0.25, span.length * 0.5 + wide * 0.4), 3),
                          'hy': round(max(0.2, top_ * 0.5), 3), 'hz': round(max(0.25, wide * 0.8), 3),
                          'ry': round(-math.atan2(span.y, span.x), 4), 'moveTopY': round(max(0.1, top_), 3)})
    return boxes


def cloud_pad(P, c, R, sides, plans, rng, dome=0, rim=5, spokes=7, under=3, lean=False, layers=2):
    """A domed CLOUD of conifer foliage at a limb's end, thick enough to read
    as a mass: plan cards radiating from the centre, a cap of cards rising to
    dome the top, side-view boughs hanging round the rim, and a few steep,
    darker cards under it so the pad has a belly instead of a flat plate
    (round-1 review: "thin plate pads")."""
    tw = rng.uniform(0, math.tau)
    for k in range(spokes):
        a = tw + k / spokes * math.tau + rng.uniform(-0.2, 0.2)
        o = Vector((math.cos(a), math.sin(a), 0))
        tn = bough_tint(rng)
        # each spoke RISES off the centre and rolls over: together they dome
        # the pad (separate rising cap cards read as floating slabs from the
        # side, round-4 review)
        P.plan_card(c + o * R * 0.05, o, R * rng.uniform(0.85, 1.05), rng.choice(plans),
                    droop0=rng.uniform(-0.5, -0.3), droop1=rng.uniform(0.6, 0.9), roll=rng.uniform(-0.2, 0.2),
                    tint=tn, segs=3)
    for k in range(dome):
        a = tw + (k + 0.5) / dome * math.tau
        o = Vector((math.cos(a), math.sin(a), 0))
        P.plan_card(c - o * R * 0.25 + Z * R * 0.12, o, R * rng.uniform(0.62, 0.78), rng.choice(plans),
                    droop0=rng.uniform(-0.85, -0.6), droop1=rng.uniform(0.35, 0.6), roll=rng.uniform(-0.3, 0.3),
                    shade=1.1, tint=bough_tint(rng))
    if layers > 1:
        # a second, lower layer of spokes: the pad gets THICKNESS, a domed
        # mass rather than a thin umbrella (six review rounds)
        for k in range(spokes - 1):
            a = tw + (k + 0.5) / (spokes - 1) * math.tau + rng.uniform(-0.2, 0.2)
            o = Vector((math.cos(a), math.sin(a), 0))
            P.plan_card(c - Z * R * 0.22 + o * R * 0.05, o, R * rng.uniform(0.8, 0.95), rng.choice(plans),
                        droop0=rng.uniform(-0.15, 0.05), droop1=rng.uniform(0.8, 1.1), roll=rng.uniform(-0.2, 0.2),
                        segs=2, shade=0.88, tint=bough_tint(rng))
    for k in range(rim):
        a = tw + (k + 0.3) / rim * math.tau + rng.uniform(-0.2, 0.2)
        o = Vector((math.cos(a), math.sin(a), 0))
        P.side_card(c + o * R * 0.2 - Z * R * 0.02, o, R * rng.uniform(0.8, 0.98), rng.choice(sides),
                    droop=rng.uniform(0.2, 0.4), roll=rng.uniform(-0.3, 0.3), tint=bough_tint(rng))
    for k in range(under):
        a = tw + (k + 0.6) / under * math.tau
        o = Vector((math.cos(a), math.sin(a), 0))
        P.plan_card(c + o * R * 0.1 - Z * R * 0.08, o, R * rng.uniform(0.55, 0.7), rng.choice(plans),
                    droop0=0.55, droop1=1.15, roll=rng.uniform(-0.3, 0.3), shade=0.8)


def pad_fields(P, pads, height):
    def nearest(p):
        best, bd = None, 1e9
        for c, R in pads:
            d = ((p - c) * (1.0 / R)).length
            if d < bd:
                best, bd = (c, R), d
        return best

    def nfield(p):
        c, R = nearest(p)
        d = p - c
        return Vector((d.x, d.y, d.z * 2.2 + R * 0.55)).normalized() + Z * 0.25

    def vfield(p):
        c, R = nearest(p)
        f = clamp(0.5 + (p.z - c.z) / (R * 0.8))
        v = (0.5 + 0.62 * f) * (0.88 + 0.18 * clamp(p.z / height))
        return (v * (0.94 + 0.1 * f), v, v * (1.05 - 0.13 * f))

    P.nfield = nfield
    P.vfield = vfield


def crag_roots(P, rock, side, base_r, rng):
    """Three roots grip the crag, each its own (SPACEY, 2026-09-24: "make the
    roots covering it look less uniform"; they were one root and its mirror,
    one radius, one path, flattened into planks): a thick main root out of
    the trunk foot, over the crown and down the far face into the soil; a
    thinner one wrapping the near flank lower down; a rootlet forking off the
    main one down the side. Every point lies ON the stone (ray cast to its
    surface), pressed flat against it (tube `hug`) and sunk a quarter of its
    thickness, so there is no daylight under it; the radius wanders so no
    root reads as a pipe."""
    bvh, bc = rock['bvh'], rock['centre']
    s_ = -side                                   # stone -> trunk
    t_ = Vector((-side.y, side.x, 0))

    def surf(az, el):
        a, e = math.radians(az), math.radians(el)
        d = ((s_ * math.cos(a) + t_ * math.sin(a)) * math.cos(e) + Z * math.sin(e)).normalized()
        loc, n, _i, _d = bvh.ray_cast(bc + d * 30.0, -d)
        return loc, n.normalized()

    def spline(ctrl):
        # Catmull-Rom through the control angles, one point between each pair:
        # jittered points joined straight read as a folded strap
        out = []
        for i in range(len(ctrl)):
            out.append(ctrl[i])
            if i < len(ctrl) - 1:
                a, b, c, d = ctrl[max(0, i - 1)], ctrl[i], ctrl[i + 1], ctrl[min(len(ctrl) - 1, i + 2)]
                out.append(tuple((-w + 9 * x + 9 * y - z) / 16 for w, x, y, z in zip(a, b, c, d)))
        return out

    def root(foot, path, r0, r1, sides, shade, hug_k):
        pts, rads, hug = list(foot), [r0 * 1.1] * len(foot), [None] * len(foot)
        # wander off the great circle: a root follows the stone's cracks
        path = spline([(az + rng.uniform(-7, 7), el + rng.uniform(-4, 4)) for az, el in path])
        # a knot or two where the root swells over a lip of the stone
        knots = set(rng.sample(range(1, len(path) - 1), 2))
        for k, (az, el) in enumerate(path):
            t = (k + 1) / len(path)
            r = (r0 + (r1 - r0) * t ** 0.8) * rng.uniform(0.92, 1.08) * (1.22 if k in knots else 1.0)
            loc, n = surf(az, el)
            # pressed HALF its thickness into the stone: it grips, not rests
            pts.append(loc + n * r * hug_k * 0.5)
            rads.append(r)
            hug.append(n)
        # the tip dives into the soil past the stone's foot
        pts.append(pts[-1] + (pts[-1] - pts[-2]).normalized() * r1 * 2.5 - Z * 0.6)
        rads.append(r1 * 0.35)
        hug.append(None)
        # bark mapped SQUARE on a thin root (one wrap per circumference, about
        # as many per yard of length): the trunk's v_scale stretched its
        # grain lengthwise and a root read as a sawn plank
        P.tube(pts, rads, sides=sides, shade=shade, cap_start=False, tip=True, hug=hug, hug_k=hug_k,
               v_scale=0.9 / (math.tau * r0), twist=0.15)
        return pts, rads

    main, mr = root([Z * 0.55 + side * base_r * 0.3 + t_ * base_r * 0.2],
                    [(2, 24), (24, 52), (62, 70), (104, 62), (136, 40), (158, 13)],
                    base_r * 0.5, base_r * 0.15, 7, (0.6, 0.7), 0.88)
    # the second root DESCENDS the near flank on a diagonal (run level around
    # it, it read as a rail)
    root([Z * 0.7 + side * base_r * 0.25 - t_ * base_r * 0.4],
         [(-10, 42), (-38, 44), (-66, 30), (-88, 17), (-100, 8)],
         base_r * 0.32, base_r * 0.1, 5, (0.64, 0.74), 0.9)
    # the rootlet leaves the main root where it crests the stone's near side
    root([main[4]], [(46, 52), (60, 33), (70, 12)], mr[4] * 0.5, base_r * 0.06, 5, (0.68, 0.76), 0.92)


CRAG_RIM = 1.1


def crag_boxes(rock):
    """Collision for the crag, in the game frame (x, height, z = -Blender y):
    a boulder you cannot walk up but can jump onto, and never float beside.

    A DOME: one cone-topped surface (colliders.ts TopSlope 'cone'), fitted
    under the stone's real surface (rays down its own faces), whose rim holds
    at CRAG_RIM, above the 1.0 yd stride. Its footprint is the stone's own
    outline AT that height, so the wall stands where the stone really is that
    tall. The old flat bands stood a standable 1.36 yd top over the stone's
    whole foot, and a player on its edge floated 1.3 yd over the stone's
    flank (live-Sim probe, 2026-09-24). Three boxes, a cross and a square,
    all on ONE centre so their cones are one surface (sloped tops that differ
    cannot hand a walker between them)."""
    cols = list(zip(*rock['rows']))

    def section(h):
        pts = []
        for col in cols:
            chain = [rock['pole']] + list(col)
            for a, b in zip(chain, chain[1:]):
                if (a.z - h) * (b.z - h) <= 0 and a.z != b.z:
                    pts.append(a.lerp(b, (h - a.z) / (b.z - a.z)))
                    break
        return pts

    def reach(pts, c, deg):
        # how far the section reaches from c toward `deg`: a ray against its edges
        u = Vector((math.cos(math.radians(deg)), math.sin(math.radians(deg))))
        best = 0.0
        for i in range(len(pts)):
            a = (pts[i] - c).to_2d()
            e = (pts[(i + 1) % len(pts)] - c).to_2d() - a
            den = u.x * e.y - u.y * e.x
            if abs(den) < 1e-9:
                continue
            t = (a.x * e.y - a.y * e.x) / den
            s = (a.x * u.y - a.y * u.x) / den
            if t > 0 and 0 <= s <= 1:
                best = max(best, t)
        return best

    def stone(x, y):
        loc, _n, _i, _d = rock['bvh'].ray_cast(Vector((x, y, 8.0)), Vector((0, 0, -1)), 12.0)
        return loc.z if loc is not None else 0.0

    pts = section(CRAG_RIM)
    if len(pts) < 6:
        return []
    c = sum(pts, Vector()) / len(pts)
    r = {k: reach(pts, c, k) for k in range(0, 360, 45)}
    ax, ay = min(r[0], r[180]), min(r[90], r[270])
    dg = min(r[45], r[135], r[225], r[315])
    feet = [(0.92 * ax, 0.38 * ay), (0.38 * ax, 0.92 * ay), (0.7 * dg, 0.7 * dg)]
    # the cone: for each pitch, the highest apex under the stone everywhere
    # on the footprint; keep the pitch that leaves the least stone above it
    grid = []
    for hx, hy in feet:
        for i in range(11):
            for j in range(11):
                x, y = c.x + hx * (i / 5 - 1), c.y + hy * (j / 5 - 1)
                grid.append((math.hypot(x - c.x, y - c.y), stone(x, y)))
    best = None
    for k in range(60):
        p = 0.1 + 0.1 * k
        T = min(h + p * d for d, h in grid)
        err = sum(h - max(CRAG_RIM, T - p * d) for d, h in grid)
        if best is None or err < best[0]:
            best = (err, T, p)
    _, T, p = best
    return [{'x': round(c.x, 3), 'y': round(T / 2, 3), 'z': round(-c.y, 3), 'hx': round(hx, 3), 'hy': round(T / 2, 3),
             'hz': round(hy, 3), 'slope': 'cone', 'pitch': round(p, 4), 'eave': CRAG_RIM} for hx, hy in feet]


def root_giant(name, seed, height, base_r, lean, roots, limbs, pad_r, sheet='dg_fol_pine',
               sides=('side_a', 'side_b', 'side_c', 'side_d'), plans=('plan_a', 'plan_b', 'plan_c'), crown='crown',
               twin=False, tint=(1, 1, 1), bow=(0.4, 1.0), low=0.42, mids=False, crag=False):
    """A big-root giant: a flared, slightly twisted bole whose buttress
    ridges run on into flattened roots, with limbs that end in domed cloud
    pads. `twin` makes TWO distinct trunks rising from one root plate and
    parting ~20 degrees, each with its own crown."""
    P = Plant(name, seed, sheet, BARK_ROOT, tint)
    P.height = height
    rng = P.rng
    foot = Vector((0, 0, 0))
    trunks = []
    angles = plan_roots(rng, roots)
    lift = base_r * 1.0
    lobes = [(a, 0.72, 0.4) for a in angles]
    part = rng.uniform(0, math.tau)
    pd = Vector((math.cos(part), math.sin(part), 0))
    specs = [(0.0, 1.0)] if not twin else [(-1.0, 0.84), (1.0, 1.0)]
    for side, hmul in specs:
        h = height * hmul
        path = trunk_path(rng, h, 0 if twin else lean, 0.4, n=10, bow=rng.uniform(*bow) * (0.4 if twin else 1),
                          z0=-0.7, turns=0.35)
        if twin:
            # two boles fused at the foot that SPLIT above ~2 yd and part at
            # ~15 degrees: one lobed base, two trunks, two crowns
            path = [p + pd * side * (base_r * 0.3 + 0.27 * max(0.0, p.z - 1.5) ** 1.08) for p in path]
        radii = []
        for i in range(len(path)):
            t = i / (len(path) - 1)
            fl = 1.0 + 0.6 * max(0.0, 1 - t * 5) ** 2
            radii.append(base_r * (0.7 if twin else 1.0) * (1 - t) ** 0.72 * fl + 0.12)
        # the trunk proper starts INSIDE the flared base
        # twin: the boles go right down into the soil, fused, and part above
        # (a Y), no stump top; single: the trunk starts inside its foot
        trunks.append((path, h, radii))
    if crag:
        # the CRAG: a broken boulder the tree grows against, three roots of
        # its own gripping it (bake_stone paints and mosses it after build)
        P.extra = L.rock_material('Stone_dg_crag_src', 'Cliff002')
        # sits BETWEEN two buttresses, so no lobe ends as a flipper on its top
        mid_a = (angles[0] + angles[1]) * 0.5 if len(angles) > 1 else angles[0] + 0.8
        side = Vector((math.cos(mid_a), math.sin(mid_a), 0))
        # its centre under the soil: the stone EMERGES from the ground (sat
        # on it, widest at the grass line, it read as a dropped egg)
        bc = side * base_r * 2.4 - Z * base_r * 0.5
        # the crag draws from its OWN generator; the tree's burns exactly the
        # 128 draws the old boulder took, so the crown SPACEY approved is
        # rebuilt limb for limb
        for _ in range(128):
            rng.random()
        crng = random.Random(seed * 7919 + 17)
        rock = P.crag(bc, base_r * 2.8, base_r * 2.35, base_r * 2.6, crng, rings=5, sides=18, slot=2, dip=0.3)
        crag_roots(P, rock, side, base_r, crng)
        crag_box = crag_boxes(rock)
        if os.environ.get('DG_COLDIAG'):
            stone_diag(P, crag_box)
        # Cliff002, lifted: a cool grey-green painted stone that sits with the
        # cold pine and the meadow (the warm Cliff003/004 read as desert)
        P.stone_bake = {'slot': 2, 'mat_name': 'Stone_dg_crag', 'base': 'Cliff002', 'moss': 'Rock056',
                        'grade': (0.5, 0.9, 1.6)}
    boxes = []
    for ti, (path, h, radii) in enumerate(trunks):
        # twin: both boles carry the same buttress angles, so their fused feet
        # read as ONE lobed base that splits into a Y above it. The leader
        # ends inside its top pad (a bare tip poked up through it).
        path = path[:-1] + [path[-2].lerp(path[-1], 0.15 if twin else 0.4)]
        trunks[ti] = (path, h, radii)
        # the giants' buttresses a touch slimmer and shorter than v2's
        # (2.5-3.3 reach, 0.42-0.52 spread): the foot read as a skirt (SPACEY,
        # 2026-09-24: "make them slightly less wide keep the roots realistic").
        # One draw per lobe either way, so the crown is unchanged.
        boxes += lobed_trunk(P, path, radii, angles, reach=(1.9, 2.4) if twin else (2.25, 2.95),
                             spread=(0.42, 0.52) if twin else (0.35, 0.43),
                             lobe_h=base_r * (2.2 if twin else 3.1), sides=24 if not twin else 11,
                             boxes=True if ti == 0 else 'trunk', k=4 if not twin else 3)
    pads = []
    for ti, (path, h, radii) in enumerate(trunks):
        n_l = limbs if not twin else limbs
        base_a = rng.uniform(0, math.tau)
        for k in range(n_l):
            t = low + (0.86 - low) * k / max(1, n_l - 1)
            p = at(path, t)
            a = base_a + k * 2.4 + rng.uniform(-0.3, 0.3)
            if twin:
                # each twin's limbs lean away from the other trunk
                a = math.atan2(pd.y, pd.x) + (0 if ti else math.pi) + rng.uniform(-1.3, 1.3)
            o = Vector((math.cos(a), math.sin(a), 0))
            ln = h * rng.uniform(0.2, 0.3) * (1.2 - t * 0.55)
            mid = p + o * ln * 0.55 + Z * ln * 0.18
            end = p + o * ln + Z * ln * 0.34
            r0 = base_r * (0.7 if twin else 1.0) * (1 - t) ** 0.7 * 0.55 + 0.1
            # the limb stays thick right into the pad: a limb tapering to a
            # point left the pad reading as detached from any distance
            P.tube([p - o * r0, mid, end], [r0, r0 * 0.7, r0 * 0.3], sides=6, shade=(0.72, 0.95),
                   cap_start=False, tip=True)
            R = pad_r * rng.uniform(0.85, 1.1) * (1.15 - 0.3 * t)
            pads.append((end + Z * 0.05, R))
            if mids and k % 2 == 0 and not twin:
                # seated ON the limb: v2.0 floated it R*0.35 above, which the
                # round-2 review saw as a pad with no limb
                pads.append((mid + Z * 0.05, R * 0.62))
        top = path[-1]
        # the top pad sits OVER the leader's tip: a tip poking through its own
        # crown read as a bare spike (round-7 review)
        pads.append((top + Z * pad_r * 0.08, pad_r * 0.85))
        if not twin and not crag:
            # a TALL crown mass: a second, wider pad stacked under the top one
            # (round-9 review: "one dominant tall dome, not umbrella pads")
            pads.append((top - Z * pad_r * 0.5, pad_r * 1.0))
    pad_fields(P, pads, height)
    for c, R in pads:
        # a pad is attached through its CENTRE: that must sit on wood
        P.suspend = True
        # the twin carries 2x the pads: one layer each keeps it in budget
        cloud_pad(P, c, R, sides, plans, rng, layers=1 if (twin or crag) else 2)
        P.suspend = False
        P.blobs.append((c, R * 0.35))
    # a leader out of each trunk's top pad
    for path, h, radii in trunks:
        # the leader grows out of the trunk's own tip (not out of whichever
        # pad happens to be nearest, which could be a limb's)
        ch = max(1.5, pad_r * 0.7)
        for k in range(2):
            P.upright_card(path[-1] - Z * ch * 0.35, ch, crown, rng.uniform(0, math.pi) + k * math.pi / 2,
                           shade=1.05)
    if crag:
        boxes += crag_box
    P.check_attached()
    META[name] = {'kind': 'root', 'height': height, 'base_r': base_r, 'lift': lift, 'boxes': boxes,
                  'boxes_complete': True}
    return P


def blob_fields(P, blobs, height, centre):
    def nearest(p):
        best, bd = None, 1e9
        for c, R in blobs:
            d = ((p - c) * (1.0 / R)).length
            if d < bd:
                best, bd = (c, R), d
        return best

    def nfield(p):
        c, R = nearest(p)
        return (p - c).normalized() * 0.75 + (p - centre).normalized() * 0.35 + Z * 0.3

    def vfield(p):
        c, R = nearest(p)
        f = clamp(0.5 + (p.z - c.z) / (R * 1.4))
        v = (0.5 + 0.62 * f) * (0.92 + 0.12 * clamp(p.z / height))
        return (v * (0.95 + 0.08 * f), v, v * (1.04 - 0.1 * f))

    P.nfield = nfield
    P.vfield = vfield


CARD_MAX = 3.8    # yards: a 256 px clump cell magnified past this reads blurry


def blossom_blob(P, c, R, flowers, leaves, rng, cards=6, dense=False):
    """A canopy cloud of cupped clump cards facing out over the sphere. The
    blossom cells go on the cards that face UP (the lit crown of the cloud);
    the flanks and belly get leaf cells, which is how a flowering tree reads
    from below and keeps the eye somewhere to rest (round-1 review). Cards
    are capped at CARD_MAX and a big cloud gets more of them instead."""
    size = min(R * 2.1, CARD_MAX)
    n = cards + max(0, int((R * 2.1 - CARD_MAX) / 1.1))
    if dense:
        n += 1
    dirs = fib_dirs(n, up_bias=0.3, min_z=-0.45)
    for d in dirs:
        # blossom on everything but the underside: from eye level a flowering
        # tree must read PURPLE (SPACEY: "trees with purple flowers"), with the
        # dark leaves kept to the belly
        cell_ = rng.choice(flowers) if d.z > -0.1 else rng.choice(leaves)
        off = R * (0.3 if size >= R * 2.0 else 0.45)
        P.clump_card(c + d * off, size * rng.uniform(0.9, 1.05), cell_, d, roll=rng.uniform(0, math.tau), cup=0.2,
                     tint=(rng.uniform(0.95, 1.05), rng.uniform(0.96, 1.04), rng.uniform(0.95, 1.05)))
    if dense:
        # an inner card turned edgewise to the others: the middle never shows sky
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0.2)).normalized()
        P.clump_card(c, size * 0.85, rng.choice(leaves), d, roll=rng.uniform(0, math.tau), cup=0.2, shade=0.85)


def bloom_tree(name, seed, height, base_r, lean, roots, limbs, blob_r, flowers, leaves=('leaf_a',),
               wisteria=0, wcells=('wisteria_a', 'wisteria_b'), turns=0.6, bow=0.8, low=0.46, weep=False,
               tint=(1, 1, 1), dense=False, cards=6, crown_w=2.1):
    """A violet-blossom tree in the WoD reference's shape language: a thick
    twisted trunk on a flared, lobed foot, limbs reaching out to ONE merged
    canopy, a big central cloud, a ring of overlapping clouds round it and a
    few on top, so the crown reads as a single lobed mass (round-2 review:
    separate spheres read as broccoli). Each cloud has ONE blossom colour on
    its lit top and dark leaves underneath. Optional wisteria hangs round the
    whole canopy edge."""
    P = Plant(name, seed, 'dg_fol_bloom', BARK_ROOT, tint)
    P.height = height
    rng = P.rng
    path = trunk_path(rng, height * 0.62, lean, 0.5, n=9, bow=bow, z0=-0.6, turns=turns)
    radii = []
    for i in range(len(path)):
        t = i / (len(path) - 1)
        radii.append(base_r * (1 - t) ** 0.65 + 0.1)
    # EVEN roots: random angles left a heavy side that read as a boot
    a0r = rng.uniform(0, math.tau)
    angles = [a0r + k / roots * math.tau for k in range(roots)]
    # narrow, distinct lobes: wide ones merged into one smooth onion bulb
    boxes = lobed_trunk(P, path, radii, angles, reach=(2.2, 2.25), spread=(0.28, 0.3), lobe_h=base_r * 2.6,
                        sides=15, twist=0.06, shade=(0.58, 1.0), base=0.08, k=3)
    top = path[-1]
    Rx, Rz = blob_r * crown_w, blob_r * (1.1 if not weep else 0.8)
    C = top + Z * blob_r * (0.55 if not weep else 0.3)
    blobs = [(C, blob_r * 1.4)]
    a0 = rng.uniform(0, math.tau)
    ring = []
    # clouds OVERLAP by ~40%: ring close in, each cloud bigger than the gap to
    # its neighbour, so the crown reads as ONE mass (round-3: "broccoli")
    for k in range(limbs):
        a = a0 + k / limbs * math.tau + rng.uniform(-0.2, 0.2)
        ring_z = (0.05 if not weep else -0.2) * Rz
        c = C + Vector((math.cos(a) * Rx * 0.62, math.sin(a) * Rx * 0.62, ring_z))
        ring.append((a, c))
        blobs.append((c, blob_r * rng.uniform(1.15, 1.3)))
    # one BROAD cap over the whole crown: the top reads as one lit surface
    # with a few lumps, not a cluster of separate spheres (round-5 review)
    blobs.append((C + Z * Rz * (0.35 if not weep else 0.4), blob_r * (2.15 if not weep else 1.6)))
    n_top = len(blobs)
    # a dark BELLY of leaf-only clouds under the ring
    for k in range(3):
        a = a0 + (k + 0.2) / 3 * math.tau
        blobs.append((C + Vector((math.cos(a) * Rx * 0.36, math.sin(a) * Rx * 0.36, -Rz * 0.5)), blob_r * 0.95))
    # limbs from the trunk out to each ring cloud, forking once
    for k, (a, c) in enumerate(ring):
        t = low + (0.9 - low) * k / max(1, limbs - 1)
        p = at(path, t)
        o = (c - p)
        o.z = 0
        o = o.normalized()
        r0 = base_r * (1 - t) ** 0.6 * 0.6 + 0.1
        mid = p.lerp(c, 0.5) + Z * ((c.z - p.z) * 0.25 + blob_r * 0.3)
        P.tube([p - o * r0, mid, c], [r0, r0 * 0.72, r0 * 0.45], sides=6, shade=(0.7, 0.95), twist=0.05,
               cap_start=False)
    # short branches up into the top clouds
    for c, R in blobs[len(ring) + 1:n_top]:
        P.tube([C - Z * blob_r * 0.6, c], [base_r * 0.3, base_r * 0.15], sides=5, shade=(0.8, 1.0),
               cap_start=False)
    centre = sum((c for c, _ in blobs), Vector()) / len(blobs)
    blob_fields(P, blobs, height, centre)
    for i, (c, R) in enumerate(blobs):
        flower = flowers[i % len(flowers)]           # ONE blossom colour per cloud
        belly = i >= n_top
        blossom_blob(P, c, R, leaves if belly else (flower,), leaves, rng, cards=cards - (2 if belly else 0),
                     dense=dense or i == 0)
        P.blobs.append((c, R * (1.6 if belly else 1.0)))
    if wisteria:
        tax = axis_xy(path, 3.0)
        hangers = []
        P.suspend = True
        for k in range(wisteria):
            sect = (k + rng.uniform(0.1, 0.9)) / wisteria * math.tau
            cand = sorted(blobs, key=lambda b: abs(((math.atan2(b[0].y - tax.y, b[0].x - tax.x) - sect + math.pi)
                                                    % math.tau) - math.pi))
            c, R = cand[rng.randrange(min(3, len(cand)))]
            # the cloud's REAL extent: its cards are capped at CARD_MAX, so a
            # big cloud is smaller than its nominal R, an anchor at 0.85 R
            # hung the raceme in open air beside the canopy (round-8 review)
            Re = min(R, CARD_MAX * 0.5 + R * 0.3)
            # hung from the TRUNK side of its cloud, up in its belly, where the
            # leaves close over the raceme's top: out at the rim (up to 0.72 R)
            # a raceme read as floating beside the canopy (SPACEY, 2026-09-24:
            # "move them in closer to the center so non of them look like they
            # are floating")
            inward = Vector((tax.x - c.x, tax.y - c.y, 0))
            inward = inward.normalized() if inward.length > 1e-3 else Vector((1, 0, 0))
            across = Vector((-inward.y, inward.x, 0))
            anchor = (c + inward * Re * rng.uniform(0.15, 0.45) + across * Re * rng.uniform(-0.3, 0.3)
                      - Z * Re * 0.3)
            rad = Vector((anchor.x - tax.x, anchor.y - tax.y, 0))
            if rad.length < 1.5:
                anchor += (rad.normalized() if rad.length > 1e-3 else Vector((1, 0, 0))) * (1.5 - rad.length)
            ln = R * rng.uniform(0.75, 1.9)
            # 30% shorter, and narrower with it (a hanging card keeps its
            # aspect): SPACEY, 2026-09-24, "make them 30% smaller"
            ln = 0.7 * min(ln, max(R * 0.6, anchor.z - 2.8))
            yaw = rng.uniform(0, math.pi)
            cw = rng.choice(wcells)
            P.hang_card(anchor, ln, cw, yaw, sway=rng.uniform(-0.1, 0.1))
            P.hang_card(anchor, ln * 0.95, cw, yaw + math.pi / 2, sway=rng.uniform(-0.1, 0.1))
            hangers.append((anchor, c, Re))
        P.suspend = False
        # every raceme must hang from INSIDE a cloud's real extent
        for anchor, c, Re in hangers:
            assert (anchor - c).length <= Re * 1.0, (name, 'wisteria outside its cloud', tuple(anchor))
    P.check_attached()
    META[name] = {'kind': 'bloom', 'height': height, 'base_r': base_r, 'lift': base_r * 0.95, 'boxes': boxes,
                  'boxes_complete': True}
    return P


# tree-wide leaf tints (vertex colour multipliers on top of the sheet palette)
TEAL = (0.98, 1.02, 1.0)
COLD = (0.94, 1.0, 1.06)
DUSK = (0.93, 0.98, 1.02)
MOSS = (1.04, 1.03, 0.9)
SNOWT = (1.0, 1.0, 1.02)

SNOW = dict(sheet='dg_fol_snow', sides=('side_snow_a', 'side_snow_b', 'side_frost'),
            plans=('plan_snow_a', 'plan_snow_b'), crown='crown_snow')

SPECS = {
    'tree_pine_tall_a': lambda: pine('tree_pine_tall_a', 1, 30, 0.85, 0.3, 11, 6, 7.4, tint=TEAL, lean=1.6,
                                     lean_skew=0.25),
    'tree_pine_tall_b': lambda: pine('tree_pine_tall_b', 2, 34, 0.9, 0.22, 12, 5, 7.0, tint=COLD, lean=0.8,
                                     stubs=4, tier_droop=0.5, crown_scale=1.4),
    'tree_pine_full': lambda: pine('tree_pine_full', 3, 22, 0.7, 0.12, 9, 6, 7.0, tint=TEAL, wobble=0.1,
                                   dense=1.0),
    'tree_pine_lean': lambda: pine('tree_pine_lean', 4, 26, 0.75, 0.28, 10, 6, 6.4, tint=DUSK, lean=7.0, bow=2.0,
                                   lean_skew=0.35, lean_az=0.0),
    'tree_pine_young': lambda: pine('tree_pine_young', 5, 12, 0.36, 0.14, 8, 5, 4.2, tint=MOSS, stubs=0,
                                    roots=3, dense=1.0),
    'tree_pine_ragged': lambda: pine('tree_pine_ragged', 6, 24, 0.7, 0.26, 10, 6, 6.4, tint=DUSK, sparse=0.12,
                                     stubs=6, lean=2.2, gap_sector=2.2, lean_skew=0.3, gap_tiers={2, 3, 6, 7}),
    'tree_root_giant_a': lambda: root_giant('tree_root_giant_a', 7, 20, 1.5, 3.5, 5, 3, 6.8, tint=MOSS),
    'tree_root_giant_b': lambda: root_giant('tree_root_giant_b', 8, 24, 1.7, 2.5, 5, 3, 7.4, tint=TEAL, mids=False),
    'tree_root_twin': lambda: root_giant('tree_root_twin', 9, 18, 1.3, 2.2, 5, 3, 4.6, twin=True, tint=DUSK),
    'tree_root_crag_pine': lambda: root_giant('tree_root_crag_pine', 10, 13, 1.1, 4.5, 4, 3, 4.4, tint=COLD,
                                              low=0.5, crag=True),
    'tree_pine_snow_tall': lambda: pine('tree_pine_snow_tall', 11, 31, 0.85, 0.3, 12, 6, 7.4, tint=SNOWT, **SNOW),
    'tree_pine_snow_full': lambda: pine('tree_pine_snow_full', 12, 21, 0.7, 0.12, 9, 6, 6.8, tint=SNOWT,
                                        wobble=0.1, dense=1.0, **SNOW),
    'tree_pine_snow_young': lambda: pine('tree_pine_snow_young', 13, 12, 0.36, 0.14, 8, 5, 4.2, tint=SNOWT,
                                         stubs=0, roots=3, dense=1.0, **SNOW),
    # new, 2026-09-24
    'tree_pine_pollen': lambda: pine('tree_pine_pollen', 14, 22, 0.7, 0.22, 9, 6, 6.8, tint=TEAL, pollen=0.7,
                                     dense=1.0),
    'tree_pine_pollen_tall': lambda: pine('tree_pine_pollen_tall', 15, 30, 0.85, 0.28, 11, 7, 8.0, tint=DUSK,
                                          pollen=0.5, lean=1.0, gap_sector=1.2, tier_droop=0.22, bottom_boost=1.15),
    'tree_bloom_giant': lambda: bloom_tree('tree_bloom_giant', 16, 20, 1.3, 1.5, 5, 5, 3.6,
                                           ('bloom_full', 'bloom_dense', 'bloom_full'), wisteria=8,
                                           dense=True, cards=6),
    'tree_bloom_twist': lambda: bloom_tree('tree_bloom_twist', 17, 13, 0.8, 1.2, 4, 5, 2.3,
                                           ('bloom_full_b', 'bloom_b', 'bloom_full_b'), turns=1.0, bow=0.3, cards=6),
    'tree_bloom_weeping': lambda: bloom_tree('tree_bloom_weeping', 18, 12, 0.8, 0.8, 5, 6, 2.2,
                                             ('bloom_c', 'bloom_squash', 'bloom_c'),
                                             wisteria=13, wcells=('wisteria_pale', 'wisteria_a', 'wisteria_pale'),
                                             weep=True, crown_w=2.4),
}

os.makedirs(OUT_DIR, exist_ok=True)
import json  # noqa: E402

meta_path = os.path.join(OUT_DIR, 'dg_trees.json')
if ONLY and os.path.exists(meta_path):
    META.update(json.load(open(meta_path)))
for name, spec in SPECS.items():
    if ONLY and name not in ONLY:
        continue
    P = spec()
    obj, tris = P.build()
    if getattr(P, 'stone_bake', None):
        L.bake_stone(obj, **P.stone_bake)
    d = obj.dimensions
    print('DGTREE', name, 'tris', tris, '(wood %d, leaves %d)' % P.tri_split, 'dims', round(d.x, 2), round(d.y, 2),
          round(d.z, 2))
    assert tris < TRI_BUDGET, (name, tris)
    META[name].update({'two_sided': True, 'tris': tris, 'dims': [round(d.x, 3), round(d.z, 3), round(d.y, 3)]})
    L.export(obj, os.path.join(OUT_DIR, name + '.glb'))
json.dump(META, open(meta_path, 'w'), indent=1)
print('DGTREE done')
