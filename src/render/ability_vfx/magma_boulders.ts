import * as THREE from 'three';
import type { TrackedLightHost } from '../light_pulses';
import { MagmaBoulderVisual } from '../magma_boulder_visual';
import { tagVfxSubtree } from '../renderer_diagnostics';
import type { VfxAnchorResolver } from '../vfx_anchor';
import type { ParticleBurstKind } from './fx';
import {
  BOULDER_RADIUS,
  boulderScale,
  crackGap,
  FIRE_RING_RADIUS,
  FIRE_RING_S,
  flightLavaLight,
  flightProgress,
  impactLavaLight,
  LAVA_LIGHT_COLOR,
  type LavaLight,
  type MagmaBurstPlan,
  RING_WAVES,
  ringWaveAt,
} from './magma_boulder_core';
import { flightLightGain } from './stepped_leader_core';

// The Magma Burst cracking boulder (the Shaman's lava_burst): a volcanic rock
// that rides the pooled Vfx projectile (its head drawn as a molten halo), a
// pebble at the caster's hand that swells into a boulder by arrival while its
// crust plates drift apart so the glowing cracks open and widen; it drips lava
// and lights the ground under it more as it grows. When it lands it shatters
// (debris and embers) and a ring of fire burns at the target's feet; the
// archetype sequencer owns the rest of the impact stack (flash, rings, sparks,
// smoke, scorch) and fires it at the same arrival.
//
// The rocks are scene meshes built ONCE here, hidden, on the two shared
// materials the boot manifest stages (magma_boulder_visual.ts,
// ABILITY_MATERIAL_SOURCES), so a cast never links a program live. Bursts are
// immediate pooled particles on this pool's own clock (never the shared
// delayed-burst pool, whose slots are few and whose delays cap at 0.2 s), and
// the light is ONE pulse-pool slot (TrackedLightHost), never a new light.
// Pure math lives in magma_boulder_core.ts. Steady state allocates nothing.

const SLOTS = 3;
const MAX_FLIGHT_S = 3.3; // the projectile's ttl is 3 s: past this it is an orphan
const DRIP_EVERY_S = 0.07;
const RING_POINTS = 14;
const LIGHT_RELEASE_FADE = 0.15;
const SHORT_TAIL_S = 0.6;
const SPIN_X = 2.6; // radians per second of tumble
const SPIN_Y = 1.7;

interface BoulderSlot {
  active: boolean;
  gen: number;
  visual: MagmaBoulderVisual;
  sourceId: number;
  targetId: number;
  head: THREE.Vector3 | null;
  landed: boolean;
  since: number;
  age: number;
  progress: number;
  startDist: number;
  dripTimer: number;
  ringWave: number;
  plan: MagmaBurstPlan;
  light: number;
  impact: THREE.Vector3;
  lightAt: THREE.Vector3;
  rx: number;
  ry: number;
}

export interface MagmaBoulderHost {
  /** A pooled particle burst (AbilityVfxFx.burstAt), fired immediately. */
  burst: (
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    power: number,
    kind: ParticleBurstKind,
    duration?: number,
  ) => void;
  anchor: VfxAnchorResolver;
  groundY: (x: number, z: number) => number;
}

export class MagmaBoulders {
  private slots: BoulderSlot[] = [];
  private lights: TrackedLightHost | null = null;
  private readonly aim = new THREE.Vector3();
  private readonly lava: LavaLight = { intensity: 0, range: 0 };
  private disposed = false;

  constructor(
    private scene: THREE.Scene,
    private host: MagmaBoulderHost,
  ) {
    for (let i = 0; i < SLOTS; i++) {
      const visual = new MagmaBoulderVisual();
      visual.group.visible = false;
      tagVfxSubtree(visual.group);
      scene.add(visual.group);
      this.slots.push({
        active: false,
        gen: 0,
        visual,
        sourceId: 0,
        targetId: 0,
        head: null,
        landed: false,
        since: 0,
        age: 0,
        progress: 0,
        startDist: 0,
        dripTimer: 0,
        ringWave: 0,
        plan: { drips: true, fireRing: true },
        light: -1,
        impact: new THREE.Vector3(),
        lightAt: new THREE.Vector3(),
        rx: 0,
        ry: 0,
      });
    }
  }

