"""Author the full cat clip vocabulary on editable Rigify controls at 30 fps.

Load this module from Blender MCP after rig.py and weights.py. The sampled paw
stance is linear in time, with eased aerial recovery; root travel remains zero
for locomotion and jumping. Inspect before exporting.
"""
import bpy
import json
from motion import bake, gait, idle, reset
import poses

rig=bpy.data.objects['DruidCat_Rig']
CLIPS=[
    ('Idle',120,lambda t:idle(t),True),
    ('Idle_Look',120,poses.look,False),
    ('CombatIdle',90,lambda t:idle(t,3,alert=True),True),
    ('Walk',27,lambda t:gait(t,.9,.40,.48,.065),True),
    ('WalkBack',30,lambda t:gait(t,1,.40,.25,.065,'back'),True),
    ('Run',18,lambda t:gait(t,.6,.40,.22,.12,'run'),True),
    ('ProwlIdle',120,lambda t:idle(t,4,prowl=True),True),
    ('ProwlWalk',30,lambda t:gait(t,1,.40,.22,.07,'prowl'),True),
    ('Jump',12,poses.jump,False),('Land',12,poses.land,False),
    ('Fall',30,lambda t:poses.blend(poses.GLIDE,poses.GLIDE,0),True),
    ('Attack_Left',18,lambda t:poses.swipe(t,'L'),False),
    ('Attack_Right',18,lambda t:poses.swipe(t,'R'),False),
    ('Bite',18,poses.bite,False),('Pounce',21,poses.pounce,False),
    ('Finisher',27,poses.finisher,False),
    ('Hit_Left',12,lambda t:poses.hit(t,'L'),False),
    ('Hit_Right',12,lambda t:poses.hit(t,'R'),False),
    ('Death',36,poses.death,False),
    ('SitDown',24,lambda t:poses.timeline([(0,{}),(.8,poses.SIT)],t),False),
    ('Sit',120,poses.sit,True),
    ('Swim',24,lambda t:poses.swim(t,.8,submerged=True),True),
    ('SwimSurface',30,lambda t:poses.swim(t,1),True),
    ('SwimIdle',48,lambda t:poses.swim(t,1.6,rest=True),True),
    # Long deliberate lifted steps; the per-cat runtime reference is measured.
    ('Wade',30,lambda t:gait(t,1,.40,.25,.085),True),
    ('Rise',30,poses.rise,False),
]
rig.animation_data_create()
rig.animation_data.action=None
for name,frames,sample,loop in CLIPS:
    previous=bpy.data.actions.get(name)
    if previous:
        bpy.data.actions.remove(previous)
    action=bake(rig,name,frames,sample)
    action['loop']=loop
    action['authored_for']='DruidCat_Rig'
rig.animation_data.action=None
reset(rig)
bpy.context.scene.frame_start=1
bpy.context.scene.frame_end=121
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print(json.dumps({'clips':[{'name':n,'seconds':f/30,'loop':loop} for n,f,_,loop in CLIPS]},indent=2))
