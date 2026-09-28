"""The Mirefen tavern's weathering (build_tavern.py calls build(B, parts) after the shell): what
years of marsh damp do to an old inn, painted as thin decals a hand proud of the walls, each in
the part of the wall it lies on (so it ghosts with its wall for the camera).

  damp        a tide line of damp rising from the stone base into the plaster panels, ragged
              along its top, darkest low; and streaks run down from the upper storey's sills
  fallen      a few places where the plaster has come away and the brick nogging shows, a
              pale broken rim round the hole, courses of brick and mortar inside
  plinth      the stone base darkened by the wet ground at its foot and grown over with moss in
              patches, thickest in the corners and on the shady north side; moss cushions along
              its foot (TavernClutter: high tier)

Everything is placed from stable hashes of where it stands (no rng), clear of the doors, windows
and the chimney.
"""
import math

DAMP = (0.62, 0.52, 0.34)
DAMP_DARK = (0.5, 0.43, 0.3)
STREAK = (0.66, 0.57, 0.4)
RIM = (0.95, 0.86, 0.66)
MORTAR = (0.6, 0.56, 0.48)
BRICK = [(0.58, 0.29, 0.2), (0.52, 0.25, 0.18), (0.63, 0.34, 0.23), (0.48, 0.24, 0.19), (0.6, 0.38, 0.27)]
MOSS = [(0.3, 0.42, 0.16), (0.36, 0.47, 0.19), (0.25, 0.36, 0.15), (0.42, 0.5, 0.22)]
WET_STONE = (0.3, 0.33, 0.36)


def _h(*k):
    v = math.sin(sum(x * (12.9898 + 4.117 * i) for i, x in enumerate(k)) + 0.91) * 43758.5453
    return v - math.floor(v)


class Face:
    """A wall's outer face as a plane: u along it, v up, and the depth `w` in front of it."""

    def __init__(self, origin, along, normal):
        self.o, self.a, self.n = origin, along, normal

    def pt(self, u, v, lift=0.0):
        return (self.o[0] + self.a[0] * u + self.n[0] * lift, v, self.o[2] + self.a[2] * u + self.n[2] * lift)


def poly(B, p, face, pts, color, lift):
    """A flat polygon on the face (a fan of (u, v) corners), facing out."""
    return B.flat_face(p, [face.pt(u, v, lift) for (u, v) in pts], color, B.PLASTER, face.n)


def ragged(u0, u1, v0, top, seed, n=7, amp=0.22):
    """A band from v0 up to a ragged top line over u0..u1."""
    pts = [(u0, v0), (u1, v0)]
    for k in range(n, -1, -1):
        u = u0 + (u1 - u0) * k / n
        pts.append((u, top + (_h(u, seed, 1) - 0.5) * 2 * amp))
    return pts


def damp_band(B, p, face, spans, v0, height, seed):
    """The damp tide line over the panels between `spans` (u0, u1): two layers, the darker one
    lower."""
    for i, (u0, u1) in enumerate(spans):
        if u1 - u0 < 0.3:
            continue
        h = height * (0.6 + 0.8 * _h(u0, seed, 2))
        poly(B, p, face, ragged(u0, u1, v0, v0 + h, seed + i, amp=0.18), DAMP, 0.012)
        poly(B, p, face, ragged(u0 + 0.05, u1 - 0.05, v0, v0 + h * 0.45, seed + i + 7, amp=0.1), DAMP_DARK, 0.018)


def streak(B, p, face, u, v_top, length, seed):
    """A rain streak down from a sill: narrowing as it runs."""
    w = 0.12 + 0.1 * _h(u, seed, 3)
    pts = [(u - w, v_top), (u + w, v_top), (u + w * 0.35, v_top - length), (u - w * 0.2, v_top - length * 0.9)]
    poly(B, p, face, pts, STREAK, 0.014)


