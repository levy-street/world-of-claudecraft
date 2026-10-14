# Deepglass undergrowth, v2 (2026-09-24): shrubs, ferns and grass for the
# fjord, each under 300 GPU triangles, on the v2 foliage sheets
# (paint_foliage.py) and the shared builder (dg_foliage_lib.py).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python \
#       scripts/assets/deepglass/bl_dg_shrubs.py -- <out_dir> [name ...]
#   node scripts/assets/deepglass/finish_dg_shrubs.mjs <out_dir>
#
# v1 (2026-09-20) reused the TREE atlas on a handful of cards, and the review
# graded it 2-3/10: hollow wreaths of one-sided conifer cards, grass drawn
# with needle sprays. v2:
#  * a leafy shrub is a DOME of cupped clump cards over the upper sphere plus
#    a low ring that meets the ground, lit by the dome's own normals, with a
#    few woody roots at the foot like the reference berry bush;
#  * conifer and snow shrubs are small versions of the pine tiers;
#  * a fern is a crown of fronds rising and arching out from one root;
#  * grass is real blade art on crossed cards from ONE root.
# Blender Z-up, one unit = one yard, base at the origin.
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
import dg_foliage_lib as L  # noqa: E402
from dg_foliage_lib import Plant, Z, fib_dirs  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
OUT_DIR = argv[0]
ONLY = set(argv[1:])
TRI_BUDGET = 300
BARK = L.bark_material('Bark_dg_root', 'bark_root', 'dg_bark_root.png')
BARK_PINE = L.bark_material('Bark_dg_pine', 'bark_pine', 'dg_bark_pine.png')
META = {}


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def dome_fields(P, lobes, height):
    """Normals from the nearest lobe's ellipsoid, blended with the whole
    bush's, so each lump shades like a ball but the bush still has one lit
    side; value and hue warm toward the top."""
    main = lobes[0]

    def ell(p, lobe):
        c, rx, rz = lobe
        d = p - c
        return Vector((d.x / rx, d.y / rx, d.z / rz))

    def nfield(p):
        best = min(lobes, key=lambda lb: ell(p, lb).length)
        return ell(p, best).normalized() * 0.6 + ell(p, main).normalized() * 0.5 + Z * 0.45

    def vfield(p):
        k = clamp(p.z / height) ** 0.9
        v = 0.8 + 0.36 * k
        return (v * (0.95 + 0.08 * k), v, v * (1.04 - 0.1 * k))

    P.nfield = nfield
    P.vfield = vfield


def foot_roots(P, n, spread, r0, rng):
    """A few gnarled roots at the foot that HUG the ground and slip under it
    (the reference berry bush's base), dark, flattened and tapered, never
    twig legs under the silhouette."""
    for k in range(n):
        a = k / n * math.tau + rng.uniform(-0.4, 0.4)
        o = Vector((math.cos(a), math.sin(a), 0))
        ln = spread * rng.uniform(0.5, 0.68)
        P.tube([Z * r0 * 1.5, o * ln * 0.4 + Z * r0 * 0.9, o * ln * 0.78 + Z * r0 * 0.25, o * ln - Z * r0 * 1.2],
               [r0 * 1.6, r0 * 1.2, r0 * 0.8, r0 * 0.2], sides=4, shade=(0.5, 0.62), cap_start=False, tip=True,
               flat=0.7)


