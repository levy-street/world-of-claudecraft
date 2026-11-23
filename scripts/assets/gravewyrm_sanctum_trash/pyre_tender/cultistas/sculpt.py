"""Layered fitted garments, anatomical limbs and original cultist identity."""
import math,random
from mathutils import Vector
from geometry import Batch,catmull,tube
from surfaces import uv_and_finish
from skeleton import landmarks

def loft(batch,rings,weight,segments=24,fold=.0):
    vs=[];ws=[];fs=[]
    for j,(z,rx,ry,cy) in enumerate(rings):
        for i in range(segments):
            a=math.tau*i/segments;f=1+fold*math.cos(a*9+.2*j)
            v=(rx*math.cos(a)*f,cy+ry*math.sin(a)*f,z)
            vs.append(v);ws.append(weight(v) if callable(weight) else weight)
        if j:
            for i in range(segments):
                a=(j-1)*segments+i;b=(j-1)*segments+(i+1)%segments;c=j*segments+i;d=j*segments+(i+1)%segments
                fs.extend([(a,b,c),(b,d,c)])
    fs.extend([tuple(reversed(range(segments))),tuple(range((len(rings)-1)*segments,len(rings)*segments))])
    batch.add(vs,fs,ws)

def limb(batch,a,b,c,radii,bones):
    points=catmull([a,b,c],4);rs=[];weights=[]
    for i,p in enumerate(points):
        t=i/(len(points)-1);u=t*2
        rs.append(radii[0]*(1-u)+radii[1]*u if u<=1 else radii[1]*(2-u)+radii[2]*(u-1))
        blend=max(0,min(1,(t-.37)/.26));weights.append({bones[0]:1-blend,bones[1]:blend})
    tube(batch,points,rs,weights,16)

def line(batch,pts,r,weight):
    points=catmull(pts,3);tube(batch,points,[r]*len(points),[weight]*len(points),6)

