import * as THREE from 'three';

/** The rage crown is a moving blood flame, not red metal. One prepared program
 * serves every instance; shared uniforms and fixed geometry stay allocation-free. */
export function animateWarriorRage(
  material: THREE.MeshStandardMaterial,
  time: { value: number },
  motion: { value: number },
): void {
  const previous = material.onBeforeCompile.bind(material);
  const cacheKey = material.customProgramCacheKey.bind(material);
  material.transparent = true;
  material.depthWrite = false;
  // Emitted light composes independently of instance submission order.
  material.blending = THREE.AdditiveBlending;
  material.roughness = 1;
  material.metalness = 0;
  material.emissiveIntensity = 1.6;
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.uWarriorRageTime = time;
    shader.uniforms.uWarriorRageMotion = motion;
    shader.vertexShader =
      `uniform float uWarriorRageTime,uWarriorRageMotion; varying vec3 vRagePosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRagePosition=position;
        float rageLift=clamp(position.y/1.9,0.,1.)*uWarriorRageMotion;
        float ragePhase=0.;
        #ifdef USE_INSTANCING
          ragePhase=instanceMatrix[3].x*1.7+instanceMatrix[3].z*.9;
        #endif
        // Coherent shear preserves the curved sheet: per-vertex sine folds
        // its broad triangulated face into bright overlapping crystal facets.
        transformed.x+=sin(-uWarriorRageTime*3.4+ragePhase)*.15*rageLift;
        transformed.z+=sin(-uWarriorRageTime*2.7+ragePhase)*.21*rageLift;
        transformed.y+=sin(-uWarriorRageTime*3.9+ragePhase)*.09*rageLift;`,
      );
    shader.fragmentShader = `uniform float uWarriorRageTime; varying vec3 vRagePosition;
      float rageHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float rageNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(rageHash(i),rageHash(i+vec2(1.,0.)),f.x),mix(rageHash(i+vec2(0.,1.)),rageHash(i+vec2(1.,1.)),f.x),f.y);}
      ${shader.fragmentShader}`
      .replace(
        '#include <alphatest_fragment>',
        `
        vec2 rageUv=vec2(vRagePosition.x*6.+sin(vRagePosition.y*3.-uWarriorRageTime*4.)*.7,vRagePosition.y*1.8-uWarriorRageTime*3.2);
        float rageField=rageNoise(rageUv)*.72+rageNoise(rageUv*2.3)*.28;
        float rageTip=clamp(vRagePosition.y/1.9,0.,1.);
        float rageRoot=smoothstep(0.,.2,rageTip);
        float rageDensity=smoothstep(.3+rageTip*.22,.76,rageField)*rageRoot;
        diffuseColor.a*=rageDensity*.87;
        if(diffuseColor.a<.025)discard;
        diffuseColor.rgb*=vec3(1.15,.42,.5);
        #include <alphatest_fragment>`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance*=.18+rageTip*.62;
        totalEmissiveRadiance+=vec3(1.,.028,.045)*rageDensity*pow(rageTip,2.)*.35;`,
      );
  };
  material.customProgramCacheKey = () => `${cacheKey()}|warrior-rage-flame-v4`;
  material.needsUpdate = true;
}
