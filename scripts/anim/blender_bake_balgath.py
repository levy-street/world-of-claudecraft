# Authored boss clips for Balgath, the Buried Foreman (Mirefen world boss).
#
# This is the `blender-anim-pipeline` skill's TECHNIQUE 2 (headless Blender), used
# because the escalation test is met: none of the eight Tripo preset clips the
# creature lane retargets (idle/walk/run/slash/hit/defeat/cast/jump) approximates a
# giant's two-fisted overhead ground smash, a shockwave stomp, a scrying eye-flare
# channel, or the blinded stagger the fight's low-level counterplay is built on. Those
# are novel silhouettes for this rig, so they are keyframed here rather than blended
# out of donor poses.
#
# Usage (headless, reproducible):
#   blender --background --python scripts/anim/blender_bake_balgath.py -- \
#       --in  tmp/asset_pipeline/<job>/final.glb \
#       --out public/models/creatures/balgath_ability_anims.glb \
#       [--preview tmp/balgath_preview.glb]
#
# Output shape matches `bakeClip`/`stripToAnimationsOnly` from scripts/anim/pose_blend.mjs:
# the production file is MESH-FREE (armature nodes plus animations only) so it composes
# with the base creature GLB through `VisualDef.animUrls`, exactly like bow_anims.glb.
# `--preview` additionally writes a full mesh+skin copy for visual review.
#
# Bone names are RESOLVED, never hardcoded: Tripo's auto-rig emits a mixamorig-style
# skeleton but the exact prefix varies per job, and the skill's own warning is that a
# renamed bone fails silently at runtime rather than erroring at build time. Every clip
# is authored against semantic slots (hips, chest, head, arm_l, ...) that `resolve_bones`
# maps onto whatever the incoming armature actually calls them; a slot that cannot be
# resolved raises immediately.

import math
import os
import sys

import bpy
from mathutils import Euler, Quaternion

# --- argument parsing (everything after the `--` separator) -------------------


def script_args():
    argv = sys.argv
    return argv[argv.index("--") + 1 :] if "--" in argv else []


def arg(name, default=None):
    a = script_args()
    return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else default


# --- bone resolution ---------------------------------------------------------

# Semantic slot -> ordered candidate substrings, matched case-insensitively against the
# armature's real bone names. First match wins; earlier candidates are more specific so
# "leftforearm" never steals the "leftarm" slot.
BONE_PATTERNS = {
    # Two rig dialects are in play and both must resolve: Tripo's biped auto-rig
    # emits Hip/Pelvis/Waist/Spine01/Spine02/L_Upperarm/L_Clavicle, while the KayKit
    # and mixamo-derived rigs emit Hips/Spine/Spine1/Spine2/LeftArm/LeftShoulder.
    # Zero-padded numbering is why a bare "spine2" candidate is not enough on its own.
    "hips": ["hips", "hip", "pelvis", "root_bone"],
    # Order matters and the slots are deliberately disjoint: `spine` takes the LOWER
    # link and `chest` the upper one, or both resolve to the same bone and every
    # torso key lands twice (which reads as a stiff, over-rotated lean). The bare
    # "spine" fallback on chest is safe because the `taken` set has already claimed
    # the lower link by the time chest is resolved.
    "spine": ["spine1", "spine_01", "spine01", "waist", "spine"],
    "chest": ["chest", "upperchest", "spine3", "spine_03", "spine2", "spine_02", "spine02", "spine"],
    "neck": ["neck"],
    "head": ["head"],
    "shoulder_l": ["leftshoulder", "shoulder_l", "l_shoulder", "clavicle_l", "l_clavicle"],
    "shoulder_r": ["rightshoulder", "shoulder_r", "r_shoulder", "clavicle_r", "r_clavicle"],
    "arm_l": ["leftarm", "upperarm_l", "l_upperarm", "arm_l"],
    "arm_r": ["rightarm", "upperarm_r", "r_upperarm", "arm_r"],
    "forearm_l": ["leftforearm", "lowerarm_l", "l_forearm", "forearm_l"],
    "forearm_r": ["rightforearm", "lowerarm_r", "r_forearm", "forearm_r"],
    "hand_l": ["lefthand", "hand_l", "l_hand"],
    "hand_r": ["righthand", "hand_r", "r_hand"],
    "thigh_l": ["leftupleg", "thigh_l", "l_thigh", "upleg_l"],
    "thigh_r": ["rightupleg", "thigh_r", "r_thigh", "upleg_r"],
    "shin_l": ["leftleg", "calf_l", "l_calf", "shin_l"],
    "shin_r": ["rightleg", "calf_r", "r_calf", "shin_r"],
    "foot_l": ["leftfoot", "foot_l", "l_foot"],
    "foot_r": ["rightfoot", "foot_r", "r_foot"],
}

