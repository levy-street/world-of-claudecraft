import { describe, expect, it } from 'vitest';
import {
  nextTurretRig,
  TurretFeedbackCursor,
  TurretSlotBook,
  turretBodyCapacity,
  turretBuildOrder,
  turretRigCapacities,
  turretRigPlan,
  turretRunResidencyOver,
  turretUrgentTemplates,
} from '../src/render/turret_defense_pool_core';
import {
  FIRE_AND_FLY_DUNGEON_DEFS,
  FIRE_AND_FLY_DUNGEON_ID,
} from '../src/sim/content/fire_and_fly_arena';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import {
  recordTurretFeedback,
  TURRET_FEEDBACK_LIMIT,
  type TurretFeedback,
} from '../src/sim/minigames/turret_feedback';

// kinds: 0 wolf, 1 boar, 2 bandit
const plan = {
  kinds: [{ templateId: 'wolf' }, { templateId: 'boar' }, { templateId: 'bandit' }],
  waves: [{ spawns: [0, 0, 0] }, { spawns: [0, 1, 0, 1] }, { spawns: [2, 2] }, { spawns: [1] }],
};

describe('Fire and Fly rig pool capacity', () => {
  it('names each kind by its rig, a dressed template apart from its plain self, and keeps the waves', () => {
    const waves = [{ spawns: [0, 1, 1] }];
    const kinds = [{ templateId: 'tunnel_rat' }, { templateId: 'forest_wolf' }];
    const deluge = turretRigPlan({ scenarioId: 'fire_and_fly_deluge', kinds, waves });
    expect(deluge.kinds.map((k) => k.templateId)).toEqual([
      'tunnel_rat>deeprock_kobold',
      'forest_wolf',
    ]);
    expect(deluge.waves).toBe(waves);
    const watch = turretRigPlan({ scenarioId: 'fire_and_fly_standard', kinds, waves });
    expect(watch.kinds.map((k) => k.templateId)).toEqual(['tunnel_rat', 'forest_wolf']);
    expect(Object.fromEntries(turretRigCapacities(deluge))).toEqual({
      'tunnel_rat>deeprock_kobold': 1,
      forest_wolf: 2,
    });
  });

  it('sizes each template to its largest wave plus the previous wave corpses of it', () => {
    expect(Object.fromEntries(turretRigCapacities(plan))).toEqual({ wolf: 5, boar: 2, bandit: 2 });
    expect(turretBodyCapacity(plan)).toBe(7);
  });

  it('covers every wave of the real plan, carried corpses included', () => {
    const real = resolveTurretPlan();
    const capacities = turretRigCapacities(real);
    real.waves.forEach((wave, w) => {
      const count = (spawns: readonly number[], id: string) =>
        spawns.filter((k) => real.kinds[k].templateId === id).length;
      for (const kind of new Set(wave.spawns)) {
        const id = real.kinds[kind].templateId;
        const previous = w > 0 ? count(real.waves[w - 1].spawns, id) : 0;
        expect(capacities.get(id)).toBeGreaterThanOrEqual(count(wave.spawns, id) + previous);
      }
    });
    const bodies = turretBodyCapacity(real);
    real.waves.forEach((wave, w) => {
      const carried = w > 0 ? real.waves[w - 1].spawns.length : 0;
      expect(bodies).toBeGreaterThanOrEqual(wave.spawns.length + carried);
    });
  });

  it('builds the current wave first, then the next, later waves, and the previous one last', () => {
    expect(turretBuildOrder(plan, 0)).toEqual(['wolf', 'boar', 'bandit']);
    expect(turretBuildOrder(plan, 2)).toEqual(['bandit', 'boar', 'wolf']);
    const capacities = turretRigCapacities(plan);
    const built = new Map([['bandit', 2]]);
    expect(nextTurretRig(turretBuildOrder(plan, 2), capacities, built, new Set())).toBe('boar');
    built.set('boar', 2);
    expect(nextTurretRig(turretBuildOrder(plan, 2), capacities, built, new Set(['wolf']))).toBe(
      null,
    );
    expect(nextTurretRig(turretBuildOrder(plan, 2), capacities, built, new Set())).toBe('wolf');
  });

  it('builds on the frame only for the current and the next wave', () => {
    expect([...turretUrgentTemplates(plan, 0)]).toEqual(['wolf', 'boar']);
    expect([...turretUrgentTemplates(plan, 2)]).toEqual(['bandit', 'boar']);
    expect([...turretUrgentTemplates(plan, 3)]).toEqual(['boar']);
  });
});

