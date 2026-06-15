import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Entity, dist2d } from '../src/sim/types';
import { CLASSES, CRYPT_DOOR_POS, DUNGEON_LIST, DUNGEON_X_THRESHOLD, ITEMS, LAKE, MOBS, NPCS, QUESTS, zoneAt, zoneWelcomeText } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { isBlocked, resolvePosition } from '../src/sim/colliders';

const SEED = 20061;

function makeSim(cls: 'warrior' | 'mage' = 'warrior') {
  return new Sim({ seed: SEED, playerClass: cls });
}

function teleportTo(sim: Sim, x: number, z: number, pid?: number) {
  const p = sim.entities.get(pid ?? sim.playerId)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('quest lifecycle', () => {
  it('stops showing the Redbrook starter hint after the first quest is accepted', () => {
    const sim = makeSim();
    const starterZone = zoneAt(sim.player.pos.z);

    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId)))
      .toBe('Find Marshal Redbrook in town — he has work for you.');

    const redbrook = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook')!;
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.acceptQuest('q_wolves');
    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId))).toBeNull();

    const qp = sim.questLog.get('q_wolves')!;
    qp.counts[0] = 8;
    qp.state = 'ready';

    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.turnInQuest('q_wolves');

    expect(sim.questState('q_wolves')).toBe('done');
    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId))).toBeNull();
  });

  it('accepting a quest directly requires standing near the giver', () => {
    const sim = makeSim();
    teleportTo(sim, 0, -40);

    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('available');
    expect(sim.questLog.has('q_wolves')).toBe(false);

    const redbrook = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook')!;
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z);
    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('active');
  });

  it('a turned-in quest cannot be accepted again', () => {
    const sim = makeSim();
    const redbrook = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook')!;
    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('active');

    const qp = sim.questLog.get('q_wolves')!;
    qp.counts[0] = 8;
    qp.state = 'ready';

    teleportTo(sim, redbrook.pos.x + 2, redbrook.pos.z + 2);
    sim.turnInQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('done');
    expect(sim.questLog.has('q_wolves')).toBe(false);

    // attempting to take it again must be rejected
    sim.acceptQuest('q_wolves');
    expect(sim.questLog.has('q_wolves')).toBe(false);
    expect(sim.questState('q_wolves')).toBe('done');
  });
});

describe('collision & terrain', () => {
  it('players cannot walk through town buildings', () => {
    const sim = makeSim();
    const p = sim.player;
    // approach the house at (10,12) from the south and hold forward
    teleportTo(sim, 10, 6);
    p.facing = 0; // +z, straight at the building
    sim.moveInput.forward = true;
    for (let i = 0; i < 120; i++) sim.tick();
    // blocked at the wall: never reaches the interior
    expect(dist2d(p.pos, { x: 10, y: 0, z: 12 })).toBeGreaterThan(2.2);
  });

  it('steep rims are walls, not ramps', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 150, 0);
    p.facing = Math.PI / 2; // +x, toward the world rim
    sim.moveInput.forward = true;
    for (let i = 0; i < 400; i++) sim.tick();
    expect(p.pos.x).toBeLessThan(170);
  });

  it('NPCs spawn on dry land outside buildings', () => {
    const sim = makeSim();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'npc') continue;
      expect(groundHeight(e.pos.x, e.pos.z, SEED), `${e.name} underwater`).toBeGreaterThan(WATER_LEVEL + 0.5);
      expect(isBlocked(SEED, e.pos.x, e.pos.z, 0.4), `${e.name} inside a prop`).toBe(false);
    }
  });

  it('mobs spawn out of deep water (murlocs may wade)', () => {
    const sim = makeSim();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob') continue;
      const h = groundHeight(e.pos.x, e.pos.z, SEED);
      const canWade = MOBS[e.templateId].family === 'murloc' || MOBS[e.templateId].canSwim;
      const min = canWade ? WATER_LEVEL - 0.55 : WATER_LEVEL + 0.35;
      expect(h, `${e.name} at ${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}`).toBeGreaterThan(min);
    }
  });

  it('resolvePosition pushes points out of colliders', () => {
    const inside = resolvePosition(SEED, 10, 12, 0.5); // house centre
    expect(Math.abs(inside.x - 10) + Math.abs(inside.z - 12)).toBeGreaterThan(0.5);
    const open = resolvePosition(SEED, 0, -40, 0.5); // open road
    expect(open.x).toBe(0);
    expect(open.z).toBe(-40);
  });
});

