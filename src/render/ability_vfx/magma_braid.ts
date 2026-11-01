import * as THREE from 'three';
import type { TrackedLightHost } from '../light_pulses';
import type { VfxAnchorResolver } from '../vfx_anchor';
import type { ParticleBurstKind } from './fx';
import {
  BRAID_PTS,
  drainedFraction,
  FIRE_RING_RADIUS,
  FIRE_RING_S,
  fillStrand,
  flightLightScale,
  flightProgress,
  impactLightGain,
  MAGMA_STRANDS,
  type MagmaBurstPlan,
  strandWidthScale,
} from './magma_braid_core';
import type { AbilityVfxRibbons } from './ribbons';
import { flightLightGain } from './stepped_leader_core';

// The Magma Burst braid (the Shaman's lava_burst): two molten strands spiral
// from the caster's hand into the flying magma orb (the pooled Vfx projectile
// drawn with its molten-orb head), which swells as they pour into it while the
// strands thin and the light it casts grows; they drip lava as they go; when
// the orb lands they drain into the target and crumble, and a ring of fire
// burns at its feet. The archetype sequencer owns the rest of the impact (the
// flipbook, rings, debris, smoke, scorch) and fires it at the same arrival.
// Pure helix and envelope math lives in magma_braid_core.ts. This module owns
// no material: the strands draw through the shared ribbon program in its held
// pass, and the drips, flakes and flames are pooled Vfx particles. Its light is
// ONE pulse-pool slot (TrackedLightHost), never a new light. Steady state
// allocates nothing: every slot's buffers are built up front.

const SLOTS = 4;
const ROOT_FRAC = 0.62; // anchor fallback when the hand cannot be sampled
const DRIP_EVERY_S = 0.06;
const FLAKE_EVERY = 4; // one crumbling flake per this many strand points
const RING_WAVES = 4;
const RING_POINTS = 14;
/** When each ring-of-fire wave fires, seconds after the burst. */
function ringWaveAt(w: number): number {
  return 0.05 + (w * (FIRE_RING_S - 0.4)) / RING_WAVES;
}

const LIGHT_FLIGHT = 0xff8a3a;
const LIGHT_IMPACT = 0xffb060;
const FLIGHT_INTENSITY = 10;
const FLIGHT_RANGE = 10;
const IMPACT_INTENSITY = 24;
const IMPACT_RANGE = 15;
const LIGHT_RELEASE_FADE = 0.15;
const LIGHT_STANDOFF = 1.2; // yards back toward the caster from the impact
const MAX_FLIGHT_S = 3.3; // the projectile's ttl is 3 s: past this it is an orphan

// One braid lingers past its burst no longer than its ring of fire (or a
// short tail without one).
const SHORT_TAIL_S = 0.6;

interface StrandColors {
  glow: THREE.Color;
  body: THREE.Color;
  core: THREE.Color;
  width: number;
}
const STRAND_COLORS: StrandColors[] = MAGMA_STRANDS.map((s) => ({
  glow: new THREE.Color(s.glow),
  body: new THREE.Color(s.body),
  core: new THREE.Color(s.core),
  width: s.width,
}));

interface BraidSlot {
  active: boolean;
  gen: number;
  sourceId: number;
  targetId: number;
  head: THREE.Vector3 | null;
  landed: boolean;
  since: number;
  age: number;
  dripTimer: number;
  plan: MagmaBurstPlan;
  /** Distance to the target at launch, and the flight progress since. */
  startDist: number;
  progress: number;
  /** After impact: the next strand point to crumble, and the next ring wave. */
  flakeNext: number;
  ringWave: number;
  strands: Float32Array[];
  counts: number[];
  light: number;
  impact: THREE.Vector3;
  lightAt: THREE.Vector3;
}

