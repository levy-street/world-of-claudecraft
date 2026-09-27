"""Original procedural Blender 5.2 VFX bake. Run with Blender --background --python.

Modes: preview (default), all, smoke, shockwave, mesh. PNGs are straight RGBA.
All animation is authored/coherent; no bitmap scaling or fluid cache is used.
"""
import bpy, math, os, sys, json, random, argparse
from mathutils import Vector

ROOT = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--mode', default='preview')
parser.add_argument('--samples', type=int, default=32)
parser.add_argument('--engine', default='BLENDER_EEVEE')
parser.add_argument('--resolution', type=int, default=496)
parser.add_argument('--preview-frame',type=int,default=0)
opt = parser.parse_args(args)

def reset(name, target, location, scale):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    sc = bpy.context.scene
    sc.name = name
    sc.render.engine = opt.engine
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'CUDA'
        prefs.get_devices()
        for d in prefs.devices: d.use = d.type == 'CUDA'
        sc.cycles.device = 'GPU'
    except Exception:
        sc.cycles.device = 'CPU'
    sc.cycles.samples = opt.samples
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.adaptive_threshold = .025
    sc.cycles.volume_bounces = 2
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.volume_step_rate = .6
    sc.cycles.volume_preview_step_rate = .6
    if opt.engine=='BLENDER_EEVEE':
        sc.eevee.taa_render_samples=opt.samples
        sc.eevee.volumetric_samples=128
        sc.eevee.volumetric_tile_size='2'
        sc.eevee.use_volumetric_shadows=True
        sc.eevee.volumetric_shadow_samples=64
        sc.eevee.use_volume_custom_range=True
        sc.eevee.volumetric_start=.1
        sc.eevee.volumetric_end=20
    sc.render.resolution_x = opt.resolution
    sc.render.resolution_y = opt.resolution
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.image_settings.compression = 30
    sc.render.fps = 30
    sc.frame_start, sc.frame_end = 1, 64
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    sc.world.use_nodes = True
    sc.world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.16,.16,.16,1)
    sc.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .26
    bpy.ops.object.camera_add(location=location)
    cam = bpy.context.object
    cam.name = name + '_orthographic_camera'
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.data.lens = 50
    sc.camera = cam
    for lname, loc, power, size in [
        ('Key_softbox',(-4,-4,7),410,3.4),
        ('Fill_softbox',(4,-1,4),100,4),
        ('Rim_softbox',(-1,3,6),275,2.2)]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        ob = bpy.context.object
        ob.name = lname
        ob.data.energy = power
        ob.data.shape = 'DISK'
        ob.data.size = size
        ob.rotation_euler = (Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
    return sc

class Graph:
    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.n = self.nt.nodes
        self.l = self.nt.links
        self.count = 0
        self.out = self.node('ShaderNodeOutputMaterial')
    def node(self, typ, label=''):
        n=self.n.new(typ)
        self.count += 1
        n.location = ((self.count % 9)*210, -(self.count // 9)*210)
        if label: n.label=label; n.name=label
        return n
    def link(self, inp, val):
        if isinstance(val,(float,int)): inp.default_value=val
        elif isinstance(val,(tuple,list)): inp.default_value=val
        else: self.l.new(val,inp)
    def math(self, op, a, b=0, label=''):
        n=self.node('ShaderNodeMath',label)
        n.operation=op
        self.link(n.inputs[0],a); self.link(n.inputs[1],b)
        return n.outputs[0]
    def vec(self, op, a, b=(0,0,0), scale=1, label=''):
        n=self.node('ShaderNodeVectorMath',label)
        n.operation=op
        self.link(n.inputs[0],a)
        self.link(n.inputs[1],b)
        if op == 'SCALE': self.link(n.inputs[3],scale)
        return n.outputs['Value'] if op in ['LENGTH','DISTANCE','DOT_PRODUCT'] else n.outputs['Vector']
    def val(self, name, v):
        n=self.node('ShaderNodeValue',name); n.outputs[0].default_value=v
        return n.outputs[0]
    def vector(self,name,v):
        n=self.node('ShaderNodeCombineXYZ',name)
        for i in range(3): n.inputs[i].default_value=v[i]
        return n
    def noise(self, p, scale, detail=4, roughness=.65, distortion=0, name=''):
        n=self.node('ShaderNodeTexNoise',name)
        n.noise_dimensions='3D'
        self.link(n.inputs['Vector'],p)
        n.inputs['Scale'].default_value=scale
        n.inputs['Detail'].default_value=detail
        n.inputs['Roughness'].default_value=roughness
        n.inputs['Distortion'].default_value=distortion
        return n
    def clamp(self, v, lo=0, hi=1):
        return self.math('MINIMUM',self.math('MAXIMUM',v,lo),hi)
    def volume(self,density, emission=0):
        n=self.node('ShaderNodeVolumePrincipled','Physically_lit_neutral_smoke')
        n.inputs['Color'].default_value=(.78,.78,.78,1)
        n.inputs['Anisotropy'].default_value=.22
        n.inputs['Emission Color'].default_value=(1,1,1,1)
        n.inputs['Emission Strength'].default_value=emission
        self.link(n.inputs['Density'],density)
        self.l.new(n.outputs['Volume'],self.out.inputs['Volume'])
    def warped_position(self, amount=.58, scale=1.8):
        geo=self.node('ShaderNodeNewGeometry')
        p=geo.outputs['Position']
        self.adv=self.vector('Animated_flow_advection',(0,0,0))
        flow=self.vec('ADD',p,self.adv.outputs[0])
        coarse=self.noise(flow,scale,4,.64,.38,'Rolling_turbulence')
        warp=self.vec('SUBTRACT',coarse.outputs['Color'],(.5,.5,.5))
        warp=self.vec('SCALE',warp,scale=amount)
        q=self.vec('ADD',p,warp)
        fine=self.noise(flow,7.2,3,.72,.25,'Fine_vorticity')
        warp2=self.vec('SUBTRACT',fine.outputs['Color'],(.5,.5,.5))
        warp2=self.vec('SCALE',warp2,scale=.15)
        return self.vec('ADD',q,warp2),flow

def volume_box(mat, name, minv, maxv):
    center = (Vector(minv)+Vector(maxv))*.5
    ext = (Vector(maxv)-Vector(minv))*.5
    bpy.ops.mesh.primitive_cube_add(size=2,location=center)
    ob=bpy.context.object
    ob.name=name
    ob.scale=ext
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(mat)
    return ob

def key_vec(n,v,f):
    for i in range(3):
        n.inputs[i].default_value=v[i]
        n.inputs[i].keyframe_insert('default_value',frame=f)
def key_val(s,v,f):
    s.default_value=v
    s.keyframe_insert('default_value',frame=f)

def smoke():
    sc=reset('Volumetric_smoke_eruption',(0,0,2.65),(0,-14,3.6),6.85)
    if opt.engine=='BLENDER_EEVEE':
        sc.eevee.volumetric_start=11
        sc.eevee.volumetric_end=17
    g=Graph('SMOKE__advected_multiscale_density')
    p,flow=g.warped_position(.96,1.55)
    # Lobes expand from the eruption origin and roll into the rising crown.
    lobes=[
        ((-.10,.0,.60),.47,.00),((.20,.06,1.24),.63,.015),
        ((-.27,.04,1.79),.85,.045),((.22,.10,2.30),.89,.07),
        ((-.85,.08,2.91),.96,.085),((.62,.14,3.00),1.06,.10),
        ((-.12,.06,3.54),1.17,.12),((-.94,.30,3.79),.82,.14),
        ((.83,.36,3.84),.84,.145),((.0,.55,4.04),.85,.16),
        ((-1.31,-.14,3.18),.61,.12),((1.29,-.12,3.16),.65,.125),
        ((-.57,-.42,2.41),.58,.075),((.53,-.54,3.68),.68,.145),
        ((-.65,-.56,3.48),.77,.125),((.12,-.64,3.11),.68,.105)]
    cn=[]; rn=[]; wn=[]; field=0
    for i,(center,r,delay) in enumerate(lobes):
        c=g.vector('Billow_%02d_center'%i,center)
        rad=g.val('Billow_%02d_radius'%i,r)
        d=g.vec('DISTANCE',p,c.outputs[0])
        d=g.math('DIVIDE',d,rad)
        s=g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',1,d),3.6))
        s=g.math('MULTIPLY',s,s)
        weight=g.val('Billow_%02d_lifetime'%i,1)
        s=g.math('MULTIPLY',s,weight)
        field=g.math('MAXIMUM',field,s)
        cn.append(c);rn.append(rad);wn.append(weight)
    noise=g.noise(flow,3.75,6,.69,.4,'Wispy_density_erosion')
    detail=g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',noise.outputs['Fac'],.24),2.2))
    detail=g.math('POWER',detail,1.45)
    density=g.math('MULTIPLY',field,detail)
    strength=g.val('Animated_density',5)
    density=g.math('MULTIPLY',density,strength)
    g.volume(density)
    volume_box(g.mat,'SMOKE_VOLUME_DOMAIN',(-3.05,-2.7,-.4),(3.05,2.7,6.0))
    for frame in range(1,65):
        t=(frame-1)/63
        key_vec(g.adv,(-.31*t,.13*t,-1.20*t),frame)
        for i,(center,r,delay) in enumerate(lobes):
            q=max(0,min(1,(t-delay)/(.46-delay)))
            ease=1-(1-q)**2.25
            decay=max(0,(t-.50)/.50)
            growth=ease*(1+.19*decay)
            cx,cy,cz=center
            ang=(i*2.399)+t*2.3
            lateral=.14*t*math.sin(ang)
            z=.18 + (cz-.18)*ease + .62*decay
            x=cx*ease+lateral*ease
            y=cy*ease+.09*t*math.cos(ang)
            key_vec(cn[i],(x,y,z),frame)
            key_val(rn[i],max(.004,r*growth),frame)
            stem_decay=max(0,1-max(0,(t-.39)/.38))**1.5 if i<4 else 1
            key_val(wn[i],stem_decay,frame)
        # Fade density naturally; outer density wisps disappear first.
        onset=min(1,t/.055)
        dissipate=max(0,1-max(0,(t-.57)/.43))**1.5
        key_val(strength,7.3*onset*dissipate,frame)
    sc['effect']='Coherent advected volumetric smoke eruption with independently rolling billows'
    sc['frame_count']=64
    sc['fps']=30
    sc['baked_bloom']=False
    sc['pivot_uv_tile_top_origin']=[.5,(4+248*(.5+(2.65*14/math.sqrt(14**2+.95**2))/6.85))/256]
    return sc

def shockwave():
    sc=reset('Turbulent_shockwave_ring',(0,0,0),(0,0,10),6.50)
    if opt.engine=='BLENDER_EEVEE':
        sc.eevee.volumetric_start=9.45
        sc.eevee.volumetric_end=10.55
    for light in bpy.data.objects:
        if light.type=='LIGHT':light.data.energy*=7.5
    g=Graph('SHOCKWAVE__advected_toroidal_volume')
    p,flow=g.warped_position(.46,2.9)
    sep=g.node('ShaderNodeSeparateXYZ')
    g.l.new(p,sep.inputs[0])
    xy=g.node('ShaderNodeCombineXYZ')
    g.l.new(sep.outputs['X'],xy.inputs[0]);g.l.new(sep.outputs['Y'],xy.inputs[1])
    radial=g.vec('LENGTH',xy.outputs[0])
    radius=g.val('Animated_shockwave_radius',1)
    width=g.val('Animated_ring_width',.13)
    radial_dist=g.math('SUBTRACT',radial,radius)
    distort=g.noise(flow,4.7,4,.7,.35,'Rolling_ring_edge')
    rwarp=g.math('MULTIPLY',g.math('SUBTRACT',distort.outputs['Fac'],.5),.13)
    radial_dist=g.math('ADD',radial_dist,rwarp)
    rr=g.math('MULTIPLY',radial_dist,radial_dist)
    zz=g.math('MULTIPLY',sep.outputs['Z'],2.4)
    zz=g.math('MULTIPLY',zz,zz)
    tube=g.math('SQRT',g.math('ADD',rr,zz))
    tube=g.math('DIVIDE',tube,width)
    main=g.math('POWER',g.clamp(g.math('SUBTRACT',1,tube)),1.1)
    # A softer, slightly delayed inner rolling cloud adds a physically useful wake.
    trail_r=g.math('SUBTRACT',radial_dist,-.16)
    trail_r=g.math('MULTIPLY',trail_r,trail_r)
    trail=g.math('SQRT',g.math('ADD',trail_r,zz))
    trail=g.math('DIVIDE',trail,g.math('MULTIPLY',width,2.25))
    trail=g.math('MULTIPLY',g.math('POWER',g.clamp(g.math('SUBTRACT',1,trail)),1.4),.16)
    cloud=g.math('MAXIMUM',main,trail)
    n=g.noise(flow,8.5,4,.7,1.2,'Substructure_wisps')
    n2=g.noise(flow,2.6,4,.63,.9,'Broken_circumference')
    breakup=g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',n2.outputs['Fac'],.47),8.8))
    fine=g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',n.outputs['Fac'],.29),3.2))
    wisps=g.math('MULTIPLY',fine,breakup)
    strength=g.val('Animated_density',22)
    density=g.math('MULTIPLY',cloud,g.math('MULTIPLY',wisps,strength))
    g.volume(density)
    volume_box(g.mat,'SHOCKWAVE_VOLUME_DOMAIN',(-3.2,-3.2,-.5),(3.2,3.2,.5))
    for frame in range(1,65):
        t=(frame-1)/63
        radius_v=.065 + 2.50*(1-(1-t)**1.15)
        width_v=.035 + .14*math.sin(math.pi*t)**.75
        key_val(radius,radius_v,frame)
        key_val(width,width_v,frame)
        key_val(strength,38*min(1,t/.048)*max(0,(1-t))**.72,frame)
        key_vec(g.adv,(.23*t,-.14*t,-.6*t),frame)
    sc['effect']='Expanding volumetric shockwave with broken turbulent circumference and rolling wake'
    sc['frame_count']=64;sc['fps']=30;sc['baked_bloom']=False;sc['pivot_uv']=[.5,.5]
    return sc

def mesh_library():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    random.seed(314159)
    def mesh(name,verts,faces):
        data=bpy.data.meshes.new(name+'_faceted_geometry')
        data.from_pydata(verts,[],faces);data.update()
        ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
        center=sum((v.co.copy() for v in data.vertices),Vector())/len(data.vertices)
        for v in data.vertices:v.co-=center
        rad=max(v.co.length for v in data.vertices)
        for v in data.vertices:v.co/=rad
        for p in data.polygons:p.use_smooth=False
        ob['normalized_radius']=1.0;ob['pivot']='centroid';ob['style']='crisp flat facets'
        mat=bpy.data.materials.new(name+'_neutral_placeholder');mat.diffuse_color=(.65,.65,.65,1)
        mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.43
        ob.data.materials.append(mat)
        return ob
    # Irregular six-sided crystal, broken heel and skewed sharp crown.
    verts=[]
    for z,scale,ang in [(-.70,.36,0),(-.13,.52,.11),(.60,.29,.025)]:
        for i in range(6):
            a=i*math.tau/6+ang
            verts.append((math.cos(a)*scale*(.85+random.random()*.22),math.sin(a)*scale*.63,z+random.uniform(-.10,.10)))
    verts += [(-.075,.04,1.50),(.03,-.05,-.95)]
    faces=[]
    for ring in range(2):
        for i in range(6):
            a=ring*6+i;b=ring*6+(i+1)%6;c=(ring+1)*6+(i+1)%6;d=(ring+1)*6+i
            faces += [(a,b,c),(a,c,d)]
    for i in range(6):faces += [(12+i,12+(i+1)%6,18),((i+1)%6,i,19)]
    ice=mesh('ice_shard',verts,faces)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1)
    stone=bpy.context.object;stone.name='stone_chip';stone.data.name='stone_chip_faceted_geometry'
    for v in stone.data.vertices:
        v.co.x*=random.uniform(.88,1.13);v.co.y*=random.uniform(.66,.83);v.co.z*=random.uniform(.33,.49)
    center=sum((v.co.copy() for v in stone.data.vertices),Vector())/len(stone.data.vertices)
    for v in stone.data.vertices:v.co-=center
    rad=max(v.co.length for v in stone.data.vertices)
    for v in stone.data.vertices:v.co/=rad
    stone['normalized_radius']=1.;stone['pivot']='centroid'
    for p in stone.data.polygons:p.use_smooth=False
    metal=mesh('metal_splinter',[
        (-.15,-.095,-.85),(.18,-.07,-.80),(.15,.095,-.77),(-.13,.075,-.85),
        (-.06,-.08,.23),(.145,-.05,.44),(.07,.065,.38),(-.12,.045,.15),
        (.12,-.025,1.08),(.03,.027,.86)
    ],[(0,2,1),(0,3,2),(0,1,5),(0,5,4),(1,2,6),(1,6,5),
       (2,3,7),(2,7,6),(3,0,4),(3,4,7),(4,5,8),(5,6,8),(6,9,8),(6,7,9),(7,4,9),(4,8,9)])
    bpy.ops.object.select_all(action='DESELECT')
    for ob in [ice,stone,metal]:ob.select_set(True)
    bpy.context.view_layer.objects.active=ice
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'shard_library.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'shard_library.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_extras=True)
    stats={ob.name:{'triangles':sum(len(p.vertices)-2 for p in ob.data.polygons),'vertices':len(ob.data.vertices),'radius':max(v.co.length for v in ob.data.vertices),'pivot':'vertex centroid; object translation zero','axes':'glTF Y-up'} for ob in [ice,stone,metal]}
    with open(os.path.join(ROOT,'mesh_metadata.json'),'w') as f:json.dump(stats,f,indent=2)

def bake(effect,full):
    sc=smoke() if effect=='smoke' else shockwave()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,effect+'.blend'))
    directory=os.path.join(ROOT,effect+'_frames' if full else 'previews')
    os.makedirs(directory,exist_ok=True)
    frames=range(1,65) if full else ([opt.preview_frame] if opt.preview_frame else [12,25,40,53])
    for frame in frames:
        sc.frame_set(frame)
        sc.render.filepath=os.path.join(directory,(effect+'_%03d.png')%frame)
        bpy.ops.render.render(write_still=True)
        print('BAKED',effect,frame,flush=True)

if opt.mode=='mesh':mesh_library()
elif opt.mode=='preview':
    bake('smoke',False)
    bake('shockwave',False)
elif opt.mode=='all':
    mesh_library()
    bake('smoke',True)
    bake('shockwave',True)
elif opt.mode in ['smoke','shockwave']:bake(opt.mode,True)
