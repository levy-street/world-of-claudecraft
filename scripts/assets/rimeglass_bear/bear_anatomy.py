"""The Rimeglass Bear's skeleton for the wolf rig (scripts/assets/wolf_rig/).

Same bone names and hierarchy as the wolves, so the wolf clips carry onto it. The
joints were placed from x-ray views and head close-ups of the bear's body in the
wolf rig's frame (frame.py); build_rig.py registers RIMEGLASS_BEAR as a model.
"""


# ---------------------------------------------------------------- the Rimeglass Bear
# tmp/wolf_rig/bear_body.glb: the Tripo bear turned into this frame (muzzle -Y),
# scaled 2.6x, floor at -0.553. A stocky body on short legs, the head carried low and
# forward, standing mid-stride (the right forepaw and right hind paw sit further back).
def _bear_bones():
    b = [
        ('Root', None, (0.0, 0.5, -0.553), (0.0, 0.1, -0.553)),
        ('Pelvis', 'Root', (0.0, 0.95, 0.38), (0.0, 0.60, 0.42)),
        ('Spine1', 'Pelvis', (0.0, 0.60, 0.42), (0.0, 0.25, 0.45)),
        ('Spine2', 'Spine1', (0.0, 0.25, 0.45), (0.0, -0.05, 0.45)),
        ('Chest', 'Spine2', (0.0, -0.05, 0.45), (0.0, -0.35, 0.42)),
        ('Neck1', 'Chest', (0.0, -0.35, 0.42), (0.0, -0.55, 0.35)),
        ('Neck2', 'Neck1', (0.0, -0.55, 0.35), (0.0, -0.72, 0.28)),
        ('Head', 'Neck2', (0.0, -0.72, 0.28), (0.0, -1.30, 0.0)),
        # the ears are round lobes set wide on the skull (the head sits a little to
        # the bear's left, so the left ear is further out), read off front and top
        # close-ups of the body
        ('Ear_L', 'Head', (0.37, -0.78, 0.30), (0.41, -0.78, 0.37)),
        ('EarTip_L', 'Ear_L', (0.41, -0.78, 0.37), (0.45, -0.78, 0.43)),
        ('Ear_R', 'Head', (-0.25, -0.77, 0.31), (-0.28, -0.77, 0.39)),
        ('EarTip_R', 'Ear_R', (-0.28, -0.77, 0.39), (-0.30, -0.77, 0.47)),
    ]
    legs = {
        'L': dict(fy=0.0, hy=0.0, fx=0.42, hx=0.44),
        'R': dict(fy=-0.12, hy=0.18, fx=-0.38, hx=-0.40),
    }
    for s, g in legs.items():
        sx = 1 if s == 'L' else -1
        fx, fy, hx, hy = g['fx'], g['fy'], g['hx'], g['hy']
        b += [
            (f'Scapula_{s}', 'Chest', (0.30 * sx, -0.02 + fy, 0.55), (fx - 0.02 * sx, 0.08 + fy, 0.20)),
            (f'Humerus_{s}', f'Scapula_{s}', (fx - 0.02 * sx, 0.08 + fy, 0.20), (fx, 0.24 + fy, -0.08)),
            (f'Forearm_{s}', f'Humerus_{s}', (fx, 0.24 + fy, -0.08), (fx, 0.20 + fy, -0.42)),
            (f'FrontPastern_{s}', f'Forearm_{s}', (fx, 0.20 + fy, -0.42), (fx, 0.14 + fy, -0.51)),
            (f'FrontPaw_{s}', f'FrontPastern_{s}', (fx, 0.14 + fy, -0.51), (fx, -0.06 + fy, -0.545)),
            (f'Thigh_{s}', 'Pelvis', (0.32 * sx, 0.92 + hy * 0.3, 0.32), (hx - 0.02 * sx, 0.70 + hy, -0.05)),
            (f'Shin_{s}', f'Thigh_{s}', (hx - 0.02 * sx, 0.70 + hy, -0.05), (hx, 0.95 + hy, -0.24)),
            (f'HindPastern_{s}', f'Shin_{s}', (hx, 0.95 + hy, -0.24), (hx, 0.90 + hy, -0.50)),
            (f'HindPaw_{s}', f'HindPastern_{s}', (hx, 0.90 + hy, -0.50), (hx, 0.62 + hy, -0.545)),
        ]
    return b


RIMEGLASS_BEAR = {
    'midline_x': 0.0,
    'ground_z': -0.553,
    'bones': _bear_bones(),
    # A short stub of a tail at the top of the round rump.
    'tail_curve': [(0.0, 1.12, 0.42), (0.0, 1.20, 0.43), (0.0, 1.26, 0.41), (0.0, 1.31, 0.37)],
    'shoulder_fade': {'top_z0': 0.42, 'top_z1': 0.62, 'mid_lat0': 0.10, 'mid_lat1': 0.24,
                      'chest_share': 0.35},
    'tuck_min': 0.25,
    # front leg 0.75 shoulder to ground against the wolf's 1.1
    'stride_scale': 0.65,
}
