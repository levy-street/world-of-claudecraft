// The Sunken Bastion's boss visuals (plan: bastion_boss_fx_core.ts), all read
// off mirrored entity state so offline and online look the same:
//  - Olen: the four Breach Bastion buttresses drawn in their live state (the
//    kit piece swaps intact, cracked, broken, with a burst of dust and stone
//    on each crash), the Oathbound Charge lane on the floor (stopping at the
//    first standing buttress, as the sim resolves it), a gold oath glow under
//    him growing with each Unbroken Oath stack, dizzy stars while Breached,
//    and the heroic Undertow Wake flooding the lane behind a charge;
//  - (the Turnkey's cage and Ossick's anchor and shackles: bastion_gaol_fx.ts;
//    Vael's reaper visuals: bastion_reaper_fx.ts);
//  - Vael: the Mist Surge ring, the Fogbeacon's beam swung down onto the
//    crown during the Fog Veil with its pool of light on the roof, a hard
//    shadow and a gold flare on the REAL Vael when the beam finds him (light
//    pours through a fog shade in a green shimmer instead), and the crown
//    flooding as the Drowning Hymn rises;
//  - the Turretback Hermit: a shimmering barnacle dome while it withdraws.
//
// Rules (src/render/CLAUDE.md): pooled meshes and materials built once under
// the telegraph root (compile-gated by BastionFx), no per-frame allocation.
// Everything a player acts on (lanes, rings, the beam and its reveal, the
// flood, the dome) draws on every tier;
// only the dust, debris and smoke shed on the low effects tier.

import * as THREE from 'three';
import {
  BEACON_LAMP_TEMPLATE,
  BUTTRESS_TEMPLATES,
  CROWN as CROWN_DEF,
  FOG_SHADE_ID,
  OLEN_BREACHED,
  OLEN_ID,
  OLEN_OATHBOUND_CHARGE,
  OLEN_UNBROKEN_OATH,
  TURRETBACK_ID,
  UNDERTOW_TEMPLATE,
  VAEL_FOG_VEIL,
  VAEL_ID,
  VAEL_MIST_SURGE,
  VAEL_TUNING,
} from '../../sim/encounters/sunken_bastion';
import { TRASH_WITHDRAW_AURA } from '../../sim/mob/trash_kit/support';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { radialGlowTexture } from '../textures';
import { setBeaconYaw } from './bastion_beacon';
import {
  BEAM_HALF,
  type BeamReveal,
  BUTTRESS_BURST_RADIUS,
  BUTTRESS_PIECES,
  bastionSlotOrigin,
  beamReveal,
  buttressAt,
  buttressCrash,
  buttressPiece,
  HYMN_FLOOD_DEPTH,
  hymnFlood,
  OATH_LANE_HALF,
  oathLaneLength,
  pickVeilClaim,
  predictBeamYaw,
  revealGlow,
  standingButtressIds,
  VAEL_LANTERN,
  type VeilCandidate,
} from './bastion_boss_fx_core';
import { modelPointWorld } from './bastion_creature_fx_core';
import { BASTION_TELEGRAPH_COLORS } from './bastion_fx_core';
import { bastionKitPiece, bastionKitReady, bastionSlotMaterial } from './bastion_kit';

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;
type Slot = 'stone' | 'glow' | 'glass';

const SCAN_SEC = 0.1;
const BUTTRESS_SLOTS = 8;
const WAKE_SLOTS = 4;
const REVEAL_SLOTS = 4;
const PUFF_SLOTS = 24;
const DEBRIS = 18;
const LIFT = 0.08;
const DOME_R = 9.5;

let glowTex: THREE.Texture | null = null;
function glow(): THREE.Texture {
  glowTex ??= radialGlowTexture();
  return glowTex;
}

function hasAura(e: EntityView, id: string): boolean {
  for (const a of e.auras) if (a.id === id) return true;
  return false;
}

function auraOf(e: EntityView, id: string): EntityView['auras'][number] | undefined {
  for (const a of e.auras) if (a.id === id) return a;
  return undefined;
}

