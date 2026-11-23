"""Shared modelling, rigging and clip authoring for the Hollow Crypt creatures.

Chunky, faceted KayKit-style bodies built from the Hollow Crypt kit's
primitives (docs/design/dungeon-rework/kit/hckit.py), every part RIGID-skinned
to one bone (the KayKit look: parts that rotate, never stretch), plus a small
keyframe language for the clips:

  * a creature is authored in Blender units = yards, +Z up, FACING -Y (the
    game's +Z after the glTF export, so the VISUALS row needs no yaw);
  * bones are (name, parent, head, tail); names ending in ".L" are mirrored to
    ".R" automatically (x -> -x);
  * a pose is {bone: [(axis, degrees), ...]} with the axis in the REST
    armature frame at the bone's head, carried by the parent; a ".L" entry is
    mirrored onto its ".R" twin; ('loc', (x, y, z)) moves a bone;
  * a clip is a list of (frame, pose) keys at 24 fps, looped or one-shot.

Run through build_creature.py; see README.md in this folder.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'docs', 'design', 'dungeon-rework', 'kit'))
sys.path.insert(0, KIT)
import hckit  # noqa: E402
from hckit import GLOW, STONE, Piece  # noqa: E402

FPS = 24


class Body(Piece):
    """A Piece whose every primitive is rigid-bound to the current bone."""

    def __init__(self, name, **kw):
        super().__init__(name, **kw)
        self.bone_layer = self.bm.verts.layers.int.new('bone')
        self.bone_names = []
        self.current = 0

    def on(self, bone):
        if bone not in self.bone_names:
            self.bone_names.append(bone)
        self.current = self.bone_names.index(bone) + 1
        return self

    def _paint(self, faces, color, mat):
        super()._paint(faces, color, mat)
        for face in faces:
            for v in face.verts:
                if v[self.bone_layer] == 0:
                    v[self.bone_layer] = self.current

    def mirror_last(self, mark, bone_r):
        """Duplicate everything built since `mark` onto the .R side (x -> -x)."""
        src = [f for f in self.bm.faces if any(v[self.gen] == 0 or v[self.gen] > mark for v in f.verts)]
        geom = bmesh.ops.duplicate(self.bm, geom=src)
        new_verts = [e for e in geom['geom'] if isinstance(e, bmesh.types.BMVert)]
        new_faces = [e for e in geom['geom'] if isinstance(e, bmesh.types.BMFace)]
        bmesh.ops.scale(self.bm, vec=Vector((-1, 1, 1)), verts=new_verts)
        bmesh.ops.reverse_faces(self.bm, faces=new_faces)
        if bone_r not in self.bone_names:
            self.bone_names.append(bone_r)
        idx = self.bone_names.index(bone_r) + 1
        left = {self.bone_names.index(b) + 1: b for b in self.bone_names if b.endswith('.L')}
        for v in new_verts:
            name = left.get(v[self.bone_layer])
            if name:
                twin = name[:-2] + '.R'
                if twin not in self.bone_names:
                    self.bone_names.append(twin)
                v[self.bone_layer] = self.bone_names.index(twin) + 1
            else:
                v[self.bone_layer] = idx
            v[self.gen] = 10 ** 6  # already placed: later turns never move it


def expand_bones(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(head), tuple(tail)))
        if name.endswith('.L'):
            m = lambda p: (-p[0], p[1], p[2])
            twin_parent = parent[:-2] + '.R' if parent and parent.endswith('.L') else parent
            out.append((name[:-2] + '.R', twin_parent, m(head), m(tail)))
    return out


def build_rig(name, bones, body_obj, bone_names):
    scene = bpy.context.scene
    arm_data = bpy.data.armatures.new(name + 'Rig')
    arm = bpy.data.objects.new(name + 'Rig', arm_data)
    scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, parent, head, tail in bones:
        eb = arm_data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.roll = 0.0
    for bname, parent, head, tail in bones:
        if parent:
            arm_data.edit_bones[bname].parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    # Rigid skin: the 'bone' attribute of each vertex names its one bone.
    mesh = body_obj.data
    attr = mesh.attributes.get('bone')
    groups = {}
    for i, b in enumerate(bone_names):
        groups[i + 1] = body_obj.vertex_groups.new(name=b)
    per = {}
    for vi, value in enumerate(attr.data):
        per.setdefault(value.value, []).append(vi)
    for idx, verts in per.items():
        g = groups.get(idx)
        if g is None:
            raise RuntimeError(f'vertex bound to no bone ({idx})')
        g.add(verts, 1.0, 'REPLACE')
    mesh.attributes.remove(attr)
    body_obj.parent = arm
    mod = body_obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return arm


def _axis(a):
    return {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[a] if isinstance(a, str) else Vector(a)


def _mirror_axis(v):
    # Reflection x -> -x maps a rotation about (ax, ay, az) by t to (ax, -ay, -az) by t.
    return Vector((v.x, -v.y, -v.z))


def expand_pose(pose):
    out = {}
    for bone, turns in pose.items():
        out.setdefault(bone, []).extend(turns)
        if bone.endswith('.L'):
            twin = bone[:-2] + '.R'
            mirrored = []
            for a, deg in turns:
                if a == 'loc':
                    mirrored.append(('loc', (-deg[0], deg[1], deg[2])))
                else:
                    mirrored.append((tuple(_mirror_axis(_axis(a))), deg))
            out.setdefault(twin, []).extend(mirrored)
    return out


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    for bone, turns in expand_pose(pose).items():
        pb = arm.pose.bones.get(bone)
        if pb is None:
            raise RuntimeError(f'pose names unknown bone {bone}')
        rest = pb.bone.matrix_local.to_3x3()
        inv = rest.inverted()
        q = Quaternion()
        loc = Vector()
        for a, deg in turns:
            if a == 'loc':
                loc += inv @ Vector(deg)
                continue
            r = Quaternion(_axis(a).normalized(), math.radians(deg)).to_matrix()
            q = (inv @ r @ rest).to_quaternion() @ q
        pb.rotation_quaternion = q
        pb.location = loc


def author_clip(arm, name, keys, loop=True):
    """keys: [(frame, pose)]; a looped clip repeats its first key at the end."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    if loop and keys[-1][0] != keys[0][0]:
        pass
    for frame, pose in keys:
        apply_pose(arm, pose)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
    return act


