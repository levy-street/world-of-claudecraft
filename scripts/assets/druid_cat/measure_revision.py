import bpy, sys, json, math, hashlib, struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from motion import reset
rig=bpy.data.objects['DruidCat_Rig']
mesh=bpy.data.objects['Druid_Cat_form']
rig.animation_data.action=None
reset(rig)
bpy.context.view_layer.update()
bone_names=['DEF-spine.004','DEF-spine.008','DEF-spine.011','DEF-front_toe.L','DEF-front_toe.R','DEF-toe.L','DEF-toe.R']
def sample():
    rig.update_tag()
    bpy.context.view_layer.update()
    bones={n:list(rig.pose.bones[n].tail if 'toe' in n else rig.pose.bones[n].head) for n in bone_names}
    obj=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    points=[v.co.copy() for v in obj.data.vertices]
    return bones,points
rest,rest_mesh=sample()
source_hash=hashlib.sha256(b''.join(struct.pack('3f',*v.co) for v in mesh.data.vertices)).hexdigest()
report={'source_mesh_hash':source_hash,'actions':{}}
actions=[a for a in bpy.data.actions if a.get('authored_for')==rig.name]
for a in actions:
    rig.animation_data.action=a
    n=round(a['duration_seconds']*30)
    records=[]
    reach={name:0.0 for name in ['front_foot_ik.L','front_foot_ik.R','foot_ik.L','foot_ik.R']}
    minimum=math.inf
    first=None
    for k in range(n*2+1):
        f=1+k/2
        bpy.context.scene.frame_set(int(f),subframe=f-int(f))
        b,points=sample()
        for ik in reach:
            deform=('DEF-front_toe.' if ik.startswith('front') else 'DEF-toe.')+ik[-1]
            error=(rig.pose.bones[ik].head-rig.pose.bones[deform].tail).length
            reach[ik]=max(reach[ik],error)
        assert all(math.isfinite(x) for p in points for x in p),a.name
        if first is None: first=points
        minimum=min(minimum,min(p.z for p in points))
        records.append(b)
    closure=max((x-y).length for x,y in zip(first,points))
    if a.get('loop'): assert closure<3e-5,(a.name,closure)
    ranges={name:[max(p[name][i] for p in records)-min(p[name][i] for p in records) for i in range(3)] for name in bone_names}
    contact_drift={name:max(math.dist(p[name],rest[name]) for p in records) for name in ['DEF-toe.L','DEF-toe.R']}
    elevations=[p['DEF-spine.008'][2]-p['DEF-spine.004'][2] for p in records]
    report['actions'][a.name]={'ranges':ranges,'min_mesh_z':minimum,'closure':closure,
                             'ik_reach_error':reach,
                             'hind_contact_max_displacement':contact_drift,
                             'shoulder_above_hip_max':max(elevations),'samples':records}
rig.animation_data.action=None
reset(rig)
bpy.context.view_layer.update()
_,points=sample()
report['neutral_max_error']=max((x-y.co).length for x,y in zip(points,mesh.data.vertices))
assert report['neutral_max_error']<3e-5
path=Path(bpy.data.filepath).with_suffix('.metrics.json')
path.write_text(json.dumps(report,indent=2))
print('MOTION_METRICS',json.dumps({k:{x:y for x,y in v.items() if x!='samples'} for k,v in report['actions'].items() if k in ['Run','Walk','Attack_Left','Attack_Right','Finisher','Bite']},indent=2))
