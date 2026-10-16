"""Authored hovering, cutlass attacks, commands and an imploding death."""
import math
import anatomy as A
import motion as M
from motion import Body, keyed, write_clip
WALKREF=2.5
RUNREF=5.0

def stance(rig):
    return M.aim_weapon(Body(rig,pelvis=(0,0,.08),lean=2 if A.CAPTAIN else 15,neck=5,
                hand_r=(-.87,-.22,2.5),hand_l=(.83,-.15,2.6),fist_l=.35,
                foot_l=(.34,-.06,.09),foot_r=(-.33,.14,.09),weapon=(-.52,-.2,-.83)))

def loop(rig,duration,fast=False):
    st=stance(rig)
    def frame(t):
        u=t*math.tau/duration
        return st.but(pelvis=(.025*math.sin(u),0,.08+.06*math.sin(u)),
                      lean=st.p['lean']+(12 if fast else 0)+2*math.sin(u),
                      look=(4*math.sin(u),-3),head_roll=2*math.sin(u),
                      hand_l=(.83+.04*math.sin(u),-.15,2.6+.08*math.sin(u)))
    return frame

def gesture(rig,dur,kind):
    st=stance(rig)
    if kind=='Attack':
        load=st.but(twist=-30,hand_r=(-.9,.1,3.7),lean=-5)
        apex=st.but(twist=37,hand_r=(.35,-.8,2.8),lean=16)
    elif kind=='Anchor':
        load=st.but(lean=-12,hand_l=(.7,.1,3.9),fist_l=1)
        apex=st.but(lean=22,hand_l=(.3,-1,2.8),fist_l=.1)
    elif kind=='Boarding':
        load=st.but(lean=-8,hand_r=(-.75,.3,3.7),twist=-25)
        apex=st.but(lean=28,hand_r=(.15,-1,3.15),twist=30)
    else:
        load=st.but(hand_l=(.8,-.2,3.65),lean=-6,look=(12,-8))
        apex=st.but(hand_l=(1.3,-.3,3.5),hand_r=(-.9,-.35,3.3),fist_l=.05,spread_l=18,look=(-12,-5))
    return keyed([(0,st,'inout'),(dur*.35,load,'inout'),(dur*.63,apex,'in'),(dur*.8,apex,'inout'),(dur,st,'out')])

def make_clips(arm,only=None):
    import rig as R
    rig=R.Rig(arm)
    catalog=[('Idle',4,True),('Walk',2,True),('Run',1.2,True),('Attack',1.2,False),('Attack2',1.4,False),('Cast',2,False),('Broadside',2.4,False),('Anchor',2.0,False),('Boarding',2.0,False),('Hit',.55,False),('Death',2.8,False)]
    names=[]
    for name,dur,repeat in catalog:
        if only and name not in only: continue
        st=stance(rig)
        if repeat: fn=loop(rig,dur,name=='Run')
        elif name=='Hit':
            fn=keyed([(0,st,'inout'),(.13,st.but(lean=-16,twist=10),'in'),(dur,st,'out')])
        elif name=='Death':
            fn=keyed([
                (0,st,'inout'),
                (.35,st.but(lean=-18,hand_l=(1.2,0,3.3),jaw=18),'in'),
                (1.1,st.but(pelvis=(0,0,.25),lean=-28,hand_l=(1.1,.1,3.7),
                            hand_r=(-1.1,.1,3.7),jaw=25),'inout'),
                (2.3,st.but(pelvis=(0,0,-1.75),lean=65,hand_l=(.3,-.5,1.0),
                            hand_r=(-.3,-.5,1.0),look=(0,35),scale={'Root':.3}),'in'),
                (2.7,st.but(pelvis=(0,0,-1.8),lean=68,hand_l=(.3,-.5,.95),
                            hand_r=(-.3,-.5,.95),scale={'Root':.0001}),'inout'),
            ])
        else: fn=gesture(rig,dur,'Boarding' if name=='Attack2' else name)
        write_clip(arm,rig,name,fn,dur,loop=repeat,wind=.25)
        names.append(name)
    return names
