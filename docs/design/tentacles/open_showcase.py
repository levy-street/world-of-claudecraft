"""Open an ANIMATED showcase of four Buried Hoard boss mechanics in the Blender UI.

Build a scratch file headless, then open it (a saved file skips the splash):

    HOARD_SHOWCASE_SAVE=/tmp/hoard_showcase.blend blender --background --python <this file>
    blender /tmp/hoard_showcase.blend --python <this file>

Four stations side by side, each on the game's own numbers, looping together:

  1. Tentacles of the Abyss: a tentacle rises, rears and LASHES a lane, then
     lowers and SWEEPS a full turn (docs/design/tentacles/).
  2. Rolling Boulder: hefted, thrown down, rolled at a marked player inside the
     green ring, thrown back, broken (docs/design/boulder/).
  3. Cocoon: the silk cocoon on its strand beside the brood cocoon
     (docs/design/cocoon/).
  4. Hammer of the Forge: the hammer falls, lands and is drawn back up while
     its ring spreads (docs/design/forge-hammer/).

A preview only: in the game none of this is baked animation, it is the same
closed-form functions evaluated by code, and the colours here stand in for the
runtime materials. Nothing is saved into the repository.
"""
import math
import os

import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN = os.path.dirname(HERE)
FPS = 30
SECONDS = 12.0
SPACING = 34.0
HALF_PI = math.pi / 2

# ---- the tentacle's pose maths (src/render/hoard_tentacles_core.ts)
LINKS, LENGTH, BASE_R, TIP_R = 16, 11.0, 1.0, 0.3
WHIP_TELE, WHIP_STRIKE, WHIP_LEN = 1.3, 0.22, 15.0
SWEEP_TELE, SWEEP_SEC, SWEEP_R = 1.6, 1.3, 8.5
# ---- the boulder (src/sim/rift/hoard_boulder_core.ts)
B_RADIUS, B_WARN, B_SPEED, B_SUPPORT, B_HEFT = 2.3, 2.4, 9.0, 5.0, 7.5
# ---- the hammer (src/sim/rift/hoard_forge_hammer_core.ts)
H_WARN, H_FALL, H_DROP, H_RING_SPEED, H_RING_MAX = 1.5, 0.55, 46.0, 6.2, 27.0


def smooth(v):
    t = max(0.0, min(1.0, v))
    return t * t * (3 - 2 * t)


def frame(seconds):
    return max(1, int(round(seconds * FPS)) + 1)


def emissive(name, color, strength, base=None, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*(base or color), 1)
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Alpha'].default_value = alpha
    return mat


def key(obj, f, **props):
    for name, value in props.items():
        setattr(obj, name, value)
        obj.keyframe_insert(data_path=name, frame=f)


def key_matrix(obj, f, matrix):
    loc, rot, scale = matrix.decompose()
    obj.rotation_mode = 'QUATERNION'
    key(obj, f, location=loc, rotation_quaternion=rot, scale=scale)


def added(make, name, material=None):
    before = set(bpy.context.scene.objects)
    make()
    obj = next(o for o in bpy.context.scene.objects if o not in before)
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def load(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return {o.name.split('.')[0]: o for o in bpy.context.scene.objects if o not in before}


def copy_of(source, name):
    clone = source.copy()
    clone.name = name
    clone.parent = None
    bpy.context.scene.collection.objects.link(clone)
    return clone


def player(name, x, y):
    return added(
        lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=1.8, location=(x, y, 0.9)),
        name,
        emissive('PlayerRed', (0, 0, 0), 0.0, base=(0.6, 0.12, 0.08)),
    )


# ------------------------------------------------------------------ tentacles
def idle_pitch(s):
    return 0.16 + 0.5 * s ** 1.5 + 1.5 * max(0.0, s - 0.7) ** 1.3


def rear_pitch(s):
    return -0.8 * s ** 0.85 + 1.1 * max(0.0, s - 0.78)


def flat_pitch(s, share, droop):
    return (HALF_PI + droop) * smooth(s / share)