def _fcurves(act):
    if hasattr(act, 'fcurves') and len(getattr(act, 'fcurves', [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def loop(period, poses):
    """Evenly spaced keys over `period` frames, closing the loop on the first pose."""
    n = len(poses)
    keys = [(round(i * period / n) + 1, p) for i, p in enumerate(poses)]
    keys.append((period + 1, poses[0]))
    return keys


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission in (('KitStone', 0.0), ('KitGlow', 4.0)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.85
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        materials.append(mat)
    return materials


def finish_body(body, materials):
    root = bpy.data.objects.new(body.name + '_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    bone_names = list(body.bone_names)
    obj = body.finish(materials, root)
    obj.parent = None
    bpy.data.objects.remove(root, do_unlink=True)
    return obj, bone_names


def export(path, arm):
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    )
    print('WROTE', path)


def preview(arm, clips, out_png, focus_z=1.0, dist=9.0):
    """A contact sheet: each clip at its middle frame, side by side (one render)."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.25, 0.27, 0.33, 1)
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 6.0
    sun.rotation_euler = (0.9, 0.3, 2.4)
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 2.5
    fill.data.color = (0.7, 0.8, 1.0)
    fill.rotation_euler = (1.1, 0.0, -0.9)
    scene.collection.objects.link(fill)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    target = Vector((0, 0, focus_z))
    cam.location = target + Vector((dist * 0.75, -dist, dist * 0.35))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    base, ext = os.path.splitext(out_png)
    for clip in clips:
        act = bpy.data.actions[clip]
        arm.animation_data.action = act
        start, end = act.frame_range
        scene.frame_set(int((start + end) / 2))
        scene.render.filepath = f'{base}_{clip}{ext}'
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath)


__all__ = ['Body', 'STONE', 'GLOW', 'hckit', 'expand_bones', 'build_rig', 'author_clip', 'loop',
           'new_scene', 'finish_body', 'export', 'preview', 'FPS', 'Matrix', 'Vector']
