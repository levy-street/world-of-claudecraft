"""Open an ANIMATED preview of Soul Harvest in the Blender UI.

Build a scratch file headless, then open it (a saved file skips the splash):

    BONE_PREVIEW_SAVE=/tmp/soul_harvest_preview.blend blender --background --python <this file>
    blender /tmp/soul_harvest_preview.blend --python <this file>

The whole mechanic, on the game's own timings (SOUL_HARVEST in
src/sim/rift/hoard_bone_reaper_core.ts): souls take shape round the room while
the boss channels, hold and brighten, then are drawn to him in a straight line.
A player figure runs to two of them and RELEASES them (a clean bright pop); the
other three arrive and are ABSORBED (a heavy green bloom at his ribs, a ring
across the floor), and the glow in his chest grows with every stack.

A preview only: in the game none of this is baked animation, it is the same
closed-form functions evaluated by code. The colours here stand in for the
runtime materials (the game tints and lights the souls; the GLB ships untinted).
Nothing is saved into the repository.
"""
import math
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
CAST, HOLD, SPEED, ABSORB, CATCH = 1.6, 0.9, 4.2, 2.6, 2.4
LATERAL, REACH, DEPTH = 9.0, 8.6, 28.0
SECONDS = 12.0
COUNT = 5
# Which souls the player reaches, and when (seconds): the rest reach the boss.
RELEASED = {1: 4.4, 3: 7.6}
SOUL = (0.2, 0.85, 1.0)
SOUL_DEEP = (0.05, 0.4, 0.55)
ABSORB_GREEN = (0.2, 1.0, 0.45)


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
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


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


def added(make, name, material=None):
    before = set(bpy.context.scene.objects)
    make()
    obj = next(o for o in bpy.context.scene.objects if o not in before)
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def duplicate(root):
    clone = root.copy()
    bpy.context.scene.collection.objects.link(clone)
    for child in root.children:
        kid = child.copy()
        bpy.context.scene.collection.objects.link(kid)
        kid.parent = clone
    return clone


def soul_track(index):
    """Spawn point and the soul's position over time (the sim's soulPosition)."""
    near, far = 13.0, DEPTH
    mid, rf, rx = (near + far) / 2, (far - near) / 2 + 2, LATERAL + REACH * 0.55
    a = 0.6 + index / COUNT * math.tau
    sx, sf = rx * math.sin(a), max(3.0, mid + rf * math.cos(a))
    d = math.hypot(sx, sf)
    if d < near:
        sx, sf = sx * near / d, sf * near / d
    sy = -sf  # game forward is Blender -Y
    distance = math.hypot(sx, sy)
    travel = max(0.0, distance - ABSORB)
    travel_sec = travel / SPEED
    life = CAST + HOLD + travel_sec

    def at(t):
        walk = max(0.0, min(travel_sec, t - CAST - HOLD))
        ease = travel_sec / 3
        covered = walk * walk / (2 * ease) if walk <= ease else ease / 2 + (walk - ease)
        k = covered / (travel_sec - ease / 2) * travel / distance
        return sx * (1 - k), sy * (1 - k)

    return (sx, sy), life, at


def burst(name, material, frames, start, span, where, grow):
    """A pop: nothing, then a sphere that swells and is gone. `grow` = (from, to)."""
    ball = added(lambda: bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=where),
                 name, material)
    for frame in range(1, frames + 1):
        t = ((frame - 1) / FPS - start) / span
        if t < 0 or t >= 1:
            size = 0.001
        else:
            ease = 1 - (1 - t) ** 3
            # Swell, then collapse to nothing over the last third (no alpha here).
            size = (grow[0] + (grow[1] - grow[0]) * ease) * (1 - smooth((t - 0.6) / 0.4))
        key(ball, frame, scale=(max(0.001, size),) * 3)
    linear(ball)
    return ball


