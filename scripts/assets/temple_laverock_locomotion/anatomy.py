"""Grand Necromancer Laverock: skeleton and sculpts (rest pose), in yards.

Conventions (shared with the Balgath kit this builder is adapted from): Blender
units are yards, +Z up, he FACES -Y (the game's +Z after the glTF export), his left
is +X. Bones are (name, parent, head, tail); `L_` bones are mirrored onto `R_`.

He is the brain of the Gravecallers, not their brute: a tall, gaunt prelate of the
Chapel of the Sleep gone to heresy. Crown of the head 4.0 yd, the cowl's peak about
4.3 yd (the KayKit knight is 2.6: 1.55x to the crown, 1.65x to the peak), the staff
about 5.0 yd. Proportions are a long-limbed old man's: narrow shoulders under a
broad fur mantle, long forearms and long thin fingers, a long narrow head.

Rest pose: an A-pose (arms about 30 degrees off the body) so every skin weight
separates the sleeves from the cassock cleanly.

Sculpts (signed-distance fields, sdf.py), each meshed on its own grid:
  * build_head   the face, the beard and the neck (fine grid: the face reads)
  * build_hand   one forearm and hand (fine grid: the frost-burned fingers)
  * build_body   torso, legs and boots (coarse: the robe hides all but the boots)
  * build_robe   the violet cassock, the bell sleeves and the cowl
  * build_fur    the black fur mantle and the back cape
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, Torus, frame_from, rot_matrix

# ------------------------------------------------------------------ landmarks
HEAD_C = np.array((0.0, -0.01, 3.83))
EYE = np.array((0.072, -0.178, 3.842))     # left eye centre (deep in the socket)
EYE_R = 0.03
SHOULDER = np.array((0.36, 0.03, 3.34))
ELBOW = np.array((0.66, 0.09, 2.78))
WRIST = np.array((0.92, -0.01, 2.27))
_HD = (WRIST - ELBOW) / np.linalg.norm(WRIST - ELBOW)
HAND_TIP = WRIST + _HD * 0.40
HIP = np.array((0.15, 0.02, 1.98))
KNEE = np.array((0.17, -0.04, 1.08))
ANKLE = np.array((0.18, 0.05, 0.14))
BALL = np.array((0.19, -0.14, 0.045))
TOE = np.array((0.19, -0.3, 0.035))
WAIST_Z = 2.05
HEM_Z = 0.02
SKIRT_N = 8                                  # skirt panels round the waist (0 = front, toward his left)
SKIRT_R = (0.215, 0.43, 0.66)                # waist, knee and hem radii of the cassock
SKIRT_Z = (2.02, 1.02, 0.11)
SKIRT_C = np.array((0.0, 0.03))              # the skirt's centre line (x, y)


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def hand_frame(side=1):
    """(origin, down, width, palm) of a hand at rest: `width` toward the index
    (forward), `palm` the palm's normal (toward the thigh)."""
    w = WRIST if side > 0 else mirror(WRIST)
    tip = HAND_TIP if side > 0 else mirror(HAND_TIP)
    down = tip - w
    down /= np.linalg.norm(down)
    width = np.array((0.0, -1.0, 0.0))
    width -= down * (width @ down)
    width /= np.linalg.norm(width)
    palm = np.cross(down, width) * side
    palm /= np.linalg.norm(palm)
    return w, down, width, palm


FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
_SPREAD = {'Index': 0.042, 'Middle': 0.013, 'Ring': -0.016, 'Little': -0.042}
_FLEN = {'Index': 0.108, 'Middle': 0.12, 'Ring': 0.112, 'Little': 0.088}
_FBASE = {'Index': 0.188, 'Middle': 0.195, 'Ring': 0.188, 'Little': 0.172}


def finger_chain(side, name):
    """Rest stations (base, mid, tip) of a finger."""
    w, down, width, palm = hand_frame(side)
    if name == 'Thumb':
        base = w + down * 0.05 + width * 0.035 + palm * 0.02
        d = down * 0.6 + width * 0.62 + palm * 0.5
        d /= np.linalg.norm(d)
        mid = base + d * 0.085
        d2 = d + down * 0.4
        d2 /= np.linalg.norm(d2)
        tip = mid + d2 * 0.07
        return base, mid, tip
    base = w + down * _FBASE[name] + width * _SPREAD[name]
    d = down + width * _SPREAD[name] * 1.4 + palm * 0.12
    d /= np.linalg.norm(d)
    ln = _FLEN[name]
    mid = base + d * ln
    d2 = d + palm * 0.3
    d2 /= np.linalg.norm(d2)
    tip = mid + d2 * ln * 0.92
    return base, mid, tip


def skirt_dir(k):
    """Unit horizontal direction of skirt panel k (0 = front -Y, then toward his left)."""
    th = math.tau * k / SKIRT_N
    return np.array((math.sin(th), -math.cos(th), 0.0))


def skirt_point(k, level):
    d = skirt_dir(k)
    r = SKIRT_R[level]
    back = max(0.0, d[1])
    r = r * (1.0 + 0.12 * back * (level > 0))
    return np.array((SKIRT_C[0] + d[0] * r, SKIRT_C[1] + d[1] * r, SKIRT_Z[level]))


def staff_frame():
    """The staff in the right fist at rest: the shaft runs along the hand's `width`
    axis (index side up) through the grip channel inside the curled fingers."""
    w, down, width, palm = hand_frame(-1)
    grip = w + down * 0.205 + palm * 0.03
    return grip, width