// The ribbon pool and the particle cloud reach this module as CLOSURES, never
// as fields holding a pool: the cast-gate attribution walk
// (tests/cast_vfx_engine_family) credits a drawable to every pool whose fields
// reach it.
export interface MagmaBraidHost {
  /** One immediate strip (AbilityVfxRibbons.appendStrip, held pass only). */
  strip: AbilityVfxRibbons['appendStrip'];
  /** A pooled particle burst (AbilityVfxFx.burstAt), optionally delayed. */
  burst: (
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    power: number,
    kind: ParticleBurstKind,
    duration?: number,
    delay?: number,
  ) => void;
  anchor: VfxAnchorResolver;
  /** The caster's casting hand; false when it cannot be sampled. */
  hand?: (id: number, out: THREE.Vector3) => boolean;
  groundY: (x: number, z: number) => number;
}

export class MagmaBraids {
  private slots: BraidSlot[] = [];
  private lights: TrackedLightHost | null = null;
  private readonly pts: THREE.Vector3[] = [];
  private readonly root = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private reducedMotion = false;

  constructor(private host: MagmaBraidHost) {
    for (let i = 0; i < BRAID_PTS; i++) this.pts.push(new THREE.Vector3());
    for (let i = 0; i < SLOTS; i++) {
      this.slots.push({
        active: false,
        gen: 0,
        sourceId: 0,
        targetId: 0,
        head: null,
        landed: false,
        since: 0,
        age: 0,
        dripTimer: 0,
        plan: { strands: MAGMA_STRANDS.length, drips: true, fireRing: true },
        startDist: 0,
        progress: 0,
        flakeNext: 1,
        ringWave: 0,
        strands: MAGMA_STRANDS.map(() => new Float32Array(BRAID_PTS * 3)),
        counts: MAGMA_STRANDS.map(() => 0),
        light: -1,
        impact: new THREE.Vector3(),
        lightAt: new THREE.Vector3(),
      });
    }
  }

  setLightHost(host: TrackedLightHost | null): void {
    this.lights = host;
  }

  /** Live braids (a test and probe readout). */
  activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  /** Start a braid riding `head` (the projectile's live position). Returns a
   *  handle for impact()/lost(). */
  spawn(sourceId: number, targetId: number, head: THREE.Vector3, plan: MagmaBurstPlan): number {
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
    s.dripTimer = 0;
    s.plan = plan;
    s.progress = 0;
    s.startDist = this.host.anchor(targetId, 0.5, this.aim) ? head.distanceTo(this.aim) : 0;
    for (let k = 0; k < s.counts.length; k++) s.counts[k] = 0;
    s.light = this.lights ? this.lights.track() : -1;
    this.shape(s);
    return index + s.gen * SLOTS;
  }

  private slotOf(handle: number): BraidSlot | null {
    if (handle < 0) return null;
    const s = this.slots[handle % SLOTS];
    return s?.active && s.gen === Math.floor(handle / SLOTS) ? s : null;
  }

  /** The orb arrived: the strands drain and crumble, the ring of fire lights. */
  impact(handle: number, at: THREE.Vector3): boolean {
    const s = this.slotOf(handle);
    if (!s || s.landed) return false;
    s.landed = true;
    s.head = null;
    s.since = 0;
    s.progress = 1;
    s.impact.copy(at);
    // Shape the braid one last time so it ends ON the impact point.
    this.shapeTo(s, at.x, at.y, at.z);
    // The crumble and the ring of fire run on this braid's own clock in
    // advance() (never through the shared delayed-burst pool, whose slots are
    // few and whose delays are capped far below the ring's life).
    s.flakeNext = 1;
    s.ringWave = 0;
    // The flash stands back toward the caster so it lights the target's facing
    // side and the ground, not the inside of the struck mesh.
    const pts = s.strands[0];
    const n = s.counts[0];
    const bi = Math.max(0, n - 6) * 3;
    const dx = pts[bi] - at.x;
    const dz = pts[bi + 2] - at.z;
    const len = Math.hypot(dx, dz) || 1;
    const k = Math.min(LIGHT_STANDOFF, len) / len;
    s.lightAt.set(at.x + dx * k, at.y + 0.4, at.z + dz * k);
    return true;
  }

