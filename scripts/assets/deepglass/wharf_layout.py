# Lay the Warden wharf kit (scripts/assets/deepglass/dg_wharf.py) onto SPACEY's
# Tidehold ring map: one harbour on each open flank (the harbour mouths the
# Low Wards curtain leaves at bearings +-2.325), laid out 50% larger than the
# kit's own proportions (SPACEY, 2026-09-16: the docks felt small next to the
# galleon). Each main wharf ends in an open-faced bastion with a berth gangway
# out to a galleon lying across the end, its boarding landing level with the
# planks (the WoW boat dock; a future transport docks there).
#
#   python3 scripts/assets/deepglass/wharf_layout.py <in.map.json> <out.map.json>
#
# Re-runnable: it drops every deepglass/wharf_* kit piece and the dressing a
# previous layout stood on the docks (cargo at deck height, boats and buoys),
# the old hex-kit wharfs and quay platforms in the two mouths, re-berths the
# ships already there (a galleon across each wharf's end, a hex ship alongside
# the main pier), and appends the wharf. Frames: bearing phi from north
# clockwise, pol(r, phi) = (sin phi * r, 495 + cos phi * r); a placement's
# glTF +X points along (cos rotY, -sin rotY) and +Z along (sin rotY, cos rotY).
#
# Scale: pile-borne pieces (decks, quay sectors, bastion, stairs, berth) take
# scaleX = scaleZ = 1.5 at height scale 1, so the plan grows while the deck
# stays 36 over the pile feet and rails, parapets and the tide band keep their
# walking and waterline heights. Dressing (lamps, bollards, cranes, mast,
# shed) takes a uniform 1.5, cargo and boats 1.5x their old sizes.
import json
import math
import sys

CZ = 495.0
DECK_Y = 6.08            # plank tops: 8 cm over the Low Wards cobbles (world 6)
PILE_G = DECK_Y - 36.0   # groundY of every pile-borne piece (pile feet)
WATER_Y = -2.0
K = 1.5                  # the docks' scale over the kit's own proportions
# The boardwalk: quay_wide sectors (0.06 rad each) tile the ring r 276.5..300.5
# at scale 1.5, 3 yd of it on the quay (face r 279.5). Nine of them span
# c +- 0.27, running a few yards along the foot of each curtain-wall end.
Q_IN, Q_OUT, Q_MID, SECT, NSECT = 276.5, 300.5, 288.5, 0.06, 9
SIDE = 3 * SECT          # the side piers join three sectors off the main pier
MOD = 8.0 * K            # pier module (12 yd square)
R0 = Q_OUT + MOD / 2     # first module centre off the boardwalk
HEAD_R = Q_OUT + 5 * MOD + 7.2 * K     # the bastion: main pier (5 modules), then the head
FACE_R = HEAD_R + 7.36 * K             # its open seaward face
BERTH_END = FACE_R + 2.5 * K           # the berth gangway's open end
# The galleon (dg_galleon.py, model yards over its keel): main deck and
# boarding landings at 9.8, each landing centred 3.8 along +X from the origin
# with its outer edge 6.2946 off the keel line. Lying across a wharf's end,
# its main deck is seated level with the planks at any scale; a placement
# taller than GALLEON_SY is brought down to it (SPACEY: "a bit shorter").
G_DECK, G_LAND_X, G_LAND_OUT, GALLEON_SY = 9.8, 3.8, 6.2946, 1.8
# Dressing a layout stands on the docks (dropped and rebuilt on a re-run).
LAYOUT_DRESSING = {
    'dungeon/crates_stacked', 'resources/food_barrel_fish', 'dungeon/barrel_small_stack', 'biome/hex_sack',
    'biome/hex_crate_big', 'dungeon/keg', 'biome/sea_rowboat_large', 'biome/sea_boat_fishing',
    'biome/sea_boat_sail_a', 'biome/sea_buoy_flag',
}
# Ships are the maker's placements: re-berthed, never dropped.
SHIPS = {'deepglass/wharf_galleon', 'deepglass/wharf_gangplank'}


