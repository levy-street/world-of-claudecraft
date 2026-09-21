/** Authored collision light, carried by the existing six prepared impact quads.
 * Material sprites remain the physical aftermath. No runtime texture generation. */
export type WarriorFlashStyle =
  | 'warrior_steel_flash'
  | 'warrior_blood_flash'
  | 'warrior_storm_flash'
  | 'warrior_crush_flash';

export function warriorFlashStyle(style: string): number {
  switch (style) {
    case 'warrior_steel_flash':
      return 1;
    case 'warrior_blood_flash':
      return 2;
    case 'warrior_storm_flash':
      return 3;
    case 'warrior_crush_flash':
      return 4;
    default:
      return 0;
  }
}

const fallbackFlashes = {
  hamstring: { style: 'warrior_steel_flash', size: 6.5, colour: 0xb5d5ed, hdr: 3.4 },
  breachmaker: { style: 'warrior_steel_flash', size: 11.5, colour: 0xb5d5ed, hdr: 4.8 },
  charge: { style: 'warrior_crush_flash', size: 11, colour: 0xb1d3e8, hdr: 4.8 },
} as const;

/** Only these Warrior actions use the shared physical contact path. */
export function warriorFallbackFlash(id: string) {
  return Object.hasOwn(fallbackFlashes, id)
    ? fallbackFlashes[id as keyof typeof fallbackFlashes]
    : undefined;
}

/** Directional collision drawing. Physical colour and opacity come from the
 * authored sprite layer underneath; this carrier supplies edge light, hot
 * slivers and departing particles. No shared radial spokes or expanding disc. */
