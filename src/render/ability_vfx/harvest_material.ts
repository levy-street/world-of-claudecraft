/** Shared crest program extension. No extra material, pass or runtime upload.
 * UV.x follows extraction; UV.y crosses each sculpted fold. */
export const HARVEST_VERTEX = `
if(uKind>23.5&&uKind<25.5){
  float motionAge=mix(0.32,uAge,uMotion);
  float grow=1.0-pow(1.0-clamp(motionAge/0.38,0.0,1.0),3.0);
  float erupt=step(24.5,uKind);
  p=mix(position*vec3(0.12,0.06,0.18),position,grow*erupt+(1.0-erupt));
  float release=smoothstep(0.36,1.0,motionAge);
  p.x+=sign(position.x)*release*uv.x*0.95;
  p.y+=(release*uv.x*0.45-release*release*1.45)*erupt;
  p.z+=release*uv.x*0.85;
}`;

export const HARVEST_FRAGMENT = `
if(uKind>23.5&&uKind<25.5){
  if(uKind>24.5&&!gl_FrontFacing)discard;
  float motionAge=mix(0.32,uAge,uMotion);
  float head=clamp(motionAge/0.20,0.0,1.0)*1.18;
  float reveal=1.0-smoothstep(head-0.09,head+0.015,vUv.x);
  vec2 flow=vec2(fract(vUv.x*0.85-motionAge*0.12),0.08+vUv.y*0.82);
  vec3 tex=texture2D(uBloodMap,flow).rgb;
  float grain=dot(tex,vec3(0.333333));
  float erosion=smoothstep(0.38,0.95,motionAge);
  float neck=sin(vUv.x*21.0+sin(vUv.y*6.2831853)*1.2+vLocal.z*0.8);
  float holes=smoothstep(-1.3+erosion*2.8,-0.9+erosion*2.8,neck+grain*0.7);
  vec3 hn=normalize(vNormal);
  vec3 he=normalize(vView); if(dot(hn,he)<0.0)hn=-hn;
  vec3 hs=normalize((viewMatrix*vec4(uSunWorld,0.0)).xyz);
  float light=0.32+0.68*max(0.0,dot(hn,hs));
  float wet=pow(max(0.0,dot(hn,normalize(hs+he))),42.0);
  colour=mix(uTint*0.8,uAccent,0.2+grain*0.3)*light;
  colour+=vec3(1.0,0.38,0.42)*wet*0.38;
  float tip=1.0-smoothstep(0.018,0.09,abs(vUv.x-head));
  colour+=vec3(1.0,0.45,0.4)*tip*0.45*(1.0-uAge);
  float tornEdge=0.67+0.16*sin(vUv.x*29.0)+0.08*sin(vUv.x*73.0);
  float edgeBreak=1.0-smoothstep(tornEdge-0.045,tornEdge+0.015,vUv.y);
  float aperture=mix(0.38,1.0,smoothstep(0.7,1.7,vLocal.y));
  float rootRelease=smoothstep(erosion*0.5-0.08,erosion*0.5+0.06,vUv.x);
  alpha=reveal*holes*mix(edgeBreak,1.0,step(24.5,uKind))*aperture*rootRelease*0.94*(1.0-smoothstep(0.68,1.0,uAge));
}`;
