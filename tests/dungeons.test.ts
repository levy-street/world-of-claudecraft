// Direct unit tests for the dungeon-instancing module (src/sim/instances/dungeons.ts),
// extracted in session I1. Drives the module's exported functions against a real Sim's
// SimContext (and a few via the Sim facade), proving the door-trigger enter/leave path,
// the party-shared instance, the claim -> free empty-reset, and the raid-lockout gate.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { DUNGEONS, ITEMS, instanceOrigin, MOBS } from '../src/sim/data';
import { spawnNythraxisAdds } from '../src/sim/encounters/nythraxis';
import {
  enterDungeon,
  instanceKeyFor,
  instanceOriginOf,
  leaveDungeon,
  updateDoorTriggers,
  updateInstances,
} from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  type MobTemplate,
  NYTHRAXIS_ADD_ID,
  NYTHRAXIS_BOSS_ID,
} from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 99): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function hollowDoor(sim: AnySim): AnyEntity {
  return [...sim.entities.values()].find(
    (e: AnyEntity) => e.templateId === 'dungeon_door' && e.dungeonId === 'hollow_crypt',
  ) as AnyEntity;
}

function claimedHollow(sim: AnySim): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
  );
}

function claimedDungeon(sim: AnySim, dungeonId: string, difficulty = 'normal'): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.difficulty === difficulty && i.partyKey !== null,
  );
}

function mobInInstance(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const mob = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!mob) throw new Error(`missing ${templateId} in ${inst.dungeonId}`);
  return mob as AnyEntity;
}

// Recompute the heroic spawn stats from the RAW base template and the tuning
// record, independently of mobTemplateForDungeonDifficulty, mirroring createMob's
// formulas. Dropping any multiplier from the transform reddens these pins even
// though forcing level 20 alone would already raise the per-level stats.
function expectedHeroicStats(template: MobTemplate, dungeonId: string) {
  const tuning = HEROIC_DUNGEON_TUNING[dungeonId];
  const levelUps = tuning.level - 1;
  const hpMult = template.elite ? 2.3 : 1;
  const dmgMult = template.elite ? 1.5 : 1;
  const dmg =
    (template.dmgBase * tuning.damageMultiplier +
      template.dmgPerLevel * tuning.damageMultiplier * levelUps) *
    dmgMult;
  return {
    maxHp: Math.round(
      (template.hpBase * tuning.healthMultiplier +
        template.hpPerLevel * tuning.healthMultiplier * levelUps) *
        hpMult,
    ),
    weaponMin: Math.round(dmg * 0.8),
    weaponMax: Math.round(dmg * 1.25),
    armor: Math.round(template.armorPerLevel * tuning.armorMultiplier * levelUps),
  };
}

describe('dungeons: door-trigger entry/exit', () => {
  it('walking onto a dungeon door teleports the player into a freshly claimed instance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    const door = hollowDoor(sim);
    teleport(sim, p, door.pos.x, door.pos.z);

    updateDoorTriggers(sim.ctx, p);

    const slot = sim.instanceSlotAt(p.pos);
    expect(slot).not.toBeNull();
    const inst = claimedHollow(sim);
    expect(inst.slot).toBe(slot);
    expect(inst.partyKey).toBe(instanceKeyFor(sim.ctx, pid)); // solo:<pid>
    expect(inst.mobIds.length).toBeGreaterThan(0); // claimInstance spawned the elites
    expect(inst.exitId).not.toBeNull();
  });

  it('a party of two walking the same door shares ONE instance (instanceKeyFor)', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aaa');
    const b = sim.addPlayer('mage', 'Bbb');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const ea = sim.entities.get(a) as AnyEntity;
    const eb = sim.entities.get(b) as AnyEntity;
    const door = hollowDoor(sim);

    teleport(sim, ea, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, ea);
    teleport(sim, eb, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, eb);

    expect(sim.instanceSlotAt(ea.pos)).toBe(sim.instanceSlotAt(eb.pos));
    const claimed = (sim.instances as any[]).filter(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    );
    expect(claimed.length).toBe(1);
    expect(claimed[0].partyKey).toBe(instanceKeyFor(sim.ctx, a));
  });

  it('walking the exit portal climbs the player back out (no DUNGEON_LIST[0] fallback)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    const door = hollowDoor(sim);
    teleport(sim, p, door.pos.x, door.pos.z);
    updateDoorTriggers(sim.ctx, p);
    const inst = claimedHollow(sim);

    const exit = sim.entities.get(inst.exitId) as AnyEntity;
    teleport(sim, p, exit.pos.x, exit.pos.z);
    updateDoorTriggers(sim.ctx, p);

    expect(sim.instanceSlotAt(p.pos)).toBeNull(); // back outside the instance
  });
});

