"""Author in-place encounter clips on the P2/Tripo bind rigs in Blender.

blender --background --factory-startup --python-exit-code 1 --python scripts/assets/animate_roach_king.py -- <name>
Raw rig inputs and editable .blend masters live in tmp/asset_pipeline/roach_<name>_p2.
The final GLB is optimized and KTX2-compressed with scripts/assets/specs/roach_king.json afterward.
"""
import bpy
import json
import math
import os
import re
import sys
from mathutils import Quaternion, Vector

NAME = sys.argv[sys.argv.index('--') + 1]
JOB = os.path.abspath(f'tmp/asset_pipeline/roach_{NAME}_p2')
HUMAN = NAME == 'asmon_hermit'
FPS = 30
REPAIRED_WEIGHTS = 0
CLIPS = {'Idle': 3.2, 'Walk': 1.4, 'Run': .8, 'Attack': 1.25,
         'Hit': .55, 'Death': 2.4, 'Cast': 2.4, 'Jump': 1.1}
if NAME in ('asmon_hermit', 'roach_king'):
    CLIPS.update({'Transform': 2.8, 'Decree': 2.8, 'Spit': 1.8, 'Stomp': 1.7})

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(JOB, 'rigged.glb'))
ARM = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
MESHES = [o for o in bpy.context.scene.objects if o.type == 'MESH'
          and any(m.type == 'ARMATURE' for m in o.modifiers)]
if not MESHES:
    raise RuntimeError('No skinned mesh in Tripo rig')
for obj in [ARM] + MESHES:
    obj.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
if NAME == 'garbage_beetle':
    # This rig's middle-right leg was assigned to the root. Repair its weights
    # locally instead of shipping a fifth-legged walk or paying to reroll the mesh.
    bpy.context.view_layer.objects.active=ARM
    ARM.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    parent=ARM.data.edit_bones['tripo::Root']
    points=[(-.18,.06,-.10),(-.29,.055,-.18),(-.40,.07,-.32),(-.5,.08,-.40)]
    for i in range(3):
        b=ARM.data.edit_bones.new(f'Beetle_MiddleRight_{i}')
        b.head=points[i]
        b.tail=points[i+1]
        b.parent=parent
        parent=b
    bpy.ops.object.mode_set(mode='OBJECT')
    for mesh in MESHES:
        to_arm=ARM.matrix_world.inverted() @ mesh.matrix_world
        groups=[mesh.vertex_groups.new(name=f'Beetle_MiddleRight_{i}') for i in range(3)]
        for v in mesh.data.vertices:
            p=to_arm @ v.co
            if p.x<-.22 and -.05<p.y<.17 and p.z<-.08:
                for index in [g.group for g in v.groups]:
                    mesh.vertex_groups[index].remove([v.index])
                groups[0 if p.x>-.29 else 1 if p.x>-.40 else 2].add([v.index],1,'REPLACE')
BONES = ARM.pose.bones
AXES = {}
for b in BONES:
    b.rotation_mode = 'QUATERNION'
    inv = b.bone.matrix_local.to_3x3().inverted()
    AXES[b.name] = [inv @ Vector(a) for a in [(1, 0, 0), (0, 1, 0), (0, 0, 1)]]


def rotate(name, x=0, y=0, z=0):
    if name not in BONES:
        return
    axes = AXES[name]
    BONES[name].rotation_quaternion = (Quaternion(axes[2], z)
        @ Quaternion(axes[1], y) @ Quaternion(axes[0], x))


def translate(name, xyz):
    b = BONES[name]
    b.location = b.bone.matrix_local.to_3x3().inverted() @ Vector(xyz)


def smooth(a, b, t):
    u = max(0, min(1, (t-a)/(b-a)))
    return u*u*u*(u*(u*6-15)+10)


def envelope(t, peak=.35):
    return smooth(0, peak, t) * (1-smooth(peak, 1, t))


