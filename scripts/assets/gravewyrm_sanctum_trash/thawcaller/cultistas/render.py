import sys,json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0,str(Path(__file__).resolve().parent))
from config import BASE,TMP,SPECS
from stage import camera
args=sys.argv[sys.argv.index('--')+1:];key=args[0];mode=args[1] if len(args)>1 else 'poses'
out=BASE/key;sc=bpy.context.scene;rig=bpy.data.objects['Broodsworn_Rig']
sha=hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
sc.render.engine='BLENDER_EEVEE';sc.eevee.taa_render_samples=32;sc.eevee.use_raytracing=False
sc.render.threads_mode='FIXED';sc.render.threads=2
sc.render.resolution_x=1920;sc.render.resolution_y=1080;sc.render.resolution_percentage=100
sc.render.image_settings.compression=20
def select(clip,t):rig.animation_data.action=bpy.data.actions[clip];f=1+t*30;sc.frame_set(int(f),subframe=f%1)
def fit_full_scene(target):
    dg=bpy.context.evaluated_depsgraph_get();points=[]
    for obj in sc.objects:
        if obj.type!='MESH' or obj.name=='StudioFloor':continue
        ev=obj.evaluated_get(dg);me=ev.to_mesh()
        points.extend(ev.matrix_world@v.co for v in me.vertices);ev.to_mesh_clear()
    for attempt in range(24):
        bpy.context.view_layer.update()
        projected=[world_to_camera_view(sc,sc.camera,p) for p in points]
        bounds=[min(p.x for p in projected),min(p.y for p in projected),max(p.x for p in projected),max(p.y for p in projected)]
        if bounds[0]>=.045 and bounds[1]>=.045 and bounds[2]<=.955 and bounds[3]<=.955:return bounds
        if sc.camera.data.type=='ORTHO':sc.camera.data.ortho_scale*=1.12
        else:sc.camera.location=Vector(target)+(sc.camera.location-Vector(target))*1.12
    raise RuntimeError('Camera cannot contain the full creature and knight')
if mode=='poses':
    folder=out/'reviews/r3';folder.mkdir(parents=True,exist_ok=True)
    poses=[('Walk',.85),('Run',.43),('Attack',.8),('Death',2.9),('Cast',1.)]
    poses.extend((clip,t) for clip,t in [('WarmingRite',2.5),('Goad',2.),('ReRivet',6.),('PlantBrazier',1.5)] if clip in SPECS[key]['clips'])
    for clip,t in poses:
        select(clip,t);camera((8,-14,6),(-.4,-.7,1.9),10.0)
        sc.render.filepath=str(folder/(clip+'.png'));bpy.ops.render.render(write_still=True)
        (folder/(clip+'.json')).write_text(json.dumps({'model_sha256':sha,'clip':clip,'time':t}))
if mode in ('stills','final'):
    folder=out/'renders';folder.mkdir(exist_ok=True);select('Idle',0)
    for name,pos,target,ortho in [('hero',(7,-13,6),(-.5,0,2.25),None),('front',(0,-15,2.3),(-.55,0,2.3),7.),
       ('back',(0,15,2.3),(0,0,2.3),6.),('side',(12,-.1,4),(0,0,2.4),6.),
       ('head',(3,-6,4.9),(0,0,3.8),3.8),('scale_knight',(0,-15,2.3),(-.7,0,2.3),7.)]:
        camera(pos,target,ortho);framing=fit_full_scene(target) if name!='head' else None
        sc.eevee.taa_render_samples=96;sc.render.filepath=str(folder/(name+'.png'))
        bpy.ops.render.render(write_still=True)
        (folder/(name+'.json')).write_text(json.dumps({'model_sha256':sha,'engine':sc.render.engine,'samples':96,'framing_bounds':framing,
          'image_sha256':hashlib.sha256(Path(sc.render.filepath).read_bytes()).hexdigest()},indent=2))
if mode in ('media','final'):
    sc.eevee.taa_render_samples=32
    for clip,seconds in SPECS[key]['clips'].items():
        if len(args)>2 and clip not in args[2:]:continue
        folder=TMP/key/'frames'/clip;folder.mkdir(parents=True,exist_ok=True)
        camera((8,-14,6),(-.4,-.7,1.9),10.)
        for i in range(round(seconds*30)):
            select(clip,i/30);sc.render.filepath=str(folder/f'{i:05d}.png');bpy.ops.render.render(write_still=True)
        (folder/'metadata.json').write_text(json.dumps({'clip':clip,'seconds':seconds,'fps':30,
          'frames':round(seconds*30),'model_sha256':sha,'renderer_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'engine':sc.render.engine,'samples':32,'resolution':[1920,1080]},indent=2))
        print('CLIP_FINISHED',key,clip,flush=True)
elif mode not in ('poses','stills'):raise ValueError(mode)