describe('dungeons: heroic difficulty', () => {
  it('claims heroic Hollow Crypt as a fixed heroic instance with level-20 transformed mobs', () => {
    const heroic = makeSim(123);
    const heroicPid = heroic.addPlayer('warrior', 'Hero');
    heroic.setDungeonDifficulty('heroic', heroicPid);

    enterDungeon(heroic.ctx, 'hollow_crypt', heroicPid);

    const heroicInst = claimedDungeon(heroic, 'hollow_crypt', 'heroic');
    expect(heroicInst).toBeTruthy();
    expect(heroicInst.difficulty).toBe('heroic');
    const heroicMorthen = mobInInstance(heroic, heroicInst, 'morthen');
    expect(heroicMorthen.level).toBe(20);

    // The health/damage/armor multipliers must survive independently of the
    // level-20 bump: pin the exact recomputed values, not just a > compare.
    const pins = expectedHeroicStats(MOBS.morthen, 'hollow_crypt');
    expect(heroicMorthen.maxHp).toBe(pins.maxHp);
    expect(heroicMorthen.weapon.min).toBe(pins.weaponMin);
    expect(heroicMorthen.weapon.max).toBe(pins.weaponMax);
    expect(heroicMorthen.stats.armor).toBe(pins.armor);
    // Fire-time mechanic scaling rides these per-entity fields (the mechanic
    // numbers are read from the base MOBS table, not the transformed template).
    expect(heroicMorthen.mechanicDamageMult).toBe(
      HEROIC_DUNGEON_TUNING.hollow_crypt.damageMultiplier,
    );
    expect(heroicMorthen.mechanicHealMult).toBe(
      HEROIC_DUNGEON_TUNING.hollow_crypt.healthMultiplier,
    );

    // Anti-kite floor: every heroic mob moves at least 8 (player run speed 7).
    expect(heroicMorthen.moveSpeed).toBe(8);
    // Heroic bosses can be neither controlled nor snared: a stun and a slow
    // both bounce off (entity-level immunity, since the applyAura gates read
    // the base MOBS table for the template flags).
    const stunAura = (sourceId: number) => ({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun' as const,
      remaining: 3,
      duration: 3,
      value: 0,
      sourceId,
      school: 'physical' as const,
    });
    const slowAura = (sourceId: number) => ({
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'slow' as const,
      remaining: 3,
      duration: 3,
      value: 0.5,
      sourceId,
      school: 'frost' as const,
    });
    (heroic as any).applyAura(heroicMorthen, stunAura(heroicPid));
    (heroic as any).applyAura(heroicMorthen, slowAura(heroicPid));
    expect(heroicMorthen.auras.some((a: any) => a.id === 'test_stun')).toBe(false);
    expect(heroicMorthen.auras.some((a: any) => a.id === 'test_slow')).toBe(false);

    const normal = makeSim(123);
    const normalPid = normal.addPlayer('warrior', 'Normal');
    enterDungeon(normal.ctx, 'hollow_crypt', normalPid);
    const normalInst = claimedDungeon(normal, 'hollow_crypt', 'normal');
    const normalMorthen = mobInInstance(normal, normalInst, 'morthen');
    expect(normalMorthen.level).toBe(10);
    expect(heroicMorthen.maxHp).toBeGreaterThan(normalMorthen.maxHp);
    expect(heroicMorthen.weapon.min).toBeGreaterThan(normalMorthen.weapon.min);
    expect(normalMorthen.mechanicDamageMult).toBeUndefined();
    expect(normalMorthen.mechanicHealMult).toBeUndefined();
    // Normal Morthen keeps his template speed and stays controllable.
    expect(normalMorthen.moveSpeed).toBe(7);
    (normal as any).applyAura(normalMorthen, stunAura(normalPid));
    (normal as any).applyAura(normalMorthen, slowAura(normalPid));
    expect(normalMorthen.auras.some((a: any) => a.id === 'test_stun')).toBe(true);
    expect(normalMorthen.auras.some((a: any) => a.id === 'test_slow')).toBe(true);
  });

  it('supports heroic mode across the four five-player dungeons only', () => {
    const finalBosses = [
      ['hollow_crypt', 'morthen'],
      ['sunken_bastion', 'vael_the_mistcaller'],
      ['drowned_temple', 'ysolei'],
      ['gravewyrm_sanctum', 'korzul_the_gravewyrm'],
    ] as const;

    for (const [dungeonId, bossId] of finalBosses) {
      const sim = makeSim(321);
      const pid = sim.addPlayer('warrior', `Hero-${dungeonId}`);
      sim.setDungeonDifficulty('heroic', pid);

      enterDungeon(sim.ctx, dungeonId, pid);

      const inst = claimedDungeon(sim, dungeonId, 'heroic');
      expect(inst, `${dungeonId} did not claim a heroic instance`).toBeTruthy();
      expect(mobInInstance(sim, inst, bossId).level).toBe(20);
    }
  });

  it('never applies heroic selection to the Nythraxis attunement dungeon', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Attuned');
    sim.setDungeonDifficulty('heroic', pid);

    enterDungeon(sim.ctx, 'nythraxis_crypt', pid);

    expect(claimedDungeon(sim, 'nythraxis_crypt', 'heroic')).toBeUndefined();
    expect(claimedDungeon(sim, 'nythraxis_crypt', 'normal')).toBeTruthy();
  });

  it('a live claim wins over a flipped selection; the new difficulty applies after the reset', () => {
    const sim = makeSim(456);
    const pid = sim.addPlayer('warrior', 'Switcher');

    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const normalInst = claimedDungeon(sim, 'hollow_crypt', 'normal');
    expect(mobInInstance(sim, normalInst, 'morthen').level).toBe(10);

    // Flipping the selection mid-claim and re-entering rejoins the existing
    // normal instance (never mutating it, never claiming a parallel one): the
    // claimed difficulty is fixed for the instance's life. This is also the
    // ghost corpse-run path, so a dead member can never be stranded in a fresh
    // parallel instance by a mid-run flip.
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    expect(claimedDungeon(sim, 'hollow_crypt', 'heroic')).toBeUndefined();
    expect(normalInst.partyKey).not.toBeNull();
    expect(normalInst.difficulty).toBe('normal');
    expect(mobInInstance(sim, normalInst, 'morthen').level).toBe(10);

    // Leave and free the slot (fast-forward the empty-instance reset rather than
    // ticking out 300 real sim-seconds, which is slow under CI load); the freed
    // slot clears back to normal and the pending heroic selection applies next.
    leaveDungeon(sim.ctx, pid);
    teleport(sim, sim.entities.get(pid) as AnyEntity, 0, 0);
    normalInst.emptyFor = 100000;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(normalInst.partyKey).toBeNull();
    expect(normalInst.difficulty).toBe('normal');

    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const heroicInst = claimedDungeon(sim, 'hollow_crypt', 'heroic');
    expect(heroicInst).toBeTruthy();
    expect(mobInInstance(sim, heroicInst, 'morthen').level).toBe(20);
    // 6000+ ticks of empty-instance countdown: comfortably under a second alone,
    // but borderline at the 5s default under full-suite core contention.
  }, 20000);

  it('a party formed after the leader chose heroic inherits the selection', () => {
    const sim = makeSim();
    const leader = sim.addPlayer('warrior', 'Lead');
    const member = sim.addPlayer('mage', 'Late');
    sim.setDungeonDifficulty('heroic', leader);

    sim.partyInvite(member, leader);
    sim.partyAccept(member);

    expect(sim.dungeonDifficulty(leader)).toBe('heroic');
    expect(sim.dungeonDifficulty(member)).toBe('heroic');
  });

  it("a member's stale personal heroic preference never overrides an unset party", () => {
    const sim = makeSim();
    const member = sim.addPlayer('warrior', 'Stale');
    const leader = sim.addPlayer('mage', 'Fresh');
    sim.setDungeonDifficulty('heroic', member); // stamped while solo
    expect(sim.dungeonDifficulty(member)).toBe('heroic');

    sim.partyInvite(member, leader);
    sim.partyAccept(member);

    // Inside a party the party state is the only authority: the stale solo
    // stamp must not let a non-leader claim heroic at the door.
    expect(sim.dungeonDifficulty(member)).toBe('normal');
    enterDungeon(sim.ctx, 'hollow_crypt', member);
    expect(claimedDungeon(sim, 'hollow_crypt', 'heroic')).toBeUndefined();
    expect(claimedDungeon(sim, 'hollow_crypt', 'normal')).toBeTruthy();

    // Back solo the personal preference still applies.
    sim.partyLeave(member);
    expect(sim.dungeonDifficulty(member)).toBe('heroic');
  });

  it('boss adds summoned in a heroic instance spawn as level-20 transforms', () => {
    const sim = makeSim(31);
    const pid = sim.addPlayer('warrior', 'Adds');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'sunken_bastion', pid);
    const inst = claimedDungeon(sim, 'sunken_bastion', 'heroic');
    const vael = mobInInstance(sim, inst, 'vael_the_mistcaller');

    vael.inCombat = true;
    vael.hp = Math.floor(vael.maxHp * 0.5);
    sim.tick();

    const adds = (vael.summonedIds as number[])
      .map((id) => sim.entities.get(id) as AnyEntity)
      .filter(Boolean);
    expect(adds.length).toBeGreaterThan(0);
    const pins = expectedHeroicStats(MOBS.drowned_thrall, 'sunken_bastion');
    for (const add of adds) {
      expect(add.templateId).toBe('drowned_thrall');
      expect(add.level).toBe(20);
      expect(add.maxHp).toBe(pins.maxHp);
      expect(add.mechanicDamageMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.damageMultiplier);
    }
  });

  it('mechanicDamageMult scales aoePulse damage at the fire site', () => {
    // Two identical runs where the ONLY difference is a manually doubled
    // mechanicDamageMult on the same boss: the pulse rng draw is identical, so
    // the landed damage must double (within one point of rounding). This pins
    // the fire-site multiply that heroic spawns rely on.
    const run = (mult?: number): number => {
      const sim = makeSim(444);
      const pid = sim.addPlayer('warrior', 'Pulse');
      enterDungeon(sim.ctx, 'hollow_crypt', pid);
      const inst = claimedDungeon(sim, 'hollow_crypt', 'normal');
      const morthen = mobInInstance(sim, inst, 'morthen');
      if (mult !== undefined) morthen.mechanicDamageMult = mult;
      const p = sim.entities.get(pid) as AnyEntity;
      p.maxHp = 1_000_000;
      p.hp = 1_000_000;
      teleport(sim, p, morthen.pos.x + 1, morthen.pos.z);
      (sim as any).dealDamage(p, morthen, 1, false, 'physical', null, 'hit');
      morthen.pulseTimer = 0.1;
      for (let i = 0; i < 20 * 15; i++) {
        for (const ev of sim.tick() as any[]) {
          if (ev.type === 'damage' && ev.ability === 'Shadow Pulse' && ev.targetId === pid) {
            return ev.amount as number;
          }
        }
      }
      throw new Error('Shadow Pulse never fired');
    };

    const base = run();
    const doubled = run(2);
    expect(base).toBeGreaterThanOrEqual(12); // morthen aoePulse min
    expect(Math.abs(doubled - base * 2)).toBeLessThanOrEqual(1);
  });

  it('allows only the party leader to change the party dungeon difficulty', () => {
    const sim = makeSim();
    const leader = sim.addPlayer('warrior', 'Leader');
    const member = sim.addPlayer('mage', 'Member');
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    sim.drainEvents();

    sim.setDungeonDifficulty('heroic', member);

    expect(sim.dungeonDifficulty(leader)).toBe('normal');
    expect(sim.dungeonDifficulty(member)).toBe('normal');
    expect(
      (sim.drainEvents() as any[]).some(
        (e) => e.type === 'error' && e.pid === member && e.text === 'You are not the party leader.',
      ),
    ).toBe(true);

    sim.setDungeonDifficulty('heroic', leader);

    expect(sim.dungeonDifficulty(leader)).toBe('heroic');
    expect(sim.dungeonDifficulty(member)).toBe('heroic');
  });

  it('a leader-set party difficulty never stamps other members personally', () => {
    const sim = makeSim();
    const leader = sim.addPlayer('warrior', 'Boss');
    const member = sim.addPlayer('mage', 'Along');
    sim.partyInvite(member, leader);
    sim.partyAccept(member);

    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.dungeonDifficulty(member)).toBe('heroic'); // mirrors the party while grouped

    // The member never chose heroic personally: leaving reverts them, and a
    // party they later lead does not inherit the old group's setting.
    sim.partyLeave(member);
    expect(sim.dungeonDifficulty(member)).toBe('normal');
    const third = sim.addPlayer('rogue', 'Newmate');
    sim.partyInvite(third, member);
    sim.partyAccept(third);
    expect(sim.dungeonDifficulty(third)).toBe('normal');
    // The setter keeps their own preference.
    expect(sim.dungeonDifficulty(leader)).toBe('heroic');
  });
});

