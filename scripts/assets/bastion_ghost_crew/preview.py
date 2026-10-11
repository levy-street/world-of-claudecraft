"""Render a reproducible sculpt/clip review, from a baked blend file."""
import os
import sys
import math
import bpy
from mathutils import Vector
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
sys.path.insert(1,os.path.join(HERE,'..','sunken_bastion_drowned','kit'))
import stage
import rig
args=sys.argv[sys.argv.index('--')+1:]
out=args[0]
arm=next((o for o in bpy.context.scene.objects if o.type=='ARMATURE'),None)
for obj in bpy.context.scene.objects:
    if obj.name.endswith('_hi'): obj.hide_render=True
cam=stage.setup(res=(1200,1200),ground=True,sky=(.035,.06,.065),ref_at=(2,-.2,0))
if arm:
    clip=args[1] if len(args)>1 else 'Idle'
    rig.set_action(arm,bpy.data.actions[clip])
    bpy.context.scene.frame_set(1+int((float(args[2]) if len(args)>2 else 0)*24))
    target=Vector((0,0,2.3));cam.location=(7,-11,6)
else:
    target=Vector((0,0,6));cam.location=(26,-33,22)
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.render.filepath=os.path.abspath(out)
bpy.ops.render.render(write_still=True)
