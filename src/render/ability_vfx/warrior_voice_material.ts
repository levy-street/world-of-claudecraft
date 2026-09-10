/** Interrupted acoustic fronts. Each prepared layer travels independently;
 * the thin compression edge leaves open air instead of a filled liquid wall. */
export const WARRIOR_VOICE_VERTEX = `
if(uKind>12.5&&uKind<13.5){
  float layer=floor(uv.y/2.0);
  float pulseAge=clamp((uAge-layer*.09)/min(.72,1.-layer*.09),0.,1.);
  float radius=mix(.18,1.,pulseAge);
  p.xz*=mix(.78,radius,uMotion);
  p.y+=pressureGround(p.xz);
}`;

export const WARRIOR_VOICE_FRAGMENT = `
if(uKind>12.5&&uKind<13.5){
  float layer=floor(vUv.y/2.0),v=mod(vUv.y,2.0);
  float age=(uAge-layer*.09)/min(.72,1.-layer*.09);
  float texture=texture2D(uPressureMap,vec2(fract(vUv.x*2.3-layer*.13),v*.6+.18)).r;
  float grain=.5+.5*sin(vUv.x*337.0+texture*12.0);
  float edge=exp(-v*6.0);
  float contrast=exp(-pow((v-.42)*9.0,2.0));
  float segment=fract(vUv.x*12.0);
  float opening=smoothstep(.03,.14,segment)*(1.-smoothstep(.74,.91,segment));
  float feather=.58+.42*smoothstep(.17,.62,texture+grain*.19);
  colour=mix(uTint*.3,uAccent,edge*.91+texture*.07);
  colour+=uAccent*edge*grain*.23;
  alpha=(edge+contrast*.46)*opening*feather*
    smoothstep(0.,.035,age)*(1.-smoothstep(.63,1.,age));
}`;