describe('dungeons: heroic marks', () => {
  it('registers the heroic_mark item the award path references', () => {
    expect(ITEMS[HEROIC_MARK_ITEM_ID]).toBeTruthy();
    expect(ITEMS[HEROIC_MARK_ITEM_ID].quality).toBe('rare');
    expect(ITEMS[HEROIC_MARK_ITEM_ID].sellValue).toBe(0);
    // Every tuned final boss must be a real mob record (ids are string-matched
    // at runtime with no compile check).
    for (const tuning of Object.values(HEROIC_DUNGEON_TUNING)) {
      expect(MOBS[tuning.finalBossId], `${tuning.id} finalBossId`).toBeTruthy();
    }
  });

  it('a heroic final boss drops one personal Heroic Mark per participant', () => {
    const sim = makeSim(9);
    const leader = sim.addPlayer('warrior', 'Lead');
    const member = sim.addPlayer('mage', 'Mate');
    sim.partyInvite(member, leader);
    sim.partyAccept(member);
    sim.setDungeonDifficulty('heroic', leader);
    enterDungeon(sim.ctx, 'hollow_crypt', leader);
    enterDungeon(sim.ctx, 'hollow_crypt', member);
    const inst = claimedDungeon(sim, 'hollow_crypt', 'heroic');
    const morthen = mobInInstance(sim, inst, 'morthen');
    const le = sim.entities.get(leader) as AnyEntity;
    const me = sim.entities.get(member) as AnyEntity;
    teleport(sim, le, morthen.pos.x + 1, morthen.pos.z);
    teleport(sim, me, morthen.pos.x - 1, morthen.pos.z);

    (sim as any).dealDamage(le, morthen, morthen.hp + 10, false, 'physical', null, 'hit');

    expect(morthen.dead).toBe(true);
    const marks = ((morthen.loot?.items ?? []) as any[]).filter(
      (s) => s.itemId === HEROIC_MARK_ITEM_ID,
    );
    expect(marks).toHaveLength(2);
    expect(marks.every((s) => s.count === 1)).toBe(true);
    // One personal slot per participant: each mark is lootable by exactly one
    // player, and together they cover both party members.
    expect(marks.map((s) => s.personalFor)).toEqual(expect.arrayContaining([[leader], [member]]));
    expect(morthen.lootable).toBe(true);
  });

  it('a solo heroic participant gets exactly one mark', () => {
    const sim = makeSim(12);
    const pid = sim.addPlayer('warrior', 'Solo');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedDungeon(sim, 'hollow_crypt', 'heroic');
    const morthen = mobInInstance(sim, inst, 'morthen');

    (sim as any).dealDamage(
      sim.entities.get(pid),
      morthen,
      morthen.hp + 10,
      false,
      'physical',
      null,
      'hit',
    );

    const marks = ((morthen.loot?.items ?? []) as any[]).filter(
      (s) => s.itemId === HEROIC_MARK_ITEM_ID,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].personalFor).toEqual([pid]);
  });

  it('drops no marks from a normal final boss or heroic trash', () => {
    const normal = makeSim(10);
    const nPid = normal.addPlayer('warrior', 'Norm');
    enterDungeon(normal.ctx, 'hollow_crypt', nPid);
    const nInst = claimedDungeon(normal, 'hollow_crypt', 'normal');
    const nMorthen = mobInInstance(normal, nInst, 'morthen');
    (normal as any).dealDamage(
      normal.entities.get(nPid),
      nMorthen,
      nMorthen.hp + 10,
      false,
      'physical',
      null,
      'hit',
    );
    expect(nMorthen.dead).toBe(true);
    expect(
      ((nMorthen.loot?.items ?? []) as any[]).some((s) => s.itemId === HEROIC_MARK_ITEM_ID),
    ).toBe(false);

    const heroic = makeSim(11);
    const hPid = heroic.addPlayer('warrior', 'Hero');
    heroic.setDungeonDifficulty('heroic', hPid);
    enterDungeon(heroic.ctx, 'hollow_crypt', hPid);
    const hInst = claimedDungeon(heroic, 'hollow_crypt', 'heroic');
    const trash = (hInst.mobIds as number[])
      .map((id) => heroic.entities.get(id) as AnyEntity)
      .find((e) => e && e.templateId !== 'morthen');
    expect(trash).toBeTruthy();
    (heroic as any).dealDamage(
      heroic.entities.get(hPid),
      trash,
      (trash as AnyEntity).hp + 10,
      false,
      'physical',
      null,
      'hit',
    );
    expect((trash as AnyEntity).dead).toBe(true);
    expect(
      (((trash as AnyEntity).loot?.items ?? []) as any[]).some(
        (s) => s.itemId === HEROIC_MARK_ITEM_ID,
      ),
    ).toBe(false);
  });
});

