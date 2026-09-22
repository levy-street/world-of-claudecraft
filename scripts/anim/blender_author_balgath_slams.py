# Balgath's two AIMED slams, authored in Blender: the whack-a-mole hammer and the low cleave.
#
# This is the `blender-anim-pipeline` skill's TECHNIQUE 2, and the escalation test is met
# twice over. The eight Tripo preset clips the creature lane retargets onto this rig carry
# no horizontal swing at all and no one-armed gesture of any kind, so neither of these
# silhouettes can be sampled out of donor poses. The pose-blend versions they replace were
# honest approximations built by masking half the body out of a two-armed overhead chop;
# they read as "something happened", not as a hammer and a sweep.
#
# Usage (headless, reproducible):
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python scripts/anim/blender_author_balgath_slams.py -- \
#     --rig tmp/balgath_for_blender.glb \
#     --out scripts/anim_data/balgath_slam_clips.json
#
# The rig argument is a BASISU-STRIPPED copy of public/models/creatures/balgath_cyclops.glb
# (Blender's importer refuses a file that declares KHR_texture_basisu, and every shipped
# creature GLB here is KTX2-compressed). scripts/strip_glb_for_blender.mjs makes one.
#
# Output is per-frame node-local TRS as JSON, which scripts/build_balgath_anims.mjs bakes
# into the shipped clip GLB alongside the pose-blended clips. Rotation for every bone, plus
# translation for the ones the idle base actually displaces (on this rig, the Hip alone,
# and it carries the entire crouch).
#
# TWO RULES THIS FILE EXISTS TO KEEP, both learned the hard way on other rigs:
#
# 1. NEVER animate the parentless bone. The axis conversion bakes into its pose matrix, so
#    sampling it writes a constant +90deg X root track that pitches the whole model forward
#    for as long as the one-shot plays. That shipped once. `ANIMATED` excludes it by
#    construction (parent is None), not by name.
#
# 2. NEVER guess a local axis. "Raise the arm" is a different axis on every rig and this
#    Tripo auto-rig is not mixamo's; an earlier hand-keyed cut of Balgath's clips had arms
#    that simply never came up. Every angle below was measured: each bone was rotated about
#    each of its own local axes and the resulting WORLD movement of the hand was read back
#    through the dependency graph. What that measurement found, for this rig:
#      R_Upperarm  local -Z raises the arm (fist peaks above the head near -80)
#                  local  X sweeps it horizontally at near-constant height
#      Spine01     local  Y is the TWIST (the head sits on the axis and does not move,
#                                         so a head landmark cannot see it at all)
#                  local  X is the forward/back pitch, -X folds him forward
#
# 3. NEVER author from the BIND pose. Every shipped clip bookends on IDLE, and this rig's
#    idle is a deep knuckle-down hunch: the hands hang at z 0.01 against a bind pose that
#    holds them out at 0.479, nearly half the model's height apart. A clip whose first and
#    last frames are the identity pose therefore opens and closes with a visible T-pose
#    pop. The beats below are composed ON TOP of the idle pose, captured through
#    `matrix_basis` (which round-trips whatever the action drives, euler channels and bone
#    LOCATION included; capturing rotation alone silently dropped the crouch and put the
#    hands back up at chest height).
import json
import math
import os
import sys

import bpy
from mathutils import Quaternion

AXES = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}
FPS = 30


def script_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    args = {}
    for i in range(0, len(argv) - 1, 2):
        args[argv[i].lstrip("-")] = argv[i + 1]
    return args