  /** The projectile was dropped without arriving: the braid just goes. */
  lost(handle: number): void {
    const s = this.slotOf(handle);
    if (s && !s.landed) this.release(s);
  }

  clear(): void {
    for (const s of this.slots) if (s.active) this.release(s);
  }

  private release(s: BraidSlot): void {
    s.active = false;
    s.head = null;
    if (this.lights && s.light >= 0) this.lights.releaseTracked(s.light, LIGHT_RELEASE_FADE);
    s.light = -1;
  }

  private origin(s: BraidSlot, out: THREE.Vector3): boolean {
    if (this.host.hand?.(s.sourceId, out)) return true;
    return this.host.anchor(s.sourceId, ROOT_FRAC, out) !== null;
  }

  private shape(s: BraidSlot): void {
    const head = s.head;
    if (head) this.shapeTo(s, head.x, head.y, head.z);
  }

  private shapeTo(s: BraidSlot, x: number, y: number, z: number): void {
    if (!this.origin(s, this.root)) return;
    for (let k = 0; k < s.plan.strands; k++) {
      s.counts[k] = fillStrand(
        s.strands[k],
        this.root.x,
        this.root.y,
        this.root.z,
        x,
        y,
        z,
        // reduced motion holds the twist still rather than spinning it
        this.reducedMotion ? 0 : s.age,
        MAGMA_STRANDS[k].phase,
      );
    }
  }

  /** Emit every fire-ring wave whose time has come (one per call at most per
   *  wave), immediately, from the braid's own impact clock. */
  private fireRingWaves(s: BraidSlot): void {
    while (s.ringWave < RING_WAVES && s.since >= ringWaveAt(s.ringWave)) {
      this.fireRingWave(s.impact, s.ringWave);
      s.ringWave++;
    }
  }

  private fireRingWave(at: THREE.Vector3, w: number): void {
    for (let i = 0; i < RING_POINTS; i++) {
      const a = (i / RING_POINTS) * Math.PI * 2 + w * 0.2;
      const x = at.x + Math.cos(a) * FIRE_RING_RADIUS;
      const z = at.z + Math.sin(a) * FIRE_RING_RADIUS;
      this.host.burst(x, this.host.groundY(x, z) + 0.1, z, 0xff7a1a, 2, 0.32, 'embers', 0.55);
    }
  }