def pol(r, phi):
    return (math.sin(phi) * r, CZ + math.cos(phi) * r)


def polar(x, z):
    return math.hypot(x, z - CZ), math.atan2(x, z - CZ)


def t_hat(phi):
    return (math.cos(phi), -math.sin(phi))


def add(p, v, k=1.0):
    return (p[0] + v[0] * k, p[1] + v[1] * k)


def rot_x_along(dx, dz):
    """rotY that points a model's glTF +X along the world direction (dx, dz)."""
    return math.atan2(-dz, dx)


def place(out, asset, xz, rot, ground, scale=1.0, collide=True, plan=None):
    d = {'assetId': asset, 'x': round(xz[0], 3), 'z': round(xz[1], 3), 'rotY': round(rot, 5), 'scale': round(scale, 4)}
    if plan:
        d['scaleX'] = plan
        d['scaleZ'] = plan
    if collide:
        d['collide'] = True
        d['collisionMode'] = 'baked'
    d['detached'] = True
    d['groundY'] = round(ground, 3)
    out.append(d)
    return d


def kit(out, piece, xz, rot):
    """A pile-borne kit piece, grown in plan only."""
    return place(out, 'deepglass/wharf_' + piece, xz, rot, PILE_G, plan=K)


def dress(out, piece, xz, rot):
    """Kit dressing standing on a deck, grown uniformly."""
    return place(out, 'deepglass/wharf_' + piece, xz, rot, DECK_Y, scale=K)


def prop(out, asset, xz, rot, height, ground=DECK_Y):
    """A catalogue prop normalized to 2.2 yd max dimension, sized by height."""
    return place(out, asset, xz, rot, ground, scale=height / 2.2)


