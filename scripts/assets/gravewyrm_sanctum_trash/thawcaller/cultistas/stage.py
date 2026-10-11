import bpy
from mathutils import Vector
from geometry import material
from config import TMP

def camera(pos=(8,-14,7),target=(-.4,0,2.2),ortho=None):
    sc=bpy.context.scene
    if not sc.camera:
        data=bpy.data.cameras.new('ReviewCamera');sc.camera=bpy.data.objects.new('ReviewCamera',data);sc.collection.objects.link(sc.camera)
    c=sc.camera;c.location=pos;c.rotation_euler=(Vector(target)-c.location).to_track_quat('-Z','Y').to_euler()
    c.data.lens=55;c.data.type='ORTHO' if ortho else 'PERSP'
    if ortho:c.data.ortho_scale=ortho

def create():
    sc=bpy.context.scene;sc.name='Broodsworn_Review';sc.render.engine='CYCLES';sc.cycles.samples=32
    sc.cycles.use_denoising=True;sc.cycles.device='GPU';sc.render.threads_mode='FIXED';sc.render.threads=2
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='OPTIX'
    sc.render.resolution_x=1440;sc.render.resolution_y=1080;sc.render.resolution_percentage=100
    sc.render.image_settings.file_format='PNG';sc.render.fps=30
    sc.world=bpy.data.worlds.new('PolarStudio');sc.world.use_nodes=True
    sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.14,.20,1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value=.4
    sc.view_settings.view_transform='AgX'
    bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='StudioFloor';floor.location.z=-.015
    floor.data.materials.append(material('Floor',(.055,.075,.085),.0,.75))
    for name,pos,power,col,size in [('Key',(-4,-6,9),1300,(.8,.9,1),5),('Fill',(5,-2,5),900,(1,.72,.5),4),('Rim',(1,4,7),1700,(.25,.65,1),4)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=col;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);sc.collection.objects.link(obj);obj.location=pos
        obj.rotation_euler=(Vector((0,0,2))-obj.location).to_track_quat('-Z','Y').to_euler()
    before=set(bpy.data.objects);actions=set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(TMP/'knight_reference.glb'),disable_bone_shape=True)
    added=set(bpy.data.objects)-before
    for o in added:
        if o.type=='ARMATURE':o.animation_data_clear()
    dg=bpy.context.evaluated_depsgraph_get();coords=[]
    anchor=bpy.data.objects.new('KayKit_Knight_2_6yd',None);sc.collection.objects.link(anchor)
    for o in list(added):
        if o.type=='MESH':
            ev=o.evaluated_get(dg);me=bpy.data.meshes.new_from_object(ev,preserve_all_data_layers=True,depsgraph=dg)
            mat=o.matrix_world.copy();o.data=me;o.modifiers.clear();o.parent=anchor;o.matrix_world=mat
            coords.extend(mat@v.co for v in me.vertices)
    for o in list(added):
        if o.type=='ARMATURE':bpy.data.objects.remove(o,do_unlink=True)
    for a in set(bpy.data.actions)-actions:bpy.data.actions.remove(a)
    low=min(v.z for v in coords);high=max(v.z for v in coords);s=2.6/(high-low)
    anchor.scale=(s,)*3;anchor.location=(-2.45,-.1,-low*s)
    camera();return sc

def render_views(out,round_name):
    sc=bpy.context.scene;folder=out/'reviews'/round_name;folder.mkdir(parents=True,exist_ok=True)
    sc.render.engine='BLENDER_EEVEE';sc.eevee.taa_render_samples=32
    sc.eevee.use_raytracing=False
    for name,pos,target,ortho in [('hero',(7,-13,6),(-.5,0,2.25),None),
        ('front',(0,-15,2.3),(-.55,0,2.3),7.0),('side',(12,-.1,4),(0,0,2.4),6.0),
        ('head',(3,-6,4.7),(0,0,3.6),3.0)]:
        camera(pos,target,ortho);sc.render.filepath=str(folder/(name+'.png'));bpy.ops.render.render(write_still=True)
    camera()
