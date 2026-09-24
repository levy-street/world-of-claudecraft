"""Original blade collision: dense wound split, sheared steel and blood fibres.
Blender 5.2 --background --python this.py -- --output-dir tmp/warrior-bite
Authored mesh/sprite animation, not fluid simulation or generated imagery.
"""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser();parser.add_argument('--output-dir',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
output=Path(args.output_dir).resolve();(output/'frames').mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
scene.cycles.use_denoising=True;scene.cycles.max_bounces=3
scene.render.resolution_x=scene.render.resolution_y=248;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.view_settings.view_transform='Standard';scene.world.color=(.15,.15,.15)
scene.frame_start,scene.frame_end=1,64
bpy.ops.object.camera_add(location=(0,-14,0));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=7.6;scene.camera=camera
for pos,power,size in [((-3,-5,5),650,3),((3,-3,1),500,2),((1,2,4),900,2)]:
    bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object
    light.data.energy=power;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
def mat(name,colour,metal,emission):
    m=bpy.data.materials.new(name);m.diffuse_color=(*colour,1);m.use_nodes=True
    n=m.node_tree.nodes;links=m.node_tree.links;b=n.get('Principled BSDF')
    b.inputs['Base Color'].default_value=(*colour,1);b.inputs['Metallic'].default_value=metal
    b.inputs['Roughness'].default_value=.27;b.inputs['Emission Color'].default_value=(*colour,1)
    b.inputs['Emission Strength'].default_value=emission
    tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=28;tex.inputs['Detail'].default_value=3
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.025
    links.new(tex.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs[0],b.inputs['Normal'])
    return m
steel=mat('Brushed cold steel',(.65,.73,.77),.86,.16)
deep=mat('Compressed oxblood',(.2,.004,.019),.08,.12)
red=mat('Torn scarlet fibres',(.64,.012,.047),.1,.2)
hot=mat('Narrow rose white collision',(.95,.8,.73),.12,2.6)
objects=[]
def mesh(name,vertices,faces,material,role,index=0):
    m=bpy.data.meshes.new(name);m.from_pydata(vertices,[],faces);m.materials.append(material)
    o=bpy.data.objects.new(name,m);scene.collection.objects.link(o)
    objects.append((o,[v.co.copy() for v in m.vertices],role,index));return o
for layer,material in enumerate([deep,red,hot]):
    vertices=[];faces=[]
    for i in range(33):
        u=i/32;x=(u-.5)*3.1
        width=math.sin(math.pi*u)**.7*(.40 if layer==0 else .25 if layer==1 else .12)
        for side in [-1,1]:
            jag=1+.28*math.sin(i*2.37+layer)
            vertices.append((x,-layer*.07,side*width*jag+.09*math.sin(u*17)))
        if i<32:faces.append((i*2,i*2+1,i*2+3,i*2+2))
    mesh('Bite layer '+str(layer),vertices,faces,material,'core',layer)
for index in range(12):
    angle=(-.3+index/11*.6)+(0 if index%2==0 else math.pi)
    length=1.2+(index%4)*.28;width=.22 if index%3==0 else .12
    vertices=[];faces=[]
    for i in range(19):
        u=i/18;travel=.32+u*length;bend=math.sin(u*2.5)*(.25 if index%2 else -.25)
        x=math.cos(angle)*travel;z=math.sin(angle)*travel+bend
        taper=math.sin(u*math.pi)**.65*width*(.8+.2*math.sin(u*42+index))
        for side in [-1,1]:vertices.append((x,-.1+math.sin(u*4+index)*.16,z+side*taper))
        if i<18:faces.append((i*2,i*2+1,i*2+3,i*2+2))
    mesh('Pulled blood '+str(index),vertices,faces,red if index%3 else deep,'fibre',index)
for index in range(14):
    a=index*2.399963;l=.12+(index%3)*.05
    vertices=[(-l,0,-.025),(l,0,0),(-l*.3,.04,.045)]
    o=mesh('Sheared steel '+str(index),vertices,[(0,1,2)],steel,'shard',index)
    o.rotation_euler.y=a
def animate(t):
    for o,base,role,index in objects:
        if role=='core':
            gain=min(1,t/.025)*max(0,1-t/(.48 if index<2 else .3))
            o.scale=(gain,gain,gain)
        elif role=='fibre':
            grow=min(1,t/.22);fade=max(0,1-(t-.38)/.60)
            for v,p in zip(o.data.vertices,base):
                v.co=(p.x*(.25+.9*grow),p.y,p.z*fade-t*t*.28)
            o.scale=(1,1,fade*min(1,t/.035))
        else:
            a=index*2.399963;travel=.3+t*(1.1+index%4*.3)
            o.location=(math.cos(a)*travel,-.2,math.sin(a)*travel-t*t*.5)
            gain=min(1,t/.045)*max(0,1-t/.7);o.scale=(gain,gain,gain)
        o.hide_render=t<=0 or t>=1
for frame in range(1,65):
    scene.frame_set(frame);animate((frame-1)/63)
    scene.render.filepath=str(output/'frames'/f'{frame:03d}.png');bpy.ops.render.render(write_still=True)
animate(.15);bpy.ops.wm.save_as_mainfile(filepath=str(output/'warrior_bite.blend'))
(output/'metadata.json').write_text(json.dumps({'frames':64,'grid':[8,8],'frame_size':248,'gutter':4,'camera_span':7.6,'provenance':'Original Blender-authored geometry and material animation','style':'Dense blade bite with sheared steel and directional blood fibres'},indent=2))
