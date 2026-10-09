"""Human hierarchy and stable anatomical frames, shared by sculpture and motion."""
import bpy
from mathutils import Vector,Matrix

def frame(a,b):
    a,b=Vector(a),Vector(b);y=(b-a).normalized();hint=Vector((0,-1,0))
    if abs(y.dot(hint))>.97:hint=Vector((0,0,1))
    x=y.cross(hint).normalized();z=x.cross(y).normalized()
    m=Matrix((x,y,z)).transposed().to_4x4();m.translation=a;return m

def landmarks(spec):
    w=spec['width'];p={'Root':(0,0,0),'Hips':(0,0,2.0),'Spine':(0,0,2.6),
      'Chest':(0,0,3.18),'Neck':(0,0,3.64),'Head':(0,-.02,3.88)}
    for s,v in [('L',1),('R',-1)]:
        p.update({f'UpperArm_{s}':(v*.65*w,0,3.4),f'Forearm_{s}':(v*.95*w,-.05,2.88),
         f'Hand_{s}':(v*.89*w,-.48,2.48),f'Thigh_{s}':(v*.32*w,0,2.),
         f'Shin_{s}':(v*.34*w,-.12,1.08),f'Foot_{s}':(v*.34*w,0,.20)})
    return {k:Vector(v) for k,v in p.items()}

def goad_tip(spec):
    return Vector((landmarks(spec)['Hand_R'].x,-2.35,2.535))

def definitions(spec):
    p=landmarks(spec);d=[]
    def bone(n,end,parent):d.append((n,p[n],p[end] if isinstance(end,str) else Vector(end),parent))
    bone('Root',(0,0,.3),None);bone('Hips','Spine','Root');bone('Spine','Chest','Hips')
    bone('Chest','Neck','Spine');bone('Neck','Head','Chest');bone('Head',(0,-.02,4.3),'Neck')
    for s in ['L','R']:
        for n,end,parent in [('UpperArm','Forearm','Chest'),('Forearm','Hand','UpperArm_'+s),
                              ('Thigh','Shin','Hips'),('Shin','Foot','Thigh_'+s)]:
            bone(n+'_'+s,end+'_'+s,parent)
        h=p['Hand_'+s];bone('Hand_'+s,h+Vector((0,0,-.24)),'Forearm_'+s)
        f=p['Foot_'+s];bone('Foot_'+s,f+Vector((0,-.4,0)),'Shin_'+s)
    for n,point,parent in [('Socket_Grip_R',p['Hand_R'],'Hand_R'),('Socket_Grip_L',p['Hand_L'],'Hand_L'),
      ('Lantern',(-1.43,-.48,3.4),'Hand_R'),('Socket_Lantern',(-1.43,-.48,2.64),'Lantern'),
      ('Socket_GoadTip',goad_tip(spec),'Hand_R'),('Yoke',(0,.06,3.48),'Chest'),
      ('Socket_Brazier_L',(1.08,.06,3.38),'Yoke'),('Socket_Brazier_R',(-1.08,.06,3.38),'Yoke')]:
        point=Vector(point);d.append((n,point,point+Vector((0,0,.15)),parent))
    return d

def build(spec,col):
    arm=bpy.data.armatures.new('BroodswornSkeleton');rig=bpy.data.objects.new('Broodsworn_Rig',arm)
    col.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for n,a,b,parent in definitions(spec):
        eb=arm.edit_bones.new(n);eb.head=a;eb.tail=b;eb.matrix=frame(a,b)
        if parent:eb.parent=arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
    return rig
