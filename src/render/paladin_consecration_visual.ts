// Persistent Consecration (Holy Ground) presentation. The authoritative zone comes
// from IWorld, so late-joining and reconnecting clients see the same holy ground as
// the caster.
//
// Detail: core = the holy ground itself (field, heart, spec emblem, sacred
// geometry, the tick's wave and embers drawn in it), the rune band and the
// perimeter ring; secondary = the inner and middle rings, the pulse ring, the
// tick's wall of fire and the opening column; accents = the heat shimmer. The
// rising motes thin with paladinDetailCount; the end fade and the opening
// column's decay scale with paladinDetailLinger. A zone reads the detail as it
// opens and keeps it; the renderer's quality floors (setQuality) still apply on
// top, so a piece draws only while both allow it.

import * as THREE from 'three';
import type { ActiveConsecration } from '../world_api';
import { GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './ability_vfx/effect_floor';
import {
  paladinConsecrationAscendedAt,
  paladinConsecrationSpecAt,
} from './ability_vfx/paladin_consecration_spec';
import { PALADIN_RUNE_GLSL } from './ability_vfx/paladin_runes';
import { PALADIN_SPEC_EMBLEM_GLSL } from './ability_vfx/paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './ability_vfx/paladin_spec_icons';
import { paladinVfxDetailNow } from './ability_vfx/paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './ability_vfx/paladin_vfx_detail_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';

const SEGMENTS = 72;
const GROUND_LIFT = 0.055;
const FADE_SECONDS = 0.65;
/** The holy ground writes itself outward from the Paladin over this long. */
const REVEAL_SECONDS = 0.35;
/** The zone ticks once a second; a wave of light runs out with each tick. */
const TICK_SECONDS = 1;
const OPENING_SECONDS = 0.6;
const MOTE_COUNT = 14;
/** Faithwarden's icon until the cast's note of the caster's spec is found. */
const DEFAULT_SPEC = 1;
/** How long a new zone keeps looking for its caster's spec note. */
const SPEC_SEARCH_SECONDS = 1;

// The zone's fixed-shape pieces, one each for every zone and never disposed:
// the pulse ring (scaled to the wave), the opening column, the unit fire wall,
// the shimmer (scaled to the radius) and the motes. Only the terrain-draped
// discs and rings are built per zone, since they follow the ground under it.
const PULSE_GEOMETRY = new THREE.RingGeometry(0.95, 1, 64);
const OPENING_GEOMETRY = new THREE.CylinderGeometry(0.45, 1.1, 10, 32, 1, true);
const FIRE_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, SEGMENTS, 1, true);
const SHIMMER_GEOMETRY = new THREE.CylinderGeometry(0.99, 0.95, 0.5, 48, 1, true);
const MOTE_GEOMETRY = new THREE.SphereGeometry(0.06, 6, 4);

interface AmbientOffset {
  x: number;
  y: number;
  z: number;
  phase: number;
  scale: number;
}

interface ConsecrationVisual {
  root: THREE.Group;
  motes: THREE.InstancedMesh;
  pulseRing: THREE.Mesh;
  pulseMaterial: THREE.MeshBasicMaterial;
  shimmer: THREE.Mesh;
  opening: THREE.Mesh;
  openingMaterial: THREE.ShaderMaterial;
  /** The tick's wall of holy fire: a unit open cylinder scaled to the wave. */
  fireWall: THREE.Mesh;
  fireMaterial: THREE.ShaderMaterial;
  fireBase: number;
  moteOffsets: readonly AmbientOffset[];
  scratch: THREE.Matrix4;
  scratchPosition: THREE.Vector3;
  scratchScale: THREE.Vector3;
  scratchRotation: THREE.Quaternion;
  materials: THREE.MeshBasicMaterial[];
  baseOpacities: number[];
  /** The shader-drawn ground and rune band, faded through uAlpha. */
  shaders: THREE.ShaderMaterial[];
  /** The ground itself, which bears the caster's spec icon. */
  ground: THREE.ShaderMaterial;
  /** Whether the caster's spec has been settled (found, or given up on). */
  specSettled: boolean;
  /** Ascension empowered it: its fire and pulses burn hotter. */
  gilded: boolean;
  geometries: THREE.BufferGeometry[];
  /** Quality-floored pieces; `detailShown` is whether the zone's detail keeps it. */
  qualityObjects: { object: THREE.Object3D; minQuality: number; detailShown: boolean }[];
  /** The detail this zone draws at: read as it opens, kept to its end. */
  detail: PaladinVfxDetail;
  /** The end fade and the opening column's decay, scaled for the detail. */
  fadeSeconds: number;
  openingSeconds: number;
  radius: number;
  duration: number;
  elapsed: number;
  lastRemaining: number;
}

