"""Independent measured skin, contact, attachment and temporal checks at 60 Hz."""
import sys,json,hashlib,math,gzip
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from config import BASE,SPECS,LOOPS,WALK_SPEED,RUN_SPEED,STANCE
key=sys.argv[sys.argv.index('--')+1];out=BASE/key;spec=SPECS[key]
rig=bpy.data.objects['Broodsworn_Rig'];meshes=[o for o in bpy.data.collections['Cultist_Export'].objects if o.type=='MESH']
errors=[];report={'clips':{},'model_sha256':hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()}
proof={'clips':{}};rigid={};rest_cache={}
for obj in meshes:
    groups={g.index:g.name for g in obj.vertex_groups};items={}
    for v in obj.data.vertices:
        live=[g for g in v.groups if g.weight>.99999]
        if len(live)==1 and groups[live[0].group] in ['Hand_L','Hand_R','Foot_L','Foot_R','Lantern','Yoke']:
            items.setdefault(groups[live[0].group],[]).append(v.index)
    rigid[obj.name]=items
    rest_cache[obj.name]={}
    for owner,indices in items.items():
        original=np.array([tuple(obj.data.vertices[j].co) for j in indices])
        rest=np.array(rig.data.bones[owner].matrix_local.inverted())
        expected=original@rest[:3,:3].T+rest[:3,3]
        rest_cache[obj.name][owner]=(expected,np.where(original[:,2]<.04)[0])
def check(ok,message):
    if not ok:errors.append(message)
yoke_landmarks={}
if key=='pyre_tender':
    for side,sgn in [('L',1),('R',-1)]:
        join=np.array((sgn*.80,.07,3.45));handle=[];beam=[]
        for obj in meshes:
            for owner,target,radius in [('Hand_'+side,handle,.04),('Yoke',beam,.23)]:
                for index in rigid[obj.name].get(owner,[]):
                    v=np.array(obj.data.vertices[index].co)
                    if np.linalg.norm(v-join)<radius:target.append((obj.name,index,v))
        check(len(handle)==6,f'{side} missing actual handle end ring')
        check(len(beam)>=6,f'{side} missing actual yoke near handle')
        if handle and beam:
            check(np.linalg.norm(np.mean([v for _,_,v in handle],axis=0)-join)<.005,f'{side} handle end misplaced')
            pair=min(((a,b) for a in handle for b in beam),key=lambda ab:np.linalg.norm(ab[0][2]-ab[1][2]))
            distance=float(np.linalg.norm(pair[0][2]-pair[1][2]))
            check(distance<.14,f'{side} handle does not meet yoke surface')
            yoke_landmarks[side]=(pair,distance)
for obj in meshes:
    for v in obj.data.vertices:
        ws=[g.weight for g in v.groups if g.weight>1e-7]
        check(1<=len(ws)<=4 and abs(sum(ws)-1)<1e-5 and all(math.isfinite(w) for w in ws),'Invalid skin '+obj.name)
