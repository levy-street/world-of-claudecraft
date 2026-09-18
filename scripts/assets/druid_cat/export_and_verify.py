import sys, json
from pathlib import Path
import bpy
here=Path(__file__).resolve().parent
sys.path.insert(0,str(here))
from export import export_cat
from validate import validate_cat
from motion import reset
out=here.parent
export_cat(out/'Druid_Cat_Form_Animation_v11.glb')
report=validate_cat(out/'Druid_Cat_Form_Animation_v11.glb',out/'export-validation.json')
print('VALIDATED_EXPORT',report['max_error'],len(report['clips']))
rig=bpy.data.objects['DruidCat_Rig']
rig.animation_data.action=None
reset(rig)
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'Druid_Cat_Form_Animation_v11.blend'))
