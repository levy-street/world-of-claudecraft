// Fire and Fly sounds: the cannon's report at the muzzle, the shell's blast where
// it lands, a barrel's heavier boom, the crunch of a monster's strike on the
// turret, the limited weapons (the Shockwave's slam and roll, the frag shell's
// burst and its bomblets), and the monsters' cries, thumps and knocks
// (turret_monster_sfx.ts), each read once per feedback entry (by sequence
// number) from the seat HUD's frame. Every clip a seat can play is preloaded
// when the seat is first seen. The player's own shot and Shockwave report on the
// click, from the own-shot ledger (turret_own_shot_core.ts); the `fired` or
// `shockwave` entry it confirms plays that report no more.

import type { TurretEvent } from '../sim/minigames/turret_defense';
import type { TurretFeedback } from '../sim/minigames/turret_feedback';
import { TURRET_BOMBLETS } from '../sim/minigames/turret_fragmentation';
import { TurretFeedbackReader } from '../ui/hud/vehicle/turret_feedback_reader_core';
import { turretHitStrength } from '../ui/hud/vehicle/turret_hit_feedback_core';
import { turretOwnShots } from '../ui/hud/vehicle/turret_own_shots';
import { availableMobVoiceCue } from '../ui/hud_voice_cues';
import type { TurretSessionView } from '../world_api/vehicles';
import { type PlayOpts, sfx } from './sfx';
import {
  TURRET_KNOCK_SFX,
  TURRET_THUMP_HEAVY_SFX,
  TURRET_THUMP_LIGHT_SFX,
  TurretMonsterSfx,
  type TurretVoiceCue,
  turretVoiceKeys,
} from './turret_monster_sfx';

export const TURRET_FIRE_SFX = 'proj_groundshaker';
export const TURRET_IMPACT_SFX = 'impact_groundshaker';
/** A barrel blowing: the meteor's bass-heavy blast and long rumble, a size above the shell's. */
export const TURRET_BARREL_SFX = 'meteor';
/** The turret taking a monster's blow: a heavy shield smashing plate. */
export const TURRET_BREACH_SFX = 'impact_warrior_faultline';
/** The tower slamming for a Shockwave: an earth boom, never the breach's loss crunch. */
export const TURRET_SLAM_SFX = 'impact_warrior_quake';
/** The Shockwave's ring rolling out from the tower's foot. */
export const TURRET_ROLL_SFX = 'melee_warrior_quake_release';
/** A frag shell cracking open in the air over its point. */
export const TURRET_FRAG_BURST_SFX = 'impact_warrior_shieldcrack';
/** Each bomblet: the shell's blast, lighter and brighter. */
export const TURRET_BOMBLET_SFX = TURRET_IMPACT_SFX;
/** Bomblet voices sounding at once (started within the last TURRET_BOMBLET_VOICE_MS). */
export const TURRET_BOMBLET_VOICES = 4;
/**
 * How long a bomblet counts as sounding: the loud head of its cut boom. A frag's six
 * land one tick (50 ms) apart, so its own ripple keeps at most three sounding, a
 * frame of jitter included; only overlapping bursts or a read that bunches them
 * reach the cap.
 */
export const TURRET_BOMBLET_VOICE_MS = 150;
/**
 * The least time between two bomblet starts: two started together stack in phase.
 * Under a frag's own 50 ms spacing read a frame early, so its ripple is never held.
 */
export const TURRET_BOMBLET_GAP_MS = 30;
const BOMBLET_GAIN = 0.45;
const BOMBLET_RATE = 1.4;
/** A bomblet's boom is cut to this (seconds) so six do not pile their long tails; the last keeps its tail. */
const BOMBLET_RELEASE = 0.3;
/** Own cooldown namespaces: the ripple is not throttled by, nor throttles, a shell's blast or a knock. */
const BOMBLET_COOLDOWN = 'turret_bomblet';
const SLAM_COOLDOWN = 'turret_slam';
const SEAT_SFX = [
  TURRET_FIRE_SFX,
  TURRET_IMPACT_SFX,
  TURRET_BARREL_SFX,
  TURRET_BREACH_SFX,
  TURRET_SLAM_SFX,
  TURRET_ROLL_SFX,
  TURRET_FRAG_BURST_SFX,
  TURRET_THUMP_LIGHT_SFX,
  TURRET_THUMP_HEAVY_SFX,
  TURRET_KNOCK_SFX,
] as const;

/** The muzzle sits this high over the turret and this far toward the shot. */
const MUZZLE_LIFT = 2.2;
const MUZZLE_REACH = 2;
/**
 * Field sounds are heard from a point pulled toward the turret: yards past NEAR
 * count for FAR_SHARE of a yard, so a shell landing or a body falling at the edge
 * of the field stays inside the one-shot cutoff (sfx MAX_DISTANCE, measured from
 * the camera behind the tank) instead of going silent. The direction is kept.
 */
