import * as THREE from 'three';
import { bindSceneSamples, SCENE_SAMPLE_GLSL, sceneKeyLightUniform } from '../scene_sampling';
import { CrestPrewarm } from './crest_prewarm';
import { buildSignatureShapes, type CrestKind } from './signature_shapes';

/** Prepared crystalline fans, curling water sheets, flame ribbons and torn
 * spectral fins. Eight slots share cached geometry families and one program. */
export class SignatureCrests {
  readonly preparation: CrestPrewarm;
  private readonly shapes = buildSignatureShapes();
  private readonly slots: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    age: number;
    duration: number;
    active: boolean;
  }[] = [];
  private disposed = false;
  private readonly unbind: Array<() => void> = [];
  constructor(scene: THREE.Scene) {
    const initialGeometry = this.shapes.get('water');
    if (!initialGeometry) throw new Error('Missing water crest geometry');
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uAge: { value: 0 },
        uSunWorld: sceneKeyLightUniform(scene),
        uKind: { value: 0 },
        uMotion: { value: 1 },
        uTint: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
      },
      vertexShader: `uniform float uAge,uKind,uMotion; varying vec2 vUv; varying vec3 vNormal,vView;
        void main(){
          vUv=uv; vec3 p=position;
          float angle=atan(p.z,p.x);
          float lip=uKind<0.5 || uKind>3.5 ? 1.0 : 0.9+sin(angle*5.0-uAge*5.0*uMotion)*0.1;
          p.y*=lip;
          float expand=0.6+0.4*(1.0-pow(max(0.0,1.0-uAge),3.0));
          p.xz*=uKind>9.5 ? 1.0 : uKind>6.5 ? 0.86+0.14*smoothstep(0.0,0.25,uAge) : mix(0.88,expand,uMotion);
          p.y*=uKind>9.5 ? 1.0 : uKind>6.5 ? 0.96+0.04*smoothstep(0.0,0.2,uAge) : mix(0.85,sin(min(1.0,uAge*1.4)*3.14159265)*0.65+0.35,uMotion);
          if(uKind>11.5){p.z+=uAge*(0.2+uv.y*0.6)*uMotion;p.y-=uAge*uAge*0.55*uMotion;}
          vec4 view=modelViewMatrix*vec4(p,1.0); vView=-view.xyz; vNormal=normalize(normalMatrix*normal);
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: `${SCENE_SAMPLE_GLSL}
        uniform float uAge,uKind,uMotion; uniform vec3 uTint,uAccent,uSunWorld;
        varying vec2 vUv; varying vec3 vNormal,vView;
        void main(){
          float fresnel=pow(max(0.0,1.0-abs(dot(normalize(cross(dFdx(vView),dFdy(vView))),normalize(vView)))),3.0);
          float thread=sin(vUv.x*150.0+sin(vUv.y*22.0)*2.0-uAge*8.0*uMotion);
          float ribs=pow(max(0.0,thread),16.0);
          float tip=smoothstep(0.7,1.0,vUv.y);
          float holes=smoothstep(-0.65,0.1,sin(vUv.x*91.0+vUv.y*12.0));
          float fade=smoothstep(0.0,0.07,uAge)*(1.0-smoothstep(0.35,1.0,uAge));
          if(uKind>9.5)fade=smoothstep(0.0,0.03,uAge)*(1.0-smoothstep(0.86,1.0,uAge));
          float body=uKind<0.5?0.48:0.18;
          float alpha=(body+fresnel*0.4+ribs*0.2)*fade*mix(1.0,holes,step(1.5,uKind)*(1.0-step(3.5,uKind)));
          vec3 colour=uTint*(0.28+0.55*fresnel)+uAccent*(ribs*0.65+tip*0.5);
          if(uKind>4.5 && uKind<5.5){
            float vein=1.0-smoothstep(0.015,0.045,abs(vUv.x-0.5));
            colour=uTint*(0.38+fresnel*0.45)+uAccent*(vein*0.14+tip*0.08);
            alpha=(0.52+fresnel*0.22)*fade;
          }
          if(uKind>6.5){
            vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));
            vec3 eye=normalize(vView); if(dot(n,eye)<0.0)n=-n;
            vec3 sun=normalize((viewMatrix*vec4(uSunWorld,0.0)).xyz);
            float diffuse=0.3+0.7*max(0.0,dot(n,sun));
            float grain=sin(vUv.y*164.0+sin(vUv.x*37.0)*2.0)*0.035;
            colour=uTint*(diffuse+grain)+uAccent*fresnel*0.24;
            alpha=fade*(uKind<7.5?0.94:uKind<8.5?0.38+fresnel*0.35:0.76);
            if(uKind>8.5 && uKind<9.5){
              float shaft=1.0-smoothstep(0.015,0.04,abs(vUv.x-0.5));
              colour+=uAccent*shaft*0.22;
              alpha*=smoothstep(0.0,0.1,vUv.y)*(1.0-smoothstep(0.94,1.0,vUv.y));
            }
          }
          if(uKind>11.5){
            float taper=sin(vUv.x*3.14159265);
            float striation=sin(vUv.x*109.0+sin(vUv.y*17.0)*2.2);
            float tear=sin(vUv.x*67.0+vUv.y*19.0)*sin(vUv.x*31.0-vUv.y*13.0);
            float edge=1.0-smoothstep(0.015,0.08,vUv.y);
            float dissolve=smoothstep(uAge*1.2-0.2,uAge*1.2+0.15,1.0-vUv.y*0.65+tear*0.28);
            colour=colour*(0.82+striation*0.12)+uAccent*edge*0.85;
            alpha=0.92*dissolve*smoothstep(0.0,0.16,taper)*(1.0-smoothstep(0.68,1.0,uAge));
          }
          gl_FragColor=vec4(colour,alpha*sceneSoftness(vView.z,0.12));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(initialGeometry, proto.clone());
      mesh.material.uniforms.uSunWorld = sceneKeyLightUniform(scene);
      this.unbind.push(bindSceneSamples(scene, mesh));
      mesh.name = 'signatureCrest';
      mesh.visible = false;
      mesh.userData.renderCategory = 'vfx';
      mesh.renderOrder = 4;
      // Shader animation can move the surface beyond its prepared bounds.
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({ mesh, age: 0, duration: 1.15, active: false });
    }
    this.preparation = new CrestPrewarm(scene, this.shapes, this.slots[0].mesh.material);
    proto.dispose();
  }
  spawn(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    tint: number,
    accent: number,
    kind: CrestKind,
    angle = 0,
    duration = 1.15,
    pitch = 0,
  ): void {
    if (
      this.disposed ||
      ![x, y, z, radius, height, angle, pitch].every(Number.isFinite) ||
      radius <= 0 ||
      height <= 0
    )
      return;
    if (kind === 'blood_cut' && !this.preparation.ready(kind)) return;
    const s = this.slots.find((s) => !s.active);
    if (!s) return;
    s.active = true;
    s.age = 0;
    s.duration = Number.isFinite(duration) ? Math.max(0.05, duration) : 1.15;
    s.mesh.visible = kind === 'blood_cut';
    const geometry = this.shapes.get(kind) ?? this.shapes.get('shadow');
    if (geometry) s.mesh.geometry = geometry;
    s.mesh.rotation.set(pitch, angle, 0, 'YXZ');
    if (kind === 'blood_cut') s.mesh.rotation.set(0, angle, pitch, 'YXZ');
    s.mesh.position.set(x, y, z);
    s.mesh.scale.set(Math.min(3, radius), Math.min(3, height), Math.min(3, radius));
    if (kind === 'chain') s.mesh.scale.set(height, height, radius);
    const u = s.mesh.material.uniforms;
    u.uTint.value.setHex(tint);
    u.uAccent.value.setHex(accent);
    u.uKind.value =
      kind === 'blood_cut'
        ? 12
        : kind === 'chain'
          ? 11
          : kind === 'hook'
            ? 10
            : kind === 'bone'
              ? 7
              : kind === 'ward'
                ? 8
                : kind === 'feather'
                  ? 9
                  : kind === 'ice'
                    ? 0
                    : kind === 'water'
                      ? 1
                      : kind === 'fire'
                        ? 3
                        : kind === 'light'
                          ? 4
                          : kind === 'nature'
                            ? 5
                            : kind === 'arcane'
                              ? 6
                              : 2;
    u.uAge.value = 0;
  }
  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      s.active = s.age < s.duration;
      s.mesh.visible = s.active;
      s.mesh.material.uniforms.uAge.value = Math.min(1, s.age / s.duration);
      s.mesh.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
    }
  }
  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    const errors: unknown[] = [];
    const release = (work: () => void) => {
      try {
        work();
      } catch (error) {
        errors.push(error);
      }
    };
    release(() => this.preparation.dispose());
    for (const unbind of this.unbind) release(unbind);
    for (const s of this.slots) {
      release(() => s.mesh.removeFromParent());
      release(() => s.mesh.material.dispose());
    }
    for (const geometry of this.shapes.values()) release(() => geometry.dispose());
    if (errors.length) throw new AggregateError(errors, 'Signature crest cleanup failed');
  }
}
