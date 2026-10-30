import { describe, expect, it } from 'vitest';
import { CAMPS, MOBS } from '../src/sim/data';
import { summonQuestMob } from '../src/sim/encounters/quest_summon';
import { createMob } from '../src/sim/entity';
import { mobTemplateForDungeonDifficulty } from '../src/sim/instances/difficulty';
import { enterDungeon } from '../src/sim/instances/dungeons';
import {
  isOpenWorldTuned,
  OPEN_WORLD_MOB_CURVE,
  openWorldMobScale,
  openWorldMobTemplate,
  spawnOpenWorldMob,
} from '../src/sim/mob/open_world_tuning';
import { Sim } from '../src/sim/sim';
import type { Entity, MobTemplate } from '../src/sim/types';

const ORIGIN = { x: 0, y: 0, z: 0 };

// Expected spawn health for a template at a level, through the curve when
// tuned, with the classic elite multiplier createMob applies on top.
function expectedMaxHp(t: MobTemplate, level: number): number {
  const base = t.hpBase + t.hpPerLevel * (level - 1);
  if (!isOpenWorldTuned(t)) return Math.round(base * (t.elite ? 2.3 : 1));
  const curve = openWorldMobScale(level).health;
  const scale = t.elite ? Math.max(1, ((40 + 18 * level) * curve) / base) : curve;
  return Math.round((t.hpBase * scale + t.hpPerLevel * scale * (level - 1)) * (t.elite ? 2.3 : 1));
}

