"""The wolf skeletons, fitted by hand to the shipped meshes.

Coordinates are Blender space (Z up, the muzzle toward -Y, the wolf's left toward +X)
in the GLB's own units, exactly where Blender's glTF importer puts the shipped body.
Every joint was placed from measurements of the body (surface samples sliced along
the legs, the spine profile, the traced tail centre line) and then checked against
the mesh in x-ray from the side, the front and above.

Two facts about these bodies drive the layout:

- Neither wolf sits on the axis. The tail curls off to the wolf's left, so the
  bounding-box centring the export did put the body midline at x = -0.18 (Greyjaw
  -0.15). The old dog rig assumed x = 0, which is part of why it never deformed well.
- The tail droops and curls in the rest pose. The tail bones follow that curve
  (TAIL_CURVE, resampled into six equal bones) instead of running straight out
  behind the rump the way the old rig's did, past the end of the tail.

Bone roles (one table per wolf, same names and hierarchy, so one clip set fits both):
  Root            ground anchor under the body; never deforms, never animated
  Pelvis          the body bone: carries all body travel and the hips' turn
  Spine1, Spine2  lumbar and mid back; Chest carries the shoulders
  Neck1, Neck2    the neck; Head (the whole head, the mouth stays closed as modeled)
  Ear_L/EarTip_L  two-segment ears (and the right side)
  Scapula, Humerus, Forearm, FrontPastern, FrontPaw   a front leg
  Thigh, Shin, HindPastern, HindPaw                    a hind leg
  Tail1 .. Tail6  the tail, root to tip

`shoulder_fade` bounds where the front legs may pull skin (rig.py shoulder_fade):
bone heat hands the shoulder bones the whole flank up over the withers and across
the sternum, so a raised foreleg dragged the chest into the face.
"""

TAIL_BONES = 6

