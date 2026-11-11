# The Quarryheart Charger's skeleton and its clips, posed in ARMATURE space and keyed as each
# bone's local basis (no Blender constraints, no depsgraph: every matrix is computed here, so the
# build is deterministic and the hooves land exactly where the gait puts them).
#
# Legs are solved with an analytic two-bone IK on a hinge (the leg's own sideways axis): the
# front leg's knee and the hind leg's hock both bend the way a horse's do, and the hoof is held
# flat to the ground through the stance and flexes its toe back through the swing. The gait
# numbers (stride, duty, period) are the source of the manifest's walk/run references: a planted
# hoof slides back under the body at exactly stride / (duty * period) yards a second.

import math

from mathutils import Matrix, Vector

FPS = 30

# name, parent, head, tail (Blender Z up, front toward -Y; +X is the charger's LEFT)
BONES = [
    ("root", None, (0, 0, 0), (0, 0, 0.4)),
    ("hips", "root", (0, 0.95, 2.15), (0, 0.2, 2.15)),
    ("spine", "hips", (0, 0.2, 2.15), (0, -0.55, 2.18)),
    ("chest", "spine", (0, -0.55, 2.18), (0, -1.15, 2.28)),
    ("saddle", "spine", (0, -0.12, 2.8), (0, -0.12, 3.05)),
    ("neck1", "chest", (0, -1.12, 2.45), (0, -1.45, 3.08)),
    ("neck2", "neck1", (0, -1.45, 3.08), (0, -1.76, 3.7)),
    ("head", "neck2", (0, -1.76, 3.7), (0, -2.66, 3.3)),
    ("tail1", "hips", (0, 1.52, 2.36), (0, 1.92, 2.24)),
    ("tail2", "tail1", (0, 1.92, 2.24), (0, 2.26, 2.0)),
    ("tail3", "tail2", (0, 2.26, 2.0), (0, 2.5, 1.66)),
]
for side, sx in (("L", 1), ("R", -1)):
    x = 0.42 * sx
    hx = 0.47 * sx
    BONES += [
        (f"upperF.{side}", "chest", (x, -0.9, 1.98), (x, -1.0, 1.16)),
        (f"lowerF.{side}", f"upperF.{side}", (x, -1.0, 1.16), (x, -0.95, 0.32)),
        (f"hoofF.{side}", f"lowerF.{side}", (x, -0.95, 0.32), (x, -0.95, 0.02)),
        (f"thighH.{side}", "hips", (hx, 1.0, 2.2), (hx, 0.78, 1.46)),
        (f"gaskinH.{side}", f"thighH.{side}", (hx, 0.78, 1.46), (hx, 1.15, 0.86)),
        (f"cannonH.{side}", f"gaskinH.{side}", (hx, 1.15, 0.86), (hx, 1.1, 0.32)),
        (f"hoofH.{side}", f"cannonH.{side}", (hx, 1.1, 0.32), (hx, 1.1, 0.02)),
    ]

FETLOCK_Z = 0.32


def V(*a):
    return Vector(a)


def rot_x(a):
    return Matrix.Rotation(a, 4, "X")


def rot_y(a):
    return Matrix.Rotation(a, 4, "Y")


def rot_z(a):
    return Matrix.Rotation(a, 4, "Z")


class Poser:
    """Rest matrices from the armature; pose matrices computed in hierarchy order."""

    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
        self.order = [b.name for b in arm.data.bones]  # parents before children
        self.pose = {}

    def delta(self, name):
        """The bone's deformation (pose @ rest^-1), identity for an unposed root."""
        if name is None:
            return Matrix.Identity(4)
        return self.pose[name] @ self.rest[name].inverted()

    def set_rot(self, name, A, offset=None, pivot=None):
        """Pose `name` as its parent carries it, rotated by A (a rotation in the PARENT'S frame
        of world axes) about its head (or `pivot`, a rest-space point), plus a translation."""
        D = self.rest[name]
        P = self.delta(self.parent[name])
        head = D.to_translation() if pivot is None else Vector(pivot)
        M = Matrix.Translation(head) @ A @ Matrix.Translation(-head) @ D
        if offset is not None:
            M = Matrix.Translation(Vector(offset)) @ M
        self.pose[name] = P @ M

    def carry(self, name):
        self.pose[name] = self.delta(self.parent[name]) @ self.rest[name]

    def set_frame(self, name, head, y_axis, x_hint):
        """Pose a bone by where its head sits and where it points, keeping its twist (x axis) as
        close to `x_hint` as the new direction allows."""
        y = y_axis.normalized()
        x = (x_hint - y * x_hint.dot(y)).normalized()
        z = x.cross(y)
        M = Matrix((
            (x.x, y.x, z.x, head.x),
            (x.y, y.y, z.y, head.y),
            (x.z, y.z, z.z, head.z),
            (0, 0, 0, 1),
        ))
        self.pose[name] = M

    def basis(self, name):
        D = self.rest[name]
        p = self.parent[name]
        if p is None:
            local_rest = D
            parent_pose = Matrix.Identity(4)
        else:
            local_rest = self.rest[p].inverted() @ D
            parent_pose = self.pose[p]
        return (parent_pose @ local_rest).inverted() @ self.pose[name]


