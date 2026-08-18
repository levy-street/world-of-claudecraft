"""Render one clip as a single montage PNG, so the ARC can be judged in one look.

A swing is a shape over time; separate frame files hide whether that shape reads. One
wide image with the frames in order shows anticipation, contact and follow-through
together, which is what "does this land" actually depends on.

The camera is fitted ONCE, on the widest frame of the clip rather than the first, and
held for the whole strip: a per-frame refit silently rescales the figure and turns a
huge swing into a small one. Fitting on the widest frame also stops a big overswing
from running out of frame.

Usage: blender -b -P tmp/strip.py -- <glb-path-or-name> <clip> <out.png> [n] [yaw] [pitch]
"""

import os
import sys

import bpy
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import preview  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, CLIP, OUT = argv[0], argv[1], argv[2]
N = int(argv[3]) if len(argv) > 3 else 7
YAW = float(argv[4]) if len(argv) > 4 else 34.0
PITCH = float(argv[5]) if len(argv) > 5 else 6.0
SRC = os.path.join(REPO, NAME) if "/" in NAME else os.path.join(
    REPO, "public/models/chars/npcs", NAME)
OUTPATH = os.path.join(REPO, OUT) if "/" in OUT else os.path.join(REPO, "tmp", OUT)
CELL = (400, 520)

for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
             bpy.data.actions, bpy.data.images, bpy.data.collections, bpy.data.lights,
             bpy.data.cameras):
    for item in list(coll):
        try:
            coll.remove(item)
        except Exception:
            pass
s0 = bpy.data.objects.new("ctx_seed", None)
bpy.context.scene.collection.objects.link(s0)
bpy.context.view_layer.objects.active = s0
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.data.objects.remove(s0, do_unlink=True)
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
    bpy.data.objects.remove(o, do_unlink=True)

body = next(o for o in bpy.data.objects if o.type == "MESH")
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
cam = preview.setup(res=CELL, transparent=False)
bpy.context.scene.render.image_settings.file_format = "PNG"

# "Clip@frame" renders ONE pose from N yaws instead of N frames from one yaw. A key pose
# aimed at the camera is foreshortened to nothing, so judging a strike from a single
# station is how a swing that reads badly gets called good.
ORBIT = "@" in CLIP
if ORBIT:
    CLIP, at = CLIP.split("@")
    at = int(at)
act = bpy.data.actions[CLIP]
preview.pose(rig, CLIP, None)
s, e = act.frame_range
frames = [at] * N if ORBIT else [int(round(s + (e - s) * k / (N - 1))) for k in range(N)]
yaws = [YAW + 360.0 * k / N for k in range(N)] if ORBIT else [YAW] * N

# widest frame decides the station, so nothing clips out of the montage
best = None
for f in frames:
    bpy.context.scene.frame_set(f)
    t, d = preview.fit([body], pad=1.95)
    if best is None or d > best[1]:
        best = (t, d)
target, dist = best

tmpdir = os.path.join(REPO, "tmp", "_strip_frames")
os.makedirs(tmpdir, exist_ok=True)
cells = []
for k, f in enumerate(frames):
    bpy.context.scene.frame_set(f)
    p = os.path.join(tmpdir, f"f{k:02d}.png")
    preview.shoot(cam, p, target, dist, yaws[k], PITCH)
    img = bpy.data.images.load(p)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
    cells.append(a[:, :, :3])
    bpy.data.images.remove(img)

h, w = cells[0].shape[0], cells[0].shape[1]
sheet = np.concatenate(cells, axis=1)
# 2px divider between frames, so a reader can tell the beats apart
for k in range(1, len(cells)):
    sheet[:, k * w - 1:k * w + 1, :] = 0.10

out = bpy.data.images.new("montage", width=w * len(cells), height=h, alpha=False)
rgba = np.concatenate([sheet, np.ones((h, w * len(cells), 1), dtype=np.float32)], axis=2)
out.pixels = rgba.reshape(-1)
out.filepath_raw = OUTPATH
out.file_format = "PNG"
out.save()
print(f"STRIP {CLIP} frames={frames} -> {OUTPATH}")