def material(name, color, metallic=0, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = .72
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
    return m


def staff():
    """A crooked broom scepter rigidly weighted to the actual right-hand joint."""
    wood = material('Gutterstaff_Bark', (.12, .065, .022))
    brass = material('Gutterstaff_Bindings', (.38, .22, .055), .65)
    violet = material('Gutterstaff_Amethyst', (.38, .04, .7), .15, 1.4)
    hand = BONES['R_Hand'].head.copy()
    x, y = hand.x + .018, hand.y
    pieces = []

    def rod(a, b, radius, mat, vertices=8):
        a, b = Vector(a), Vector(b)
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
            radius2=radius*.83, depth=(b-a).length, location=(a+b)/2)
        o = bpy.context.object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = (b-a).to_track_quat('Z', 'Y')
        o.data.materials.append(mat)
        pieces.append(o)

    for i in range(9):
        a = (x+.008*math.sin(i*1.8), y+.006*math.cos(i*1.4), .08+i*.098)
        b = (x+.008*math.sin((i+1)*1.8), y+.006*math.cos((i+1)*1.4), .08+(i+1)*.098)
        rod(a, b, .013, wood)
    for z in (.14, .53, .86, .89, .92):
        bpy.ops.mesh.primitive_torus_add(major_radius=.012, minor_radius=.003,
            major_segments=10, minor_segments=4, location=(x,y,z))
        o=bpy.context.object
        o.data.materials.append(brass)
        pieces.append(o)
    for i in range(9):
        a = i*math.tau/9
        rod((x+.012*math.cos(a), y+.012*math.sin(a), .15),
            (x+.045*math.cos(a), y+.045*math.sin(a), .025), .005, wood, 5)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=(x,y,.985))
    o=bpy.context.object
    o.scale=(.035,.035,.055)
    o.data.materials.append(violet)
    pieces.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in pieces:
        o.select_set(True)
    bpy.context.view_layer.objects.active=pieces[0]
    bpy.ops.object.join()
    s=bpy.context.object
    s.name='Gutterstaff'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Geometry was built in armature space. Binding preserves the shaft at the palm.
    s.matrix_world=ARM.matrix_world.copy()
    vg=s.vertex_groups.new(name='R_Hand')
    vg.add(list(range(len(s.data.vertices))),1,'REPLACE')
    mod=s.modifiers.new('Gutterstaff_skin','ARMATURE')
    mod.object=ARM
    s.parent=ARM
    MESHES.append(s)


if HUMAN:
    staff()
    FORWARD=Vector((1,0,0))
    BODY='Hip'
    HEAD='Head'
    LEGS=[]