describe('dungeons: heroic boss drops', () => {
  function killFinalBoss(sim: AnySim, dungeonId: string, bossId: string): AnyEntity {
    const pid = sim.addPlayer('warrior', 'Slayer');
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, dungeonId, pid);
    const inst = claimedDungeon(sim, dungeonId, 'heroic');
    const boss = mobInInstance(sim, inst, bossId);
    (sim as any).dealDamage(
      sim.entities.get(pid),
      boss,
      boss.hp + 1000,
      false,
      'physical',
      null,
      'hit',
    );
    return boss;
  }

  it('a heroic final-boss corpse carries two epics, one from each roll group', () => {
    // Morthen has two rollGroups (morthen_heroic + morthen_heroic2), so each
    // heroic kill drops exactly two epics, one per group. Sweep seeds so the
    // groups land on different entries over the run.
    const groups = ['morthen_heroic', 'morthen_heroic2'];
    const byGroup: Record<string, string[]> = {};
    for (const e of HEROIC_BOSS_LOOT.morthen) {
      byGroup[e.rollGroup!] ??= [];
      byGroup[e.rollGroup!].push(e.itemId!);
    }
    const dropped = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const sim = makeSim(seed);
      const boss = killFinalBoss(sim, 'hollow_crypt', 'morthen');
      const epics = ((boss.loot?.items ?? []) as any[]).filter((s) =>
        HEROIC_BOSS_LOOT.morthen.some((e) => e.itemId === s.itemId),
      );
      expect(epics.length, `seed ${seed}`).toBe(2);
      // Exactly one from each group.
      for (const g of groups) {
        expect(
          epics.filter((s: any) => byGroup[g].includes(s.itemId)).length,
          `${g} seed ${seed}`,
        ).toBe(1);
      }
      for (const s of epics) dropped.add(s.itemId);
    }
    expect(dropped.size).toBeGreaterThan(2); // the groups actually vary
  });

  it('normal final bosses and heroic trash never drop the heroic epics', () => {
    const normal = makeSim(3);
    const nPid = normal.addPlayer('warrior', 'Norm');
    enterDungeon(normal.ctx, 'hollow_crypt', nPid);
    const nBoss = mobInInstance(
      normal,
      claimedDungeon(normal, 'hollow_crypt', 'normal'),
      'morthen',
    );
    (normal as any).dealDamage(
      normal.entities.get(nPid),
      nBoss,
      nBoss.hp + 1000,
      false,
      'physical',
      null,
      'hit',
    );
    const heroicIds = new Set(
      Object.values(HEROIC_BOSS_LOOT)
        .flat()
        .map((e) => e.itemId),
    );
    expect(((nBoss.loot?.items ?? []) as any[]).some((s) => heroicIds.has(s.itemId))).toBe(false);
  });

  it('the heroic Nythraxis raid boss drops from its own heroic table', () => {
    const table = HEROIC_BOSS_LOOT.nythraxis_scourge_of_thornpeak.map((e) => e.itemId);
    const dropped = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const sim = makeSim(seed);
      const tank = sim.addPlayer('warrior', 'Tank');
      sim.players.get(tank)!.questsDone.add('q_nythraxis_bound_guardian');
      for (let i = 0; i < 4; i++) {
        const p = sim.addPlayer('mage', `D${i}`);
        sim.partyInvite(p, tank);
        sim.partyAccept(p);
      }
      sim.convertPartyToRaid(tank);
      sim.setDungeonDifficulty('heroic', tank);
      sim.enterDungeon('nythraxis_boss_arena', tank);
      const inst = claimedDungeon(sim, 'nythraxis_boss_arena', 'heroic');
      const boss = mobInInstance(sim, inst, NYTHRAXIS_BOSS_ID);
      (sim as any).dealDamage(
        sim.entities.get(tank),
        boss,
        boss.hp + 1000,
        false,
        'physical',
        null,
        'hit',
      );
      const epics = ((boss.loot?.items ?? []) as any[]).filter((s) => table.includes(s.itemId));
      expect(epics.length, `seed ${seed}`).toBe(2); // one per roll group
      for (const s of epics) dropped.add(s.itemId);
    }
    expect(dropped.size).toBeGreaterThan(2);
  });
});