def dome(name, seed, height, spread, leaves, sheet='dg_fol_under', cards=9, ring=5, roots=0, tint=(1, 1, 1),
         cup=0.2, size_mul=1.0, side_lobes=2, upright=False, tops=None, core=2, crown_cells=None, lobe_scale=None,
         tops_z=0.2, squash=1.0, dome_core=True):
    """A leafy shrub: a main dome and `side_lobes` lower lumps SITTING ON THE
    GROUND (flat underneath), each a set of cupped clump cards facing out over
    its upper hemisphere, a skirt of low cards that meets the soil, and `core`
    cards in the middle so no view sees through it. `tops` (flower/berry/snow
    cells) go on the cards that face UP, `leaves` on the flanks and skirt.
    `upright` keeps each card's image-up pointing up (snow caps)."""
    P = Plant(name, seed, sheet, BARK if roots else None, tint)
    P.height = height
    rng = P.rng
    rz = height * 0.55 * squash
    tops = tops or leaves
    lobes = [(Vector((0, 0, height - rz * 0.95)), spread * 0.9, rz)]
    a0 = rng.uniform(0, math.tau)
    for k in range(side_lobes):
        a = a0 + k / max(1, side_lobes) * math.tau + rng.uniform(-0.5, 0.5)
        o = Vector((math.cos(a), math.sin(a), 0))
        sc = (lobe_scale[k % len(lobe_scale)] if lobe_scale else rng.uniform(0.78, 1.0))
        rr = rz * 0.72 * sc
        lobes.append((o * spread * (0.4 + 0.15 * sc) + Z * (rr * 0.75), spread * 0.62 * sc, rr))
    dome_fields(P, lobes, height)
    if dome_core:
        # the core wears LEAVES: blossom or snow stretched over a smooth dome
        # read as a cap; the cards carry those on top
        core_cell = (tops if (tops and 'berry' in tops[0]) else leaves)[0]
        c0, rx0, rz0 = lobes[0]
        P.dome_core(c0 - Z * rz0 * 0.1, rx0 * 0.78, rz0 * 0.88, core_cell)
        for c1, rx1, rz1 in lobes[1:]:
            P.dome_core(c1 - Z * rz1 * 0.1, rx1 * 0.75, rz1 * 0.85, leaves[0], rings=2, sides=6)

    def roll():
        return rng.uniform(-0.35, 0.35) if upright else rng.uniform(0, math.tau)

    def pick(d):
        # the cards that face straight up get the crown cells (a snow bush's
        # fully snowed top), the lit upper band the tops, the rest leaves
        if crown_cells and d.z > 0.7:
            return rng.choice(crown_cells)
        return rng.choice(tops) if d.z > tops_z else rng.choice(leaves)

    weights = [1.0] + [0.45] * side_lobes
    tot = sum(weights)
    for (c, rx, rzz), wgt in zip(lobes, weights):
        n = max(3, round(cards * wgt / tot))
        # no near-vertical lobe cards: their tops poked out of the crown as
        # dark spikes and slashes (round-5); the skirt covers the flanks
        # lobe cards face at least ~25 degrees up: steeper ones stood out of
        # the crown as dark shards (five rounds); the skirt covers the flanks
        for d in fib_dirs(n + 1, up_bias=0.3, min_z=0.42):
            # with a core dome the cards sit ON its surface (inside it they
            # were swallowed: a snow bush lost its snow, round 10)
            ko = 0.72 if dome_core else 0.45
            off = Vector((d.x * rx * ko, d.y * rx * ko, d.z * rzz * ko))
            size = max(rx, rzz) * (1.75 if dome_core else 2.1) * size_mul * rng.uniform(0.85, 1.1)
            cell_ = pick(d)
            # a card whose top would leave the dome is shrunk to fit: tall
            # tilted cards read as dark spikes over the crown (4 rounds)
            reach_up = size * 0.5 * math.sqrt(max(0.0, 1 - d.z * d.z)) + size * 0.2
            top_z = (c + off).z + reach_up
            if top_z > height * 1.02:
                size *= max(0.55, (height * 1.02 - (c + off).z) / max(1e-3, reach_up))
            if crown_cells and cell_ in crown_cells:
                # snow cards smaller and set INTO the foliage, so their edges
                # tuck under the leaves instead of hanging like paper
                off *= 0.9 if dome_core else 0.7
                size *= 0.78
            # top cells (snow, blossom, berries) keep a raised pyramid so they
            # still face an eye-level viewer instead of fading edge-on
            is_top = cell_ in (tops or ()) and tops is not leaves or (crown_cells and cell_ in crown_cells)
            cup_ = cup * 1.5 if is_top else (cup * 0.5 if dome_core else cup)
            P.clump_card(c + off, size, cell_, d, roll=roll(), cup=cup_,
                         tint=(rng.uniform(0.95, 1.05), rng.uniform(0.97, 1.03), rng.uniform(0.95, 1.05)))
    # the skirt: low cards leaning out, their bottom edge on the ground
    for k in range(ring):
        a = k / ring * math.tau + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0.15)).normalized()
        size = max(spread, rz) * 1.35 * size_mul * rng.uniform(0.9, 1.1)
        cc = Vector((math.cos(a) * spread * 0.6, math.sin(a) * spread * 0.6, size * 0.42))
        P.clump_card(cc, size, rng.choice(leaves), d, roll=roll(), cup=cup, shade=0.94)
    # the core: cards turned edgewise to the shell, through the middle AND
    # low down, so the bottom of the silhouette is closed (round-2 review:
    # "a cave at the bottom front")
    for k in range(core):
        a = rng.uniform(0, math.tau) if k else a0
        d = Vector((math.cos(a), math.sin(a), 0.1)).normalized()
        zc = height * (0.36 if k % 2 == 0 else 0.22)
        # kept well INSIDE the shell: a core card as big as the dome poked
        # out of the crown as a dark blade (round-3 review)
        P.clump_card(Vector((0, 0, zc)), max(spread, rz) * 1.05, rng.choice(leaves), d, roll=roll(),
                     cup=cup, shade=0.85)
    if roots:
        foot_roots(P, roots, spread * 1.0, max(0.04, height * 0.04), rng)
    META[name] = {'kind': 'shrub', 'height': height, 'spread': spread}
    return P


