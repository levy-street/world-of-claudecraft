// Fire and Fly damage numbers: every shell or barrel blast hit and every bowling
// knock floats its damage over the struck body, where the sim says it stood, through the HUD's own
// floating combat text. A core hit reads as a crit. Each feedback entry spawns
// its numbers once, however often the same view is read.
import type { TurretSessionView } from '../../../world_api/vehicles';
import { FCT_ANCHOR_HEAD_OFFSET, type FctEvent } from '../../fct_core';
import { TurretFeedbackReader } from './turret_feedback_reader_core';

export type TurretFctSpawn = (event: FctEvent, now: number) => void;

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

export class TurretDamageNumbers {
  private readonly reader = new TurretFeedbackReader();

  /** `now` is the FCT painter's frame clock, read only when a number spawns. */
  constructor(
    private readonly spawn: TurretFctSpawn,
    private readonly now: () => number,
  ) {}

  /** `clock` is the seat's sim tick (IWorld.turretClock), null when unknown. */
  update(session: TurretSessionView | null, clock: number | null): void {
    if (!session) return;
    const fresh = this.reader.read(session);
    if (fresh.length === 0) return;
    let now: number | null = null;
    for (const entry of fresh) {
      if (clock !== null && entry.tick < clock - STALE_TICKS) continue;
      const event = entry.event;
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