def harbour(out, c, sgn, name):
    """One harbour on the mouth centred at bearing c. sgn = +1 east, -1 west:
    tangential choices are made in sgn * phi terms so the two harbours mirror
    in plan (the pieces themselves are not mirrored)."""
    notes = []
    th = t_hat(c)
    u = (math.sin(c), math.cos(c))
    # ---- the quay boardwalk: open where a pier joins ------------------------
    half = NSECT // 2
    phis = [c + (k - half) * SECT for k in range(NSECT)]
    joins = {half - 3, half, half + 3}
    for k, ph in enumerate(phis):
        kit(out, 'quay_wide' if k in joins else 'quay_wide_rail', pol(Q_MID, ph), ph)
    for ph_end, inward in ((phis[0] - SECT / 2, 1.0), (phis[-1] + SECT / 2, -1.0)):
        ur = (math.sin(ph_end), math.cos(ph_end))
        for r in (Q_IN + 6.0, Q_IN + 18.0):
            p = add(pol(r, ph_end), t_hat(ph_end), 0.3 * K * inward)
            place(out, 'deepglass/wharf_rail', p, rot_x_along(*ur), DECK_Y, plan=K)
    for k in (half - 4, half - 2, half + 2, half + 4):
        ph = phis[k]
        ur = (math.sin(ph), math.cos(ph))
        dress(out, 'lamp', pol(Q_OUT - 2.7, ph), rot_x_along(-ur[0], -ur[1]))
    # ---- the main pier, the open bastion and the berth at the wharf's end ----
    berth = sgn               # a hex ship may moor on the +sgn*phi side
    for j in range(5):
        r = R0 + MOD * j
        if j == 0:
            piece, rot = 'deck_rails', c
        elif j < 4:
            piece = 'deck_rail'
            rot = c if -berth > 0 else c + math.pi   # rail on the side away from the mooring
        else:
            piece, rot = 'deck', c
        kit(out, piece, pol(r, c), rot)
    for j in (1, 3):
        p = add(pol(R0 + MOD * j, c), th, -berth * 2.9 * K)
        dress(out, 'lamp', p, rot_x_along(th[0] * berth, th[1] * berth))
    for j in (1, 2, 3):
        p = add(pol(R0 + MOD * j + 2.0 * K, c), th, berth * 3.35 * K)
        dress(out, 'bollard', p, rot_x_along(*u))
    head = pol(HEAD_R, c)
    kit(out, 'bastion_open', head, c)
    # the beacon mast stands OFF the centre line: on the head it was a stone
    # plinth square in the middle of the walk from the pier to the ship
    dress(out, 'mast', add(head, th, -berth * 6.2), rot_x_along(-u[0], -u[1]))
    for s in (1, -1):
        p = add(head, th, 5.0 * K * s)
        dress(out, 'lamp', p, rot_x_along(-th[0] * s, -th[1] * s))
        for dr in (-2.6 * K, 2.6 * K):
            q = add(add(head, th, 6.1 * K * s), u, dr)
            dress(out, 'bollard', q, rot_x_along(*u))
    kit(out, 'berth', pol(FACE_R, c), rot_x_along(*u))
    # ---- two side piers: crane at the end, stairs down into the harbour ------
    for side in (-1, 1):
        cp = c + side * SIDE
        tp = t_hat(cp)
        up = (math.sin(cp), math.cos(cp))
        outer = side            # the rail runs on the side away from the main pier
        for j in range(3):
            kit(out, 'deck_rail', pol(R0 + MOD * j, cp), cp if outer > 0 else cp + math.pi)
        dress(out, 'crane', pol(Q_OUT + 21.3 * K, cp), rot_x_along(*up))
        dress(out, 'lamp', add(pol(Q_OUT + 12.0 * K, cp), tp, outer * 2.9 * K),
              rot_x_along(-tp[0] * outer, -tp[1] * outer))
        # stairs on the inner side. With rotY = phi + pi/2 the landing's pier
        # side faces -t and the flight runs OUT; with phi - pi/2 it faces +t and
        # runs IN (the stairs asset is not mirror-symmetric).
        inner = -side
        off, run = 5.6 * K, 16.0 * K      # landing off the pier axis; landing to foot
        if inner > 0:
            rl = Q_OUT + 5.0 * K
            kit(out, 'stairs', add(pol(rl, cp), tp, off), cp + math.pi / 2)
            foot = add(pol(rl + run, cp), tp, off)
        else:
            rl = Q_OUT + 22.2 * K
            kit(out, 'stairs', add(pol(rl, cp), tp, -off), cp - math.pi / 2)
            foot = add(pol(rl - run, cp), tp, -off)
        boat = add(foot, tp, inner * 3.2 * K)
        prop(out, 'biome/sea_rowboat_large', boat, cp + 0.1 * side, 4.6 * K, ground=WATER_Y - 0.9 * K)
        # cargo round the crane
        base = pol(Q_OUT + 17.0 * K, cp)
        prop(out, 'dungeon/crates_stacked', add(base, tp, outer * 2.4 * K), cp, 1.9 * K)
        prop(out, 'resources/food_barrel_fish', add(add(base, tp, outer * 2.6 * K), up, -2.4 * K), cp + 0.7, 1.15 * K)
        prop(out, 'dungeon/barrel_small_stack', add(add(base, tp, -outer * 2.6 * K), up, -3.0 * K), cp + 1.9, 1.35 * K)
        prop(out, 'biome/hex_sack', add(add(base, tp, outer * 1.2 * K), up, -3.2 * K), cp + 0.4, 0.8 * K)
    # ---- cargo on the main pier and the boardwalk ---------------------------
    near_head = pol(Q_OUT + 36.0 * K, c)
    prop(out, 'biome/hex_crate_big', add(near_head, th, -berth * 2.4 * K), c + 0.2, 1.7 * K)
    prop(out, 'dungeon/keg', add(add(near_head, th, -berth * 2.6 * K), u, -1.8 * K), c, 0.95 * K)
    prop(out, 'dungeon/keg', add(add(near_head, th, -berth * 1.7 * K), u, -2.4 * K), c + 1.1, 0.95 * K)
    # the harbourmaster's shed on the inner half of the boardwalk, door to the
    # piers, cargo on its flanks
    ks, kc = (half + 2, half - 2) if sgn > 0 else (half - 2, half + 2)
    ph = phis[ks]
    dress(out, 'shed', pol(Q_IN + 4.4 * K, ph), ph)
    tp_ = t_hat(ph)
    prop(out, 'dungeon/crates_stacked', add(pol(Q_IN + 4.2 * K, ph), tp_, -4.6 * K * sgn), ph, 1.9 * K)
    prop(out, 'resources/food_barrel_fish', add(pol(Q_IN + 6.6 * K, ph), tp_, 4.1 * K * sgn), ph + 0.5, 1.15 * K)
    prop(out, 'dungeon/keg', add(pol(Q_IN + 3.2 * K, ph), tp_, 4.2 * K * sgn), ph, 0.95 * K)
    ph = phis[kc]
    prop(out, 'dungeon/crates_stacked', add(pol(Q_IN + 5.5 * K, ph), t_hat(ph), 2.0 * K * sgn), ph, 1.9 * K)
    prop(out, 'resources/food_barrel_fish', add(pol(Q_IN + 4.0 * K, ph), t_hat(ph), -1.6 * K * sgn), ph + 0.5, 1.15 * K)
    # a fishing boat moored along a side pier's outer rail, a sailboat at anchor
    cf = c - sgn * SIDE
    prop(out, 'biome/sea_boat_fishing', add(pol(Q_OUT + 15.0 * K, cf), t_hat(cf), -sgn * 6.0 * K), cf + 0.04,
         7.0 * K, ground=WATER_Y - 0.9 * K)
    ca = c - sgn * 0.12
    prop(out, 'biome/sea_boat_sail_a', pol(Q_OUT + 41.0 * K, ca), c + sgn * 0.55, 11.0 * K, ground=WATER_Y - 1.2 * K)
    # buoys marking the harbour mouth, clear of a galleon across the berth
    for s in (1, -1):
        prop(out, 'biome/sea_buoy_flag', pol(385.0, c + s * 0.3), c, 2.6 * K, ground=WATER_Y - 1.3 * K)
    notes.append(f"{name}: harbour at bearing {c:+.3f}, bastion {HEAD_R:.1f}, berth end {BERTH_END:.2f}")
    return notes


