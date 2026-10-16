"""Baked stable analytic two-bone poses; all keys are editable native actions."""
import math,bpy
from mathutils import Vector,Matrix,Euler
from skeleton import landmarks,definitions,frame
from config import LOOPS,STANCE

def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def bump(t,start,peak,end):return smooth((t-start)/(peak-start)) if t<peak else 1-smooth((t-peak)/(end-peak))
def casting(clip,t,duration):
    if clip in ('WarmingRite','Goad','PlantBrazier','ReRivet','ThawTheHeld'):
        contact={'WarmingRite':2.5,'Goad':2.,'PlantBrazier':1.5,'ReRivet':6.,'ThawTheHeld':3.}[clip]
        return .72*smooth(t/.55)*(1-smooth((t-contact)/.6))+.28*bump(t,contact-.4,contact,contact+.6)
    return .55+.08*math.sin(math.tau*t/duration) if clip=='Cast' else 0
def ik(a,c,l1,l2,pole):
    delta=c-a;d=max(.001,min(delta.length,l1+l2-.005));axis=delta.normalized()
    bend=Vector(pole)-axis*axis.dot(Vector(pole));bend.normalize()
    x=(l1*l1-l2*l2+d*d)/(2*d);return a+axis*x+bend*math.sqrt(max(.00001,l1*l1-x*x))

def pose(rig,spec,clip,t,duration):
    p=landmarks(spec);ds={n:(a,b,parent) for n,a,b,parent in definitions(spec)}
    gait=clip in ('Walk','Run');period=duration;phase=t/period
    breath=duration if clip in LOOPS else 3.2
    dead=smooth((t-.3)/2.2) if clip=='Death' else 0
    tender=spec.get('key')=='pyre_tender'
    attack=bump(t,.1,.8,1.4) if clip=='Attack' else bump(t,.1,26/30,1.5) if clip=='Attack2' else 0
    lean=.025*math.sin(math.tau*t/breath)
    if gait:lean=.10 if clip=='Run' else .025
    hit=bump(t,0,.18,.7) if clip=='Hit' else 0
    lean-=hit*.13
    cast=casting(clip,t,duration)
    thaw=cast if clip=='ThawTheHeld' else 0
    rip=bump(t,2.75,3.,3.6) if clip=='ThawTheHeld' else 0
    if spec.get('key')=='thawcaller':lean+=.09*cast if not thaw else .85*thaw-.75*rip
    if spec.get('key')=='goadsmith':lean+=.10*attack+.12*cast
    if tender:lean+=.22*attack+.26*cast
    root=Matrix.Translation((0,0,0))
    if dead:
        root=Matrix.Translation((0,0,.06*dead))@Euler((dead*math.pi/2,0,0)).to_matrix().to_4x4()
        lean*=1-dead
    spine=Matrix.Translation((0,0,2.0))@Euler((lean,0,.02*math.sin(math.tau*t/breath))).to_matrix().to_4x4()@Matrix.Translation((0,0,-2.0))
    bob=(-.09 if clip=='Walk' else -.23)+.035*math.cos(math.tau*2*phase) if gait else .012*math.sin(math.tau*t/breath)
    if tender:bob-=.12*attack+.18*cast
    if thaw:bob-=.42*thaw-.28*rip
    shift=-.25*attack-.15*cast if tender else 0
    positions={n:spine@v+Vector((0,shift,bob)) for n,v in p.items()}
    mats={'Root':root}
    for n,end in [('Hips','Spine'),('Spine','Chest'),('Chest','Neck'),('Neck','Head')]:mats[n]=root@frame(positions[n],positions[end])
    mats['Head']=root@frame(positions['Head'],positions['Head']+Vector((0,0,.42)))
    if tender:
        mats['Yoke']=mats['Chest']@rig.data.bones['Chest'].matrix_local.inverted()@Matrix.Translation((0,.25*dead,0))@rig.data.bones['Yoke'].matrix_local
    for s,sgn in [('L',1),('R',-1)]:
        upper='UpperArm_'+s;fore='Forearm_'+s;hand='Hand_'+s
        a=positions[upper];h=positions[hand].copy()
        if gait and not (s=='R' or spec.get('key')=='pyre_tender'):
            h.y+=.22*math.sin(math.tau*(phase+(0 if s=='L' else .5)))
        if s=='R':h+=Vector((attack*.13,-attack*.56,attack*.2))
        if s=='R' and spec.get('key')=='goadsmith':h.z-=attack*.65
        if clip=='Attack2' and s=='R':h+=Vector((attack*.45,attack*.23,attack*.06))
        if thaw and s=='L':
            # Clawing down at the corpse's ice, then ripping the soul up out of it.
            h+=Vector((-.05*thaw,-.95*thaw,-.85*thaw+.08*math.sin(math.tau*t*1.6)*thaw))+Vector((.10*rip,.35*rip,2.1*rip))
        elif thaw and s=='R':
            # The censer swung out low over the body, circling as the bar fills.
            h+=Vector((.22*thaw+.12*math.sin(math.tau*t*.8)*thaw,-.95*thaw,-.30*thaw))+Vector((0,.30*rip,1.1*rip))
        elif s=='L':h+=Vector((-.20*cast,-.55*cast,.95*cast)) if spec.get('key')=='thawcaller' else Vector((-.08*cast,-.40*cast,.60*cast))
        if s=='R' and spec.get('key')=='thawcaller' and not thaw:h+=Vector((0,-.08*cast,.12*cast))
        if clip in ('Goad','ReRivet') and s=='R':h+=Vector((.1*cast,-.34*cast,.14*cast))
        if clip=='PlantBrazier':h.z-=.34*cast
        if dead:h+=Vector((sgn*.22*dead,.28*dead,-.08*dead))
        if tender:
            held=mats['Yoke']@rig.data.bones['Yoke'].matrix_local.inverted()@rig.data.bones[hand].matrix_local
            h=root.inverted()@held.translation
        l1=(p[fore]-p[upper]).length;l2=(p[hand]-p[fore]).length
        reach=(h-a).length;soft=(l1+l2)*.90;span=(l1+l2)*.07
        if reach>soft and not tender:h=a+(h-a).normalized()*(soft+span*(1-math.exp(-(reach-soft)/span)))
        e=ik(a,h,l1,l2,(sgn, .45,-.1))
        mats[upper]=root@frame(a,e);mats[fore]=root@frame(e,h)
        mats[hand]=root@frame(h,h+Vector((0,0,-.24)))
        if tender:mats[hand]=held
        if s=='R' and spec.get('key')=='goadsmith':
            # Keep the long iron beside the fallen body instead of spearing
            # the floor and forcing the corpse upward during contact solving.
            local=frame(h,h+Vector((0,0,-.24)))
            rotation=Euler((.15*cast+.18*attack-dead*math.pi/2,0,0)).to_matrix().to_4x4()@local.to_3x3().to_4x4()
            rotation.translation=h;mats[hand]=root@rotation
        thigh='Thigh_'+s;shin='Shin_'+s;foot='Foot_'+s;a=positions[thigh];f=p[foot].copy()
        if gait:
            q=(phase+(0 if s=='L' else .5))%1;stride=.9 if clip=='Walk' else 1.8
            if q<STANCE:f.y=-stride/2+stride*q/STANCE
            else:
                u=(q-STANCE)/(1-STANCE);f.y=stride/2-stride*smooth(u)
                f.z+=(.24 if clip=='Walk' else .43)*math.sin(math.pi*u)**2
        k=ik(a,f,(p[shin]-p[thigh]).length,(p[foot]-p[shin]).length,(0,-1,0))
        mats[thigh]=root@frame(a,k);mats[shin]=root@frame(k,f);mats[foot]=root@frame(f,f+Vector((0,-.4,0)))
    for n,a,b,parent in definitions(spec):
        if n in mats:continue
        parentRest=rig.data.bones[parent].matrix_local
        m=mats[parent]@parentRest.inverted()@rig.data.bones[n].matrix_local
        if n=='Lantern':
            sw=1+2.2*(cast if clip=='ThawTheHeld' else 0)
            m=m@Euler((.13*sw*math.sin(math.tau*t/breath*sw)+attack*.38,0,.10*sw*math.cos(math.tau*t/breath*sw))).to_matrix().to_4x4()
        mats[n]=m
    for n,_,_,parent in definitions(spec):
        rest=rig.data.bones[n].matrix_local
        basis=rest.inverted()@mats[n] if not parent else rest.inverted()@rig.data.bones[parent].matrix_local@mats[parent].inverted()@mats[n]
        rig.pose.bones[n].matrix_basis=basis
    bpy.context.view_layer.update()

