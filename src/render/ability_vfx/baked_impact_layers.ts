import * as THREE from 'three';
import { SUN_DIR } from '../gfx';
import { bindSceneSamples, SCENE_SAMPLE_GLSL } from '../scene_sampling';
import { type BakedKind, bakedTexture } from './production_assets';
import { liquidSurfaceMaps } from './simulation_assets';

const CAPACITY = 10;
interface Slot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  active: boolean;
  age: number;
  duration: number;
  size: number;
  ground: boolean;
  rise: number;
  y: number;
  authored: boolean;
}
/** Authored volume motion with premultiplied temporal blending, straight-alpha
 * output, scene-depth intersection softness and bounded heat refraction. */
export class BakedImpactLayers {
  private readonly point = new THREE.Vector3();
  private readonly slots: Slot[] = [];
  private disposed = false;
  private readonly unbind: Array<() => void> = [];
  constructor(scene: THREE.Scene) {
    const geometry = new THREE.PlaneGeometry(1, 1, 8, 8);
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uNormal: { value: null },
        uFlow: { value: null },
        uLighting: { value: null },
        uSurface: { value: 0 },
        uSourceScale: { value: 1 },
        uSunWorld: { value: SUN_DIR.clone() },
        uFrame: { value: 0 },
        uOpacity: { value: 0 },
        uTint: { value: new THREE.Color() },
        uHot: { value: new THREE.Color() },
        uHeat: { value: 0 },
        uFloor: { value: 0 },
        uGround: { value: 0 },
        uMotion: { value: 1 },
        uAuthored: { value: 0 },
        uPivot: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: `uniform vec2 uPivot; varying vec2 vUv; varying float vHeight,vDistance,vViewDepth; void main(){vUv=uv;vec3 p=position;p.xy+=vec2(0.5-uPivot.x,uPivot.y-0.5);vec4 world=modelMatrix*vec4(p,1.);vec4 view=viewMatrix*world;vHeight=world.y;vDistance=length(view.xyz);vViewDepth=-view.z;gl_Position=projectionMatrix*view;}`,
      fragmentShader: `${SCENE_SAMPLE_GLSL}
      uniform sampler2D uNormal,uFlow,uLighting;uniform float uSurface,uSourceScale;uniform vec3 uSunWorld;
      uniform sampler2D uMap;uniform float uFrame,uOpacity,uHeat,uFloor,uGround,uMotion,uAuthored;uniform vec3 uTint,uHot;varying vec2 vUv;varying float vHeight,vDistance,vViewDepth;
      vec2 cellUv(float f,vec2 local){f=clamp(f,0.,63.);float gutter=mix(0.018,8.0/512.0,uAuthored);vec2 content=mix(vec2(gutter),vec2(1.0-gutter),clamp(local,vec2(0.),vec2(1.)));vec2 uv=(content+vec2(mod(f,8.),7.-floor(f/8.)))/8.;return uv;}
      vec4 cell(float f){return texture2D(uMap,cellUv(f,vUv));}
      void main(){vec4 a=cell(floor(uFrame)),b=cell(floor(uFrame)+1.);float t=fract(uFrame);float alpha=mix(a.a,b.a,t);vec3 premix=mix(a.rgb*a.a,b.rgb*b.a,t);vec3 shade=premix/max(alpha,0.001);
        float surfaceDepth=vViewDepth;
        vec3 normal=vec3(0.,0.,1.);
        if(uSurface>0.5) {
          vec2 uvA=cellUv(floor(uFrame),vUv), uvB=cellUv(floor(uFrame)+1.,vUv);
          vec4 flowA=texture2D(uFlow,uvA), flowB=texture2D(uFlow,uvB);
          float guard=smoothstep(0.02,0.3,min(a.a,b.a))*(1.-smoothstep(0.12,0.6,abs(a.a-b.a)));
          vec2 moveA=(flowA.rg-.5)*vec2(64./496.,-64./496.)*flowA.a*guard;
          vec2 moveB=(flowB.rg-.5)*vec2(64./496.,-64./496.)*flowB.a*guard;
          uvA=cellUv(floor(uFrame),vUv-moveA*t);
          uvB=cellUv(floor(uFrame)+1.,vUv+moveB*(1.-t));
          vec4 movedA=texture2D(uMap,uvA), movedB=texture2D(uMap,uvB);
          float movedAlpha=mix(movedA.a,movedB.a,t);
          vec3 moved=mix(movedA.rgb*movedA.a,movedB.rgb*movedB.a,t)/max(movedAlpha,.001);
          shade=mix(shade,moved,guard);
          // Alpha stays at adjacent unwarped endpoints across changing fluid topology.
          vec4 nd=mix(texture2D(uNormal,uvA),texture2D(uNormal,uvB),t);
          normal=normalize(nd.rgb*2.-1.+vec3(0.,0.,.00001));
          surfaceDepth+=clamp(nd.a*6.+12.5-15.859136,-2.5,2.5)*uSourceScale;
          vec3 baked=mix(texture2D(uLighting,uvA).rgb,texture2D(uLighting,uvB).rgb,t);
          baked=baked/max(vec3(.04),1.-baked);
          float reference=dot(baked,vec3(.2126,.7152,.0722));
          vec3 sun=normalize((viewMatrix*vec4(uSunWorld,0.)).xyz);
          float diffuse=.35+.65*max(0.,dot(normal,sun));
          float adjustment=clamp(diffuse/max(.35,reference),.55,1.65);
          shade*=mix(1.,adjustment,.65);
          float spec=pow(max(0.,dot(normal,normalize(sun+vec3(0.,0.,1.)))),64.);
          shade+=vec3(.45,.85,.92)*spec*.6;
        }
        float floorFade=mix(smoothstep(uFloor-0.04,uFloor+0.38,vHeight),1.,uGround);float nearFade=smoothstep(0.7,2.3,vDistance);
        vec3 colour=shade*uTint+uHot*pow(max(shade.r,0.),2.)*uHeat;
        colour=mix(colour,shade*(1.0+uHeat*0.18),uAuthored);
        vec2 bend=vec2(shade.r-shade.b,shade.g-shade.r)*uHeat*3.0*uMotion;
        bend+=normal.xy*2.5*uSurface*uMotion;
        colour=sceneRefract(colour,bend,surfaceDepth,min(0.22,uHeat*0.08+uSurface*0.12)*uMotion);
        gl_FragColor=vec4(colour,alpha*uOpacity*floorFade*nearFade*sceneSoftness(surfaceDepth,mix(0.45,0.025,uGround)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < CAPACITY; i++) {
      const mesh = new THREE.Mesh(geometry.clone(), proto.clone());
      this.unbind.push(bindSceneSamples(scene, mesh));
      mesh.name = 'bakedImpactVolume';
      mesh.userData.renderCategory = 'vfx';
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        mesh,
        active: false,
        age: 0,
        duration: 1,
        size: 1,
        ground: false,
        rise: 0,
        y: 0,
        authored: false,
      });
    }
    proto.dispose();
    geometry.dispose();
  }
  spawn(
    kind: BakedKind,
    x: number,
    y: number,
    z: number,
    size: number,
    tint: number,
    hot: number,
    duration: number,
    delay: number,
    heat: number,
    floor: number,
    angle = 0,
    groundY?: (x: number, z: number) => number,
  ): boolean {
    if (
      this.disposed ||
      !bakedTexture(kind) ||
      ![x, y, z, size, duration, delay, heat, floor, angle].every(Number.isFinite) ||
      size <= 0 ||
      duration <= 0
    )
      return false;
    const s = this.slots.find((s) => !s.active);
    if (!s) return false;
    s.active = true;
    s.age = -Math.max(0, delay);
    s.duration = Math.min(3, duration);
    s.size = Math.min(9, size);
    s.ground = kind === 'shockwave';
    s.authored = kind === 'pyroblast' || kind === 'frost_nova' || kind === 'chain_heal';
    s.rise = s.ground || s.authored ? 0 : 0.18;
    s.y = y;
    s.mesh.position.set(x, y, z);
    s.mesh.scale.setScalar(s.size);
    s.mesh.quaternion.identity();
    if (s.ground) s.mesh.rotation.set(-Math.PI / 2, 0, angle);
    // Prepared per-slot vertices drape once at spawn. Smoke resets the same
    // surface to a flat billboard; neither path edits buffers during playback.
    s.mesh.updateMatrixWorld(true);
    const positions = s.mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      let depth = 0;
      if (s.ground && groundY) {
        this.point.set(positions.getX(i), positions.getY(i), 0).applyMatrix4(s.mesh.matrixWorld);
        const height = groundY(this.point.x, this.point.z);
        depth = ((Number.isFinite(height) ? height : floor) + 0.08 - y) / s.size;
      }
      positions.setZ(i, depth);
    }
    positions.needsUpdate = true;
    const u = s.mesh.material.uniforms;
    u.uMap.value = bakedTexture(kind);
    const surface = kind === 'chain_heal' ? liquidSurfaceMaps() : null;
    u.uSurface.value = surface ? 1 : 0;
    u.uNormal.value = surface?.normal ?? u.uMap.value;
    u.uFlow.value = surface?.motion ?? u.uMap.value;
    u.uLighting.value = surface?.lighting ?? u.uMap.value;
    u.uSourceScale.value = s.size / 5.9;
    u.uFrame.value = 0;
    u.uOpacity.value = 0;
    u.uTint.value.setHex(tint);
    u.uHot.value.setHex(hot);
    u.uHeat.value = Math.min(2, Math.max(0, heat));
    u.uFloor.value = floor;
    u.uGround.value = s.ground ? 1 : 0;
    u.uAuthored.value = s.authored ? 1 : 0;
    u.uPivot.value.set(
      0.5,
      kind === 'pyroblast'
        ? 0.8623381263
        : kind === 'frost_nova'
          ? 0.64255944
          : kind === 'chain_heal'
            ? 0.7128991485
            : 0.5,
    );
    s.mesh.userData.heat = u.uHeat.value;
    return true;
  }
  update(dt: number, camera: THREE.Quaternion, reducedMotion: boolean): void {
    if (this.disposed) return;
    const delta = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += delta;
      const p = Math.max(0, Math.min(1, s.age / s.duration));
      s.active = p < 1;
      s.mesh.visible = s.active && s.age >= 0;
      if (!s.mesh.visible) continue;
      const u = s.mesh.material.uniforms;
      u.uMotion.value = reducedMotion ? 0 : 1;
      u.uFrame.value = (reducedMotion ? 0.36 : p) * 63;
      u.uOpacity.value =
        (s.authored ? 0.94 : s.ground ? 0.75 : 0.64) *
        Math.min(1, p / 0.045) *
        Math.min(1, (1 - p) / 0.25);
      u.uHeat.value = s.mesh.userData.heat * (1 - p) ** 3;
      if (!s.ground) {
        s.mesh.quaternion.copy(camera);
        s.mesh.position.y = s.y + (reducedMotion ? 0 : p * s.rise);
      }
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
    this.disposed = true;
    this.clear();
    for (const unbind of this.unbind) unbind();
    for (const s of this.slots) {
      s.mesh.removeFromParent();
      s.mesh.material.dispose();
      s.mesh.geometry.dispose();
    }
  }
}
