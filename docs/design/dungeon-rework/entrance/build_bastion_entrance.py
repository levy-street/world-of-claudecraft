"""The Sunken Bastion world entrance: the Drowned Gate Tower.

  blender -b --factory-startup --python build_bastion_entrance.py -- --out DIR
      [--terrain DIR] [--renders all|quick|beauty|maps|none] [--tag NAME] [--no-ao]

The barbican of the Court's drowned keep (Mirefen Marsh, door (45, 515)),
swallowed to its shoulders by the peat knoll the north fen road climbs: two
truncated round towers leaning outward, the outer arch with its portcullis
jammed half way, the broken star-glass rosette of the Court over it, the tide
line written on every stone, the wardens' rotten hoarding and Olen's torn
banner on the dry tower, an open gate court, the inner arch (the door) with
its flood sill, a curtain wall running down the slope into rubble, a fallen
tower drum beside the road, the worn causeway, peat, reed and weed.

Run from the repo: --out tmp/asset_src/sunken_bastion_entrance --terrain <dir
of the probe's bastion_heightgrid.json and bastion_surroundings.json>
(probe.mts beside this file writes them:
`npx tsx probe.mts bastion 45 515 <dir> 40 120`), then
node scripts/assets/sunken_bastion_entrance/build.mjs.

Local game coords via ec.B(lx, lz, y): lx = x - 45 (+ WEST), lz = z - 515
(+ NORTH), y = y - terrainHeight(45, 515). In Blender that is X = lx, Y = -lz
(so SOUTH is +Y), Z = y. Three GLBs share ONE origin, the door at its terrain
height:
  sunken_bastion_entrance.glb         towers, gate front, court, iron and timber
  sunken_bastion_entrance_ruins.glb   curtain wall, fallen drum, causeway, peat
  sunken_bastion_entrance_growth.glb  reed, sedge, weed, moss, the banner
Materials: KitStone (lit, vertex colour), KitLeaf (lit, double sided),
KitGlow (the rosette's pale core, unlit), KitWet (lit and glossy: star glass,
standing water).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'kit'))
sys.path.insert(0, HERE)
import bastion_ruin_kit as rk  # noqa: E402
import entrance_common as ec  # noqa: E402
from bastion_ruin_kit import (COURT, COURT_COOL, COURT_DARK, COURT_PALE, GLOW, K_CLOTH, K_EARTH, K_GLASS,  # noqa: E402
                              K_LEAF, K_METAL, K_PAVE, K_RAW, K_STONE, K_WATER, K_WOOD, LEAF, STONE, TAU, WET, B, Ruin,
                              arch_hole, arch_points, mix, scale, smooth)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


OUT = arg('--out', os.path.join(HERE, 'out'))
TERRAIN = arg('--terrain', os.path.join(OUT, 'terreno'))
RENDERS = arg('--renders', 'none')
TAG = arg('--tag', '')
os.makedirs(OUT, exist_ok=True)
GR = ec.Ground(os.path.join(TERRAIN, 'bastion_heightgrid.json'))
SURR = json.load(open(os.path.join(TERRAIN, 'bastion_surroundings.json')))
gh = GR.h

VOIDC = (0.012, 0.016, 0.016)
STAR = (0.80, 0.90, 0.96)
STAR_DEEP = (0.26, 0.40, 0.52)
STAR_CORE = (0.90, 0.97, 1.0)
CLOTH = (0.18, 0.25, 0.38)
CLOTH_PALE = (0.56, 0.57, 0.52)
FLAG = (0.37, 0.38, 0.35)
WATER = (0.02, 0.035, 0.03)
COLLIDERS = []
FOOTINGS = []
SOCKETS = {'drips': [], 'puddles': [], 'weeps': []}
TOPS = []             # wall and tower tops (Blender point, width) for the growth pass

# ---- layout (door-local) -------------------------------------------------------------
TIDE = 1.75           # the flood line, level, above the door's ground
FRONT_Z = -3.0        # the gate front's centre line
WALL_D = 1.3
FRONT_HW = 4.6
ARCH = dict(half=2.2, spring=2.7, rise=2.2)        # the outer arch
INNER = dict(half=1.25, spring=2.75, rise=1.25)    # the inner arch: the door
INNER_D = 1.1
COURT_X = 2.65        # the court's side walls (their centre lines)
KERB = dict(z0=0.1, z1=0.5, top=0.72)              # the flood sill in the door
WINDOW_Z = 0.5        # the engine's dark-water window stands here
WATER_Y = 0.55
ROSE = dict(y=6.95, r=1.0)
PORT_Y = 2.05         # the portcullis' spike tips (mean), above the door's ground
ROAD = [(-25.0, -45.0), (0.0, 0.0)]
WARD_STONES = [(-2.0, -3.0), (3.0, 2.0)]
EXIT_DROP = (0.0, -4.0)

TOWER = {
    'w': dict(cx=7.2, cz=-1.2, r=2.9, lean_w=math.radians(7.0), lean_s=math.radians(2.5), pivot=-2.9,
              flare=(0.2, -5.5, 0.45)),
    'e': dict(cx=-7.2, cz=-1.2, r=2.9, lean_w=math.radians(-5.0), lean_s=math.radians(1.2), pivot=0.7,
              flare=(2.6, -2.0, 0.32)),
}


def tower_matrix(key):
    t = TOWER[key]
    return (Matrix.Translation(B(t['cx'], t['cz'], t['pivot'])) @ Matrix.Rotation(t['lean_w'], 4, 'Y')
            @ Matrix.Rotation(-t['lean_s'], 4, 'X') @ Matrix.Translation((0, 0, -t['pivot'])))


def tower_point(key, theta, y, out=0.0):
    """A point on a tower's leaning face (Blender space) and its outward normal."""
    t = TOWER[key]
    M = tower_matrix(key)
    r = tower_radius(key, y) + out
    p = M @ Vector((math.cos(theta) * r, math.sin(theta) * r, y))
    n = (M.to_3x3() @ Vector((math.cos(theta), math.sin(theta), 0))).normalized()
    return p, n


def tower_radius(key, y):
    t = TOWER[key]
    a, b, k = t['flare']
    return t['r'] + k * smooth(a, b, y)


def collider_obb(name, cx, cz, hw, hd, rot, top):
    COLLIDERS.append({'name': name, 'type': 'obb', 'lx': round(cx, 3), 'lz': round(cz, 3), 'hw': round(hw, 3),
                      'hd': round(hd, 3), 'rot': round(rot, 4), 'top': round(top, 2)})


def collider_circle(name, cx, cz, r, top):
    COLLIDERS.append({'name': name, 'type': 'circle', 'lx': round(cx, 3), 'lz': round(cz, 3), 'r': round(r, 3),
                      'top': round(top, 2)})


def footing(name, cx, cz, hw, hd, rot, bury):
    """Register a footing and return its underside: `bury` under the lowest
    ground at its centre and four corners (the points the sim test samples;
    rot is the three.js yaw the colliders use)."""
    c, s = math.cos(rot), math.sin(rot)
    lo = min(gh(cx + u * c + v * s, cz - u * s + v * c)
             for (u, v) in ((0, 0), (-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)))
    FOOTINGS.append((name, cx, cz, hw, hd, rot, lo - bury))
    return lo - bury


def gb(x, y):
    """Ground height at a Blender XY."""
    return gh(x, -y)


def P(name, **kw):
    return Ruin('Entrance_' + name, tide=TIDE, **kw)


def strut(p, a, b, w, h, color, mat=STONE, bevel=0.0, chip=0.0, spin=0.0, face=None):
    """A bar of section w by h from a to b (Blender space); its h side looks
    up, or along `face` when one is given."""
    a, b = Vector(a), Vector(b)
    d = b - a
    ln = d.length
    x = d / ln
    up = Vector(face) if face is not None else (Vector((0, 0, 1)) if abs(x.z) < 0.95 else Vector((0, 1, 0)))
    y = up.cross(x).normalized()
    z = x.cross(y)
    R = Matrix((x, y, z)).transposed().to_4x4()
    M = Matrix.Translation((a + b) / 2) @ R @ Matrix.Rotation(spin, 4, 'X')
    return p.box((0, 0, 0), (ln, w, h), color, mat=mat, bevel=bevel, chip=chip, M=M)


def chain(p, pts, link=0.2, w=0.1, t=0.04):
    """A heavy chain along a polyline: flat links, every other one turned."""
    pts = [Vector(q) for q in pts]
    k = 0
    for (a, b) in zip(pts, pts[1:]):
        n = max(1, int(round((b - a).length / (link * 0.8))))
        for i in range(n):
            q0 = a + (b - a) * (i / n)
            q1 = a + (b - a) * ((i + 1.18) / n)
            strut(p, q0, q1, w, t, p.vary(rk.IRON, 0.15), spin=(k % 2) * math.pi / 2)
            k += 1


