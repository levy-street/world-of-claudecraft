"""Full-body feline motion, authored in metres in the rig's -Y forward frame."""
import math
from motion import gait as base_gait
from poses import blend, timeline, STAND, bite as base_bite


def gait(t, duration, stride, duty, lift, kind='walk'):
    v = base_gait(t, duration, stride, duty, lift, kind)
    q = math.tau * t / duration
    if kind == 'run':
        # A collected and an extended suspension, with yielding shoulders at
        # fore contact. The independently rooted IK feet retain their contacts.
        v['torso'] = {'p': (.003*math.sin(q), 0, -.077-.030*math.cos(2*q))}
        v['hips'] = {'p': (0, .010*math.sin(q), .005*math.sin(q+.35)),
                     'r': (6*math.sin(q), 1.5*math.sin(q), 1.6*math.sin(q))}
        v['chest'] = {'p': (0, -.015*math.sin(q), -.016*math.sin(q+.35)),
                      'r': (-8*math.sin(q), -1.5*math.sin(q), -1.2*math.sin(q))}
        v['neck'] = {'r': (5.5*math.sin(q), 0, 0)}
        v['head'] = {'r': (2*math.sin(q-.35), 0, -1.2*math.sin(q))}
        for side, shift in [('L', .48), ('R', .54)]:
            v['shoulder.'+side] = {'p': (0, .008*math.sin(q+math.tau*shift), 0),
                                   'r': (3*math.sin(q+math.tau*shift), 0, 0)}
        for i, name in enumerate(['spine.003', 'spine.002', 'spine.001', 'spine']):
            v[name] = {'r': ((16 if i == 0 else 0)+6*math.sin(q-.55*i-.4),
                             0, (3+i)*math.sin(q-.6*i))}
    else:
        # The walk shifts weight shoulder-to-shoulder; stealth keeps a lower,
        # quieter vertical envelope but retains a flowing trunk and pelvis.
        stealth = kind == 'prowl'
        z = -.074 if stealth else (-.062 if kind == 'back' else -.068)
        bob = .006 if stealth else .009
        v['torso'] = {'p': (.007*math.sin(q), 0, z-bob*math.cos(2*q))}
        v['hips'] = {'p': (0, 0, .004*math.sin(q)),
                     'r': (2.2*math.sin(q), 1.2*math.sin(q), 2.5*math.sin(q))}
        v['chest'] = {'p': (0, 0, -.004*math.sin(q)),
                      'r': (-2*math.sin(q), -1.5*math.sin(q), -1.8*math.sin(q))}
        v['neck'] = {'r': (1.5*math.sin(q), 0, 0)}
        v['head'] = {'r': ((2 if stealth else 0)+.6*math.sin(q), 0, 1.2*math.sin(q))}
    return v