else:
    BODY='tripo::0_Left_Limb_0'
    HEAD='tripo::Spine_0'
    named_legs=[b for b in BONES if re.fullmatch(r'tripo::[012]_(Left|Right)_Limb_0',b.name)]
    if len(named_legs)==6:
        BODY='tripo::Spine_0'
        HEAD='tripo::Head_1'
    if NAME=='garbage_beetle':
        BODY='tripo::Root'
        HEAD='tripo::Spine_0'
        named_legs=[BONES[n] for n in ['tripo::2_Right_Limb_0','bone_5',
            'tripo::1_Right_Limb_0','tripo::0_Left_Limb_0','bone_16','Beetle_MiddleRight_0']]
    if BODY not in BONES or HEAD not in BONES:
        raise RuntimeError('Unexpected hexapod topology; inspect this rig before authoring')
    FORWARD=(BONES[HEAD].head-BONES[BODY].head)
    FORWARD.z=0
    FORWARD.normalize()
    SIDE=Vector((-FORWARD.y,FORWARD.x,0))
    # Tripo labels several legs bone_N. Resolve six articulated branches by their
    # ancestry and low foot endpoints, not by falsely interpreting those labels.
    LEGS=[]
    for b in (named_legs if len(named_legs)==6 else BONES[BODY].children):
        if b.name==HEAD:
            continue
        chain=[b]
        while chain[-1].children:
            child=next((c for c in chain[-1].children if '_Limb_' in c.name),None)
            if child is None and len(chain[-1].children)==1:
                child=chain[-1].children[0]
            if child is None:
                break
            chain.append(child)
        if len(named_legs)==6 or (len(chain)>=3 and chain[-1].tail.z < BONES[BODY].head.z-.1):
            LEGS.append(chain)
    if len(LEGS)!=6:
        raise RuntimeError(f'Expected six leg chains, got {len(LEGS)}')
    LEGS.sort(key=lambda chain: (round(chain[0].head.dot(SIDE),2)>0,
                               chain[0].head.dot(FORWARD)))
    LEG_NAMES={b.name for chain in LEGS for b in [chain[0]]+list(chain[0].children_recursive)}
    DETAIL=[b for b in BONES[HEAD].children_recursive if b.name not in LEG_NAMES]


    if NAME == 'roach_king':
        # The donor assigned up to half of a front paw to the opposite paw.
        # Reassign distal feet geometrically, remove distant antenna/leg
        # influences, and retain each branch's original joint blend. The root
        # also held shell vertices that must follow the thorax in live poses.
        ownership={b.name:i for i,c in enumerate(LEGS) for b in c}
        repaired=0
        for mesh in MESHES:
            for v in mesh.data.vertices:
                weights={mesh.vertex_groups[g.group].name:g.weight for g in v.groups}
                totals=[sum(w for n,w in weights.items() if ownership.get(n)==i)
                        for i in range(len(LEGS))]
                point=ARM.matrix_world.inverted() @ mesh.matrix_world @ v.co
                def distance(bone):
                    a,b=bone.bone.head_local,bone.bone.tail_local
                    d=b-a
                    u=max(0,min(1,(point-a).dot(d)/d.length_squared))
                    return (point-a-u*d).length
                owner=min(range(len(LEGS)),
                          key=lambda i:min(distance(b) for b in LEGS[i]))
                distal=point.z<-.12 and min(distance(b) for b in LEGS[owner])<.10
                off_leg=point.z>-.12 and min(distance(b) for b in LEGS[owner])>.065
                if distal:
                    kept={n:w for n,w in weights.items() if ownership.get(n)==owner}
                    if not kept:
                        nearest=min(LEGS[owner],key=distance)
                        kept={nearest.name:1}
                elif off_leg:
                    kept={n:w for n,w in weights.items() if n not in ownership}
                else:
                    kept={n:w for n,w in weights.items()
                          if n not in ownership or ownership[n]==owner}
                if not kept:
                    kept={BODY:1}
                if 'tripo::Root' in kept:
                    kept[BODY]=kept.get(BODY,0)+kept.pop('tripo::Root')
                if kept==weights:
                    continue
                total=sum(kept.values())
                for index in [g.group for g in v.groups]:
                    mesh.vertex_groups[index].remove([v.index])
                for n,w in kept.items():
                    mesh.vertex_groups[n].add([v.index],w/total,'REPLACE')
                repaired+=1
        REPAIRED_WEIGHTS=repaired
        print('REPAIRED_CROSS_LEG_WEIGHTS',repaired)