# Slots a clip may reference without the bake failing if the rig genuinely lacks them
# (a stumpy auto-rig sometimes merges shoulders into the arms).
OPTIONAL_SLOTS = {"shoulder_l", "shoulder_r", "neck", "spine"}


def resolve_bones(armature):
    names = [b.name for b in armature.data.bones]
    lower = sorted(((n.lower(), n) for n in names), key=lambda p: len(p[0]))
    out = {}
    taken = set()
    for slot, candidates in BONE_PATTERNS.items():
        hit = None
        for cand in candidates:
            for low, real in lower:
                # Never let two slots claim the same bone: spine/chest and
                # arm/forearm are the pairs this actually protects.
                if cand in low and real not in taken:
                    hit = real
                    break
            if hit:
                break
        if hit:
            out[slot] = hit
            taken.add(hit)
    missing = [s for s in BONE_PATTERNS if s not in out and s not in OPTIONAL_SLOTS]
    if missing:
        raise SystemExit(
            "bone resolution failed for slots %s; armature has: %s" % (missing, names)
        )
    return out


# --- clip authoring ----------------------------------------------------------
#
# A clip is (name, duration_seconds, {slot: [(time, (rx, ry, rz)), ...]}) with rotations
# in DEGREES, local to each bone's rest pose. Blender owns the interpolation between
# keys, per the skill's rule against re-implementing slerp in the Blender script.
#
# Every looping clip returns to its opening pose on the last key so the loop point does
# not pop; the one-shots (Smash, Stomp, Roar, Wake) deliberately do not.
#
# TORSO ANGLES ACCUMULATE. hips, spine and chest are a parent chain, so the visible lean
# is their SUM, not the largest of them. The first cut of these clips used 26/30/34 on
# the smash impact and the giant folded 90 degrees into a face-plant. The budget kept
# here: about 35 degrees of total forward lean at an impact, about 25 of total backbend
# on a windup, and the head carries the rest of the read since it has no children to
# multiply it.

FPS = 30

