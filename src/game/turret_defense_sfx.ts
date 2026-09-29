// Fire and Fly sounds: the cannon's report at the muzzle, the shell's blast where
// it lands, a barrel's heavier boom, the crunch of a monster's strike on the
// turret, and the monsters' cries,
// thumps and knocks (turret_monster_sfx.ts),
// each read once per feedback entry (by sequence number) from the seat HUD's
// frame. Every clip a seat can play is preloaded when the seat is first seen.
// The player's own shot reports on the click, from the own-shot ledger
// (turret_own_shot_core.ts); the `fired` entry it confirms plays nothing more.

import type { TurretEvent } from '../sim/minigames/turret_defense';
import { TurretFeedbackReader } from '../ui/hud/vehicle/turret_feedback_reader_core';
import { turretHitStrength } from '../ui/hud/vehicle/turret_hit_feedback_core';
import type { TurretOwnShotLedger } from '../ui/hud/vehicle/turret_own_shot_core';
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
const SEAT_SFX = [
  TURRET_FIRE_SFX,
  TURRET_IMPACT_SFX,
  TURRET_BARREL_SFX,
  TURRET_BREACH_SFX,
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
  out.key = TURRET_BREACH_SFX;
  out.x = at.x;
  out.y = at.y;
  out.z = at.z;
  out.gain = 1 + 0.5 * strength;
  out.rate = 0.95 - 0.2 * strength;
  out.jitter = true;
  return out;
}

/** The cannon's report for a shot from (fromX, fromZ) toward (x, z), at the muzzle. */
export function turretFireCueInto(
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
  origin: { readonly y: number },
  out: TurretSfxCue,
): TurretSfxCue {
  const dx = x - fromX;
  const dz = z - fromZ;
  const dist = Math.hypot(dx, dz);
  out.key = TURRET_FIRE_SFX;
  out.x = fromX + (dist > 1e-6 ? dx / dist : 0) * MUZZLE_REACH;
  out.y = origin.y + MUZZLE_LIFT;
  out.z = fromZ + (dist > 1e-6 ? dz / dist : 1) * MUZZLE_REACH;
  out.gain = 1.25;
  out.rate = 1;
  out.jitter = false;
  return out;
}

/**
 * The sound an engine event makes, written into `out`; null for a silent event.
 * A breach is silent here: a frame's strikes play once, through turretBreachCueInto.
 */
export function turretSfxCueInto(
  event: TurretEvent,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  out: TurretSfxCue,
): TurretSfxCue | null {
  if (event.type === 'fired') {
    return turretFireCueInto(event.fromX, event.fromZ, event.x, event.z, origin, out);
  }
  if (event.type === 'barrelExploded') {
    const size = turretBlastSize(event.hits);
    out.key = TURRET_BARREL_SFX;
    out.x = event.x;
    out.y = event.y;
    out.z = event.z;
    turretHeardInto(origin, out);
    out.gain = 1.5 + 0.3 * size;
    out.rate = 0.95 + 0.1 * size;
    out.jitter = true;
    return out;
  }
  if (event.type === 'impact') {
    const size = turretBlastSize(event.hits);
    out.key = TURRET_IMPACT_SFX;
    out.x = event.x;
    out.y = event.y;
    out.z = event.z;
    turretHeardInto(origin, out);
    out.gain = (0.65 + 0.25 * size) * 1.5;
    out.rate = 0.9 + 0.2 * size;
    out.jitter = true;
    return out;
  }
  return null;
}

export class TurretDefenseSfx {
  private readonly reader = new TurretFeedbackReader();
  private readonly monsters: TurretMonsterSfx;
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
    private readonly shots: TurretOwnShotLedger = turretOwnShots,
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
      for (const key of SEAT_SFX) this.preload(key);
      for (const key of turretVoiceKeys(session.defense.plan, this.voiceCue)) this.preload(key);
    }
    this.reportOwnShots(session, clock);
    if (fresh.length === 0) return;
    const now = this.now();
    this.origin = session.origin;
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
      const cue = turretSfxCueInto(event, session.origin, this.cue);
      if (cue) this.play(cue);
      else this.monsters.offer(event, session, now);
    }
    if (strongest) this.play(turretBreachCueInto(breachPoints, strongest, this.cue));
    this.monsters.flush(now, this.playHeard);
  }

  /** The report of every own shot marked since the last read, on the click's frame. */
  private reportOwnShots(session: TurretSessionView, clock: number | null): void {
    for (let shot = this.shots.launchAfter(session, this.launched); shot; ) {
      this.launched = shot.serial;
      if (clock === null || shot.clock >= clock - STALE_TICKS) {
        this.play(
          turretFireCueInto(shot.fromX, shot.fromZ, shot.x, shot.z, session.origin, this.cue),
        );
      }
      shot = this.shots.launchAfter(session, this.launched);
    }
  }

  private readonly playHeard = (cue: TurretSfxCue): void => {
    turretHeardInto(this.origin, cue);
    this.play(cue);
  };

  private play(cue: TurretSfxCue): void {
    this.sink.playAt(cue.key, cue.x, cue.y, cue.z, {
      gain: cue.gain,
      rate: cue.rate,
      jitter: cue.jitter,
    });
  }

  private preload(key: string): void {
    if (this.preloaded.has(key)) return;
    this.preloaded.add(key);
    this.sink.preload(key);
  }
}