// ---- shaders ---------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// The Undertow Wake: churning sea water racing down the lane, a frost edge.
const WAKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLength;
uniform float uAlpha;
uniform vec3 uEdge;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE}
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float along = vUv.y * uLength;
  float churn = noise(vec2(vUv.x * 6.0, along * 0.5 - uTime * 3.2)) * 0.6
    + noise(vec2(vUv.x * 14.0 + 3.0, along * 1.3 - uTime * 5.0)) * 0.4;
  float foam = smoothstep(0.55, 0.85, churn) * (0.6 + 0.4 * across);
  vec3 sea = mix(vec3(0.04, 0.16, 0.18), vec3(0.1, 0.32, 0.34), churn);
  vec3 col = mix(sea, vec3(0.86, 0.97, 1.0), foam);
  float edge = smoothstep(0.82, 0.97, across);
  col = mix(col, uEdge, edge);
  float a = (0.72 + 0.25 * foam + 0.3 * edge) * uAlpha;
  gl_FragColor = vec4(col, min(1.0, a));
  #include <colorspace_fragment>
}
`;

// The Drowning Hymn's flood: murky green sea water welling over the crown.
const FLOOD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE}
void main() {
  vec2 p = vWorld.xz * 0.22;
  float n = noise(p + vec2(uTime * 0.3, -uTime * 0.21)) * 0.5
    + noise(p * 2.3 - vec2(uTime * 0.5, uTime * 0.37)) * 0.35
    + noise(p * 6.0 + uTime * 0.8) * 0.15;
  float r = length(vUv - 0.5) * 2.0;
  float rimFoam = smoothstep(0.86, 0.98, r) * (0.5 + 0.5 * n);
  vec3 col = mix(vec3(0.03, 0.08, 0.065), vec3(0.11, 0.26, 0.19), n);
  col += vec3(0.45, 0.8, 0.62) * smoothstep(0.66, 0.82, n) * 0.22;
  col = mix(col, vec3(0.5, 0.72, 0.62), rimFoam * 0.6);
  gl_FragColor = vec4(col, (0.62 + 0.22 * n + 0.12 * rimFoam) * uAlpha);
  #include <colorspace_fragment>
}
`;