def tuft_cards(name, seed, height, cells, sheet='dg_fol_under', cards=9, lean=(0.2, 0.5), tint=(1, 1, 1),
               kind='shrub', spread=None, core=3, curl=(0.1, 0.35), clumps=1, mound=None):
    """Upright cards standing on ONE root (axis 'up' art: heather spikes, a
    leaf spray, grass): `core` crossed through the centre, the rest round it
    leaning out, so the plant is full from every side."""
    P = Plant(name, seed, sheet, None, tint)
    P.height = height
    rng = P.rng

    def nfield(p):
        h = Vector((p.x, p.y, 0))
        h = h.normalized() if h.length > 1e-4 else Vector((0, 0, 0))
        return h * 0.6 + Z * 1.0

    P.nfield = nfield

    def vfield(p):
        k = clamp(p.z / height)
        v = 0.8 + 0.34 * k
        return (v * (0.96 + 0.07 * k), v, v * (1.03 - 0.08 * k))

    P.vfield = vfield
    tw = rng.uniform(0, math.pi)
    # several ROOTS a little apart (a heather clump is many plants, not one
    # whisk from a single point, round-2 review)
    roots_ = [Vector((0, 0, 0))] + [Vector((math.cos(tw + k * 2.1), math.sin(tw + k * 2.1), 0)) *
                                    (spread or height) * 0.22 for k in range(max(0, clumps - 1))]
    for k in range(core):
        P.upright_card(roots_[k % len(roots_)] - Z * 0.01, height * rng.uniform(0.95, 1.05), rng.choice(cells),
                       tw + k * math.pi / core, lean=rng.uniform(-0.06, 0.06), segs=2, curl=rng.uniform(-0.1, 0.1))
    for k in range(cards - core):
        a = tw + k / max(1, cards - core) * math.tau + rng.uniform(-0.3, 0.3)
        o = Vector((math.cos(a), math.sin(a), 0))
        base = roots_[k % len(roots_)]
        P.upright_card(base + o * height * 0.08 - Z * 0.01, height * rng.uniform(0.72, 0.95), rng.choice(cells),
                       a + math.pi / 2, lean=rng.uniform(*lean), lean_dir=o, segs=2, curl=rng.uniform(*curl),
                       tint=(rng.uniform(0.95, 1.05), 1.0, rng.uniform(0.95, 1.05)))
    if mound:
        # a SOLID low dome under the spikes: a top card and a ring
        sp = spread or height
        P.clump_card(Z * height * 0.2, sp * 0.95, mound, Z, roll=rng.uniform(0, math.tau), cup=0.25, shade=0.9)
        for k in range(6):
            a = tw + k * math.tau / 6
            d = Vector((math.cos(a), math.sin(a), 0.3)).normalized()
            P.clump_card(Vector((math.cos(a), math.sin(a), 0)) * sp * 0.24 + Z * height * 0.12,
                         sp * 0.62, mound, d, roll=rng.uniform(0, math.tau), cup=0.2, shade=0.85)
    META[name] = {'kind': kind, 'height': height, 'spread': spread or height * 0.6}
    return P


