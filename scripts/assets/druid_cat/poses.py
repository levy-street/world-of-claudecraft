"""Authored anticipation, contact, follow-through and recovery key poses."""
import math
from motion import idle, PAWS

def blend(a,b,t):
    result={}
    for bone in a.keys() | b.keys():
        result[bone]={}
        for channel in a.get(bone,{}).keys() | b.get(bone,{}).keys():
            av=a.get(bone,{}).get(channel,(0,0,0))
            bv=b.get(bone,{}).get(channel,(0,0,0))
            result[bone][channel]=tuple(x+(y-x)*t for x,y in zip(av,bv))
    return result

def timeline(keys,t):
    if t<=keys[0][0]:return keys[0][1]
    for (start,a),(end,b) in zip(keys,keys[1:]):
        if t<=end:
            u=(t-start)/(end-start)
            return blend(a,b,u*u*(3-2*u))
    return keys[-1][1]

STAND={}
GLIDE={
    'torso':{'p':(0,0,-.025)},
    'chest':{'r':(-3,0,0)}, 'neck':{'r':(8,0,0)},
    'head':{'r':(-8,0,0)},
    'front_foot_ik.L':{'p':(0,-.075,.095),'r':(-12,0,0)},
    'front_foot_ik.R':{'p':(0,-.065,.105),'r':(-10,0,0)},
    'foot_ik.L':{'p':(0,.055,.085),'r':(13,0,0)},
    'foot_ik.R':{'p':(0,.05,.095),'r':(10,0,0)},
    'spine.003':{'r':(16,0,0)}, 'spine.002':{'r':(8,0,0)},
    'spine.001':{'r':(0,0,0)}, 'spine':{'r':(0,0,0)},
}
SIT={
    'torso':{'p':(0,.015,-.09)},
    'hips':{'p':(0,.025,-.12),'r':(-12,0,0)},
    'chest':{'p':(0,-.015,.1),'r':(-5,0,0)},
    'neck':{'r':(-3,0,0)}, 'head':{'r':(3,0,0)},
    'foot_ik.L':{'p':(.012,-.07,0),'r':(0,0,12)},
    'foot_ik.R':{'p':(-.012,-.07,0),'r':(0,0,-12)},
    'spine.003':{'r':(25,0,-10)}, 'spine.002':{'r':(0,0,-12)},
    'spine.001':{'r':(0,0,-12)}, 'spine':{'r':(0,0,-5)},
}
DEAD={
    'root':{'p':(-.28,0,.147),'r':(0,88,0)},
    'torso':{'p':(0,0,-.018)}, 'neck':{'r':(10,0,0)},
    'head':{'r':(12,0,8)}, 'jaw':{'r':(4,0,0)},
    'front_foot_ik.L':{'p':(0,-.015,.05)},
    'front_foot_ik.R':{'p':(0,.04,.10)},
    'foot_ik.L':{'p':(0,-.035,.055)},
    'foot_ik.R':{'p':(0,-.015,.095)},
    'spine.003':{'r':(0,0,10)},'spine.002':{'r':(0,0,15)},
}

def jump(t):
    coil={'torso':{'p':(0,0,-.035)},'chest':{'r':(-4,0,0)},
          'front_foot_ik.L':{'p':(0,-.02,.035)},'front_foot_ik.R':{'p':(0,-.015,.03)}}
    extend=blend(coil,GLIDE,.6)
    extend['torso']={'p':(0,0,.015)}
    return timeline([(0,STAND),(.065,coil),(.16,extend),(.36,GLIDE),(.4,GLIDE)],t)

def land(t):
    reach=blend(GLIDE,STAND,.7)
    absorb={'torso':{'p':(0,0,-.055)},'chest':{'r':(5,0,0)},
            'hips':{'r':(-3,0,0)},'head':{'r':(-4,0,0)},
            'spine.003':{'r':(-6,0,0)},'spine.002':{'r':(8,0,0)}}
    return timeline([(0,GLIDE),(.07,reach),(.14,absorb),(.3,{'torso':{'p':(0,0,.003)}}),(.4,STAND)],t)

def swipe(t,side):
    sign=1 if side=='L' else -1
    paw='front_foot_ik.'+side
    wind={'torso':{'p':(-sign*.008,.018,-.005)},
          'chest':{'p':(0,.005,.035),'r':(-8,0,sign*5)},
          paw:{'p':(sign*.025,.025,.17),'r':(16,0,sign*18)},
          'front_foot_ik.'+('R' if side=='L' else 'L'):{'p':(0,.012,.045)},
          'hips':{'p':(0,0,-.02),'r':(3,0,-sign*3)},
          'shoulder.'+side:{'r':(0,0,sign*6)},
          'head':{'r':(-5,0,-sign*10)}}
    strike={'torso':{'p':(sign*.008,-.03,-.035)},
            'chest':{'p':(0,-.01,-.02),'r':(8,0,-sign*7)},
            paw:{'p':(-sign*.065,-.18,.09),'r':(20,0,-sign*40)},
            'head':{'r':(5,0,sign*5)},'hips':{'r':(-3,0,sign*3)},
            'spine.003':{'r':(8,0,sign*12)}}
    follow=blend(strike,STAND,.45)
    follow[paw]={'p':(-sign*.025,-.08,.05),'r':(5,0,-sign*15)}
    return timeline([(0,STAND),(.15,wind),(.225,strike),(.30,follow),(.56,STAND)],t)

