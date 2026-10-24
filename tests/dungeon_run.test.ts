// The dungeon run read behind IWorld.dungeonRun (src/sim/instances/dungeon_run.ts):
// which group dungeon a player stands in, on what difficulty, and which of its
// bosses are down in this claim. The HUD's dungeon objectives tracker paints
// exactly this, on both hosts, so what counts as a boss row and when it ticks
// is pinned here against the real claim lifecycle.
import { describe, expect, it } from 'vitest';
import { MERE_HYDRA_HEAD_IDS } from '../src/sim/content/drowned_temple';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { DUNGEONS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { dungeonGateBossIds } from '../src/sim/instances/dungeon_gates';
import {
  dungeonRunForClaim,
  dungeonRunForPlayer,
  dungeonRunPlan,
} from '../src/sim/instances/dungeon_run';
import {
  claimedInstanceAt,
  enterDungeon,
  freeInstance,
  leaveDungeon,
} from '../src/sim/instances/dungeons';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { DungeonDifficulty, Entity } from '../src/sim/types';

const GROUP_DUNGEONS = [
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'gravewyrm_sanctum',
  'wildheart_basin',
] as const;

function makeSim(seed = 23): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  return sim;
}

function enter(
  sim: Sim,
  dungeonId: string,
  difficulty: DungeonDifficulty = 'normal',
): InstanceSlot {
  sim.setDungeonDifficulty(difficulty, sim.player.id);
  expect(enterDungeon(sim.ctx, dungeonId, sim.player.id, true)).toBe(true);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error(`no ${dungeonId} claim`);
  return inst;
}

/** The claim's placed bodies of one template, in spawn order. */
function placed(sim: Sim, inst: InstanceSlot, mobId: string): Entity[] {
  const out: Entity[] = [];
  DUNGEONS[inst.dungeonId].spawns.forEach((spawn, i) => {
    const mob = sim.ctx.entities.get(inst.mobIds[i]);
    if (spawn.mobId === mobId && mob) out.push(mob);
  });
  return out;
}

function kill(sim: Sim, inst: InstanceSlot, mobId: string): void {
  const bodies = placed(sim, inst, mobId);
  expect(bodies.length, `${mobId} is placed in ${inst.dungeonId}`).toBeGreaterThan(0);
  for (const body of bodies) sim.ctx.handleDeath(body, sim.player);
}

const rows = (sim: Sim) => sim.dungeonRun?.bosses.map((b) => [b.mobId, b.defeated]);