const templateOf = (kind: number) => plan.kinds[kind].templateId;

function bookWith(rigs: string[], bodies: number): TurretSlotBook {
  const book = new TurretSlotBook();
  book.growBodies(bodies);
  for (const id of rigs) book.setRigReady(book.addRig(id));
  return book;
}

describe('Fire and Fly slot book', () => {
  it('assigns rigs and bodies by id, keeps them stable, and releases them when the monster leaves', () => {
    const book = bookWith(['wolf', 'wolf', 'boar'], 3);
    const a = { id: 1, kind: 0, hp: 10 };
    const b = { id: 2, kind: 0, hp: 10 };
    const c = { id: 3, kind: 1, hp: 10 };
    book.assign([a, b, c], templateOf);
    expect([book.rigOf(1), book.rigOf(2), book.rigOf(3)]).toEqual([0, 1, 2]);
    expect([book.bodyOf(1), book.bodyOf(2), book.bodyOf(3)]).toEqual([0, 1, 2]);
    book.assign([c, b], templateOf);
    expect(book.rigOf(2)).toBe(1);
    expect(book.rigOf(1)).toBe(-1);
    expect(book.bodyOf(1)).toBe(-1);
    expect(book.rigId[0]).toBeNull();
    const d = { id: 4, kind: 0, hp: 10 };
    book.assign([d, c, b], templateOf);
    expect(book.rigOf(4)).toBe(0);
    expect(book.bodyOf(4)).toBe(0);
  });

  it('never hands out a rig before it is ready: the monster keeps only its marker body', () => {
    const book = new TurretSlotBook();
    book.growBodies(2);
    const rig = book.addRig('wolf');
    book.assign([{ id: 9, kind: 0, hp: 5 }], templateOf);
    expect(book.rigOf(9)).toBe(-1);
    expect(book.bodyOf(9)).toBe(0);
    book.setRigReady(rig);
    book.assign([{ id: 9, kind: 0, hp: 5 }], templateOf);
    expect(book.rigOf(9)).toBe(rig);
  });

  it('gives a living monster the rig of a corpse of its template when none is free', () => {
    const book = bookWith(['wolf'], 2);
    const corpse = { id: 1, kind: 0, hp: 0 };
    book.assign([corpse], templateOf);
    expect(book.rigOf(1)).toBe(0);
    const living = { id: 2, kind: 0, hp: 10 };
    book.assign([corpse, living], templateOf);
    expect(book.rigOf(2)).toBe(0);
    expect(book.rigOf(1)).toBe(-1);
    expect(book.bodyOf(1)).toBeGreaterThanOrEqual(0);
    // A living holder is never evicted, whatever the order in the view.
    const late = { id: 3, kind: 0, hp: 10 };
    book.assign([late, corpse, living], templateOf);
    expect(book.rigOf(2)).toBe(0);
    expect(book.rigOf(3)).toBe(-1);
  });

  it('lets a living monster take the rig of a holder that died since it was assigned', () => {
    const book = bookWith(['wolf'], 2);
    book.assign([{ id: 1, kind: 0, hp: 10 }], templateOf);
    expect(book.rigOf(1)).toBe(0);
    book.assign(
      [
        { id: 1, kind: 0, hp: 0 },
        { id: 2, kind: 0, hp: 10 },
      ],
      templateOf,
    );
    expect(book.rigOf(2)).toBe(0);
    expect(book.rigOf(1)).toBe(-1);
  });

  it('serves the living before corpses when bodies run short, and releases everything at once', () => {
    const book = bookWith([], 1);
    book.assign(
      [
        { id: 1, kind: 0, hp: 0 },
        { id: 2, kind: 0, hp: 3 },
      ],
      templateOf,
    );
    expect(book.bodyOf(2)).toBe(0);
    expect(book.bodyOf(1)).toBe(-1);
    book.releaseAll();
    expect(book.bodyOf(2)).toBe(-1);
    expect(book.bodyId).toEqual([null]);
  });
});

