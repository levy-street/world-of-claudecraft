"""Smooth-bodied modelling and clip helpers for the Sunken Bastion's sea creatures.

The Hollow Crypt creature kit (../hollow_crypt_creatures/creature_kit.py) builds
faceted stone and bone. The Bastion's living sea creatures are soft, rounded
KayKit-style bodies instead: smooth shaded ellipsoids and tapering tubes, big
readable eyes with a catch-light, glossy wet shells. Everything else is the
crypt kit's contract, unchanged:

  * Blender units = yards, +Z up, FACING -Y (the game's +Z after export);
  * every part is RIGID-skinned to the current bone (`body.on(bone)`);
  * bones are (name, parent, head, tail) with `.L` mirrored onto `.R`;
  * a pose is {bone: [(axis, degrees) | ('loc', xyz) | ('scale', s)]} in the
    rest armature frame, `.L` mirrored onto `.R` (a key ending in '!', such as
    'Arm.L!', poses that one side only); clips are 24 fps keys.

`('scale', s)` is this kit's addition: a bone scaled uniformly about its head
(a brine sac swelling before it bursts, a throat pouch filling).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'hollow_crypt_creatures')))
import creature_kit as ck  # noqa: E402
from creature_kit import (  # noqa: E402
    GLOW, Body, build_rig, expand_bones, export, finish_body, loop, new_scene, preview,
)

STONE = 0

# ---- the Bastion sea palette (sRGB) ------------------------------------------
BARNACLE = (0.86, 0.83, 0.74)
BARNACLE_D = (0.55, 0.52, 0.46)
BARNACLE_HOLE = (0.12, 0.1, 0.09)
KELP = (0.22, 0.34, 0.16)
KELP_D = (0.14, 0.22, 0.1)
ALGAE = (0.36, 0.5, 0.3)
EYE_WHITE = (0.97, 0.95, 0.88)
PUPIL = (0.03, 0.03, 0.04)
TOOTH = (0.95, 0.93, 0.84)
MOUTH = (0.18, 0.05, 0.07)
RUST = (0.52, 0.26, 0.13)
RUST_D = (0.33, 0.17, 0.1)
IRON = (0.24, 0.24, 0.26)
BRINE = (0.35, 1.0, 0.82)
LANTERN = (1.0, 0.82, 0.42)


class SeaBody(Body):
    """A Body with smooth rounded primitives."""

    def blob(self, center, radii, color, yaw=0.0, pitch=0.0, roll=0.0, rings=10, segments=16,
             smooth=True, bulge=0.0, flat_bottom=False, mat=STONE):
        """A smooth ellipsoid (a UV sphere), optionally squashed flat underneath
        or bulged on top."""
        before = set(self.bm.faces)
        made = bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=rings, radius=1.0)
        rot = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
        for v in made['verts']:
            x, y, z = v.co
            if bulge and z > 0:
                z *= 1 + bulge * (1 - (x * x + y * y))
            if flat_bottom and z < 0:
                z *= 0.35
            v.co = rot @ Vector((x * radii[0], y * radii[1], z * radii[2])) + Vector(center)
        faces = self._new_faces(before)
        for f in faces:
            f.smooth = smooth
        self._paint(faces, color, mat)
        return faces

    def tube(self, points, radii, color, sides=10, smooth=True, cap=True, squash=1.0, mat=STONE):
        """A smooth tube through `points` with one radius per point (or r0, r1)."""
        pts = [Vector(p) for p in points]
        if not isinstance(radii, (list, tuple)) or len(radii) != len(pts):
            r0, r1 = radii
            radii = [r0 + (r1 - r0) * i / max(1, len(pts) - 1) for i in range(len(pts))]
        before = set(self.bm.faces)
        rings = []
        for i, p in enumerate(pts):
            ahead = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            if ahead.length < 1e-6:
                ahead = Vector((0, 0, 1))
            ahead.normalize()
            side = ahead.cross(Vector((0, 0, 1)))
            if side.length < 1e-4:
                side = ahead.cross(Vector((0, 1, 0)))
            side.normalize()
            up = side.cross(ahead).normalized()
            r = radii[i]
            rings.append([self.bm.verts.new(p + side * math.cos(math.tau * k / sides) * r
                                            + up * math.sin(math.tau * k / sides) * r * squash)
                          for k in range(sides)])
        for i in range(len(rings) - 1):
            for k in range(sides):
                f = self.bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                                       rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
                f.smooth = smooth
        if cap:
            if radii[0] > 1e-4:
                self.bm.faces.new(list(reversed(rings[0])))
            if radii[-1] > 1e-4:
                self.bm.faces.new(rings[-1])
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def cone(self, base, tip, radius, color, sides=8, smooth=False, mat=STONE):
        """A cone from a round base to a point (teeth, claws, spines)."""
        return self.tube([base, tip], [radius, 0.0005], color, sides=sides, smooth=smooth, mat=mat)

    def eye(self, center, radius, look=(0, -1, 0), pupil=0.55, color=EYE_WHITE, iris=None, glow=False):
        """A big readable eye: a white ball, a dark pupil set into its front
        along `look`, and a small unlit catch-light up and to one side."""
        c = Vector(center)
        d = Vector(look).normalized()
        self.blob(c, (radius, radius, radius), color, rings=8, segments=12, mat=GLOW if glow else STONE)
        if iris is not None:
            self.blob(c + d * radius * 0.62, (radius * pupil * 1.35,) * 3, iris, rings=6, segments=10)
        self.blob(c + d * radius * (0.86 if iris is not None else 0.8), (radius * pupil,) * 3, PUPIL, rings=6,
                  segments=10)
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        glint = c + d * radius * 1.3 + Vector((0, 0, radius * 0.32)) + side * radius * 0.22
        self.blob(glint, (radius * 0.16,) * 3, (1.0, 1.0, 1.0), rings=4, segments=6, mat=GLOW)

    def barnacle(self, center, normal, size, color=BARNACLE):
        """One acorn barnacle: a ridged cone stub with a dark mouth, standing
        out of the surface along `normal`."""
        n = Vector(normal).normalized()
        c = Vector(center)
        self.tube([c - n * size * 0.2, c + n * size * 0.55], [size * 0.62, size * 0.34], color, sides=6,
                  smooth=False)
        self.blob(c + n * size * 0.56, (size * 0.26, size * 0.26, size * 0.08), BARNACLE_HOLE, rings=4,
                  segments=6, pitch=0.0)

    def kelp(self, top, length, sway, width, color=KELP):
        """A flat hanging kelp ribbon (two-sided) from `top`, curling by `sway`."""
        t = Vector(top)
        pts = [t + Vector((sway[0] * (i / 5) ** 1.5, sway[1] * (i / 5) ** 1.5, -length * i / 5)) for i in range(6)]
        self.tube(pts, [width, width * 0.4], color, sides=4, smooth=True, squash=0.25)


# ---- poses with scale ---------------------------------------------------------

def _expand(pose):
    out = {}
    for bone, turns in pose.items():
        if bone.endswith('!'):
            # 'Arm.L!': this side only, never mirrored (an asymmetric pose).
            out.setdefault(bone[:-1], []).extend(turns)
            continue
        out.setdefault(bone, []).extend(turns)
        if bone.endswith('.L'):
            twin = bone[:-2] + '.R'
            mirrored = []
            for a, deg in turns:
                if a == 'loc':
                    mirrored.append(('loc', (-deg[0], deg[1], deg[2])))
                elif a == 'scale':
                    mirrored.append(('scale', deg))
                else:
                    ax = ck._axis(a)
                    mirrored.append(((ax.x, -ax.y, -ax.z), deg))
            out.setdefault(twin, []).extend(mirrored)
    return out


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
        pb.scale = Vector((1, 1, 1))
    for bone, turns in _expand(pose).items():
        pb = arm.pose.bones.get(bone)
        if pb is None:
            raise RuntimeError(f'pose names unknown bone {bone}')
        rest = pb.bone.matrix_local.to_3x3()
        inv = rest.inverted()
        q = Quaternion()
        loc = Vector()
        scale = 1.0
        for a, deg in turns:
            if a == 'loc':
                loc += inv @ Vector(deg)
                continue
            if a == 'scale':
                scale *= deg
                continue
            r = Quaternion(ck._axis(a).normalized(), math.radians(deg)).to_matrix()
            q = (inv @ r @ rest).to_quaternion() @ q
        pb.rotation_quaternion = q
        pb.location = loc
        pb.scale = Vector((scale, scale, scale))


def author_clip(arm, name, keys, loop=True):
    """keys: [(frame, pose)] at 24 fps; bezier eased between keys."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for frame, pose in keys:
        apply_pose(arm, pose)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)
            pb.keyframe_insert('scale', frame=frame)
    for fc in ck._fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
    return act


