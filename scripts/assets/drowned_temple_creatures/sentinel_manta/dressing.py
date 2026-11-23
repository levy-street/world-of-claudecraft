"""The Moonmantle Ray's dressing: its heart pearl gone dark (PearlDark, seen
only as it dies; the living pearl and the silver crescent it rests in are
sculpts in anatomy.py), the small cold eyes with their slits of light
(EyeGlow), a row of pearls down its spine, a silver band where the tide-glass
meets the tail, and the filament of cyan light inside each wing's clear edge:
five pieces a wing, each riding its wing bone's Glow twin, so the death can
put the light out from the tips inward."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part, allow=None, swap=None, relax=0):
    o = part.to_object()
    if allow:
        o['allow'] = ','.join(allow)
        o['relax'] = relax
    if swap:
        o['swap'] = swap
    hi = K.duplicate(o, o.name + '_hi')
    return (hi, o)


def build_pearl():
    """The heart pearl itself is a sculpt (anatomy.build_heart); here only
    the same pearl gone dark, seen as it dies."""
    dark = K.Part('DarkPearl', 'glow_darkpearl', bone='PearlDark')
    dark.sphere(A.PEARL_AT, (A.PEARL_R * A.HEART_K * 1.01,) * 3, seg=24, rings=14)
    return [_pair(dark)]


def build_eyes():
    out = []
    for s, side in ((1, 'L'), (-1, 'R')):
        c = A._m(A.EYE_AT, s)
        eye = K.Part(f'{side}_Eye', 'eye', bone='Head')
        eye.sphere(c, (A.EYE_R, A.EYE_R * 0.9, A.EYE_R * 0.8), seg=14, rings=9)
        # the slit: a thin bar of cold light across the eye's outer face
        slit = K.Part(f'{side}_EyeSlit', 'glow_eye', bone='EyeGlow')
        out_dir = np.array((s * 0.86, -0.42, 0.28))
        out_dir /= np.linalg.norm(out_dir)
        p = c + out_dir * A.EYE_R * 0.86
        along = np.cross(out_dir, (0, 0, 1))
        along /= np.linalg.norm(along)
        R = np.stack([along, np.cross(out_dir, along), out_dir], axis=1)
        slit.sphere(p, (0.055, 0.011, 0.012), rot=R, seg=12, rings=6)
        out += [_pair(eye), _pair(slit)]
    return out


def build_spine_pearls():
    """A row of pearls down the middle of the back, set like a necklace on the
    temple's guardian, larger at the shoulders."""
    p = K.Part('SpinePearls', 'pearl', binding='transfer')
    for i in range(7):
        y = -0.72 + 0.27 * i
        top = float(A.surfaces(0.0, y)[0])
        r = 0.055 - 0.004 * i
        p.sphere((0.0, y, top + r * 0.45), (r, r, r), seg=10, rings=7)
    return [_pair(p, allow=('Head', 'Body', 'Hip'))]


def build_crystal_band():
    a, b = A.crystal_axis()
    d = (b - a) / np.linalg.norm(b - a)
    band = K.Part('TideGlassBand', 'silver', bone='Tail6')
    band.torus(A.TAIL[-1] - d * 0.01, d, 0.036, 0.013, seg=16, sides=6)
    return [_pair(band)]


def _rim_points(lo_x, hi_x, n=26):
    """The wing outline between lo_x and hi_x (left wing): along the leading
    edge out, round the tip if it is in range, back along the trailing edge."""
    xs = np.linspace(lo_x, hi_x, n)
    le = [np.array((x, float(A.y_le(x / A.S)), float(A.zc_of(x)))) for x in xs]
    te = [np.array((x, float(A.y_te(x / A.S)), float(A.zc_of(x)))) for x in xs[::-1]]
    return le, te


def build_rim_light():
    """The filament of light inside the clear wing edge, one piece per wing
    segment (and a piece each side for the leading and trailing edge)."""
    out = []
    for s, side in ((1, 'L'), (-1, 'R')):
        for i in range(A.N_WING):
            x0 = max(A.WING_X[i] - 0.02, 0.46) if i else 0.46
            x1 = A.WING_X[i + 1] + (0.0 if i < A.N_WING - 1 else 0.0)
            le, te = _rim_points(x0, x1)
            last = i == A.N_WING - 1
            p = K.Part(f'{side}_RimLight{i + 1}', 'glow_rim', binding='transfer')
            if last:
                # round the tip in one piece
                pts = le + te[1:]
                u = np.linspace(0, 1, len(pts))
                rad = 0.016 + 0.006 * np.sin(np.pi * u)
                p.tube([A._m(q, s) for q in pts], list(rad), sides=6)
            else:
                rl = 0.011 + 0.008 * i / (A.N_WING - 1)
                p.tube([A._m(q, s) for q in le], [rl] * len(le), sides=6)
                p.tube([A._m(q, s) for q in te], [rl * 0.8] * len(te), sides=6)
            allow = [f'{side}_Wing{j + 1}' for j in range(max(0, i - 1), min(A.N_WING, i + 2))]
            if i == 0:
                allow = ['Body', 'Head', 'Hip'] + allow
            out.append(_pair(p, allow=allow, swap=f'{side}_Wing>{side}_Glow'))
    return out


def build(sculpts):
    return build_pearl() + build_eyes() + build_spine_pearls() + build_crystal_band() + build_rim_light()