describe('dungeons: heroic daily lockouts', () => {
  function heroicClear(sim: AnySim, pid: number, dungeonId: string, bossId: string): void {
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, dungeonId, pid);
    const inst = claimedDungeon(sim, dungeonId, 'heroic');
    const boss = mobInInstance(sim, inst, bossId);
    (sim as any).dealDamage(
      sim.entities.get(pid),
      boss,
      boss.hp + 1000,
      false,
      'physical',
      null,
      'hit',
    );
    // Leave and free the claim so a re-entry must re-claim (fast-forward the
    // empty-instance reset rather than ticking out 300 real sim-seconds).
    leaveDungeon(sim.ctx, pid);
    teleport(sim, sim.entities.get(pid) as AnyEntity, 0, 0);
    inst.emptyFor = 100000;
    for (let i = 0; i < 40; i++) sim.tick();
  }

  it('a heroic clear locks the heroic claim for the day but not the normal run', () => {
    const sim = makeSim(5);
    const pid = sim.addPlayer('warrior', 'Raider');
    heroicClear(sim, pid, 'hollow_crypt', 'morthen');

    // Heroic re-entry is refused with the heroic-locked message.
    sim.setDungeonDifficulty('heroic', pid);
    sim.drainEvents();
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    expect(claimedDungeon(sim, 'hollow_crypt', 'heroic')).toBeUndefined();
    expect(
      (sim.drainEvents() as any[]).some(
        (e) => e.type === 'error' && e.text === 'You are locked to Heroic The Hollow Crypt.',
      ),
    ).toBe(true);

    // The same day, the NORMAL run is still available (independent lockout key).
    sim.setDungeonDifficulty('normal', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    expect(claimedDungeon(sim, 'hollow_crypt', 'normal')).toBeTruthy();
  });

  it('the heroic lockout key is difficulty-scoped and clears at the reset boundary', () => {
    let now = 1_000_000;
    const sim = new Sim({
      seed: 5,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => now,
      raidResetMs: () => now + 24 * 3600 * 1000,
    }) as AnySim;
    const pid = sim.addPlayer('warrior', 'Raider');
    heroicClear(sim, pid, 'hollow_crypt', 'morthen');

    const meta = sim.players.get(pid)!;
    expect(meta.raidLockouts.has('hollow_crypt:heroic')).toBe(true);
    expect(meta.raidLockouts.has('hollow_crypt')).toBe(false); // never the normal key

    // Past the reset boundary, the heroic claim is available again.
    now += 24 * 3600 * 1000 + 1;
    sim.setDungeonDifficulty('heroic', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    expect(claimedDungeon(sim, 'hollow_crypt', 'heroic')).toBeTruthy();
  });
});

describe('dungeons: heroic Nythraxis raid arena', () => {
  // Compact attuned-raid harness (the full version lives in
  // tests/nythraxis_encounter.test.ts): five raiders, tank attuned, leader
  // selects the difficulty, tank enters and claims the arena.
  function raidSetup(difficulty: 'normal' | 'heroic') {
    const sim = makeSim(77);
    const tank = sim.addPlayer('warrior', 'Tank');
    sim.players.get(tank)!.questsDone.add('q_nythraxis_bound_guardian');
    const raiders: number[] = [tank];
    for (let i = 0; i < 4; i++) {
      const pid = sim.addPlayer('mage', `Dps${i}`);
      sim.partyInvite(pid, tank);
      sim.partyAccept(pid);
      raiders.push(pid);
    }
    sim.convertPartyToRaid(tank);
    if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', tank);
    sim.enterDungeon('nythraxis_boss_arena', tank);
    const inst = claimedDungeon(sim, 'nythraxis_boss_arena', difficulty);
    return { sim, tank, raiders, inst };
  }

  it('a heroic raid claim spawns the transformed boss and scaled add waves', () => {
    const { sim, inst } = raidSetup('heroic');
    expect(inst).toBeTruthy();
    expect(inst.difficulty).toBe('heroic');

    const boss = mobInInstance(sim, inst, NYTHRAXIS_BOSS_ID);
    const pins = expectedHeroicStats(MOBS[NYTHRAXIS_BOSS_ID], 'nythraxis_boss_arena');
    expect(boss.level).toBe(20);
    expect(boss.maxHp).toBe(pins.maxHp);
    expect(boss.weapon.min).toBe(pins.weaponMin);
    expect(boss.weapon.max).toBe(pins.weaponMax);
    expect(boss.mechanicDamageMult).toBe(
      HEROIC_DUNGEON_TUNING.nythraxis_boss_arena.damageMultiplier,
    );

    // The encounter's scripted add waves inherit the instance difficulty.
    spawnNythraxisAdds(sim.ctx, boss);
    const adds = (boss.summonedIds as number[])
      .map((id) => sim.entities.get(id) as AnyEntity)
      .filter(Boolean);
    expect(adds.length).toBeGreaterThan(0);
    const addPins = expectedHeroicStats(MOBS[NYTHRAXIS_ADD_ID], 'nythraxis_boss_arena');
    for (const add of adds) {
      expect(add.templateId).toBe(NYTHRAXIS_ADD_ID);
      expect(add.maxHp).toBe(addPins.maxHp);
      expect(add.mechanicDamageMult).toBe(
        HEROIC_DUNGEON_TUNING.nythraxis_boss_arena.damageMultiplier,
      );
    }
  });

  it('a normal raid claim is untransformed; a heroic kill pays marks to every raider', () => {
    const normal = raidSetup('normal');
    const nBoss = mobInInstance(normal.sim, normal.inst, NYTHRAXIS_BOSS_ID);
    expect(nBoss.maxHp).toBe(60000); // the untransformed raid boss (60k on normal)
    expect(nBoss.mechanicDamageMult).toBeUndefined();
    spawnNythraxisAdds(normal.sim.ctx, nBoss);
    const nAdd = normal.sim.entities.get((nBoss.summonedIds as number[])[0]) as AnyEntity;
    expect(nAdd.mechanicDamageMult).toBeUndefined();

    const { sim, raiders, inst } = raidSetup('heroic');
    const boss = mobInInstance(sim, inst, NYTHRAXIS_BOSS_ID);
    raiders.forEach((pid, i) => {
      teleport(sim, sim.entities.get(pid) as AnyEntity, boss.pos.x + (i - 2), boss.pos.z - 4);
    });

    (sim as any).dealDamage(
      sim.entities.get(raiders[0]),
      boss,
      boss.hp + 100,
      false,
      'physical',
      null,
      'hit',
    );

    expect(boss.dead).toBe(true);
    const marks = ((boss.loot?.items ?? []) as any[]).filter(
      (s) => s.itemId === HEROIC_MARK_ITEM_ID,
    );
    // The raid pays THREE marks per participant (marksPerParticipant), one
    // personal slot each so a single loot click takes all three.
    expect(marks).toHaveLength(raiders.length * 3);
    expect(marks.flatMap((s) => s.personalFor).sort((a, b) => a - b)).toEqual(
      raiders.flatMap((pid) => [pid, pid, pid]).sort((a, b) => a - b),
    );
  });
});

describe('dungeons: ghost corpse-run re-entry', () => {
  it('the tick loop pulls a ghost through the door and resurrects it at the entry', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    // enter, die inside, release the spirit to the outdoor graveyard
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    expect(sim.instanceSlotAt(p.pos)).not.toBeNull();
    p.dead = true;
    sim.releaseSpirit(pid);
    expect(p.ghost).toBe(true);
    expect(sim.instanceSlotAt(p.pos)).toBeNull(); // ghost is outside the instance

    // stand the ghost on the door and tick once: the tick loop now runs door triggers
    // for ghosts (sim.ts), so it is pulled back in and resurrected at the entrance.
    const door = hollowDoor(sim);
    teleport(sim, p, door.pos.x, door.pos.z);
    sim.tick();

    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
    expect(sim.instanceSlotAt(p.pos)).not.toBeNull(); // back inside, alive
  });
});

