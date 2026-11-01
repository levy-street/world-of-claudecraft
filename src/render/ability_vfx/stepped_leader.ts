import * as THREE from 'three';
import type { TrackedLightHost } from '../light_pulses';
import type { VfxAnchorResolver } from '../vfx_anchor';
import type { AbilityVfxRibbons } from './ribbons';
import {
  type ArcBoltLeaderPlan,
  BRANCH_CHANCE,
  BRANCH_PTS,
  createLeaderPath,
  flightLightGain,
  followHead,
  LEADER_MAX_BRANCHES,
  LEADER_MAX_PTS,
  LEADER_STEP_S,
  type LeaderPath,
  leaderPoint,
  planBranch,
  resetLeaderPath,
  type StrokeEnvelope,
  setLeaderOrigin,
  stepLeader,
  strokeEnvelopeAt,
  strokeLightGain,
  strokeLightPosition,
} from './stepped_leader_core';

// The Arc Bolt stepped leader (the Shaman's lightning_bolt): a dim, branching
// lightning leader that rides the pooled Vfx projectile from the caster's hand
// to the target, then a blinding return stroke, one restrike and a violet
// afterglow when it lands. Pure path and envelope math lives in
// stepped_leader_core.ts; this module owns the pooled slots, draws them as
// ribbon strips (no material of its own: the shared ribbon program, already
// prewarmed with the engine family) and moves ONE tracked point light from the
// pulse pool (no new light, so no program relink and no carrier change).
// Steady state allocates nothing: every slot's buffers are built up front.

const SLOTS = 4;
const JAG = 0.5; // kink size relative to one step's length
const BRANCH_LEN_MIN = 1.4; // yards
const BRANCH_LEN_MAX = 3.4;
const ROOT_FRAC = 0.62; // anchor fallback when the hand cannot be sampled

// Palette: white-hot core, electric blue glow, violet plasma aura.
const CORE = new THREE.Color(0xf2f8ff);
const BLUE = new THREE.Color(0x3e8dff);
const PLASMA = new THREE.Color(0xa56cff);
const PLASMA_PINK = new THREE.Color(0xd68cff);
const LIGHT_FLIGHT = 0x6fb4ff;
const LIGHT_STROKE = 0xdfeaff;
const LIGHT_AFTERGLOW = 0xa98bff;

// Light: the leader tip lights the ground it crosses; the stroke floods the
// impact. Ranges in yards, intensities in the pulse pool's units.
const FLIGHT_INTENSITY = 9;
const FLIGHT_RANGE = 10;
const STROKE_INTENSITY = 30;
const STROKE_RANGE = 18;
const LIGHT_RELEASE_FADE = 0.12;
const LIGHT_STANDOFF = 1.3; // yards back along the channel from the impact
const LIGHT_LIFT = 0.5;

interface LeaderSlot {
  active: boolean;
  gen: number;
  sourceId: number;
  targetId: number;
  head: THREE.Vector3 | null;
  landed: boolean;
  since: number;
  stepTimer: number;
  path: LeaderPath;
  branches: LeaderPath[];
  branchBorn: number[];
  branchCount: number;
  age: number;
  plan: ArcBoltLeaderPlan;
  restrike: boolean;
  light: number;
  impact: THREE.Vector3;
  lightAt: THREE.Vector3;
}

// The ribbon pool reaches this module as CLOSURES, never as a field holding
// the pool: the cast-gate attribution walk (tests/cast_vfx_engine_family)
// credits a drawable to every pool whose fields reach it.
export interface SteppedLeaderHost {
  /** One immediate strip (AbilityVfxRibbons.appendStrip, held pass only). */
  strip: AbilityVfxRibbons['appendStrip'];
  /** A short delayed crack between two points (AbilityVfxRibbons.spawnBoltPoints). */
  crack: AbilityVfxRibbons['spawnBoltPoints'];
  anchor: VfxAnchorResolver;
  /** The caster's casting hand; false when it cannot be sampled. */
  hand?: (id: number, out: THREE.Vector3) => boolean;
  /** Impact ring at the target (the pooled ring family). */
  ring: (x: number, y: number, z: number, radius: number, colorHex: number) => void;
}

export class SteppedLeaderBolts {
  private slots: LeaderSlot[] = [];
  private lights: TrackedLightHost | null = null;
  private readonly pts: THREE.Vector3[] = [];
  private readonly env: StrokeEnvelope = { stroke: 0, afterglow: 0, done: false };
  private readonly root = new THREE.Vector3();
  private reducedMotion = false;