def slope_matrix(lx, lz, yaw=0.0, lift=0.0):
    """A frame lying on the terrain at (lx, lz): Z along the ground normal."""
    e = 0.4
    dx = (gh(lx + e, lz) - gh(lx - e, lz)) / (2 * e)
    dz = (gh(lx, lz + e) - gh(lx, lz - e)) / (2 * e)
    n = Vector((-dx, dz, 1.0)).normalized()          # Blender: Y = -lz
    x = Vector((math.cos(yaw), math.sin(yaw), 0))
    x = (x - n * x.dot(n)).normalized()
    y = n.cross(x)
    R = Matrix((x, y, n)).transposed().to_4x4()
    return Matrix.Translation(B(lx, lz, gh(lx, lz)) + n * lift) @ R


def rubble(p, lx, lz, spread, count, size=(0.3, 0.7), color=None, sink=0.45, clear=1.1):
    """Fallen blocks half sunk in the peat, lying to the slope."""
    rng = p.rng
    for _ in range(count):
        x, z = lx + rng.uniform(-spread, spread), lz + rng.uniform(-spread, spread)
        s = rng.uniform(*size)
        if any(math.hypot(x - wx, z - wz) < clear for (wx, wz) in WARD_STONES + [EXIT_DROP]) or (abs(x) < 2.0 and -14 < z < 0.3):
            continue
        M = slope_matrix(x, z, yaw=rng.random() * TAU, lift=s * (0.5 - sink) * rng.uniform(0.3, 1.0))
        M = M @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, 'X') @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 4, 'Y')
        with p.as_kind(K_PAVE):
            p.box((0, 0, 0), (s * rng.uniform(1.0, 1.7), s * rng.uniform(0.7, 1.1), s * rng.uniform(0.55, 0.9)),
                  color or p.tone(x, z), chip=0.34, bevel=min(0.05, s * 0.1) if s > 0.5 else 0.0, M=M,
                  taper=rng.uniform(0.7, 1.0))


# ================================================================ the towers
def loop_hole(tc, yc, r, cross=False):
    def hole(t, y):
        d = abs(((t - tc + math.pi) % TAU) - math.pi) * r
        if d < 0.11 and abs(y - yc) < 0.62:
            return True
        return cross and d < 0.3 and abs(y - yc - 0.12) < 0.1
    return hole


def tower(p, key, top_fn, loops, bands, shift=None):
    t = TOWER[key]
    M = tower_matrix(key)
    r = t['r']
    holes = [loop_hole(tc, yc, r, cr) for (tc, yc, cr) in loops]
    y0 = footing(f'tower_{key}', t['cx'], t['cz'], r, r, 0.0, 0.8)
    tops = p.drum(lambda y: tower_radius(key, y), y0, top_fn, M=M, holes=holes, bands=bands, shift=shift,
                  ground=gb, lining=0.9)
    TOPS.extend(tops)
    m = p.mark()
    tmin = min(top_fn(TAU * k / 96) for k in range(96))
    tmax = max(top_fn(TAU * k / 96) for k in range(96))
    # The dark of each loop, and the rubble heart of the truncated crown.
    with p.as_kind(K_RAW):
        for (tc, yc, cr) in loops:
            p.box((math.cos(tc) * (r - 0.36), math.sin(tc) * (r - 0.36), yc), (0.3, 0.9 if cr else 0.5, 1.5), VOIDC, yaw=tc)
        ring = [(math.cos(TAU * i / 14) * (r - 0.8), math.sin(TAU * i / 14) * (r - 0.8), tmin - 0.7) for i in range(14)]
        p.quad(ring, (0.1, 0.1, 0.1), want=(0, 0, 1))
    rng = p.rng
    for _ in range(11):
        a, d = rng.random() * TAU, rng.random() * (r - 1.2)
        s = rng.uniform(0.4, 0.8)
        p.box((math.cos(a) * d, math.sin(a) * d, tmin - 0.7 + s * 0.3), (s * 1.4, s, s * 0.7), p.tone(a, d), chip=0.2,
              yaw=rng.random() * 3, pitch=rng.uniform(-0.4, 0.4), roll=rng.uniform(-0.4, 0.4))
    p.turn(m, M)
    for (tc, yc, _cr) in loops:
        q, _n = tower_point(key, tc, yc - 0.5)
        p.soot.append((q, 0.9, 0.45))
    collider_circle(f'tower_{key}', t['cx'], t['cz'], r + 0.15, tmax)
    return tmin, tmax


def towers():
    p = P('Towers')

    # West: the tall one, leaning out over its slope. Its outer side still
    # stands to the wall walk with a few merlons; the side toward the gate
    # tore away with the front wall and steps down to it; a wedge of the road
    # face has dropped along stepped cracks.
    def top_w(th):
        d = abs(((th - 3.75 + math.pi) % TAU) - math.pi)
        torn = 4.6 * smooth(1.25, 0.2, d) + 1.0 * smooth(2.2, 1.0, d)
        merlon = 0.85 if (int(th / 0.36) % 2 == 0 and d > 1.9) else 0.0
        return 13.3 - torn * 1.12 + merlon + 0.25 * math.sin(th * 5.0)

    def shift_w(th, y):
        d = ((th - 1.5 + math.pi) % TAU) - math.pi
        if abs(d) > 0.42 or y < 0.6:
            return (0.0, 0.0, 0.0)
        k = smooth(0.6, 8.0, y)
        return (0.12 * k, -0.18 * k, 0.0)

    tower(p, 'w', top_w, loops=[(1.95, 4.3, True), (0.75, 7.6, False), (1.5, 9.2, False), (1.2, -1.2, False)],
          bands=[(-0.9, 0.32, 0.09, COURT_DARK), (5.7, 0.34, 0.13, COURT_PALE), (10.7, 0.3, 0.16, COURT_PALE)], shift=shift_w)

    # East: the dry one, half swallowed by the knoll, truncated low; its high
    # side faces the road and carries the wardens' hoarding.
    def top_e(th):
        return 6.9 + 1.0 * math.cos(th - 1.0) + 0.3 * math.sin(th * 4.0 + 1.0)

    tower(p, 'e', top_e, loops=[(1.3, 4.5, True), (2.35, 3.6, False)],
          bands=[(4.9, 0.34, 0.13, COURT_PALE)])
    return p


# ============================================================ the gate front
def front_top(x):
    """The gate front's top by local x (west +): the raised portcullis housing
    with the rosette, the wall walks either side, a breach on the east."""
    ax = abs(x)
    if ax < 2.1:
        top = 9.05 - (1.25 * smooth(1.1, 2.1, x) if x > 0 else 0.0) + (0.3 if ax < 0.5 else 0.0)
        return top
    merlon = 0.8 if int((x + 20) / 0.78) % 2 == 0 else 0.0
    if x < 0:
        return 7.15 + merlon - 1.5 * smooth(-2.3, -3.2, x) * smooth(-4.4, -3.5, x)
    return 7.15 + merlon * smooth(4.3, 3.6, x) - 0.9 * smooth(3.4, 4.6, x)


def gate_front():
    p = P('GateFront')
    L = FRONT_HW * 2
    a, b = (-FRONT_HW, FRONT_Z), (FRONT_HW, FRONT_Z)
    y0 = footing('gate_front', 0, FRONT_Z, FRONT_HW, WALL_D / 2, 0.0, 0.6)
    holes = [arch_hole(ARCH['half'], ARCH['spring'], ARCH['rise'], cx=L / 2),
             lambda u, y: math.hypot(u - L / 2, y - ROSE['y']) < ROSE['r']]

    def deform(u, n, y):
        # The wall follows the west tower down: it sags toward it and bows out.
        k = smooth(L / 2 + 1.0, L, u) * smooth(-3.0, 9.0, y)
        return (0.0, 0.12 * k, -0.2 * k)

    tops = p.wall(a, b, WALL_D, y0, lambda t: front_top(t * L - L / 2), holes=holes, deform=deform, missing=0.035,
                  ground=gb)
    TOPS.extend(tops)
    south = FRONT_Z - WALL_D / 2       # lz of the south face
    Ms = Matrix.Translation(B(0, FRONT_Z, ARCH['spring']))
    # The outer arch: a deep ring of voussoirs, one slipped, and a broken hood mould.
    pts = arch_points(ARCH['half'], ARCH['rise'], steps=7)
    p.arch(pts, 0.66, WALL_D + 0.16, COURT_PALE, Ms, bevel=0.06, drop={9: (0.02, -0.13, 0.05), 3: (0.0, -0.05, -0.03)},
           center=(0, 0))
    hood = [(x * (1 + 0.68 / ARCH['half']), z * (1 + 0.68 / ARCH['rise'])) for (x, z) in arch_points(ARCH['half'], ARCH['rise'], 9)]
    p.arch(hood, 0.2, 0.34, COURT, Ms, bevel=0.03, skip=(4, 5, 13), y_off=WALL_D / 2 + 0.06, center=(0, 0))
    # Imposts and the dressed jambs under them.
    for sx in (-1, 1):
        p.hewn(B(sx * (ARCH['half'] + 0.33), FRONT_Z, ARCH['spring'] - 0.19), (0.9, WALL_D + 0.26, 0.36),
               p.vary(COURT_PALE, 0.05))
        p.streaks.append((Vector(B(sx * (ARCH['half'] - 0.02), south - 0.02, ARCH['spring'] + 0.6)), 0.3, 4.6, 0.55))
        p.streaks.append((Vector(B(sx * (ARCH['half'] + 0.5), south - 0.02, ARCH['spring'] - 0.3)), 0.22, 3.2, 0.5))
    # Rust from the rosette's iron and from the cramps of the housing.
    for (x, y, w, ln, s) in ((-0.5, ROSE['y'] - 1.0, 0.25, 2.2, 0.55), (0.62, ROSE['y'] - 1.05, 0.2, 1.7, 0.45),
                             (-3.3, 6.2, 0.2, 2.6, 0.5), (3.0, 5.4, 0.22, 2.2, 0.5), (1.7, 8.2, 0.16, 1.6, 0.4)):
        p.streaks.append((Vector(B(x, south - 0.02, y)), w, ln, s))
    # The soffit of the arch and the rosette's eye are dark and damp.
    p.soot.append((Vector(B(0, FRONT_Z, ARCH['spring'] + ARCH['rise'] - 0.2)), 2.2, 0.55))
    rosette(p, south)
    for sx in (-1, 1):
        collider_obb(f'front_wall_{"w" if sx > 0 else "e"}', sx * (ARCH['half'] + (FRONT_HW - ARCH['half']) / 2), FRONT_Z,
                     (FRONT_HW - ARCH['half']) / 2, WALL_D / 2, 0.0, 9.05)
    return p