const NEAR = 8;
const FAR_SHARE = 0.35;
/**
 * An entry older than this many ticks at its first read plays nothing: a seat joined
 * late, or a stall long enough that the moment has passed.
 */
const STALE_TICKS = 10;

type TurretBreach = Extract<TurretEvent, { type: 'breach' }>;

export interface TurretSfxSink {
  playAt(key: string, x: number, y: number, z: number, opts?: PlayOpts): boolean;
  preload(key: string): void;
}

export interface TurretSfxCue {
  key: string;
  x: number;
  y: number;
  z: number;
  gain: number;
  rate: number;
  jitter: boolean;
  /** The cooldown namespace (PlayOpts.cooldownKey); absent or '' for the key's own. */
  cooldownKey?: string;
  /** Seconds the clip is cut to (PlayOpts.release); absent or 0 plays it whole. */
  release?: number;
  /** Seconds between plays in its namespace (PlayOpts.cooldown); absent for the sink's default. */
  cooldown?: number;
}

/** What the sound reads of an own shot; `weapon` is the mark's limited weapon, absent on a shell. */
export interface TurretSfxOwnShot {
  readonly serial: number;
  readonly clock: number;
  readonly fromX: number;
  readonly fromZ: number;
  readonly x: number;
  readonly z: number;
  readonly weapon?: 'frag' | 'shock';
}

/** The own-shot ledger as the sound reads it (TurretOwnShotLedger). */
export interface TurretSfxShots {
  readonly newestSerial: number;
  launchAfter(session: TurretSessionView, serial: number): TurretSfxOwnShot | null;
  ownShotOf(session: TurretSessionView, entry: TurretFeedback): number;
}

function cueInto(
  out: TurretSfxCue,
  key: string,
  x: number,
  y: number,
  z: number,
  gain: number,
  rate: number,
  jitter: boolean,
): TurretSfxCue {
  out.key = key;
  out.x = x;
  out.y = y;
  out.z = z;
  out.gain = gain;
  out.rate = rate;
  out.jitter = jitter;
  out.cooldownKey = '';
  out.release = 0;
  out.cooldown = undefined;
  return out;
}

/** Pulls `point` toward the turret along its bearing (see NEAR). */
export function turretHeardInto(
  origin: { readonly x: number; readonly z: number },
  point: { x: number; z: number },
): void {
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  const dist = Math.hypot(dx, dz);
  const heard = dist > NEAR ? NEAR + (dist - NEAR) * FAR_SHARE : dist;
  const pull = dist > 1e-6 ? heard / dist : 1;
  point.x = origin.x + dx * pull;
  point.z = origin.z + dz * pull;
}

/** How big a blast was, 0 to 1: its strongest hit, plus a little per extra body caught. */
export function turretBlastSize(hits: readonly { readonly falloff: number }[]): number {
  if (hits.length === 0) return 0;
  let strongest = 0;
  for (const hit of hits) strongest = Math.max(strongest, hit.falloff);
  return Math.min(1, strongest + 0.15 * (hits.length - 1));
}

/**
 * The turret's crunch for `points` lost in one frame, at the strongest strike: louder
 * and deeper the more it cost.
 */
export function turretBreachCueInto(
  points: number,
  at: { readonly x: number; readonly y: number; readonly z: number },
  out: TurretSfxCue,
): TurretSfxCue {
  const strength = turretHitStrength(points);
  return cueInto(
    out,
    TURRET_BREACH_SFX,
    at.x,
    at.y,
    at.z,
    1 + 0.5 * strength,
    0.95 - 0.2 * strength,
    true,
  );
}

/**
 * The cannon's report for a shot from (fromX, fromZ) toward (x, z), at the muzzle;
 * a frag shell's is the same cannon, a little lighter.
 */
export function turretFireCueInto(
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
  origin: { readonly y: number },
  out: TurretSfxCue,
  weapon?: 'frag',
): TurretSfxCue {
  const dx = x - fromX;
  const dz = z - fromZ;
  const dist = Math.hypot(dx, dz);
  const frag = weapon === 'frag';
  return cueInto(
    out,
    TURRET_FIRE_SFX,
    fromX + (dist > 1e-6 ? dx / dist : 0) * MUZZLE_REACH,
    origin.y + MUZZLE_LIFT,
    fromZ + (dist > 1e-6 ? dz / dist : 1) * MUZZLE_REACH,
    frag ? 1.15 : 1.25,
    frag ? 1.1 : 1,
    false,
  );
}

