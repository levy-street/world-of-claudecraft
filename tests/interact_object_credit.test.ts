// Regression suite for the interact-objective credit exploit (bug report: "The
// Three Bells - you can complete the quest by spam clicking your interact key on
// the box right next to the quest giver").
//
// A multi-count `interact` objective is keyed on targetObjectItemId, not on the
// object instance, and interactObjectForQuests never consumes the object the way
// the collect path does. So every press on ONE object re-credited the objective:
// 3 presses on the Landing-point watchbell, without ever walking the coast,
// finished q_fs_the_three_bells. 20 quests across 10 zones share the shape.
//
// The fix credits an interact objective once per DISTINCT object, keyed on the
// authored spawn position (stable across restarts and deploys, unlike entity ids)
// and recorded on the persisted QuestProgress.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, GROUND_OBJECTS, QUESTS } from '../src/sim/data';
import {
  hasInteractObjectCredit,
  interactObjectCreditKey,
  questProgressForWire,
  recordInteractObjectCredit,
  sanitizeCreditedObjects,
} from '../src/sim/quests/interact_object_credit';
import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestProgress } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const BELLS_QUEST = 'q_fs_the_three_bells';
const BELL_ITEM = 'gullhaven_watchbell';

function bellWorld(): {
  sim: AnySim;
  meta: any;
  player: AnyEntity;
  bells: AnyEntity[];
  qp: QuestProgress;
} {
  const sim = new Sim({ seed: 11, playerClass: 'warrior' }) as AnySim;
  const player = sim.player as AnyEntity;
  const meta = sim.ctx.resolve(undefined)?.meta as any;
  // The prerequisite chain, then the real accept path (so resolvedCounts is
  // stamped exactly as it is in play).
  meta.questsDone.add('q_fs_bell_at_the_landing');
  const tam = [...sim.entities.values()].find(
    (e: AnyEntity) => e.templateId === 'bellkeeper_tam',
  ) as AnyEntity;
  expect(tam, 'Bellkeeper Tam spawns').toBeTruthy();
  place(sim, player, tam.pos.x, tam.pos.z);
  sim.acceptQuest(BELLS_QUEST);
  const qp = meta.questLog.get(BELLS_QUEST) as QuestProgress;
  expect(qp?.state, 'the quest accepted').toBe('active');
  const bells = [...sim.entities.values()].filter(
    (e: AnyEntity) => e.kind === 'object' && e.objectItemId === BELL_ITEM,
  ) as AnyEntity[];
  return { sim, meta, player, bells, qp };
}

function place(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = sim.groundPos(x, z).y;
  e.prevPos = { ...e.pos };
  e.onGround = true;
  sim.rebucket(e);
}

/** Walk to an object and press interact on it, the way a player does. */
function ring(sim: AnySim, player: AnyEntity, bell: AnyEntity): boolean {
  place(sim, player, bell.pos.x, bell.pos.z);
  return sim.pickUpObject(bell.id) as boolean;
}

