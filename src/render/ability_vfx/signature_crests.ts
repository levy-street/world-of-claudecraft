import * as THREE from 'three';
import { bindSceneSamples, SCENE_SAMPLE_GLSL, sceneKeyLightUniform } from '../scene_sampling';
import { BLOODLETTING_FRAGMENT, BLOODLETTING_VERTEX } from './bloodletting_shape';
import { CrestPrewarm } from './crest_prewarm';
import { HARVEST_FRAGMENT, HARVEST_VERTEX } from './harvest_material';
import {
  warriorBloodTexture,
  warriorPressureTexture,
  warriorSteelTexture,
} from './production_assets';
import { buildSignatureShapes, type CrestKind } from './signature_shapes';
import { STEEL_SWEEP_GLSL } from './steel_sweep';
import { TWINSTRIKE_FRAGMENT, TWINSTRIKE_VERTEX } from './twinstrike_shape';

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
    heldId: number | null;
    heldStamp: number;
    phase: number;
  }[] = [];
  private disposed = false;
  private reducedMotion = false;
  private frame = 0;
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
        uBloodMap: { value: null },
        uSteelMap: { value: null },
        uSunWorld: sceneKeyLightUniform(scene),
        uKind: { value: 0 },
        uMotion: { value: 1 },
        uStorm: { value: 0 },
        uFlow: { value: 0 },
        uPressureGround: { value: new Float32Array(25) },
        uTint: { value: new THREE.Color() },
        uAccent: { value: new THREE.Color() },
      },
      vertexShader: `uniform float uAge,uKind,uMotion,uPressureGround[25]; varying vec2 vUv,vSurface; varying vec3 vNormal,vView,vLocal,vLocalNormal;
        float pressureGround(vec2 p){
          vec2 uv=uKind>22.5?p/12.0+0.5:(uKind>20.5 && uKind<21.5)?p/8.0+0.5:uKind>16.5?p/16.0+0.5:vec2(p.x/22.0+0.5,p.y/10.0);
          vec2 grid=clamp(uv*4.0,vec2(0.0),vec2(3.9999));
          ivec2 cell=ivec2(floor(grid));vec2 f=fract(grid);int i=cell.y*5+cell.x;
          return mix(mix(uPressureGround[i],uPressureGround[i+1],f.x),
            mix(uPressureGround[i+5],uPressureGround[i+6],f.x),f.y);
        }
        void main(){
          vLocal=position; vLocalNormal=normal;
          vUv=uv; vSurface=uKind>19.5?position.zy*vec2(0.15,0.55)+0.5:uKind>15.5?position.xz*0.08+0.5:position.xy*(uKind>14.5?vec2(0.22,0.55):vec2(0.4))+0.5; vec3 p=position;
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
          if(uKind>12.5 && uKind<13.5){
            float advance=mix(0.85,0.12+0.88*(1.0-pow(max(0.0,1.0-uAge),2.0)),uMotion);
            p.xz*=advance;
            p.y*=mix(1.0,0.6+0.4*advance,uMotion);
            p.y+=pressureGround(p.xz);
          }
          if(uKind>13.5 && uKind<14.5){
            p.xy*=0.88+0.12*smoothstep(0.0,0.16,uAge);
            p.x+=sign(p.x)*smoothstep(0.35,1.0,uAge)*0.17*uMotion;
            p.z-=uAge*uAge*0.18*uMotion;
          }
          if(uKind>16.5 && uKind<19.5){
            if(uKind>17.5)p.y*=mix(1.0,(0.45+0.55*smoothstep(0.0,0.12,uAge))*(1.0-0.7*smoothstep(0.45,1.0,uAge)),uMotion);
            p.y+=pressureGround(p.xz);
          }
          if((uKind>20.5 && uKind<21.5)){
            float lift=smoothstep(0.0,0.16,uAge);
            float settle=1.0-smoothstep(0.3,1.0,uAge);
            p.y*=mix(1.0,0.12+0.88*lift*settle,uMotion);
            p.y+=pressureGround(p.xz);
          }
          if(uKind>21.5 && uKind<22.5){
            float turn=(0.137+0.842*min(1.0,uAge))*6.2831853*uMotion;
            p.xz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xz;
          }
          if(uKind>22.5 && uKind<23.5){
            float settle=1.0-smoothstep(0.28,1.0,uAge);
            p.y*=mix(1.0,0.72+0.28*sin(min(uAge*5.0,1.0)*1.5707963),uMotion);
            p.y*=mix(1.0,max(0.05,settle),uMotion);
            p.y+=pressureGround(p.xz);
          }
          ${HARVEST_VERTEX}
          ${TWINSTRIKE_VERTEX}
          ${BLOODLETTING_VERTEX}
          vec4 view=modelViewMatrix*vec4(p,1.0); vView=-view.xyz; vNormal=normalize(normalMatrix*normal);
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: `${SCENE_SAMPLE_GLSL}
        ${STEEL_SWEEP_GLSL}
        uniform sampler2D uPressureMap,uBloodMap,uSteelMap; uniform float uAge,uKind,uMotion,uStorm,uFlow; uniform vec3 uTint,uAccent,uSunWorld;
        varying vec2 vUv,vSurface; varying vec3 vNormal,vView,vLocal,vLocalNormal;
        vec2 groundSteelUv(vec2 p){return 1.0-abs(mod(p*0.24+0.37,2.0)-1.0);}
        void main(){
          if(((uKind>17.5 && uKind<19.5)||(uKind>20.5 && uKind<21.5)||(uKind>22.5 && uKind<23.5)) && !gl_FrontFacing)discard;
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
            float tear=sin(vUv.x*67.0+vUv.y*19.0)*sin(vUv.x*31.0-vUv.y*13.0);
            float edge=1.0-smoothstep(0.015,0.08,vUv.y);
            float dissolve=smoothstep(uAge*1.2-0.2,uAge*1.2+0.15,1.0-vUv.y*0.65+tear*0.28);
            // Source is an authored red surface on a black matte. Sample the
            // actual painted strip, flipped from image rows into the mesh UVs.
            vec3 enamel=texture2D(uBloodMap,vec2(vUv.x,0.70-vUv.y*0.47)).rgb;
            float coverage=smoothstep(0.004,0.055,max(enamel.r,max(enamel.g,enamel.b)));
            // The geometry owns the cut silhouette. A black paint matte must
            // not punch the entire blood mass into isolated bright speckles.
            float core=smoothstep(0.02,0.12,vUv.x)*(1.0-smoothstep(0.88,0.98,vUv.x))*(1.0-smoothstep(0.72,1.0,vUv.y));
            coverage=max(coverage,core*0.92);
            vec3 bloodBody=mix(uTint*0.58,enamel,smoothstep(0.015,0.14,enamel.r));
            colour=bloodBody*(1.1+fresnel*0.28)+uAccent*edge*0.34;
            alpha=0.97*coverage*dissolve*smoothstep(0.0,0.1,taper)*(1.0-smoothstep(0.68,1.0,uAge));
          }
          if(uKind>12.5 && uKind<13.5){
            float grain=texture2D(uPressureMap,vec2(vUv.x,0.46+vUv.y*0.08)).r;
            float compression=exp(-vUv.y*9.0);
            float air=exp(-vUv.y*3.0)*0.12;
            float ends=smoothstep(0.0,0.08,vUv.x)*(1.0-smoothstep(0.92,1.0,vUv.x));
            float crackle=0.72+0.28*smoothstep(0.04,0.3,grain);
            colour=mix(uTint,uAccent,0.8+compression*0.2)*(1.1+compression*0.25);
            alpha=(compression*0.76+air)*ends*crackle*(1.0-smoothstep(0.35,1.0,uAge));
          }
          if(uKind>13.5){
            float bevel=1.0-smoothstep(0.18,0.3,vUv.y);
            vec3 steel=texture2D(uSteelMap,clamp(vSurface,vec2(0.0),vec2(1.0))).rgb;
            vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));
            vec3 sun=normalize((viewMatrix*vec4(uSunWorld,0.0)).xyz);
            float light=0.65+0.65*abs(dot(n,sun));
            colour=steel*light+uAccent*(bevel*0.58+fresnel*0.13);
            if(uKind>16.5 && uKind<19.5){
              float score=dot(steel,vec3(0.333333));
              colour=uTint*(0.34+score*0.5)*light+uAccent*(bevel*0.6+fresnel*0.12);
            }
            if((uKind>17.5 && uKind<19.5)||(uKind>20.5 && uKind<21.5)||uKind>22.5){
              // Sidewalls need their own vertical grain. XZ-only projection
              // stretches one texel column down the entire raised fracture.
              vec3 weights=pow(abs(normalize(vLocalNormal)),vec3(4.0));
              weights/=max(0.0001,weights.x+weights.y+weights.z);
              vec3 surface=texture2D(uSteelMap,groundSteelUv(vLocal.yz)).rgb*weights.x
                +texture2D(uSteelMap,groundSteelUv(vLocal.xz)).rgb*weights.y
                +texture2D(uSteelMap,groundSteelUv(vLocal.xy)).rgb*weights.z;
              float grain=dot(surface,vec3(0.333333));
              if(dot(n,normalize(vView))<0.0)n=-n;
              float incidence=max(0.0,dot(n,sun));
              float faceLight=0.36+0.85*incidence;
              colour=uTint*(0.58+grain*1.5)*faceLight;
              colour+=uAccent*bevel*(0.06+0.2*incidence)*(0.45+grain);
              colour+=uAccent*fresnel*0.055;
              if(uKind>22.5){
                // Matte fault faces use the existing surface's mineral grain,
                // with compressed highlights and dark sediment seams. The thin
                // fresh edge catches light without reading as a forged blade.
                float strata=sin(vLocal.y*6.0+vLocal.x*0.6+vLocal.z*0.3+grain*0.45);
                float seam=1.0-smoothstep(0.04,0.16,abs(strata));
                float bed=mix(0.6,1.1,grain)*(1.0-seam*0.24);
                colour=uTint*bed*(0.52+incidence*0.65);
                colour+=uAccent*bevel*(0.045+incidence*0.12);
              }
            }
            alpha=1.0-smoothstep(0.48,1.0,uAge);
          }
          if(uKind>14.5 && uKind<15.5){
            // A fast cutting head draws the broad steel wake through contact.
            // A fixed full-opacity wall would freeze the motion into a panel.
            float gain=steelSweepGain(vUv.x,uAge);
            alpha*=mix(1.0,min(1.0,gain),uMotion);
            colour+=uAccent*max(0.0,gain-0.8)*0.24*uMotion;
          }
          if(uStorm>0.5){
            // Directional air dragged by the cutting edge. Broken textured
            // tails leave the fighter visible through the full-radius sweep.
            float lengthFade=smoothstep(0.0,0.16,vUv.x)*(1.0-smoothstep(0.91,1.0,vUv.x));
            float edge=1.0-smoothstep(0.015,0.10,vUv.y);
            vec2 streamUv=vec2(fract(vUv.x-uFlow*0.32*uMotion),0.46+vUv.y*0.13);
            float grain=texture2D(uPressureMap,streamUv).r;
            float striation=sin(vUv.y*43.0+vUv.x*7.0+grain*7.0);
            float strands=smoothstep(0.36,0.9,striation)*(1.0-vUv.y);
            float body=(0.07+grain*0.18+strands*0.24)*(1.0-smoothstep(0.55,1.0,vUv.y));
            colour=mix(uTint,uAccent,edge*0.75+strands*0.2)*(0.85+grain*0.55)+uAccent*edge*0.5;
            alpha=lengthFade*(edge*0.55+body)*(1.0-smoothstep(0.7,1.0,uAge));
          }
          if(uKind>13.5 && uKind<14.5){
            float bevel=1.0-smoothstep(0.18,0.3,vUv.y);
            colour=mix(uTint*0.55,colour,0.6)+uAccent*bevel*0.08;
          }
          if(uKind>16.5 && uKind<17.5){
            float sweepU=clamp((atan(vSurface.x-0.5,vSurface.y-0.5)+2.2)/4.4,0.0,1.0);
            float gain=steelSweepGain(sweepU,uAge);
            alpha*=mix(1.0,min(1.0,gain),uMotion);
            colour+=uAccent*max(0.0,gain-0.75)*0.55*uMotion;
          }
          if(uKind>19.5 && uKind<20.5){
            // The compression travels down the thrust, with its hot head
            // crossing the victim before the scored pressure wake dissolves.
            float thrustU=clamp((vLocal.z+3.3)/5.6,0.0,1.0);
            float gain=steelSweepGain(thrustU,uAge);
            float grain=dot(colour,vec3(0.333333));
            colour=uTint*(0.45+grain*0.6)+uAccent*max(0.0,gain-0.65)*0.9;
            alpha*=mix(1.0,min(1.0,gain),uMotion);
          }
          if(uKind>21.5 && uKind<22.5){
            vec3 blood=texture2D(uBloodMap,clamp(vec2(vUv.x,vUv.y),vec2(.01),vec2(.99))).rgb;
            float grain=dot(blood,vec3(.333333));
            float edge=1.0-smoothstep(.06,.24,vUv.y);
            colour=mix(uTint*(.55+grain*1.2),uAccent*(.85+grain*.45),edge);
            float tail=(1.0-smoothstep(.25,1.0,vUv.y))*(.2+grain*.45);
            float cut=smoothstep(.0,.12,vUv.x)*(1.0-smoothstep(.9,1.0,vUv.x));
            alpha=cut*(edge*.85+tail)*(1.0-smoothstep(.62,1.0,uAge));
          }
          ${HARVEST_FRAGMENT}
          ${TWINSTRIKE_FRAGMENT}
          ${BLOODLETTING_FRAGMENT}
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
      mesh.material.uniforms.uBloodMap.value = warriorBloodTexture();
      mesh.material.uniforms.uSteelMap.value = warriorSteelTexture();
      mesh.material.uniforms.uPressureGround.value = new Float32Array(25);
      this.unbind.push(bindSceneSamples(scene, mesh));
      mesh.name = 'signatureCrest';
      mesh.visible = false;
      mesh.userData.renderCategory = 'vfx';
      mesh.renderOrder = 4;
      // Shader animation can move the surface beyond its prepared bounds.
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        mesh,
        age: 0,
        duration: 1.15,
        active: false,
        pressure: false,
        heldId: null,
        heldStamp: -1,
        phase: 0,
      });
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
    const steelBlade =
      kind === 'steel_cut' ||
      kind === 'steel_chop' ||
      kind === 'steel_counter' ||
      kind === 'steel_execution';
    const contactSurface =
      kind === 'blood_cut' ||
      kind === 'twinstrike_cut' ||
      kind === 'bloodletting_pull' ||
      kind.startsWith('harvest_') ||
      kind === 'shield_contact' ||
      steelBlade ||
      kind === 'breach_wedge';
    const authoredSurface =
      contactSurface ||
      kind === 'steel_storm' ||
      kind === 'steel_reap' ||
      kind === 'avatar_rupture' ||
      kind === 'blood_gyre' ||
      kind === 'leap_rupture' ||
      kind.startsWith('iron_') ||
      kind.endsWith('_pressure');
    if (authoredSurface && !this.preparation.ready(kind)) return false;
    let s = this.slots.find((s) => !s.active);
    // A decorative voice wake can yield to the target's physical blade contact.
    // Never displace another material family or another contact backing.
    if (!s && contactSurface) {
      for (const candidate of this.slots)
        if (candidate.pressure && (!s || candidate.age / candidate.duration > s.age / s.duration))
          s = candidate;
    }
    if (!s) return false;
    s.pressure = kind.endsWith('_pressure');
    s.heldId = null;
    s.active = true;
    s.age = 0;
    s.duration = Number.isFinite(duration) ? Math.max(0.05, duration) : 1.15;
    s.mesh.visible = authoredSurface;
    const geometry = this.shapes.get(kind) ?? this.shapes.get('shadow');
    if (geometry) s.mesh.geometry = geometry;
    s.mesh.rotation.set(pitch, angle, 0, 'YXZ');
    if (
      kind === 'blood_cut' ||
      kind === 'twinstrike_cut' ||
      kind === 'bloodletting_pull' ||
      kind.startsWith('harvest_') ||
      steelBlade
    )
      s.mesh.rotation.set(0, angle, pitch, 'YXZ');
    s.mesh.position.set(x, y, z);
    s.mesh.scale.set(Math.min(3, radius), Math.min(3, height), Math.min(3, radius));
    if (kind === 'chain') s.mesh.scale.set(height, height, radius);
    const u = s.mesh.material.uniforms;
    const ground = u.uPressureGround.value as Float32Array;
    ground.fill(0);
    const ironGround =
      kind.startsWith('iron_') || kind === 'avatar_rupture' || kind === 'leap_rupture';
    const groundSpan = kind === 'leap_rupture' ? 12 : kind === 'avatar_rupture' ? 8 : 16;
    if ((s.pressure || ironGround) && this.groundY) {
      const cosine = Math.cos(angle),
        sine = Math.sin(angle),
        sourceFloor = this.groundY(x, z);
      for (let row = 0; row < 5; row++)
        for (let column = 0; column < 5; column++) {
          const lx = (column / 4 - 0.5) * (ironGround ? groundSpan : 22) * s.mesh.scale.x;
          const lz = (ironGround ? (row / 4 - 0.5) * groundSpan : (row / 4) * 10) * s.mesh.scale.z;
          const heightAt = this.groundY(x + lx * cosine + lz * sine, z + lz * cosine - lx * sine);
          ground[row * 5 + column] =
            Number.isFinite(sourceFloor) && Number.isFinite(heightAt)
              ? (heightAt - sourceFloor) / s.mesh.scale.y
              : 0;
        }
    }
    u.uTint.value.setHex(tint);
    u.uAccent.value.setHex(accent);
    u.uKind.value =
      kind === 'leap_rupture'
        ? 23
        : kind === 'blood_gyre'
          ? 22
          : ironGround
            ? kind === 'avatar_rupture'
              ? 21
              : kind === 'iron_counter'
                ? 17
                : kind === 'iron_quake'
                  ? 18
                  : 19
            : kind === 'steel_storm' || kind === 'steel_reap'
              ? 16
              : kind === 'breach_wedge'
                ? 20
                : steelBlade
                  ? 15
                  : kind === 'shield_contact'
                    ? 14
                    : kind.endsWith('_pressure')
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
    if (kind === 'harvest_cut') u.uKind.value = 24;
    if (kind === 'harvest_eruption') u.uKind.value = 25;
    if (kind === 'twinstrike_cut') u.uKind.value = 26;
    if (kind === 'bloodletting_pull') u.uKind.value = 27;
    u.uStorm.value = kind === 'steel_storm' ? 1 : 0;
    u.uFlow.value = 0;
    u.uMotion.value = this.reducedMotion ? 0 : 1;
    return true;
  }
  /** One caster-owned storm borrows the existing eight-slot sculpture pool.
   * Live frame stamps, not a guessed duration, own release and interruption. */
  holdStorm(entityId: number, x: number, y: number, z: number, elapsed: number): boolean {
    if (
      this.disposed ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !Number.isFinite(elapsed)
    )
      return false;
    let slot: (typeof this.slots)[number] | undefined;
    for (const candidate of this.slots)
      if (candidate.active && candidate.heldId === entityId) {
        slot = candidate;
        break;
      }
    if (!slot) {
      const available = this.slots.find((s) => !s.active);
      if (!available) return false;
      if (!this.spawn(x, y, z, 1, 1, 0x9ca9a8, 0xd8e1e3, 'steel_storm', 0, 1)) return false;
      slot = available;
      slot.heldId = entityId;
    }
    slot.heldStamp = this.frame;
    slot.phase = Math.max(0, elapsed);
    slot.mesh.position.set(x, y, z);
    return true;
  }
  releaseHeld(entityId: number): void {
    for (const s of this.slots)
      if (s.heldId === entityId) {
        s.active = false;
        s.mesh.visible = false;
        s.heldId = null;
      }
  }
  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.reducedMotion = reducedMotion;
    for (const s of this.slots) {
      if (!s.active) continue;
      if (s.heldId !== null) {
        s.active = s.heldStamp === this.frame;
        s.mesh.visible = s.active;
        s.mesh.rotation.y = reducedMotion ? 0 : s.phase * 14;
        s.mesh.material.uniforms.uAge.value = 0.18;
        s.mesh.material.uniforms.uFlow.value = s.phase;
        s.mesh.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
        continue;
      }
      s.age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      s.active = s.age < s.duration;
      s.mesh.visible = s.active;
      s.mesh.material.uniforms.uAge.value = Math.min(1, s.age / s.duration);
      s.mesh.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
    }
    this.frame++;
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
