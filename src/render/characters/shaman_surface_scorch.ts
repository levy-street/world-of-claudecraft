import { abilityVfxFullSpec } from '../ability_vfx_registry';

/** Called only by the existing confirmed-contact delegate. Nature is not
 * synonymous with lightning: stone, wind and healing keep their own response. */
export function shamanLightningSurface(abilityId: string | undefined): boolean {
  return !!abilityId && abilityVfxFullSpec(abilityId)?.shaman?.element === 'storm';
}

/** Runs inside the already-prepared body-response material. Char changes the
 * receiver's native albedo only in a broken torso patch. Narrow residual charge
 * lives on the same skinned surface, never a second silhouette or whole-body dye. */
export const SHAMAN_SURFACE_SCORCH_GLSL = `
  float charAge=clamp(uSurfaceAge,0.0,1.0);
  float charLife=(1.0-smoothstep(0.42,1.0,charAge));
  float charStrength=smoothstep(0.0,0.5,uSurfaceAmount);
  vec2 charP=vec2(woundSide,surfaceHeight-0.54);
  float charFold=sin(charP.x*23.0+sin(charP.y*19.0)*0.7)*0.021;
  float charBounds=abs(charP.x)*1.35+abs(charP.y+charFold)*0.9;
  float charPatch=1.0-smoothstep(0.17,0.31,charBounds);
  float charBranch=charP.y-charP.x*0.53-sin(charP.x*29.0)*0.018;
  float charFork=charP.y+charP.x*0.83+0.046-sin(charP.x*37.0)*0.013;
  float charAA=max(0.001,fwidth(charBranch));
  float charSeam=1.0-smoothstep(0.003,0.007+charAA,abs(charBranch));
  charSeam=max(charSeam,(1.0-smoothstep(0.002,0.005+charAA,abs(charFork)))*0.68);
  float charAsh=charPatch*(0.88+0.055*sin(charP.x*17.0+charP.y*24.0));
  surfaceCoat=clamp((charAsh+charSeam*charPatch*0.06)*charLife*charStrength,0.0,0.92);
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*0.055,surfaceCoat);
  // A short return stroke crawls along the seam; reduced motion keeps the
  // same scorched read and a steady residual glint without spatial jitter.
  float charTravel=uSurfaceMotion>0.5
    ? pow(max(0.0,sin(charP.x*13.0-charAge*17.0)),6.0) : 0.36;
  float charHot=(1.0-smoothstep(0.06,0.3,charAge));
  surfaceEmission=vec3(0.2,0.52,0.88)*charSeam*charPatch*charLife*charStrength
    *(charHot*1.7+charTravel*0.78);
`;
