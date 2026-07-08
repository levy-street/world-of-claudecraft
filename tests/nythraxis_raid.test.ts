import { describe, expect, it } from 'vitest';
import { nextRaidResetMs } from '../server/raid_reset';
import { visualKeyFor } from '../src/render/characters/manifest';
import { dungeonDaisHasRaisedPlatform } from '../src/render/dungeon';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEONS, ITEMS, instanceOrigin, MOBS } from '../src/sim/data';
import { NYTHRAXIS_LAYOUT } from '../src/sim/dungeon_layout';
import { Sim } from '../src/sim/sim';
import { type Aura, dist2d, type Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

type TickEvent = ReturnType<Sim['tick']>[number];
type TimedEvent = { at: number; event: TickEvent };
type TimedChatEvent = { at: number; event: Extract<TickEvent, { type: 'chat' }> };
type TimedDamageEvent = { at: number; event: Extract<TickEvent, { type: 'damage' }> };
type TimedSpellFxEvent = { at: number; event: Extract<TickEvent, { type: 'spellfx' }> };
type DamageEvent = Extract<TickEvent, { type: 'damage' }>;

function isTimedChatEvent(row: TimedEvent): row is TimedChatEvent {
  return row.event.type === 'chat';
}

function isTimedDamageEvent(row: TimedEvent): row is TimedDamageEvent {
  return row.event.type === 'damage';
}

function isTimedSpellFxEvent(row: TimedEvent): row is TimedSpellFxEvent {
  return row.event.type === 'spellfx';
}

function isDamageEvent(event: TickEvent): event is DamageEvent {
  return event.type === 'damage';
}

function makeWorld(lockoutNowMs?: () => number, raidResetMs?: (nowMs: number) => number) {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, lockoutNowMs, raidResetMs });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function rebucket(sim: Sim, e: Entity) {
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(e);
}

function attune(sim: Sim, pid: number) {
  sim.players.get(pid)!.questsDone.add('q_nythraxis_bound_guardian');
}

function formRaid(sim: Sim, leaderPid: number) {
  while ((sim.partyOf(leaderPid)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    sim.partyInvite(pid, leaderPid);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(leaderPid);
}

function enterRaid(sim: Sim, pid: number) {
  attune(sim, pid);
  formRaid(sim, pid);
  sim.enterDungeon('nythraxis_boss_arena', pid);
  const p = sim.entities.get(pid)!;
  return instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, sim.instanceSlotAt(p.pos)!);
}

function mob(sim: Sim, templateId: string): Entity {
  const found = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === templateId && !e.dead,
  );
  expect(found).toBeTruthy();
  return found!;
}

function objects(sim: Sim, itemId: string, near?: { x: number; z: number }): Entity[] {
  return [...sim.entities.values()].filter(
    (e) =>
      e.kind === 'object' &&
      e.objectItemId === itemId &&
      (!near || dist2d(e.pos, { x: near.x, y: 0, z: near.z }) < 140),
  );
}

function deathlessChannelObjects(sim: Sim, near: { x: number; z: number }): Entity[] {
  return objects(sim, 'bastion_ward_stone', near).sort((a, b) => a.id - b.id);
}

function engage(boss: Entity, tank: Entity) {
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
}

function tickSeconds(sim: Sim, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) sim.tick();
}

function summonImp(sim: Sim, pid: number): Entity {
  sim.setPlayerLevel(20, pid);
  const owner = sim.entities.get(pid)!;
  const pet = (
    sim as unknown as {
      createDemonPet(owner: Entity, mobId: string, emit?: boolean): Entity | null;
    }
  ).createDemonPet(owner, 'emberkin', false);
  if (!pet) throw new Error('expected warlock imp');
  return pet;
}

function collectEventsForSeconds(sim: Sim, seconds: number): TimedEvent[] {
  const rows: TimedEvent[] = [];
  for (let i = 0; i < seconds * 20; i++) {
    const events = sim.tick();
    const at = (sim as unknown as { time: number }).time;
    for (const event of events) rows.push({ at, event });
  }
  return rows;
}

function killMob(sim: Sim, mob: Entity, killer: Entity) {
  (
    sim as unknown as {
      dealDamage(
        source: Entity,
        target: Entity,
        amount: number,
        crit: boolean,
        school: string,
        ability: string | null,
        kind: 'hit',
        noRage?: boolean,
      ): void;
    }
  ).dealDamage(killer, mob, mob.hp, false, 'physical', null, 'hit', true);
}

function applyExternalAura(
  sim: Sim,
  target: Entity,
  sourceId: number,
  aura: Omit<Aura, 'sourceId'>,
) {
  (sim as unknown as { applyAura(target: Entity, aura: Aura): void }).applyAura(target, {
    ...aura,
    sourceId,
  });
}

