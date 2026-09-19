/** Prepared crest extension: a travelling cut through a fraying sheet.
 * UV.x follows the blade; UV.y measures distance behind its cutting edge. */
export const HARVEST_VERTEX = `
if(uKind>23.5&&uKind<25.5){
  float motionAge=mix(0.32,uAge,uMotion);
  float release=smoothstep(0.18,1.0,motionAge);
  p=position;
  p.z+=release*0.75;
  p.y-=release*release*0.48;
}`;

export const HARVEST_FRAGMENT = `
if(uKind>23.5&&uKind<25.5){
  float motionAge=mix(0.32,uAge,uMotion);
  warriorBloodFilm(vUv,vLocal.z,motionAge,colour,alpha);
}`;
