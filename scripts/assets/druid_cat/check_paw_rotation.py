"""Verify outward anticipation, followed by the established inward wrist rake."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector
p=Path(__file__).resolve().parent.parent
cases=[('Attack_Left','L',5,8,10,19),('Attack_Right','R',5,8,10,19),
       ('Finisher','L',5,6,8,28),('Finisher','R',15,16,18,28)]
def sample(path):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    rig=bpy.data.objects['DruidCat_Rig']
    results={}
    for action,side,wind,arc,strike,end in cases:
        rig.animation_data.action=bpy.data.actions[action]
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        toe=rig.pose.bones['DEF-front_toe.'+side]
        rest_pad=Vector((1,0,0)).cross((toe.tail-toe.head).normalized()).normalized()
        local_pad=toe.matrix.to_quaternion().inverted()@rest_pad
        values={}
        for frame in [1,wind,arc,strike,end]:
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            bone=rig.pose.bones['DEF-front_toe.'+side]
            values[frame]={'direction':list((bone.tail-bone.head).normalized()),
                           'orientation':list(bone.matrix.to_quaternion()),
                           'pad_normal':list(bone.matrix.to_quaternion()@local_pad)}
        results[action+side]=values
    return results
before=sample(p/'Before.blend')
after=sample(p/'Druid_Cat_Form_Animation_v11.blend')
checks=[]
for action,side,wind,arc,strike,end in cases:
    key=action+side
    sign=1 if side=='L' else -1
    old_q=before[key][wind]['orientation'];new_q=after[key][wind]['orientation']
    rotation=math.degrees(2*math.acos(min(1,abs(sum(x*y for x,y in zip(old_q,new_q))))))
    outward=sign*after[key][wind]['direction'][0]
    checks.append({'action':action,'side':side,'windup_outward_component':outward,
                   'windup_rotation_change_degrees':rotation,'passed':outward>.45})
    for frame in [arc,strike]:
        new=after[key][frame]['direction'];pad=after[key][frame]['pad_normal']
        checks.append({'action':action,'side':side,'frame':frame,'inward_claw_component':-sign*new[0],
                       'pad_inward_component':-sign*pad[0],'pad_body_component':pad[1],
                       'passed':-sign*new[0]>.8 and -sign*pad[0]>.05 and pad[1]>.7})
    restored=math.dist(after[key][1]['orientation'],after[key][end]['orientation'])
    checks.append({'action':action,'side':side,'restored_orientation_error':restored,'passed':restored<1e-4})
report={'passed':all(c['passed'] for c in checks),'checks':checks}
(p/'paw-rotation-validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
assert report['passed']