const GROUND_VERTEX = `
  uniform vec2 uCenter; uniform float uRadius;
  varying vec2 vLocal;
  ${GROUND_DEPTH_PULL_GLSL}
  void main(){
    vLocal=(position.xz-uCenter)/uRadius;
    gl_Position=projectionMatrix*groundPulledView(position,${GROUND_DEPTH_PULL.toFixed(2)});
  }
`;
const GROUND_COMMON = `
  uniform float uTime, uAlpha, uReveal;
  varying vec2 vLocal;
  const vec3 GOLD=vec3(1.0,0.82,0.42);
  const vec3 HOT=vec3(1.0,0.95,0.8);
  const float PI=3.14159265;
  float sq(float x){return x*x;}
  float band(float r,float at,float w){return exp(-sq((r-at)/w));}
  // The tick's wave front: out from the heart once a second after the opening.
  float tickPhase(){return fract(uTime/${TICK_SECONDS.toFixed(2)});}
  float waveFront(){return tickPhase()*1.15;}
  float fireHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float fireNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(fireHash(i),fireHash(i+vec2(1.0,0.0)),f.x),
               mix(fireHash(i+vec2(0.0,1.0)),fireHash(i+vec2(1.0,1.0)),f.x),f.y);
  }
`;

/**
 * Holy Ground. The ground itself is drawn in light, draped over the terrain: a
 * warm radiant field with a white-hot heart, the caster's spec icon
 * (Faithwarden or Dawnreaver) at the centre, slowly turning sacred geometry (an eight-pointed star of two
 * squares, a ring and twelve diamond-tipped spokes) inside the shared Paladin
 * rune band at the rim. It writes itself outward from the Paladin with a
 * column of light, then with every tick a wave of holy fire runs out from the
 * heart: a wall of flame sweeping to the rim, embers smouldering behind it,
 * the geometry lit and the runes flashing.
 * Motes of light rise across it.
 */
