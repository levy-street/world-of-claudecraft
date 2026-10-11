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
      uniform vec2 uSurfaceContact,uSurfaceRight;\n` + shader.fragmentShader;
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
  active = false;
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
    this.active = true;
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
    this.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    root.getWorldPosition(this.uniforms.uSurfaceOrigin.value);
    const matrix = root.matrixWorld.elements;
    this.uniforms.uSurfaceRight.value.set(matrix[0], matrix[2]).normalize();
    this.uniforms.uSurfaceHeight.value = Math.max(0.1, height);
    this.uniforms.uSurfaceAge.value = Math.min(1, this.age / this.duration);
    if (this.age < this.duration) return false;
    this.clear();
    return true;
  }
  clear(): void {
    this.active = false;
    this.age = 0;
    this.uniforms.uSurfaceAmount.value = 0;
  }
}