def tentacle_pose(t):
    """(grow, rear, slam, low, heading, stretch, lag) at `t` seconds of the loop."""
    rest, aim = math.radians(200), math.radians(180)
    grow = smooth((t - 0.6) / 0.55)
    rear = slam = low = lag = 0.0
    heading = rest
    a = t - 2.2  # the lash
    if 0 <= a < WHIP_TELE:
        rear = smooth(a / (WHIP_TELE * 0.7))
        heading = rest + (aim - rest) * smooth(a / (WHIP_TELE * 0.45))
    elif WHIP_TELE <= a < WHIP_TELE + WHIP_STRIKE:
        k = (a - WHIP_TELE) / WHIP_STRIKE
        slam, rear, heading = k * k, 1 - k * k, aim
    elif WHIP_TELE + WHIP_STRIKE <= a < WHIP_TELE + WHIP_STRIKE + 1.1:
        back = smooth((a - WHIP_TELE - WHIP_STRIKE - 0.5) / 0.6)
        slam, heading = 1 - back, aim + (rest - aim) * back
    b = t - 5.6  # the sweep
    if 0 <= b < SWEEP_TELE:
        low = smooth(b / (SWEEP_TELE * 0.8))
        heading = rest + (aim - rest) * smooth(b / (SWEEP_TELE * 0.5))
    elif SWEEP_TELE <= b < SWEEP_TELE + SWEEP_SEC:
        k = (b - SWEEP_TELE) / SWEEP_SEC
        low, lag = 1.0, 4 * k * (1 - k)
        heading = aim + math.tau * smooth(k)
    elif SWEEP_TELE + SWEEP_SEC <= b < SWEEP_TELE + SWEEP_SEC + 0.8:
        back = smooth((b - SWEEP_TELE - SWEEP_SEC) / 0.8)
        low, heading = 1 - back, aim + (rest - aim) * back
    stretch = 1 + 0.5 * slam + 0.06 * rear - 0.17 * low
    return grow, rear, slam, low, heading, stretch, lag


def tentacle_links(t):
    grow, rear, slam, low, heading, stretch, lag = tentacle_pose(t)
    calm = 1 - max(rear, slam, low)
    step = LENGTH / LINKS * stretch * grow
    x = y = z = 0.0
    out = []
    for link in range(LINKS):
        s = (link + 0.5) / LINKS
        pitch = (
            idle_pitch(s) * calm
            + rear_pitch(s) * rear
            + flat_pitch(s, 0.24, 0.5) * slam
            + flat_pitch(s, 0.3, 0.2) * low
            + calm * 0.12 * math.sin(t * 1.3 + s * 2.6)
        )
        h = heading + calm * 0.4 * s * math.sin(t * 0.9 + s * 1.7) - lag * 0.34 * s * s
        radius = (BASE_R + (TIP_R - BASE_R) * s ** 0.85) * (0.55 + 0.45 * grow)
        floor = radius * 0.55
        if z <= floor + 1e-3 and link > 0:
            z = floor
            pitch = min(pitch, HALF_PI)
        out.append((x, y, z, pitch, h, radius, step))
        x += math.sin(h) * math.sin(pitch) * step
        y += math.cos(h) * math.sin(pitch) * step
        z += math.cos(pitch) * step
    return out, (x, y, max(z, 0.2), out[-1][3], out[-1][4], out[-1][5] * 0.94)


def link_matrix(origin, position, pitch, heading, radius, length):
    axis = Vector((math.sin(heading) * math.sin(pitch), math.cos(heading) * math.sin(pitch), math.cos(pitch)))
    belly = Vector((math.sin(heading) * math.cos(pitch), math.cos(heading) * math.cos(pitch), -math.sin(pitch)))
    local_y = -belly
    local_x = local_y.cross(axis)
    size = max(radius, 1e-3)
    return Matrix((
        (local_x.x * size, local_y.x * size, axis.x * max(length, 1e-3), origin[0] + position[0]),
        (local_x.y * size, local_y.y * size, axis.y * max(length, 1e-3), origin[1] + position[1]),
        (local_x.z * size, local_y.z * size, axis.z * max(length, 1e-3), origin[2] + position[2]),
        (0, 0, 0, 1),
    ))


def build_tentacles(origin, frames):
    parts = load(os.path.join(HERE, 'tentacle_components.glb'))
    links = [copy_of(parts['Tentacle_Seg'], f'Link_{n:02d}') for n in range(LINKS)]
    tip = copy_of(parts['Tentacle_Tip'], 'Link_Tip')
    for name in ('Tentacle_Seg', 'Tentacle_Tip'):
        parts[name].hide_viewport = True
        parts[name].hide_render = True
    parts['Tentacle_ROOT'].location = origin
    danger = emissive('Danger', (1.0, 0.35, 0.2), 2.5, alpha=0.5)
    lane = added(lambda: bpy.ops.mesh.primitive_plane_add(size=1), 'WhipLane', danger)
    ring = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=SWEEP_R, minor_radius=0.12), 'SweepRing', danger)
    player('Tentacle_Player', origin[0], origin[1] - 9)
    for f in range(1, frames + 1):
        t = (f - 1) / FPS
        chain, end = tentacle_links(t)
        for obj, (x, y, z, pitch, h, radius, step) in zip(links, chain):
            key_matrix(obj, f, link_matrix(origin, (x, y, z), pitch, h, radius, step * 1.22))
        key_matrix(tip, f, link_matrix(origin, end[:3], end[3], end[4], end[5], end[5]))
        lashing = 2.2 <= t < 2.2 + WHIP_TELE + WHIP_STRIKE + 0.4
        sweeping = 5.6 <= t < 5.6 + SWEEP_TELE + SWEEP_SEC
        key(lane, f, location=(origin[0], origin[1] - WHIP_LEN / 2, 0.06),
            scale=(3.4, WHIP_LEN, 1) if lashing else (0.001,) * 3)
        key(ring, f, location=(origin[0], origin[1], 0.08), scale=(1, 1, 1) if sweeping else (0.001,) * 3)