def _bones_left():
    out = [
        ('L_Clavicle', 'Spine2', (0.05, -0.0, 3.28), tuple(SHOULDER)),
        ('L_UpperArm', 'L_Clavicle', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        ('L_ElbowFix', 'L_UpperArm', tuple(ELBOW), tuple(_lerp(ELBOW, WRIST, 0.3))),
        ('L_Hand', 'L_Forearm', tuple(WRIST), tuple(HAND_TIP)),
        # the hanging drape of the bell sleeve (a spring)
        ('L_Sleeve', 'L_Forearm', tuple(_lerp(ELBOW, WRIST, 0.45) + np.array((0, 0.03, -0.06))),
         tuple(_lerp(ELBOW, WRIST, 0.85) + np.array((0.0, 0.06, -0.3)))),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(ANKLE)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, ANKLE, 0.3))),
        ('L_Foot', 'L_Shin', tuple(ANKLE), tuple(BALL)),
        ('L_Toes', 'L_Foot', tuple(BALL), tuple(TOE)),
    ]
    for f in FINGERS:
        base, mid, tip = finger_chain(1, f)
        out.append((f'L_{f}1', 'L_Hand', tuple(base), tuple(mid)))
        out.append((f'L_{f}2', f'L_{f}1', tuple(mid), tuple(tip)))
    return out


def _expand(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(head), tuple(tail)))
        if name.startswith('L_'):
            m = lambda p: (-p[0], p[1], p[2])  # noqa: E731
            twin_parent = 'R_' + parent[2:] if parent and parent.startswith('L_') else parent
            out.append(('R_' + name[2:], twin_parent, m(head), m(tail)))
    return out


def _skirt_bones():
    out = []
    for k in range(SKIRT_N):
        w, m, h = skirt_point(k, 0), skirt_point(k, 1), skirt_point(k, 2)
        out.append((f'Skirt{k}_1', 'Hips', tuple(w), tuple(m)))
        out.append((f'Skirt{k}_2', f'Skirt{k}_1', tuple(m), tuple(h)))
    return out


GRIP, STAFF_UP = staff_frame()
STAFF_FOOT_T = -2.25                          # the staff's foot, yards below the grip
STAFF_FLAME_T = 2.15                          # the flame's heart above the grip (the StaffTip anchor)
STAFF_FOOT = GRIP + STAFF_UP * STAFF_FOOT_T
STAFF_TOP = GRIP + STAFF_UP * 2.7           # the finial's point
STAFF_FLAME = GRIP + STAFF_UP * STAFF_FLAME_T
LEDGER_TOP = np.array((0.25, -0.13, 2.0))    # the belt ring on his left hip
BONES = _expand([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Hips', 'Root', (0, 0.02, 1.98), (0, 0.02, 2.25)),
    ('Spine1', 'Hips', (0, 0.02, 2.25), (0, 0.03, 2.72)),
    ('Spine2', 'Spine1', (0, 0.03, 2.72), (0, 0.04, 3.3)),
    ('Neck', 'Spine2', (0, 0.04, 3.3), (0, -0.01, 3.6)),
    ('Head', 'Neck', (0, -0.01, 3.6), (0, -0.03, 4.0)),
    ('Jaw', 'Head', (0, -0.05, 3.7), (0, -0.19, 3.56)),
    ('Staff', 'R_Hand', tuple(GRIP), tuple(STAFF_FLAME)),
] + _skirt_bones() + _bones_left())


def _topo(bones):
    out, placed = [], set()
    pending = list(bones)
    while pending:
        rest = []
        for b in pending:
            if b[1] is None or b[1] in placed:
                out.append(b)
                placed.add(b[0])
            else:
                rest.append(b)
        if len(rest) == len(pending):
            raise RuntimeError(f'unparented bones: {[b[0] for b in rest]}')
        pending = rest
    return out


BONES = _topo(BONES)
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
PARENT = {n: p for n, p, _, _ in BONES}


class ConeShell:
    """A shell of thickness `t` round the vertical axis through (cx, cy): its radius
    runs linearly through the (z, r) stations `prof`; it is cut to the angular sector
    centred on `th0` (0 = front, toward his left) of half-width `half` (radians) and
    to the z range of the profile. Used for the fur pelerine and the back cape."""

    def __init__(self, cx, cy, prof, t, th0=0.0, half=math.pi, bone=None, solid=False, ey=1.0):
        self.cx, self.cy, self.prof, self.t, self.th0, self.half, self.bone = cx, cy, prof, t, th0, half, bone
        self.solid, self.ey = solid, ey
        rmax = max(r for _, r in prof) + t
        zs = [z for z, _ in prof]
        self.lo = np.array((cx - rmax, cy - rmax * 1.3, min(zs) - t))
        self.hi = np.array((cx + rmax, cy + rmax * 1.3, max(zs) + t))

    def dist(self, X, Y, Z):
        zs = np.array([z for z, _ in self.prof])
        rs = np.array([r for _, r in self.prof])
        o = np.argsort(zs)
        R = np.interp(Z, zs[o], rs[o])
        dx, dy = X - self.cx, (Y - self.cy) / self.ey
        rho = np.sqrt(dx * dx + dy * dy)
        d = (rho - R) if self.solid else (np.abs(rho - R) - self.t)
        if self.half < math.pi:
            th = np.arctan2(dx, -dy)
            dth = np.abs((th - self.th0 + math.pi) % math.tau - math.pi) - self.half
            d = np.maximum(d, dth * np.maximum(rho, 0.05))
        d = np.maximum(d, np.maximum(zs.min() - Z, Z - zs.max()))
        return d

    def dist_pts(self, P):
        return self.dist(P[:, 0], P[:, 1], P[:, 2])


