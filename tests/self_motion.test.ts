import { describe, expect, it } from 'vitest';
import {
  BLOCK_EPISODE_MAX_MS,
  hasAuthoritativeSelfPositionDiscontinuity,
  SELF_MOTION_CAP_MAX_MS,
  SELF_MOTION_CAP_MIN_MS,
  SELF_MOTION_SNAP_DIST_SQ,
  type SelfMotionFrame,
  SelfMotionPredictor,
  updateSelfRenderFallback,
  type Vec3Like,
} from '../src/render/self_motion';
import { DUNGEON_FLOOR_Y } from '../src/sim/data';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import { type Entity, type MoveInput, RUN_SPEED } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Policy tests for the online display-only self extrapolator, driven against a
// REAL lagging authority: a live Sim plays the server (inputs arrive lagMs
// late, snapshots leave after each 20 Hz tick) and the predictor renders 60 fps
// frames against the mirrored self entity, exactly like main.ts online.

const SEED = 42;
const FRAME_MS = 1000 / 60;
const SNAP_MS = 50;

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
  ...over,
});

function teleport(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
}

interface FrameResult {
  pose: { x: number; y: number; z: number } | null;
  a: { x: number; y: number; z: number };
  /** The leash's own anchor: alpha clamped at 1, exactly as the predictor
   *  computes it internally, so stall containment is measured against the
   *  same point the clamp enforces. */
  ac: { x: number; y: number; z: number };
  /** True when this frame delivered a snapshot to the mirror. */
  delivered: boolean;
}

// The lagging-authority lab: server Sim + mirrored self + predictor.
class Lab {
  readonly srv: Sim;
  readonly self: Entity;
  readonly predictor: SelfMotionPredictor;
  private nowMs = 0;
  private lastSnapMs = 0;
  private sinceTickMs = 0;
  private localInput = mi();
  private inputLog: { atMs: number; input: MoveInput }[] = [];
  enabled = true;
  // Scripted broadcast stall: while positive, tick boundaries still advance
  // the server (it never stops simulating) but the mirror and lastSnapMs are
  // suppressed, so the client renders against a frozen snapshot exactly like
  // a real broadcast gap. Skipping n deliveries makes the wall-clock gap
  // between the last delivery and the resume delivery n plus 1 intervals.
  skipDeliveries = 0;

  // Snapshots produced during a frame, held back until the frame's tail: a
  // long render frame blocks the main thread, so the socket is only drained
  // AFTER the frame the messages arrived in (see the long-frame lane below).
  private pending: { x: number; y: number; z: number }[] = [];
  private readonly deliverAfter: boolean;
  private readonly deliveryMs: number;
  private readonly serverDeaf: boolean;
  /** While true the frame tail keeps the queue: a scripted delivery burst. */
  holdSnapshots = false;

  constructor(
    readonly lagMs: number,
    readonly frameMs = FRAME_MS,
    opts: {
      start?: { x: number; z: number };
      facing?: number;
      /** Drain the socket in the frame's TAIL instead of before the step. */
      deliverAfter?: boolean;
      /** Wall-clock spacing of deliveries, which is what the mirror's EWMA
       *  measures. Above the 50 ms tick cadence it models a coalescing link:
       *  the server still ticks at 20 Hz, the snapshots arrive in pairs. */
      deliveryMs?: number;
      /** The server never receives the local intent: worst-case divergence,
       *  the display predicting a run the authority never performs. */
      serverDeaf?: boolean;
    } = {},
  ) {
    this.deliverAfter = opts.deliverAfter ?? false;
    this.deliveryMs = opts.deliveryMs ?? SNAP_MS;
    this.serverDeaf = opts.serverDeaf ?? false;
    this.srv = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    // Same fixed-per-world token the live Sim closes over for its own movement
    // (Sim.riftCollisionToken); real only once a scenario calls srv.enterRift.
    this.predictor = new SelfMotionPredictor(SEED, this.srv.riftCollisionToken);
    this.srv.setPlayerLevel(60);
    // Default start re-pinned 2026-08 for the Eastbrook harbor move
    // (d19aa33f76, docs/design/eastbrook-revamp/site-plan.md): (0,-80) now
    // sits inside the relocated chapel's footprint, whose collider mangles
    // every default-start run. Use the collider-free open-field lane this
    // file already documents for the stall labs, so the default and explicit
    // lanes stay identical.
    const start = opts.start ?? { x: 0, z: -1000 };
    teleport(this.srv, start.x, start.z);
    this.facing = opts.facing ?? 0;
    this.srv.player.facing = this.facing; // run straight north (+z) by default
    const p = this.srv.player;
    this.self = { ...p, pos: { ...p.pos }, prevPos: { ...p.prevPos } };
    this.inputLog.push({ atMs: 0, input: mi() });
  }

  readonly facing: number;

  setInput(input: MoveInput): void {
    this.localInput = input;
    this.inputLog.push({ atMs: this.nowMs, input });
  }

  // What the server has received by time t (inputs travel lagMs).
  private serverInputAt(tMs: number): MoveInput {
    if (this.serverDeaf) return this.inputLog[0].input;
    let eff = this.inputLog[0].input;
    for (const e of this.inputLog) {
      if (e.atMs + this.lagMs <= tMs) eff = e.input;
    }
    return eff;
  }

  /** `drainFirst` models the other browser ordering: the socket is drained
   *  just BEFORE the rAF callback, so the long frame's step already sees the
   *  burst (fresh anchor, prevPos re-anchored at the drawn pose). */
  frame(frameMsOverride?: number, drainFirst = false): FrameResult {
    const frameMs = frameMsOverride ?? this.frameMs;
    this.nowMs += frameMs;
    this.sinceTickMs += frameMs;
    let delivered = false;
    while (this.sinceTickMs >= SNAP_MS) {
      this.sinceTickMs -= SNAP_MS;
      const meta = this.srv.players.get(this.srv.player.id);
      if (!meta) throw new Error('missing player meta');
      Object.assign(meta.moveInput, this.serverInputAt(this.nowMs));
      this.srv.tick();
      if (this.skipDeliveries > 0) {
        this.skipDeliveries--;
        continue;
      }
      if (this.deliverAfter) {
        this.pending.push({ ...this.srv.player.pos });
        continue;
      }
      // the 20 Hz snapshot: prev pose = last wire pose, pose = fresh server pose
      this.self.prevPos = { ...this.self.pos };
      this.self.pos = { ...this.srv.player.pos };
      this.self.dead = this.srv.player.dead;
      this.self.ghost = this.srv.player.ghost;
      this.lastSnapMs = this.nowMs;
      delivered = true;
    }
    // At the default cadence every produced tick is delivered as it appears;
    // a coalescing link (deliveryMs above the tick spacing) holds them back.
    const dueForDelivery =
      this.deliveryMs <= SNAP_MS || this.nowMs - this.lastSnapMs >= this.deliveryMs;
    if (drainFirst && this.pending.length > 0 && !this.holdSnapshots && dueForDelivery) {
      this.drainPending();
      delivered = true;
    }
    const alpha = Math.min(1.25, (this.nowMs - this.lastSnapMs) / this.deliveryMs);
    const frame: SelfMotionFrame = {
      enabled: this.enabled,
      moveInput: this.localInput,
      displayFacing: this.facing,
      echoMs: this.lagMs,
      jitterMs: 0,
      alpha,
      frameDt: frameMs / 1000,
      snapAgeMs: this.lastSnapMs > 0 ? this.nowMs - this.lastSnapMs : 0,
      snapIntervalMs: this.deliveryMs,
      // Read fresh every frame, exactly like main.ts reads net.riftFloor: null
      // outside a rift, the live descriptor once a rift scenario calls
      // srv.enterRift (see the "rift prediction" describe block below).
      riftFloor: this.srv.riftFloor,
    };
    const out = this.predictor.step(this.self, frame);
    const a = {
      x: this.self.prevPos.x + (this.self.pos.x - this.self.prevPos.x) * alpha,
      y: this.self.prevPos.y + (this.self.pos.y - this.self.prevPos.y) * alpha,
      z: this.self.prevPos.z + (this.self.pos.z - this.self.prevPos.z) * alpha,
    };
    const leashAlpha = Math.min(1, alpha);
    const ac = {
      x: this.self.prevPos.x + (this.self.pos.x - this.self.prevPos.x) * leashAlpha,
      y: this.self.prevPos.y + (this.self.pos.y - this.self.prevPos.y) * leashAlpha,
      z: this.self.prevPos.z + (this.self.pos.z - this.self.prevPos.z) * leashAlpha,
    };
    if (this.pending.length > 0 && !this.holdSnapshots && dueForDelivery) {
      this.drainPending();
      delivered = true;
    }
    return { pose: out ? { ...out } : null, a, ac, delivered };
  }

