// The Sanctum trash's creature effects (plan: sanctum_fx_core.ts), composed by
// SanctumFx (sanctum_fx.ts) under its gated root:
//  - the Warming Rite's soulfire tether from the Thawcaller to its patient
//    while the bar runs, and the soul-smoke its censer trails;
//  - the Goad: a stream of red-hot sparks from the Goadsmith's iron to the
//    ally while the bar runs, a burst on the ally as it lands, and the fury
//    glowing and smoking off it for as long as `sanctum_goaded` holds;
//  - the Soul Brazier's soulfire, its quickening pulse every stoke and the
//    violet-green flame motes rising off every `sanctum_stoked` ally;
//  - the Pyre-Tender's yoke of braziers burning over her shoulders;
//  - the Scaleguard's meltwater dripping off it, the cinders it draws in
//    through the Cinder Breath's bar and the cinders it pours down the cone;
//  - the Ice Block Toss: the block lobbed from the Hauler onto its ring for
//    the bar's last stretch, then the crash, the shards and the frost;
//  - the Glacier Splinter's corpse building to its Shatter (the rune-iron core
//    glowing up through the ice), then the Shatter itself;
//  - the Rime Whelp's Hoarfrost Pop.
//
// Cosmetic only (src/render/CLAUDE.md): the floor telegraphs (the toss ring,
// the kick glyphs, the breath cone) are sanctum_fx.ts's; every primitive here
// sits under them. Built once under the host's root before its gated attach;
// no light.

import * as THREE from 'three';
import { MOBS } from '../../sim/data';
import {
  GLACIER_SPLINTER_ID,
  GOADSMITH_ID,
  PYRE_TENDER_ID,
  RIME_WHELP_ID,
  SANCTUM_TOSS_RING,
  SCALEGUARD_ID,
  SLEDGE_HAULER_ID,
  SOUL_BRAZIER_ID,
  THAWCALLER_ID,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import {
  SANCTUM_CINDER_BREATH,
  SANCTUM_GOAD,
  SANCTUM_GOADED,
  SANCTUM_HOARFROST_POP,
  SANCTUM_ICE_BLOCK_TOSS,
  SANCTUM_SHATTER,
  SANCTUM_SOULFIRE_STOKE,
  SANCTUM_STOKED,
  SANCTUM_WARMING_RITE,
} from '../../sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { SPLINTER_SHATTERED_GESTURE } from '../characters/sanctum_creature_looks';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import {
  BLOCK_RELEASE,
  blockFlight,
  FLAME_HEAT,
  goadedPulse,
  hoarfrostRadius,
  objectFill,
  rgb,
  SANCTUM_PALETTE,
  sanctumDrawnHeight,
  sanctumObjectSpecs,
  shatterBuild,
  shatterDelay,
  shatterRadius,
  stokeReach,
} from './sanctum_fx_core';
import type { SanctumFxHost } from './sanctum_fx_host';

/** Either side of a body (walked without allocating). */
const SIDES = [-1, 1] as const;

const BEAM_SLOTS = 6;
const AURA_SLOTS = 10;
const BLOCK_SLOTS = 4;
const SHATTER_SLOTS = 6;
/** Seconds the Cinder Breath's torrent pours down its cone. */
const BREATH_SECONDS = 0.55;