CLIPS = {
    # The telegraphed circle-smash payoff: both fists overhead, a held beat at the top
    # so the ground ring reads before it lands, then a fast drive down and a heavy
    # settle. Impact is at 0.85s, which is what attackTimeScaleByAbility tunes against.
    "Smash": (
        1.70,
        {
            "hips": [(0, (0, 0, 0)), (0.55, (-7, 0, 0)), (0.85, (13, 0, 0)), (1.10, (8, 0, 0)), (1.70, (0, 0, 0))],
            "spine": [(0, (0, 0, 0)), (0.55, (-8, 0, 0)), (0.85, (12, 0, 0)), (1.10, (7, 0, 0)), (1.70, (0, 0, 0))],
            "chest": [(0, (0, 0, 0)), (0.55, (-9, 0, 0)), (0.85, (11, 0, 0)), (1.10, (6, 0, 0)), (1.70, (0, 0, 0))],
            "head": [(0, (0, 0, 0)), (0.55, (-18, 0, 0)), (0.85, (26, 0, 0)), (1.70, (0, 0, 0))],
            "arm_l": [(0, (0, 0, 0)), (0.55, (-118, 0, -16)), (0.70, (-126, 0, -18)), (0.85, (34, 0, -8)), (1.70, (0, 0, 0))],
            "arm_r": [(0, (0, 0, 0)), (0.55, (-118, 0, 16)), (0.70, (-126, 0, 18)), (0.85, (34, 0, 8)), (1.70, (0, 0, 0))],
            "forearm_l": [(0, (0, 0, 0)), (0.55, (-34, 0, 0)), (0.85, (-12, 0, 0)), (1.70, (0, 0, 0))],
            "forearm_r": [(0, (0, 0, 0)), (0.55, (-34, 0, 0)), (0.85, (-12, 0, 0)), (1.70, (0, 0, 0))],
            "thigh_l": [(0, (0, 0, 0)), (0.55, (10, 0, 0)), (0.85, (-18, 0, 0)), (1.70, (0, 0, 0))],
            "thigh_r": [(0, (0, 0, 0)), (0.55, (10, 0, 0)), (0.85, (-18, 0, 0)), (1.70, (0, 0, 0))],
        },
    ),
    # Shockwave stomp: one knee driven high, then slammed flat. The torso counter-rotates
    # so the weight reads as his, not the animation's.
    "Stomp": (
        1.30,
        {
            "hips": [(0, (0, 0, 0)), (0.45, (-5, 0, -6)), (0.70, (8, 0, 0)), (1.30, (0, 0, 0))],
            "spine": [(0, (0, 0, 0)), (0.45, (-4, 0, 4)), (0.70, (9, 0, 0)), (1.30, (0, 0, 0))],
            "chest": [(0, (0, 0, 0)), (0.45, (-3, 0, 6)), (0.70, (10, 0, 0)), (1.30, (0, 0, 0))],
            "thigh_r": [(0, (0, 0, 0)), (0.45, (-72, 0, 0)), (0.70, (14, 0, 0)), (1.30, (0, 0, 0))],
            "shin_r": [(0, (0, 0, 0)), (0.45, (62, 0, 0)), (0.70, (-6, 0, 0)), (1.30, (0, 0, 0))],
            "foot_r": [(0, (0, 0, 0)), (0.45, (24, 0, 0)), (0.70, (0, 0, 0)), (1.30, (0, 0, 0))],
            "thigh_l": [(0, (0, 0, 0)), (0.45, (12, 0, 0)), (0.70, (-8, 0, 0)), (1.30, (0, 0, 0))],
            "arm_l": [(0, (0, 0, 0)), (0.45, (-26, 0, -10)), (0.70, (18, 0, -4)), (1.30, (0, 0, 0))],
            "arm_r": [(0, (0, 0, 0)), (0.45, (-26, 0, 10)), (0.70, (18, 0, 4)), (1.30, (0, 0, 0))],
        },
    ),
    # The scrying channel behind the bigCast: he straightens, tips the eye skyward and
    # holds both palms out. Loops flat through the middle so the cast bar can be any
    # length without the pose drifting.
    "EyeFlare": (
        2.40,
        {
            "hips": [(0, (0, 0, 0)), (0.60, (-4, 0, 0)), (1.80, (-4, 0, 0)), (2.40, (0, 0, 0))],
            "spine": [(0, (0, 0, 0)), (0.60, (-7, 0, 0)), (1.80, (-7, 0, 0)), (2.40, (0, 0, 0))],
            "chest": [(0, (0, 0, 0)), (0.60, (-9, 0, 0)), (1.80, (-9, 0, 0)), (2.40, (0, 0, 0))],
            "head": [(0, (0, 0, 0)), (0.60, (-26, 0, 0)), (1.20, (-30, 0, 0)), (1.80, (-26, 0, 0)), (2.40, (0, 0, 0))],
            "arm_l": [(0, (0, 0, 0)), (0.60, (-52, 0, -28)), (1.80, (-56, 0, -30)), (2.40, (0, 0, 0))],
            "arm_r": [(0, (0, 0, 0)), (0.60, (-52, 0, 28)), (1.80, (-56, 0, 30)), (2.40, (0, 0, 0))],
            "forearm_l": [(0, (0, 0, 0)), (0.60, (-28, 0, 0)), (1.80, (-24, 0, 0)), (2.40, (0, 0, 0))],
            "forearm_r": [(0, (0, 0, 0)), (0.60, (-28, 0, 0)), (1.80, (-24, 0, 0)), (2.40, (0, 0, 0))],
        },
    ),
    # Blinded: the whole point of the fight's low-level counterplay, so it has to read
    # from across the fen. He reels, one hand claws at the eye, the head thrashes off
    # the axis he normally tracks on. Loops.
    "Blinded": (
        2.00,
        {
            "hips": [(0, (0, 0, 0)), (0.50, (3, -6, 3)), (1.00, (4, 5, -3)), (1.50, (3, -4, 2)), (2.00, (0, 0, 0))],
            "spine": [(0, (0, 0, 0)), (0.50, (4, -8, 3)), (1.00, (5, 7, -3)), (1.50, (4, -5, 2)), (2.00, (0, 0, 0))],
            "chest": [(0, (0, 0, 0)), (0.50, (5, -10, 4)), (1.00, (6, 9, -4)), (1.50, (5, -6, 3)), (2.00, (0, 0, 0))],
            "head": [(0, (0, 0, 0)), (0.35, (14, -34, 8)), (0.90, (16, 32, -8)), (1.45, (14, -26, 6)), (2.00, (0, 0, 0))],
            "arm_r": [(0, (0, 0, 0)), (0.40, (-96, 0, 26)), (1.00, (-104, 0, 30)), (1.60, (-92, 0, 24)), (2.00, (0, 0, 0))],
            "forearm_r": [(0, (0, 0, 0)), (0.40, (-72, 0, 0)), (1.00, (-84, 0, 0)), (1.60, (-70, 0, 0)), (2.00, (0, 0, 0))],
            "arm_l": [(0, (0, 0, 0)), (0.50, (-30, 0, -34)), (1.20, (-24, 0, -28)), (2.00, (0, 0, 0))],
            "forearm_l": [(0, (0, 0, 0)), (0.50, (-40, 0, 0)), (1.20, (-32, 0, 0)), (2.00, (0, 0, 0))],
        },
    ),
    # Enrage flourish: chest thrown open, head back, arms flung wide. One shot.
    "Roar": (
        1.60,
        {
            "hips": [(0, (0, 0, 0)), (0.35, (5, 0, 0)), (0.75, (-6, 0, 0)), (1.60, (0, 0, 0))],
            "spine": [(0, (0, 0, 0)), (0.35, (6, 0, 0)), (0.75, (-8, 0, 0)), (1.60, (0, 0, 0))],
            "chest": [(0, (0, 0, 0)), (0.35, (7, 0, 0)), (0.75, (-10, 0, 0)), (1.60, (0, 0, 0))],
            "head": [(0, (0, 0, 0)), (0.35, (14, 0, 0)), (0.75, (-38, 0, 0)), (1.60, (0, 0, 0))],
            "arm_l": [(0, (0, 0, 0)), (0.35, (18, 0, -10)), (0.75, (-62, 0, -46)), (1.60, (0, 0, 0))],
            "arm_r": [(0, (0, 0, 0)), (0.35, (18, 0, 10)), (0.75, (-62, 0, 46)), (1.60, (0, 0, 0))],
            "forearm_l": [(0, (0, 0, 0)), (0.75, (-34, 0, 0)), (1.60, (0, 0, 0))],
            "forearm_r": [(0, (0, 0, 0)), (0.75, (-34, 0, 0)), (1.60, (0, 0, 0))],
        },
    ),
    # The rise: he spawns folded into the barrow and unbends. Played once at the world
    # boss's scheduled rise, which is the moment the whole server gets announced to.
    "Wake": (
        3.20,
        {
            "hips": [(0, (26, 0, 0)), (1.20, (18, 0, 0)), (2.20, (6, 0, 0)), (3.20, (0, 0, 0))],
            "spine": [(0, (22, 0, 0)), (1.20, (15, 0, 0)), (2.20, (5, 0, 0)), (3.20, (0, 0, 0))],
            "chest": [(0, (20, 0, 0)), (1.20, (13, 0, 0)), (2.20, (4, 0, 0)), (3.20, (0, 0, 0))],
            "head": [(0, (46, 0, 0)), (1.60, (26, 0, 0)), (2.60, (-16, 0, 0)), (3.20, (0, 0, 0))],
            "arm_l": [(0, (-24, 0, -52)), (1.60, (-16, 0, -34)), (3.20, (0, 0, 0))],
            "arm_r": [(0, (-24, 0, 52)), (1.60, (-16, 0, 34)), (3.20, (0, 0, 0))],
            "forearm_l": [(0, (-88, 0, 0)), (1.60, (-52, 0, 0)), (3.20, (0, 0, 0))],
            "forearm_r": [(0, (-88, 0, 0)), (1.60, (-52, 0, 0)), (3.20, (0, 0, 0))],
            "thigh_l": [(0, (-74, 0, 0)), (1.20, (-52, 0, 0)), (2.40, (-12, 0, 0)), (3.20, (0, 0, 0))],
            "thigh_r": [(0, (-74, 0, 0)), (1.20, (-52, 0, 0)), (2.40, (-12, 0, 0)), (3.20, (0, 0, 0))],
            "shin_l": [(0, (96, 0, 0)), (1.20, (68, 0, 0)), (2.40, (16, 0, 0)), (3.20, (0, 0, 0))],
            "shin_r": [(0, (96, 0, 0)), (1.20, (68, 0, 0)), (2.40, (16, 0, 0)), (3.20, (0, 0, 0))],
        },
    ),
}


