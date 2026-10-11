/** One blood material for Warrior cuts: torn film, narrow fibres and a travelling
 * blade front. The callers supply their own silhouette, scale and cut direction. */
export const BLOOD_FILM_GLSL = `
float harvestHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float harvestNoise(vec2 p){
  vec2 cell=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(harvestHash(cell),harvestHash(cell+vec2(1.,0.)),f.x),
    mix(harvestHash(cell+vec2(0.,1.)),harvestHash(cell+vec2(1.,1.)),f.x),f.y);
}
void warriorBloodFilm(vec2 uv,float depth,float motionAge,out vec3 colour,out float alpha){
  float along=uFlow<0.0?1.0-uv.x:uv.x;
  float head=clamp(motionAge/0.34,0.0,1.0)*1.18;
  float tail=max(0.0,(motionAge-0.26)*1.55);
  float reveal=(1.0-smoothstep(head-0.08,head+0.015,along))*smoothstep(tail-0.08,tail+0.04,along);
  vec3 tex=texture2D(uBloodMap,vec2(fract(uv.x*0.91-motionAge*0.035),0.05+uv.y*0.9)).rgb;
  float grain=dot(tex,vec3(0.333333));
  vec2 tornUv=vec2(uv.x*17.0,uv.y*5.0)+vec2(depth*1.3,0.0);
  float broad=harvestNoise(tornUv);
  float detail=harvestNoise(tornUv*2.71+7.3);
  float fibres=harvestNoise(vec2(uv.x*8.0,uv.y*38.0)+broad*2.0);
  float film=broad*0.65+detail*0.25+fibres*0.1;
  float erosion=smoothstep(0.22,0.94,motionAge);
  float holes=smoothstep(0.18+erosion*0.6,0.3+erosion*0.6,film);
  float edge=0.48+harvestNoise(vec2(uv.x*31.0,2.7))*0.5;
  float fray=1.0-smoothstep(edge-0.12,edge+0.03,uv.y+erosion*0.18);
  float density=mix(0.38,0.88,broad);
  float blade=exp(-uv.y*14.0)*0.22;
  colour=mix(uTint,uAccent,clamp(0.16+broad*0.5+grain*0.12+blade,0.0,1.0));
  alpha=reveal*holes*fray*density*(1.0-smoothstep(0.66,1.0,uAge));
}`;
