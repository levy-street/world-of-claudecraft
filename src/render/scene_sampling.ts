import * as THREE from 'three';
import { SUN_DIR } from './gfx';

/** One scene-owned uniform service. Copies opaque attachments before transparent
 * draws, never samples the attachment currently being written. Direct output
 * deliberately retains the material's unsampled fallback. */
class SceneSamples {
  readonly uniforms = {
    uSunWorld: { value: SUN_DIR.clone() },
    uOpaqueColor: { value: null as THREE.Texture | null },
    uOpaqueDepth: { value: null as THREE.Texture | null },
    uSceneReady: { value: 0 },
    uSceneExtent: { value: new THREE.Vector4(1, 1, 1, 1) },
    uSceneClip: { value: new THREE.Vector2(0.1, 1000) },
  };
  readonly consumers = new Set<THREE.Object3D>();
}
const services = new WeakMap<THREE.Scene, SceneSamples>();
function samples(scene: THREE.Scene): SceneSamples {
  let service = services.get(scene);
  if (!service) {
    service = new SceneSamples();
    services.set(scene, service);
  }
  return service;
}

export function sceneKeyLightUniform(scene: THREE.Scene): { value: THREE.Vector3 } {
  return samples(scene).uniforms.uSunWorld;
}

export function bindSceneSamples(
  scene: THREE.Scene,
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
): () => void {
  const service = samples(scene);
  Object.assign(mesh.material.uniforms, service.uniforms);
  service.consumers.add(mesh);
  return () => service.consumers.delete(mesh);
}

export const SCENE_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uOpaqueColor, uOpaqueDepth;
uniform float uSceneReady;
uniform vec4 uSceneExtent;
uniform vec2 uSceneClip;
vec2 sceneUv(){return clamp(gl_FragCoord.xy*uSceneExtent.xy,
  uSceneExtent.xy*0.5,uSceneExtent.zw-uSceneExtent.xy*0.5);}
float sceneDepth(vec2 uv){float d=texture2D(uOpaqueDepth,uv).r;
  return uSceneClip.x*uSceneClip.y/(uSceneClip.y-d*(uSceneClip.y-uSceneClip.x));}
float sceneSoftness(float viewDepth,float width){
  if(uSceneReady<0.5)return 1.;
  return smoothstep(0.,width,max(0.,sceneDepth(sceneUv())-viewDepth));
}
vec3 sceneRefract(vec3 colour,vec2 offset,float viewDepth,float amount){
  if(uSceneReady<0.5 || amount<=0.)return colour;
  vec2 uv=sceneUv();
  vec2 edge=min(uv,uSceneExtent.zw-uv)/uSceneExtent.xy;
  offset*=smoothstep(1.,18.,min(edge.x,edge.y));
  vec2 shifted=clamp(uv+offset*uSceneExtent.xy,uSceneExtent.xy*0.5,
    uSceneExtent.zw-uSceneExtent.xy*0.5);
  if(sceneDepth(shifted)<viewDepth+0.04)shifted=uv;
  return mix(colour,texture2D(uOpaqueColor,shifted).rgb,amount);
}`;

export class OpaqueSceneCapture {
  private readonly service: SceneSamples;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly group = new THREE.Group();
  private readonly sentinel: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private disposed = false;
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    width: number,
    height: number,
  ) {
    this.service = samples(scene);
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
      samples: 0,
    });
    this.target.texture.name = 'vfxOpaqueColour';
    this.target.depthTexture!.name = 'vfxOpaqueDepth';
    this.renderer.initRenderTarget(this.target);
    this.service.uniforms.uOpaqueColor.value = this.target.texture;
    this.service.uniforms.uOpaqueDepth.value = this.target.depthTexture;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(0.,0.,0.,1.);}',
      fragmentShader: 'void main(){gl_FragColor=vec4(0.);}',
      transparent: true,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
    });
    this.sentinel = new THREE.Mesh(geometry, material);
    this.sentinel.name = 'opaqueVfxCapture';
    this.sentinel.userData.renderCategory = 'vfx';
    this.sentinel.frustumCulled = false;
    this.sentinel.renderOrder = -Infinity;
    this.group.renderOrder = -Infinity;
    this.group.add(this.sentinel);
    scene.add(this.group);
    this.sentinel.onBeforeRender = (_renderer, _scene, camera) => this.capture(camera);
  }
  begin(): void {
    this.service.uniforms.uSceneReady.value = 0;
  }
  setSize(width: number, height: number): void {
    if (this.disposed) return;
    this.begin();
    this.target.setSize(width, height);
    this.renderer.initRenderTarget(this.target);
  }
  private capture(camera: THREE.Camera): void {
    this.begin();
    if (this.disposed) return;
    let active = false;
    for (const mesh of this.service.consumers) {
      if (mesh.visible && mesh.parent?.visible) {
        active = true;
        break;
      }
    }
    if (!active) return;
    const source = this.renderer.getRenderTarget();
    if (
      !source?.depthTexture ||
      source.samples !== 0 ||
      source.width !== this.target.width ||
      source.height !== this.target.height
    )
      return;
    const perspective = camera as THREE.PerspectiveCamera;
    if (!perspective.isPerspectiveCamera) return;
    const u = this.service.uniforms;
    u.uSceneClip.value.set(perspective.near, perspective.far);
    u.uSceneExtent.value.set(
      1 / source.width,
      1 / source.height,
      source.viewport.z / source.width,
      source.viewport.w / source.height,
    );
    try {
      this.renderer.copyTextureToTexture(source.texture, this.target.texture);
      this.renderer.copyTextureToTexture(source.depthTexture, this.target.depthTexture!);
      u.uSceneReady.value = 1;
    } finally {
      this.renderer.setRenderTarget(source);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.begin();
    this.service.uniforms.uOpaqueColor.value = null;
    this.service.uniforms.uOpaqueDepth.value = null;
    this.sentinel.onBeforeRender = () => {};
    const errors: unknown[] = [];
    for (const release of [
      () => this.group.removeFromParent(),
      () => this.sentinel.geometry.dispose(),
      () => this.sentinel.material.dispose(),
      () => this.target.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Opaque scene capture cleanup failed');
  }
}