def body(key,spec,mats,col,rig,detail=1):
    b={n:Batch('Cultist_'+n,m) for n,m in mats.items()};p=landmarks(spec);w=spec['width']
    def torso(v):
        t=max(0,min(1,(v[2]-2.4)/.65));return {'Spine':1-t,'Chest':t}
    loft(b['Cloth'],[(1.9,.43*w,.31,0),(2.2,.48*w,.34,0),(2.55,.48*w,.31,0),
       (2.95,.65*w,.38,0),(3.35,.72*w,.37,0),(3.55,.39*w,.26,0)],torso,32,.025)
    # Split skirts expose the stepping boots. Front panels bend with their own thigh.
    for s,sgn in [('L',1),('R',-1)]:
        thigh=p['Thigh_'+s];knee=p['Shin_'+s];foot=p['Foot_'+s]
        limb(b['Cloth'],thigh,knee,foot+Vector((0,0,.21)),(.24*w,.20,.14),['Thigh_'+s,'Shin_'+s])
        # Broad flat soles; upper boot curves cover shin transitions.
        rings=[(.0,.225,.39,-.13),(.13,.24,.42,-.13),(.3,.21,.34,-.10),(.49,.18,.22,0),(.73,.18,.19,0)]
        local=Batch('boot',mats['Leather']);loft(local,rings,{'Foot_'+s:1},16)
        local.vertices=[(v[0]+foot.x,v[1],v[2]) for v in local.vertices]
        b['Leather'].add(local.vertices,local.faces,local.weights)
        a,e,h=p['UpperArm_'+s],p['Forearm_'+s],p['Hand_'+s]
        if key in ('goadsmith','pyre_tender'):
            # One uninterrupted skin surface from rounded deltoid to wrist.
            axis=(a-e).normalized()
            points=catmull([a+axis*.32,a+axis*.18,a,e,h],4)
            profile=[.015,.25*w,.31*w,.21*w,.16*w];rs=[];weights=[]
            for i,point in enumerate(points):
                u=i/4;j=min(3,int(u));f=u-j
                rs.append(profile[j]*(1-f)+profile[j+1]*f)
                blend=max(0,min(1,(u-2.6)/.75))
                weights.append({'UpperArm_'+s:1-blend,'Forearm_'+s:blend})
            tube(b['Skin' if key=='goadsmith' else 'Cloth'],points,rs,weights,20)
        else:
            limb(b['Cloth'],a,e,h,(.28*w,.21*w,.16*w),['UpperArm_'+s,'Forearm_'+s])
            b['Cloth'].ellipsoid(a+Vector((0,0,-.08)),(.28*w,.28,.30),{'UpperArm_'+s:1},16,10)
        tube(b['Leather'],[h+Vector((0,0,.20)),h+Vector((0,0,.08)),h-Vector((0,0,.015))],
             [.17,.17,.15],[{'Hand_'+s:1}]*3,14)
        b['Skin'].ellipsoid(h+Vector((0,-.025,-.07)),(.145,.13,.155),{'Hand_'+s:1},14,8)
        # Four articulated-looking curled fingers and a wrapped thumb, all rigid to grip.
        for j in range(4):
            x=h.x+(j-1.5)*.065
            free=s=='L' and key!='pyre_tender'
            pts=[(x,h.y-.11,h.z+.015),(x+(j-1.5)*.012,h.y-.22,h.z-.05),
              (x+(j-1.5)*.02,h.y-(.30+.018*j),h.z-.07)] if free else [(x,h.y-.11,h.z+.015),(x,h.y-.19,h.z-.09),(x,h.y-.11,h.z-.17)]
            line(b['Skin'],pts,.033,{'Hand_'+s:1})
        line(b['Skin'],[(h.x-sgn*.13,h.y,h.z),(h.x-sgn*.20,h.y-.12,h.z-.035),
             (h.x-sgn*.12,h.y-.19,h.z-.095)],.055,{'Hand_'+s:1})
        for z in [.36,.54,.68]:
            line(b['Iron'],[(foot.x-.17,-.20,z),(foot.x,-.245,z-.03),(foot.x+.17,-.20,z)],.017,{'Foot_'+s:1})
        # Broad asymmetric coat panels, not a cone hiding the gait.
        xs=[sgn*.06,sgn*.17*w,sgn*.29*w,sgn*.42*w,sgn*.56*w,sgn*.66*w];vs=[]
        for z in [2.45,2.15,1.8,1.45,1.1,.66]:
            for x in xs:vs.append((x*(1+(2.45-z)*.14),-.42*math.sqrt(max(.05,1-(abs(x)/(.73*w))**2))+
               (.075*math.cos(abs(x)*10)-.06*math.sin((2.45-z)*math.pi/1.8) if key=='pyre_tender' else .06*math.cos(abs(x)*22))-.10*(2.45-z)/1.8,
               z+.07*math.sin(x*13)+(0.05*math.cos(x*32) if z<.7 else 0)))
        fs=[]
        for j in range(5):
            for i in range(5):a=j*6+i;fs.extend([(a,a+1,a+6),(a+1,a+7,a+6)])
        def panelweight(v):
            hip=max(0,min(1,(v[2]-1.9)/.5));shin=max(0,min(.55,(1.4-v[2])*.75))
            return {'Hips':hip,'Thigh_'+s:1-hip-shin,'Shin_'+s:shin}
        ws=[panelweight(v) for v in vs]
        if key!='goadsmith':
            b['Cloth'].add(vs,fs,ws)
            for j in [0,5]:
                pts=[Vector(vs[k*6+j])+Vector((0,-.012,0)) for k in range(6)]
                pts=catmull(pts,3);tube(b['Leather'],pts,[.022]*len(pts),[panelweight(v) for v in pts],6)
            # Worn runic straps over the hanging cloth, separate from the silhouette edge.
            for j in range(0 if key=='pyre_tender' else 6):
                z=1.10+j*.13;x=sgn*(.27*w+(2.45-z)*.03)
                line(b['Bone'],[(x-.035,-.475,z),(x+.035,-.475,z+.02)],.007,panelweight((x,0,z)))
    # Neck and living face under a deep, thick hood.
    b['Skin'].ellipsoid((0,0,3.7),(.19,.19,.30),{'Neck':1},16,10)
    # Continuous facial surface, nose bridge and cheek planes sculpted into it.
    facevs=[];facefs=[];segments=36;rings=20
    for j in range(rings+1):
        phi=math.pi*j/rings
        for i in range(segments):
            theta=math.tau*i/segments;x=.285*math.sin(phi)*math.cos(theta)
            z=3.99+.36*math.cos(phi);y=-.075+.235*math.sin(phi)*math.sin(theta)
            front=max(0,-math.sin(theta))**10
            nose=.105*math.exp(-(x/.058)**2-((z-4.005)/.115)**2)
            cheeks=.028*math.exp(-((abs(x)-.16)/.08)**2-((z-3.98)/.11)**2)
            ridge=.018*math.exp(-((z-4.12)/.045)**2)
            facevs.append((x,y-front*(nose+cheeks+ridge),z))
    for j in range(rings):
        for i in range(segments):
            a=j*segments+i;c=a+segments;d=j*segments+(i+1)%segments
            if j:facefs.append((a,c,d))
            if j<rings-1:facefs.append((d,c,d+segments))
    b['Skin'].add(facevs,facefs,{'Head':1})
    for sg in [-1,1]:
        b['Dark'].ellipsoid((sg*.115,-.291,4.07),(.070,.022,.020),{'Head':1},12,6)
        b['Bone'].ellipsoid((sg*.115,-.312,4.069),(.024,.009,.014),{'Head':1},10,6)
        b['Dark'].ellipsoid((sg*.115,-.321,4.069),(.012,.005,.013),{'Head':1},8,5)
        line(b['Skin'],[(sg*.035,-.3,4.10),(sg*.12,-.31,4.135),(sg*.205,-.26,4.13)],.022,{'Head':1})
    line(b['Dark'],[(-.10,-.267,3.86),(0,-.295,3.85),(.10,-.267,3.86)],.017,{'Head':1})
    # Hood arch is an open shell with folded thickness, never a solid sphere over face.
    vs=[];fs=[]
    for j in range(7):
        y=[-.51,-.36,-.12,.12,.27,.33,.35][j]
        for i in range(21):
            a=math.pi*i/20
            vs.append((math.cos(a)*[.43,.445,.42,.37,.28,.14,.01][j],y,
              3.55+.36*j/6+math.sin(a)**.85*[.88,.84,.76,.66,.50,.27,.02][j]))
    for j in range(6):
        for i in range(20):a=j*21+i;fs.extend([(a,a+1,a+21),(a+1,a+22,a+21)])
    b['Cloth'].add(vs,fs,{'Head':1})
    line(b['Leather'],[(math.cos(math.pi*i/20)*.435,-.525,3.55+math.sin(math.pi*i/20)*.89) for i in range(21)],.046,{'Head':1})
    # Folded cowl hides the lower face and buries the neck in a real garment volume.
    loft(b['Cloth'],[(3.48,.37,.30,-.03),(3.63,.34,.32,-.035),(3.79,.29,.31,-.03),
         (3.89,.235,.27,-.045)],{'Head':1},28,.035)
    # Fur collar: distinct flattened tapered locks, layered following shoulder anatomy.
    rng=random.Random(512)
    loft(b['Fur'],[(3.07,.61*w,.34,.02),(3.25,.79*w,.43,.02),(3.46,.78*w,.41,.01),
         (3.66,.31,.25,0)],{'Chest':1},32,.04)
    for i in range(260 if detail else 100):
        a=rng.random()*math.tau;t=rng.random();z=3.64-.56*t
        profile=[(3.07,.61,.34),(3.25,.79,.43),(3.46,.78,.41),(3.66,.31,.25)]
        j=next((j for j in range(3) if profile[j][0]<=z<=profile[j+1][0]),2)
        f=(z-profile[j][0])/(profile[j+1][0]-profile[j][0])
        rx=profile[j][1]*(1-f)+profile[j+1][1]*f;ry=profile[j][2]*(1-f)+profile[j+1][2]*f
        x=math.cos(a)*(rx-.02)*w;y=math.sin(a)*(ry-.012)+.01
        bone='Chest';length=.09+rng.random()*.11;half=.030+rng.random()*.023
        side=Vector((-math.sin(a)*half,math.cos(a)*half,0));base=Vector((x,y,z))
        normal=Vector((math.cos(a),math.sin(a),0));tip=base+normal*.055+Vector((0,0,-length))
        ridge=base+normal*.065+Vector((0,0,-length*.40));back=base-normal*.008+Vector((0,0,-length*.4))
        b['Fur'].add([base-side,base+side,ridge,tip,back],[(0,2,1),(0,3,2),(1,2,3),(0,4,3),(1,3,4),(0,1,4)],{bone:1})
        if i%11==0:b['Frost'].cone(tuple(base),tuple(base+Vector((0,0,-.055))),.018,{bone:1},4)
    for i in range(32):
        a=math.pi*i/31;root=Vector((math.cos(a)*.432,-.522,3.55+math.sin(a)*.89))
        tangent=Vector((-math.sin(a),0,math.cos(a)))*(.08+rng.random()*.045)
        tip=root+Vector((math.cos(a)*.035,-.035,-.075-rng.random()*.07))
        ridge=root+Vector((0,-.045,-.035));back=root+Vector((0,.012,0))
        b['Fur'].add([root-tangent,root+tangent,ridge,tip,back],[(0,2,1),(0,3,2),(1,2,3),(0,4,3),(1,3,4),(0,1,4)],{'Head':1})
    # Belt, edged pouches, fetishes and seams.
    loft(b['Leather'],[(2.36,.51*w,.35,0),(2.47,.52*w,.35,0)],{'Hips':1},28)
    for sg in [-1,1]:
        b['Leather'].ellipsoid((sg*.43*w,-.48,2.21),(.17,.14,.23),{'Hips':1},10,8)
        b['Iron'].ellipsoid((sg*.43*w,-.627,2.29),(.05,.02,.035),{'Hips':1},8,4)
    b['Iron'].add([(-.1,-.38,2.37),(.1,-.38,2.37),(.1,-.38,2.48),(-.1,-.38,2.48)],[(0,1,2,3)],{'Hips':1})
    for i in range(9):
        z=2.6+i*.075
        line(b['Bone'],[(-.07,-.365,z),(.07,-.365,z+.025)],.008,torso((0,0,z)))
    if key=='goadsmith':
        # Apron has separate hanging panels, reinforced neck strap, hammer burns.
        def apronweight(v):
            t=max(0,min(.85,(2.4-v[2])/1.0));left=max(0,min(1,.5+v[0]/.5))
            if v[2]>2.4:return torso(v)
            return {'Spine':1-t,'Thigh_L':t*left,'Thigh_R':t*(1-left)}
        loft(b['Leather'],[(1.15,.44,.045,-.43),(1.55,.48,.045,-.43),(2.1,.47,.045,-.41),
             (2.55,.43,.045,-.40),(3.05,.40,.04,-.395),(3.32,.28,.04,-.35)],apronweight,20,.04)
        b['Fur'].ellipsoid((0,.005,4.43),(.44,.34,.24),{'Head':1},20,12)
        b['Fur'].ellipsoid((0,-.46,4.49),(.235,.27,.15),{'Head':1},18,10)
        b['Dark'].ellipsoid((0,-.695,4.52),(.10,.06,.065),{'Head':1},12,8)
        for sg in [-1,1]:
            b['Fur'].ellipsoid((sg*.33,.04,4.61),(.115,.095,.125),{'Head':1},12,8)
            b['Dark'].ellipsoid((sg*.33,-.049,4.62),(.060,.020,.065),{'Head':1},10,6)
            line(b['Dark'],[(sg*.16,-.32,4.59),(sg*.235,-.29,4.56),(sg*.28,-.24,4.57)],.017,{'Head':1})
            b['Bone'].cone((sg*.165,-.58,4.41),(sg*.15,-.61,4.26),.035,{'Head':1},8)
    if key=='pyre_tender':
        # Long back cloth, with radial sewn seams and a scorched edge.
        def robeweight(v):
            if v[2]>2.4:return torso(v)
            spine=max(0,min(1,(v[2]-1.85)/.55));shin=max(0,min(.45,(1.3-v[2])*.7))
            left=max(0,min(1,.5+v[0]/.45));thigh=1-spine-shin
            return {'Spine':spine,'Thigh_L':thigh*left,'Thigh_R':thigh*(1-left),
                    'Shin_L':shin*left,'Shin_R':shin*(1-left)}
        loft(b['Cloth'],[(.65,.65,.20,.22),(1.,.64,.20,.23),(1.35,.62,.20,.24),
             (1.75,.55,.21,.23),(2.1,.49,.22,.22),(3.2,.48,.22,.15)],robeweight,26,.06)
    return b
