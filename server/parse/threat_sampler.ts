// Threat sampling: the sim keeps a real hate table per mob (`Entity.threat`,
// `src/sim/threat.ts`) and nothing ever emitted it, so the dashboard could show
// what everyone did but never why the boss turned around. This samples the top
// of each tracked mob's table once a second, the cadence the plan reserves for
// continuous streams (section 5.3), and ships it as the contract's
// `SampleRecord` with kind 'threat'.
//
// Read-only like the rest of the recorder: it reads the structural entity view
// and never touches sim state.
//
// Wire layout of `data`, one flat number array per sampled mob:
//   [mobId, aggroTargetId, srcA, threatA, srcB, threatB, ...]
// Entries are highest threat first, capped at TOP_THREAT_ENTRIES. aggroTargetId
// is 0 when the mob is not currently locked on anyone, which keeps every entry
// a plain number array (cheap to JSON, cheap to parse). Source ids are the hate
// table's own keys: a pet's threat sits under the PET's entity id, exactly as
// the sim tracks it, and the reader resolves names through the fight's actor
// roster.
import type { OpenFight } from './fights';
import type { SegmenterHost } from './types';

/** 1 Hz against the sim's 20 Hz tick. */
export const TICKS_PER_THREAT_SAMPLE = 20;
/** Table entries kept per mob; classic threat only ever needs the top few. */
export const TOP_THREAT_ENTRIES = 8;
/** Mobs sampled per fight per second. A fight may track far more (an add wave),
 * but the tank-versus-dps question is always about the boss and its named adds,
 * and an unbounded sample would put a big trash pull on the wire every second. */
export const MAX_SAMPLED_MOBS = 12;

export class ThreatSampler {
  /**
   * Emits one threat sample per open fight, once per second. Cheap on the
   * ticks in between: a single modulo returns before any fight is walked.
   */
  observe(host: SegmenterHost, tick: number, fights: Iterable<OpenFight>): void {
    if (tick % TICKS_PER_THREAT_SAMPLE !== 0) return;
    for (const fight of fights) {
      if (fight.mobIds.size === 0) continue;
      const data = sampleFight(host, fight);
      if (data.length > 0) fight.recordSample(tick, 'threat', data);
    }
  }
}

/**
 * Bosses first, then everything else, up to the cap: on a fight where an add
 * wave outnumbers the cap, the boss's table is the one that must survive.
 */
function sampleFight(host: SegmenterHost, fight: OpenFight): number[][] {
  const bosses: number[][] = [];
  const others: number[][] = [];
  for (const mobId of fight.mobIds) {
    const entity = host.sim.entities.get(mobId);
    if (entity === undefined) continue;
    const table = entity.threat;
    if (table === undefined || table.size === 0) continue;
    // Decide the bucket BEFORE encoding: a big trash pull can track far more
    // mobs than the cap, and encoding sorts a table per mob. Skipping the
    // encode for a mob that cannot fit keeps the pass cheap.
    const isBoss = host.isBossTemplate(entity.templateId);
    if (!isBoss && others.length >= MAX_SAMPLED_MOBS) continue;
    const entry = encodeMob(mobId, entity.aggroTargetId ?? null, table);
    if (isBoss) bosses.push(entry);
    else others.push(entry);
    if (bosses.length >= MAX_SAMPLED_MOBS) break;
  }
  if (bosses.length >= MAX_SAMPLED_MOBS) return bosses.slice(0, MAX_SAMPLED_MOBS);
  return [...bosses, ...others].slice(0, MAX_SAMPLED_MOBS);
}

function encodeMob(
  mobId: number,
  aggroTargetId: number | null,
  table: ReadonlyMap<number, number>,
): number[] {
  const entry: number[] = [mobId, aggroTargetId ?? 0];
  for (const [sourceId, threat] of topEntries(table)) {
    entry.push(sourceId, threat);
  }
  return entry;
}

/**
 * Top-N of the hate table, highest first, rounded. Mirrors `threatEntries` in
 * `src/sim/threat.ts`, but reads the recorder's structural view rather than a
 * live `Entity`, so a unit test can script a fake sim.
 */
function topEntries(table: ReadonlyMap<number, number>): [number, number][] {
  return [...table.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_THREAT_ENTRIES)
    .map(([id, threat]) => [id, Math.round(threat)]);
}