describe('dungeons: empty-instance reset', () => {
  it('updateInstances frees an empty claimed instance past the timeout', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedHollow(sim);
    const mobIds = [...inst.mobIds];
    const objectIds = [...inst.objectIds];
    const exitId = inst.exitId as number;
    expect(mobIds.length).toBeGreaterThan(0);

    // Move the player out to the overworld, jump the empty timer past the timeout.
    teleport(sim, p, 0, 0);
    inst.emptyFor = 100000;
    updateInstances(sim.ctx); // tickCount 0 % 20 === 0, so the reaper runs

    expect(inst.partyKey).toBeNull();
    expect(inst.mobIds.length).toBe(0);
    expect(inst.objectIds.length).toBe(0);
    expect(inst.exitId).toBeNull();
    expect(mobIds.every((id) => !sim.entities.has(id))).toBe(true);
    expect(objectIds.every((id) => !sim.entities.has(id))).toBe(true);
    expect(sim.entities.has(exitId)).toBe(false);
  });

  it('an occupied instance never resets (emptyFor stays 0)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedHollow(sim);
    inst.emptyFor = 100000; // even pre-loaded, an occupied check resets it
    updateInstances(sim.ctx);
    expect(inst.partyKey).not.toBeNull();
    expect(inst.emptyFor).toBe(0);
  });
});