def conifer_shrub(name, seed, height, spread, sheet='dg_fol_pine', sides=('side_a', 'side_b', 'side_c'),
                  plans=('plan_a', 'plan_b', 'plan_c'), tiers=2, per=6, rise=0.0, tint=(1, 1, 1), crown=None,
                  stems=1, inner=None, stem_vis=True, column=False):
    """A juniper / young-spruce shrub: the pine tiers at shrub scale, side
    boughs (the droop) and plan boughs off `stems` short woody stems. With
    stems > 1 it is multi-stemmed with foliage right down to the ground.
    `inner` (a cell) fills the underside with a dark cone of steep cards so
    the skirt is never hollow."""
    P = Plant(name, seed, sheet, BARK_PINE, tint)
    P.height = height
    rng = P.rng

    def nfield(p):
        h = Vector((p.x, p.y, 0))
        h = h.normalized() if h.length > 1e-4 else Vector((1, 0, 0))
        return h + Z * (0.5 + 0.6 * clamp(p.z / height))

    P.nfield = nfield

    def vfield(p):
        k = clamp(p.z / height)
        v = 0.78 + 0.4 * k
        return (v * (0.95 + 0.08 * k), v, v * (1.04 - 0.1 * k))

    P.vfield = vfield
    tw = rng.uniform(0, math.tau)
    bases = []
    for s_ in range(stems):
        a = tw + s_ / max(1, stems) * math.tau
        off = Vector((math.cos(a), math.sin(a), 0)) * (spread * 0.22 if stems > 1 else 0)
        top = off * 1.6 + Z * height * (0.5 if stems == 1 else rng.uniform(0.5, 0.62))
        if stem_vis:
            P.tube([off - Z * 0.12, top], [height * 0.022, height * 0.008], sides=4, shade=(0.3, 0.4), tip=True,
                   cap_start=False)
        bases.append((off, top))
    for s_, (off, top) in enumerate(bases):
        for t_ in range(tiers):
            f = t_ / max(1, tiers - 1)
            anchor = off.lerp(top, (0.06 if stems > 1 else 0.42) + (0.86 if stems > 1 else 0.34) * f)
            span = spread * (1.0 - 0.4 * f) * (0.8 if (inner and t_ == 0) else 1.0)
            count = max(2, per - t_ - (1 if stems > 1 else 0))
            if column:
                # a foliage COLUMN up each stem: the side boughs hang from
                # three heights and overlap, so no bare stem shows between the
                # skirt and the top (round-4 review: "cocktail umbrellas")
                count = 2
                span = spread * (0.9 - 0.3 * f)
            tw += 1.1
            for k in range(count):
                a = tw + k / count * math.tau + rng.uniform(-0.25, 0.25)
                o = Vector((math.cos(a), math.sin(a), 0))
                ln = span * rng.uniform(0.7, 1.2)
                tn = (rng.uniform(0.94, 1.06), 1.0, rng.uniform(0.94, 1.06))
                P.side_card(anchor, o, ln, rng.choice(sides), droop=rng.uniform(0.35, 0.6) - rise,
                            roll=rng.uniform(-0.3, 0.3), lift=rise, tint=tn)
                if (stems == 1 or t_ == 0) and not column:
                    low = t_ == 0 and inner
                    P.plan_card(anchor + Z * 0.03, o, ln * (0.72 if low else 0.95), rng.choice(plans),
                                droop0=-rise + rng.uniform(-0.05, 0.1),
                                droop1=(rng.uniform(0.35, 0.55) if low else rng.uniform(0.45, 0.8)) - rise,
                                roll=rng.uniform(-0.2, 0.2), tint=tn)
    if inner:
        for k in range(5):
            a = tw + k / 5 * math.tau
            o = Vector((math.cos(a), math.sin(a), 0))
            P.plan_card(Z * height * 0.45, o, spread * 0.85, inner, droop0=0.75, droop1=1.15,
                        roll=rng.uniform(-0.2, 0.2), shade=0.8)
    if crown:
        for off, top in bases:
            ch = height * (0.5 if stems > 1 else 0.42)
            for k in range(2):
                P.upright_card(top - Z * ch * 0.5, ch, crown, rng.uniform(0, math.pi) + k * math.pi / 2)
    META[name] = {'kind': 'shrub', 'height': height, 'spread': spread}
    return P