def berth_ships(kept, c, sgn):
    """Re-berth the ships of the harbour at bearing c: the nearest galleon
    across the wharf's end (its pier-side landing on the berth gangway, main
    deck level with the planks), the nearest hex ship alongside the main pier
    clear of its wider deck."""
    notes = []
    th = t_hat(c)
    best, bd = None, 1e9
    for p in kept:
        if p['assetId'] != 'deepglass/wharf_galleon':
            continue
        r, phi = polar(p['x'], p['z'])
        if 330 < r < 470 and abs(phi - c) < 0.35 and abs(phi - c) * r + abs(r - 400) < bd:
            best, bd = p, abs(phi - c) * r + abs(r - 400)
    if best:
        s = best['scale'] if best.get('scale', 0) > 0 else 1.0
        sx, sz = s * best.get('scaleX', 1.0), s * best.get('scaleZ', 1.0)
        sy = min(s * best.get('scaleY', 1.0), GALLEON_SY)
        bow = th if sgn > 0 else (-th[0], -th[1])
        # the pier-side landing's outer edge a hair past the berth's open end
        # (the berth deck reaches 0.3 over the joint)
        xz = add(pol(BERTH_END + 0.05 + G_LAND_OUT * sz, c), bow, -G_LAND_X * sx)
        before = (best['x'], best['z'], best.get('groundY'), best.get('y'), best.get('scaleY'))
        best['x'], best['z'] = round(xz[0], 3), round(xz[1], 3)
        best['rotY'] = round(rot_x_along(*bow), 5)
        best['scaleY'] = round(sy / s, 5)
        best['detached'] = True
        best['groundY'] = round(DECK_Y - G_DECK * sy, 3)
        best.pop('y', None)
        notes.append(f"galleon at {c:+.3f}: ({before[0]:.1f},{before[1]:.1f}) groundY {before[2]} y {before[3]} "
                     f"scaleY {before[4]} -> ({best['x']:.1f},{best['z']:.1f}) groundY {best['groundY']} "
                     f"scaleY {best['scaleY']} (plan {sx:.3f} x {sz:.3f}, height {sy:.3f})")
    best, bd = None, 1e9
    for p in kept:
        if p['assetId'] != 'biome/hex_ship_blue':
            continue
        r, phi = polar(p['x'], p['z'])
        d = abs(phi - c) * 300 + abs(r - 318)
        if abs(phi - c) < 0.5 and r < 360 and d < bd:
            best, bd = p, d
    if best:
        # 15 yd in the beam: 14.6 off the axis clears the 12 yd pier by a
        # yard; its 34 yd hull (r 313..347) clears the boardwalk and the head
        xz = add(pol(330.0, c), th, sgn * 14.6)
        notes.append(f"hex ship at {c:+.3f}: ({best['x']:.1f},{best['z']:.1f}) -> ({xz[0]:.1f},{xz[1]:.1f})")
        best['x'], best['z'] = round(xz[0], 3), round(xz[1], 3)
        best['rotY'] = round(c, 5)
    return notes


