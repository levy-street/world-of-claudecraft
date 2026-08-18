"""Turnaround/pose rendering for the concept book.

One lighting rig and one camera helper, shared by the interactive look-dev pass
and by the committed concept-book stills, so a figure never looks different
between the two. Warm key, cool sky fill, warm rim: the lighting the game's own
world runs, so a decision made here holds up in-world.

Deterministic: fixed lamp angles and energies, no randomness, no time.
"""

import bpy
import math
from mathutils import Vector

LAMPS = (
    ("Key", 4.2, (55, 0, 32), (1.00, 0.96, 0.90)),
    ("Fill", 1.5, (70, 0, -150), (0.70, 0.81, 1.00)),
    ("Rim", 2.4, (100, 0, 192), (1.00, 0.84, 0.62)),
)
BACKDROP = (0.050, 0.068, 0.086)


def setup(res=(760, 1000), lens=80, backdrop=BACKDROP, transparent=False):
    """Build the shared lighting rig, world and camera. Returns the camera."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.view_settings.view_transform = "AgX"

    for name, energy, rot, color in LAMPS:
        if name in bpy.data.objects:
            continue
        data = bpy.data.lights.new(name, type="SUN")
        data.energy = energy
        data.color = color
        data.angle = math.radians(22)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.rotation_euler = [math.radians(v) for v in rot]

    world = bpy.data.worlds.get("crew_preview") or bpy.data.worlds.new("crew_preview")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*backdrop, 1.0)
    bg.inputs[1].default_value = 0.9

    cam = bpy.data.objects.get("CrewCam")
    if cam is None:
        cam = bpy.data.objects.new("CrewCam", bpy.data.cameras.new("CrewCam"))
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    sc.camera = cam
    return cam


def aim(cam, target, dist, yaw, pitch):
    """Orbit the camera around `target`. Yaw 0 faces the figure's front (-Y)."""
    t = Vector(target)
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = t + Vector((
        math.sin(y) * math.cos(p) * dist,
        -math.cos(y) * math.cos(p) * dist,
        math.sin(p) * dist,
    ))
    cam.rotation_euler = (t - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()


def shoot(cam, path, target, dist, yaw, pitch):
    aim(cam, target, dist, yaw, pitch)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def fit(objs, pad=1.30):
    """Camera target and distance that frame a figure, whatever its size.

    The cast runs from a 2.1 yard spider to a 4 yard giant, so plates cannot share
    one hardcoded station. Framed on the TRUE bounding box rather than assuming
    feet at z=0: several creature GLBs are authored around their centre, and
    treating the floor as zero put the camera inside them. Returns (target, dist).
    """
    # EVALUATED geometry, not raw vertex data. Several creature rigs carry a 100x
    # scale on the armature, so their bind-pose vertices sit nowhere near where the
    # model actually draws, and a raw-vertex fit put the camera hundreds of units
    # away. Evaluating also means a posed plate frames the POSE.
    # settle the depsgraph first: straight after an import or a pose change it is
    # stale, and evaluating it then returns the UNevaluated bind data
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for obj in objs:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(dg)
        mesh = ev.to_mesh()
        pts.extend(ev.matrix_world @ v.co for v in mesh.vertices)
        ev.to_mesh_clear()
    if not pts:
        return (0.0, 0.0, 1.3), 7.0
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    height = hi[2] - lo[2]
    width = max(hi[0] - lo[0], hi[1] - lo[1])
    # frame on height for a portrait plate, but do not let a wide pose (arms out,
    # a spider's legs) run off the sides
    extent = max(height, width * 0.78)
    target = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
    sensor = bpy.context.scene.camera.data.sensor_width if bpy.context.scene.camera else 36.0
    lens = bpy.context.scene.camera.data.lens if bpy.context.scene.camera else 80.0
    dist = (extent * pad * 0.5) / math.tan(math.atan(sensor / (2 * lens)))
    return target, dist


def pose(rig, action_name, frame=None):
    """Put the rig into a shipped clip so a still shows the figure ACTING.

    `frame` defaults to the middle of the clip, which is where a swing or a
    stride reads best; pass a frame to pick a specific beat.
    """
    action = bpy.data.actions.get(action_name)
    if action is None:
        return None
    rig.data.pose_position = "POSE"
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, "action_slot"):
        for slot in action.slots:
            rig.animation_data.action_slot = slot
            break
    start, end = action.frame_range
    f = int(start + (end - start) * 0.5) if frame is None else frame
    bpy.context.scene.frame_set(f)
    return f
