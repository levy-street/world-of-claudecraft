"""Open the Bone Reaper assets in the Blender UI, ANIMATED, for a look round.

    blender --python docs/design/bone-reaper/open_in_blender.py

To come up without the splash screen, build a scratch file first and open that:

    BONE_PREVIEW_SAVE=/tmp/bone_reaper_preview.blend blender --background --python <this file>
    blender /tmp/bone_reaper_preview.blend --python <this file>

In the game nothing here is a baked animation: the scythe's travel and turn and
the souls' walk are closed-form functions evaluated by code every frame
(src/sim/rift/hoard_bone_reaper_core.ts), because the route is sized to the room
a hoard rolled and the server must know where the blade is. This script ports
those same functions and bakes them into keyframes purely as a PREVIEW, so the
motion can be judged here: the assembly, the spin-up, the wandering pivot, the
lean, the break-up, and souls drawn to the boss. Nothing is saved into the repo.
"""
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30

# ---- mirrored from BONE_SCYTHE / SOUL_HARVEST (hoard_bone_reaper_core.ts)
CAST, ACTIVE, END = 1.4, 12.0, 1.1
TOTAL = CAST + ACTIVE + END
PERIOD, REACH, CLEARANCE, EASE = 3.4, 8.6, 5.0, 1.6
LATERAL, DEPTH = 9.0, 28.0
BLADE_HEIGHT, SUMMON_DEPTH = 1.15, 1.4
SOUL_CAST, SOUL_HOLD, SOUL_SPEED, ABSORB = 1.6, 0.9, 4.2, 2.6
PATTERN = int(os.environ.get("SCYTHE_PATTERN", "1"))  # 0 serpentine, 1 loop, 2 eight
HARVEST_AT = 3.0  # seconds into the preview the souls appear


def smooth(t):
    v = max(0.0, min(1.0, t))
    return v * v * (3 - 2 * v)


def spin(t):
    omega = math.tau / PERIOD
    t = max(0.0, min(TOTAL, t))
    if t <= CAST:
        return omega * t * t / (2 * CAST)
    at_cast = omega * CAST / 2
    if t <= CAST + ACTIVE:
        return at_cast + omega * (t - CAST)
    s = t - CAST - ACTIVE
    k = 0.6 * omega / END
    return at_cast + omega * ACTIVE + omega * s - k * s * s / 2


def progress(t):
    x = max(0.0, min(ACTIVE, t - CAST))
    e = min(EASE, ACTIVE / 2)
    cruise = ACTIVE - e
    if x <= e:
        area = x * x / (2 * e)
    elif x <= ACTIVE - e:
        area = e / 2 + (x - e)
    else:
        r = ACTIVE - x
        area = cruise - r * r / (2 * e)
    return area / cruise


def path(u):
    near = REACH + CLEARANCE
    far = max(near + 6, DEPTH)
    mid, span = (near + far) / 2, (far - near) / 2
    if PATTERN == 0:
        return LATERAL * math.sin(math.tau * u), near + (far - near) * u
    if PATTERN == 1:
        return LATERAL * math.sin(math.tau * u), mid - span * math.cos(math.tau * u)
    return LATERAL * math.sin(math.tau * u), mid + span * 0.6 * math.sin(math.tau * 2 * u)


def key(obj, frame, **props):
    for name, value in props.items():
        setattr(obj, name, value)
        obj.keyframe_insert(data_path=name, frame=frame)


def linear(obj):
    action = obj.animation_data and obj.animation_data.action
    if not action:
        return
    curves = getattr(action, "fcurves", None)
    if curves is None:  # layered actions (Blender 4.4+)
        curves = [fc for layer in action.layers for strip in layer.strips
                  for bag in strip.channelbags for fc in bag.fcurves]
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"


def empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.6
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def added(make, name):
    """Run a primitive operator and return the object it made, renamed. (The
    operator's result is found by difference: bpy.context.object is not reliable
    while a script runs at startup.)"""
    before = set(bpy.context.scene.objects)
    make()
    obj = next(o for o in bpy.context.scene.objects if o not in before)
    obj.name = name
    return obj