/** The tower's slam for a Shockwave, at its foot. */
export function turretSlamCueInto(
  x: number,
  y: number,
  z: number,
  out: TurretSfxCue,
): TurretSfxCue {
  cueInto(out, TURRET_SLAM_SFX, x, y, z, 1.4, 0.85, true);
  out.cooldownKey = SLAM_COOLDOWN;
  return out;
}

/**
 * The sound an engine event makes, written into `out`; null for a silent event.
 * A breach is silent here: a frame's strikes play once, through turretBreachCueInto.
 * A Shockwave's entry gives its ring's roll; its slam is turretSlamCueInto, played
 * on the click for an own Shockwave. A Shockwave's hits are silent: the bodies it
 * throws cry through their `launched` entries.
 */
export function turretSfxCueInto(
  event: TurretEvent,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  out: TurretSfxCue,
): TurretSfxCue | null {
  switch (event.type) {
    case 'fired':
      return turretFireCueInto(
        event.fromX,
        event.fromZ,
        event.x,
        event.z,
        origin,
        out,
        event.weapon,
      );
    case 'barrelExploded': {
      const size = turretBlastSize(event.hits);
      cueInto(
        out,
        TURRET_BARREL_SFX,
        event.x,
        event.y,
        event.z,
        1.5 + 0.3 * size,
        0.95 + 0.1 * size,
        true,
      );
      break;
    }
    case 'impact': {
      const size = turretBlastSize(event.hits);
      const gain = (0.65 + 0.25 * size) * 1.5;
      cueInto(out, TURRET_IMPACT_SFX, event.x, event.y, event.z, gain, 0.9 + 0.2 * size, true);
      break;
    }
    case 'shockwave':
      // The ring's rumble, always from the entry: the ring is timed on it, not on the click.
      return cueInto(out, TURRET_ROLL_SFX, event.x, event.y, event.z, 0.6, 0.8, true);
    case 'fragBurst':
      cueInto(out, TURRET_FRAG_BURST_SFX, event.x, event.y, event.z, 1.3, 1, true);
      break;
    case 'bomblet':
      cueInto(out, TURRET_BOMBLET_SFX, event.x, event.y, event.z, BOMBLET_GAIN, BOMBLET_RATE, true);
      out.cooldownKey = BOMBLET_COOLDOWN;
      // TurretBombletVoices spaces the starts; the sink's cooldown, on the audio
      // clock, could refuse a start it admits.
      out.cooldown = 0;
      out.release = event.index === TURRET_BOMBLETS - 1 ? 0 : BOMBLET_RELEASE;
      break;
    default:
      return null;
  }
  turretHeardInto(origin, out);
  return out;
}

/**
 * When a bomblet's boom may start: TURRET_BOMBLET_GAP_MS after the last one, and
 * while fewer than TURRET_BOMBLET_VOICES sound. Only a boom the sink started counts.
 */
export class TurretBombletVoices {
  private readonly started = new Float64Array(TURRET_BOMBLET_VOICES).fill(Number.NEGATIVE_INFINITY);
  private last = Number.NEGATIVE_INFINITY;

  ready(now: number): boolean {
    if (now - this.last < TURRET_BOMBLET_GAP_MS) return false;
    let sounding = 0;
    for (const at of this.started) if (now - at < TURRET_BOMBLET_VOICE_MS) sounding++;
    return sounding < TURRET_BOMBLET_VOICES;
  }

  start(now: number): void {
    let oldest = 0;
    for (let i = 1; i < this.started.length; i++) {
      if (this.started[i] < this.started[oldest]) oldest = i;
    }
    this.started[oldest] = now;
    this.last = now;
  }

  reset(): void {
    this.started.fill(Number.NEGATIVE_INFINITY);
    this.last = Number.NEGATIVE_INFINITY;
  }
}

export class TurretDefenseSfx {
  private readonly reader = new TurretFeedbackReader();
  private readonly monsters: TurretMonsterSfx;
  private readonly bomblets = new TurretBombletVoices();
  /** Bomblets read while the gap or the cap held them, oldest first; a frag's worth at most. */
  private readonly waiting: TurretFeedback[] = [];
  private readonly preloaded = new Set<string>();
  /** The newest own-shot serial already reported; a rebuilt player starts past the page's. */
  private launched: number;
  private origin: { readonly x: number; readonly z: number } = { x: 0, z: 0 };
  private readonly cue: TurretSfxCue = {
    key: '',
    x: 0,
    y: 0,
    z: 0,
    gain: 1,
    rate: 1,
    jitter: true,
  };

  /** `now` is a millisecond clock for the monster sounds' gaps. */
  constructor(
    private readonly sink: TurretSfxSink = sfx,
    private readonly voiceCue: TurretVoiceCue = availableMobVoiceCue,
    private readonly now: () => number = () => performance.now(),
    private readonly shots: TurretSfxShots = turretOwnShots,
  ) {
    this.monsters = new TurretMonsterSfx(voiceCue);
    this.launched = shots.newestSerial;
  }

