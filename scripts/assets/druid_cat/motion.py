"""Rigify control-space posing and contact-authored feline gait curves."""
import math
import bpy
from mathutils import Quaternion, Vector

CONTROL_NAMES = [
    'root', 'torso', 'hips', 'chest', 'neck', 'head', 'jaw', 'ear.L', 'ear.R',
    'shoulder.L', 'shoulder.R', 'spine_master.003',
    'spine.003', 'spine.002', 'spine.001', 'spine',
    'front_foot_ik.L', 'front_foot_ik.R', 'foot_ik.L', 'foot_ik.R',
]
PAWS = ['front_foot_ik.L', 'front_foot_ik.R', 'foot_ik.L', 'foot_ik.R']
LIMB_SETTINGS = ['front_thigh_parent.L', 'front_thigh_parent.R', 'thigh_parent.L', 'thigh_parent.R']
# The glTF exporter clears unkeyed pose transforms before evaluating actions.
# Key Rigify's generated heel corrections so export cannot erase the bind stance.
REST_MECHANISMS = ['MCH-front_foot_parent.L', 'MCH-front_foot_parent.R']

def reset(rig):
    for bone in rig.pose.bones:
        # Rigify's front-paw mechanism stores a non-identity heel correction.
        # Clearing MCH transforms bends the neutral legs before any animation.
        if bone.name.startswith(('DEF-', 'ORG-', 'MCH-', 'VIS_')):
            continue
        bone.location = (0, 0, 0)
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
    for name in LIMB_SETTINGS:
        rig.pose.bones[name]['IK_FK'] = 0.0
        rig.pose.bones[name]['IK_Stretch'] = 0.0

def offset(rig, name, xyz):
    bone = rig.pose.bones[name]
    bone.location = bone.bone.matrix_local.to_3x3().inverted() @ Vector(xyz)

def rotate(rig, name, xyz_degrees):
    bone = rig.pose.bones[name]
    basis = bone.bone.matrix_local.to_quaternion()
    q = Quaternion((1,0,0,0))
    for axis, angle in zip([(1,0,0),(0,1,0),(0,0,1)], xyz_degrees):
        q = Quaternion(axis, math.radians(angle)) @ q
    bone.rotation_quaternion = basis.inverted() @ q @ basis

def pose(rig, values):
    reset(rig)
    for name, channels in values.items():
        if 'p' in channels:
            offset(rig, name, channels['p'])
        if 'r' in channels:
            rotate(rig, name, channels['r'])

def idle(t, duration=4, alert=False, prowl=False):
    cycle = math.tau*t/duration
    # Standing idles preserve the bind-pose shoulders, hips and planted legs.
    # Put life in the gaze, ears and tail without continuously crouching the cat.
    values = {
        'head': {'r':(.7*math.sin(cycle+.5),0,.7*math.sin(cycle))},
    }
    if prowl or alert:
        values['head']={'r':((2 if prowl else -2)+.5*math.sin(cycle),0,.5*math.sin(cycle))}
        values['ear.L']={'r':(0,0,2*math.sin(cycle))}
        values['ear.R']={'r':(0,0,-2*math.sin(cycle))}
    for i,name in enumerate(['spine.003','spine.002','spine.001','spine']):
        # Keep the tail base still: its soft weights meet the hind-leg skin.
        values[name]={'r':(0,0,0 if i<2 else (2+i)*math.sin(cycle-i*.5))}
    return values

def paw_path(phase, stride, duty, lift, backwards=False):
    u=phase % 1
    if u < duty:
        y=-stride/2+stride*u/duty
        z=0
    else:
        s=(u-duty)/(1-duty)
        y=stride/2-stride*(3*s*s-2*s*s*s)
        z=lift*math.sin(math.pi*s)**1.3
    return (0,-y if backwards else y,z)

def gait(t, duration, stride, duty, lift, kind='walk'):
    phase=t/duration
    run=kind=='run'
    prowl=kind=='prowl'
    offsets=[.48,.54,0,.06] if run else ([0,.5,.5,0] if prowl else [0,.5,.75,.25])
    values=idle(t,duration,prowl=prowl)
    # Keep the shoulders inside the non-stretch IK reach throughout contact.
    down = -.085 if run else (-.055 if kind=='back' else -.065)
    values['torso']={'p':(0,0,down+(.009 if run else .002)*math.cos(math.tau*phase*2))}
    if prowl: values['torso']={'p':(0,0,-.07+.0015*math.cos(math.tau*phase*2))}
    values['hips']={'r':((3.5 if run else .6)*math.sin(math.tau*phase),0,(.8 if run else .5)*math.sin(math.tau*phase))}
    values['chest']={'r':((-2.5 if run else -.6)*math.sin(math.tau*phase),0,0)}
    for name,shift in zip(PAWS,offsets):
        values[name]={'p':paw_path(phase+shift,stride,duty,lift,kind=='back')}
    for i,name in enumerate(['spine.003','spine.002','spine.001','spine']):
        lift_angle=(18 if run else 8) if i==0 else 0
        values[name]={'r':(lift_angle+(4 if run else 1)*math.sin(math.tau*phase-.4*i),0,(2+i)*math.sin(math.tau*phase-.5*i))}
    return values

def bake(rig, name, frames, sample):
    action=bpy.data.actions.new(name)
    action.use_fake_user=True
    rig.animation_data_create()
    rig.animation_data.action=action
    for index in range(frames+1):
        frame=index+1
        bpy.context.scene.frame_set(frame)
        pose(rig,sample(index/30))
        for name in CONTROL_NAMES + REST_MECHANISMS:
            bone=rig.pose.bones[name]
            bone.keyframe_insert(data_path='location',frame=frame,group=name)
            bone.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=name)
            if name in REST_MECHANISMS:
                bone.keyframe_insert(data_path='scale',frame=frame,group=name)
        for name in LIMB_SETTINGS:
            rig.pose.bones[name].keyframe_insert(data_path='["IK_FK"]',frame=frame,group=name)
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:
                        key.interpolation='LINEAR'
    action['duration_seconds']=frames/30
    action['in_place']=True
    return action
