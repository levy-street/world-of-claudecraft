"""Open an ANIMATED preview of the Twin Pulsars in the Blender UI.

Build a scratch file headless, then open it (a saved file skips the splash):

    PULSAR_PREVIEW_SAVE=/tmp/pulsars_preview.blend blender --background --python <this file>
    blender /tmp/pulsars_preview.blend --python <this file>

The whole mechanic, on the game's own numbers (PULSARS in
src/sim/rift/hoard_pulsars_core.ts): two orbs ride above the boss's shoulders,
turning slowly; they light, leave him and take station; a thin line locks on a
player; the beam fires SHORT of them and chases, slower than a run and turning
only so fast, while the player keeps moving; then the orbs are destroyed one
after the other and the ward round the boss breaks.

A preview only: in the game none of this is baked animation, it is the same
closed-form functions evaluated by code, and the colours here stand in for the
runtime materials. Nothing is saved into the repository.
"""
import math
import os

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
ACTIVATE, WARN = 1.8, 0.7
TRACK, TURN, LAG, WIDTH, RUN = 5.6, 3.2, 4.0, 0.9, 7.0
BOSS_SCALE = 2.4
ANCHOR = (1.05 * BOSS_SCALE, 0.3 * BOSS_SCALE, 1.95 * BOSS_SCALE)  # right, back, up
STATION, STATION_ANGLE, STATION_HEIGHT = 7.5, math.pi * 0.42, 3.0
DORMANT, ACTIVE = 0.8, 1.7
T_WAKE = 2.0
T_LOCK = T_WAKE + ACTIVATE
T_FIRE = T_LOCK + WARN
T_DEATH_A = T_FIRE + 6.0
T_DEATH_B = T_DEATH_A + 1.6
SECONDS = T_DEATH_B + 2.0


def smooth(t):
    v = max(0.0, min(1.0, t))
    return v * v * (3 - 2 * v)