# ------------------------------------------------------------------ boulder
def build_boulder(origin, frames):
    parts = load(os.path.join(DESIGN, 'boulder', 'boulder_components.glb'))
    root = parts['Boulder_ROOT']
    shards = [o for name, o in parts.items() if name.startswith('Boulder_Shard')]
    whole = [parts['Boulder_Rock'], parts['Boulder_Bands'], parts['Boulder_Cracks']]
    homes = {o.name: Vector(o.location) for o in shards}
    start = Vector((origin[0], origin[1] + 9, 0))
    mark = Vector((origin[0], origin[1] - 9, 0))
    distance = (mark - start).length
    travel = distance / B_SPEED
    back = distance / 16.0
    t_arrive = 1.0 + B_WARN + travel
    t_home = t_arrive + back
    added(lambda: bpy.ops.mesh.primitive_cone_add(radius1=1.6, radius2=0.9, depth=5.6, location=(start.x, start.y + 2.6, 2.8)),
          'Boss_Grask', emissive('BossBrute', (0, 0, 0), 0.0, base=(0.35, 0.16, 0.1)))
    stand = emissive('Stand', (0.35, 1.0, 0.55), 3.0)
    ring = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=B_SUPPORT, minor_radius=0.1, location=(mark.x, mark.y, 0.08)),
                 'SupportRing', stand)
    player('Marked_Player', mark.x, mark.y)
    allies = [player(f'Ally_{n}', mark.x + 16 * (1 if n else -1), mark.y - 4) for n in range(2)]
    for f in range(1, frames + 1):
        t = (f - 1) / FPS
        local = t - 1.0
        for n, ally in enumerate(allies):
            k = smooth(local / (B_WARN + travel * 0.6))
            side = 1 if n else -1
            key(ally, f, location=(mark.x + side * (16 - 13.5 * k), mark.y - 4 + 3 * k, 0.9))
        key(ring, f, scale=(1, 1, 1) if 0 <= local < B_WARN + travel else (0.001,) * 3)
        rolling = t < t_home
        if local < 0:
            p, height, size = 0.0, B_RADIUS, 0.001
        elif local < B_WARN:
            p, height, size = 0.0, B_RADIUS + B_HEFT * smooth(local / (B_WARN * 0.6)), smooth(local / 0.7)
        elif t < t_arrive:
            k = (local - B_WARN) / travel
            p = k * (0.55 + 0.45 * k)
            drop = 1 - smooth(p / 0.18)
            height = B_RADIUS + B_HEFT * drop + abs(math.sin(p * math.pi * 4)) * 1.3 * (1 - p) * (1 - drop)
            size = 1.0
        else:
            k = min(1.0, (t - t_arrive) / back)
            p = 1 - k
            height, size = B_RADIUS + math.sin(k * math.pi) * min(6, distance * 0.22), 1.0
        where = start + (mark - start) * p
        roll = (p * distance) / B_RADIUS
        key(root, f, location=(where.x, where.y, height), rotation_euler=(roll, 0, 0),
            scale=(size,) * 3 if rolling else (1, 1, 1))
        for obj in whole:
            key(obj, f, scale=(1, 1, 1) if rolling else (0.001,) * 3)
        since = t - t_home
        for n, shard in enumerate(shards):
            home = homes[shard.name]
            if since < 0:
                key(shard, f, location=tuple(home), scale=(0.001,) * 3)
                continue
            flat = max(0.2, math.hypot(home.x, home.y))
            speed = 5.5 + ((n * 37) % 10) * 0.45
            lift = 5 + ((n * 53) % 7) * 0.6
            key(shard, f,
                location=(home.x + home.x / flat * speed * since, home.y + home.y / flat * speed * since,
                          max(-B_RADIUS + 0.3, home.z + lift * since - 11 * since * since)),
                rotation_euler=(since * (3 + n % 4), since * 2, 0),
                scale=(max(0.001, 1 - smooth((since - 0.5) / 0.4)),) * 3)


