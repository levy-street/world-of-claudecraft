"""Red Harvest: authored curved blood jets, dense bite and stretched breakup.

Blender 5.2 --background --python this.py -- --output-dir tmp/harvest-impact
Renders 64 original RGBA frames; --preview renders four composition frames.
Geometry animation, not a fluid simulation. No generated-image service used.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
parser.add_argument('--preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output_dir).resolve()
output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 3
scene.render.resolution_x = scene.render.resolution_y = 248
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.world.color = (0.12, 0.12, 0.12)
scene.frame_start, scene.frame_end = 1, 64
bpy.ops.object.camera_add(location=(0, -14, 0.45))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0.45)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 7.8
scene.camera = camera
for location, power, size in [((-3,-4,5),650,3),((4,-2,1),350,2),((0,2,4),800,2)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    lamp = bpy.context.object
    lamp.data.energy, lamp.data.size = power, size
    lamp.rotation_euler = (Vector((0,0,1))-lamp.location).to_track_quat('-Z','Y').to_euler()

def material(name, colour, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour,1)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*colour,1)
    bsdf.inputs['Roughness'].default_value = .28
    bsdf.inputs['Metallic'].default_value = .12
    bsdf.inputs['Emission Color'].default_value = (*colour,1)
    bsdf.inputs['Emission Strength'].default_value = emission
    tex = nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 8
    tex.inputs['Detail'].default_value = 4
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value = (2,2,18)
    links.new(coord.outputs['Generated'],mapping.inputs[0])
    links.new(mapping.outputs[0],tex.inputs['Vector'])
    ramp=nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position=.23
    ramp.color_ramp.elements[0].color=(*(c*.24 for c in colour),1)
    ramp.color_ramp.elements[1].position=.78
    ramp.color_ramp.elements[1].color=(*colour,1)
    links.new(tex.outputs['Fac'],ramp.inputs[0])
    if not emission>1: links.new(ramp.outputs[0],bsdf.inputs['Base Color'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value=.25
    bump.inputs['Distance'].default_value=.08
    links.new(tex.outputs['Fac'],bump.inputs['Height'])
    links.new(bump.outputs[0],bsdf.inputs['Normal'])
    return mat

blood = material('Oxblood_with_stretched_fibres',(.35,.008,.028),.13)
scarlet = material('Scarlet_fold_highlights',(.75,.02,.065),.25)
hot = material('Rose_white_contact_only',(1,.65,.55),2.4)
meshes=[]
cores=[]
for layer in range(2):
    vertices=[(0,0,0)]
    for i in range(32):
        angle=i*math.pi/16
        radius=(1 if i%2==0 else .35)*(1+.2*math.sin(i*11))
        vertices.append((math.cos(angle)*radius*1.65,0,math.sin(angle)*radius*.65))
    mesh=bpy.data.meshes.new('Jagged_collision_core_%d'%layer)
    mesh.from_pydata(vertices,[],[(0,i+1,(i+1)%32+1) for i in range(32)])
    obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
    obj.location.y=-1.2-layer*.1
    obj.data.materials.append(scarlet if layer==0 else hot)
    cores.append(obj)
for k in range(14):
    verts,faces=[],[]
    for i in range(33):
        for j in range(5): verts.append((0,0,0))
    for i in range(32):
        for j in range(4):
            n=i*5+j;faces.append((n,n+1,n+6,n+5))
    mesh=bpy.data.meshes.new('Torn_jet_%02d'%k)
    mesh.from_pydata(verts,[],faces)
    obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
    obj.data.materials.append(hot if k>=14 else scarlet if k%3==0 else blood)
    for face in mesh.polygons: face.use_smooth=True
    obj.shape_key_add(name='Basis')
    meshes.append(obj)

for frame in range(1,65):
    t=(frame-1)/63
    expansion=1-(1-min(1,t/.38))**3
    fade=max(0,1-max(0,t-.47)/.53)
    for layer,obj in enumerate(cores):
        gain=min(1,t/.025)*max(0,1-t/(.5 if layer==0 else .36))
        scale=(1.25 if layer==0 else .68)*gain
        obj.scale=(scale,scale,scale)
        obj.keyframe_insert('scale',frame=frame)
    for k,obj in enumerate(meshes):
        key=obj.shape_key_add(name='Frame_%02d'%frame)
        side=1 if k%2 else -1
        angle=side*(.23+(k//2)*.31)+.12*math.sin(k*7)
        length=(3.25-.19*(k%5)+.12*math.sin(k*11))*expansion
        if k>=14: length=(1.5+(k-14)*.25)*(1-min(1,t/.22))
        for i in range(33):
            u=i/32
            # Material tears back from its root after the first release.
            trail=max(0,(t-.36)*1.5)
            along=trail+(1-trail)*u
            for j in range(5):
                v=j/4-.5
                broad=.95 if k<4 else .6 if k<8 else .22
                w=math.sin(math.pi*u)**.65*(broad if k<14 else .24)*fade
                w*=.82+.15*math.sin(u*47+k)+.07*math.sin(u*89)
                r=along*length
                x=math.sin(angle)*r+side*math.sin(u*3.5)*.35*expansion+v*w*math.cos(angle)
                z=math.cos(angle)*r-.55*expansion+v*w*math.sin(angle)
                y=math.sin(u*6+k+v*4)*w*.85+(k%3-1)*.14
                if frame in (1,64): x=y=z=0
                key.data[i*5+j].co=(x,y,z)
        key.value=0;key.keyframe_insert('value',frame=max(0,frame-1))
        key.value=1;key.keyframe_insert('value',frame=frame)
        key.value=0;key.keyframe_insert('value',frame=frame+1)
scene['authoring']='Original keyframed torn jet surfaces, dense bite and layered blood material'
bpy.ops.wm.save_as_mainfile(filepath=str(output/'harvest_impact.blend'))
(output/'metadata.json').write_text(json.dumps({'frames':64,'grid':[8,8],'content_px':248,
    'gutter_px':4,'alpha':'straight','pivot':[.5,.5],'source':'Blender Cycles authored geometry',
    'baked_bloom':False},indent=2))
frames=output/'frames';frames.mkdir(exist_ok=True)
for frame in ([5,14,29,48] if args.preview else range(1,65)):
    scene.frame_set(frame)
    scene.render.filepath=str(frames/('%03d.png'%frame))
    bpy.ops.render.render(write_still=True)
    print('HARVEST_FRAME',frame,flush=True)
