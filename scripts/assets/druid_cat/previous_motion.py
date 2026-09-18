"""Grounded feline revision: subtle trunk motion and a single supported paw rake."""
from motion import gait as original_gait
from exaggerated_motion import gait as large_gait
from poses import blend, timeline, STAND, bite
import math


def gait(t, duration, stride, duty, lift, kind='walk'):
    # Retain only 30 percent of the previous increase in body movement.
    result=blend(original_gait(t,duration,stride,duty,lift,kind),
                 large_gait(t,duration,stride,duty,lift,kind),.30)
    if kind=='run':
        # Keep contact-phase compression: mixing opposite bob phases would
        # cancel the motion and recreate a rigid torso.
        result['torso']={'p':(.001*math.sin(math.tau*t/duration),0,
                             -.082-.014*math.cos(2*math.tau*t/duration))}
    return result


def swipe_poses(side):
    s=1 if side=='L' else -1
    paw='front_foot_ik.'+side
    coil={'torso':{'p':(-s*.006,.008,-.038)},
          'chest':{'r':(-3,0,s*4)}, 'hips':{'r':(2,0,-s*2)},
          'head':{'r':(-2,0,-s*3)}}
    wind={'torso':{'p':(-s*.008,.010,-.045)},
          'hips':{'p':(0,0,-.006),'r':(2,0,-s*2)},
          'chest':{'p':(0,.010,.032),'r':(-5,-s*4,s*8)},
          'neck':{'r':(2,0,-s*2)}, 'head':{'r':(2,0,-s*5)},
          paw:{'p':(s*.090,.015,.200),'r':(-6,0,s*12)},
          'shoulder.'+side:{'r':(-2,0,s*4)},
          'spine.003':{'r':(5,0,-s*3)},
          'spine.002':{'r':(2,0,-s*4)}}
    strike={'torso':{'p':(s*.004,-.012,-.050)},
            'hips':{'r':(-2,0,s*2)},
            'chest':{'p':(0,-.005,.020),'r':(4,s*3,-s*9)},
            'neck':{'r':(-2,0,s*2)}, 'head':{'r':(1,0,s*5)},
            paw:{'p':(-s*.140,-.125,.130),'r':(14,-s*8,-s*22)},
            'shoulder.'+side:{'r':(2,0,-s*4)},
            'spine.003':{'r':(5,0,s*4)},
            'spine.002':{'r':(2,0,s*5)}}
    arc=blend(wind,strike,.5)
    arc[paw]={'p':(s*.015,-.125,.190),'r':(6,-s*3,-s*5)}
    follow=blend(strike,STAND,.3)
    follow[paw]={'p':(-s*.080,-.045,.075),'r':(12,-s*4,-s*15)}
    follow['chest']={'p':(0,-.006,.006),'r':(4,s*2,-s*10)}
    returning=blend(follow,STAND,.5)
    returning[paw]={'p':(s*.020,.020,.065),'r':(0,0,s*3)}
    settle={'torso':{'p':(0,0,-.024)},'chest':{'r':(2,0,0)}}
    # Other forepaw and both hind paws are deliberately absent: reset/keying
    # leaves them planted at their original positions through the whole rake.
    return coil,wind,arc,strike,follow,returning,settle


def swipe(t,side):
    coil,wind,arc,strike,follow,returning,settle=swipe_poses(side)
    return timeline([(0,STAND),(2/30,coil),(5/30,wind),(6/30,arc),
                     (7/30,strike),(9/30,follow),(11/30,returning),
                     (13/30,settle),(.6,STAND)],t)


def finisher(t):
    l,r=swipe_poses('L'),swipe_poses('R')
    return timeline([(0,STAND),(2/30,l[0]),(4/30,l[1]),(5/30,l[2]),
                     (6/30,l[3]),(8/30,l[4]),(10/30,l[6]),
                     (12/30,r[1]),(13/30,r[2]),(14/30,r[3]),
                     (16/30,r[4]),(18/30,r[6]),(20/30,bite(.16)),
                     (22/30,bite(.25)),(.9,STAND)],t)