def mat_shrub(name, seed, height, spread, cells=('juniper', 'juniper_b'), sheet='dg_fol_under', arc=math.tau,
              drape=0.0, tint=(1, 1, 1), spokes=9):
    """A creeping MAT: plan cards radiating flat over the ground (at most ~20
    degrees up) with the centre filled, so it reads as a low mat rather than
    a mop. `arc` < tau and `drape` > 0 make it a one-sided mat that spills
    down over a ledge, a plant you can sit on a rock edge."""
    P = Plant(name, seed, sheet, None, tint)
    P.height = height
    rng = P.rng
    c = Vector((0, 0, height * 0.3))

    def nfield(p):
        d = p - c
        return Vector((d.x, d.y, 0)).normalized() * 0.6 + Z * 1.0

    P.nfield = nfield

    def vfield(p):
        k = clamp((p.z + 0.1) / (height + 0.1))
        v = 0.92 + 0.12 * k
        return (v * (0.95 + 0.08 * k), v, v * (1.04 - 0.1 * k))

    P.vfield = vfield
    a0 = rng.uniform(0, math.tau)
    for k in range(spokes):
        a = a0 + (k / max(1, spokes - (0 if arc >= math.tau else 1))) * arc + rng.uniform(-0.15, 0.15)
        o = Vector((math.cos(a), math.sin(a), 0))
        ln = spread * rng.uniform(0.85, 1.1)
        # rises a little off the crown, then lies back down to the soil (or
        # spills over the rock's edge with `drape`)
        P.plan_card(c - o * 0.05, o, ln, rng.choice(cells), droop0=rng.uniform(-0.3, -0.12),
                    droop1=rng.uniform(0.35, 0.55) + drape, roll=rng.uniform(-0.25, 0.25), segs=3,
                    tint=(rng.uniform(0.95, 1.06), 1.0, rng.uniform(0.94, 1.05)))
    for k in range(3):
        a = a0 + k / 3 * arc + 0.4
        o = Vector((math.cos(a), math.sin(a), 0))
        P.plan_card(c + Z * height * 0.08, o, spread * 0.5, rng.choice(cells), droop0=-0.2, droop1=0.35,
                    roll=rng.uniform(-0.2, 0.2), shade=1.06)
    META[name] = {'kind': 'shrub', 'height': height, 'spread': spread}
    return P


