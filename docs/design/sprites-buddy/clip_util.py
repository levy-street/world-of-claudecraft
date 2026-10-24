"""Shared helpers: pick one clip on the rig AND on every face's shape keys."""
import bpy

KINDS = ("_sprite", "_face")


def anim_meshes():
    ms = [o for o in bpy.data.objects if o.type == "MESH" and o.name.split(".")[0].endswith(KINDS)]
    return sorted(ms, key=lambda o: o.name.split(".")[0])


def set_clip_source(clip):
    rig = bpy.data.objects["SpritesRig"]
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True
    act = bpy.data.actions[f"Sprites_{clip}"]
    rig.animation_data.action = act
    for o in anim_meshes():
        k = o.data.shape_keys
        if k and k.animation_data:
            for tr in k.animation_data.nla_tracks:
                tr.mute = True
            c = o.name.split("_")[0]
            k.animation_data.action = bpy.data.actions[f"Face_{c}_{clip}"]
    return int(act.frame_range[1])


def set_clip_glb(clip):
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    act = bpy.data.actions[clip]
    if rig.animation_data is None:
        rig.animation_data_create()
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True
    rig.animation_data.action = act
    rig.animation_data.action_slot = next(s for s in act.slots if s.target_id_type == "OBJECT")
    for o in anim_meshes():
        k = o.data.shape_keys
        if not k:
            continue
        ad = k.animation_data or k.animation_data_create()
        for tr in ad.nla_tracks:
            tr.mute = True
        ad.action = act
        ad.action_slot = next(s for s in act.slots if s.identifier == f"KE{k.user.name}" or s.identifier.endswith(o.name))
    return int(act.frame_range[1])
