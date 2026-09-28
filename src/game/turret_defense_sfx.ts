// Fire and Fly sounds: the cannon's report at the muzzle and the shell's blast
// where it lands, each played once per feedback entry (by sequence number) from
// the seat HUD's frame. Both samples are preloaded the first time a seat is seen.
import type { TurretEvent } from '../sim/minigames/turret_defense';
import { turretFeedbackSince } from '../sim/minigames/turret_feedback';
import type { TurretSessionView } from '../world_api/vehicles';
import { type PlayOpts, sfx } from './sfx';

export const TURRET_FIRE_SFX = 'proj_groundshaker';
export const TURRET_IMPACT_SFX = 'impact_groundshaker';

/** The muzzle sits this high over the turret and this far toward the shot. */
const MUZZLE_LIFT = 2.2;
const MUZZLE_REACH = 2;
/**
 * A blast is heard from a point pulled toward the turret: yards past NEAR count
 * for FAR_SHARE of a yard, so a shell landing at the edge of the field stays
 * inside the one-shot cutoff (sfx MAX_DISTANCE, measured from the camera behind
 * the tank) instead of going silent. The direction is kept.
 */
const NEAR = 8;
const FAR_SHARE = 0.35;
/** An entry older than this many ticks at its first read (a seat joined late) plays nothing. */
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
    const dx = event.x - origin.x;
    const dz = event.z - origin.z;
    const dist = Math.hypot(dx, dz);
    const heard = dist > NEAR ? NEAR + (dist - NEAR) * FAR_SHARE : dist;
    const pull = dist > 1e-6 ? heard / dist : 1;
    out.key = TURRET_IMPACT_SFX;
    out.x = origin.x + dx * pull;
    out.y = event.y;
    out.z = origin.z + dz * pull;
    out.gain = (0.65 + 0.25 * size) * 1.5;
    out.rate = 0.9 + 0.2 * size;
    out.jitter = true;
    return out;
  }
  return null;
}

export class TurretDefenseSfx {
  private startTick: number | null = null;
  private lastSeq = 0;
  private preloaded = false;
  private readonly cue: TurretSfxCue = {
    key: '',
    x: 0,
    y: 0,
    z: 0,
    gain: 1,
    rate: 1,
    jitter: true,
  };

  constructor(private readonly sink: TurretSfxSink = sfx) {}

  /** `clock` is the seat's sim tick (IWorld.turretClock), null when unknown. */
  update(session: TurretSessionView | null, clock: number | null = null): void {
    if (!session) return;
    if (!this.preloaded) {
      this.preloaded = true;
      this.sink.preload(TURRET_FIRE_SFX);
      this.sink.preload(TURRET_IMPACT_SFX);
    }
    const ring = session.feedback;
    const newest = ring.length ? ring[ring.length - 1].seq : 0;
    // A new seat: a new start tick, or a sequence that went back (a seat taken
    // again within the same tick).
    if (session.defense.startTick !== this.startTick || newest < this.lastSeq) {
      this.startTick = session.defense.startTick;
      this.lastSeq = 0;
    }
    if (newest <= this.lastSeq) return;
    for (const entry of turretFeedbackSince(ring, this.lastSeq)) {
      this.lastSeq = entry.seq;
      if (clock !== null && entry.tick < clock - STALE_TICKS) continue;
      const cue = turretSfxCueInto(entry.event, session.origin, this.cue);
      if (!cue) continue;
      this.sink.playAt(cue.key, cue.x, cue.y, cue.z, {
        gain: cue.gain,
        rate: cue.rate,
        jitter: cue.jitter,
      });
    }
  }
}
