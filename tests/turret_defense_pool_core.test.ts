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
import { TURRET_MISSIONS } from '../src/sim/content/fire_and_fly_missions';
import { FIRE_AND_FLY_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { positionAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import {
  recordTurretFeedback,
  TURRET_FEEDBACK_LIMIT,
  type TurretFeedback,
} from '../src/sim/minigames/turret_feedback';

const flat: ThrowProbe = { ground: () => 0, water: () => null };

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

  it("pins each scenario's rig total and marker bodies, so growing a pool is a decision", () => {
    // Every rig is a whole skinned character built on seat. Raising any of these numbers
    // (a mission edit buys rigs silently) needs a heap and GPU memory check on a low-end
    // GPU first: an integrated GPU and an iOS device at the deepest wave.
    const sizes = Object.fromEntries(
      FIRE_AND_FLY_SCENARIOS.map((scenario) => {
        const rigPlan = turretRigPlan(resolveTurretPlan(scenario));
        let rigs = 0;
        for (const count of turretRigCapacities(rigPlan).values()) rigs += count;
        return [scenario.boardKey, { rigs, bodies: turretBodyCapacity(rigPlan) }];
      }),
    );
    expect(sizes).toEqual({
      introduction: { rigs: 56, bodies: 35 },
      standard: { rigs: 98, bodies: 40 },
      hard: { rigs: 118, bodies: 42 },
      pack: { rigs: 109, bodies: 62 },
      deluge: { rigs: 64, bodies: 51 },
      brittle: { rigs: 57, bodies: 43 },
      powder: { rigs: 56, bodies: 46 },
    });
  });

  it('carries no tail: a rig plan is its kinds and its waves, nothing older than the previous wave', () => {
    const dressed = turretRigPlan({ scenarioId: 'fire_and_fly_pack', ...plan });
    expect(Object.keys(dressed).sort()).toEqual(['kinds', 'waves']);
    // The boars of the second wave are corpses before the bandits' wave starts: the last
    // wave's boar needs one rig beside them, never a third.
    expect(turretRigCapacities(dressed).get('boar')).toBe(2);
  });

  it.each(FIRE_AND_FLY_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    "gives %s a rig for every monster of a wave plus the previous wave's corpses of it",
    (_key, scenario) => {
      const real = turretRigPlan(resolveTurretPlan(scenario));
      const capacities = turretRigCapacities(real);
      const counts = real.waves.map((wave) => {
        const per = new Map<string, number>();
        for (const k of wave.spawns) {
          const id = real.kinds[k].templateId;
          per.set(id, (per.get(id) ?? 0) + 1);
        }
        return per;
      });
      const exact = new Map<string, number>();
      counts.forEach((per, w) => {
        for (const [id, count] of per) {
          const need = count + (w > 0 ? (counts[w - 1].get(id) ?? 0) : 0);
          exact.set(id, Math.max(exact.get(id) ?? 0, need));
        }
      });
      expect(Object.fromEntries(capacities)).toEqual(Object.fromEntries(exact));
    },
  );

  it.each(FIRE_AND_FLY_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    "gives %s a body for every monster of a wave and its predecessor's corpses, no more",
    (_key, scenario) => {
      const real = resolveTurretPlan(scenario);
      const fields = real.waves.map(
        (wave, w) => wave.spawns.length + (w > 0 ? real.waves[w - 1].spawns.length : 0),
      );
      expect(turretBodyCapacity(real)).toBe(Math.max(...fields));
    },
  );

  it.each(TURRET_MISSIONS.map((m) => [m.boardKey, m] as const))(
    "fields at most a wave's living on %s, each holding a body and a rig",
    (_key, mission) => {
      const real = resolveTurretPlan(mission);
      const bound = Math.max(...real.waves.map((w) => w.spawns.length));
      // A nearest-first aimer, then one firing every 0.8 s, which leaves more corpses lying
      // as the next wave walks in.
      for (const [seed, cadence] of [
        [5, 1],
        [6, 16],
      ]) {
        const state = createTurretDefense(real, { x: 0, z: 0 }, seed, 1000);
        // Only as many bodies as the living can number: the corpses have to give theirs up.
        const book = new TurretSlotBook();
        book.growBodies(bound);
        const rigPlan = turretRigPlan(real);
        for (const [id, capacity] of turretRigCapacities(rigPlan)) {
          for (let i = 0; i < capacity; i++) book.setRigReady(book.addRig(id));
        }
        let most = 0;
        for (let t = 1001; t < 1000 + 20 * 60 * 10; t++) {
          if (state.phase === 'won' || state.phase === 'lost') break;
          tickTurretDefense(state, t, flat);
          const living = state.monsters.filter((m) => m.hp > 0);
          most = Math.max(most, living.length);
          book.assign(state.monsters, (kind) => rigPlan.kinds[kind].templateId);
          for (const m of living) {
            expect(book.bodyOf(m.id), `tick ${t}`).toBeGreaterThanOrEqual(0);
            expect(book.rigOf(m.id), `rig, tick ${t}`).toBeGreaterThanOrEqual(0);
          }
          if (t >= state.readyTick && t % cadence === 0) {
            const target = nearestLive(state, t);
            if (target) fireTurret(state, t, target.x, target.z, flat);
          }
        }
        expect(most).toBeLessThanOrEqual(bound);
        expect(turretBodyCapacity(real)).toBeGreaterThanOrEqual(most);
      }
    },
    60_000,
  );

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

function nearestLive(state: TurretDefenseState, tick: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, flat);
    const d = Math.hypot(p.x - state.cx, p.z - state.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

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

  it("gives a living monster a corpse's marker body when none is free, never the other way", () => {
    const book = bookWith([], 2);
    const corpses = [
      { id: 1, kind: 0, hp: 0 },
      { id: 2, kind: 0, hp: 0 },
    ];
    book.assign(corpses, templateOf);
    expect([book.bodyOf(1), book.bodyOf(2)]).toEqual([0, 1]);
    const living = { id: 3, kind: 0, hp: 10 };
    book.assign([...corpses, living], templateOf);
    expect(book.bodyOf(3)).toBe(0);
    expect([book.bodyOf(1), book.bodyOf(2)]).toEqual([-1, 1]);
    // A corpse finding every body held by the living goes without one.
    const more = { id: 4, kind: 0, hp: 10 };
    book.assign([corpses[0], corpses[1], living, more], templateOf);
    expect([book.bodyOf(3), book.bodyOf(4)]).toEqual([0, 1]);
    expect([book.bodyOf(1), book.bodyOf(2)]).toEqual([-1, -1]);
    book.assign([{ id: 5, kind: 0, hp: 0 }, living, more], templateOf);
    expect(book.bodyOf(5)).toBe(-1);
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
    expect(book.rigId).toEqual([]);
    expect(book.rigOf(1)).toBe(-1);
    expect(book.bodyOf(1)).toBe(-1);
    book.addRig('boar');
    book.growBodies(1);
    book.assign([{ id: 2, kind: 0, hp: 5 }], () => 'boar');
    expect(book.bodyOf(2)).toBe(0);
    expect(book.rigOf(2)).toBe(-1);
  });
});
