// Slice 2 of The Undermount Descent (docs/prd/furnace-lair-raid.md): the seal
// rule enforced end to end through a real Sim. A sealed wing rejects entry; a
// clear (killing the prior wing's boss) records permanent per-character progress
// that opens the next wing. Test-first: RED until the enterDungeon seal check,
// the PlayerMeta.undermountCleared state, and the clear-on-boss-death hook land.

import { describe, expect, it } from 'vitest';
import { ZONE3_QUEST_ORDER } from '../src/sim/content/zone3';
import { CLASSES, ITEMS, MOBS, QUESTS } from '../src/sim/data';
import { onUndermountBossDeath } from '../src/sim/encounters/undermount';
import { enterDungeon, instanceKeyFor } from '../src/sim/instances/dungeons';
import {
  UNDERMOUNT_FOREMAN_ID,
  UNDERMOUNT_RUNE_ITEM_ID,
  UNDERMOUNT_RUNE_POSITIONS,
} from '../src/sim/quests/undermount_prequest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 7): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

// A claimed instance of `dungeonId` owned by this player's group, or undefined
// when entry was refused (the observable difference between sealed and open).
function claimFor(sim: AnySim, dungeonId: string, pid: number): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.partyKey === instanceKeyFor(sim.ctx, pid),
  );
}

function metaOf(sim: AnySim, pid: number): any {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no player ${pid}`);
  return r.meta;
}

function bossIn(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const boss = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${inst.dungeonId}`);
  return boss as AnyEntity;
}

function maerinYells(events: ReturnType<Sim['drainEvents']>): string[] {
  return events
    .filter(
      (event) =>
        event.type === 'chat' && event.channel === 'yell' && event.from === 'Runeseeker Maerin',
    )
    .map((event) => (event.type === 'chat' ? event.text : ''));
}

function runDialogue(sim: AnySim, seconds = 10): ReturnType<Sim['drainEvents']> {
  const events = sim.drainEvents();
  for (let tick = 0; tick < seconds * 20; tick++) events.push(...sim.tick());
  return events;
}