def bite(t):
    wind={'torso':{'p':(0,.02,-.005)},
          'chest':{'p':(0,.005,.035),'r':(-8,0,0)},
          'hips':{'p':(0,0,-.02)},
          'front_foot_ik.L':{'p':(0,.01,.055)},'front_foot_ik.R':{'p':(0,.01,.045)},
          'neck':{'r':(-8,0,0)},'head':{'r':(-10,0,0)},'jaw':{'r':(25,0,0)}}
    strike={'torso':{'p':(0,-.035,-.035)},
            'chest':{'p':(0,-.01,-.02),'r':(8,0,0)},'neck':{'r':(13,0,0)},
            'head':{'r':(14,0,0)},'jaw':{'r':(2,0,0)},'spine.003':{'r':(9,0,0)}}
    return timeline([(0,STAND),(.16,wind),(.25,strike),(.33,blend(strike,STAND,.25)),(.6,STAND)],t)

def pounce(t):
    coil={'torso':{'p':(0,.025,-.085)},'chest':{'p':(0,0,-.025),'r':(7,0,0)},'neck':{'r':(5,0,0)},'head':{'r':(-5,0,0)}}
    strike=blend(GLIDE,STAND,.15)
    strike['torso']={'p':(0,-.025,-.012)}
    strike['chest']={'p':(0,-.015,.035),'r':(-9,0,0)}
    strike['jaw']={'r':(10,0,0)}
    return timeline([(0,STAND),(.13,coil),(.24,strike),(.38,strike),(.53,{'torso':{'p':(0,0,-.045)}}),(.7,STAND)],t)

def finisher(t):
    # Two separate rakes followed by a compact heavy bite, not a renamed swipe.
    return timeline([(0,STAND),(.13,swipe(.15,'L')),(.22,swipe(.225,'L')),
                     (.34,swipe(.15,'R')),(.43,swipe(.225,'R')),
                     (.56,bite(.16)),(.65,bite(.25)),(.90,STAND)],t)

def hit(t,side):
    sign=1 if side=='L' else -1
    recoil={'torso':{'p':(-sign*.012,.015,-.025)},'chest':{'r':(-3,-sign*5,-sign*6)},
            'head':{'r':(-5,0,-sign*10)},'ear.L':{'r':(0,10,0)},'ear.R':{'r':(0,-10,0)}}
    return timeline([(0,STAND),(.085,recoil),(.18,blend(recoil,STAND,.5)),(.4,STAND)],t)

def death(t):
    buckle={'torso':{'p':(0,0,-.085)},'head':{'r':(14,0,0)},
            'front_foot_ik.L':{'p':(0,.03,.015)},'front_foot_ik.R':{'p':(0,.05,.03)}}
    return timeline([(0,STAND),(.2,buckle),(.58,blend(buckle,DEAD,.85)),(.82,DEAD),(1.2,DEAD)],t)

def rise(t):
    return timeline([(0,DEAD),(.30,blend(DEAD,SIT,.65)),(.60,SIT),(1,STAND)],t)

def sit(t):
    value=blend(SIT,SIT,0)
    value['chest']['p']=(0,-.015,.1+.0015*math.sin(math.tau*t/4))
    value['head']['r']=(3+.5*math.sin(math.tau*t/4),0,0)
    return value

def swim(t,duration,rest=False,submerged=False):
    q=math.tau*t/duration
    result={'torso':{'p':(0,0,-.015+.002*math.sin(q*2))},
            'neck':{'r':(-7 if not submerged else 0,0,0)},
            'head':{'r':(-4 if not submerged else 0,0,0)}}
    for i,name in enumerate(PAWS):
        phase=q+(0 if i in (0,3) else math.pi)
        result[name]={'p':(0,(.035 if rest else .07)*math.cos(phase),.13+.045*math.sin(phase)),
                      'r':(8*math.sin(phase),0,0)}
    for i,name in enumerate(['spine.003','spine.002','spine.001','spine']):
        result[name]={'r':(0,0,4*math.sin(q-.5*i))}
    return result

def look(t):
    values=idle(t)
    turn=timeline([(0,STAND),(.8,{'head':{'r':(-3,0,13)},'ear.L':{'r':(0,0,12)}}),
                   (1.6,{'head':{'r':(-3,0,13)}}),(2.6,{'head':{'r':(0,0,-9)},'ear.R':{'r':(0,0,-10)}}),(4,STAND)],t)
    return blend(values,turn,.85)