def swipe_poses(side):
    s = 1 if side == 'L' else -1
    paw = 'front_foot_ik.'+side
    other = 'front_foot_ik.'+('R' if side == 'L' else 'L')
    coil = {
        'torso': {'p': (-s*.008, .015, -.065)},
        'hips': {'p': (0, 0, -.018), 'r': (4, 0, -s*4)},
        'chest': {'p': (0, .01, .008), 'r': (-5, 0, s*6)},
        'head': {'r': (-4, 0, -s*5)},
    }
    wind = {
        'torso': {'p': (-s*.008, .045, -.012)},
        'hips': {'p': (0, -.025, -.068), 'r': (3, 0, -s*5)},
        'chest': {'p': (0, .050, .135), 'r': (-18, s*6, s*18)},
        'neck': {'r': (8, 0, -s*5)}, 'head': {'r': (7, 0, -s*16)},
        paw: {'p': (s*.180, .025, .365), 'r': (-12, s*20, s*30)},
        other: {'p': (-s*.015, .045, .205), 'r': (-22, 0, -s*8)},
        'shoulder.'+side: {'r': (-6, 0, s*9)},
        'jaw': {'r': (6, 0, 0)},
        'spine.003': {'r': (18, 0, -s*7)},
        'spine.002': {'r': (10, 0, -s*10)},
        'spine.001': {'r': (4, 0, -s*12)},
    }
    contact = {
        'torso': {'p': (s*.010, -.005, -.025)},
        'hips': {'p': (0, 0, -.028), 'r': (-3, 0, s*5)},
        'chest': {'p': (0, .005, .060), 'r': (6, -s*6, -s*18)},
        'neck': {'r': (-3, 0, s*7)}, 'head': {'r': (2, 0, s*12)},
        paw: {'p': (-s*.245, -.100, .255), 'r': (20, -s*28, -s*52)},
        other: {'p': (-s*.02, .025, .175), 'r': (-14, 0, -s*8)},
        'shoulder.'+side: {'r': (6, 0, -s*12)},
        'jaw': {'r': (10, 0, 0)},
        'spine.003': {'r': (12, 0, s*13)},
        'spine.002': {'r': (4, 0, s*14)},
        'spine.001': {'r': (0, 0, s*8)},
    }
    arc = blend(wind, contact, .46)
    arc[paw] = {'p': (s*.035, -.160, .365), 'r': (6, -s*5, -s*8)}
    follow = blend(contact, STAND, .25)
    follow['chest'] = {'p': (0, -.015, .018), 'r': (10, -s*4, -s*22)}
    follow[paw] = {'p': (-s*.185, -.025, .135), 'r': (26, -s*15, -s*42)}
    follow[other] = {'p': (-s*.085, 0, .045), 'r': (0, 0, 0)}
    settle = {'torso': {'p': (0, -.006, -.048)},
              'chest': {'r': (3, 0, -s*3)},
              paw: {'p': (0, 0, .01)},
              'spine.003': {'r': (8, 0, s*5)}}
    return coil, wind, arc, contact, follow, settle


def swipe(t, side):
    coil, wind, arc, contact, follow, settle = swipe_poses(side)
    s=1 if side=='L' else -1
    returning=blend(follow,settle,.5)
    returning['front_foot_ik.'+side]={'p':(s*.045,.045,.120),'r':(5,0,s*8)}
    # Every storytelling pose is an exact 30 fps key, including the broad
    # forward arc between the outside wind-up and opposite-side contact.
    return timeline([(0, STAND), (2/30, coil), (5/30, wind),
                     (6/30, arc), (7/30, contact), (9/30, follow), (11/30,returning),
                     (13/30, settle), (18/30, STAND)], t)


def bite(t):
    v = base_bite(t)
    strength = timeline([(0, {}), (5/30, {'x': {'p': (1, 0, 0)}}),
                         (8/30, {'x': {'p': (0, 0, 0)}}), (.6, {})], t)
    w = strength.get('x', {}).get('p', (0, 0, 0))[0]
    v.setdefault('chest', {}).setdefault('p', (0, 0, 0))
    p = v['chest']['p']
    v['chest']['p'] = (p[0], p[1]+.025*w, p[2]+.055*w)
    for name in ['front_foot_ik.L', 'front_foot_ik.R']:
        p = v.get(name, {}).get('p', (0, 0, 0))
        v[name] = {'p': (p[0], p[1], p[2]+.055*w)}
    return v


def finisher(t):
    l, r = swipe_poses('L'), swipe_poses('R')
    exchange=blend(l[4],r[1],.65)
    exchange['front_foot_ik.L']={'p':(.035,.05,.180),'r':(-8,0,8)}
    exchange['front_foot_ik.R']={'p':(-.170,.015,.320),'r':(-10,-16,-24)}
    # Rear-supported alternating rakes, retaining the existing heavy bite.
    return timeline([(0, STAND), (2/30, l[0]), (4/30, l[1]),
                     (5/30, l[2]), (6/30, l[3]), (8/30, l[4]), (10/30,exchange),
                     (11/30, r[1]), (12/30, r[2]), (13/30, r[3]),
                     (15/30, r[4]), (18/30, bite(5/30)),
                     (20/30, bite(.25)), (23/30, l[5]), (.9, STAND)], t)