describe('Undermount wing progression (seal enforced through the Sim)', () => {
  it('blocks a sealed wing, then unseals it on the prior boss kill', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const player = sim.entities.get(pid) as AnyEntity;
    const meta = metaOf(sim, pid);

    expect(
      ['q_undermount_heat', 'q_undermount_ledger', 'q_undermount_descent'].every(
        (questId) => !meta.questsDone.has(questId),
      ),
      'the optional pre-quest was skipped',
    ).toBe(true);

    // Wing 2 is sealed until wing 1 is cleared: entry is refused (no claim).
    enterDungeon(sim.ctx, 'undermount_wing2', pid);
    expect(claimFor(sim, 'undermount_wing2', pid), 'wing 2 starts sealed').toBeUndefined();
    expect(meta.undermountCleared.has('undermount_wing1')).toBe(false);

    // Wing 1 is always open.
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const wing1 = claimFor(sim, 'undermount_wing1', pid);
    expect(wing1, 'wing 1 is open').toBeDefined();

    // The Kiln-Keepers duo clears the wing only when BOTH keepers fall.
    for (const id of ['vosh_the_glazier', 'saan_the_stoker']) {
      const keeper = bossIn(sim, wing1, id);
      sim.dealDamage(player, keeper, keeper.hp, false, 'physical', null, 'hit', true);
      expect(keeper.dead, `${id} died`).toBe(true);
    }
    expect(meta.undermountCleared.has('undermount_wing1'), 'wing 1 recorded').toBe(true);

    // With wing 1 cleared, wing 2 now opens.
    enterDungeon(sim.ctx, 'undermount_wing2', pid);
    expect(claimFor(sim, 'undermount_wing2', pid), 'wing 2 now open').toBeDefined();
    expect(
      ['q_undermount_heat', 'q_undermount_ledger', 'q_undermount_descent'].every(
        (questId) => !meta.questsDone.has(questId),
      ),
      'wing progress never completes or requires the optional pre-quest',
    ).toBe(true);
  });

  it('does not clear a wing when a non-boss dies', () => {
    const sim = makeSim(11);
    const pid = sim.addPlayer('warrior', 'Solo');
    const meta = metaOf(sim, pid);
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    expect(meta.undermountCleared.size).toBe(0);
  });

  it('keeps wing clears scoped to the character that earned them', () => {
    const sim = makeSim(19);
    const clearedPid = sim.addPlayer('warrior', 'Cleared');
    const sealedPid = sim.addPlayer('mage', 'Sealed');
    metaOf(sim, clearedPid).undermountCleared.add('undermount_wing1');

    enterDungeon(sim.ctx, 'undermount_wing2', clearedPid);
    enterDungeon(sim.ctx, 'undermount_wing2', sealedPid);

    expect(claimFor(sim, 'undermount_wing2', clearedPid), 'cleared character enters').toBeDefined();
    expect(
      claimFor(sim, 'undermount_wing2', sealedPid),
      'other character stays sealed',
    ).toBeUndefined();
  });

  it('spawns Maerin once on a completed wing and delivers every beat in order', () => {
    const expectedByWing = {
      undermount_wing1: [
        "This craftsmanship... a whole guild's work, for a cult of arsonists? Something down here is worth hiding behind all this.",
        'Beast provisions, wages, kennel feed... and the signature page torn out. Someone left in a hurry. North.',
        'They are not making anything. They are keeping something ASLEEP until they are ready.',
      ],
      undermount_wing2: [
        'These are not summoning wards. They are RESTRAINTS, and we have been CUTTING them. Every keeper we killed was a lock.',
        'There was never a factory. There was only ever him, and a very good disguise. Go.',
      ],
      undermount_wing3: [
        'Half-formed. We killed him before the forge could finish its work.',
        'The fire is receding north along the vein. This is not over.',
      ],
    } as const;

    for (const [index, [dungeonId, expected]] of Object.entries(expectedByWing).entries()) {
      const sim = makeSim(40 + index);
      const pid = sim.addPlayer('warrior', 'Solo');
      const player = sim.entities.get(pid) as AnyEntity;
      const meta = metaOf(sim, pid);
      if (dungeonId !== 'undermount_wing1') meta.undermountCleared.add('undermount_wing1');
      if (dungeonId === 'undermount_wing3') meta.undermountCleared.add('undermount_wing2');
      enterDungeon(sim.ctx, dungeonId, pid);
      const claim = claimFor(sim, dungeonId, pid);
      expect(claim, `${dungeonId} opens for its cleared prerequisite`).toBeDefined();
      sim.drainEvents();

      const bossIds =
        dungeonId === 'undermount_wing1'
          ? ['vosh_the_glazier', 'saan_the_stoker']
          : dungeonId === 'undermount_wing2'
            ? ['odrenn_the_temperer']
            : ['volzharr_buried_furnace'];
      for (const bossId of bossIds) {
        const boss = bossIn(sim, claim, bossId);
        sim.dealDamage(player, boss, boss.hp, false, 'physical', null, 'hit', true);
        if (bossId === bossIds[0] && bossIds.length > 1) {
          expect(maerinYells(sim.drainEvents()), 'Maerin waits for the full duo clear').toEqual([]);
        }
      }

      const finalBoss = bossIn(sim, claim, bossIds.at(-1) ?? '');
      onUndermountBossDeath(sim.ctx, finalBoss);
      const yells = maerinYells(runDialogue(sim));
      expect(yells, `${dungeonId} dialogue order and once-only delivery`).toEqual(expected);
      expect(yells.length, `${dungeonId} has 2 to 3 corpse lines`).toBeGreaterThanOrEqual(2);
      expect(yells.length, `${dungeonId} has 2 to 3 corpse lines`).toBeLessThanOrEqual(3);

      const maerins = claim.mobIds
        .map((entityId: number) => sim.entities.get(entityId))
        .filter(
          (entity: AnyEntity | undefined) =>
            entity?.templateId === 'runeseeker_maerin' && !entity.dead,
        );
      expect(maerins, `${dungeonId} owns one Maerin spawn`).toHaveLength(1);
      if (dungeonId !== 'undermount_wing3') {
        expect(maerins[0].channeling, 'Maerin channels the next wing door as flavor').toBe(true);
        expect(maerins[0].castingAbility).toBe('undermount_door_channel');
      }
    }

    expect(expectedByWing.undermount_wing1).toContain(
      'Beast provisions, wages, kennel feed... and the signature page torn out. Someone left in a hurry. North.',
    );
  });

  it('authors the optional surface chain and no-stat Runeseeker Lantern reward', () => {
    expect(ZONE3_QUEST_ORDER.slice(-3)).toEqual([
      'q_undermount_heat',
      'q_undermount_ledger',
      'q_undermount_descent',
    ]);
    expect(QUESTS.q_undermount_heat.objectives).toEqual([
      {
        type: 'interact',
        targetObjectItemId: UNDERMOUNT_RUNE_ITEM_ID,
        count: 3,
        label: 'Rune rubbings taken',
      },
    ]);
    expect(QUESTS.q_undermount_ledger.objectives).toEqual([
      {
        type: 'kill',
        targetMobId: UNDERMOUNT_FOREMAN_ID,
        count: 1,
        label: 'Wyrmcult foreman slain',
      },
      {
        type: 'kill',
        targetMobId: 'wyrmcult_zealot',
        count: 3,
        label: 'Wyrmcult guards slain',
      },
      {
        type: 'collect',
        itemId: 'undermount_foreman_ledger',
        count: 1,
        label: 'Foreman ledger recovered',
      },
    ]);
    expect(QUESTS.q_undermount_descent.requiresQuest).toBe('q_undermount_ledger');
    expect(QUESTS.q_undermount_ledger.requiresQuest).toBe('q_undermount_heat');
    expect(MOBS[UNDERMOUNT_FOREMAN_ID].name).toBe('Wyrmcult Dig Foreman');
    expect(MOBS[UNDERMOUNT_FOREMAN_ID].loot).toContainEqual({
      itemId: 'undermount_foreman_ledger',
      chance: 1,
      questId: 'q_undermount_ledger',
    });
    expect(new Set(Object.values(QUESTS.q_undermount_descent.itemRewards))).toEqual(
      new Set(['runeseekers_lantern']),
    );
    expect(new Set(Object.keys(QUESTS.q_undermount_descent.itemRewards))).toEqual(
      new Set(Object.keys(CLASSES)),
    );

    const lantern = ITEMS.runeseekers_lantern;
    expect(lantern.kind).toBe('held_offhand');
    expect(lantern.stats ?? {}, 'the Lantern grants no combat stats').toEqual({});
    expect(lantern.spellPower ?? 0).toBe(0);
    expect(lantern.critRating ?? 0).toBe(0);
    expect(lantern.hasteRating ?? 0).toBe(0);
    expect(lantern.hitRating ?? 0).toBe(0);
    expect(lantern.pvpOffenseRating ?? 0).toBe(0);
    expect(lantern.pvpDefenseRating ?? 0).toBe(0);
    expect(lantern.cosmeticOnly).toBe(true);
    expect(new Set(lantern.requiredClass)).toEqual(new Set(Object.keys(CLASSES)));
  });

  it('creates and completes the optional chain at Maerin without colliding with sigils', () => {
    const sim = makeSim(73);
    const pid = sim.addPlayer('warrior', 'Runeseeker');
    const player = sim.entities.get(pid) as AnyEntity;
    const meta = metaOf(sim, pid);
    player.level = 20;
    player.pos = { x: -170, y: 0, z: 606 };

    meta.questLog.set('q_wyrm_sigils', {
      questId: 'q_wyrm_sigils',
      counts: [0],
      state: 'active',
      resolvedCounts: [3],
    });
    sim.acceptQuest('q_undermount_heat', pid);

    const runeFaces = [...sim.entities.values()].filter(
      (entity: AnyEntity) =>
        entity.kind === 'object' && entity.objectItemId === UNDERMOUNT_RUNE_ITEM_ID,
    );
    expect(runeFaces).toHaveLength(3);
    expect(runeFaces.map((entity: AnyEntity) => ({ x: entity.pos.x, z: entity.pos.z }))).toEqual(
      UNDERMOUNT_RUNE_POSITIONS,
    );
    for (const rune of runeFaces) {
      player.pos = { ...rune.pos };
      expect(sim.pickUpObject(rune.id, pid)).toBe(true);
    }
    expect(meta.questLog.get('q_undermount_heat')?.state).toBe('ready');
    expect(meta.questLog.get('q_wyrm_sigils')?.counts).toEqual([0]);

    const gravewyrmSigil = [...sim.entities.values()].find(
      (entity: AnyEntity) => entity.objectItemId === 'gravewyrm_sigil',
    );
    if (!gravewyrmSigil) throw new Error('missing original Gravewyrm Sigil object');
    player.pos = { ...gravewyrmSigil.pos };
    expect(sim.pickUpObject(gravewyrmSigil.id, pid)).toBe(true);
    expect(meta.questLog.get('q_wyrm_sigils')?.counts).toEqual([1]);

    player.pos = { x: -170, y: 0, z: 606 };
    sim.turnInQuest('q_undermount_heat', pid);
    sim.acceptQuest('q_undermount_ledger', pid);
    const digMobs = [...sim.entities.values()].filter(
      (entity: AnyEntity) =>
        entity.kind === 'mob' &&
        (entity.templateId === UNDERMOUNT_FOREMAN_ID || entity.templateId === 'wyrmcult_zealot') &&
        Math.abs(entity.pos.x + 186) < 15 &&
        Math.abs(entity.pos.z - 613) < 8,
    );
    expect(
      digMobs.filter((entity: AnyEntity) => entity.templateId === UNDERMOUNT_FOREMAN_ID),
    ).toHaveLength(1);
    expect(
      digMobs.filter((entity: AnyEntity) => entity.templateId === 'wyrmcult_zealot'),
    ).toHaveLength(3);

    for (const mob of digMobs) {
      sim.dealDamage(player, mob, mob.hp, false, 'physical', null, 'hit', true);
      if (mob.templateId === UNDERMOUNT_FOREMAN_ID) {
        player.pos = { ...mob.pos };
        sim.lootCorpse(mob.id, pid);
      }
    }
    expect(meta.questLog.get('q_undermount_ledger')?.counts).toEqual([1, 3, 1]);
    expect(meta.questLog.get('q_undermount_ledger')?.state).toBe('ready');
  });

  it.each([
    ['q_undermount_heat', 'rune faces', 1],
    ['q_undermount_ledger', 'dig opposition', 3],
  ] as const)('restores %s quest-local %s after save and reload', (questId, _label, countSize) => {
    const source = makeSim(79);
    const sourcePid = source.addPlayer('warrior', 'Runeseeker');
    metaOf(source, sourcePid).questLog.set(questId, {
      questId,
      counts: Array.from({ length: countSize }, () => 0),
      state: 'active',
    });
    const state = source.serializeCharacter(sourcePid);
    if (!state) throw new Error('missing serialized character');

    const restored = makeSim(83);
    restored.addPlayer('warrior', 'Runeseeker', { state });
    const entities = [...restored.entities.values()] as AnyEntity[];
    if (questId === 'q_undermount_heat') {
      expect(
        entities.filter(
          (entity) => entity.kind === 'object' && entity.objectItemId === UNDERMOUNT_RUNE_ITEM_ID,
        ),
      ).toHaveLength(3);
    } else {
      expect(entities.filter((entity) => entity.templateId === UNDERMOUNT_FOREMAN_ID)).toHaveLength(
        1,
      );
      expect(
        entities.filter(
          (entity) =>
            entity.templateId === 'wyrmcult_zealot' &&
            Math.abs(entity.pos.x + 186) < 15 &&
            Math.abs(entity.pos.z - 613) < 8,
        ),
      ).toHaveLength(3);
    }
  });
});
