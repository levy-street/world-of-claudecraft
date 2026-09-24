"""Open an ANIMATED preview of Ice Age in the Blender UI.

Build a scratch file headless, then open it (a saved file skips the splash):

    ICE_PREVIEW_SAVE=/tmp/ice_age_preview.blend blender --background --python <this file>
    blender /tmp/ice_age_preview.blend --python <this file>

The whole mechanic, on the game's own timings (ICE_AGE in
src/sim/rift/hoard_ice_age_core.ts): shadows on the floor, two giant icicles
fall and stay as pillars, the boss casts while frost creeps out from him, the
storm's wave crosses the room, and the pillars break into their pre-fractured
chunks. One figure stands in a pillar's lee and lives; one stands beside the
other pillar, in the open, and does not.

A preview only: in the game none of this is baked animation, it is the same
closed-form functions evaluated by code, and the colours here stand in for the
runtime materials. Nothing is saved into the repository.
"""
import math
import os
import random

import bpy
from mathutils import Euler

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
WARN, FALL, SETTLE, CAST, BREAK_DELAY, SHATTER = 1.4, 0.5, 1.3, 4.5, 0.35, 1.5
IMPACT_AT = WARN
CAST_AT = WARN + SETTLE
BLAST_AT = CAST_AT + CAST
BREAK_AT = BLAST_AT + BREAK_DELAY
SECONDS = BREAK_AT + SHATTER + 1.2
PILLAR_RADIUS, IMPACT_RADIUS, COVER_DISTANCE, COVER_WIDTH = 2.6, 4.2, 10.0, 1.15
DROP = 52.0
PILLARS = {"A": (-8.0, -15.0), "C": (9.0, -19.0)}  # Blender x, y (the boss is at the origin)
CHUNK_SPEED, CHUNK_LIFT, CHUNK_GRAVITY, CHUNK_SPIN = 7.5, 8.5, 19.0, 5.2


def smooth(t):
    v = max(0.0, min(1.0, t))
    return v * v * (3 - 2 * v)


