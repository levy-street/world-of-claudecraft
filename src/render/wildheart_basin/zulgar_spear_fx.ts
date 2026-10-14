// Zulgar's Hunting Spear standing in the terrace (plan: zulgar_hunt_fx_core.ts),
// on WildheartFx's host. The sim's spear is a usable body with no rig of its
// own (characters/wildheart_creature_looks.ts WILDHEART_HUNTING_SPEAR_LOOK:
// only its click capsule, nameplate and bar); what a player sees is here:
//  - the spear: an obsidian head sunk in the flags, a bone collar bound in red
//    cord, a dark shaft leaning back at the hand that threw it, red and gold
//    feathers at its throat and its butt. It drives in from above along its
//    own line and its shaft quivers for a moment;
//  - the cord: a jade spirit cord (the Pack Bond's braid, bond_cord.ts) from
//    the shaft to the Pinned player's chest, taut and bright, a jade glow
//    pooled under both;
//  - the ring under the Pinned player, on the shared telegraph kit in the
//    palette's control violet, its fill the pin's time left;
//  - the throw: a pale streak from his hand to the spear and a burst of stone
//    chips where it bites, and a puff as it is pulled.
// The spear, the cord and the ring draw on every graphics tier (the ring is
// the kit's footprint; the spear a lit mesh; the cord one additive draw);
// only the chips and dust thin with the host's density.
//
// Rules (src/render/CLAUDE.md): everything is built in the constructor under
// the host's root before its gated attach; the frame path allocates nothing;
// no light. The spear's material is the shared surface factory's (never
// disposed here).

import * as THREE from 'three';
import {
  HUNTING_SPEAR_ID,
  ZULGAR_HUNTING_SPEAR,
  ZULGAR_PINNED,
  ZULGAR_SPEAR_FREED,
  ZULGAR_TUNING,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphFan, TelegraphPaint } from '../floor_telegraph';
import { surfaceMat } from '../gfx';
import { BOSS_SPLASH, bossBodyHeight } from './basin_boss_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import { BondCord } from './bond_cord';
import {
  clockLeft,
  PINNED_RING,
  SPEAR_LOOK,
  spearAxisInto,
  spearDrive,
} from './zulgar_hunt_fx_core';

/** Two spears at once is the most the encounter ever stands (one on every
 *  difficulty today; the spare covers a pull landing as the next is thrown). */
const SPEAR_SLOTS = 2;

interface SpearSlot {
  mesh: THREE.Mesh;
  cord: BondCord;
  ring: TelegraphFan;
  bodyId: number;
  victimId: number;
  since: number;
}

interface Streak {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  alive: boolean;
}

