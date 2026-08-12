// Resource sampling: health and the primary resource pool for everyone in a
// fight, once a second. The contract has reserved `SampleRecord` kind 'res'
// since v1 (plan section 5.3) and nothing emitted it, so a parse could show
// every point of damage and healing but never the bars they moved.
//
// This is the balance-facing stream. Damage events alone cannot answer whether
// a warrior sat rage-starved between spenders, whether a rogue capped energy
// and wasted regen, whether a healer went out of mana or coasted at full, or
// how close a raid actually ran to the floor. None of it is derivable after the
// fact either: the event stream carries amounts, never the resulting pools, and
// a periodic tick that FULLY overheals emits no heal event at all (see the
// known capture limits in this directory's CLAUDE.md), so integrating damage
// minus healing drifts silently. Sampling the real pools is the only honest
// answer.
//
// Read-only like the rest of the recorder: it reads the structural entity view
// and never touches sim state.
//
// Wire layout of `data`, one flat number array per sampled entity:
//   [entityId, hp, maxHp, resource, maxResource, resourceTypeCode]
// Every entry is self-contained on purpose: carrying the maxima costs two
// numbers per second per entity and means a reader never has to join against a
// roster that may not cover late joiners, dead players, or a stamina buff that
// moved maxHp mid-fight.
import type { OpenFight } from './fights';
import type { RecorderEntityView, SegmenterHost } from './types';

/** 1 Hz against the sim's 20 Hz tick. Deliberately the same cadence as the
 * threat sampler so the two series line up sample-for-sample when read
 * together; they stay separate constants because the plan's third stream
 * (positions) samples at 2 Hz and these are independent knobs. */
export const TICKS_PER_RESOURCE_SAMPLE = 20;
/** Boss/elite mobs sampled per fight. Participants are always sampled in full
 * (raid size is its own bound); this caps only the hostile side, so a big trash
 * pull cannot put an unbounded roster on the wire every second. */
export const MAX_SAMPLED_MOBS = 8;

/** Compact wire codes for ResourceType. 0 is "no pool" (most mobs). */
export const RESOURCE_TYPE_CODES = { mana: 1, rage: 2, energy: 3, focus: 4 } as const;

export function resourceTypeCode(type: RecorderEntityView['resourceType']): number {
  if (type === undefined || type === null) return 0;
  return RESOURCE_TYPE_CODES[type] ?? 0;
}

export class ResourceSampler {
  /**
   * Emits one resource sample per open fight, once per second. Cheap on the
   * ticks in between: a single modulo returns before any fight is walked.
   */
  observe(host: SegmenterHost, tick: number, fights: Iterable<OpenFight>): void {
    if (tick % TICKS_PER_RESOURCE_SAMPLE !== 0) return;
    for (const fight of fights) {
      const data = sampleFight(host, fight);
      if (data.length > 0) fight.recordSample(tick, 'res', data);
    }
  }
}

function sampleFight(host: SegmenterHost, fight: OpenFight): number[][] {
  const out: number[][] = [];
  // Participants first and always: they are the reason this stream exists, and
  // a dead one still samples (hp 0 is the signal a reader needs to see the
  // death and any rez, not a row to drop).
  for (const entityId of fight.participantEntityIds()) {
    const entity = host.sim.entities.get(entityId);
    if (entity !== undefined) out.push(encode(entity));
  }
  let mobs = 0;
  for (const mobId of fight.mobIds) {
    if (mobs >= MAX_SAMPLED_MOBS) break;
    const entity = host.sim.entities.get(mobId);
    // Boss health over time is the phase-timing and dps-check record; ordinary
    // trash would multiply the payload for no analytical value.
    if (entity === undefined || !host.isBossTemplate(entity.templateId)) continue;
    out.push(encode(entity));
    mobs++;
  }
  return out;
}

function encode(entity: RecorderEntityView): number[] {
  return [
    entity.id,
    Math.round(entity.hp ?? 0),
    Math.round(entity.maxHp ?? 0),
    Math.round(entity.resource ?? 0),
    Math.round(entity.maxResource ?? 0),
    resourceTypeCode(entity.resourceType),
  ];
}