/** A soft beam of light flowing from its root to its tip. */
const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uFlow;
varying vec2 vUv;
void main() {
  float flow = fract(vUv.y * 5.0 - uTime * uFlow);
  float pulse = smoothstep(0.0, 0.18, flow) * (1.0 - smoothstep(0.3, 0.62, flow));
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  vec3 col = mix(uColA, uColB, pulse);
  float a = (0.3 + pulse * 0.95) * edge * edge;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

interface Beam {
  mesh: THREE.Mesh;
  casterId: number;
  castId: string;
}
interface Aura {
  mesh: THREE.Mesh;
  entityId: number;
  auraId: string;
}
interface Block {
  mesh: THREE.Mesh;
  /** The ring object it falls on, the Hauler that threw it. */
  ringId: number;
  tosserId: number;
  since: number;
  x: number;
  z: number;
  /** Where it leaves the Hauler's hands (latched at the release). */
  fromX: number;
  fromY: number;
  fromZ: number;
  released: boolean;
  spin: number;
}
interface Breath {
  entityId: number;
  until: number;
  facing: number;
  range: number;
  half: number;
  x: number;
  y: number;
  z: number;
  /** Its embers were left on the ice. */
  embered: boolean;
}
interface Shatter {
  entityId: number;
  since: number;
  x: number;
  z: number;
}

export class SanctumTrashFx {
  private readonly beams: Beam[] = [];
  private readonly auras: Aura[] = [];
  private readonly blocks: Block[] = [];
  private readonly shatters: Shatter[] = [];
  private readonly breaths: Breath[] = [];
  /** Splinters already shattered (their corpse stays hidden). */
  private readonly shattered = new Map<number, number>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly soulBeamMat: THREE.ShaderMaterial;
  private readonly goadBeamMat: THREE.ShaderMaterial;
  private readonly goadedMat: THREE.MeshBasicMaterial;
  private readonly stokedMat: THREE.MeshBasicMaterial;
  private readonly tossSeconds: number;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private clock = 0;

  constructor(
    private readonly host: SanctumFxHost,
    private readonly world: IWorld,
    glowTexture: THREE.Texture | null,
  ) {
    this.tossSeconds = sanctumObjectSpecs()[SANCTUM_TOSS_RING]?.fillSeconds ?? 2;
    // The tethers: a cylinder along +y, oriented each frame.
    const beamGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 10, 1, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    const beamMat = (name: string, a: number, b: number, flow: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uTime: host.uTime,
          uColA: { value: new THREE.Color(a) },
          uColB: { value: new THREE.Color(b) },
          uFlow: { value: flow },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    };
    this.soulBeamMat = beamMat(
      'sanctumWarmingRiteTether',
      SANCTUM_PALETTE.soulViolet,
      SANCTUM_PALETTE.soulGreen,
      2,
    );
    this.goadBeamMat = beamMat('sanctumGoadSparks', 0xb3200e, 0xffb070, 3.4);
    for (let i = 0; i < BEAM_SLOTS; i++) {
      // Both tether looks ride a pooled mesh from the start, so the compile
      // gate links both programs before the first Goad or Warming Rite.
      const mesh = new THREE.Mesh(beamGeo, i % 2 === 0 ? this.soulBeamMat : this.goadBeamMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      host.root.add(mesh);
      this.beams.push({ mesh, casterId: -1, castId: '' });
    }
    // The auras: a glow pooled flat on the ice under the body.
    const glowMat = (name: string, color: number) => {
      const m = new THREE.MeshBasicMaterial({
        map: glowTexture,
        color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name,
      });
      this.materials.push(m);
      return m;
    };
    this.goadedMat = glowMat('sanctumGoadedGlow', 0xff4a1e);
    this.stokedMat = glowMat('sanctumStokedGlow', 0x7fe0a8);
    const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(planeGeo);
    for (let i = 0; i < AURA_SLOTS; i++) {
      // Both glows are on a mesh at the gated attach (both programs link).
      const mesh = new THREE.Mesh(planeGeo, i % 2 === 0 ? this.goadedMat : this.stokedMat);
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 2);
      host.root.add(mesh);
      this.auras.push({ mesh, entityId: -1, auraId: '' });
    }
    // The tossed blocks: a rough-hewn lump of glacier ice.
    const blockGeo = new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.95, 1.1);
    blockGeo.computeVertexNormals();
    this.geometries.push(blockGeo);
    const blockMat = surfaceMat({
      color: 0xe8f7ff,
      roughness: 0.22,
      metalness: 0.05,
      emissive: 0x24587a,
      flatShading: true,
    });
    for (let i = 0; i < BLOCK_SLOTS; i++) {
      const mesh = new THREE.Mesh(blockGeo, blockMat);
      mesh.name = 'sanctumTossBlock';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.castShadow = host.density >= 1;
      host.root.add(mesh);
      this.blocks.push({
        mesh,
        ringId: -1,
        tosserId: -1,
        since: 0,
        x: 0,
        z: 0,
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        released: false,
        spin: 0,
      });
    }
  }

  // ------------------------------------------------------------------ events

  /** The trash's spellfx. True when drawn here (the renderer then skips its
   *  generic nova or windup). */
  handleEvent(ev: SimEvent & { type: 'spellfx' }, src: Entity): boolean {
    switch (ev.ability) {
      case SANCTUM_GOAD: {
        const ally = this.world.entities.get(ev.targetId);
        if (ally) this.goadLands(ally);
        return true;
      }
      case SANCTUM_SOULFIRE_STOKE:
        this.stoke(src);
        return true;
      case SANCTUM_HOARFROST_POP:
        this.hoarfrostPop(src);
        return true;
      case SANCTUM_SHATTER:
        if (ev.fx === 'windup') this.armShatter(src);
        else this.shatter(src);
        return true;
      case SANCTUM_ICE_BLOCK_TOSS:
        // The crash is drawn when its ring goes (paintBlocks): the event only
        // tells which ring was this Hauler's.
        this.tossLanded(src);
        return true;
      default:
        return false;
    }
  }

  /** The generic fire cone of a Scaleguard's breath (the renderer still draws
   *  its own): a torrent of cinders and pyre fire poured down the whole cone
   *  for half a second, then embers left smouldering on the ice. */
  cinderBreath(src: Entity): void {
    const breath = this.breathOf(src);
    if (!breath) return;
    const h = this.drawnHeight(src);
    const f = src.facing;
    const slot =
      this.breaths.find((x) => x.entityId === src.id) ??
      this.breaths.find((x) => x.until < this.clock && x.embered) ??
      (this.breaths.length < 4 ? this.newBreath() : this.breaths[0]);
    slot.entityId = src.id;
    slot.until = this.clock + BREATH_SECONDS;
    slot.facing = f;
    slot.range = breath.range;
    slot.half = (breath.arcDeg * Math.PI) / 360;
    slot.x = src.pos.x + Math.sin(f) * h * 0.3;
    slot.z = src.pos.z + Math.cos(f) * h * 0.3;
    slot.y = this.host.groundY(src.pos.x, src.pos.z) + h * 0.5;
    slot.embered = false;
  }

  private newBreath(): Breath {
    const b: Breath = {
      entityId: -1,
      until: -1,
      facing: 0,
      range: 0,
      half: 0,
      x: 0,
      y: 0,
      z: 0,
      embered: true,
    };
    this.breaths.push(b);
    return b;
  }

  /** The torrent in flight (cosmetic; the cone the sim tested is the
   *  telegraph's). */
  private paintBreaths(dt: number): void {
    for (const b of this.breaths) {
      if (b.until < this.clock) {
        if (!b.embered) {
          b.embered = true;
          this.embers(b);
        }
        continue;
      }
      const n = dt * 260 * this.host.density;
      let count = Math.floor(n);
      if (this.host.rand() < n - count) count++;
      const fall = (b.y - this.host.groundY(b.x, b.z)) / Math.max(1, b.range);
      for (let i = 0; i < count; i++) {
        const a = b.facing + (this.host.rand() - 0.5) * 2 * b.half * 0.92;
        const drop = (0.4 + this.host.rand() * 0.5) * fall;
        this.host.puff(b.x, b.y, b.z, 1, {
          speed: (b.range / 0.5) * (0.6 + this.host.rand() * 0.5),
          life: 0.6,
          size: [0.9, 3],
          color: [0.46, 0, 0],
          alpha: 0.75,
          pool: 'pyre',
          dir: [Math.sin(a), -drop, Math.cos(a)],
          spread: 0.04,
          drag: 0.9,
        });
        if (this.host.rand() < 0.45)
          this.host.puff(b.x, b.y, b.z, 1, {
            speed: (b.range / 0.5) * (0.6 + this.host.rand() * 0.6),
            life: 0.75,
            size: [0.24, 0.08],
            color: [1, 0.55, 0.18],
            alpha: 1,
            pool: 'glow',
            dir: [Math.sin(a), -drop * 0.5, Math.cos(a)],
            spread: 0.08,
            drag: 1.2,
            gravity: 5,
          });
      }
      if (this.host.rand() < dt * 30 * this.host.density) {
        const a = b.facing + (this.host.rand() - 0.5) * 2 * b.half * 0.7;
        const r = b.range * (0.5 + this.host.rand() * 0.5);
        const x = b.x + Math.sin(a) * r;
        const z = b.z + Math.cos(a) * r;
        this.host.puff(x, this.host.groundY(x, z) + 1, z, 1, {
          speed: 0.6,
          up: 1.6,
          life: 2,
          size: [1.2, 3.2],
          color: [0.2, 0.18, 0.17],
          alpha: 0.4,
        });
      }
    }
  }

  /** After the torrent: embers smouldering on the scorched ice of the cone,
   *  and the meltwater's steam. */
  private embers(b: Breath): void {
    for (let i = 0; i < 12; i++) {
      const a = b.facing + (this.host.rand() - 0.5) * 2 * b.half * 0.85;
      const r = b.range * (0.25 + this.host.rand() * 0.7);
      const x = b.x + Math.sin(a) * r;
      const z = b.z + Math.cos(a) * r;
      const gy = this.host.groundY(x, z);
      this.host.puff(x, gy + 0.05, z, 1, {
        speed: 0.2,
        up: 0.6,
        life: 1.4,
        size: [0.9, 0.3],
        color: [0.75, 0, 0],
        alpha: 1,
        pool: 'pyre',
        radius: 0.4,
      });
      this.host.puff(x, gy + 0.2, z, 1, {
        speed: 0.3,
        up: 1.2,
        life: 2.4,
        size: [0.8, 2.6],
        color: [0.88, 0.9, 0.93],
        alpha: 0.3,
      });
    }
  }

  private breathOf(src: Entity): { range: number; arcDeg: number } | null {
    if (src.templateId !== SCALEGUARD_ID) return null;
    const b = MOBS[SCALEGUARD_ID]?.breathCone;
    return b ? { range: b.range, arcDeg: b.arcDeg } : null;
  }

  private goadLands(ally: Entity): void {
    const h = this.drawnHeight(ally);
    const gy = this.host.groundY(ally.pos.x, ally.pos.z);
    this.host.puff(ally.pos.x, gy + h * 0.55, ally.pos.z, 26, {
      speed: 5,
      up: 2,
      life: 0.8,
      size: [0.3, 0.08],
      color: [1, 0.5, 0.18],
      alpha: 1,
      pool: 'glow',
      radius: 0.6,
      gravity: 5,
    });
    this.host.puff(ally.pos.x, gy + 0.2, ally.pos.z, 10, {
      speed: 1.2,
      up: 2.4,
      life: 0.9,
      size: [1.3, 0.5],
      color: FLAME_HEAT,
      alpha: 1,
      pool: 'pyre',
      radius: 0.9,
    });
    this.host.shockRing(ally.pos.x, ally.pos.z, 0xff5a2a, 3.2, 0.5);
  }

  private stoke(src: Entity): void {
    const reach = stokeReach();
    this.host.shockRing(src.pos.x, src.pos.z, SANCTUM_PALETTE.soulGreen, reach, 0.9);
    const top = this.host.groundY(src.pos.x, src.pos.z) + this.drawnHeight(src) * 0.85;
    this.host.puff(src.pos.x, top, src.pos.z, 16, {
      speed: 2.6,
      up: 2.4,
      life: 1,
      size: [1.2, 0.4],
      color: FLAME_HEAT,
      alpha: 1,
      pool: 'soulfire',
      radius: 0.6,
    });
  }

  private hoarfrostPop(src: Entity): void {
    const r = hoarfrostRadius();
    const gy = this.host.groundY(src.pos.x, src.pos.z);
    this.host.shockRing(src.pos.x, src.pos.z, SANCTUM_PALETTE.rime, r, 0.45);
    this.host.puff(src.pos.x, gy + 1, src.pos.z, 30, {
      speed: r * 2.4,
      up: 1,
      life: 1.4,
      size: [0.8, 2.6],
      color: [0.88, 0.95, 1],
      alpha: 0.65,
      drag: 3,
    });
    this.host.puff(src.pos.x, gy + 1.2, src.pos.z, 24, {
      speed: r * 2,
      up: 1.5,
      life: 1.1,
      size: [0.26, 0.06],
      color: rgb(SANCTUM_PALETTE.rime),
      alpha: 1,
      pool: 'glow',
      drag: 2,
    });
    this.host.shards.burst(src.pos.x, gy + 0.8, src.pos.z, 8, {
      speed: 4,
      up: 4,
      size: [0.12, 0.3],
    });
  }

  private armShatter(src: Entity): void {
    if (this.shatters.some((s) => s.entityId === src.id)) return;
    if (this.shatters.length >= SHATTER_SLOTS) this.shatters.shift();
    this.shatters.push({ entityId: src.id, since: this.clock, x: src.pos.x, z: src.pos.z });
  }

  private shatter(src: Entity): void {
    const i = this.shatters.findIndex((s) => s.entityId === src.id);
    const x = i >= 0 ? this.shatters[i].x : src.pos.x;
    const z = i >= 0 ? this.shatters[i].z : src.pos.z;
    if (i >= 0) this.shatters.splice(i, 1);
    const r = shatterRadius();
    const gy = this.host.groundY(x, z);
    // The body itself is what bursts: its corpse is gone with the Shatter.
    this.host.gesture(src.id, SPLINTER_SHATTERED_GESTURE);
    this.shattered.set(src.id, this.clock);
    this.host.shockRing(x, z, SANCTUM_PALETTE.runeBlue, r, 0.55);
    this.host.shockRing(x, z, SANCTUM_PALETTE.rime, r * 0.7, 0.35);
    // Thrown about as far as the burst reaches (the ring is the danger).
    this.host.shards.burst(x, gy + 1.6, z, 56, {
      speed: r * 1.7,
      up: 8,
      size: [0.4, 1.3],
      radius: 1.6,
      iron: 0.15,
    });
    this.host.puff(x, gy + 2, z, 14, {
      speed: 2,
      up: 1,
      life: 0.45,
      size: [3.5, 1.2],
      color: rgb(SANCTUM_PALETTE.runeBlue),
      alpha: 1,
      pool: 'glow',
      radius: 1,
    });
    this.host.puff(x, gy + 1.4, z, 40, {
      speed: r * 2.2,
      up: 1.2,
      life: 1.6,
      size: [1, 3.2],
      color: [0.86, 0.94, 1],
      alpha: 0.6,
      drag: 2.6,
    });
    this.host.puff(x, gy + 1.6, z, 36, {
      speed: r * 2.4,
      up: 2,
      life: 1,
      size: [0.34, 0.08],
      color: rgb(SANCTUM_PALETTE.runeBlue),
      alpha: 1,
      pool: 'glow',
      drag: 1.6,
    });
    if (!this.host.reducedMotion()) this.host.shake(0.35);
  }

  private tossLanded(src: Entity): void {
    // Its block is the one this Hauler threw; the crash itself waits for the
    // ring to go (the same tick), so a block whose ring never landed (its
    // thrower died mid-bar) simply melts away.
    for (const b of this.blocks)
      if (b.tosserId === src.id) b.since = Math.min(b.since, this.clock - this.tossSeconds);
  }

  // ------------------------------------------------------------------- scans

  /** One mob seen by the scan: claim its tether, its aura glow, its toss. */
  scanMob(e: Entity): void {
    if (e.dead) return;
    const cast = e.castingAbility;
    if (cast === SANCTUM_WARMING_RITE || cast === SANCTUM_GOAD) this.claimBeam(e, cast);
    if (hasAura(e, SANCTUM_GOADED)) this.claimAura(e, SANCTUM_GOADED);
    else if (hasAura(e, SANCTUM_STOKED)) this.claimAura(e, SANCTUM_STOKED);
  }

  /** A toss ring seen by the scan: its block (thrown by the nearest Hauler
   *  casting the toss). */
  scanRing(o: Entity): void {
    if (o.templateId !== SANCTUM_TOSS_RING) return;
    if (this.blocks.some((b) => b.ringId === o.id)) return;
    const b = this.blocks.find((s) => s.ringId < 0);
    if (!b) return;
    let tosser: Entity | null = null;
    let best = Infinity;
    for (const e of this.world.entities.values()) {
      if (e.templateId !== SLEDGE_HAULER_ID || e.dead) continue;
      if (e.castingAbility !== SANCTUM_ICE_BLOCK_TOSS) continue;
      const d = Math.hypot(e.pos.x - o.pos.x, e.pos.z - o.pos.z);
      if (d < best) {
        best = d;
        tosser = e;
      }
    }
    b.ringId = o.id;
    b.tosserId = tosser?.id ?? -1;
    b.since = this.clock;
    b.x = o.pos.x;
    b.z = o.pos.z;
    b.released = false;
    b.spin = (this.host.rand() - 0.5) * 6;
  }

  private claimBeam(e: Entity, castId: string): void {
    if (this.beams.some((b) => b.casterId === e.id)) return;
    const b = this.beams.find((s) => s.casterId < 0);
    if (!b) return;
    b.casterId = e.id;
    b.castId = castId;
    b.mesh.material = castId === SANCTUM_GOAD ? this.goadBeamMat : this.soulBeamMat;
  }

  private claimAura(e: Entity, auraId: string): void {
    if (this.auras.some((a) => a.entityId === e.id)) return;
    const a = this.auras.find((s) => s.entityId < 0);
    if (!a) return;
    a.entityId = e.id;
    a.auraId = auraId;
    a.mesh.material = auraId === SANCTUM_GOADED ? this.goadedMat : this.stokedMat;
    a.mesh.visible = true;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    this.paintBeams(dt);
    this.paintAuras(dt);
    this.paintBlocks();
    this.paintShatters(dt);
    this.paintBreaths(dt);
    this.paintBodies(dt);
    this.resendShattered();
  }

  private paintBeams(dt: number): void {
    for (const b of this.beams) {
      if (b.casterId < 0) continue;
      const caster = this.world.entities.get(b.casterId);
      const tid = caster?.castTargetId;
      const target = tid !== null && tid !== undefined ? this.world.entities.get(tid) : undefined;
      if (!caster || caster.dead || caster.castingAbility !== b.castId || !target) {
        b.casterId = -1;
        b.mesh.visible = false;
        continue;
      }
      const goad = b.castId === SANCTUM_GOAD;
      const hc = this.drawnHeight(caster);
      // From the censer at the Thawcaller's side, or the goad iron's tip
      // thrust out ahead of the Goadsmith.
      const fx = Math.sin(caster.facing);
      const fz = Math.cos(caster.facing);
      const reach = goad ? 0.42 : 0.2;
      const from = this.tmpA.set(
        caster.pos.x + fx * hc * reach,
        this.host.groundY(caster.pos.x, caster.pos.z) + hc * (goad ? 0.5 : 0.45),
        caster.pos.z + fz * hc * reach,
      );
      const to = this.tmpB.set(
        target.pos.x,
        this.host.groundY(target.pos.x, target.pos.z) + this.drawnHeight(target) * 0.55,
        target.pos.z,
      );
      const len = from.distanceTo(to);
      if (len < 0.2) {
        b.mesh.visible = false;
        continue;
      }
      // Sparks and soul motes streaming along it.
      if (this.host.rand() < dt * (goad ? 40 : 22) * this.host.density) {
        const k = this.host.rand();
        const dir = [(to.x - from.x) / len, (to.y - from.y) / len, (to.z - from.z) / len] as const;
        this.host.puff(
          from.x + (to.x - from.x) * k * 0.3,
          from.y + (to.y - from.y) * k * 0.3,
          from.z + (to.z - from.z) * k * 0.3,
          1,
          {
            speed: len * 1.4,
            life: 0.65,
            size: goad ? [0.26, 0.06] : [0.4, 0.12],
            color: goad ? [1, 0.55, 0.2] : rgb(SANCTUM_PALETTE.soulGreen),
            alpha: 1,
            pool: 'glow',
            dir,
            spread: goad ? 0.12 : 0.05,
            drag: 0.4,
            gravity: goad ? 3 : 0,
          },
        );
      }
      to.sub(from).normalize();
      b.mesh.position.copy(from);
      b.mesh.quaternion.setFromUnitVectors(this.up, to);
      b.mesh.scale.set(goad ? 0.7 : 1, len, goad ? 0.7 : 1);
      b.mesh.visible = true;
    }
  }

  private paintAuras(dt: number): void {
    for (const a of this.auras) {
      if (a.entityId < 0) continue;
      const e = this.world.entities.get(a.entityId);
      if (!e || e.dead || !hasAura(e, a.auraId)) {
        a.entityId = -1;
        a.mesh.visible = false;
        continue;
      }
      const h = this.drawnHeight(e);
      const gy = this.host.groundY(e.pos.x, e.pos.z);
      const goaded = a.auraId === SANCTUM_GOADED;
      const k = goaded ? goadedPulse(this.clock) : 0.9 + 0.1 * Math.sin(this.clock * 4);
      a.mesh.position.set(e.pos.x, gy + 0.2, e.pos.z);
      a.mesh.scale.set(h * 0.95 * k, 1, h * 0.95 * k);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = goaded ? 0.65 : 0.5;
      if (this.host.rand() > dt * (goaded ? 18 : 12) * this.host.density) continue;
      if (goaded) {
        // The fury: embers and red heat-smoke boiling off it.
        this.host.puff(e.pos.x, gy + h * 0.5, e.pos.z, 2, {
          speed: 0.8,
          up: 2.6,
          life: 1.1,
          size: [0.22, 0.06],
          color: [1, 0.42, 0.16],
          alpha: 1,
          pool: 'glow',
          radius: h * 0.22,
        });
        this.host.puff(e.pos.x, gy + h * 0.8, e.pos.z, 1, {
          speed: 0.5,
          up: 1.8,
          life: 1.4,
          size: [0.8, 2],
          color: [0.6, 0.18, 0.12],
          alpha: 0.3,
          radius: h * 0.2,
        });
      } else {
        // Quickened by the soulfire: violet-green flame motes rising off it.
        this.host.puff(e.pos.x, gy + h * 0.3, e.pos.z, 2, {
          speed: 0.4,
          up: 2.2,
          life: 1,
          size: [0.3, 0.08],
          color: rgb(SANCTUM_PALETTE.soulGreen),
          alpha: 1,
          pool: 'glow',
          radius: h * 0.25,
        });
      }
    }
  }

  private paintBlocks(): void {
    for (const b of this.blocks) {
      if (b.ringId < 0) continue;
      const ring = this.world.entities.get(b.ringId);
      const age = this.clock - b.since;
      const fill = objectFill(age, this.tossSeconds);
      if (!ring) {
        // The ring went: a block that reached it crashes, one that never
        // left the Hauler's hands is simply gone.
        if (fill >= 0.8) this.crash(b.x, b.z);
        b.ringId = -1;
        b.tosserId = -1;
        b.mesh.visible = false;
        continue;
      }
      b.x = ring.pos.x;
      b.z = ring.pos.z;
      const flight = blockFlight(fill, 7);
      if (!flight) {
        b.mesh.visible = false;
        continue;
      }
      if (!b.released) {
        b.released = true;
        const tosser = b.tosserId >= 0 ? this.world.entities.get(b.tosserId) : undefined;
        const src = tosser ?? ring;
        const h = tosser ? this.drawnHeight(tosser) : 0;
        b.fromX = src.pos.x;
        b.fromZ = src.pos.z;
        b.fromY = this.host.groundY(src.pos.x, src.pos.z) + Math.max(2, h * 1.05);
      }
      const gy = this.host.groundY(b.x, b.z) + 1.1;
      const t = flight.along;
      const x = b.fromX + (b.x - b.fromX) * t;
      const z = b.fromZ + (b.z - b.fromZ) * t;
      const y = b.fromY + (gy - b.fromY) * t + flight.lift;
      b.mesh.visible = true;
      b.mesh.position.set(x, y, z);
      b.mesh.rotation.set(age * b.spin, age * b.spin * 0.6, 0);
      b.mesh.scale.setScalar(1.35);
      // A trail of rime falling off it.
      if (this.host.rand() < 0.5)
        this.host.puff(x, y, z, 1, {
          speed: 0.4,
          life: 0.6,
          size: [0.5, 1.2],
          color: [0.9, 0.95, 1],
          alpha: 0.4,
        });
      if (fill < BLOCK_RELEASE) b.mesh.visible = false;
    }
  }

  private crash(x: number, z: number): void {
    const gy = this.host.groundY(x, z);
    const r = 5;
    this.host.shockRing(x, z, SANCTUM_PALETTE.rime, r, 0.5);
    this.host.shards.burst(x, gy + 0.8, z, 34, {
      speed: r * 2.2,
      up: 6,
      size: [0.25, 0.75],
      radius: 0.8,
    });
    this.host.puff(x, gy + 0.8, z, 34, {
      speed: r * 2,
      up: 1,
      life: 1.5,
      size: [1, 3],
      color: [0.88, 0.94, 1],
      alpha: 0.6,
      drag: 2.6,
    });
    this.host.puff(x, gy + 1, z, 20, {
      speed: r * 1.8,
      up: 2,
      life: 0.8,
      size: [0.28, 0.07],
      color: rgb(SANCTUM_PALETTE.rime),
      alpha: 1,
      pool: 'glow',
      drag: 1.8,
    });
    if (!this.host.reducedMotion()) this.host.shake(0.3);
  }

  private paintShatters(dt: number): void {
    const delay = shatterDelay();
    for (let i = this.shatters.length - 1; i >= 0; i--) {
      const s = this.shatters[i];
      const since = this.clock - s.since;
      if (since > delay + 1) {
        this.shatters.splice(i, 1);
        continue;
      }
      if (since > delay) continue;
      const b = shatterBuild(since, delay);
      const gy = this.host.groundY(s.x, s.z);
      // The rune-iron core flaring up through the ice, quicker as it builds.
      if (this.host.rand() < dt * b.rate * this.host.density) {
        this.host.puff(s.x, gy + 0.6, s.z, 2, {
          speed: 0.6,
          up: 1.8 * b.glow,
          life: 0.8,
          size: [0.5 * b.glow + 0.2, 0.1],
          color: rgb(SANCTUM_PALETTE.runeBlue),
          alpha: 1,
          pool: 'glow',
          radius: 1.2,
        });
        this.host.puff(s.x, gy + 0.3, s.z, 1, {
          speed: 0.4,
          up: 0.6,
          life: 1.2,
          size: [0.8, 1.8],
          color: [0.85, 0.92, 1],
          alpha: 0.3 * b.glow,
          radius: 1.4,
        });
      }
    }
  }

  /** A view rebuilt after its Splinter shattered hides the corpse too. */
  private resendShattered(): void {
    for (const [id, at] of this.shattered) {
      const e = this.world.entities.get(id);
      if (!e?.dead) {
        this.shattered.delete(id);
        continue;
      }
      if (this.clock - at < 1) continue;
      this.shattered.set(id, this.clock);
      this.host.gesture(id, SPLINTER_SHATTERED_GESTURE);
    }
  }

  /** The bodies' own idle effects: the brazier's soulfire, the Pyre-Tender's
   *  yoke fires, the Thawcaller's censer smoke, the Scaleguard's meltwater,
   *  the Goadsmith's red-hot iron. */
  private paintBodies(dt: number): void {
    const density = this.host.density;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead) continue;
      switch (e.templateId) {
        case SOUL_BRAZIER_ID:
          this.brazierFire(e, dt * 14 * density);
          break;
        case PYRE_TENDER_ID:
          this.yokeFires(e, dt * 10 * density);
          break;
        case THAWCALLER_ID:
          this.censer(e, dt * 5 * density);
          break;
        case SCALEGUARD_ID:
          this.meltwater(e, dt * 7 * density);
          this.cinderDraw(e, dt * 30 * density);
          break;
        case GOADSMITH_ID:
          this.goadIron(e, dt * 8 * density);
          break;
        case RIME_WHELP_ID:
          this.rimeFrost(e, dt * 6 * density);
          break;
        case GLACIER_SPLINTER_ID:
          this.runeCore(e, dt * 7 * density);
          break;
        default:
          break;
      }
    }
  }

  private brazierFire(e: Entity, rate: number): void {
    if (this.host.rand() > rate) return;
    const top = this.host.groundY(e.pos.x, e.pos.z) + this.drawnHeight(e) * 0.82;
    this.host.puff(e.pos.x, top, e.pos.z, 1, {
      speed: 0.3,
      up: 1.3,
      life: 0.8,
      size: [1.3, 0.5],
      color: FLAME_HEAT,
      alpha: 1,
      pool: 'soulfire',
      radius: 0.45,
    });
    if (this.host.rand() < 0.4)
      this.host.puff(e.pos.x, top + 0.6, e.pos.z, 1, {
        speed: 0.4,
        up: 2.4,
        life: 1.3,
        size: [0.16, 0.05],
        color: rgb(SANCTUM_PALETTE.soulGreen),
        alpha: 1,
        pool: 'glow',
        radius: 0.4,
      });
  }

  private yokeFires(e: Entity, rate: number): void {
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    const fx = Math.sin(e.facing);
    const fz = Math.cos(e.facing);
    for (const side of SIDES) {
      if (this.host.rand() > rate) continue;
      // The yoke's two braziers ride out past her shoulders, a little behind.
      const x = e.pos.x + fz * side * h * 0.2 - fx * h * 0.05;
      const z = e.pos.z - fx * side * h * 0.2 - fz * h * 0.05;
      this.host.puff(x, gy + h * 0.76, z, 1, {
        speed: 0.25,
        up: 1,
        life: 0.6,
        size: [0.75, 0.3],
        color: FLAME_HEAT,
        alpha: 1,
        pool: 'pyre',
        radius: 0.15,
      });
      if (this.host.rand() < 0.3)
        this.host.puff(x, gy + h * 0.9, z, 1, {
          speed: 0.3,
          up: 1.4,
          life: 1.6,
          size: [0.4, 1.4],
          color: [0.2, 0.18, 0.17],
          alpha: 0.4,
        });
    }
  }

  private censer(e: Entity, rate: number): void {
    if (this.host.rand() > rate) return;
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    const sway = Math.sin(this.clock * 2.2 + e.id) * h * 0.08;
    const fx = Math.sin(e.facing);
    const fz = Math.cos(e.facing);
    const x = e.pos.x + fx * h * 0.18 + fz * sway;
    const z = e.pos.z + fz * h * 0.18 - fx * sway;
    this.host.puff(x, gy + h * 0.42, z, 1, {
      speed: 0.25,
      up: 0.9,
      life: 2,
      size: [0.4, 1.4],
      color: [0.5, 0.42, 0.7],
      alpha: 0.32,
    });
    this.host.puff(x, gy + h * 0.42, z, 1, {
      speed: 0.2,
      up: 1.1,
      life: 0.9,
      size: [0.26, 0.08],
      color: rgb(SANCTUM_PALETTE.soulGreen),
      alpha: 1,
      pool: 'glow',
    });
  }

  private meltwater(e: Entity, rate: number): void {
    if (this.host.rand() > rate) return;
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    // Meltwater running off the drowned brood: drops falling off its flanks.
    this.host.puff(e.pos.x, gy + h * (0.4 + this.host.rand() * 0.35), e.pos.z, 1, {
      speed: 0.2,
      life: 0.7,
      size: [0.09, 0.06],
      color: [0.7, 0.88, 1],
      alpha: 0.9,
      pool: 'glow',
      radius: h * 0.28,
      gravity: 14,
    });
  }

  /** The Cinder Breath's bar: embers drawn in toward its jaws. */
  private cinderDraw(e: Entity, rate: number): void {
    if (e.castingAbility !== SANCTUM_CINDER_BREATH) return;
    if (this.host.rand() > rate) return;
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    const fx = Math.sin(e.facing);
    const fz = Math.cos(e.facing);
    const mx = e.pos.x + fx * h * 0.3;
    const mz = e.pos.z + fz * h * 0.3;
    const my = gy + h * 0.5;
    const a = this.host.rand() * Math.PI * 2;
    const r = 1.6 + this.host.rand() * 1.2;
    const sx = mx + Math.cos(a) * r;
    const sz = mz + Math.sin(a) * r;
    const sy = my + (this.host.rand() - 0.3) * 1.5;
    const d = Math.hypot(mx - sx, my - sy, mz - sz) || 1;
    this.host.puff(sx, sy, sz, 1, {
      speed: d * 1.6,
      life: 0.55,
      size: [0.22, 0.06],
      color: [1, 0.5, 0.16],
      alpha: 1,
      pool: 'glow',
      dir: [(mx - sx) / d, (my - sy) / d, (mz - sz) / d],
      spread: 0.05,
      drag: 0.6,
    });
  }

  /** The Smith's rune-iron core glowing blue through a Splinter's ice. */
  private runeCore(e: Entity, rate: number): void {
    if (this.host.rand() > rate) return;
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    this.host.puff(e.pos.x, gy + h * 0.5, e.pos.z, 1, {
      speed: 0.3,
      up: 0.6,
      life: 0.9,
      size: [h * 0.12, h * 0.05],
      color: rgb(SANCTUM_PALETTE.runeBlue),
      alpha: 0.8,
      pool: 'glow',
      radius: h * 0.12,
    });
  }

  /** Hoarfrost shed off a thawed whelp's wings as it moves. */
  private rimeFrost(e: Entity, rate: number): void {
    if (this.host.rand() > rate) return;
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    this.host.puff(e.pos.x, gy + h * 0.6, e.pos.z, 1, {
      speed: 0.4,
      up: -0.2,
      life: 1.2,
      size: [0.18, 0.05],
      color: rgb(SANCTUM_PALETTE.rime),
      alpha: 1,
      pool: 'glow',
      radius: h * 0.45,
      gravity: 1,
    });
  }

  private goadIron(e: Entity, rate: number): void {
    if (this.host.rand() > rate) return;
    const h = this.drawnHeight(e);
    const gy = this.host.groundY(e.pos.x, e.pos.z);
    const fx = Math.sin(e.facing);
    const fz = Math.cos(e.facing);
    // The red-hot tip of the goad iron, ahead and to its right.
    const x = e.pos.x + fx * h * 0.28 - fz * h * 0.12;
    const z = e.pos.z + fz * h * 0.28 + fx * h * 0.12;
    this.host.puff(x, gy + h * 0.55, z, 1, {
      speed: 0.6,
      up: 1.4,
      life: 0.6,
      size: [0.18, 0.05],
      color: [1, 0.48, 0.18],
      alpha: 1,
      pool: 'glow',
      radius: 0.25,
      gravity: 2,
    });
  }

  /** A body's drawn height (the look's height at its sim scale). */
  private drawnHeight(e: Entity): number {
    return sanctumDrawnHeight(e.templateId, e.scale || 1);
  }

  hideAll(): void {
    for (const b of this.beams) {
      b.casterId = -1;
      b.mesh.visible = false;
    }
    for (const a of this.auras) {
      a.entityId = -1;
      a.mesh.visible = false;
    }
    for (const b of this.blocks) {
      b.ringId = -1;
      b.mesh.visible = false;
    }
    this.shatters.length = 0;
    for (const b of this.breaths) b.until = -1;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** Does the entity carry the aura (a loop: no per-frame closure). */
function hasAura(e: { auras?: readonly { id: string }[] }, id: string): boolean {
  const auras = e.auras;
  if (!auras) return false;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return true;
  return false;
}
