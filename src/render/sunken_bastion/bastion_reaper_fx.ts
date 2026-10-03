// Vael the reaper's fifth-pass visuals (plan: bastion_gaol_reaper_core.ts), all
// read off mirrored entity state so offline and online look the same:
//  - the Shadow Crossing: a burst of black smoke and soul wisps where he sinks,
//    a churning shadow pool behind his mark (black, violet-edged, souls
//    rising out of it) with the scythe's sweep laid on the floor ahead of it,
//    filling until the blade lands, and a geyser of shadow as he rises;
//  - the Reaping Scythe: a pale crescent of soul fire trailing the blade
//    through the arc (the sweep itself is his ScytheSweep flourish);
//  - heroic Grave Shadow: the pool left burning, ringed where it bites;
//  - soul wisps drifting round every reaper figure (his shadow copies too, so
//    they never give the real one away).
//
// Rules (src/render/CLAUDE.md): pooled meshes and materials built once under
// the Bastion telegraph root (compile-gated by BastionFx), no per-frame
// allocation. The sweep fan, the pool and the Grave Shadow ring draw on every
// tier (a player acts on them); the smoke, wisps and the blade trail shed on
// the low tier.

import * as THREE from 'three';
import {
  FOG_SHADE_ID,
  GRAVE_SHADOW_TEMPLATE,
  REAPER_POOL_TEMPLATE,
  VAEL_ID,
  VAEL_REAPING_SCYTHE,
  VAEL_SHADOWSTEP,
  VAEL_VEIL_RISE,
} from '../../sim/encounters/sunken_bastion/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_ACCENTS,
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { pickVeilClaim, type VeilCandidate } from './bastion_boss_fx_core';
import {
  GRAVE_SHADOW_RADIUS,
  REAPER_POOL_RADIUS,
  REAPER_SWEEP_ARC_DEG,
  REAPER_SWEEP_RANGE,
  reaperWarningFill,
} from './bastion_gaol_reaper_core';
import { BastionParticles } from './bastion_particles';

const SCAN_SEC = 0.1;
const POOL_SLOTS = 3;
const TRAIL_SEC = 0.4;

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The shadow pool: an ink-black whirl, violet at its churning rim, pale soul
// light seeping up through it.
const POOL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uBurn;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = atan(c.y, c.x);
  float swirl = a + uTime * 1.6 + r * 5.0;
  float n = noise(vec2(cos(swirl), sin(swirl)) * 2.5 + r * 3.0 - uTime * 0.7);
  float n2 = noise(vec2(a * 3.0, r * 8.0 - uTime * 2.0));
  vec3 ink = vec3(0.01, 0.005, 0.02);
  vec3 violet = vec3(0.35, 0.12, 0.55);
  vec3 soul = vec3(0.55, 1.0, 0.82);
  float rim = smoothstep(0.55, 0.95, r) * (0.6 + 0.4 * n);
  vec3 col = mix(ink, violet, rim * 0.8);
  col += soul * smoothstep(0.72, 0.95, n2) * (1.0 - r) * (0.6 + uBurn);
  col += vec3(1.0, 0.25, 0.2) * uBurn * rim * 0.4;
  float alpha = (0.92 - 0.35 * smoothstep(0.85, 1.0, r)) * uAlpha;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

interface PoolSlot {
  objectId: number;
  since: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  fan: TelegraphFan;
  grave: TelegraphFan;
  wasGrave: boolean;
}

