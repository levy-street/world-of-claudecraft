# Old Thatchgrin's clip set (shared by his strawlings): every clip keyed on the one rig
# scarecrow.py builds, so the boss and his adds share their motion and nothing drifts.
#
# Poses are authored in ARMATURE space and converted to each bone's local frame, so the
# numbers read the way the body moves (the rig faces -Y, its right side is -X):
#   rotation about X  +: an upright bone bows FORWARD, a hanging leg swings BACK
#   rotation about Y  +: an upright bone leans to HIS LEFT (+X), his left arm DROPS,
#                        his right arm LIFTS
#   rotation about Z  +: he turns to HIS LEFT; his left arm swings back, his right forward
# Locations are armature-space offsets in metres at the boss's size (scaled by `s`).
#
# Clips and the frames the game times against (manifest.ts THATCHGRIN clip map):
#   Idle       4.0 s loop  a hanging sway, the hat nodding, the crows shuffling
#   Walk       1.2 s loop  a stiff-legged lurch on his two stakes
#   Run        0.85 s loop the same lurch driven harder
#   Swipe      1.5 s       THE REAP: one flat horizontal sweep. He coils to his right, the
#                          blade trailing low behind him (0.42 s, held to 0.52), whips it
#                          flat across his front at a player's waist (impact 0.66 s),
#                          follows through to his left and settles (1.5 s)
#   Chop       1.7 s       THE SLAM: one overhead blow. He rises on his stakes with the
#                          scythe high behind his head (0.5 s, hangs to 0.62), drives it
#                          down into the ground in front of him (impact 0.78 s), holds it
#                          buried, wrenches it free and settles (1.7 s)
#   Throw      2.2 s       pluck a gourd off his shoulder, wind, hurl (release 1.0 s): the
#                          Kindled Gourd's whole windup, so he is upright as it lands
#   Summon     2.0 s       arms flung wide, head thrown back, the crows burst off him and
#                          settle (peak 1.4 s, when the call lands)
#   Hit        0.45 s      a jolt back
#   Death      3.2 s       sags, the stakes fold, the body slumps into the stubble, the head
#                          rolls off, the hat falls, the scythe drops; the crows fly off
import math

import bpy
from mathutils import Euler, Quaternion, Vector

# Every clip is keyed in SECONDS and sampled at 30 fps (the model pipeline's rate); the two
# attacks were re-authored at it (owner note, 2026-10-17), the rest only resampled.
FPS = 30

EASE = {
    "auto": ("BEZIER", "AUTO"),
    "in": ("CUBIC", "EASE_IN"),
    "out": ("CUBIC", "EASE_OUT"),
    "inout": ("SINE", "EASE_IN_OUT"),
    "backout": ("BACK", "EASE_OUT"),
    "linear": ("LINEAR", "AUTO"),
}


def prefix(boss):
    return "Thatchgrin|" if boss else "Strawling|"


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


def arm_quat(rot):
    """(x, y, z) degrees as an XYZ Euler, or a list of (axis, degrees) applied in order."""
    if isinstance(rot, list):
        q = Quaternion()
        axes = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}
        for axis, deg in rot:
            q = Quaternion(axes[axis], math.radians(deg)) @ q
        return q
    rx, ry, rz = rot
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_quaternion()


class Pose(dict):
    """bone -> {'r': (x, y, z) degrees, 'l': (x, y, z) metres, 's': scale,
    'a': (x, y, z) degrees}. 'a' is an ABSOLUTE armature-space turn from the bone's rest
    orientation, whatever its parents do (the scythe hand: the blade keeps its line)."""

    def set(self, bone, r=None, l=None, s=None, a=None):
        d = self.setdefault(bone, {})
        if a is not None:
            d["a"] = a
        if r is not None:
            old = d.get("r", (0, 0, 0))
            d["r"] = (old[0] + r[0], old[1] + r[1], old[2] + r[2])
        if l is not None:
            old = d.get("l", (0, 0, 0))
            d["l"] = (old[0] + l[0], old[1] + l[1], old[2] + l[2])
        if s is not None:
            d["s"] = s
        return self

    def copy(self):
        out = Pose()
        for k, v in self.items():
            out[k] = dict(v)
        return out


