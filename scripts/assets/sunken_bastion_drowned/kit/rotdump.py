"""Per-frame angular speed (deg/frame) of bones over a window: blender -b x.blend --python rotdump.py -- Clip t0 t1 B1,B2"""
import sys, math
import bpy
argv = sys.argv[sys.argv.index('--') + 1:]
c, t0, t1, bones = argv[0], float(argv[1]), float(argv[2]), argv[3].split(',')
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
act = bpy.data.actions[c]
arm.animation_data.action = act
if act.slots:
    arm.animation_data.action_slot = act.slots[0]
prev = {}
for f in range(int(1 + t0 * 24), int(2 + t1 * 24)):
    bpy.context.scene.frame_set(f)
    row = []
    for b in bones:
        q = arm.pose.bones[b].matrix.to_quaternion()
        if b in prev:
            a = math.degrees(prev[b].rotation_difference(q).angle)
            row.append(f'{b}:{min(a, 360 - a):6.1f}')
        prev[b] = q
    el = arm.pose.bones['R_Forearm'].head; hd = arm.pose.bones['R_Hand'].head
    q = arm.pose.bones['R_UpperArm'].rotation_quaternion
    row.append(f'elbow=({el.x:.2f},{el.y:.2f},{el.z:.2f}) wrist=({hd.x:.2f},{hd.y:.2f},{hd.z:.2f}) uroll={math.degrees(2*math.atan2(q.y,q.w)):.0f}')
    print('ROT', f, f'{(f - 1) / 24:.2f}', ' '.join(row))
