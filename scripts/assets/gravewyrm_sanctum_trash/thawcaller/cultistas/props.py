import math
from mathutils import Vector
from sculpt import line,loft
from skeleton import landmarks,goad_tip

def ring(batch,center,radius,weight,plane='XY',wire=.018):
    c=Vector(center);axes={'XY':(0,1),'XZ':(0,2),'YZ':(1,2)}[plane];pts=[]
    for i in range(17):
        a=math.tau*i/16;p=c.copy();p[axes[0]]+=radius*math.cos(a);p[axes[1]]+=radius*math.sin(a);pts.append(p)
    line(batch,pts,wire,weight)

def flame(b,center,radius,weight):
    x,y,z=center
    for i in range(5):
        a=i*2.4;r=radius*(.6 if i else 0)
        b['Soul'].cone((x+math.cos(a)*r,y+math.sin(a)*r,z),
           (x+math.cos(a+.7)*r,y+math.sin(a+.7)*r,z+radius*(2.6+i*.13)),radius*.5,weight,7,.008)
    b['Ember'].ellipsoid((x,y,z), (radius*.85,radius*.85,radius*.30),weight,12,5)

def add(key,spec,b):
    p=landmarks(spec);h=p['Hand_R'];grip={'Hand_R':1}
    if key=='thawcaller':
        line(b['Leather'],[(h.x,h.y,1.25),(h.x-.03,h.y,2.5),(h.x+.05,h.y,3.8),
           (h.x-.06,h.y,4.15),(h.x-.36,h.y,4.20),(-1.43,h.y,3.99),(-1.43,h.y,3.4)],.048,grip)
        for z in [1.36,2.1,2.37,2.55,3.65]:ring(b['Iron'],(h.x,h.y,z),.060,grip,wire=.017)
        for i in range(7):ring(b['Iron'],(-1.43,h.y,3.37-i*.078),.055,{'Lantern':1},'XZ' if i%2 else 'YZ',.012)
        c=(-1.43,h.y,2.60);weight={'Lantern':1}
        b['Iron'].ellipsoid(c,(.26,.26,.12),weight,12,6)
        for z,r in [(2.59,.24),(2.72,.25),(2.95,.22),(3.05,.10)]:ring(b['Iron'],(c[0],c[1],z),r,weight,wire=.025)
        for i in range(6):
            a=math.tau*i/6;x=c[0]+.23*math.cos(a);y=c[1]+.23*math.sin(a)
            line(b['Iron'],[(x,y,2.6),(x,y,2.96),(c[0],c[1],3.1)],.025,weight)
        flame(b,(c[0],c[1],2.72),.12,weight)
        # Soul skull inset in the lantern, contained by the cage.
        b['Bone'].ellipsoid((c[0],c[1]-.07,2.81),(.10,.095,.12),weight,12,8)
        for sg in [-1,1]:b['Dark'].ellipsoid((c[0]+sg*.043,c[1]-.155,2.83),(.028,.016,.034),weight,8,5)
    elif key=='goadsmith':
        a=h+Vector((0,.6,-.30));tip=goad_tip(spec)-Vector((0,-.40,.035))
        line(b['Iron'],[a,h,tip],.045,grip)
        for i in range(8):ring(b['Leather'],(h.x,h.y+.03-i*.045,h.z-.04+i*.003),.067,grip,'XZ',.014)
        b['Ember'].cone(tip,goad_tip(spec),.065,grip,8,.006)
        line(b['Iron'],[tip+Vector((0,.12,0)),tip+Vector((.12,-.06,0)),tip+Vector((.13,-.26,0))],.035,grip)
    else:
        # Yoke is part of the chest harness; raised hands clamp its front handles.
        wt={'Yoke':1}
        line(b['Leather'],[(-1.18,.08,3.42),(-.65,.10,3.51),(0,.12,3.59),(.65,.10,3.51),(1.18,.08,3.42)],.11,wt)
        for sg in [-1,1]:
            x=sg*1.08;c=(x,.08,3.32)
            b['Iron'].ellipsoid(c,(.31,.31,.15),wt,16,8)
            for z,r in [(3.25,.20),(3.34,.32),(3.48,.34)]:ring(b['Iron'],(x,.08,z),r,wt,wire=.035)
            for i in range(8):
                a=math.tau*i/8
                line(b['Iron'],[(x+.22*math.cos(a),.08+.22*math.sin(a),3.26),
                    (x+.34*math.cos(a),.08+.34*math.sin(a),3.50)],.026,wt)
            flame(b,(x,.08,3.47),.16,wt)
            # Gripped vertical handle shares Hand bone; rest end embedded in yoke.
            h=p['Hand_L' if sg>0 else 'Hand_R']
            line(b['Iron'],[(h.x,h.y,2.30),h,(sg*.80,.07,3.45)],.035,{'Hand_L' if sg>0 else 'Hand_R':1})
