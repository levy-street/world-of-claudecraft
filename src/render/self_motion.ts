// Bounded intent-driven extrapolation of the LOCAL player's pose online: the
// sanctioned display-layer locomotion anticipation (src/net/CLAUDE.md).
//
// The online avatar used to wait a full round trip before moving: intent goes
// to the server, the next 20 Hz tick applies it, and the snapshot comes back.
// This module advances a display-only scratch pose every frame using the SAME
// movement math the server runs (src/sim/player_motion.ts: real speed, slope
// gates, swept static collision, jump/gravity), so starts, stops, and turns
// respond the frame the key changes.
//
// It is a visual layer with three hard safety properties, in order:
//  1. Anchored: every frame the authoritative pose (which shows the past, one
//     echo ago) is compared against where the local display WAS one echo ago
//     (a short pose-history ring); any disagreement, from server-driven motion
//     (charge, knockback) or a misprediction (a stun landing mid-press),
//     corrects as a short glide, never a divergence.
//  2. Bounded: the horizontal error from the authoritative pose is leashed to
//     what the player could legitimately cover in the latency cap; a server
//     teleport (or any gap over the renderer's 6 yd snap rule) resets outright.
//  3. Invisible to logic: the output feeds only the renderer's
//     selfRenderPosition (mesh + camera). It never writes into ClientWorld
//     mirrored state, IWorld reads, or the input stream.
//
// Pure and Node-testable (no Three, no DOM): plain {x,y,z} in and out, like
// facing_smooth.ts / locomotion.ts. tests/self_motion.test.ts drives it
// against a real lagging Sim.

import { resolveMovement } from '../sim/colliders';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../sim/player_motion';
import { DT, type Entity, type MoveInput, RUN_SPEED } from '../sim/types';

// Latency cap on the extrapolation window: at least one snapshot-ish interval
// so low-ping links still get the start-of-motion snap, and a hard ceiling so
// a pathological link never runs the visual far ahead of the truth. The
// ceiling must sit ABOVE any RTT the game is meant to feel good at: when the
// real echo exceeds it the display rides the leash boundary permanently and
// every steering input gets radially clamped, a distinct gluey "moving
// through water" feel (observed under netem at ~280ms RTT with a 180 cap).
// Mispredictions stay small regardless: CC gates the predictor off and
// teleports snap, so the cost of a higher ceiling is only a longer correction
// glide in the rare genuine-divergence case.
export const SELF_MOTION_CAP_MIN_MS = 60;
export const SELF_MOTION_CAP_MAX_MS = 350;
// The divergence MEASUREMENT is aligned to the true echo, bounded only by
// what the history ring can serve. This is a different bound from the lead
// cap above on purpose: capping the measurement at 180ms on a 280ms link
// compares the anchor against a history sample 100ms too new, a constant
// phantom error that drives the servo continuously; and since the history
// records the already-corrected display, the correction chases its own
// delayed output. With gain x delay > 1 that loop self-oscillates (the
// observed forward/backward pumping under netem). Alignment kills the
// phantom error; the rate bound below keeps the residual loop damped.
export const SELF_MOTION_MEASURE_MAX_MS = 400;
// Pull rate of the divergence correction. The correction compares the
// authoritative pose against WHERE THE LOCAL PREDICTION WAS one latency cap
// ago (a short pose-history ring), so during agreed motion (steady runs,
// starts, stops, jump arcs) the error is ~zero and the rate never shows; it
// only bites on genuine divergence (server-driven charge/knockback, a stun
// landing mid-press, a misprediction), which glides in over ~1/12 s.
export const SELF_MOTION_BLEND_RATE = 12; // 1/s
// Divergence deadband: the wire rounds positions to centimeters and the
// history sampling is frame-quantized; inside this radius the pose is left
// alone so a settled stop never jiggles. Real corrections are far larger.
export const SELF_MOTION_DEADBAND_YD = 0.05;
// Same teleport rule the renderer's self smoother uses (6 yd).
export const SELF_MOTION_SNAP_DIST_SQ = 6 * 6;
const MAX_FRAME_DT = 0.25; // matches the main-loop frame clamp
const LEASH_SLACK_YD = 0.05;
// Pose-history ring: enough to look SELF_MOTION_CAP_MAX_MS into the past with
// headroom even on high-refresh displays (128 entries covers 267 ms at 480 fps
// and over 2 s at 60 fps).
const HISTORY_SIZE = 128;