check(set(a.name for a in bpy.data.actions)==set(spec['clips']),'Action vocabulary mismatch')
for name,duration in spec['clips'].items():
    rig.animation_data.action=bpy.data.actions[name];allhands=[];allrot=[];soles=[];feet=[];minz=1e9
    starts=None;ends=None;attachment=0.;elbowAngles=[];native_samples=[];cloud_samples=[];bone_frames=[]
    sole_tracks=[];rigid_error=0.;plane_normals=[];tip_error=0.;tip_samples=0;yoke_seam=0.
    for i in range(round(duration*60)+1):
        t=i/60;bpy.context.scene.frame_set(1+i//2,subframe=(i%2)*.5);dg=bpy.context.evaluated_depsgraph_get()
        cloud=[];cloud_groups={};sole_points={'L':[],'R':[]};actual_world={}
        for obj in meshes:
            ev=obj.evaluated_get(dg);me=ev.to_mesh();coords=np.empty(len(me.vertices)*3);me.vertices.foreach_get('co',coords)
            coords=coords.reshape(-1,3);m=np.array(ev.matrix_world);world=coords@m[:3,:3].T+m[:3,3]
            minz=min(minz,float(world[:,2].min()));cloud.append(world);actual_world[obj.name]=world;ev.to_mesh_clear()
            if key=='goadsmith' and obj.data.materials[0].name=='Ember':
                tip=np.array(rig.pose.bones['Socket_GoadTip'].matrix.translation)
                tip_error=max(tip_error,float(np.min(np.linalg.norm(world-tip,axis=1))))
                tip_samples+=len(world)
            cloud_groups.setdefault(obj.data.materials[0].name,[]).extend(world[::40].round(6).tolist())
            for owner,indices in rigid[obj.name].items():
                posed=world[indices];pm=np.array(rig.pose.bones[owner].matrix.inverted())
                local=posed@pm[:3,:3].T+pm[:3,3]
                expected,floor_indices=rest_cache[obj.name][owner]
                rigid_error=max(rigid_error,float(np.abs(local-expected).max()))
                if owner.startswith('Foot_'):
                    sole_points[owner[-1]].extend(posed[floor_indices].tolist())
        cloud=np.concatenate(cloud)
        if i==0:starts=cloud.copy();report['height']=float(cloud[:,2].max()-cloud[:,2].min()) if name=='Idle' else report.get('height')
        if name=='Idle' and i==30:
            report['height']=float(cloud[:,2].max()-cloud[:,2].min())
            report['placement_min_z']=float(cloud[:,2].min())
            report['placement_sample_seconds']=.5
        ends=cloud
        # A stable subset of actual deformed vertices for raw/optimized export parity.
        if i%12==0 or i==round(duration*60):
            native_samples.append({'time':t,'bounds':[cloud.min(axis=0).tolist(),cloud.max(axis=0).tolist()]})
            cloud_samples.append({'time':t,'groups':cloud_groups})
        bone_frames.append([round(float(c),6) for pb in rig.pose.bones for c in pb.matrix.translation])
        sole_tracks.append(sole_points)
        hands=[];rots=[];fs=[];angles=[];planes=[]
        for side in ['L','R']:
            mats=[rig.pose.bones[n+'_'+side].matrix for n in ['UpperArm','Forearm','Hand']]
            a,e,h=[m.translation for m in mats];v=(a-e).normalized();u=(h-e).normalized()
            angles.append(math.degrees(math.acos(max(-1,min(1,v.dot(u))))))
            planes.append(v.cross(u).normalized())
            hands.extend(h);hands.extend(e)
            fs.append(tuple(rig.pose.bones['Foot_'+side].matrix.translation))
            grip=rig.pose.bones['Socket_Grip_'+side]
            rest=rig.data.bones['Hand_'+side].matrix_local.inverted()@grip.bone.matrix_local
            now=mats[2].inverted()@grip.matrix
            attachment=max(attachment,max(abs(now[r][c]-rest[r][c]) for r in range(4) for c in range(4)))
            if key=='pyre_tender':
                join=Vector((.80 if side=='L' else -.80,.07,3.45))
                hand_point=mats[2]@rig.data.bones['Hand_'+side].matrix_local.inverted()@join
                yoke_point=rig.pose.bones['Yoke'].matrix@rig.data.bones['Yoke'].matrix_local.inverted()@join
                yoke_seam=max(yoke_seam,(hand_point-yoke_point).length)
                if side in yoke_landmarks:
                    (a,b),rest_distance=yoke_landmarks[side]
                    distance=float(np.linalg.norm(actual_world[a[0]][a[1]]-actual_world[b[0]][b[1]]))
                    yoke_seam=max(yoke_seam,abs(distance-rest_distance))
        rots=[pb.matrix.to_quaternion().copy() for pb in rig.pose.bones]
        allhands.append(hands);allrot.append(rots);feet.append(fs);elbowAngles.append(angles)
        plane_normals.append(planes)
    hands=np.array(allhands);acc=np.diff(hands,n=2,axis=0)*3600
    contact_proof=None
    contacts={'Attack':25,'Attack2':27,'WarmingRite':76,'Goad':61,'ReRivet':181,'PlantBrazier':46}
    if name in contacts:
        marker=bpy.data.actions[name].pose_markers.get('CONTACT')
        check(marker is not None and marker.frame==contacts[name],f'{name} native contact marker differs')
        index=(contacts[name]-1)*2
        side=0 if name=='WarmingRite' else 6
        trajectory=hands[:,side:side+3]
        excursion=np.linalg.norm(trajectory-trajectory[0],axis=1)
        before=max(0,index-18);after=min(len(excursion)-1,index+18)
        check(excursion[index]>excursion[before]+.005 and excursion[index]>excursion[after]+.005,
              f'{name} contact has no distinct gesture peak')
        contact_proof={'native_frame':contacts[name],'time':index/60,
          'hand_excursion':[float(excursion[before]),float(excursion[index]),float(excursion[after])]}
    # Alternating-frame jitter is distinct from a broad impact/anticipation gesture.
    high=np.diff(hands,n=3,axis=0);jitter=float(np.max(np.linalg.norm(high.reshape(-1,4,3),axis=2)))
    maxflip=0.
    for prev,now in zip(allrot,allrot[1:]):
        maxflip=max(maxflip,max(2*math.acos(min(1,abs(a.dot(b)))) for a,b in zip(prev,now)))
    foot_error=0.;feet=np.array(feet)
    if name in ('Walk','Run'):
        speed=WALK_SPEED if name=='Walk' else RUN_SPEED
        for j,offset in [(0,0),(1,.5)]:
            for i in range(len(feet)-1):
                q=((i/60)/duration+offset)%1;q2=(((i+1)/60)/duration+offset)%1
                if q<STANCE-1e-6 and q2<=STANCE+1e-6 and q2>q:
                    delta=feet[i+1,j]-feet[i,j];delta[1]-=speed/60
                    foot_error=max(foot_error,float(np.linalg.norm(delta)))
                    side='L' if j==0 else 'R';a=np.array(sole_tracks[i][side]);b=np.array(sole_tracks[i+1][side])
                    check(len(a)>0,f'{name} missing sole landmarks')
                    movement=b-a;movement[:,1]-=speed/60
                    foot_error=max(foot_error,float(np.max(np.linalg.norm(movement,axis=1))))
                    check(float(a[:,2].min())<.05,f'{name} stance foot floats')
        check(foot_error<.002,f'{name} support slides {foot_error}')
    elif name!='Death':
        foot_error=float(np.abs(feet-feet[0]).max());check(foot_error<.002,f'{name} static foot drift {foot_error}')
    check(minz>=-.015,f'{name} ground penetration {minz}')
    check(attachment<1e-4,f'{name} detached grip {attachment}')
    check(rigid_error<.0002,f'{name} detached rigid prop or boot {rigid_error}')
    if key=='goadsmith':
        check(tip_samples>0,f'{name} missing incandescent tip geometry')
        check(tip_error<.008,f'{name} goad socket misses incandescent tip {tip_error}')
    if key=='pyre_tender':check(yoke_seam<.002,f'{name} hand handle detaches from yoke {yoke_seam}')
    check(all(a.dot(b)>.8 for prev,now in zip(plane_normals,plane_normals[1:]) for a,b in zip(prev,now)),f'{name} elbow bend-plane reversal')
    check(maxflip<.35,f'{name} limb flip {maxflip}')
    check(jitter<.012,f'{name} hand tremor {jitter}')
    looperr=float(np.max(np.linalg.norm(ends-starts,axis=1)))
    if name in LOOPS:
        check(looperr<.0015,f'{name} loop opens {looperr}')
        seam=np.max(np.abs((hands[1]-hands[0])-(hands[-1]-hands[-2])))*60
        check(seam<.4,f'{name} loop velocity seam {seam}')
    if name=='Idle':check(max(np.array(elbowAngles).flatten())<170,'Idle locked elbows')
    report['clips'][name]={'samples60Hz':len(feet),'min_z':minz,'support_error':foot_error,
       'grip_error':attachment,'rigid_vertex_error':rigid_error,'max_bone_rotation_step':maxflip,'arm_third_difference':jitter,
       'max_hand_acceleration':float(np.abs(acc).max()),'loop_error':looperr,
       'elbow_range':[float(np.min(elbowAngles)),float(np.max(elbowAngles))], 'native_bounds':native_samples,
       'contact_gesture':contact_proof,'goad_tip_vertex_distance':tip_error if key=='goadsmith' else None,
       'yoke_handle_seam':yoke_seam if key=='pyre_tender' else None}
    proof['clips'][name]={'bone_frames':bone_frames,'clouds':cloud_samples}
proof['bones']=[b.name for b in rig.pose.bones]
with gzip.open(out/'native_geometry.json.gz','wt',encoding='utf-8') as f:json.dump(proof,f,separators=(',',':'))
report['geometry_sha256']=hashlib.sha256((out/'native_geometry.json.gz').read_bytes()).hexdigest()
report['errors']=sorted(set(errors));report['status']='FAIL' if errors else 'PASS'
report['validator_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
(out/'native_validation.json').write_text(json.dumps(report,indent=2))
print('NATIVE',report['status'],report['errors'],flush=True)
if errors:raise RuntimeError('Native acceptance failed')