def make_clip(arm, name, keys, s):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    last = {}
    ease_at = {}
    for t, pose, ease in keys:
        f = 1.0 + t * FPS
        ease_at[round(f, 4)] = ease
        absolute = []
        for pb in arm.pose.bones:
            spec = pose.get(pb.name, {})
            m3 = pb.bone.matrix_local.to_3x3()
            mq = m3.to_quaternion()
            qa = arm_quat(spec.get("r", (0, 0, 0)))
            q = mq.inverted() @ qa @ mq
            pb.rotation_quaternion = q
            loc = Vector(spec.get("l", (0, 0, 0))) * s
            pb.location = m3.inverted() @ loc
            sc = spec.get("s", 1.0)
            pb.scale = sc if isinstance(sc, tuple) else (sc, sc, sc)
            if "a" in spec:
                absolute.append((pb, spec["a"]))
        if absolute:
            bpy.context.view_layer.update()
            for pb, a in absolute:
                mq = pb.bone.matrix_local.to_quaternion()
                target = arm_quat(a) @ mq
                parent_posed = pb.parent.matrix.to_quaternion()
                rel = pb.parent.bone.matrix_local.to_quaternion().inverted() @ mq
                pb.rotation_quaternion = (parent_posed @ rel).inverted() @ target
        for pb in arm.pose.bones:
            q = pb.rotation_quaternion.copy()
            prev = last.get(pb.name)
            if prev is not None and prev.dot(q) < 0:
                q.negate()
                pb.rotation_quaternion = q
            last[pb.name] = q
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("scale", frame=f)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            interp, easing = EASE[ease_at.get(round(kp.co[0], 4), "auto")]
            kp.interpolation = interp
            kp.easing = easing
            kp.handle_left_type = "AUTO_CLAMPED"
            kp.handle_right_type = "AUTO_CLAMPED"
        fc.update()
    act["duration"] = max(t for t, _, _ in keys)
    return act


# ---------------------------------------------------------------------------
# building blocks
# ---------------------------------------------------------------------------

CROW_NAMES = ("Crow1", "Crow2", "Crow3")

# The scythe's line (the right hand's ABSOLUTE turn, see Pose): upright at rest, the
# blade spun flat and swept low across his front for the reap, raised and driven down
# for the chop.
SCYTHE_UP = [("Y", 6)]


def scythe_reap(yaw):
    return [("Z", 90), ("X", 72), ("Z", yaw)]


def rest_pose():
    """His standing rest: the T of a scarecrow slumped into a hang. Arms droop from the
    yoke, the elbows sag, the head lolls a touch to his right, the knees soft."""
    p = Pose()
    p.set("L_UpperArm", r=(0, 34, 6))
    p.set("L_Forearm", r=(0, 16, -8))
    p.set("L_Hand", r=(0, 20, 0))
    p.set("R_UpperArm", r=(0, -30, -10))
    p.set("R_Forearm", r=(0, -12, -14))
    p.set("R_Hand", a=SCYTHE_UP)
    p.set("Spine", r=(5, 0, 0))
    p.set("Chest", r=(6, 0, 0))
    p.set("Neck", r=(4, -6, 0))
    p.set("Head", r=(6, -8, 3))
    p.set("L_Thigh", r=(-4, 2, 0))
    p.set("L_Shin", r=(6, 0, 0))
    p.set("R_Thigh", r=(-4, -2, 0))
    p.set("R_Shin", r=(6, 0, 0))
    p.set("Coat_B", r=(-4, 0, 0))
    return p


def crows(p, t, energy=1.0):
    """The perched crows' small life: bobbing, a look round, a wing hitch now and then.
    `t` in seconds, periodic in the 4 s idle so the loop closes."""
    for i, c in enumerate(CROW_NAMES):
        ph = t / 4.0 * math.tau + i * 2.1
        p.set(c, l=(0, 0, 0.012 * energy * math.sin(ph * 2)))
        p.set(c + "_Head", r=(10 * math.sin(ph * 3 + i), 0, 35 * energy * math.sin(ph + i * 0.7)))
        hitch = max(0.0, math.sin(ph * 2 + i)) ** 6
        p.set(c + "_WingL", r=(0, -25 * hitch * energy, 0))
        p.set(c + "_WingR", r=(0, 25 * hitch * energy, 0))
    return p


def flap(p, amount, lift=0.0, out=0.0):
    """Every crow's wings beating (amount -1..1) and the body rising off its perch."""
    for i, c in enumerate(CROW_NAMES):
        p.set(c + "_WingL", r=(0, -70 * amount, 0))
        p.set(c + "_WingR", r=(0, 70 * amount, 0))
        dx = (0.5 if i != 1 else 0.2) * out
        p.set(c, l=(dx, -0.2 * out, lift * (1.0 + 0.3 * i)))
    return p


