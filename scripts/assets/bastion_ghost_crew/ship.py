"""Original spectral brig, authored offline; +Y Blender bow becomes -Z glTF.

18 yards long, 5.4 beam, 14 tall. Cannon muzzles at X +/-2.7, Z 2.1,
Y -5,-2.5,0,2.5,5. The broadside is symmetric under the glTF Z reversal.
"""
import os
import sys
import math
import bpy
import bmesh
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,os.path.join(HERE,'..','sunken_bastion_drowned','kit'))
import mesh_kit as K
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
parts=[]
def add(p):
    obj=p.to_object()
    parts.append(obj)
    return obj

# Each strake follows a curved hull profile. Deep plank gaps preserve silhouette
# and stay readable when the ship is a dim apparition behind combat telegraphs.
for band in range(9):
    p=K.Part('HullStrake'+str(band),'wood')
    for side in (-1,1):
        def shape(u,v,side=side,band=band):
            y=-9+18*u
            t=(band+v*.92)/9
            width=2.45*max(0,1-(y/9)**2)**.5*(.3+.7*t)
            return (side*width,y,.1+2.7*t+.55*(abs(y)/9)**4)
        p.grid(40,2,shape,two_sided=False)
    add(p)
deck=K.Part('Deck','wood')
deck.grid(36,12,lambda u,v: ((v*2-1)*2.38*max(0,1-((-8.6+17.2*u)/9)**2)**.5,-8.6+17.2*u,2.76),two_sided=False)
add(deck)
rails=K.Part('RailsAndRibs','iron')
for side in (-1,1):
    pts=[]
    for j in range(49):
        y=-8.7+17.4*j/48
        x=side*2.48*math.sqrt(1-(y/9)**2)
        z=3.02+.55*(abs(y)/9)**4
        pts.append((x,y,z))
        if j%3==0: rails.tube([(x,y,z-.45),(x,y,z+.25)],.055,sides=6)
    rails.tube(pts,.09,sides=8)
    rails.tube([(x,y,z+.3) for x,y,z in pts],.055,sides=6)
add(rails)
cab=K.Part('SternCabin','wood')
cab.box((0,-6.65,3.5),(1.55,1.15,.74),bevel=.13,segments=3)
cab.box((0,-6.65,4.28),(1.75,1.35,.1),bevel=.1)
add(cab)
windows=K.Part('CabinWindows','glow')
for j in range(5): windows.box((-.98+j*.49,-7.812,3.59),(.16,.015,.28),bevel=.035)
add(windows)
for mast,y,height in [(0,-3.4,10.8),(1,2.6,13.6)]:
    wood=K.Part('Mast'+str(mast),'wood')
    wood.tube([(0,y,2.7),(0,y,height)], [.19,.09],sides=12)
    for level,span in [(height-1,3.3),(height-4,4.4)]:
        wood.tube([(-span,y,level),(span,y,level)],.075,sides=10)
        sail=K.Part('TatteredSail%s_%s'%(mast,level),'sail')
        # Separate panels with uneven bitten hems, never a solid rectangular card.
        for strip in range(9):
            def sheet(u,v,strip=strip,span=span,level=level,y=y):
                across=(strip+v*.96)/9
                x=(across*2-1)*span*(1-.1*u)
                rag=.25*math.sin(across*61)+.2*math.sin(across*29)
                z=level-u*(2.5+rag)
                return (x,y-.6*math.sin(u*math.pi)*math.sin(across*math.pi),z)
            sail.grid(12,3,sheet,two_sided=False)
        torn=[]
        for face in sail.bm.faces:
            c=face.calc_center_median()
            for cx,cz,rx,rz in [(-span*.42,level-1.1,.26,.49),(span*.52,level-1.8,.2,.35)]:
                if ((c.x-cx)/rx)**2+((c.z-cz)/rz)**2 < 1:
                    torn.append(face)
                    break
        bmesh.ops.delete(sail.bm,geom=torn,context='FACES_ONLY')
        add(sail)
    wood.tube([(0,y,height),(0,y+.9,height-.25)],.035,sides=6)
    add(wood)
    ropes=K.Part('StandingRigging'+str(mast),'rope')
    for side in (-1,1):
        for j in range(5): ropes.tube([(side*2.1,y-1.2+j*.5,3),(side*.07,y,height-1)],.016,sides=5)
        for j in range(12):
            u=j/12
            ropes.tube([(side*2.1*(1-u),y-1.2*(1-u),3+(height-4)*u),(side*2.1*(1-u),y+.8*(1-u),3+(height-4)*u)],.012,sides=4)
    add(ropes)
bowsprit=K.Part('Bowsprit','wood')
bowsprit.tube([(0,6.8,3.1),(0,11.3,5)], [.15,.04],sides=10)
add(bowsprit)
guns=K.Part('BroadsideCannons','iron')
glow=K.Part('CannonSoulBores','glow')
for side in (-1,1):
    for y in (-5,-2.5,0,2.5,5):
        guns.tube([(side*1.5,y,2.1),(side*2.7,y,2.1)],[.22,.16],sides=14)
        guns.torus((side*2.68,y,2.1),(1,0,0),.16,.045,seg=14,sides=6)
        glow.sphere((side*2.705,y,2.1),(.006,.115,.115),seg=12,rings=8)
add(guns);add(glow)
colors={'wood':(.035,.115,.105,.0),'iron':(.09,.19,.17,.65),'rope':(.06,.19,.15,0),'sail':(.16,.3,.26,0),'glow':(.12,.7,.48,0)}
for obj in parts:
    kind=obj['mat']; r,g,b,metal=colors[kind]
    mat=bpy.data.materials.get(kind)
    if mat is None:
        mat=bpy.data.materials.new(kind);mat.use_nodes=True
        bs=mat.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value=(r,g,b,1)
        bs.inputs['Metallic'].default_value=metal
        bs.inputs['Roughness'].default_value=.72
        bs.inputs['Emission Color'].default_value=(r,g,b,1)
        bs.inputs['Emission Strength'].default_value=2 if kind=='glow' else .12
    obj.data.materials.clear();obj.data.materials.append(mat)
    for vertex in obj.data.vertices:
        vertex.co.y *= -2 if obj.name in ('BroadsideCannons','CannonSoulBores') else -1.5
    colors_layer=obj.data.color_attributes.get('Col')
    if colors_layer and kind!='glow':
        for loop in obj.data.loops:
            p=obj.data.vertices[loop.vertex_index].co
            grain=.72+.14*math.sin(p.x*7+p.z*13)+.1*math.sin(p.y*2.1+p.z*4.2)
            colors_layer.data[loop.index].color=(grain*.86,grain,grain*.94,1)
    obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join()
body=bpy.context.object;body.name='BastionGhostShip'
argv=sys.argv[sys.argv.index('--')+1:]
bpy.ops.export_scene.gltf(filepath=os.path.abspath(argv[0]),export_format='GLB',use_selection=True,export_yup=True,export_cameras=False,export_lights=False,export_vertex_color='ACTIVE')
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[0]).replace('.glb','.blend'))