describe('swimming', () => {
  it('players float at the surface over deep water', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, LAKE.x, LAKE.z);
    expect(groundHeight(LAKE.x, LAKE.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    sim.tick();
    expect(p.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
    expect(p.pos.y).toBeLessThan(WATER_LEVEL);
    expect(sim.isSwimming(p)).toBe(true);
  });

  it('landlocked mobs refuse to chase into deep water', () => {
    const sim = makeSim();
    const wolf = [...sim.entities.values()].find((e) => e.templateId === 'forest_wolf')!;
    // park a chase target in the middle of the lake
    const p = sim.player;
    teleportTo(sim, LAKE.x, LAKE.z);
    wolf.aiState = 'chase';
    wolf.aggroTargetId = p.id;
    wolf.pos = { ...sim.groundPos(LAKE.x + 24, LAKE.z + 24) };
    wolf.spawnPos = { ...wolf.pos };
    for (let i = 0; i < 100; i++) sim.tick();
    expect(groundHeight(wolf.pos.x, wolf.pos.z, SEED)).toBeGreaterThan(WATER_LEVEL - 0.8);
  });

  it('rare swimmers can chase into deep water', () => {
    const sim = makeSim();
    const rare = createMob(990001, MOBS.elder_bristleback, 5, sim.groundPos(LAKE.x + 24, LAKE.z + 24));
    for (let i = 0; i < 120; i++) {
      (sim as any).moveToward(rare, { x: LAKE.x, y: 0, z: LAKE.z }, rare.moveSpeed);
    }
    expect(groundHeight(rare.pos.x, rare.pos.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    expect(rare.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
  });
});

describe('rare spawn rules', () => {
  it('rare spawns are elite, control immune, swimmers with long respawns', () => {
    for (const id of [
      'elder_bristleback',
      'sableweb_matriarch',
      'mirejaw_the_ravenous',
      'sister_nhalia',
      'ironvein_foreman',
      'marrowlord_varkas',
    ]) {
      expect(MOBS[id], id).toMatchObject({
        rare: true,
        elite: true,
        canSwim: true,
        ccImmune: true,
      });
      if (id === 'elder_bristleback' || id === 'sableweb_matriarch') expect(MOBS[id].respawnMult).toBe(432);
      else if (id === 'mirejaw_the_ravenous' || id === 'sister_nhalia') expect(MOBS[id].respawnMult).toBe(648);
      else expect(MOBS[id].respawnMult).toBe(864);
    }
    expect(MOBS.mogger).toMatchObject({
      rare: true,
      elite: true,
      canSwim: true,
      ccImmune: true,
      respawnMult: 24,
    });
  });

  it('control auras do not stick to control-immune rares', () => {
    const sim = makeSim();
    const rare = createMob(990002, MOBS.sableweb_matriarch, 6, { x: 0, y: 0, z: 0 });

    (sim as any).applyAura(rare, {
      id: 'test_root',
      name: 'Test Root',
      kind: 'root',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: sim.playerId,
    });
    expect(rare.auras.some((a) => a.kind === 'root')).toBe(false);

    (sim as any).applyAura(rare, {
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'slow',
      remaining: 5,
      duration: 5,
      value: 0.5,
      sourceId: sim.playerId,
    });
    expect(rare.auras.some((a) => a.kind === 'slow')).toBe(true);
  });

  it('rare respawn timers use their configured multiplier', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', respawnSeconds: 2 });
    const rare = createMob(990003, MOBS.elder_bristleback, 5, { x: 0, y: 0, z: 0 });
    (sim as any).handleDeath(rare, null);
    expect(rare.respawnTimer).toBe(864);
  });

  it('outdoor rare spawns have 3-player mechanics and no-loot summoned helpers', () => {
    const rareIds = [
      'elder_bristleback',
      'sableweb_matriarch',
      'mogger',
      'mirejaw_the_ravenous',
      'sister_nhalia',
      'ironvein_foreman',
      'marrowlord_varkas',
    ];

    for (const id of rareIds) {
      const rare = MOBS[id];
      expect(rare.elite, id).toBe(true);
      expect(rare.ccImmune, id).toBe(true);
      expect(
        !!rare.aoePulse || !!rare.summonAdds || !!rare.enrage,
        `${id} should have at least one mechanic`,
      ).toBe(true);
      if (rare.summonAdds) {
        expect(MOBS[rare.summonAdds.mobId], `${id} summon target`).toBeTruthy();
        expect(MOBS[rare.summonAdds.mobId].loot, `${id} summon loot`).toEqual([]);
      }
    }

    expect(MOBS.mogger.summonAdds).toEqual({ mobId: 'mogger_lackey', count: 2, atHpPct: [0.70] });
    expect(MOBS.mogger.enrage).toEqual({ belowHpPct: 0.30, dmgMult: 1.6 });
  });
});

describe('the Hollow Crypt doors', () => {
  it('walking into the door teleports you inside; walking into the exit brings you back', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1.2);
    sim.tick();
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);

    // the exit portal sits 6yd behind the entry point — walk into it
    const exit = [...sim.entities.values()].find((e) => e.templateId === 'dungeon_exit')!;
    p.pos.x = exit.pos.x;
    p.pos.z = exit.pos.z + 1.2;
    p.facing = Math.PI;
    sim.tick();
    expect(p.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(dist2d(p.pos, { x: CRYPT_DOOR_POS.x, y: 0, z: CRYPT_DOOR_POS.z }) < 8).toBe(true);
  });

  it('party members who walk in share one instance', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.partyOf(a)?.members).toContain(b);

    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, a);
    sim.tick();
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, b);
    sim.tick();

    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect(ea.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(eb.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const slotA = sim.instanceSlotAt(ea.pos);
    const slotB = sim.instanceSlotAt(eb.pos);
    expect(slotA).not.toBeNull();
    expect(slotA).toBe(slotB);
  });

  it('solo players from different groups get different instances', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, a);
    sim.tick();
    teleportTo(sim, CRYPT_DOOR_POS.x, CRYPT_DOOR_POS.z - 1, b);
    sim.tick();
    const slotA = sim.instanceSlotAt(sim.entities.get(a)!.pos);
    const slotB = sim.instanceSlotAt(sim.entities.get(b)!.pos);
    expect(slotA).not.toBeNull();
    expect(slotB).not.toBeNull();
    expect(slotA).not.toBe(slotB);
  });
});

