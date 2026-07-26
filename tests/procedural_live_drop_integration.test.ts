import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { canEquipItem } from '../src/sim/equipment_rules';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { appendLiveProceduralDrop, proceduralLootSourceEligible } from '../src/sim/loot/loot_roll';
import { Sim } from '../src/sim/sim';
import type { Entity, MobTemplate } from '../src/sim/types';

const rareTemplate = Object.values(MOBS).find(
  (template) => template.maxLevel >= 5 && template.rare && !template.worldBoss,
);
const normalTemplate = Object.values(MOBS).find(
  (template) =>
    template.maxLevel >= 5 &&
    !template.elite &&
    !template.rare &&
    !template.boss &&
    !template.worldBoss &&
    !template.dummy,
);

if (!rareTemplate || !normalTemplate) throw new Error('expected procedural loot fixtures');

function setup(seed = 20_061) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    proceduralItemUidLease: {
      realmNamespace: 'live_int',
      startSerial: '1000',
      endExclusive: '10000',
    },
  });
  const pid = sim.addPlayer('warrior', 'Loot Tester');
  const meta = sim.ctx.players.get(pid);
  if (!meta) throw new Error('expected player metadata');
  const makeMob = (template: MobTemplate, registered = true): Entity => {
    const mob = createMob(sim.ctx.nextId++, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    if (registered) sim.ctx.registerProceduralLootSource(mob);
    sim.addEntity(mob);
    return mob;
  };
  return { sim, pid, meta, makeMob };
}

function proceduralSlot(mob: Entity) {
  return mob.loot?.items.find((slot) => slot.instance?.procedural);
}

