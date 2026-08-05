"""Measure a rig against the mesh it is supposed to drive.

The point is to stop arguing about these bodies by eye. Every claim about an "elbow
buried in the torso" or a "noodle arm" should be a number, so a fix can be checked
against the same number afterwards.

Reports, per model:
  * bone chain with world-space head/tail and length
  * for every bone: the CENTROID and BOUNDS of the geometry it actually dominates
    (highest-weight bone per vertex). A bone whose geometry sits nowhere near the
    bone is a mis-pivoted bone, which is the whole class of defect here.
  * torso half-width sampled per z-slab, so "outside the torso" is measured at the
    height the arm actually leaves the body rather than against one global number.
  * EXPOSURE: for each arm bone, how far outside the local torso half-width its head
    sits. Negative means the joint is inside the body mass and cannot read as a joint.

Usage: blender -b -P tmp/rig_audit.py -- <glb-name>
"""

import os
import sys
from collections import defaultdict

import bpy

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
NAME = sys.argv[sys.argv.index("--") + 1:][0]
PATH = (os.path.join(REPO, NAME) if "/" in NAME
        else os.path.join(REPO, "public/models/chars/npcs", NAME))

for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
             bpy.data.actions, bpy.data.images, bpy.data.collections, bpy.data.lights,
             bpy.data.cameras):
    for item in list(coll):
        try:
            coll.remove(item)
        except Exception:
            pass

seed = bpy.data.objects.new("ctx_seed", None)
bpy.context.scene.collection.objects.link(seed)
bpy.context.view_layer.objects.active = seed
bpy.ops.import_scene.gltf(filepath=PATH)
bpy.data.objects.remove(seed, do_unlink=True)

for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
    bpy.data.objects.remove(o, do_unlink=True)

body = next(o for o in bpy.data.objects if o.type == "MESH")
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
me = body.data
W = body.matrix_world
RW = rig.matrix_world
co = {v.index: W @ v.co for v in me.vertices}
gname = {g.index: g.name for g in body.vertex_groups}

lo = [min(p[i] for p in co.values()) for i in range(3)]
hi = [max(p[i] for p in co.values()) for i in range(3)]
print(f"== {NAME}")
print(f"MESH verts={len(me.vertices)} tris~{len(me.polygons)} "
      f"bounds x[{lo[0]:+.3f},{hi[0]:+.3f}] y[{lo[1]:+.3f},{hi[1]:+.3f}] "
      f"z[{lo[2]:+.3f},{hi[2]:+.3f}] height={hi[2] - lo[2]:.3f}")
print(f"ARMATURE {rig.name} bones={len(rig.data.bones)} scale={tuple(round(s, 3) for s in rig.scale)}")

# ---- dominant-bone geometry: which vertices does each bone actually own
dom = defaultdict(list)
for v in me.vertices:
    if not v.groups:
        continue
    g = max(v.groups, key=lambda g: g.weight)
    dom[gname[g.group]].append(v.index)

# ---- torso half-width per z slab, so "outside the body" is a local question.
# Sampled from vertices near the mid-line in y, and excluding the vertices the arm
# chain dominates, otherwise the arms themselves inflate the torso measurement.
ARM_PREFIX = ("upperarm", "lowerarm", "wrist", "hand", "handslot", "finger", "thumb")
arm_verts = {i for b, ids in dom.items() if b.split(".")[0] in ARM_PREFIX for i in ids}
SLABS = 24
z0, z1 = lo[2], hi[2]
slab_w = {}
for s in range(SLABS):
    a = z0 + (z1 - z0) * s / SLABS
    b = z0 + (z1 - z0) * (s + 1) / SLABS
    xs = [abs(co[i].x) for i in co if a <= co[i].z < b and i not in arm_verts]
    if xs:
        xs.sort()
        slab_w[s] = xs[int(len(xs) * 0.90)]


def torso_at(z):
    """Torso half-width at height z, from the nearest measured slab."""
    if not slab_w:
        return 0.0
    s = min(max(int((z - z0) / (z1 - z0) * SLABS), 0), SLABS - 1)
    for d in range(SLABS):
        for c in (s - d, s + d):
            if c in slab_w:
                return slab_w[c]
    return 0.0


print("\nBONES  (head/tail world; owned = geometry whose top weight is this bone)")
order = []


def walk(bone, depth):
    order.append((bone, depth))
    for c in bone.children:
        walk(c, depth + 1)


for b in rig.data.bones:
    if b.parent is None:
        walk(b, 0)

for bone, depth in order:
    h = RW @ bone.head_local
    t = RW @ bone.tail_local
    ids = dom.get(bone.name, [])
    own = ""
    if ids:
        cx = sum(co[i].x for i in ids) / len(ids)
        cy = sum(co[i].y for i in ids) / len(ids)
        cz = sum(co[i].z for i in ids) / len(ids)
        d = ((cx - h.x) ** 2 + (cy - h.y) ** 2 + (cz - h.z) ** 2) ** 0.5
        own = f" owned={len(ids):4d} centroid=({cx:+.2f},{cy:+.2f},{cz:+.2f}) d_head={d:.3f}"
    print(f"  {'  ' * depth}{bone.name:<16} h=({h.x:+.3f},{h.y:+.3f},{h.z:+.3f}) "
          f"t=({t.x:+.3f},{t.y:+.3f},{t.z:+.3f}) len={bone.length:.3f}{own}")

print("\nEXPOSURE  (how far a joint sits outside the torso half-width at its own height)")
print("  negative = joint buried in the body mass, cannot read as a joint")
for name in [f"{l}.{s}" for l in ("upperarm", "lowerarm", "wrist", "hand") for s in ("l", "r")]:
    b = rig.data.bones.get(name)
    if b is None:
        continue
    h = RW @ b.head_local
    tw = torso_at(h.z)
    print(f"  {name:<14} |x|={abs(h.x):.3f} torso_half@z={tw:.3f} exposure={abs(h.x) - tw:+.3f}")

print("\nARM GEOMETRY EXTENT  (where the arm mesh really is)")
if arm_verts:
    axs = [abs(co[i].x) for i in arm_verts]
    azs = [co[i].z for i in arm_verts]
    print(f"  arm verts={len(arm_verts)} |x| [{min(axs):.3f},{max(axs):.3f}] "
          f"z [{min(azs):.3f},{max(azs):.3f}]")
else:
    print("  NONE: no vertex is dominated by an arm bone. The arms are riding the torso.")

print("\nCLIPS")
for a in sorted(bpy.data.actions, key=lambda a: a.name):
    fr = a.frame_range
    print(f"  {a.name:<38} frames {fr[0]:.0f}..{fr[1]:.0f}")