describe('dungeon instance placement and targetability', () => {
  it('places every dungeon entry and mob spawn on unblocked instance ground', () => {
    for (const dungeon of DUNGEON_LIST) {
      const sim = makeSim();
      sim.enterDungeon(dungeon.id);
      const p = sim.player;
      expect(p.pos.x, `${dungeon.id} entry is not inside an instance`).toBeGreaterThan(DUNGEON_X_THRESHOLD);
      expect(isBlocked(SEED, p.pos.x, p.pos.z, 0.5), `${dungeon.id} entry spawned in geometry`).toBe(false);

      const mobs = [...sim.entities.values()].filter((e) => e.kind === 'mob' && e.spawnPos.x > DUNGEON_X_THRESHOLD);
      expect(mobs.length, `${dungeon.id} spawned no instance mobs`).toBeGreaterThan(0);
      for (const mob of mobs) {
        expect(mob.hostile, `${dungeon.id} ${mob.name} is not hostile`).toBe(true);
        expect(sim.isHostileTo(sim.player, mob), `${dungeon.id} ${mob.name} is not targetable`).toBe(true);
        expect(isBlocked(SEED, mob.pos.x, mob.pos.z, 0.5), `${dungeon.id} ${mob.name} spawned in geometry`).toBe(false);
      }
    }
  });
});

