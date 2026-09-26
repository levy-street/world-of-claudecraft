"""Review staging for the harbormaster's gear: the exported tricorne, pipe and spyglass on her own
composed body (the fitting reference extract_reference.mjs bakes out of the shipped modular
GLB, in the hips bone's bind frame), painted in flat approximations of her in-game colours: the
navy coat of the NPC-only `admiralty` colorway, grey braid, weathered skin.

Nothing here is exported: build_harbormaster_gear.py exports both gear roots before this module
adds anything. Without the reference directory the gear is staged on its own.

  node scripts/assets/harbormaster_gear/extract_reference.mjs
  blender --background --python scripts/assets/harbormaster_gear/build_harbormaster_gear.py -- \
      --save capitana.blend --preview OUT_DIR
  blender capitana.blend --python scripts/assets/harbormaster_gear/open_gear.py
"""
import math
import os

import bpy
from shiplib import P

# the head bone's bind origin in the hips bone's frame (extract_reference.mjs bounds: the head
# spans y -0.026..0.804 from the head bone and 0.810..1.639 from the hips bone)
HEAD_IN_HIPS = (0.0, 0.836, 0.0)

REF_COLORS = {
    'F_Head': (0.62, 0.42, 0.3),
    'F_Ear_round': (0.62, 0.42, 0.3),
    'F_Eye_narrow': (0.03, 0.04, 0.05),
    'F_Brow_thick': (0.55, 0.53, 0.5),
    'F_Mouth_smile': (0.35, 0.16, 0.14),
    'H2_warriorbraid': (0.62, 0.6, 0.57),
    'Armor_mage_Chest': (0.08, 0.12, 0.25),
    'Armor_mage_ArmL': (0.08, 0.12, 0.25),
    'Armor_mage_ArmR': (0.08, 0.12, 0.25),
    'Armor_mage_Back': (0.07, 0.1, 0.22),
    'Armor_mage_LegL': (0.22, 0.14, 0.09),
    'Armor_mage_LegR': (0.22, 0.14, 0.09),
    'Armor_mage_FootL': (0.16, 0.1, 0.06),
    'Armor_mage_FootR': (0.16, 0.1, 0.06),
    'Armor_rogue_HandL': (0.26, 0.16, 0.1),
    'Armor_rogue_HandR': (0.26, 0.16, 0.1),
}


def _mat(name, color, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def stage(objs, reference_dir):
    scene = bpy.context.scene
    models = {m['bone']: m for m in objs['models']}
    head_root = models['head']['root']
    head_root.location = P(*HEAD_IN_HIPS)
    ref = os.path.join(reference_dir, 'reference_hips.glb')
    if os.path.exists(ref):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=ref)
        coll = bpy.data.collections.new('HarbormasterBody_Reference')
        scene.collection.children.link(coll)
        for obj in set(bpy.data.objects) - before:
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            coll.objects.link(obj)
            if obj.type == 'MESH':
                base = obj.name.split('.')[0]
                obj.data.materials.clear()
                obj.data.materials.append(_mat(f'ref_{base}', REF_COLORS.get(base, (0.5, 0.5, 0.5))))
                for poly in obj.data.polygons:
                    poly.use_smooth = True
    else:
        print('PREVIEW no reference at', ref, '(run extract_reference.mjs); staging the gear alone')
    # a neutral studio: soft sky, a key sun and a fill, a floor disc
    world = bpy.data.worlds.new('Studio')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.52, 0.56, 0.62, 1)
    bg.inputs[1].default_value = 0.9
    for name, rot, energy in (('Key', (50, 0, -35), 3.2), ('Fill', (65, 0, 140), 1.0)):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(light)
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.6, fill_type='NGON',
                                      location=P(0, -0.41, 0))
    floor = bpy.context.object
    floor.name = 'Studio_Floor'
    floor.data.materials.append(_mat('floor', (0.3, 0.22, 0.15)))
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.lens = 55
    scene.collection.objects.link(cam)
    scene.camera = cam
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1100
    scene.view_settings.view_transform = 'Standard'


# name, yaw (0 = in front of her), camera height, target height, distance (hips frame)
SHOTS = (
    ('front', 0, 0.9, 0.62, 4.6),
    ('three_quarter', 40, 1.15, 0.62, 4.6),
    ('left_side', 90, 0.7, 0.45, 4.2),
    ('back', 160, 1.2, 0.62, 4.6),
    ('head_closeup', 28, 1.55, 1.3, 2.4),
    ('gameplay_high', 25, 3.6, 0.6, 7.5),
)


def aim(cam, yaw_deg, cam_h, target_h, dist):
    a = math.radians(yaw_deg)
    loc = P(math.sin(a) * dist, cam_h, math.cos(a) * dist)
    cam.location = loc
    direction = P(0, target_h, 0) - loc
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def render_all(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    for name, yaw, cam_h, target_h, dist in SHOTS:
        aim(scene.camera, yaw, cam_h, target_h, dist)
        scene.render.filepath = os.path.join(out_dir, f'gear_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath)
    aim(scene.camera, 40, 1.15, 0.62, 4.6)


def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print('SAVED', path)