describe('open-world mob curve', () => {
  it('ramps health evenly from the authored level-5 pool to full strength at 20', () => {
    for (let level = 1; level <= 5; level++) {
      expect(openWorldMobScale(level).health).toBe(1);
    }
    for (let level = 6; level <= 20; level++) {
      expect(openWorldMobScale(level).health - openWorldMobScale(level - 1).health).toBeCloseTo(
        0.15,
        10,
      );
    }
    expect(openWorldMobScale(20).health).toBe(3.25);
    expect(openWorldMobScale(25).health).toBe(3.25);
  });

  it('gives the level-16 elite Crusher more HP than the normal ogre without buffing damage', () => {
    const ogre = spawnOpenWorldMob(1, MOBS.thornpeak_ogre, 16, ORIGIN);
    const crusher = spawnOpenWorldMob(2, MOBS.ogre_crusher, 16, ORIGIN);
    expect(crusher.maxHp).toBeGreaterThan(ogre.maxHp);
    expect(ogre.maxHp).toBe(1089);
    expect(crusher.maxHp).toBe(1999);
    expect(crusher.weapon).toEqual(createMob(3, MOBS.ogre_crusher, 16, ORIGIN).weapon);
    expect(crusher.mechanicDamageMult).toBeUndefined();
  });

  it('preserves the damage curve at every level and leaves armor unchanged', () => {
    for (let level = 1; level <= 25; level++) {
      const expected =
        level <= 3 ? 1 + (level - 1) * 0.06125 : level < 8 ? 1.1225 + (level - 3) * 0.0455 : 1.35;
      expect(openWorldMobScale(level).damage).toBeCloseTo(expected, 12);
      expect(openWorldMobScale(level).armor).toBe(1);
    }
  });

  it('never decreases with level', () => {
    let prev = openWorldMobScale(1);
    for (let level = 2; level <= 20; level++) {
      const next = openWorldMobScale(level);
      expect(next.health).toBeGreaterThanOrEqual(prev.health);
      expect(next.damage).toBeGreaterThanOrEqual(prev.damage);
      expect(next.armor).toBeGreaterThanOrEqual(prev.armor);
      prev = next;
    }
    expect(OPEN_WORLD_MOB_CURVE[0].level).toBe(1);
  });

  it('scales an ordinary mob: a level-10 Fen Troll has 429 health and hits 33 to 52', () => {
    const troll = spawnOpenWorldMob(1, MOBS.fen_troll, 10, ORIGIN);
    // Template ladder: 56 + 21 x 9 = 245 health, 9 + 2.4 x 9 = 30.6 damage, 18 x 9 armor.
    expect(troll.maxHp).toBe(429);
    expect(troll.hp).toBe(429);
    expect(troll.weapon.min).toBe(33);
    expect(troll.weapon.max).toBe(52);
    expect(troll.stats.armor).toBe(162);
    expect(troll.mechanicDamageMult).toBe(1.35);
    expect(troll.mechanicHealMult).toBe(1.75);
    const untuned = createMob(2, MOBS.fen_troll, 10, ORIGIN);
    expect(untuned.maxHp).toBe(245);
    expect(untuned.mechanicDamageMult).toBeUndefined();
  });

  it('leaves open-world elites on their authored elite ladder without double-scaling', () => {
    const mogger = MOBS.mogger;
    expect(mogger.elite).toBe(true);
    expect(isOpenWorldTuned(mogger)).toBe(true);
    const spawned = spawnOpenWorldMob(1, mogger, 6, ORIGIN);
    expect(spawned.maxHp).toBe(createMob(2, mogger, 6, ORIGIN).maxHp);
    expect(spawned.maxHp).toBe(1357);
    expect(spawned.maxHp).toBeGreaterThan(spawnOpenWorldMob(3, MOBS.wild_boar, 6, ORIGIN).maxHp);
    expect(spawned.mechanicDamageMult).toBeUndefined();
    expect(spawned.mechanicHealMult).toBeUndefined();
    expect(spawnOpenWorldMob(4, MOBS.brutok_skullsmasher, 17, ORIGIN).maxHp).toBe(3036);
  });

  it('raises weak elites throughout the world and scales their support heals by the HP gain', () => {
    expect(spawnOpenWorldMob(1, MOBS.drowned_warlord, 12, ORIGIN).maxHp).toBe(1207);
    const croaker = spawnOpenWorldMob(2, MOBS.drowsy_croaker, 20, ORIGIN);
    expect(croaker.maxHp).toBe(2990);
    expect(croaker.mechanicHealMult).toBeCloseTo(1300 / 786, 10);
    expect(croaker.mechanicDamageMult).toBeUndefined();
    const elites = [...new Set(CAMPS.map((c) => c.mobId))]
      .map((id) => MOBS[id])
      .filter((t) => t.elite && isOpenWorldTuned(t));
    expect(elites.length).toBeGreaterThan(20);
    for (const t of elites) {
      for (let level = t.minLevel; level <= t.maxLevel; level++) {
        const mob = spawnOpenWorldMob(1, t, level, ORIGIN);
        expect(mob.maxHp, `${t.id}@${level}`).toBeGreaterThanOrEqual(
          createMob(2, t, level, ORIGIN).maxHp,
        );
      }
    }
  });

  it('leaves decoration, practice targets, world bosses and puzzle objects alone', () => {
    const exempt = Object.values(MOBS).filter(
      (t) =>
        t.dummy ||
        t.ambient ||
        t.friendlyPracticeTarget ||
        t.worldBoss ||
        t.xpMult === 0 ||
        t.requiresQuestId,
    );
    // Every exempt class is present, so this cannot pass vacuously.
    expect(exempt.some((t) => t.dummy)).toBe(true);
    expect(exempt.some((t) => t.ambient)).toBe(true);
    expect(exempt.some((t) => t.friendlyPracticeTarget)).toBe(true);
    expect(exempt.some((t) => t.worldBoss)).toBe(true);
    expect(exempt.some((t) => t.xpMult === 0)).toBe(true);
    for (const t of exempt) {
      expect(isOpenWorldTuned(t), t.id).toBe(false);
      expect(openWorldMobTemplate(t, 20)).toBe(t);
      const level = Math.max(t.minLevel, 1);
      const spawned = spawnOpenWorldMob(1, t, level, ORIGIN);
      expect(spawned.maxHp, t.id).toBe(createMob(2, t, level, ORIGIN).maxHp);
      expect(spawned.mechanicDamageMult).toBeUndefined();
    }
  });

  it('never mutates the shared template table', () => {
    for (const template of [MOBS.fen_troll, MOBS.ogre_crusher, MOBS.mogger]) {
      const before = { ...template };
      openWorldMobTemplate(template, 15);
      spawnOpenWorldMob(1, template, 15, ORIGIN);
      expect(template).toEqual(before);
    }
  });
});

