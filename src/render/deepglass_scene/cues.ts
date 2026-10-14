// The deepball sound cues, moved out of renderer.ts behind a small host.
//
// The bell shipped silent, and silence is what made a 26 yd/s sport read as a
// physics demo: no strike, no burners, no whistle. The sim has no event bus
// for any of this, so the cues are edge-detected here off state the renderer
// is already reading every frame, the touch log for a strike, the pack flags
// for a dash or a brake, the phase for the whistle and the goal. Every buffer
// is synthesised at startup with no assets (game/deepglass_audio.ts).
//
// Positioned, not UI: they play through the ordinary spatial path, so a
// strike across the bell is quiet and behind you, which is also how you find
// the ball by ear.

import { bounceMixFor } from '../../game/deepglass_audio';
import { sfx } from '../../game/sfx';
import { DG_BALL_MAX_SPEED } from '../../sim/deepglass/ball';
import { DEEPGLASS_CENTER, DEEPGLASS_PLAY_R, ringCentreFor } from '../../sim/deepglass/layout';
import { type DgMatch, deepglassLastBeam, deepglassMatch } from '../../sim/deepglass/match';
import type { IWorld } from '../../world_api';
import { bodyCueBits, bodyCueFor, boostBedDrive, DG_SOUND_RANGE } from './deepglass_cue_core';

/** What the cues need from the renderer: the world, and the camera kicks. */
export interface DeepglassCueHost {
  readonly sim: IWorld;
  addShake(amount: number): void;
  punchFov(degrees: number): void;
  /** The Zap Shot victim burst (nature proc surge + ward bloom). */
  zapBurst(entityId: number): void;
}

interface FlyingBody {
  pos: { x: number; y: number; z: number };
  vx?: number;
  vy?: number;
  vz?: number;
  dgFlight?: boolean;
  dgBoosting?: boolean;
  dgBraking?: boolean;
  dgDashTicks?: number;
}

export class DeepglassCues {
  /** Edge-detection state. The sim has no event bus for these, a strike, a
   *  dash, a body meeting the glass, so the render side watches the state it
   *  is already reading each frame and fires on the transitions. */
  private phase: string | null = null;
  private touch = -1;
  private readonly body = new Map<number, number>();
  private charge = 0;
  private powerup: string | null = null;
  private atGlass = false;
  private tumble = 0;
  // The ball's velocity as of LAST frame. A bounce has to be scaled by how hard
  // the ball was met, and by the time the renderer sees the touch the contact
  // has already been resolved, the ball's post-contact speed is near zero for
  // exactly the hits that should be loudest (a rocket trapped dead on a chest).
  // Keeping the incoming vector is what makes a closing speed available at all.
  private readonly ballV = { x: 0, y: 0, z: 0 };
  // Fighters currently running a burner bed, so they can all be released when
  // the bout ends or a body drops out mid-flight.
  private readonly boostLoops = new Set<number>();
  /** Match tick of the last Zap Shot the render blew up. */
  private zapTick = -1;

  constructor(private readonly host: DeepglassCueHost) {}