  constructor(private host: SteppedLeaderHost) {
    for (let i = 0; i < Math.max(LEADER_MAX_PTS, BRANCH_PTS); i++)
      this.pts.push(new THREE.Vector3());
    for (let i = 0; i < SLOTS; i++) {
      const branches: LeaderPath[] = [];
      for (let b = 0; b < LEADER_MAX_BRANCHES; b++) branches.push(createLeaderPath(BRANCH_PTS));
      this.slots.push({
        active: false,
        gen: 0,
        sourceId: 0,
        targetId: 0,
        head: null,
        landed: false,
        since: 0,
        stepTimer: 0,
        path: createLeaderPath(LEADER_MAX_PTS),
        branches,
        branchBorn: new Array(LEADER_MAX_BRANCHES).fill(0),
        branchCount: 0,
        age: 0,
        plan: { scale: 1, branches: true, restrike: true },
        restrike: true,
        light: -1,
        impact: new THREE.Vector3(),
        lightAt: new THREE.Vector3(),
      });
    }
  }

  setLightHost(host: TrackedLightHost | null): void {
    this.lights = host;
  }

  /** Live bolts (a test and probe readout). */
  activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  /**
   * Start a leader riding `head` (the projectile's live position, moved in
   * place until it lands). Returns a handle for impact()/lost(), or -1.
   */
  spawn(sourceId: number, targetId: number, head: THREE.Vector3, plan: ArcBoltLeaderPlan): number {
    let index = this.slots.findIndex((s) => !s.active);
    if (index < 0) {
      // all busy: recycle the oldest
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
    s.stepTimer = 0;
    s.age = 0;
    s.branchCount = 0;
    s.plan = plan;
    s.restrike = plan.restrike;
    this.origin(s, this.root);
    resetLeaderPath(s.path, this.root.x, this.root.y, this.root.z);
    followHead(s.path, head.x, head.y, head.z);
    s.light = this.lights ? this.lights.track() : -1;
    return index + s.gen * SLOTS;
  }

  private slotOf(handle: number): LeaderSlot | null {
    if (handle < 0) return null;
    const s = this.slots[handle % SLOTS];
    return s?.active && s.gen === Math.floor(handle / SLOTS) ? s : null;
  }

  /** The projectile arrived: connect the channel and start the stroke. */
  impact(handle: number, at: THREE.Vector3): boolean {
    const s = this.slotOf(handle);
    if (!s || s.landed) return false;
    s.landed = true;
    s.head = null;
    s.since = 0;
    s.impact.copy(at);
    followHead(s.path, at.x, at.y, at.z);
    strokeLightPosition(s.path, LIGHT_STANDOFF, LIGHT_LIFT, s.lightAt);
    const r = 1.6 * s.plan.scale;
    this.host.ring(at.x, at.y, at.z, r, PLASMA.getHex());
    // a few small arcs crawling over the struck body
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      const b = a + 0.8 + Math.random() * 1.4;
      const rr = 0.45 * s.plan.scale;
      this.host.crack(
        at.x + Math.cos(a) * rr,
        at.y + (Math.random() - 0.3) * 0.8,
        at.z + Math.sin(a) * rr,
        at.x + Math.cos(b) * rr,
        at.y + (Math.random() - 0.3) * 0.8,
        at.z + Math.sin(b) * rr,
        BLUE.getHex(),
        0.16,
        0.035 * s.plan.scale,
        1.4,
        k * 0.09,
      );
    }
    return true;
  }

  /** The projectile was dropped without arriving: the leader just fades. */
  lost(handle: number): void {
    const s = this.slotOf(handle);
    if (s && !s.landed) this.release(s);
  }

  clear(): void {
    for (const s of this.slots) if (s.active) this.release(s);
  }

  private release(s: LeaderSlot): void {
    s.active = false;
    s.head = null;
    if (this.lights && s.light >= 0) this.lights.releaseTracked(s.light, LIGHT_RELEASE_FADE);
    s.light = -1;
  }

  private origin(s: LeaderSlot, out: THREE.Vector3): boolean {
    if (this.host.hand?.(s.sourceId, out)) return true;
    return this.host.anchor(s.sourceId, ROOT_FRAC, out) !== null;
  }