describe('Nythraxis raid encounter', () => {
  it('registers the Abandoned Crypt as a 10-player dark raid instance', () => {
    const crypt = DUNGEONS.nythraxis_crypt;
    const dungeon = DUNGEONS.nythraxis_boss_arena;
    expect(crypt.interior).toBe('crypt');
    expect(
      crypt.objects?.some(
        (o) =>
          o.templateId === 'dungeon_door' && o.dungeonId === 'nythraxis_boss_arena' && o.z >= 109,
      ),
    ).toBe(true);
    // The crypt's interactables are the three attunement relics that summon the
    // guardian undead. The Royal Graves belong to the overworld q_nythraxis_graves
    // quest (ZONE3_OBJECTS) — they must not be duplicated inside the crypt.
    expect(crypt.objects?.map((o) => o.itemId)).toEqual(
      expect.arrayContaining(['captains_crest', 'priests_sigil', 'royal_seal']),
    );
    expect(crypt.objects?.some((o) => o.itemId.startsWith('grave_'))).toBe(false);
    expect(dungeon.interior).toBe('nythraxis');
    expect(dungeon.suggestedPlayers).toBe(10);
    expect(dungeon.spawns).toEqual([{ mobId: 'nythraxis_scourge_of_thornpeak', x: 0, z: 96 }]);
    expect(NYTHRAXIS_LAYOUT.wallX).toBeGreaterThanOrEqual(230);
    expect(MOBS.nythraxis_scourge_of_thornpeak.boss).toBe(true);
    expect(MOBS.nythraxis_scourge_of_thornpeak.ccImmune).toBe(true);
    expect(MOBS.nythraxis_scourge_of_thornpeak.moveSpeed).toBe(10.5);
    expect(MOBS.nythraxis_scourge_of_thornpeak.dmgBase).toBeCloseTo(54);
    expect(MOBS.nythraxis_scourge_of_thornpeak.dmgPerLevel).toBeCloseTo(11.4);
    expect(MOBS.nythraxis_skeleton_warrior.dmgBase).toBeCloseTo(26);
    expect(MOBS.nythraxis_skeleton_warrior.dmgPerLevel).toBeCloseTo(5.6);

    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, pid);
    expect(sim.entities.get(pid)!.pos.x).toBeGreaterThan(3000);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    expect(boss.maxHp).toBe(60000);
    expect(boss.weapon.min).toBe(325);
    expect(boss.weapon.max).toBe(507);
    expect(visualKeyFor(boss)).toBe('skel_golem');
    expect(boss.scale).toBeGreaterThanOrEqual(3);
    expect(boss.facing).toBe(Math.PI);
    const wards = objects(sim, 'bastion_ward_stone', origin);
    const pillars = objects(sim, 'soulshard_pillar', origin);
    expect(wards).toHaveLength(3);
    expect(
      wards
        .map((w) => ({ x: Math.round(w.pos.x - origin.x), z: Math.round(w.pos.z - origin.z) }))
        .sort((a, b) => a.x - b.x),
    ).toEqual([
      { x: -40, z: 79 },
      { x: 0, z: 63 },
      { x: 40, z: 79 },
    ]);
    expect(pillars).toHaveLength(0);
    expect(isBlocked(sim.cfg.seed, origin.x + 0, origin.z + 96)).toBe(false);
    expect(isBlocked(sim.cfg.seed, origin.x + 18, origin.z + 82)).toBe(false);
    expect(isBlocked(sim.cfg.seed, origin.x + 230, origin.z + 82)).toBe(true);
    expect(dungeonDaisHasRaisedPlatform('nythraxis')).toBe(false);
    expect(dungeonDaisHasRaisedPlatform('crypt')).toBe(true);
  });

  it('blocks attuned solo players from the Nythraxis arena until they are in a raid group', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Solo');
    attune(sim, pid);
    const before = { ...sim.entities.get(pid)!.pos };

    sim.enterDungeon('nythraxis_boss_arena', pid);

    expect(dist2d(sim.entities.get(pid)!.pos, before)).toBeLessThan(0.1);
  });

  it('automatically pulls Nythraxis when a player enters his aggro radius', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, boss.pos.x, boss.pos.z - 10);
    rebucket(sim, tank);

    sim.tick();

    expect(boss.inCombat).toBe(true);
    expect(['chase', 'attack']).toContain(boss.aiState);
    expect(boss.aggroTargetId).toBe(tank.id);
  });

  it('defines four Nythraxis equipment drops with 3 percent legendary rolls', () => {
    const loot = MOBS.nythraxis_scourge_of_thornpeak.loot.filter((entry) => entry.itemId);
    const groups = new Map<string, typeof loot>();
    for (const entry of loot) {
      expect(entry.rollGroup).toMatch(/^nythraxis_drop_[1-4]$/);
      const group = entry.rollGroup!;
      groups.set(group, [...(groups.get(group) ?? []), entry]);
      expect(ITEMS[entry.itemId!], entry.itemId).toBeTruthy();
    }

    expect(groups.size).toBe(4);
    for (const entries of groups.values()) {
      const total = entries.reduce((sum, entry) => sum + entry.chance, 0);
      expect(total).toBeCloseTo(1, 5);
    }

    for (const itemId of ['deathless_heartwood', 'kingsbane_last_oath']) {
      const item = ITEMS[itemId];
      expect(item.quality).toBe('legendary');
      expect(loot.find((entry) => entry.itemId === itemId)?.chance).toBe(0.03);
    }

    for (const itemId of [
      'crownforged_dreadhelm',
      'crownforged_warspaulders',
      'nighttalon_crown',
      'nighttalon_shoulderguards',
      'soulflame_cowl',
      'soulflame_mantle',
      'stormcallers_crown',
      'stormcallers_spaulders',
    ]) {
      const item = ITEMS[itemId];
      expect(item.quality).toBe('epic');
      expect(['helmet', 'shoulder']).toContain(item.slot);
      expect(loot.some((entry) => entry.itemId === itemId)).toBe(true);
    }

    expect(ITEMS.crownforged_dreadhelm.requiredClass).toEqual(['warrior', 'paladin']);
    expect(ITEMS.crownforged_warspaulders.requiredClass).toEqual(['warrior', 'paladin']);
    expect(ITEMS.soulflame_cowl.requiredClass).toEqual(['mage', 'priest', 'warlock', 'druid']);
    expect(ITEMS.soulflame_mantle.requiredClass).toEqual(['mage', 'priest', 'warlock', 'druid']);
    expect(ITEMS.stormcallers_crown.requiredClass).toEqual(['shaman']);
    expect(ITEMS.stormcallers_spaulders.requiredClass).toEqual(['shaman']);
  });

  it('keeps Nythraxis fixed at his throne facing the entrance before pull', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, pid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const spawn = { ...boss.spawnPos };

    tickSeconds(sim, 8);

    expect(dist2d(boss.pos, spawn)).toBeLessThan(0.01);
    expect(boss.facing).toBe(Math.PI);
    expect(boss.aiState).toBe('idle');
    expect(boss.inCombat).toBe(false);
  });

  it('keeps the three Abandoned Crypt attunement relics and summons their undead', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Attuning');
    sim.players.get(pid)!.questLog.set('q_nythraxis_sealed_crypt', {
      questId: 'q_nythraxis_sealed_crypt',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.enterDungeon('nythraxis_crypt', pid);
    const p = sim.entities.get(pid)!;
    const origin = instanceOrigin(DUNGEONS.nythraxis_crypt.index, sim.instanceSlotAt(p.pos)!);
    const relics = [
      ['captains_crest', 'fallen_captain_aldren'],
      ['priests_sigil', 'corrupted_priest_malric'],
      ['royal_seal', 'deathstalker_voss'],
    ] as const;
    for (const [itemId, summonId] of relics) {
      const relic = objects(sim, itemId, origin)[0];
      expect(relic, itemId).toBeTruthy();
      teleport(sim, pid, relic.pos.x, relic.pos.z);
      sim.pickUpObject(relic.id, pid);
      expect(mob(sim, summonId), summonId).toBeTruthy();
    }
  });

  it('Nythraxis keeps autoattacking while normal mechanics are active', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, boss.pos.x, boss.pos.z - 4);
    engage(boss, tank);
    boss.aiState = 'attack';
    boss.swingTimer = 0;
    const hp = tank.hp;
    sim.tick();
    expect(tank.hp).toBeLessThan(hp);
  });

  it('stages Nythraxis opening yells far enough apart for the voice lines to finish', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);

    const events = collectEventsForSeconds(sim, 6);
    const openingYells = events
      .filter(isTimedChatEvent)
      .filter(
        (row) =>
          row.event.from === boss.name &&
          row.event.channel === 'yell' &&
          (row.event.text === 'Another kingdom comes to challenge me' ||
            row.event.text === 'You will join the rest'),
      );

    expect(openingYells.map((row) => row.event.text)).toEqual([
      'Another kingdom comes to challenge me',
      'You will join the rest',
    ]);
    expect(openingYells[1].at - openingYells[0].at).toBeGreaterThanOrEqual(3.75);
  });

  it('does not interrupt the opening yells with the Gravebreaker voice line', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);

    const events = collectEventsForSeconds(sim, 12);
    const bossYells = events
      .filter(isTimedChatEvent)
      .filter((row) => row.event.from === boss.name && row.event.channel === 'yell');
    const openingYells = bossYells.filter(
      (row) =>
        row.event.text === 'Another kingdom comes to challenge me' ||
        row.event.text === 'You will join the rest',
    );
    const kneelYells = bossYells.filter((row) => row.event.text === 'Kneel before your king');
    const gravebreakerFx = events
      .filter(isTimedSpellFxEvent)
      .filter(
        (row) =>
          row.event.sourceId === boss.id &&
          row.event.fx === 'nova' &&
          row.event.school === 'physical',
      );

    expect(openingYells.map((row) => row.event.text)).toEqual([
      'Another kingdom comes to challenge me',
      'You will join the rest',
    ]);
    expect(gravebreakerFx.length).toBeGreaterThan(0);
    expect(kneelYells).toHaveLength(0);
    expect(bossYells.map((row) => row.event.text)).toEqual([
      'Another kingdom comes to challenge me',
      'You will join the rest',
    ]);
  });

  it('only speaks the Gravebreaker line on every third cleave cadence', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 1.5,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = collectEventsForSeconds(sim, 66);
    const gravebreakerFx = events
      .filter(isTimedSpellFxEvent)
      .filter(
        (row) =>
          row.event.sourceId === boss.id &&
          row.event.fx === 'nova' &&
          row.event.school === 'physical',
      );
    const kneelYells = events
      .filter(isTimedChatEvent)
      .filter((row) => row.event.text === 'Kneel before your king' && row.event.from === boss.name);

    expect(gravebreakerFx).toHaveLength(6);
    expect(kneelYells).toHaveLength(2);
    expect(kneelYells[0].at).toBeGreaterThanOrEqual(25);
    expect(kneelYells[0].at).toBeCloseTo(gravebreakerFx[2].at, 5);
    expect(kneelYells[1].at).toBeCloseTo(gravebreakerFx[5].at, 5);
    expect(kneelYells[1].at - kneelYells[0].at).toBeGreaterThanOrEqual(35);
  });

  it('deals normal Gravebreaker damage to the tank and 150 percent to secondary cone targets', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const secondaryPid = sim.addPlayer('warrior', 'Secondary');
    const secondary = sim.entities.get(secondaryPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    secondary.maxHp = 1e7;
    secondary.hp = secondary.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    boss.facing = Math.PI;
    boss.prevFacing = Math.PI;
    teleport(sim, tankPid, origin.x, origin.z + 90);
    teleport(sim, secondaryPid, origin.x + 1, origin.z + 89);
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 0,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();
    const gravebreakerHits = events
      .filter(isDamageEvent)
      .filter(
        (ev) => ev.sourceId === boss.id && ev.ability === 'Gravebreaker' && ev.kind === 'hit',
      );
    const tankHit = gravebreakerHits.find((ev) => ev.targetId === tank.id);
    const secondaryHit = gravebreakerHits.find((ev) => ev.targetId === secondary.id);

    expect(tankHit?.amount).toBeGreaterThan(0);
    expect(secondaryHit?.amount).toBeGreaterThan(0);
    expect(secondaryHit!.amount / tankHit!.amount).toBeCloseTo(1.5, 1);
  });

  it('only hits players in front of Nythraxis with Gravebreaker placement', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const besideTankPid = sim.addPlayer('warrior', 'BesideTank');
    const besideTank = sim.entities.get(besideTankPid)!;
    const behindPid = sim.addPlayer('warrior', 'Behind');
    const behind = sim.entities.get(behindPid)!;
    for (const p of [tank, besideTank, behind]) {
      p.maxHp = 1e7;
      p.hp = p.maxHp;
    }
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    boss.facing = Math.PI;
    boss.prevFacing = Math.PI;
    teleport(sim, tankPid, origin.x, origin.z + 90);
    teleport(sim, besideTankPid, origin.x + 2, origin.z + 90);
    teleport(sim, behindPid, origin.x, origin.z + 102);
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 0,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();
    const gravebreakerHits = events
      .filter(isDamageEvent)
      .filter(
        (ev) => ev.sourceId === boss.id && ev.ability === 'Gravebreaker' && ev.kind === 'hit',
      );
    const tankHit = gravebreakerHits.find((ev) => ev.targetId === tank.id);
    const besideTankHit = gravebreakerHits.find((ev) => ev.targetId === besideTank.id);
    const behindHit = gravebreakerHits.find((ev) => ev.targetId === behind.id);

    expect(tankHit?.amount).toBeGreaterThan(0);
    expect(besideTankHit?.amount).toBeGreaterThan(tankHit!.amount);
    expect(besideTankHit!.amount / tankHit!.amount).toBeCloseTo(1.5, 1);
    expect(behindHit).toBeUndefined();
  });

  it('respects the Gravebreaker cone width at the front-arc boundary', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const insidePid = sim.addPlayer('warrior', 'InsideCone');
    const outsidePid = sim.addPlayer('warrior', 'OutsideCone');
    const inside = sim.entities.get(insidePid)!;
    const outside = sim.entities.get(outsidePid)!;
    for (const p of [tank, inside, outside]) {
      p.maxHp = 1e7;
      p.hp = p.maxHp;
    }
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    boss.facing = Math.PI;
    boss.prevFacing = Math.PI;
    teleport(sim, tankPid, origin.x, origin.z + 90);

    const placeAtArc = (pid: number, angleOffset: number, range: number) => {
      teleport(
        sim,
        pid,
        boss.pos.x + Math.sin(boss.facing + angleOffset) * range,
        boss.pos.z + Math.cos(boss.facing + angleOffset) * range,
      );
    };
    placeAtArc(insidePid, Math.PI / 3 - 0.01, 10);
    placeAtArc(outsidePid, Math.PI / 3 + 0.01, 10);
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 0,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();
    const gravebreakerHits = events
      .filter(isDamageEvent)
      .filter(
        (ev) => ev.sourceId === boss.id && ev.ability === 'Gravebreaker' && ev.kind === 'hit',
      );

    expect(gravebreakerHits.some((ev) => ev.targetId === tank.id)).toBe(true);
    expect(gravebreakerHits.some((ev) => ev.targetId === inside.id)).toBe(true);
    expect(gravebreakerHits.some((ev) => ev.targetId === outside.id)).toBe(false);
  });

  it('suppresses non-critical Nythraxis dialogue while another dialogue set is active', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: (sim as unknown as { time: number }).time + 30,
      dialogueToken: 1,
      gravebreakerTimer: 0,
      gravebreakerCasts: 2,
      raiseFallenTimer: 999,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();

    expect(
      events.some(
        (ev) =>
          ev.type === 'spellfx' &&
          ev.sourceId === boss.id &&
          ev.fx === 'nova' &&
          ev.school === 'physical',
      ),
    ).toBe(true);
    expect(events.some((ev) => ev.type === 'chat' && ev.text === 'Kneel before your king')).toBe(
      false,
    );
  });

  it('lets Soul Rend callout interrupt an active non-critical dialogue set', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    for (const name of ['A', 'B', 'C']) {
      const pid = sim.addPlayer('mage', name);
      teleport(sim, pid, origin.x, origin.z + 82);
    }
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      dialogueBusyUntil: (sim as unknown as { time: number }).time + 30,
      dialogueToken: 1,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 0,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 99,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();

    expect(events.some((ev) => ev.type === 'chat' && ev.text === 'Your spirit belongs to me')).toBe(
      true,
    );
    expect(boss.nythraxis.soulRendMarks.length).toBeGreaterThan(0);
  });

  it('lets Deathless Rage callout interrupt an active non-critical dialogue set', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      dialogueBusyUntil: (sim as unknown as { time: number }).time + 30,
      dialogueToken: 1,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();

    expect(events.some((ev) => ev.type === 'chat' && ev.text === 'Witness true eternity!')).toBe(
      true,
    );
    expect(boss.castingAbility).toBe('nythraxis_deathless_rage');
  });

  it('lets Nythraxis immediately swing when his target is inside 8 yards', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 0;
    teleport(sim, tankPid, origin.x, origin.z + 88.5);
    engage(boss, tank);
    boss.aiState = 'chase';

    const events = sim.tick();

    expect(dist2d(boss.pos, tank.pos)).toBeLessThanOrEqual(8);
    expect(
      events.some(
        (ev) => ev.type === 'damage' && ev.sourceId === boss.id && ev.targetId === tank.id,
      ),
    ).toBe(true);
  });

  it('keeps Nythraxis closing to his desired melee band while he can already swing', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, boss.pos.x, boss.pos.z - 10.5);
    tank.prevPos = { ...tank.pos, z: tank.pos.z - 0.2 }; // moving target gets the old range grace
    engage(boss, tank);
    boss.aiState = 'attack';
    boss.swingTimer = 999;

    const before = dist2d(boss.pos, tank.pos);
    tickSeconds(sim, 1);

    expect(before).toBeLessThanOrEqual(11);
    expect(dist2d(boss.pos, tank.pos)).toBeLessThan(8);
  });

  it('keeps Nythraxis autoattacking while the tank moves around the arena', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.swingTimer = 0;
    teleport(sim, tankPid, boss.pos.x, boss.pos.z - 6);
    engage(boss, tank);
    boss.aiState = 'attack';

    const hitTimes: number[] = [];
    for (let i = 0; i < 20 * 24; i++) {
      const t = i / 20;
      if (t > 2) {
        const oldPos = { ...tank.pos };
        const angle = (t - 2) * 0.65;
        tank.pos.x = origin.x + Math.sin(angle) * 18;
        tank.pos.z = origin.z + 82 + Math.cos(angle) * 18;
        tank.pos.y = groundHeight(tank.pos.x, tank.pos.z, sim.cfg.seed);
        tank.prevPos = oldPos;
      }
      const events = sim.tick();
      if (
        events.some(
          (ev) =>
            ev.type === 'damage' &&
            ev.sourceId === boss.id &&
            ev.targetId === tank.id &&
            ev.ability === null,
        )
      ) {
        hitTimes.push(t);
      }
    }

    expect(hitTimes.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < hitTimes.length; i++) {
      expect(hitTimes[i] - hitTimes[i - 1]).toBeLessThanOrEqual(4);
    }
  });

  it('prevents sustained circle-kiting from delaying Nythraxis boss swings', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.hp = boss.maxHp;
    boss.swingTimer = 0;
    engage(boss, tank);
    boss.aiState = 'chase';
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 999,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const hitTimes: number[] = [];
    for (let i = 0; i < 20 * 24; i++) {
      const t = i / 20;
      const oldPos = { ...tank.pos };
      const angle = t * 0.3;
      tank.pos.x = origin.x + Math.sin(angle) * 24;
      tank.pos.z = origin.z + 82 + Math.cos(angle) * 24;
      tank.pos.y = groundHeight(tank.pos.x, tank.pos.z, sim.cfg.seed);
      tank.prevPos = oldPos;
      const events = sim.tick();
      if (
        events.some(
          (ev) =>
            ev.type === 'damage' &&
            ev.sourceId === boss.id &&
            ev.targetId === tank.id &&
            ev.ability === null,
        )
      ) {
        hitTimes.push(t);
      }
    }

    expect(hitTimes.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < hitTimes.length; i++) {
      expect(hitTimes[i] - hitTimes[i - 1]).toBeLessThanOrEqual(3.25);
    }
  });

  it('lets Nythraxis adds immediately swing after stepping into melee range', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      gravebreakerTimer: 999,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.pos = { x: tank.pos.x, y: tank.pos.y, z: tank.pos.z - 6.0 };
    add.prevPos = { ...add.pos };
    add.swingTimer = 0;
    add.aiState = 'chase';
    add.aggroTargetId = tank.id;
    add.threat.set(tank.id, 1000);

    const events = sim.tick();

    expect(dist2d(add.pos, tank.pos)).toBeLessThanOrEqual(5.75);
    expect(
      events.some(
        (ev) => ev.type === 'damage' && ev.sourceId === add.id && ev.targetId === tank.id,
      ),
    ).toBe(true);
  });

  it('keeps Nythraxis adds closing to their desired melee band while they can already swing', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.pos = { x: tank.pos.x, y: tank.pos.y, z: tank.pos.z - 8 };
    add.prevPos = { ...add.pos };
    tank.prevPos = { ...tank.pos, z: tank.pos.z + 0.2 };
    add.swingTimer = 999;
    add.aiState = 'attack';
    add.aggroTargetId = tank.id;
    add.threat.set(tank.id, 1000);

    const before = dist2d(add.pos, tank.pos);
    tickSeconds(sim, 1);

    expect(before).toBeLessThanOrEqual(8.75);
    expect(dist2d(add.pos, tank.pos)).toBeLessThan(6);
  });

  it('keeps Nythraxis adds autoattacking while their target moves', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.swingTimer = 0;
    add.aiState = 'chase';
    add.aggroTargetId = tank.id;
    add.threat.set(tank.id, 1000);

    const hitTimes: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      const t = i / 20;
      const oldPos = { ...tank.pos };
      const angle = t * 0.9;
      tank.pos.x = origin.x + Math.sin(angle) * 14;
      tank.pos.z = origin.z + 82 + Math.cos(angle) * 14;
      tank.pos.y = groundHeight(tank.pos.x, tank.pos.z, sim.cfg.seed);
      tank.prevPos = oldPos;
      const events = sim.tick();
      if (
        events.some(
          (ev) => ev.type === 'damage' && ev.sourceId === add.id && ev.targetId === tank.id,
        )
      ) {
        hitTimes.push(t);
      }
    }

    expect(add.moveSpeed).toBeGreaterThan(7);
    expect(hitTimes.length).toBeGreaterThanOrEqual(6);
    expect(hitTimes.at(-1)).toBeGreaterThan(15);
    for (let i = 1; i < hitTimes.length; i++) {
      expect(hitTimes[i] - hitTimes[i - 1]).toBeLessThanOrEqual(4.5);
    }
  });

  it('prevents sustained circle-kiting from delaying Nythraxis add swings', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.swingTimer = 0;
    add.aiState = 'chase';
    add.aggroTargetId = tank.id;
    add.threat.set(tank.id, 1000);

    const hitTimes: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      const t = i / 20;
      const oldPos = { ...tank.pos };
      const angle = t * 0.3;
      tank.pos.x = origin.x + Math.sin(angle) * 18;
      tank.pos.z = origin.z + 82 + Math.cos(angle) * 18;
      tank.pos.y = groundHeight(tank.pos.x, tank.pos.z, sim.cfg.seed);
      tank.prevPos = oldPos;
      const events = sim.tick();
      if (
        events.some(
          (ev) => ev.type === 'damage' && ev.sourceId === add.id && ev.targetId === tank.id,
        )
      ) {
        hitTimes.push(t);
      }
    }

    expect(hitTimes.length).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < hitTimes.length; i++) {
      expect(hitTimes[i] - hitTimes[i - 1]).toBeLessThanOrEqual(3.25);
    }
  });

  it('retargets Nythraxis adds to living threat before falling back to the boss target', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const offTankPid = sim.addPlayer('paladin', 'OffTank');
    const offTank = sim.entities.get(offTankPid)!;
    const bossTargetPid = sim.addPlayer('mage', 'BossTarget');
    const bossTarget = sim.entities.get(bossTargetPid)!;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    teleport(sim, offTankPid, origin.x + 2, origin.z + 82);
    teleport(sim, bossTargetPid, origin.x + 4, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, bossTarget);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.aggroTargetId = tank.id;
    add.aiState = 'attack';
    add.inCombat = true;
    add.threat.clear();
    add.threat.set(tank.id, 1000);
    add.threat.set(offTank.id, 500);
    tank.dead = true;
    tank.hp = 0;

    sim.tick();

    expect(add.aggroTargetId).toBe(offTank.id);
    expect(add.aiState).toBe('chase');
    expect(add.despawnTimer).toBeUndefined();
  });

  it('falls Nythraxis adds back to the boss target only when their threat table has no living targets', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const bossTargetPid = sim.addPlayer('mage', 'BossTarget');
    const bossTarget = sim.entities.get(bossTargetPid)!;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    teleport(sim, bossTargetPid, origin.x + 4, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, bossTarget);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.aggroTargetId = tank.id;
    add.aiState = 'attack';
    add.inCombat = true;
    add.threat.clear();
    add.threat.set(tank.id, 1000);
    tank.dead = true;
    tank.hp = 0;

    sim.tick();

    expect(add.aggroTargetId).toBe(bossTarget.id);
    expect(add.aiState).toBe('chase');
    expect(add.threat.get(bossTarget.id)).toBeGreaterThan(0);
    expect(add.despawnTimer).toBeUndefined();
  });

  it('despawns Nythraxis adds after 10 seconds only when Nythraxis is out of combat', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    add.aggroTargetId = tank.id;
    add.aiState = 'attack';
    add.inCombat = true;
    add.threat.clear();
    add.threat.set(tank.id, 1000);
    boss.inCombat = false;
    boss.aiState = 'idle';
    boss.aggroTargetId = null;
    boss.nythraxis = undefined;
    tank.dead = true;
    tank.hp = 0;

    sim.tick();

    expect(add.despawnTimer).toBeGreaterThan(9);
    expect(add.aiState).toBe('idle');
    expect(add.hostile).toBe(false);

    tickSeconds(sim, 9);
    expect(sim.entities.has(add.id)).toBe(true);
    tickSeconds(sim, 2);
    expect(sim.entities.has(add.id)).toBe(false);
  });

  it('prevents external slows and hard CC from affecting Nythraxis', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const controls: Omit<Aura, 'sourceId'>[] = [
      {
        id: 'test_slow',
        name: 'Test Slow',
        kind: 'slow',
        remaining: 10,
        duration: 10,
        value: 0.5,
        school: 'frost',
      },
      {
        id: 'test_root',
        name: 'Test Root',
        kind: 'root',
        remaining: 10,
        duration: 10,
        value: 0,
        school: 'nature',
      },
      {
        id: 'test_stun',
        name: 'Test Stun',
        kind: 'stun',
        remaining: 4,
        duration: 4,
        value: 0,
        school: 'physical',
      },
      {
        id: 'test_fear',
        name: 'Test Fear',
        kind: 'incapacitate',
        remaining: 8,
        duration: 8,
        value: 0,
        school: 'shadow',
      },
      {
        id: 'test_poly',
        name: 'Test Polymorph',
        kind: 'polymorph',
        remaining: 12,
        duration: 12,
        value: 0,
        school: 'arcane',
      },
    ];

    for (const aura of controls) applyExternalAura(sim, boss, tankPid, aura);

    expect(boss.auras.some((a) => controls.some((control) => control.id === a.id))).toBe(false);
  });

  it('prevents external slows and hard CC from affecting Nythraxis adds', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    teleport(sim, tankPid, origin.x, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      gravebreakerTimer: 999,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    const controls: Omit<Aura, 'sourceId'>[] = [
      {
        id: 'test_slow',
        name: 'Test Slow',
        kind: 'slow',
        remaining: 10,
        duration: 10,
        value: 0.5,
        school: 'frost',
      },
      {
        id: 'test_root',
        name: 'Test Root',
        kind: 'root',
        remaining: 10,
        duration: 10,
        value: 0,
        school: 'nature',
      },
      {
        id: 'test_stun',
        name: 'Test Stun',
        kind: 'stun',
        remaining: 4,
        duration: 4,
        value: 0,
        school: 'physical',
      },
      {
        id: 'test_fear',
        name: 'Test Fear',
        kind: 'incapacitate',
        remaining: 8,
        duration: 8,
        value: 0,
        school: 'shadow',
      },
      {
        id: 'test_poly',
        name: 'Test Polymorph',
        kind: 'polymorph',
        remaining: 12,
        duration: 12,
        value: 0,
        school: 'arcane',
      },
    ];

    for (const aura of controls) applyExternalAura(sim, add, tankPid, aura);

    expect(add.auras.some((a) => controls.some((control) => control.id === a.id))).toBe(false);
  });

  it('Nythraxis chases back into swing range when his target runs away', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    teleport(sim, tankPid, origin.x, origin.z + 36);
    boss.aiState = 'chase';
    boss.swingTimer = 0;

    const hp = tank.hp;
    for (let i = 0; i < 20 * 12 && tank.hp === hp; i++) sim.tick();

    expect(dist2d(boss.pos, tank.pos)).toBeLessThanOrEqual(12);
    expect(tank.hp).toBeLessThan(hp);
    expect(boss.aiState).toBe('attack');
  });

  it('forces an engaged but idle Nythraxis into chase and melee swings', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, origin.x, origin.z + 36);
    boss.inCombat = true;
    boss.aiState = 'idle';
    boss.aggroTargetId = tank.id;
    boss.threat.set(tank.id, 1000);
    boss.swingTimer = 0;

    sim.tick();
    expect(boss.aiState).toBe('chase');

    const hp = tank.hp;
    for (let i = 0; i < 20 * 12 && tank.hp === hp; i++) sim.tick();

    expect(dist2d(boss.pos, tank.pos)).toBeLessThanOrEqual(12);
    expect(tank.hp).toBeLessThan(hp);
    expect(boss.aiState).toBe('attack');
  });

  it('raised skeleton adds chase back into swing range', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      gravebreakerTimer: 99,
      raiseFallenTimer: 0,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 99,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const add = mob(sim, 'nythraxis_skeleton_warrior');
    teleport(sim, tankPid, origin.x + 34, origin.z + 82);
    add.aiState = 'chase';
    add.swingTimer = 0;

    for (let i = 0; i < 20 * 12; i++) sim.tick();

    expect(dist2d(add.pos, tank.pos)).toBeLessThanOrEqual(6);
    expect(add.aiState).toBe('attack');
  });

  it('allows the outer crypt but blocks un-attuned players at the inner royal door', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Unready');
    sim.enterDungeon('nythraxis_crypt', pid);
    expect(sim.entities.get(pid)!.pos.x).toBeGreaterThan(3000);
    const before = { ...sim.entities.get(pid)!.pos };
    sim.enterDungeon('nythraxis_boss_arena', pid);
    expect(dist2d(sim.entities.get(pid)!.pos, before)).toBeLessThan(0.1);
  });

  it('transitions at 70 percent, stuns the room, spawns Aldric, and lights wardstones', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, boss.pos.x, boss.pos.z - 6);
    engage(boss, tank);
    for (const name of ['A', 'B', 'C']) {
      const pid = sim.addPlayer('mage', name);
      teleport(sim, pid, origin.x, origin.z + 82);
    }
    boss.hp = Math.floor(boss.maxHp * 0.69);

    sim.tick();
    expect(boss.nythraxis?.phase).toBe('transition');
    expect(tank.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    // Brother Aldric is a dynamically-spawned NPC (not a friendly mob) so the
    // online client can open his turn-in dialog.
    const aldric = [...sim.entities.values()].find(
      (e) => e.templateId === 'brother_aldric_raid' && !e.dead,
    );
    expect(aldric).toBeTruthy();
    expect(aldric!.kind).toBe('npc');

    tickSeconds(sim, 8);
    expect(
      deathlessChannelObjects(sim, boss.spawnPos).every((w) =>
        w.auras.some((a) => a.id === 'nythraxis_wardstone_lit'),
      ),
    ).toBe(true);
    tickSeconds(sim, 20);
    expect(boss.nythraxis?.phase).toBe(2);
    expect(boss.nythraxis?.soulRendTimer).toBeGreaterThan(4);
    expect(boss.nythraxis?.soulRendTimer).toBeLessThanOrEqual(5);
    expect(boss.nythraxis?.deathlessTimer).toBeGreaterThan(19);
    expect(boss.nythraxis?.deathlessTimer).toBeLessThanOrEqual(20);
    expect(tank.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(false);
    expect(visualKeyFor(aldric!)).toBe('npc_aldric');
  });

  it('stuns active Nythraxis adds for the full Aldric transition', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, origin.x, origin.z + 82);
    engage(boss, tank);
    boss.nythraxis = {
      phase: 1,
      introSpoken: true,
      transitionStarted: false,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: false,
      dialogueBusyUntil: 0,
      dialogueToken: 0,
      gravebreakerTimer: 999,
      gravebreakerCasts: 0,
      raiseFallenTimer: 0,
      soulRendTimer: 999,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 999,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    const adds = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_skeleton_warrior',
    );
    expect(adds).toHaveLength(2);
    for (const add of adds) {
      add.pos = { ...tank.pos };
      add.prevPos = { ...add.pos };
      add.aiState = 'attack';
      add.inCombat = true;
      add.aggroTargetId = tank.id;
      add.swingTimer = 0;
      add.threat.set(tank.id, 1000);
    }

    boss.hp = Math.floor(boss.maxHp * 0.69);
    sim.tick();
    const transitionHp = tank.hp;
    const transitionEvents = collectEventsForSeconds(sim, 20);

    expect(adds.every((add) => add.auras.some((a) => a.id === 'nythraxis_transition_stun'))).toBe(
      true,
    );
    expect(
      transitionEvents
        .filter(isTimedDamageEvent)
        .some(
          (row) =>
            adds.some((add) => add.id === row.event.sourceId) && row.event.targetId === tank.id,
        ),
    ).toBe(false);
    expect(tank.hp).toBe(transitionHp);
    expect(boss.nythraxis?.phase).toBe('transition');
  });

  it('stuns active pets during the Aldric transition so they cannot keep attacking', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const warlockPid = sim.addPlayer('warlock', 'Warlock');
    teleport(sim, warlockPid, origin.x, origin.z + 82);
    const pet = summonImp(sim, warlockPid);
    teleport(sim, pet.id, origin.x + 2, origin.z + 82);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    teleport(sim, tankPid, origin.x, origin.z + 82);
    engage(boss, tank);
    pet.aiState = 'attack';
    pet.inCombat = true;
    pet.aggroTargetId = boss.id;
    pet.targetId = boss.id;
    pet.swingTimer = 0;

    boss.hp = Math.floor(boss.maxHp * 0.69);
    sim.tick();
    const transitionBossHp = boss.hp;
    const transitionEvents = collectEventsForSeconds(sim, 20);

    expect(pet.auras.some((a) => a.id === 'nythraxis_transition_stun')).toBe(true);
    expect(
      transitionEvents
        .filter(isTimedDamageEvent)
        .some((row) => row.event.sourceId === pet.id && row.event.targetId === boss.id),
    ).toBe(false);
    expect(boss.hp).toBe(transitionBossHp);
  });

  it('spawns Nythraxis add waves every 30 seconds in phase one', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);

    tickSeconds(sim, 28);
    expect(
      [...sim.entities.values()].filter(
        (e) => e.kind === 'mob' && e.templateId === 'nythraxis_skeleton_warrior' && !e.dead,
      ),
    ).toHaveLength(0);

    tickSeconds(sim, 4);
    const adds = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_skeleton_warrior' && !e.dead,
    );
    expect(adds).toHaveLength(2);
    expect(adds[0].weapon.min).toBe(159);
    expect(adds[0].weapon.max).toBe(248);
  });

  it('stages Aldric transition dialogue without interrupting itself before Soul Rend opens phase two after a settle delay', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);
    for (const name of ['A', 'B', 'C']) {
      const pid = sim.addPlayer('mage', name);
      teleport(sim, pid, origin.x, origin.z + 82);
    }
    boss.hp = Math.floor(boss.maxHp * 0.69);

    sim.tick();
    const transitionEvents = collectEventsForSeconds(sim, 27);
    const aldricYells = transitionEvents
      .filter(isTimedChatEvent)
      .filter((row) => row.event.from === 'Brother Aldric' && row.event.channel === 'yell');
    const uniqueAldricYells = aldricYells.filter(
      (row, i) => i === 0 || row.event.text !== aldricYells[i - 1].event.text,
    );
    expect(uniqueAldricYells.map((row) => row.event.text)).toEqual([
      'Your kingdom is gone, Nythraxis',
      'Yet you still cling to it',
      'Champions, listen carefully!',
      'The wardstones still bind his soul.',
      'When the time comes, do not ignore them.',
      'Fail and we all perish',
    ]);
    for (let i = 1; i < uniqueAldricYells.length; i++) {
      expect(uniqueAldricYells[i].at - uniqueAldricYells[i - 1].at).toBeGreaterThanOrEqual(2.35);
    }
    expect(boss.nythraxis?.phase).toBe('transition');
    expect(boss.nythraxis?.soulRendMarks).toHaveLength(0);

    const settleEvents = collectEventsForSeconds(sim, 4);
    expect(
      settleEvents
        .filter(isTimedChatEvent)
        .some((row) => row.event.text === 'Your spirit belongs to me'),
    ).toBe(false);
    expect(boss.nythraxis?.phase).toBe(2);
    expect(boss.nythraxis?.soulRendMarks).toHaveLength(0);

    const openerEvents = collectEventsForSeconds(sim, 2);
    const soulRendYell = openerEvents
      .filter(isTimedChatEvent)
      .find((row) => row.event.text === 'Your spirit belongs to me');
    expect(soulRendYell).toBeDefined();
    expect(soulRendYell!.at).toBeGreaterThan(uniqueAldricYells.at(-1)!.at);
    expect(boss.nythraxis?.soulRendMarks.length).toBeGreaterThan(0);
  });

  it('opens phase two with a 5s settle delay, then Soul Rend and Deathless Rage', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    boss.moveSpeed = 0;
    boss.swingTimer = 999;
    teleport(sim, tankPid, origin.x, origin.z + 36);
    engage(boss, tank);
    const markedPids = ['A', 'B', 'C'].map((name, i) => {
      const pid = sim.addPlayer('mage', name);
      const p = sim.entities.get(pid)!;
      p.maxHp = 1e7;
      p.hp = p.maxHp;
      teleport(sim, pid, origin.x + i, origin.z + 82);
      return pid;
    });
    boss.hp = Math.floor(boss.maxHp * 0.69);

    sim.tick();
    tickSeconds(sim, 28);
    expect(boss.nythraxis?.phase).toBe(2);
    expect(boss.nythraxis?.soulRendMarks).toHaveLength(0);
    expect(boss.nythraxis?.soulRendTimer).toBeGreaterThan(4);
    expect(boss.nythraxis?.soulRendTimer).toBeLessThanOrEqual(5);

    tickSeconds(sim, 5);
    sim.tick();

    const firstSoulRendMarks = boss.nythraxis!.soulRendMarks.map((m) => m.playerId);
    expect(firstSoulRendMarks).toHaveLength(3);
    expect(firstSoulRendMarks).not.toContain(tankPid);
    expect(firstSoulRendMarks.every((pid) => markedPids.includes(pid))).toBe(true);
    expect(boss.nythraxis?.deathlessTimer).toBeGreaterThan(14);
    expect(boss.nythraxis?.deathlessTimer).toBeLessThanOrEqual(15);
    expect(boss.nythraxis?.soulRendTimer).toBeGreaterThan(29);
    expect(boss.nythraxis?.soulRendTimer).toBeLessThanOrEqual(30);

    tickSeconds(sim, 15);
    expect(boss.castingAbility).toBe('nythraxis_deathless_rage');
  });

  it('does not overlap Deathless Rage with active Soul Rend marks', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    engage(boss, tank);
    const markedPids = ['A', 'B', 'C'].map((name, i) => {
      const pid = sim.addPlayer('mage', name);
      const p = sim.entities.get(pid)!;
      p.maxHp = 1e7;
      p.hp = p.maxHp;
      teleport(sim, pid, origin.x + i, origin.z + 82);
      return pid;
    });
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: markedPids.map((pid) => ({ playerId: pid, remaining: 3 })),
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    sim.tick();
    expect(boss.castingAbility).not.toBe('nythraxis_deathless_rage');
    expect(boss.nythraxis.deathlessTimer).toBeGreaterThan(0);
    expect(boss.nythraxis.soulRendMarks).toHaveLength(3);

    tickSeconds(sim, 4);
    expect(boss.nythraxis.soulRendMarks).toHaveLength(0);
    tickSeconds(sim, 1);
    expect(boss.castingAbility).toBe('nythraxis_deathless_rage');
  });

  it('splits Soul Rend among players stacked within 5 yards and kills isolated marks', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const tank = sim.entities.get(tankPid)!;
    engage(boss, tank);
    const pids = ['A', 'B', 'C'].map((name) => {
      const pid = sim.addPlayer('mage', name);
      teleport(sim, pid, origin.x, origin.z + 82);
      return pid;
    });
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: pids.map((pid) => ({ playerId: pid, remaining: 0 })),
      soulRendLockout: 0,
      deathlessTimer: 99,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    for (const pid of pids) {
      const p = sim.entities.get(pid)!;
      expect(p.dead).toBe(false);
      expect(p.hp).toBeLessThanOrEqual(Math.ceil(p.maxHp * 0.7));
    }

    for (let i = 0; i < pids.length; i++) {
      teleport(sim, pids[i], origin.x + i * 4, origin.z + 82);
    }
    boss.nythraxis.soulRendMarks = pids.map((pid) => ({ playerId: pid, remaining: 0 }));
    sim.tick();
    expect(pids.every((pid) => !sim.entities.get(pid)!.dead)).toBe(true);

    for (let i = 0; i < pids.length; i++) {
      teleport(sim, pids[i], origin.x + i * 12, origin.z + 82);
      const p = sim.entities.get(pids[i])!;
      p.dead = false;
      p.hp = p.maxHp;
    }
    boss.nythraxis.soulRendMarks = pids.map((pid) => ({ playerId: pid, remaining: 0 }));
    sim.tick();
    expect(pids.every((pid) => sim.entities.get(pid)!.dead)).toBe(true);
  });

  it('marks non-tank raid members with Soul Rend and skips the aggro target', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const tank = sim.entities.get(tankPid)!;
    engage(boss, tank);
    const pids = ['A', 'B', 'C', 'D'].map((name, i) => {
      const pid = sim.addPlayer('mage', name);
      teleport(sim, pid, origin.x + i, origin.z + 82);
      return pid;
    });
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 0,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 99,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    sim.tick();

    const marked = boss.nythraxis.soulRendMarks.map((m) => m.playerId);
    expect(marked).toHaveLength(3);
    expect(marked).not.toContain(tankPid);
    expect(marked.every((pid) => pids.includes(pid))).toBe(true);
    for (const pid of marked) {
      expect(sim.entities.get(pid)?.auras.some((a) => a.id === 'nythraxis_soul_rend')).toBe(true);
    }
  });

  it('does not mark pets or dead players with Soul Rend', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const tank = sim.entities.get(tankPid)!;
    engage(boss, tank);
    const alivePids = ['A', 'B', 'C'].map((name, i) => {
      const pid = sim.addPlayer('mage', name);
      teleport(sim, pid, origin.x + i, origin.z + 82);
      return pid;
    });
    const deadPid = sim.addPlayer('mage', 'DeadMark');
    const deadPlayer = sim.entities.get(deadPid)!;
    teleport(sim, deadPid, origin.x + 8, origin.z + 82);
    deadPlayer.dead = true;
    deadPlayer.hp = 0;
    const warlockPid = sim.addPlayer('warlock', 'PetOwner');
    teleport(sim, warlockPid, origin.x + 12, origin.z + 82);
    const pet = summonImp(sim, warlockPid);
    teleport(sim, pet.id, origin.x + 14, origin.z + 82);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 0,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 99,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    sim.tick();

    const marked = boss.nythraxis.soulRendMarks.map((m) => m.playerId);
    expect(marked).toHaveLength(3);
    expect(marked.every((pid) => alivePids.includes(pid) || pid === warlockPid)).toBe(true);
    expect(marked).not.toContain(deadPid);
    expect(marked).not.toContain(pet.id);
    expect(deadPlayer.auras.some((a) => a.id === 'nythraxis_soul_rend')).toBe(false);
    expect(pet.auras.some((a) => a.id === 'nythraxis_soul_rend')).toBe(false);
  });

  it('does not detonate Soul Rend on pets or dead players even if a stale mark exists', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    const tank = sim.entities.get(tankPid)!;
    engage(boss, tank);
    const alivePid = sim.addPlayer('mage', 'AliveMark');
    teleport(sim, alivePid, origin.x, origin.z + 82);
    const alive = sim.entities.get(alivePid)!;
    const deadPid = sim.addPlayer('mage', 'DeadMark');
    const deadPlayer = sim.entities.get(deadPid)!;
    teleport(sim, deadPid, origin.x + 2, origin.z + 82);
    deadPlayer.dead = true;
    deadPlayer.hp = 0;
    const warlockPid = sim.addPlayer('warlock', 'PetOwner');
    const pet = summonImp(sim, warlockPid);
    teleport(sim, pet.id, origin.x + 4, origin.z + 82);
    pet.hp = pet.maxHp;
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: [
        { playerId: alivePid, remaining: 0 },
        { playerId: deadPid, remaining: 0 },
        { playerId: pet.id, remaining: 0 },
      ],
      soulRendLockout: 0,
      deathlessTimer: 99,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };

    const events = sim.tick();

    expect(alive.hp).toBeLessThan(alive.maxHp);
    expect(deadPlayer.hp).toBe(0);
    expect(pet.hp).toBe(pet.maxHp);
    expect(
      events.some(
        (ev) => ev.type === 'damage' && ev.targetId === deadPid && ev.ability === 'Soul Rend',
      ),
    ).toBe(false);
    expect(
      events.some(
        (ev) => ev.type === 'damage' && ev.targetId === pet.id && ev.ability === 'Soul Rend',
      ),
    ).toBe(false);
  });

  it('interrupts Deathless Rage when three players channel the wardstones', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, sim.entities.get(tankPid)!);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();
    expect(boss.castingAbility).toBe('nythraxis_deathless_rage');

    const channels = deathlessChannelObjects(sim, origin);
    expect(channels).toHaveLength(3);
    const channelers = channels.map((ward, i) => {
      const pid = sim.addPlayer('priest', `Ward${i}`);
      teleport(sim, pid, ward.pos.x, ward.pos.z);
      sim.targetEntity(ward.id, pid);
      sim.interact(pid);
      return pid;
    });
    tickSeconds(sim, 6);

    expect(boss.castingAbility).toBeNull();
    expect(boss.nythraxis?.deathlessStunRemaining).toBeGreaterThan(0);
    expect(boss.auras.some((a) => a.id === 'nythraxis_deathless_stun' && a.kind === 'stun')).toBe(
      true,
    );
    expect(channelers.every((pid) => sim.entities.get(pid)!.castingAbility === null)).toBe(true);
    expect(objects(sim, 'bastion_ward_stone', origin)).toHaveLength(3);
    expect(objects(sim, 'soulshard_pillar', origin)).toHaveLength(0);
    expect(origin.x).toBeGreaterThan(3000);
  });

  it('does not reset a wardstone channel when the same player interacts again', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, sim.entities.get(tankPid)!);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();

    const ward = objects(sim, 'bastion_ward_stone', origin)[0];
    const pid = sim.addPlayer('priest', 'WardSpam');
    teleport(sim, pid, ward.pos.x, ward.pos.z);
    sim.targetEntity(ward.id, pid);
    sim.interact(pid);
    tickSeconds(sim, 2);
    const remaining = boss.nythraxis!.wardChannels.find((c) => c.objectId === ward.id)!.remaining;
    expect(remaining).toBeLessThan(4);

    sim.interact(pid);
    expect(boss.nythraxis!.wardChannels.find((c) => c.objectId === ward.id)!.remaining).toBeCloseTo(
      remaining,
    );
  });

  it('does not interrupt Deathless Rage unless all three wardstone channels complete', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();

    const ward = objects(sim, 'bastion_ward_stone', origin)[0];
    teleport(sim, tankPid, ward.pos.x, ward.pos.z);
    sim.targetEntity(ward.id, tankPid);
    sim.interact(tankPid);
    sim.tick();

    expect(tank.castingAbility).toBe('nythraxis_ward_channel');
    expect(tank.channeling).toBe(true);
    expect(boss.castingAbility).toBe('nythraxis_deathless_rage');
    expect(boss.nythraxis?.wardChannels.every((c) => c.complete)).toBe(false);

    tickSeconds(sim, 6);

    expect(boss.nythraxis?.wardChannels.filter((c) => c.complete)).toHaveLength(1);
    expect(boss.nythraxis?.deathlessStunRemaining).toBe(0);
    tickSeconds(sim, 5);
    expect(boss.castingAbility).toBeNull();
    expect(boss.nythraxis?.deathlessStunRemaining).toBe(0);
    expect(tank.hp).toBeLessThan(tank.maxHp);
  });

  it('does not interrupt Deathless Rage when one player completes all wardstones', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();

    expect(deathlessChannelObjects(sim, origin)).toHaveLength(3);
    for (const channel of boss.nythraxis!.wardChannels) {
      channel.playerId = tankPid;
      channel.complete = true;
      channel.remaining = 0;
    }
    sim.tick();

    expect(boss.castingAbility).toBe('nythraxis_deathless_rage');
    expect(boss.nythraxis?.deathlessStunRemaining).toBe(0);
    tickSeconds(sim, 10);
    expect(boss.nythraxis?.deathlessStunRemaining).toBe(0);
    expect(tank.hp).toBeLessThan(tank.maxHp);
  });

  it('starts wardstone channels through the object click pickup path', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, sim.entities.get(tankPid)!);
    boss.nythraxis = {
      phase: 2,
      introSpoken: true,
      transitionStarted: true,
      transitionTimer: 0,
      transitionCues: [],
      transitionReleased: true,
      gravebreakerTimer: 99,
      raiseFallenTimer: 99,
      soulRendTimer: 99,
      soulRendMarks: [],
      soulRendLockout: 0,
      deathlessTimer: 0,
      deathlessCastRemaining: 0,
      deathlessStunRemaining: 0,
      wardChannels: [],
      finalStand: false,
      deathSpoken: false,
    };
    sim.tick();

    const ward = objects(sim, 'bastion_ward_stone', origin)[0];
    const pid = sim.addPlayer('priest', 'Clicker');
    teleport(sim, pid, ward.pos.x, ward.pos.z);
    sim.pickUpObject(ward.id, pid);

    const channel = boss.nythraxis!.wardChannels.find((c) => c.objectId === ward.id)!;
    expect(channel.playerId).toBe(pid);
    expect(sim.entities.get(pid)!.castingAbility).toBe('nythraxis_ward_channel');
    expect(ward.lootable).toBe(true);
    expect(
      sim.players.get(pid)!.inventory.some((slot) => slot?.itemId === 'bastion_ward_stone'),
    ).toBe(false);
  });

  it('never leashes/resets when kited — keeps chasing instead of evading home', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    const origin = enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    tank.maxHp = 1e7;
    tank.hp = tank.maxHp; // survive so a wipe can't muddy the test
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    sim.tick(); // init the encounter
    // drag the boss far from its home (further than any leash) but keep the tank
    // alive in the room; a normal mob would evade — Nythraxis must not.
    teleport(sim, tankPid, origin.x + 150, origin.z + 96);
    boss.pos.x = origin.x + 140;
    boss.pos.z = origin.z + 96;
    boss.prevPos = { ...boss.pos };
    tickSeconds(sim, 3);
    expect(boss.nythraxis).toBeTruthy(); // encounter still live
    expect(boss.dead).toBe(false);
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aiState).not.toBe('idle');
  });

  it('resets only on a full wipe (every player in the arena dead)', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    sim.tick();
    expect(boss.nythraxis).toBeTruthy();
    boss.hp = Math.floor(boss.maxHp * 0.4); // mid-fight
    tank.dead = true;
    tank.hp = 0; // raid wipes
    tickSeconds(sim, 1);
    expect(boss.nythraxis).toBeUndefined(); // encounter reset
    expect(boss.hp).toBe(boss.maxHp); // back to full
    expect(dist2d(boss.pos, boss.spawnPos)).toBeLessThan(1); // sent home
    expect(boss.inCombat).toBe(false);
  });

  it('seals the royal door while engaged and reopens it when Nythraxis dies', () => {
    const sim = makeWorld();
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    sim.tick(); // engage -> encounter live -> door sealed
    const inside = { ...tank.pos };
    sim.leaveDungeon(tankPid);
    expect(dist2d(tank.pos, inside)).toBeLessThan(0.1); // could not flee
    expect(tank.pos.x).toBeGreaterThan(3000);
    // boss dies -> seal lifts
    boss.dead = true;
    boss.hp = 0;
    sim.tick();
    sim.leaveDungeon(tankPid);
    expect(tank.pos.x).toBeLessThan(3000); // back out to Thornpeak
  });

  it('locks raid members out of the Nythraxis arena until the next realm-local 3 AM reset', () => {
    // 2025-06-29 12:00 EDT (16:00 UTC). With the server's realm-local reset injected
    // through the lockout seam, the lockout expires at the next US Eastern 3 AM reset
    // (2025-06-30 03:00 EDT == 07:00 UTC), not 24h from the kill.
    let now = Date.UTC(2025, 5, 29, 16, 0, 0);
    const reset = nextRaidResetMs(now);
    const sim = makeWorld(
      () => now,
      (nowMs) => nextRaidResetMs(nowMs),
    );
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    killMob(sim, boss, tank);
    expect(sim.players.get(tankPid)?.raidLockouts.get('nythraxis_boss_arena')).toBe(reset);

    sim.leaveDungeon(tankPid);
    expect(tank.pos.x).toBeLessThan(3000);
    sim.enterDungeon('nythraxis_boss_arena', tankPid);
    expect(tank.pos.x).toBeLessThan(3000); // still locked before the reset

    now = reset + 1; // just past the daily reset boundary
    sim.enterDungeon('nythraxis_boss_arena', tankPid);
    expect(tank.pos.x).toBeGreaterThan(3000); // lockout lifted, re-entry allowed
  });

  it('a heroic kill locks the :heroic key only; the normal raid stays open that day', () => {
    const now = Date.UTC(2025, 5, 29, 16, 0, 0);
    const reset = nextRaidResetMs(now);
    const sim = makeWorld(
      () => now,
      (nowMs) => nextRaidResetMs(nowMs),
    );
    const tankPid = sim.addPlayer('warrior', 'Tank');
    attune(sim, tankPid);
    formRaid(sim, tankPid);
    sim.setDungeonDifficulty('heroic', tankPid);
    sim.enterDungeon('nythraxis_boss_arena', tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    killMob(sim, boss, tank);

    const meta = sim.players.get(tankPid)!;
    // The kill locked the difficulty-scoped key, never the plain raid key: the
    // two difficulties never consume each other's daily lockout.
    expect(meta.raidLockouts.get('nythraxis_boss_arena:heroic')).toBe(reset);
    expect(meta.raidLockouts.has('nythraxis_boss_arena')).toBe(false);

    // Leave and free the heroic claim so the normal re-entry can claim fresh
    // (the live-claim-wins rule otherwise rejoins the locked heroic instance).
    // Fast-forward the empty-instance reset by marking the claim long-empty and
    // running one reset cycle, rather than ticking out 300 real sim-seconds
    // (6000 ticks), which times the test out under CI load.
    sim.leaveDungeon(tankPid);
    const heroicInst = (sim as any).instances.find(
      (i: any) => i.dungeonId === 'nythraxis_boss_arena' && i.partyKey !== null,
    );
    heroicInst.emptyFor = 100000;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(heroicInst.partyKey).toBeNull(); // the heroic claim actually freed

    // Heroic re-entry is still barred by the daily lockout...
    sim.setDungeonDifficulty('heroic', tankPid);
    sim.enterDungeon('nythraxis_boss_arena', tankPid);
    expect(tank.pos.x).toBeLessThan(3000);
    // ...but the NORMAL raid is open the same day (independent lockout key).
    sim.setDungeonDifficulty('normal', tankPid);
    sim.enterDungeon('nythraxis_boss_arena', tankPid);
    expect(tank.pos.x).toBeGreaterThan(3000);
  });

  it('falls back to a flat 24h lockout when the host injects no reset boundary (offline/headless)', () => {
    // The offline browser and the headless RL env omit raidResetMs, so a kill locks for
    // a plain 24h day rather than a realm-local 3 AM reset (the server's behavior).
    const now = 1_000_000;
    const sim = makeWorld(() => now);
    const tankPid = sim.addPlayer('warrior', 'Tank');
    enterRaid(sim, tankPid);
    const tank = sim.entities.get(tankPid)!;
    const boss = mob(sim, 'nythraxis_scourge_of_thornpeak');
    engage(boss, tank);
    killMob(sim, boss, tank);
    expect(sim.players.get(tankPid)?.raidLockouts.get('nythraxis_boss_arena')).toBe(
      now + 24 * 60 * 60 * 1000,
    );
  });

  it('does not allow dueling inside the Nythraxis boss arena', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Tank');
    const b = sim.addPlayer('mage', 'Mage');
    attune(sim, a);
    attune(sim, b);
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    formRaid(sim, a);
    sim.enterDungeon('nythraxis_boss_arena', a);
    sim.enterDungeon('nythraxis_boss_arena', b);
    const ae = sim.entities.get(a)!;
    const be = sim.entities.get(b)!;
    be.pos = { ...ae.pos, x: ae.pos.x + 3 };
    be.prevPos = { ...be.pos };

    sim.duelRequest(b, a);
    sim.duelAccept(b);

    expect(sim.duelFor(a)).toBeNull();
    expect(sim.duelFor(b)).toBeNull();
  });
});