const STREAK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The thrown spear's streak: bright at its head, torn behind. */
const STREAK_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float head = smoothstep(0.35, 1.0, vUv.y);
  float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
  vec3 col = mix(vec3(0.5, 0.95, 0.7), vec3(1.0, 0.95, 0.8), head);
  gl_FragColor = vec4(col * (0.25 + 0.75 * head) * core * uAlpha, 1.0);
}
`;

type Rgb = readonly [number, number, number];
const WOOD: Rgb = [0.3, 0.19, 0.1];
const OBSIDIAN: Rgb = [0.07, 0.08, 0.1];
const BONE: Rgb = [0.86, 0.8, 0.66];
const CORD_RED: Rgb = [0.62, 0.1, 0.08];
const FEATHER_RED: Rgb = [0.8, 0.14, 0.1];
const FEATHER_GOLD: Rgb = [0.95, 0.7, 0.2];

/** The spear along +y: its point at the origin, its butt at SPEAR_LOOK.length.
 *  One merged, vertex-coloured geometry (built once). */
function spearGeometry(): THREE.BufferGeometry {
  const L = SPEAR_LOOK.length;
  const parts: { geo: THREE.BufferGeometry; rgb: Rgb }[] = [];
  const add = (geo: THREE.BufferGeometry, rgb: Rgb) => parts.push({ geo, rgb });
  // The head: a broad leaf of obsidian, flat, point down.
  add(
    new THREE.ConeGeometry(0.34, 1.25, 4).rotateX(Math.PI).scale(1, 1, 0.3).translate(0, 0.625, 0),
    OBSIDIAN,
  );
  // The bone collar it is socketed in, and two turns of red cord.
  add(new THREE.CylinderGeometry(0.13, 0.17, 0.36, 8).translate(0, 1.3, 0), BONE);
  add(new THREE.CylinderGeometry(0.135, 0.135, 0.13, 8).translate(0, 1.56, 0), CORD_RED);
  add(new THREE.CylinderGeometry(0.13, 0.13, 0.11, 8).translate(0, 1.76, 0), CORD_RED);
  // The shaft: a troll's spear, thick as a wrist.
  add(
    new THREE.CylinderGeometry(0.082, 0.1, L - 1.45, 8).translate(0, 1.45 + (L - 1.45) / 2, 0),
    WOOD,
  );
  // Feathers hung at its throat (three, fanned out and down) and a larger
  // fletching of four at its butt, so it reads from across the terrace.
  for (let i = 0; i < 3; i++) {
    const turn = (i / 3) * Math.PI * 2 + 0.4;
    add(
      new THREE.BoxGeometry(0.26, 0.9, 0.03)
        .translate(0, -0.45, 0)
        .rotateZ(-0.62)
        .translate(0.12, 1.72, 0)
        .rotateY(turn),
      i === 1 ? FEATHER_GOLD : FEATHER_RED,
    );
  }
  for (let i = 0; i < 4; i++) {
    const turn = (i / 4) * Math.PI * 2 + 0.2;
    add(
      new THREE.BoxGeometry(0.42, 1.3, 0.035)
        .translate(0, -0.65, 0)
        .rotateZ(-0.46)
        .translate(0.09, L - 0.05, 0)
        .rotateY(turn),
      i % 2 === 0 ? FEATHER_RED : FEATHER_GOLD,
    );
  }
  add(new THREE.SphereGeometry(0.15, 8, 6).translate(0, L, 0), BONE);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(part.rgb[0], part.rgb[1], part.rgb[2]);
    }
    if (g !== part.geo) g.dispose();
    part.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

export class ZulgarSpearFx {
  private readonly slots: SpearSlot[] = [];
  private readonly streaks: Streak[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly axis = { x: 0, y: 1, z: 0 };
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly feet: [number, number, number, number] = [0, 0, 0, 0];
  private readonly paint: TelegraphPaint = { fill: 1, clock: 0, range: 1, fade: 1 };
  private clock = 0;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
  ) {
    const { root, kit } = host;
    const geo = spearGeometry();
    this.geometries.push(geo);
    // The shared surface factory's material (lit by the basin's own rig).
    const mat = surfaceMat({ vertexColors: true, flatShading: true, roughness: 0.78 });
    for (let i = 0; i < SPEAR_SLOTS; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'wildheart-hunting-spear';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.scale.setScalar(SPEAR_LOOK.scale);
      root.add(mesh);
      const ring = kit.fan(15);
      ring.group.name = 'wildheart-pinned-ring';
      kit.layOutFan(ring, 360, PINNED_RING);
      const cord = new BondCord(host, SPEAR_LOOK.cord);
      this.slots.push({ mesh, cord, ring, bodyId: -1, victimId: -1, since: 0 });
    }
    const streakGeo = new THREE.CylinderGeometry(0.09, 0.03, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(streakGeo);
    for (let i = 0; i < SPEAR_SLOTS; i++) {
      const streakMat = new THREE.ShaderMaterial({
        name: 'wildheartSpearStreak',
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(streakMat);
      const mesh = new THREE.Mesh(streakGeo, streakMat);
      mesh.name = 'wildheart-spear-streak';
      mesh.frustumCulled = false;
      mesh.visible = false;
      root.add(mesh);
      this.streaks.push({ mesh, mat: streakMat, born: 0, alive: false });
    }
  }

  // ------------------------------------------------------------------- scan

  /** A Pinned player names their spear (the aura's source is its body). */
  scanPlayer(e: Entity): void {
    const auras = e.auras;
    if (!auras || e.dead) return;
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i];
      if (a.id !== ZULGAR_PINNED) continue;
      for (const s of this.slots) if (s.bodyId === a.sourceId) return;
      const slot = this.slots.find((s) => s.bodyId < 0);
      if (!slot) return;
      slot.bodyId = a.sourceId;
      slot.victimId = e.id;
      slot.since = this.clock;
      return;
    }
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    for (const s of this.slots) this.paintSpear(s, dt);
    for (const k of this.streaks) {
      if (!k.alive) continue;
      const u = (clock - k.born) / SPEAR_LOOK.streakSeconds;
      if (u >= 1) {
        k.alive = false;
        k.mesh.visible = false;
        continue;
      }
      k.mat.uniforms.uAlpha.value = (1 - u) ** 2;
    }
  }

  private release(s: SpearSlot): void {
    s.bodyId = -1;
    s.victimId = -1;
    s.mesh.visible = false;
    s.ring.group.visible = false;
    s.cord.hide();
  }

  private paintSpear(s: SpearSlot, dt: number): void {
    if (s.bodyId < 0) return;
    const world = this.world;
    const body = world.entities.get(s.bodyId);
    const victim = world.entities.get(s.victimId);
    let pin: { remaining: number; duration: number } | null = null;
    if (victim && !victim.dead && victim.auras) {
      for (let i = 0; i < victim.auras.length; i++) {
        const a = victim.auras[i];
        if (a.id === ZULGAR_PINNED && a.sourceId === s.bodyId) pin = a;
      }
    }
    if (!body || body.dead || body.templateId !== HUNTING_SPEAR_ID || !victim || !pin) {
      this.release(s);
      return;
    }
    const host = this.host;
    const drive = spearDrive(this.clock - s.since);
    const axis = spearAxisInto(this.axis, body.facing, SPEAR_LOOK.lean + drive.sway);
    const bx = body.pos.x;
    const bz = body.pos.z;
    const gy = host.groundY(bx, bz);
    const off = drive.rise - SPEAR_LOOK.buried;
    s.mesh.position.set(bx + axis.x * off, gy + axis.y * off, bz + axis.z * off);
    s.mesh.quaternion.setFromUnitVectors(this.up, this.dir.set(axis.x, axis.y, axis.z));
    s.mesh.visible = true;
    // The ring under the Pinned player: its fill the pin's time left.
    const vx = victim.pos.x;
    const vz = victim.pos.z;
    host.kit.drapeFan(s.ring, host.groundY, vx, host.groundY(vx, vz), vz, 0, SPEAR_LOOK.ringRadius);
    this.paint.fill = clockLeft(pin.remaining, pin.duration);
    this.paint.clock = this.clock;
    this.paint.range = SPEAR_LOOK.ringRadius;
    this.paint.fade = 0.85 + 0.15 * Math.sin(this.clock * 6);
    host.kit.paintFan(s.ring, this.paint);
    s.ring.group.visible = true;
    // The cord from the shaft to their chest, once the spear is in.
    if (drive.rise > 0) {
      s.cord.hide();
      return;
    }
    const tie = SPEAR_LOOK.tieAt - SPEAR_LOOK.buried;
    this.from.set(bx + axis.x * tie, gy + axis.y * tie, bz + axis.z * tie);
    const h = bossBodyHeight(victim.templateId, victim.scale || 1);
    this.to.set(vx, victim.pos.y + h * 0.52, vz);
    this.feet[0] = bx;
    this.feet[1] = bz;
    this.feet[2] = vx;
    this.feet[3] = vz;
    s.cord.show(this.from, this.to, this.feet, 1, dt);
  }

  // ------------------------------------------------------------------- events

  /** The throw landing and the spear coming out. True when the event was one
   *  of the spear's. */
  handleEvent(ev: Extract<SimEvent, { type: 'spellfx' }>, src: Entity): boolean {
    const target = this.world.entities.get(ev.targetId);
    if (ev.ability === ZULGAR_HUNTING_SPEAR) {
      if (!target || ev.fx !== 'detonate') return true;
      this.thrown(src, target);
      return true;
    }
    if (ev.ability !== ZULGAR_SPEAR_FREED) return false;
    if (!target) return true;
    const host = this.host;
    const { x, z } = target.pos;
    const gy = host.groundY(x, z);
    host.shockRing(x, z, 0xd8fff0, SPEAR_LOOK.ringRadius * 1.6, 0.45);
    host.puff(x, gy + 0.3, z, 12, {
      speed: 2.4,
      up: 1.6,
      life: 0.8,
      size: [0.6, 1.6],
      color: [0.5, 0.44, 0.36],
      alpha: 0.5,
      drag: 2,
      radius: 0.8,
    });
    return true;
  }

  /** His throw: a streak from his hand to where the spear bites, chips of
   *  flagstone thrown up, the floor shaken. */
  private thrown(z: Entity, victim: Entity): void {
    const host = this.host;
    const dx = z.pos.x - victim.pos.x;
    const dz = z.pos.z - victim.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = victim.pos.x + (dx / len) * ZULGAR_TUNING.spearStandoff;
    const sz = victim.pos.z + (dz / len) * ZULGAR_TUNING.spearStandoff;
    const gy = host.groundY(sx, sz);
    const streak = this.streaks.find((k) => !k.alive) ?? this.streaks[0];
    const h = bossBodyHeight(z.templateId, z.scale || 1);
    this.from.set(z.pos.x, z.pos.y + h * 0.8, z.pos.z);
    this.to.set(sx, gy, sz);
    const span = this.from.distanceTo(this.to);
    this.to.sub(this.from).normalize();
    streak.mesh.position.copy(this.from);
    streak.mesh.quaternion.setFromUnitVectors(this.up, this.to);
    streak.mesh.scale.set(1, Math.max(0.01, span), 1);
    streak.mat.uniforms.uAlpha.value = 1;
    streak.mesh.visible = true;
    streak.alive = true;
    streak.born = this.clock;
    host.splash.crown(sx, gy, sz, BOSS_SPLASH.spear.crown, BOSS_SPLASH.spear.tint);
    host.puff(sx, gy + 0.2, sz, 14, {
      speed: 4.2,
      up: 3.2,
      life: 0.7,
      size: [0.22, 0.1],
      color: [0.62, 0.58, 0.52],
      alpha: 1,
      gravity: 12,
      radius: 0.4,
    });
    if (!host.reducedMotion()) host.shake(0.22);
  }

  // ------------------------------------------------------------------- lifetime

  /** Out of the basin (a wipe, a leave): put every spear away. */
  hideAll(): void {
    for (const s of this.slots) this.release(s);
    for (const k of this.streaks) {
      k.alive = false;
      k.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const s of this.slots) s.cord.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