def rosette(p, south):
    """The Court's star-glass rosette: an eight-point star of pale glass in
    stone tracery, three shards gone, the pale core still lit."""
    R0 = Matrix.Translation(B(0, south, ROSE['y']))       # X across, Y out (south), Z up
    r = ROSE['r']
    S = Vector((0, 1, 0))

    def pt(ang, rad, out=0.0):
        return R0 @ Vector((math.cos(ang) * rad, out, math.sin(ang) * rad))

    ring = [(math.cos(TAU * i / 16) * r, math.sin(TAU * i / 16) * r) for i in range(17)]
    p.arch(ring, 0.3, 0.5, COURT_PALE, R0, bevel=0.045, y_off=-0.08, center=(0, 0), drop={11: (0.03, -0.06, 0.06)})
    with p.as_kind(K_RAW):
        p.quad([pt(TAU * i / 16, r + 0.05, -0.62) for i in range(16)], VOIDC, want=S)
    # blind on the court side: the eye is walled up behind the glass
    p.quad([pt(TAU * i / 16, r + 0.06, -WALL_D + 0.04) for i in range(16)], scale(COURT_DARK, 0.8), want=-S)
    P_ = [math.pi / 2 + k * TAU / 8 for k in range(8)]
    Q_ = [math.pi / 2 + (k + 0.5) * TAU / 8 for k in range(8)]
    ro, ri, rb = 0.93, 0.43, 0.2
    gone_star = {5}
    gone_outer = {1, 6}
    rng = p.rng

    def shard(a, b, c, col):
        """What is left of a broken pane along its edge a-b: a jagged tooth."""
        a, b, c = Vector(a), Vector(b), Vector(c)
        for k in range(2):
            t0, t1 = 0.08 + 0.45 * k, 0.4 + 0.45 * k
            tip = a.lerp(b, (t0 + t1) / 2) + (c - a.lerp(b, 0.5)) * rng.uniform(0.2, 0.45)
            p.quad([a.lerp(b, t0), a.lerp(b, t1), tip], p.vary(col, 0.08), mat=WET, want=S)

    with p.as_kind(K_GLASS):
        for k in range(8):
            a = pt(Q_[k - 1], ri, -0.12)
            b = pt(P_[k], ro, -0.06)
            c = pt(Q_[k], ri, -0.12)
            o = pt(P_[k], rb, -0.04)
            if k in gone_star:
                shard(a, b, o, STAR)
                shard(c, o, b, STAR)
            else:
                grime = 0.72 + 0.28 * smooth(-1.0, 0.6, math.sin(P_[k]))
                p.quad([o, a, b], scale(p.vary(STAR, 0.05), 0.62 * grime), mat=GLOW, want=S)
                p.quad([o, b, c], scale(p.vary(STAR, 0.05), 0.5 * grime), mat=GLOW, want=S)
            # the pane between this point and the next, out to the ring
            kn = (k + 1) % 8
            d = pt(P_[kn], ro, -0.06)
            e0, e1, e2 = pt(P_[k], r, -0.14), pt(Q_[k], r, -0.14), pt(P_[kn], r, -0.14)
            if k in gone_outer:
                shard(e0, e1, c, STAR_DEEP)
                shard(d, e2, c, STAR_DEEP)
            else:
                grime = 0.7 + 0.3 * smooth(-1.0, 0.6, math.sin(Q_[k]))
                p.quad([c, b, e0, e1], scale(p.vary(STAR_DEEP, 0.1), 0.62 * grime), mat=GLOW, want=S)
                p.quad([c, e1, e2, d], scale(p.vary(STAR_DEEP, 0.1), 0.5 * grime), mat=GLOW, want=S)
    # The tracery: stone bars along the star and out to the ring, the boss.
    for k in range(8):
        kn = (k + 1) % 8
        for (a, b) in ((pt(P_[k], ro, 0.0), pt(Q_[k], ri, 0.0)), (pt(Q_[k], ri, 0.0), pt(P_[kn], ro, 0.0)),
                       (pt(P_[k], ro - 0.04, 0.0), pt(P_[k], r + 0.04, 0.0))):
            if k in gone_star and rng.random() < 0.5:
                b = Vector(a).lerp(Vector(b), 0.55)
            strut(p, a, b, 0.11, 0.075, p.vary(COURT_PALE, 0.06), chip=0.1)
    boss = [(math.cos(TAU * i / 8) * (rb + 0.03), math.sin(TAU * i / 8) * (rb + 0.03)) for i in range(9)]
    p.arch(boss, 0.1, 0.16, COURT_PALE, R0, bevel=0.02, y_off=0.0, center=(0, 0))
    p.quad([pt(TAU * i / 8 + 0.39, rb + 0.035, 0.04) for i in range(8)], STAR_CORE, mat=GLOW, want=S)
    SOCKETS['rosette'] = [0.0, ROSE['y'], round(south - 0.1, 3), ROSE['r']]