def merge(*poses):
    """Merge poses: later turns on the same bone are appended."""
    out = {}
    for p in poses:
        for bone, turns in p.items():
            out.setdefault(bone, []).extend(turns)
    return out


def over(base, pose):
    """`base` with each bone named in `pose` REPLACED by the pose's turns
    (a strike written as an absolute key pose over a stance)."""
    out = {b: list(t) for b, t in base.items()}
    for bone, turns in pose.items():
        out[bone] = list(turns)
    return out


def export_all(path, arm):
    for pb in arm.pose.bones:
        pb.scale = Vector((1, 1, 1))
    export(path, arm)


def sheet(arm, clips, out_png, focus_z=1.0, dist=9.0, human=None):
    """Preview renders, each clip at its middle frame (and a player-sized
    reference figure beside the creature when `human` is a height)."""
    if human:
        mat = bpy.data.materials.new('ref')
        mat.diffuse_color = (0.85, 0.3, 0.25, 1)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=human, location=(2.6, 0.5, human / 2))
        bpy.context.active_object.data.materials.append(mat)
    preview(arm, clips, out_png, focus_z, dist)


__all__ = [
    'SeaBody', 'GLOW', 'STONE', 'author_clip', 'apply_pose', 'build_rig', 'expand_bones', 'export_all',
    'finish_body', 'loop', 'merge', 'over', 'new_scene', 'preview', 'sheet',
]