  // ClientWorld.applyWire re-anchors prevPos at the pose the renderer last
  // DREW (contAlpha, capped 1.25), not at the previous server pose, so a burst
  // of queued snapshots leaves prevPos at the drawn pose and pos at the newest
  // tick: the anchor then sweeps several ticks over one snapshot interval.
  private drainPending(): void {
    for (const pos of this.pending) {
      const contAlpha =
        this.lastSnapMs > 0 ? Math.min(1.25, (this.nowMs - this.lastSnapMs) / this.deliveryMs) : 1;
      this.self.prevPos = {
        x: this.self.prevPos.x + (this.self.pos.x - this.self.prevPos.x) * contAlpha,
        y: this.self.prevPos.y + (this.self.pos.y - this.self.prevPos.y) * contAlpha,
        z: this.self.prevPos.z + (this.self.pos.z - this.self.prevPos.z) * contAlpha,
      };
      this.self.pos = { ...pos };
      this.self.dead = this.srv.player.dead;
      this.self.ghost = this.srv.player.ghost;
      this.lastSnapMs = this.nowMs;
    }
    this.pending = [];
  }

  budget(): number {
    const cap = Math.min(SELF_MOTION_CAP_MAX_MS, Math.max(SELF_MOTION_CAP_MIN_MS, this.lagMs));
    return (RUN_SPEED * cap) / 1000 + 0.05;
  }
}