def _sym(fn):
    for s in (1, -1):
        fn(s)


def _m(p, s):
    p = np.asarray(p, dtype=float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def _along_rot(a, b):
    return frame_from(np.asarray(b) - np.asarray(a))


def _project(F, origin, toward, inset=0.002):
    o = np.asarray(origin, float)
    d = np.asarray(toward, float) - o
    d /= np.linalg.norm(d)
    t, prev = 0.0, F.sample(o[None])[0]
    while t < 1.0:
        t += F.voxel * 0.6
        v = F.sample((o + d * t)[None])[0]
        if prev < 0 <= v:
            return o + d * (t - inset)
        prev = v
    return np.asarray(toward, float)


# ------------------------------------------------------------------ head
def build_head(voxel=0.0045, detail=True, seed=11):
    """The face and the neck (the beard, the brows and the hair are the hair sculpt).
    An old cantor, haunted but kind: a long head with a high receding brow, heavy
    drooping upper lids over deep-set eyes, soft bags beneath, high cheekbones over
    hollow (but living) cheeks, a long nose with a soft bulb, big old ears."""
    F = Field((-0.27, -0.42, 3.18), (0.27, 0.3, 4.12), voxel)
    F.add(Ellipsoid((0, 0.015, 3.875), (0.152, 0.18, 0.168), rot_matrix(rx=-0.12), bone='Head'), 0.04)
    F.add(Ellipsoid((0, -0.07, 3.78), (0.126, 0.122, 0.17), bone='Head'), 0.05)
    # the brow: a soft shelf over the eyes, heavier over the inner corners
    F.add(Ellipsoid((0, -0.152, 3.9), (0.112, 0.036, 0.026), rot_matrix(rx=0.18), bone='Head'), 0.028)
    _sym(lambda s: F.add(Ellipsoid(_m((0.052, -0.16, 3.895), s), (0.045, 0.03, 0.024), rot_matrix(ry=-0.3 * s),
                                   bone='Head'), 0.016))
    # cheekbones, and the living flesh of the cheeks under them
    _sym(lambda s: F.add(Ellipsoid(_m((0.09, -0.128, 3.795), s), (0.042, 0.048, 0.026), rot_matrix(rz=0.3 * s),
                                   bone='Head'), 0.02))
    _sym(lambda s: F.add(Ellipsoid(_m((0.082, -0.128, 3.725), s), (0.036, 0.042, 0.04), bone='Jaw'), 0.03))
    _sym(lambda s: F.add(Ellipsoid(_m((0.105, -0.03, 3.74), s), (0.03, 0.055, 0.06), bone='Jaw'), 0.03))
    # the nose: long, a slight hook at the bridge, a soft bulb at the tip
    F.add(Polyline([(0, -0.168, 3.878), (0, -0.192, 3.83), (0, -0.21, 3.785), (0, -0.214, 3.758)],
                   [0.016, 0.017, 0.019, 0.017], bone='Head'), 0.014)
    F.add(Sphere((0, -0.214, 3.762), 0.022, bone='Head'), 0.012)
    _sym(lambda s: F.add(Sphere(_m((0.021, -0.196, 3.752), s), 0.014, bone='Head'), 0.01))
    # the mouth (mostly under the moustache), a little open: a singer's mouth
    F.add(Ellipsoid((0, -0.172, 3.71), (0.048, 0.026, 0.02), bone='Head'), 0.012)
    F.add(Ellipsoid((0, -0.12, 3.66), (0.075, 0.068, 0.05), bone='Jaw'), 0.03)
    F.add(Ellipsoid((0, -0.165, 3.632), (0.044, 0.034, 0.042), bone='Jaw'), 0.02)
    F.add(Ellipsoid((0, -0.172, 3.68), (0.044, 0.02, 0.013), bone='Jaw'), 0.008)
    _sym(lambda s: F.add(RoundCone(_m((0.098, -0.04, 3.7), s), _m((0.04, -0.15, 3.62), s), 0.024, 0.02,
                                   bone='Jaw'), 0.02))
    # big old ears
    _sym(lambda s: F.add(Ellipsoid(_m((0.148, 0.005, 3.8), s), (0.016, 0.036, 0.066), rot_matrix(rx=0.25, rz=-0.25 * s),
                                   bone='Head'), 0.012))
    _sym(lambda s: F.sub(Ellipsoid(_m((0.158, -0.002, 3.8), s), (0.006, 0.02, 0.04), rot_matrix(rx=0.25)), 0.006))
    F.add(RoundCone((0, 0.03, 3.3), (0, -0.01, 3.66), 0.078, 0.07, bone='Neck'), 0.04)
    _sym(lambda s: F.add(RoundCone(_m((0.05, -0.07, 3.36), s), _m((0.055, -0.04, 3.68), s), 0.014, 0.012,
                                   bone='Neck'), 0.02))
    F.add(Ellipsoid((0, -0.07, 3.43), (0.022, 0.018, 0.03), bone='Neck'), 0.015)
    F.add(Ellipsoid((0, 0.03, 3.25), (0.17, 0.12, 0.07), bone='Spine2'), 0.05)
    # the sockets: deep-set, not a skull's holes
    _sym(lambda s: F.sub(Sphere(_m(EYE, s) + np.array((0, -0.006, 0.002)), EYE_R + 0.002), 0.012))
    _sym(lambda s: F.sub(Ellipsoid(_m((0.088, -0.15, 3.73), s), (0.02, 0.016, 0.03), rot_matrix(rz=0.2 * s)),
                         0.03))
    F.sub(Ellipsoid((0, -0.188, 3.694), (0.04, 0.03, 0.0045)), 0.004)
    _sym(lambda s: F.sub(Sphere(_m((0.013, -0.215, 3.745), s), 0.0065), 0.004))
    # the lids: a heavy, drooping upper lid (the outer corner falls: kindness,
    # tiredness) and a soft bag under each eye
    def lids(s):
        e = _m(EYE, s)
        F.add(Ellipsoid(e + np.array((0.0, 0.0, 0.016)), (EYE_R * 0.95, EYE_R * 0.62, EYE_R * 0.46),
                        rot_matrix(rx=-0.35, ry=0.2 * s), bone='Head'), 0.016)
        F.add(Ellipsoid(e + np.array((0.004 * s, 0.0, -0.022)), (EYE_R * 0.8, EYE_R * 0.45, EYE_R * 0.3),
                        rot_matrix(ry=-0.12 * s), bone='Head'), 0.016)
    _sym(lids)
    if detail:
        _face_detail(F, Noise(seed))
    return F


def _face_detail(F, noise):
    hc = np.array((0.0, -0.02, 3.8))

    def line(pts, depth=0.004, k=0.006):
        P = [_project(F, hc, p) for p in pts]
        F.groove(Polyline(P, 0.001), depth, k=k)

    # forehead lines and the two upright frown lines of a man who has grieved
    for z, w in ((3.945, 0.07), (3.965, 0.085), (3.985, 0.075)):
        line([(-w, -0.15, z + 0.006), (0, -0.165, z), (w, -0.15, z + 0.006)], depth=0.0028)
    for s in (1, -1):
        line([(0.012 * s, -0.17, 3.925), (0.014 * s, -0.18, 3.895)], depth=0.004)
        # the smile folds from the nose down past the mouth (they read through the moustache's edge)
        line([(0.03 * s, -0.2, 3.752), (0.052 * s, -0.188, 3.72), (0.062 * s, -0.172, 3.68)], depth=0.004,
             k=0.006)
        # crow's feet: laughter lines, fanned
        for k in range(4):
            a = math.radians(-30 + 20 * k)
            c = np.array((0.106 * s, -0.148, 3.845))
            line([c, c + np.array((0.032 * s * math.cos(a), 0.022, 0.032 * math.sin(a)))], depth=0.0024)
        line([(0.05 * s, -0.172, 3.82), (0.088 * s, -0.152, 3.812)], depth=0.0035)
        line([(0.1 * s, -0.12, 3.76), (0.09 * s, -0.125, 3.69)], depth=0.0035)
    F.displace(lambda X, Y, Z: 0.001 * noise.fbm(X * 90, Y * 90, Z * 90, octaves=2)
               - 0.0012 * noise.ridged(X * 40 + 3, Y * 40, Z * 110, octaves=2), band=0.03)


# ------------------------------------------------------------------ hands
def build_hand(side, voxel=0.0045, detail=True, seed=5):
    """One forearm (to inside the sleeve) and the long-fingered hand."""
    s = side
    el, wr = _m(ELBOW, s), _m(WRIST, s)
    tip = _m(HAND_TIP, s)
    lo = np.minimum(el, tip) - 0.16
    hi = np.maximum(el, tip) + 0.16
    F = Field(lo, hi, voxel)
    fo, hand = _side('Forearm', s), _side('Hand', s)
    F.add(RoundCone(_lerp(el, wr, 0.15), wr, 0.05, 0.036, bone=fo), 0.02)
    F.add(Ellipsoid(_lerp(el, wr, 0.4), (0.048, 0.045, 0.12), _along_rot(el, wr), bone=fo), 0.02)
    w, down, width, palm = hand_frame(s)
    R = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.1, (0.05, 0.019, 0.075), R, radius=0.016, bone=hand), 0.018)
    F.add(Ellipsoid(w + down * 0.07 + width * 0.03 + palm * 0.012, (0.024, 0.02, 0.045), R, bone=hand), 0.012)
    F.add(Ellipsoid(w + down * 0.02, (0.035, 0.024, 0.03), R, bone=hand), 0.015)
    for f in FINGERS:
        base, mid, ftip = finger_chain(s, f)
        # stout fingers (the game's hands read big and round, not spidery)
        r0 = 1.25 * (0.0145 if f == 'Thumb' else {'Index': 0.0118, 'Middle': 0.012, 'Ring': 0.0112, 'Little': 0.0098}[f])
        b1, b2 = _side(f + '1', s), _side(f + '2', s)
        F.add(Sphere(base - palm * 0.006, r0 * 1.2, bone=hand), 0.007)
        F.add(RoundCone(base, mid, r0, r0 * 0.86, bone=b1), 0.004)
        F.add(Sphere(mid, r0 * 0.98, bone=b2), 0.003)
        F.add(RoundCone(mid, ftip, r0 * 0.86, r0 * 0.62, bone=b2), 0.003)
        tdir = (ftip - mid) / np.linalg.norm(ftip - mid)
        F.add(RoundCone(ftip - tdir * 0.012 - palm * 0.004, ftip + tdir * 0.016 + palm * 0.006, r0 * 0.5, r0 * 0.2,
                        bone=b2), 0.002)
    if detail:
        noise = Noise(seed + (0 if s > 0 else 3))
        for f in ('Index', 'Middle', 'Ring', 'Little'):
            base, _, _ = finger_chain(s, f)
            a = w + down * 0.04 + width * _SPREAD[f] * 0.3
            F.ridge(Polyline([a - palm * 0.022, base - palm * 0.016], 0.001), 0.0035, k=0.004)
        ax = (wr - el) / np.linalg.norm(wr - el)
        side_v = np.cross(ax, palm)
        for k in range(2):
            pts = [_lerp(el, wr, t) + side_v * 0.036 * (1 if k else -1) - palm * (0.03 + 0.008 * math.sin(t * 9 + k))
                   for t in np.linspace(0.25, 0.95, 8)]
            F.ridge(Polyline(pts, 0.001), 0.003, k=0.0045)
        F.displace(lambda X, Y, Z: -0.0014 * noise.ridged(X * 140, Y * 140, Z * 140, octaves=2)
                   + 0.0008 * noise.fbm(X * 60, Y * 60, Z * 60, octaves=2), band=0.02)
    return F