def scythe_rest(p):
    return p


# ---------------------------------------------------------------------------
# the clips
# ---------------------------------------------------------------------------


def idle_keys():
    keys = []
    for k in range(9):
        t = k * 0.5
        ph = t / 4.0 * math.tau
        p = rest_pose()
        sway = math.sin(ph)
        p.set("Hips", r=(0, 3 * sway, 2 * math.sin(ph * 2)), l=(0.03 * sway, 0, 0.015 * math.sin(ph * 2)))
        p.set("Spine", r=(1.5 * math.sin(ph * 2), -2 * sway, 0))
        p.set("Chest", r=(0, -2.5 * sway, 2 * math.sin(ph)))
        p.set("Head", r=(4 * math.sin(ph * 2 + 1), 3 * math.sin(ph + 0.6), 5 * math.sin(ph * 0.5 + 0.3)))
        p.set("Hat", r=(5 * math.sin(ph * 2 + 1.5), 4 * math.sin(ph + 1), 0))
        # arms hanging off the yoke swing a beat behind the body
        p.set("L_UpperArm", r=(3 * math.sin(ph - 0.8), 4 * math.sin(ph - 0.9), 0))
        p.set("L_Forearm", r=(4 * math.sin(ph - 1.4), 3 * math.sin(ph - 1.3), 0))
        p.set("R_UpperArm", r=(3 * math.sin(ph - 0.8), 4 * math.sin(ph - 0.9), 0))
        p.set("R_Forearm", r=(3 * math.sin(ph - 1.4), 2 * math.sin(ph - 1.3), 0))
        for c, a in (("Coat_B", 0), ("Coat_L", 1.3), ("Coat_R", 2.5)):
            p.set(c, r=(5 * math.sin(ph * 2 + a), 3 * math.sin(ph + a), 0))
        crows(p, t)
        keys.append((t, p, "auto"))
    return keys


def gait_keys(period, swing, bob, lean):
    keys = []
    n = 8
    for k in range(n + 1):
        t = period * k / n
        ph = k / n * math.tau
        p = rest_pose()
        leg = math.sin(ph)
        # stake legs: big hip swing, the shin barely bends, a hitch on the passing leg
        p.set("L_Thigh", r=(-swing * leg, 0, 0))
        p.set("R_Thigh", r=(swing * leg, 0, 0))
        p.set("L_Shin", r=(swing * 0.45 * max(0.0, -math.cos(ph)), 0, 0))
        p.set("R_Shin", r=(swing * 0.45 * max(0.0, math.cos(ph)), 0, 0))
        p.set("L_Foot", r=(-10 * leg, 0, 0))
        p.set("R_Foot", r=(10 * leg, 0, 0))
        # the lurch: the hips rise over each planted stake and roll toward it
        p.set("Hips", r=(lean * 0.4, 5 * leg, -6 * leg), l=(0.05 * leg, 0, bob * abs(math.cos(ph)) - bob * 0.5))
        p.set("Spine", r=(lean * 0.5, -3 * leg, 4 * leg))
        p.set("Chest", r=(lean * 0.3 + 3 * math.sin(ph * 2), -2 * leg, 5 * leg))
        p.set("Head", r=(-lean * 0.6 + 5 * math.sin(ph * 2 + 0.6), 6 * leg, -4 * leg))
        p.set("Hat", r=(8 * math.sin(ph * 2 + 1.2), 6 * math.sin(ph + 0.8), 0))
        # loose arms swing opposite the legs, flopping at the elbow a beat late
        p.set("L_UpperArm", r=(0, 0, 18 * leg * swing / 22))
        p.set("L_Forearm", r=(0, 6 * math.sin(ph - 1.0), 12 * math.sin(ph - 0.9)))
        p.set("R_UpperArm", r=(0, 0, 14 * leg * swing / 22))
        p.set("R_Forearm", r=(0, -4 * math.sin(ph - 1.0), 8 * math.sin(ph - 0.9)))
        for c, a in (("Coat_B", 0.5), ("Coat_L", 1.5), ("Coat_R", 2.6)):
            p.set(c, r=(-10 - 8 * math.sin(ph * 2 + a), 6 * math.sin(ph + a), 0))
        crows(p, t * (4.0 / period) / 4.0 * 4.0, energy=1.4)
        keys.append((t, p, "auto"))
    return keys