def fern(name, seed, height, fronds, cells=('fern', 'fern_b'), sheet='dg_fol_grass', tint=(1, 1, 1)):
    """A fern shuttlecock: fronds of varied length rising steeply out of one
    crown and ARCHING over, drooping at the tips, with a few young fronds
    standing more upright in the middle."""
    P = Plant(name, seed, sheet, None, tint)
    P.height = height
    rng = P.rng
    c = Vector((0, 0, height * 0.4))

    def nfield(p):
        d = p - c
        return Vector((d.x, d.y, 0)).normalized() * 0.8 + Z * 0.9

    P.nfield = nfield

    def vfield(p):
        k = clamp(p.z / height)
        v = 0.74 + 0.44 * k
        return (v * (0.96 + 0.06 * k), v, v * (1.03 - 0.08 * k))

    P.vfield = vfield
    tw = rng.uniform(0, math.tau)
    for k in range(fronds):
        a = tw + k / fronds * math.tau + rng.uniform(-0.25, 0.25)
        o = Vector((math.cos(a), math.sin(a), 0))
        ln = height * rng.uniform(1.1, 1.75)
        P.plan_card(Z * 0.02 + o * 0.03, o, ln, rng.choice(cells), droop0=rng.uniform(-1.55, -1.35),
                    droop1=rng.uniform(1.15, 1.45), roll=rng.uniform(-0.3, 0.3), segs=4,
                    tint=(rng.uniform(0.94, 1.06), 1.0, rng.uniform(0.94, 1.06)))
    for k in range(3):
        a = tw + k * math.tau / 3 + 0.5
        o = Vector((math.cos(a), math.sin(a), 0))
        P.plan_card(Z * 0.02, o, height * rng.uniform(0.85, 1.05), rng.choice(cells), droop0=-1.5, droop1=-0.3,
                    roll=rng.uniform(-0.3, 0.3), segs=3, shade=1.06)
    META[name] = {'kind': 'shrub', 'height': height, 'spread': height * 1.3}
    return P


def twigs(name, seed, height, spread, stems=5):
    """A bare winter shrub: stems from a small root crown, each FORKING with
    a kink at every fork, thick and dark at the base and pale and whip-thin at
    the tips (a bark gradient in the vertex colour)."""
    P = Plant(name, seed, 'dg_fol_under', BARK, (1, 1, 1))
    P.height = height
    rng = P.rng

    def grow(p, d, ln, r, depth):
        end = p + d * ln
        lo, hi = 0.5 + 0.3 * depth, 0.8 + 0.3 * depth
        if depth == 2:
            P.tube([p - d * r, end], [r, r * 0.7], sides=3, shade=(lo, hi), cap_start=False, cap_end=True,
                   v_scale=3.0)
            return
        # a kink part way along: twigs never grow dead straight
        kink = (d + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0.1))).normalized()
        mid = p + d * ln * 0.5
        end = mid + kink * ln * 0.5
        if depth == 0:
            k2 = (kink + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0.15))).normalized()
            q1 = p + d * ln * 0.35
            q2 = q1 + kink * ln * 0.35
            end = q2 + k2 * ln * 0.3
            kink = k2
            P.tube([p - d * r, q1, q2, end], [r, r * 0.8, r * 0.62, r * 0.5], sides=3, shade=(lo, hi),
                   cap_start=False, cap_end=False, v_scale=3.0)
        else:
            end = p + kink * ln
            P.tube([p - d * r, end], [r, r * 0.55], sides=3, shade=(lo, hi), cap_start=False, cap_end=False,
                   v_scale=3.0)
        for s_ in (-1, 1):
            ax = kink.cross(Z)
            ax = ax.normalized() if ax.length > 1e-4 else Vector((1, 0, 0))
            nd = (kink + ax * s_ * rng.uniform(0.35, 0.6) + Z * rng.uniform(0.1, 0.3)).normalized()
            grow(end, nd, ln * rng.uniform(0.55, 0.7), r * 0.5, depth + 1)

    for k in range(stems):
        a = k / stems * math.tau
        o = Vector((math.cos(a), math.sin(a), 0))
        # an even FAN of stems (round-3: two groups read as a tuning fork)
        tl = 0.25 + 0.3 * (k % 2)
        d = Vector((o.x * tl, o.y * tl, 1)).normalized()
        grow(o * 0.15 - Z * 0.08, d, height * rng.uniform(0.4, 0.5), max(0.028, height * 0.035), 0)
    META[name] = {'kind': 'shrub', 'height': height, 'spread': spread}
    return P