# ------------------------------------------------------------------ body (under the robe)
def build_body(voxel=0.014, detail=True):
    """Torso, hips, legs and boots: the frame the cassock hangs on. Only the boot
    toes show under the hem; the rest is there for the weights and the clearance."""
    F = Field((-0.5, -0.45, -0.03), (0.5, 0.42, 3.42), voxel)
    F.add(Ellipsoid((0, 0.03, 2.95), (0.2, 0.135, 0.32), bone='Spine2'), 0.08)
    F.add(Ellipsoid((0, 0.04, 2.45), (0.165, 0.12, 0.28), bone='Spine1'), 0.08)
    F.add(Ellipsoid((0, 0.03, 2.05), (0.19, 0.13, 0.17), bone='Hips'), 0.07)
    _sym(lambda s: F.add(Ellipsoid(_m((0.24, 0.03, 3.22), s), (0.13, 0.1, 0.09), bone='Spine2'), 0.05))
    _sym(lambda s: F.add(RoundCone(_m(SHOULDER, s), _m(ELBOW, s), 0.07, 0.055, bone=_side('UpperArm', s)), 0.04))

    def leg(s):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        F.add(RoundCone(hp, kn, 0.1, 0.07, bone=_side('Thigh', s)), 0.05)
        F.add(Sphere(kn, 0.068, bone=_side('KneeFix', s)), 0.03)
        F.add(RoundCone(kn, an, 0.066, 0.048, bone=_side('Shin', s)), 0.04)
        foot, toes = _side('Foot', s), _side('Toes', s)
        F.add(Ellipsoid(an + np.array((0, 0.02, -0.06)), (0.058, 0.07, 0.07), bone=foot), 0.03)
        F.add(RoundCone(_m((0.185, -0.02, 0.06), s), _m(BALL, s) + np.array((0, 0, 0.012)), 0.06, 0.05,
                        bone=foot), 0.03)
        F.add(RoundCone(_m(BALL, s) + np.array((0, 0, 0.01)), _m(TOE, s) + np.array((0, -0.04, 0.035)), 0.048,
                        0.012, bone=toes), 0.02)
    _sym(leg)
    return F