function ring(events: TurretEvent[][], startTick = 100): TurretFeedback[] {
  const entries: TurretFeedback[] = [];
  let seq = 1;
  events.forEach((batch, i) => {
    seq = recordTurretFeedback(entries, seq, startTick + i, batch);
  });
  return entries;
}

const wave = (n: number): TurretEvent => ({ type: 'waveStart', wave: n, count: 1 });

describe('Fire and Fly feedback cursor', () => {
  it('hands each entry out once, by sequence number, and nothing for an unchanged view', () => {
    const cursor = new TurretFeedbackCursor();
    const first = { defense: { startTick: 100 }, feedback: ring([[wave(0)], [wave(1)]]) };
    expect(cursor.take(first).map((e) => e.seq)).toEqual([1, 2]);
    expect(cursor.take(first)).toEqual([]);
    const second = {
      defense: { startTick: 100 },
      feedback: ring([[wave(0)], [wave(1)], [wave(2)]]),
    };
    expect(cursor.take(second).map((e) => e.seq)).toEqual([3]);
    expect(cursor.take({ ...second })).toEqual([]);
    expect(cursor.dropped).toBe(0);
  });

  it('restarts with a new seat and counts entries the ring dropped between reads', () => {
    const cursor = new TurretFeedbackCursor();
    cursor.take({ defense: { startTick: 100 }, feedback: ring([[wave(0)]]) });
    const reseated = { defense: { startTick: 500 }, feedback: ring([[wave(0)]], 500) };
    expect(cursor.take(reseated).map((e) => e.seq)).toEqual([1]);
    const flood = ring(
      Array.from({ length: TURRET_FEEDBACK_LIMIT + 8 }, (_, i) => [wave(i)]),
      500,
    );
    expect(flood[0].seq).toBe(9);
    const taken = cursor.take({ defense: { startTick: 500 }, feedback: flood });
    expect(taken[0].seq).toBe(9);
    expect(cursor.dropped).toBe(7);
  });
});

describe('Fire and Fly run residency', () => {
  const arenaX = instanceOrigin(FIRE_AND_FLY_DUNGEON_DEFS[FIRE_AND_FLY_DUNGEON_ID].index, 0).x;
  const otherDungeon = Object.values(DUNGEONS).find((d) => d.id !== FIRE_AND_FLY_DUNGEON_ID)!;

  it('releases only once the seat is gone and the player stands outside the arena band', () => {
    expect(turretRunResidencyOver(false, -340)).toBe(true);
    expect(turretRunResidencyOver(false, instanceOrigin(otherDungeon.index, 0).x)).toBe(true);
    expect(turretRunResidencyOver(true, -340)).toBe(false);
    expect(turretRunResidencyOver(false, arenaX)).toBe(false);
    expect(turretRunResidencyOver(false, arenaX + 40)).toBe(false);
    expect(turretRunResidencyOver(false, null)).toBe(false);
    expect(turretRunResidencyOver(false, Number.NaN)).toBe(false);
  });

  it('forgets every rig and body slot when the pools they named are released', () => {
    const book = new TurretSlotBook();
    book.addRig('wolf');
    book.setRigReady(0);
    book.growBodies(2);
    book.assign([{ id: 1, kind: 0, hp: 5 }], () => 'wolf');
    expect(book.rigOf(1)).toBe(0);
    expect(book.bodyOf(1)).toBe(0);
    book.clear();
    expect(book.rigTemplate).toEqual([]);
    expect(book.rigReady).toEqual([]);
    expect(book.bodyId).toEqual([]);
    expect(book.rigOf(1)).toBe(-1);
    expect(book.bodyOf(1)).toBe(-1);
    book.addRig('boar');
    book.growBodies(1);
    book.assign([{ id: 2, kind: 0, hp: 5 }], () => 'boar');
    expect(book.bodyOf(2)).toBe(0);
    expect(book.rigOf(2)).toBe(-1);
  });
});
