"""Find skinning artifacts by measuring EDGE STRETCH across a clip.

A tear or a flung shard is an edge whose posed length bears no relation to its rest
length. Eyeballing renders finds these only when they happen to face the camera and be
large; measuring every edge on every sampled frame finds all of them, and says which
bones are pulling the two ends apart, which is what actually needs fixing.

Reports the worst offenders with position and the dominant bone on each end, plus a
per-frame summary so a clip can be compared against another after a change.

Usage: blender -b -P tmp/stretch_check.py -- <glb-path> <clip> [samples] [ratio]
"""

import os
import sys
from collections import defaultdict

import bpy

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:]
NAME, CLIP = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 9
RATIO = float(argv[3]) if len(argv) > 3 else 2.0
MIN_ABS = float(argv[4]) if len(argv) > 4 else 0.04
SRC = os.path.join(REPO, NAME) if "/" in NAME else os.path.join(
    REPO, "public/models/chars/npcs", NAME)

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
me = body.data
gname = {g.index: g.name for g in body.vertex_groups}
dom = {}
for v in me.vertices:
    if v.groups:
        dom[v.index] = gname[max(v.groups, key=lambda g: g.weight).group]

# rest lengths, measured with the armature in REST so nothing is already deformed
rig.data.pose_position = "REST"
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
m = ev.to_mesh()
rest = [(ev.matrix_world @ m.vertices[e.vertices[0]].co
         - ev.matrix_world @ m.vertices[e.vertices[1]].co).length for e in m.edges]
pairs = [(e.vertices[0], e.vertices[1]) for e in m.edges]
ev.to_mesh_clear()

rig.data.pose_position = "POSE"
act = bpy.data.actions[CLIP]
if rig.animation_data is None:
    rig.animation_data_create()
rig.animation_data.action = act
if hasattr(rig.animation_data, "action_slot"):
    for slot in act.slots:
        rig.animation_data.action_slot = slot
        break

s, e = act.frame_range
frames = [int(round(s + (e - s) * k / (SAMPLES - 1))) for k in range(SAMPLES)]
print(f"== {NAME} {CLIP} edges={len(pairs)} ratio_threshold={RATIO}")
worst = []
for f in frames:
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    W = ev.matrix_world
    bad, peak, peak_abs = 0, 1.0, 0.0
    for i, (a, b) in enumerate(pairs):
        if rest[i] < 1e-6:
            continue
        cur = (W @ m.vertices[a].co - W @ m.vertices[b].co).length
        r = cur / rest[i]
        grew = cur - rest[i]
        # A ratio alone is misleading on this mesh: the triangle soup contains sliver
        # edges only a few thousandths long, and those hit 5x while moving a distance
        # nobody can see. A real tear has to open up an actual GAP, so require both.
        if grew > MIN_ABS:
            peak = max(peak, r)
            peak_abs = max(peak_abs, grew)
            if r > RATIO:
                bad += 1
                p = W @ m.vertices[a].co
                worst.append((r, f, a, b, (p.x, p.y, p.z),
                              dom.get(a, "?"), dom.get(b, "?"), grew, rest[i]))
    ev.to_mesh_clear()
    print(f"  frame {f:3d}  real_tears={bad:5d}  peak_stretch={peak:.2f}x  "
          f"peak_gap={peak_abs:.3f}")

worst.sort(reverse=True)
if worst:
    print(f"\nWORST EDGES ({len(worst)} over {RATIO}x, showing 14)")
    seen = defaultdict(int)
    shown = 0
    for r, f, a, b, p, da, db, grew, rl in worst:
        k = tuple(sorted((da, db)))
        seen[k] += 1
        if shown < 14:
            print(f"  {r:6.1f}x gap={grew:.3f} rest={rl:.3f} frame={f:3d} "
                  f"at ({p[0]:+.2f},{p[1]:+.2f},{p[2]:+.2f}) {da} <-> {db}")
            shown += 1
    print("\nBY BONE PAIR (which joints are pulling apart)")
    for k, n in sorted(seen.items(), key=lambda kv: -kv[1])[:10]:
        print(f"  {n:5d}  {k[0]} <-> {k[1]}")
else:
    print("\nNo edge exceeded the threshold: no tearing.")