describe('boss loot and encounter resets', () => {
  it('boss roll groups drop at most one item from each exclusive table', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    for (const [bossId, groupId, exactlyOne] of [
      ['morthen', 'morthen_guaranteed_uncommon', true],
      ['morthen', 'morthen_bonus', false],
      ['knight_commander_olen', 'olen_guaranteed_uncommon', true],
      ['knight_commander_olen', 'olen_bonus', false],
      ['vael_the_mistcaller', 'vael_guaranteed_uncommon', true],
      ['vael_the_mistcaller', 'vael_bonus', false],
      ['korgath_the_bound', 'korgath_guaranteed_uncommon', true],
      ['korgath_the_bound', 'korgath_bonus', false],
      ['grand_necromancer_velkhar', 'velkhar_guaranteed_uncommon', true],
      ['grand_necromancer_velkhar', 'velkhar_bonus', false],
      ['korzul_the_gravewyrm', 'korzul_guaranteed_uncommon', true],
      ['korzul_the_gravewyrm', 'korzul_bonus', false],
    ] as const) {
      const template = MOBS[bossId];
      const groupItems = template.loot.filter((l) => l.rollGroup === groupId).map((l) => l.itemId!);
      expect(groupItems.length).toBeGreaterThan(0);
      const mob = createMob(900000, template, 20, { x: 0, y: 0, z: 0 });
      // accessor defeats TS narrowing (mob.loot is assigned null in the loop)
      const lootOf = (m: Entity) => m.loot;
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        mob.loot = null;
        (sim as any).rollLoot(mob, meta);
        const dropped = (lootOf(mob)?.items ?? []).filter((s) => groupItems.includes(s.itemId));
        if (exactlyOne) {
          expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeGreaterThanOrEqual(1);
          expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeLessThanOrEqual(2);
        }
        else expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeLessThanOrEqual(1);
        if (dropped[0]) seen.add(dropped[0].itemId);
      }
      if (exactlyOne) expect([...seen].sort()).toEqual([...groupItems].sort()); // all three reachable
    }
  });

  it('dungeon bosses always drop gear but cap bonus quality drops', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    const lootOf = (m: Entity) => m.loot;
    for (const bossId of [
      'morthen',
      'knight_commander_olen',
      'vael_the_mistcaller',
      'korgath_the_bound',
      'grand_necromancer_velkhar',
      'korzul_the_gravewyrm',
    ]) {
      const template = MOBS[bossId];
      const mob = createMob(900010, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 300; i++) {
        mob.loot = null;
        (sim as any).rollLoot(mob, meta);
        const gear = (lootOf(mob)?.items ?? []).filter((s) => {
          const q = ITEMS[s.itemId]?.quality;
          return q === 'uncommon' || q === 'rare' || q === 'epic';
        });
        const uncommon = gear.filter((s) => ITEMS[s.itemId]?.quality === 'uncommon');
        const premium = gear.filter((s) => {
          const q = ITEMS[s.itemId]?.quality;
          return q === 'rare' || q === 'epic';
        });
        expect(gear.length, bossId).toBeGreaterThanOrEqual(1);
        expect(gear.length, bossId).toBeLessThanOrEqual(2);
        expect(uncommon.length, bossId).toBeGreaterThanOrEqual(1);
        expect(uncommon.length, bossId).toBeLessThanOrEqual(2);
        expect(premium.length, bossId).toBeLessThanOrEqual(1);
      }
    }
  });

  it('uncommon and better corpse drops are rolled among nearby party members', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990100, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    const total =
      sim.countItem('greyjaw_hide_boots', a) +
      sim.countItem('greyjaw_hide_boots', b);
    expect(total).toBe(1);
    expect(sim.events.some((e) => e.type === 'loot' && e.text.includes('wins Greyjaw Hide Boots'))).toBe(true);
    expect(mob.loot).toBeNull();
  });

  it('quest drops stay on the corpse as personal loot for every eligible nearby party member', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    for (const pid of [a, b]) {
      sim.meta(pid)!.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
    }
    const mob = createMob(990101, MOBS.wild_boar, 3, { x: 20, y: 0, z: 22 });
    const boarHide = MOBS.wild_boar.loot.find((entry) => entry.itemId === 'boar_hide')!;
    const oldChance = boarHide.chance;
    boarHide.chance = 1;
    try {
      (sim as any).rollLoot(mob, sim.meta(a)!, [sim.meta(a)!, sim.meta(b)!]);
    } finally {
      boarHide.chance = oldChance;
    }

    expect(sim.countItem('boar_hide', a)).toBe(0);
    expect(sim.countItem('boar_hide', b)).toBe(0);
    expect(mob.loot?.items).toContainEqual({ itemId: 'boar_hide', count: 1, personalFor: [a, b] });

    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    sim.entities.set(mob.id, mob);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);

    sim.lootCorpse(mob.id, a);
    expect(sim.countItem('boar_hide', a)).toBe(1);
    expect(sim.countItem('boar_hide', b)).toBe(0);
    expect(mob.lootable).toBe(true);
    expect(mob.loot?.items).toContainEqual({ itemId: 'boar_hide', count: 1, personalFor: [b] });

    sim.lootCorpse(mob.id, b);
    expect(sim.countItem('boar_hide', b)).toBe(1);
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(false);
  });

  it('boss adds despawn on encounter reset instead of stacking across pulls', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 45, 515 - 1.2); // walk into the Sunken Bastion door
    sim.tick();
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const vael = [...sim.entities.values()].find((e) => e.templateId === 'vael_the_mistcaller')!;
    const thralls = () => [...sim.entities.values()].filter((e) => e.templateId === 'drowned_thrall').length;
    // pull to 50%: the 60% summon threshold fires one wave of 2 thralls
    vael.inCombat = true;
    vael.hp = Math.floor(vael.maxHp * 0.5);
    const events = sim.tick();
    expect(thralls()).toBe(2);
    // the "calls for aid!" log is anchored to the boss so it routes by radius
    const aid = events.find((e) => e.type === 'log' && e.text.includes('calls for aid'));
    expect(aid && 'entityId' in aid ? aid.entityId : undefined).toBe(vael.id);
    // wipe-style reset: boss evades home -> wave despawns, thresholds re-arm
    vael.aiState = 'evade';
    vael.aggroTargetId = null;
    vael.pos = { ...vael.spawnPos };
    sim.tick();
    expect(vael.aiState).toBe('idle');
    expect(vael.firedSummons).toBe(0);
    expect(thralls()).toBe(0);
  });

  it('leaveDungeon outdoors is a no-op (no crypt-door fallback teleport)', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 0, -40);
    sim.leaveDungeon();
    expect(p.pos.x).toBe(0);
    expect(p.pos.z).toBe(-40);
  });

  it('selling requires a vendor within interact range', () => {
    const sim = makeSim();
    sim.addItem('wolf_fang', 1);
    teleportTo(sim, 0, -40); // open road, far from every vendor
    const copperBefore = sim.copper;
    sim.sellItem('wolf_fang');
    expect(sim.countItem('wolf_fang')).toBe(1);
    expect(sim.copper).toBe(copperBefore);
  });
});

