"""Original Blender hero spell assets. All geometry/volumes are authored analytically.

No fluid-simulation claim: coherent animated density fields, crystal geometry,
and an animated liquid sheet with ballistic droplets. Blender 5.2 / EEVEE.
Usage: blender --background --python bake_hero_assets.py -- --effect all --mode preview
"""
import bpy, math, os, sys, random, argparse, json
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT=os.path.dirname(os.path.abspath(__file__))
pa=argparse.ArgumentParser()
pa.add_argument('--effect',default='all')
pa.add_argument('--mode',default='preview')
pa.add_argument('--resolution',type=int,default=496)
pa.add_argument('--samples',type=int,default=48)
pa.add_argument('--frame',type=int,default=0)
opt=pa.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
TAU=math.tau
def sat(x):return max(0.,min(1.,x))
def ease(x):return 1-(1-sat(x))**2.5
def kv(s,v,f):s.default_value=v;s.keyframe_insert('default_value',frame=f)
def key(ob,prop,v,f):setattr(ob,prop,v);ob.keyframe_insert(prop,frame=f)
def keyvec(n,v,f):
    for i in range(3):kv(n.inputs[i],v[i],f)

def reset(name,target,scale):
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    sc=bpy.context.scene;sc.name=name
    sc.render.engine='BLENDER_EEVEE'
    sc.eevee.taa_render_samples=opt.samples
    sc.eevee.volumetric_samples=96
    sc.eevee.volumetric_tile_size='2'
    sc.eevee.use_volumetric_shadows=True
    sc.eevee.volumetric_shadow_samples=48
    sc.eevee.use_volume_custom_range=True
    sc.eevee.volumetric_start=10
    sc.eevee.volumetric_end=19
    sc.render.resolution_x=sc.render.resolution_y=opt.resolution
    sc.render.resolution_percentage=100
    sc.render.film_transparent=True
    sc.render.image_settings.file_format='PNG'
    sc.render.image_settings.color_mode='RGBA'
    sc.render.image_settings.color_depth='16'
    sc.render.image_settings.compression=30
    sc.render.fps=30;sc.frame_start=1;sc.frame_end=64
    sc.view_settings.view_transform='AgX'
    sc.view_settings.look='AgX - Medium High Contrast'
    sc.world.use_nodes=True
    bg=sc.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value=(.10,.14,.20,1);bg.inputs['Strength'].default_value=.32
    target=Vector(target)
    bpy.ops.object.camera_add(location=target+Vector((0,-14,5.1)))
    cam=bpy.context.object;cam.name=name+'_fixed_ortho_camera'
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=scale;sc.camera=cam
    for ln,loc,power,size,col in [
      ('Large_key',(-3,-4,6),1250,4,(.72,.88,1)),
      ('Narrow_white_rim',(3,1,5),2100,2,(.87,.96,1)),
      ('Low_fill',(-3,2,2),800,3,(.34,.72,1)),
      ('Front_reflector',(1,-5,3),900,1.3,(1,1,1))]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        ob=bpy.context.object;ob.name=ln;ob.data.energy=power;ob.data.shape='DISK';ob.data.size=size;ob.data.color=col
        ob.rotation_euler=(target-ob.location).to_track_quat('-Z','Y').to_euler()
    sc['bloom_baked']=False;sc['frame_count']=64;sc['fps']=30
    sc['simulation']='Authored analytic animation, not a fluid simulation'
    return sc

