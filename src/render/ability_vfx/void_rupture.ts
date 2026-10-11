import * as THREE from 'three';
import {
  CAST_VFX_ENGINE,
  type CastVfxSpawnGate,
  OPEN_CAST_VFX_SPAWN_GATE,
  tagCastVfxEngine,
} from '../cast_vfx_family';
import { spellEffectsMutedBy } from '../spell_effects_switch';
import type { VfxAnchorResolver } from '../vfx_anchor';

export const VOID_RUPTURE_SLOTS = 6;
export const VOID_RUPTURE_LIFETIME = 1.05;
export const VOID_RUPTURE_SURFACE_OFFSET = 0.9;

// One prelinked program, no textures, lights, post-processing or live geometry.
// The slit is present from the first frame: compression never delays hit feedback.
const FRAGMENT = `
  varying vec2 vUv;
  uniform float uAge;
  uniform float uReduced;
  uniform float uQuality;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  void main() {
    vec2 p=(vUv-0.5)*2.0;
    float t=uAge;
    float motion=t*(1.0-uReduced);
    float fade=1.0-smoothstep(0.38,1.05,t);
    float peak=exp(-pow((t-0.16)*10.0,2.0));
    float jag=sin(p.y*23.0)*0.022+sin(p.y*51.0)*0.009;
    float taper=pow(max(0.0,1.0-abs(p.y)*1.38),0.7);
    float width=(0.016+peak*0.025)*taper;
    float d=abs(p.x-jag*taper);
    float slit=exp(-d/max(0.001,width))*taper;
    float rim=exp(-abs(d-width*2.5)*65.0)*taper;
    float r=length(p);
    float angle=atan(p.y,p.x);
    float field=noise(p*8.0+vec2(motion*1.3,-motion*2.0));
    float smoke=noise(p*15.0-vec2(motion*2.0,motion*0.7));
    float cloud=exp(-r*r*5.5)*smoothstep(0.35,0.75,field)*smoke;
    float inward=0.78*(1.0-clamp(t/0.16,0.0,1.0));
    float threads=pow(max(0.0,sin(angle*9.0+r*10.0+field*3.0)),18.0);
    float compression=threads*exp(-pow((r-inward)*9.0,2.0))*(1.0-smoothstep(0.12,0.2,t));
    float shockRadius=0.12+clamp((t-0.12)/0.32,0.0,1.0)*0.78;
    float shock=exp(-pow((r-shockRadius)*65.0,2.0))*exp(-max(0.0,t-0.16)*9.0)*step(0.12,t);
    shock*=0.45+0.55*pow(abs(sin(angle*7.0+field*2.0)),3.0);
    float shards=pow(max(0.0,sin(angle*17.0+field*0.7)),42.0)*exp(-pow((r-shockRadius*0.85)*13.0,2.0))*peak;
    float decor=uQuality*(1.0-uReduced);
    float edge=1.0-smoothstep(0.8,0.98,r);
    vec3 color=vec3(0.32,0.025,0.75)*cloud*2.0;
    color+=vec3(0.58,0.13,1.3)*(rim*0.55+decor*(compression*1.2+shock*0.8));
    color+=vec3(1.4,0.8,1.85)*(slit*(0.8+peak*1.2)+shards*decor);
    float alpha=clamp(slit+rim*0.45+cloud*0.5+decor*(compression+shock+shards),0.0,1.0)*fade*edge;
    if(alpha<0.003) discard;
    gl_FragColor=vec4(color,alpha);
  }`;

interface RuptureSlot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  age: number;
  sourceId: number;
}

/** Bounded impact snapshots remain visible if a killed target loses its view. */
export class VoidRuptures {
  spawnGate: CastVfxSpawnGate = OPEN_CAST_VFX_SPAWN_GATE;
  private readonly geometry = new THREE.PlaneGeometry(4.8, 4.8);
  private readonly slots: RuptureSlot[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
  ) {
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
    for (let i = 0; i < VOID_RUPTURE_SLOTS; i++) {
      const material = new THREE.ShaderMaterial({
        name: 'void-rupture-fissure',
        uniforms: {
          uAge: { value: 0 },
          uSurfaceOffset: { value: VOID_RUPTURE_SURFACE_OFFSET },
          uReduced: { value: 0 },
          uQuality: { value: 1 },
        },
        vertexShader:
          'varying vec2 vUv; uniform float uSurfaceOffset; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position+vec3(0.0,0.0,uSurfaceOffset),1.0);}',
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.name = `void-rupture-${i}`;
      mesh.visible = false;
      tagCastVfxEngine(mesh);
      scene.add(mesh);
      this.slots.push({ mesh, age: VOID_RUPTURE_LIFETIME, sourceId: -1 });
    }
  }

  spawn(sourceId: number, targetId: number): boolean {
    if (this.disposed || !this.spawnGate.allows(CAST_VFX_ENGINE) || spellEffectsMutedBy(sourceId))
      return false;
    const slot = this.slots.find((s) => s.age >= VOID_RUPTURE_LIFETIME);
    if (!slot || !this.anchor(targetId, 0.6, this.scratch)) return false;
    slot.mesh.position.copy(this.scratch);
    // Bounds follow the actual loaded rig height, so large creatures cannot
    // bury the slit in their torso. Missing extents retain the humanoid floor.
    const feet = this.anchor(targetId, 0, this.feet);
    const head = this.anchor(targetId, 1, this.head);
    const height = feet && head ? Math.abs(head.y - feet.y) : 0;
    slot.mesh.material.uniforms.uSurfaceOffset.value = Math.max(
      VOID_RUPTURE_SURFACE_OFFSET,
      Math.min(8, height * 0.35),
    );
    slot.sourceId = sourceId;
    slot.age = 0;
    return true;
  }

  update(dt: number, camera: THREE.Quaternion, reducedMotion = false, quality = 1): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.age >= VOID_RUPTURE_LIFETIME) continue;
      slot.age += Math.max(0, dt);
      if (!this.spawnGate.allows(CAST_VFX_ENGINE) || spellEffectsMutedBy(slot.sourceId))
        slot.age = VOID_RUPTURE_LIFETIME;
      slot.mesh.visible = slot.age < VOID_RUPTURE_LIFETIME;
      if (!slot.mesh.visible) continue;
      slot.mesh.quaternion.copy(camera);
      slot.mesh.material.uniforms.uAge.value = slot.age;
      slot.mesh.material.uniforms.uReduced.value = reducedMotion ? 1 : 0;
      slot.mesh.material.uniforms.uQuality.value = Math.max(0, Math.min(1, quality));
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.age = VOID_RUPTURE_LIFETIME;
      slot.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const slot of this.slots) {
      slot.mesh.removeFromParent();
      slot.mesh.material.dispose();
    }
    this.geometry.dispose();
  }
}