describe('open-world curve at the spawn sites', () => {
  it('camp mobs spawn on the curve', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'warrior' });
    const campTemplates = new Set(CAMPS.map((c) => c.mobId));
    const camps = [...sim.entities.values()].filter(
      (e) =>
        e.kind === 'mob' &&
        e.ownerId === null &&
        campTemplates.has(e.templateId) &&
        isOpenWorldTuned(MOBS[e.templateId]),
    );
    expect(camps.length).toBeGreaterThan(100);
    for (const mob of camps) {
      expect(mob.maxHp, `${mob.templateId}@${mob.level}`).toBe(
        expectedMaxHp(MOBS[mob.templateId], mob.level),
      );
    }
    // Level-1 camps are untouched; a level-20 camp carries the full curve.
    const levelOne = camps.find((e) => e.level === 1);
    const highLevel = camps.find((e) => e.level === 20 && !MOBS[e.templateId].elite);
    expect(levelOne?.maxHp).toBe(createMob(0, MOBS[levelOne?.templateId ?? ''], 1, ORIGIN).maxHp);
    expect(highLevel?.maxHp).toBe(
      Math.round(
        3.25 *
          (MOBS[highLevel?.templateId ?? ''].hpBase +
            MOBS[highLevel?.templateId ?? ''].hpPerLevel * ((highLevel?.level ?? 1) - 1)),
      ),
    );
  });

  it('a summoned quest foe spawns on the curve while elite quest summons keep their elite ladder', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'warrior' });
    const p = sim.player;
    const template = MOBS.mister_crabs;
    expect(isOpenWorldTuned(template)).toBe(true);
    summonQuestMob(sim.ctx, template.id, { ...p.pos }, p.id);
    const summoned = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === template.id && e.tappedById === p.id,
    );
    expect(summoned?.maxHp).toBe(expectedMaxHp(template, template.maxLevel));
    expect(summoned?.maxHp).toBe(createMob(0, template, template.maxLevel, ORIGIN).maxHp);
    const eliteTemplate = MOBS.bound_guardian;
    expect(isOpenWorldTuned(eliteTemplate)).toBe(true);
    summonQuestMob(sim.ctx, eliteTemplate.id, { ...p.pos }, p.id);
    const summonedElite = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === eliteTemplate.id && e.tappedById === p.id,
    );
    expect(summonedElite?.maxHp).toBe(expectedMaxHp(eliteTemplate, eliteTemplate.maxLevel));
  });

  it('keeps instanced spawns on their own tuning table', () => {
    const sim = new Sim({ seed: 99, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Delver');
    enterDungeon(sim.ctx, 'gravewyrm_sanctum', pid);
    const inst = (sim.instances as { dungeonId: string; mobIds: number[] }[]).find(
      (i) => i.dungeonId === 'gravewyrm_sanctum',
    );
    const mobs = (inst?.mobIds ?? [])
      .map((id) => sim.entities.get(id))
      .filter((e): e is Entity => !!e && e.kind === 'mob');
    expect(mobs.length).toBeGreaterThan(5);
    let onDungeonTable = 0;
    for (const mob of mobs) {
      const base = MOBS[mob.templateId];
      const dungeon = createMob(
        0,
        mobTemplateForDungeonDifficulty(base, 'gravewyrm_sanctum', 'normal'),
        mob.level,
        ORIGIN,
      ).maxHp;
      if (mob.maxHp === dungeon) onDungeonTable++;
      if (dungeon !== expectedMaxHp(base, mob.level)) {
        expect(mob.maxHp, mob.templateId).not.toBe(expectedMaxHp(base, mob.level));
      }
    }
    expect(onDungeonTable).toBeGreaterThan(0);
  });

  it('a tamed beast is rebuilt from its base template, not the tuned wild spawn', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'hunter' });
    sim.setPlayerLevel(8);
    const p = sim.player;
    const wild = spawnOpenWorldMob(sim.ctx.nextId++, MOBS.mire_prowler, 8, {
      x: p.pos.x + 2,
      y: p.pos.y,
      z: p.pos.z + 2,
    });
    sim.addEntity(wild);
    expect(wild.maxHp).toBe(expectedMaxHp(MOBS.mire_prowler, 8));
    sim.ctx.completeTame(p, wild);
    const pet = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.ownerId === p.id);
    expect(pet).toBeDefined();
    const base = createMob(0, MOBS.mire_prowler, 8, ORIGIN).maxHp;
    expect(pet?.maxHp).toBe(base + (pet?.petOwnerHpBonus ?? 0));
  });
});