def emissive(name, color, strength, base=None, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*(base or color), 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.6
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = "BLENDED" if hasattr(mat, "surface_render_method") else "DITHERED"
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


def flat_ring(name, material, inner, outer, where, z=0.05):
    ring = added(lambda: bpy.ops.mesh.primitive_circle_add(vertices=64, radius=outer, fill_type="NGON"), name, material)
    ring.location = (where[0], where[1], z)
    del inner
    return ring


def lee_mesh(name, material, pillar):
    """The lee behind a pillar, exactly as the sim tests it: past the pillar along
    the boss's bearing, widening like a shadow, out to the cover distance."""
    px, py = pillar
    d = math.hypot(px, py)
    ux, uy = px / d, py / d
    verts, faces = [], []
    rows = 10
    for row in range(rows + 1):
        behind = (COVER_DISTANCE + PILLAR_RADIUS) * row / rows
        along = d + behind
        half = PILLAR_RADIUS * COVER_WIDTH * max(1.0, min(1.5, along / d))
        cx, cy = ux * along, uy * along
        verts += [(cx - uy * half, cy + ux * half, 0.07), (cx + uy * half, cy - ux * half, 0.07)]
    for row in range(rows):
        a = row * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = frame(SECONDS)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "ice_pillar_components.glb"))
    rng = random.Random(7)

    shadow_mat = emissive("Shadow", (0, 0, 0), 0.0, base=(0.01, 0.015, 0.03))
    lee_mat = emissive("Lee", (0.06, 0.32, 0.8), 1.2)
    wave_mat = emissive("Wave", (0.2, 0.55, 1.0), 3.0)
    chill_mat = emissive("Chill", (0.18, 0.42, 0.85), 0.6)

    # Park the variant this preview does not use far out of sight.
    for obj in scene.objects:
        if obj.parent is None and obj.type == "EMPTY" and obj.name.split("_")[1] not in PILLARS:
            obj.location = (0, 0, -500)

    for letter, (px, py) in PILLARS.items():
        root = scene.objects[f"IcePillar_{letter}_ROOT"]
        # ---- the shadow, closing in
        shadow = flat_ring(f"Shadow_{letter}", shadow_mat, 0, IMPACT_RADIUS, (px, py), 0.04)
        key(shadow, 1, scale=(1.25, 1.25, 1))
        key(shadow, frame(IMPACT_AT), scale=(1.0, 1.0, 1))
        key(shadow, frame(IMPACT_AT) + 1, scale=(0.001, 0.001, 1))
        # ---- the fall: out of sight, then faster and faster into the floor
        fall_from = IMPACT_AT - FALL
        key(root, 1, location=(px, py, DROP + 40))
        key(root, frame(fall_from), location=(px, py, DROP))
        for step in range(1, 9):
            t = step / 8
            key(root, frame(fall_from + FALL * t), location=(px, py, DROP * (1 - t * t)))
        # ---- the lee, from the landing to the break
        lee = lee_mesh(f"Lee_{letter}", lee_mat, (px, py))
        key(lee, 1, scale=(0.001, 0.001, 0.001))
        key(lee, frame(IMPACT_AT), scale=(0.001, 0.001, 0.001))
        key(lee, frame(IMPACT_AT) + 6, scale=(1, 1, 1))
        key(lee, frame(BREAK_AT), scale=(1, 1, 1))
        key(lee, frame(BREAK_AT) + 3, scale=(0.001, 0.001, 0.001))
        # ---- the break-up: every chunk thrown downwind on the game's own arc
        d = math.hypot(px, py)
        wind = (px / d, py / d)
        for chunk in [c for c in root.children if "_Chunk_" in c.name]:
            # In the pillar's own frame: the chunk's vertices plus where the chunk sits.
            verts = [v.co for v in chunk.data.vertices]
            cx = sum(v.x for v in verts) / len(verts) + chunk.location.x
            cy = sum(v.y for v in verts) / len(verts) + chunk.location.y
            cz = sum(v.z for v in verts) / len(verts) + chunk.location.z
            away = math.hypot(cx, cy) or 1.0
            ox = cx / away * 0.75 + wind[0] * 0.65
            oy = cy / away * 0.75 + wind[1] * 0.65
            norm = math.hypot(ox, oy) or 1.0
            ox, oy = ox / norm, oy / norm
            vigor = rng.uniform(0.75, 1.3)
            rest = tuple(chunk.location)
            key(chunk, frame(BREAK_AT), location=rest, rotation_euler=(0, 0, 0), scale=(1, 1, 1))
            for step in range(1, 13):
                p = step / 12
                t = p * SHATTER
                rise = CHUNK_LIFT * vigor * (0.35 + 0.65 * min(1.0, cz / 10))
                z = max(-cz, rise * t - 0.5 * CHUNK_GRAVITY * t * t)
                spin = CHUNK_SPIN * vigor * t
                size = 1 - smooth((p - 0.55) / 0.45)
                key(
                    chunk,
                    frame(BREAK_AT + t),
                    location=(rest[0] + ox * CHUNK_SPEED * vigor * t, rest[1] + oy * CHUNK_SPEED * vigor * t, rest[2] + z),
                    rotation_euler=(oy * spin, -ox * spin, spin * 0.35),
                    scale=(max(0.001, size),) * 3,
                )
        for extra in [c for c in root.children if "_Chunk_" not in c.name]:
            key(extra, frame(BREAK_AT), scale=(1, 1, 1))
            key(extra, frame(BREAK_AT + 0.8), scale=(1, 1, 0.001))

    # ---- the boss, his cast, and the storm's wave
    boss = added(lambda: bpy.ops.mesh.primitive_cone_add(radius1=1.6, radius2=0.9, depth=5, location=(0, 0, 2.5)),
                 "Boss_Hoarfrost", emissive("BossIce", (0.1, 0.3, 0.6), 0.4, base=(0.12, 0.2, 0.32)))
    del boss
    chill = flat_ring("FloorChill", chill_mat, 0, 1, (0, 0), 0.03)
    key(chill, 1, scale=(0.001, 0.001, 1))
    key(chill, frame(CAST_AT), scale=(0.001, 0.001, 1))
    key(chill, frame(BLAST_AT), scale=(46, 46, 1))
    key(chill, frame(BLAST_AT + 1.6), scale=(46, 46, 1))
    key(chill, frame(BLAST_AT + 1.8), scale=(0.001, 0.001, 1))
    wave = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.04, location=(0, 0, 0.6)),
                 "StormWave", wave_mat)
    key(wave, 1, scale=(0.001, 0.001, 0.001))
    key(wave, frame(BLAST_AT), scale=(0.001, 0.001, 0.001))
    key(wave, frame(BLAST_AT + 0.7), scale=(60, 60, 8))
    key(wave, frame(BLAST_AT + 0.75), scale=(0.001, 0.001, 0.001))

    # ---- two players: one in the lee, one beside a pillar in the open
    def figure(name, color):
        return added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=1.8, location=(0, 0, 0.9)),
                     name, emissive(name, (0, 0, 0), 0.0, base=color))

    px, py = PILLARS["A"]
    d = math.hypot(px, py)
    safe = figure("Player_Safe", (0.1, 0.6, 0.2))
    key(safe, 1, location=(1.5, -9, 0.9))
    key(safe, frame(CAST_AT), location=(1.5, -9, 0.9))
    key(safe, frame(CAST_AT + 2.6), location=(px + px / d * 5.5, py + py / d * 5.5, 0.9))
    qx, qy = PILLARS["C"]
    q = math.hypot(qx, qy)
    lost = figure("Player_Exposed", (0.7, 0.15, 0.1))
    key(lost, 1, location=(-1.5, -9, 0.9))
    key(lost, frame(CAST_AT), location=(-1.5, -9, 0.9))
    # Beside the pillar, not behind it: near is not cover.
    key(lost, frame(CAST_AT + 2.8), location=(qx + qy / q * 5.5, qy - qx / q * 5.5, 0.9))
    key(lost, frame(BLAST_AT), rotation_euler=(0, 0, 0), location=(qx + qy / q * 5.5, qy - qx / q * 5.5, 0.9))
    key(lost, frame(BLAST_AT + 0.3), rotation_euler=(math.radians(90), 0, 0),
        location=(qx + qy / q * 5.5 + qx / q * 3, qy - qx / q * 5.5 + qy / q * 3, 0.4))

    # ---- stage: a snow floor, a low sun, a cold sky
    added(lambda: bpy.ops.mesh.primitive_plane_add(size=90, location=(0, -16, 0)), "Ground",
          emissive("Snow", (0, 0, 0), 0.0, base=(0.78, 0.82, 0.86)))
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(52), 0, math.radians(-38))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.26, 0.34, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
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
            view.view_location = (0.0, -13.0, 3.0)
            view.view_distance = 62.0
            view.view_rotation = Euler((math.radians(62), 0.0, math.radians(28))).to_quaternion()
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.context.scene.frame_set(1)
                if not bpy.context.screen.is_animation_playing:
                    bpy.ops.screen.animation_play()
            return None
    return None


SAVE = os.environ.get("ICE_PREVIEW_SAVE")
if SAVE:
    build()
    bpy.ops.wm.save_as_mainfile(filepath=SAVE)
    print("SAVED", SAVE)
else:
    if not bpy.data.filepath:
        build()
    bpy.app.timers.register(frame_and_play, first_interval=0.8)