# ------------------------------------------------------------------ robe (cassock, sleeves)
def build_robe(voxel=0.009, detail=True, seed=3):
    """The under-habit: a full-length cassock that drags at the hem (the lagoon
    soaks it), and the deep bell sleeves. Real folds: tubes of cloth hanging
    from the girdle, widening to the hem, where the edge waves with them."""
    F = Field((-1.32, -0.86, -0.04), (1.32, 1.0, 3.7), voxel)
    noise = Noise(seed)
    F.add(Ellipsoid((0, 0.03, 2.95), (0.29, 0.2, 0.38), bone='Spine2'), 0.07)
    F.add(Ellipsoid((0, 0.04, 2.45), (0.25, 0.18, 0.34), bone='Spine1'), 0.07)
    F.add(Ellipsoid((0, 0.03, 2.1), (0.25, 0.185, 0.18), bone='Hips'), 0.06)
    _sym(lambda s: F.add(Ellipsoid(_m((0.29, 0.03, 3.2), s), (0.17, 0.15, 0.13), bone='Spine2'), 0.05))
    F.add(RoundCone((0, 0.05, 3.28), (0, 0.04, 3.42), 0.12, 0.105, bone='Neck'), 0.03)
    F.sub(RoundCone((0, 0.03, 3.36), (0, 0.02, 3.6), 0.085, 0.1), 0.01)
    F.add(ConeShell(SKIRT_C[0], SKIRT_C[1] + 0.02, [(2.2, 0.215), (1.95, 0.245), (1.5, 0.33), (1.0, 0.44),
                                                    (0.45, 0.58), (0.03, 0.66)], 0.0, bone='Hips', solid=True,
                    ey=1.08), 0.08)
    _skirt_tubes(F, [(2.0, 0.24), (1.0, 0.44), (0.05, 0.66)], 13, 0.05, seed=1)

    def sleeve(s):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(RoundCone(sh + np.array((0.02 * s, 0, 0.02)), el, 0.13, 0.112, bone=up), 0.05)
        F.add(Sphere(el, 0.115, bone=_side('ElbowFix', s)), 0.04)
        cuff = wr + (wr - el) * 0.12
        F.add(RoundCone(el, cuff, 0.115, 0.24, bone=fo), 0.04)
        drop = _lerp(el, wr, 0.72) + np.array((0, 0.08, -0.25))
        F.add(Ellipsoid(drop, (0.09, 0.18, 0.27), rot_matrix(rx=0.3), bone=_side('Sleeve', s)), 0.12)
        ax = (wr - el) / np.linalg.norm(wr - el)
        F.sub(RoundCone(wr - ax * 0.32, cuff + ax * 0.06, 0.06, 0.21), 0.015)
        # folds down the hanging sleeve, from the elbow toward the cuff
        side_v = np.cross(ax, (0, 0, 1.0))
        side_v /= np.linalg.norm(side_v)
        for j, (a, b) in enumerate(((0.0, 0.7), (0.3, 0.9), (-0.4, 0.85))):
            off = side_v * 0.09 * a * s + np.array((0, 0.05 * (j - 1), 0))
            F.ridge(Polyline([_lerp(el, wr, 0.2) + off + np.array((0, 0.07, -0.07)),
                              _lerp(el, cuff, b) + off * 1.6 + np.array((0, 0.11, -0.16))], 0.001), 0.012, k=0.018)
    _sym(sleeve)
    if detail:
        _robe_detail(F, noise)
    return F