def reap_line(yaw, dip):
    """The scythe flat for the reap: haft pointing ahead and DOWN by `dip` degrees, the
    blade lying horizontal and leading the sweep (to his left), turned about the vertical
    by `yaw` (negative: round to his right and behind)."""
    return [("Z", 90), ("X", 90 + dip), ("Z", yaw)]


def swipe_keys():
    """THE REAP. One idea: a single flat horizontal sweep at a player's waist, right to left.
    Anticipation coils him to his right with the blade trailing low behind; the strike whips
    the torso through and the blade across his whole front; the follow-through carries it
    round to his left; the recovery settles him back to rest. Arm turns are RELATIVE to the
    torso, so a twisted chest carries the arm round with it."""
    base = rest_pose()
    crows(base, 0.0)
    # anticipation: coiled right (60 degrees through hips, spine and chest), crouched, the
    # scythe trailing low behind his right hip, the free arm thrown across for balance, the
    # head turned back toward the sweep's path
    coil = base.copy()
    coil.set("Hips", r=(2, 0, -16), l=(0.04, 0.1, -0.2))
    coil.set("Spine", r=(0, -4, -22)).set("Chest", r=(-4, -8, -32)).set("Neck", r=(0, 0, 12)).set("Head", r=(-2, 4, 26))
    coil.set("R_UpperArm", r=(0, 14, 70)).set("R_Forearm", r=(0, 14, 26)).set("R_Hand", a=reap_line(-142, -22))
    coil.set("L_UpperArm", r=(0, -24, -48)).set("L_Forearm", r=(0, -6, -34))
    coil.set("R_Thigh", r=(-14, 0, 0)).set("R_Shin", r=(24, 0, 0))
    coil.set("L_Thigh", r=(10, 0, 0)).set("L_Shin", r=(14, 0, 0))
    coil.set("Coat_B", r=(-6, 6, 0)).set("Coat_L", r=(-6, 0, 0)).set("Coat_R", r=(-12, 0, 0))
    # the tension hold: a touch more coil, so the release reads as a release
    hold = coil.copy()
    hold.set("Chest", r=(-2, 0, -7)).set("Spine", r=(0, 0, -3)).set("R_Hand", a=reap_line(-150, -26))
    hold.set("Hips", l=(0, 0, -0.03))
    # impact: whipped through to his left, the blade dead ahead and flat at a player's waist
    strike = base.copy()
    strike.set("Hips", r=(6, 0, 12), l=(0, -0.12, -0.26))
    strike.set("Spine", r=(6, 2, 14)).set("Chest", r=(10, 3, 22)).set("Neck", r=(2, 0, -6)).set("Head", r=(6, 0, -12))
    strike.set("R_UpperArm", r=(0, -30, 52)).set("R_Forearm", r=(0, -4, 16)).set("R_Hand", a=reap_line(-4, 10))
    strike.set("L_UpperArm", r=(0, -16, 30)).set("L_Forearm", r=(0, -4, 22))
    strike.set("L_Thigh", r=(-22, 0, 0)).set("L_Shin", r=(28, 0, 0))
    strike.set("R_Thigh", r=(14, 0, 0)).set("R_Shin", r=(16, 0, 0))
    strike.set("Coat_B", r=(-14, -8, 0)).set("Coat_L", r=(-10, 0, 0)).set("Coat_R", r=(4, 0, 0))
    # follow-through: carried round to his left and behind, over-rotated, the coat swinging
    follow = strike.copy()
    follow.set("Hips", r=(0, 0, 6)).set("Spine", r=(0, 0, 6)).set("Chest", r=(-4, 0, 8))
    follow.set("R_UpperArm", r=(0, 6, 8)).set("R_Forearm", r=(0, 2, 6)).set("R_Hand", a=reap_line(82, 16))
    follow.set("Head", r=(-4, 0, -8))
    follow.set("Coat_B", r=(6, -10, 0)).set("Coat_R", r=(-8, 0, 0))
    # settle: the weight comes back over the stakes, the blade swinging home upright
    settle = base.copy()
    settle.set("Hips", r=(3, 0, 5), l=(0, -0.04, -0.08)).set("Chest", r=(5, 0, 8)).set("Spine", r=(2, 0, 4))
    settle.set("R_UpperArm", r=(0, -4, 10)).set("R_Hand", a=[("Y", 10), ("Z", 20)])
    return [(0.0, base, "inout"), (0.42, coil, "out"), (0.52, hold, "in"), (0.66, strike, "linear"),
            (0.84, follow, "out"), (1.1, settle, "inout"), (1.5, base, "auto")]