def action_fcurves(action, slot):
    """Every fcurve on `action`, across both the pre-4.4 and the slotted layouts.

    Blender 4.4 moved fcurves off `Action` and into layer -> strip -> channelbag(slot);
    `Action.fcurves` no longer exists at all on 5.x, so reading it is an AttributeError,
    not an empty list. This is the one place that difference is handled.
    """
    layers = getattr(action, "layers", None)
    if layers:
        out = []
        for layer in layers:
            for strip in layer.strips:
                bag = None
                try:
                    bag = strip.channelbag(slot) if slot else None
                except Exception:
                    bag = None
                if bag is not None:
                    out.extend(bag.fcurves)
        return out
    return list(getattr(action, "fcurves", []))


def build_clip(armature, bones, clip_name, duration, tracks):
    """Key one action onto the armature and return it."""
    action = bpy.data.actions.new(clip_name)
    action.use_fake_user = True
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action
    # Blender 4.4+ routes every action through a slot; bind one or the keys land nowhere.
    slot = None
    if hasattr(action, "slots"):
        try:
            slot = action.slots.new(id_type="OBJECT", name=clip_name)
            armature.animation_data.action_slot = slot
        except Exception:
            slot = getattr(armature.animation_data, "action_slot", None)

    for pb in armature.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = (0, 0, 0)

    for slot_name, keys in tracks.items():
        bone_name = bones.get(slot_name)
        if not bone_name:
            continue  # optional slot this rig does not have
        pb = armature.pose.bones[bone_name]
        for t, (rx, ry, rz) in keys:
            q = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_quaternion()
            pb.rotation_quaternion = q
            pb.keyframe_insert(data_path="rotation_quaternion", frame=1 + t * FPS)

    # Ease every key so the giant reads heavy rather than linear-robotic.
    curves = action_fcurves(action, slot)
    if not curves:
        raise SystemExit("clip %s got no fcurves: keys did not bind to a slot" % clip_name)
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = "AUTO_CLAMPED"
            kp.handle_right_type = "AUTO_CLAMPED"

    armature.animation_data.action = None
    return action