# ================================================================ the court
def court():
    """The open gate court behind the outer arch (its vault long fallen), the
    inner arch that is the door with its flood sill, and the roofed passage
    that runs on into the mound."""
    p = P('Court')
    rng = p.rng
    z0, z1 = FRONT_Z + WALL_D / 2, INNER_D / 2
    zc = -INNER_D / 2
    for sx in (-1, 1):
        x = sx * COURT_X
        y0 = footing(f'court_wall_{"w" if sx > 0 else "e"}', x, (z0 + zc) / 2, 0.45, (zc - z0) / 2, 0.0, 0.6)
        hi, lo = (6.4, 5.0) if sx > 0 else (5.5, 6.1)
        tops = p.wall((x, z0 - 0.16), (x, zc + 0.16), 0.9, y0, lambda t, hi=hi, lo=lo: hi + (lo - hi) * t + 0.35 * math.sin(t * 7.0),
                      missing=0.03, ground=gb, course=(0.3, 0.5), unit=(1.1, 2.3), chip=0.09, proud=0.06)
        TOPS.extend(tops)
        collider_obb(f'court_wall_{"w" if sx > 0 else "e"}', x, (z0 + zc) / 2, 0.45, (zc - z0) / 2, 0.0, max(hi, lo))
        # The stubs of the fallen vault's ribs on each wall.
        for z in (-1.9, -0.9):
            for k in range(2):
                p.hewn(B(sx * (COURT_X - 0.52 - 0.2 * k), z, 4.3 + 0.36 * k), (0.42, 0.5, 0.36), p.vary(COURT_PALE, 0.07),
                       roll=sx * (0.3 + 0.35 * k), chip=0.14)
    # The inner arch: a cross wall with the door in it.
    hw = COURT_X + 0.45
    y0 = footing('inner_arch', 0, 0, hw, INNER_D / 2, 0.0, 0.6)
    tops = p.wall((-hw, 0.0), (hw, 0.0), INNER_D, y0, lambda t: 5.5 + 0.5 * math.sin(t * 5.0) - 0.9 * smooth(0.72, 1.0, t),
                  holes=[arch_hole(INNER['half'], INNER['spring'], INNER['rise'], cx=hw)], missing=0.02, ground=gb,
                  course=(0.3, 0.5), unit=(1.1, 2.3), chip=0.09, proud=0.06)
    TOPS.extend(tops)
    Mi = Matrix.Translation(B(0, 0, INNER['spring']))
    p.arch(arch_points(INNER['half'], INNER['rise'], steps=5), 0.5, INNER_D + 0.14, COURT_PALE, Mi, bevel=0.05,
           center=(0, 0), drop={6: (0.0, -0.07, 0.04)})
    for sx in (-1, 1):
        p.hewn(B(sx * (INNER['half'] + 0.26), 0, INNER['spring'] - 0.16), (0.7, INNER_D + 0.2, 0.3), p.vary(COURT_PALE, 0.05))
        collider_obb(f'door_pier_{"w" if sx > 0 else "e"}', sx * (INNER['half'] + (hw - INNER['half']) / 2), 0.0,
                     (hw - INNER['half']) / 2, INNER_D / 2, 0.0, 5.6)
    p.soot.append((Vector(B(0, 0.2, INNER['spring'] + 0.4)), 2.4, 0.8))
    # The Court's star cut over the door, worn almost flat.
    c = Vector(B(0, -INNER_D / 2 - 0.05, INNER['spring'] + INNER['rise'] + 0.82))
    for k in range(8):
        a0 = math.pi / 2 + k * TAU / 8
        a1, a2 = a0 - TAU / 16, a0 + TAU / 16
        tip = c + Vector((math.cos(a0) * 0.34, 0.0, math.sin(a0) * 0.34))
        l = c + Vector((math.cos(a1) * 0.15, 0.0, math.sin(a1) * 0.15))
        r_ = c + Vector((math.cos(a2) * 0.15, 0.0, math.sin(a2) * 0.15))
        p.quad([c + Vector((0, 0.05, 0)), l, tip], scale(COURT_PALE, 1.08), want=(0, 1, 0))
        p.quad([c + Vector((0, 0.05, 0)), tip, r_], scale(COURT_PALE, 0.8), want=(0, 1, 0))
    # The flood sill: a dressed kerb across the door, level, brimming.
    xs = [-INNER['half'] - 0.05, -0.42, 0.5, INNER['half'] + 0.05]
    kb = footing('flood_sill', 0, (KERB['z0'] + KERB['z1']) / 2, INNER['half'], (KERB['z1'] - KERB['z0']) / 2, 0.0, 0.3)
    for (xa, xb) in zip(xs, xs[1:]):
        hgt = KERB['top'] - kb - rng.uniform(0.0, 0.04)
        p.hewn(B((xa + xb) / 2, (KERB['z0'] + KERB['z1']) / 2, kb + hgt / 2), (xb - xa - 0.02, KERB['z1'] - KERB['z0'] + 0.1, hgt),
               p.vary(COURT_DARK, 0.06), chip=0.07, bevel=0.05)
    collider_obb('flood_sill', 0, (KERB['z0'] + 5.6) / 2, INNER['half'] + 0.1, (5.6 - KERB['z0']) / 2, 0.0, 4.2)
    # The roofed passage beyond the door, running into the mound: its walls
    # and its great roof slabs (the window hides its inside).
    zb = 5.6
    for sx in (-1, 1):
        x = sx * 1.62
        yb = footing(f'passage_wall_{"w" if sx > 0 else "e"}', x, (z1 + zb) / 2, 0.28, (zb - z1) / 2, 0.0, 0.5)
        tops = p.wall((x, z1 - 0.16), (x, zb), 0.55, yb, lambda t: 4.6 - 0.5 * t, missing=0.02, course=(0.42, 0.7), ground=gb)
        TOPS.extend(tops)
        collider_obb(f'passage_wall_{"w" if sx > 0 else "e"}', x, (z1 + zb) / 2, 0.28, (zb - z1) / 2, 0.0, 4.6)
    for k in range(4):
        z = z1 + 0.65 + k * 1.24
        p.hewn(B(rng.uniform(-0.08, 0.08), z, 4.62 - 0.14 * k), (4.0 + rng.uniform(-0.2, 0.2), 1.2, 0.42),
               p.tone(k, 3), chip=0.1, roll=rng.uniform(-0.04, 0.04), pitch=0.1 + rng.uniform(-0.03, 0.03))
    with p.as_kind(K_RAW):
        p.box(B(0, (z1 + zb) / 2 + 0.2, 2.2), (3.0, zb - z1 - 0.5, 4.4), VOIDC)
    SOCKETS['window'] = {'z': WINDOW_Z, 'half': INNER['half'], 'spring': INNER['spring'], 'rise': INNER['rise'],
                         'water': WATER_Y, 'kerb': KERB['top']}
    SOCKETS['pulse_light'] = [0.0, 1.9, -0.75]
    return p


# ========================================================== iron and timber
def fittings():
    """The jammed portcullis with its chains and the wardens' winch, the
    rotten hoarding on the dry tower, the banner's pole."""
    p = P('Fittings')
    rng = p.rng
    # ---- the portcullis: hangs crooked in its groove, a little south of the
    # wall's middle, its spiked feet over the lane.
    tilt = math.radians(3.2)
    Mp = Matrix.Translation(B(0, FRONT_Z - 0.2, PORT_Y)) @ Matrix.Rotation(tilt, 4, 'Y')
    half = ARCH['half'] - 0.1

    def soffit(x):
        return ARCH['spring'] - PORT_Y + ARCH['rise'] * math.sqrt(max(0.0, 1 - (x / ARCH['half']) ** 2)) + 0.5

    with p.as_kind(K_METAL):
        m = p.mark()
        xs = [-1.92 + 0.48 * i for i in range(9)]
        for i, x in enumerate(xs):
            top = max(1.2, soffit(x))
            # a square bar set on its edge, and its spiked foot
            p.box((x, 0, 0.5 + top / 2), (0.17, 0.17, top), p.vary(rk.IRON, 0.12), yaw=math.pi / 4, chip=0.05)
            foot = [(x + sx * 0.125, sy * 0.125, 0.56) for (sx, sy) in ((0, -1), (1, 0), (0, 1), (-1, 0))]
            tip = (x + rng.uniform(-0.02, 0.02), 0, 0.0 - (0.14 if i % 2 else 0.0))
            for k in range(4):
                mid = (Vector(foot[k]) + Vector(foot[(k + 1) % 4])) / 2
                p.quad([foot[k], foot[(k + 1) % 4], tip], p.vary(rk.IRON, 0.12), want=(mid.x - x, mid.y, -0.02))
        for (z, h, d) in ((0.74, 0.32, 0.13), (1.66, 0.24, 0.1), (2.56, 0.24, 0.1)):
            w = min(half, ARCH['half'] * math.sqrt(max(0.05, 1 - ((z + PORT_Y - ARCH['spring']) / ARCH['rise']) ** 2))
                    if z + PORT_Y > ARCH['spring'] else half) + 0.12
            for sy in (-1, 1):
                p.box((0, sy * 0.15, z), (2 * w, d, h), p.vary(rk.IRON, 0.1), chip=0.04, bevel=0.015)
            for x in xs:
                if abs(x) < w - 0.05:
                    for sy in (-1, 1):
                        p.box((x, sy * 0.225, z), (0.1, 0.06, 0.1), p.vary(rk.IRON, 0.2), yaw=math.pi / 4, taper=0.4)
        # the side stiles running in the grooves
        for sx in (-1, 1):
            p.box((sx * (half + 0.02), 0, 1.7), (0.22, 0.24, 3.0), p.vary(rk.IRON, 0.1), chip=0.05)
        p.turn(m, Mp)
        for i, x in enumerate(xs):
            q = Mp @ Vector((x, 0, -(0.14 if i % 2 else 0.0)))
            SOCKETS['drips'].append([round(q.x, 3), round(q.z, 3), round(-q.y, 3)])
        # A snapped chain still hanging from the soffit, east of the middle.
        chain(p, [B(-1.25, FRONT_Z - 0.05, ARCH['spring'] + 1.75), B(-1.22, FRONT_Z - 0.08, 3.4), B(-1.3, FRONT_Z - 0.1, 2.75)])
        # ---- the winch on the court's west wall: a drum in an iron-bound
        # frame, a ratchet wheel, its crank, the chain up to the pulley.
        wx, wz = COURT_X - 0.45, -1.55
        wy = gh(wx - 0.3, wz) + 0.1
        wfoot = footing('winch', wx - 0.28, wz, 0.25, 0.45, 0.0, 0.12)
    for dz in (-0.42, 0.42):
        with p.as_kind(K_WOOD):
            p.box(B(wx - 0.28, wz + dz, wy + 0.85), (0.56, 0.16, 1.7), p.vary(rk.TIMBER_GREY, 0.1), chip=0.08)
            strut(p, B(wx - 0.05, wz + dz, wy + 1.65), B(wx - 0.7, wz + dz, wy + 0.25), 0.11, 0.13, p.vary(rk.TIMBER_GREY, 0.12), chip=0.08)
    with p.as_kind(K_WOOD):
        p.prism(B(wx - 0.32, wz - 0.36, wy + 1.05), 8, 0.27, 0.27, 0.72, p.vary(rk.TIMBER_GREY, 0.08), axis=(0, -1, 0))
    with p.as_kind(K_METAL):
        # the ratchet wheel and its pawl, the crank
        c = Vector(B(wx - 0.32, wz - 0.52, wy + 1.05))
        for k in range(10):
            a0, a1 = TAU * k / 10, TAU * (k + 1) / 10
            r0, r1 = 0.5, 0.38
            p.quad([c + Vector((0, 0.03, 0)), c + Vector((math.cos(a0) * r0, 0.03, math.sin(a0) * r0)),
                    c + Vector((math.cos(a1) * r1, 0.03, math.sin(a1) * r1))], p.vary(scale(rk.RUST_BRIGHT, 0.8), 0.2), want=(0, 1, 0))
            p.quad([c + Vector((math.cos(a0) * r0, 0.03, math.sin(a0) * r0)), c + Vector((math.cos(a0) * r0, -0.03, math.sin(a0) * r0)),
                    c + Vector((math.cos(a1) * r1, -0.03, math.sin(a1) * r1)), c + Vector((math.cos(a1) * r1, 0.03, math.sin(a1) * r1))],
                   p.vary(rk.IRON, 0.15), want=(math.cos((a0 + a1) / 2), 0, math.sin((a0 + a1) / 2)))
        strut(p, c + Vector((0, 0.1, 0)), c + Vector((-0.42, 0.1, 0.46)), 0.06, 0.08, rk.RUST)
        strut(p, c + Vector((-0.42, 0.08, 0.46)), c + Vector((-0.42, 0.46, 0.46)), 0.06, 0.06, rk.RUST)
        for dy in (0.4, 1.3):
            p.box(B(wx - 0.26, wz, wy + dy), (0.54, 0.98, 0.07), p.vary(rk.IRON, 0.12), chip=0.05)
        chain(p, [B(wx - 0.32, wz, wy + 1.3), B(wx - 0.12, wz - 0.3, 3.9), B(wx - 0.1, wz - 0.62, 5.3)], link=0.24, w=0.13, t=0.05)
        p.box(B(wx - 0.12, wz - 0.66, 5.42), (0.3, 0.12, 0.3), p.vary(rk.IRON, 0.1), yaw=0.0, chip=0.08)
        strut(p, B(wx + 0.3, wz - 0.66, 5.6), B(wx - 0.3, wz - 0.66, 5.45), 0.08, 0.1, rk.IRON)
    SOCKETS['weeps'].append([round(wx - 0.12, 3), 5.2, round(wz - 0.62, 3)])
    collider_obb('winch', wx - 0.28, wz, 0.3, 0.5, 0.0, wy + 1.6)
    with p.as_kind(K_WOOD):
        for dz in (-0.42, 0.42):
            p.box(B(wx - 0.26, wz + dz, (wy + wfoot) / 2), (0.5, 0.14, wy - wfoot + 0.02), rk.TIMBER_DARK)
    hoarding(p)
    return p


