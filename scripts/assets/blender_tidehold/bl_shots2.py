# Non-destructive render pass: adds only a camera + sun, renders, removes them.
# Touches no building geometry.
import bpy, traceback, math
from mathutils import Vector
try:
    OUT = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad/shots'
    sc = bpy.context.scene
    for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try: sc.render.engine = e; break
        except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = 1100, 760
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try: sc.eevee.taa_render_samples = 16
    except Exception: pass

    tmp = []
    cam_d = bpy.data.cameras.new('OPTCAM'); cam = bpy.data.objects.new('OPTCAM', cam_d)
    sc.collection.objects.link(cam); sc.camera = cam; tmp.append(cam)
    sun_d = bpy.data.lights.new('OPTSUN', 'SUN'); sun_d.energy = 4.0
    sun = bpy.data.objects.new('OPTSUN', sun_d); sc.collection.objects.link(sun); tmp.append(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))
    if sc.world is None:
        sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg: bg.inputs[0].default_value = (0.55, 0.66, 0.82, 1); bg.inputs[1].default_value = 1.1

    SHOTS = [
        ('ext_34',   (-40, -44, 27), (0, 2, 7),   40),
        ('ext_front',(  0, -52, 15), (0, 6, 8),   45),
        ('ext_rear', ( 34,  30, 24), (0, 2, 7),   40),
        ('spires',   (  0, -30, 36), (0, 0, 13),  50),
        ('hall',     (  0, -5.5, 3.2), (0, 6, 3.0), 24),
        ('floor',    (  0, 11.0, 4.6), (0, 17.5, 0.2), 34),
    ]
    for name, loc, tgt, lens in SHOTS:
        cam.location = Vector(loc)
        cam_d.lens = lens
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{OUT}/{name}.png'
        bpy.ops.render.render(write_still=True)
        print('  shot', name)
    for o in tmp:
        bpy.data.objects.remove(o, do_unlink=True)
    print('SHOTS DONE, scene untouched')
except Exception:
    print(traceback.format_exc())
