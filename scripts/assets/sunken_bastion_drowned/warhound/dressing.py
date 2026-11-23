"""Everything the Bastion Warhound grew, and what its handlers strapped on it.

Grown: the sea-light eyes and the glow in the throat (flat emissive parts), the
mouth (palate, a blackened tongue), the teeth (long yellowed canines, a row of
incisors, the premolar saw, one canine broken), the thick dark claws.
Worn (the garrison's war-dog harness, rusted and rotted by the sea): a broad
iron war collar with outward spikes and a ring at the throat, a snapped chain
hanging from the ring; an iron chamfron over the brow and the muzzle; a quilted
leather war-coat over the back and the shoulders with three riveted iron lames
down the spine, each with a row of short spikes; the Bastion's sea-green
caparison hanging off the coat on the flanks (torn away from the left flank's
hole), the tower-over-waves on each side. Barnacles crust the collar, the
lames and the shoulders; kelp lies over the back and hangs off the collar.

Each item returns (high, low) objects. Shells of the skin's own distance field
take their weights from the skin; rigid parts ride one bone.
"""
import math

import bpy
import numpy as np

import anatomy as A
import sdf
from mesh_kit import Part, decimate, duplicate
from sdf import Ellipsoid, Field, Polyline, RoundBox, RoundCone, Sphere, frame_from


# ------------------------------------------------------------------ surface queries
def surface_along(F, origin, direction, max_dist=3.0):
    o = np.asarray(origin, float)
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    step = F.voxel * 0.6
    prev_t, prev_v = 0.0, F.sample(o[None])[0]
    t = step
    while t < max_dist:
        v = F.sample((o + d * t)[None])[0]
        if prev_v < 0 <= v:
            a, b = prev_t, t
            for _ in range(20):
                m = (a + b) / 2
                if F.sample((o + d * m)[None])[0] < 0:
                    a = m
                else:
                    b = m
            return o + d * (a + b) / 2
        prev_t, prev_v = t, v
        t += step
    raise RuntimeError(f'no surface from {origin} along {direction}')


def normal_at(F, p):
    return F.gradient(np.asarray(p, float)[None])[0]


def tag(objs, mat, bone='', binding='rigid', group='body'):
    for o in objs:
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = binding
        o['group'] = group
    return objs


def pair(part_obj, group='body'):
    part_obj['group'] = group
    hi = duplicate(part_obj, part_obj.name + '_hi')
    hi['group'] = group
    return hi, part_obj


def field_pair(G, name, mat, target, workdir, bone='', binding='transfer'):
    h = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    low = duplicate(h, name)
    decimate(low, target=target)
    tag((h, low), mat, bone, binding)
    for o in (h, low):
        for p in o.data.polygons:
            p.use_smooth = True
    return h, low


def shell(F, lo, hi, voxel, name, mat, region, thick=0.05, inset=0.03, target=800, workdir=None, bone='Neck1',
          binding='transfer', extra=None):
    """A layer over the skin: `region(X, Y, Z, db)` is negative where it covers."""
    G = Field(np.asarray(lo, float), np.asarray(hi, float), voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    db = F.sample(P).reshape(X.shape)
    t = thick(X, Y, Z, db) if callable(thick) else thick
    d = np.maximum(db - t, -(db + inset))
    d = sdf.smax(d, region(X, Y, Z, db), 0.02)
    G.d = d.astype(np.float32)
    if extra is not None:
        extra(G)
    return field_pair(G, name, mat, target, workdir, bone, binding)


def horn(part, base, ctrl, tip, r0, n=8, sides=7, r_tip=0.006):
    """A curved tapering spike (a fang, a claw, a collar spike) along a quadratic Bezier."""
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.75 + r_tip)
    part.tube(pts, rr, sides=sides)


def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


# ------------------------------------------------------------------ grown
def build_eyes():
    """The sea light: a glowing orb in each sunken socket and a glow deep in the throat."""
    p = Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        R = sdf.frame_from(A._m(A.EYE_DIR, s))
        p.sphere(A._m(A.EYE, s), (A.EYE_R, A.EYE_R * 0.75, A.EYE_R * 0.85), rot=R, seg=14, rings=8)
    p.sphere(A.H((0, -3.05, 3.47)), np.array((0.08, 0.12, 0.03)) * A.HK, seg=10, rings=5)
    return [pair(p.to_object())]