def _skirt_tubes(F, prof, n, r_hem, seed=1, bone='Hips'):
    """Hanging tubes of cloth: `n` folds round a skirt whose radius runs through
    `prof` [(z, r) top, middle, hem], each a tapered tube from just under the top
    station to the hem, fat at the hem (about r_hem), its angle jittered. Smoothly
    unioned with the skirt so they read as folds of one cloth, not pipes."""
    rng = np.random.default_rng(seed)
    (z0, r0), (zm, rm), (zh, rh) = prof
    cx, cy = SKIRT_C
    for i in range(n):
        th = math.tau * (i + rng.uniform(-0.28, 0.28)) / n
        d = np.array((math.sin(th), -math.cos(th), 0.0))
        back = max(0.0, d[1])
        k_hem = 1.0 + 0.1 * back
        rr = r_hem * rng.uniform(0.7, 1.25)
        top = np.array((cx + d[0] * (r0 - 0.03), cy + d[1] * (r0 - 0.03), z0 - 0.05))
        mid = np.array((cx + d[0] * (rm * 0.97), cy + d[1] * (rm * 0.97), zm))
        hem = np.array((cx + d[0] * (rh * k_hem - rr * 0.55), cy + d[1] * (rh * k_hem - rr * 0.55), zh + 0.01))
        F.add(Polyline([top, mid, hem], [0.012, rr * 0.55, rr], bone=bone), 0.05)


def _robe_detail(F, noise):
    cx, cy = SKIRT_C

    def folds(X, Y, Z):
        th = np.arctan2(X - cx, -(Y - cy))
        r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
        low = np.clip((WAIST_Z - Z) / (WAIST_Z - HEM_Z), 0, 1)
        n = noise(X * 3.0, Y * 3.0, Z * 0.6)
        f2 = np.sin(th * 29 + n * 3.1) * 0.5 + 0.5
        skirt = (Z < WAIST_Z + 0.05) & (r > 0.12)
        out = 0.006 * low * f2 + 0.004 * noise(X * 9, Y * 9, Z * 2.0)
        return np.where(skirt, out, 0.0)
    F.displace(folds, band=0.12)

    def hem(X, Y, Z):
        # the dragged hem: lifted and ragged where it has trailed through water
        n = noise.fbm(X * 7, Y * 7, Z * 2, octaves=3)
        lift = np.clip((0.16 - Z) / 0.16, 0, 1)
        return lift * np.clip(n, 0, None) * 0.05
    F.displace(hem, band=0.1, region=(np.array((-1.0, -1.0, -0.05)), np.array((1.0, 1.0, 0.3))))
    # a little crumple at the waist under the girdle, and the wool's nap
    F.displace(lambda X, Y, Z: 0.0025 * noise.fbm(X * 22, Y * 22, Z * 22, octaves=2)
               - 0.004 * noise.ridged(X * 9 + 2, Y * 9, Z * 5, octaves=2)
               - 0.006 * np.exp(-((Z - 2.13) / 0.05) ** 2), band=0.05)


# ------------------------------------------------------------------ surplice (the over-habit)
SURPLICE_HEM = 0.78


def build_surplice(voxel=0.009, detail=True, seed=13):
    """The choir surplice over the cassock: a pearl over-habit from under the
    stole's cape to below the knee, gathered at the girdle and falling in its
    own deep folds to a waving hem; a mended layer of its own (surface.py)."""
    F = Field((-0.9, -0.82, SURPLICE_HEM - 0.12), (0.9, 0.9, 3.15), voxel)
    noise = Noise(seed)
    F.add(Ellipsoid((0, 0.03, 2.82), (0.305, 0.215, 0.3), bone='Spine2'), 0.06)
    F.add(Ellipsoid((0, 0.04, 2.42), (0.265, 0.195, 0.3), bone='Spine1'), 0.06)
    F.add(Ellipsoid((0, 0.03, 2.1), (0.265, 0.2, 0.16), bone='Hips'), 0.05)
    F.add(ConeShell(SKIRT_C[0], SKIRT_C[1] + 0.02, [(2.12, 0.25), (1.9, 0.29), (1.4, 0.4), (SURPLICE_HEM, 0.555)],
                    0.0, bone='Hips', solid=True, ey=1.08), 0.08)
    _skirt_tubes(F, [(1.98, 0.27), (1.35, 0.4), (SURPLICE_HEM + 0.02, 0.555)], 11, 0.045, seed=5)
    if detail:
        cx, cy = SKIRT_C

        def hemwave(X, Y, Z):
            # the hem dips and lifts with the folds (a straight hem reads as a lampshade)
            th = np.arctan2(X - cx, -(Y - cy))
            w = 0.5 + 0.5 * np.sin(th * 5 + 0.7) * np.sin(th * 3 + 2.0)
            band = np.clip((SURPLICE_HEM + 0.16 - Z) / 0.16, 0, 1)
            return band * w * 0.06
        F.displace(hemwave, band=0.12, region=(np.array((-0.9, -0.9, SURPLICE_HEM - 0.1)),
                                               np.array((0.9, 0.9, SURPLICE_HEM + 0.2))))
        F.displace(lambda X, Y, Z: 0.0022 * noise.fbm(X * 24, Y * 24, Z * 24, octaves=2)
                   - 0.007 * np.exp(-((Z - 2.13) / 0.05) ** 2), band=0.05)
    return F


