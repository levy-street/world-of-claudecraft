"""Tailored tricorn, torn coat panels, embroidered braid, irons and soul tails."""
import math
import os
import numpy as np
import anatomy as A
import mesh_kit as K

def pair(part):
    obj=part.to_object()
    if part.name in ('CaptainsTricorn','TricornBraiding'):
        for vertex in obj.data.vertices:
            vertex.co.z -= .28
    elif part.name == 'SailorsCap':
        for vertex in obj.data.vertices:
            vertex.co.z -= .14
    return K.duplicate(obj,obj.name+'_hi'),obj

def build(sculpts):
    old=A.source('dressing')
    work=os.environ['GHOST_BUILD_WORK']
    os.makedirs(work,exist_ok=True)
    parts=old.build_cutlass(work,A.VOXEL_K)+old.build_eyes()
    # Tricorn brim has three raised corners, rolled brass edge and a crown.
    hat=K.Part('CaptainsTricorn' if A.CAPTAIN else 'SailorsCap','leather',bone='Head')
    if A.CAPTAIN:
        pts=[]
        for i in range(73):
            a=math.tau*i/72
            r=.57+.16*math.cos(3*a)
            pts.append((r*math.sin(a),r*math.cos(a),4.52+.16*(1+math.cos(3*a))))
        hat.grid(8,72,lambda u,v: ((.22+u*(.57+.16*math.cos(3*math.tau*v)-.22))*math.sin(math.tau*v),(.22+u*(.57+.16*math.cos(3*math.tau*v)-.22))*math.cos(math.tau*v),4.53+u*u*.16*(1+math.cos(3*math.tau*v))),two_sided=False)
        hat.sphere((0,.02,4.59),(.34,.32,.28),seg=32,rings=16)
        braid=K.Part('TricornBraiding','plate',bone='Head')
        braid.tube(pts,.018,sides=6)
        parts.append(pair(braid))
    else:
        hat.sphere((0,.03,4.48),(.3,.32,.17),seg=24,rings=12)
        hat.torus((0,.03,4.43),(0,0,1),.27,.038,seg=30,sides=8)
    parts.append(pair(hat))
    for side in (-1,1):
        # Three independent tatters per side, with jagged hems and fold ridges.
        for j in range(3):
            p=K.Part('CoatTail_%s_%s'%(side,j),'cloth',bone='TabB1' if j else 'TabF1')
            angle=side*(.68+j*.65)
            def panel(u,v,a=angle,j=j):
                theta=a+(v-.5)*.63
                radius=.54+.15*u+.05*math.sin(v*math.pi*5)*u
                hem=.85+.24*j+.18*side+.09*math.sin(v*19+j)+.045*math.sin(v*37)
                return (math.sin(theta)*radius,math.cos(theta)*radius,2.7-u*(2.7-hem))
            p.grid(22,12,panel,two_sided=False)
            parts.append(pair(p))
        # Dense braided epaulettes and individually hanging fringe.
        if A.CAPTAIN:
            ep=K.Part('Epaulette'+str(side),'plate',bone=('L_' if side==1 else 'R_')+'UpperArm')
            ep.sphere((side*.66,.055,3.61),(.3,.3,.09),seg=24,rings=10)
            for j in range(9):
                a=-1.3+j*.325
                x=side*(.66+.27*math.cos(a)); y=.055+.27*math.sin(a)
                ep.tube([(x,y,3.62),(x+side*.025,y,3.47),(x+side*.015,y,3.38)],.017,sides=5)
            parts.append(pair(ep))
        cuff=K.Part('BrokenIron'+str(side),'plate',bone=('L_' if side==1 else 'R_')+'Forearm')
        wrist=A.WRIST*np.array((side,1,1))
        cuff.torus(wrist,(.5*side,0,-1),.145,.035,seg=20,sides=8)
        for j in range(6 if A.CAPTAIN else 9):
            cuff.torus(wrist+np.array((side*.05,.03*j,-.075*j)),(0,1,0) if j%2 else (1,0,0),.055,.012,seg=12,sides=5,squash=(1,1.5))
        parts.append(pair(cuff))
    buttons=K.Part('NavalButtons','plate',bone='Spine1')
    for s in (-1,1):
        for j in range(5):
            buttons.sphere((s*.25,-.43,2.67+j*.145),(.033,.019,.033),seg=10,rings=6)
    parts.append(pair(buttons))
    # A twisted tapered soul, with dim exterior wisps instead of opaque legs.
    for j in range(7):
        p=K.Part('SoulStreamer'+str(j),'glow_soul' if j==0 else 'glow_wisp',bone='Hips')
        pts=[]; radii=[]
        for i in range(17):
            u=i/16; a=j*math.tau/7+u*2.6
            r=(.27 if j else .05)*(1-u)+.12*math.sin(u*math.pi)
            pts.append((math.cos(a)*r,math.sin(a)*r+.25*u*u,2.45-2.12*u))
            radii.append((.19 if j==0 else .06)*(1-u)**1.3+.003)
        p.tube(pts,radii,sides=10,squash=.7)
        parts.append(pair(p))
    return parts
