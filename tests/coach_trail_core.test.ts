// The island golden guidance's pure core: the trail route per rail station
// (arrival to Tam, the gauntlet lanes, crate to crate on the haul, the
// graduation walk to the bell), the stable rebuild keys, and the golden
// target NPC (the giver on the way in, the turn-in on the way back, nobody
// mid-task).

import { describe, expect, it } from 'vitest';
import {
  type CoachGuideReader,
  coachGuides,
  coachTargetNpcId,
  coachTrailPlan,
  distanceToTrail,
} from '../src/render/coach_trail_core';
import {
  BOOTCAMP_COURSE_CHECKPOINTS,
  PROVING_SHORE_ARRIVAL,
  PROVING_SHORE_NPCS,
  PROVING_SHORE_OBJECTS,
  PROVING_SHORE_QUEST_ORDER,
  PROVING_SHORE_QUESTS,
} from '../src/sim/content/proving_shore';
import { CRAB_SUMMON_SITE } from '../src/sim/interactions/crab_summon';

const GAUNTLET = PROVING_SHORE_QUEST_ORDER[0];

/** A reader where `active` quests sit in the log (with counts) and every
 *  other quest answers questState from the given table. */
function reader(
  states: Record<string, string>,
  activeCounts: Record<string, number> = {},
): CoachGuideReader {
  const log = new Map<string, { state: string; counts?: readonly number[] }>();
  for (const [id, state] of Object.entries(states)) {
    if (state === 'active') log.set(id, { state: 'active', counts: [activeCounts[id] ?? 0] });
  }
  return {
    questState: (id) => states[id] ?? 'unavailable',
    questLog: log,
  };
}

describe('coachTrailPlan: the route per station', () => {
  it('walks arrival to Warden Tam while the first quest is on offer', () => {
    const plan = coachTrailPlan(reader({ [GAUNTLET]: 'available' }), 0);
    expect(plan!.key).toBe(`${GAUNTLET}:available`);
    expect(plan!.points[0]).toEqual({ x: PROVING_SHORE_ARRIVAL.x, z: PROVING_SHORE_ARRIVAL.z });
    expect(plan!.points[1]).toEqual(PROVING_SHORE_NPCS.warden_tam.pos);
  });

  it('threads the gauntlet lanes through every flag in running order', () => {
    const plan = coachTrailPlan(reader({ [GAUNTLET]: 'active' }), 0);
    expect(plan!.key).toBe(`${GAUNTLET}:lanes`);
    expect(plan!.points).toEqual([
      PROVING_SHORE_NPCS.warden_tam.pos,
      ...BOOTCAMP_COURSE_CHECKPOINTS,
    ]);
  });

  it('crosses to Overseer Pell once every flag is tagged', () => {
    const counts = BOOTCAMP_COURSE_CHECKPOINTS.length;
    const plan = coachTrailPlan(reader({ [GAUNTLET]: 'active' }), counts);
    expect(plan!.key).toBe(`${GAUNTLET}:handoff`);
    expect(plan!.points[plan!.points.length - 1]).toEqual(PROVING_SHORE_NPCS.overseer_pell.pos);
  });

  it('starts the next station from the PREVIOUS turn-in, not from the arrival', () => {
    const plan = coachTrailPlan(reader({ q_ps_strike_true: 'available' }), 0);
    const prevTurnIn = PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS[GAUNTLET].turnInNpcId];
    expect(plan!.points[0]).toEqual(prevTurnIn.pos);
  });

  it('chains the haul giver, every crate in authored order, then the stall', () => {
    const plan = coachTrailPlan(reader({ q_ps_the_wreck_line: 'active' }), 0);
    const crates = PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_castaway_crate')!.positions;
    expect(plan!.key).toBe('wreck:active');
    expect(plan!.points.length).toBe(crates.length + 2);
    expect(plan!.points[0]).toEqual(
      PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS.q_ps_the_wreck_line.giverNpcId].pos,
    );
    expect(plan!.points[plan!.points.length - 1]).toEqual(
      PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS.q_ps_the_wreck_line.turnInNpcId].pos,
    );
  });

  it('walks the hand-back leg from where the task ended', () => {
    const plan = coachTrailPlan(reader({ q_ps_shell_and_claw: 'ready' }), 0);
    expect(plan!.key).toBe('q_ps_shell_and_claw:ready');
    expect(plan!.points[plan!.points.length - 1]).toEqual(
      PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS.q_ps_shell_and_claw.turnInNpcId].pos,
    );
  });

  it('paints the graduation walk to the bell, and nothing before the rail starts', () => {
    const last = PROVING_SHORE_QUEST_ORDER[PROVING_SHORE_QUEST_ORDER.length - 1];
    const done = coachTrailPlan(reader({ [last]: 'done' }), 0);
    expect(done!.key).toBe('bell');
    expect(coachTrailPlan(reader({}), 0)).toBeNull();
  });
});