# ------------------------------------------------------------------ cocoons
def build_cocoons(origin, frames):
    silk = load(os.path.join(DESIGN, 'cocoon', 'silk_cocoon_components.glb'))['SilkCocoon_ROOT']
    brood = load(os.path.join(DESIGN, 'cocoon', 'brood_cocoon_components.glb'))['BroodCocoon_ROOT']
    silk.location = (origin[0] - 5, origin[1], 0)
    brood.location = (origin[0] + 5, origin[1], 0)
    strand = added(lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=24, location=(origin[0] - 5, origin[1], 3.4 + 12)),
                   'Strand', emissive('SilkStrand', (0.9, 0.92, 0.82), 0.6))
    ring = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=2.1, minor_radius=0.12, location=(origin[0] - 5, origin[1], 0.08)),
                 'RescueRing', emissive('Rescue', (0.8, 0.9, 0.4), 3.0))
    player('Rescuer', origin[0] - 8.5, origin[1] - 2)
    for f in range(1, frames + 1, 2):
        t = (f - 1) / FPS
        up = smooth((t - 1.0) / 0.4)
        key(silk, f, scale=(up, up, up) if up > 0 else (0.001,) * 3)
        key(strand, f, scale=(1, 1, up) if up > 0 else (0.001,) * 3)
        key(ring, f, scale=(up, up, 1) if up > 0 else (0.001,) * 3)
        beat = 1 + 0.04 * math.sin(t * (2.2 + 0.4 * t) * math.pi)
        key(brood, f, scale=(beat, beat, 2 - beat))


# ------------------------------------------------------------------ hammer
def build_hammer(origin, frames):
    root = load(os.path.join(DESIGN, 'forge-hammer', 'forge_hammer_components.glb'))['ForgeHammer_ROOT']
    fire = emissive('RingFire', (1.0, 0.5, 0.12), 6.0)
    ring = added(lambda: bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.03, location=(origin[0], origin[1], 0.15)),
                 'FireRing', fire)
    marker = added(lambda: bpy.ops.mesh.primitive_circle_add(radius=4.5, fill_type='NGON', location=(origin[0], origin[1], 0.05)),
                   'Marker', emissive('Molten', (1.0, 0.35, 0.05), 2.0))
    player('Hammer_Player', origin[0] + 8, origin[1] - 8)
    for f in range(1, frames + 1):
        t = (f - 1) / FPS
        local = t - 1.0
        since = local - H_WARN
        falling = max(0.0, min(1.0, (local - (H_WARN - H_FALL)) / H_FALL))
        lifting = max(0.0, min(1.0, (since - 0.55) / 0.9))
        drop = H_DROP * (1 - falling * falling) if since < 0 else H_DROP * lifting * lifting
        key(root, f, location=(origin[0], origin[1], drop))
        key(marker, f, scale=(1, 1, 1) if 0 <= local < H_WARN else (0.001,) * 3)
        radius = min(H_RING_MAX, max(0.0, since) * H_RING_SPEED)
        key(ring, f, scale=(radius, radius, 12) if 0.05 < radius < H_RING_MAX else (0.001,) * 3)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = frame(SECONDS)
    frames = scene.frame_end
    build_tentacles((-1.5 * SPACING, 0, 0), frames)
    build_boulder((-0.5 * SPACING, 0, 0), frames)
    build_cocoons((0.5 * SPACING, 0, 0), frames)
    build_hammer((1.5 * SPACING, 0, 0), frames)
    added(lambda: bpy.ops.mesh.primitive_plane_add(size=260, location=(0, 0, 0)), 'Ground',
          emissive('Floor', (0, 0, 0), 0.0, base=(0.09, 0.095, 0.1)))
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 2.6
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.08, 0.1, 0.13, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    scene.world = world
    scene.frame_set(1)


def frame_and_play():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.shading.use_scene_world = True
            space.shading.use_scene_lights = True
            space.overlay.show_floor = False
            space.overlay.show_axis_x = False
            space.overlay.show_axis_y = False
            region = next((r for r in area.regions if r.type == 'WINDOW'), None)
            if region is None:
                continue
            # A fixed three-quarter view of all four stations: framing on the
            # selection is unreliable from a timer.
            view = space.region_3d
            view.view_perspective = 'PERSP'
            view.view_location = (0.0, -2.0, 4.0)
            view.view_distance = 120.0
            view.view_rotation = Euler((math.radians(60), 0.0, math.radians(0))).to_quaternion()
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.context.scene.frame_set(1)
                if not bpy.context.screen.is_animation_playing:
                    bpy.ops.screen.animation_play()
            return None
    return None


SAVE = os.environ.get('HOARD_SHOWCASE_SAVE')
if SAVE:
    build()
    bpy.ops.wm.save_as_mainfile(filepath=SAVE)
    print('SAVED', SAVE)
else:
    if not bpy.data.filepath:
        build()
    bpy.app.timers.register(frame_and_play, first_interval=0.8)