# ------------------------------------------------------------------ the choir stole's cape
PELERINE_EY = 0.7
PELERINE_LOBES = 12
PELERINE_PROF = [(3.5, 0.15), (3.44, 0.25), (3.34, 0.42), (3.16, 0.53), (2.84, 0.6)]
PELERINE_T = 0.034


def on_pelerine(th, z, off=0.0):
    """A point on the pelerine's outer face at azimuth `th` (0 = front, toward his
    left) and height z, lifted `off` off it (below the hem it hangs straight)."""
    zs = [a for a, _ in PELERINE_PROF][::-1]
    rs = [b for _, b in PELERINE_PROF][::-1]
    r = float(np.interp(z, zs, rs)) + PELERINE_T + off
    return np.array((r * math.sin(th), 0.05 - r * math.cos(th) * PELERINE_EY, z))


def build_mantle(voxel=0.01, detail=True, seed=9):
    """The Pale Choir's stiff pelerine: a starched shoulder cape closed at the
    throat, broad over the shoulders (the old frame looks wide under it) and close
    over the breast and the back, its edge cut in crescent scallops. Weighted
    from the robe (build.py)."""
    F = Field((-0.8, -0.6, 2.75), (0.8, 0.8, 3.62), voxel)
    noise = Noise(seed)
    F.add(ConeShell(0.0, 0.05, PELERINE_PROF, PELERINE_T, bone='Spine2', ey=PELERINE_EY), 0.02)
    F.add(Torus((0, 0.04, 3.45), (0, -0.2, 1.0), 0.165, 0.032, bone='Neck'), 0.03)
    if detail:
        def scallop(X, Y, Z):
            # round lobes hanging between points (a crescent embroidered on each, surface.py)
            th = np.arctan2(X, -(Y - 0.05) / PELERINE_EY)
            lobe = np.abs(np.sin(th * PELERINE_LOBES / 2))
            edge = 2.95 - 0.1 * lobe ** 0.7
            return np.clip((edge - Z) / 0.012, 0, 1) * 0.1
        F.displace(scallop, band=0.08, region=(np.array((-0.8, -0.6, 2.75)), np.array((0.8, 0.8, 3.0))))
        F.displace(lambda X, Y, Z: 0.006 * np.sin(np.arctan2(X, -(Y - 0.05)) * 24) * np.clip((3.42 - Z) / 0.4, 0, 1)
                   + 0.002 * noise.fbm(X * 24, Y * 24, Z * 24, octaves=2), band=0.03)
    return F


# ------------------------------------------------------------------ hair, brows and beard
HAIR_C = np.array((0.0, 0.015, 3.875))
HAIR_R = np.array((0.152, 0.18, 0.168))


def _scalp(p, lift=0.012):
    """`p` pushed radially from the skull's centre onto the scalp plus `lift`."""
    d = np.asarray(p, float) - HAIR_C
    k = math.sqrt(float(((d / HAIR_R) ** 2).sum()))
    return HAIR_C + d / k + d / np.linalg.norm(d) * lift


def _on_skull(phi, theta):
    return HAIR_C + np.array((HAIR_R[0] * math.sin(phi) * math.cos(theta),
                              -HAIR_R[1] * math.cos(phi) * math.cos(theta), HAIR_R[2] * math.sin(theta)))


def _clump(F, pts, radii, z_head=3.66, z_body=3.42, k=0.009):
    """A clump of hair along `pts`: the segments above `z_head` ride the Head, those
    below `z_body` lie on the shoulders (Spine2), the ones between the Neck, so the
    sculpt's own weights blend them. Tapered by `radii`."""
    pts = [np.asarray(p, float) for p in pts]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        z = 0.5 * (a[2] + b[2])
        tag = 'Head' if z >= z_head else ('Neck' if z >= z_body else 'Spine2')
        F.add(RoundCone(a, b, radii[i], radii[i + 1], bone=tag), k)


