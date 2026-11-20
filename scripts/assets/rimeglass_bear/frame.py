"""Put the baked bear into the wolf rig's frame and measure it there.

blender -b --python scripts/assets/rimeglass_bear/frame.py -- <baked.glb> <out_body.glb>

Frame: muzzle toward -Y, left toward +X, floor at z = -0.553, scaled 2.6x (about the
wolf's standing height). Prints the leg columns, the back and belly lines and the head.
"""
import math
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :]
SRC, OUT = argv
S = 2.6
GROUND = -0.553

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
# Bake the import transform into the mesh, then turn and scale.
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
obj.data.transform(Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(S, 4))
zs = [v.co.z for v in obj.data.vertices]
xs = [v.co.x for v in obj.data.vertices]
dz = GROUND - min(zs)
dx = -(min(xs) + max(xs)) / 2
obj.data.transform(Matrix.Translation((dx, 0, dz)))
obj.data.update()
pts = [v.co.copy() for v in obj.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
print('BB', tuple(round(c, 3) for c in lo), tuple(round(c, 3) for c in hi))
h = hi.z - lo.z

# Feet and leg columns.
low = [p for p in pts if p.z < lo.z + 0.05 * h]
for qx in (1, -1):
    for name, ysel in (('front', lambda y: y < 0.1), ('hind', lambda y: y >= 0.1)):
        q = [p for p in low if p.x * qx > 0 and ysel(p.y)]
        if not q:
            continue
        foot = sum(q, Vector()) / len(q)
        ys = sorted(p.y for p in q)
        print(f'{name} {"L" if qx > 0 else "R"} foot c=({foot.x:.3f},{foot.y:.3f}) toe..heel y {ys[0]:.3f}..{ys[-1]:.3f}')
        # Walk up the column: points within 0.22 of the foot's x,y (relaxed as we rise).
        for z in [GROUND + f * h for f in (0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65)]:
            band = [p for p in pts if abs(p.z - z) < 0.03 and p.x * qx > 0.02]
            col = [p for p in band if (Vector((p.x, p.y)) - Vector((foot.x, foot.y))).length < 0.32]
            if col:
                c = sum(col, Vector()) / len(col)
                ys = sorted(p.y for p in col)
                xs2 = sorted(p.x for p in col)
                print(f'   z {z:6.3f} c=({c.x:.3f},{c.y:.3f}) y {ys[0]:.3f}..{ys[-1]:.3f} x {xs2[0]:.3f}..{xs2[-1]:.3f} n={len(col)}')

# Back/belly along y at the midline band.
print('profile (y: belly..back, lateral half-width)')
for i in range(20):
    y0 = lo.y + (hi.y - lo.y) * i / 20
    y1 = lo.y + (hi.y - lo.y) * (i + 1) / 20
    sl = [p for p in pts if y0 <= p.y < y1]
    mid = [p for p in sl if abs(p.x) < 0.12]
    if not mid:
        continue
    zz = sorted(p.z for p in mid)
    upper = [p for p in mid if p.z > GROUND + 0.4 * h]
    belly = min((p.z for p in upper), default=float('nan'))
    hw = max(abs(p.x) for p in sl)
    print(f'  y {y0:6.3f}..{y1:6.3f}  low {zz[0]:6.3f} trunkBelly {belly:6.3f} top {zz[-1]:6.3f}  hw {hw:.3f}')

# Ears: the highest points in the front third, off the midline.
head = [p for p in pts if p.y < lo.y + 0.32 * (hi.y - lo.y)]
for qx in (1, -1):
    e = [p for p in head if p.x * qx > 0.05]
    if e:
        top = max(e, key=lambda p: p.z)
        print('ear', 'L' if qx > 0 else 'R', tuple(round(c, 3) for c in top))
nose = min(pts, key=lambda p: p.y)
print('nose', tuple(round(c, 3) for c in nose))
rump = max(pts, key=lambda p: p.y)
print('rump', tuple(round(c, 3) for c in rump))

obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True)
print('WROTE', OUT)