describe('live procedural loot roll integration', () => {
  it('appends exact rare drops with deterministic replay, unique UIDs, and source metadata', () => {
    const first = setup();
    const mob = first.makeMob(rareTemplate);

    first.sim.ctx.rollLoot(mob, first.meta);
    const initial = proceduralSlot(mob);
    expect(initial?.instance?.procedural).toMatchObject({
      uid: 'pi1:live_int:1000',
      dropContext: {
        source: 'rare',
        sourceEntityId: mob.id,
        sourceSpawnSequence: 0,
        lootSlotIndex: 0,
        sourceTemplateId: rareTemplate.id,
      },
    });
    expect(initial?.instance?.procedural?.dropContext?.sourceTags).toContain(rareTemplate.family);

    first.sim.ctx.rollLoot(mob, first.meta);
    const second = proceduralSlot(mob);
    expect(second?.instance?.procedural?.uid).toBe('pi1:live_int:1001');
    expect(second?.instance?.procedural?.dropContext?.sourceSpawnSequence).toBe(1);
    expect(second?.instance?.procedural?.seed).not.toBe(initial?.instance?.procedural?.seed);

    const replay = setup();
    const replayMob = replay.makeMob(rareTemplate);
    replay.sim.ctx.rollLoot(replayMob, replay.meta);
    expect(proceduralSlot(replayMob)).toEqual(initial);
  });

  it('keeps the five percent normal policy deterministic and allocates UIDs only for hits', () => {
    const { sim, meta, makeMob } = setup(91_337);
    const mob = makeMob(normalTemplate);
    const uids: string[] = [];
    const sourceSequences: number[] = [];

    for (let attempt = 0; attempt < 1000; attempt++) {
      mob.loot = null;
      sim.ctx.rollLoot(mob, meta);
      const procedural = proceduralSlot(mob)?.instance?.procedural;
      if (!procedural) continue;
      uids.push(procedural.uid);
      sourceSequences.push(procedural.dropContext?.sourceSpawnSequence ?? -1);
    }

    expect(uids.length).toBeGreaterThan(30);
    expect(uids.length).toBeLessThan(70);
    expect(uids).toEqual(uids.map((_, index) => `pi1:live_int:${1000 + index}`));
    expect(new Set(sourceSequences).size).toBe(sourceSequences.length);
  });

  it('fails closed for unregistered, summoned, developer, affix, world boss, and dummy sources', () => {
    const { sim, pid, makeMob } = setup();
    const unregistered = makeMob(rareTemplate, false);
    const summoned = makeMob(rareTemplate);
    summoned.ownerId = pid;
    const developer = makeMob(rareTemplate);
    developer.devSpawnOwnerId = pid;
    const affix = makeMob(rareTemplate);
    affix.affixSpawned = true;
    const worldBossTemplate = Object.values(MOBS).find((template) => template.worldBoss);
    const dummyTemplate = Object.values(MOBS).find((template) => template.dummy);
    if (!worldBossTemplate || !dummyTemplate) throw new Error('expected exclusion fixtures');
    const worldBoss = makeMob(worldBossTemplate);
    const dummy = makeMob(dummyTemplate);

    for (const mob of [unregistered, summoned, developer, affix, worldBoss, dummy]) {
      expect(proceduralLootSourceEligible(sim.ctx, mob)).toBe(false);
    }
    expect(sim.allocateProceduralItemUid()).toBe('pi1:live_int:1000');
  });

  it('does not consume the legacy shared RNG stream', () => {
    const first = setup(7788);
    const replay = setup(7788);
    const mob = first.makeMob(rareTemplate);
    replay.makeMob(rareTemplate);

    appendLiveProceduralDrop(first.sim.ctx, mob, rareTemplate, []);

    expect(first.sim.ctx.rng.next()).toBe(replay.sim.ctx.rng.next());
  });

  it('uses every eligible recipient for shared smart loot without favoring the tap holder', () => {
    const run = (tapClass: 'warrior' | 'mage') => {
      const state = setup(44_771);
      const magePid = state.sim.addPlayer('mage', 'Second Recipient');
      const mageMeta = state.sim.ctx.players.get(magePid);
      if (!mageMeta) throw new Error('expected second recipient metadata');
      const mob = state.makeMob(rareTemplate);
      const eligible = [state.meta, mageMeta];
      const tap = tapClass === 'warrior' ? state.meta : mageMeta;

      state.sim.ctx.rollLoot(mob, tap, tapClass === 'warrior' ? eligible : [...eligible].reverse());
      const slot = proceduralSlot(mob);
      if (!slot) throw new Error('expected guaranteed rare procedural slot');
      return {
        itemId: slot.itemId,
        procedural: slot.instance?.procedural,
      };
    };

    expect(run('mage')).toEqual(run('warrior'));
  });

  it('raises caster-only base frequency when a caster shares loot eligibility', () => {
    const sample = (includeMage: boolean) => {
      const state = setup(56_881);
      const magePid = state.sim.addPlayer('mage', 'Frequency Recipient');
      const mageMeta = state.sim.ctx.players.get(magePid);
      if (!mageMeta) throw new Error('expected frequency recipient metadata');
      const mob = state.makeMob(rareTemplate);
      mob.level = 20;
      let mageOnly = 0;
      for (let attempt = 0; attempt < 2000; attempt++) {
        mob.loot = null;
        state.sim.ctx.rollLoot(
          mob,
          state.meta,
          includeMage ? [state.meta, mageMeta] : [state.meta],
        );
        const slot = proceduralSlot(mob);
        if (!slot) throw new Error('expected guaranteed rare procedural slot');
        const definition = ITEMS[slot.itemId];
        if (canEquipItem('mage', definition) && !canEquipItem('warrior', definition)) mageOnly++;
      }
      return mageOnly;
    };

    expect(sample(true)).toBeGreaterThan(sample(false) * 1.45);
  });
  it('keeps authored, Heroic-only, and procedural loot together on a Heroic final boss', () => {
    const sim = new Sim({
      seed: 73_119,
      playerClass: 'warrior',
      noPlayer: true,
      proceduralItemUidLease: {
        realmNamespace: 'heroic_layers',
        startSerial: '1',
        endExclusive: '100',
      },
    });
    const pid = sim.addPlayer('warrior', 'Heroic Layer Tester');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const instance = sim.ctx.instances.find(
      (candidate) =>
        candidate.dungeonId === 'hollow_crypt' &&
        candidate.difficulty === 'heroic' &&
        candidate.partyKey !== null,
    );
    if (!instance) throw new Error('expected claimed Heroic Hollow Crypt');
    const boss = instance.mobIds
      .map((id) => sim.ctx.entities.get(id))
      .find((entity) => entity?.templateId === 'morthen');
    const player = sim.ctx.entities.get(pid);
    if (!boss || !player) throw new Error('expected Heroic Morthen and player entities');

    sim.ctx.dealDamage(player, boss, boss.hp + 1000, false, 'physical', null, 'hit');

    const slots = boss.loot?.items ?? [];
    const authoredIds = new Set(
      MOBS.morthen.loot.flatMap((entry) => (entry.itemId ? [entry.itemId] : [])),
    );
    const heroicOnlyIds = new Set(
      HEROIC_BOSS_LOOT.morthen.flatMap((entry) => (entry.itemId ? [entry.itemId] : [])),
    );
    expect(slots.some((slot) => authoredIds.has(ITEMS[slot.itemId]?.heroicOf ?? slot.itemId))).toBe(
      true,
    );
    expect(slots.some((slot) => heroicOnlyIds.has(slot.itemId))).toBe(true);
    expect(slots.some((slot) => slot.instance?.procedural)).toBe(true);
  });

  it('transports the exact generated instance from corpse to inventory', () => {
    const { sim, pid, meta, makeMob } = setup();
    const mob = makeMob(rareTemplate);
    sim.ctx.rollLoot(mob, meta);
    const instance = proceduralSlot(mob)?.instance;
    const uid = instance?.procedural?.uid;
    expect(uid).toBe('pi1:live_int:1000');

    mob.dead = true;
    mob.aiState = 'dead';
    mob.hp = 0;
    mob.tappedById = pid;
    mob.lootable = true;
    mob.corpseTimer = 999;
    const player = sim.ctx.entities.get(pid);
    if (!player) throw new Error('expected live player entity');
    mob.pos = { ...player.pos };
    expect(sim.lootCorpse(mob.id, pid)).toBe(true);

    const held = meta.inventory.find((slot) => slot.instance?.procedural?.uid === uid);
    expect(held?.instance).toEqual(instance);
  });
});