def build_hair(voxel=0.004, detail=True, seed=21):
    """Long white hair swept back off a high, receding brow and falling in heavy
    clumps over the cape behind and in front of the shoulders; bushy brows with
    drooping ends; a long beard from the jaw to the breast, the moustache falling
    into it. Lower clumps lie on the cape (they ride Spine2), so a lifted chin
    stretches them rather than swinging them through the cloth."""
    F = Field((-0.56, -0.5, 2.8), (0.56, 0.6, 4.1), voxel)
    noise = Noise(seed)
    rng = np.random.default_rng(seed)
    # the swept-back crown: from the hairline over the skull to the nape, then
    # down over the cape's back
    for i in range(24):
        f = i / 23
        phi = math.radians(-78 + 156 * f) + rng.normal(0, 0.03)
        th_h = math.radians(52 - 40 * (abs(math.degrees(phi)) / 80) ** 1.6)
        root = _on_skull(phi, th_h)
        x0 = root[0]
        crown = [_scalp(root, -0.004)]
        for t in (0.25, 0.5, 0.75):
            q = root + (np.array((x0 * 1.05, 0.2, 3.88)) - root) * t + np.array((0, 0, 0.1 * math.sin(math.pi * t)))
            crown.append(_scalp(q, 0.016 + 0.006 * t))
        nape = _scalp(np.array((x0 * 1.15, 0.2, 3.72)), 0.022)
        th = math.pi - (x0 / 0.15) * 0.95 + rng.normal(0, 0.04)
        r = rng.uniform(0.034, 0.041)
        ln = rng.uniform(0.0, 0.1)
        tail = [nape, np.array((x0 * 1.25, 0.25, 3.58))] + [on_pelerine(th, z, r * 0.7) for z in (3.42, 3.27, 3.12)]
        end = on_pelerine(th, 2.97, r * 0.7)
        tail += [end, end + np.array((0, 0, -0.08 - ln))]
        _clump(F, crown + tail, [r * 0.45, r * 0.85, r, r, r, r * 1.05, r * 1.05, r, r * 0.9, r * 0.6, r * 0.15],
               k=0.022)
    # the side locks: from above the ears, falling past them, two forward over the
    # cape in front of each shoulder and the rest behind
    for s in (1, -1):
        for j in range(7):
            phi = math.radians(76 + 30 * j / 6) * s
            root = _on_skull(phi, math.radians(16 - 12 * j / 6))
            p1 = _scalp(root + np.array((0.0, 0.01, -0.06)), 0.02)
            # heavy locks that merge into one mass (thin ones read as tubes)
            r = rng.uniform(0.038, 0.046)
            if j < 2:
                th = math.radians(32 + 10 * j) * s
                mid = np.array((0.165 * s, -0.04 + 0.02 * j, 3.58))
            else:
                th = math.radians(70 + 14 * (j - 2)) * s
                mid = np.array((0.17 * s, 0.05 + 0.03 * j, 3.58))
            pts = [_scalp(root, 0.01), p1, mid] + [on_pelerine(th, z, r * 0.7) for z in (3.4, 3.24, 3.08)]
            end = on_pelerine(th, 2.96 + 0.02 * (j % 3), r * 0.7)
            pts += [end, end + np.array((0, 0, -0.06))]
            _clump(F, pts, [r * 0.6, r * 0.9, r, r * 1.05, r * 1.05, r * 0.95, r * 0.65, r * 0.12], k=0.028)
    # brows: bushy, drooping at the outer ends
    for s in (1, -1):
        for j in range(4):
            dz = 0.004 * (j - 1.5)
            pts = [_m((0.018, -0.176, 3.9 + dz), s), _m((0.06, -0.176, 3.912 + dz), s),
                   _m((0.105, -0.158, 3.902 + dz), s), _m((0.138, -0.14, 3.872 + dz * 2), s)]
            F.add(Polyline(pts, [0.008, 0.012, 0.01, 0.004], bone='Head'), 0.006)
    # the moustache: two heavy drooping wings from under the nose into the beard
    for s in (1, -1):
        for j in range(3):
            o = 0.006 * j
            pts = [_m((0.004, -0.216, 3.735 - o), s), _m((0.034, -0.216, 3.716 - o), s),
                   _m((0.064, -0.2, 3.676 - o), s), _m((0.074, -0.196, 3.6 - o), s)]
            F.add(Polyline(pts, [0.009, 0.016, 0.015, 0.008], bone='Jaw' if j else 'Head'), 0.01)
    # the chin's beard under the lip (a singer's mouth shows above it)
    for x in (-0.03, 0.0, 0.03):
        F.add(Polyline([(x, -0.19, 3.665), (x * 1.2, -0.21, 3.6), (x * 1.1, -0.23, 3.5)], [0.016, 0.024, 0.026],
                       bone='Jaw'), 0.012)
    # the beard: clumps from the jaw line and the chin, flowing down over the
    # throat onto the cape's breast and gathering to a long soft point
    for i in range(15):
        f = i / 14
        a = math.radians(-82 + 164 * f)
        root = np.array((0.112 * math.sin(a), -0.03 - 0.15 * math.cos(a), 3.72 - 0.1 * math.cos(a) ** 2))
        mid1 = np.array((0.105 * math.sin(a), -0.08 - 0.13 * math.cos(a), 3.58 - 0.02 * math.cos(a)))
        conv = 0.55 * math.sin(a)
        sw = rng.normal(0, 0.01)
        tip_z = 3.0 + 0.24 * abs(math.sin(a)) ** 1.5 + rng.uniform(-0.02, 0.03)
        r = rng.uniform(0.036, 0.045)
        pts = [root, mid1,
               np.array((0.105 * math.sin(a) + sw, -0.2 - 0.04 * math.cos(a), 3.46)),
               on_pelerine(conv * 0.5 + sw, 3.3, r * 0.75),
               on_pelerine(conv * 0.3 + sw, tip_z + 0.1, r * 0.6),
               on_pelerine(conv * 0.15, tip_z, r * 0.3)]
        _clump(F, pts, [r * 0.8, r, r * 1.1, r * 0.95, r * 0.55, r * 0.12], z_head=3.6, z_body=3.38, k=0.02)
    if detail:
        # strands: fine creases down the hanging hair and the beard, and back
        # along the swept crown
        def strands(X, Y, Z):
            hang = -0.0045 * noise.ridged(X * 150, Y * 150, Z * 9, octaves=2)
            crown = (-0.006 * noise.ridged(X * 150, Y * 9, Z * 150, octaves=2)
                     - 0.006 * noise.ridged(X * 45 + 5, Y * 4, Z * 45, octaves=1))
            w = np.clip((Z - 3.72) / 0.08, 0, 1) * np.clip((0.12 - Y) / 0.1, 0, 1)
            return hang * (1 - w) + crown * w
        F.displace(strands, band=0.02)
    return F