describe('dungeons: concurrent-instance capacity', () => {
  it('more than six solo parties can hold their own Hollow Crypt instance at once', () => {
    const sim = makeSim();
    const PARTIES = 8; // was capped at 6 concurrent instances before the bump
    for (let i = 0; i < PARTIES; i++) {
      const pid = sim.addPlayer('warrior', `Solo${i}`);
      sim.drainEvents();
      enterDungeon(sim.ctx, 'hollow_crypt', pid);
      const events = sim.drainEvents() as any[];
      expect(
        events.some((e) => e.type === 'error' && /All instances of .* are busy/.test(e.text ?? '')),
      ).toBe(false);
    }
    const claimed = (sim.instances as any[]).filter(
      (i) => i.dungeonId === 'hollow_crypt' && i.partyKey !== null,
    );
    expect(claimed.length).toBe(PARTIES);
    // every claimed party landed in a distinct slot (no double-booking)
    expect(new Set(claimed.map((i) => i.slot)).size).toBe(PARTIES);
  });
});

describe('dungeons: raid lockout gate', () => {
  function attunedRaid(sim: AnySim): number {
    const leader = sim.addPlayer('warrior', 'Lead');
    while ((sim.partyOf(leader)?.members.length ?? 1) < 5) {
      const pid = sim.addPlayer('priest', `Fill${sim.players.size}`);
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leader);
    sim.players.get(leader)!.questsDone.add('q_nythraxis_bound_guardian');
    return leader;
  }

  it('an active lockout blocks entry and emits the locked-to-arena error', () => {
    const sim = makeSim();
    const leader = attunedRaid(sim);
    sim.players.get(leader)!.raidLockouts.set('nythraxis_boss_arena', 999999999);
    sim.drainEvents();

    enterDungeon(sim.ctx, 'nythraxis_boss_arena', leader);

    const events = sim.drainEvents() as any[];
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You are locked to Nythraxis Raid Arena.',
      ),
    ).toBe(true);
    expect(sim.instanceSlotAt(sim.entities.get(leader)!.pos)).toBeNull(); // not entered
  });

  it('an expired lockout is deleted and no longer blocks entry', () => {
    const sim = makeSim();
    const leader = attunedRaid(sim);
    sim.players.get(leader)!.raidLockouts.set('nythraxis_boss_arena', 0); // 0 <= lockoutNowMs
    sim.drainEvents();

    enterDungeon(sim.ctx, 'nythraxis_boss_arena', leader);

    expect(sim.players.get(leader)!.raidLockouts.has('nythraxis_boss_arena')).toBe(false);
    const events = sim.drainEvents() as any[];
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'You are locked to Nythraxis Raid Arena.',
      ),
    ).toBe(false);
  });

  it('a non-raid party cannot enter the raid-required arena', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
    sim.drainEvents();
    enterDungeon(sim.ctx, 'nythraxis_boss_arena', pid);
    const events = sim.drainEvents() as any[];
    expect(
      events.some(
        (e) =>
          e.type === 'error' && e.text === 'You must convert your party to a raid group first.',
      ),
    ).toBe(true);
  });
});

describe('dungeons: pure helpers', () => {
  it('instanceKeyFor keys solo vs party players', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aaa');
    expect(instanceKeyFor(sim.ctx, a)).toBe(`solo:${a}`);
    const b = sim.addPlayer('mage', 'Bbb');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const party = sim.partyOf(a)!;
    expect(instanceKeyFor(sim.ctx, a)).toBe(`party:${party.id}`);
    expect(instanceKeyFor(sim.ctx, b)).toBe(`party:${party.id}`);
  });

  it('instanceOriginOf matches the data instanceOrigin for the slot', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const inst = claimedHollow(sim);
    expect(instanceOriginOf(inst)).toEqual(instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot));
  });
});

describe('dungeons: leaveDungeon guard', () => {
  it('leaveDungeon from the overworld is a no-op (no fallback teleport)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    teleport(sim, p, 0, 0);
    const before = { ...p.pos };
    leaveDungeon(sim.ctx, pid);
    expect(p.pos.x).toBe(before.x);
    expect(p.pos.z).toBe(before.z);
  });
});