def main():
    src = arg("--in")
    out = arg("--out")
    preview = arg("--preview")
    if not src or not out:
        raise SystemExit("usage: --in <rigged.glb> --out <clips.glb> [--preview <full.glb>]")

    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))

    # Whatever clips the source rig already ships are DONOR context only. They must not
    # ride along into the production file: this output composes over the base GLB through
    # `animUrls`, and a second copy of Idle/Walk/Attack there would shadow the base rig's
    # own clips of the same name.
    inherited = {a.name for a in bpy.data.actions}
    if inherited:
        print("source clips (will be dropped from output):", sorted(inherited))

    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not armatures:
        raise SystemExit("no armature in %s (is this the RIGGED glb?)" % src)
    arm = armatures[0]
    bones = resolve_bones(arm)
    print("resolved bones:", bones)

    bpy.context.scene.render.fps = FPS
    built = []
    for name, (duration, tracks) in CLIPS.items():
        built.append(build_clip(arm, bones, name, duration, tracks))
        print("authored clip:", name, "%.2fs" % duration)

    # Every action must be exported, not just the active one.
    for o in bpy.data.objects:
        o.select_set(True)

    if preview:
        bpy.ops.export_scene.gltf(
            filepath=os.path.abspath(preview),
            export_format="GLB",
            export_animations=True,
            export_animation_mode="ACTIONS",
        )
        print("preview written:", preview)

    # Production output: drop the mesh AND every inherited clip, so the donor carries
    # exactly the authored set and nothing else.
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)
    for act in [a for a in bpy.data.actions if a.name in inherited]:
        bpy.data.actions.remove(act, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
    )
    print("clips written:", out, [a.name for a in built])


main()