def hoarding(p):
    """The wardens' timber gallery on the dry tower's road side: putlogs,
    braces, a plank breastwork with boards gone and boards hanging, a
    lean-to roof half fallen in. Built about the tower's own axis, then
    leaned with it."""
    rng = p.rng
    t = TOWER['e']
    M = tower_matrix('e')
    r = t['r']
    a0, a1, n = 0.05, 2.35, 9
    deck, eave, ridge = 6.55, 8.45, 9.25
    m = p.mark()

    def pol(a, rad, y):
        return Vector((math.cos(a) * rad, math.sin(a) * rad, y))

    with p.as_kind(K_WOOD):
        angs = [a0 + (a1 - a0) * i / (n - 1) for i in range(n)]
        for i, a in enumerate(angs):
            gone = i in (6,)
            strut(p, pol(a, r - 0.5, deck - 0.1), pol(a, r + 1.05, deck - 0.1 - (0.25 if gone else 0.0)), 0.16, 0.2,
                  p.vary(rk.TIMBER_DARK, 0.12), chip=0.1)
            strut(p, pol(a, r + 0.02, deck - 1.25), pol(a, r + 0.9, deck - 0.22), 0.1, 0.12, p.vary(rk.TIMBER, 0.12), chip=0.1)
            if not gone:
                h = eave - deck + rng.uniform(-0.05, 0.05) - (0.7 if i == 8 else 0.0)
                p.box(pol(a, r + 0.98, deck + h / 2), (0.13, 0.13, h), p.vary(rk.TIMBER, 0.12), yaw=a, chip=0.1)
        for i in range(n - 1):
            a, b = angs[i], angs[i + 1]
            # the deck: two planks a bay, some gone
            for (rad, w) in ((r + 0.28, 0.4), (r + 0.74, 0.44)):
                if rng.random() < 0.22:
                    continue
                strut(p, pol(a, rad, deck + 0.04), pol(b, rad, deck + 0.04 + rng.uniform(-0.02, 0.02)), w, 0.06,
                      p.vary(rk.TIMBER_GREY, 0.14), chip=0.1)
            if i in (5, 6):
                continue
            # the breastwork: upright boards, a gap for the bows, boards missing
            # and one hanging by its last nail
            k = 4
            for j in range(k):
                u = (j + 0.5) / k
                am = a + (b - a) * u
                if rng.random() < 0.24:
                    continue
                lo, hi = deck + 0.08, deck + rng.uniform(1.15, 1.45)
                hang = rng.random() < 0.1
                q0, q1 = pol(am, r + 1.06, lo), pol(am, r + 1.06, hi)
                if hang:
                    q0 = q1 + Vector((math.cos(am + 1.2) * 0.5, math.sin(am + 1.2) * 0.5, -1.1))
                strut(p, q0, q1, 0.24, 0.045, p.vary(rk.TIMBER_GREY if rng.random() < 0.6 else rk.TIMBER, 0.16), chip=0.14,
                      face=(math.cos(am), math.sin(am), 0.0), spin=0.0 if not hang else 0.5)
            strut(p, pol(a, r + 1.1, deck + 1.0), pol(b, r + 1.1, deck + 1.0), 0.06, 0.12, p.vary(rk.TIMBER_DARK, 0.1))
        # the roof: a wall plate, rafters, boards over the first bays only
        for i in range(n - 1):
            if i in (5, 6, 7):
                continue
            strut(p, pol(angs[i], r + 1.0, eave), pol(angs[i + 1], r + 1.0, eave), 0.12, 0.12, p.vary(rk.TIMBER_DARK, 0.1))
        for i, a in enumerate(angs):
            if i in (6, 7, 8):
                continue
            fallen = i == 5
            strut(p, pol(a, r + 1.25, eave - 0.1), pol(a, r - 0.75, ridge - (0.9 if fallen else 0.0)), 0.09, 0.12,
                  p.vary(rk.TIMBER_DARK, 0.12), chip=0.1)
        for i in range(n - 1):
            if i > 3:
                continue
            a, b = angs[i], angs[i + 1]
            for j in range(4):
                if rng.random() < 0.3:
                    continue
                u0 = j / 4
                rad = r + 1.2 - 1.75 * (u0 + 0.12)
                y = eave - 0.02 + (ridge - eave + 0.1) * (u0 + 0.12) + 0.03
                strut(p, pol(a, rad, y), pol(b, rad + rng.uniform(-0.04, 0.04), y), 0.5, 0.04,
                      p.vary(rk.TIMBER_GREY, 0.16), chip=0.12, spin=-0.42)
        # the banner's pole, braced off a post
        ab = 1.72
        p0, p1 = pol(ab, r + 0.95, eave - 0.5), pol(ab, r + 2.35, eave + 0.75)
        strut(p, p0, p1, 0.08, 0.08, p.vary(rk.TIMBER_DARK, 0.1))
        strut(p, pol(ab, r + 1.0, eave - 1.3), pol(ab, r + 1.75, eave + 0.18), 0.06, 0.06, rk.TIMBER_DARK)
    p.turn(m, M)
    SOCKETS['banner_pole'] = [list(M @ p0), list(M @ p1)]


# ============================================== curtain, fallen drum, ground
def ruins():
    p = P('Ruins')
    rng = p.rng
    # The curtain wall off the east tower, stepping down the slope to rubble.
    runs = [((-9.7, -0.2), (-14.9, 3.3), 4.5, 2.9), ((-14.9, 3.3), (-19.6, 6.9), 2.9, 0.5)]
    for i, (a, b, h0, h1) in enumerate(runs):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        dx, dz = b[0] - a[0], b[1] - a[1]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        y0 = footing(f'curtain_{i}', mid[0], mid[1], L / 2, 0.75, math.atan2(-dz, dx), 0.5)

        def top_fn(t, a=a, b=b, h0=h0, h1=h1):
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            step = math.floor(t * 5.0) / 5.0
            return gh(x, z) + h0 + (h1 - h0) * step + 0.45 * math.sin(t * 11 + h0)

        tops = p.wall(a, b, 1.5, y0, top_fn, missing=0.045, ragged=0.5, slip=0.05, ground=gb)
        TOPS.extend(tops)
        collider_obb(f'curtain_{i}', mid[0], mid[1], L / 2, 0.75, math.atan2(-dz, dx), gh(*mid) + max(h0, h1))
    rubble(p, -20.6, 7.6, 1.9, 13, size=(0.35, 0.8))
    rubble(p, -17.0, 3.2, 1.6, 6, size=(0.3, 0.7))
    # What fell from the east tower's crown: a heap of its great blocks beside
    # the road, tumbled one on another and sunk in the peat, a merlon among
    # them still whole.
    hx, hz = -10.6, -8.6
    for k in range(15):
        a = rng.random() * TAU
        d = 1.9 * math.sqrt(rng.random())
        x, z = hx + math.cos(a) * d * 1.25, hz + math.sin(a) * d * 0.9
        s = rng.uniform(0.55, 0.95) * (1.0 - 0.25 * d / 1.9)
        up = max(0.0, 0.75 - d * 0.5) * rng.uniform(0.5, 1.0)
        M = slope_matrix(x, z, yaw=rng.random() * TAU, lift=s * 0.12 + up)
        M = M @ Matrix.Rotation(rng.uniform(-0.6, 0.6), 4, 'X') @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, 'Y')
        with p.as_kind(K_PAVE):
            p.box((0, 0, 0), (s * rng.uniform(1.2, 1.9), s * rng.uniform(0.8, 1.1), s * rng.uniform(0.6, 0.85)),
                  p.tone(x, z), chip=0.22, bevel=min(0.06, s * 0.09), M=M)
    M = slope_matrix(hx + 0.5, hz + 0.3, yaw=0.9, lift=0.75) @ Matrix.Rotation(0.5, 4, 'X') @ Matrix.Rotation(-0.3, 4, 'Y')
    with p.as_kind(K_PAVE):
        p.box((0, 0, 0), (1.5, 0.95, 1.15), scale(COURT, 0.95), chip=0.16, bevel=0.07, M=M)
    collider_circle('fallen_stones', hx, hz, 2.1, gh(hx, hz) + 1.6)
    footing('fallen_stones', hx, hz, 0.6, 0.6, 0.0, 0.4)
    rubble(p, hx + 0.6, hz - 1.4, 3.2, 8, size=(0.22, 0.5))
    # Blocks shed by the west tower's broken crown, down its slope.
    rubble(p, 10.4, -5.6, 2.2, 9, size=(0.35, 0.8))
    rubble(p, 6.2, -6.4, 1.6, 5, size=(0.25, 0.5))
    rubble(p, -4.4, -5.0, 0.8, 3, size=(0.22, 0.4))
    causeway(p)
    peat(p)
    return p