def leg_ik(P, upper, lower, hoof, target, bend_hint, hoof_flex, hoof_world=None):
    """Two-bone IK for (upper, lower) reaching `target` with the fetlock, then the hoof below."""
    r_up = P.rest[upper]
    r_lo = P.rest[lower]
    r_hf = P.rest[hoof]
    j0_rest = r_up.to_translation()
    k_rest = r_lo.to_translation()
    f_rest = r_hf.to_translation()
    L1 = (k_rest - j0_rest).length
    L2 = (f_rest - k_rest).length
    pdel = P.delta(P.parent[upper])
    j0 = pdel @ j0_rest
    prot = pdel.to_3x3()
    hinge = (prot @ r_up.to_3x3().col[0]).normalized()
    t = Vector(target) - j0
    d = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, t.length))
    dirT = t.normalized()
    a = math.acos(max(-1.0, min(1.0, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))))
    bend = hinge.cross(dirT).normalized()
    if bend.dot(prot @ Vector(bend_hint)) < 0:
        bend = -bend
    knee = j0 + L1 * (math.cos(a) * dirT + math.sin(a) * bend)
    fet = j0 + dirT * d
    P.set_frame(upper, j0, knee - j0, hinge)
    P.set_frame(lower, knee, fet - knee, hinge)
    # the hoof: its rest orientation in the world, flexed about the hinge
    base = r_hf.to_3x3() if hoof_world is None else hoof_world
    R = Matrix.Rotation(hoof_flex, 3, hinge) @ base
    M = R.to_4x4()
    M.translation = fet
    P.pose[hoof] = M


# ---------------------------------------------------------------------------
# gaits
# ---------------------------------------------------------------------------

LEGS = {
    # leg: (upper, lower, hoof, bend hint: front knees forward, hind hocks back)
    "FL": ("upperF.L", "lowerF.L", "hoofF.L", (0, -1, 0)),
    "FR": ("upperF.R", "lowerF.R", "hoofF.R", (0, -1, 0)),
    "HL": ("gaskinH.L", "cannonH.L", "hoofH.L", (0, 1, 0)),
    "HR": ("gaskinH.R", "cannonH.R", "hoofH.R", (0, 1, 0)),
}


def rest_fetlock(P, leg):
    return P.rest[LEGS[leg][2]].to_translation()


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def foot_cycle(p, duty, stride, lift, reach=0.0):
    """Hoof offset (dy, dz, flex) at cycle phase p: planted and sliding back (+Y) through the
    stance, lifted and carried forward through the swing. `reach` overshoots the swing's front."""
    p %= 1.0
    if p < duty:
        s = p / duty
        return (-stride / 2 + stride * s, 0.0, 0.0)
    s = (p - duty) / (1 - duty)
    e = smooth(s)
    dy = stride / 2 - (stride + reach) * e + reach * smooth((s - 0.75) / 0.25)
    dz = lift * math.sin(math.pi * s) ** 0.8
    flex = 1.15 * math.sin(math.pi * min(1.0, s * 1.15)) ** 1.2
    return (dy, dz, flex)


