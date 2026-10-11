"""Directional steel shear: opposing torn bevels and blade-aligned metal ejection.
Blender 5.2 --background --python this.py -- --output-dir tmp/warrior-steel
This is authored geometry animation; it uses no generated or third-party image.
"""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

p=argparse.ArgumentParser();p.add_argument('--output-dir',required=True);p.add_argument('--preview',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.output_dir).resolve()
(out/'frames').mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=16;s.cycles.use_denoising=True
s.cycles.max_bounces=3;s.render.resolution_x=s.render.resolution_y=248;s.render.resolution_percentage=100
s.render.film_transparent=True;s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA'
s.view_settings.view_transform='Standard';s.world.color=(.15,.15,.15)
s.frame_start,s.frame_end=1,64
bpy.ops.object.camera_add(location=(0,-15,0));c=bpy.context.object
c.rotation_euler=(Vector((0,0,0))-c.location).to_track_quat('-Z','Y').to_euler()
c.data.type='ORTHO';c.data.ortho_scale=8.2;s.camera=c
for pos,power,size in [((-3,-5,5),800,3),((3,-3,1),650,2),((1,2,4),1000,2)]:
    bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object
    l.data.energy=power;l.data.size=size;l.rotation_euler=(-l.location).to_track_quat('-Z','Y').to_euler()

def material(name,color,metal,emission):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;b=n.get('Principled BSDF')
    b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metal
    b.inputs['Roughness'].default_value=.25;b.inputs['Emission Color'].default_value=(*color,1)
    b.inputs['Emission Strength'].default_value=emission
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=42;noise.inputs['Detail'].default_value=4
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.22;bump.inputs['Distance'].default_value=.02
    m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs[0],b.inputs['Normal'])
    return m
iron=material('Split dark iron',(.025,.036,.044),.65,.08)
steel=material('Silver shear facets',(.46,.55,.62),.85,.22)
hot=material('White steel collision',(.82,.91,1),.3,1.8)
ember=material('Hot swarf',(.53,.66,.75),.65,.35)
objects=[]
def mesh(name,verts,faces,mat,role,index):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.materials.append(mat)
    o=bpy.data.objects.new(name,data);s.collection.objects.link(o)
    objects.append((o,[v.co.copy() for v in data.vertices],role,index));return o

# An angular slit, broad dark shoulders and two unequal folded cutting faces.
for layer,mat in enumerate([iron,steel,hot]):
    verts=[];faces=[]
    for i in range(41):
        u=i/40;x=(u-.5)*1.65;envelope=math.sin(math.pi*u)**.65
        for row in range(3):
            side=row-1;width=(.43 if layer==0 else .26 if layer==1 else .065)
            z=side*width*envelope*(1+.22*math.sin(i*2.7))+x*.18
            verts.append((x,-layer*.09-abs(side)*.05,z))
        if i<40:
            for j in range(2):faces.append((i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j))
    mesh('Collision split '+str(layer),verts,faces,mat,'split',layer)

# Broad sheared fan: short broken facets, not long continuous white rays.
# Unequal wings preserve the blade axis while the off-axis material gives mass.
for index in range(48):
    side=1 if index<31 else -1
    angle=(0 if side>0 else math.pi)+math.sin(index*2.399963)*.85
    distance=.12+(index*11%17)*.055
    length=.22+(index*7%11)*.044;verts=[];faces=[]
    for i in range(13):
        u=i/12;r=distance+u*length
        bend=(abs(u-.43)-.43)*(.13 if index%2 else -.16)
        width=(.024+(index%5)*.009)*(1-abs(2*u-1))*(.84 if (i+index)%3 else 1)
        for edge in [-1,1]:
            verts.append((math.cos(angle)*r-math.sin(angle)*(bend+edge*width),-.3-(index%3)*.025,
                          math.sin(angle)*r+math.cos(angle)*(bend+edge*width)))
        if i<12 and (i+index)%9!=4:faces.append((i*2,i*2+1,i*2+3,i*2+2))
    mesh('Torn swarf '+str(index),verts,faces,ember if index%4==0 else steel,'spray',index)
for index in range(78):
    length=.023+(index%5)*.012
    o=mesh('Tumbling metal '+str(index),[(-length,0,-.018),(length,0,.009),(-length*.3,.03,.025)],[(0,1,2)],ember if index%6==0 else steel,'chip',index)
    o.rotation_euler.y=index*2.399963

def animate(t):
    for o,base,role,index in objects:
        if role=='split':
            gain=min(1,t/.022)*max(0,1-t/(.3 if index==0 else .2 if index==1 else .08))
            o.scale=(gain,1,gain)
        elif role=='spray':
            head=1-(1-t)**3;fade=max(0,1-(t-.2)/.62)
            # The whole torn facet advects out of the wound, then breaks down.
            angle=(0 if index<31 else math.pi)+math.sin(index*2.399963)*.85
            travel=head*(.7+(index%7)*.09)
            o.location=(math.cos(angle)*travel,0,math.sin(angle)*travel-t*t*.85)
            gain=min(1,t/.035)*fade
            o.scale=(gain,1,gain)
        else:
            angle=(0 if index%3 else math.pi)+math.sin(index*2.399963)*1.12;distance=.08+(1-(1-t)**2)*(1.05+index%9*.2)
            o.location=(math.cos(angle)*distance,-.25,math.sin(angle)*distance-t*t*.9)
            o.rotation_euler.y=angle+t*(index%5-2)*5
            gain=min(1,t/.035)*max(0,1-t)**.5;o.scale=(gain,gain,gain)
        o.hide_render=t<=0 or t>=1
rendered=[1,7,15,27,43,64] if a.preview else list(range(1,65))
for frame in rendered:
    s.frame_set(frame);animate((frame-1)/63);s.render.filepath=str(out/'frames'/f'{frame:03d}.png')
    bpy.ops.render.render(write_still=True)
animate(.12);bpy.ops.wm.save_as_mainfile(filepath=str(out/'warrior_shear.blend'))
(out/'metadata.json').write_text(json.dumps({'frames':64,'grid':[8,8],'frame_size':248,'gutter':4,'camera_span':8.2,
    'provenance':'Original Blender-authored geometry and material animation',
    'rendered_frames':rendered,
    'style':'Compressed steel bite, two unequal broad fans, 48 broken torn facets and 78 decelerating tumbling chips; white core expires at eight percent'},indent=2))