def causeway(p):
    """The old gate road: worn setts showing through the dirt, close set
    under the arch and across the court to the sill, thinning down the hill.
    Each is an irregular domed stone sunk to its shoulders, so it reads as
    stone at any angle and never as a sheet."""
    rng = p.rng
    dx, dz = ROAD[0][0] - 0.0, ROAD[0][1] - FRONT_Z
    ln = math.hypot(dx, dz)
    ux, uz = dx / ln, dz / ln

    def sett(x, z, r):
        if any(math.hypot(x - wx, z - wz) < 0.8 for (wx, wz) in WARD_STONES):
            return
        n = rng.randrange(5, 8)
        M = slope_matrix(x, z, yaw=rng.random() * TAU, lift=0.0)
        up = M.to_3x3() @ Vector((0, 0, 1))
        tone = p.vary(mix(FLAG, COURT_DARK, rng.random() * 0.8), 0.14)
        rim = []
        for i in range(n):
            a = TAU * i / n + rng.uniform(-0.25, 0.25)
            rr = r * rng.uniform(0.78, 1.08)
            rim.append(Vector((math.cos(a) * rr * 1.2, math.sin(a) * rr, 0.03 + rng.uniform(-0.012, 0.02))))
        crown = Vector((rng.uniform(-0.15, 0.15) * r, rng.uniform(-0.15, 0.15) * r, 0.085))
        with p.as_kind(K_PAVE):
            for i in range(n):
                a_, b_ = rim[i], rim[(i + 1) % n]
                p.quad([M @ crown, M @ a_, M @ b_], tone, cols=[scale(tone, 1.1), scale(tone, 0.82), scale(tone, 0.82)], want=up)
                la, lb = Vector((a_.x * 1.07, a_.y * 1.07, -0.34)), Vector((b_.x * 1.07, b_.y * 1.07, -0.34))
                p.quad([M @ a_, M @ la, M @ lb, M @ b_], scale(tone, 0.62),
                       want=M.to_3x3() @ Vector(((a_.x + b_.x) / 2, (a_.y + b_.y) / 2, 0.0)))

    # the road outside, thinning down the hill
    s = 0.7
    while s < 11.5:
        keep = 0.9 - 0.75 * smooth(2.0, 11.5, s)
        off = -1.8
        while off < 1.8:
            r = rng.uniform(0.3, 0.46)
            if rng.random() < keep:
                cx = ux * s + uz * (off + r) + rng.uniform(-0.08, 0.08)
                cz = FRONT_Z - 0.65 + uz * s - ux * (off + r) + rng.uniform(-0.08, 0.08)
                sett(cx, cz, r)
            off += r * 2.25
        s += rng.uniform(0.62, 0.8)
    # under the arch and across the court, close set
    z = FRONT_Z - 0.62
    while z < -0.62:
        x = -ARCH['half'] + 0.3
        while x < ARCH['half'] - 0.3:
            r = rng.uniform(0.3, 0.44)
            if rng.random() < 0.9:
                sett(x + r * 0.9 + rng.uniform(-0.05, 0.05), z + rng.uniform(-0.06, 0.06), r)
            x += r * 2.2
        z += rng.uniform(0.6, 0.74)


def puddle(p, lx, lz, r, dam=True):
    """Standing black water held on the slope by a lip of peat."""
    rng = p.rng
    y = gh(lx, lz) + 0.05
    e = 0.4
    gx = (gh(lx + e, lz) - gh(lx - e, lz)) / (2 * e)
    gz = (gh(lx, lz + e) - gh(lx, lz - e)) / (2 * e)
    gl = math.hypot(gx, gz) or 1.0
    ddx, ddz = -gx / gl, -gz / gl          # downhill
    n = 9
    pts = []
    for i in range(n):
        a = TAU * i / n
        rr = r * rng.uniform(0.75, 1.15)
        pts.append(B(lx + math.cos(a) * rr * 1.25, lz + math.sin(a) * rr, y))
    with p.as_kind(K_WATER):
        p.quad(pts, WATER, mat=WET, want=(0, 0, 1))
    if dam:
        yaw = math.atan2(ddz, ddx) + math.pi / 2
        p.mound(lx + ddx * r * 1.05, lz + ddz * r * 1.05, r * 1.9, r * 0.8, 0.34 + r * gl * 0.9, gh, rk.PEAT, yaw=yaw,
                rings=2, segs=7)
    SOCKETS['puddles'].append([round(lx, 3), round(y, 3), round(lz, 3), round(r, 2)])


def peat(p):
    """Peat and silt heaped against every foot, spilling through the arch."""
    rng = p.rng
    tw, te = TOWER['w'], TOWER['e']
    # round the towers: a thick skirt uphill, tongues downhill
    for (t, arcs) in ((tw, ((3.6, 6.4, 8, 0.4), (0.2, 2.6, 6, 0.3))), (te, ((2.6, 6.6, 9, 0.42), (0.4, 2.4, 6, 0.3)))):
        for (a0, a1, n, h) in arcs:
            for k in range(n):
                a = a0 + (a1 - a0) * (k + rng.random() * 0.6) / n
                rad = t['r'] + rng.uniform(0.2, 0.9)
                x, z = t['cx'] + math.cos(a) * rad, t['cz'] - math.sin(a) * rad
                if any(math.hypot(x - wx, z - wz) < 1.5 for (wx, wz) in WARD_STONES):
                    continue
                p.mound(x, z, rng.uniform(1.2, 2.0), rng.uniform(1.0, 1.6), h * rng.uniform(0.5, 0.9), gh,
                        mix(rk.PEAT, rk.MUD, rng.random() * 0.8), yaw=rng.random() * 3, rings=3, segs=6)
    # the gate front's foot, either side of the arch, and the wall's north foot
    for (x, z, rx, rz, h) in ((-3.6, -4.0, 1.6, 1.0, 0.5), (3.5, -4.1, 1.7, 1.1, 0.55), (-4.4, -4.5, 1.2, 0.9, 0.35),
                              (4.6, -4.6, 1.3, 1.0, 0.4), (-3.9, -1.2, 1.2, 1.6, 0.5), (4.2, -1.0, 1.1, 1.5, 0.4),
                              (-2.9, 3.4, 1.4, 2.2, 0.6), (-0.2, 6.2, 2.6, 1.5, 0.6), (2.3, 4.6, 1.0, 1.5, 0.4),
                              (-11.5, 2.2, 1.6, 1.2, 0.45), (-15.6, 5.2, 1.5, 1.1, 0.4), (-12.4, 0.2, 1.4, 1.0, 0.35)):
        if any(math.hypot(x - wx, z - wz) < 1.5 for (wx, wz) in WARD_STONES):
            continue
        p.mound(x, z, rx, rz, h, gh, mix(rk.PEAT, rk.MUD, rng.random() * 0.6), yaw=rng.random() * 3)
    # silt spilling into the court along the east wall, and over the roof slabs
    for (x, z, rx, rz, h) in ((-1.75, -1.9, 0.7, 1.1, 0.32), (-1.8, -0.9, 0.6, 0.8, 0.26), (1.85, -2.2, 0.5, 0.7, 0.2)):
        p.mound(x, z, rx, rz, h, gh, mix(rk.PEAT, rk.MUD_WET, 0.5), yaw=0.2)
    for (x, z, rx, rz, h) in ((-0.9, 4.9, 1.6, 1.1, 0.5), (1.1, 3.6, 1.0, 0.9, 0.3)):
        p.mound(x, z, rx, rz, h, lambda a, b: max(gh(a, b), 4.84 - 0.113 * (b - 1.2)), mix(rk.PEAT, rk.MUD, 0.4), yaw=0.5,
                sink=0.1)
    # standing water at the wall foot
    puddle(p, -3.7, -4.55, 0.62)
    puddle(p, 3.3, -4.75, 0.7)
    puddle(p, -11.6, -4.2, 0.6)
    puddle(p, 9.6, 3.4, 0.55)