def pose_frame(P, ctl):
    """Build every bone's pose from one frame of controls."""
    P.pose = {}
    P.carry("root")
    P.set_rot("hips", rot_x(ctl.get("pitch", 0.0)) @ rot_z(ctl.get("yaw", 0.0)) @ rot_y(ctl.get("roll", 0.0)),
              offset=(0, ctl.get("dy", 0.0), ctl.get("dz", 0.0)), pivot=ctl.get("pivot"))
    P.set_rot("spine", rot_x(ctl.get("spine", 0.0)) @ rot_z(ctl.get("spine_yaw", 0.0)))
    P.set_rot("chest", rot_x(ctl.get("chest", 0.0)) @ rot_z(ctl.get("chest_yaw", 0.0)))
    P.carry("saddle")
    P.set_rot("neck1", rot_x(ctl.get("neck1", 0.0)) @ rot_z(ctl.get("neck_yaw", 0.0) * 0.5))
    P.set_rot("neck2", rot_x(ctl.get("neck2", 0.0)) @ rot_z(ctl.get("neck_yaw", 0.0) * 0.5))
    P.set_rot("head", rot_x(ctl.get("head", 0.0)) @ rot_z(ctl.get("head_yaw", 0.0)) @ rot_y(ctl.get("head_tilt", 0.0)))
    for k, name in enumerate(("tail1", "tail2", "tail3")):
        P.set_rot(name, rot_x(ctl.get("tail_pitch", 0.0) * (0.6 + 0.3 * k))
                  @ rot_z(ctl.get("tail_yaw", 0.0) * (0.5 + 0.4 * k)))
    for side in ("L", "R"):
        P.set_rot(f"thighH.{side}", rot_x(ctl.get(f"thigh{side}", 0.0)))
    hips_d = P.delta("hips")
    chest_d = P.delta("chest")
    for leg, (up, lo, hf, hint) in LEGS.items():
        f0 = rest_fetlock(P, leg)
        mode = ctl.get(f"{leg}_mode", "ground")
        dy, dz, flex = ctl.get(leg, (0.0, 0.0, 0.0))
        if mode == "ground":
            target = f0 + Vector((0, dy, dz))
        else:
            # carried with the body (jump tuck, the rear's pawing): offsets in the body's frame
            body = chest_d if leg[0] == "F" else hips_d
            target = body @ (f0 + Vector((0, dy, dz)))
        leg_ik(P, up, lo, hf, target, hint, flex)
        if mode == "body":
            # a tucked hoof follows its leg rather than staying level with the ground
            M = P.pose[lo].copy()
            R = Matrix.Rotation(flex, 3, M.to_3x3().col[0]) @ M.to_3x3() @ P.rest[lo].to_3x3().inverted() @ P.rest[hf].to_3x3()
            Mh = R.to_4x4()
            Mh.translation = P.pose[hf].to_translation()
            P.pose[hf] = Mh
    for name in P.order:
        if name not in P.pose:
            P.carry(name)


def key_frame(P, arm, frame):
    for pb in arm.pose.bones:
        B = P.basis(pb.name)
        loc, rot, _ = B.decompose()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = rot
        pb.location = loc
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)


def fcurves(act):
    out = []
    if hasattr(act, "layers") and len(act.layers) > 0:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
    elif hasattr(act, "fcurves"):
        out.extend(act.fcurves)
    return out


def bake_clip(P, arm, name, seconds, control, prefix="Charger"):
    import bpy

    act = bpy.data.actions.new(f"{prefix}|{name}")
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    n = max(1, round(seconds * FPS))
    for k in range(n + 1):
        t = k / FPS
        pose_frame(P, control(t, k / n))
        key_frame(P, arm, 1 + k)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
        fc.update()
    act["duration"] = seconds
    return act


# ---------------------------------------------------------------------------
# the clips
# ---------------------------------------------------------------------------

# gait tables: (period s, duty, stride yd, lift yd, phase offsets per leg)
WALK = dict(period=1.15, duty=0.64, stride=1.5, lift=0.3,
            phase={"HL": 0.0, "FL": 0.25, "HR": 0.5, "FR": 0.75})
RUN = dict(period=0.62, duty=0.36, stride=2.8, lift=0.5,
           phase={"HL": 0.0, "HR": 0.1, "FL": 0.42, "FR": 0.52})
BACK = dict(period=0.8, duty=0.55, stride=2.4, lift=0.3,
            phase={"HL": 0.0, "FL": 0.25, "HR": 0.5, "FR": 0.75})


def gait_ref(g):
    """Ground speed (yd/s) a planted hoof matches at time scale 1."""
    return g["stride"] / (g["duty"] * g["period"])