def import_rig(path):
    """Import the stripped GLB. The importer's armature_display arm reads a context that a
    script does not get for free, so a GUI session needs a temp_override; --background has
    no window to override with and takes the plain path."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    windows = bpy.context.window_manager.windows
    if len(windows):
        win = windows[0]
        area = next((a for a in win.screen.areas if a.type == "VIEW_3D"), None)
        if area is not None:
            region = next(r for r in area.regions if r.type == "WINDOW")
            with bpy.context.temp_override(window=win, area=area, region=region):
                bpy.ops.import_scene.gltf(filepath=path)
                return next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bpy.ops.import_scene.gltf(filepath=path)
    return next(o for o in bpy.data.objects if o.type == "ARMATURE")


# --- the two poses, as named dials over the measured axes ---------------------
# Keeping the beats as dials rather than as raw per-bone angles is what makes them
# reviewable: `raise_` is how high the fist goes, `sweep` is how far the arm travels round,
# and a reviewer can move one without re-deriving the others.


def hammer(raise_, across, elbow, fold, bend=0, clav=0, twist=0):
    return [
        ("R_Clavicle", "Z", clav),
        ("R_Clavicle", "X", across * 0.25),
        ("R_Upperarm", "Z", raise_),
        ("R_Upperarm", "X", across),
        ("R_Forearm", "Z", elbow),
        ("Spine01", "X", fold),
        ("Spine02", "X", fold * 0.5),
        ("Waist", "X", fold * 0.4),
        ("Spine01", "Z", bend),
        ("Spine01", "Y", twist),
    ]


def cleave(twist, sweep, raise_, bend=0, elbow=0):
    """`twist` turns the hips and chest into the swing, `sweep` carries the arm round,
    `raise_` sets how far off the ground the fist rides, and `bend` is the side bend that
    drops the swinging shoulder.

    The scrape beats all share bend -30 and raise -20, which is what pins the fist to the
    ground; the arc is then driven almost entirely by TWIST. That is the difference between
    a swing and a scrape: the arm does not travel through the air, the BODY rotates and
    drags it round. Those values came from a grid search over this same evaluator, not from
    reasoning: the four dials interact and hand-estimating them drifted every time."""
    return [
        ("Waist", "Y", twist * 0.65),
        ("Spine01", "Y", twist),
        ("Spine01", "X", -8),
        ("Waist", "Z", bend * 0.5),
        ("Spine01", "Z", bend),
        ("R_Clavicle", "X", sweep * 0.15),
        ("R_Upperarm", "X", sweep),
        ("R_Upperarm", "Z", raise_),
        ("R_Forearm", "Z", elbow),
    ]


# Beat times are load-bearing: each clip's contact frame sits ON its template windup
# (MobTemplate.slams, src/sim/content/zone2.ts), and both are wired at timeScale 1, so the
# blow and the blast land together. Move a windup and these move with it.
CLIPS = {
    # Fist height above his own foot, beat by beat: 0.22 idle, 0.26, 0.36, 0.47, 0.49 at the
    # top of the wind, 0.28, 0.19 on contact.
    #
    # `clav` is POSITIVE throughout, and that sign is the whole fix for a defect that
    # shipped: this rig has an enormous head (0.226 radius on a 0.55 body) and short arms,
    # so raising the fist onto the centreline drives the forearm straight through the skull.
    # Measured against the deformed mesh, the previous apex had the forearm 0.025 from the
    # head's centre, i.e. buried in it, on the beats that are HELD on screen for the whole
    # windup. Positive clavicle rotation carries the shoulder outboard; every beat below now
    # clears the head shell, worst case 0.021, and the fist still reaches twice its resting
    # height. The trade was real and deliberate: a strictly higher fist is available and it
    # is inside his head.
    "Balgath_Hammer": {
        "seconds": 1.70,
        "beats": [
            (0.00, hammer(0, 0, 0, 0, 0, 0, 0)),
            (0.20, hammer(-40, 0, -14, -14, 0, 10, -6)),  # gather: weight sinks back
            (0.62, hammer(-85, 25, -14, 4, 4, 28, -4)),  # rise, shoulder already opening out
            (0.88, hammer(-120, 45, -10, 16, 6, 45, -2)),  # apex, fist high and OUTBOARD
            (1.10, hammer(-120, 45, -10, 16, 6, 45, -2)),  # HELD: the ring burns down here
            (1.18, hammer(-128, 42, -18, 18, 6, 48, 0)),  # last inch of wind, a touch higher
            (1.26, hammer(-70, 60, -16, -10, 0, 26, 6)),  # drive
            (1.30, hammer(-16, 66, 2, -18, -4, 16, 8)),  # IMPACT (template windup 1.3s)
            (1.46, hammer(-46, 44, -14, -10, 0, 14, 6)),  # recover
            (1.70, hammer(0, 0, 0, 0, 0, 0, 0)),
        ],
    },
    # A SCRAPE, not a swing. The fist plants on the ground at 0.14 above his own foot and
    # stays there through 145 degrees of arc, dragged round by the torso over three quarters
    # of a second: bearing -104 to -61 to -14 (contact, dead ahead) to +41. It reads as an
    # arm ploughing a furrow, which is also what makes the jump check legible, because the
    # thing you have to clear is visibly ON the floor for a long time rather than whipping
    # past in a couple of frames.
    #
    # Longer than its 1.5s windup on purpose: the damage resolves mid-scrape and the follow
    # through keeps dragging afterwards. The shared mechanic lock covers the whole clip.
    "Balgath_Cleave": {
        "seconds": 2.50,
        "beats": [
            (0.00, cleave(0, 0, 0, 0, 0)),
            (0.30, cleave(-40, -70, -38, 0, -24)),  # coil away, fist cocked back and up
            (0.62, cleave(-46, -84, -42, 0, -30)),  # deepest wind
            (1.00, cleave(-46, -84, -42, 0, -30)),  # HELD: the time to read it and jump
            (1.05, cleave(-35, 60, -20, -30, 0)),  # the arm PLANTS on the ground
            (1.30, cleave(-10, 60, -20, -30, 0)),  # dragging
            (1.50, cleave(20, 50, -20, -30, 0)),  # CONTACT, dead ahead (windup 1.5s)
            (1.78, cleave(60, 30, -20, -30, 0)),  # still dragging, past centre
            (2.05, cleave(60, 10, -40, -14, -16)),  # the arm finally lifts off
            (2.50, cleave(0, 0, 0, 0, 0)),
        ],
    },
}


def idle_base(arm, frame=7):
    """The idle pose as a per-bone basis transform, which is what these clips are built on.

    Read through `matrix_basis` rather than `rotation_quaternion`, because the idle action
    also drives bone LOCATION (the Hip carries the whole crouch) and a rotation-only
    capture reproduces a completely different, upright body."""
    act = bpy.data.actions["Idle"]
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    evaluated = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    base = {}
    for pb in arm.pose.bones:
        if pb.bone.parent is None:
            continue
        loc, rot, _ = evaluated.pose.bones[pb.name].matrix_basis.decompose()
        base[pb.name] = (list(loc), Quaternion(rot))
    arm.animation_data.action = None
    return base


def build(arm):
    bpy.context.view_layer.objects.active = arm
    if arm.mode != "POSE":
        bpy.ops.object.mode_set(mode="POSE")
    animated = [b.name for b in arm.data.bones if b.parent is not None]
    base = idle_base(arm)

    def clear():
        for pb in arm.pose.bones:
            pb.rotation_mode = "QUATERNION"
            if pb.bone.parent is None:
                pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
                pb.location = (0, 0, 0)
                continue
            loc, rot = base[pb.name]
            pb.location = loc
            pb.rotation_quaternion = rot.copy()

    for name, spec in CLIPS.items():
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        if arm.animation_data is None:
            arm.animation_data_create()
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        # Blender 5.x: assigning the action alone evaluates NOTHING. The slot must be set
        # too, and act.fcurves no longer exists. Silent no-op if this is skipped.
        if hasattr(act, "slots"):
            slot = act.slots[0] if len(act.slots) else act.slots.new(id_type="OBJECT", name="Legacy")
            arm.animation_data.action_slot = slot
        for secs, pose_spec in spec["beats"]:
            clear()
            for bone, axis, deg in pose_spec:
                pb = arm.pose.bones[bone]
                pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion(
                    AXES[axis], math.radians(deg)
                )
            frame = round(secs * FPS) + 1
            for bn in animated:
                arm.pose.bones[bn].keyframe_insert("rotation_quaternion", frame=frame)
                arm.pose.bones[bn].keyframe_insert("location", frame=frame)
    return animated, base


def sample(arm, animated, base, name, frames):
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    if hasattr(act, "slots") and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    scene = bpy.context.scene
    rotation = {b: [] for b in animated}
    # Only the bones the idle base actually displaces need a translation track; on this rig
    # that is the Hip alone, and it carries the entire crouch. Dropping it renders the clip
    # standing upright, which is not the pose any of this was authored against.
    translated = [b for b in animated if max(abs(v) for v in base[b][0]) > 1e-5]
    translation = {b: [] for b in translated}
    times = []
    for f in range(1, frames + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        evaluated = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        times.append(round((f - 1) / FPS, 5))
        for bn in animated:
            pb = evaluated.pose.bones[bn]
            local = pb.parent.matrix.inverted() @ pb.matrix
            q = local.to_quaternion()
            # Blender quaternions are (w,x,y,z); glTF wants (x,y,z,w).
            rotation[bn].append([round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)])
            if bn in translation:
                t = local.to_translation()
                translation[bn].append([round(t.x, 5), round(t.y, 5), round(t.z, 5)])
    return {
        "duration": round((frames - 1) / FPS, 5),
        "times": times,
        "rotation": rotation,
        "translation": translation,
    }


def main():
    args = script_args()
    rig = args.get("rig", "tmp/balgath_for_blender.glb")
    out = args.get("out", "scripts/anim_data/balgath_slam_clips.json")
    arm = import_rig(os.path.abspath(rig))
    animated, base = build(arm)
    if "Root" in animated:
        raise SystemExit("refusing to author a track on the parentless root bone")
    data = {
        "note": (
            "Authored in Blender against the shipped balgath_cyclops rig; per-frame "
            "node-local rotations only. The parentless Root bone is never animated. "
            "Regenerate with scripts/anim/blender_author_balgath_slams.py."
        ),
        "fps": FPS,
        "rig": "public/models/creatures/balgath_cyclops.glb",
        "bones": animated,
        "clips": {
            name: sample(arm, animated, base, name, round(spec["seconds"] * FPS) + 1)
            for name, spec in CLIPS.items()
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(os.path.abspath(out), "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"wrote {out}: {len(animated)} bones, clips {list(data['clips'])}")


main()