def rock_cling(name, seed):
    """A creeping mat SEATED ON ITS OWN BOULDER: a lichen-grey stone with the
    moss mat spilling over its crown and down one side. As a free-standing
    mat it read as a spider on flat ground (round-2 review), shipped on the
    rock it is placed right wherever it goes."""
    P = Plant(name, seed, 'dg_fol_under', L.rock_material(), (0.94, 0.98, 1.03))
    rng = P.rng
    rx, ry, rz = 0.8, 0.68, 0.72
    P.height = rz * 1.6
    P.boulder(Vector((0, 0, 0)), rx, ry, rz, rng, rings=7, sides=12, sink=0.18, light=1.0)
    c = Vector((-0.18, 0.06, rz * 0.8))

    def nfield(p):
        d = p - c
        return Vector((d.x, d.y, 0)).normalized() * 0.5 + Z * 1.0

    P.nfield = nfield
    P.vfield = lambda p: (0.7 + 0.35 * clamp(p.z / 0.6),) * 3
    # a moss CARPET: broad cupped pad cards laid ON the stone, each facing
    # out along the rock's own normal, over the crown and down one flank
    # (round-6 review: the strand cards read as combed hair)
    a0 = rng.uniform(0, math.tau)
    cz = -rz * 0.18
    dirs = []
    for k in range(3):
        a = a0 + k / 3 * math.tau
        dirs.append(Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 1.0)).normalized())
    for k in range(7):
        a = a0 + k / 7 * math.pi * 1.3
        el = rng.uniform(0.55, 1.0)
        dirs.append(Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el))))
    for d in dirs:
        surf = Vector((d.x * rx, d.y * ry, cz + d.z * rz))
        nrm = Vector((d.x / rx, d.y / ry, d.z / rz)).normalized()
        P.clump_card(surf + nrm * 0.02, rng.uniform(0.5, 0.62), rng.choice(('leaf_round', 'leaf_b', 'leaf_round')),
                     nrm, roll=rng.uniform(0, math.tau), cup=-0.08, shade=1.0)
    # the STONE blocks (SPACEY, 2026-09-24: "add collision for it"); the moss on
    # it stays walk-through like every other plant. NO moveTopY: the rock is
    # 0.6 yd tall and the player's stride (MAX_STEP_HEIGHT, 1.0 yd) walks
    # straight up any standable top below that, so a standable rock never felt
    # solid ("the collision still not working"). Without it the box blocks at
    # every height, like a wall or a trunk.
    top = rz * (1 - 0.18)
    META[name] = {'kind': 'shrub', 'height': rz * 1.3, 'spread': rx,
                  'boxes': [{'x': 0, 'y': round(top * 0.5, 3), 'z': 0, 'hx': round(rx * 0.86, 3),
                             'hy': round(top * 0.5, 3), 'hz': round(ry * 0.86, 3)}]}
    return P


OLIVE = (1.05, 1.03, 0.9)
DUSK = (0.94, 0.98, 1.03)
LEAFY = ('leaf_a', 'leaf_b', 'leaf_round', 'leaf_young')

