import { describe, expect, it } from 'vitest';
import {
  SELF_MOTION_CAP_MAX_MS,
  SELF_MOTION_CAP_MIN_MS,
  SELF_MOTION_SNAP_DIST_SQ,
  type SelfMotionFrame,
  SelfMotionPredictor,
} from '../src/render/self_motion';
import { Sim } from '../src/sim/sim';
import { type Entity, type MoveInput, RUN_SPEED } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

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
  readonly predictor = new SelfMotionPredictor(SEED);
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

  constructor(
    readonly lagMs: number,
    readonly frameMs = FRAME_MS,
    opts: { start?: { x: number; z: number }; facing?: number } = {},
  ) {
    this.srv = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    this.srv.setPlayerLevel(60);
    const start = opts.start ?? { x: 0, z: -80 };
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
    let eff = this.inputLog[0].input;
    for (const e of this.inputLog) {
      if (e.atMs + this.lagMs <= tMs) eff = e.input;
    }
    return eff;
  }

  frame(): FrameResult {
    this.nowMs += this.frameMs;
    this.sinceTickMs += this.frameMs;
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
      // the 20 Hz snapshot: prev pose = last wire pose, pose = fresh server pose
      this.self.prevPos = { ...this.self.pos };
      this.self.pos = { ...this.srv.player.pos };
      this.self.dead = this.srv.player.dead;
      this.self.ghost = this.srv.player.ghost;
      this.lastSnapMs = this.nowMs;
      delivered = true;
    }
    const alpha = Math.min(1.25, (this.nowMs - this.lastSnapMs) / SNAP_MS);
    const frame: SelfMotionFrame = {
      enabled: this.enabled,
      moveInput: this.localInput,
      displayFacing: this.facing,
      echoMs: this.lagMs,
      jitterMs: 0,
      alpha,
      frameDt: this.frameMs / 1000,
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
    return { pose: out ? { ...out } : null, a, ac, delivered };
  }

  budget(): number {
    const cap = Math.min(SELF_MOTION_CAP_MAX_MS, Math.max(SELF_MOTION_CAP_MIN_MS, this.lagMs));
    return (RUN_SPEED * cap) / 1000 + 0.05;
  }
}

describe('SelfMotionPredictor', () => {
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
    expect(lab.srv.player.pos.z).toBeCloseTo(-80, 3);
  });

  // Running into a blocker is the case the predictor must NOT "correct": the
  // display stops at the wall a full echo before the server does, and that is
  // right. Stripping the lead against the lagging anchor teleports the avatar
  // backward by RUN_SPEED x echo on the contact frame. A normal forward step at
  // 60 fps is RUN_SPEED/60 = 0.117 yd, so any backward frame step of that order
  // reads as a snap; the leash + divergence servo alone keep it sub-centimeter.
  it.each([100, 200, 300])('does not snap the pose backward on contact at %ims echo', (lagMs) => {
    const lab = new Lab(lagMs, FRAME_MS, { start: { x: 0, z: -6 }, facing: 0 });
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
    const lab = new Lab(200, FRAME_MS, { start: { x: 0, z: -6 }, facing: 0 });
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
    const lab = new Lab(120, FRAME_MS, { start: { x: 0, z: -2 }, facing: 0 });
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
      const errOf = (r: FrameResult): number => {
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        return Math.hypot(r.pose.x - r.ac.x, r.pose.z - r.ac.z);
      };
      const advance = (r: FrameResult): number => {
        if (!r.pose) throw new Error('predictor disabled unexpectedly');
        worstLateral = Math.max(worstLateral, Math.abs(r.pose.x));
        serverLateral = Math.max(serverLateral, Math.abs(lab.srv.player.pos.x));
        const step = r.pose.z - lastZ;
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
    });
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
