"""Review and presentation renders of the Lantern Hall Destrier, from the scene build_steed.py
saves (its optional third argument), plus a presentation .blend to open and orbit.

Day and night, from the 3/4 front and the near side, the horse standing in its Idle clip. At
night the scene is lit the way the game lights it: a weak cold moon, and a warm point light
burning in each storm lantern (and the chanfron's brow lantern), parented to the lantern's own
swinging bone so the light rides the glass when the clips play.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_steed/render_steed.py -- \
      <destrier.blend> <out_dir> [presentation.blend] [--samples N] [--size WxH]

Writes <out_dir>/destrier_{dia,noche}_{3cuartos,lado}.png. Original work for this project.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT_DIR = args[0], args[1]
PRESENT = args[2] if len(args) > 2 and not args[2].startswith('--') else None
SAMPLES = int(args[args.index('--samples') + 1]) if '--samples' in args else 32
SIZE = tuple(int(v) for v in args[args.index('--size') + 1].split('x')) if '--size' in args else (1600, 1000)

bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
ARM = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
HORSE = next(o for o in bpy.data.objects if o.type == 'MESH')

# the horse at rest in its own Idle, a few frames in so the lanterns hang in their swing
ARM.data.pose_position = 'POSE'
ARM.animation_data_create()
idle = bpy.data.actions['Idle']
ARM.animation_data.action = idle
if getattr(idle, 'slots', None) and len(idle.slots):
    ARM.animation_data.action_slot = idle.slots[0]
sc.frame_start, sc.frame_end = int(idle.frame_range[0]), int(idle.frame_range[1])
sc.frame_set(6)

dg = bpy.context.evaluated_depsgraph_get()
ev = HORSE.evaluated_get(dg)
me = ev.to_mesh()
pts = [ev.matrix_world @ v.co for v in me.vertices]
ev.to_mesh_clear()
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2
height = hi.z - lo.z

# ---------------------------------------------------------------------------
# the stage: a ground of trodden grass and earth, a camera, the two lighting moods
# ---------------------------------------------------------------------------
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=height * 6, fill_type='NGON',
                                  location=(centre.x, centre.y, lo.z))
ground = bpy.context.object
ground.name = 'Ground'
gm = bpy.data.materials.new('Ground')
gm.use_nodes = True
nt = gm.node_tree
bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 1.0
noise = nt.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 3.0
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.05, 0.075, 0.03, 1)
ramp.color_ramp.elements[1].color = (0.13, 0.1, 0.055, 1)
nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
ground.data.materials.append(gm)

cam_data = bpy.data.cameras.new('Camera')
cam_data.lens = 55
CAM = bpy.data.objects.new('Camera', cam_data)
sc.collection.objects.link(CAM)
sc.camera = CAM
VIEWS = {
    '3cuartos': Vector((-1.0, -1.15, 0.38)),
    'lado': Vector((-1.0, 0.04, 0.12)),
}


def aim(direction):
    d = direction.normalized()
    target = centre + Vector((0, 0, height * 0.02))
    CAM.location = target + d * height * 2.9
    CAM.rotation_euler = (target - CAM.location).to_track_quat('-Z', 'Y').to_euler()


world = bpy.data.worlds.new('Sky')
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']

sun = bpy.data.lights.new('Sun', 'SUN')
SUN = bpy.data.objects.new('Sun', sun)
sc.collection.objects.link(SUN)
SUN.rotation_euler = (math.radians(52), 0, math.radians(-32))
sun.angle = math.radians(6)


def lantern_light(name, bone, offset, power):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.color = (1.0, 0.55, 0.2)
    ld.shadow_soft_size = 0.02
    ld.energy = power
    # the light burns INSIDE the lantern's own glass: unshadowed, or the glass would hold it in
    ld.use_shadow = False
    ob = bpy.data.objects.new(name, ld)
    sc.collection.objects.link(ob)
    ob.parent = ARM
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    # bone parenting hangs the child at the bone's TAIL; the glass sits `offset` along the bone
    # from its HEAD (the same numbers as MountLampSpec.offset, src/render/mount_visuals.ts)
    length = ARM.data.bones[bone].length
    ob.location = Vector((offset[0], offset[1] - length, offset[2]))
    return ob


LAMPS = [lantern_light('Lantern L', 'lantern_l', (0, 0.195, 0), 0.0),
         lantern_light('Lantern R', 'lantern_r', (0, 0.195, 0), 0.0)]


def mood(name):
    night = name == 'noche'
    if night:
        bg.inputs['Color'].default_value = (0.012, 0.018, 0.04, 1)
        bg.inputs['Strength'].default_value = 1.0
        sun.energy = 0.7
        sun.color = (0.55, 0.65, 1.0)
        for lamp in LAMPS:
            lamp.data.energy = 24.0
    else:
        bg.inputs['Color'].default_value = (0.52, 0.62, 0.78, 1)
        bg.inputs['Strength'].default_value = 0.85
        sun.energy = 3.4
        sun.color = (1.0, 0.94, 0.84)
        for lamp in LAMPS:
            lamp.data.energy = 0.6


sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = SAMPLES
sc.render.resolution_x, sc.render.resolution_y = SIZE
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy'
os.makedirs(OUT_DIR, exist_ok=True)
for m in ('dia', 'noche'):
    mood(m)
    for view, direction in VIEWS.items():
        aim(direction)
        sc.render.filepath = os.path.join(OUT_DIR, f'destrier_{m}_{view}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', sc.render.filepath)

if PRESENT:
    mood('dia')
    aim(VIEWS['3cuartos'])
    bpy.ops.wm.save_as_mainfile(filepath=PRESENT)
    print('SAVED', PRESENT)
