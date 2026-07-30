// Frozen Orb visual: the roaming ice sphere the frost mage releases (WoW-style
// reference: a translucent blue orb drifting forward, swirling shards, frosty
// glow, sparkling frost trail). The sim's orb is pure state (ctx.frozenOrbs,
// never wired); the client animates the flight locally from three 'orb'
// spellfxAt moments: 'release' starts the drift (origin, unit direction,
// speed, duration), and 'halt'/'resume' freeze and restart it at the server's
// real coordinates when the orb latches onto (and outlives) an enemy. The
// per-second pulse novas remain the authoritative area telegraph at every
// graphics tier; this sphere is cosmetic richness on top.
//
// Renderer contract: construct once with the scene and a terrain-height
// resolver, spawn()/halt()/resume() from the 'orb' events, update(dt) once per
// frame from the same block that ticks the other transient systems (vfx /
// lightPulses). Per-frame work is allocation-free: geometries are built once
// and shared; materials and the trail buffer are per orb (they animate) and
// disposed when the orb expires. Math.random here is fine: this is the
// renderer, the determinism ban is sim-only.

import * as THREE from 'three';
import { SCHOOL_COLORS } from './vfx';

const ORB_HOVER = 1.15; // yards the sphere floats above the terrain
const ORB_RADIUS = 0.55;
const CORE_RADIUS = 0.26;
const SHARD_COUNT = 6;
const SHARD_ORBIT = 0.85;
const FADE_IN = 0.18; // seconds growing out of the cast
const FADE_OUT = 0.4; // seconds dissolving at end of life
const BOB_HEIGHT = 0.08;
const BOB_SPEED = 3.2; // rad/s of the hover bob
const SPIN_SPEED = 1.6; // rad/s, the shell's lazy roll
const SHARD_SPIN_SPEED = -2.8; // rad/s, counter-rotating shard ring
// Latched onto prey: the shard ring whirls up, so the grind reads as effort.
const HALTED_SPIN_MULT = 2.2;
const SHELL_OPACITY = 0.42;
const CORE_OPACITY = 0.9;
const SHARD_OPACITY = 0.85;
// Frost sparkle trail: a small recycled pool of additive motes shed behind the
// flight, drifting apart and sinking as they die.
const TRAIL_COUNT = 42;
const TRAIL_LIFE_MIN = 0.45;
const TRAIL_LIFE_MAX = 0.95;
const TRAIL_SIZE = 0.14;
const TRAIL_SPREAD = 0.45; // spawn scatter around the orb's heart (yards)
const TRAIL_DRIFT = 0.6; // outward drift speed (yards/s)
const TRAIL_SINK = 0.5; // downward drift (yards/s), melting snowfall

export interface FrozenOrbSpawn {
  sourceId: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number; // yards per second
  duration: number; // seconds of flight
}