  setLightHost(host: TrackedLightHost | null): void {
    this.lights = host;
  }

  /** Live boulders (a test and probe readout). */
  activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  /** Start a boulder riding `head` (the projectile's live position). */
  spawn(sourceId: number, targetId: number, head: THREE.Vector3, plan: MagmaBurstPlan): number {
    if (this.disposed) return -1;
    let index = -1;
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i].active) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      index = 0;
      for (let i = 1; i < this.slots.length; i++) {
        if (this.slots[i].age > this.slots[index].age) index = i;
      }
      this.release(this.slots[index]);
    }
    const s = this.slots[index];
    s.active = true;
    s.gen++;
    s.sourceId = sourceId;
    s.targetId = targetId;
    s.head = head;
    s.landed = false;
    s.since = 0;
    s.age = 0;
    s.progress = 0;
    s.dripTimer = 0;
    s.ringWave = 0;
    s.plan = plan;
    s.rx = (index * 1.7) % 6.28;
    s.ry = (index * 2.3) % 6.28;
    s.startDist = this.host.anchor(targetId, 0.5, this.aim) ? head.distanceTo(this.aim) : 0;
    s.light = this.lights ? this.lights.track() : -1;
    this.place(s);
    s.visual.group.visible = true;
    return index + s.gen * SLOTS;
  }

  private slotOf(handle: number): BoulderSlot | null {
    if (handle < 0) return null;
    const s = this.slots[handle % SLOTS];
    return s?.active && s.gen === Math.floor(handle / SLOTS) ? s : null;
  }

  /** The boulder arrived: it shatters, and the ring of fire starts its clock. */
  impact(handle: number, at: THREE.Vector3): boolean {
    const s = this.slotOf(handle);
    if (!s || s.landed) return false;
    s.landed = true;
    s.head = null;
    s.since = 0;
    s.progress = 1;
    s.ringWave = 0;
    s.impact.copy(at);
    s.visual.group.visible = false;
    // the shatter: dark crust shards and molten embers, sized to the boulder
    this.host.burst(at.x, at.y, at.z, 0x3a2418, 12, 1.15, 'debris', 1.1);
    this.host.burst(at.x, at.y, at.z, 0xff7a1a, 14, 0.9, 'embers', 0.8);
    // the flash stands back toward the caster so it lights the target's facing
    // side and the ground, not the inside of the struck mesh
    const from = this.host.anchor(s.sourceId, 0.5, this.aim);
    if (from) {
      const dx = from.x - at.x;
      const dz = from.z - at.z;
      const len = Math.hypot(dx, dz) || 1;
      const k = Math.min(1.2, len) / len;
      s.lightAt.set(at.x + dx * k, at.y + 0.4, at.z + dz * k);
    } else {
      s.lightAt.set(at.x, at.y + 0.4, at.z);
    }
    return true;
  }

  /** The projectile was dropped without arriving: the boulder just goes. */
  lost(handle: number): void {
    const s = this.slotOf(handle);
    if (s && !s.landed) this.release(s);
  }

  clear(): void {
    for (const s of this.slots) if (s.active) this.release(s);
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
    for (const s of this.slots) this.scene.remove(s.visual.group);
  }

  private release(s: BoulderSlot): void {
    s.active = false;
    s.head = null;
    s.visual.group.visible = false;
    if (this.lights && s.light >= 0) this.lights.releaseTracked(s.light, LIGHT_RELEASE_FADE);
    s.light = -1;
  }

  private radiusOf(s: BoulderSlot): number {
    return BOULDER_RADIUS * boulderScale(s.progress);
  }

  private place(s: BoulderSlot): void {
    const head = s.head;
    if (!head) return;
    s.visual.pose(head.x, head.y, head.z, this.radiusOf(s), crackGap(s.progress), s.rx, s.ry);
  }

  /** Advance every live boulder; call once per frame. */
  advance(dt: number, reducedMotion: boolean): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      if (!s.landed) {
        const head = s.head;
        if (!head || s.age > MAX_FLIGHT_S) {
          this.release(s);
          continue;
        }
        if (this.host.anchor(s.targetId, 0.5, this.aim))
          s.progress = flightProgress(s.startDist, head.distanceTo(this.aim));
        // reduced motion: no tumble, the rock simply grows along its path
        if (!reducedMotion) {
          s.rx += SPIN_X * dt;
          s.ry += SPIN_Y * dt;
        }
        this.place(s);
        if (s.plan.drips) this.drip(s, dt);
        // lit like the world's lava: its colour, level and reach (core)
        const lava = flightLavaLight(s.progress, this.lava);
        const gain = flightLightGain(reducedMotion ? 1 : Math.random());
        this.light(s, head.x, head.y, head.z, lava.intensity * gain, LAVA_LIGHT_COLOR, lava.range);
        continue;
      }
      s.since += dt;
      if (s.plan.fireRing) {
        while (s.ringWave < RING_WAVES && s.since >= ringWaveAt(s.ringWave)) {
          this.fireRingWave(s.impact, s.ringWave);
          s.ringWave++;
        }
      }
      const end = s.plan.fireRing ? FIRE_RING_S : SHORT_TAIL_S;
      if (s.since >= end) {
        this.release(s);
        continue;
      }
      const l = s.lightAt;
      const lava = impactLavaLight(s.since, this.lava);
      this.light(s, l.x, l.y, l.z, lava.intensity, LAVA_LIGHT_COLOR, lava.range);
    }
  }

  private drip(s: BoulderSlot, dt: number): void {
    const head = s.head;
    if (!head) return;
    // a bigger, more cracked rock sheds more lava
    s.dripTimer += dt * (0.4 + s.progress);
    while (s.dripTimer >= DRIP_EVERY_S) {
      s.dripTimer -= DRIP_EVERY_S;
      const r = this.radiusOf(s);
      this.host.burst(head.x, head.y - r * 0.8, head.z, 0xff7a1a, 1, 0.12, 'embers', 0.7);
    }
  }

  private fireRingWave(at: THREE.Vector3, wave: number): void {
    for (let i = 0; i < RING_POINTS; i++) {
      const a = (i / RING_POINTS) * Math.PI * 2 + wave * 0.2;
      const x = at.x + Math.cos(a) * FIRE_RING_RADIUS;
      const z = at.z + Math.sin(a) * FIRE_RING_RADIUS;
      this.host.burst(x, this.host.groundY(x, z) + 0.1, z, 0xff7a1a, 2, 0.32, 'embers', 0.55);
    }
  }

  private light(
    s: BoulderSlot,
    x: number,
    y: number,
    z: number,
    intensity: number,
    color: number,
    range: number,
  ): void {
    if (!this.lights) return;
    // An ordinary pulse may take the slot (the cast's release flash on the
    // one-light tier); claim one back as soon as one is free, so the rock keeps
    // lighting the world for the rest of its life. track() never steals.
    if (s.light < 0) s.light = this.lights.track();
    if (s.light < 0) return;
    if (!this.lights.setTracked(s.light, x, y, z, intensity, color, range)) s.light = -1;
  }

  /** Probe readouts: a live boulder's flight progress and current radius. */
  progressOf(handle: number): number {
    return this.slotOf(handle)?.progress ?? -1;
  }
  radiusOfHandle(handle: number): number {
    const s = this.slotOf(handle);
    return s ? this.radiusOf(s) : -1;
  }
  /** Whether any boulder group is visible in the scene (test readout). */
  visibleCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.visual.group.visible) n++;
    return n;
  }
}