def ring_wave(name, material, frames, start, span, where, grow):
    ring = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.035, location=where),
                 name, material)
    for frame in range(1, frames + 1):
        t = ((frame - 1) / FPS - start) / span
        size = 0.001 if t < 0 or t >= 1 else grow[0] + (grow[1] - grow[0]) * (1 - (1 - t) ** 3)
        key(ring, frame, scale=(size, size, max(0.001, 1 - t) if 0 <= t < 1 else 0.001))
    linear(ring)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = int(SECONDS * FPS)
    frames = scene.frame_end

    bone = emissive("BossBone", (0.0, 0.0, 0.0), 0.0, base=(0.42, 0.38, 0.3))
    boss = added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=1.3, depth=4.8, location=(0, 0, 2.4)),
                 "Boss_stand_in", bone)
    skull = added(lambda: bpy.ops.mesh.primitive_uv_sphere_add(radius=1.15, location=(0, 0, 5.6)),
                  "Boss_skull", bone)
    del boss, skull

    # ---- the souls, in the game's colours
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "soul_components.glb"))
    emissive("SoulBody", SOUL_DEEP, 1.6)
    emissive("SoulCore", (0.75, 1.0, 1.0), 3.5)
    emissive("SoulWisp", SOUL, 1.8)
    emissive("SoulVoid", (0, 0, 0), 0.0, base=(0.01, 0.04, 0.06))
    first = next(o for o in scene.objects if o.name.startswith("SoulHarvest_Soul_ROOT"))
    souls = [first] + [duplicate(first) for _ in range(COUNT - 1)]
    marker_mat = emissive("SoulMarker", SOUL, 1.4)
    release_mat = emissive("ReleaseBurst", (0.55, 0.95, 1.0), 3.0)
    absorb_mat = emissive("AbsorbBloom", ABSORB_GREEN, 2.2)

    absorbed_at = []
    player_stops = []
    for index, ghost in enumerate(souls):
        (sx, sy), life, at = soul_track(index)
        end = RELEASED.get(index, life)
        released = index in RELEASED
        ghost.name = f"Soul_{index + 1}_{'released' if released else 'absorbed'}"
        ghost.rotation_euler = (0, 0, math.atan2(-sx, sy))  # faces the boss
        wisps = next((c for c in ghost.children if c.name.startswith("OuterWisps")), None)
        marker = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=CATCH, minor_radius=0.04),
                       f"Soul_{index + 1}_reach_ring", marker_mat)
        for frame in range(1, frames + 1):
            t = (frame - 1) / FPS
            x, y = at(min(t, end))
            alive = t < end
            left = life - t
            taken = 0.0 if released else 1 - smooth(left / 0.55)
            size = smooth(t / CAST) * (1 - 0.45 * taken) if alive else 0.001
            bob = 0.16 * math.sin(t * 2.1 + index * 1.7)
            # Pulled thin along its heading (local Y) as the boss takes it.
            key(ghost, frame, location=(x, y, 0.55 + bob + 0.5 * taken),
                scale=(max(0.001, size), max(0.001, size * (1 + 1.4 * taken)), max(0.001, size)))
            key(marker, frame, location=(x, y, 0.06),
                scale=((1.0 if alive and t > CAST * 0.4 else 0.001),) * 3)
            if wisps:
                key(wisps, frame, rotation_euler=(wisps.rotation_euler.x, wisps.rotation_euler.y, t * 1.5))
        linear(ghost)
        linear(marker)
        if wisps:
            linear(wisps)
        x, y = at(end)
        if released:
            player_stops.append((end, x, y))
            burst(f"Release_pop_{index + 1}", release_mat, frames, end, 0.7, (x, y, 1.4), (0.3, 1.6))
            ring_wave(f"Release_ring_{index + 1}", marker_mat, frames, end, 0.7, (x, y, 0.08), (0.5, 3.1))
        else:
            absorbed_at.append(life)
            burst(f"Absorb_bloom_{index + 1}", absorb_mat, frames, life, 1.1, (0, 0, 3.3), (0.6, 3.0))
            ring_wave(f"Absorb_ring_{index + 1}", absorb_mat, frames, life, 1.1, (0, 0, 0.08), (2.0, 9.0))

    # ---- Harvested Soul: the glow in his ribs grows with every stack
    ribs = added(lambda: bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(0, -0.9, 3.3)),
                 "Harvested_Soul_rib_glow", emissive("RibGlow", ABSORB_GREEN, 2.0))
    for frame in range(1, frames + 1):
        t = (frame - 1) / FPS
        stacks = sum(1 for when in absorbed_at if t >= when)
        pulse = 0.9 + 0.1 * math.sin(t * 3.1)
        size = 0.001 if stacks == 0 else (0.35 + 0.22 * stacks) * pulse
        key(ribs, frame, scale=(size,) * 3)
    linear(ribs)

    # ---- the player who runs to release two of them
    player = added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.32, depth=1.8, location=(2, -12, 0.9)),
                   "Player_1m80", emissive("PlayerRed", (0, 0, 0), 0.0, base=(0.55, 0.08, 0.06)))
    key(player, 1, location=(2.0, -12.0, 0.9))
    key(player, int(CAST * FPS), location=(2.0, -12.0, 0.9))
    for when, x, y in sorted(player_stops):
        key(player, int(when * FPS) + 1, location=(x, y, 0.9))
    linear(player)

    # ---- stage
    ground = added(lambda: bpy.ops.mesh.primitive_plane_add(size=56, location=(0, -14, 0)), "Ground",
                   emissive("Ground", (0, 0, 0), 0.0, base=(0.035, 0.045, 0.04)))
    del ground
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 2.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.07, 0.1, 1)
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
            # The scene's own dark world and sun, not the studio light: the souls
            # are lights in a dim room, and the studio HDRI washes them out.
            space.shading.use_scene_world = True
            space.shading.use_scene_lights = True
            space.overlay.show_floor = False
            space.overlay.show_axis_x = False
            space.overlay.show_axis_y = False
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            if region is None:
                continue
            with bpy.context.temp_override(window=window, area=area, region=region):
                # Frame on the souls where they APPEAR plus the boss: the whole play.
                bpy.context.scene.frame_set(int(CAST * FPS))
                bpy.ops.object.select_all(action="DESELECT")
                for obj in bpy.context.scene.objects:
                    if obj.name.startswith(("Soul_", "Boss_")) and obj.type == "MESH":
                        obj.select_set(True)
                    elif obj.name.startswith("Soul_") and obj.type == "EMPTY":
                        for child in obj.children:
                            child.select_set(True)
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action="DESELECT")
                bpy.context.scene.frame_set(1)
                if not bpy.context.screen.is_animation_playing:
                    bpy.ops.screen.animation_play()
            return None
    return None


SAVE = os.environ.get("BONE_PREVIEW_SAVE")
if SAVE:
    build()
    bpy.ops.wm.save_as_mainfile(filepath=SAVE)
    print("SAVED", SAVE)
else:
    if not bpy.data.filepath:
        build()
    bpy.app.timers.register(frame_and_play, first_interval=0.8)