describe('SelfMotionPredictor', () => {
  it('recognizes only the local completed-unstuck event as an authoritative discontinuity', () => {
    const completed = {
      type: 'unstuck',
      phase: 'completed',
      pid: 7,
      reason: 'moved_to_graveyard',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 0, y: 0, z: 0, localX: 0, localZ: 0 },
      destination: { x: 0, y: 0, z: 4, localX: 0, localZ: 4 },
      duration: 10,
      distance: 4,
    } as const;
    expect(hasAuthoritativeSelfPositionDiscontinuity([completed], 7)).toBe(true);
    expect(hasAuthoritativeSelfPositionDiscontinuity([completed], 8)).toBe(false);
    expect(
      hasAuthoritativeSelfPositionDiscontinuity(
        [{ type: 'unstuck', phase: 'countdown', seconds: 4 }],
        7,
      ),
    ).toBe(false);
  });

  it('snaps both predictive and fallback poses on a sub-threshold authoritative recovery', () => {
    const sim = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    teleport(sim, 0, -40);
    const self = {
      ...sim.player,
      pos: { ...sim.player.pos },
      prevPos: { ...sim.player.prevPos },
    };
    const frame: SelfMotionFrame = {
      enabled: true,
      moveInput: mi({ forward: true }),
      displayFacing: 0,
      echoMs: 100,
      jitterMs: 0,
      alpha: 1,
      frameDt: 0.05,
      snapAgeMs: 0,
      snapIntervalMs: SNAP_MS,
      riftFloor: null,
    };
    const predictive = new SelfMotionPredictor(SEED);
    const ordinary = new SelfMotionPredictor(SEED);
    for (let i = 0; i < 2; i++) {
      predictive.step(self, frame);
      ordinary.step(self, frame);
    }

    // Four yards is deliberately below the renderer's normal six-yard snap
    // threshold. The explicit completed-unstuck discontinuity must still win.
    self.pos = { ...self.pos, z: self.pos.z + 4 };
    self.prevPos = { ...self.pos };
    const ordinaryPose = ordinary.step(self, frame);
    const snappedPose = predictive.step(self, frame, true);
    expect(Math.abs((ordinaryPose?.z ?? self.pos.z) - self.pos.z)).toBeGreaterThan(0.1);
    expect(snappedPose).toEqual(self.pos);
    expect(predictive.leadMs).toBe(0);

    const fallbackPose = { x: 0, y: 0, z: 0 };
    updateSelfRenderFallback(fallbackPose, 0, 0, 4, true, 1 / 60, true, false);
    expect(fallbackPose.z).toBeGreaterThan(0);
    expect(fallbackPose.z).toBeLessThan(4);
    fallbackPose.z = 0;
    updateSelfRenderFallback(fallbackPose, 0, 0, 4, true, 1 / 60, true, true);
    expect(fallbackPose).toEqual({ x: 0, y: 0, z: 4 });
  });

  it('moves the pose the moment intent is pressed, long before the server does', () => {
    const lab = new Lab(120);
    lab.frame();
    const before = lab.frame();
    lab.setInput(mi({ forward: true }));
    let moved = 0;
    for (let i = 0; i < 4; i++) {
      const r = lab.frame();
      if (r.pose) moved = r.pose.z - (before.pose?.z ?? 0);
    }
    expect(moved).toBeGreaterThan(0.2); // ~4 frames of RUN_SPEED
    // the server has not even received the input yet (120ms lag > 4 frames)
    expect(lab.srv.player.pos.z).toBeCloseTo(-1000, 3);
  });

  // Running into a blocker (the Grand Armoury's flat south face at z = -12) is
  // the case the predictor must NOT "correct": the
  // display stops at the wall a full echo before the server does, and that is
  // right. Stripping the lead against the lagging anchor teleports the avatar
  // backward by RUN_SPEED x echo on the contact frame. A normal forward step at
  // 60 fps is RUN_SPEED/60 = 0.117 yd, so any backward frame step of that order
  // reads as a snap; the leash + divergence servo alone keep it sub-centimeter.
  it.each([100, 200, 300])('does not snap the pose backward on contact at %ims echo', (lagMs) => {
    const lab = new Lab(lagMs, FRAME_MS, { start: { x: 17.5, z: -16 }, facing: 0 });
    lab.frame();
    lab.frame();
    lab.setInput(mi({ forward: true }));

    let prevZ: number | null = null;
    let worstBackwardStep = 0;
    for (let i = 0; i < 240; i++) {
      const r = lab.frame();
      if (!r.pose) throw new Error('predictor disabled unexpectedly');
      if (prevZ !== null) worstBackwardStep = Math.min(worstBackwardStep, r.pose.z - prevZ);
      prevZ = r.pose.z;
    }

    // The blocked-intent lead removal produced -0.30/-0.99/-1.69 yd here.
    expect(worstBackwardStep).toBeGreaterThan(-0.05);
    // and the pose still settles onto the wall the server stopped at.
    expect(prevZ ?? Number.NaN).toBeCloseTo(lab.srv.player.pos.z, 1);
  });

  it('never renders the pose through a blocker it is running into', () => {
    const lab = new Lab(200, FRAME_MS, { start: { x: 17.5, z: -16 }, facing: 0 });
    lab.frame();
    lab.frame();
    lab.setInput(mi({ forward: true }));

    let farthest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 240; i++) {
      const r = lab.frame();
      if (!r.pose) throw new Error('predictor disabled unexpectedly');
      farthest = Math.max(farthest, r.pose.z);
    }

    // The predictor runs the same swept static collision as the server, so it
    // cannot walk into the wall; only the divergence servo can nudge it a few
    // centimetres past the resting face.
    expect(farthest).toBeLessThan(lab.srv.player.pos.z + 0.1);
  });

  it('holds a settled pose while forward is held against a wall', () => {
    const lab = new Lab(120, FRAME_MS, { start: { x: 17.5, z: -14.2 }, facing: 0 });
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 60; i++) lab.frame(); // run in and settle

    let prev = lab.frame().pose;
    if (!prev) throw new Error('predictor disabled unexpectedly');
    let worstJitter = 0;
    for (let i = 0; i < 120; i++) {
      const r = lab.frame();
      if (!r.pose) throw new Error('predictor disabled unexpectedly');
      worstJitter = Math.max(worstJitter, Math.hypot(r.pose.x - prev.x, r.pose.z - prev.z));
      prev = r.pose;
    }

    expect(worstJitter).toBeLessThan(0.01);
  });

  it('keeps the horizontal error inside the latency leash for the whole run', () => {
    const lab = new Lab(100);
    lab.setInput(mi({ forward: true }));
    const budget = lab.budget();
    for (let i = 0; i < 60 * 3; i++) {
      const { pose, a } = lab.frame();
      if (!pose) throw new Error('predictor disabled unexpectedly');
      const err = Math.hypot(pose.x - a.x, pose.z - a.z);
      expect(err, `frame ${i}`).toBeLessThanOrEqual(budget + 1e-6);
    }
  });

  it('leads the authoritative pose in a steady run (latency actually hidden)', () => {
    const lab = new Lab(100);
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 60; i++) lab.frame(); // 1s warmup
    let leadSum = 0;
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const { pose, a } = lab.frame();
      if (pose) {
        leadSum += pose.z - a.z;
        n++;
      }
    }
    expect(leadSum / n).toBeGreaterThan(0.25); // meaningful fraction of the 0.7yd lag
  });

  it('caps the extrapolation on a terrible link', () => {
    const lab = new Lab(500);
    lab.setInput(mi({ forward: true }));
    const capBudget = (RUN_SPEED * SELF_MOTION_CAP_MAX_MS) / 1000 + 0.05;
    for (let i = 0; i < 60 * 2; i++) {
      const { pose, a } = lab.frame();
      if (!pose) throw new Error('predictor disabled unexpectedly');
      expect(Math.hypot(pose.x - a.x, pose.z - a.z), `frame ${i}`).toBeLessThanOrEqual(
        capBudget + 1e-6,
      );
    }
  });

  it('stops instantly and settles onto the server pose with no backslide', () => {
    const lab = new Lab(100);
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 60 * 2; i++) lab.frame();
    lab.setInput(mi());
    let prevZ = -Infinity;
    let last: FrameResult | null = null;
    for (let i = 0; i < 60 * 1.5; i++) {
      const r = lab.frame();
      if (r.pose) {
        expect(r.pose.z, `frame ${i} backslide`).toBeGreaterThanOrEqual(prevZ - 0.005);
        prevZ = r.pose.z;
        last = r;
      }
    }
    if (!last?.pose) throw new Error('no pose');
    // converged onto the (now stationary) authoritative pose
    expect(Math.abs(last.pose.z - last.a.z)).toBeLessThan(0.25);
  });

  it('snaps to the authoritative pose on a server teleport', () => {
    const lab = new Lab(100);
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 30; i++) lab.frame();
    teleport(lab.srv, 0, 40); // 80yd jump, way past the 6yd snap rule
    let r: FrameResult | null = null;
    for (let i = 0; i < 4; i++) r = lab.frame(); // let a snapshot deliver it
    if (!r?.pose) throw new Error('no pose');
    expect(Math.abs(r.pose.z - r.a.z)).toBeLessThan(2);
  });

  it('returns null when disabled and re-adopts cleanly on re-enable', () => {
    const lab = new Lab(100);
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 30; i++) lab.frame();
    lab.enabled = false;
    expect(lab.frame().pose).toBeNull();
    lab.enabled = true;
    const r = lab.frame();
    if (!r.pose) throw new Error('no pose after re-enable');
    expect(Math.hypot(r.pose.z - r.a.z, r.pose.x - r.a.x)).toBeLessThan(0.5);
  });

  it('keeps corrections gentle under load-hitch frame times (world-entry low fps)', () => {
    // 8 fps frames like the first seconds after entering the world: the
    // per-frame display movement must stay near the legitimate run distance;
    // an unclamped correction blend would eat ~95% of the divergence in one
    // frame and read as a jerk.
    const lab = new Lab(100, 125);
    lab.setInput(mi({ forward: true }));
    let prev: number | null = null;
    for (let i = 0; i < 40; i++) {
      const { pose } = lab.frame();
      if (!pose) throw new Error('predictor disabled unexpectedly');
      if (prev !== null) {
        const step = pose.z - prev;
        expect(step, `frame ${i}`).toBeLessThanOrEqual(1.5); // ~run distance + bounded correction
        expect(step, `frame ${i}`).toBeGreaterThanOrEqual(-0.01); // never backward
      }
      prev = pose.z;
    }
  });

  it('never pumps forward/backward when the RTT exceeds the lead cap (netem case)', () => {
    // 280ms RTT > SELF_MOTION_CAP_MAX_MS: the divergence measurement must stay
    // aligned to the TRUE delay and the servo gain bounded, or the correction
    // chases its own delayed history and pumps the pose back and forth.
    const lab = new Lab(280);
    lab.setInput(mi({ forward: true }));
    let prev: number | null = null;
    for (let i = 0; i < 60 * 3; i++) {
      const { pose } = lab.frame();
      if (!pose) throw new Error('predictor disabled unexpectedly');
      if (prev !== null) expect(pose.z - prev, `run frame ${i}`).toBeGreaterThanOrEqual(-0.005);
      prev = pose.z;
    }
    lab.setInput(mi());
    // per-frame: nothing beyond sub-centimeter noise; cumulative: no slow
    // sawtooth sneaking under a per-frame threshold
    let backslide = 0;
    for (let i = 0; i < 60 * 2; i++) {
      const r = lab.frame();
      if (r.pose && prev !== null) {
        const step = r.pose.z - prev;
        expect(step, `release frame ${i}`).toBeGreaterThanOrEqual(-0.01);
        if (step < 0) backslide += -step;
        prev = r.pose.z;
      }
    }
    expect(backslide).toBeLessThan(0.05);
  });

  it('sustains the full run speed on a high-RTT link (no underwater feel)', () => {
    const lab = new Lab(280);
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 60; i++) lab.frame(); // 1s: past the start transient
    const first = lab.frame().pose;
    if (!first) throw new Error('predictor disabled unexpectedly');
    let last = first;
    for (let i = 0; i < 60 * 2; i++) {
      const r = lab.frame();
      if (r.pose) last = r.pose;
    }
    const avgSpeed = (last.z - first.z) / 2; // yd/s over the 2s window
    expect(avgSpeed).toBeGreaterThan(6.5); // RUN_SPEED is 7
  });

  // Phase 06, packet-0-instruments R11: the 100 to 500 ms broadcast-gap
  // regime. The server keeps ticking while the mirror and lastSnapMs are
  // suppressed, then one resume delivery re-anchors interpolation, exactly
  // like a real broadcast stall: the rAF loop never stops, snapshots do.
  // During the stall the leash freezes the display at the latency-scaled
  // budget from the frozen anchor, the intended anti-divergence behavior; on
  // resume the anchor sweeps to the fresh pose over one snapshot interval and
  // the display glides after it with no snap. The straight-north lane doubles
  // as the yaw proxy: yaw is never server-gated, so the predictor must not
  // touch it, and any yaw contamination shows up as lateral drift.
  describe('scripted broadcast stalls', () => {
    const ECHO_MS = 150; // mid-band echo: cap 150 ms, leash budget 1.10 yd
    const WARMUP_FRAMES = 120; // 2 s of held run, settled on the steady lead
    const RESUME_WINDOW_FRAMES = 15; // the resume delivery + the anchor sweep
    const RECOVERY_SKIP_FRAMES = 60; // about 1 s after resume
    const RECOVERY_SAMPLE_FRAMES = 30;

    interface StallTrace {
      budget: number;
      stallErrs: number[];
      resumeSteps: number[];
      resumeErrs: number[];
      recoveryErrs: number[];
      recoveryLeads: number[];
      /** Mean lead of an unstalled control run over the same final window:
       *  the steady band the stalled run must have rejoined. */
      controlMeanLead: number;
      worstLateral: number;
      serverLateral: number;
      /** Most negative per-frame step over the WHOLE run, not just the resume
       *  window: the sub-tick interpolation must never run backward, including
       *  on a frame where the leash clips more than the kernel step it just
       *  took (which is what the prevPos collapse in step() prevents). */
      worstStep: number;
    }

    function runStall(gapMs: number): StallTrace {
      // Long stalls cover enough northward ground to reach the authored town
      // wall from the default start, which clamps the server and hides the
      // snap the 2500 ms scenario exists to prove. Run the stall lab in the
      // collider-free open-field lane so these pins stay world-independent.
      const lab = new Lab(ECHO_MS, FRAME_MS, { start: { x: 0, z: -1000 } });
      const budget = lab.budget();
      lab.setInput(mi({ forward: true }));
      let lastZ = Number.NaN;
      let worstLateral = 0;
      let serverLateral = 0;
      let worstStep = 0;
      const errOf = (r: FrameResult): number => {
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        return Math.hypot(r.pose.x - r.ac.x, r.pose.z - r.ac.z);
      };
      const advance = (r: FrameResult): number => {
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        worstLateral = Math.max(worstLateral, Math.abs(r.pose.x));
        serverLateral = Math.max(serverLateral, Math.abs(lab.srv.player.pos.x));
        const step = r.pose.z - lastZ;
        if (!Number.isNaN(step)) worstStep = Math.min(worstStep, step);
        lastZ = r.pose.z;
        return step;
      };
      for (let i = 0; i < WARMUP_FRAMES; i++) advance(lab.frame());
      lab.skipDeliveries = gapMs / SNAP_MS - 1;
      const stallErrs: number[] = [];
      const resumeSteps: number[] = [];
      const resumeErrs: number[] = [];
      let resumed = false;
      for (let guard = 0; guard < 400 && !resumed; guard++) {
        const r = lab.frame();
        if (r.delivered) {
          resumed = true;
          resumeSteps.push(advance(r));
          resumeErrs.push(errOf(r));
          break;
        }
        advance(r);
        stallErrs.push(errOf(r));
      }
      if (!resumed) throw new Error('stall never resumed');
      for (let i = 1; i < RESUME_WINDOW_FRAMES; i++) {
        const r = lab.frame();
        resumeSteps.push(advance(r));
        resumeErrs.push(errOf(r));
      }
      for (let i = RESUME_WINDOW_FRAMES; i < RECOVERY_SKIP_FRAMES; i++) advance(lab.frame());
      const recoveryErrs: number[] = [];
      const recoveryLeads: number[] = [];
      for (let i = 0; i < RECOVERY_SAMPLE_FRAMES; i++) {
        const r = lab.frame();
        advance(r);
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        recoveryErrs.push(errOf(r));
        recoveryLeads.push(r.pose.z - r.ac.z);
      }
      // The steady band, measured rather than assumed: an identical run with
      // no stall, sampled over the same final window. The stalled run must
      // land back on this band, which also proves recovery completed inside
      // the skip window rather than still converging through the sample.
      const postWarmupFrames = stallErrs.length + 1 + (RESUME_WINDOW_FRAMES - 1);
      const totalFrames =
        WARMUP_FRAMES +
        postWarmupFrames +
        (RECOVERY_SKIP_FRAMES - RESUME_WINDOW_FRAMES) +
        RECOVERY_SAMPLE_FRAMES;
      const control = new Lab(ECHO_MS);
      control.setInput(mi({ forward: true }));
      const controlLeads: number[] = [];
      for (let i = 0; i < totalFrames; i++) {
        const r = control.frame();
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        if (i >= totalFrames - RECOVERY_SAMPLE_FRAMES) controlLeads.push(r.pose.z - r.ac.z);
      }
      const controlMeanLead = controlLeads.reduce((s, v) => s + v, 0) / controlLeads.length;
      return {
        budget,
        stallErrs,
        resumeSteps,
        resumeErrs,
        recoveryErrs,
        recoveryLeads,
        controlMeanLead,
        worstLateral,
        serverLateral,
        worstStep,
      };
    }

    // Per-arm literals are measured on this deterministic rig, with headroom:
    // saturation floor: gaps of 250 ms and up pin the leash boundary itself
    //   (observed 1.098 on a 1.100 budget); the 100 ms arm only NEARS it
    //   (observed 0.997), because the anchor keeps sweeping the last
    //   delivered segment for the first 50 ms of a one-interval gap.
    // step ceiling: observed resume maxima 0.148 / 0.205 / 0.274 / 0.498 yd,
    //   each far below the one-frame gap replay a snap would show
    //   (0.7 / 1.75 / 2.8 / 3.5 yd) and below the 6 yd reset rule.
    it.each([
      [100, 0.95, 0.25],
      [250, 1.05, 0.35],
      [400, 1.05, 0.45],
      [500, 1.05, 0.75],
    ])(
      'freezes on the leash and recovers across a %ims broadcast stall',
      (gapMs, satFloorYd, maxStepYd) => {
        const run = runStall(gapMs);
        // a: leash containment on every stall frame
        run.stallErrs.forEach((err, i) => {
          expect(err, `stall frame ${i}`).toBeLessThanOrEqual(run.budget + 1e-6);
        });
        // b: the stall drives the error into the leash boundary, so the
        // containment above is a boundary claim, not slack
        expect(Math.max(...run.stallErrs)).toBeGreaterThanOrEqual(satFloorYd);
        // c: no backward step on resume. The worst observed value is a single
        // 2.3 cm servo-settle frame at 250 ms; the artifact class this pins
        // against, lead stripping and the prevPos-clamp sawtooth, is 10x up.
        expect(Math.min(...run.resumeSteps)).toBeGreaterThanOrEqual(-0.03);
        const backslide = run.resumeSteps.reduce((s, v) => s + (v < 0 ? -v : 0), 0);
        expect(backslide).toBeLessThan(0.05);
        // d: bounded forward step on resume: the anchor sweep spreads the gap
        // distance over one snapshot interval and the display glides after it
        const maxStep = Math.max(...run.resumeSteps);
        expect(maxStep).toBeLessThanOrEqual(maxStepYd);
        expect(maxStep).toBeLessThan(Math.sqrt(SELF_MOTION_SNAP_DIST_SQ));
        // e: back in the steady lead band within about a second: contained,
        // meaningfully leading, and equal to the unstalled control's band
        run.recoveryErrs.forEach((err, i) => {
          expect(err, `recovery frame ${i}`).toBeLessThanOrEqual(run.budget + 1e-6);
        });
        const meanLead = run.recoveryLeads.reduce((s, v) => s + v, 0) / run.recoveryLeads.length;
        expect(meanLead).toBeGreaterThanOrEqual(0.45);
        expect(Math.abs(meanLead - run.controlMeanLead)).toBeLessThanOrEqual(0.05);
        // f: zero lateral drift on the straight lane, the yaw-untouched proxy.
        // The server assert proves the lane itself is straight, so the display
        // assert is a real claim about the predictor and not about terrain.
        expect(run.serverLateral).toBeLessThanOrEqual(1e-9);
        expect(run.worstLateral).toBeLessThanOrEqual(1e-9);
        // g: not one backward frame anywhere in the run, stall and recovery
        // included, not just the resume window sampled above
        expect(run.worstStep).toBeGreaterThanOrEqual(-0.03);
      },
    );

    it('snap-resets deliberately when the resume anchor outruns the 6 yd rule', () => {
      // 2500 ms of missed broadcasts: the resume sweep moves the anchor about
      // 5.8 yd per frame, so the pre-clamp distance check exceeds the 6 yd
      // rule and the predictor re-adopts outright, the same deliberate reset
      // the teleport arm exercises. This is the boundary pin for the regime
      // above: at 500 ms and below the reset must never fire.
      const run = runStall(2500);
      // the stall itself is still just the leash freeze
      run.stallErrs.forEach((err, i) => {
        expect(err, `stall frame ${i}`).toBeLessThanOrEqual(run.budget + 1e-6);
      });
      expect(Math.max(...run.stallErrs)).toBeGreaterThanOrEqual(1.05);
      // The detection threshold below is the SAME constant production uses to
      // DECIDE the reset, so a moderate drift of the rule (36 to 64) would
      // move detection and decision together and stay invisible; this literal
      // pins the 6 yd rule itself so that drift is caught.
      expect(SELF_MOTION_SNAP_DIST_SQ).toBe(36);
      // the reset is a single deliberate discontinuity: exactly one frame
      // jumps farther than the 6 yd rule, and it lands ON the fresh anchor
      const snapDist = Math.sqrt(SELF_MOTION_SNAP_DIST_SQ);
      const snapIdx = run.resumeSteps.findIndex((s) => s > snapDist);
      expect(run.resumeSteps.filter((s) => s > snapDist)).toHaveLength(1);
      expect(run.resumeErrs[snapIdx]).toBeLessThan(0.2);
      // and the predictor is re-locked afterwards
      run.recoveryErrs.forEach((err, i) => {
        expect(err, `recovery frame ${i}`).toBeLessThanOrEqual(run.budget + 1e-6);
      });
      expect(run.worstLateral).toBeLessThanOrEqual(1e-9);
      // The resume sweep here clips MORE than the kernel step the frame took,
      // which leaves prevPos ahead of the clamped pos; without the collapse in
      // step() the sub-tick interpolation walks the display backward on that
      // frame. Measured at about -0.05 yd with the collapse removed.
      expect(run.worstStep).toBeGreaterThanOrEqual(-0.03);
    });
  });

  // A long render frame (a shader link, a GC pause, a texture decode) blocks
  // the main thread, so the snapshots that arrive DURING it are only applied
  // after it: inside the frame the anchor is frozen, and right after it a
  // burst of queued snapshots re-anchors prevPos at the drawn pose and sweeps
  // the anchor several ticks across one snapshot interval. The display must
  // keep running at its steady speed through both halves: the kernel is
  // trusted while the anchor is stale (long frame) and while the burst sweep
  // settles, or the avatar stalls inside the long frame and rushes after it.
  describe('long render frames', () => {
    const SPEED_MIN = 5.0; // yd/s: RUN_SPEED is 7
    const SPEED_MAX = 9.0;
    const AFTER_FRAMES = 12;
    const WARMUP_FRAMES = 120; // 2 s, settled on the steady lead
    const HOLD_FRAMES = 9; // ~150 ms: three snapshots queue up
    const BURST_FRAMES = 30; // the burst arm repays a real network gap, see below
    // Long enough to outlast BLOCK_EPISODE_MAX_MS with frames to spare, so the
    // cap expiring is observable inside the gap rather than at its edge.
    const GAP_MS = 700;
    // The sweep replays the whole gap over one snapshot interval, and the
    // leash then walks its 4.7 yd loan back to the honest budget, which costs
    // one short re-phasing trim around the fortieth frame. Long enough that
    // the tail is settled run speed again.
    const GAP_RECOVERY_FRAMES = 60;

    interface Step {
      label: string;
      dtMs: number;
      /** Horizontal display speed over this frame, yd/s. */
      speed: number;
      /** Signed advance along the run direction (+z), yd. */
      forward: number;
      /** Horizontal distance to the leash's own anchor (alpha capped at 1). */
      err: number;
    }

    const trace = (steps: Step[]): string =>
      `\n${steps
        .map(
          (s) =>
            `  ${s.label.padStart(6)} dt=${s.dtMs.toFixed(1).padStart(6)}ms ` +
            `v=${s.speed.toFixed(2).padStart(6)} yd/s fwd=${s.forward.toFixed(3)} ` +
            `err=${s.err.toFixed(3)}`,
        )
        .join('\n')}`;

    // The collider-free open-field lane (same reason as the stall lane above:
    // the authored town wall would clamp the server and hide the artifact).
    function warmLab(lagMs: number): Lab {
      const lab = new Lab(lagMs, FRAME_MS, { start: { x: 0, z: -1000 }, deliverAfter: true });
      lab.setInput(mi({ forward: true }));
      for (let i = 0; i < WARMUP_FRAMES; i++) lab.frame();
      return lab;
    }

    // Runs `count` frames of `dtMs` and returns one Step per frame, each
    // measured against the pose the previous frame drew.
    function recorder(
      lab: Lab,
    ): (label: string, dtMs: number, count?: number, drainFirst?: boolean) => Step[] {
      let prev = { x: Number.NaN, z: Number.NaN };
      return (label, dtMs, count = 1, drainFirst = false): Step[] => {
        const out: Step[] = [];
        for (let i = 0; i < count; i++) {
          const r = lab.frame(dtMs, drainFirst);
          if (!r.pose) throw new Error('predictor disabled unexpectedly');
          const pose = { x: r.pose.x, z: r.pose.z };
          if (!Number.isNaN(prev.x)) {
            out.push({
              label: count > 1 ? `${label}${i + 1}` : label,
              dtMs,
              speed: Math.hypot(pose.x - prev.x, pose.z - prev.z) / (dtMs / 1000),
              forward: pose.z - prev.z,
              err: Math.hypot(pose.x - r.ac.x, pose.z - r.ac.z),
            });
          }
          prev = pose;
        }
        return out;
      };
    }

    function runLongFrame(lagMs: number, longMs: number): Step[] {
      const lab = warmLab(lagMs);
      const record = recorder(lab);
      record('warm', FRAME_MS); // seeds the previous pose, produces no step
      return [...record('long', longMs), ...record('+', FRAME_MS, AFTER_FRAMES)];
    }

    // The real-browser ordering, measured with injected blocks: after the long
    // frame Chrome runs several SHORT catch-up frames (8 to 17 ms) before it
    // drains the socket, so the anchor stays frozen for 4 to 6 more frames and
    // the queued snapshots land as one burst only then.
    function runWithheldBurst(
      lagMs: number,
      longMs: number,
      heldFrames: number,
      heldMs: number,
    ): Step[] {
      const lab = warmLab(lagMs);
      const record = recorder(lab);
      record('warm', FRAME_MS);
      lab.holdSnapshots = true;
      const blocked = [...record('long', longMs), ...record('held', heldMs, heldFrames)];
      lab.holdSnapshots = false;
      // the next frame's tail drains the whole queue at once
      return [...blocked, ...record('+', FRAME_MS, AFTER_FRAMES + 1)];
    }

    // The other browser ordering, also measured: the socket is drained just
    // before the long frame's rAF callback, so the anchor is FRESH but
    // ClientWorld has re-anchored prevPos at the drawn pose with pos several
    // ticks ahead. Nothing looks stale, and the leash clips the frame's own
    // multi-step advance unless the hitch itself is recognised.
    function runDeliverBefore(lagMs: number, longMs: number): Step[] {
      const lab = warmLab(lagMs);
      const record = recorder(lab);
      record('warm', FRAME_MS);
      const long = record('long', longMs, 1, true);
      return [...long, ...record('+', FRAME_MS, AFTER_FRAMES)];
    }

    function runBurst(lagMs: number): Step[] {
      const lab = warmLab(lagMs);
      const record = recorder(lab);
      record('warm', FRAME_MS);
      lab.holdSnapshots = true;
      record('hold', FRAME_MS, HOLD_FRAMES);
      lab.holdSnapshots = false;
      const burst = record('burst', FRAME_MS); // its tail applies all three at once
      return [...burst, ...record('+', FRAME_MS, BURST_FRAMES)];
    }

    const expectSteadyBand = (steps: Step[], maxSpeed = SPEED_MAX): void => {
      const report = trace(steps);
      for (const step of steps) {
        expect(step.speed, `${step.label}${report}`).toBeGreaterThanOrEqual(SPEED_MIN);
        expect(step.speed, `${step.label}${report}`).toBeLessThanOrEqual(maxSpeed);
        expect(step.forward, `${step.label}${report}`).toBeGreaterThanOrEqual(0);
      }
    };

    // The 250 ms rows carry a wider ceiling for a cause outside this fix: 250
    // ms IS the main-loop frame clamp, so the kernel accumulator drops the
    // remainder it was already holding and the display owes the server up to
    // one tick of ground. The servo repays that at a bounded rate over the
    // following frames (observed peak 9.67 yd/s); the artifact this test pins
    // against ran at 13.8 and stalled to 1.3 first.
    it.each([
      [40, 100, SPEED_MAX],
      [40, 156, SPEED_MAX],
      [40, 250, 10.0],
      [120, 100, SPEED_MAX],
      [120, 156, SPEED_MAX],
      [120, 250, 10.0],
    ])(
      'holds the steady display speed across a %ims-echo, %ims render frame',
      (lagMs, longMs, maxSpeed) => {
        expectSteadyBand(runLongFrame(lagMs, longMs), maxSpeed);
      },
    );

    it.each([
      [40, 100, 4, 10],
      [40, 156, 4, 10],
      [120, 100, 4, 10],
      [120, 156, 4, 10],
      [40, 100, 6, FRAME_MS],
      [40, 156, 6, FRAME_MS],
      [120, 100, 6, FRAME_MS],
      [120, 156, 6, FRAME_MS],
    ])(
      'holds the steady display speed at %ims echo across a %ims frame plus %i withheld frames of %ims',
      (lagMs, longMs, heldFrames, heldMs) => {
        expectSteadyBand(runWithheldBurst(lagMs, longMs, heldFrames, heldMs));
      },
    );

    it.each([
      [40, 100],
      [40, 156],
      [120, 100],
      [120, 156],
    ])(
      'holds the steady display speed at %ims echo across a %ims frame whose burst lands first',
      (lagMs, longMs) => {
        expectSteadyBand(runDeliverBefore(lagMs, longMs));
      },
    );

    // The isolation term in the hitch trigger, pinned from the regime it
    // protects: at a steady 8 fps nothing is hitching, no episode may open,
    // and the servo must keep correcting every frame. Sibling of 'keeps
    // corrections gentle under load-hitch frame times', which pins the same
    // regime from the smoothness side.
    it('keeps the divergence servo alive at steady low fps', () => {
      const lab = new Lab(100, 125, { start: { x: 0, z: -1000 } });
      lab.setInput(mi({ forward: true }));
      for (let i = 0; i < 20; i++) lab.frame();
      lab.srv.player.pos.x += 1; // a server-side sidestep, well under the 6 yd snap
      const errs: number[] = [];
      for (let i = 0; i < 8; i++) {
        const r = lab.frame();
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        errs.push(Math.abs(r.pose.x - r.ac.x));
      }
      const report = `\n  lateral error by frame: ${errs.map((e) => e.toFixed(3)).join(' ')}`;
      // Strictly closing every frame is the decisive part: a held servo would
      // park the error on the leash boundary (0.75 yd here) instead. The rate
      // is the module's own bound, not this test's choice: at a 100 ms echo the
      // blend runs at min(12, 500/measureMs) with its dt capped at 1/30, about
      // 15% of the gap per frame, so a 1 yd sidestep is two thirds gone by the
      // sixth frame and under 0.15 yd by the eighth.
      errs.forEach((err, i) => {
        if (i > 0) expect(err, `frame ${i}${report}`).toBeLessThan(errs[i - 1]);
      });
      expect(errs[5], report).toBeLessThan(0.25);
      expect(errs[7], report).toBeLessThan(0.15);
    });

    // The declared worst case, and the one the broadcast-stall arms cannot
    // reach: an isolated hitch opens an episode and THEN the network gaps for
    // half a second, so the lending mechanism meets a genuine stall already
    // switched on. The episode cap is what bounds it.
    it.each([
      [40, 156],
      [120, 156],
    ])(
      'caps the episode when a %ims-echo hitch of %ims is followed by a 500 ms gap',
      (lagMs, longMs) => {
        const lab = warmLab(lagMs);
        const record = recorder(lab);
        record('warm', FRAME_MS);
        lab.holdSnapshots = true;
        const gapFrames = Math.round(GAP_MS / FRAME_MS);
        const blocked = [...record('long', longMs), ...record('gap', FRAME_MS, gapFrames)];
        lab.holdSnapshots = false;
        // A 700 ms gap needs a longer tail than the short-burst arms: the
        // resume sweep is the whole gap replayed over one snapshot interval.
        const post = record('+', FRAME_MS, GAP_RECOVERY_FRAMES);
        const report = trace([...blocked, ...post]);
        // a: the lending is bounded by the episode cap, stated from the
        // constants: the plain leash budget plus what one capped episode plus
        // its opening frame can cover at run speed.
        const bound = lab.budget() + (RUN_SPEED * (BLOCK_EPISODE_MAX_MS + longMs)) / 1000;
        for (const step of [...blocked, ...post]) {
          expect(step.err, `${step.label}${report}`).toBeLessThanOrEqual(bound);
        }
        // b: the cap expires INSIDE the gap and the display drops back onto
        // the plain leash freeze: the error stops growing and the display
        // stops advancing while the anchor stays frozen. With no cap the
        // lending would run for the whole gap and both would keep going.
        const frozen = blocked.slice(-6);
        const errs = frozen.map((step) => step.err);
        expect(Math.max(...errs) - Math.min(...errs), report).toBeLessThan(0.02);
        for (const step of frozen) {
          expect(step.speed, `frozen ${step.label}${report}`).toBeLessThan(1);
        }
        // c: the burst re-contains it on the stall arms' own terms
        for (const step of post) {
          expect(step.forward, `${step.label}${report}`).toBeGreaterThanOrEqual(-0.03);
        }
        expectSteadyBand(post.slice(-8));
      },
    );

    // The loan is temporary, pinned where it matters: a plain broadcast gap
    // arriving later must be contained by the PLAIN leash, not by whatever
    // room the earlier hitch was lent. A loan that never drained would ride
    // straight through this.
    it.each([[40], [120]])(
      'drains the loan so a later broadcast gap is contained by the plain leash at %ims echo',
      (lagMs) => {
        const lab = warmLab(lagMs);
        const record = recorder(lab);
        record('warm', FRAME_MS);
        record('long', 156);
        record('settle', FRAME_MS, 60); // 1 s of ordinary frames: the loan drains
        lab.holdSnapshots = true; // now a network gap, with no hitch of its own
        const stall = record('stall', FRAME_MS, Math.round(250 / FRAME_MS));
        const report = trace(stall);
        for (const step of stall) {
          expect(step.err, `${step.label}${report}`).toBeLessThanOrEqual(lab.budget() + 1e-6);
        }
        // and the gap really does drive the display into that boundary
        expect(Math.max(...stall.map((step) => step.err)), report).toBeGreaterThan(
          lab.budget() * 0.8,
        );
      },
    );

    // The trigger is RELATIVE to the mirror's measured interval, not to a
    // hardcoded 50 ms. On a coalescing link that delivers every 70 ms, a 60 ms
    // frame is an ordinary frame (shorter than the interval, nothing was
    // swallowed) and must be left to the plain leash, while a 90 ms one is a
    // hitch and gets its episode.
    const COALESCED_MS = 70;
    function runCoalesced(lagMs: number, longMs: number): Step[] {
      const lab = new Lab(lagMs, FRAME_MS, {
        start: { x: 0, z: -1000 },
        deliverAfter: true,
        deliveryMs: COALESCED_MS,
      });
      lab.setInput(mi({ forward: true }));
      for (let i = 0; i < WARMUP_FRAMES; i++) lab.frame();
      const record = recorder(lab);
      record('warm', FRAME_MS);
      return [...record('long', longMs), ...record('+', FRAME_MS, AFTER_FRAMES)];
    }

    it.each([[40], [120]])(
      'treats a 90 ms frame as a hitch when the interval is 70 ms at %ims echo',
      (lagMs) => {
        const steps = runCoalesced(lagMs, 90);
        const report = trace(steps);
        // the frame's own ground, less the fixed-step accumulator's phase (the
        // kernel lands whole 50 ms ticks, so a 90 ms frame carries one or two)
        expect(steps[0].forward, `long${report}`).toBeGreaterThan(0.9 * RUN_SPEED * 0.09);
        expectSteadyBand(steps);
      },
    );

    // The other half of the same claim, and the one a fixed 50 ms threshold
    // would get wrong: under the measured interval nothing was swallowed, so
    // the frame is ordinary and the servo must NOT be held. Read through a
    // server-side sidestep injected just before the frame in question: the
    // ordinary frame keeps closing it, the hitch defers it for the settle
    // window. A 50 ms threshold defers both, a 100 ms one defers neither.
    it('scales the hitch trigger to the measured interval, not to a fixed 50 ms', () => {
      const lateralErrs = (longMs: number): number[] => {
        const lab = new Lab(40, FRAME_MS, {
          start: { x: 0, z: -1000 },
          deliverAfter: true,
          deliveryMs: COALESCED_MS,
        });
        lab.setInput(mi({ forward: true }));
        for (let i = 0; i < WARMUP_FRAMES; i++) lab.frame();
        // Under the plain leash budget on purpose: inside it only the servo
        // can close the gap, so this reads the servo and not the clamp.
        lab.srv.player.pos.x += 0.35;
        lab.frame(longMs);
        const errs: number[] = [];
        for (let i = 0; i < 6; i++) {
          const r = lab.frame();
          if (!r.pose) throw new Error('predictor disabled unexpectedly');
          errs.push(Math.abs(r.pose.x - r.ac.x));
        }
        return errs;
      };
      const ordinary = lateralErrs(60);
      const hitch = lateralErrs(90);
      const report =
        `\n  60 ms frame: ${ordinary.map((e) => e.toFixed(3)).join(' ')}` +
        `\n  90 ms frame: ${hitch.map((e) => e.toFixed(3)).join(' ')}`;
      // the ordinary frame leaves the servo running, so the divergence turns
      // around inside the window; the hitch defers it through its settle
      // window, where it is still opening
      expect(ordinary[5], report).toBeLessThan(ordinary[4]);
      expect(ordinary[5], report).toBeLessThan(0.5);
      expect(hitch[5], report).toBeGreaterThan(hitch[4]);
    });

    // Recurrence bound. A machine hitching every few frames must not be able
    // to keep the servo held forever: measured against a server that never
    // receives the intent (the display predicts a run the authority never
    // performs), the display has to stay on the leash instead of walking out
    // to the 6 yd re-adopt. SERVO_REFRACTORY_INTERVALS is what bounds it.
    it('bounds the display against a diverging server through repeated hitches', () => {
      const lab = new Lab(100, FRAME_MS, {
        start: { x: 0, z: -1000 },
        deliverAfter: true,
        serverDeaf: true,
      });
      lab.setInput(mi({ forward: true }));
      const record = recorder(lab);
      record('warm', FRAME_MS);
      const hitching: Step[] = [];
      for (let cycle = 0; cycle < 15; cycle++) {
        hitching.push(...record('run', FRAME_MS, 5), ...record('hitch', 120));
      }
      const settling = record('calm', FRAME_MS, 60);
      const report = trace([...hitching, ...settling]);
      const peak = Math.max(...hitching.map((step) => step.err));
      expect(peak, `peak${report}`).toBeLessThan(2.5);
      expect(peak, `peak${report}`).toBeLessThan(Math.sqrt(SELF_MOTION_SNAP_DIST_SQ));
      // and once the hitching stops the servo closes it back onto the leash
      expect(settling[settling.length - 1].err, `settled${report}`).toBeLessThan(
        lab.budget() + 1e-6,
      );
    });

    // Defensive inputs: ClientWorld hands over its live EWMA and last-apply
    // age, and a fresh or reset mirror can present 0 or a negative sentinel.
    // The core floors both, so the two frame shapes must be indistinguishable.
    it('treats a degenerate interval and a negative snapshot age as the floored pair', () => {
      const sim = new Sim({
        seed: SEED,
        playerClass: 'warrior',
        autoEquip: true,
        world: EMPTY_TEST_WORLD,
      });
      sim.setPlayerLevel(60);
      teleport(sim, 0, -1000);
      sim.player.facing = 0;
      const mirror = (): Entity => ({
        ...sim.player,
        pos: { ...sim.player.pos },
        prevPos: { ...sim.player.prevPos },
      });
      const sentinel = { self: mirror(), predictor: new SelfMotionPredictor(SEED) };
      const floored = { self: mirror(), predictor: new SelfMotionPredictor(SEED) };
      const step = (
        arm: { self: Entity; predictor: SelfMotionPredictor },
        frameDt: number,
        snapAgeMs: number,
        snapIntervalMs: number,
      ): Vec3Like => {
        const out = arm.predictor.step(arm.self, {
          enabled: true,
          moveInput: mi({ forward: true }),
          displayFacing: 0,
          echoMs: 100,
          jitterMs: 0,
          alpha: 1,
          frameDt,
          snapAgeMs,
          snapIntervalMs,
          riftFloor: null,
        });
        if (!out) throw new Error('predictor disabled unexpectedly');
        expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(
          true,
        );
        return { ...out };
      };
      const pair = (frameDt: number, ageMs: number): { a: Vec3Like; b: Vec3Like } => ({
        a: step(sentinel, frameDt, ageMs < 0 ? -1 : ageMs, 0),
        b: step(floored, frameDt, Math.max(0, ageMs), 20),
      });
      for (let i = 0; i < 30; i++) pair(FRAME_MS / 1000, -1);
      const before = pair(FRAME_MS / 1000, -1);
      const hitch = pair(0.156, -1); // the isolated long frame
      const after = pair(FRAME_MS / 1000, 300); // ...and a stale frame behind it
      expect(hitch.a).toEqual(hitch.b);
      expect(after.a).toEqual(after.b);
      // the episode still opened despite the sentinel: full kernel ground, not
      // the base-budget clamp, and the frame after it keeps advancing
      expect(hitch.a.z - before.a.z).toBeGreaterThan(0.9);
      expect(after.a.z).toBeGreaterThan(hitch.a.z);
    });

    // The boundary of the fix, pinned from the other side. A delivery burst
    // with no long frame is a NETWORK gap: nothing local explains the stale
    // anchor, so it stays in the broadcast-stall regime above (the display
    // freezes on the leash, then the resume sweep repays the gap). The
    // staleness allowance must not leak into it, or the leash containment the
    // stall arms pin would quietly stop holding.
    it.each([
      [40, 15.5],
      [120, 12.0],
    ])(
      'leaves a delivery burst with no long frame frozen on the leash at %ims echo',
      (lagMs, peakYdS) => {
        const steps = runBurst(lagMs);
        const report = trace(steps);
        // the freeze itself: the frame whose tail applies the burst still steps
        // against the frozen anchor, so it shows the leash, not the kernel
        expect(steps[0].speed, `frozen${report}`).toBeLessThan(2);
        // the repayment: forward, bounded, and back on the steady band by the end
        for (const step of steps) {
          expect(step.forward, `${step.label}${report}`).toBeGreaterThanOrEqual(-0.03);
          expect(step.speed, `${step.label}${report}`).toBeLessThanOrEqual(peakYdS);
        }
        expectSteadyBand(steps.slice(-8));
      },
    );
  });

  it('starts the jump arc locally without waiting for the server', () => {
    const lab = new Lab(150);
    lab.setInput(mi({ forward: true }));
    for (let i = 0; i < 30; i++) lab.frame();
    const groundY = lab.frame().pose?.y ?? 0;
    // hold jump across a full 50ms fixed step (a sub-step tap can fall between
    // 20 Hz samples, exactly like it can server-side)
    lab.setInput(mi({ forward: true, jump: true }));
    for (let i = 0; i < 4; i++) lab.frame();
    lab.setInput(mi({ forward: true }));
    let maxRise = 0;
    for (let i = 0; i < 12; i++) {
      const r = lab.frame(); // 200ms window, server still grounded for most of it
      if (r.pose) maxRise = Math.max(maxRise, r.pose.y - groundY);
    }
    expect(maxRise).toBeGreaterThan(0.3);
  });
});