export class PaladinConsecrationVisuals {
  private readonly active = new Map<string, ConsecrationVisual>();
  private quality = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
    for (const visual of this.active.values()) this.applyQuality(visual);
  }

  sync(states: readonly ActiveConsecration[]): void {
    const ids = new Set<string>();
    for (const state of states) {
      ids.add(state.id);
      const current = this.active.get(state.id);
      if (!current) {
        this.create(state);
        continue;
      }
      if (current.lastRemaining !== state.remaining) {
        current.duration = Math.max(0.1, state.duration);
        current.elapsed = Math.max(0, current.duration - state.remaining);
        current.lastRemaining = state.remaining;
        this.animate(current, 0, true);
      }
    }
    for (const [id, visual] of this.active) {
      if (ids.has(id)) continue;
      this.disposeVisual(visual);
      this.active.delete(id);
    }
  }

  update(dt: number, reducedMotion = false): void {
    for (const [id, visual] of this.active) {
      visual.elapsed += Math.max(0, dt);
      if (visual.elapsed >= visual.duration) {
        this.disposeVisual(visual);
        this.active.delete(id);
        continue;
      }
      this.animate(visual, dt, reducedMotion);
    }
  }

  dispose(): void {
    for (const visual of this.active.values()) this.disposeVisual(visual);
    this.active.clear();
  }

  private groundShader(
    name: string,
    state: ActiveConsecration,
    radius: number,
    fragment: string,
    extra: Record<string, THREE.IUniform> = {},
  ) {
    return new THREE.ShaderMaterial({
      name,
      uniforms: {
        uCenter: { value: new THREE.Vector2(state.x, state.z) },
        uRadius: { value: radius },
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uReveal: { value: 0 },
        ...extra,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: GROUND_VERTEX,
      fragmentShader: fragment,
    });
  }

  private create(state: ActiveConsecration): void {
    const radius = Math.max(0.5, state.radius);
    const centerY = this.groundY(state.x, state.z);
    const detail = paladinVfxDetailNow();
    const scale = paladinDetailScale(detail);
    const root = new THREE.Group();
    root.name = 'paladin-consecration';
    const materials: THREE.MeshBasicMaterial[] = [];
    const baseOpacities: number[] = [];
    const shaders: THREE.ShaderMaterial[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const qualityObjects: ConsecrationVisual['qualityObjects'] = [];

    const addTerrainMesh = (
      geometry: THREE.BufferGeometry,
      name: string,
      material: THREE.Material,
      renderOrder: number,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      // The authored stack (5 to 11) on the player rung of the floor ladder.
      mesh.renderOrder = floorVfxRenderOrder('player', renderOrder - 5);
      root.add(mesh);
      geometries.push(geometry);
      return mesh;
    };
    const basic = (role: string, color: number, opacity: number): THREE.MeshBasicMaterial => {
      const material = this.material(role, color, opacity);
      materials.push(material);
      baseOpacities.push(opacity);
      return material;
    };

    // The holy ground itself: field, heart, emblem, the sacred geometry and the tick wave.
    const ground = this.groundShader(
      'paladin_consecration:ground',
      state,
      radius,
      `
      ${GROUND_COMMON}
      ${PALADIN_SPEC_ICON_GLSL}
      ${PALADIN_SPEC_EMBLEM_GLSL}
      uniform float uSpec, uGild;
      void main(){
        vec2 p=vLocal;
        float r=length(p);
        float a=atan(p.y,p.x);
        float reveal=1.0-smoothstep(uReveal*1.04-0.05,uReveal*1.04,r);
        float tick=tickPhase();
        float front=waveFront();
        float live=step(${REVEAL_SECONDS.toFixed(2)},uTime);
        // The tick's holy fire: a flickering burning front, embers and scorch
        // light smouldering behind it.
        float flick=0.55+0.45*fireNoise(vec2(a*9.0,uTime*7.0));
        float wave=band(r,front,0.05)*(1.0-tick)*live*flick;
        float behind=step(r,front)*exp(-(front-r)*7.0)*(1.0-tick)*live;
        float embers=behind*(0.25+0.75*step(0.72,fireNoise(vec2(a*26.0,r*30.0))))*0.45;
        float field=0.03+0.1*exp(-r*r*4.0)+band(r,0.985,0.025)*0.3;
        // Sacred geometry inside the runes, turning slowly: an eight-pointed star
        // of two squares in single lines, framed by a thin ring, and twelve
        // straight spokes, long and short by turns, each tipped with a diamond.
        // The lines flare where the tick's holy fire passes over them.
        float turn=uTime*0.05;
        vec2 q=vec2(p.x*cos(turn)-p.y*sin(turn),p.x*sin(turn)+p.y*cos(turn));
        float starR=0.62;
        float diamond=abs(abs(q.x)+abs(q.y)-starR);
        float square=abs(max(abs(q.x),abs(q.y))-starR*0.7071);
        float star=min(diamond,square);
        float starLine=exp(-sq(star/0.0065))*smoothstep(0.3,0.33,r);
        float qa=atan(q.y,q.x);
        float slot=qa*12.0/(2.0*PI);
        float index=floor(slot+0.5);
        float spokeLen=mod(index,2.0)<0.5?0.58:0.5;
        float across=abs(slot-index)*2.0*PI*r/12.0;
        float spoke=exp(-sq(across/0.0045))*smoothstep(0.33,0.35,r)*(1.0-smoothstep(spokeLen-0.03,spokeLen,r));
        float node=1.0-smoothstep(0.0,0.004,abs(r-spokeLen)/0.03+across/0.018-1.0);
        float frame=band(r,starR+0.03,0.0045);
        float lines=starLine+spoke*0.9+node+frame*0.8;
        float veins=lines*(0.3+1.3*exp(-sq((r-front)/0.07))*(1.0-tick)*live);
        // The caster's spec icon at the heart, from the atlas once it has
        // loaded and its drawn emblem until then.
        vec2 e=p/0.26;
        float emblem;
        if(uSpecIconsReady>0.5){
          vec3 icon=paladinSpecIcon(e,uSpec);
          emblem=(1.0-smoothstep(-0.01,0.02,icon.x))*0.35+(1.0-smoothstep(0.0,0.03,icon.y-0.008));
        } else {
          float d=paladinSpecDist(e,uSpec);
          emblem=(1.0-smoothstep(-0.01,0.01,d))*0.35+(1.0-smoothstep(0.01,0.025,abs(d)));
        }
        emblem*=0.6+0.6*exp(-tick*5.0)*live;
        float hallow=band(r,0.3,0.008)*0.7;
        // Empowered by Ascension: a gold edge held round the ground, and the
        // emblem at the heart burning brighter.
        float gilt=uGild*(band(r,0.985,0.012)*1.4+band(r,0.955,0.006)*0.6);
        emblem*=1.0+0.5*uGild;
        float mask=(field+veins+emblem*0.75+hallow+gilt)*reveal+wave*1.15+embers;
        vec3 color=mix(GOLD,HOT,clamp(exp(-r*r*7.0)*0.6+wave+veins*0.5+emblem*0.4+gilt*0.3,0.0,1.0));
        color=mix(color,vec3(1.0,0.42,0.1),clamp(embers*1.6+wave*0.35,0.0,0.9));
        float opacity=uAlpha*mask;
        if(!(opacity>=0.003)) discard;
        gl_FragColor=vec4(color,opacity);
        #include <colorspace_fragment>
      }
    `,
      { ...paladinSpecIconUniforms(), uSpec: { value: DEFAULT_SPEC }, uGild: { value: 0 } },
    );
    shaders.push(ground);
    addTerrainMesh(
      this.createTerrainDisc(state.x, state.z, radius, 48),
      'paladin-consecration-base-glow',
      ground,
      5,
    );

    qualityObjects.push({
      object: addTerrainMesh(
        this.createTerrainRing(state.x, state.z, radius * 0.17, radius * 0.185),
        'paladin-consecration-inner-ring',
        basic('inner-ring', 0xffffcf, 0.28),
        8,
      ),
      minQuality: 0.25,
      detailShown: scale.secondary,
    });
    qualityObjects.push({
      object: addTerrainMesh(
        this.createTerrainRing(state.x, state.z, radius * 0.595, radius * 0.605),
        'paladin-consecration-middle-ring',
        basic('middle-ring', 0xffe78b, 0.18),
        8,
      ),
      minQuality: 0.65,
      detailShown: scale.secondary,
    });
    addTerrainMesh(
      this.createTerrainRing(state.x, state.z, radius * 0.982, radius),
      'paladin-consecration-perimeter',
      basic('perimeter', 0xffffb5, 0.42),
      9,
    );

    // The shared Paladin rune band at the rim, writing itself in and flashing
    // as each tick's wave reaches it.
    const runes = this.groundShader(
      'paladin_consecration:runes',
      state,
      radius,
      `
      ${GROUND_COMMON}
      ${PALADIN_RUNE_GLSL}
      void main(){
        vec2 p=vLocal;
        float spin=uTime*0.06;
        float c=cos(spin),s=sin(spin);
        vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
        float turn=fract(atan(q.y,q.x)/(2.0*PI)+0.25);
        // Past the seam once fully revealed, so no sliver of the band stays unwritten.
        float edge=uReveal*1.04;
        float drawn=1.0-smoothstep(edge-0.03,edge,turn);
        float tick=tickPhase();
        float flash=exp(-sq((waveFront()-0.9)/0.1))*(1.0-tick)*step(${REVEAL_SECONDS.toFixed(2)},uTime);
        // Quiet between ticks, flashing as each wave reaches it.
        float mask=paladinRuneRing(q,0.84,0.95)*drawn*(0.5+0.9*flash);
        vec3 color=mix(GOLD,HOT,0.35+flash*0.6);
        float opacity=uAlpha*mask;
        if(!(opacity>=0.003)) discard;
        gl_FragColor=vec4(color,opacity);
        #include <colorspace_fragment>
      }
    `,
    );
    shaders.push(runes);
    const runeField = addTerrainMesh(
      this.createTerrainRing(state.x, state.z, radius * 0.82, radius * 0.97),
      'paladin-consecration-sun-rune-field',
      runes,
      8,
    );
    runeField.userData.runeSegmentCount = 0;

    const pulseMaterial = this.material('pulse', 0xffc070, 0.35);
    const pulseRing = new THREE.Mesh(PULSE_GEOMETRY, pulseMaterial);
    pulseRing.name = 'paladin-consecration-pulse-ring';
    pulseRing.rotation.x = -Math.PI / 2;
    pulseRing.position.set(state.x, centerY + GROUND_LIFT * 2.2, state.z);
    pulseRing.renderOrder = floorVfxRenderOrder('player', 5);
    pulseRing.visible = scale.secondary;
    root.add(pulseRing);

    const shimmer = new THREE.Mesh(SHIMMER_GEOMETRY, basic('shimmer', 0xffefae, 0.035));
    shimmer.name = 'paladin-consecration-shimmer';
    shimmer.position.set(state.x, centerY + 0.25, state.z);
    shimmer.scale.set(radius, 1, radius);
    shimmer.renderOrder = floorVfxRenderOrder('player', 2);
    root.add(shimmer);
    qualityObjects.push({ object: shimmer, minQuality: 0.7, detailShown: scale.accents });

    // A column of light where the Paladin consecrates the ground.
    // Soft light, not a solid pipe: fading upward and toward its silhouette edges.
    const openingMaterial = new THREE.ShaderMaterial({
      name: 'paladin_consecration:opening',
      uniforms: { uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        varying float vUp; varying float vFacing;
        void main(){
          vUp=uv.y;
          vec4 view=modelViewMatrix*vec4(position,1.0);
          vec3 n=normalize(normalMatrix*normal);
          vFacing=abs(dot(n,normalize(-view.xyz)));
          gl_Position=projectionMatrix*view;
        }`,
      fragmentShader: `
        uniform float uAlpha; varying float vUp; varying float vFacing;
        void main(){
          float mask=pow(max(1.0-vUp,0.0),1.6)*vFacing*vFacing;
          float opacity=uAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(vec3(1.0,0.93,0.72)*1.4,opacity);
          #include <colorspace_fragment>
        }`,
    });
    const opening = new THREE.Mesh(OPENING_GEOMETRY, openingMaterial);
    opening.name = 'paladin-consecration-opening';
    opening.position.set(state.x, centerY + 5, state.z);
    opening.renderOrder = floorVfxRenderOrder('player', 6);
    opening.visible = scale.secondary;
    root.add(opening);

    // Each tick's wall of holy fire: flame tongues rising from the wave front,
    // white-hot at the root, gold in the body, licking orange at the tips.
    const fireMaterial = new THREE.ShaderMaterial({
      name: 'paladin_consecration:fire-wall',
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        varying vec2 vUv;
        void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uTime, uAlpha; varying vec2 vUv;
        float fireHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float fireNoise(vec2 p){
          vec2 i=floor(p),f=fract(p);
          f=f*f*(3.0-2.0*f);
          return mix(mix(fireHash(i),fireHash(i+vec2(1.0,0.0)),f.x),
                     mix(fireHash(i+vec2(0.0,1.0)),fireHash(i+vec2(1.0,1.0)),f.x),f.y);
        }
        void main(){
          float h=vUv.y;
          // Tongues: noise scrolling upward sets each flame's height around the ring.
          float n=fireNoise(vec2(vUv.x*26.0,h*2.0-uTime*4.5))*0.55
            +fireNoise(vec2(vUv.x*71.0,h*3.5-uTime*7.5))*0.45;
          float top=0.25+n*0.85;
          float tongue=1.0-smoothstep(top-0.14,top,h);
          // A hotter core runs up the middle of each tongue.
          float core=(1.0-smoothstep(top*0.55-0.1,top*0.55,h))*smoothstep(0.35,0.75,n);
          float root=exp(-h*7.0);
          float mask=tongue*(0.6+0.5*n)+core*0.5+root*0.7;
          vec3 color=mix(vec3(1.0,0.96,0.82),vec3(1.0,0.66,0.2),smoothstep(0.0,0.3,h));
          color=mix(color,vec3(1.0,0.34,0.08),smoothstep(0.3,0.8,h/max(top,0.01)));
          color=mix(color,vec3(1.0,0.93,0.75),core*0.6);
          float opacity=uAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color*1.7,opacity);
          #include <colorspace_fragment>
        }`,
    });
    const fireWall = new THREE.Mesh(FIRE_GEOMETRY, fireMaterial);
    fireWall.name = 'paladin-consecration-fire-wall';
    fireWall.position.set(state.x, centerY, state.z);
    fireWall.renderOrder = floorVfxRenderOrder('player', 5);
    fireWall.visible = false;
    root.add(fireWall);

    const moteMaterial = basic('motes', 0xffffd7, 0.8);
    const motes = new THREE.InstancedMesh(MOTE_GEOMETRY, moteMaterial, MOTE_COUNT);
    motes.name = 'paladin-consecration-motes';
    motes.position.set(state.x, centerY, state.z);
    motes.renderOrder = floorVfxRenderOrder('player', 6);
    // Fewer instances drawn, the same buffer and program.
    motes.count = paladinDetailCount(MOTE_COUNT, detail);
    root.add(motes);
    qualityObjects.push({ object: motes, minQuality: 0.25, detailShown: true });

    const ambientOffset = (
      index: number,
      count: number,
      distance: number,
      phaseStep: number,
    ): AmbientOffset => {
      const angle = (index / count) * Math.PI * 2 + (index % 2) * 0.19;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      return {
        x,
        y: this.groundY(state.x + x, state.z + z) - centerY,
        z,
        phase: index * phaseStep,
        scale: 0.78 + (index % 3) * 0.12,
      };
    };
    // The drawn motes share the whole circle: a lighter tier draws fewer of
    // them spread all the way round, never the first few bunched on one side.
    const motesShown = Math.max(1, motes.count);
    const moteOffsets = Array.from({ length: MOTE_COUNT }, (_, index) =>
      ambientOffset(index, motesShown, radius * (0.2 + (index % 5) * 0.15), 0.67),
    );

    const visual: ConsecrationVisual = {
      root,
      motes,
      pulseRing,
      pulseMaterial,
      shimmer,
      opening,
      openingMaterial,
      fireWall,
      fireMaterial,
      fireBase: centerY,
      moteOffsets,
      scratch: new THREE.Matrix4(),
      scratchPosition: new THREE.Vector3(),
      scratchScale: new THREE.Vector3(),
      scratchRotation: new THREE.Quaternion(),
      materials,
      baseOpacities,
      shaders,
      ground,
      specSettled: false,
      gilded: false,
      geometries,
      qualityObjects,
      detail,
      fadeSeconds: paladinDetailLinger(FADE_SECONDS, detail),
      openingSeconds: paladinDetailLinger(OPENING_SECONDS, detail),
      radius,
      duration: Math.max(0.1, state.duration),
      elapsed: Math.max(0, state.duration - state.remaining),
      lastRemaining: state.remaining,
    };
    materials.push(pulseMaterial);
    baseOpacities.push(0.3);
    this.applyQuality(visual);
    this.placeAmbient(visual, true);
    this.animate(visual, 0, true);
    this.active.set(state.id, visual);
    this.scene.add(root);
  }

  private applyQuality(visual: ConsecrationVisual): void {
    for (const { object, minQuality, detailShown } of visual.qualityObjects) {
      object.visible = detailShown && this.quality >= minQuality;
    }
  }

  private material(role: string, color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      name: `paladin_consecration:${role}`,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private animate(visual: ConsecrationVisual, dt: number, reducedMotion: boolean): void {
    const t = visual.elapsed;
    bindPaladinSpecIcons(visual.ground);
    if (!visual.specSettled) {
      // The cast notes the caster's spec where they stood; the zone may open a
      // frame before or after it.
      const center = visual.ground.uniforms.uCenter.value as THREE.Vector2;
      const spec = paladinConsecrationSpecAt(center.x, center.y);
      if (spec !== null) visual.ground.uniforms.uSpec.value = spec;
      visual.specSettled = spec !== null || t > SPEC_SEARCH_SECONDS;
    }
    if (!visual.gilded && t <= SPEC_SEARCH_SECONDS) {
      const center = visual.ground.uniforms.uCenter.value as THREE.Vector2;
      visual.gilded = paladinConsecrationAscendedAt(center.x, center.y);
    }
    visual.ground.uniforms.uGild.value = visual.gilded ? 1 : 0;
    const gild = visual.gilded ? 1.3 : 1;
    const fade = Math.min(1, Math.max(0, (visual.duration - t) / visual.fadeSeconds));
    const reveal = Math.min(1, t / REVEAL_SECONDS);
    const breathe = reducedMotion ? 1 : 0.95 + Math.sin(t * Math.PI * 2) * 0.05;
    visual.materials.forEach((material, index) => {
      material.opacity = visual.baseOpacities[index] * fade * reveal * breathe;
    });
    for (const shader of visual.shaders) {
      shader.uniforms.uTime.value = reducedMotion ? REVEAL_SECONDS + 0.58 : t;
      shader.uniforms.uAlpha.value = fade;
      shader.uniforms.uReveal.value = reveal;
    }

    // Each tick sends a ring out from the heart; the opening sends the first.
    const phase =
      t < REVEAL_SECONDS
        ? t / REVEAL_SECONDS
        : reducedMotion
          ? 0.58
          : (t % TICK_SECONDS) / TICK_SECONDS;
    visual.pulseRing.scale.setScalar(visual.radius * (0.15 + phase * 0.95));
    visual.pulseMaterial.opacity = 0.35 * gild * fade * reveal * (1 - phase) ** 1.6;

    // The wall of holy fire rides the wave out to the rim and burns down.
    const front = Math.min(1, phase * 1.15);
    const burning = reducedMotion
      ? 0
      : (1 - phase) ** 1.2 * (1 - Math.max(0, phase * 1.15 - 1) * 4);
    visual.fireWall.visible =
      burning > 0.01 && front > 0.05 && paladinDetailScale(visual.detail).secondary;
    visual.fireWall.scale.set(
      visual.radius * front,
      0.9 + 1.1 * (1 - phase),
      visual.radius * front,
    );
    visual.fireWall.position.y = visual.fireBase + visual.fireWall.scale.y / 2;
    visual.fireMaterial.uniforms.uTime.value = t;
    // The wall of fire marks each tick's sweep; kept below the full blaze so a
    // 6 m ring of it every second does not drown the fight inside.
    visual.fireMaterial.uniforms.uAlpha.value = Math.max(0, burning) * fade * reveal * 0.75 * gild;

    // The column of light at the opening.
    const open = reducedMotion ? 0 : Math.max(0, 1 - t / visual.openingSeconds);
    visual.openingMaterial.uniforms.uAlpha.value = 0.7 * open * open;
    visual.opening.scale.set(0.6 + 0.4 * open, 1, 0.6 + 0.4 * open);

    if (reducedMotion) return;
    if (visual.motes.visible) visual.motes.rotation.y += dt * 0.11;
    if (visual.shimmer.visible) visual.shimmer.rotation.y += dt * 0.08;
    this.placeAmbient(visual, false);
  }

  private placeAmbient(visual: ConsecrationVisual, staticPose: boolean): void {
    const t = visual.elapsed;
    if (visual.motes.visible) {
      // Motes rise through the light and fade as they climb, looping.
      for (let index = 0; index < visual.motes.count; index++) {
        const offset = visual.moteOffsets[index];
        const climb = staticPose ? 0.4 : (t * 0.45 + offset.phase / 6.28) % 1;
        const scale = offset.scale * Math.sin(climb * Math.PI);
        visual.scratchPosition.set(offset.x, offset.y + 0.15 + climb * 2.2, offset.z);
        visual.scratchScale.set(scale, scale, scale);
        visual.scratch.compose(visual.scratchPosition, visual.scratchRotation, visual.scratchScale);
        visual.motes.setMatrixAt(index, visual.scratch);
      }
      visual.motes.instanceMatrix.needsUpdate = true;
    }
  }

  private disposeVisual(visual: ConsecrationVisual): void {
    this.scene.remove(visual.root);
    for (const material of visual.materials) material.dispose();
    for (const shader of visual.shaders) shader.dispose();
    visual.openingMaterial.dispose();
    visual.fireMaterial.dispose();
    // Only the per-zone terrain drape: the fixed-shape geometries are shared.
    for (const geometry of visual.geometries) geometry.dispose();
    visual.motes.dispose();
  }

  private createTerrainRing(
    x: number,
    z: number,
    innerRadius: number,
    outerRadius: number,
  ): THREE.BufferGeometry {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      for (const radius of [innerRadius, outerRadius]) {
        const sampleX = x + Math.cos(angle) * radius;
        const sampleZ = z + Math.sin(angle) * radius;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + GROUND_LIFT, sampleZ);
      }
      if (segment < SEGMENTS) {
        const inner = segment * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private createTerrainDisc(
    x: number,
    z: number,
    radius: number,
    segments: number,
  ): THREE.BufferGeometry {
    const vertices = [x, this.groundY(x, z) + GROUND_LIFT, z];
    const indices: number[] = [];
    const radialSegments = 8;
    for (let ring = 1; ring <= radialSegments; ring++) {
      const sampleRadius = (radius * ring) / radialSegments;
      for (let segment = 0; segment <= segments; segment++) {
        const angle = (segment / segments) * Math.PI * 2;
        const sampleX = x + Math.cos(angle) * sampleRadius;
        const sampleZ = z + Math.sin(angle) * sampleRadius;
        vertices.push(sampleX, this.groundY(sampleX, sampleZ) + GROUND_LIFT, sampleZ);
        if (segment >= segments) continue;
        const current = 1 + (ring - 1) * (segments + 1) + segment;
        if (ring === 1) indices.push(0, current, current + 1);
        else {
          const previous = current - (segments + 1);
          indices.push(previous, current, previous + 1, current, current + 1, previous + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    return geometry;
  }
}

/**
 * The boot manifest's stand-in: one hidden Holy Ground built from a fixed
 * state over flat ground, never disposed, so each program a live zone draws
 * (the ground and rune shaders, the opening column, the fire wall, the
 * additive rings, shimmer and pulse, the instanced motes) is linked behind the
 * loading cover and stays referenced for the session. Every live zone mints
 * its own material instances (their uniforms are per zone) and disposes them
 * when it ends; with this anchor holding the same programs, a zone's teardown
 * never releases one and the next cast relinks nothing. Registered in
 * ABILITY_MATERIAL_SOURCES.
 */
interface PaladinConsecrationStandIn {
  root: THREE.Object3D;
  materials: THREE.Material[];
}
let paladinConsecrationStandIn: PaladinConsecrationStandIn | null = null;

export function buildPaladinConsecrationStandIn(): PaladinConsecrationStandIn {
  if (!paladinConsecrationStandIn) {
    const scratch = new THREE.Scene();
    new PaladinConsecrationVisuals(scratch, () => 0).sync([
      { id: 'paladin-consecration-stand-in', x: 0, z: 0, radius: 8, duration: 8, remaining: 8 },
    ]);
    const root = scratch.children[0];
    root.removeFromParent();
    root.name = 'paladin-consecration-stand-in';
    root.visible = false;
    const materials: THREE.Material[] = [];
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (material && !Array.isArray(material) && !materials.includes(material)) {
        materials.push(material);
      }
    });
    paladinConsecrationStandIn = { root, materials };
  }
  return paladinConsecrationStandIn;
}

export function paladinConsecrationStandInMaterials(): readonly THREE.Material[] {
  return buildPaladinConsecrationStandIn().materials;
}