# ================================================================ the growth
def banner(p):
    """Olen's banner: the wardens' faded blue with a pale tower, hung from a
    yard on the hoarding's pole, torn, heavy with wet."""
    rng = p.rng
    p0, p1 = (Vector(v) for v in SOCKETS['banner_pole'])
    tip = p1
    away = Vector((p1.x - p0.x, p1.y - p0.y, 0)).normalized()
    right = Vector((0, 0, 1)).cross(away).normalized()
    W, H = 1.25, 3.1
    cols, rows = 8, 14
    top = tip + Vector((0, 0, -0.16))
    with p.as_kind(K_WOOD):
        strut(p, top - right * (W / 2 + 0.12), top + right * (W / 2 + 0.12), 0.06, 0.06, rk.TIMBER_DARK)
        for s in (-1, 1):
            strut(p, top + right * s * W * 0.42, tip + Vector((0, 0, 0.02)), 0.015, 0.015, rk.STEM)
    ends = [H * (1.0 - (0.36 if c_ in (5, 6) else 0.0) - rng.uniform(0.0, 0.14) - (0.24 if c_ in (1, 2) else 0.0)
                 - (0.5 if c_ == 8 else 0.0)) for c_ in range(cols + 1)]

    def at(i, j):
        u, v = i / cols, j / rows
        vv = min(v * H, ends[i])
        sag = 0.06 * math.sin(u * math.pi) * (1 - v)
        fold = (0.07 + 0.3 * v) * math.sin(u * 9.0 + v * 2.2 + 0.6) + 0.1 * v * math.sin(u * 21.0 + 1.3)
        gather = 1 - 0.3 * v + 0.05 * math.sin(v * 9.0 + u * 3.0)
        fray = 0.04 * math.sin(v * 31.0) * (1 if i in (0, cols) else 0)
        return (top + right * ((u - 0.5) * W * gather + fray + 0.22 * v * v) + Vector((0, 0, -vv - sag))
                + away * (fold + 0.16 * v * v))

    def emblem(i, j):
        if 4 <= j <= 9 and 3 <= i <= 4:
            return True
        if j == 3 and 2 <= i <= 5:
            return True
        if j == 2 and i in (2, 4):
            return True
        return j == 10 and 2 <= i <= 5

    with p.as_kind(K_CLOTH):
        for j in range(rows):
            for i in range(cols):
                if (j + 0.5) / rows * H > min(ends[i], ends[i + 1]) + 0.05:
                    continue
                if (i == 1 and 5 <= j <= 9) or (i == 6 and 2 <= j <= 3):
                    continue         # a long rent, and a hole
                fade = 1.0 - 0.25 * (j / rows) + rng.uniform(-0.05, 0.05)
                c = mix(CLOTH_PALE, (0.7, 0.7, 0.66), rng.random() * 0.3) if emblem(i, j) else scale(CLOTH, fade + 0.15 * (i % 2))
                c = mix(c, (0.36, 0.37, 0.36), 0.25 * smooth(0.5, 1.0, j / rows))
                p.quad([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], c, mat=LEAF)


