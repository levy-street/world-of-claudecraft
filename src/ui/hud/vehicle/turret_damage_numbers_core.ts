// Fire and Fly damage numbers: every shell or barrel blast hit and every bowling
// knock floats its damage over the struck body, where the sim says it stood, through the HUD's own
// floating combat text. A core hit reads as a crit. A fragmentation shell whose
// bomblets struck enough distinct monsters pops one "xN" over its burst as its
// last bomblet lands. Each feedback entry spawns its numbers once, however often
// the same view is read.
import { TURRET_FRAGMENTATION } from '../../../sim/content/turret_defense';
import { TURRET_BOMBLETS } from '../../../sim/minigames/turret_fragmentation';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { FCT_ANCHOR_HEAD_OFFSET, type FctEvent } from '../../fct_core';
import { formatNumber, t } from '../../i18n';
import { TurretFeedbackReader } from './turret_feedback_reader_core';

export type TurretFctSpawn = (event: FctEvent, now: number) => void;

/** Distinct monsters one frag shell's bomblets must strike for its callout. */
export const TURRET_MULTI_HIT_MIN = 6;
/** A frag still tracked this many ticks after its burst lost its last bomblet (a run that ended). */
const FRAG_FORGET_TICKS = 60;

interface FragTally {
  readonly burstTick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly struck: Set<number>;
}

/** A number rises from this share of the struck body's height (the FCT anchors over a head). */
const HEAD_CLEARANCE = 1.1;
/**
 * An entry older than this many ticks at its first read floats nothing: a seat joined
 * late, or a stall long enough that the moment has passed.
 */
const STALE_TICKS = 10;

interface Anchor {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: number;
}

/** The struck body's height; a body the engine already dropped clears the plan's tallest kind. */
function heightOf(session: TurretSessionView, id: number): number {
  const kinds = session.defense.plan.kinds;
  const monster = session.defense.monsters.find((m) => m.id === id);
  const height = monster ? kinds[monster.kind]?.height : undefined;
  if (height !== undefined) return height;
  let tallest = 0;
  for (const kind of kinds) tallest = Math.max(tallest, kind.height);
  return tallest;
}

function anchorAt(session: TurretSessionView, id: number, x: number, y: number, z: number): Anchor {
  const height = heightOf(session, id);
  const scale = height > 0 ? (height * HEAD_CLEARANCE) / FCT_ANCHOR_HEAD_OFFSET : 1;
  return { pos: { x, y, z }, scale };
}

/** The FCT's own damage text: the amount, and a bang for a crit. */
export function turretDamageText(damage: number, crit: boolean): string {
  return `${damage}${crit ? '!' : ''}`;
}

/** The callout's text for `count` distinct monsters struck. */
export function turretMultiHitText(count: number): string {
  return t('hudChrome.turret.fragMultiHit', { count: formatNumber(count) });
}

export class TurretDamageNumbers {
  private readonly reader = new TurretFeedbackReader();
  private readonly frags = new Map<number, FragTally>();

  /** `now` is the FCT painter's frame clock, read only when a number spawns. */
  constructor(
    private readonly spawn: TurretFctSpawn,
    private readonly now: () => number,
  ) {}

  /** `clock` is the seat's sim tick (IWorld.turretClock), null when unknown. */
  update(session: TurretSessionView | null, clock: number | null): void {
    if (!session) return;
    const fresh = this.reader.read(session);
    if (this.reader.newSeat) this.frags.clear();
    if (fresh.length === 0) return;
    let now: number | null = null;
    for (const entry of fresh) {
      const event = entry.event;
      const stale = clock !== null && entry.tick < clock - STALE_TICKS;
      if (event.type === 'fragBurst') {
        this.forgetBefore(entry.tick - FRAG_FORGET_TICKS);
        const { x, y, z } = event;
        this.frags.set(event.shotId, { burstTick: entry.tick, x, y, z, struck: new Set() });
        continue;
      }
      if (event.type === 'bomblet') {
        const frag = this.frags.get(event.shotId);
        if (!frag) continue;
        for (const hit of event.hits) frag.struck.add(hit.id);
        if (event.index < TURRET_BOMBLETS - 1) continue;
        this.frags.delete(event.shotId);
        if (stale || frag.struck.size < TURRET_MULTI_HIT_MIN) continue;
        now ??= this.now();
        this.callout(frag, turretMultiHitText(frag.struck.size), now);
        continue;
      }
      if (stale) continue;
      if (event.type === 'impact' || event.type === 'barrelExploded') {
        for (const hit of event.hits) {
          now ??= this.now();
          this.float(session, hit.id, hit.x, hit.y, hit.z, hit.damage, hit.falloff >= 1, now);
        }
      } else if (event.type === 'bowled') {
        now ??= this.now();
        this.float(session, event.struckId, event.x, event.y, event.z, event.damage, false, now);
      }
    }
  }

  private forgetBefore(tick: number): void {
    for (const [shotId, frag] of this.frags) if (frag.burstTick < tick) this.frags.delete(shotId);
  }

  /** The "xN" pop at the burst's height over its aim point, as big as a crit. */
  private callout(frag: FragTally, text: string, now: number): void {
    const lift = TURRET_FRAGMENTATION.burstHeight;
    this.spawn(
      {
        kind: 'damage-done-ability',
        text,
        target: {
          pos: { x: frag.x, y: frag.y - lift, z: frag.z },
          scale: lift / FCT_ANCHOR_HEAD_OFFSET,
        },
        crit: true,
        isSelf: false,
      },
      now,
    );
  }

  private float(
    session: TurretSessionView,
    id: number,
    x: number,
    y: number,
    z: number,
    damage: number,
    crit: boolean,
    now: number,
  ): void {
    this.spawn(
      {
        kind: 'damage-done-ability',
        text: turretDamageText(damage, crit),
        target: anchorAt(session, id, x, y, z),
        crit,
        isSelf: false,
      },
      now,
    );
  }
}
