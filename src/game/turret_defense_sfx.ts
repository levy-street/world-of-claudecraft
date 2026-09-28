// Fire and Fly sounds: the cannon's report at the muzzle, the shell's blast where
// it lands, and the monsters' cries, thumps and knocks (turret_monster_sfx.ts),
// each read once per feedback entry (by sequence number) from the seat HUD's
// frame. Every clip a seat can play is preloaded when the seat is first seen.

import type { TurretEvent } from '../sim/minigames/turret_defense';
import { TurretFeedbackReader } from '../ui/hud/vehicle/turret_feedback_reader_core';
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
const SEAT_SFX = [
  TURRET_FIRE_SFX,
  TURRET_IMPACT_SFX,
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

/** The sound an engine event makes, written into `out`; null for a silent event. */
export function turretSfxCueInto(
  event: TurretEvent,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  out: TurretSfxCue,
): TurretSfxCue | null {
  if (event.type === 'fired') {
    const dx = event.x - event.fromX;
    const dz = event.z - event.fromZ;
    const dist = Math.hypot(dx, dz);
    out.key = TURRET_FIRE_SFX;
    out.x = event.fromX + (dist > 1e-6 ? dx / dist : 0) * MUZZLE_REACH;
    out.y = origin.y + MUZZLE_LIFT;
    out.z = event.fromZ + (dist > 1e-6 ? dz / dist : 1) * MUZZLE_REACH;
    out.gain = 1.25;
    out.rate = 1;
    out.jitter = false;
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
  ) {
    this.monsters = new TurretMonsterSfx(voiceCue);
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
    if (fresh.length === 0) return;
    const now = this.now();
    this.origin = session.origin;
    for (const entry of fresh) {
      if (clock !== null && entry.tick < clock - STALE_TICKS) continue;
      const cue = turretSfxCueInto(entry.event, session.origin, this.cue);
      if (cue) this.play(cue);
      else this.monsters.offer(entry.event, session, now);
    }
    this.monsters.flush(now, this.playHeard);
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