def human_pose(clip,t):
    wave=math.sin(math.tau*t)
    if clip not in ('Idle','Walk','Run'):
        wave*=envelope(t,.4) if clip not in ('Death','Transform') else 0
    rotate('Spine01',y=.07+.014*wave)
    rotate('Spine02',y=.075+.018*wave)
    rotate('Head',y=-.09+.018*wave,z=.016*wave)
    rotate('R_Upperarm',y=-.25)
    rotate('R_Forearm',y=-.34)
    rotate('L_Upperarm',y=-.06,x=.04)
    rotate('L_Forearm',y=-.11)
    if clip in ('Walk','Run'):
        amp=.24 if clip=='Walk' else .43
        translate('Hip',(0,.003*wave,.006*(1-math.cos(math.tau*t*2))))
        rotate('Hip',x=.018*wave,z=.025*wave)
        for side,phase in [('L',0),('R',math.pi)]:
            step=math.sin(math.tau*t+phase)
            rotate(side+'_Thigh',y=amp*step)
            rotate(side+'_Calf',y=-.4*max(0,-step)**2)
            rotate(side+'_Foot',y=.16*max(0,-step)**2)
        rotate('L_Upperarm',y=-.08-amp*.55*wave)
        rotate('R_Upperarm',y=-.25+amp*.14*wave)
        rotate('Spine02',y=.09,z=.035*wave)
    elif clip in ('Attack','Stomp'):
        wind=smooth(0,.35,t)
        strike=smooth(.36,.52,t)
        recover=1-smooth(.60,1,t)
        drive=(wind-strike*1.55)*recover
        rotate('R_Upperarm',y=-.25-1.2*drive)
        rotate('R_Forearm',y=-.34-.65*wind*recover)
        rotate('Spine02',y=.075-.25*drive,z=.14*drive)
        rotate('L_Upperarm',y=-.06+.25*drive,x=.04+.12*wind*recover)
        translate('Hip',(0,0,-.035*strike*recover))
    elif clip in ('Cast','Decree','Spit'):
        power=envelope(t,.28)
        rotate('R_Upperarm',y=-.25-.8*power)
        rotate('R_Forearm',y=-.34-.6*power)
        rotate('L_Upperarm',y=-.06-.9*power,x=.04+.2*power)
        rotate('L_Forearm',y=-.11-.7*power)
        rotate('Head',y=-.09-.16*power,z=.06*wave*power)
        rotate('Spine02',y=.075-.08*power)
    elif clip=='Hit':
        pulse=envelope(t,.14)
        rotate('Spine02',y=.075-.23*pulse,z=.12*pulse)
        rotate('Head',y=-.09-.35*pulse)
    elif clip=='Death':
        fall=smooth(.12,.7,t)
        translate('Hip',(0,0,-.39*fall))
        rotate('Hip',y=-math.pi/2*fall,x=.05*fall)
        rotate('Spine01',y=.07*(1-fall))
        rotate('Spine02',y=.075*(1-fall))
        for side in ('L','R'):
            rotate(side+'_Thigh',y=-.12*fall)
            rotate(side+'_Calf',y=-.3*fall)
            rotate(side+'_Upperarm',y=-.16*fall)
            rotate(side+'_Forearm',y=-.22*fall)
        rotate('Head',y=-.09*(1-fall))
    elif clip=='Transform':
        curl=smooth(.05,.7,t)
        translate('Hip',(0,0,-.19*curl))
        rotate('Spine01',y=.07+.45*curl)
        rotate('Spine02',y=.075+.5*curl,z=.018*math.sin(t*math.tau*3)*envelope(t,.55))
        rotate('Head',y=-.09+.44*curl)
        for side in ('L','R'):
            rotate(side+'_Upperarm',y=(-.25 if side=='R' else -.06)-.85*curl,
                   x=.04*(1-curl) if side=='L' else 0)
            rotate(side+'_Forearm',y=(-.34 if side=='R' else -.11)-.5*curl)
            rotate(side+'_Thigh',y=.55*curl)
            rotate(side+'_Calf',y=-1.0*curl)
    elif clip=='Jump':
        translate('Hip',(0,0,.1*math.sin(math.pi*t)))
        for side in ('L','R'):
            rotate(side+'_Thigh',y=.3*math.sin(math.pi*t))
            rotate(side+'_Calf',y=-.6*math.sin(math.pi*t))
    # Counter-rotate the wrist against shoulder/elbow/spine motion. The staff
    # remains upright in the palm except for the deliberately authored strike.
    bpy.context.view_layer.update()
    hand=BONES['R_Hand']
    pre=(hand.parent.matrix.to_3x3()
         @ hand.parent.bone.matrix_local.to_3x3().inverted()
         @ hand.bone.matrix_local.to_3x3())
    tilt=.08*wave
    if clip in ('Attack','Stomp'):
        tilt=-.45*envelope(t,.35)+.75*envelope(t,.57)
    elif clip=='Death':
        tilt=math.pi/2*smooth(.12,.7,t)
    elif clip=='Transform':
        tilt=.6*smooth(.05,.7,t)
    desired=Quaternion(Vector((0,1,0)),tilt) @ hand.bone.matrix_local.to_quaternion()
    hand.rotation_quaternion=pre.inverted().to_quaternion() @ desired


