import sys,json,hashlib
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from config import SPECS,BASE,ROOT,CONTACTS
from geometry import collection
from surfaces import materials,uv_and_finish
from skeleton import build as skeleton
from sculpt import body
from props import add as props
from motion import bake
from stage import create as stage,render_views

args=sys.argv[sys.argv.index('--')+1:];key=args[0];round_name=args[1] if len(args)>1 else 'r1'
spec=dict(SPECS[key],key=key);out=BASE/key;out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
col=collection('Cultist_Export');rig=skeleton(spec,col);mats=materials(spec,out)
batches=body(key,spec,mats,col,rig);props(key,spec,batches)
meshes=[o for b in batches.values() if (o:=uv_and_finish(b,col,rig,b.mat.name not in ('Frost','Iron')))]
if round_name!='r1':bake(rig,spec,meshes)
scene=stage()
if round_name!='r1':rig.animation_data.action=bpy.data.actions['Idle']
scene.frame_set(1)
fingerprints={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
    for p in sorted(Path(__file__).parent.glob('*.py')) if p.name not in ('render.py','validate_native.py')}
rig['source_fingerprint']=hashlib.sha256(json.dumps(fingerprints,sort_keys=True).encode()).hexdigest()
rig['forward_axis']='-Y Blender, +Z glTF';rig['authoring']='Original Broodsworn geometry and motion'
(out/'source_fingerprint.json').write_text(json.dumps({'fingerprint':rig['source_fingerprint'],'files':fingerprints},indent=2))
if round_name!='r1':
    curves=[]
    for action in bpy.data.actions:
        for slot in action.slots:
            for layer in action.layers:
                for strip in layer.strips:
                    bag=strip.channelbag(slot)
                    if bag:curves.extend(bag.fcurves)
    # glTF exporter steps whole frames. Temporarily expand the native half-frame
    # keys to a 60 fps timeline so the shipped rig keeps the solved contacts.
    for fc in curves:
        for k in fc.keyframe_points:k.co.x=(k.co.x-1)*2+1
    scene.render.fps=60
    bpy.ops.export_scene.gltf(filepath=str(out/(key+'.raw.glb')),export_format='GLB',collection='Cultist_Export',
      use_active_scene=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,
      export_def_bones=True,export_force_sampling=True,export_bake_animation=True,export_frame_range=False,
      export_frame_step=1,export_anim_slide_to_zero=True,export_skins=True,export_influence_nb=4,
      export_all_influences=False,export_morph=False,export_yup=True,export_extras=True,
      export_optimize_animation_size=False,export_cameras=False,export_lights=False)
    for fc in curves:
        for k in fc.keyframe_points:k.co.x=(k.co.x-1)*.5+1
    scene.render.fps=30;scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(out/(key+'.blend')))
stats={'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),
  'bones':len(rig.data.bones),'materials':len(meshes),'clips':spec['clips'] if round_name!='r1' else {},
  'contacts':{n:round(t*30)+1 for n,t in CONTACTS.items() if n in spec['clips']}}
(out/'source_metrics.json').write_text(json.dumps(stats,indent=2));print('BUILT',key,stats,flush=True)
render_views(out,round_name)
print('ROUND_FINISHED',key,round_name,flush=True)
