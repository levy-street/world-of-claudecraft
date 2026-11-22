/** The Paladin specializations in emblem order: the value `paladinSpecEmblem` takes. */
export const PALADIN_SPEC_EMBLEMS = ['holy', 'protection', 'retribution'] as const;
export type PaladinSpecEmblem = (typeof PALADIN_SPEC_EMBLEMS)[number];

/** Emblem index for a spec id, or `fallback` for another class's or none. */
export function paladinSpecEmblemIndex(spec: string | null | undefined, fallback = 1): number {
  const i = PALADIN_SPEC_EMBLEMS.indexOf(spec as PaladinSpecEmblem);
  return i < 0 ? fallback : i;
}

/** Each spec's own abilities, which mark a Paladin as that spec when seen
 * cast. Shared abilities (Holy Ground, Hushbrand, the heals and auras every
 * spec has) mark nothing. */
export const PALADIN_SPEC_SIGNATURES: Readonly<Record<string, PaladinSpecEmblem>> = {
  mercy_lance: 'holy',
  solar_invocation: 'holy',
  beacon_of_light: 'holy',
  sacred_form: 'holy',
  dawns_embrace: 'holy',
  radiant_chorus: 'holy',
  life_covenant: 'holy',
  aegis_first_dawn: 'holy',
  sunward_disc: 'protection',
  vowkeeper_strike: 'protection',
  bastion_rite: 'protection',
  sacred_challenge: 'protection',
  bastion_sweep: 'protection',
  holy_shield: 'protection',
  oath_chain: 'protection',
  veilbound_march: 'protection',
  final_edict: 'retribution',
  dawnfall: 'retribution',
  faithforged_guard: 'retribution',
  hammer_of_wrath: 'retribution',
  guardian_covenant: 'retribution',
  sun_gods_verdict: 'retribution',
  valkyrs_calling: 'retribution',
};

/**
 * The three Paladin spec icons drawn in light, in about [-1, 1] with y up:
 * - Sunmender (holy): a sun disc with an eight-pointed star, its long rays
 *   reaching up and down, held between two rising crescent horns with a leaf
 *   of flame beneath each;
 * - Faithwarden (protection): a shield split into two plates, a spine of
 *   light running through the gap and a sun star at its heart;
 * - Dawnreaver (retribution): a tall blade with a fuller, forking at its base
 *   into two fangs round an inner spear, before a thin halo open below, with
 *   swept, hooked wings either side.
 * `paladinSpecDist(p, spec)` is a signed distance (negative inside);
 * `paladinSpecEmblem(p, spec)` is its fill * 0.4 + outline stroke * 0.9;
 * `paladinSpecSigilDist(p, spec)` is the simplified icon for small sigils.
 */