def fallen_plaster(B, p, face, uc, vc, rw, rh, seed):
    """A hole in the plaster showing the brick nogging: a pale broken rim, a mortar bed, and
    courses of brick clipped to the hole."""
    n = 11
    outline = []
    for k in range(n):
        a = 2 * math.pi * k / n
        r = 0.78 + 0.34 * _h(k, seed, 4)
        outline.append((uc + math.cos(a) * rw * r, vc + math.sin(a) * rh * r))
    rim = [(uc + (u - uc) * 1.12, vc + (v - vc) * 1.14) for (u, v) in outline]
    poly(B, p, face, rim, RIM, 0.01)
    poly(B, p, face, outline, MORTAR, 0.016)

    def inside(u, v):
        return ((u - uc) / rw) ** 2 + ((v - vc) / rh) ** 2 < 0.62

    bh, bw = 0.12, 0.3
    row = 0
    v = vc - rh
    while v < vc + rh:
        u = uc - rw - (bw / 2 if row % 2 else 0.0)
        while u < uc + rw:
            cu, cv = u + bw / 2, v + bh / 2
            if inside(cu, cv):
                col = B.scale_color(BRICK[int(_h(cu, cv, seed) * len(BRICK))], 0.9 + 0.2 * _h(cv, cu, seed))
                poly(B, p, face, [(u + 0.015, v + 0.012), (u + bw - 0.015, v + 0.012), (u + bw - 0.015, v + bh - 0.012),
                                  (u + 0.015, v + bh - 0.012)], col, 0.022)
            u += bw
        v += bh
        row += 1


def moss_patch(B, p, face, uc, vc, rw, rh, seed):
    """A patch of moss on the stone: an irregular blob, a darker heart."""
    for layer, (k, col) in enumerate(((1.0, MOSS[int(_h(uc, seed, 5) * 4)]), (0.55, MOSS[2]))):
        pts = []
        for j in range(9):
            a = 2 * math.pi * j / 9
            r = k * (0.7 + 0.45 * _h(j, seed, layer, 6))
            pts.append((uc + math.cos(a) * rw * r, vc + math.sin(a) * rh * r))
        poly(B, p, face, pts, col, 0.036 + 0.006 * layer)


def plinth(B, p, clutter, face, u0, u1, ground_at, stone_top, seed, mossy, skip=()):
    """The stone base's foot: a wet dark band along the ground, moss patches over it, cushions
    of moss along the foot."""
    step = 1.6
    u = u0 + 0.2
    k = 0
    while u < u1 - 0.3:
        ub = min(u1 - 0.1, u + step)
        if not any(a < ub and b > u for (a, b) in skip):
            g0, g1 = ground_at(u), ground_at(ub)
            top = min(stone_top - 0.15, max(g0, g1) + 0.45 + 0.35 * _h(u, seed, 7))
            if top > min(g0, g1) + 0.1:
                pts = [(u, g0 - 0.1), (ub, g1 - 0.1)]
                for j in range(4, -1, -1):
                    uu = u + (ub - u) * j / 4
                    pts.append((uu, top + (_h(uu, seed, 8) - 0.5) * 0.3))
                poly(B, p, face, pts, WET_STONE, 0.03)
            if _h(u, seed, 9) < mossy:
                vc = max(g0, g1) + 0.25 + 0.3 * _h(u, seed, 10)
                if vc < stone_top - 0.2:
                    moss_patch(B, p, face, (u + ub) / 2, vc, 0.45 + 0.4 * _h(u, seed, 11), 0.22 + 0.15 * _h(u, 12),
                               seed + k)
            # cushions along the foot
            for j in range(2):
                uu = u + (ub - u) * (0.25 + 0.5 * j) + (_h(u, j, 13) - 0.5) * 0.4
                if _h(uu, seed, 14) < mossy * 0.9:
                    c = face.pt(uu, ground_at(uu) + 0.04, 0.1)
                    s = 0.3 + 0.35 * _h(uu, 15)
                    clutter.rock_blob(c, (s, s * 0.4, s * 0.7), MOSS[int(_h(uu, 16) * 4)], B.PLASTER, jitter=0.25,
                                      subdivisions=0)
        u = ub
        k += 1


def spans_between(posts, lo, hi, holes):
    """The panels between consecutive posts, clear of `holes` (u0, u1)."""
    out = []
    for a, b in zip(posts, posts[1:]):
        a, b = a + 0.2, b - 0.2
        if b <= lo or a >= hi:
            continue
        if any(ha < b and hb > a for (ha, hb) in holes):
            continue
        out.append((max(a, lo), min(b, hi)))
    return out