def slam_line(pitch):
    """The scythe in the slam, turned about his shoulders' axis by `pitch` degrees: negative
    tips the haft back over his head with the blade curling forward above it (the reaper's
    raised scythe); about +95 lays the haft out ahead with the blade driven straight down."""
    return [("X", pitch)]


def chop_keys():
    """THE SLAM. One idea: a single overhead blow driven into the ground in front of him.
    Anticipation lifts him tall on his stakes with the scythe raised high over his head, the
    blade curling forward above it; the strike crunches him down and buries the blade in
    the ground ahead; he holds it there a beat, wrenches it free, and settles back to rest.
    Arm turns are totals over his rest pose (rest_pose), so they read as targets."""
    base = rest_pose()
    crows(base, 1.0)
    # anticipation: up on his stakes, chest arched back, both arms raising the scythe high
    # over his head, the blade curled forward above him
    rise = base.copy()
    rise.set("Hips", r=(-6, 0, 0), l=(0, 0.06, 0.14))
    rise.set("Spine", r=(-10, 0, 0)).set("Chest", r=(-18, 0, 0)).set("Neck", r=(-6, 0, 0)).set("Head", r=(-14, 0, 0)).set("Hat", r=(-8, 0, 0))
    rise.set("R_UpperArm", r=(0, 110, -35)).set("R_Forearm", r=(0, 12, 14)).set("R_Hand", a=slam_line(-38))
    rise.set("L_UpperArm", r=(0, -114, 39)).set("L_Forearm", r=(0, -16, 8)).set("L_Hand", r=(0, -20, 0))
    rise.set("L_Thigh", r=(4, 0, 0)).set("R_Thigh", r=(4, 0, 0))
    rise.set("Coat_B", r=(8, 0, 0)).set("Coat_L", r=(4, 0, 0)).set("Coat_R", r=(4, 0, 0))
    # the hang at the top: a breath more arch and reach, then the drop
    top = rise.copy()
    top.set("Chest", r=(-5, 0, 0)).set("Spine", r=(-2, 0, 0)).set("R_Hand", a=slam_line(-50)).set("Hips", l=(0, 0, 0.04))
    # impact: crunched forward over the blow, knees driven down, both arms thrown down ahead,
    # the blade buried in the ground in front of him
    slam = base.copy()
    slam.set("Hips", r=(14, 0, 0), l=(0, -0.16, -0.42))
    slam.set("Spine", r=(12, 0, 0)).set("Chest", r=(20, 0, 0)).set("Neck", r=(4, 0, 0)).set("Head", r=(8, 0, 0)).set("Hat", r=(10, 0, 0))
    slam.set("R_UpperArm", r=(0, -24, 108)).set("R_Forearm", r=(0, 12, 24)).set("R_Hand", a=slam_line(122))
    slam.set("L_UpperArm", r=(0, 20, -104)).set("L_Forearm", r=(0, -16, -14))
    slam.set("L_Thigh", r=(-30, 0, 0)).set("L_Shin", r=(40, 0, 0))
    slam.set("R_Thigh", r=(-12, 0, 0)).set("R_Shin", r=(30, 0, 0))
    slam.set("Coat_B", r=(-20, 0, 0)).set("Coat_L", r=(-12, 0, 0)).set("Coat_R", r=(-12, 0, 0))
    # held buried, a shudder through him
    stuck = slam.copy()
    stuck.set("Chest", r=(-3, 0, 2)).set("Hips", l=(0, 0, 0.02))
    # the wrench: he hauls it out, leaning back, the blade coming up out of the ground
    wrench = base.copy()
    wrench.set("Hips", r=(4, 0, 0), l=(0, -0.06, -0.2)).set("Chest", r=(-6, 0, 0)).set("Spine", r=(2, 0, 0))
    wrench.set("R_UpperArm", r=(0, -10, 60)).set("R_Forearm", r=(0, 6, 10)).set("R_Hand", a=slam_line(40))
    wrench.set("L_UpperArm", r=(0, 10, -56)).set("L_Forearm", r=(0, -8, 6))
    return [(0.0, base, "inout"), (0.5, rise, "out"), (0.62, top, "in"), (0.78, slam, "out"),
            (1.0, stuck, "inout"), (1.22, wrench, "inout"), (1.7, base, "auto")]