# --------------------------------------------------------------------- the pack wolf
# public/models/creatures/wolf_basic.glb (also the shaman's Shadewolf form)
WOLF_BASIC = {
    'midline_x': -0.18,
    'ground_z': -0.553,
    'bones': [
        ('Root', None, (-0.18, 0.15, -0.553), (-0.18, -0.25, -0.553)),
        ('Pelvis', 'Root', (-0.18, 0.82, 0.70), (-0.18, 0.42, 0.73)),
        ('Spine1', 'Pelvis', (-0.18, 0.42, 0.73), (-0.18, 0.02, 0.76)),
        ('Spine2', 'Spine1', (-0.18, 0.02, 0.76), (-0.18, -0.36, 0.80)),
        ('Chest', 'Spine2', (-0.18, -0.36, 0.80), (-0.18, -0.70, 0.88)),
        ('Neck1', 'Chest', (-0.18, -0.70, 0.88), (-0.18, -0.85, 0.93)),
        ('Neck2', 'Neck1', (-0.18, -0.85, 0.93), (-0.18, -0.98, 0.97)),
        ('Head', 'Neck2', (-0.18, -0.98, 0.97), (-0.18, -1.58, 0.74)),
        ('Ear_L', 'Head', (0.035, -1.06, 1.15), (0.085, -1.10, 1.27)),
        ('EarTip_L', 'Ear_L', (0.085, -1.10, 1.27), (0.13, -1.135, 1.385)),
        ('Ear_R', 'Head', (-0.405, -1.06, 1.15), (-0.455, -1.085, 1.27)),
        ('EarTip_R', 'Ear_R', (-0.455, -1.085, 1.27), (-0.499, -1.102, 1.384)),
        ('Scapula_L', 'Chest', (0.02, -0.48, 1.00), (0.12, -0.66, 0.55)),
        ('Humerus_L', 'Scapula_L', (0.12, -0.66, 0.55), (0.14, -0.37, 0.18)),
        ('Forearm_L', 'Humerus_L', (0.14, -0.37, 0.18), (0.14, -0.54, -0.33)),
        ('FrontPastern_L', 'Forearm_L', (0.14, -0.54, -0.33), (0.155, -0.66, -0.47)),
        ('FrontPaw_L', 'FrontPastern_L', (0.155, -0.66, -0.47), (0.155, -0.87, -0.535)),
        ('Scapula_R', 'Chest', (-0.38, -0.47, 1.00), (-0.48, -0.64, 0.55)),
        ('Humerus_R', 'Scapula_R', (-0.48, -0.64, 0.55), (-0.495, -0.345, 0.18)),
        ('Forearm_R', 'Humerus_R', (-0.495, -0.345, 0.18), (-0.495, -0.52, -0.33)),
        ('FrontPastern_R', 'Forearm_R', (-0.495, -0.52, -0.33), (-0.51, -0.645, -0.47)),
        ('FrontPaw_R', 'FrontPastern_R', (-0.51, -0.645, -0.47), (-0.512, -0.86, -0.535)),
        ('Thigh_L', 'Pelvis', (0.02, 0.86, 0.56), (0.05, 0.73, 0.14)),
        ('Shin_L', 'Thigh_L', (0.05, 0.73, 0.14), (0.02, 1.03, -0.12)),
        ('HindPastern_L', 'Shin_L', (0.02, 1.03, -0.12), (0.06, 0.95, -0.45)),
        ('HindPaw_L', 'HindPastern_L', (0.06, 0.95, -0.45), (0.065, 0.74, -0.53)),
        ('Thigh_R', 'Pelvis', (-0.37, 0.86, 0.56), (-0.39, 0.72, 0.14)),
        ('Shin_R', 'Thigh_R', (-0.39, 0.72, 0.14), (-0.37, 1.06, -0.12)),
        ('HindPastern_R', 'Shin_R', (-0.37, 1.06, -0.12), (-0.395, 0.97, -0.45)),
        ('HindPaw_R', 'HindPastern_R', (-0.395, 0.97, -0.45), (-0.40, 0.75, -0.53)),
    ],
    # The tail's centre line, root (inside the rump) to tip, traced from the body.
    'tail_curve': [
        (-0.15, 1.00, 0.66), (-0.07, 1.16, 0.55), (0.04, 1.24, 0.37), (0.13, 1.35, 0.235),
        (0.20, 1.39, 0.08), (0.29, 1.494, -0.025), (0.385, 1.601, -0.118),
        (0.496, 1.724, -0.181), (0.601, 1.817, -0.253), (0.66, 1.875, -0.28),
    ],
    # Front legs pull skin fully below `top_z0`, none above `top_z1` (the withers),
    # none within `mid_lat0` of the midline (sternum, throat), fully past `mid_lat1`;
    # the Chest keeps `chest_share` of what the Scapula holds.
    'shoulder_fade': {'top_z0': 0.80, 'top_z1': 1.0, 'mid_lat0': 0.10, 'mid_lat1': 0.24,
                      'chest_share': 0.35},
}

