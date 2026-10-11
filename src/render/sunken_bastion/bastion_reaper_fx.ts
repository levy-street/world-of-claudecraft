// Vael the reaper's fifth-pass visuals (plan: bastion_gaol_reaper_core.ts), all
// read off mirrored entity state so offline and online look the same:
//  - the Shadow Crossing: a burst of black smoke and soul wisps where he sinks,
//    a churning shadow pool behind his mark (black, violet-edged, souls
//    rising out of it) with the scythe's sweep laid on the floor ahead of it,
//    filling until the blade lands, and a geyser of shadow as he rises;
//  - the Reaping Scythe: a pale crescent of soul fire trailing the blade
//    through the arc (the sweep itself is his ScytheSweep flourish);
//  - heroic Grave Shadow: the pool left burning, ringed where it bites;
//  - the Fog Veil's emergence (and every rise of his entrance): dark sea water
//    wells up and boils on the flags under every figure, each rises out of it (the Emerge clip, once over the
//    rise bar) with fog and brine shedding off the shroud as it climbs, and a
//    pall of fog marks where the real one melted away; identical for the real
//    Vael and his copies, so the rise never gives him away;
//  - soul wisps drifting round every reaper figure (his shadow copies too, so
//    they never give the real one away).
//
// Rules (src/render/CLAUDE.md): pooled meshes and materials built once under
// the Bastion telegraph root (compile-gated by BastionFx), no per-frame
// allocation. The sweep fan, the pool and the Grave Shadow ring draw on every
// tier (a player acts on them), and so does the veil's boil (the emergence
// itself); the smoke, wisps, shed fog and the blade trail shed on the low tier.

import * as THREE from 'three';
import {
  FOG_SHADE_ID,
  GRAVE_SHADOW_TEMPLATE,
  REAPER_POOL_TEMPLATE,
  VAEL_ID,
  VAEL_REAPING_SCYTHE,
  VAEL_SHADOWSTEP,
  VAEL_SINK,
  VAEL_TUNING,
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
  VEIL_BOIL_RADIUS,
  veilBoilAlpha,
  veilBoilDone,
  veilBoilScale,
  veilRiseEmerged,
} from './bastion_gaol_reaper_core';
import { BastionParticles } from './bastion_particles';
import { isVaelRiseCast } from './bastion_vael_stage_core';

const SCAN_SEC = 0.1;
// A chain of three Shadow Crossings back to back, each pool burning on for 6 s
// as a heroic Grave Shadow while the next steps open: room for all of them.
const POOL_SLOTS = 5;
const TRAIL_SEC = 0.4;
/** The veil's four figures (the real Vael and three shades). */
const BOIL_SLOTS = 4;
/** A figure's hood peak over its feet (model units; scaled by e.scale). */
const FIGURE_HEIGHT = 6.5;
/** A jump this far on the rise's first frame is the real one melting away. */
const MELT_JUMP = 2;
/** Fog puffs a second rolling round a rising figure's waist at the flags, and
 *  shed off its shroud as it climbs (cosmetic tier only). */
const COLLAR_PER_SEC = 9;
const SHED_PER_SEC = 7;

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