export class BastionReaperFx {
  private readonly root = new THREE.Group();
  private readonly kit: TelegraphKit;
  private readonly fx: BastionParticles;
  private readonly pools: PoolSlot[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly trail: THREE.Mesh | null = null;
  private readonly trailMat: THREE.MeshBasicMaterial | null = null;
  private trailAge = -1;
  private trailYaw = 0;
  private readonly poolIds: number[] = [];
  private readonly figureIds: number[] = [];
  private vaelId = -1;
  private vaelCast: string | null = null;
  /** Each veil figure's last-seen bar (the rise geyser fires on its edge). */
  private readonly figureCast = new Map<number, string | null>();
  private scan = 0;
  private clock = 0;

  constructor(
    parent: THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world: IWorld | undefined,
    private readonly cosmetic: boolean,
  ) {
    this.root.name = 'sunken-bastion-reaper-fx';
    parent.add(this.root);
    this.kit = new TelegraphKit(this.root, cosmetic);
    this.fx = new BastionParticles(this.root, cosmetic);
    const disc = new THREE.PlaneGeometry(REAPER_POOL_RADIUS * 2, REAPER_POOL_RADIUS * 2);
    disc.rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    for (let i = 0; i < POOL_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sunkenBastionReaperPool',
        vertexShader: POOL_VERT,
        fragmentShader: POOL_FRAG,
        uniforms: { uTime: sharedUniforms.uTime, uAlpha: { value: 0 }, uBurn: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 11);
      this.root.add(mesh);
      const fan = this.kit.fan(15);
      this.kit.layOutFan(fan, REAPER_SWEEP_ARC_DEG, {
        color: TELEGRAPH_THREAT_COLORS.lethal,
        accent: TELEGRAPH_ACCENTS.shadow,
      });
      const grave = this.kit.fan(9);
      this.kit.layOutFan(grave, 360, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: TELEGRAPH_ACCENTS.shadow,
      });
      this.pools.push({ objectId: -1, since: 0, mesh, mat, fan, grave, wasGrave: false });
    }
    if (cosmetic) {
      // The blade's trail: a crescent of soul fire swept through the arc.
      const arc = (REAPER_SWEEP_ARC_DEG * Math.PI) / 180;
      const g = new THREE.RingGeometry(3.2, 7.2, 40, 1, Math.PI / 2 - arc / 2, arc);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.PI);
      this.geometries.push(g);
      this.trailMat = new THREE.MeshBasicMaterial({
        color: 0xb8ffe0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(this.trailMat);
      this.trail = new THREE.Mesh(g, this.trailMat);
      this.trail.visible = false;
      this.trail.frustumCulled = false;
      this.root.add(this.trail);
    }
  }

  private scanWorld(world: IWorld): void {
    this.poolIds.length = 0;
    this.figureIds.length = 0;
    this.vaelId = -1;
    const vaels: VeilCandidate[] = [];
    const me = world.entities.get(world.playerId);
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        if (e.templateId === REAPER_POOL_TEMPLATE || e.templateId === GRAVE_SHADOW_TEMPLATE)
          this.poolIds.push(e.id);
        continue;
      }
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.templateId === VAEL_ID) {
        vaels.push({
          id: e.id,
          slot: 0,
          // The one in a fight (mid-bar) first, else the nearest: offline
          // every claim's Vael exists at once.
          veiled: e.castingAbility !== null || e.aggroTargetId !== null,
          dist: me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0,
        });
        this.figureIds.push(e.id);
      } else if (e.templateId === FOG_SHADE_ID) this.figureIds.push(e.id);
    }
    this.vaelId = pickVeilClaim(vaels, []).vaelId;
  }

  /** Claims the vanish's cue (the smoke is drawn here); the sweep's cue is left
   *  to the renderer (it plays his flourish) and only adds the blade's trail. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !this.world) return false;
    const src = this.world.entities.get(ev.sourceId);
    if (!src) return false;
    if (ev.ability === VAEL_SHADOWSTEP) {
      const y = this.groundY(src.pos.x, src.pos.z);
      this.fx.burst(src.pos.x, y + 1.2, src.pos.z, 0x0a0812, 10, 2.2, 7, 1.6, 1.2, 1.5, true);
      this.fx.burst(src.pos.x, y + 2.5, src.pos.z, 0x9dffd0, 8, 0.4, 1.4, 1.2, 3.2, 1.2);
      return true;
    }
    if (ev.ability === VAEL_REAPING_SCYTHE && this.trail) {
      this.trailAge = 0;
      this.trailYaw = src.facing;
      this.trail.position.set(src.pos.x, this.groundY(src.pos.x, src.pos.z) + 2.6, src.pos.z);
      this.trail.visible = true;
    }
    return false;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.updatePools(world, dt);
    this.updateRise(world);
    this.updateTrail(dt);
    this.updateWisps(world);
    this.fx.update(dt);
  }

  private updatePools(world: IWorld, dt: number): void {
    for (const slot of this.pools) {
      if (slot.objectId >= 0 && !this.poolIds.includes(slot.objectId)) {
        slot.objectId = -1;
        slot.mesh.visible = false;
        slot.fan.group.visible = false;
        slot.grave.group.visible = false;
      }
    }
    for (const id of this.poolIds) {
      if (this.pools.some((s) => s.objectId === id)) continue;
      const slot = this.pools.find((s) => s.objectId < 0);
      if (!slot) break;
      slot.objectId = id;
      slot.since = this.clock;
      slot.wasGrave = false;
      slot.mat.uniforms.uAlpha.value = 0;
      slot.mesh.visible = true;
    }
    for (const slot of this.pools) {
      if (slot.objectId < 0) continue;
      const e = world.entities.get(slot.objectId);
      if (!e) continue;
      const y = this.groundY(e.pos.x, e.pos.z);
      const grave = e.templateId === GRAVE_SHADOW_TEMPLATE;
      slot.mesh.position.set(e.pos.x, y + 0.09, e.pos.z);
      slot.mesh.rotation.y = this.clock * 0.3;
      const a = slot.mat.uniforms.uAlpha.value as number;
      slot.mat.uniforms.uAlpha.value = Math.min(1, a + dt * 4);
      slot.mat.uniforms.uBurn.value = grave ? 0.8 + 0.2 * Math.sin(this.clock * 6) : 0;
      const scale = grave ? GRAVE_SHADOW_RADIUS / REAPER_POOL_RADIUS : 1;
      slot.mesh.scale.set(scale, 1, scale);
      // The scythe's sweep, laid ahead of the pool along its facing.
      slot.fan.group.visible = !grave;
      if (!grave) {
        const fill = reaperWarningFill(this.clock - slot.since);
        this.kit.drapeFan(
          slot.fan,
          this.groundY,
          e.pos.x,
          y,
          e.pos.z,
          e.facing,
          REAPER_SWEEP_RANGE,
        );
        this.kit.paintFan(slot.fan, { fill, clock: this.clock, range: REAPER_SWEEP_RANGE });
        if (this.cosmetic && this.fx.rand() < 0.5)
          this.fx.burst(
            e.pos.x + (this.fx.rand() - 0.5) * 3,
            y + 0.2,
            e.pos.z + (this.fx.rand() - 0.5) * 3,
            this.fx.rand() < 0.5 ? 0x9dffd0 : 0x5a2a8a,
            1,
            0.3,
            1.1,
            1.1,
            2.4,
          );
      }
      slot.grave.group.visible = grave;
      if (grave) {
        if (!slot.wasGrave) {
          slot.wasGrave = true;
          this.fx.burst(e.pos.x, y + 0.4, e.pos.z, 0x2a0f3a, 6, 1.5, 4, 1.2, 0.8, 1.2, true);
        }
        this.kit.drapeFan(slot.grave, this.groundY, e.pos.x, y, e.pos.z, 0, GRAVE_SHADOW_RADIUS);
        this.kit.paintFan(slot.grave, { fill: 1, clock: this.clock, range: GRAVE_SHADOW_RADIUS });
      }
    }
  }

  /** The geyser of shadow as he rises out of the pool (his Emerge bar), and
   *  as every Fog Veil figure rises out of the roof together (the veil rise). */
  private updateRise(world: IWorld): void {
    const vael = this.vaelId >= 0 ? world.entities.get(this.vaelId) : undefined;
    const cast = vael?.castingAbility ?? null;
    if (vael && cast === VAEL_REAPING_SCYTHE && this.vaelCast !== VAEL_REAPING_SCYTHE)
      this.geyser(vael.pos.x, vael.pos.z);
    // The veil spawns its shades on the tick he starts to rise: find them now.
    if (cast === VAEL_VEIL_RISE && this.vaelCast !== VAEL_VEIL_RISE) this.scanWorld(world);
    this.vaelCast = cast;
    for (const id of this.figureIds) {
      const e = world.entities.get(id);
      const now = e && !e.dead ? e.castingAbility : null;
      if (e && now === VAEL_VEIL_RISE && this.figureCast.get(id) !== VAEL_VEIL_RISE)
        this.geyser(e.pos.x, e.pos.z);
      this.figureCast.set(id, now);
    }
    for (const id of this.figureCast.keys())
      if (!world.entities.has(id)) this.figureCast.delete(id);
  }

  private geyser(x: number, z: number): void {
    const y = this.groundY(x, z);
    this.fx.burst(x, y + 0.5, z, 0x07050c, 10, 1.6, 6, 1.1, 5.5, 0.8, true);
    this.fx.burst(x, y + 1.0, z, 0xa8ffd8, 6, 0.4, 2.2, 0.8, 6, 1.4);
  }

  private updateTrail(dt: number): void {
    const trail = this.trail;
    const mat = this.trailMat;
    if (!trail || !mat || this.trailAge < 0) return;
    this.trailAge += dt;
    const k = this.trailAge / TRAIL_SEC;
    if (k >= 1) {
      this.trailAge = -1;
      trail.visible = false;
      return;
    }
    // The crescent sweeps from the reaper's right through his front.
    trail.rotation.y = this.trailYaw + (0.8 - k * 1.6);
    mat.opacity = 0.85 * Math.sin(Math.PI * k);
    trail.scale.setScalar(0.9 + 0.2 * k);
  }

  /** Soul wisps drifting up round every reaper figure (the copies too). */
  private updateWisps(world: IWorld): void {
    if (!this.cosmetic) return;
    for (const id of this.figureIds) {
      if (this.fx.rand() > 0.12) continue;
      const e = world.entities.get(id);
      if (!e) continue;
      const a = this.fx.rand() * Math.PI * 2;
      const r = 1.6 + this.fx.rand() * 1.2;
      this.fx.burst(
        e.pos.x + Math.sin(a) * r,
        e.pos.y + 1.5 + this.fx.rand() * 4,
        e.pos.z + Math.cos(a) * r,
        0x9dffd0,
        1,
        0.25,
        0.8,
        1.6,
        0.9,
      );
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.fx.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
