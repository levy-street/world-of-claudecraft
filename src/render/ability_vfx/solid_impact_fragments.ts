import * as THREE from 'three';
import { sceneKeyLightUniform } from '../scene_sampling';
import { type FragmentKind, fragmentGeometry } from './production_assets';

const PER_KIND = 32;
const KINDS = ['ice_shard', 'stone_chip', 'metal_splinter'] as const;
interface Batch {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  ends: Float64Array;
}
/** Three capped solid draws. Faceted models are prepared offline; trajectories,
 * tumbling, a single damped bounce and shrink-out run entirely on the GPU. */
export class SolidImpactFragments {
  private readonly batches = new Map<FragmentKind, Batch>();
  private readonly color = new THREE.Color();
  private time = 0;
  private serial = 0;
  private disposed = false;
  constructor(scene: THREE.Scene) {
    for (const kind of KINDS) {
      const source = fragmentGeometry(kind);
      if (!source) continue;
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute('position', source.getAttribute('position').clone());
      geometry.setAttribute('normal', source.getAttribute('normal').clone());
      if (source.index) geometry.setIndex(source.index.clone());
      for (const name of ['aOrigin', 'aVelocity', 'aTint'])
        geometry.setAttribute(
          name,
          new THREE.InstancedBufferAttribute(new Float32Array(PER_KIND * 3), 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
      for (const name of ['aLife', 'aShape'])
        geometry.setAttribute(
          name,
          new THREE.InstancedBufferAttribute(new Float32Array(PER_KIND * 4), 4).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
      geometry.instanceCount = PER_KIND;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uSun: sceneKeyLightUniform(scene),
          uTime: { value: 0 },
          uMotion: { value: 1 },
          uCrystal: { value: kind === 'ice_shard' ? 1 : kind === 'metal_splinter' ? 0.5 : 0 },
        },
        vertexShader: `attribute vec3 aOrigin,aVelocity,aTint;attribute vec4 aLife,aShape;uniform float uTime,uMotion;uniform vec3 uSun;varying vec3 vNormal,vView,vTint,vLight;varying float vFade;
        void main(){float age=uTime-aLife.x;float life=aLife.y;float p=clamp(age/max(life,0.001),0.,1.);float live=step(0.,age)*(1.-step(life,age))*step(0.001,life);float t=age*uMotion;
          float gravity=12.;float floorY=aShape.w;float fall=aOrigin.y-floorY;float hit=(aVelocity.y+sqrt(max(0.,aVelocity.y*aVelocity.y+2.*gravity*fall)))/gravity;
          float after=max(0.,t-hit);float bounceV=0.24*max(0.,gravity*hit-aVelocity.y);
          vec3 travel=aVelocity*t;travel.y-=0.5*gravity*t*t;
          if(t>hit){travel.xz=aVelocity.xz*(hit+after*0.3);travel.y=floorY-aOrigin.y+max(0.,bounceV*after-0.5*gravity*after*after);}
          float angle=aLife.w+t*5.;float c=cos(angle),s=sin(angle);mat3 rot=mat3(c,0.,s,s*0.6,0.8,-c*0.6,-s*0.8,0.6,c*0.8);
          float shrink=1.-smoothstep(0.66,1.,p);vec3 local=rot*(position*aShape.xyz)*aLife.z*shrink*live;
          vec4 view=modelViewMatrix*vec4(aOrigin+travel+local,1.);vNormal=normalize(normalMatrix*rot*(normal/max(aShape.xyz,vec3(0.001))));vView=-view.xyz;vTint=aTint;vLight=mat3(viewMatrix)*uSun;vFade=live;gl_Position=projectionMatrix*view;
          if(live<0.5)gl_Position=vec4(2.,2.,2.,1.);
        }`,
        fragmentShader: `uniform float uCrystal;varying vec3 vNormal,vView,vTint,vLight;varying float vFade;void main(){if(vFade<0.5)discard;vec3 n=normalize(vNormal);vec3 light=normalize(vLight);float diffuse=0.24+0.76*max(0.,dot(n,light));float fresnel=pow(max(0.,1.-abs(dot(n,normalize(vView)))),3.);float spec=pow(max(0.,dot(reflect(-light,n),normalize(vView))),38.);vec3 colour=vTint*diffuse+vec3(0.75,0.9,1.)*(spec*(0.22+uCrystal*0.7)+fresnel*uCrystal*0.26);gl_FragColor=vec4(colour,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `solidImpact:${kind}`;
      mesh.userData.renderCategory = 'vfx';
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.batches.set(kind, { mesh, ends: new Float64Array(PER_KIND) });
    }
  }
  burst(
    kind: FragmentKind,
    x: number,
    y: number,
    z: number,
    tint: number,
    count: number,
    power: number,
    dx: number,
    dz: number,
    ground: (x: number, z: number) => number,
    lifetime?: number,
  ): number {
    if (this.disposed || ![x, y, z, count, power, dx, dz].every(Number.isFinite)) return 0;
    const batch = this.batches.get(kind);
    if (!batch) return 0;
    const g = batch.mesh.geometry;
    const origin = g.getAttribute('aOrigin') as THREE.InstancedBufferAttribute,
      velocity = g.getAttribute('aVelocity') as THREE.InstancedBufferAttribute,
      life = g.getAttribute('aLife') as THREE.InstancedBufferAttribute,
      shape = g.getAttribute('aShape') as THREE.InstancedBufferAttribute,
      tints = g.getAttribute('aTint') as THREE.InstancedBufferAttribute;
    const length = Math.hypot(dx, dz);
    dx = length > 0.01 ? dx / length : 0;
    dz = length > 0.01 ? dz / length : 0;
    this.color.setHex(tint);
    let n = 0;
    const amount = Math.min(14, Math.max(0, Math.floor(count))),
      force = Math.min(1.6, Math.max(0.3, power));
    const seed = ++this.serial;
    for (let i = 0; i < PER_KIND && n < amount; i++) {
      if (batch.ends[i] > this.time) continue;
      const phase = (seed * 1.618 + n) * 2.399963,
        radial = 1.2 + ((n * 7 + seed) % 9) * 0.17;
      const vx = (Math.cos(phase) * radial + dx * 1.4) * force,
        vz = (Math.sin(phase) * radial + dz * 1.4) * force,
        vy = (2.2 + (n % 4) * 0.65) * force;
      const floor = ground(x + vx * 0.65, z + vz * 0.65);
      if (!Number.isFinite(floor)) continue;
      const startY = Math.max(y, floor + 0.08),
        duration =
          lifetime !== undefined && Number.isFinite(lifetime)
            ? Math.max(0.05, lifetime)
            : 1.45 + (n % 3) * 0.28,
        size = (kind === 'ice_shard' ? 0.22 : 0.13) * (0.7 + (n % 5) * 0.17) * force;
      origin.setXYZ(i, x, startY, z);
      velocity.setXYZ(i, vx, vy, vz);
      life.setXYZW(i, this.time, duration, size, phase);
      shape.setXYZW(i, 0.65 + (n % 3) * 0.15, kind === 'ice_shard' ? 1.7 : 1, 0.7, floor + 0.025);
      tints.setXYZ(i, this.color.r, this.color.g, this.color.b);
      for (const attribute of [origin, velocity, life, shape, tints])
        attribute.addUpdateRange(i * attribute.itemSize, attribute.itemSize);
      batch.ends[i] = this.time + duration;
      n++;
    }
    if (n) {
      for (const attribute of [origin, velocity, life, shape, tints]) attribute.needsUpdate = true;
      batch.mesh.visible = true;
    }
    return n;
  }
  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.time += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const b of this.batches.values()) {
      b.mesh.material.uniforms.uTime.value = this.time;
      b.mesh.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
      b.mesh.visible = false;
      for (const end of b.ends) {
        if (end > this.time) {
          b.mesh.visible = true;
          break;
        }
      }
    }
  }
  clear(): void {
    for (const b of this.batches.values()) {
      b.ends.fill(0);
      b.mesh.visible = false;
      (b.mesh.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute).array.fill(0);
      b.mesh.geometry.getAttribute('aLife').needsUpdate = true;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const b of this.batches.values()) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.batches.clear();
  }
}