def build(B, parts):
    import tavern_jetty as JET
    import tavern_shell as S

    H = B.HALL
    t = H['wall']
    split = B.FRONT_SPLIT
    clutter = parts['TavernClutter']
    stone_top = 1.4
    # ---- the front (local x along it, facing +z) ------------------------------------------
    mid = -H['x0']
    front = Face((0.0, 0.0, H['z1'] - t / 2 + t / 2 - 0.04), (1, 0, 0), (0, 0, 1))
    door = B.LAYOUT['door']
    holes = [(door['x'] - door['width'] / 2 - 0.5, door['x'] + door['width'] / 2 + 0.5)]
    holes += [(u0 - mid - 0.3, u1 - mid + 0.3) for (u0, u1, _, _) in S.FRONT_WINDOWS]
    posts = sorted(S.FRONT_POSTS)
    for side, lo, hi in (('HallWallFrontLeft', H['x0'], -split), ('HallWallFrontRight', split, H['x1'])):
        p = parts[side]
        spans = spans_between(posts, lo + 0.1, hi - 0.1, holes)
        damp_band(B, p, front, spans, stone_top + 0.28, 0.75, 21 if lo < 0 else 22)
    # the fallen plaster on the ground floor's front and on the jettied storey
    parts_of = lambda x: parts['HallWallFrontLeft'] if x < -split else parts['HallWallFrontRight']  # noqa: E731
    for (x, y) in ((-13.1, 3.9), (11.7, 2.4), (-6.9, 4.6)):
        fallen_plaster(B, parts_of(x), front, x, y, 0.42, 0.3, int(x * 7))
    jf = Face((0.0, 0.0, JET.face_z(B) - 0.04), (1, 0, 0), (0, 0, 1))
    for (x, y) in ((-9.1, 9.0), (14.2, 7.4)):
        fallen_plaster(B, parts_of(x), jf, x, y, 0.38, 0.27, int(x * 5))
    # streaks down from the upper storey's sills
    for (x, w) in JET.UPPER_WINDOWS:
        for d in (-0.4, 0.35):
            if abs(x + d) > split + 0.3:
                streak(B, parts_of(x), jf, x + d, JET.UPPER_SILL - 0.25, 0.7 + 0.5 * _h(x, d), int(x))
    # the front's stone base at its foot, clear of the porch and its steps
    q = B.LAYOUT['porch']
    zfb = H['z1'] + 0.06
    for side, lo, hi in (('HallWallFrontLeft', H['x0'] + 0.1, q['x0'] - 0.3),
                         ('HallWallFrontRight', q['x1'] + 0.3, H['x1'] - 0.1)):
        pf = Face((0.0, 0.0, zfb), (1, 0, 0), (0, 0, 1))
        plinth(B, parts[side], clutter, pf, lo, hi, lambda u: B.ground(u, zfb + 0.3), stone_top, 31 + int(lo), 0.55)
    # ---- the sides (the left faces -x, south, sunnier; the right +x, north, shady) ------------
    fire = next(q for q in B.LAYOUT['props'] if q['kind'] == 'fireplace')
    for name, s, mossy, windows in (('HallWallLeft', -1, 0.45, (4.5, 15.0, 23.0)),
                                    ('HallWallRight', 1, 0.8, (5.5, 12.2, 23.0))):
        p = parts[name]
        xo = s * (H['x1'] - 0.04)
        face = Face((xo, 0.0, 0.0), (0, 0, 1), (s, 0, 0))
        zholes = [(H['z0'] + u - 1.1, H['z0'] + u + 1.1) for u in windows]
        if s > 0:
            zholes.append((fire['z'] - fire['hd'] - 0.3, fire['z'] + fire['hd'] + 0.3))
        zposts = [H['z0'] + k * (H['z1'] - H['z0']) / 9 for k in range(10)]
        spans = spans_between(zposts, H['z0'] + 0.3, H['z1'] - 0.3, zholes)
        damp_band(B, p, face, spans, stone_top + 0.28, 0.85 if s > 0 else 0.6, 41 + s)
        for (z, y) in ((-3.4, 3.4), (6.3, 7.6)) if s < 0 else ((-11.4, 2.9), (7.0, 7.9)):
            fallen_plaster(B, p, face, z, y, 0.4, 0.28, int(z * 3 + s))
        sf = Face((s * (H['x1'] + 0.06), 0.0, 0.0), (0, 0, 1), (s, 0, 0))
        plinth(B, p, clutter, sf, H['z0'] + 0.2, H['z1'] - 0.2, lambda u: B.ground(s * (H['x1'] + 0.3), u), stone_top,
               51 + s, mossy, skip=zholes[-1:] if s > 0 else ())