interface OrbFx {
  sourceId: number;
  group: THREE.Group;
  shardRing: THREE.Group;
  shellMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshBasicMaterial;
  shardMat: THREE.MeshStandardMaterial;
  trail: THREE.Points;
  trailMat: THREE.PointsMaterial;
  trailPos: Float32Array;
  trailVel: Float32Array;
  trailAge: Float32Array;
  trailLife: Float32Array;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  duration: number;
  elapsed: number;
  halted: boolean;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export class FrozenOrbFx {
  private readonly scene: THREE.Scene;
  private readonly groundY: (x: number, z: number) => number;
  private readonly orbs: OrbFx[] = [];
  // Shared geometry, built lazily on the first spawn and reused for every orb.
  private shellGeo: THREE.SphereGeometry | null = null;
  private coreGeo: THREE.SphereGeometry | null = null;
  private shardGeo: THREE.TetrahedronGeometry | null = null;

  constructor(scene: THREE.Scene, groundY: (x: number, z: number) => number) {
    this.scene = scene;
    this.groundY = groundY;
  }

  spawn(opts: FrozenOrbSpawn): void {
    this.shellGeo ??= new THREE.SphereGeometry(ORB_RADIUS, 20, 14);
    this.coreGeo ??= new THREE.SphereGeometry(CORE_RADIUS, 12, 8);
    this.shardGeo ??= new THREE.TetrahedronGeometry(0.11);
    // A re-release from the same caster replaces their previous orb visual
    // (the sim can never overlap two, but a missed expiry must not leak one).
    const stale = this.orbs.findIndex((o) => o.sourceId === opts.sourceId);
    if (stale >= 0) this.remove(stale);

    const frost = new THREE.Color(SCHOOL_COLORS.frost);
    // Translucent icy shell: the emissive term keeps it readable in shade and
    // feeds the bloom pass a soft blue halo without an actual light.
    const shellMat = new THREE.MeshStandardMaterial({
      color: frost,
      emissive: frost.clone().multiplyScalar(0.55),
      roughness: 0.18,
      metalness: 0,
      transparent: true,
      opacity: SHELL_OPACITY,
      depthWrite: false,
    });
    // Bright additive heart, over the bloom threshold so the orb glows.
    const coreMat = new THREE.MeshBasicMaterial({
      color: frost.clone().multiplyScalar(1.9),
      transparent: true,
      opacity: CORE_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xcfeaff,
      emissive: frost.clone().multiplyScalar(0.35),
      roughness: 0.25,
      metalness: 0,
      transparent: true,
      opacity: SHARD_OPACITY,
    });

    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.shellGeo, shellMat));
    group.add(new THREE.Mesh(this.coreGeo, coreMat));
    // Counter-rotating ring of ice shards around the equator.
    const shardRing = new THREE.Group();
    for (let i = 0; i < SHARD_COUNT; i++) {
      const shard = new THREE.Mesh(this.shardGeo, shardMat);
      const a = (i / SHARD_COUNT) * Math.PI * 2;
      shard.position.set(
        Math.cos(a) * SHARD_ORBIT,
        Math.sin(a * 3) * 0.12,
        Math.sin(a) * SHARD_ORBIT,
      );
      shard.rotation.set(a, a * 1.7, a * 0.6);
      shardRing.add(shard);
    }
    group.add(shardRing);
    const y0 = this.groundY(opts.x, opts.z) + ORB_HOVER;
    group.position.set(opts.x, y0, opts.z);
    group.scale.setScalar(0.01); // grows in over FADE_IN
    this.scene.add(group);

