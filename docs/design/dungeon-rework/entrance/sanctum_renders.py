import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_renders as er  # noqa: E402


def run(out, GR, surr, colliders, mode, road):
    # A clear cold mountain day: a low pale sun from the south-west, a blue sky.
    day = {'sky': 'day', 'sky_strength': 1.15, 'sun_dir': (0.45, 0.75, 0.5), 'sun_strength': 4.2,
           'sun_color': (1.0, 0.95, 0.9)}
    views = [
        # From the road, two hundred yards out: the ice tongue on the skyline first.
        dict(day, name='approach_far_road', cam=(1.5, -125.0, ('eye', 1.9)), target=(-6.0, 20.0, 18.0), lens=26),
        # Walking up the last stretch of the road at a player's eye height.
        dict(day, name='approach_eye_road', cam=(-1.0, -42.0, ('eye', 1.9)), target=(-1.0, 4.0, 7.0), lens=28),
        # Third person in the gate plaza.
        dict(day, name='plaza_thirdperson', cam=(-5.0, -22.0, ('eye', 5.0)), target=(0.0, 1.0, 5.5), lens=28),
        # Close on the gate: the runes, the empty socket, the hanging chain.
        dict(day, name='gate_close', cam=(4.5, -10.5, ('eye', 2.2)), target=(-0.5, 1.0, 7.2), lens=26),
        # Into the mouth: the tunnel running back into the mountain.
        dict(day, name='mouth_close', cam=(-1.2, -5.0, ('eye', 1.8)), target=(0.2, 12.0, 4.0), lens=30),
        # Overviews.
        dict(day, name='overview', cam=(-34.0, -40.0, 32.0), target=(0.0, 6.0, 6.0), lens=30),
        dict(day, name='overview_west', cam=(34.0, -18.0, 26.0), target=(0.0, 6.0, 5.0), lens=30),
        dict(day, name='graveyard_east', cam=(-26.0, -8.0, ('eye', 4.0)), target=(-17.0, 6.0, 1.5), lens=30),
        # VFX reference: the cold mist pouring out, the rune glow, at dusk.
        {'name': 'vfx_dusk_mouth', 'cam': (5.0, -16.0, ('eye', 3.0)), 'target': (0.0, 2.0, 5.5), 'lens': 28,
         'sky': 'dusk', 'sky_strength': 0.55, 'sun_strength': 0.8, 'sun_color': (1.0, 0.7, 0.55),
         'sun_dir': (0.7, 0.6, 0.18), 'vfx': True, 'glare': True},
    ]
    if mode == 'quick':
        views = [v for v in views if v['name'] in ('approach_eye_road', 'gate_close', 'overview')]
    cfg = {
        'name': 'gravewyrm_sanctum', 'out': out, 'views': views,
        'map_half': 30, 'map_title': "Gravewyrm Sanctum entrance (the Smith's Seal Gate): door (0, 858)",
        'new_colliders': colliders,
        'new_paths': [],
        'extra_labels': [('seal gate = door', 0, 3.0, (1, 1, 1)), ('gate tunnel', 0, 16.0, (1, 0.5, 0.5)),
                         ('exit drop', 0, -4.8, (1, 0.7, 0.2)), ('chain heap', 5.2, -12.2, (1, 0.5, 0.5)),
                         ('Vigil cairn', -4.0, -18.6, (1, 0.5, 0.5)), ('sledge', -9.6, -12.8, (1, 0.5, 0.5)),
                         ('graves', -20.0, 12.5, (1, 0.5, 0.5)), ('graves', 14.5, -16.2, (1, 0.5, 0.5))],
        'sections': [
            {'name': 'NS_through_gate_and_tunnel', 'axis': 'z', 'at': 0.0, 'span': (-20.0, 48.0),
             'ylim': (-3.0, 28.0),
             'labels': [('S', -19.0, 25.0), ('N', 46.0, 25.0), ('gate', -0.5, -2.4), ('tunnel end', 28.0, -2.4)]},
            {'name': 'EW_through_pylons', 'axis': 'x', 'at': 0.6, 'span': (-15.0, 15.0), 'ylim': (-2.0, 16.0),
             'labels': [('E', -14.0, 15.0), ('W', 14.0, 15.0)]},
            {'name': 'EW_through_tunnel', 'axis': 'x', 'at': 12.0, 'span': (-16.0, 16.0), 'ylim': (-1.0, 21.0),
             'labels': [('E', -15.0, 20.0), ('W', 15.0, 20.0)]},
            {'name': 'NS_through_east_graves', 'axis': 'z', 'at': -19.8, 'span': (-4.0, 14.0), 'ylim': (-1.0, 6.0),
             'labels': [('S', -3.0, 5.0), ('N', 13.0, 5.0)]},
        ],
    }
    if mode in ('all', 'quick', 'beauty'):
        er.beauty(cfg, GR)
    if mode in ('all', 'maps'):
        er.placement_map(cfg, GR, surr)
        er.sections(cfg, GR)