def duplicate(root):
    """A linked copy of an imported hierarchy (shares mesh data)."""
    clone = root.copy()
    bpy.context.scene.collection.objects.link(clone)
    for child in root.children:
        kid = child.copy()
        bpy.context.scene.collection.objects.link(kid)
        kid.parent = clone
    return clone


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = int(TOTAL * FPS)

    # ---- the scythe on its double transform: MovementPivot -> RotationPivot -> model
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "scythe_components.glb"))
    scythe = next(o for o in scene.objects if o.name.startswith("WanderingScythe_ROOT"))
    movement = empty("MovementPivot")
    rotation = empty("RotationPivot", movement)
    scythe.parent = rotation
    for frame in range(1, scene.frame_end + 1):
        t = (frame - 1) / FPS
        x, f = path(progress(t))
        summon = smooth(t / CAST)
        broken = smooth((t - CAST - ACTIVE) / END) if t > CAST + ACTIVE else 0.0
        lift = -SUMMON_DEPTH * (1 - summon) if t < CAST else 0.5 * broken
        formed = summon * (1 + 0.12 * math.sin(summon * math.pi)) if t < CAST else 1 - 0.35 * broken
        # Lean into travel: velocity by finite difference, as the renderer does.
        x2, f2 = path(progress(t + 0.1))
        vx, vy = (x2 - x) / 0.1, -(f2 - f) / 0.1
        speed = math.hypot(vx, vy)
        lean = min(0.16, speed * 0.035)
        dx, dy = (vx / speed, vy / speed) if speed > 1e-4 else (0.0, 0.0)
        # Game forward (+Z) is Blender -Y, so the pivot walks toward -Y.
        key(movement, frame, location=(x, -f, BLADE_HEIGHT + lift),
            rotation_euler=(dy * lean, -dx * lean, 0.0))
        key(rotation, frame, rotation_euler=(0.0, 0.0, spin(t)),
            scale=(max(0.001, formed),) * 3)
    linear(movement)
    linear(rotation)

    # ---- the boss he stands in for, and a player for scale
    added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=1.3, depth=4.8, location=(0, 0, 2.4)),
          "Boss_stand_in")
    added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.32, depth=1.8, location=(6, -10, 0.9)),
          "Player_1m80_for_scale")

    # ---- souls: appear, hold, then walk a straight line to the boss
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "soul_components.glb"))
    soul = next(o for o in scene.objects if o.name.startswith("SoulHarvest_Soul_ROOT"))
    count = 5
    souls = [soul] + [duplicate(soul) for _ in range(count - 1)]
    near, far = 13.0, DEPTH
    mid, rf, rx = (near + far) / 2, (far - near) / 2 + 2, LATERAL + REACH * 0.55
    for index, ghost in enumerate(souls):
        a = 0.6 + index / count * math.tau
        sx, sf = rx * math.sin(a), max(3.0, mid + rf * math.cos(a))
        if math.hypot(sx, sf) < near:
            k = near / max(0.001, math.hypot(sx, sf))
            sx, sf = sx * k, sf * k
        sy = -sf
        distance = math.hypot(sx, sy)
        travel = max(0.0, distance - ABSORB)
        travel_sec = travel / SOUL_SPEED
        ghost.rotation_euler = (0, 0, math.atan2(-sx, sy))  # faces the boss
        for frame in range(1, scene.frame_end + 1):
            t = (frame - 1) / FPS - HARVEST_AT
            if t < 0:
                key(ghost, frame, location=(sx, sy, 0.55), scale=(0.001,) * 3)
                continue
            walk = max(0.0, min(travel_sec, t - SOUL_CAST - SOUL_HOLD))
            ease = travel_sec / 3
            covered = walk * walk / (2 * ease) if walk <= ease else ease / 2 + (walk - ease)
            k = covered / (travel_sec - ease / 2) * travel / distance
            left = SOUL_CAST + SOUL_HOLD + travel_sec - t
            taken = 1 - smooth(left / 0.55)
            size = smooth(t / SOUL_CAST) * (1 - 0.45 * taken) if left > 0 else 0.001
            bob = 0.16 * math.sin(t * 2.1 + index * 1.7)
            key(ghost, frame, location=(sx * (1 - k), sy * (1 - k), 0.55 + bob + 0.5 * taken),
                scale=(max(0.001, size),) * 3)
        linear(ghost)

    # ---- stage
    ground = added(lambda: bpy.ops.mesh.primitive_plane_add(size=60, location=(0, -14, 0)), "Ground")
    mat = bpy.data.materials.new("Ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.1, 0.12, 0.1, 1)
    ground.data.materials.append(mat)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.2, 0.24, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    scene.frame_set(1)


def frame_and_play():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            area.spaces.active.shading.type = "MATERIAL"
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            if region is None:
                continue
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.ops.object.select_all(action="DESELECT")
                ground = bpy.data.objects.get("Ground")
                if ground:
                    ground.select_set(True)
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action="DESELECT")
                # Pull in from "the whole ground" to "the room".
                area.spaces.active.region_3d.view_distance *= 0.7
                if not bpy.context.screen.is_animation_playing:
                    bpy.ops.screen.animation_play()
            return None
    return None


SAVE = os.environ.get("BONE_PREVIEW_SAVE")
if SAVE:
    # Headless: build the animated scene and save it. Opening a saved file is what
    # skips Blender's splash screen, so the window comes up on the models.
    build()
    bpy.ops.wm.save_as_mainfile(filepath=SAVE)
    print("SAVED", SAVE)
else:
    if not bpy.data.filepath:
        build()
    # The UI is not ready while this script runs: frame and press play a moment later.
    bpy.app.timers.register(frame_and_play, first_interval=0.8)
