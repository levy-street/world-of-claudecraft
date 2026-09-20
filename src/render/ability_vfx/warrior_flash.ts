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

/** No closed ring. Unequal blade lobes, fragmented pressure and branching
 * discharge grow out of one receiving point, then tear into sparks. All phases
 * are continuous; the one collision flash never strobes during its decay. */
export const WARRIOR_FLASH_GLSL = `
uniform float uWarriorStyle, uWarriorPhase;
float warriorNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  vec4 n=sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+vec2(1.),vec2(127.1,311.7))))*43758.5453;
  n=fract(n);return mix(mix(n.x,n.y,f.x),mix(n.z,n.w,f.x),f.y);
}
float warriorLine(vec2 p, float angle, float thickness, float reach) {
  vec2 axis=vec2(cos(angle),sin(angle));
  float along=dot(p,axis), across=dot(p,vec2(-axis.y,axis.x));
  return exp(-abs(across)*thickness)*exp(-abs(along)*reach);
}
vec4 warriorFlash(vec2 uv, float phase, vec3 tint, float hdr) {
  float t=clamp(phase,0.,1.);
  float grow=.24+.76*(1.-exp(-t*10.));
  vec2 p=(uv-.5)/grow;
  float r=length(p), a=atan(p.y,p.x);
  float alive=pow(1.-t,1.35);
  float hot=1.-smoothstep(.13,.43,t);
  float tear=smoothstep(.19,.67,t);
  float edge=1.-smoothstep(.43,.49,length(uv-.5));
  float irregular=sin(a*7.+.6)*.018+sin(a*13.-1.2)*.012;
  float grain=warriorNoise(p*58.-vec2(t*3.,t));
  float islands=warriorNoise(p*23.+vec2(t,0.));
  float core=exp(-dot(p,p)*800.)*hot;
  float glow=exp(-dot(p,p)*85.)*alive;
  float cut=warriorLine(p,.05,200.,8.)+warriorLine(p,1.27,170.,15.)*.55;
  float rays=pow(max(0.,sin(a*11.+sin(a*3.)*2.)),18.);
  float fragments=pow(max(0.,sin(a*23.+r*28.)),10.);
  float body=0., filament=0., mist=0.;
  if(uWarriorStyle<1.5) {
    // Steel: a sharp diagonal wedge and a shorter opposing silver blast.
    float blade=pow(abs(cos(a+.10)),9.);
    float end=.16+.22*blade+irregular;
    float fan=exp(-abs(p.y+sin(p.x*17.)*.015)*28.);
    body=fan*(1.-smoothstep(end-.08,end,r))*(.25+.75*hot);
    filament=rays*smoothstep(.055,.13,r)*(1.-smoothstep(.23,.43,r));
    mist=fragments*tear*exp(-abs(r-(.12+t*.25))*35.);
  } else if(uWarriorStyle<2.5) {
    // Blood rage: broken broad sheets and hot torn rims around dark red spray.
    float lobe=.19+.085*sin(a*3.+.7)+.045*sin(a*7.-.2);
    float rim=exp(-abs(r-lobe-irregular)*70.);
    float slit=.25+.75*pow(abs(cos(a-.2)),3.);
    body=(1.-smoothstep(lobe-.045,lobe,r))*slit*.48;
    filament=rim*(.2+.8*max(0.,sin(a*9.+1.)))+rays*.5*smoothstep(.12,.2,r)*(1.-smoothstep(.3,.44,r));
    mist=fragments*tear*exp(-abs(r-(.20+t*.18))*32.);
    cut*=.48;
  } else if(uWarriorStyle<3.5) {
    // Spirit hammer: branching lightning around a fractured thunder core.
    float zig=(abs(fract(r*13.+.16)*2.-1.)-.5)*1.15;
    float forks=pow(max(0.,cos(a*7.+zig+sin(a*3.)*.65)),82.);
    float broken=.21+irregular+sin(a*5.)*.055;
    body=(1.-smoothstep(broken-.025,broken,r))*.35;
    filament=forks*smoothstep(.04,.1,r)*(1.-smoothstep(.32,.45,r));
    filament+=exp(-abs(r-broken)*140.)*pow(max(0.,sin(a*11.+.8)),3.);
    filament+=pow(max(0.,cos(a*13.-zig*.7)),110.)*.35*smoothstep(.14,.21,r)*(1.-smoothstep(.3,.43,r));
    mist=fragments*tear*exp(-abs(r-(.18+t*.21))*35.);
    cut+=warriorLine(p,2.35,210.,12.)*.6;
  } else {
    // Shield and ground: broad angular compression, shattered at the shoulders.
    float diamond=abs(p.x)*.7+abs(p.y)*1.3;
    float extent=.24+irregular;
    body=(1.-smoothstep(extent-.035,extent,diamond))*.45;
    filament=exp(-abs(diamond-extent)*90.)*(.2+.8*max(0.,sin(a*9.)));
    filament+=rays*smoothstep(.10,.2,r)*(1.-smoothstep(.32,.44,r))*.7;
    mist=fragments*tear*exp(-abs(r-(.20+t*.18))*32.);
    cut=warriorLine(p,0.,160.,6.)+warriorLine(p,1.57,180.,16.)*.35;
  }
  body*=.25+.75*smoothstep(.18,.7,islands);
  filament*=.4+.6*smoothstep(.2,.8,grain);
  float chips=smoothstep(.73,.92,grain)*smoothstep(.06,.16,r)*(1.-smoothstep(.34,.44,r))*tear;
  float energy=(body*.85+filament*.7+mist*.5+chips*.45+cut*hot*.7+glow*.3)*alive;
  vec3 colour=tint*energy*hdr+mix(tint,vec3(1.),.8)*core*hdr*1.3;
  // Use alpha=1 inside the additive carrier; its lifetime controls the fade. Empty
  // pixels are zero light, so no large opaque rectangle can veil the fight.
  return vec4(colour*edge,1.);
}
`;