class Graph:
    def __init__(self,name):
        self.mat=bpy.data.materials.new(name);self.mat.use_nodes=True
        self.nt=self.mat.node_tree;self.nt.nodes.clear();self.n=self.nt.nodes;self.l=self.nt.links;self.count=0
        self.out=self.node('ShaderNodeOutputMaterial')
    def node(self,typ,label=''):
        n=self.n.new(typ);self.count+=1;n.location=((self.count%10)*210,-(self.count//10)*210)
        if label:n.name=n.label=label
        return n
    def link(self,inp,val):
        if isinstance(val,(int,float,tuple,list)):inp.default_value=val
        else:self.l.new(val,inp)
    def math(self,op,a,b=0):
        n=self.node('ShaderNodeMath');n.operation=op;self.link(n.inputs[0],a);self.link(n.inputs[1],b);return n.outputs[0]
    def vec(self,op,a,b=(0,0,0),scale=1):
        n=self.node('ShaderNodeVectorMath');n.operation=op;self.link(n.inputs[0],a);self.link(n.inputs[1],b)
        if op=='SCALE':self.link(n.inputs[3],scale)
        return n.outputs['Value'] if op in ('DISTANCE','LENGTH','DOT_PRODUCT') else n.outputs['Vector']
    def val(self,name,v):
        n=self.node('ShaderNodeValue',name);n.outputs[0].default_value=v;return n.outputs[0]
    def vector(self,name,v):
        n=self.node('ShaderNodeCombineXYZ',name)
        for i in range(3):n.inputs[i].default_value=v[i]
        return n
    def clamp(self,v):return self.math('MINIMUM',self.math('MAXIMUM',v,0),1)
    def noise(self,p,scale,detail=4,rough=.68,distort=.3):
        n=self.node('ShaderNodeTexNoise');self.link(n.inputs['Vector'],p)
        n.inputs['Scale'].default_value=scale;n.inputs['Detail'].default_value=detail
        n.inputs['Roughness'].default_value=rough;n.inputs['Distortion'].default_value=distort;return n
    def warped(self,amount=.8,scale=2):
        p=self.node('ShaderNodeNewGeometry').outputs['Position']
        self.adv=self.vector('FLOW_advection',(0,0,0))
        flow=self.vec('ADD',p,self.adv.outputs[0])
        n=self.noise(flow,scale,5,.72,.65)
        warp=self.vec('SCALE',self.vec('SUBTRACT',n.outputs['Color'],(.5,.5,.5)),scale=amount)
        q=self.vec('ADD',p,warp)
        fine=self.noise(flow,8.5,3,.65,.35)
        q=self.vec('ADD',q,self.vec('SCALE',self.vec('SUBTRACT',fine.outputs['Color'],(.5,.5,.5)),scale=.13))
        return q,flow

def box(mat,name,lo,hi):
    bpy.ops.mesh.primitive_cube_add(size=2,location=(Vector(lo)+Vector(hi))*.5)
    ob=bpy.context.object;ob.name=name;ob.scale=(Vector(hi)-Vector(lo))*.5
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);ob.data.materials.append(mat);return ob

def material(name,col,metal=.2,rough=.2,emission=0,opacity=1,bump=.035):
    g=Graph(name);p=g.node('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=rough;p.inputs['IOR'].default_value=1.33
    p.inputs['Coat Weight'].default_value=.72;p.inputs['Coat Roughness'].default_value=.10
    p.inputs['Emission Color'].default_value=(*col,1);p.inputs['Emission Strength'].default_value=emission
    if bump:
        n=g.noise(g.node('ShaderNodeTexCoord').outputs['Generated'],9,4,.65,.12)
        b=g.node('ShaderNodeBump');b.inputs['Strength'].default_value=.27;b.inputs['Distance'].default_value=bump
        g.l.new(n.outputs['Fac'],b.inputs['Height']);g.l.new(b.outputs[0],p.inputs['Normal'])
    trans=g.node('ShaderNodeBsdfTransparent');mix=g.node('ShaderNodeMixShader','Lifetime_opacity')
    fade=g.val('GLOBAL_OPACITY',opacity);g.l.new(fade,mix.inputs[0]);g.l.new(trans.outputs[0],mix.inputs[1]);g.l.new(p.outputs[0],mix.inputs[2]);g.l.new(mix.outputs[0],g.out.inputs['Surface'])
    return g.mat,fade

def meshob(name,verts,faces,mat,smooth=False):
    me=bpy.data.meshes.new(name+'_geometry');me.from_pydata(verts,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    for p in me.polygons:p.use_smooth=smooth
    return ob

def ico(name,mat,sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1)
    ob=bpy.context.object;ob.name=name;ob.data.materials.append(mat)
    for p in ob.data.polygons:p.use_smooth=True
    return ob

def curveob(name,coords,radius,mat):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=2
    cu.bevel_depth=radius;cu.bevel_resolution=2
    sp=cu.splines.new('POLY');sp.points.add(len(coords)-1)
    for p,co in zip(sp.points,coords):p.co=(*co,1)
    ob=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat);return ob

def fire():
    sc=reset('PYROBLAST_rolling_combustion',(0,0,2.10),6.70)
    sc.view_settings.view_transform='Standard';sc.view_settings.look='None'
    for ob in bpy.data.objects:
        if ob.type=='LIGHT':ob.data.energy*=.09
    g=Graph('Fire_rolling_combustion_density_temperature')
    p,flow=g.warped(.96,1.85)
    # Four asymmetric rolling branches, expanded from a shared base.
    lobes=[(-.2,0,.40,.48,0),(-.65,0,.85,.68,.01),(.47,.12,.95,.64,.015),
      (-1.12,.1,1.35,.78,.035),(.48,-.1,1.65,.85,.045),(.95,.12,2.15,.73,.07),
      (.54,.08,2.65,.66,.09),(-.15,.05,2.90,.77,.11),(-.68,.1,3.36,.67,.13),
      (-.48,.18,3.84,.54,.15),(-1.31,-.18,2.11,.59,.075),(-1.05,-.2,2.69,.51,.11),
      (1.45,.0,1.23,.54,.055),(1.76,.05,1.64,.44,.075),(.18,-.45,1.16,.55,.02),
      (-.76,-.44,1.87,.59,.055),(.49,-.43,2.23,.60,.08),(-.3,-.40,3.05,.53,.11),
      (1.26,.18,.61,.39,.035),(-1.63,.08,.80,.38,.055)]
    field=0;controls=[]
    for i,(x,y,z,r,delay) in enumerate(lobes):
        c=g.vector('Roll_%02d_center'%i,(x,y,z));rad=g.val('Roll_%02d_radius'%i,r);w=g.val('Roll_%02d_density'%i,1)
        d=g.math('DIVIDE',g.vec('DISTANCE',p,c.outputs[0]),rad)
        s=g.math('POWER',g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',1,d),3.2)),1.7)
        field=g.math('MAXIMUM',field,g.math('MULTIPLY',s,w));controls.append((c,rad,w))
    noise=g.noise(flow,4.2,6,.76,.8)
    detail=g.math('POWER',g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',noise.outputs['Fac'],.27),2.6)),2.0)
    dens=g.math('MULTIPLY',field,detail);strength=g.val('Lifetime_density',5)
    density=g.math('MULTIPLY',dens,strength)
    hotnoise=g.noise(flow,2.35,4,.62,1.5)
    hot=g.math('POWER',g.clamp(g.math('MULTIPLY',g.math('SUBTRACT',hotnoise.outputs['Fac'],.43),3.9)),2.7)
    heat=g.val('Lifetime_temperature',1)
    emitted=g.math('MULTIPLY',g.math('MULTIPLY',g.math('MULTIPLY',dens,hot),heat),19)
    ramp=g.node('ShaderNodeValToRGB','Combustion_temperature_palette')
    cr=ramp.color_ramp;cr.elements.remove(cr.elements[1])
    for idx,(pos,col) in enumerate([(0,(.34,.001,.0001,1)),(.3,(1,.013,.0003,1)),(.67,(1,.10,.002,1)),(1,(1,.37,.018,1))]):
        e=cr.elements[0] if idx==0 else cr.elements.new(pos);e.position=pos;e.color=col
    g.l.new(hot,ramp.inputs[0])
    v=g.node('ShaderNodeVolumePrincipled','Smoke_and_combustion_volume')
    v.inputs['Color'].default_value=(.095,.068,.052,1);v.inputs['Anisotropy'].default_value=.15
    g.l.new(density,v.inputs['Density']);g.l.new(emitted,v.inputs['Emission Strength']);g.l.new(ramp.outputs[0],v.inputs['Emission Color']);g.l.new(v.outputs[0],g.out.inputs['Volume'])
    box(g.mat,'Combustion_volume_domain',(-2.8,-2,-.45),(2.8,2,5.35))
    for f in range(1,65):
        t=(f-1)/63;growth=ease(t/.30);decay=sat((t-.55)/.45)
        keyvec(g.adv,(-.5*t,.20*t,-2.0*t),f)
        for i,((x,y,z,r,delay),(c,rad,w)) in enumerate(zip(lobes,controls)):
            e=ease((t-delay)/(.30-delay));a=i*2.399+t*3.3
            keyvec(c,(x*e+.17*math.sin(a)*e,y*e+.13*math.cos(a)*e,.08+(z-.08)*e+.48*decay),f)
            kv(rad,max(.002,r*e*(1+.28*decay)),f)
            kv(w,max(0,1-sat((t-.45)/.30)) if i<3 else 1,f)
        kv(strength,4.6*sat(t/.028)*(1-decay)**1.6,f)
        kv(heat,1.75*(1-sat((t-.38)/.48))**1.3,f)
    ember,fade=material('Hot_ember_gold',(1,.12,.006),.1,.32,8,1,0)
    rng=random.Random(9827)
    for i in range(100):
        ob=ico('Ballistic_ember_%03d'%i,ember,1)
        theta=rng.uniform(0,TAU);speed=rng.uniform(.4,2.1);start=rng.uniform(.03,.35);life=rng.uniform(.26,.53)
        size=rng.uniform(.008,.030);z0=rng.uniform(.10,2.4)
        for f in range(1,65):
            t=(f-1)/63;q=sat((t-start)/life);active=math.sin(math.pi*q)**.5
            age=q*life*2.1
            key(ob,'location',(math.cos(theta)*speed*age,.35*math.sin(theta)*age,z0+2.1*age-.85*age*age),f)
            key(ob,'scale',(size*active,size*active,size*(1.8+3*q)*active),f)
    sc['effect']='Asymmetric rolling combustion, cooling charcoal smoke, independently ballistic embers'
    return sc

def crystal_mesh(name,mat,rng):
    verts=[]
    for z,r,phase in [(-.13,.33,0),(.18,.47,.12),(.72,.29,.025)]:
        for k in range(6):
            a=k*TAU/6+phase;rr=r*rng.uniform(.86,1.12)
            verts.append((math.cos(a)*rr,math.sin(a)*rr*.69,z+rng.uniform(-.04,.04)))
    verts.extend([(.035,-.025,1.48),(-.08,.02,-.27)])
    faces=[]
    for ring in range(2):
        for k in range(6):
            a=ring*6+k;b=ring*6+(k+1)%6;c=(ring+1)*6+(k+1)%6;d=(ring+1)*6+k
            faces.extend([(a,b,c),(a,c,d)])
    for k in range(6):faces.extend([(12+k,12+(k+1)%6,18),((k+1)%6,k,19)])
    return meshob(name,verts,faces,mat)

def frost_vapor():
    g=Graph('Cold_vapor_advected_low_ring');p,flow=g.warped(.40,3.1)
    sep=g.node('ShaderNodeSeparateXYZ');g.l.new(p,sep.inputs[0]);xy=g.node('ShaderNodeCombineXYZ')
    g.l.new(sep.outputs['X'],xy.inputs[0]);g.l.new(sep.outputs['Y'],xy.inputs[1])
    rad=g.val('Ring_radius',1);width=g.val('Ring_width',.24)
    d=g.math('SUBTRACT',g.vec('LENGTH',xy.outputs[0]),rad)
    z=g.math('MULTIPLY',g.math('SUBTRACT',sep.outputs['Z'],.15),2.6)
    d=g.math('SQRT',g.math('ADD',g.math('MULTIPLY',d,d),g.math('MULTIPLY',z,z)))
    field=g.math('POWER',g.clamp(g.math('SUBTRACT',1,g.math('DIVIDE',d,width))),1.8)
    n=g.noise(flow,5,5,.72,.5);strength=g.val('Vapor_lifetime',5)
    dens=g.math('MULTIPLY',g.math('MULTIPLY',field,n.outputs['Fac']),strength)
    v=g.node('ShaderNodeVolumePrincipled');v.inputs['Color'].default_value=(.44,.76,.94,1);v.inputs['Anisotropy'].default_value=.1
    g.l.new(dens,v.inputs['Density']);g.l.new(v.outputs[0],g.out.inputs['Volume'])
    box(g.mat,'Frost_vapor_domain',(-3.2,-3.2,-.4),(3.2,3.2,1.0))
    for f in range(1,65):
        t=(f-1)/63;kv(rad,.06+2.6*ease(t/.80),f);kv(width,.06+.28*math.sin(math.pi*t),f)
        kv(strength,4.0*sat(t/.06)*(1-t)**1.2,f);keyvec(g.adv,(.1*t,-.2*t,-.8*t),f)

def frost():
    sc=reset('FROST_NOVA_fracture_crown',(0,0,1.10),7.25)
    for ob in bpy.data.objects:
        if ob.type=='LIGHT':ob.data.energy*=.65
    mats=[];fades=[]
    for i,col in enumerate([(.07,.38,.65),(.22,.63,.87),(.42,.79,1),(.045,.17,.34)]):
        m,fa=material('Ice_facets_%d'%i,col,.48,.14,.055,.95,.025);mats.append(m);fades.append(fa)
    rim,rf=material('Icy_white_fracture_edges',(.65,.91,1),.3,.16,.3,.9,0);fades.append(rf)
    rng=random.Random(52339)
    for i in range(54):
        a=i*2.399+rng.uniform(-.15,.15)
        ring=0 if i<6 else (1 if i<24 else 2)
        radius=rng.uniform(.03,.4) if ring==0 else rng.uniform(.4,1.0) if ring==1 else rng.uniform(1.05,1.55)
        height=rng.uniform(1.30,2.0) if ring==0 else rng.uniform(.82,1.40) if ring==1 else rng.uniform(.43,.83)
        lean=.15 if ring==0 else .65 if ring==1 else 1.04
        ob=crystal_mesh('Radial_crystal_%02d'%i,mats[i%4],rng)
        direction=Vector((math.cos(a)*math.sin(lean),math.sin(a)*math.sin(lean),math.cos(lean)))
        quat=direction.to_track_quat('Z','Y');ob.rotation_mode='QUATERNION';ob.rotation_quaternion=quat
        thickness=rng.uniform(.30,.55);delay=.015+ring*.035+rng.uniform(0,.04)
        for f in range(1,65):
            t=(f-1)/63;grow=ease((t-delay)/.20);breakup=sat((t-.49)/.51)
            r=radius*grow+.35*breakup
            key(ob,'location',(math.cos(a)*r,math.sin(a)*r,.03+.34*math.sin(breakup*math.pi)),f)
            key(ob,'scale',(thickness*grow,thickness*grow,height*grow*(1-.48*breakup)),f)
    # Broken radial plates provide the outward impact read.
    for i in range(36):
        a=i*TAU/36;r=rng.uniform(.7,1.5);da=rng.uniform(.025,.065);extent=rng.uniform(.4,.85)
        verts=[(r*math.cos(a-da),r*math.sin(a-da),.02),((r+extent)*math.cos(a), (r+extent)*math.sin(a),.04),
               (r*math.cos(a+da),r*math.sin(a+da),.03),((r+.1)*math.cos(a),(r+.1)*math.sin(a),.21)]
        ob=meshob('Fracture_plate_%02d'%i,verts,[(0,1,3),(1,2,3),(2,0,3),(0,2,1)],mats[i%3])
        for f in range(1,65):
            t=(f-1)/63;v=ease((t-.04)/.18)*(1-.20*sat((t-.60)/.4));key(ob,'scale',(v,v,v),f)
    for i in range(44):
        a=rng.uniform(0,TAU);speed=rng.uniform(.8,2.3);zspeed=rng.uniform(.5,2.0);delay=rng.uniform(.14,.30);size=rng.uniform(.035,.09)
        ob=crystal_mesh('Airborne_ice_splinter_%02d'%i,mats[i%3],rng)
        for f in range(1,65):
            t=(f-1)/63;q=sat((t-delay)/.64);age=q*1.3;s=math.sin(math.pi*q)**.7*size
            key(ob,'location',(math.cos(a)*speed*age,math.sin(a)*speed*age,.10+zspeed*age-.85*age*age),f)
            key(ob,'scale',(s,s,s*1.5),f);key(ob,'rotation_euler',(q*3+i,q*2,i+q*4),f)
    for fa in fades:
        for f in range(1,65):
            t=(f-1)/63;kv(fa,.97*sat(t/.025)*(1-sat((t-.61)/.39))**1.5,f)
    frost_vapor();sc['effect']='Radial ice fracture crown, 54 shaped crystals, 36 plates, ballistic splinters and cold vapor';return sc

def water():
    sc=reset('CHAIN_HEAL_breaking_liquid_surge',(0,0,1.30),6.30)
    for ob in bpy.data.objects:
        if ob.type=='LIGHT':ob.data.energy*=.68
    watermat,fade=material('Healing_liquid_coated_aqua',(.008,.30,.20),.26,.08,.075,.91,.025)
    # Actual view-angle-dependent sheet opacity, preserved in the rendered alpha.
    nt=watermat.node_tree
    facing=nt.nodes.new('ShaderNodeLayerWeight');facing.inputs['Blend'].default_value=.35
    thick=nt.nodes.new('ShaderNodeMath');thick.operation='MULTIPLY_ADD'
    nt.links.new(facing.outputs['Facing'],thick.inputs[0]);thick.inputs[1].default_value=.32;thick.inputs[2].default_value=.52
    mult=nt.nodes.new('ShaderNodeMath');mult.operation='MULTIPLY'
    nt.links.new(fade,mult.inputs[0]);nt.links.new(thick.outputs[0],mult.inputs[1]);nt.links.new(mult.outputs[0],nt.nodes['Lifetime_opacity'].inputs[0])
    foam,ff=material('Crest_foam_luminous_jade',(.43,.91,.72),.3,.12,.35,.90,.025)
    inner,inf=material('Luminous_inner_current',(.045,.6,.23),.25,.15,.75,.90,.02)
    W=35;N=97
    def fluid_point(u,w,t,offset=0):
        grow=ease(t/.11);front=ease(t/.34);breaking=sat((t-.39)/.61)
        # The front travels through the arc; the sheet first spreads low, rises,
        # and only then curls over. This is shape evolution, not sprite scaling.
        angle=math.radians(-133+269*u*front)+.11*math.sin(2.2*t+u*3)
        r=1.40+.11*math.sin(8*u+4*w-4.1*t)+.05*math.sin(27*u-6*w+3*t)
        r+=.027*math.sin(70*u+21*w-10*t)+.022*math.cos(43*w+27*u+3*t)+offset
        x=.05+r*math.cos(angle)+.11*math.sin(w*5+u*9+t*2)
        z=1.48+r*math.sin(angle)+.06*math.sin(w*8+u*23+t*4)
        y=w*(.62+.16*math.sin(u*math.pi))+.10*math.sin(u*10+w*3+t*2)
        z+=.06*(1-w*w)*math.sin(u*16+t*3)
        return (x*grow*(1+.10*breaking),y*grow,max(.025,z*grow*(1-.25*breaking)))
    def positions(t,offset=0):
        return [fluid_point(j/(N-1),2*k/(W-1)-1,t,offset) for j in range(N) for k in range(W)]
    faces=[]
    for j in range(N-1):
        for k in range(W-1):
            a=j*W+k
            # Stable holes near torn crests, outside core coherent sheet.
            if j>78 and (k*11+j*7)%31<4:continue
            faces.append((a,a+1,a+W+1,a+W))
    sheet=meshob('Curled_breaking_liquid_sheet',positions(.3),faces,watermat,True)
    solid=sheet.modifiers.new('Thin_fluid_film_thickness','SOLIDIFY');solid.thickness=.014
    sheet.shape_key_add(name='Basis')
    for f in range(1,65):
        t=(f-1)/63;sk=sheet.shape_key_add(name='Liquid_pose_%02d'%f)
        for v,co in zip(sk.data,positions(t)):v.co=co
        for k in [max(1,f-1),f,min(64,f+1)]:sk.value=1 if k==f else 0;sk.keyframe_insert('value',frame=k)
    rng=random.Random(918373)
    # Filament geometry follows the same curled profile; it is not painted light.
    for i in range(22):
        w=rng.uniform(-1,1);u0=rng.uniform(.05,.70);u1=min(.99,u0+rng.uniform(.15,.40));coords=[]
        for k in range(34):
            u=u0+(u1-u0)*k/33;coords.append(fluid_point(u,w,.30,.025))
        ob=curveob('Fluid_crest_filament_%02d'%i,coords,rng.uniform(.006,.015),foam if i%3 else inner)
        for f in range(1,65):
            t=(f-1)/63
            for k,point in enumerate(ob.data.splines[0].points):
                u=u0+(u1-u0)*k/33;point.co=(*fluid_point(u,w,t,.025),1);point.keyframe_insert('co',frame=f)
    # Lip beads and spray are individually animated along ballistic trajectories.
    for i in range(144):
        ob=ico('Liquid_spray_droplet_%03d'%i,foam if i%5==0 else watermat,2)
        a=rng.uniform(-.85,2.45);rad=rng.uniform(1.25,1.6);y=rng.uniform(-.8,.8)
        origin=Vector((.05+rad*math.cos(a),y,1.48+rad*math.sin(a)))
        speed=rng.uniform(.25,1.10);vel=Vector((math.cos(a)*speed,rng.uniform(-.35,.35),math.sin(a)*speed+.25))
        start=rng.uniform(.07,.35);life=rng.uniform(.36,.61);size=rng.uniform(.012,.065)
        for f in range(1,65):
            t=(f-1)/63;q=sat((t-start)/life);active=math.sin(math.pi*q)**.55;age=q*1.23
            pos=origin*ease(t/.23)+vel*age+Vector((0,0,-.65*age*age))
            key(ob,'location',pos,f);key(ob,'scale',(size*active,size*.78*active,size*(1.2+q)*active),f)
            key(ob,'rotation_euler',(0,-a+.5+q,0),f)
    for fa,base in [(fade,.93),(ff,.94),(inf,.9)]:
        for f in range(1,65):
            t=(f-1)/63;kv(fa,base*sat(t/.035)*(1-sat((t-.58)/.42))**1.5,f)
    sc['effect']='Folded liquid sheet with coherent rolling lip, geometric foam filaments, 144 ballistic stretched droplets'
    return sc

BUILDERS={'pyroblast':fire,'frost_nova':frost,'chain_heal':water}
def bake(effect):
    sc=BUILDERS[effect]()
    sc.frame_set(23);bpy.context.view_layer.update()
    pivot=world_to_camera_view(sc,sc.camera,Vector((0,0,0)))
    meta={'effect':effect,'source':effect+'.blend','authoring':'Original authored analytic Blender geometry/volume animation; no fluid simulation',
      'camera':{'type':'orthographic','target_pivot_world':[0,0,0],'location':list(sc.camera.location),'rotation_euler':list(sc.camera.rotation_euler),'ortho_scale':sc.camera.data.ortho_scale},
      'pivot_uv_content_top_origin':[pivot.x,1-pivot.y],'pivot_uv_tile_top_origin':[(8+496*pivot.x)/512,(8+496*(1-pivot.y))/512],
      'phase_frames_zero_based':{'onset':[0,6],'rise':[7,18],'peak':[19,32],'breakup':[33,46],'tail':[47,63]},
      'normal_map':None,'motion_vector_map':None,'auxiliary_map_note':'No invented normal or optical flow maps. Volume density has no single surface normal; beauty-only contract.',
      'simulation_claim':False,'bloom_baked':False,'view_transform':sc.view_settings.view_transform+' / '+sc.view_settings.look,'render_engine':'EEVEE','samples':opt.samples,'render_resolution':opt.resolution}
    with open(os.path.join(ROOT,effect+'_source.json'),'w') as f:json.dump(meta,f,indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,effect+'.blend'))
    directory=os.path.join(ROOT,effect+'_frames' if opt.mode=='full' else 'lookdev');os.makedirs(directory,exist_ok=True)
    frames=[opt.frame] if opt.frame else range(1,65) if opt.mode=='full' else [12,23,39,54]
    for frame in frames:
        sc.frame_set(frame);sc.render.filepath=os.path.join(directory,'%s_%03d.png'%(effect,frame))
        bpy.ops.render.render(write_still=True);print('HERO_BAKED',effect,frame,flush=True)

for effect in BUILDERS if opt.effect=='all' else [opt.effect]:bake(effect)
