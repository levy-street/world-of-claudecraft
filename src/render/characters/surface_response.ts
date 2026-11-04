import * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';
import type { MeleeImpactProfile } from '../melee_impact_core';

export const SURFACE_RESPONSE_PROGRAM = 'wocSurfaceResponseProgram';
export function surfaceResponseUniforms() {
  return {
    uSurfaceAge: { value: 1 },
    uSurfaceKind: { value: 0 },
    uSurfaceAmount: { value: 0 },
    uSurfaceOrigin: { value: new THREE.Vector3() },
    uSurfaceHeight: { value: 2 },
    uSurfaceContact: { value: new THREE.Vector2(0.56, -0.28) },
    uSurfaceRight: { value: new THREE.Vector2(1, 0) },
    // A held glaze painted over whatever transient runs: (height share it has
    // climbed, rim light, bite, strength); strength 0 draws nothing.
    uSurfaceGlaze: { value: new THREE.Vector4() },
  };
}
type Uniforms = ReturnType<typeof surfaceResponseUniforms>;

/** One program for every treatment; the shared source material and textures
 * stay immutable. Native albedo, armour dye and light response are preserved. */
export function createSurfaceResponseMaterial(
  source: THREE.Material,
  uniforms: Uniforms,
): THREE.Material {
  const material = cloneMaterialWithHooks(source);
  const previous = material.onBeforeCompile,
    previousKey = material.customProgramCacheKey();
  material.userData[SURFACE_RESPONSE_PROGRAM] = true;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vSurfacePoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nvSurfacePoint=(modelMatrix*vec4(transformed,1.0)).xyz;',
    );
    shader.fragmentShader =
      `varying vec3 vSurfacePoint;
      uniform float uSurfaceAge,uSurfaceKind,uSurfaceAmount,uSurfaceHeight;
      uniform vec3 uSurfaceOrigin;
      uniform vec2 uSurfaceContact,uSurfaceRight;
      uniform vec4 uSurfaceGlaze;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
      #include <color_fragment>
      vec3 surfaceP=vSurfacePoint-uSurfaceOrigin;
      float surfaceHeight=clamp(surfaceP.y/max(0.1,uSurfaceHeight),0.0,1.0);
      float woundSide=dot(surfaceP.xz,uSurfaceRight)/max(0.1,uSurfaceHeight);
      float woundLine=surfaceHeight-uSurfaceContact.x-woundSide*sin(uSurfaceContact.y);
      float surfaceGrain=sin(surfaceP.x*39.0+sin(surfaceP.z*27.0))*sin(surfaceP.y*35.0-surfaceP.z*19.0);
      float surfaceVein=1.0-smoothstep(0.025,0.105,abs(sin(surfaceP.x*13.0+sin(surfaceP.y*9.0)*1.8+surfaceP.z*11.0)));
      float surfaceFade=smoothstep(0.0,0.08,uSurfaceAge)*(1.0-smoothstep(0.55,1.0,uSurfaceAge))*uSurfaceAmount;
      float surfaceCoat=0.0; vec3 surfaceEmission=vec3(0.0);
      if(uSurfaceKind<0.5) {
        surfaceCoat=surfaceFade*(0.38+surfaceGrain*0.12);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*0.17,surfaceCoat);
        surfaceEmission=vec3(0.8,0.11,0.018)*surfaceVein*surfaceFade*pow(max(0.0,1.0-uSurfaceAge),2.0);
      } else if(uSurfaceKind<1.5) {
        float rise=smoothstep(0.0,0.34,uSurfaceAge)*1.25;
        surfaceCoat=surfaceFade*(1.0-smoothstep(rise-0.22,rise,surfaceHeight))*(0.6+surfaceGrain*0.24);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.52,0.74,0.86),surfaceCoat);
        surfaceEmission=vec3(0.08,0.23,0.3)*surfaceVein*surfaceCoat*0.22;
      } else if(uSurfaceKind<2.5) {
        float sweepPosition=(surfaceHeight-uSurfaceAge*1.6)*8.0;
        float sweep=exp(-(sweepPosition*sweepPosition));
        surfaceCoat=surfaceFade*sweep*0.38;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.28,0.74,0.64),surfaceCoat);
        surfaceEmission=vec3(0.12,0.64,0.47)*(surfaceVein*0.5+sweep*0.32)*surfaceFade;
      } else if(uSurfaceKind<3.5) {
        float travel=pow(max(0.0,sin(surfaceP.y*18.0-uSurfaceAge*37.0+surfaceP.x*7.0)),8.0);
        surfaceEmission=vec3(0.23,0.53,0.9)*surfaceVein*travel*surfaceFade*1.1;
      } else if(uSurfaceKind<4.5) {
        surfaceCoat=surfaceFade*(0.3+surfaceVein*0.25);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.055,0.017,0.085),surfaceCoat);
        surfaceEmission=vec3(0.18,0.035,0.28)*surfaceVein*surfaceFade*0.38;
      } else if(uSurfaceKind<5.5) {
        float cut=1.0-smoothstep(0.012,0.09,abs(woundLine+sin(woundSide*37.0)*0.012));
        float torn=cut*(0.7+surfaceGrain*0.3)*surfaceFade;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.12,0.018,0.025),torn*0.8);
        surfaceEmission=vec3(1.0,0.66,0.32)*torn*pow(max(0.0,1.0-uSurfaceAge),3.0)*2.4;
      } else if(uSurfaceKind<6.5) {
        float shaft=1.0-smoothstep(0.04,0.12,abs(surfaceP.x));
        float arms=1.0-smoothstep(0.015,0.06,abs(surfaceHeight-0.63));
        float brand=max(shaft,arms)*smoothstep(0.1,0.3,surfaceHeight)*(1.0-smoothstep(0.85,1.0,surfaceHeight));
        float sweepDistance=(surfaceHeight-(1.0-uSurfaceAge))*9.0;
        float sweep=exp(-(sweepDistance*sweepDistance));
        surfaceCoat=surfaceFade*(brand*0.45+surfaceVein*0.12);
        surfaceEmission=vec3(1.0,0.62,0.12)*surfaceFade*(brand*0.95+sweep*0.55);
      } else if(uSurfaceKind<7.5) {
        float band=1.0-smoothstep(0.1,0.4,abs(surfaceHeight-uSurfaceContact.x));
        float fractures=surfaceVein*band*surfaceFade;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.085,0.07,0.055),fractures*0.85);
        surfaceEmission=vec3(1.0,0.72,0.36)*fractures*(1.0-uSurfaceAge)*2.3;
      } else if(uSurfaceKind<8.5) {
        float wound=1.0-smoothstep(0.018,0.085,abs(surfaceP.x+sin(surfaceHeight*15.0)*0.028));
        float puncture=wound*(1.0-smoothstep(0.12,0.32,abs(surfaceHeight-0.6)))*surfaceFade;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.10,0.018,0.03),puncture*0.9);
        surfaceEmission=vec3(0.65,0.85,1.0)*puncture*(1.0-uSurfaceAge)*2.2;
      } else if(uSurfaceKind<9.5) {
        float infection=surfaceVein*(1.0-smoothstep(0.12,0.4,abs(surfaceHeight-0.57)))*surfaceFade;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.055,0.12,0.025),infection*0.65);
        surfaceEmission=vec3(0.3,0.9,0.06)*infection*1.4;
      } else {
        float cut=1.0-smoothstep(0.008,0.043,abs(woundLine+sin(woundSide*53.0)*0.012));
        float dripLane=pow(max(0.0,sin(woundSide*73.0)),18.0);
        float seep=dripLane*smoothstep(-0.24*uSurfaceAge,-0.02,woundLine)*(1.0-smoothstep(-0.008,0.008,woundLine));
        float wound=max(cut,seep*0.7)*surfaceFade;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.16,0.004,0.012),wound*0.96);
        surfaceEmission=vec3(0.8,0.018,0.035)*cut*surfaceFade*pow(max(0.0,1.0-uSurfaceAge),2.0)*1.6;
      }
      // The held frost glaze (the Quench's cold, CharacterSurfaceResponse
      // setGlaze): the body's own colours chilled and filmed with rime from the
      // feet up to the height the cold has climbed, a ragged white front of
      // frost at its edge; its rim light, glints and bite are emission, below.
      float glazeCoat=0.0;
      if(uSurfaceGlaze.w>0.001) {
        float glazeEdge=uSurfaceGlaze.x+surfaceGrain*0.035+sin(surfaceP.x*17.0+surfaceP.z*13.0)*0.025;
        glazeCoat=(1.0-smoothstep(glazeEdge-0.16,glazeEdge,surfaceHeight))*uSurfaceGlaze.w;
        float glazeFrost=0.5+0.5*surfaceGrain;
        vec3 glazeIce=mix(vec3(0.5,0.72,0.92),vec3(0.84,0.93,1.0),glazeFrost);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.5,0.7,0.95)+glazeIce*0.3,glazeCoat*0.72);
        float glazeFront=(1.0-smoothstep(0.0,0.05,abs(surfaceHeight-glazeEdge+0.05)))*uSurfaceGlaze.w*step(glazeEdge,1.0);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.92,0.97,1.0),glazeFront*(0.35+0.3*glazeFrost));
        glazeCoat=max(glazeCoat,glazeFront);
      }
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nif(uSurfaceKind>0.5 && uSurfaceKind<1.5)roughnessFactor=mix(roughnessFactor,0.23,surfaceCoat);',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=surfaceEmission;',
    );
    // The glaze's own light (its cold rim, its glints, the bite's veins) joins the
    // emission after the lights, before three sums them, so the emissive stage the
    // merged head's tint pins stays exactly the hit response's.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      /* glsl */ `#include <lights_fragment_end>
      if(glazeCoat>0.001) {
        vec3 glazeView=normalize(vViewPosition);
        float glazeRim=1.0-clamp(abs(dot(normal,glazeView)),0.0,1.0);
        glazeRim*=glazeRim*glazeRim;
        // A glint is a point of rime in its cell (never the whole cell, which drew squares).
        vec3 glazeCell=floor(surfaceP*24.0);
        float glazeSeed=fract(sin(dot(glazeCell,vec3(12.9898,78.233,37.719)))*43758.5453);
        vec3 glazeAt=vec3(glazeSeed,fract(glazeSeed*13.7),fract(glazeSeed*71.3))*0.6+0.2;
        float glazePoint=1.0-smoothstep(0.03,0.13,length(fract(surfaceP*24.0)-glazeAt));
        float glazeTwinkle=fract(glazeSeed*7.0+dot(glazeView,vec3(3.1,5.7,4.3))+dot(surfaceP,vec3(1.3,0.7,1.1)));
        float glazeGlint=step(0.86,glazeSeed)*smoothstep(0.8,0.97,glazeTwinkle)*glazePoint;
        totalEmissiveRadiance+=vec3(0.42,0.72,1.0)*glazeCoat*(glazeRim*(0.35+0.45*uSurfaceGlaze.y)+glazeGlint*2.2);
        totalEmissiveRadiance+=vec3(0.62,0.9,1.0)*surfaceVein*uSurfaceGlaze.z*glazeCoat*0.9;
      }`,
    );
  };
  material.customProgramCacheKey = () => `${previousKey}:surface-response-v4`;
  return material;
}

/** Per-visual state with at most one clone per already-owned source material. */
export class CharacterSurfaceResponse {
  readonly materials = new Map<THREE.Material, THREE.Material>();
  readonly uniforms = surfaceResponseUniforms();
  private age = 0;
  private duration = 2.5;
  /** A hit's short treatment is running. */
  private transient = false;
  /** A held glaze (setGlaze) is on. */
  private glazed = false;
  /** Whether the rig wears the surface program (a hit's treatment or a held glaze). */
  get active(): boolean {
    return this.transient || this.glazed;
  }
  /** Hold a glaze over the body (the Quench's frost, quench_glaze_core.ts), or
   *  release it with null. True on the on/off edge: the rig re-mounts its
   *  materials then (the same program as every hit treatment, so it rides the
   *  same gated swap); while held, only the uniform moves. */
  setGlaze(glaze: { height: number; glow: number; bite: number; alpha: number } | null): boolean {
    const on = glaze !== null && glaze.alpha > 0.001;
    const was = this.active;
    this.glazed = on;
    if (glaze && on)
      this.uniforms.uSurfaceGlaze.value.set(glaze.height, glaze.glow, glaze.bite, glaze.alpha);
    else this.uniforms.uSurfaceGlaze.value.set(0, 0, 0, 0);
    return was !== this.active;
  }
  trigger(school: string, strength: number, contact?: MeleeImpactProfile): boolean {
    const kind =
      school === 'fire'
        ? 0
        : school === 'frost'
          ? 1
          : school === 'heal'
            ? 2
            : school === 'nature' || school === 'storm'
              ? 3
              : school === 'shadow'
                ? 4
                : school === 'physical'
                  ? 5
                  : school === 'holy' || school === 'holy-heal'
                    ? 6
                    : school === 'physical-crush'
                      ? 7
                      : school === 'physical-pierce'
                        ? 8
                        : school === 'physical-venom'
                          ? 9
                          : school === 'physical-blood'
                            ? 10
                            : -1;
    if (kind < 0 || !Number.isFinite(strength) || strength <= 0) return false;
    const edge = !this.active;
    this.transient = true;
    this.age = 0;
    this.duration =
      kind === 5 || kind >= 7
        ? 0.22
        : kind === 6
          ? 0.55
          : kind === 3
            ? 0.75
            : kind === 1
              ? 2.9
              : 2.5;
    this.uniforms.uSurfaceAge.value = 0;
    this.uniforms.uSurfaceKind.value = kind;
    this.uniforms.uSurfaceAmount.value = Math.min(0.95, strength);
    this.uniforms.uSurfaceContact.value.set(contact?.height ?? 0.56, contact?.angle ?? -0.28);
    return edge;
  }
  material(source: THREE.Material): THREE.Material {
    if (
      !(source as THREE.MeshStandardMaterial).isMeshStandardMaterial &&
      !(source as THREE.MeshLambertMaterial).isMeshLambertMaterial
    )
      return source;
    let material = this.materials.get(source);
    if (!material) {
      material = createSurfaceResponseMaterial(source, this.uniforms);
      this.materials.set(source, material);
    }
    return material;
  }
  update(dt: number, root: THREE.Object3D, height: number): boolean {
    if (!this.active) return false;
    root.getWorldPosition(this.uniforms.uSurfaceOrigin.value);
    const matrix = root.matrixWorld.elements;
    this.uniforms.uSurfaceRight.value.set(matrix[0], matrix[2]).normalize();
    this.uniforms.uSurfaceHeight.value = Math.max(0.1, height);
    if (!this.transient) return false;
    this.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.uniforms.uSurfaceAge.value = Math.min(1, this.age / this.duration);
    if (this.age < this.duration) return false;
    this.clear();
    // A held glaze keeps the program: nothing to re-mount.
    return !this.glazed;
  }
  /** End a hit's treatment (a held glaze stays). */
  clear(): void {
    this.transient = false;
    this.age = 0;
    this.uniforms.uSurfaceAmount.value = 0;
  }
}
