/** Shared crest program extension. No extra material, pass or runtime upload.
 * UV.x follows extraction; UV.y crosses each sculpted fold. */
export const HARVEST_VERTEX = `
if(uKind>23.5){
  float motionAge=mix(0.32,uAge,uMotion);
  float grow=smoothstep(0.0,0.30,motionAge);
  float erupt=step(24.5,uKind);
  p=mix(position*vec3(0.65,0.28,0.5),position,grow*erupt+(1.0-erupt));
  float release=smoothstep(0.45,1.0,motionAge);
  p.x+=sign(position.x)*release*uv.x*0.75;
  p.y+=release*uv.x*0.8*erupt;
  p.z+=release*uv.x*0.5;
}`;

export const HARVEST_FRAGMENT = `
if(uKind>23.5){
  float motionAge=mix(0.32,uAge,uMotion);
  float head=clamp(motionAge/0.32,0.0,1.0)*1.18;
  float reveal=1.0-smoothstep(head-0.09,head+0.015,vUv.x);
  vec2 flow=vec2(fract(vUv.x*0.85-motionAge*0.12),0.08+vUv.y*0.82);
  vec3 tex=texture2D(uBloodMap,flow).rgb;
  float grain=dot(tex,vec3(0.333333));
  float folds=0.5+0.5*sin(vUv.y*13.0+vUv.x*4.0+grain*1.5);
  float fibre=0.5+0.5*sin(vUv.y*135.0+vUv.x*23.0+grain*5.0);
  float edge=1.0-smoothstep(0.0,0.085,min(vUv.y,1.0-vUv.y));
  float tear=sin(vUv.x*51.0+vUv.y*17.0)+sin(vUv.x*97.0-vUv.y*31.0)*0.35;
  float erosion=smoothstep(0.55,0.98,motionAge);
  float holes=mix(1.0,smoothstep(-0.9+erosion*2.1,-0.35+erosion*2.1,tear+grain),erosion);
  float ridge=smoothstep(0.72,0.98,folds);
  float light=0.55+0.45*abs(dot(normalize(vNormal),normalize(vec3(-0.4,0.7,0.6))));
  colour=mix(uTint*0.7,uAccent*0.9,folds*0.68+grain*0.05)*light;
  colour+=uAccent*(ridge*0.12+fibre*0.025+edge*0.14);
  float tip=1.0-smoothstep(0.018,0.09,abs(vUv.x-head));
  colour+=vec3(1.0,0.45,0.4)*tip*0.45*(1.0-uAge);
  float tornEdge=0.67+0.16*sin(vUv.x*29.0)+0.08*sin(vUv.x*73.0);
  float edgeBreak=1.0-smoothstep(tornEdge-0.045,tornEdge+0.015,vUv.y);
  float aperture=mix(0.38,1.0,smoothstep(0.7,1.7,vLocal.y));
  alpha=reveal*holes*edgeBreak*aperture*(0.60+ridge*0.15)*(1.0-smoothstep(0.77,1.0,uAge));
}`;
