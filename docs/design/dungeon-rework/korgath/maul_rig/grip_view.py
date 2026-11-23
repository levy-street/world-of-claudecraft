"""Close-ups of one hand on the haft at one frame, from six sides (hand-only mask)."""
import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rlib
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
BLEND, CLIP, FRAME, SIDE, OUT = a[0], a[1], int(a[2]), a[3], a[4]
bpy.ops.wm.open_mainfile(filepath=BLEND)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
me = bpy.data.objects['Korgath']
act = bpy.data.actions[CLIP]
arm.animation_data.action = act
if act.slots: arm.animation_data.action_slot = act.slots[0]
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT') or o.name.startswith('Review'): bpy.data.objects.remove(o, do_unlink=True)
keep = tuple(os.environ.get('GV_KEEP', 'hand.,fingers.,hammer,index.,middle.,ring.,pinky.,thumb.').split(','))
g = me.vertex_groups.get('GripMask2') or me.vertex_groups.new(name='GripMask2')
gname = {x.index: x.name for x in me.vertex_groups}
idx = [v.index for v in me.data.vertices if sum(x.weight for x in v.groups if gname[x.group].startswith(keep)) > 0.5]
g.add(idx, 1.0, 'REPLACE')
m = me.modifiers.new('GripMask2', 'MASK'); m.vertex_group = 'GripMask2'
rlib.setup_bench((600, 600))
bpy.context.scene.frame_set(FRAME)
c = (rlib.bone_pos(arm, 'hand.' + SIDE) + rlib.bone_pos(arm, 'fingers.' + SIDE)) / 2
paths = []
for tag, d in (('x+', Vector((1, 0, 0))), ('x-', Vector((-1, 0, 0))), ('y+', Vector((0, 1, 0.01))), ('y-', Vector((0, -1, 0.01))), ('z+', Vector((0.01, 0, 1))), ('z-', Vector((0.01, 0, -1)))):
    cam = rlib.camera('g', c + d * float(os.environ.get('GV_DIST', '3.2')), c, lens=50)
    p = os.path.join(OUT, 'gv_%s_%02d_%s_%s.png' % (CLIP, FRAME, SIDE, tag))
    rlib.render(cam, p); paths.append(p)
print('GV', ' '.join(paths))