describe('quest npc roles', () => {
  it('every quest is listed in the questIds of its giver and turn-in NPCs', () => {
    // the gossip dialog and markers filter by role, so a quest whose giver
    // does not list it would be unobtainable
    for (const quest of Object.values(QUESTS)) {
      expect(NPCS[quest.giverNpcId]?.questIds, `${quest.id} giver ${quest.giverNpcId}`).toContain(quest.id);
      expect(NPCS[quest.turnInNpcId]?.questIds, `${quest.id} turn-in ${quest.turnInNpcId}`).toContain(quest.id);
    }
  });

  it('interacting with the turn-in NPC does not auto-accept an available quest', () => {
    const sim = makeSim();
    (sim as any).grantXp(99999); // well past minLevel 6 for q_fenbridge_muster
    expect(sim.questState('q_fenbridge_muster')).toBe('available');
    const warden = [...sim.entities.values()].find((e) => e.templateId === 'warden_fenwick')!;
    teleportTo(sim, warden.pos.x + 2, warden.pos.z);
    sim.talkToNpc(warden.id);
    expect(sim.questState('q_fenbridge_muster')).toBe('available');
    const aldric = [...sim.entities.values()].find((e) => e.templateId === 'brother_aldric')!;
    teleportTo(sim, aldric.pos.x + 2, aldric.pos.z);
    // talkToNpc accepts one available quest per interaction and aldric
    // offers several — keep talking until the muster order is taken
    for (let i = 0; i < 10 && sim.questState('q_fenbridge_muster') !== 'active'; i++) sim.talkToNpc(aldric.id);
    expect(sim.questState('q_fenbridge_muster')).toBe('active');
  });

  it('cleanses hostile control auras from quest NPCs', () => {
    const sim = makeSim('mage');
    const redbrook = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook')!;
    redbrook.auras.push({
      id: 'polymorph', name: 'Polymorph', kind: 'polymorph',
      remaining: 15, duration: 15, value: 0, tickInterval: 1, tickTimer: 1,
      sourceId: sim.playerId, school: 'arcane', breaksOnDamage: true,
    });

    const events = sim.tick();

    expect(redbrook.auras.some((a) => a.kind === 'polymorph')).toBe(false);
    expect(events).toContainEqual({ type: 'aura', targetId: redbrook.id, name: 'Polymorph', gained: false });
  });
});