export interface SelfMotionFrame {
  /** Gate computed by main.ts: online, not spectating, not frozen/CC'd, not in a delve. */
  enabled: boolean;
  /** This frame's resolved held intent (click-move folded in, jump included). */
  moveInput: MoveInput;
  /** The one display heading: mouselook/click-move facing, else the local keyboard turn, else the interpolated server facing. */
  displayFacing: number;
  echoMs: number;
  jitterMs: number;
  /** The frame's snapshot alpha (same value handed to renderer.sync). */
  alpha: number;
  frameDt: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

export class SelfMotionPredictor {
  /**
   * Telemetry: how much latency the extrapolation is currently hiding, in ms
   * (the horizontal display lead over the authoritative anchor, expressed at
   * the player's current run speed). 0 while idle or inactive.
   */
  leadMs = 0;

  /** The kernel's exact physics ground state for the displayed pose; true when
   *  inactive. Replaces the renderer's foot-height airborne heuristic for the
   *  local player while the predictor drives the display. */
  get onGround(): boolean {
    return this.actor?.onGround ?? true;
  }

  private readonly deps: PlayerMotionDeps;
  private actor: Entity | null = null;
  private lastSelfId = -1;
  private lastDead = false;
  private lastGhost = false;
  private acc = 0;
  private timeMs = 0;
  // Ring of end-of-frame display poses, for the "where was the prediction one
  // latency cap ago" comparison. Preallocated; hist* index HISTORY_SIZE slots.
  private histCount = 0;
  private histHead = 0;
  private readonly histT = new Float64Array(HISTORY_SIZE);
  private readonly histX = new Float64Array(HISTORY_SIZE);
  private readonly histY = new Float64Array(HISTORY_SIZE);
  private readonly histZ = new Float64Array(HISTORY_SIZE);
  private readonly histSample: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly stepInput: MoveInput = {
    forward: false,
    back: false,
    turnLeft: false,
    turnRight: false,
    strafeLeft: false,
    strafeRight: false,
    jump: false,
  };
  private readonly out: Vec3Like = { x: 0, y: 0, z: 0 };

  constructor(seed: number) {
    // The client dep shape: pure static collision (delves are gated off by the
    // enabled flag), aura-only speed (the Fiesta augment is not mirrored; the
    // leash absorbs that bounded divergence), and no-op live-Sim callbacks.
    this.deps = {
      seed,
      moveSpeedMult: (e) => moveSpeedMult(e, 0),
      resolveMove: (fromX, fromZ, nx, nz, r, _e, ignoreFences) =>
        resolveMovement(seed, fromX, fromZ, nx, nz, r, ignoreFences),
      resolvedAbility: () => null,
      cancelCast: () => {},
      standUp: () => {},
      dealDamage: () => {},
    };
  }

  reset(): void {
    this.actor = null;
    this.acc = 0;
    this.histCount = 0;
    this.histHead = 0;
    this.leadMs = 0;
  }

  private recordHistory(x: number, y: number, z: number): void {
    const i = this.histHead;
    this.histT[i] = this.timeMs;
    this.histX[i] = x;
    this.histY[i] = y;
    this.histZ[i] = z;
    this.histHead = (i + 1) % HISTORY_SIZE;
    if (this.histCount < HISTORY_SIZE) this.histCount++;
  }

  // The display pose at time tMs (linear between recorded frames; clamped to
  // the oldest/newest sample). Writes into histSample and returns it.
  private sampleHistory(tMs: number): Vec3Like | null {
    if (this.histCount === 0) return null;
    const n = this.histCount;
    let newer = (this.histHead - 1 + HISTORY_SIZE) % HISTORY_SIZE;
    if (this.histT[newer] <= tMs) {
      this.histSample.x = this.histX[newer];
      this.histSample.y = this.histY[newer];
      this.histSample.z = this.histZ[newer];
      return this.histSample;
    }
    for (let step = 1; step < n; step++) {
      const older = (newer - 1 + HISTORY_SIZE) % HISTORY_SIZE;
      if (this.histT[older] <= tMs) {
        const span = this.histT[newer] - this.histT[older];
        const f = span > 0 ? (tMs - this.histT[older]) / span : 0;
        this.histSample.x = this.histX[older] + (this.histX[newer] - this.histX[older]) * f;
        this.histSample.y = this.histY[older] + (this.histY[newer] - this.histY[older]) * f;
        this.histSample.z = this.histZ[older] + (this.histZ[newer] - this.histZ[older]) * f;
        return this.histSample;
      }
      newer = older;
    }
    this.histSample.x = this.histX[newer];
    this.histSample.y = this.histY[newer];
    this.histSample.z = this.histZ[newer];
    return this.histSample;
  }