// Issue #3479: prediction used to be switched off entirely inside a rift
// (src/main.ts's old `!isRiftPos(pe.pos.x)` gate), so every key press showed
// the full echo latency there while the overworld and regular dungeons stayed
// predicted. These scenarios drive Lab through a REAL procedural rift floor
// (Sim.enterRift, the same entry point the server uses) so the predictor's
// strip/reapply lift pair and its rift-token wall resolution are proven
// against the actual generated geometry, not a hand-built stand-in.
describe('rift prediction (issue #3479)', () => {
  // Procedural (no authored rooms), so riftLiftAt falls through to the z-band
  // platform ramp: flat below local z=84, height ~2.2206 from z=94 on, verified
  // directly against riftLiftAt below rather than hardcoded.
  const PLATFORM_SEED = 6;
  const PLATFORM_BASE_LEVEL = 20;
  // Same "chamber-waist" wall fixture tests/rift_wall_swept_collision.test.ts
  // pins: a real side wall at local x=35 inside the origin(slot, 0) room band.
  const WALL_SEED = 2;
  const WALL_BASE_LEVEL = 20;

  // Real ClientWorld teleport handling (online.ts TELEPORT_SNAP_DIST_SQ): a jump
  // this large re-anchors prevPos AT the new pos, no interpolation sweep. Lab's
  // own snapshot mirroring has no such collapse (nothing before this needed
  // one), so every scenario below applies it manually right after repositioning
  // the server player, instead of letting Lab glide across roughly 100000 yd
  // from the overworld start to the rift band.
  //
  // Deliberately NOT authoritativeDiscontinuity: that flag is reserved for a
  // completed /unstuck recovery (hasAuthoritativeSelfPositionDiscontinuity),
  // a narrower signal than "any large teleport". A rift entry is an ordinary
  // large jump, caught the same way any other one is: step()'s own anchor
  // check (the module header's "any gap over the renderer's 6 yd snap rule
  // resets outright") sees the collapsed mirror disagree with the predictor's
  // pre-jump history and resets from there, with no discontinuity flag
  // needed. This helper exists only to fast-forward past the ~100000 yd trip
  // from the overworld start Lab's constructor uses to the rift band, so the
  // scenarios below can start their assertions already on the rift floor.
  function collapseMirrorToServerPos(lab: Lab): void {
    lab.self.pos = { ...lab.srv.player.pos };
    lab.self.prevPos = { ...lab.srv.player.pos };
  }

  it('the predicted Y matches the server-lifted Y at rest on a raised tier, with no per-frame oscillation', () => {
    const platformFloor = generateRiftFloor(PLATFORM_SEED, PLATFORM_BASE_LEVEL, 0);
    const expectedLift = riftLiftAt(platformFloor, 0, 100);
    expect(expectedLift).toBeGreaterThan(1); // sanity: this local point is really raised

    const lab = new Lab(50);
    lab.srv.enterRift(PLATFORM_SEED, PLATFORM_BASE_LEVEL, lab.srv.player.id);
    const origin = lab.srv.riftFloor?.origin;
    if (!origin) throw new Error('rift floor did not spawn');
    const p = lab.srv.player;
    p.pos.x = origin.x;
    p.pos.z = origin.z + 100;
    p.pos.y = DUNGEON_FLOOR_Y;
    p.prevPos = { ...p.pos };
    p.vy = 0;
    p.onGround = true;
    lab.srv.tick(); // settle server-side: updateRiftTriggers lifts p.pos.y once
    expect(p.pos.y).toBeCloseTo(expectedLift, 6);
    collapseMirrorToServerPos(lab);

    // The reposition above is a real teleport (a rift entry always is): the
    // predictor's actor is already rooted correctly. What this test actually
    // proves is what happens AFTER, across many further frames with no input:
    // the strip/reapply pair around the kernel must keep re-deriving the SAME
    // lift every tick, or the display would drift or judder on the platform.
    // Vertical is never leash-clamped (a jump apex must not be), so this is
    // decisive: nothing else would mask a wrong or drifting lift here.
    const ys: number[] = [];
    for (let i = 0; i < 40; i++) {
      const r = lab.frame();
      if (r.pose) ys.push(r.pose.y);
    }
    expect(ys.length).toBeGreaterThan(30);
    for (const y of ys) {
      expect(y).toBeCloseTo(expectedLift, 2);
    }
    // No per-frame oscillation: consecutive settled samples barely move at all
    // (this is a STANDING player; any visible bobbing would show up here).
    for (let i = 1; i < ys.length; i++) {
      expect(Math.abs(ys[i] - ys[i - 1])).toBeLessThan(0.01);
    }
  });

  it('a jump from the raised tier arcs above the lift and settles back onto it, never sinking through', () => {
    const platformFloor = generateRiftFloor(PLATFORM_SEED, PLATFORM_BASE_LEVEL, 0);
    const expectedLift = riftLiftAt(platformFloor, 0, 100);

    const lab = new Lab(50);
    lab.srv.enterRift(PLATFORM_SEED, PLATFORM_BASE_LEVEL, lab.srv.player.id);
    const origin = lab.srv.riftFloor?.origin;
    if (!origin) throw new Error('rift floor did not spawn');
    const p = lab.srv.player;
    p.pos.x = origin.x;
    p.pos.z = origin.z + 100;
    p.pos.y = DUNGEON_FLOOR_Y;
    p.prevPos = { ...p.pos };
    p.vy = 0;
    p.onGround = true;
    lab.srv.tick();
    collapseMirrorToServerPos(lab);
    for (let i = 0; i < 10; i++) lab.frame(); // settle the mirror onto the lift

    lab.setInput(mi({ jump: true }));
    for (let i = 0; i < 4; i++) lab.frame(); // hold across a full 50ms server step
    lab.setInput(mi());
    let maxY = 0;
    for (let i = 0; i < 30; i++) {
      const r = lab.frame();
      if (r.pose) maxY = Math.max(maxY, r.pose.y);
    }
    // The arc goes measurably above the resting lift...
    expect(maxY).toBeGreaterThan(expectedLift + 0.3);
    // ...and once landed and fully settled (a further 1s, well past a normal
    // jump arc's flight time) it is back to EXACTLY the platform's lift (same
    // decisive tolerance as the at-rest test), not sunk into a tier the
    // flat-floor kernel would otherwise not know exists. Only the TAIL of the
    // window is asserted: the arc itself is still descending through part of
    // this window, and asserting on that part would just re-measure the jump.
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) {
      const r = lab.frame();
      if (r.pose) ys.push(r.pose.y);
    }
    for (const y of ys.slice(-15)) {
      expect(y).toBeCloseTo(expectedLift, 2);
    }
  });

  // Regression pin for a bug the first version of this fix shipped: the lift
  // was stripped/reapplied per kernel step INSIDE the DT loop, so it was
  // correct at the moment each step ran, but the divergence servo and the
  // horizontal leash clamp both run AFTER the loop and can still move x/z
  // (that is their whole job under lag) without ever recomputing the lift for
  // where they moved it to. On a flat plateau that is invisible (the lift is
  // constant either side of any such shift); it only shows up walking the
  // ramp itself, where the lift is a function of z. lagMs 300 keeps the servo
  // and the leash both continuously active for the whole traverse (the same
  // budget reasoning as the wall test below), so this is decisive, not just
  // theoretically exercising the path.
  it('the predicted Y matches the lift at wherever x/z actually ends up while walking up a ramp under lag', () => {
    const platformFloor = generateRiftFloor(PLATFORM_SEED, PLATFORM_BASE_LEVEL, 0);
    // Sanity: the ramp is really a ramp over this span (not flat, not already
    // fully raised), so the assertion below is actually exercising a
    // position-varying lift, not a constant.
    expect(riftLiftAt(platformFloor, 0, 80)).toBe(0);
    expect(riftLiftAt(platformFloor, 0, 89)).toBeGreaterThan(0);
    expect(riftLiftAt(platformFloor, 0, 89)).toBeLessThan(riftLiftAt(platformFloor, 0, 100));

    const lab = new Lab(300, FRAME_MS, { facing: 0 }); // facing 0: +z, straight up the ramp
    lab.srv.enterRift(PLATFORM_SEED, PLATFORM_BASE_LEVEL, lab.srv.player.id);
    const origin = lab.srv.riftFloor?.origin;
    if (!origin) throw new Error('rift floor did not spawn');
    const p = lab.srv.player;
    p.pos.x = origin.x;
    p.pos.z = origin.z + 70; // flat, well short of the ramp's rampZ0=84
    p.pos.y = DUNGEON_FLOOR_Y;
    p.prevPos = { ...p.pos };
    p.vy = 0;
    p.onGround = true;
    p.facing = 0;
    lab.srv.tick();
    collapseMirrorToServerPos(lab);
    for (let i = 0; i < 10; i++) lab.frame(); // settle the mirror

    lab.setInput(mi({ forward: true }));
    // 4s comfortably crosses the flat lead-in (z 70-84) and carries well into
    // the ramp itself (84-94), leash-bounded well under full run speed; it
    // does not reach the plateau (94+) at this lag budget, which the
    // maxLocalZ/liftedSamples assertions below pin directly rather than
    // leaving to a comment a future speed or leash change could silently
    // outdate.
    let sampled = 0;
    let maxLocalZ = Number.NEGATIVE_INFINITY;
    let liftedSamples = 0;
    for (let i = 0; i < 240; i++) {
      const r = lab.frame();
      if (!r.pose) continue;
      const localX = r.pose.x - origin.x;
      const localZ = r.pose.z - origin.z;
      const expected = riftLiftAt(platformFloor, localX, localZ);
      // 0.02 yd (under a centimeter), not the tighter 0.005 the at-rest tests
      // use: right at the ramp's kink (rampZ0) the OUTPUT itself linearly
      // interpolates x/z and y separately across one sub-frame step, and the
      // lift function is not linear across that exact point, so a one- or
      // two-frame sub-visual residual there is real and expected, not a
      // regression. The bug this test exists to catch (the servo/leash not
      // recomputing the lift after moving x/z) was an order of magnitude
      // larger: ~0.22 yd of Y error per yard of x/z correction on this same
      // ramp slope.
      expect(
        Math.abs(r.pose.y - expected),
        `frame ${i} at local z=${localZ.toFixed(2)}: expected ~${expected.toFixed(4)}, got ${r.pose.y.toFixed(4)}`,
      ).toBeLessThan(0.02);
      sampled++;
      maxLocalZ = Math.max(maxLocalZ, localZ);
      if (expected > 0) liftedSamples++;
    }
    expect(sampled).toBeGreaterThan(200);
    // Decisive traversal pins: the run must actually carry well onto the
    // ramp's rising slope (not just brush its start) while staying short of
    // the plateau, and a solid share of the 4s window must land on the
    // lifted (z > 84) part. A future speed or leash change that quietly
    // shrank the ramp portion toward zero would still pass `sampled > 200`
    // (a pose is produced on flat ground too), so these two are what
    // actually hold the traversal this test claims to exercise.
    expect(maxLocalZ).toBeGreaterThan(85);
    expect(maxLocalZ).toBeLessThan(94);
    expect(liftedSamples).toBeGreaterThan(80);
  });

  it('the predicted pose stops at a rift wall, never crossing it while running into it', () => {
    // facing: PI/2 (+x, toward the wall) as a constructor opt, not just on
    // the entity: the predictor's displayFacing reads Lab's OWN readonly
    // facing field, set once here, never the live entity's p.facing.
    // lagMs 300 gives a generous leash budget (~2 yd), so only the
    // predictor's OWN local wall resolution can hold it short of the wall:
    // a small budget would pass this test vacuously (the leash alone already
    // keeps the display within a fraction of a yard of the (also correctly
    // blocked) server anchor, whether or not local collision resolves at all).
    const lab = new Lab(300, FRAME_MS, { facing: Math.PI / 2 });
    lab.srv.enterRift(WALL_SEED, WALL_BASE_LEVEL, lab.srv.player.id);
    const origin = lab.srv.riftFloor?.origin;
    if (!origin) throw new Error('rift floor did not spawn');
    const p = lab.srv.player;
    // The same "chamber-waist" wall the swept-collision fixture pins (local
    // x=35), approached along z=70 (verified clear) rather than that
    // fixture's own single-shot teleport start point (z=61): stepped
    // movement there is a pre-existing dead spot unrelated to this fix
    // (resolveMovement's ejection guard rejects every iterative step from
    // that exact point, in every direction), so it cannot host a WALKED
    // approach. Server-verified along z=70 to run freely and stop at local
    // x=33.5.
    p.pos.x = origin.x + 33;
    p.pos.z = origin.z + 70;
    p.pos.y = DUNGEON_FLOOR_Y;
    p.prevPos = { ...p.pos };
    p.vy = 0;
    p.onGround = true;
    p.facing = Math.PI / 2; // face +x, straight at the wall
    lab.srv.tick();
    collapseMirrorToServerPos(lab);
    for (let i = 0; i < 10; i++) lab.frame(); // settle the mirror

    lab.setInput(mi({ forward: true }));
    let maxLocalX = Number.NEGATIVE_INFINITY;
    let sampled = 0;
    const localXs: number[] = [];
    // The wall must hold the predicted pose at its real block face
    // (server-verified 33.5) the whole way, not just at the end.
    for (let i = 0; i < 120; i++) {
      const r = lab.frame();
      if (!r.pose) continue;
      const localX = r.pose.x - origin.x;
      maxLocalX = Math.max(maxLocalX, localX);
      localXs.push(localX);
      sampled++;
    }
    // A pose must actually be produced across most of the run, or the bound
    // below is satisfied vacuously by prediction being off the whole time
    // (exactly the failure mode: a rift floor riftFloor never populated for,
    // e.g. a resumed session, suspends prediction entirely and this loop
    // would otherwise pass on zero samples).
    expect(sampled).toBeGreaterThan(100);
    expect(maxLocalX).toBeLessThan(34.5);
    // A full yard of slack against the real block face (33.5) would also let
    // the local wall resolution silently do nothing (leaving the leash alone
    // to hold the pose near the server anchor) and still pass; pin the lower
    // bound too, so a regression that stops resolving the wall locally shows
    // up here even while the leash still masks it from the naive test.
    expect(maxLocalX).toBeGreaterThan(33.4);
    // No backward step once the run reaches the wall: the issue's own
    // acceptance criterion ("no backward step when the authoritative anchor
    // catches up"), which nothing above asserts on its own.
    for (let i = 1; i < localXs.length; i++) {
      expect(localXs[i]).toBeGreaterThanOrEqual(localXs[i - 1] - 1e-6);
    }
  });

  it('suspends prediction while riftSliding is true and resumes once it clears', () => {
    // The ice slide is server-driven and unmirrored (self_motion.ts module
    // header): step()'s early-return gate on self.riftSliding is what hands
    // control back to the authoritative fallback for its duration, the same
    // way the Valkyr's Calling flight aura suspends grounded prediction
    // (tests/paladin_valkyrs_calling.test.ts). Nothing else in this suite
    // exercises that gate directly.
    const lab = new Lab(50);
    lab.srv.enterRift(PLATFORM_SEED, PLATFORM_BASE_LEVEL, lab.srv.player.id);
    lab.srv.tick();
    collapseMirrorToServerPos(lab);
    expect(lab.frame().pose).not.toBeNull();

    lab.self.riftSliding = true;
    expect(lab.frame().pose).toBeNull();

    lab.self.riftSliding = false;
    expect(lab.frame().pose).not.toBeNull();
  });
});
