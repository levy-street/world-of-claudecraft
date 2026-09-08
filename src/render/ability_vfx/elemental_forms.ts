import * as THREE from 'three';
import { SUN_DIR } from '../gfx';
import { bindSceneSamples, SCENE_SAMPLE_GLSL } from '../scene_sampling';
import { buildElementalForm } from './elemental_form_geometry';
import type { ElementalForm } from './elemental_performance_core';

const FORMS: ElementalForm[] = [
  'pyre',
  'glacier',
  'thunder',
  'tide',
  'rift',
  'judgement',
  'fault',
  'grove',
];
const CAPACITY = 12;
interface FormSlot {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  age: number;
  duration: number;
  active: boolean;
}

/** Prepared geometry and one common material program. Every piece grows from
 * its own foot, holds a readable silhouette, and has a material-specific exit.
 * The family is decorative and never substitutes for a real area telegraph. */
export class ElementalForms {
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  private readonly slots: FormSlot[] = [];
  private readonly unbind: Array<() => void> = [];
  private disposed = false;
  constructor(scene: THREE.Scene) {
    for (const form of FORMS)
      for (const detail of [false, true])
        this.geometry.set(`${form}:${detail}`, buildElementalForm(form, detail));
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uAge: { value: 0 },
        uKind: { value: 0 },
        uMotion: { value: 1 },
        uTint: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
        uSunWorld: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter, aPiece;
        uniform float uAge, uKind, uMotion;
        varying vec3 vView, vLocal, vSmoothNormal;
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          float t = clamp((uAge-aPiece.y)/max(0.01,1.0-aPiece.y),0.0,1.0);
          float grow = 1.0-pow(max(0.0,1.0-smoothstep(0.0,0.2,t)),3.0);
          vec3 local = position-aCenter;
          vec3 surfaceNormal=normal;
          vec3 p = aCenter+local*grow;
          if(uKind>0.5 && uKind<1.5 || uKind>5.5 && uKind<6.5) {
            float fracture=smoothstep(0.52,0.92,t)*uMotion;
            float angle=fracture*(aPiece.x-0.5)*3.2;
            local.xy=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*local.xy;
            vec3 fly=vec3(aCenter.x*0.72,0.5+aPiece.x,aCenter.z*0.72);
            p=aCenter+local*grow+fly*fracture;
            p.y-=fracture*fracture*1.45;
          } else if(uKind>2.5 && uKind<3.5 || uKind>6.5) {
            float gather=smoothstep(0.0,0.35,t), drain=smoothstep(0.58,1.0,t);
            float twist=(gather*0.48+drain*1.25)*uMotion;
            p.xz=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*p.xz;
            surfaceNormal.xz=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*surfaceNormal.xz;
            surfaceNormal/=max(vec3(0.08),vec3(1.0-drain*0.7,grow*(1.0-drain*0.16),1.0-drain*0.7));
            p.xz*=1.0-drain*0.7*uMotion;
            p.y*=grow*(1.0-drain*0.16);
            p.xz+=sin(vec2(p.y*9.0,p.y*7.0)+t*13.0)*0.025*uMotion;
          } else if(uKind>3.5 && uKind<4.5) {
            float close=smoothstep(0.68,1.0,t);
            p.x*=grow*(1.0-close*0.97);
            p.z+=sin(p.y*5.0+aPiece.x*13.0-t*8.0)*0.055*uMotion;
          } else if(uKind<0.5) {
            p.y+=smoothstep(0.15,1.0,t)*(0.3+aPiece.x)*uMotion;
            float swirl=t*1.6*uMotion;
            p.xz=mat2(cos(swirl),-sin(swirl),sin(swirl),cos(swirl))*p.xz;
            p.xz*=0.82+0.32*grow;
          } else if(uKind>4.5 && uKind<5.5) {
            p.y*=grow;
            p.y+=smoothstep(0.45,1.0,t)*0.7*uMotion;
          }
          vLocal=p; vUv=uv; vSeed=aPiece.x; vSmoothNormal=normalMatrix*surfaceNormal;
          vec4 view=modelViewMatrix*vec4(p,1.0); vView=-view.xyz;
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: /* glsl */ `${SCENE_SAMPLE_GLSL}
        uniform float uAge,uKind,uMotion;
        uniform vec3 uTint,uAccent,uSunWorld;
        varying vec3 vView,vLocal,vSmoothNormal;
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));
          if(uKind>2.5 && uKind<3.5)n=normalize(vSmoothNormal);
          vec3 eye=normalize(vView);
          if(dot(n,eye)<0.0)n=-n;
          vec3 sun=normalize((viewMatrix*vec4(uSunWorld,0.0)).xyz);
          float diffuse=0.25+0.75*max(0.0,dot(n,sun));
          float rim=pow(max(0.0,1.0-max(0.0,dot(n,eye))),3.0);
          vec3 halfDirection=sun+eye;
          halfDirection*=inversesqrt(max(0.000001,dot(halfDirection,halfDirection)));
          float glint=pow(max(0.0,dot(n,halfDirection)),72.0);
          float flow=sin(vUv.x*87.0+sin(vUv.y*31.0)*2.0-uAge*21.0*uMotion+vSeed*9.0);
          float vein=pow(max(0.0,flow),18.0);
          float fade=smoothstep(0.0,0.025,uAge)*(1.0-smoothstep(0.72,1.0,uAge));
          vec3 colour=uTint*(0.28+diffuse*0.5)+uAccent*(rim*0.48+glint*0.5);
          float alpha=0.8;
          if(uKind<0.5) {
            float ember=pow(max(0.0,sin(vUv.x*21.0-uAge*11.0+vSeed*17.0)*sin(vUv.y*13.0+uAge*5.0)),2.0);
            float holes=smoothstep(-0.5,0.25,flow+0.7*(1.0-uAge));
            colour=mix(uTint*0.18,vec3(1.5,0.48,0.045),ember)*(1.0-uAge*0.6);
            alpha=(0.12+ember*0.32)*holes;
          } else if(uKind<1.5) {
            colour=uTint*(0.12+diffuse*0.36)+uAccent*(rim*0.6+glint*1.15+vein*0.035);
            colour=sceneRefract(colour,n.xy*5.0*uMotion,vView.z,(1.0-rim)*0.34*uMotion);
            alpha=0.76+rim*0.12;
          } else if(uKind<2.5) {
            float pulse=0.66+0.34*pow(max(0.0,sin(uAge*37.0+vSeed*13.0)),4.0);
            colour=mix(uTint,uAccent,0.72)*2.0;
            alpha=pulse;
          } else if(uKind<3.5) {
            colour=uTint*(0.18+diffuse*0.46)+uAccent*(rim*0.6+glint*1.35+vein*0.06);
            colour=sceneRefract(colour,n.xy*8.0*uMotion,vView.z,(1.0-rim)*0.42*uMotion);
            alpha=0.62+rim*0.22;
          } else if(uKind<4.5) {
            float center=1.0-smoothstep(0.65,1.05,length(vec2(vLocal.x,(vLocal.y-1.25)/1.4)));
            colour=mix(uTint*0.3+uAccent*(rim*0.5+vein*0.2),uTint*0.008,center*0.98);
            alpha=0.85+center*0.13;
          } else if(uKind<5.5) {
            colour=uTint*(0.58+diffuse*0.55)+uAccent*(0.18+glint+vein*0.32);
            alpha=0.85;
          } else if(uKind<6.5) {
            colour=uTint*(0.18+diffuse*0.55)+uAccent*vein*0.035;
            alpha=1.0;
          } else {
            colour=uTint*(0.3+diffuse*0.6)+uAccent*(rim*0.42+vein*0.38);
          }
          gl_FragColor=vec4(colour,alpha*fade*sceneSoftness(vView.z,0.12));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    for (let i = 0; i < CAPACITY; i++) {
      const mesh = new THREE.Mesh(this.geometry.get('glacier:true')!, proto.clone());
      mesh.name = 'elementalSculpture';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.userData.renderCategory = 'vfx';
      mesh.renderOrder = 4;
      this.unbind.push(bindSceneSamples(scene, mesh));
      scene.add(mesh);
      this.slots.push({ mesh, age: 0, duration: 1, active: false });
    }
    proto.dispose();
  }
  spawn(
    kind: ElementalForm,
    x: number,
    y: number,
    z: number,
    size: number,
    duration: number,
    tint: number,
    accent: number,
    angle: number,
    detail: boolean,
  ): boolean {
    if (
      this.disposed ||
      ![x, y, z, size, duration, angle].every(Number.isFinite) ||
      size <= 0 ||
      duration <= 0
    )
      return false;
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return false;
    slot.active = true;
    slot.age = 0;
    slot.duration = Math.min(4, duration);
    slot.mesh.geometry = this.geometry.get(`${kind}:${detail}`)!;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.set(0, angle, 0);
    slot.mesh.scale.setScalar(Math.min(2, size));
    slot.mesh.visible = false;
    const u = slot.mesh.material.uniforms;
    u.uKind.value = FORMS.indexOf(kind);
    u.uAge.value = 0;
    u.uTint.value.setHex(tint);
    u.uAccent.value.setHex(accent);
    return true;
  }
  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += step;
      slot.active = slot.age < slot.duration;
      slot.mesh.visible = slot.active;
      slot.mesh.material.uniforms.uAge.value = Math.min(1, slot.age / slot.duration);
      slot.mesh.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
    }
  }
  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const unbind of this.unbind) unbind();
    for (const slot of this.slots) {
      slot.mesh.removeFromParent();
      slot.mesh.material.dispose();
    }
    for (const geometry of this.geometry.values()) geometry.dispose();
  }
}