describe('interact objectives credit once per distinct object', () => {
  it('pins the shape of the quest under test', () => {
    const objective = QUESTS[BELLS_QUEST].objectives[0];
    expect(objective.type).toBe('interact');
    if (objective.type !== 'interact') throw new Error('unreachable');
    expect(objective.targetObjectItemId).toBe(BELL_ITEM);
    expect(objective.count).toBe(3);
  });

  it('spam-clicking ONE watchbell never finishes The Three Bells', () => {
    const { sim, player, bells, qp } = bellWorld();
    expect(bells.length).toBe(3);
    for (let i = 0; i < 10; i++) ring(sim, player, bells[0]);
    expect(qp.counts[0], 'one bell rung ten times is still one bell').toBe(1);
    expect(qp.state).toBe('active');
    // A refused ring reports failure to the caller (the server relays that as the
    // command outcome) and, critically, never falls through to the generic pickup
    // branch that would hand the player a Coastal Watchbell item.
    expect(ring(sim, player, bells[0]), 'the refused press reports failure').toBe(false);
    expect(sim.countItem(BELL_ITEM, sim.playerId), 'and grants no item').toBe(0);
  });

  it('keys the LIVE spawned bells to their authored spots', () => {
    // The whole stability argument rests on GroundObjectDef.positions being
    // spawned verbatim (Sim.groundPos recomputes only y). Pin the table to the
    // entities, or a future spawn-time jitter/projection would silently make
    // every key drift from the authored spot it is reasoned about.
    const { bells } = bellWorld();
    const authored = GROUND_OBJECTS.find((d) => d.itemId === BELL_ITEM);
    expect(new Set(bells.map((b) => interactObjectCreditKey(0, b.pos)))).toEqual(
      new Set((authored?.positions ?? []).map((p) => interactObjectCreditKey(0, p))),
    );
  });

  it('is deterministic: the same seed credits the same keys', () => {
    const a = bellWorld();
    ring(a.sim, a.player, a.bells[0]);
    const b = bellWorld();
    ring(b.sim, b.player, b.bells[0]);
    expect(a.qp.creditedObjects).toEqual(b.qp.creditedObjects);
  });

  it('ringing all three distinct watchbells completes it', () => {
    const { sim, player, bells, qp } = bellWorld();
    for (const bell of bells) ring(sim, player, bell);
    expect(qp.counts[0]).toBe(3);
    expect(qp.state).toBe('ready');
  });

  it('tells the player a re-rung bell gave nothing, instead of failing silently', () => {
    const { sim, player, bells, meta } = bellWorld();
    const errors: string[] = [];
    const realError = sim.ctx.error as (...args: unknown[]) => void;
    sim.ctx.error = (pid: number, text: string, ...rest: unknown[]) => {
      if (pid === meta.entityId) errors.push(text);
      return realError(pid, text, ...rest);
    };
    ring(sim, player, bells[0]);
    expect(errors, 'the first ring is silent (it credits)').toEqual([]);
    ring(sim, player, bells[0]);
    expect(errors).toEqual(['You have already done this one.']);
  });

  it('keeps two objectives of the same quest from consuming each other credit', () => {
    // Cross-QUEST isolation comes from the ledger living on each quest's own
    // QuestProgress; within one quest it comes from the objective index being
    // part of the key. This pins the latter.
    const a = interactObjectCreditKey(0, { x: 256, z: 0 });
    const b = interactObjectCreditKey(1, { x: 256, z: 0 });
    expect(a).not.toBe(b);
  });

  it('isolates two quests that would share one object by key', () => {
    // Two quests whose index-0 interact objective targets the same item produce
    // the IDENTICAL key string, so nothing about the key keeps them apart: the
    // isolation comes from the ledger living on each quest's own QuestProgress.
    const key = interactObjectCreditKey(0, { x: 256, z: 0 });
    const questA: QuestProgress = { questId: 'a', counts: [0], state: 'active' };
    const questB: QuestProgress = { questId: 'b', counts: [0], state: 'active' };
    recordInteractObjectCredit(questA, key);
    expect(hasInteractObjectCredit(questA, key)).toBe(true);
    expect(hasInteractObjectCredit(questB, key), 'the other quest is untouched').toBe(false);
  });
});