def insect_pose(clip,t):
    pulse=math.sin(math.tau*t)
    rotate(BODY,x=.012*pulse,y=.009*pulse)
    rotate(HEAD,x=.018*pulse,z=.018*math.sin(t*math.tau*2))
    for i,b in enumerate(DETAIL):
        # Small phased motion through mandibles and antenna segments, no rigid
        # whole-head wobble standing in for articulated feelers.
        rotate(b.name,z=.018*math.sin(t*math.tau*2-i*.48),
               y=.01*math.sin(t*math.tau*3-i*.3))
    for i,chain in enumerate(LEGS):
        sign=1 if chain[0].head.dot(SIDE)>0 else -1
        phase=math.pi*((i%3)%2+(sign<0))
        cycle=math.sin(t*math.tau+phase)
        lift=max(0,cycle)**2
        amount=.24 if clip=='Walk' else .38 if clip=='Run' else .009
        rotate(chain[0].name,z=sign*amount*cycle,
               x=FORWARD.x*sign*amount*.7*lift,y=FORWARD.y*sign*amount*.7*lift)
        rotate(chain[1].name,x=-FORWARD.x*sign*amount*.75*lift,
               y=-FORWARD.y*sign*amount*.75*lift)
        for j,b in enumerate(chain[2:]):
            rotate(b.name,z=.009*math.sin(t*math.tau+phase-j*.35))
    if clip in ('Attack','Stomp','Spit'):
        wind=smooth(0,.36,t)
        impact=smooth(.36,.50,t)
        recovery=1-smooth(.55,1,t)
        drive=(wind-impact*1.65)*recovery
        rotate(BODY,x=SIDE.x*.22*drive,y=SIDE.y*.22*drive)
        rotate(HEAD,x=SIDE.x*.10*drive,y=SIDE.y*.10*drive)
        translate(BODY,(0,0,.024*wind*recovery))
    elif clip in ('Cast','Decree','Transform'):
        power=envelope(t,.33) if clip!='Transform' else 1-smooth(.45,1,t)
        rotate(BODY,x=-SIDE.x*.18*power,y=-SIDE.y*.18*power)
        rotate(HEAD,x=-SIDE.x*.08*power,y=-SIDE.y*.08*power)
        translate(BODY,(0,0,.012*power))
        for i,chain in enumerate(LEGS):
            if chain[0].head.dot(FORWARD)>BONES[BODY].head.dot(FORWARD):
                sign=1 if chain[0].head.dot(SIDE)>0 else -1
                rotate(chain[0].name,x=FORWARD.x*sign*.32*power,
                       y=FORWARD.y*sign*.32*power)
    elif clip=='Hit':
        p=envelope(t,.15)
        rotate(BODY,x=FORWARD.x*.13*p,y=FORWARD.y*.13*p)
    elif clip=='Death':
        if NAME != 'roach_king':
            p=smooth(.08,.72,t)
            # Roll fully onto the shell. Use a single axis-angle quaternion:
            # composing X/Y Euler rotations would tilt the long abdomen upright.
            roll_axis=BONES[BODY].bone.matrix_local.to_3x3().inverted() @ FORWARD
            BONES[BODY].rotation_quaternion=Quaternion(roll_axis,math.pi*p)
            translate(BODY,(0,0,-.12*p))
            BONES[BODY].scale=(1,1,1-.15*p)
            for i,chain in enumerate(LEGS):
                sign=1 if chain[0].head.dot(SIDE)>0 else -1
                rotate(chain[0].name,x=-FORWARD.x*sign*.65*p,
                       y=-FORWARD.y*sign*.65*p,z=.03*math.sin(t*40+i)*(1-p))
        else:
            p=smooth(.08,.76,t)
            # Roll the complete rig, including vertices weighted to the root.
            # Rolling only the thorax leaves the shell and underside suspended.
            top=next(b for b in BONES if b.parent is None)
            roll_axis=top.bone.matrix_local.to_3x3().inverted() @ FORWARD
            rotate(BODY)
            rotate(HEAD)
            # Raise the crowned head as the abdomen lands. A pure half-roll
            # rests on the taller crown and suspends the shell above the floor.
            pitch_axis=top.bone.matrix_local.to_3x3().inverted() @ SIDE
            top.rotation_quaternion=(Quaternion(pitch_axis,-.28*p)
                                     @ Quaternion(roll_axis,math.pi*p))
            for b in DETAIL:
                rotate(b.name)
            for i,chain in enumerate(LEGS):
                sign=1 if chain[0].head.dot(SIDE)>0 else -1
                curl=smooth(.12,.65,t)
                rotate(chain[0].name,x=-FORWARD.x*sign*.38*curl,
                       y=-FORWARD.y*sign*.38*curl,
                       z=.015*math.sin(t*math.tau*3+i)*envelope(t,.32)*(1-p))
                rotate(chain[1].name,x=FORWARD.x*sign*.55*curl,
                       y=FORWARD.y*sign*.55*curl)
                for b in chain[2:]:
                    rotate(b.name)
    elif clip=='Jump':
        translate(BODY,(0,0,.1*math.sin(math.pi*t)))