describe('dungeon run plan (content)', () => {
  it('tracks exactly the five group dungeons, on both difficulties', () => {
    const tracked = FINDER_ACTIVITIES.filter(
      (a) => dungeonRunPlan(a.dungeonId, a.difficulty) !== null,
    ).map((a) => a.id);
    expect(tracked.sort()).toEqual(
      GROUP_DUNGEONS.flatMap((id) => [`${id}_heroic`, `${id}_normal`]).sort(),
    );
  });

  it('leaves the raids and the solo attunement crypt untracked', () => {
    for (const id of [
      'nythraxis_crypt',
      'nythraxis_boss_arena',
      'ignivar_raid_arena',
      'ignivar_inner_crucible',
      'ignivar_forge_lift',
      'the_last_keep',
      'no_such_dungeon',
    ]) {
      expect(dungeonRunPlan(id, 'normal'), id).toBeNull();
      expect(dungeonRunPlan(id, 'heroic'), id).toBeNull();
    }
  });

  it('lists the catalogue encounters in route order, the same bosses on both difficulties', () => {
    expect(dungeonRunPlan('hollow_crypt', 'normal')?.map((r) => r.mobId)).toEqual([
      'sexton_marrow',
      'rimeweb',
      'cantor_ilvane',
      'morthen',
    ]);
    expect(dungeonRunPlan('sunken_bastion', 'normal')?.map((r) => r.mobId)).toEqual([
      'knight_commander_olen',
      'gaol_turnkey',
      'gaoler_ossick',
      'vael_the_mistcaller',
    ]);
    // The Mere Hydra is one row, second on the route: the Prism Stair behind
    // it rises only when its heads are down. The row is named for its centre
    // head, whose mob name is the boss's own.
    expect(dungeonRunPlan('drowned_temple', 'normal')?.map((r) => r.mobId)).toEqual([
      'choirmother_selthe',
      'mere_hydra_head_center',
      'tideglass_colossus',
      'ysolei',
    ]);
    expect(dungeonRunPlan('gravewyrm_sanctum', 'normal')?.map((r) => r.mobId)).toEqual([
      'korgath_the_bound',
      'grand_necromancer_velkhar',
      'korzul_the_gravewyrm',
    ]);
    expect(dungeonRunPlan('wildheart_basin', 'normal')?.map((r) => r.mobId)).toEqual([
      'wildheart_beastmaster',
      'the_gorgebloom',
      'wildheart_high_priest',
    ]);
    for (const id of GROUP_DUNGEONS) {
      expect(
        dungeonRunPlan(id, 'heroic')?.map((r) => r.mobId),
        id,
      ).toEqual(dungeonRunPlan(id, 'normal')?.map((r) => r.mobId));
    }
  });

  it('every row is a body its dungeon places exactly once, so its corpse can prove the kill', () => {
    for (const id of GROUP_DUNGEONS) {
      const seen = new Set<string>();
      for (const row of dungeonRunPlan(id, 'normal') ?? []) {
        // The boss itself leads its own body list, and no body is in two rows.
        expect(row.bodyIds[0], `${id}: ${row.mobId} leads its bodies`).toBe(row.mobId);
        for (const bodyId of row.bodyIds) {
          expect(MOBS[bodyId], `${id}: ${bodyId} is a mob`).toBeDefined();
          expect(
            DUNGEONS[id].spawns.filter((s) => s.mobId === bodyId).length,
            `${id}: ${bodyId} placements`,
          ).toBe(1);
          expect(seen.has(bodyId), `${id}: ${bodyId} belongs to one row`).toBe(false);
          seen.add(bodyId);
        }
      }
    }
  });

  it('only the Mere Hydra is a boss of several bodies, on both difficulties', () => {
    for (const difficulty of ['normal', 'heroic'] as const) {
      const several = GROUP_DUNGEONS.flatMap((id) =>
        (dungeonRunPlan(id, difficulty) ?? [])
          .filter((row) => row.bodyIds.length > 1)
          .map((row) => `${id}:${row.bodyIds.join('+')}`),
      );
      expect(several, difficulty).toEqual([
        'drowned_temple:mere_hydra_head_center+mere_hydra_head_left+mere_hydra_head_right',
      ]);
    }
    // What the row shows is the boss's name, never a head's: all three heads
    // wear it, and the row is keyed on one of them.
    for (const head of MERE_HYDRA_HEAD_IDS) expect(MOBS[head].name).toBe('Mere Hydra');
    // The same three bodies the Cantor waits on before he speaks of the kill.
    expect([...(dungeonRunPlan('drowned_temple', 'normal')?.[1].bodyIds ?? [])].sort()).toEqual(
      [...MERE_HYDRA_HEAD_IDS].sort(),
    );
  });

  it('gives a finale only to the Hollow Crypt, on its final boss, naming a summoned body', () => {
    const finales = GROUP_DUNGEONS.flatMap((id) =>
      (dungeonRunPlan(id, 'normal') ?? [])
        .filter((row) => row.finaleId !== null)
        .map((row) => `${id}:${row.mobId}>${row.finaleId}`),
    );
    expect(finales).toEqual(['hollow_crypt:morthen>crypt_knellwyrm']);
    // The finale is what the far exit portal waits on, and it is never placed.
    expect(DUNGEONS.hollow_crypt.bossExitPortal?.after).toBe('crypt_knellwyrm');
    expect(DUNGEONS.hollow_crypt.spawns.some((s) => s.mobId === 'crypt_knellwyrm')).toBe(false);
    expect(MOBS.crypt_knellwyrm).toBeDefined();
  });

  it('every boss a gate seals an arena for has a row (the Wildheart jaguar rides its master)', () => {
    // A sealed arena is the game's own mark of a boss room. The linked jaguar
    // shares the Beastmaster's health pool and falls with him, so it is one row.
    for (const id of GROUP_DUNGEONS) {
      const rowIds = new Set((dungeonRunPlan(id, 'normal') ?? []).map((r) => r.mobId));
      const unlisted = dungeonGateBossIds(DUNGEONS[id]).filter((boss) => !rowIds.has(boss));
      expect(unlisted, id).toEqual(id === 'wildheart_basin' ? ['fanglord_jaguar'] : []);
    }
  });
});

