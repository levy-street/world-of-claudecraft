"""Compare sampled evaluated Blender deformation, not authored control values."""
import json, math
from pathlib import Path
p=Path(__file__).resolve().parent.parent
before=json.loads((p/'Before.metrics.json').read_text())
after=json.loads((p/'Druid_Cat_Form_Animation_v11.metrics.json').read_text())
checks=[]
def check(label, condition):
    checks.append({'check':label,'passed':bool(condition)})
check('source geometry is unchanged', before['source_mesh_hash']==after['source_mesh_hash'])
check('all 26 original actions retained',set(before['actions'])==set(after['actions']) and len(after['actions'])==26)
check('neutral source stance preserved',after['neutral_max_error']<3e-5)
revised=['Attack_Left','Attack_Right','Finisher']
for name in revised:
    a=after['actions'][name]
    check(name+': reachable limb targets',max(a['ik_reach_error'].values())<.002)
    check(name+': no visible ground penetration',a['min_mesh_z']>-.001)
    check(name+': closes to matching start pose',a['closure']<3e-5)
for name in set(after['actions'])-set(revised):
    check(name+': original motion preserved',after['actions'][name]['samples']==before['actions'][name]['samples'])
run=after['actions']['Run']
check('Run: restrained shoulder motion',.010<run['ranges']['DEF-spine.008'][2]<.022)
check('Run: restrained pelvis motion',.015<run['ranges']['DEF-spine.004'][2]<.036)
for side,s in [('L',1),('R',-1)]:
    a=after['actions']['Attack_'+('Left' if side=='L' else 'Right')]
    paw='DEF-front_toe.'+side
    x=[s*f[paw][0] for f in a['samples']]
    check(side+' swipe: crosses the opposing side',min(x)<-.14 and max(x)>.25)
    check(side+' swipe: broad lateral claw arc',.40<a['ranges'][paw][0]<.50)
    check(side+' swipe: modest rearward rise',a['shoulder_above_hip_max']<.135)
    support='DEF-front_toe.'+('R' if side=='L' else 'L')
    check(side+' swipe: free forepaw lifts slightly',.035<a['ranges'][support][2]<.05)
    check(side+' swipe: free forepaw lands for follow-through',math.dist(a['samples'][22][support],a['samples'][0][support])<.001)
    check(side+' swipe: rear paws stay planted',max(a['hind_contact_max_displacement'].values())<.001)
    check(side+' swipe: pelvis visibly transfers weight',.065<a['ranges']['DEF-spine.004'][0]<.11)
    check(side+' swipe: shoulders follow body turn',.06<a['ranges']['DEF-spine.008'][0]<.11)
    wind, arc, strike = [a['samples'][(frame-1)*2] for frame in (5,8,10)]
    old_wind=before['actions']['Attack_'+('Left' if side=='L' else 'Right')]['samples'][8]
    check(side+' swipe: outward windup retained',math.dist(wind[paw][:2],old_wind[paw][:2])<.001)
    check(side+' swipe: slight chest rise above v10',.045<wind['DEF-spine.008'][2]-old_wind['DEF-spine.008'][2]<.080)
    check(side+' swipe: hips stay over the hind legs',abs(wind['DEF-spine.004'][2]-old_wind['DEF-spine.004'][2])<.012)
    check(side+' swipe: both forepaws clear ground at windup',min(wind['DEF-front_toe.L'][2],wind['DEF-front_toe.R'][2])>.05)
    pelvis = 'DEF-spine.004'
    hip_progress = (arc[pelvis][0]-wind[pelvis][0])/(strike[pelvis][0]-wind[pelvis][0])
    paw_progress = (arc[paw][0]-wind[paw][0])/(strike[paw][0]-wind[paw][0])
    check(side+' swipe: hips unwind before the paw finishes',hip_progress>.75 and paw_progress<.6)
for name in ['Attack_Left','Attack_Right','Finisher']:
    a=after['actions'][name]
    check(name+': separated paw return paths',min(math.dist(f['DEF-front_toe.L'],f['DEF-front_toe.R']) for f in a['samples'])>.09)
report={'passed':all(c['passed'] for c in checks),'checks':checks}
(p/'acceptance.json').write_text(json.dumps(report,indent=2))
for c in checks:print(('PASS' if c['passed'] else 'FAIL'),c['check'])
raise SystemExit(0 if report['passed'] else 1)