SPECS = {
    'shrub_round_a': lambda: dome('shrub_round_a', 101, 0.85, 0.66, ('leaf_a', 'leaf_round'), cards=10, ring=6,
                                  roots=0, core=0, squash=0.85, tops=('leaf_round',), tops_z=0.6),
    'shrub_round_b': lambda: dome('shrub_round_b', 102, 1.4, 0.8, ('leaf_b', 'leaf_a', 'leaf_young'), cards=9,
                                  ring=5, roots=0, side_lobes=3, lobe_scale=(1.25, 0.8, 1.0), core=0),
    'shrub_sprawl': lambda: mat_shrub('shrub_sprawl', 103, 0.45, 1.1, cells=('juniper_b', 'juniper_b', 'juniper'),
                                      tint=OLIVE, spokes=10),
    'shrub_upright': lambda: conifer_shrub('shrub_upright', 104, 1.8, 0.5, tiers=4, per=3, rise=0.3, tint=DUSK,
                                           stems=3, crown='crown', column=True),
    'shrub_twig_bare': lambda: twigs('shrub_twig_bare', 105, 1.1, 0.7),
    'shrub_snow_a': lambda: dome('shrub_snow_a', 106, 1.0, 0.65, ('leaf_cold',), tops=('snow_clump',), cards=11,
                                 ring=5, upright=True, crown_cells=('snow_top',), tops_z=0.6, core=0),
    'shrub_snow_b': lambda: conifer_shrub('shrub_snow_b', 107, 0.85, 0.9, sheet='dg_fol_snow',
                                          sides=('side_snow_a', 'side_snow_b'), plans=('plan_snow_a', 'plan_snow_b'),
                                          tiers=2, per=6, inner='plan_cold_a', stem_vis=False, rise=0.15),
    'shrub_fern': lambda: fern('shrub_fern', 108, 0.95, 9),
    'shrub_tuft': lambda: tuft_cards('shrub_tuft', 109, 0.75, ('leaf_spray', 'leaf_spray_b'), cards=7,
                                     tint=OLIVE, spread=0.8),
    'shrub_rock_cling': lambda: rock_cling('shrub_rock_cling', 110),
    'grass_tuft': lambda: tuft_cards('grass_tuft', 201, 0.5, ('grass_a',), sheet='dg_fol_grass',
                                     cards=7, kind='grass'),
    'grass_tall': lambda: tuft_cards('grass_tall', 202, 1.4, ('grass_b', 'grass_b', 'grass_a'),
                                     sheet='dg_fol_grass', cards=8, lean=(0.12, 0.3), kind='grass'),
    'grass_snow': lambda: tuft_cards('grass_snow', 203, 0.45, ('grass_snow',), sheet='dg_fol_grass', cards=7,
                                     kind='grass'),
    # new, 2026-09-24
    'shrub_berry': lambda: dome('shrub_berry', 111, 1.0, 0.72, ('leaf_b',), tops=('berry',), cards=8,
                                ring=6, roots=3, core=0, tops_z=0.55),
    'shrub_bloom': lambda: dome('shrub_bloom', 112, 1.3, 0.8, ('leaf_a',),
                                tops=('bloom_full', 'bloom_a', 'bloom_dense'), sheet='dg_fol_bloom', cards=10, ring=6,
                                roots=0, size_mul=0.85, tops_z=0.28, core=0),
    'shrub_heather': lambda: tuft_cards('shrub_heather', 113, 0.7, ('heather', 'heather_b'), cards=12,
                                        lean=(0.25, 0.55), spread=1.0, core=4, clumps=4, mound='leaf_b'),
    'grass_bloom': lambda: tuft_cards('grass_bloom', 204, 0.65, ('grass_bloom', 'grass_a'), sheet='dg_fol_grass',
                                      cards=7, kind='grass'),
    'grass_dry': lambda: tuft_cards('grass_dry', 205, 0.55, ('grass_dry', 'grass_dry', 'grass_a'),
                                    sheet='dg_fol_grass', cards=7, kind='grass'),
}

os.makedirs(OUT_DIR, exist_ok=True)
meta_path = os.path.join(OUT_DIR, 'dg_shrubs.json')
if ONLY and os.path.exists(meta_path):
    META.update(json.load(open(meta_path)))
for name, spec in SPECS.items():
    if ONLY and name not in ONLY:
        continue
    P = spec()
    obj, tris = P.build(ao_rays=24)
    d = obj.dimensions
    print('DGSHRUB', name, 'tris', tris, 'dims', round(d.x, 2), round(d.y, 2), round(d.z, 2))
    assert tris < TRI_BUDGET, (name, tris)
    META[name].update({'two_sided': True, 'tris': tris, 'dims': [round(d.x, 3), round(d.z, 3), round(d.y, 3)]})
    L.export(obj, os.path.join(OUT_DIR, name + '.glb'))
json.dump(META, open(meta_path, 'w'), indent=1)
print('DGSHRUB done')