// The veil's boil: black sea water welling up through the flags, churning,
// flecked with foam, a grey fog rolling at its rim.
const BOIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;
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
  float t = uTime + uSeed;
  // Roiling cells welling outward from the middle.
  float n = noise(c * 5.0 - normalize(c + 1e-4) * t * 0.9 + uSeed);
  float n2 = noise(c * 12.0 + vec2(t * 1.3, -t * 0.9));
  float bubbles = smoothstep(0.74, 0.9, n2) * (1.0 - r * 0.8);
  float fog = smoothstep(0.45, 0.95, r) * (0.5 + 0.5 * noise(vec2(a * 3.0 + t * 0.5, r * 4.0 - t)));
  vec3 col = mix(vec3(0.004, 0.01, 0.012), vec3(0.02, 0.06, 0.055), n);
  col += vec3(0.5, 0.66, 0.62) * bubbles * 0.45;
  col = mix(col, vec3(0.16, 0.21, 0.2), fog * 0.35);
  float edge = 1.0 - smoothstep(0.7, 1.0, r);
  gl_FragColor = vec4(col, (0.9 * edge + 0.25 * fog * (1.0 - r)) * uAlpha);
  #include <colorspace_fragment>
}
`;

interface BoilSlot {
  entityId: number;
  since: number;
  x: number;
  z: number;
  y: number;
  height: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

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
  /** Each veil figure's last-seen bar (the emergence starts on its edge). */
  private readonly figureCast = new Map<number, string | null>();
  /** Each figure's last drawn spot (where the real one melts from). */
  private readonly figureAt = new Map<number, { x: number; z: number }>();
  private readonly boils: BoilSlot[] = [];
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
    // The veil's boil under each rising figure (every tier: it is the rise).
    for (let i = 0; i < BOIL_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sunkenBastionVeilBoil',
        vertexShader: POOL_VERT,
        fragmentShader: BOIL_FRAG,
        uniforms: { uTime: sharedUniforms.uTime, uAlpha: { value: 0 }, uSeed: { value: i * 7.3 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 10);
      this.root.add(mesh);
      this.boils.push({ entityId: -1, since: 0, x: 0, z: 0, y: 0, height: 0, mesh, mat });
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
    // The Shadow Crossing's sink, and his sink back under the roof through the
    // entrance and before each veil: the same burst of black smoke and souls.
    if (ev.ability === VAEL_SHADOWSTEP || ev.ability === VAEL_SINK) {
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
    this.updateBoils(world, dt);
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
   *  the emergence as every Fog Veil figure rises out of the roof together
   *  (the veil rise): the boil under each, and the fog where the real one
   *  melted away. */
  private updateRise(world: IWorld): void {
    const vael = this.vaelId >= 0 ? world.entities.get(this.vaelId) : undefined;
    const cast = vael?.castingAbility ?? null;
    if (vael && cast === VAEL_REAPING_SCYTHE && this.vaelCast !== VAEL_REAPING_SCYTHE)
      this.geyser(vael.pos.x, vael.pos.z);
    // The veil spawns its shades on the tick he starts to rise: find them now.
    if (isVaelRiseCast(cast) && !isVaelRiseCast(this.vaelCast)) this.scanWorld(world);
    this.vaelCast = cast;
    for (const id of this.figureIds) {
      const e = world.entities.get(id);
      const now = e && !e.dead ? e.castingAbility : null;
      if (e && isVaelRiseCast(now) && !isVaelRiseCast(this.figureCast.get(id))) {
        // The real one melts where he stood (only he stood anywhere before).
        const was = this.figureAt.get(id);
        if (was && Math.hypot(was.x - e.pos.x, was.z - e.pos.z) > MELT_JUMP)
          this.melt(was.x, was.z);
        this.startBoil(e.id, e.pos.x, e.pos.z, FIGURE_HEIGHT * e.scale);
      }
      this.figureCast.set(id, now);
      if (e) {
        const at = this.figureAt.get(id);
        if (at) {
          at.x = e.pos.x;
          at.z = e.pos.z;
        } else this.figureAt.set(id, { x: e.pos.x, z: e.pos.z });
      }
    }
    for (const id of this.figureCast.keys())
      if (!world.entities.has(id)) {
        this.figureCast.delete(id);
        this.figureAt.delete(id);
      }
  }

  /** A figure starts rising out of the roof: dark water wells up under it. */
  private startBoil(id: number, x: number, z: number, height: number): void {
    let slot = this.boils.find((b) => b.entityId === id) ?? this.boils.find((b) => b.entityId < 0);
    if (!slot) {
      slot = this.boils[0];
      for (const b of this.boils) if (b.since < slot.since) slot = b;
    }
    slot.entityId = id;
    slot.since = this.clock;
    slot.x = x;
    slot.y = this.groundY(x, z);
    slot.z = z;
    slot.height = height;
    slot.mat.uniforms.uAlpha.value = 0;
    slot.mesh.visible = true;
    // The flags burst open: black water thrown out in a ring, then a breath of
    // fog rolling off it.
    this.fx.burst(x, slot.y + 0.15, z, 0x0c1513, 8, 1.2, 3.4, 0.9, 0.6, 2.4, true);
    this.fx.burst(x, slot.y + 0.3, z, 0x6f817b, 5, 1.6, 4.6, 1.6, 0.35, 1.1, true);
  }

  /** The boil under each rising figure, and the fog and brine shedding off it
   *  as the body climbs out (identical for every figure). */
  private updateBoils(world: IWorld, dt: number): void {
    for (const b of this.boils) {
      if (b.entityId < 0) continue;
      const age = this.clock - b.since;
      if (veilBoilDone(age)) {
        b.entityId = -1;
        b.mesh.visible = false;
        continue;
      }
      const e = world.entities.get(b.entityId);
      if (e && !e.dead) {
        b.x = e.pos.x;
        b.z = e.pos.z;
      }
      b.mat.uniforms.uAlpha.value = veilBoilAlpha(age);
      b.mesh.position.set(b.x, b.y + 0.07, b.z);
      b.mesh.rotation.y = this.clock * -0.4 + b.entityId;
      const s = (veilBoilScale(age) * VEIL_BOIL_RADIUS) / REAPER_POOL_RADIUS;
      b.mesh.scale.set(s, 1, s);
      if (!this.cosmetic || !e || e.dead) continue;
      const out = veilRiseEmerged(age);
      // A collar of sea fog rolls round the body where it passes through the
      // flags, for as long as it is still coming up.
      if (age < VAEL_TUNING.veilRiseSeconds + 0.2 && this.fx.rand() < dt * COLLAR_PER_SEC) {
        const a = this.fx.rand() * Math.PI * 2;
        const r = 1.4 + this.fx.rand() * 1.4;
        this.fx.burst(
          b.x + Math.sin(a) * r,
          b.y + 0.25,
          b.z + Math.cos(a) * r,
          0x7d918a,
          1,
          1.6,
          4.2,
          1.3,
          0.55,
          0.7,
          true,
        );
      }
      // Fog and sea water shed off the shroud as it climbs: spawned along the
      // part already out of the floor, sliding down and away.
      if (out <= 0.02 || out >= 0.999 || this.fx.rand() > dt * SHED_PER_SEC) continue;
      const a = this.fx.rand() * Math.PI * 2;
      const r = 0.7 + this.fx.rand() * 0.9;
      const h = b.y + (0.3 + this.fx.rand() * 0.7) * out * b.height;
      const brine = this.fx.rand() < 0.4;
      this.fx.burst(
        b.x + Math.sin(a) * r,
        h,
        b.z + Math.cos(a) * r,
        brine ? 0xc4eee2 : 0x9db3ab,
        1,
        brine ? 0.3 : 1.0,
        brine ? 0.6 : 2.6,
        brine ? 0.6 : 1.1,
        brine ? -3.4 : -1.1,
        brine ? 0.7 : 0.9,
        !brine,
      );
    }
  }

  /** The fog takes the real one where he stood: a pall of dark fog sinking
   *  onto the empty spot. */
  private melt(x: number, z: number): void {
    const y = this.groundY(x, z);
    this.fx.burst(x, y + 2.2, z, 0x1a2422, 9, 2.4, 1.0, 1.1, -1.2, 0.4, true);
    this.fx.burst(x, y + 0.4, z, 0x56665f, 6, 1.2, 4.2, 1.5, 0.3, 1.4, true);
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