def throw_keys():
    """Pluck a gourd off his left shoulder, wind it back over his head, hurl it: release at
    1.0 s (the renderer launches the gourd from his left hand then)."""
    base = rest_pose()
    crows(base, 2.0)
    reach = base.copy()
    reach.set("L_UpperArm", r=(0, -55, -40)).set("L_Forearm", r=(0, -80, -20)).set("L_Hand", r=(0, -30, 0))
    reach.set("Chest", r=(0, 8, 12)).set("Head", r=(0, 12, 20))
    wind = base.copy()
    wind.set("L_UpperArm", r=(0, -85, 35)).set("L_Forearm", r=(0, -40, 40)).set("L_Hand", r=(0, -10, 20))
    wind.set("Chest", r=(-14, 6, 28)).set("Spine", r=(-6, 0, 12)).set("Head", r=(-8, 0, 10))
    wind.set("R_UpperArm", r=(0, 10, -20)).set("L_Thigh", r=(10, 0, 0)).set("R_Thigh", r=(-12, 0, 0))
    release = base.copy()
    release.set("L_UpperArm", r=(0, -30, -60)).set("L_Forearm", r=(0, -6, -30)).set("L_Hand", r=(0, 10, -20))
    release.set("Chest", r=(22, -4, -26)).set("Spine", r=(10, 0, -12)).set("Head", r=(10, 0, -14))
    release.set("R_UpperArm", r=(0, -10, 25)).set("L_Thigh", r=(-16, 0, 0)).set("R_Thigh", r=(8, 0, 0))
    release.set("Hips", l=(0, -0.08, -0.06))
    follow = release.copy()
    follow.set("Chest", r=(6, 0, -6)).set("L_UpperArm", r=(0, 20, -10))
    for p in (reach, wind, release, follow):
        p.set("Coat_B", r=(-10, 0, 0))
    return [(0.0, base, "inout"), (0.45, reach, "inout"), (0.85, wind, "in"), (1.0, release, "out"),
            (1.5, follow, "inout"), (2.2, base, "auto")]


def summon_keys():
    """Arms gathered in, then flung wide and high, head thrown back: the crows burst off
    him and wheel back down (peak at 1.4 s, when the call lands)."""
    base = rest_pose()
    crows(base, 3.0)
    gather = base.copy()
    gather.set("Chest", r=(24, 0, 0)).set("Spine", r=(10, 0, 0)).set("Head", r=(16, 0, 0))
    gather.set("L_UpperArm", r=(-20, 30, -40)).set("L_Forearm", r=(0, 10, -50))
    gather.set("R_UpperArm", r=(-20, -30, 40)).set("R_Forearm", r=(0, -10, 50))
    gather.set("Hips", l=(0, 0, -0.18)).set("L_Shin", r=(20, 0, 0)).set("R_Shin", r=(20, 0, 0))
    gather.set("L_Thigh", r=(-14, 0, 0)).set("R_Thigh", r=(-14, 0, 0))
    flap(gather, 0.3, 0.0)
    fling = base.copy()
    fling.set("Chest", r=(-22, 0, 0)).set("Spine", r=(-10, 0, 0)).set("Head", r=(-28, 0, 0)).set("Hat", r=(-15, 0, 0))
    fling.set("L_UpperArm", r=(0, -62, 0)).set("L_Forearm", r=(0, -20, 0)).set("L_Hand", r=(0, -20, 0))
    fling.set("R_UpperArm", r=(0, 58, 0)).set("R_Forearm", r=(0, 18, 0))
    fling.set("Hips", l=(0, 0, 0.1)).set("R_Hand", a=[("Y", 25)])
    keys = [(0.0, base, "inout"), (0.5, gather, "in")]
    # the burst: the crows beat up off him and wheel back down to their perches
    for k, t in enumerate((0.75, 0.95, 1.15, 1.4, 1.6, 1.8)):
        p = fling.copy()
        beat = 1.0 if k % 2 == 0 else -0.6
        rise = [0.6, 1.2, 1.6, 1.5, 0.9, 0.3][k]
        flap(p, beat, rise, rise * 0.6)
        keys.append((t, p, "inout"))
    keys.append((2.0, base, "auto"))
    return keys