  /**
   * Advance one rendered frame. Returns the display pose, or null when the
   * predictor is disabled (the caller falls back to the plain lead-smoothing
   * path, which shares the same selfRenderPosition so the handoff is seamless).
   */
  step(self: Entity, frame: SelfMotionFrame): Vec3Like | null {
    if (!frame.enabled) {
      this.reset();
      return null;
    }
    const dt = clamp(frame.frameDt, 0, MAX_FRAME_DT);
    this.timeMs += dt * 1000;
    // The authoritative anchor. Alpha is capped at 1 (unlike the renderer's
    // 1.25 display extrapolation): an extrapolated anchor overshoots every
    // stop and then retreats when the stationary snapshot lands, and that
    // retreat would jiggle the divergence measurement.
    const alpha = clamp(frame.alpha, 0, 1);
    const ax = self.prevPos.x + (self.pos.x - self.prevPos.x) * alpha;
    const ay = self.prevPos.y + (self.pos.y - self.prevPos.y) * alpha;
    const az = self.prevPos.z + (self.pos.z - self.prevPos.z) * alpha;

    // Re-adopt the authoritative pose outright on identity/life-state flips and
    // teleports; otherwise keep the persistent scratch actor.
    const flipped =
      self.id !== this.lastSelfId || self.dead !== this.lastDead || self.ghost !== this.lastGhost;
    this.lastSelfId = self.id;
    this.lastDead = self.dead;
    this.lastGhost = self.ghost;
    let actor = this.actor;
    if (actor && !flipped) {
      const dx = actor.pos.x - ax;
      const dy = actor.pos.y - ay;
      const dz = actor.pos.z - az;
      if (dx * dx + dy * dy + dz * dz > SELF_MOTION_SNAP_DIST_SQ) actor = null;
    } else {
      actor = null;
    }
    if (!actor) {
      actor = {
        ...self,
        pos: { x: ax, y: ay, z: az },
        prevPos: { x: ax, y: ay, z: az },
        facing: frame.displayFacing,
        vx: 0,
        vy: 0,
        vz: 0,
        onGround: true,
        jumping: false,
        fallStartY: ay,
      };
      this.actor = actor;
      this.acc = 0;
      // The old display trajectory is meaningless relative to the new anchor
      // (teleport / life-state flip); comparing against it would fling the pose.
      this.histCount = 0;
      this.histHead = 0;
    }
    // Borrow the mirrored per-frame state the kernel reads; the pose fields
    // above stay owned by the scratch actor.
    actor.auras = self.auras;
    actor.ghost = self.ghost;
    actor.sitting = self.sitting;
    actor.castingAbility = self.castingAbility;
    actor.maxHp = self.maxHp;

    // Fixed-step advance with the held intent. Turn flags are stripped: the
    // heading is assigned from the one display source each step, and letting
    // the kernel integrate tl/tr on top would double the turn.
    const inp = this.stepInput;
    inp.forward = frame.moveInput.forward;
    inp.back = frame.moveInput.back;
    inp.strafeLeft = frame.moveInput.strafeLeft;
    inp.strafeRight = frame.moveInput.strafeRight;
    inp.jump = frame.moveInput.jump;
    // A blocked step needs NO special handling, and must never get any. The
    // kernel runs the same swept static collision as the server, so when the
    // display stops at a wall it is already RIGHT and the authoritative anchor
    // is merely one echo behind, still mid-approach. Both converge on the wall
    // face on their own, and the divergence measurement below sees ~zero error
    // throughout (it compares the anchor against the display one echo ago, and
    // the display stopped one echo ago too). Detecting the block and stripping
    // the forward lead against the anchor instead yanks the avatar backward by
    // RUN_SPEED x echo in a SINGLE frame (a yard at 200ms, unsmoothed, because
    // the renderer follows this pose exactly), and then walks it back into the
    // wall: the "collide and snap back" artifact. Leave the block alone.
    this.acc = Math.min(this.acc + dt, MAX_FRAME_DT);
    while (this.acc >= DT) {
      actor.prevPos.x = actor.pos.x;
      actor.prevPos.y = actor.pos.y;
      actor.prevPos.z = actor.pos.z;
      actor.facing = frame.displayFacing;
      stepPlayerMotion(this.deps, actor, inp);
      this.acc -= DT;
    }
    const frac = this.acc / DT;

    // Divergence correction: the authoritative anchor shows where the server
    // had the player ~capMs ago, so compare it against where the LOCAL display
    // was capMs ago. During agreed motion (steady run, start, stop, jump arc)
    // that error is ~zero; it only grows on genuine divergence, and the pull
    // glides the visual back at SELF_MOTION_BLEND_RATE. Server-driven motion
    // with no local intent (charge, knockback) is also captured: the history
    // stands still while the anchor moves, so the error tracks the ride.
    const latencyMs = frame.echoMs + 0.5 * frame.jitterMs;
    const capMs = clamp(latencyMs, SELF_MOTION_CAP_MIN_MS, SELF_MOTION_CAP_MAX_MS);
    const measureMs = clamp(latencyMs, SELF_MOTION_CAP_MIN_MS, SELF_MOTION_MEASURE_MAX_MS);
    const past = this.sampleHistory(this.timeMs - measureMs);
    if (past) {
      // The blend dt is clamped tighter than the frame clamp: at load-hitch
      // frame times (100-250ms at world entry, or on weak hardware) an
      // unclamped exponential eats ~95% of the error in ONE frame, turning
      // every correction into a visible jerk. Capped at 1/30 a correction
      // never moves more than ~33% of the gap per frame and still converges.
      // The rate itself is bounded so that rate x measurement-delay stays
      // under 0.5: the correction loop runs through its own delayed history,
      // and a delayed servo rings near gain x delay ~1 (at 0.8 it still
      // pumped ~17cm over a 2s settle in the 280ms-RTT lab).
      const rate = Math.min(SELF_MOTION_BLEND_RATE, 500 / measureMs);
      const k = 1 - Math.exp(-rate * Math.min(dt, 1 / 30));
      const errX = ax - past.x;
      const errY = ay - past.y;
      const errZ = az - past.z;
      const errLen = Math.hypot(errX, errY, errZ);
      const scale =
        errLen > SELF_MOTION_DEADBAND_YD ? ((errLen - SELF_MOTION_DEADBAND_YD) / errLen) * k : 0;
      actor.pos.x += errX * scale;
      actor.pos.y += errY * scale;
      actor.pos.z += errZ * scale;
      actor.prevPos.x += errX * scale;
      actor.prevPos.y += errY * scale;
      actor.prevPos.z += errZ * scale;
    }

    // Horizontal leash: never show the player farther from the authoritative
    // anchor than they could legitimately RUN inside the latency cap (the
    // kernel itself moves slower while backpedaling/swimming, so the run
    // budget is the honest upper bound; only corrections consume the slack).
    // Vertical is exempt (a jump apex must not be leash-clipped; gravity
    // bounds it).
    const budget = (RUN_SPEED * moveSpeedMult(actor, 0) * capMs) / 1000 + LEASH_SLACK_YD;
    const ex = actor.pos.x - ax;
    const ez = actor.pos.z - az;
    const elen = Math.hypot(ex, ez);
    if (elen > budget) {
      // Clamp pos ONLY (unlike the correction blend above): prevPos keeps the
      // last displayed point, so the sub-frame interpolation glides onto the
      // boundary instead of stepping back. When the RTT exceeds the lead cap
      // the display rides this boundary permanently, and shifting prevPos too
      // turned each 20Hz kernel step into a visible forward/back sawtooth.
      actor.pos.x = ax + (ex * budget) / elen;
      actor.pos.z = az + (ez * budget) / elen;
    }

    this.out.x = actor.prevPos.x + (actor.pos.x - actor.prevPos.x) * frac;
    this.out.y = actor.prevPos.y + (actor.pos.y - actor.prevPos.y) * frac;
    this.out.z = actor.prevPos.z + (actor.pos.z - actor.prevPos.z) * frac;
    this.recordHistory(this.out.x, this.out.y, this.out.z);
    const runSpeed = RUN_SPEED * moveSpeedMult(actor, 0);
    this.leadMs =
      runSpeed > 0 ? (Math.hypot(this.out.x - ax, this.out.z - az) / runSpeed) * 1000 : 0;
    return this.out;
  }
}