def idle_ctl(t, u):
    w = math.tau * u
    c = {
        "dz": 0.018 * math.sin(w * 2),
        "chest": -0.012 * math.sin(w * 2),
        "neck1": 0.03 * math.sin(w + 0.4),
        "neck2": 0.04 * math.sin(w + 0.9),
        "head": 0.06 * math.sin(w + 1.6) - 0.02,
        "neck_yaw": 0.12 * math.sin(w),
        "head_yaw": 0.14 * math.sin(w - 0.5),
        "head_tilt": 0.05 * math.sin(w * 2 + 0.3),
        "tail_pitch": -0.05 + 0.06 * math.sin(w * 2),
        "tail_yaw": 0.18 * math.sin(w + 0.7),
    }
    # one hoof paws the ground in the middle of the idle
    paw = smooth((u - 0.45) / 0.08) * (1 - smooth((u - 0.62) / 0.08))
    swing = math.sin(math.pi * max(0.0, min(1.0, (u - 0.45) / 0.25)))
    c["FL"] = (-0.12 * paw * swing, 0.28 * paw * swing, 0.9 * paw)
    return c


def gait_ctl(g, back=False, run=False):
    def ctl(t, u):
        c = {}
        for leg, ph in g["phase"].items():
            dy, dz, flex = foot_cycle(u + ph, g["duty"], g["stride"], g["lift"],
                                      reach=0.18 if run else 0.06)
            if back:
                dy = -dy
            c[leg] = (dy, dz, flex)
        w = math.tau * u
        if run:
            c["dz"] = 0.11 * math.sin(w * 1 - 0.6) + 0.02
            c["pitch"] = 0.07 * math.sin(w - 1.1)
            c["spine"] = -0.03 * math.sin(w - 0.4)
            c["chest"] = 0.04 * math.sin(w)
            c["neck1"] = -0.16 + 0.08 * math.sin(w + 0.5)
            c["neck2"] = -0.1 + 0.07 * math.sin(w + 1.0)
            c["head"] = 0.18 + 0.08 * math.sin(w + 1.5)
            c["tail_pitch"] = -0.42 + 0.08 * math.sin(w + 1.8)
            c["tail_yaw"] = 0.06 * math.sin(w * 0.5)
            for side, ph in (("L", 0.0), ("R", 0.1)):
                c[f"thigh{side}"] = 0.22 * math.sin(math.tau * (u + ph) - 0.4)
        else:
            c["dz"] = 0.03 * math.cos(w * 2)
            c["roll"] = 0.025 * math.sin(w)
            c["neck1"] = -0.04 + 0.04 * math.sin(w * 2 + 0.6)
            c["neck2"] = 0.03 * math.sin(w * 2 + 1.2)
            c["head"] = 0.04 + 0.05 * math.sin(w * 2 + 1.8)
            c["neck_yaw"] = 0.05 * math.sin(w)
            c["tail_pitch"] = -0.12
            c["tail_yaw"] = 0.14 * math.sin(w + 1.0)
            for side, ph in (("L", 0.0), ("R", 0.5)):
                c[f"thigh{side}"] = (-1 if back else 1) * 0.12 * math.sin(math.tau * (u + ph) - 0.6)
        return c
    return ctl


# the airborne pose the Jump ends on and the Land starts from
AIR = {
    "dz": 0.05, "pitch": -0.1, "neck1": -0.12, "neck2": -0.04, "head": 0.12, "tail_pitch": -0.5,
    "FL": (0.38, 0.62, 1.7), "FR": (0.3, 0.58, 1.6), "FL_mode": "body", "FR_mode": "body",
    "HL": (0.5, 0.42, 0.9), "HR": (0.58, 0.38, 0.85), "HL_mode": "body", "HR_mode": "body",
    "thighL": -0.32, "thighR": -0.36,
}


def lerp_ctl(a, b, s):
    out = {}
    for k in set(a) | set(b):
        va, vb = a.get(k), b.get(k)
        if k.endswith("_mode"):
            out[k] = vb if s >= 0.5 and vb is not None else (va if va is not None else vb)
            continue
        if va is None:
            va = (0.0, 0.0, 0.0) if isinstance(vb, tuple) else 0.0
        if vb is None:
            vb = (0.0, 0.0, 0.0) if isinstance(va, tuple) else 0.0
        if isinstance(va, tuple):
            out[k] = tuple(x + (y - x) * s for x, y in zip(va, vb))
        else:
            out[k] = va + (vb - va) * s
    return out