describe('warrior charge', () => {
  function chargeSetup() {
    const sim = makeSim();
    (sim as any).grantXp(99999); // learn charge (level 4)
    const p = sim.player;
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead)!;
    teleportTo(sim, wolf.pos.x - 18, wolf.pos.z);
    p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
    sim.targetEntity(wolf.id);
    return { sim, p, wolf };
  }

  it('stuns the target immediately and does not teleport', () => {
    const { sim, p, wolf } = chargeSetup();
    const before = dist2d(p.pos, wolf.pos);
    sim.castAbility('charge');
    expect(wolf.auras.some((a) => a.kind === 'stun')).toBe(true);
    // still roughly where we started — the run happens over the next ticks
    expect(dist2d(p.pos, wolf.pos)).toBeGreaterThan(before - 2);
    expect(p.chargeTargetId).toBe(wolf.id);
  });

  it('runs to melee range at roughly 3x speed and starts attacking', () => {
    const { sim, p, wolf } = chargeSetup();
    sim.castAbility('charge');
    const start = { ...p.pos };
    // 10 ticks = 0.5s; at 21 yd/s a clear run covers ~10.5yd, far beyond
    // the 3.5yd a normal run would manage
    for (let i = 0; i < 10; i++) sim.tick();
    expect(dist2d(start, p.pos)).toBeGreaterThan(7);
    for (let i = 0; i < 50 && p.chargeTargetId !== null; i++) sim.tick();
    expect(p.chargeTargetId).toBe(null);
    expect(dist2d(p.pos, wolf.pos)).toBeLessThanOrEqual(5);
    expect(p.autoAttack).toBe(true);
  });

  it('gives up cleanly when the target dies mid-charge', () => {
    const { sim, p, wolf } = chargeSetup();
    sim.castAbility('charge');
    sim.tick();
    wolf.dead = true;
    sim.tick();
    expect(p.chargeTargetId).toBe(null);
  });
});

describe('ranged auto-attack crit suppression', () => {
  // The crit chance a swing rolls against is the second rng.chance() call in
  // both meleeSwing and rangedSwing (the first is the miss roll). Capture the
  // args and return false so no miss/crit branches fire and perturb state.
  function critChanceRolled(sim: Sim, swing: () => void): number {
    const calls: number[] = [];
    (sim as any).rng.chance = (p: number) => { calls.push(p); return false; };
    swing();
    return calls[1];
  }

  function setup(level: number, targetLevel: number) {
    const sim = new Sim({ seed: SEED, playerClass: 'hunter' });
    const hunter = sim.player;
    if (level > 1) sim.setPlayerLevel(level);
    hunter.critChance = 0.5;
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob')!;
    wolf.level = targetLevel;
    const ranged = CLASSES.hunter.ranged!;
    return { sim, hunter, wolf, ranged };
  }

  it('suppresses crit against a higher-level target, matching melee', () => {
    const { sim, hunter, wolf, ranged } = setup(10, 13); // +3 levels
    const rolled = critChanceRolled(sim, () => (sim as any).rangedSwing(hunter, wolf, ranged));
    // 0.5 base - 3 * 0.002 suppression = 0.494 (was a flat 0.5 before the fix)
    expect(rolled).toBeCloseTo(0.5 - 3 * 0.002, 5);
  });

  it('does not suppress crit against an equal-or-lower-level target', () => {
    const { sim, hunter, wolf, ranged } = setup(10, 8); // lower level
    const rolled = critChanceRolled(sim, () => (sim as any).rangedSwing(hunter, wolf, ranged));
    expect(rolled).toBeCloseTo(0.5, 5);
  });
});

describe('spell visuals', () => {
  it('hostile casts emit projectile spellfx events', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    const wolf = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.templateId === 'forest_wolf')!;
    teleportTo(sim, wolf.pos.x - 10, wolf.pos.z);
    p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
    sim.targetEntity(wolf.id);
    sim.castAbility('fireball');
    const events = [];
    for (let i = 0; i < 60; i++) events.push(...sim.tick());
    const fx = events.filter((e) => e.type === 'spellfx');
    expect(fx.some((e) => e.type === 'spellfx' && e.fx === 'projectile' && e.school === 'fire')).toBe(true);
  });
});