// The Hermit's withdraw dome: a barnacle-sheened fresnel shell.
const DOME_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const DOME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec3 vNormalW;
varying vec3 vWorld;
${NOISE}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(max(1.0 - abs(dot(view, vNormalW)), 0.0), 2.2);
  float cells = noise(vWorld.xz * 1.6 + vWorld.y * 0.9 + uTime * 0.4);
  float web = smoothstep(0.42, 0.5, cells) - smoothstep(0.5, 0.58, cells);
  vec3 col = mix(vec3(0.2, 0.75, 0.7), vec3(0.8, 1.0, 0.95), web);
  float a = (0.12 + fres * 0.75 + web * 0.35) * uAlpha;
  gl_FragColor = vec4(col * (0.7 + fres), a);
  #include <colorspace_fragment>
}
`;

// The dark cast shadow the beam throws off the real Vael.
const SHADOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
uniform float uAlpha;
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, across)) * (1.0 - (1.0 - vUv.y) * 0.85) * uAlpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

// ---- pooled pieces -----------------------------------------------------------------

interface ButtressSlot {
  group: THREE.Group;
  pieces: Map<string, THREE.InstancedMesh[]>;
  entityId: number;
  template: string;
  withKit: boolean;
}

interface WakeSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  entityId: number;
}

interface RevealSlot {
  entityId: number;
  flare: THREE.Sprite;
  core: THREE.Sprite;
  shimmer: THREE.Sprite;
  shadow: THREE.Mesh;
  shadowMat: THREE.ShaderMaterial;
  kind: BeamReveal;
  k: number;
}

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  age: number;
  life: number;
  from: number;
  to: number;
  rise: number;
  peak: number;
}

interface Debris {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  age: number;
  floor: number;
}

export class BastionBossFx {
  private readonly root = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly buttresses: ButtressSlot[] = [];
  private readonly wakes: WakeSlot[] = [];
  private readonly reveals: RevealSlot[] = [];
  private readonly lantern = { x: 0, y: 0, z: 0 };
  private readonly puffs: Puff[] = [];
  private readonly debris: Debris[] = [];
  private readonly debrisMesh: THREE.InstancedMesh | null;
  private readonly oathGlow: THREE.Mesh;
  private readonly oathMat: THREE.MeshBasicMaterial;
  private readonly stars: THREE.Sprite[] = [];
  private readonly flood: THREE.Mesh;
  private readonly floodMat: THREE.ShaderMaterial;
  private readonly beamPool: THREE.Mesh;
  private readonly beamPoolMat: THREE.MeshBasicMaterial;
  private readonly domes: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; entityId: number }[] = [];
  /** Standing buttress ids per slot (Olen's lane resolver reads it). */
  private readonly standing = new Map<number, Set<string>>();
  private readonly seenShades = new Set<number>();
  private readonly deadShades = new Set<number>();
  private readonly buttressIds: number[] = [];
  private readonly wakeIds: number[] = [];
  private readonly veilIds: number[] = [];
  private olenId = -1;
  private vaelId = -1;
  private lampId = -1;
  private hermitIds: number[] = [];
  private lampSample = 0;
  private lampSampleAge = 0;
  private beamSlot: { x: number; z: number } | null = null;
  private floodLevel = 0;
  private floodTop = -Infinity;
  private scan = 0;
  private clock = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    private readonly cosmetic: boolean,
  ) {
    this.root.name = 'sunken-bastion-boss-fx';
    parent.add(this.root);
    for (let i = 0; i < BUTTRESS_SLOTS; i++) {
      const group = new THREE.Group();
      group.visible = false;
      this.root.add(group);
      this.buttresses.push({
        group,
        pieces: new Map(),
        entityId: -1,
        template: '',
        withKit: false,
      });
    }
    // Olen's oath glow and dizzy stars.
    const discGeo = this.geo(new THREE.CircleGeometry(1, 40));
    discGeo.rotateX(-Math.PI / 2);
    this.oathMat = this.basic(0xffc040, 0);
    this.oathMat.map = glow();
    this.oathGlow = new THREE.Mesh(discGeo, this.oathMat);
    this.oathGlow.visible = false;
    this.oathGlow.renderOrder = floorVfxRenderOrder('encounter', 4);
    this.root.add(this.oathGlow);
    for (let i = 0; i < 3; i++) {
      const star = this.sprite(0xfff2a0, 0.95, 0.9);
      star.visible = false;
      this.root.add(star);
      this.stars.push(star);
    }
    // Undertow Wakes.
    const wakeGeo = this.geo(new THREE.PlaneGeometry(1, 1, 1, 12));
    wakeGeo.rotateX(-Math.PI / 2);
    wakeGeo.translate(0, 0, 0.5);
    for (let i = 0; i < WAKE_SLOTS; i++) {
      const mat = this.shader(
        WAKE_FRAG,
        {
          uLength: { value: 1 },
          uAlpha: { value: 1 },
          uEdge: { value: new THREE.Color(BASTION_TELEGRAPH_COLORS.frost) },
        },
        false,
      );
      const mesh = new THREE.Mesh(wakeGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 8);
      this.root.add(mesh);
      this.wakes.push({ mesh, mat, entityId: -1 });
    }
    // The Hymn's flood and the beam's pool of light on the crown.
    const floodGeo = this.geo(new THREE.CircleGeometry(CROWN_DEF.r - 0.6, 72));
    floodGeo.rotateX(-Math.PI / 2);
    this.floodMat = this.shader(FLOOD_FRAG, { uAlpha: { value: 0 } }, false);
    this.flood = new THREE.Mesh(floodGeo, this.floodMat);
    this.flood.visible = false;
    this.flood.frustumCulled = false;
    this.flood.renderOrder = floorVfxRenderOrder('encounter', 2);
    this.root.add(this.flood);
    const poolGeo = this.geo(
      new THREE.RingGeometry(6.8, CROWN_DEF.r - 0.4, 6, 4, Math.PI / 2 - BEAM_HALF, BEAM_HALF * 2),
    );
    // Ring angles run from +x; turn so the sector centres on +z (sim yaw 0).
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.rotateY(Math.PI);
    this.beamPoolMat = this.basic(0xfff1c8, 0.42);
    this.beamPoolMat.blending = THREE.AdditiveBlending;
    this.beamPool = new THREE.Mesh(poolGeo, this.beamPoolMat);
    this.beamPool.visible = false;
    this.beamPool.frustumCulled = false;
    this.beamPool.renderOrder = floorVfxRenderOrder('encounter', 6);
    this.root.add(this.beamPool);
    // The reveal.
    const shadowGeo = this.geo(new THREE.PlaneGeometry(1.6, 1, 1, 1));
    shadowGeo.rotateX(-Math.PI / 2);
    shadowGeo.translate(0, 0, 0.5);
    for (let i = 0; i < REVEAL_SLOTS; i++) {
      // The real Vael's lantern flares: a wide amber halo round a white-hot
      // core (two sprites), so the tell reads across the roof.
      const flare = this.sprite(0xffc56a, 0, 9);
      const core = this.sprite(0xfff8e8, 0, 3.2);
      const shimmer = this.sprite(0x9dffc6, 0, 4.5);
      const shadowMat = this.shader(SHADOW_FRAG, { uAlpha: { value: 0 } }, false, true);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.frustumCulled = false;
      shadow.renderOrder = floorVfxRenderOrder('encounter', 5);
      for (const o of [flare, core, shimmer, shadow]) {
        o.visible = false;
        this.root.add(o);
      }
      this.reveals.push({
        entityId: -1,
        flare,
        core,
        shimmer,
        shadow,
        shadowMat,
        kind: null,
        k: 0,
      });
    }
    // The Hermit's dome.
    const domeGeo = this.geo(
      new THREE.SphereGeometry(DOME_R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    );
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sunkenBastionHermitDome',
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        uniforms: { uTime: sharedUniforms.uTime, uAlpha: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(domeGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.domes.push({ mesh, mat, entityId: -1 });
    }
    // Cosmetic dust, smoke and debris.
    if (cosmetic) {
      for (let i = 0; i < PUFF_SLOTS; i++) {
        const sprite = this.sprite(0xffffff, 0, 1);
        sprite.visible = false;
        this.root.add(sprite);
        this.puffs.push({
          sprite,
          mat: sprite.material as THREE.SpriteMaterial,
          age: -1,
          life: 1,
          from: 1,
          to: 2,
          rise: 0,
          peak: 0.6,
        });
      }
      const chunk = this.geo(new THREE.DodecahedronGeometry(0.3, 0));
      const chunkMat = new THREE.MeshStandardMaterial({ color: 0x4d524c, roughness: 0.95 });
      this.materials.push(chunkMat);
      this.debrisMesh = new THREE.InstancedMesh(chunk, chunkMat, DEBRIS);
      this.debrisMesh.count = 0;
      this.debrisMesh.frustumCulled = false;
      this.root.add(this.debrisMesh);
      for (let i = 0; i < DEBRIS; i++)
        this.debris.push({
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          spin: new THREE.Vector3(),
          rot: new THREE.Euler(),
          age: -1,
          floor: 0,
        });
    } else {
      this.debrisMesh = null;
    }
  }

  /** The live Olen lane length, for the telegraph resolver. */
  laneLength(caster: EntityView): number {
    const o = bastionSlotOrigin(caster.pos.x, caster.pos.z);
    const standing = this.standing.get(o.slot) ?? ALL_STANDING;
    return oathLaneLength(caster.pos.x - o.x, caster.pos.z - o.z, caster.facing, standing);
  }

  // ---- builders ----------------------------------------------------------------------

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private basic(color: number, opacity: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.materials.push(m);
    return m;
  }

  private sprite(color: number, opacity: number, size: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: glow(),
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(mat);
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    return s;
  }

  private shader(
    frag: string,
    extra: Record<string, THREE.IUniform>,
    additive: boolean,
    normalBlend = false,
  ): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      name: 'sunkenBastionBossFx',
      vertexShader: WATER_VERT,
      fragmentShader: frag,
      uniforms: { uTime: sharedUniforms.uTime, ...extra },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    if (normalBlend) m.blending = THREE.NormalBlending;
    this.materials.push(m);
    return m;
  }

  private buildButtressPieces(slot: ButtressSlot): void {
    for (const meshes of slot.pieces.values()) for (const m of meshes) slot.group.remove(m);
    slot.pieces.clear();
    for (const piece of BUTTRESS_PIECES) {
      const baked = bastionKitPiece(piece);
      const list: THREE.InstancedMesh[] = [];
      for (const s of ['stone', 'glow', 'glass'] as Slot[]) {
        const g = baked[s];
        if (!g) continue;
        // One-instance InstancedMesh: the same program the kit already linked.
        const mesh = new THREE.InstancedMesh(g, bastionSlotMaterial(s), 1);
        mesh.setMatrixAt(0, this.m4.identity());
        mesh.castShadow = s === 'stone';
        mesh.receiveShadow = s === 'stone';
        mesh.visible = false;
        slot.group.add(mesh);
        list.push(mesh);
      }
      slot.pieces.set(piece, list);
    }
    slot.withKit = bastionKitReady();
  }

  // ---- the scan ------------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.clock += dt;
    this.lampSampleAge += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.updateButtresses(world);
    this.updateOlen(world);
    this.updateWakes(world, dt);
    this.updateVael(world, dt);
    this.updateHermits(world);
    this.updatePuffs(dt);
  }

  private scanWorld(world: IWorld): void {
    this.buttressIds.length = 0;
    this.wakeIds.length = 0;
    this.veilIds.length = 0;
    this.hermitIds = [];
    this.olenId = -1;
    this.vaelId = -1;
    const vaels: VeilCandidate[] = [];
    const lamps: VeilCandidate[] = [];
    const figures: { id: number; slot: number }[] = [];
    const me = world.entities.get(world.playerId);
    this.standing.clear();
    const perSlot = new Map<number, { lx: number; lz: number; templateId: string }[]>();
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        const t = e.templateId;
        if (t.startsWith('bastion_buttress_')) {
          this.buttressIds.push(e.id);
          const o = bastionSlotOrigin(e.pos.x, e.pos.z);
          const list = perSlot.get(o.slot) ?? [];
          list.push({ lx: e.pos.x - o.x, lz: e.pos.z - o.z, templateId: t });
          perSlot.set(o.slot, list);
        } else if (t === UNDERTOW_TEMPLATE) this.wakeIds.push(e.id);
        else if (t === BEACON_LAMP_TEMPLATE)
          lamps.push({ id: e.id, slot: bastionSlotOrigin(e.pos.x, e.pos.z).slot });
        continue;
      }
      if (e.kind !== 'mob') continue;
      const t = e.templateId;
      if (t === OLEN_ID && !e.dead) this.olenId = e.id;
      else if (t === VAEL_ID) {
        if (!e.dead) {
          vaels.push({
            id: e.id,
            slot: bastionSlotOrigin(e.pos.x, e.pos.z).slot,
            veiled: hasAura(e, VAEL_FOG_VEIL),
            dist: me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0,
          });
          figures.push({ id: e.id, slot: bastionSlotOrigin(e.pos.x, e.pos.z).slot });
        }
      } else if (t === FOG_SHADE_ID) {
        if (e.dead) {
          if (!this.deadShades.has(e.id)) {
            this.deadShades.add(e.id);
            this.burst(e.pos.x, e.pos.y + 1.5, e.pos.z, 0x8dffb8, 4, 2.2, 7, 1.2);
          }
        } else {
          figures.push({ id: e.id, slot: bastionSlotOrigin(e.pos.x, e.pos.z).slot });
          if (!this.seenShades.has(e.id)) {
            this.seenShades.add(e.id);
            this.burst(e.pos.x, e.pos.y + 1.2, e.pos.z, 0x9fe8c4, 5, 2.5, 8, 1.4);
          }
        }
      } else if (t === TURRETBACK_ID && !e.dead && hasAura(e, TRASH_WITHDRAW_AURA))
        this.hermitIds.push(e.id);
    }
    for (const [slot, list] of perSlot) this.standing.set(slot, standingButtressIds(list));
    // Several claims in the world (offline): follow the veiled (else nearest)
    // Vael and his own claim's lamp.
    const pick = pickVeilClaim(vaels, lamps);
    this.vaelId = pick.vaelId;
    const slot = vaels.find((v) => v.id === pick.vaelId)?.slot;
    for (const f of figures) if (f.slot === slot) this.veilIds.push(f.id);
    const lampId = pick.lampId;
    if (lampId !== this.lampId) {
      this.lampId = lampId;
      this.lampSampleAge = 99;
    }
    if (this.seenShades.size > 32)
      for (const id of this.seenShades) if (!world.entities.has(id)) this.seenShades.delete(id);
    if (this.deadShades.size > 32)
      for (const id of this.deadShades) if (!world.entities.has(id)) this.deadShades.delete(id);
  }

  // ---- Olen ----------------------------------------------------------------------------

  private updateButtresses(world: IWorld): void {
    for (const slot of this.buttresses) {
      if (slot.entityId < 0) continue;
      const e = world.entities.get(slot.entityId);
      if (!e || !e.templateId.startsWith('bastion_buttress_')) {
        slot.entityId = -1;
        slot.group.visible = false;
      }
    }
    for (const id of this.buttressIds) {
      let slot = this.buttresses.find((b) => b.entityId === id);
      const e = world.entities.get(id);
      if (!e) continue;
      if (!slot) {
        slot = this.buttresses.find((b) => b.entityId < 0);
        if (!slot) continue;
        const o = bastionSlotOrigin(e.pos.x, e.pos.z);
        const at = buttressAt(e.pos.x - o.x, e.pos.z - o.z);
        slot.entityId = id;
        slot.template = e.templateId;
        slot.group.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
        slot.group.rotation.y = at?.yaw ?? 0;
        slot.group.visible = true;
        this.showButtress(slot, e.templateId);
      }
      if (!slot.withKit && bastionKitReady()) this.showButtress(slot, slot.template, true);
      if (slot.template !== e.templateId) {
        if (buttressCrash(slot.template, e.templateId)) this.crash(slot.group.position);
        slot.template = e.templateId;
        this.showButtress(slot, e.templateId);
      }
    }
  }

  private showButtress(slot: ButtressSlot, templateId: string, rebuild = false): void {
    if (rebuild || slot.pieces.size === 0) this.buildButtressPieces(slot);
    const want = buttressPiece(templateId);
    for (const [piece, meshes] of slot.pieces) for (const m of meshes) m.visible = piece === want;
  }

  private crash(at: THREE.Vector3): void {
    if (!this.cosmetic) return;
    this.burst(
      at.x,
      at.y + 3,
      at.z,
      0xb8b4a8,
      7,
      BUTTRESS_BURST_RADIUS * 0.6,
      BUTTRESS_BURST_RADIUS * 2,
      1.6,
      0.35,
    );
    this.burst(at.x, at.y + 1, at.z, 0xfff0d0, 2, 2, 7, 0.35);
    for (const d of this.debris) {
      if (d.age >= 0 && d.age < 1.4) continue;
      const a = Math.random() * Math.PI * 2;
      const up = 5 + Math.random() * 6;
      d.pos.set(at.x + Math.sin(a) * 1.2, at.y + 5 + Math.random() * 4, at.z + Math.cos(a) * 1.2);
      d.vel.set(Math.sin(a) * (3 + Math.random() * 5), up, Math.cos(a) * (3 + Math.random() * 5));
      d.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      d.rot.set(0, 0, 0);
      d.age = 0;
      d.floor = at.y;
    }
  }

  private updateOlen(world: IWorld): void {
    const olen = this.olenId >= 0 ? world.entities.get(this.olenId) : undefined;
    if (!olen || olen.dead) {
      this.oathGlow.visible = false;
      for (const s of this.stars) s.visible = false;
      return;
    }
    const floor = this.groundY(olen.pos.x, olen.pos.z);
    const oath = auraOf(olen, OLEN_UNBROKEN_OATH);
    const stacks = oath ? Math.max(1, oath.stacks ?? 1) : 0;
    this.oathGlow.visible = stacks > 0;
    if (stacks > 0) {
      const r = 2.4 + stacks * 0.7;
      this.oathGlow.position.set(olen.pos.x, floor + LIFT, olen.pos.z);
      this.oathGlow.scale.set(r, 1, r);
      this.oathMat.opacity =
        Math.min(0.85, 0.25 + stacks * 0.12) * (0.8 + 0.2 * Math.sin(this.clock * 5));
    }
    const dizzy = hasAura(olen, OLEN_BREACHED);
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.visible = dizzy;
      if (!dizzy) continue;
      const a = this.clock * 3.2 + (i * Math.PI * 2) / this.stars.length;
      s.position.set(
        olen.pos.x + Math.sin(a) * 1.3,
        olen.pos.y + 4.6 * olen.scale + Math.sin(a * 2) * 0.15,
        olen.pos.z + Math.cos(a) * 1.3,
      );
    }
  }

  private updateWakes(world: IWorld, dt: number): void {
    for (const w of this.wakes) {
      if (w.entityId < 0) continue;
      const e = world.entities.get(w.entityId);
      if (!e || e.templateId !== UNDERTOW_TEMPLATE) {
        w.entityId = -1;
        w.mesh.visible = false;
      }
    }
    for (const id of this.wakeIds) {
      if (this.wakes.some((w) => w.entityId === id)) continue;
      const w = this.wakes.find((s) => s.entityId < 0);
      if (!w) break;
      w.entityId = id;
      w.mat.uniforms.uAlpha.value = 0;
      w.mesh.visible = true;
    }
    for (const w of this.wakes) {
      if (w.entityId < 0) continue;
      const e = world.entities.get(w.entityId);
      if (!e) continue;
      const length = Math.max(1, e.scale);
      w.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + LIFT + 0.04, e.pos.z);
      w.mesh.rotation.y = e.facing;
      w.mesh.scale.set(OATH_LANE_HALF * 2, 1, length);
      w.mat.uniforms.uLength.value = length;
      w.mat.uniforms.uAlpha.value = Math.min(1, (w.mat.uniforms.uAlpha.value as number) + dt * 3);
    }
  }

  // ---- Vael ----------------------------------------------------------------------------

  private updateVael(world: IWorld, dt: number): void {
    const vael = this.vaelId >= 0 ? world.entities.get(this.vaelId) : undefined;
    const lamp = this.lampId >= 0 ? world.entities.get(this.lampId) : undefined;
    const veiled = !!vael && !vael.dead && hasAura(vael, VAEL_FOG_VEIL) && !!lamp;
    // The Hymn floods the crown while the shades sing.
    let hymn: EntityView | undefined;
    for (const id of this.veilIds) {
      const e = world.entities.get(id);
      if (e && e.castingAbility === 'bastion_drowning_hymn') {
        hymn = e;
        break;
      }
    }
    const target = hymn ? hymnFlood(hymn.castRemaining, hymn.castTotal) : 0;
    this.floodLevel += (target - this.floodLevel) * Math.min(1, dt * (hymn ? 3 : 0.8));
    const anchor = hymn ?? vael;
    this.flood.visible = this.floodLevel > 0.01 && !!anchor;
    this.floodTop = -Infinity;
    if (this.flood.visible && anchor) {
      const o = bastionSlotOrigin(anchor.pos.x, anchor.pos.z);
      const cx = o.x + CROWN_DEF.x;
      const cz = o.z + CROWN_DEF.z;
      const floor = this.groundY(cx + CROWN_DEF.r * 0.6, cz);
      this.floodTop = floor + 0.05 + this.floodLevel * HYMN_FLOOD_DEPTH;
      this.flood.position.set(cx, this.floodTop, cz);
      this.floodMat.uniforms.uAlpha.value = Math.min(1, this.floodLevel * 3);
    }
    if (veiled && lamp) {
      if (Math.abs(lamp.facing - this.lampSample) > 1e-4 || this.lampSampleAge > 1) {
        this.lampSample = lamp.facing;
        this.lampSampleAge = 0;
      }
      const yaw = predictBeamYaw(this.lampSample, this.lampSampleAge);
      const o = bastionSlotOrigin(lamp.pos.x, lamp.pos.z);
      this.beamSlot = { x: o.x, z: o.z };
      setBeaconYaw(o.x, o.z, yaw);
      const cx = o.x + CROWN_DEF.x;
      const cz = o.z + CROWN_DEF.z;
      const floor = this.groundY(cx + CROWN_DEF.r * 0.6, cz);
      this.beamPool.visible = true;
      this.beamPool.position.set(cx, Math.max(floor + LIFT + 0.05, this.floodTop + 0.04), cz);
      this.beamPool.rotation.y = yaw;
      this.beamPoolMat.opacity = 0.34 + 0.08 * Math.sin(this.clock * 9);
      this.updateReveals(world, yaw, o, dt);
    } else {
      if (this.beamSlot) setBeaconYaw(this.beamSlot.x, this.beamSlot.z, null);
      this.beamSlot = null;
      this.beamPool.visible = false;
      for (const r of this.reveals) {
        r.entityId = -1;
        r.flare.visible = r.core.visible = r.shimmer.visible = r.shadow.visible = false;
      }
    }
  }

  private updateReveals(world: IWorld, yaw: number, o: { x: number; z: number }, dt: number): void {
    // Assign every veiled figure a slot (the real Vael and his shades).
    for (const r of this.reveals) {
      if (r.entityId >= 0 && !this.veilIds.includes(r.entityId)) {
        r.entityId = -1;
        r.flare.visible = r.core.visible = r.shimmer.visible = r.shadow.visible = false;
      }
    }
    for (const id of this.veilIds) {
      if (this.reveals.some((r) => r.entityId === id)) continue;
      const r = this.reveals.find((s) => s.entityId < 0);
      if (!r) break;
      r.entityId = id;
      r.k = 0;
      r.kind = null;
    }
    const bx = o.x + CROWN_DEF.x;
    const bz = o.z + CROWN_DEF.z;
    for (const r of this.reveals) {
      if (r.entityId < 0) continue;
      const e = world.entities.get(r.entityId);
      if (!e) continue;
      const kind = beamReveal(e.templateId, yaw, e.pos.x - o.x, e.pos.z - o.z);
      // The real one's tell flashes on (a burst of gold off the lantern) and
      // then holds a slow afterglow, so it is learnable at a glance.
      if (kind === 'real' && r.k < 0.5 && this.cosmetic)
        this.burst(e.pos.x, e.pos.y + 2.4 * e.scale, e.pos.z, 0xffd890, 10, 0.5, 2.6, 0.9, 2.4);
      if (kind) r.kind = kind;
      r.k = revealGlow(r.k, kind !== null, dt);
      const floor = this.groundY(e.pos.x, e.pos.z);
      const real = r.kind === 'real';
      r.flare.visible = real && r.k > 0.01;
      r.core.visible = real && r.k > 0.01;
      r.shadow.visible = real && r.k > 0.01;
      r.shimmer.visible = !real && r.k > 0.01;
      if (real) {
        const pulse = 0.8 + 0.2 * Math.sin(this.clock * 11);
        (r.flare.material as THREE.SpriteMaterial).opacity = Math.min(1, r.k * 1.2) * pulse;
        (r.core.material as THREE.SpriteMaterial).opacity = r.k;
        modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, e.scale, VAEL_LANTERN, this.lantern);
        r.flare.position.set(this.lantern.x, this.lantern.y, this.lantern.z);
        r.core.position.set(this.lantern.x, this.lantern.y, this.lantern.z);
        const away = Math.atan2(e.pos.x - bx, e.pos.z - bz);
        r.shadow.position.set(
          e.pos.x,
          Math.max(floor + LIFT + 0.01, this.floodTop + 0.02),
          e.pos.z,
        );
        r.shadow.rotation.y = away;
        r.shadow.scale.set(1, 1, 5.5);
        r.shadowMat.uniforms.uAlpha.value = 0.72 * r.k;
      } else {
        (r.shimmer.material as THREE.SpriteMaterial).opacity =
          r.k * (0.55 + 0.45 * Math.sin(this.clock * 17 + r.entityId));
        const sway = Math.sin(this.clock * 5 + r.entityId) * 0.25;
        r.shimmer.position.set(e.pos.x + sway, e.pos.y + 1.6 * e.scale, e.pos.z - sway);
        r.shimmer.scale.set(3.2, 5.4, 1);
        if (this.cosmetic && r.k > 0.9 && Math.random() < dt * 6)
          this.burst(
            e.pos.x,
            e.pos.y + 0.6 + Math.random() * 2,
            e.pos.z,
            0xa8ffd0,
            1,
            0.3,
            0.9,
            0.9,
            1.6,
          );
      }
    }
  }

  // ---- the Hermit ------------------------------------------------------------------------

  private updateHermits(world: IWorld): void {
    for (const d of this.domes) {
      if (d.entityId >= 0 && !this.hermitIds.includes(d.entityId)) {
        d.entityId = -1;
      }
    }
    for (const id of this.hermitIds) {
      if (this.domes.some((d) => d.entityId === id)) continue;
      const d = this.domes.find((s) => s.entityId < 0);
      if (d) {
        d.entityId = id;
        d.mat.uniforms.uAlpha.value = 0;
      }
    }
    for (const d of this.domes) {
      const e = d.entityId >= 0 ? world.entities.get(d.entityId) : undefined;
      const alpha = d.mat.uniforms.uAlpha.value as number;
      const next = e ? Math.min(1, alpha + 0.08) : Math.max(0, alpha - 0.05);
      d.mat.uniforms.uAlpha.value = next;
      d.mesh.visible = next > 0.01;
      if (e) {
        d.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
        d.mesh.scale.setScalar(e.scale * (0.94 + 0.06 * next));
      }
    }
  }

  // ---- puffs and debris ------------------------------------------------------------------

  /** `count` soft puffs of `color` at a point: size from -> to over `life`. */
  private burst(
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    from: number,
    to: number,
    life: number,
    rise = 0.6,
  ): void {
    if (!this.cosmetic) return;
    for (let i = 0; i < count; i++) {
      const p = this.puffs.find((s) => s.age < 0);
      if (!p) return;
      const a = (i / Math.max(1, count)) * Math.PI * 2 + Math.random();
      const r = count > 1 ? from * 0.6 : 0;
      p.sprite.position.set(x + Math.sin(a) * r, y + Math.random() * 0.4, z + Math.cos(a) * r);
      p.mat.color.setHex(color);
      p.age = 0;
      p.life = life * (0.8 + Math.random() * 0.4);
      p.from = from;
      p.to = to;
      p.rise = rise;
      p.peak = color === 0x70706a || color === 0xb8b4a8 ? 0.5 : 0.85;
      p.mat.blending = p.peak < 0.6 ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.sprite.visible = true;
    }
  }

  private updatePuffs(dt: number): void {
    for (const p of this.puffs) {
      if (p.age < 0) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.age = -1;
        p.sprite.visible = false;
        continue;
      }
      const size = p.from + (p.to - p.from) * (1 - (1 - k) * (1 - k));
      p.sprite.scale.set(size, size, 1);
      p.sprite.position.y += p.rise * dt;
      p.mat.opacity = p.peak * Math.sin(Math.PI * Math.min(1, k * 1.15));
    }
    const mesh = this.debrisMesh;
    if (!mesh) return;
    let n = 0;
    for (const d of this.debris) {
      if (d.age < 0) continue;
      d.age += dt;
      if (d.age > 2.4) {
        d.age = -1;
        continue;
      }
      d.vel.y -= 22 * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < d.floor + 0.3) {
        d.pos.y = d.floor + 0.3;
        d.vel.set(d.vel.x * 0.4, Math.abs(d.vel.y) * 0.25, d.vel.z * 0.4);
        d.spin.multiplyScalar(0.5);
      }
      d.rot.set(d.rot.x + d.spin.x * dt, d.rot.y + d.spin.y * dt, d.rot.z + d.spin.z * dt);
      this.q.setFromEuler(d.rot);
      const shrink = d.age > 1.8 ? Math.max(0.01, 1 - (d.age - 1.8) / 0.6) : 1;
      this.s.setScalar(shrink * (0.7 + (n % 3) * 0.3));
      this.m4.compose(d.pos, this.q, this.s);
      mesh.setMatrixAt(n++, this.m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.beamSlot) setBeaconYaw(this.beamSlot.x, this.beamSlot.z, null);
    this.root.removeFromParent();
    this.debrisMesh?.dispose();
    for (const b of this.buttresses)
      for (const list of b.pieces.values()) for (const m of list) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const ALL_STANDING: ReadonlySet<string> = new Set(['nw', 'n', 'ne', 'e']);

/** The boss casts BastionFx paints: Olen's lane (live length) and the Mist Surge. */
export const BASTION_BOSS_TELEGRAPHS = {
  charge: OLEN_OATHBOUND_CHARGE,
  surge: VAEL_MIST_SURGE,
  surgeRadius: VAEL_TUNING.surgeRadius,
  laneHalf: OATH_LANE_HALF,
  buttressTemplates: BUTTRESS_TEMPLATES,
} as const;