def posed_floor():
    bpy.context.view_layer.update()
    depsgraph=bpy.context.evaluated_depsgraph_get()
    return min((o.matrix_world @ v.co).z
               for source in MESHES for o in [source.evaluated_get(depsgraph)]
               for v in o.data.vertices)


def ground_death_pose():
    # Runtime normalization measures the deformed Idle floor and applies that
    # same offset to every clip. Match that baseline, not absolute authoring zero.
    lowest=posed_floor()
    top=next(b for b in BONES if b.parent is None)
    delta=ARM.matrix_world.to_3x3().inverted() @ Vector((0,0,IDLE_FLOOR-lowest))
    top.location += top.bone.matrix_local.to_3x3().inverted() @ delta


# Transform one common parent after authoring. +X-forward Tripo bipeds and
# arbitrarily oriented hexapods both become +Z-forward glTF, seated on y=0.
root=bpy.data.objects.new('RoachKing_AssetRoot',None)
bpy.context.collection.objects.link(root)
for o in [ARM]+MESHES:
    if o.parent is None:
        o.parent=root
root.rotation_euler.z=-math.pi/2-math.atan2(FORWARD.y,FORWARD.x)
bpy.context.view_layer.update()
coords=[o.matrix_world@Vector(c) for o in MESHES for c in o.bound_box]
root.location.z=-min(v.z for v in coords)
root['generation_model']='P2-20260801'
root['animation_author']='Blender Roach King encounter library'
root['source_asset']=NAME

# Include frame zero in authoring. The old export duplicated frame one there,
# creating a stationary frame at every locomotion loop seam. Keep the shipped
# clip durations (one extra sample) and runtime's exact Idle normalization time.
idle_sample=.5*FPS/(round(CLIPS['Idle']*FPS)+1)
if HUMAN:
    human_pose('Idle',idle_sample)
else:
    insect_pose('Idle',idle_sample)
IDLE_FLOOR=posed_floor()
print('NORMALIZED_IDLE_FLOOR',IDLE_FLOOR)

scene=bpy.context.scene
scene.render.fps=FPS
ARM.animation_data_create()
for clip,seconds in CLIPS.items():
    action=bpy.data.actions.new(clip)
    ARM.animation_data.action=action
    frames=round(seconds*FPS)+1
    for f in range(frames+1):
        t=f/frames
        scene.frame_set(f)
        for b in BONES:
            b.rotation_quaternion=Quaternion()
            b.location=(0,0,0)
            b.scale=(1,1,1)
        if HUMAN:
            human_pose(clip,t)
        else:
            insect_pose(clip,t)
        if clip=='Death':
            ground_death_pose()
        for b in BONES:
            b.keyframe_insert('rotation_quaternion',frame=f,group=b.name)
            b.keyframe_insert('location',frame=f,group=b.name)
            b.keyframe_insert('scale',frame=f,group=b.name)
    track=ARM.animation_data.nla_tracks.new()
    track.name=clip
    strip=track.strips.new(clip,0,action)
    strip.action_frame_start=0
    strip.action_frame_end=frames
    track.mute=True
    ARM.animation_data.action=None
    print('AUTHORED',clip,seconds,'seconds',len(BONES),'bones')
for b in BONES:
    b.rotation_quaternion=Quaternion()
    b.location=(0,0,0)
    b.scale=(1,1,1)
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
for o in [root,ARM]+MESHES:
    o.select_set(True)
bpy.context.view_layer.objects.active=ARM
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(JOB,NAME+'.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(JOB,NAME+'_blender.glb'),
    export_format='GLB',use_selection=True,export_animations=True,
    export_animation_mode='NLA_TRACKS',export_force_sampling=True,
    export_frame_range=False,export_yup=True,export_extras=True,
    export_skins=True,export_influence_nb=4,export_lights=False,export_cameras=False)
with open(os.path.join(JOB,'blender_authoring.json'),'w') as f:
    json.dump({'blender':bpy.app.version_string,'asset':NAME,'clips':CLIPS,
               'revision':2,'repairedWeightVertices':REPAIRED_WEIGHTS,
               'bones':len(BONES),'legChains':[[b.name for b in c] for c in LEGS],
               'normalizedIdleSampleSeconds':.5,'idleFloor':IDLE_FLOOR},f,indent=2)