export const WARRIOR_FLASH_GLSL = `
uniform float uWarriorStyle, uWarriorPhase;
uniform vec2 uWarriorDown;
float warriorHash(float n) { return fract(sin(n*127.1+19.17)*43758.5453); }
float warriorNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float n=dot(i,vec2(1.,157.));
  return mix(mix(warriorHash(n),warriorHash(n+1.),f.x),
    mix(warriorHash(n+157.),warriorHash(n+158.),f.x),f.y);
}
// An antialiased finite taper, with a pointed leading edge rather than a tube.
float warriorSliver(vec2 p, vec2 axis, float centre, float reach, float width) {
  vec2 q=vec2(dot(p,axis)-centre,dot(p,vec2(-axis.y,axis.x)));
  float along=abs(q.x)/max(.001,reach);
  float d=abs(q.y)/max(.0007,width)+along;
  float aa=max(.06,fwidth(d));
  return 1.-smoothstep(1.-aa,1.+aa,d);
}
float warriorRim(float distance, float width) {
  float coverage=max(.0005,fwidth(distance));
  float filtered=width+coverage*.55;
  return exp(-abs(distance)/filtered)*(width/filtered);
}
float warriorBend(float u, float seed) {
  float cell=u*6.,k=floor(cell),f=fract(cell);
  float a=(warriorHash(k+seed)-.5)*.074;
  float b=(warriorHash(k+1.+seed)-.5)*.074;
  return mix(a,b,f)*smoothstep(0.,.12,u);
}
vec2 warriorBranchRoot(float distance, float angle, float reach, float seed) {
  vec2 axis=vec2(cos(angle),sin(angle));
  return axis*distance+vec2(-axis.y,axis.x)*warriorBend(distance/reach,seed);
}
float warriorThread(vec2 p, float angle, float reach, float seed, float width, float phase) {
  vec2 axis=vec2(cos(angle),sin(angle));
  float x=dot(p,axis),y=dot(p,vec2(-axis.y,axis.x));
  float u=x/max(.001,reach);
  // Nonuniform corners remain stationary as the leader exposes the path.
  float bend=warriorBend(u,seed);
  float taper=width*(1.-clamp(u,0.,1.)*.82);
  float aa=max(.0007,fwidth(y-bend));
  float line=1.-smoothstep(taper,taper+aa,abs(y-bend));
  return line*smoothstep(0.,.025,u)*(1.-smoothstep(.9,1.,u))
    *(1.-smoothstep(phase-.06,phase+.02,u));
}
vec4 warriorFlash(vec2 uv, float phase, vec3 tint, float hdr) {
  vec2 p=uv-.5;
  float t=clamp(phase,0.,1.);
  float edge=1.-smoothstep(.46,.5,max(abs(p.x),abs(p.y)));
  if(edge<=0.) return vec4(0.);
  float release=1.-exp(-t*13.);
  float alive=1.-smoothstep(.32,1.,t);
  float hot=1.-smoothstep(.035,.23,t);
  float core=exp(-dot(p,p)*2700.)*hot;
  float body=0.,rim=0.,fine=0.,pigment=0.;
  float grain=warriorNoise(p*115.);
  float flow=warriorNoise(vec2(p.x*31.-release*.8,p.y*57.));
  if(uWarriorStyle<1.5) {
    // Three unequal cutting tongues. Narrow silver faces leave dark gaps.
    for(int j=0;j<3;j++) {
      float i=float(j);
      float angle=j==0?-.09:j==1?3.35:.36;
      vec2 axis=vec2(cos(angle),sin(angle));
      float length=(j==0?.44:j==1?.34:.27)*release;
      float x=dot(p,axis),y=dot(p,vec2(-axis.y,axis.x));
      float span=max(.015,length);
      float u=clamp(x/span,0.,1.);
      float fold=sin(u*12.+i)*.004*(.3+u);
      float width=(.005+(j==0?.016:.01)*sin(u*3.14159))*(1.-t*.75);
      float envelope=smoothstep(-.018,.035,x)*(1.-smoothstep(span-.035,span,x));
      float blade=1.-smoothstep(width,width+.003,abs(y-fold));
      float split=smoothstep(.23,.56,flow+u*.18);
      body+=blade*envelope*split*.38;
      rim+=warriorRim(y-fold-width*.6,.00155)*envelope*(.4+.6*grain);
    }
    rim+=warriorSliver(p,vec2(1.,0.),0.,.28*release,.0022)*hot*1.5;
  } else if(uWarriorStyle<2.5) {
    // Torn wet sheet edges over the dark, normal-alpha blood sprite. Unequal
    // lobes, holes and folded lips; no luminous solid blood disc.
    for(int j=0;j<3;j++) {
      float i=float(j),angle=j==0?-.08:j==1?3.36:.32;
      vec2 axis=vec2(cos(angle),sin(angle));
      vec2 q=vec2(dot(p,axis),dot(p,vec2(-axis.y,axis.x)));
      float length=(j==0?.46:j==1?.37:.3)*release;
      float u=clamp(q.x/max(.02,length),0.,1.);
      float curve=sin(u*3.5+i*.7)*(.032+i*.015)+u*u*(i-1.)*.11;
      float width=(.006+sin(u*3.14159)*(.026+i*.005))*(1.-t*.55);
      float ripple=(flow-.5)*.029;
      float d=abs(q.y-curve+ripple);
      float envelope=smoothstep(-.01,.04,q.x)*(1.-smoothstep(length-.05,length,q.x));
      float breakup=warriorNoise(vec2(u*24.+i*13.,q.y*92.));
      float holes=smoothstep(.23+t*.32,.42+t*.32,flow)
        *mix(1.,smoothstep(.32,.56,breakup),smoothstep(.09,.38,t));
      float sheet=(1.-smoothstep(width-.006,width+.002,d))*envelope*holes;
      pigment=max(pigment,sheet*(.67+.27*flow));
      body+=sheet*.004;
      rim+=warriorRim(q.y-curve+ripple-width,.00185)*envelope*holes*.11;
      // Broken wet highlights on stretched folds, not an evenly glowing fill.
      fine+=sheet*smoothstep(.84,.97,grain)*.08;
    }
  } else if(uWarriorStyle<3.5) {
    // Four intentionally different leaders and two true forks. Width and
    // length diminish outward. Branches extend, then drain into fine arcs.
    float leader=min(1.08,release*1.16);
    float width=.0024*(1.-t*.55);
    rim=warriorThread(p,-.16,.46,3.,width,leader)
      +warriorThread(p,1.07,.39,15.,width*.85,leader)
      +warriorThread(p,2.75,.43,29.,width*1.15,leader)
      +warriorThread(p,4.52,.32,43.,width*.7,leader);
    float forkA=max(0.,(leader-.17/.46)/(1.-.17/.46));
    float forkB=max(0.,(leader-.16/.43)/(1.-.16/.43));
    rim+=warriorThread(p-warriorBranchRoot(.17,-.16,.46,3.),.65,.23,59.,width*.6,forkA)*.7;
    rim+=warriorThread(p-warriorBranchRoot(.16,2.75,.43,29.),2.0,.23,73.,width*.55,forkB)*.7;
    fine+=warriorThread(p-warriorBranchRoot(.25,1.07,.39,15.),.38,.17,91.,width*.38,
      max(0.,(leader-.25/.39)/(1.-.25/.39)))*.85;
    fine+=warriorThread(p-warriorBranchRoot(.21,4.52,.32,43.),5.36,.15,103.,width*.42,
      max(0.,(leader-.21/.32)/(1.-.21/.32)))*.75;
    fine+=warriorThread(p-warriorBranchRoot(.28,2.75,.43,29.),3.52,.15,117.,width*.3,
      max(0.,(leader-.28/.43)/(1.-.28/.43)))*.7;
    body=exp(-dot(p,p)*420.)*.07*hot;
    fine+=warriorThread(p,-.16,.46,3.,.008,leader)*.12
      +warriorThread(p,2.75,.43,29.,.007,leader)*.1;
  } else {
    // The shield's broad compression shoulders peel outward in two broken
    // ribbons; a short hard centre, then falling armour and stone fragments.
    float extent=.43*release;
    float u=abs(p.x)/max(.02,extent);
    float shoulder=.035+u*u*.14;
    float arc=abs(p.y-shoulder);
    float envelope=(1.-smoothstep(.82,1.,u))*smoothstep(.015,.08,abs(p.x));
    float breaks=smoothstep(.2,.48,flow);
    rim=warriorRim(arc,.00263)*envelope*breaks;
    rim+=warriorRim(p.y+shoulder*.65,.00213)*envelope*breaks*.55;
    body=exp(-arc*85.)*envelope*.09;
    rim+=warriorSliver(p,vec2(1.,0.),0.,.26*release,.003)*hot;
  }
  // Individually travelling slivers, with unequal speeds, lengths and gravity.
  // A fixed small loop adds no scene objects, pool slots or texture fetches.
  float particles=0.;
  for(int j=0;j<12;j++) {
    float i=float(j),h=warriorHash(i+7.),h2=warriorHash(i+39.);
    float angle;
    if(uWarriorStyle<1.5) angle=(j<7?0.:3.14159)+(h-.5)*1.5;
    else if(uWarriorStyle<2.5) angle=(j<8?0.:3.14159)+(h-.5)*2.3;
    else if(uWarriorStyle<3.5) angle=h*6.28318;
    else angle=(j<6?0.:3.14159)+(h-.5)*2.5;
    vec2 axis=vec2(cos(angle),sin(angle));
    float depart=max(0.,t-.025-h2*.075);
    float travel=(.15+h*.31)*(1.-exp(-depart*(5.+h2*4.)));
    vec2 drift=axis*travel+uWarriorDown*depart*depart*(uWarriorStyle<2.5?.085:.13);
    float particleLength=(.006+h2*.025)*(1.-t*.7);
    float width=.0013+h*.0016;
    float shard=warriorSliver(p-drift,axis,0.,particleLength,width);
    float particleLife=smoothstep(0.,.04,depart)*(1.-smoothstep(.42+h2*.15,1.,t));
    if(uWarriorStyle>1.5&&uWarriorStyle<2.5) {
      vec2 delta=p-drift;
      vec2 droplet=vec2(dot(delta,axis)/max(.003,particleLength*.65),
        dot(delta,vec2(-axis.y,axis.x))/(width*1.7));
      float d=length(droplet);
      float cover=1.-smoothstep(1.-max(.08,fwidth(d)),1.+max(.08,fwidth(d)),d);
      pigment=max(pigment,cover*particleLife*.85);
      shard=cover*smoothstep(.1,.6,droplet.y)*.22;
    }
    particles+=shard*particleLife;
    // A dimmer short wake gives speed without fattening the leading fragment.
    fine+=warriorSliver(p-drift+axis*particleLength,axis,0.,particleLength*2.4,width*.55)*.1*alive;
  }
  float light=(body+rim*.62+fine*.55)*alive+particles*(uWarriorStyle>1.5&&uWarriorStyle<2.5?.27:.85);
  // Only the contact seed approaches white. Rich colour survives in the rim.
  vec3 colour=tint*light*hdr+mix(tint,vec3(1.),.82)*core*hdr*1.15;
  float alpha=pigment*alive*edge;
  colour+=mix(vec3(.025,.0008,.0025),vec3(.17,.004,.014),flow)*alpha;
  // Blood alone uses premultiplied source-over plus emissive edge light. It
  // can retain dark red thickness against bright terrain; other styles stay additive.
  return vec4(colour*edge,uWarriorStyle>1.5&&uWarriorStyle<2.5?alpha:1.);
}
`;