describe('dungeon run (live claim)', () => {
  it('is null in the open world and appears on entry with every boss standing', () => {
    const sim = makeSim();
    expect(sim.dungeonRun).toBeNull();
    enter(sim, 'hollow_crypt');
    expect(sim.dungeonRun).toEqual({
      dungeonId: 'hollow_crypt',
      difficulty: 'normal',
      bosses: [
        { mobId: 'sexton_marrow', defeated: false },
        { mobId: 'rimeweb', defeated: false },
        { mobId: 'cantor_ilvane', defeated: false },
        { mobId: 'morthen', defeated: false },
      ],
    });
  });

  it('ticks a row the moment its boss dies, and trash never moves it', () => {
    const sim = makeSim();
    const inst = enter(sim, 'hollow_crypt');
    const before = sim.dungeonRun;
    // A trash pack falls: nothing changes, and the view is the same object.
    const trash = DUNGEONS.hollow_crypt.spawns.findIndex((s) => s.packId === 'c1');
    sim.ctx.handleDeath(sim.ctx.entities.get(inst.mobIds[trash]) as Entity, sim.player);
    expect(sim.dungeonRun).toBe(before);
    kill(sim, inst, 'sexton_marrow');
    // No tick in between: the read is derived, not stored.
    expect(rows(sim)).toEqual([
      ['sexton_marrow', true],
      ['rimeweb', false],
      ['cantor_ilvane', false],
      ['morthen', false],
    ]);
    expect(sim.dungeonRun).not.toBe(before);
    kill(sim, inst, 'cantor_ilvane');
    expect(
      rows(sim)
        ?.filter(([, done]) => done)
        .map(([id]) => id),
    ).toEqual(['sexton_marrow', 'cantor_ilvane']);
  });

  it('hands back the SAME frozen view until the run changes', () => {
    const sim = makeSim();
    const inst = enter(sim, 'sunken_bastion');
    const first = sim.dungeonRun;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.dungeonRun).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.bosses)).toBe(true);
    expect(Object.isFrozen(first?.bosses[0])).toBe(true);
    kill(sim, inst, 'knight_commander_olen');
    const second = sim.dungeonRun;
    expect(second).not.toBe(first);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.dungeonRun).toBe(second);
    // The old object was not mutated: a consumer holding it keeps a true record.
    expect(first?.bosses[0].defeated).toBe(false);
  });

  it('reports the difficulty the CLAIM runs on, not the selector', () => {
    const sim = makeSim();
    enter(sim, 'hollow_crypt', 'heroic');
    expect(sim.dungeonRun?.difficulty).toBe('heroic');
    // The leader flips the selector for the next run while standing inside.
    sim.setDungeonDifficulty('normal', sim.player.id);
    expect(sim.dungeonDifficulty()).toBe('normal');
    expect(sim.dungeonRun?.difficulty).toBe('heroic');
  });

  it('goes away on leaving and comes back, progress intact, on re-entry', () => {
    const sim = makeSim();
    const inst = enter(sim, 'drowned_temple');
    kill(sim, inst, 'choirmother_selthe');
    const inside = sim.dungeonRun;
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    expect(sim.dungeonRun).toBeNull();
    expect(enterDungeon(sim.ctx, 'drowned_temple', sim.player.id, true)).toBe(true);
    expect(sim.dungeonRun).toBe(inside);
    expect(rows(sim)).toEqual([
      ['choirmother_selthe', true],
      ['mere_hydra_head_center', false],
      ['tideglass_colossus', false],
      ['ysolei', false],
    ]);
  });

  it('a fresh claim of the same slot starts over', () => {
    const sim = makeSim();
    const inst = enter(sim, 'gravewyrm_sanctum');
    kill(sim, inst, 'korgath_the_bound');
    expect(rows(sim)?.[0]).toEqual(['korgath_the_bound', true]);
    leaveDungeon(sim.ctx, sim.player.id);
    freeInstance(sim.ctx, inst);
    expect(dungeonRunForClaim(sim.ctx, inst)).toBeNull();
    enter(sim, 'gravewyrm_sanctum');
    expect(rows(sim)).toEqual([
      ['korgath_the_bound', false],
      ['grand_necromancer_velkhar', false],
      ['korzul_the_gravewyrm', false],
    ]);
  });

  it.each(GROUP_DUNGEONS.filter((id) => id !== 'hollow_crypt'))(
    '%s reads complete once every boss is dead, in any order',
    (dungeonId) => {
      const sim = makeSim();
      const inst = enter(sim, dungeonId, 'heroic');
      const plan = dungeonRunPlan(dungeonId, 'heroic') ?? [];
      const order = [...plan].reverse();
      order.forEach((row, n) => {
        expect(sim.dungeonRun?.bosses.filter((b) => b.defeated).length).toBe(n);
        for (const bodyId of row.bodyIds) kill(sim, inst, bodyId);
      });
      expect(sim.dungeonRun?.bosses.every((b) => b.defeated)).toBe(true);
      expect(sim.dungeonRun?.bosses.map((b) => b.mobId)).toEqual(plan.map((r) => r.mobId));
    },
  );

  it('a party member inside reads the same run; one waiting outside reads none', () => {
    const sim = makeSim();
    const inside = sim.addPlayer('mage', 'Inside');
    const outside = sim.addPlayer('priest', 'Outside');
    for (const pid of [inside, outside]) {
      sim.setPlayerLevel(20, pid);
      sim.partyInvite(pid, sim.player.id);
      sim.partyAccept(pid);
    }
    const inst = enter(sim, 'wildheart_basin');
    expect(enterDungeon(sim.ctx, 'wildheart_basin', inside, true)).toBe(true);
    kill(sim, inst, 'the_gorgebloom');
    const mine = dungeonRunForPlayer(sim.ctx, sim.player.id);
    expect(mine).not.toBeNull();
    expect(dungeonRunForPlayer(sim.ctx, inside)).toBe(mine);
    expect(dungeonRunForPlayer(sim.ctx, outside)).toBeNull();
    expect(dungeonRunForPlayer(sim.ctx, 987654)).toBeNull();
  });

  it('is null inside a dungeon that authors no tracked boss list', () => {
    const sim = makeSim();
    expect(enterDungeon(sim.ctx, 'nythraxis_crypt', sim.player.id, true)).toBe(true);
    expect(claimedInstanceAt(sim.ctx, sim.player.pos)?.dungeonId).toBe('nythraxis_crypt');
    expect(sim.dungeonRun).toBeNull();
  });

  it('draws no rng: a run that is read every tick stays identical to one never read', () => {
    const play = (read: boolean): string => {
      const sim = makeSim(91);
      const inst = enter(sim, 'hollow_crypt');
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      for (let i = 0; i < 60; i++) {
        if (i === 20) kill(sim, inst, 'rimeweb');
        if (read) void sim.dungeonRun;
        sim.tick();
      }
      return JSON.stringify(draws);
    };
    expect(play(true)).toBe(play(false));
  });
});