def growth():
    """Everything that grows, and the cloth: one render-only GLB on the
    double-sided leaf material, so the engine can shed it whole."""
    p = P('Growth')
    rng = p.rng
    S = Vector((0, 1, 0))
    N = Vector((0, -1, 0))
    south = -(FRONT_Z - WALL_D / 2)        # Blender Y of the gate front's south face
    banner(p)
    # Weed hanging from the tide line: thick on the gate front and in the
    # arch, thinner on the towers' road faces, close in the court.
    for x in [-4.3 + 0.62 * i for i in range(15)]:
        if abs(x) < ARCH['half'] + 0.1:
            continue
        if rng.random() < 0.85:
            p.weed((x + rng.uniform(-0.1, 0.1), south + 0.05, TIDE - rng.uniform(0.9, 1.25)), rng.uniform(0.8, 1.9), S,
                   width=0.6, strands=rng.randrange(3, 6))
    for key, arc in (('w', (0.6, 2.8)), ('e', (0.4, 2.6))):
        a = arc[0]
        while a < arc[1]:
            if rng.random() < 0.8:
                q, n = tower_point(key, a, TIDE - rng.uniform(0.9, 1.25), out=0.06)
                p.weed(q, rng.uniform(0.9, 2.4 if key == 'w' else 1.5), n, width=0.7, strands=3, leaf=0.19, density=0.8)
            a += 0.3
    # kelp curtains: from the line on the gate front and the towers' road
    # faces, from the portcullis' bottom rail, in the court
    for x in [-4.4 + 0.5 * i for i in range(19)]:
        if abs(x) < ARCH['half'] + 0.15:
            continue
        p.kelp((x + rng.uniform(-0.1, 0.1), south + 0.04, TIDE - rng.uniform(0.95, 1.25)), rng.uniform(1.2, 2.6), S, width=0.6,
               blades=rng.randrange(6, 10))
    for key, arc in (('w', (0.5, 2.9)), ('e', (0.4, 2.7))):
        a = arc[0]
        while a < arc[1]:
            q, n = tower_point(key, a, TIDE - rng.uniform(0.95, 1.25), out=0.05)
            p.kelp(q, rng.uniform(1.4, 3.0 if key == 'w' else 2.0), n, width=0.8, blades=rng.randrange(6, 9), blade=0.13)
            a += 0.26
    for i, d in enumerate(SOCKETS['drips']):
        p.kelp(B(d[0] + 0.2, d[2] - 0.02, d[1] + 0.7), rng.uniform(0.6, 1.3), S, width=0.42, blades=rng.randrange(3, 6), blade=0.07)
    for sx in (-1, 1):
        for z in (-2.2, -1.7, -1.2, -0.8):
            p.kelp(B(sx * (COURT_X - 0.47), z, TIDE - rng.uniform(0.95, 1.2)), rng.uniform(0.8, 1.5), Vector((-sx, 0, 0)),
                   width=0.5, blades=rng.randrange(4, 7), blade=0.09)
        for z in (-3.5, -3.0, -2.6):
            p.kelp(B(sx * (ARCH['half'] - 0.02), z, TIDE - rng.uniform(0.95, 1.2)), rng.uniform(0.8, 1.6), Vector((-sx, 0, 0)),
                   width=0.4, blades=rng.randrange(4, 7), blade=0.09)
        p.kelp(B(sx * (INNER['half'] + 0.7), -INNER_D / 2 - 0.03, TIDE - rng.uniform(0.95, 1.2)), rng.uniform(0.8, 1.4), S,
               width=1.2, blades=8, blade=0.09)
    # moss pads on every ledge the damp reaches: imposts, string courses, the sill's ends
    for sx in (-1, 1):
        p.moss_mat(B(sx * (ARCH['half'] + 0.45), FRONT_Z - WALL_D / 2 - 0.02, ARCH['spring'] + 0.02), 0.34)
        p.moss_mat(B(sx * (INNER['half'] + 0.3), -INNER_D / 2 - 0.02, INNER['spring'] + 0.02), 0.26)
        p.moss_mat(B(sx * (INNER['half'] - 0.15), 0.25, KERB['top'] + 0.01), 0.24)
    for key, band_y in (('w', 6.06), ('w', -0.56), ('e', 5.26)):
        for a in [0.3 + 0.37 * i for i in range(8)]:
            if rng.random() < 0.75:
                q, n = tower_point(key, a, band_y, out=0.1)
                p.moss_mat(q, rng.uniform(0.2, 0.34), normal=(n + Vector((0, 0, 1.6))).normalized())
    for _ in range(12):
        a, dd = rng.random() * TAU, rng.random() * 1.7
        x, z = -10.6 + math.cos(a) * dd, -8.6 + math.sin(a) * dd
        p.moss_mat(B(x, z, gh(x, z) + 0.55 + rng.random() * 0.5), rng.uniform(0.2, 0.36))
    # in the court and on the door's arch
    for sx in (-1, 1):
        for z in (-2.0, -1.4, -0.85):
            if rng.random() < 0.85:
                p.weed(B(sx * (COURT_X - 0.47), z, TIDE - rng.uniform(0.9, 1.2)), rng.uniform(0.5, 1.2), Vector((-sx, 0, 0)),
                       width=0.5, strands=3)
        p.weed(B(sx * (INNER['half'] + 0.6), -INNER_D / 2 - 0.03, TIDE - rng.uniform(0.9, 1.2)), rng.uniform(0.6, 1.2), S,
               width=0.9, strands=4)
    # weed caught on the portcullis and trailing from the arches
    for d in SOCKETS['drips'][::2]:
        p.weed(B(d[0], d[2] - 0.05, d[1] + rng.uniform(0.7, 1.5)), rng.uniform(0.5, 1.0), S, width=0.25, strands=2, leaf=0.11)
    for (x, y) in ((-1.7, ARCH['spring'] + 1.25), (1.5, ARCH['spring'] + 1.45), (0.4, ARCH['spring'] + 2.1), (-0.8, ARCH['spring'] + 2.0)):
        p.weed(B(x, FRONT_Z - 0.45, y), rng.uniform(0.6, 1.3), S, width=0.5, strands=3, leaf=0.11)
    for (x, y) in ((-0.7, INNER['spring'] + 0.95), (0.5, INNER['spring'] + 1.1)):
        p.weed(B(x, -INNER_D / 2 - 0.02, y), rng.uniform(0.5, 0.9), S, width=0.5, strands=3, leaf=0.11)
    # barnacle crust along the line: thick where the eye is (the arch jambs,
    # the court, the door's piers), sparse up on the towers
    for x in [-4.4 + 0.45 * i for i in range(20)]:
        if abs(x) < ARCH['half'] + 0.05 or rng.random() < 0.3:
            continue
        p.barnacles((x, south + 0.01, TIDE - rng.uniform(0.1, 0.75)), S, radius=0.28, count=rng.randrange(4, 8))
    for sx in (-1, 1):
        for z in (-3.5, -3.1, -2.7, -2.1, -1.6, -1.1, -0.75):
            wall_x = ARCH['half'] if z < FRONT_Z + WALL_D / 2 else COURT_X - 0.46
            p.barnacles(B(sx * wall_x, z, TIDE - rng.uniform(0.1, 0.7)), Vector((-sx, 0, 0)), radius=0.24, count=rng.randrange(4, 8))
        for x in (INNER['half'] + 0.25, INNER['half'] + 0.8, INNER['half'] + 1.3):
            p.barnacles(B(sx * x, -INNER_D / 2 - 0.02, TIDE - rng.uniform(0.1, 0.7)), S, radius=0.24, count=rng.randrange(4, 8))
    for key, arc in (('w', (0.5, 2.9)), ('e', (0.3, 2.8))):
        a = arc[0]
        while a < arc[1]:
            if rng.random() < 0.6:
                q, n = tower_point(key, a, TIDE - rng.uniform(0.1, 0.8), out=0.03)
                p.barnacles(q, n, radius=0.3, count=rng.randrange(3, 5))
            a += 0.4
    # moss on the broken tops, the fallen blocks, the roof slabs
    for (pos, w) in TOPS:
        if pos.z > TIDE + 0.6 and rng.random() < 0.3:
            p.moss_mat(pos + Vector((rng.uniform(-0.2, 0.2) * w, rng.uniform(-0.15, 0.15), 0.0)), min(0.6, w * 0.45))
    for k in range(7):
        x, z = rng.uniform(-1.6, 1.6), rng.uniform(1.0, 5.2)
        p.moss_mat(B(x, z, 4.84 - 0.115 * (z - 1.2)), rng.uniform(0.3, 0.55))
    # sedge at every wall foot; reed in the wet hollows
    def foot(lx, lz, n, spread, h=0.7):
        for _ in range(n):
            x, z = lx + rng.uniform(-spread, spread), lz + rng.uniform(-spread, spread)
            if any(math.hypot(x - wx, z - wz) < 0.9 for (wx, wz) in WARD_STONES) or abs(x) < 1.9 and -14 < z < 0.2:
                continue
            p.sedge(B(x, z, gh(x, z)), radius=0.24, blades=rng.randrange(7, 11), height=h * rng.uniform(0.7, 1.3))

    for x in [-4.6 + 0.6 * i for i in range(16)]:
        if abs(x) > ARCH['half'] + 0.3 and rng.random() < 0.7:
            foot(x, FRONT_Z - 0.9, 1, 0.2)
    for key in ('w', 'e'):
        t = TOWER[key]
        for k in range(16):
            a = TAU * k / 16
            if rng.random() < 0.6:
                rad = tower_radius(key, gh(t['cx'], t['cz'])) + rng.uniform(0.25, 0.7)
                foot(t['cx'] + math.cos(a) * rad, t['cz'] - math.sin(a) * rad, 1, 0.15)
    for (lx, lz, n, s_) in ((-3.7, -4.6, 5, 0.9), (3.4, -4.9, 5, 1.0), (-11.6, -4.3, 4, 0.9), (-10.6, -8.2, 8, 2.6),
                            (10.4, -5.6, 6, 2.2), (-13.0, 1.0, 6, 1.5), (-17.5, 4.6, 6, 1.6), (-20.6, 7.6, 6, 1.8),
                            (3.6, 3.6, 4, 1.0), (-3.2, 3.2, 5, 1.2), (0.0, 6.6, 6, 2.2), (9.4, 3.2, 5, 1.2), (-1.7, -1.6, 2, 0.3)):
        foot(lx, lz, n, s_)
    # reed beds and bulrush: at both towers' downhill feet, at the gate
    # front's foot and along the lane's edges, where the water would lie
    for (lx, lz, n, s_) in ((-4.3, -5.0, 4, 0.7), (4.3, -5.4, 4, 0.8), (-11.8, -4.6, 3, 0.7), (10.8, -4.2, 6, 1.5),
                            (8.2, -5.6, 5, 1.2), (9.8, 3.8, 3, 0.8), (-12.4, -9.6, 3, 1.0), (6.4, -7.6, 3, 0.9),
                            (-7.4, -5.2, 5, 1.2), (-5.2, -5.6, 3, 0.7), (2.9, -7.4, 3, 0.5), (-3.2, -7.0, 3, 0.5),
                            (3.4, -10.0, 3, 0.6), (-4.6, -10.2, 3, 0.6)):
        for _ in range(n):
            x, z = lx + rng.uniform(-s_, s_), lz + rng.uniform(-s_, s_)
            if any(math.hypot(x - wx, z - wz) < 1.0 for (wx, wz) in WARD_STONES) or (abs(x - 0.555 * z) < 2.1 and -14 < z < 0.2):
                continue
            p.reeds(B(x, z, gh(x, z)), radius=0.36, stems=rng.randrange(6, 10), height=rng.uniform(1.2, 1.9), heads=0.7)
    return p


# ================================================================ main
def new_root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


def join(objs, name):
    """One object from several (same materials, same colour layer)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = rk.make_materials()
    pieces = {'main': [towers(), gate_front(), court(), fittings()], 'ruins': [ruins()]}
    pieces['growth'] = [growth()]
    allp = [p for group in pieces.values() for p in group]
    bvh = None if '--no-ao' in argv else rk.occluder(allp, GR)
    roots = {'main': 'BastionEntrance_ROOT', 'ruins': 'BastionEntranceRuins_ROOT', 'growth': 'BastionEntranceGrowth_ROOT'}
    files = {'main': 'sunken_bastion_entrance.glb', 'ruins': 'sunken_bastion_entrance_ruins.glb',
             'growth': 'sunken_bastion_entrance_growth.glb'}
    raw = os.path.join(OUT, 'glb_raw')
    os.makedirs(raw, exist_ok=True)
    stats = {'tris': {}, 'total_tris': 0}
    for key, group in pieces.items():
        root = new_root(roots[key])
        objs = [p.finish(mats, root, ground=gb, bvh=bvh) for p in group]
        for o in objs:
            n = ec.count_tris([o])
            stats['tris'][o.name] = n
            stats['total_tris'] += n
        if key == 'main':
            objs = [join(objs, 'Entrance_Gatehouse')]
        ec.export_glb([root] + objs, os.path.join(raw, files[key]))
    SOCKETS.pop('banner_pole', None)
    stats.update({'sockets': SOCKETS, 'colliders': COLLIDERS, 'footings': ec.gap_report(GR, FOOTINGS), 'door': GR.door,
                  'tide': TIDE, 'wardStones': WARD_STONES, 'exitDrop': EXIT_DROP})
    stats['footingsShort'] = [f['name'] for f in stats['footings'] if not f['ok']]
    stats['footingRows'] = [{'name': n, 'cx': round(cx, 3), 'cz': round(cz, 3), 'hw': round(hw, 3), 'hd': round(hd, 3),
                             'rot': round(rot, 4), 'bottom': round(b, 3)} for (n, cx, cz, hw, hd, rot, b) in FOOTINGS]
    json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
    print('STATS', json.dumps({'tris': stats['tris'], 'total': stats['total_tris'], 'short': stats['footingsShort'],
                               'colliders': len(COLLIDERS), 'drips': len(SOCKETS['drips'])}))
    ec.build_terrain(GR, 'fen', paths=[(ROAD, 1.6)])
    import bastion_renders
    for (kx, kz, yaw, nm) in ((0.5, -4.6, 8, 'AtGate'), (-7.5, -15.0, -25, 'OnRoad'), (0.3, -1.3, 0, 'InCourt')):
        bastion_renders.figure(GR, kx, kz, yaw, 'Knight_' + nm)
    bastion_renders.vfx_reference(SOCKETS)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'sunken_bastion_entrance_v2.blend'))
    if RENDERS != 'none':
        bastion_renders.run(OUT, GR, SURR, COLLIDERS, RENDERS, ROAD, TAG)


if __name__ == '__main__':
    main()