def jump_ctl(t, u):
    # 0..0.3 the gather (haunches drop, the head comes up), 0.3..1 the spring into the air pose
    gather = {"dz": -0.16, "pitch": -0.12, "neck1": -0.18, "head": 0.1, "tail_pitch": -0.3,
              "thighL": 0.18, "thighR": 0.18, "FL": (0.0, 0.18, 0.4), "FR": (0.0, 0.1, 0.3)}
    if u < 0.3:
        return lerp_ctl({}, gather, smooth(u / 0.3))
    s = smooth((u - 0.3) / 0.55)
    c = lerp_ctl(gather, AIR, s)
    # the legs fold in the body's frame from the start of the spring
    for leg in ("FL", "FR", "HL", "HR"):
        c[f"{leg}_mode"] = "body"
    if s < 0.5:
        for leg in ("HL", "HR"):
            # the hind hooves leave the ground last: keep them in the body frame from the
            # gather pose, which sits where the ground was
            pass
    return c


def land_ctl(t, u):
    # reaching for the ground, the strike at 0.22, the haunches taking it, back to the stance
    reach = dict(AIR)
    reach.update({"FL": (-0.2, 0.25, 0.3), "FR": (-0.1, 0.3, 0.4), "pitch": 0.04})
    if u < 0.22:
        c = lerp_ctl(AIR, reach, smooth(u / 0.22))
        return c
    impact = {"dz": -0.22, "pitch": 0.06, "chest": 0.05, "neck1": 0.1, "head": -0.08,
              "tail_pitch": -0.1, "FL": (-0.12, 0.0, 0.0), "FR": (-0.04, 0.0, 0.0),
              "HL": (0.1, 0.0, 0.0), "HR": (0.16, 0.0, 0.0)}
    if u < 0.45:
        return lerp_ctl(reach, impact, smooth((u - 0.22) / 0.23))
    rest = idle_ctl(0, 0)
    rest.pop("FL", None)
    return lerp_ctl(impact, rest, smooth((u - 0.45) / 0.55))


def rear_ctl(t, u):
    # 1.5 s: rise onto the haunches (0..0.36), paw the air twice, come down hard (0.6..0.72),
    # the impact, then settle into the stance (the renderer cues the ground strike at 0.68)
    up = smooth(u / 0.36) * (1 - smooth((u - 0.58) / 0.14))
    lift = -0.7 * up
    c = {
        "pivot": (0, 1.05, 0.32),
        "pitch": lift,
        "dz": 0.06 * up,
        "spine": 0.05 * up,
        "chest": -0.08 * up,
        "neck1": 0.25 * up,
        "neck2": 0.15 * up,
        "head": -0.25 * up + 0.1 * up * math.sin(math.tau * u * 2),
        "tail_pitch": -0.25 * up + 0.35,
        "thighL": 0.35 * up,
        "thighR": 0.38 * up,
    }
    if up > 0.02:
        for leg, ph in (("FL", 0.0), ("FR", 0.5)):
            paw = math.sin(math.tau * (u * 2.6 + ph))
            c[leg] = (0.32 + 0.3 * paw, 0.55 + 0.25 * paw, 1.2 + 0.4 * paw)
            c[f"{leg}_mode"] = "body"
            # blend the tuck in and out with the rise
            c[leg] = tuple(v * up for v in c[leg])
    # the strike: haunches drop as the front comes down
    hit = smooth((u - 0.68) / 0.06) * (1 - smooth((u - 0.76) / 0.24))
    c["dz"] += -0.2 * hit
    c["head"] += -0.12 * hit
    c["neck1"] += 0.1 * hit
    return c


CLIPS = [
    ("Idle", 4.0, idle_ctl),
    ("Walk", WALK["period"], gait_ctl(WALK)),
    ("Run", RUN["period"], gait_ctl(RUN, run=True)),
    ("WalkBack", BACK["period"], gait_ctl(BACK, back=True)),
    ("Jump", 0.5, jump_ctl),
    ("Land", 0.55, land_ctl),
    ("Rear", 1.5, rear_ctl),
]
