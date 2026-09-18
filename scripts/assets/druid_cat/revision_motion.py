"""A planted, hip-led body turn carrying the broad lateral claw sweep."""
import previous_motion as previous
from poses import timeline, STAND


def swipe_poses(side):
    s = 1 if side == 'L' else -1
    paw = 'front_foot_ik.' + side
    poses = previous.swipe_poses(side)
    # Keep the low supporting stance, but let the shoulders turn into the rake.
    for values in poses:
        for name, channels in values.items():
            for channel, value in list(channels.items()):
                channels[channel] = tuple(v * .5 for v in value)
    coil, wind, arc, strike, follow, returning, settle = poses
    # Roll the wrist medially so the pad faces the body and claws rake inward.
    coil[paw] = {'p': (s*.060, .010, .100), 'r': (-4, -s*12, s*18)}
    wind[paw] = {'p': (s*.235, .025, .250), 'r': (-8, -s*25, s*38)}
    arc[paw] = {'p': (s*.015, -.185, .235), 'r': (6, s*55, -s*40)}
    strike[paw] = {'p': (-s*.255, -.140, .180), 'r': (6, s*60, -s*50)}
    follow[paw] = {'p': (-s*.215, -.080, .135), 'r': (10, s*50, -s*45)}
    # Lift clear of the planted opposite paw on the return to avoid crossing feet.
    returning[paw] = {'p': (s*.025, -.035, .100), 'r': (4, s*15, -s*5)}
    for values, yaw in [(coil, 3), (wind, 14), (arc, 1), (strike, -12),
                        (follow, -14), (returning, -4)]:
        r = values.setdefault('chest', {}).get('r', (0, 0, 0))
        values['chest']['r'] = (r[0], r[1], s*yaw)
        values['shoulder.'+side] = {'r': (0, 0, s*yaw*.7)}
        values['head'] = {'r': (0, 0, -s*yaw*.65)}
    # Pelvis turns through before the striking paw: by the arc pose the hips
    # have already unwound, then the chest and paw finish the same movement.
    # A small crouch gives the planted, non-stretch IK legs room to absorb it.
    body = [
        (coil, (-.006, .008, -.025), 2, 3, -.008, 2),
        (wind, (-.016, .018, -.046), 8, 6, -.018, 3),
        (arc, (-.008, -.006, -.048), -5, -6, .014, -2),
        (strike, (-.006, -.016, -.045), -8, -4, .022, -3),
        (follow, (-.004, -.012, -.040), -7, -2, .016, -2),
        (returning, (-.002, -.004, -.028), -2, 1, .003, 0),
        (settle, (0, 0, -.012), 0, 0, 0, 0),
    ]
    for values, xyz, turn, hip_turn, shift, bank in body:
        values['torso'] = {'p': (s*xyz[0], xyz[1], xyz[2]), 'r': (0, s*bank, s*turn)}
        values['hips'] = {'p': (s*shift, 0, -.004), 'r': (1, s*bank, s*hip_turn)}
        head_yaw = values.get('head', {}).get('r', (0, 0, 0))[2]
        values['head'] = {'r': (0, -s*bank*.6, head_yaw-s*turn*.8)}
        values['spine.003'] = {'r': (3, 0, -s*turn*.9)}
        values['spine.002'] = {'r': (1, 0, -s*turn*.7)}
    # Briefly rise from the hindquarters during anticipation. The spare
    # forepaw clears the ground, then lands as the inward rake follows through.
    spare = 'front_foot_ik.' + ('R' if side == 'L' else 'L')
    for values, pitch, rise, chest_rise, paw_lift in [
        (coil, -1, .002, .004, .005),
        (wind, -6, .018, .015, .040),
        (arc, -4, .010, .010, .032),
        (strike, -2, .004, .005, .014),
    ]:
        xyz = values['torso']['p']
        values['torso']['p'] = (xyz[0], xyz[1]+.012*paw_lift/.04, xyz[2]+rise)
        r = values['torso']['r']
        values['torso']['r'] = (pitch, r[1], r[2])
        xyz = values['chest'].get('p', (0, 0, 0))
        values['chest']['p'] = (xyz[0], xyz[1], xyz[2]+chest_rise)
        xyz = values['hips']['p']
        values['hips']['p'] = (xyz[0], xyz[1]+.006*paw_lift/.04, xyz[2]-.010*paw_lift/.04)
        xyz = values[paw]['p']
        values[paw]['p'] = (xyz[0], xyz[1], xyz[2]+paw_lift*.25)
        values[spare] = {'p': (0, paw_lift*.5, paw_lift), 'r': (pitch*.5, 0, 0)}
        r = values['head']['r']
        values['head']['r'] = (-pitch*.5, r[1], r[2])
    return poses


def swipe(t, side):
    coil, wind, arc, strike, follow, returning, settle = swipe_poses(side)
    return timeline([(0, STAND), (1/30, coil), (4/30, wind), (5/30, wind), (7/30, arc),
                     (9/30, strike), (11/30, follow), (14/30, returning),
                     (16/30, settle), (.6, STAND)], t)


def finisher(t):
    l, r = swipe_poses('L'), swipe_poses('R')
    return timeline([(0, STAND), (1/30, l[0]), (4/30, l[1]), (5/30, l[2]),
                     (7/30, l[3]), (9/30, l[4]), (11/30, l[5]),
                     (12/30, l[6]), (14/30, r[1]), (15/30, r[2]),
                     (17/30, r[3]), (19/30, r[4]), (22/30, r[5]),
                     (25/30, r[6]), (.9, STAND)], t)