describe('distanceToTrail: point-to-segment over the route', () => {
  const L = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ];

  it('measures to the segment body, not just the vertices', () => {
    // Midway along the first leg, 3 to the side: the nearest VERTEX is 5.83
    // away, but the path itself is 3 away.
    expect(distanceToTrail(L, 5, 3)).toBeCloseTo(3, 5);
  });

  it('clamps to the segment ends past the route', () => {
    expect(distanceToTrail(L, -4, 0)).toBeCloseTo(4, 5);
    expect(distanceToTrail(L, 10, 14)).toBeCloseTo(4, 5);
  });

  it('is zero on the path and infinite with no path', () => {
    expect(distanceToTrail(L, 10, 5)).toBeCloseTo(0, 5);
    expect(distanceToTrail([], 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('coachTargetNpcId: the golden press-me NPC', () => {
  it('is the giver on offer, the turn-in when ready, nobody mid-task', () => {
    expect(coachTargetNpcId(reader({ q_ps_strike_true: 'available' }))).toBe(
      PROVING_SHORE_QUESTS.q_ps_strike_true.giverNpcId,
    );
    expect(coachTargetNpcId(reader({ q_ps_strike_true: 'ready' }))).toBe(
      PROVING_SHORE_QUESTS.q_ps_strike_true.turnInNpcId,
    );
    expect(coachTargetNpcId(reader({ q_ps_strike_true: 'active' }))).toBeNull();
  });
});

describe('coachGuides: the objective beam', () => {
  it('stands the beam on the CURRENT gauntlet flag mid-lanes', () => {
    const guides = coachGuides(reader({ [GAUNTLET]: 'active' }, { [GAUNTLET]: 1 }));
    expect(guides.beamAt).toEqual(BOOTCAMP_COURSE_CHECKPOINTS[1]);
    expect(guides.beamAtNearestCrate).toBe(false);
  });

  it('hands the crate haul to the consumer (nearest live crate)', () => {
    const guides = coachGuides(reader({ q_ps_the_wreck_line: 'active' }));
    expect(guides.beamAt).toBeNull();
    expect(guides.beamAtNearestCrate).toBe(true);
  });

  it('stands the beam on the signpost reading spot', () => {
    const guides = coachGuides(reader({ q_ps_the_signpost: 'active' }));
    expect(guides.beamAt).toEqual({ x: -312, z: 42.5 });
  });

  it('gives NPC stations the aura, never a beam', () => {
    const guides = coachGuides(reader({ q_ps_strike_true: 'available' }));
    expect(guides.beamAt).toBeNull();
    expect(guides.beamAtNearestCrate).toBe(false);
    expect(guides.glowNpcId).not.toBeNull();
  });

  it('rings the whole kill camp while its lesson is live, and only then', () => {
    const strike = coachGuides(reader({ q_ps_strike_true: 'active' }));
    expect(strike.areaRing).toEqual({ x: -336, z: -14, radius: 9 });
    const shell = coachGuides(reader({ q_ps_shell_and_claw: 'active' }));
    expect(shell.areaRing).toEqual({ x: -380, z: -42, radius: 11 });
    expect(coachGuides(reader({ q_ps_strike_true: 'ready' })).areaRing).toBeNull();
    expect(coachGuides(reader({ q_ps_the_wreck_line: 'active' })).areaRing).toBeNull();
  });

  it('walks the pearl detour: trail to the pool, beam and ring on it, back to Nel', () => {
    // The render core mirrors the summon module's site; if the site moves,
    // this pins the drift.
    expect({ x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z }).toEqual({ x: -398, z: -17 });
    const active = coachGuides(reader({ q_ps_mother_of_pearl: 'active' }));
    expect(active.plan!.key).toBe('pearl:active');
    expect(active.plan!.points).toEqual([
      PROVING_SHORE_NPCS.tidewarden_nel.pos,
      { x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z },
    ]);
    // A watery target, never a character: the beam and the camp ring both
    // stand on the pool (the summoned king spawns inside it).
    expect(active.beamAt).toEqual({ x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z });
    expect(active.areaRing).toEqual({ x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z, radius: 8 });
    // The hand-back leg walks from the pool to Nel.
    const ready = coachTrailPlan(reader({ q_ps_mother_of_pearl: 'ready' }), 0);
    expect(ready!.points).toEqual([
      { x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z },
      PROVING_SHORE_NPCS.tidewarden_nel.pos,
    ]);
  });

  it('hands the KING DOWN case to the consumer, so the beam lights his shell', () => {
    // CX: "still doesn't tell me to loot Mister Crabs to pick up the quest
    // item. This is key." The pool is where he is summoned; the pearl is on
    // his corpse, and the corpse is an entity only the consumer can see, so
    // the core raises the flag and the pool stays the fallback.
    const active = coachGuides(reader({ q_ps_mother_of_pearl: 'active' }));
    expect(active.beamAtCrabCorpse).toBe(true);
    expect(active.beamAt).toEqual({ x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z });
    // Nowhere else: no other station should chase a crab corpse.
    for (const station of [GAUNTLET, 'q_ps_strike_true', 'q_ps_the_wreck_line'] as const) {
      expect(coachGuides(reader({ [station]: 'active' })).beamAtCrabCorpse, station).toBe(false);
    }
    expect(coachGuides(reader({ q_ps_mother_of_pearl: 'ready' })).beamAtCrabCorpse).toBe(false);
  });
});

describe('coachGuides: the one per-frame read', () => {
  it('resolves the plan and the glow NPC (with their authored stand) together', () => {
    const guides = coachGuides(reader({ q_ps_strike_true: 'available' }));
    expect(guides.plan!.key).toBe('q_ps_strike_true:available');
    expect(guides.glowNpcId).toBe(PROVING_SHORE_QUESTS.q_ps_strike_true.giverNpcId);
    expect(guides.glowNpcPos).toEqual(PROVING_SHORE_NPCS[guides.glowNpcId!].pos);
  });

  it('reads the gauntlet flag tally from the quest log itself', () => {
    const counts = BOOTCAMP_COURSE_CHECKPOINTS.length;
    const guides = coachGuides(reader({ [GAUNTLET]: 'active' }, { [GAUNTLET]: counts }));
    expect(guides.plan!.key).toBe(`${GAUNTLET}:handoff`);
  });
});

describe('the corpse run owns the trail while you are a ghost', () => {
  // CX: the death lesson should PAINT the walk back, not just describe it.
  const reader = (over: Record<string, unknown> = {}) => ({
    questState: () => 'unavailable',
    questLog: new Map(),
    ...over,
  });

  it('routes straight from the ghost to its own body', () => {
    const plan = coachTrailPlan(
      reader({ playerPos: { x: -324, z: 58 }, corpsePos: { x: -300, z: 10 } }),
      0,
    );
    expect(plan).not.toBeNull();
    expect(plan!.key).toBe('corpse-run');
    expect(plan!.points[0]).toEqual({ x: -324, z: 58 });
    expect(plan!.points[plan!.points.length - 1]).toEqual({ x: -300, z: 10 });
  });

  it('beats every station route, because nothing else is reachable while dead', () => {
    // A live rail quest would normally own the ribbon; the corpse does not
    // just get added to the list, it replaces it.
    const plan = coachTrailPlan(
      reader({
        questState: (id: string) => (id === 'q_ps_the_gauntlet' ? 'active' : 'unavailable'),
        questLog: new Map([['q_ps_the_gauntlet', { state: 'active', counts: [0] }]]),
        playerPos: { x: -324, z: 58 },
        corpsePos: { x: -300, z: 10 },
      }),
      0,
    );
    expect(plan!.key).toBe('corpse-run');
  });

  it('leaves the ordinary routes alone once the body is reclaimed', () => {
    const alive = coachTrailPlan(reader({ playerPos: { x: -324, z: 58 }, corpsePos: null }), 0);
    expect(alive?.key).not.toBe('corpse-run');
  });

  it('needs BOTH ends: a corpse with no viewer position paints nothing', () => {
    const plan = coachTrailPlan(reader({ corpsePos: { x: -300, z: 10 } }), 0);
    expect(plan?.key).not.toBe('corpse-run');
  });
});
