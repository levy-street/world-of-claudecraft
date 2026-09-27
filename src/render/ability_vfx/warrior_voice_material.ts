/** Interrupted acoustic fronts. Each prepared layer travels independently;
 * uVoice supplies normalized spacing, decay start and immutable voice index. */
export const WARRIOR_VOICE_VERTEX = `
if(uKind>12.5&&uKind<13.5){
  float layer=floor(uv.y/2.0);
  float layers=(uVoice.z>4.5&&uVoice.z<5.5)?5.:3.;
  float span=max(.1,1.-(layers-1.)*uVoice.x);
  float pulseAge=clamp((uAge-layer*uVoice.x)/span,0.,1.);
  float radius=mix(.18,1.,pulseAge);
  p.xz*=mix(.78,radius,uMotion);
  p.y+=pressureGround(p.xz);
}`;

export const WARRIOR_VOICE_FRAGMENT = `
if(uKind>12.5&&uKind<13.5){
  float layer=floor(vUv.y/2.0),v=mod(vUv.y,2.0);
  float layers=(uVoice.z>4.5&&uVoice.z<5.5)?5.:3.;
  float span=max(.1,1.-(layers-1.)*uVoice.x);
  float age=mix(.4,(uAge-layer*uVoice.x)/span,uMotion);
  float texture=texture2D(uPressureMap,vec2(fract(vUv.x*2.3-layer*.13),v*.6+.18)).r;
  float grain=.5+.5*sin(vUv.x*337.0+texture*12.0);
  float edge=exp(-v*8.0);
  float wake=exp(-v*4.0)*.055;
  float segment=fract(vUv.x*12.0);
  float opening=smoothstep(.03,.14,segment)*(1.-smoothstep(.74,.91,segment));
  float feather=.58+.42*smoothstep(.17,.62,texture+grain*.19);
  float compression=1.-smoothstep(.025,.12,age);
  colour=mix(uTint*.45,uAccent,edge*(.62+compression*.32));
  colour+=uAccent*edge*grain*.12;
  alpha=(edge+wake)*opening*feather*
    smoothstep(0.,.025,age)*(1.-smoothstep(uVoice.y,1.,age))*
    (1.-smoothstep(.88,1.,uAge));
}`;