    // Frost sparkle trail: world-space points recycled in place. Every mote
    // starts already expired, so the first frames seed them along the flight.
    const trailPos = new Float32Array(TRAIL_COUNT * 3);
    const trailVel = new Float32Array(TRAIL_COUNT * 3);
    const trailAge = new Float32Array(TRAIL_COUNT);
    const trailLife = new Float32Array(TRAIL_COUNT);
    for (let i = 0; i < TRAIL_COUNT; i++) {
      trailPos[i * 3] = opts.x;
      trailPos[i * 3 + 1] = y0;
      trailPos[i * 3 + 2] = opts.z;
      trailAge[i] = 1;
      trailLife[i] = 0; // expired: respawns on the first update
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    const trailMat = new THREE.PointsMaterial({
      color: frost.clone().multiplyScalar(1.7),
      size: TRAIL_SIZE,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    trail.frustumCulled = false; // world-scattered motes; the pool is tiny
    this.scene.add(trail);

    this.orbs.push({
      sourceId: opts.sourceId,
      group,
      shardRing,
      shellMat,
      coreMat,
      shardMat,
      trail,
      trailMat,
      trailPos,
      trailVel,
      trailAge,
      trailLife,
      x: opts.x,
      z: opts.z,
      dirX: opts.dirX,
      dirZ: opts.dirZ,
      speed: opts.speed,
      duration: opts.duration,
      elapsed: 0,
      halted: false,
    });
  }

  /** The orb latched onto an enemy: freeze the drift at the server's real spot. */
  halt(sourceId: number, x: number, z: number): void {
    const orb = this.orbs.find((o) => o.sourceId === sourceId);
    if (!orb) return; // released out of interest range: nothing to freeze
    orb.halted = true;
    orb.x = x;
    orb.z = z;
  }

  /** Nothing lives in reach any more: resume the drift from the server's spot. */
  resume(sourceId: number, x: number, z: number): void {
    const orb = this.orbs.find((o) => o.sourceId === sourceId);
    if (!orb) return;
    orb.halted = false;
    orb.x = x;
    orb.z = z;
  }

  update(dt: number): void {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.elapsed += dt;
      if (orb.elapsed >= orb.duration) {
        this.remove(i);
        continue;
      }
      const t = orb.elapsed;
      if (!orb.halted) {
        orb.x += orb.dirX * orb.speed * dt;
        orb.z += orb.dirZ * orb.speed * dt;
      }
      const bob = Math.sin(t * BOB_SPEED) * BOB_HEIGHT;
      const y = this.groundY(orb.x, orb.z) + ORB_HOVER + bob;
      orb.group.position.set(orb.x, y, orb.z);
      const spinMult = orb.halted ? HALTED_SPIN_MULT : 1;
      orb.group.rotation.y += SPIN_SPEED * spinMult * dt;
      orb.shardRing.rotation.y += SHARD_SPIN_SPEED * spinMult * dt;
      // Grow out of the cast, dissolve at end of life; opacity rides the same
      // ramp so the dissolve reads as melting, not popping.
      const fadeIn = easeOutCubic(Math.min(1, t / FADE_IN));
      const fadeOut = Math.min(1, (orb.duration - t) / FADE_OUT);
      const s = fadeIn * (0.6 + 0.4 * fadeOut);
      orb.group.scale.setScalar(Math.max(0.01, s));
      const a = fadeIn * fadeOut;
      orb.shellMat.opacity = SHELL_OPACITY * a;
      orb.coreMat.opacity = CORE_OPACITY * a;
      orb.shardMat.opacity = SHARD_OPACITY * a;
      orb.trailMat.opacity = 0.85 * a;
      this.updateTrail(orb, dt, y);
    }
  }

  // Advance the sparkle motes; an expired mote respawns at the orb's heart
  // with a fresh scatter and drift, so the pool recycles with no allocation.
  private updateTrail(orb: OrbFx, dt: number, orbY: number): void {
    const pos = orb.trailPos;
    const vel = orb.trailVel;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      orb.trailAge[i] += dt;
      if (orb.trailAge[i] >= orb.trailLife[i]) {
        orb.trailAge[i] = 0;
        orb.trailLife[i] = TRAIL_LIFE_MIN + Math.random() * (TRAIL_LIFE_MAX - TRAIL_LIFE_MIN);
        pos[i * 3] = orb.x + (Math.random() - 0.5) * TRAIL_SPREAD * 2;
        pos[i * 3 + 1] = orbY + (Math.random() - 0.5) * TRAIL_SPREAD;
        pos[i * 3 + 2] = orb.z + (Math.random() - 0.5) * TRAIL_SPREAD * 2;
        vel[i * 3] = (Math.random() - 0.5) * TRAIL_DRIFT * 2;
        vel[i * 3 + 1] = -TRAIL_SINK * (0.4 + Math.random());
        vel[i * 3 + 2] = (Math.random() - 0.5) * TRAIL_DRIFT * 2;
        continue;
      }
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    orb.trail.geometry.attributes.position.needsUpdate = true;
  }

  private remove(index: number): void {
    const orb = this.orbs[index];
    this.scene.remove(orb.group);
    this.scene.remove(orb.trail);
    orb.shellMat.dispose();
    orb.coreMat.dispose();
    orb.shardMat.dispose();
    orb.trailMat.dispose();
    orb.trail.geometry.dispose();
    this.orbs.splice(index, 1);
  }
}