def emissive(name, color, strength, base=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*(base or color), 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.5
    return mat


def key(obj, frame, **props):
    for name, value in props.items():
        setattr(obj, name, value)
        obj.keyframe_insert(data_path=name, frame=frame)


def added(make, name, material=None):
    before = set(bpy.context.scene.objects)
    make()
    obj = next(o for o in bpy.context.scene.objects if o not in before)
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def frame(seconds):
    return max(1, int(round(seconds * FPS)) + 1)


def duplicate_tree(root):
    """A deep copy of an imported hierarchy (objects share mesh data)."""
    clone = root.copy()
    bpy.context.scene.collection.objects.link(clone)
    for child in root.children:
        kid = duplicate_tree(child)
        kid.parent = clone
    return clone


def descendants(root):
    out = []
    for child in root.children:
        out.append(child)
        out.extend(descendants(child))
    return out


def player_at(t):
    """The hunted player: strafing to and fro across the room, never still."""
    a = math.pi + math.sin(max(0.0, t - T_LOCK) * 0.55) * 1.15
    return (math.sin(a) * 17, math.cos(a) * 17)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = frame(SECONDS)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "pulsar_components.glb"))
    source = scene.objects["PulsarOrb_ROOT"]
    orbs = [source, duplicate_tree(source)]

    # Blender: the boss faces -Y (game forward). His right is -X from the camera side.
    stations = []
    for index, orb in enumerate(orbs):
        side = -1 if index == 0 else 1
        ride = (side * ANCHOR[0], ANCHOR[1], ANCHOR[2])
        angle = side * STATION_ANGLE
        station = (math.sin(angle) * STATION, -math.cos(angle) * STATION, STATION_HEIGHT)
        stations.append(station)
        death = T_DEATH_A if index == 0 else T_DEATH_B
        # ---- riding, then the flight off his shoulder
        for f in range(1, frame(death) + 1):
            t = (f - 1) / FPS
            bob = math.sin(t * 1.7 + index * 2.1) * 0.16
            travel = smooth(((t - T_WAKE) / ACTIVATE - 0.35) / 0.6)
            size = DORMANT + (ACTIVE - DORMANT) * travel
            key(
                orb,
                f,
                location=(
                    ride[0] + (station[0] - ride[0]) * travel,
                    ride[1] + (station[1] - ride[1]) * travel,
                    ride[2] + bob + (station[2] - ride[2]) * travel,
                ),
                scale=(size, size, size),
            )
        key(orb, frame(death + 0.2), scale=(ACTIVE * 0.6,) * 3)
        key(orb, frame(death + 0.25), scale=(0.001,) * 3)
        # ---- every part turns, faster once it wakes
        parts = {o.name.split(".")[0]: o for o in descendants(orb)}
        for f in range(1, scene.frame_end + 1, 2):
            t = (f - 1) / FPS
            woke = smooth((t - T_WAKE) / (ACTIVATE * 0.7))
            turn = t * (1 + 3.2 * woke)
            for name, rate, axis in (
                ("Shell", 0.5, 2),
                ("EnergyRing_A", 1.9, 2),
                ("EnergyRing_B", -1.4, 0),
                ("RuneFragments", -0.8, 2),
                ("CoreJets", 2.6, 2),
            ):
                part = parts.get(name)
                if part is None:
                    continue
                rot = list(part.rotation_euler)
                rot[axis] = turn * rate
                if name == "CoreJets":
                    rot[0] = 0.42
                key(part, f, rotation_euler=tuple(rot))
        # ---- the plates stand off as it charges, and fly when it dies
        for plate in [o for o in descendants(orb) if o.name.startswith("Fragment_")]:
            verts = [v.co for v in plate.data.vertices]
            out = Vector((sum(v.x for v in verts), sum(v.y for v in verts), sum(v.z for v in verts))).normalized()
            key(plate, frame(T_WAKE), location=(0, 0, 0))
            key(plate, frame(T_LOCK), location=tuple(out * 0.2))
            key(plate, frame(death), location=tuple(out * 0.2))
            key(plate, frame(death + 0.2), location=tuple(out * -0.1))
            key(plate, frame(death + 0.9), location=tuple(out * 3.4), rotation_euler=(out.y * 4, 0, -out.x * 4))

    # ---- the boss and his ward
    added(lambda: bpy.ops.mesh.primitive_cone_add(radius1=1.5, radius2=0.8, depth=5.4, location=(0, 0, 2.7)),
          "Boss_Nyxaris", emissive("BossVoid", (0.1, 0.05, 0.25), 0.3, base=(0.07, 0.05, 0.12)))
    ward = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=3.4, minor_radius=0.12, location=(0, 0, 0.15)),
                 "Ward", emissive("Ward", (0.18, 0.55, 1.0), 4.0))
    key(ward, 1, scale=(0.001,) * 3)
    key(ward, frame(T_LOCK) - 2, scale=(0.001,) * 3)
    key(ward, frame(T_LOCK), scale=(1, 1, 1))
    key(ward, frame(T_DEATH_B), scale=(1, 1, 1))
    key(ward, frame(T_DEATH_B + 0.7), scale=(4.2, 4.2, 0.2))
    key(ward, frame(T_DEATH_B + 0.75), scale=(0.001,) * 3)

    # ---- the player, the lock line, and the beam that chases
    player = added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=1.8, location=(0, -17, 0.9)),
                   "Player_1m80", emissive("PlayerRed", (0, 0, 0), 0.0, base=(0.6, 0.12, 0.08)))
    beam_mat = emissive("Beam", (0.35, 0.7, 1.0), 9.0)
    lock_mat = emissive("Lock", (0.8, 0.95, 1.0), 5.0)
    beam = added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=14), "Beam", beam_mat)
    lock = added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=8), "LockLine", lock_mat)
    mark = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=WIDTH, minor_radius=0.07), "FloorMark", beam_mat)
    origin = Vector(stations[0])
    aim = None
    heading = 0.0
    for f in range(1, scene.frame_end + 1):
        t = (f - 1) / FPS
        px, py = player_at(t)
        key(player, f, location=(px, py, 0.9))
        firing = T_FIRE <= t < T_DEATH_A
        locking = T_LOCK <= t < T_FIRE
        if firing:
            if aim is None:
                # It lands SHORT of them, toward the orb, and sweeps in from there.
                to = Vector((px - origin.x, py - origin.y))
                reach = max(0.0, to.length - LAG) / max(1e-6, to.length)
                aim = Vector((origin.x + to.x * reach, origin.y + to.y * reach))
                heading = math.atan2(to.x, to.y)
            else:
                want = math.atan2(px - aim.x, py - aim.y)
                swing = (want - heading + math.pi) % math.tau - math.pi
                limit = TURN / FPS
                heading += max(-limit, min(limit, swing))
                step = TRACK / FPS
                aim = Vector((aim.x + math.sin(heading) * step, aim.y + math.cos(heading) * step))
        target = Vector((aim.x, aim.y, 0.35)) if firing and aim is not None else Vector((px, py, 0.9))
        for obj, on, radius in ((beam, firing, WIDTH), (lock, locking, 0.06)):
            if not on:
                key(obj, f, scale=(0.001,) * 3)
                continue
            along = target - origin
            key(
                obj,
                f,
                location=tuple(origin + along / 2),
                rotation_euler=along.to_track_quat("Z", "Y").to_euler(),
                scale=(radius, radius, along.length),
            )
        key(mark, f, location=(target.x, target.y, 0.08), scale=(1, 1, 1) if firing else (0.001,) * 3)

    # ---- stage: a dark void floor, a dim sky
    added(lambda: bpy.ops.mesh.primitive_plane_add(size=80, location=(0, -8, 0)), "Ground",
          emissive("VoidFloor", (0, 0, 0), 0.0, base=(0.03, 0.035, 0.06)))
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 1.6
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.04, 0.05, 0.1, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    scene.world = world
    scene.frame_set(1)


def frame_and_play():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            space = area.spaces.active
            space.shading.type = "MATERIAL"
            space.shading.use_scene_world = True
            space.shading.use_scene_lights = True
            space.overlay.show_floor = False
            space.overlay.show_axis_x = False
            space.overlay.show_axis_y = False
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            if region is None:
                continue
            # A fixed three-quarter view of the whole room: framing on the selection
            # is unreliable from a timer (the animation has not been evaluated yet).
            view = space.region_3d
            view.view_perspective = "PERSP"
            view.view_location = (0.0, -7.0, 3.0)
            view.view_distance = 48.0
            view.view_rotation = Euler((math.radians(62), 0.0, math.radians(28))).to_quaternion()
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.context.scene.frame_set(1)
                if not bpy.context.screen.is_animation_playing:
                    bpy.ops.screen.animation_play()
            return None
    return None


SAVE = os.environ.get("PULSAR_PREVIEW_SAVE")
if SAVE:
    build()
    bpy.ops.wm.save_as_mainfile(filepath=SAVE)
    print("SAVED", SAVE)
else:
    if not bpy.data.filepath:
        build()
    bpy.app.timers.register(frame_and_play, first_interval=0.8)