  /** `clock` is the seat's sim tick (IWorld.turretClock), null when unknown. */
  update(session: TurretSessionView | null, clock: number | null = null): void {
    if (!session) return;
    const fresh = this.reader.read(session);
    if (this.reader.newSeat) {
      this.monsters.reset();
      this.bomblets.reset();
      this.waiting.length = 0;
      for (const key of SEAT_SFX) this.preload(key);
      for (const key of turretVoiceKeys(session.defense.plan, this.voiceCue)) this.preload(key);
    }
    this.reportOwnShots(session, clock);
    if (fresh.length === 0 && this.waiting.length === 0) return;
    const now = this.now();
    this.origin = session.origin;
    this.startWaitingBomblet(session, clock, now);
    let breachPoints = 0;
    let strongest: TurretBreach | null = null;
    for (const entry of fresh) {
      if (clock !== null && entry.tick < clock - STALE_TICKS) continue;
      const event = entry.event;
      if (event.type === 'breach') {
        breachPoints += event.points;
        if (!strongest || event.points > strongest.points) strongest = event;
        continue;
      }
      if (event.type === 'fired' && this.shots.ownShotOf(session, entry) !== 0) continue;
      if (event.type === 'shockwave' && this.shots.ownShotOf(session, entry) === 0) {
        this.play(turretSlamCueInto(event.x, event.y, event.z, this.cue));
      }
      if (event.type === 'bomblet') {
        this.offerBomblet(entry, session, now);
        continue;
      }
      const cue = turretSfxCueInto(event, session.origin, this.cue);
      if (cue) this.play(cue);
      else this.monsters.offer(event, session, now);
    }
    if (strongest) this.play(turretBreachCueInto(breachPoints, strongest, this.cue));
    this.monsters.flush(now, this.playHeard);
  }

  /** A bomblet starts now if nothing waits before it and the voices allow, else waits its turn. */
  private offerBomblet(entry: TurretFeedback, session: TurretSessionView, now: number): void {
    if (this.waiting.length === 0 && this.bomblets.ready(now))
      this.startBomblet(entry, session, now);
    else if (this.waiting.length < TURRET_BOMBLETS) this.waiting.push(entry);
  }

  /** The oldest waiting bomblet still fresh starts once the voices allow. */
  private startWaitingBomblet(session: TurretSessionView, clock: number | null, now: number): void {
    while (
      clock !== null &&
      this.waiting.length > 0 &&
      this.waiting[0].tick < clock - STALE_TICKS
    ) {
      this.waiting.shift();
    }
    const next = this.waiting[0];
    if (!next || !this.bomblets.ready(now)) return;
    this.waiting.shift();
    this.startBomblet(next, session, now);
  }

  private startBomblet(entry: TurretFeedback, session: TurretSessionView, now: number): void {
    const cue = turretSfxCueInto(entry.event, session.origin, this.cue);
    if (cue && this.play(cue)) this.bomblets.start(now);
  }

  /** The report of every own shot marked since the last read, on the click's frame. */
  private reportOwnShots(session: TurretSessionView, clock: number | null): void {
    for (let shot = this.shots.launchAfter(session, this.launched); shot; ) {
      this.launched = shot.serial;
      if (clock === null || shot.clock >= clock - STALE_TICKS) this.reportOwnShot(session, shot);
      shot = this.shots.launchAfter(session, this.launched);
    }
  }

  /** A Shockwave's slam at the tower, else the cannon's report (the frag's, lighter). */
  private reportOwnShot(session: TurretSessionView, shot: TurretSfxOwnShot): void {
    const { fromX, fromZ, weapon } = shot;
    if (weapon === 'shock') {
      this.play(turretSlamCueInto(fromX, session.origin.y, fromZ, this.cue));
      return;
    }
    this.play(turretFireCueInto(fromX, fromZ, shot.x, shot.z, session.origin, this.cue, weapon));
  }

  private readonly playHeard = (cue: TurretSfxCue): void => {
    turretHeardInto(this.origin, cue);
    this.play(cue);
  };

  private play(cue: TurretSfxCue): boolean {
    const opts: PlayOpts = { gain: cue.gain, rate: cue.rate, jitter: cue.jitter };
    if (cue.cooldownKey) opts.cooldownKey = cue.cooldownKey;
    if (cue.release) opts.release = cue.release;
    if (cue.cooldown !== undefined) opts.cooldown = cue.cooldown;
    return this.sink.playAt(cue.key, cue.x, cue.y, cue.z, opts);
  }

  private preload(key: string): void {
    if (this.preloaded.has(key)) return;
    this.preloaded.add(key);
    this.sink.preload(key);
  }
}