  /** Fire this frame's cues (see the file header). */
  sync(): void {
    const sim = this.host.sim;
    const m = deepglassMatch();
    if (!m) {
      this.phase = null;
      this.touch = -1;
      this.body.clear();
      this.atGlass = false;
      this.stopBoostLoops();
      return;
    }
    const c = DEEPGLASS_CENTER;

    // ---- the whistle, and the bell for a goal ------------------------------
    if (m.phase !== this.phase) {
      const from = this.phase;
      this.phase = m.phase;
      if (from !== null) {
        if (m.phase === 'active') {
          sfx.playAt('dg_whistle', c.x, c.y, c.z, {
            gain: 0.9,
            cooldown: 0.5,
            maxDistance: DG_SOUND_RANGE,
          });
        } else if (m.phase === 'goal') {
          const ring = m.lastGoalBy ? ringCentreFor(m.lastGoalBy === 'A' ? 'B' : 'A') : c;
          sfx.playAt('dg_goal', ring.x, ring.y, ring.z, {
            gain: 1,
            cooldown: 1,
            maxDistance: DG_SOUND_RANGE,
          });
          // The building reacting. Its own cue rather than the Vale Cup's
          // borrowed one, because that roar was recorded in air and this crowd
          // is heard through the glass (deepglass_audio.ts renderCrowdRoar).
          sfx.playAt('dg_crowd_roar', c.x, c.y, c.z, {
            gain: 0.75,
            cooldown: 1,
            maxDistance: DG_SOUND_RANGE,
          });
        }
      }
    }

    // ---- the ball being played ---------------------------------------------
    const ball = m.ball;
    const head = m.touches[0];
    if (ball && head && head.tick !== this.touch) {
      this.touch = head.tick;
      const pace = Math.hypot(ball.vx, ball.vy, ball.vz);
      if (head.kind === 'strike') {
        // Loud in proportion to what left the boot: a scuffed touch and a
        // rocket must not sound the same.
        const hard = Math.min(1, pace / DG_BALL_MAX_SPEED);
        sfx.playAt('dg_strike', ball.x, ball.y, ball.z, {
          gain: 0.45 + 0.55 * hard,
          rate: 1.12 - 0.22 * hard, // a harder strike is a DEEPER sound
          cooldown: 0.06,
          maxDistance: DG_SOUND_RANGE,
        });
        // Your OWN strike is felt as well as heard. Only yours: a bout is a
        // hundred strikes and shaking the camera for all of them is a headache
        // rather than feedback.
        if (head.pid === sim.playerId) {
          this.host.addShake(0.06 + 0.16 * hard);
          this.host.punchFov(1.4 + 2.2 * hard);
        }
      } else {
        this.bounce(m, head.pid, pace);
      }
    }
    // Sampled AFTER the touch is handled, so next frame's closing speed is the
    // ball as it was flying in.
    if (ball) {
      this.ballV.x = ball.vx;
      this.ballV.y = ball.vy;
      this.ballV.z = ball.vz;
    }

    // ---- what the bodies are doing -----------------------------------------
    // One bitmask per fighter (boost | dash | brake), so three edges cost one
    // map lookup on a roster that is at most ten bodies.
    for (const pid of m.teamA) this.bodyCue(pid);
    for (const pid of m.teamB) this.bodyCue(pid);

    // ---- the local player's own pickups and scrapes -------------------------
    const me = sim.player as {
      pos?: { x: number; y: number; z: number };
      vx?: number;
      vy?: number;
      vz?: number;
      dgFlight?: boolean;
      dgCharge?: number;
      dgPowerup?: string;
      dgTumbleTicks?: number;
    };
    if (!me.dgFlight || !me.pos) {
      this.atGlass = false;
      return;
    }
    // Spun out, a Check, or a heavy body arriving at pace. The one deepball
    // moment where the player loses the controls, so it gets the biggest kick.
    const tumble = me.dgTumbleTicks ?? 0;
    if (tumble > this.tumble) {
      this.host.addShake(0.42);
      this.host.punchFov(-4);
      sfx.playAt('dg_bump', me.pos.x, me.pos.y, me.pos.z, { gain: 0.9, cooldown: 0.2 });
    }
    this.tumble = tumble;

    const charge = me.dgCharge ?? 0;
    // A vent, not the trickle: the passive regen is 2.5/s, a small vent is 34.
    if (charge > this.charge + 12) {
      sfx.playAt('dg_vent', me.pos.x, me.pos.y, me.pos.z, { gain: 0.7, cooldown: 0.2 });
    }
    this.charge = charge;
    const held = me.dgPowerup ?? null;
    if (held !== null && held !== this.powerup) {
      sfx.playAt('dg_powerup', me.pos.x, me.pos.y, me.pos.z, { gain: 0.8, cooldown: 0.3 });
    }
    this.powerup = held;

    // The glass. Rising edge only, and only when the body arrives with pace:
    // resting against the wall must not chatter.
    const r = Math.hypot(me.pos.x - c.x, me.pos.y - c.y, me.pos.z - c.z);
    const atGlass = r > DEEPGLASS_PLAY_R - 0.6;
    if (atGlass && !this.atGlass) {
      const speed = Math.hypot(me.vx ?? 0, me.vy ?? 0, me.vz ?? 0);
      if (speed > 7) {
        sfx.playAt('dg_wall', me.pos.x, me.pos.y, me.pos.z, {
          gain: Math.min(1, 0.35 + speed / 40),
          cooldown: 0.25,
        });
        // Meeting the glass at boost pace should register in the body, not just
        // in the mix.
        this.host.addShake(Math.min(0.4, speed / 90));
      }
    }
    this.atGlass = atGlass;
    // The Zap Shot landing: blow the victim up where they float. The beam
    // itself is drawn by deepglass.ts off the same record; this is the body.
    const shot = deepglassLastBeam();
    if (shot?.hit && shot.tick !== this.zapTick) {
      this.zapTick = shot.tick;
      if (shot.victimId !== undefined) {
        this.host.zapBurst(shot.victimId);
        if (shot.victimId === sim.playerId) this.host.addShake(0.6);
      }
    }
  }

  /** Release every burner bed: the bout ended, or the roster went away. */
  stopBoostLoops(): void {
    for (const pid of this.boostLoops) sfx.unloop(`dg_boost_${pid}`, 0.25);
    this.boostLoops.clear();
  }

