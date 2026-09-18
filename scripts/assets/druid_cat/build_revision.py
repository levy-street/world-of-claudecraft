"""Open Before.blend, replace only requested movement and strike actions."""
import sys, json
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import motion
import revision_motion as v11
rig=bpy.data.objects['DruidCat_Rig']
rig.animation_data.action=None
clips=[
    ('Attack_Left',18,lambda t:v11.swipe(t,'L'),False),
    ('Attack_Right',18,lambda t:v11.swipe(t,'R'),False),
    ('Finisher',27,v11.finisher,False),
]
for name, frames, sample, loop in clips:
    previous=bpy.data.actions[name]
    bpy.data.actions.remove(previous)
    action=motion.bake(rig,name,frames,sample)
    action['loop']=loop
    action['authored_for']=rig.name
    action['revision']='v11 small hind-leg rise into the swipe'
rig.animation_data.action=None
motion.reset(rig)
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE.parent/'Druid_Cat_Form_Animation_v11.blend'))
print('REVISED_ACTIONS',json.dumps([c[0] for c in clips]))