# ----------------------------------------------------------------------- Old Greyjaw
# public/models/creatures/greyjaw.glb (also the hunter's first Stampede beast): a
# heavier wolf with a deeper chest (the brisket hangs to 0.45 off the ground, the
# pack wolf's to 0.65), his head carried low and forward in a snarl (modeled open:
# the fangs are loose pieces inside it), a spiked mane, bigger paws with loose
# claws, and a bushy tail that drops steeply off the rump and runs back along the
# ground. Same length as the pack wolf, a third wider.
GREYJAW = {
    'midline_x': -0.15,
    'ground_z': -0.541,
    'bones': [
        ('Root', None, (-0.15, 0.15, -0.541), (-0.15, -0.25, -0.541)),
        ('Pelvis', 'Root', (-0.15, 0.82, 0.71), (-0.15, 0.42, 0.68)),
        ('Spine1', 'Pelvis', (-0.15, 0.42, 0.68), (-0.15, 0.02, 0.70)),
        ('Spine2', 'Spine1', (-0.15, 0.02, 0.70), (-0.15, -0.36, 0.74)),
        ('Chest', 'Spine2', (-0.15, -0.36, 0.74), (-0.15, -0.70, 0.78)),
        ('Neck1', 'Chest', (-0.15, -0.70, 0.78), (-0.15, -0.85, 0.79)),
        ('Neck2', 'Neck1', (-0.15, -0.85, 0.79), (-0.15, -0.98, 0.78)),
        ('Head', 'Neck2', (-0.15, -0.98, 0.78), (-0.15, -1.58, 0.52)),
        ('Ear_L', 'Head', (0.114, -1.07, 1.014), (0.165, -1.105, 1.134)),
        ('EarTip_L', 'Ear_L', (0.165, -1.105, 1.134), (0.209, -1.145, 1.249)),
        ('Ear_R', 'Head', (-0.414, -1.07, 1.014), (-0.465, -1.105, 1.134)),
        ('EarTip_R', 'Ear_R', (-0.465, -1.105, 1.134), (-0.511, -1.139, 1.255)),
        ('Scapula_L', 'Chest', (0.13, -0.31, 0.82), (0.25, -0.47, 0.42)),
        ('Humerus_L', 'Scapula_L', (0.25, -0.47, 0.42), (0.265, -0.22, 0.10)),
        ('Forearm_L', 'Humerus_L', (0.265, -0.22, 0.10), (0.27, -0.33, -0.29)),
        ('FrontPastern_L', 'Forearm_L', (0.27, -0.33, -0.29), (0.29, -0.46, -0.456)),
        ('FrontPaw_L', 'FrontPastern_L', (0.29, -0.46, -0.456), (0.30, -0.66, -0.52)),
        ('Scapula_R', 'Chest', (-0.43, -0.31, 0.82), (-0.55, -0.46, 0.42)),
        ('Humerus_R', 'Scapula_R', (-0.55, -0.46, 0.42), (-0.564, -0.215, 0.10)),
        ('Forearm_R', 'Humerus_R', (-0.564, -0.215, 0.10), (-0.57, -0.32, -0.29)),
        ('FrontPastern_R', 'Forearm_R', (-0.57, -0.32, -0.29), (-0.59, -0.441, -0.456)),
        ('FrontPaw_R', 'FrontPastern_R', (-0.59, -0.441, -0.456), (-0.60, -0.64, -0.52)),
        ('Thigh_L', 'Pelvis', (0.10, 0.825, 0.569), (0.13, 0.695, 0.149)),
        ('Shin_L', 'Thigh_L', (0.13, 0.695, 0.149), (0.11, 0.954, -0.111)),
        ('HindPastern_L', 'Shin_L', (0.11, 0.954, -0.111), (0.148, 0.852, -0.441)),
        ('HindPaw_L', 'HindPastern_L', (0.148, 0.852, -0.441), (0.155, 0.64, -0.518)),
        ('Thigh_R', 'Pelvis', (-0.40, 0.825, 0.569), (-0.426, 0.704, 0.149)),
        ('Shin_R', 'Thigh_R', (-0.426, 0.704, 0.149), (-0.405, 0.953, -0.111)),
        ('HindPastern_R', 'Shin_R', (-0.405, 0.953, -0.111), (-0.444, 0.853, -0.441)),
        ('HindPaw_R', 'HindPastern_R', (-0.444, 0.853, -0.441), (-0.455, 0.64, -0.518)),
    ],
    'tail_curve': [
        (-0.12, 1.00, 0.68), (0.03, 1.15, 0.72), (0.135, 1.205, 0.57), (0.215, 1.245, 0.41),
        (0.265, 1.29, 0.24), (0.30, 1.35, 0.10), (0.36, 1.42, 0.00), (0.44, 1.50, -0.07),
        (0.465, 1.58, -0.14), (0.47, 1.68, -0.20), (0.50, 1.78, -0.22), (0.44, 1.88, -0.19),
    ],
    'shoulder_fade': {'top_z0': 0.62, 'top_z1': 0.82, 'mid_lat0': 0.13, 'mid_lat1': 0.32,
                      'chest_share': 0.35},
    # His shoulder sits lower in the body than the pack wolf's, so the old Gallop's
    # tuck brought his forepaw onto the joint: a swinging forepaw stays this share
    # of the leg's reach off the shoulder (motion._untuck).
    'tuck_min': 0.25,
}

MODELS = {'wolf_basic': WOLF_BASIC, 'greyjaw': GREYJAW}
