import * as THREE from 'three';
import { bindSceneSamples, SCENE_SAMPLE_GLSL, sceneKeyLightUniform } from '../scene_sampling';
import { CrestPrewarm } from './crest_prewarm';
import { warriorPressureTexture } from './production_assets';
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
    pressure: boolean;
  }[] = [];
  private disposed = false;
  private reducedMotion = false;
  private readonly unbind: Array<() => void> = [];
  constructor(
    scene: THREE.Scene,
    private readonly groundY?: (x: number, z: number) => number,
  ) {
    const initialGeometry = this.shapes.get('water');
    if (!initialGeometry) throw new Error('Missing water crest geometry');
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uAge: { value: 0 },
        uPressureMap: { value: null },
        uSunWorld: sceneKeyLightUniform(scene),
        uKind: { value: 0 },
        uMotion: { value: 1 },
        uPressureGround: { value: new Float32Array(25) },
        uTint: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
      },
      vertexShader: `uniform float uAge,uKind,uMotion,uPressureGround[25]; varying vec2 vUv; varying vec3 vNormal,vView;
        float pressureGround(vec2 p){
          vec2 grid=clamp(vec2(p.x/12.0+0.5,p.y/10.0)*4.0,vec2(0.0),vec2(3.9999));
          ivec2 cell=ivec2(floor(grid));vec2 f=fract(grid);int i=cell.y*5+cell.x;
          return mix(mix(uPressureGround[i],uPressureGround[i+1],f.x),
            mix(uPressureGround[i+5],uPressureGround[i+6],f.x),f.y);
        }
        void main(){
          vUv=uv; vec3 p=position;
          float angle=atan(p.z,p.x);
          float lip=uKind<0.5 || uKind>3.5 ? 1.0 : 0.9+sin(angle*5.0-uAge*5.0*uMotion)*0.1;
          p.y*=lip;
          float expand=0.6+0.4*(1.0-pow(max(0.0,1.0-uAge),3.0));
          p.xz*=uKind>9.5 ? 1.0 : uKind>6.5 ? 0.86+0.14*smoothstep(0.0,0.25,uAge) : mix(0.88,expand,uMotion);
          p.y*=uKind>9.5 ? 1.0 : uKind>6.5 ? 0.96+0.04*smoothstep(0.0,0.2,uAge) : mix(0.85,sin(min(1.0,uAge*1.4)*3.14159265)*0.65+0.35,uMotion);
          if(uKind>11.5 && uKind<12.5){
            float peel=uv.y*uv.y*uAge*uMotion;
            p.z+=uAge*uv.y*(0.2+uv.y*0.6)*uMotion+sin(uv.x*9.0+uv.y*3.0)*peel*0.3;
            p.x+=(uv.x-0.5)*peel*0.7;
            p.y-=uAge*uAge*uv.y*(0.35+uv.y*0.45)*uMotion;
          }
          if(uKind>12.5){
            float advance=mix(0.72,0.38+0.62*(1.0-pow(1.0-uAge,3.0)),uMotion);
            p.xz*=advance;
            p.y*=mix(1.0,0.62+0.38*sin(min(1.0,uAge*1.3)*3.14159265),uMotion);
            p.y+=sin(uv.x*19.0+uv.y*8.0-uAge*7.0)*uv.y*0.045*uMotion;
            p.y+=pressureGround(p.xz);
          }
          vec4 view=modelViewMatrix*vec4(p,1.0); vView=-view.xyz; vNormal=normalize(normalMatrix*normal);
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: `${SCENE_SAMPLE_GLSL}
        uniform sampler2D uPressureMap; uniform float uAge,uKind,uMotion; uniform vec3 uTint,uAccent,uSunWorld;
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
          if(uKind>11.5 && uKind<12.5){
            float taper=sin(vUv.x*3.14159265);
            float striation=sin(vUv.x*109.0+sin(vUv.y*17.0)*2.2);
            float tear=sin(vUv.x*67.0+vUv.y*19.0)*sin(vUv.x*31.0-vUv.y*13.0);
            float edge=1.0-smoothstep(0.015,0.08,vUv.y);
            float dissolve=smoothstep(uAge*1.2-0.2,uAge*1.2+0.15,1.0-vUv.y*0.65+tear*0.28);
            float perforation=sin(vUv.x*91.0+vUv.y*23.0)*sin(vUv.x*47.0-vUv.y*19.0);
            float ragged=smoothstep(-0.42,0.12,perforation+0.5-vUv.y*0.9-uAge*0.85);
            float film=mix(1.0,ragged,smoothstep(0.18,0.65,vUv.y));
            float vein=pow(max(0.0,striation),5.0)*(1.0-vUv.y)*0.16;
            colour=colour*(0.82+striation*0.12)+uAccent*(edge*0.85+vein);
            alpha=0.94*film*dissolve*smoothstep(0.0,0.16,taper)*(1.0-smoothstep(0.68,1.0,uAge));
          }
          if(uKind>12.5){
            vec2 flowUv=vUv;
            flowUv.y+=sin(vUv.x*13.0-uAge*4.0)*0.012*uMotion*uAge;
            float density=texture2D(uPressureMap,clamp(flowUv,vec2(0.0),vec2(1.0))).r;
            float dissolution=smoothstep(uAge*0.9-0.35,uAge*0.9+0.1,density);
            colour=mix(uTint*(0.8+density*0.6),uAccent*1.3,pow(density,2.5));
            alpha=density*0.72*dissolution*(1.0-smoothstep(0.55,1.0,uAge));
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
      mesh.material.uniforms.uPressureMap.value = warriorPressureTexture();
      mesh.material.uniforms.uPressureGround.value = new Float32Array(25);
      this.unbind.push(bindSceneSamples(scene, mesh));
      mesh.name = 'signatureCrest';
      mesh.visible = false;
      mesh.userData.renderCategory = 'vfx';
      mesh.renderOrder = 4;
      // Shader animation can move the surface beyond its prepared bounds.
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({ mesh, age: 0, duration: 1.15, active: false, pressure: false });
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
  ): boolean {
    if (
      this.disposed ||
      ![x, y, z, radius, height, angle, pitch].every(Number.isFinite) ||
      radius <= 0 ||
      height <= 0
    )
      return false;
    const authoredSurface = kind === 'blood_cut' || kind.endsWith('_pressure');
    if (authoredSurface && !this.preparation.ready(kind)) return false;
    let s = this.slots.find((s) => !s.active);
    // A decorative voice wake can yield to the target's physical blade contact.
    // Never displace another material family or another contact backing.
    if (!s && kind === 'blood_cut') {
      for (const candidate of this.slots)
        if (candidate.pressure && (!s || candidate.age / candidate.duration > s.age / s.duration))
          s = candidate;
    }
    if (!s) return false;
    s.pressure = kind.endsWith('_pressure');
    s.active = true;
    s.age = 0;
    s.duration = Number.isFinite(duration) ? Math.max(0.05, duration) : 1.15;
    s.mesh.visible = authoredSurface;
    const geometry = this.shapes.get(kind) ?? this.shapes.get('shadow');
    if (geometry) s.mesh.geometry = geometry;
    s.mesh.rotation.set(pitch, angle, 0, 'YXZ');
    if (kind === 'blood_cut') s.mesh.rotation.set(0, angle, pitch, 'YXZ');
    s.mesh.position.set(x, y, z);
    s.mesh.scale.set(Math.min(3, radius), Math.min(3, height), Math.min(3, radius));
    if (kind === 'chain') s.mesh.scale.set(height, height, radius);
    const u = s.mesh.material.uniforms;
    const ground = u.uPressureGround.value as Float32Array;
    ground.fill(0);
    if (s.pressure && this.groundY) {
      const cosine = Math.cos(angle),
        sine = Math.sin(angle),
        sourceFloor = this.groundY(x, z);
      for (let row = 0; row < 5; row++)
        for (let column = 0; column < 5; column++) {
          const lx = (column / 4 - 0.5) * 12 * s.mesh.scale.x;
          const lz = (row / 4) * 10 * s.mesh.scale.z;
          const heightAt = this.groundY(x + lx * cosine + lz * sine, z + lz * cosine - lx * sine);
          ground[row * 5 + column] =
            Number.isFinite(sourceFloor) && Number.isFinite(heightAt)
              ? (heightAt - sourceFloor) / s.mesh.scale.y
              : 0;
        }
    }
    u.uTint.value.setHex(tint);
    u.uAccent.value.setHex(accent);
    u.uKind.value = kind.endsWith('_pressure')
      ? 13
      : kind === 'blood_cut'
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
    u.uMotion.value = this.reducedMotion ? 0 : 1;
    return true;
  }
  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.reducedMotion = reducedMotion;
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