def hit_keys():
    base = rest_pose()
    crows(base, 0.5)
    jolt = base.copy()
    jolt.set("Chest", r=(-14, 0, 6)).set("Spine", r=(-6, 0, 0)).set("Head", r=(-18, 6, 0)).set("Hat", r=(-10, 0, 0))
    jolt.set("L_UpperArm", r=(0, -12, 10)).set("R_UpperArm", r=(0, 10, -10))
    flap(jolt, 0.6, 0.15)
    return [(0.0, base, "out"), (0.12, jolt, "out"), (0.45, base, "auto")]


def death_keys():
    """He sags, his stakes fold, he slumps into a heap of straw; the head rolls off to his
    right, the hat tumbles, the scythe drops and the crows fly off."""
    base = rest_pose()
    crows(base, 0.0)
    sag = base.copy()
    sag.set("Chest", r=(-12, 0, 8)).set("Head", r=(-22, -10, 0)).set("Hips", l=(0, 0, -0.1))
    sag.set("L_UpperArm", r=(0, -30, 0)).set("R_UpperArm", r=(0, 30, 0))
    flap(sag, 1.0, 0.4, 0.4)
    fold = base.copy()
    fold.set("Hips", r=(30, 0, 10), l=(0, -0.2, -1.05))
    fold.set("L_Thigh", r=(-80, 10, 0)).set("R_Thigh", r=(-70, -14, 0))
    fold.set("L_Shin", r=(110, 0, 0)).set("R_Shin", r=(100, 0, 0))
    fold.set("Spine", r=(26, 0, 0)).set("Chest", r=(24, 0, -10), s=(1.0, 0.85, 0.9))
    fold.set("Head", r=(30, -30, 0)).set("Hat", r=(20, -20, 0))
    fold.set("L_UpperArm", r=(0, 40, 20)).set("R_UpperArm", r=(0, -40, -20))
    fold.set("R_Hand", a=[("Y", -55), ("Z", 10)])
    flap(fold, -0.6, 1.6, 1.4)
    heap = base.copy()
    heap.set("Hips", r=(70, 0, 16), l=(0, -0.3, -1.7))
    heap.set("L_Thigh", r=(-80, 30, 0)).set("R_Thigh", r=(-70, -40, 0))
    heap.set("L_Shin", r=(60, 0, 0)).set("R_Shin", r=(50, 0, 0))
    heap.set("Spine", r=(14, 0, 0), s=(1.05, 0.75, 1.1)).set("Chest", r=(10, 0, -14), s=(1.1, 0.7, 1.1))
    heap.set("Neck", r=(30, 0, 0))
    # the head comes loose and rolls off to his right, face up
    heap.set("Head", r=(-60, -70, 40), l=(-0.9, -0.6, -1.25))
    heap.set("Hat", r=(70, -40, 0))
    heap.set("L_UpperArm", r=(0, 70, 30)).set("L_Forearm", r=(0, 20, 0))
    heap.set("R_UpperArm", r=(0, -70, -40)).set("R_Forearm", r=(0, -20, 0)).set("R_Hand", a=[("Y", -95), ("Z", 25)])
    for c in ("Coat_B", "Coat_L", "Coat_R"):
        heap.set(c, r=(-40, 0, 0))
    flap(heap, 1.0, 4.0, 4.0)
    for c in CROW_NAMES:
        heap.set(c, s=0.02)
    return [(0.0, base, "inout"), (0.4, sag, "inout"), (1.3, fold, "in"), (1.9, heap, "backout"),
            (3.2, heap, "auto")]


CLIPS = [
    ("Idle", idle_keys),
    ("Walk", lambda: gait_keys(1.2, 22, 0.08, 4)),
    ("Run", lambda: gait_keys(0.85, 30, 0.12, 10)),
    ("Swipe", swipe_keys),
    ("Chop", chop_keys),
    ("Throw", throw_keys),
    ("Summon", summon_keys),
    ("Hit", hit_keys),
    ("Death", death_keys),
]


def build_clips(arm, s, boss):
    for name, fn in CLIPS:
        make_clip(arm, prefix(boss) + name, fn(), s)
    arm.animation_data.action = bpy.data.actions[prefix(boss) + "Idle"]


def prepare_export(arm, boss):
    """Rest pose in the scene and no action assigned: every fake-user action exports."""
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
