"""Concept-book plate rendering: a turntable plus posed stills per figure.

Renders on transparent film so the book page owns the backdrop, and writes a
manifest JSON alongside the images. `build_concept_book.mjs` reads that manifest,
so the page's copy, palette chips and plate captions all come from the same
`cast.py` table that drove the renders.

Framing is measured per figure rather than fixed: the cast runs from a young
bell-runner to a four-yard elite, and one camera station cannot serve both.

Deterministic: fixed camera stations, fixed clip frames, no randomness, no time.
"""

import bpy
import json
import os

import cast
import crew
import figures
import preview

TURN_FRAMES = 12
TURN_RES = (560, 740)
POSE_RES = (700, 880)
# Playback: 12 samples across a clip at 12fps is close to real time for the KayKit
# clips (about a second each) and keeps a sprite sheet to a sane width.
ANIM_FRAMES = 12
ANIM_FPS = 12
ANIM_RES = (300, 380)

# Clip slots to look for when a figure's rig is not the KayKit humanoid (the
# creature rigs each name their clips differently). Order is the preference order.
AUTO_POSES = (
    (("Idle", "idle"), "At rest"),
    (("Walk", "walk", "Gallop", "Run", "run"), "Moving"),
    (("Attack", "attack", "Bite", "Chop"), "Attacking"),
    (("Hit", "hit", "Damage", "Death", "death"), "Struck"),
)


def auto_poses(limit=4):
    """Pick plate clips off whatever the imported rig actually ships."""
    names = sorted(a.name for a in bpy.data.actions)
    picked, used = [], set()
    for needles, label in AUTO_POSES:
        for needle in needles:
            hit = next((n for n in names if needle in n and n not in used), None)
            if hit:
                action = bpy.data.actions[hit]
                start, end = action.frame_range
                picked.append((hit, int(start + (end - start) * 0.45), label))
                used.add(hit)
                break
        if len(picked) >= limit:
            break
    return picked


def render_member(member, out_dir, turn_frames=TURN_FRAMES):
    """Build one figure and render its plates. Returns the manifest entry."""
    meta = cast.CAST[member]
    crew.wipe()
    seed = crew.seed_context()
    built = figures.RECIPES[member]()
    bpy.data.objects.remove(seed, do_unlink=True)
    rig = built.get("rig")
    stats = crew.measure()

    os.makedirs(out_dir, exist_ok=True)
    entry = {k: v for k, v in meta.items()}
    entry["id"] = member
    entry["stats"] = stats

    figure_objs = [o for o in bpy.data.objects if o.type == "MESH"]

    # turntable, in bind pose, so the book can spin the figure
    if rig is not None:
        rig.data.pose_position = "REST"
    cam = preview.setup(res=TURN_RES, transparent=True)
    target, dist = preview.fit(figure_objs)
    turn = []
    for i in range(turn_frames):
        name = f"{member}_turn_{i:02d}.png"
        preview.shoot(cam, os.path.join(out_dir, name), target, dist,
                      i * (360.0 / turn_frames), 6)
        turn.append(name)
    entry["turntable"] = turn

    # posed plates, from the clips the figure's rig actually ships
    plates = []
    wanted = meta.get("poses") or []
    if rig is not None and not wanted:
        wanted = auto_poses()
    if rig is not None and wanted:
        cam = preview.setup(res=POSE_RES, transparent=True)
        for clip, frame, label in wanted:
            if bpy.data.actions.get(clip) is None:
                continue
            preview.pose(rig, clip, frame)
            # re-fit per pose: a stride and a raised strike do not share a frame
            target, dist = preview.fit(figure_objs)
            name = f"{member}_pose_{clip}.png"
            preview.shoot(cam, os.path.join(out_dir, name), target, dist, 32, 6)
            plates.append({"file": name, "clip": clip, "frame": frame, "label": label})
    entry["plates"] = plates

    # PLAYABLE clips. Static plates are what let the reversed shields, the sideways
    # spear and the inverted staff through review: a prop that reads fine standing
    # still is obviously wrong once the wrist moves. Each clip is sampled evenly
    # across its whole range from ONE fixed camera station (the pose plates re-fit
    # per frame, which would make a walk cycle bob in and out), then stitched into a
    # sprite sheet by `build_concept_book.mjs`.
    anims = []
    if rig is not None and wanted:
        cam = preview.setup(res=ANIM_RES, transparent=True)
        for clip, _frame, label in wanted:
            action = bpy.data.actions.get(clip)
            if action is None:
                continue
            preview.pose(rig, clip, None)
            target, dist = preview.fit(figure_objs, pad=1.52)
            start, end = action.frame_range
            files = []
            for i in range(ANIM_FRAMES):
                f = start + (end - start) * (i / ANIM_FRAMES)   # exclusive end: loops clean
                bpy.context.scene.frame_set(int(round(f)))
                name = f"{member}_anim_{clip}_{i:02d}.png"
                preview.shoot(cam, os.path.join(out_dir, name), target, dist, 32, 6)
                files.append(name)
            anims.append({"clip": clip, "label": label, "frames": files,
                          "fps": ANIM_FPS, "width": ANIM_RES[0], "height": ANIM_RES[1]})
    entry["anims"] = anims

    # a bust for the cast list (a portrait crop, or the whole thing if it has no head)
    if rig is not None:
        rig.data.pose_position = "REST"
    cam = preview.setup(res=(620, 620), transparent=True)
    target, dist = preview.fit(figure_objs)
    bust = f"{member}_bust.png"
    if meta.get("kind") in ("creature", "spawn"):
        preview.shoot(cam, os.path.join(out_dir, bust), target, dist * 0.92, 24, 8)
    else:
        # humanoids get a real headshot: 72 percent up the figure, pulled in close
        preview.shoot(cam, os.path.join(out_dir, bust),
                      (target[0], target[1], target[2] * 1.44), dist * 0.46, 24, 8)
    entry["bust"] = bust

    with open(os.path.join(out_dir, f"{member}.json"), "w") as fh:
        json.dump(entry, fh, indent=2)
    return entry