def build_mouth():
    H, k = A.H, A.HK
    out = []
    p = Part('Palate', 'mouth', bone='Head')
    p.sphere(H((0, -3.36, 3.48)), np.array((0.15, 0.36, 0.035)) * k, seg=14, rings=6)
    out.append(pair(p.to_object()))
    p = Part('Tongue', 'mouth', bone='Jaw')
    p.sphere(H((0, -3.3, 3.43)), np.array((0.1, 0.3, 0.03)) * k, seg=14, rings=6)
    p.sphere(H((0, -3.3, 3.42)), np.array((0.13, 0.34, 0.025)) * k, seg=14, rings=6)
    out.append(pair(p.to_object()))
    up = Part('TeethUpper', 'tooth', bone='Head')
    low = Part('TeethLower', 'tooth', bone='Jaw')
    zu, zl = 3.47, 3.44
    for s in (1, -1):
        # the canines: long, yellowed, the upper ones curving down outside the lower lip
        b = H((0.12 * s, -3.64, zu))
        ln = 0.07 if s < 0 else 0.2           # the right upper canine is snapped off
        horn(up, b, b + np.array((0.01 * s, -0.03, -ln * 0.5)) * k, b + np.array((0.015 * s, 0.0, -ln)) * k,
             0.04 * k, sides=8)
        b = H((0.1 * s, -3.68, zl))
        horn(low, b, b + np.array((0, -0.03, 0.08)) * k, b + np.array((0.0, 0.0, 0.15)) * k, 0.032 * k, sides=8)
        # the premolar saw behind them
        for j, y in enumerate((-3.48, -3.36, -3.24, -3.12)):
            w = 0.13 + 0.015 * j
            bb = H((w * s, y, zu))
            horn(up, bb, bb + np.array((0, 0.0, -0.035)) * k, bb + np.array((0, 0.01, -0.07)) * k, 0.028 * k, n=5,
                 sides=6)
            bb = H((w * 0.93 * s, y + 0.03, zl))
            horn(low, bb, bb + np.array((0, 0, 0.03)) * k, bb + np.array((0, 0.01, 0.06)) * k, 0.025 * k, n=5,
                 sides=6)
    for x in (-0.07, -0.025, 0.025, 0.07):
        b = H((x, -3.7, zu))
        horn(up, b, b + np.array((0, 0, -0.025)) * k, b + np.array((0, 0, -0.05)) * k, 0.016 * k, n=4, sides=5)
        b = H((x * 0.9, -3.72, zl))
        horn(low, b, b + np.array((0, 0, 0.02)) * k, b + np.array((0, 0, 0.04)) * k, 0.014 * k, n=4, sides=5)
    out.append(pair(up.to_object()))
    out.append(pair(low.to_object()))
    return out


def build_claws():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        for paw, bone, spread, r0, ln, reach in ((A.FPAW, 'FToes', 40, 0.045, 0.2, 0.24),
                                                  (A.HPAW, 'HToes', 38, 0.04, 0.17, 0.22)):
            c = A._m(paw, s)
            p = Part(f'{side}{bone}Claws', 'claw', bone=side + bone)
            for a in np.linspace(-spread, spread, 4):
                th = math.radians(a)
                d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
                base = c + d * (reach + 0.06) + np.array((0, 0, 0.06))
                tip = base + d * ln * 0.75 + np.array((0, 0, -0.11))
                ctrl = base + d * ln * 0.6 + np.array((0, 0, 0.02))
                horn(p, base, ctrl, tip, r0, n=6, sides=6, r_tip=0.01)
            out.append(pair(p.to_object()))
    return out


# ------------------------------------------------------------------ worn
def collar_frame():
    a, b = A.NECK_PTS[0] + (0, 0, -0.08), A.NECK_PTS[1] + (0, 0, -0.08)
    ax = (b - a) / np.linalg.norm(b - a)
    return a, b, A._lerp(a, b, 0.55), ax