  /** Crumble each strand as the drain passes over it, hand end first. */
  private crumble(s: BraidSlot): void {
    const drained = drainedFraction(s.since);
    const n = s.counts[0];
    if (n < 3) return;
    while (s.flakeNext < n - 1 && s.flakeNext / (n - 1) <= drained) {
      const i = s.flakeNext;
      for (let k = 0; k < s.plan.strands; k++) {
        const p = s.strands[k];
        this.host.burst(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], 0x5a2410, 1, 0.22, 'debris', 0.9);
      }
      s.flakeNext += FLAKE_EVERY;
    }
  }

  /** Advance every live braid; call once per frame before the ribbon pack. */
  advance(dt: number, reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      if (!s.landed) {
        const head = s.head;
        if (!head || s.age > MAX_FLIGHT_S) {
          this.release(s);
          continue;
        }
        this.shape(s);
        if (this.host.anchor(s.targetId, 0.5, this.aim))
          s.progress = flightProgress(s.startDist, head.distanceTo(this.aim));
        if (s.plan.drips) this.drip(s, dt);
        // the light grows with the orb: a bead's glow at the hand, a full
        // molten orb's light on the ground by the time it arrives
        const grow = flightLightScale(s.progress);
        const gain = flightLightGain(reducedMotion ? 1 : Math.random());
        this.light(
          s,
          head.x,
          head.y,
          head.z,
          FLIGHT_INTENSITY * gain * grow,
          LIGHT_FLIGHT,
          FLIGHT_RANGE * grow,
        );
        continue;
      }
      s.since += dt;
      this.crumble(s);
      if (s.plan.fireRing) this.fireRingWaves(s);
      const end = s.plan.fireRing ? FIRE_RING_S : SHORT_TAIL_S;
      if (s.since >= end) {
        this.release(s);
        continue;
      }
      const l = s.lightAt;
      this.light(
        s,
        l.x,
        l.y,
        l.z,
        IMPACT_INTENSITY * impactLightGain(s.since),
        LIGHT_IMPACT,
        IMPACT_RANGE,
      );
    }
  }

  private drip(s: BraidSlot, dt: number): void {
    s.dripTimer += dt;
    while (s.dripTimer >= DRIP_EVERY_S) {
      s.dripTimer -= DRIP_EVERY_S;
      const k = Math.floor(Math.random() * s.plan.strands);
      const n = s.counts[k];
      if (n < 8) continue;
      const i = 3 + Math.floor(Math.random() * (n - 6));
      const p = s.strands[k];
      this.host.burst(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], 0xff7a1a, 1, 0.12, 'embers', 0.7);
    }
  }

  private light(
    s: BraidSlot,
    x: number,
    y: number,
    z: number,
    intensity: number,
    color: number,
    range: number,
  ): void {
    if (!this.lights || s.light < 0) return;
    if (!this.lights.setTracked(s.light, x, y, z, intensity, color, range)) s.light = -1;
  }

  /** Emit every live braid's strips; valid only inside the ribbon pool's
   *  drawHeld callback (the pack is open there). LAYER first across every
   *  braid and strand (all cores, then all bodies, then all glows): the shared
   *  pool accepts or refuses a strip whole, so under vertex pressure the dim
   *  outer glow is what drops, never a strand's core. */
  draw(): void {
    const strip = this.host.strip;
    for (let layer = 0; layer < 3; layer++) {
      for (const s of this.slots) {
        if (!s.active) continue;
        const drained = s.landed ? drainedFraction(s.since) : 0;
        if (drained >= 1) continue;
        const fade = 1 - drained * 0.5;
        const thin = strandWidthScale(s.progress); // the strands empty into the orb
        for (let k = 0; k < s.plan.strands; k++) {
          const n = s.counts[k];
          const start = Math.floor(drained * (n - 1));
          const m = n - start;
          if (m < 2) continue;
          const src = s.strands[k];
          for (let i = 0; i < m; i++) {
            const j = (start + i) * 3;
            this.pts[i].set(src[j], src[j + 1], src[j + 2]);
          }
          const c = STRAND_COLORS[k];
          const w = c.width * thin;
          if (layer === 0) strip(this.pts, m, 0.12 * w, c.core, 1.6 * fade, 0.3);
          else if (layer === 1) strip(this.pts, m, 0.38 * w, c.body, 1.1 * fade, 0.3);
          else strip(this.pts, m, 0.85 * w, c.glow, 0.55 * fade, 0.3);
        }
      }
    }
  }

  /** Probe readout: a live braid's flight progress (0 at launch, 1 landed). */
  progressOf(handle: number): number {
    return this.slotOf(handle)?.progress ?? -1;
  }

  /** Probe readout: a live braid's first-strand end point. */
  tipOf(handle: number, out: THREE.Vector3): boolean {
    const s = this.slotOf(handle);
    if (!s || s.counts[0] === 0) return false;
    const j = (s.counts[0] - 1) * 3;
    out.set(s.strands[0][j], s.strands[0][j + 1], s.strands[0][j + 2]);
    return true;
  }

  /** Whether reduced motion was in force on the last advance (test readout). */
  get calm(): boolean {
    return this.reducedMotion;
  }
}