describe("dungeon run: the Hollow Crypt's finale belongs to Morthen's row", () => {
  function atTheFinale(difficulty: DungeonDifficulty = 'normal') {
    const sim = makeSim();
    const inst = enter(sim, 'hollow_crypt', difficulty);
    for (const boss of ['sexton_marrow', 'rimeweb', 'cantor_ilvane']) kill(sim, inst, boss);
    // The dev shortcut a playtest uses: skip his entrance, then slay him, which
    // is the only way he can die (he is immune until he lands).
    sim.chat('/dev crypt wyrm', sim.player.id);
    const morthen = placed(sim, inst, 'morthen')[0];
    expect(morthen.dead).toBe(true);
    const wyrm = () =>
      inst.mobIds
        .map((id) => sim.ctx.entities.get(id))
        .find((e): e is Entity => e?.templateId === 'crypt_knellwyrm');
    return { sim, inst, wyrm };
  }

  it('stays open while Morthen is dead and the Knellwyrm is not yet summoned', () => {
    const { sim, wyrm } = atTheFinale();
    expect(wyrm()).toBeUndefined();
    expect(rows(sim)?.[3]).toEqual(['morthen', false]);
  });

  it.each(['normal', 'heroic'] as const)(
    'stays open through the whole %s finale and closes when the Knellwyrm dies',
    (difficulty) => {
      const { sim, wyrm } = atTheFinale(difficulty);
      expect(sim.dungeonRun?.difficulty).toBe(difficulty);
      for (let i = 0; i < 20 * 3 && !wyrm(); i++) sim.tick();
      const body = wyrm();
      expect(body, 'the encounter summoned the Knellwyrm').toBeDefined();
      expect(body?.dead).toBe(false);
      const during = sim.dungeonRun;
      expect(rows(sim)).toEqual([
        ['sexton_marrow', true],
        ['rimeweb', true],
        ['cantor_ilvane', true],
        ['morthen', false],
      ]);
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      expect(sim.dungeonRun).toBe(during);
      sim.ctx.handleDeath(body as Entity, sim.player);
      expect(sim.dungeonRun?.bosses.every((b) => b.defeated)).toBe(true);
    },
  );

  it('never answers for a finale body that is gone: a re-summoned one is read afresh', () => {
    // No encounter drops and re-summons the Knellwyrm today, but one that did
    // must not leave the row answering for the body it remembered.
    const { sim, inst, wyrm } = atTheFinale();
    for (let i = 0; i < 20 * 3 && !wyrm(); i++) sim.tick();
    const first = wyrm() as Entity;
    expect(rows(sim)?.[3]).toEqual(['morthen', false]);
    // The first body leaves the world alive (never a kill).
    inst.mobIds.splice(inst.mobIds.indexOf(first.id), 1);
    sim.ctx.dropEntity(first.id);
    expect(rows(sim)?.[3]).toEqual(['morthen', false]);
    // A second one is summoned in its place and then really dies.
    const second = createMob(sim.ctx.nextId++, MOBS.crypt_knellwyrm, 10, { ...first.pos });
    sim.ctx.addEntity(second);
    inst.mobIds.push(second.id);
    expect(rows(sim)?.[3]).toEqual(['morthen', false]);
    sim.ctx.handleDeath(second, sim.player);
    expect(rows(sim)?.[3]).toEqual(['morthen', true]);
  });

  it('a new claim never reads the last run`s dead Knellwyrm', () => {
    const { sim, inst, wyrm } = atTheFinale();
    for (let i = 0; i < 20 * 3 && !wyrm(); i++) sim.tick();
    sim.ctx.handleDeath(wyrm() as Entity, sim.player);
    expect(rows(sim)?.[3]).toEqual(['morthen', true]);
    leaveDungeon(sim.ctx, sim.player.id);
    freeInstance(sim.ctx, inst);
    const fresh = enter(sim, 'hollow_crypt');
    expect(fresh.slot).toBe(inst.slot);
    expect(sim.dungeonRun?.bosses.some((b) => b.defeated)).toBe(false);
    for (const boss of ['sexton_marrow', 'rimeweb', 'cantor_ilvane']) kill(sim, fresh, boss);
    sim.chat('/dev crypt wyrm', sim.player.id);
    // Morthen is dead again, and the old wyrm's memo must not answer for the new one.
    expect(rows(sim)?.[3]).toEqual(['morthen', false]);
  });
});