describe('every multi-count interact objective has enough distinct objects to finish', () => {
  // The load-bearing content invariant this fix introduces: crediting once per
  // distinct object turns "too few authored positions" from a harmless surplus
  // into an UNFINISHABLE quest. 20 quests across 10 zones ride on this, so pin
  // it here rather than discovering it in a bug report.
  const placedByItem = new Map<string, number>();
  for (const def of GROUND_OBJECTS) {
    placedByItem.set(def.itemId, (placedByItem.get(def.itemId) ?? 0) + def.positions.length);
  }

  const interactObjectives = Object.values(QUESTS).flatMap((quest) =>
    quest.objectives.flatMap((o, i) =>
      o.type === 'interact' && o.targetObjectItemId
        ? [{ questId: quest.id, itemId: o.targetObjectItemId, count: o.count, index: i }]
        : [],
    ),
  );

  it('covers the 21 multi-count objectives the exploit applied to', () => {
    // 20 at the ledger's introduction, plus the quest-dedupe murloc-hut burn
    // (q_deepfen_purge, count 5 over 5 authored huts). The huts route to the
    // firebottle handler before the generic interact path, so their re-credit
    // pacing is the timed burnedObjects cooldown, not this ledger; the
    // distinct-objects floor above still holds for them.
    expect(interactObjectives.filter((o) => o.count > 1).length).toBe(21);
  });

  it.each(interactObjectives.filter((o) => o.count > 1))(
    '$questId can reach $count on distinct $itemId objects',
    ({ itemId, count }) => {
      expect(placedByItem.get(itemId) ?? 0).toBeGreaterThanOrEqual(count);
    },
  );

  it('places every one of them at a DISTINCT authored spot', () => {
    // Two objects authored at the same spot would share a ledger key and only
    // credit once between them, which is the same dead end by another route.
    // Grouped by itemId, not per GroundObjectDef: a second def sharing an itemId
    // would otherwise slip a duplicate spot past this.
    const spotsByItem = new Map<string, string[]>();
    for (const def of GROUND_OBJECTS) {
      const keys = def.positions.map((p) => interactObjectCreditKey(0, p));
      spotsByItem.set(def.itemId, [...(spotsByItem.get(def.itemId) ?? []), ...keys]);
    }
    for (const [itemId, keys] of spotsByItem) {
      expect(new Set(keys).size, `${itemId} authored positions`).toBe(keys.length);
    }
  });

  it('spawns every interact target at a FIXED world position, never instance-relative', () => {
    // The ledger key is the object's world position, which is only stable
    // because every interact target is a world GROUND_OBJECTS placement.
    // A dungeon object spawns at `origin + offset` with a per-instance-slot
    // origin (instances/dungeons.ts), so an interact target placed there would
    // key differently in every instance copy and could be credited again after
    // an instance reset. No dungeon places one today: keep it that way.
    const dungeonObjectItemIds = new Set(
      Object.values(DUNGEONS).flatMap((d) => (d.objects ?? []).map((o) => o.itemId)),
    );
    for (const { itemId, questId } of interactObjectives) {
      expect(dungeonObjectItemIds.has(itemId), `${questId} target ${itemId}`).toBe(false);
    }
  });

  it('places every interact target in the world table, bar the riding-lesson sentinel', () => {
    // train_valorsteed is a sentinel targetObjectItemId with no object at all
    // (mounts_training.ts credits it off the trainer NPC), so it never reaches
    // the ledger. Anything ELSE missing from the world table would mean an
    // objective whose object spawns somewhere this reasoning has not checked.
    const worldItemIds = new Set(GROUND_OBJECTS.map((d) => d.itemId));
    const unplaced = [...new Set(interactObjectives.map((o) => o.itemId))].filter(
      (id) => !worldItemIds.has(id),
    );
    expect(unplaced).toEqual(['train_valorsteed']);
  });
});

describe('interactObjectCreditKey', () => {
  it('is stable for the same authored spot and distinct per position', () => {
    expect(interactObjectCreditKey(0, { x: 256, z: 0 })).toBe(
      interactObjectCreditKey(0, { x: 256, z: 0 }),
    );
    expect(interactObjectCreditKey(0, { x: 256, z: 0 })).not.toBe(
      interactObjectCreditKey(0, { x: 318, z: 94 }),
    );
    expect(interactObjectCreditKey(0, { x: 442, z: 64 })).toBe('0@442.0,64.0');
  });

  it('survives float drift in a ground-snapped position', () => {
    expect(interactObjectCreditKey(0, { x: 256.00000001, z: -0.00000001 })).toBe(
      interactObjectCreditKey(0, { x: 256, z: 0 }),
    );
  });

  it('does not collide across a negative/positive coordinate pair', () => {
    expect(interactObjectCreditKey(0, { x: -12, z: 4 })).not.toBe(
      interactObjectCreditKey(0, { x: 12, z: 4 }),
    );
    expect(interactObjectCreditKey(0, { x: -0, z: 0 })).toBe(
      interactObjectCreditKey(0, { x: 0, z: 0 }),
    );
  });
});