export const PALADIN_SPEC_EMBLEM_GLSL = `
  float specBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
  // A ray of light from a to b: widest (half-width w) a little way out from a.
  float specRay(vec2 p,vec2 a,vec2 b,float w){
    float len=length(b-a);
    vec2 u=(b-a)/len;
    vec2 q=vec2(dot(p-a,u),abs(dot(p-a,vec2(-u.y,u.x))));
    float k=len*0.18;
    float x=q.x-k;
    float h=x>0.0?len-k:k;
    return (abs(x)/h+q.y/w-1.0)*h*w/length(vec2(h,w));
  }
  // A diamond centred on c, half-width w and half-height h.
  float specDiamond(vec2 p,vec2 c,float w,float h){
    vec2 q=abs(p-c);
    return (q.x/w+q.y/h-1.0)*w*h/length(vec2(w,h));
  }
  // A kite centred on c: half-width w, reaching up above and down below.
  float specKite(vec2 p,vec2 c,float w,float up,float down){
    vec2 q=p-c;
    float h=q.y>0.0?up:down;
    return (abs(q.x)/w+abs(q.y)/h-1.0)*w*h/length(vec2(w,h));
  }
  // A taper from a (half-width w) to a point at b, flat across at a.
  float specTaper(vec2 p,vec2 a,vec2 b,float w){
    float len=length(b-a);
    vec2 u=(b-a)/len;
    vec2 q=vec2(dot(p-a,u),abs(dot(p-a,vec2(-u.y,u.x))));
    return max((q.y-w*(1.0-q.x/len))*len/length(vec2(len,w)),-q.x);
  }
  // A leaf between a and b bounded by two circle arcs, half-width w.
  float specLeaf(vec2 p,vec2 a,vec2 b,float w){
    vec2 m=(a+b)*0.5;
    vec2 u=normalize(b-a);
    vec2 n=vec2(-u.y,u.x);
    float L=length(b-a)*0.5;
    float r=(L*L+w*w)/(2.0*w);
    float d=r-w;
    return max(length(p-m-n*d)-r,length(p-m+n*d)-r);
  }
  // A horn along a circle arc (centre c, radius R) from angle a0 to a1,
  // thickest mid-way and pointed at both ends.
  float specHorn(vec2 p,vec2 c,float R,float a0,float a1,float w){
    vec2 q=p-c;
    float a=atan(q.y,q.x);
    float t=clamp((a-a0)/(a1-a0),0.0,1.0);
    float d=abs(length(q)-R)-w*pow(max(sin(3.14159*t),0.0),0.7);
    return max(d,max(a0-a,a-a1)*R);
  }
  float sunmenderDist(vec2 p){
    vec2 c=vec2(0.0,0.3);
    vec2 m=vec2(abs(p.x),p.y);
    float disc=length(p-c)-0.15;
    float ring=abs(length(p-c)-0.2)-0.018;
    float rays=min(specRay(p,c,vec2(0.0,0.97),0.075),specRay(p,c,vec2(0.0,-0.97),0.055));
    rays=min(rays,specRay(m,c,vec2(0.64,0.3),0.06));
    vec2 q=abs(p-c);
    float diag=specRay(q,vec2(0.0),vec2(0.25,0.25),0.04);
    float gem=specRay(p,vec2(0.0,-0.44),vec2(0.0,-0.74),0.075);
    float horn=specHorn(m,vec2(-0.35,0.35),0.95,-1.2217,0.349,0.085);
    float leaf=specLeaf(m,vec2(0.86,-0.06),vec2(0.14,-0.7),0.08);
    return min(min(min(disc,ring),min(rays,diag)),min(gem,min(horn,leaf)));
  }
  float faithwardenDist(vec2 p){
    vec2 m=vec2(abs(p.x),p.y);
    vec2 c=vec2(0.0,0.05);
    float outer=max(max(m.x-0.62,p.y-0.74),max(m.x+p.y-1.18,max(m.x-p.y-0.97,-0.92-p.y)));
    // Two plates: a gap down the middle, their inner edges bent out round the star.
    float plates=max(outer,0.14-m.x);
    vec2 nq=abs(p-c);
    plates=max(plates,-(nq.x/0.46+nq.y/0.3-1.0)*0.46*0.3/length(vec2(0.46,0.3)));
    float spine=min(specRay(p,c,vec2(0.0,0.97),0.07),specRay(p,c,vec2(0.0,-0.95),0.06));
    float arms=specRay(m,c,vec2(0.5,0.05),0.065);
    vec2 q=abs(p-c);
    float diag=specRay(q,vec2(0.0),vec2(0.17,0.17),0.03);
    float sun=length(p-c)-0.12;
    float ring=abs(length(p-c)-0.16)-0.018;
    return min(min(plates,min(spine,arms)),min(diag,min(sun,ring)));
  }
  float dawnreaverSpecDist(vec2 p){
    vec2 m=vec2(abs(p.x),p.y);
    // The blade: broad at its base, a fuller down its middle, a sharp point.
    float blade=max(specTaper(p,vec2(0.0,-0.14),vec2(0.0,0.96),0.17),0.01-abs(p.x));
    // Below the base it forks into two narrow fangs round the inner spear.
    float fang=specTaper(m,vec2(0.12,-0.12),vec2(0.075,-0.47),0.055);
    // The inner spear: two heads on a slim shaft, the lower one reaching the point.
    float spear=min(specKite(p,vec2(0.0,-0.3),0.05,0.16,0.17),specKite(p,vec2(0.0,-0.645),0.05,0.16,0.315));
    spear=min(spear,specBox(p-vec2(0.0,-0.48),vec2(0.018,0.04)));
    // The wings: crescents hooked down beside the spear, flat along the top
    // where they meet the halo and swept out to a point.
    float wing=max(length(m-vec2(0.6,-0.6))-0.515,max(0.53-length(m-vec2(0.62,-0.78)),
      max(dot(m-vec2(0.235,-0.22),vec2(0.058,0.998)),m.x-0.59)));
    // The thin halo behind, open above round the blade and below at the wings.
    float halo=max(abs(length(p-vec2(0.0,0.09))-0.465)-0.006,max(-0.21-p.y,p.y-0.5));
    return min(min(blade,fang),min(spear,min(wing,halo)));
  }
  // The simplified icons for small sigils: each emblem's silhouette in a few
  // bold parts, thin gaps keeping them apart so the shape reads when small.
  float sunmenderSigilDist(vec2 p){
    vec2 c=vec2(0.0,0.28);
    vec2 m=vec2(abs(p.x),p.y);
    float star=min(specRay(p,c,vec2(0.0,0.95),0.11),specRay(p,c,vec2(0.0,-0.95),0.08));
    star=min(min(star,specRay(m,c,vec2(0.55,0.28),0.085)),length(p-c)-0.17);
    float horn=specHorn(m,vec2(-0.35,0.35),0.95,-1.2217,0.349,0.11);
    horn=max(horn,-(star-0.04));
    float leaf=max(specLeaf(m,vec2(0.86,-0.06),vec2(0.16,-0.68),0.1),-(horn-0.04));
    return min(star,min(horn,leaf));
  }
  float faithwardenSigilDist(vec2 p){
    vec2 m=vec2(abs(p.x),p.y);
    vec2 c=vec2(0.0,0.05);
    float star=min(specRay(p,c,vec2(0.0,0.97),0.09),specRay(p,c,vec2(0.0,-0.95),0.08));
    star=min(min(star,specRay(m,c,vec2(0.52,0.05),0.08)),length(p-c)-0.15);
    float outer=max(max(m.x-0.62,p.y-0.74),max(m.x+p.y-1.18,max(m.x-p.y-0.97,-0.92-p.y)));
    vec2 nq=abs(p-c);
    float plates=max(outer,-(nq.x/0.46+nq.y/0.3-1.0)*0.46*0.3/length(vec2(0.46,0.3)));
    plates=max(plates,-(star-0.045));
    return min(star,plates);
  }
  float dawnreaverSigilDist(vec2 p){
    vec2 m=vec2(abs(p.x),p.y);
    float blade=specTaper(p,vec2(0.0,-0.12),vec2(0.0,0.96),0.17);
    float spear=max(specKite(p,vec2(0.0,-0.52),0.075,0.3,0.44),-(blade-0.035));
    float wing=max(length(m-vec2(0.6,-0.6))-0.515,max(0.53-length(m-vec2(0.62,-0.78)),
      max(dot(m-vec2(0.235,-0.22),vec2(0.058,0.998)),m.x-0.59)));
    wing=max(wing,-(spear-0.035));
    float halo=max(abs(length(p-vec2(0.0,0.09))-0.465)-0.014,max(-0.21-p.y,p.y-0.5));
    halo=max(halo,-(blade-0.035));
    return min(min(blade,spear),min(wing,halo));
  }
  float paladinSpecSigilDist(vec2 p,float spec){
    return spec>1.5?dawnreaverSigilDist(p):(spec>0.5?faithwardenSigilDist(p):sunmenderSigilDist(p));
  }
  float paladinSpecDist(vec2 p,float spec){
    return spec>1.5?dawnreaverSpecDist(p):(spec>0.5?faithwardenDist(p):sunmenderDist(p));
  }
  float paladinSpecEmblem(vec2 p,float spec){
    float d=paladinSpecDist(p,spec);
    return (1.0-smoothstep(-0.01,0.01,d))*0.4+(1.0-smoothstep(0.012,0.035,abs(d)))*0.9;
  }
`;