def build_collar(F, voxel=0.018, workdir=None):
    a, b, c, ax = collar_frame()
    halfw, radius = 0.17, 0.62
    reach = radius + 0.4

    def rel(X, Y, Z):
        return (X - c[0]) * ax[0] + (Y - c[1]) * ax[1] + (Z - c[2]) * ax[2]

    def region(X, Y, Z, db):
        rn = rel(X, Y, Z)
        return np.abs(rn) - halfw

    def th(X, Y, Z, db):
        rn = rel(X, Y, Z) / halfw
        return 0.075 * (1.0 - 0.3 * rn ** 2) + 0.02 * np.exp(-((np.abs(rn) - 0.82) / 0.1) ** 2)

    out = [shell(F, c - reach, c + reach, voxel, 'Collar', 'iron', region, thick=th, inset=0.03, target=1600,
                 workdir=workdir, bone='Neck1')]
    e1 = np.cross(ax, (1.0, 0, 0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)
    spikes = Part('CollarSpikes', 'iron', bone='Neck1')
    for kk in range(16):
        th_ = math.tau * kk / 16
        d = e1 * math.cos(th_) + e2 * math.sin(th_)
        try:
            q = surface_along(F, c + d * 0.05, d)
        except RuntimeError:
            continue
        n = normal_at(F, q)
        base = q + n * 0.06
        tip = base + n * 0.21 + ax * 0.02
        horn(spikes, base - n * 0.03, base + n * 0.12, tip, 0.05, n=6, sides=6, r_tip=0.006)
        for off in (-0.11, 0.11):
            spikes.sphere(q + n * 0.085 + ax * off, (0.022, 0.022, 0.022), seg=8, rings=5)
    out.append(pair(spikes.to_object()))
    # the ring at the throat and the snapped chain hanging from it
    h0 = A.REST['Charm1'][0]
    ring = Part('CollarRing', 'iron', bone='Neck1')
    ring.torus(h0 + np.array((0, -0.02, 0.04)), (0, 1, 0.3), 0.1, 0.026, seg=14, sides=6)
    out.append(pair(ring.to_object()))
    chain = Part('Chain', 'iron', bone='Charm1', binding='charm')
    top, bot = A.REST['Charm1'][0], A.REST['Charm2'][1]
    n_links = 6
    for i in range(n_links):
        u = (i + 0.5) / n_links
        p = A._lerp(top, bot, u)
        axis = (0, 1, 0) if i % 2 == 0 else (1, 0, 0)
        chain.torus(p, axis, 0.075, 0.02, seg=12, sides=6, squash=(1.0, 1.6))
    out.append(pair(chain.to_object()))
    return out


def build_chamfron(F, voxel=0.016, workdir=None):
    """An iron face plate over the brow and down the muzzle's bridge, riveted, with a
    short spike on the brow; rigid on the head."""
    H, k = A.H, A.HK
    lo = H((-0.5, -3.9, 3.55))
    hi = H((0.5, -2.6, 4.2))
    y_back, y_front = H((0, -2.98, 0))[1], H((0, -3.62, 0))[1]
    z_cut = H((0, 0, 3.66))[2]

    def region(X, Y, Z, db):
        r = np.maximum(Y - y_back, y_front - Y)                       # between the ears and the nose
        r = np.maximum(r, z_cut - Z + 0.08 * np.abs(X) / 0.25)        # on top of the head
        r = np.maximum(r, np.abs(X) - (0.15 + 0.06 * (Y - y_front) / (y_back - y_front)) * k)
        return r

    def extra(G):
        ridge = [H((0, -3.58, 3.81)), H((0, -3.2, 3.97)), H((0, -2.92, 4.04))]
        G.add(Polyline([tuple(p) for p in ridge], 0.022 * k), 0.015)
        for s in (1, -1):
            for y in (-3.05, -3.3, -3.52):
                G.add(Sphere(H((0.12 * s, y, 3.86 - 0.07 * (y + 3.05) / -0.47)), 0.02 * k), 0.006)
    return [shell(F, lo, hi, voxel, 'Chamfron', 'iron', region, thick=0.05, inset=0.02, target=1300,
                  workdir=workdir, bone='Head', binding='rigid', extra=extra)]


COAT_Y = (-1.85, 1.25)


def build_coat(F, voxel=0.022, workdir=None):
    """The quilted war-coat over the back and the shoulders, hanging to mid-flank."""
    rng_n = sdf.Noise(71)

    def region(X, Y, Z, db):
        edge = 2.52 + 0.07 * rng_n.fbm(X * 3, Y * 3, Z * 3, octaves=2)
        r = edge - Z
        r = np.maximum(r, np.maximum(COAT_Y[0] - Y, Y - COAT_Y[1]))
        return r

    out = [shell(F, (-1.25, -2.15, 2.1), (1.25, 1.55, 3.6), voxel, 'Coat', 'leather', region, thick=0.06, inset=0.03,
                 target=2600, workdir=workdir, bone='Spine2')]
    return out


def build_lames(F, voxel=0.018, workdir=None):
    """Three riveted iron lames down the spine over the coat, each with a row of short spikes."""
    out = []
    spikes = Part('LameSpikes', 'iron', bone='Spine2')
    for i, (y0, y1) in enumerate(((-1.62, -0.98), (-1.08, -0.42), (-0.52, 0.12), (0.02, 0.66))):

        def region(X, Y, Z, db, y0=y0, y1=y1):
            r = np.maximum(y0 - Y, Y - y1)
            return np.maximum(r, 2.74 - Z + 0.3 * X * X)

        def th(X, Y, Z, db, y0=y0, y1=y1):
            u = np.clip((Y - y0) / (y1 - y0), 0, 1)
            return 0.1 + 0.05 * u           # each lame rises toward its back edge over the next

        out.append(shell(F, (-0.95, y0 - 0.2, 2.4), (0.95, y1 + 0.2, 3.5), voxel, f'Lame{i}', 'iron', region,
                         thick=th, inset=-0.065, target=800, workdir=workdir, bone='Spine2'))
        for y in np.linspace(y0 + 0.15, y1 - 0.15, 2):
            q = surface_along(F, (0, y, 2.6), (0, 0, 1))
            base = q + np.array((0, 0, 0.11))
            horn(spikes, base, base + np.array((0, 0.03, 0.09)), base + np.array((0, 0.07, 0.18)), 0.042, n=6, sides=6)
            for s in (1, -1):
                q2 = surface_along(F, (0, y, 2.8), (s, 0, 0.7))
                spikes.sphere(q2 + normal_at(F, q2) * 0.115, (0.02, 0.02, 0.02), seg=8, rings=5)
    out.append(pair(spikes.to_object()))
    return out


def build_caparison(F, voxel=0.018, workdir=None):
    """The Bastion's sea-green cloth hanging off the coat's edge down each flank,
    ragged at the hem; torn away over the left flank's hole."""
    out = []
    rng_n = sdf.Noise(83)
    for s, side in ((1, 'L_'), (-1, 'R_')):
        def region(X, Y, Z, db, s=s):
            hem = 1.72 + 0.14 * rng_n.fbm(X * 2, Y * 6, Z * 2, octaves=3)
            r = np.maximum(hem - Z, Z - 2.62)
            r = np.maximum(r, 0.3 - X * s)
            r = np.maximum(r, np.maximum(-1.15 - Y, Y - 0.7))
            if s > 0:
                # torn away round the flank hole, ragged
                cut = 0.62 - np.sqrt(((Y + 0.72) / 1.1) ** 2 + ((Z - 2.3) / 0.75) ** 2) \
                    + 0.06 * rng_n.fbm(Y * 7, Z * 7, X * 7, octaves=2)
                r = np.maximum(r, cut)
            return r

        def th(X, Y, Z, db):
            return 0.11 + 0.035 * np.clip(2.4 - Z, 0, 1)      # it hangs away from the body toward the hem

        out.append(shell(F, (min(0, 1.3 * s) - 0.05, -1.5, 1.5), (max(0, 1.3 * s) + 0.05, 1.0, 2.75), voxel,
                         f'{side}Caparison', 'cloth', region, thick=th, inset=-0.08, target=1300, workdir=workdir,
                         bone='Spine2'))
    return out


def _barnacle(G, base, n, r, h, rng):
    n = _unit(n)
    h = min(h, r * 0.8)
    top = base + n * h
    G.add(RoundCone(base - n * 0.015, top, r, r * 0.66), 0.008)
    G.sub(Sphere(top + n * r * 0.3, r * 0.52), 0.005)
    F_ = frame_from(n)
    for kk in range(6):
        a = math.tau * kk / 6 + rng.uniform(0, 0.4)
        sd = F_[:, 0] * math.cos(a) + F_[:, 1] * math.sin(a)
        G.ridge(Polyline([base + sd * r * 0.98, top + sd * r * 0.55], 0.002), 0.004, k=0.004)


def build_barnacles(F, workdir=None):
    """Clusters crusting the collar, the coat's lames and the shoulders, as (hi, lo)."""
    rng = np.random.default_rng(29)
    spots = [  # (name, centre, spread, count, size, lift off the skin, bone, axis z to cast from)
        ('BarnCollar', (0.34, -2.0, 3.4), 0.22, 9, 0.07, 0.09, 'Neck1', 3.15),
        ('BarnCollarR', (-0.4, -1.95, 3.1), 0.2, 6, 0.06, 0.09, 'Neck1', 3.15),
        ('BarnBack', (0.2, -0.4, 3.08), 0.32, 12, 0.08, 0.08, 'Spine2', 2.45),
        ('BarnShoulderL', (0.62, -1.5, 2.6), 0.24, 10, 0.07, 0.07, 'L_Scapula', 2.45),
        ('BarnShoulderR', (-0.6, -1.4, 2.7), 0.18, 6, 0.06, 0.07, 'R_Scapula', 2.45),
        ('BarnHaunch', (0.5, 0.85, 2.85), 0.22, 8, 0.07, 0.07, 'Hips', 2.45),
    ]
    out = []
    for name, centre, spread, count, size, lift, bone, az in spots:
        c = np.asarray(centre, float)
        G = Field(c - spread - 0.3, c + spread + 0.3, 0.006)
        placed = tries = 0
        while placed < count and tries < count * 8:
            tries += 1
            q = c + rng.normal(0, spread * 0.5, 3)
            o = np.array((0.0, q[1], az))
            try:
                p = surface_along(F, o, q - o, max_dist=2.5)
            except RuntimeError:
                continue
            n = normal_at(F, p)
            if np.linalg.norm(p - c) > spread * 1.2:
                continue
            r = size * rng.uniform(0.45, 1.0)
            _barnacle(G, p + n * (lift - 0.02), n, r, r * rng.uniform(0.55, 0.8), rng)
            placed += 1
        out.append(field_pair(G, name, 'barnacle', 900, workdir, bone=bone, binding='transfer'))
    return out


def _ribbon(G, pts, nrms, width, th, rng, rag=0.35):
    pts = [np.asarray(p, float) for p in pts]
    n = len(pts)
    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        d = b - a
        L_ = float(np.linalg.norm(d))
        if L_ < 1e-4:
            continue
        d = d / L_
        nm = np.asarray(nrms[i], float)
        nm = _unit(nm - d * (nm @ d))
        sd = _unit(np.cross(nm, d))
        Rm = np.stack([sd, nm, d], axis=1)
        u = (i + 0.5) / (n - 1)
        w = width * (1.0 - 0.55 * u) * rng.uniform(1.0 - rag, 1.0)
        G.add(RoundBox((a + b) / 2, (w, th, L_ * 0.5 + 0.012), Rm, radius=th * 0.9), 0.012)


def _lay(F, pts, lift, axis_z=2.45):
    """Lay points on the skin: cast from the body's axis out through each point."""
    out, nrms = [], []
    for p in pts:
        p = np.asarray(p, float)
        o = np.array((0.0, p[1], axis_z))
        try:
            q = surface_along(F, o, p - o, max_dist=2.5)
        except RuntimeError:
            q = p
        n = normal_at(F, q)
        out.append(q + n * lift)
        nrms.append(n)
    return out, nrms


def build_kelp(F, workdir=None):
    """Kelp lying over the coat across the back and hanging off the collar."""
    rng = np.random.default_rng(53)
    out = []
    G = Field((-1.4, -1.9, 1.6), (1.4, 1.0, 3.55), 0.01)
    for k, (y, sk) in enumerate(((-1.25, 1), (-0.3, -1), (0.45, 1))):
        pts = [np.array((-0.9 * sk + 1.8 * sk * t, y + 0.25 * math.sin(t * 4 + k), 2.9)) for t in np.linspace(0, 1, 9)]
        pts = [np.array((p[0], p[1], 3.4)) for p in pts]
        laid, nr = _lay(F, pts, 0.1)
        _ribbon(G, laid, nr, 0.06, 0.01, rng)
    out.append(field_pair(G, 'KelpBack', 'kelp', 1300, workdir, bone='Spine2'))
    G = Field((-0.9, -2.5, 2.2), (0.9, -1.4, 3.7), 0.008)
    for x, ln in ((0.42, 0.7), (-0.38, 0.6), (0.15, 0.5)):
        top = np.array((x, -2.0, 3.3 if abs(x) < 0.3 else 3.15))
        pts = [top + np.array((0.08 * x * t, -0.06 * t, -ln * t)) for t in np.linspace(0, 1, 6)]
        nr = [np.array((np.sign(x) if x else 1.0, -0.3, 0.0))] * len(pts)
        _ribbon(G, pts, nr, 0.055, 0.01, rng)
    out.append(field_pair(G, 'KelpCollar', 'kelp', 600, workdir, bone='Neck1'))
    return out


def build(F, workdir, fast=False):
    v = 0.026 if fast else 0.016
    pairs = []
    pairs += build_eyes()
    pairs += build_mouth()
    pairs += build_claws()
    pairs += build_collar(F, voxel=v, workdir=workdir)
    pairs += build_chamfron(F, voxel=v * 0.85, workdir=workdir)
    pairs += build_coat(F, voxel=v * 1.2, workdir=workdir)
    pairs += build_lames(F, voxel=v, workdir=workdir)
    pairs += build_caparison(F, voxel=v, workdir=workdir)
    pairs += build_barnacles(F, workdir=workdir)
    pairs += build_kelp(F, workdir=workdir)
    return pairs