describe('credit bookkeeping on QuestProgress', () => {
  function progress(): QuestProgress {
    return { questId: BELLS_QUEST, counts: [0], state: 'active' };
  }

  it('records and reads back a credit', () => {
    const qp = progress();
    const key = interactObjectCreditKey(0, { x: 256, z: 0 });
    expect(hasInteractObjectCredit(qp, key)).toBe(false);
    recordInteractObjectCredit(qp, key);
    expect(hasInteractObjectCredit(qp, key)).toBe(true);
    expect(hasInteractObjectCredit(qp, interactObjectCreditKey(0, { x: 318, z: 94 }))).toBe(false);
  });

  it('never double-records the same key', () => {
    const qp = progress();
    const key = interactObjectCreditKey(0, { x: 256, z: 0 });
    recordInteractObjectCredit(qp, key);
    recordInteractObjectCredit(qp, key);
    expect(qp.creditedObjects).toEqual([key]);
  });

  it('leaves the field absent until something is credited (parity-stable saves)', () => {
    const qp = progress();
    expect(qp.creditedObjects).toBeUndefined();
    expect(hasInteractObjectCredit(qp, 'anything')).toBe(false);
  });
});

describe('sanitizeCreditedObjects (load-side normalization)', () => {
  it('keeps a clean string list', () => {
    expect(sanitizeCreditedObjects(['0@256.0,0.0'])).toEqual(['0@256.0,0.0']);
  });

  it('drops non-strings, duplicates, and a non-array entirely', () => {
    expect(sanitizeCreditedObjects(['0@1.0,2.0', 1, '0@1.0,2.0', null, '0@3.0,4.0'])).toEqual([
      '0@1.0,2.0',
      '0@3.0,4.0',
    ]);
    expect(sanitizeCreditedObjects(undefined)).toBeUndefined();
    expect(sanitizeCreditedObjects('0@1.0,2.0')).toBeUndefined();
    expect(sanitizeCreditedObjects([])).toBeUndefined();
    expect(sanitizeCreditedObjects(null)).toBeUndefined();
  });

  it('bounds a tampered row: caps the list and drops absurd keys', () => {
    // This runs on the login path inside the server tick, and the result is
    // re-serialized into the character row on every autosave, so a hostile blob
    // must not stall the tick or bloat the row forever.
    const huge = Array.from({ length: 5000 }, (_, i) => `0@${i}.0,0.0`);
    expect(sanitizeCreditedObjects(huge)?.length).toBe(64);
    expect(sanitizeCreditedObjects(['x'.repeat(5000), '0@1.0,2.0'])).toEqual(['0@1.0,2.0']);
  });

  it('keeps only strings in the exact key grammar', () => {
    // A key that does not match what interactObjectCreditKey emits was never
    // produced by this module, so it is tamper or a bug elsewhere. Per DIMENSION
    // negatives, so a loosened regex cannot pass by accident.
    expect(sanitizeCreditedObjects([interactObjectCreditKey(2, { x: -12.5, z: 4 })])).toEqual([
      '2@-12.5,4.0',
    ]);
    for (const bad of [
      'a', // no structure at all
      '0@256,0.0', // x missing its decimal
      '0@256.0,0', // z missing its decimal
      '0@256.00,0.0', // wrong precision
      '@256.0,0.0', // no objective index
      'x@256.0,0.0', // non-numeric objective index
      '0@256.0', // one coordinate
      '0@256.0,0.0,7.0', // three coordinates
      ' 0@256.0,0.0', // leading space
      '0@256.0,0.0 ', // trailing space
      '0@abc.0,0.0', // non-numeric coordinate
    ]) {
      expect(sanitizeCreditedObjects([bad]), `should drop ${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  it('drops a bad key rather than keeping it, which is the fail-open direction', () => {
    // Keeping an unrecognized key would refuse an object the player never used
    // and dead-end the quest; dropping it only re-grants that one interact.
    expect(sanitizeCreditedObjects(['garbage', '0@1.0,2.0'])).toEqual(['0@1.0,2.0']);
  });
});

describe('the removed-quest migration carries the ledger', () => {
  function stateWith(creditedObjects: unknown): any {
    return {
      questLog: [{ questId: BELLS_QUEST, counts: [1], state: 'active', creditedObjects }],
      questsDone: [],
      inventory: [],
    };
  }

  it('preserves a live ledger through the migration', () => {
    const key = interactObjectCreditKey(0, { x: 256, z: 0 });
    const { state } = sanitizeRemovedZone1Content(stateWith([key]) as any);
    expect(state.questLog[0].creditedObjects).toEqual([key]);
  });

  it('does not throw on a malformed ledger, and drops it', () => {
    // This is the FIRST reader of the raw JSONB (it runs before the load-side
    // normalization in Sim.addPlayer) and it is on the save path too, so a
    // malformed value here would lock the character out of both.
    expect(() => sanitizeRemovedZone1Content(stateWith(null) as any)).not.toThrow();
    expect(
      sanitizeRemovedZone1Content(stateWith(null) as any).state.questLog[0].creditedObjects,
    ).toBeUndefined();
    expect(() => sanitizeRemovedZone1Content(stateWith('nope') as any)).not.toThrow();
    expect(() => sanitizeRemovedZone1Content(stateWith(7) as any)).not.toThrow();
  });
});

describe('back-compat with saves written before the fix', () => {
  it('a legacy in-progress quest keeps its counts and can still be finished', () => {
    const { sim, player, bells, qp } = bellWorld();
    // A save from before the fix: two bells already credited, no credit ledger.
    qp.counts[0] = 2;
    qp.creditedObjects = undefined;
    // The player must never be dead-ended: the remaining bell still credits.
    expect(ring(sim, player, bells[2])).toBe(true);
    expect(qp.counts[0]).toBe(3);
    expect(qp.state).toBe('ready');
  });
});

describe('the ledger survives a save/load round-trip', () => {
  it('a relogged player cannot re-ring a bell they already rang', () => {
    const { sim, player, bells, qp } = bellWorld();
    ring(sim, player, bells[0]);
    expect(qp.counts[0]).toBe(1);

    // Round-trip through the real serialize/load pair, the way a logout and
    // login does: without persistence the exploit just costs one relog.
    const saved = JSON.parse(JSON.stringify(sim.serializeCharacter(sim.playerId)));
    expect(saved.questLog.find((q: any) => q.questId === BELLS_QUEST).creditedObjects).toEqual([
      interactObjectCreditKey(0, bells[0].pos),
    ]);

    const reloaded = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const rePid = reloaded.addPlayer('warrior', 'Reload', { state: saved });
    const reQp = reloaded.meta(rePid)?.questLog.get(BELLS_QUEST) as QuestProgress;
    const reBells = [...reloaded.entities.values()].filter(
      (e: AnyEntity) => e.kind === 'object' && e.objectItemId === BELL_ITEM,
    ) as AnyEntity[];
    const rePlayer = reloaded.entities.get(rePid) as AnyEntity;
    place(reloaded, rePlayer, reBells[0].pos.x, reBells[0].pos.z);

    reloaded.pickUpObject(reBells[0].id, rePid);
    expect(reQp.counts[0], 'the same bell after a relog').toBe(1);
    place(reloaded, rePlayer, reBells[1].pos.x, reBells[1].pos.z);
    reloaded.pickUpObject(reBells[1].id, rePid);
    expect(reQp.counts[0], 'a different bell still credits').toBe(2);
  });
});

describe('the load path normalizes an untrusted ledger', () => {
  function loadWith(creditedObjects: unknown): QuestProgress | undefined {
    const donor = bellWorld();
    const saved = JSON.parse(JSON.stringify(donor.sim.serializeCharacter(donor.sim.playerId)));
    const row = saved.questLog.find((q: any) => q.questId === BELLS_QUEST);
    row.creditedObjects = creditedObjects;
    const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid = sim.addPlayer('warrior', 'Reload', { state: saved });
    return sim.meta(pid)?.questLog.get(BELLS_QUEST);
  }

  it('drops junk entries and duplicates coming out of the save blob', () => {
    // sanitizeCreditedObjects is wired into the real load loop, not just unit
    // tested: this is untrusted JSONB from the characters row.
    expect(
      loadWith(['0@1.0,2.0', 1, '0@1.0,2.0', null, 'garbage', '0@3.0,4.0'])?.creditedObjects,
    ).toEqual(['0@1.0,2.0', '0@3.0,4.0']);
  });

  it('loads a malformed ledger as absent instead of throwing', () => {
    expect(() => loadWith('garbage')).not.toThrow();
    expect(loadWith('garbage')?.creditedObjects).toBeUndefined();
    expect(loadWith(null)?.creditedObjects).toBeUndefined();
  });
});

describe('abandoning the quest clears the ledger', () => {
  it('a re-accepted quest can ring the same bells again', () => {
    const { sim, meta, player, bells } = bellWorld();
    ring(sim, player, bells[0]);
    sim.abandonQuest(BELLS_QUEST);
    place(sim, player, bells[0].pos.x, bells[0].pos.z);
    // Re-accept through the real path (the giver is only reachable in town, so
    // walk back to Tam first).
    const tam = [...sim.entities.values()].find(
      (e: AnyEntity) => e.templateId === 'bellkeeper_tam',
    ) as AnyEntity;
    place(sim, player, tam.pos.x, tam.pos.z);
    sim.acceptQuest(BELLS_QUEST);
    const qp2 = meta.questLog.get(BELLS_QUEST) as QuestProgress;
    expect(qp2.creditedObjects, 'a fresh accept starts with no ledger').toBeUndefined();
    expect(ring(sim, player, bells[0]), 'the first bell credits again').toBe(true);
    expect(qp2.counts[0]).toBe(1);
  });
});

describe('questProgressForWire (the server-only ledger never ships to clients)', () => {
  it('strips the ledger and leaves every field the client reads', () => {
    const qp: QuestProgress = {
      questId: BELLS_QUEST,
      counts: [2],
      state: 'active',
      selection: 'pick',
      resolvedCounts: [3],
      creditedObjects: ['0@256.0,0.0'],
    };
    const wire = questProgressForWire(qp);
    expect(wire.creditedObjects).toBeUndefined();
    expect(wire).toEqual({
      questId: BELLS_QUEST,
      counts: [2],
      state: 'active',
      selection: 'pick',
      resolvedCounts: [3],
    });
    expect(JSON.stringify(wire)).not.toContain('creditedObjects');
    expect(qp.creditedObjects, 'the live progress is not mutated').toEqual(['0@256.0,0.0']);
  });

  it('passes a ledger-free progress through without allocating a copy', () => {
    const qp: QuestProgress = { questId: BELLS_QUEST, counts: [0], state: 'active' };
    expect(questProgressForWire(qp)).toBe(qp);
  });
});

describe('the sibling interact-credit paths this fix does NOT cover', () => {
  it('has no multi-count objective outside the object-keyed path', () => {
    // Two other paths credit an `interact` objective and neither consults the
    // ledger: interactNpcForQuests (sim.ts, keyed on targetNpcId) and
    // creditRidingLessonInteract (mounts_training.ts, the train_valorsteed
    // sentinel). Both are safe ONLY because every objective they serve is
    // count 1, where the pre-existing `counts >= required` gate makes them
    // one-shot. A multi-count one would inherit the exact exploit this fix
    // closes, in a path that does not fix it. Fail here rather than there.
    const unguarded = Object.values(QUESTS).flatMap((quest) =>
      quest.objectives.flatMap((o) =>
        o.type === 'interact' && !o.targetObjectItemId && o.count > 1
          ? [`${quest.id}:${o.targetNpcId ?? '?'}`]
          : [],
      ),
    );
    expect(unguarded).toEqual([]);

    // The sentinel is object-keyed by type but has no object, so it rides the
    // same "count 1 is the only guard" reasoning.
    const sentinel = QUESTS.q_riding_lessons?.objectives.find(
      (o) => o.type === 'interact' && o.targetObjectItemId === 'train_valorsteed',
    );
    expect(sentinel?.count).toBe(1);
  });
});