def main():
    src, dst = sys.argv[1], sys.argv[2]
    doc = json.load(open(src))
    P = doc['placements']
    kept, dropped = [], []
    for p in P:
        a = p['assetId']
        if a.startswith('deepglass/wharf_') and a not in SHIPS:
            continue                    # a previous run's wharf: rebuilt below
        r, phi = polar(p['x'], p['z'])
        dphi = min(abs(phi - 2.325), abs(phi + 2.325))
        if r > 236 and dphi < 0.34 and a in ('biome/hexb_docks', 'props/dock_platform'):
            dropped.append(a)
            continue
        if p.get('detached') and a in LAYOUT_DRESSING and r > 274 and dphi < 0.36:
            dropped.append(a)           # a previous layout's dock dressing
            continue
        kept.append(p)
    notes = []
    for c, sgn in ((2.325, 1), (-2.325, -1)):
        notes += berth_ships(kept, c, sgn)
    new = []
    notes += harbour(new, 2.325, 1, 'Tidewharf (east)') + harbour(new, -2.325, -1, 'Gullhaven (west)')
    doc['placements'] = kept + new
    # Declared harbour water. The sim's open-sea test ignores sculpt stamps
    # (world.ts isOpenSeaAt, #1518), and the ring's harbours are ALL stamps, so
    # parts of both basins were sim-dry: a player falling off a dock sank to the
    # seabed. A declared lake is water wherever the ground is below the line.
    # A lake also carves its basin within 1.6 R, so every circle stops short of
    # the quay (closest approach r = 345 - 64 = 281 > the 279.5 quay face).
    lakes = doc['content']['zones'][0].setdefault('lakes', [])
    have = {(round(l['x'], 1), round(l['z'], 1)) for l in lakes}
    added = 0
    for c in (2.325, -2.325):
        for d in (-0.3, -0.15, 0.0, 0.15, 0.3):
            x, z = pol(345.0, c + d)
            key = (round(x, 1), round(z, 1))
            if key not in have:
                lakes.append({'x': key[0], 'z': key[1], 'radius': 40})
                have.add(key)
                added += 1
    notes.append(f"declared {added} harbour lakes (r 345, radius 40)")
    json.dump(doc, open(dst, 'w'), separators=(',', ':'))
    counts = {}
    for a in dropped:
        counts[a] = counts.get(a, 0) + 1
    print(f"dropped {len(dropped)}: {json.dumps(counts)}")
    counts = {}
    for p in new:
        counts[p['assetId']] = counts.get(p['assetId'], 0) + 1
    print(f"added {len(new)} placements: {json.dumps(counts)}")
    print("\n".join(notes))
    print(f"placements {len(P)} -> {len(doc['placements'])}")


if __name__ == '__main__':
    main()