  /** Advance every live leader; call once per frame before the ribbon pack. */
  advance(dt: number, reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      if (this.origin(s, this.root)) setLeaderOrigin(s.path, this.root.x, this.root.y, this.root.z);
      if (!s.landed) {
        const head = s.head;
        if (!head) {
          this.release(s);
          continue;
        }
        s.stepTimer += dt;
        if (s.stepTimer >= LEADER_STEP_S) {
          s.stepTimer -= LEADER_STEP_S;
          const tipIndex = s.path.count - 1;
          if (stepLeader(s.path, head.x, head.y, head.z, JAG, Math.random)) {
            this.maybeBranch(s, tipIndex);
          }
        } else {
          followHead(s.path, head.x, head.y, head.z);
        }
        this.light(
          s,
          head.x,
          head.y,
          head.z,
          FLIGHT_INTENSITY * flightLightGain(Math.random()),
          LIGHT_FLIGHT,
          FLIGHT_RANGE,
        );
        continue;
      }
      s.since += dt;
      const restrike = s.restrike && !reducedMotion;
      strokeEnvelopeAt(s.since, restrike, this.env);
      if (this.env.done) {
        this.release(s);
        continue;
      }
      const gain = strokeLightGain(s.since, restrike);
      const color = this.env.stroke > 0 ? LIGHT_STROKE : LIGHT_AFTERGLOW;
      // Stand the flash off the struck body toward the channel, so it lights
      // the target's facing side and the ground, not the inside of the mesh.
      const l = s.lightAt;
      this.light(s, l.x, l.y, l.z, STROKE_INTENSITY * gain, color, STROKE_RANGE);
    }
  }

  private light(
    s: LeaderSlot,
    x: number,
    y: number,
    z: number,
    intensity: number,
    color: number,
    range: number,
  ): void {
    if (!this.lights || s.light < 0) return;
    const scale = s.plan.scale;
    if (!this.lights.setTracked(s.light, x, y, z, intensity * scale, color, range * scale)) {
      s.light = -1; // the slot went to a higher-priority pulse
    }
  }

  private maybeBranch(s: LeaderSlot, fromIndex: number): void {
    if (!s.plan.branches || s.branchCount >= LEADER_MAX_BRANCHES || fromIndex < 1) return;
    if (Math.random() >= BRANCH_CHANCE) return;
    const p = s.path.xyz;
    const i = fromIndex * 3;
    const j = (s.path.count - 1) * 3;
    const out = s.branches[s.branchCount];
    planBranch(
      out,
      p[i],
      p[i + 1],
      p[i + 2],
      p[j] - p[i],
      p[j + 1] - p[i + 1],
      p[j + 2] - p[i + 2],
      (BRANCH_LEN_MIN + Math.random() * (BRANCH_LEN_MAX - BRANCH_LEN_MIN)) * s.plan.scale,
      Math.random,
    );
    s.branchBorn[s.branchCount] = s.age;
    s.branchCount++;
  }

  private load(path: LeaderPath): number {
    for (let i = 0; i < path.count; i++) leaderPoint(path, i, this.pts[i]);
    return path.count;
  }

  /** Emit every live leader's strips; valid only inside the ribbon pool's
   *  drawHeld callback (the pack is open there). */
  draw(): void {
    const strip = this.host.strip;
    for (const s of this.slots) {
      if (!s.active) continue;
      const k = s.plan.scale;
      const fl = 0.75 + Math.random() * 0.25;
      if (!s.landed) {
        // the dim leader: faint, crackling, persistent
        const n = this.load(s.path);
        strip(this.pts, n, 0.6 * k, PLASMA, 0.4 * fl, 0.15);
        strip(this.pts, n, 0.24 * k, BLUE, 1.0 * fl, 0.15);
        strip(this.pts, n, 0.075 * k, CORE, 1.6 * fl, 0.15);
        for (let b = 0; b < s.branchCount; b++) {
          const fade = Math.max(0.35, 1 - (s.age - s.branchBorn[b]) * 1.2);
          const m = this.load(s.branches[b]);
          strip(this.pts, m, 0.15 * k, BLUE, 0.8 * fade * fl, 0.6);
          strip(this.pts, m, 0.045 * k, CORE, 1.2 * fade * fl, 0.6);
        }
        continue;
      }
      strokeEnvelopeAt(s.since, s.restrike && !this.reducedMotion, this.env);
      const n = this.load(s.path);
      if (this.env.stroke > 0) {
        // the return stroke: the whole carved path and its branches blaze
        const g = this.env.stroke;
        strip(this.pts, n, 1.1 * k, PLASMA, 0.8 * g, 0.1);
        strip(this.pts, n, 0.55 * k, BLUE, 2.2 * g, 0.1);
        strip(this.pts, n, 0.18 * k, CORE, 3.2 * g, 0.1);
        for (let b = 0; b < s.branchCount; b++) {
          const m = this.load(s.branches[b]);
          strip(this.pts, m, 0.24 * k, BLUE, 1.6 * g, 0.5);
          strip(this.pts, m, 0.075 * k, CORE, 2.4 * g, 0.5);
        }
      } else if (this.env.afterglow > 0) {
        const a = this.env.afterglow;
        strip(this.pts, n, 0.6 * k, PLASMA, 0.6 * a, 0.1);
        strip(this.pts, n, 0.12 * k, PLASMA_PINK, 1.0 * a, 0.1);
        for (let b = 0; b < s.branchCount; b++) {
          const m = this.load(s.branches[b]);
          strip(this.pts, m, 0.1 * k, PLASMA, 0.45 * a, 0.5);
        }
      }
    }
  }

  /** Probe readout: the newest live leader's head-of-path (tests and probes). */
  tipOf(handle: number, out: THREE.Vector3): boolean {
    const s = this.slotOf(handle);
    if (!s || s.path.count === 0) return false;
    leaderPoint(s.path, s.path.count - 1, out);
    return true;
  }
}