def bake(rig,spec,meshes):
    from config import CONTACTS
    for name,duration in spec['clips'].items():
        action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data_create();rig.animation_data.action=action
        count=round(duration*60)
        previous={}
        for i in range(count+1):
            frame_number=i*.5+1
            bpy.context.scene.frame_set(int(frame_number),subframe=frame_number%1);pose(rig,spec,name,i/60,duration)
            if name=='Death':
                dg=bpy.context.evaluated_depsgraph_get();low=0.
                for obj in meshes:
                    ev=obj.evaluated_get(dg);me=ev.to_mesh()
                    low=min(low,min((ev.matrix_world@v.co).z for v in me.vertices));ev.to_mesh_clear()
                rig.pose.bones['Root'].matrix=Matrix.Translation((0,0,-low))@rig.pose.bones['Root'].matrix
                bpy.context.view_layer.update()
            for pb in rig.pose.bones:
                pb.rotation_mode='QUATERNION'
                if pb.name in previous and pb.rotation_quaternion.dot(previous[pb.name])<0:pb.rotation_quaternion.negate()
                previous[pb.name]=pb.rotation_quaternion.copy()
                pb.keyframe_insert('location',frame=frame_number)
                pb.keyframe_insert('rotation_quaternion',frame=frame_number);pb.keyframe_insert('scale',frame=frame_number)
        for slot in action.slots:
            for layer in action.layers:
                for strip in layer.strips:
                    bag=strip.channelbag(slot)
                    if bag:
                        for fc in bag.fcurves:
                            for k in fc.keyframe_points:k.interpolation='LINEAR'
        if name in CONTACTS:
            marker=action.pose_markers.new('CONTACT');marker.frame=round(CONTACTS[name]*30)+1
        action['loop']=name in LOOPS;action['duration']=duration
    rig.animation_data.action=bpy.data.actions['Idle'];bpy.context.scene.frame_set(1)