  /**
   * The ball coming off a body.
   *
   * Three layers rather than one clip at a volume (game/deepglass_audio.ts):
   * a light pock, the basketball proper, and a heavy shell layer stacked on top
   * for real hits, mixed by how hard the ball was actually met, which is the
   * whole point. A shoulder the ball rolls onto and a ball met head-on at boost
   * pace are the same EVENT and must not be the same sound.
   *
   * Hardness is the CLOSING speed (last frame's ball velocity against the
   * body's), not the ball's speed afterwards: the hardest contact in deepball
   * is a rocket trapped dead on a chest, which leaves the ball at nearly zero.
   * The post-contact speed still gets a vote for the opposite case, a slow
   * ball smashed away by a body arriving at pace.
   */
  private bounce(m: DgMatch, pid: number, postPace: number): void {
    const ball = m.ball;
    if (!ball) return;
    const body = this.host.sim.entities.get(pid) as
      | { vx?: number; vy?: number; vz?: number }
      | undefined;
    const closing = Math.hypot(
      this.ballV.x - (body?.vx ?? 0),
      this.ballV.y - (body?.vy ?? 0),
      this.ballV.z - (body?.vz ?? 0),
    );
    const impact = Math.max(closing, postPace);
    const mix = bounceMixFor(impact);
    // One cooldown across all three keys would be wrong (they are one sound in
    // three parts), so each carries its own short one: enough to stop a body
    // scraping along the ball from machine-gunning, short enough that a real
    // rally still sounds like a rally.
    const opts = { rate: mix.rate, cooldown: 0.05 };
    if (mix.soft > 0.01) {
      sfx.playAt('dg_bounce_soft', ball.x, ball.y, ball.z, { ...opts, gain: mix.soft });
    }
    if (mix.core > 0.01) {
      sfx.playAt('dg_bounce', ball.x, ball.y, ball.z, { ...opts, gain: mix.core });
    }
    if (mix.heavy > 0.01) {
      sfx.playAt('dg_bounce_hard', ball.x, ball.y, ball.z, { ...opts, gain: mix.heavy });
    }
    // Felt as well as heard, and only off your own body, same rule as the
    // strike, for the same reason.
    if (pid === this.host.sim.playerId && mix.heavy > 0.01) {
      this.host.addShake(0.05 + 0.14 * Math.min(1, impact / DG_BALL_MAX_SPEED));
    }
  }

  /**
   * The sustained half of the pack: a bed that runs for as long as the burners
   * are lit, under the ignition one-shot that starts it.
   *
   * Positional and per fighter, so a boost across the bell is a thing you hear
   * go past, which in a sport played at 26 yd/s is information, not decoration.
   * Gain and pitch both ride the body's actual speed: a bed at a fixed pitch
   * says only "lit", and the whole feel of the pack is the climb.
   */
  private boostBed(pid: number, e: FlyingBody): void {
    const id = `dg_boost_${pid}`;
    if (e.dgBoosting !== true) {
      if (this.boostLoops.delete(pid)) sfx.unloop(id, 0.22);
      return;
    }
    const drive = boostBedDrive(Math.hypot(e.vx ?? 0, e.vy ?? 0, e.vz ?? 0));
    sfx.loop(id, 'dg_boost', 0.16 + 0.26 * drive, e.pos.x, e.pos.y, e.pos.z);
    sfx.loopRate(id, 0.88 + 0.4 * drive);
    this.boostLoops.add(pid);
  }

  /** Dash / brake / ignition edges for one fighter, plus its burner bed. */
  private bodyCue(pid: number): void {
    const e = this.host.sim.entities.get(pid) as FlyingBody | undefined;
    if (!e?.dgFlight) {
      this.body.delete(pid);
      if (this.boostLoops.delete(pid)) sfx.unloop(`dg_boost_${pid}`, 0.22);
      return;
    }
    // Before the edge detection below: the bed has to follow the body every
    // frame, and that block returns early on any frame with no state change.
    this.boostBed(pid, e);
    const bits = bodyCueBits(e.dgBoosting === true, e.dgDashTicks ?? 0, e.dgBraking === true);
    const was = this.body.get(pid) ?? 0;
    this.body.set(pid, bits);
    if (bits === was) return;
    const cue = bodyCueFor(was, bits);
    if (cue === 'dash') {
      sfx.playAt('dg_dash', e.pos.x, e.pos.y, e.pos.z, {
        gain: 0.75,
        cooldown: 0.08,
        maxDistance: DG_SOUND_RANGE,
      });
    } else if (cue === 'brake') {
      sfx.playAt('dg_brake', e.pos.x, e.pos.y, e.pos.z, {
        gain: 0.6,
        cooldown: 0.2,
        maxDistance: DG_SOUND_RANGE,
      });
    } else if (cue === 'ignite') {
      sfx.playAt('dg_ignite', e.pos.x, e.pos.y, e.pos.z, {
        gain: 0.55,
        cooldown: 0.15,
        maxDistance: DG_SOUND_RANGE,
      });
    }
  }
}
