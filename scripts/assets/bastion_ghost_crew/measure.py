"""Measure authored bounds and effect anchors on the evaluated skinned mesh."""
import json
import os
import sys
import bpy
import numpy as np
from mathutils import Vector
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
sys.path.insert(1,os.path.join(HERE,'..','sunken_bastion_drowned','kit'))
import rig
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
meshes=[o for o in arm.children if o.type=='MESH']

def bounds(clip,t):
    rig.set_action(arm,bpy.data.actions[clip])
    frame=1+t*24
    bpy.context.scene.frame_set(int(frame),subframe=frame-int(frame))
    dg=bpy.context.evaluated_depsgraph_get()
    pts=[]
    for mesh in meshes:
        ev=mesh.evaluated_get(dg)
        pts.extend([tuple(ev.matrix_world@v.co) for v in ev.data.vertices])
    arr=np.array(pts)
    return {'min':arr.min(axis=0).tolist(),'max':arr.max(axis=0).tolist(),'extent':np.ptp(arr,axis=0).tolist()}

out={'idle':bounds('Idle',0)}
out['anchors']={}
for key,bone in [('head','Head'),('chest','Spine2')]:
    pb=arm.pose.bones[bone]
    p=arm.matrix_world@((pb.head+pb.tail)*.5)
    out['anchors'][key]=[p.x,p.z,-p.y]
death=bpy.data.actions['Death']
t=(death.frame_range[1]-death.frame_range[0])/24
out['death_end']=bounds('Death',t)
out['death_duration']=t
assert max(out['death_end']['extent']) < .001, 'Death must dissolve fully, not freeze a standing corpse'
argv=sys.argv[sys.argv.index('--')+1:]
with open(argv[0],'w') as f: json.dump(out,f,indent=2)
print(json.dumps(out),flush=True)
