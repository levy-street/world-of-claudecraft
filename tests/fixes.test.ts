import { describe, expect, it } from 'vitest';
import {
  cameraOcclusion,
  isBlocked,
  lineOfSightClear,
  resolvePosition,
} from '../src/sim/colliders';
import {
  CLASSES,
  CRYPT_DOOR_POS,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  dungeonAt,
  ITEMS,
  instanceOrigin,
  LAKE,
  MOBS,
  NPCS,
  PROPS,
  QUESTS,
  zoneAt,
  zoneWelcomeText,
} from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { ACTIONS, encodeObs } from '../src/sim/obs';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent } from '../src/sim/types';
import { generateDecorations, groundHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;

function makeSim(cls: 'warrior' | 'mage' | 'hunter' = 'warrior') {
  return new Sim({ seed: SEED, playerClass: cls });
}

function teleportTo(sim: Sim, x: number, z: number, pid?: number) {
  const p = sim.entities.get(pid ?? sim.playerId)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function placeEntity(sim: Sim, e: Entity, x: number, z: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.spawnPos = { ...e.pos };
}

function faceTarget(actor: Entity, target: Entity) {
  actor.facing = Math.atan2(target.pos.x - actor.pos.x, target.pos.z - actor.pos.z);
}

function formRaid(sim: Sim) {
  while ((sim.partyOf(sim.playerId)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    sim.partyInvite(pid);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid();
}

describe('quest lifecycle', () => {
  it('stops showing the Redbrook starter hint after the first quest is accepted', () => {
    const sim = makeSim();
    const starterZone = zoneAt(sim.player.pos.z);

    expect(zoneWelcomeText(starterZone, (questId) => sim.questState(questId))).toBe(
      'Find Marshal Redbrook in town — he has work for you.',
    );

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
      expect(groundHeight(e.pos.x, e.pos.z, SEED), `${e.name} underwater`).toBeGreaterThan(
        WATER_LEVEL + 0.5,
      );
      expect(isBlocked(SEED, e.pos.x, e.pos.z, 0.4), `${e.name} inside a prop`).toBe(false);
    }
  });

  it('mobs spawn out of deep water (murlocs may wade)', () => {
    const sim = makeSim();
    for (const e of sim.entities.values()) {
      if (e.kind !== 'mob') continue;
      const h = groundHeight(e.pos.x, e.pos.z, SEED);
      const canWade = MOBS[e.templateId].family === 'mudfin' || MOBS[e.templateId].canSwim;
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

  it('keeps the Fenbridge south approach clear of generated rock blockers', () => {
    expect(isBlocked(SEED, 2, 212, 0.5)).toBe(false);
  });

  it('camera ghosts through village buildings (hidden instead of pulling in)', () => {
    const groundY = groundHeight(10, 4, SEED);
    const eyeY = groundY + 2;

    // ray sweeps straight through the house at (10,12): buildings are camGhost,
    // so the chase cam no longer pulls in for them — the renderer hides them.
    const through = cameraOcclusion(SEED, 10, eyeY, 4, 10, eyeY + 1.5, 20, 0.35);
    expect(through).toBe(1);
    // but movement still collides with that same house (camGhost is camera-only)
    const blocked = resolvePosition(SEED, 10, 12, 0.5);
    expect(Math.abs(blocked.x - 10) + Math.abs(blocked.z - 12)).toBeGreaterThan(0.5);

    const clear = cameraOcclusion(SEED, 0, eyeY, -40, 0, eyeY + 1.5, -48, 0.35);
    expect(clear).toBe(1);

    const overhead = cameraOcclusion(SEED, 10, eyeY, 4, 10, eyeY + 24, 20, 0.35);
    expect(overhead).toBe(1);
  });

  it('camera ghosts through campfires while movement still collides', () => {
    const groundY = groundHeight(3, -4, SEED);

    const eyeHeightRay = cameraOcclusion(SEED, 3, groundY + 2.0, -12, 3, groundY + 2.2, 4, 0.35);
    expect(eyeHeightRay).toBe(1);

    const lowRay = cameraOcclusion(SEED, 3, groundY + 0.8, -12, 3, groundY + 0.9, 4, 0.35);
    expect(lowRay).toBe(1);

    const blocked = resolvePosition(SEED, 3, -4, 0.5);
    expect(Math.abs(blocked.x - 3) + Math.abs(blocked.z + 4)).toBeGreaterThan(0.5);
  });

  it('camera ghosts through trees while movement still collides', () => {
    const tree = generateDecorations(SEED).find((d) => d.kind !== 'rock')!;
    const groundY = groundHeight(tree.x, tree.z, SEED);

    const through = cameraOcclusion(
      SEED,
      tree.x,
      groundY + 1.0,
      tree.z - 8,
      tree.x,
      groundY + 1.2,
      tree.z + 8,
      0.35,
    );
    expect(through).toBe(1);

    const blocked = resolvePosition(SEED, tree.x, tree.z, 0.5);
    expect(Math.abs(blocked.x - tree.x) + Math.abs(blocked.z - tree.z)).toBeGreaterThan(0.5);
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

  it('ordinary mobs chase into deep water and keep dealing melee damage', () => {
    const sim = makeSim();
    const wolf = [...sim.entities.values()].find((e) => e.templateId === 'forest_wolf')!;
    // park a chase target in the middle of the lake
    const p = sim.player;
    teleportTo(sim, LAKE.x, LAKE.z);
    wolf.aiState = 'chase';
    wolf.aggroTargetId = p.id;
    wolf.pos = { ...sim.groundPos(LAKE.x + 24, LAKE.z + 24) };
    wolf.spawnPos = { ...wolf.pos };
    wolf.prevPos = { ...wolf.pos };
    const hpBefore = p.hp;
    for (let i = 0; i < 160; i++) sim.tick();
    expect(groundHeight(wolf.pos.x, wolf.pos.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    expect(wolf.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
    expect(p.hp).toBeLessThan(hpBefore);
  });

  it('rare swimmers can chase into deep water', () => {
    const sim = makeSim();
    const rare = createMob(
      990001,
      MOBS.mirejaw_the_ravenous,
      10,
      sim.groundPos(LAKE.x + 24, LAKE.z + 24),
    );
    for (let i = 0; i < 120; i++) {
      (sim as any).moveToward(rare, { x: LAKE.x, y: 0, z: LAKE.z }, rare.moveSpeed);
    }
    expect(groundHeight(rare.pos.x, rare.pos.z, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    expect(rare.pos.y).toBeGreaterThan(WATER_LEVEL - 1.0);
  });
});

describe('rare spawn rules', () => {
  it('rare spawns are elite, control immune, swimmers with configured respawns', () => {
    for (const id of [
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
      if (id === 'mirejaw_the_ravenous' || id === 'sister_nhalia')
        expect(MOBS[id].respawnMult).toBe(648);
      // Ironvein Foreman + Marrowlord Varkas rise hourly (144 * 25s base) so
      // their epic T1 boots/legs are farmable on a predictable cadence.
      else expect(MOBS[id].respawnMult).toBe(144);
    }
    expect(MOBS.mogger).toMatchObject({
      rare: true,
      elite: true,
      canSwim: true,
      ccImmune: true,
      respawnMult: 4,
    });
  });

  it('control auras do not stick to control-immune rares', () => {
    const sim = makeSim();
    const rare = createMob(990002, MOBS.mirejaw_the_ravenous, 10, { x: 0, y: 0, z: 0 });

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
    const rare = createMob(990003, MOBS.mirejaw_the_ravenous, 10, { x: 0, y: 0, z: 0 });
    (sim as any).handleDeath(rare, null);
    expect(rare.respawnTimer).toBe(1296);
  });

  it('quest-related named rares respawn after 3 minutes', () => {
    const ids = ['old_cragmaw'] as const;
    for (const id of ids) {
      const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
      const mob = createMob(990004, MOBS[id], MOBS[id].maxLevel, { x: 0, y: 0, z: 0 });
      (sim as any).handleDeath(mob, null);
      expect(mob.respawnTimer, id).toBe(180);
    }
  });

  it('Mogger respawns on a quest-boss timer instead of a long rare-spawn timer', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', respawnSeconds: 2 });
    const mogger = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'mogger',
    )!;

    (sim as any).handleDeath(mogger, null);

    expect(mogger.respawnTimer).toBe(8);
  });

  it('outdoor rare spawns have 3-player mechanics and no-loot summoned helpers', () => {
    const rareIds = [
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

    expect(MOBS.mogger.summonAdds).toEqual({ mobId: 'mogger_lackey', count: 2, atHpPct: [0.7] });
    expect(MOBS.mogger.enrage).toEqual({ belowHpPct: 0.3, dmgMult: 1.6, hasteMult: 1.3 });
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
    const infoA = sim.instanceInfoAt(ea.pos);
    const infoB = sim.instanceInfoAt(eb.pos);
    expect(slotA).not.toBeNull();
    expect(slotA).toBe(slotB);
    expect(infoA).toEqual({ slot: slotA, dungeonId: 'hollow_crypt' });
    expect(infoB).toEqual(infoA);
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
      if (dungeon.id === 'nythraxis_boss_arena') {
        sim.players.get(sim.playerId)?.questsDone.add('q_nythraxis_bound_guardian');
        formRaid(sim);
      }
      sim.enterDungeon(dungeon.id);
      const p = sim.player;
      expect(p.pos.x, `${dungeon.id} entry is not inside an instance`).toBeGreaterThan(
        DUNGEON_X_THRESHOLD,
      );
      expect(
        isBlocked(SEED, p.pos.x, p.pos.z, 0.5),
        `${dungeon.id} entry spawned in geometry`,
      ).toBe(false);

      const mobs = [...sim.entities.values()].filter(
        (e) => e.kind === 'mob' && e.spawnPos.x > DUNGEON_X_THRESHOLD,
      );
      const objects = [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'object' &&
          (e.objectItemId || e.templateId === 'dungeon_door') &&
          e.pos.x > DUNGEON_X_THRESHOLD,
      );
      expect(
        mobs.length + objects.length,
        `${dungeon.id} spawned no instance encounters`,
      ).toBeGreaterThan(0);
      for (const mob of mobs) {
        expect(mob.hostile, `${dungeon.id} ${mob.name} is not hostile`).toBe(true);
        expect(
          sim.isHostileTo(sim.player, mob),
          `${dungeon.id} ${mob.name} is not targetable`,
        ).toBe(true);
        expect(
          isBlocked(SEED, mob.pos.x, mob.pos.z, 0.5),
          `${dungeon.id} ${mob.name} spawned in geometry`,
        ).toBe(false);
      }
      for (const obj of objects) {
        expect(obj.lootable, `${dungeon.id} ${obj.name} is not interactable`).toBe(true);
        expect(
          isBlocked(SEED, obj.pos.x, obj.pos.z, 0.5),
          `${dungeon.id} ${obj.name} spawned in geometry`,
        ).toBe(false);
      }
    }
  });
});

describe('mob stat scaling', () => {
  it('scales armor from level 1 like hp and damage, not one level ahead', () => {
    const template = MOBS.gray_wolf ?? Object.values(MOBS)[0];
    const lvl1 = createMob(910001, template, 1, { x: 0, y: 0, z: 0 });
    const lvl10 = createMob(910010, template, 10, { x: 0, y: 0, z: 0 });
    // A level-1 mob has no level-scaled armor (no armorBase in the template).
    expect(lvl1.stats.armor).toBe(0);
    // Each level adds exactly armorPerLevel, matching the (level - 1) convention.
    expect(lvl10.stats.armor).toBe(Math.round(template.armorPerLevel * 9));
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
        } else expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeLessThanOrEqual(1);
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

  it('fair-splits corpse copper among nearby party members, including the in-range fallen', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('rogue', 'Cyra');
    const d = sim.addPlayer('priest', 'Dara');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    sim.partyInvite(d, a);
    sim.partyAccept(d);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    teleportTo(sim, 20, 21, c);
    teleportTo(sim, 160, 160, d);
    // Cyra was downed during the fight; her corpse is still on the mob. Classic
    // group rules keep a fallen-but-in-range member in the split (the old bug
    // erased her share for dying). Only Dara, who is far away, is excluded.
    sim.entities.get(c)!.dead = true;
    const mob = createMob(990099, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 12, items: [] };
    sim.entities.set(mob.id, mob);

    sim.lootCorpse(mob.id, b);

    const gains = [a, b, c, d].map((pid) => sim.meta(pid)?.copper ?? 0);
    expect(gains[0] + gains[1] + gains[2]).toBe(12); // a, b, and the fallen c share it
    expect(gains[0]).toBeGreaterThan(0);
    expect(gains[1]).toBeGreaterThan(0);
    expect(gains[2]).toBeGreaterThan(0);
    expect(gains[3]).toBe(0); // Dara is out of range
    expect(mob.loot).toBeNull();
  });

  it('poor and common corpse drops are awarded directly (round-robin) without need-greed rolls', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990098, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = {
      copper: 0,
      items: [
        { itemId: 'wolf_fang', count: 1 },
        { itemId: 'raw_mirror_trout', count: 1 },
      ],
    };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    // Both drops are auto-awarded (no roll), but the default common-item
    // strategy is round-robin, not looter-takes-all: the cursor advances once
    // per item, so the two drops spread across the party rather than both
    // landing on the looter.
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(sim.countItem('raw_mirror_trout', b)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
    expect(sim.countItem('raw_mirror_trout', a)).toBe(0);
    const prompts = sim.events.filter((e) => e.type === 'lootRoll');
    expect(prompts).toHaveLength(0);
    expect(mob.loot).toBeNull();
  });

  it('uncommon and better corpse drops open need-greed rolls among nearby party members', () => {
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

    expect(sim.countItem('greyjaw_hide_boots', a) + sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    const prompts = sim.events.filter((e) => e.type === 'lootRoll');
    expect(prompts).toHaveLength(2);
    expect(prompts.every((e) => e.itemId === 'greyjaw_hide_boots')).toBe(true);
    expect(mob.loot).toBeNull();
  });

  it('opens a need-greed roll instead of auto-awarding grouped item drops', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990102, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    const prompts = sim.events.filter((e) => e.type === 'lootRoll');
    expect(prompts).toHaveLength(2);
    expect(prompts.every((e) => e.itemId === 'greyjaw_hide_boots')).toBe(true);
    expect(mob.loot).toBeNull();
  });

  it('awards need over greed regardless of the greed roll number', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990103, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    const rng = (sim as any).rng;
    const realInt = rng.int.bind(rng);
    const rolls = [1, 100];
    rng.int = (min: number, max: number) =>
      min === 1 && max === 100 ? rolls.shift()! : realInt(min, max);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'need', a);
    sim.submitLootRoll(rollId, 'greed', b);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(1);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(
      sim.events.some((e) => e.type === 'loot' && e.text.includes('wins [[i:greyjaw_hide_boots]]')),
    ).toBe(true);
  });

  it('excludes players who pass on a need-greed roll', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990104, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'greed', b);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(1);
  });

  it('treats unanswered need-greed rolls as pass at timeout', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990105, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const events: SimEvent[] = [];
    for (let i = 0; i < 61 * 20; i++) events.push(...sim.tick());

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(
      events.some(
        (e) => e.type === 'loot' && e.text === 'Everyone passed on [[i:greyjaw_hide_boots]].',
      ),
    ).toBe(true);
  });

  it('returns all-passed need-greed loot to the corpse as open loot', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990106, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'pass', b);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(mob.lootable).toBe(true);
    expect(mob.loot?.items).toEqual([{ itemId: 'greyjaw_hide_boots', count: 1, openToAll: true }]);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, b);

    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(1);
    expect(mob.loot).toBeNull();
    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(false);
  });

  it('lets any player loot an all-passed need-greed item without starting another roll', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('rogue', 'Cyra');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    teleportTo(sim, 22, 20, c);
    const mob = createMob(990107, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'lootRoll')?.rollId;
    if (rollId === undefined) throw new Error('expected loot roll');
    sim.submitLootRoll(rollId, 'pass', a);
    sim.submitLootRoll(rollId, 'pass', b);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, c);

    expect(sim.countItem('greyjaw_hide_boots', c)).toBe(1);
    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
    expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
    expect(sim.events.some((e) => e.type === 'error' && e.text.includes('permission'))).toBe(false);
    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(false);
  });

  it('returns timed-out need-greed loot to the corpse for whoever loots next', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    teleportTo(sim, 20, 20, a);
    teleportTo(sim, 21, 20, b);
    const mob = createMob(990108, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
    sim.entities.set(mob.id, mob);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    for (let i = 0; i < 61 * 20; i++) sim.tick();

    expect(mob.loot?.items).toEqual([{ itemId: 'greyjaw_hide_boots', count: 1, openToAll: true }]);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.countItem('greyjaw_hide_boots', a)).toBe(1);
    expect(mob.loot).toBeNull();
    expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(false);
  });

  it('quest drops stay on the corpse as personal loot for every eligible nearby party member', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    for (const pid of [a, b]) {
      sim.meta(pid)?.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
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
    if (mob.loot) {
      mob.loot.copper = 0;
      mob.loot.items = mob.loot.items.filter((item) => item.itemId === 'boar_hide');
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

    sim.partyLeave(b);
    sim.lootCorpse(mob.id, b);
    expect(sim.countItem('boar_hide', b)).toBe(1);
    expect(mob.loot).toBeNull();
    expect(mob.lootable).toBe(false);
  });

  it('personal loot remains claimable after party rights are gone without granting shared loot', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    const mob = createMob(990103, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = a;
    mob.loot = {
      copper: 88,
      items: [
        { itemId: 'boar_hide', count: 1, personalFor: [b] },
        { itemId: 'wolf_fang', count: 1 },
      ],
    };
    sim.entities.set(mob.id, mob);
    teleportTo(sim, 20, 20, b);

    const beforeCopper = sim.meta(b)?.copper;
    sim.lootCorpse(mob.id, b);

    expect(sim.countItem('boar_hide', b)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
    expect(sim.meta(b)?.copper).toBe(beforeCopper);
    expect(mob.loot?.copper).toBe(88);
    expect(mob.loot?.items).toContainEqual({ itemId: 'wolf_fang', count: 1 });
  });

  it('does not drop a quest-gated item whose quest has no matching collect objective', () => {
    const sim = makeSim();
    const a = sim.playerId;
    // q_boars only collects boar_hide; it has no collect objective for greyjaw_fang.
    sim.meta(a)?.questLog.set('q_boars', { questId: 'q_boars', counts: [0], state: 'active' });
    const mob = createMob(990102, MOBS.wild_boar, 3, { x: 20, y: 0, z: 22 });
    // Inject a (mis)configured drop gated on q_boars but for an item the quest
    // does not collect. It must never drop, even at chance 1.
    const bogus = { itemId: 'greyjaw_fang', chance: 1, questId: 'q_boars' };
    MOBS.wild_boar.loot.push(bogus as any);
    try {
      (sim as any).rollLoot(mob, sim.meta(a)!, [sim.meta(a)!]);
    } finally {
      MOBS.wild_boar.loot.pop();
    }
    const dropped = (mob.loot?.items ?? []).some((slot) => slot.itemId === 'greyjaw_fang');
    expect(dropped).toBe(false);
  });

  it('boss adds despawn on encounter reset instead of stacking across pulls', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 45, 515 - 1.2); // walk into the Sunken Bastion door
    sim.tick();
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const vael = [...sim.entities.values()].find((e) => e.templateId === 'vael_the_mistcaller')!;
    const thralls = () =>
      [...sim.entities.values()].filter((e) => e.templateId === 'drowned_thrall').length;
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
      expect(NPCS[quest.giverNpcId]?.questIds, `${quest.id} giver ${quest.giverNpcId}`).toContain(
        quest.id,
      );
      expect(
        NPCS[quest.turnInNpcId]?.questIds,
        `${quest.id} turn-in ${quest.turnInNpcId}`,
      ).toContain(quest.id);
    }
  });

  it('offers the Nythraxis attunement only from the Highwatch Aldric', () => {
    expect(QUESTS.q_nythraxis_restless_dead.name).not.toBe('The Restless Dead');
    expect(NPCS.brother_aldric.questIds).not.toContain('q_nythraxis_restless_dead');
    expect(NPCS.brother_aldric_fen.questIds).not.toContain('q_nythraxis_restless_dead');
    expect(NPCS.brother_aldric_highwatch.questIds).toContain('q_nythraxis_restless_dead');
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
    for (let i = 0; i < 10 && sim.questState('q_fenbridge_muster') !== 'active'; i++)
      sim.talkToNpc(aldric.id);
    expect(sim.questState('q_fenbridge_muster')).toBe('active');
  });

  it('ends the Nythraxis attunement on the Bound Guardian quest', () => {
    const quest = QUESTS.q_nythraxis_bound_guardian;

    expect(NPCS.brother_aldric_highwatch.questIds).toContain(quest.id);
    expect(NPCS.brother_aldric_highwatch.questIds).not.toContain('q_nythraxis_deathless_king');
    expect(quest.itemRewards.warrior).toBe('kings_signet');
    expect(QUESTS).not.toHaveProperty('q_nythraxis_deathless_king');
  });

  it('restores the Crypt Keystone when reaccepting the Bound Guardian quest', () => {
    const sim = makeSim();
    sim.player.level = 20;
    const aldric = [...sim.entities.values()].find(
      (e) => e.templateId === 'brother_aldric_highwatch',
    )!;
    teleportTo(sim, aldric.pos.x + 2, aldric.pos.z);
    sim.questLog.set('q_nythraxis_sealed_crypt', {
      questId: 'q_nythraxis_sealed_crypt',
      counts: [3, 1, 1],
      state: 'ready',
    });
    sim.turnInQuest('q_nythraxis_sealed_crypt');
    expect(sim.countItem('crypt_keystone')).toBe(1);

    sim.removeItem('crypt_keystone', 1);
    expect(sim.countItem('crypt_keystone')).toBe(0);
    sim.acceptQuest('q_nythraxis_bound_guardian');
    expect(sim.questState('q_nythraxis_bound_guardian')).toBe('active');
    expect(sim.countItem('crypt_keystone')).toBe(1);

    sim.removeItem('crypt_keystone', 1);
    sim.abandonQuest('q_nythraxis_bound_guardian');
    sim.acceptQuest('q_nythraxis_bound_guardian');
    expect(sim.countItem('crypt_keystone')).toBe(1);
  });

  it('gates the sealed crypt and grave visions behind Nythraxis quests', () => {
    const sim = makeSim();
    const crypt = DUNGEON_LIST.find((d) => d.id === 'nythraxis_crypt')!;
    const bossArena = DUNGEON_LIST.find((d) => d.id === 'nythraxis_boss_arena')!;

    sim.enterDungeon(crypt.id);
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const outerCryptPos = { ...sim.player.pos };
    sim.enterDungeon(bossArena.id);
    expect(dist2d(sim.player.pos, outerCryptPos)).toBeLessThan(0.1);

    sim.questLog.set('q_nythraxis_sealed_crypt', {
      questId: 'q_nythraxis_sealed_crypt',
      counts: [0, 0, 0],
      state: 'active',
    });
    formRaid(sim);
    sim.enterDungeon(bossArena.id);
    expect(dist2d(sim.player.pos, outerCryptPos)).toBeLessThan(0.1);

    sim.questLog.delete('q_nythraxis_sealed_crypt');
    sim.players.get(sim.playerId)?.questsDone.add('q_nythraxis_bound_guardian');
    formRaid(sim);
    sim.enterDungeon(bossArena.id);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('nythraxis_boss_arena');

    teleportTo(sim, 0, 660);
    const grave = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'grave_sir_aldren',
    )!;
    teleportTo(sim, grave.pos.x, grave.pos.z);
    sim.pickUpObject(grave.id);
    expect([...sim.entities.values()].some((e) => e.templateId === 'vision_aldren_warrior')).toBe(
      false,
    );

    sim.questLog.set('q_nythraxis_graves', {
      questId: 'q_nythraxis_graves',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.pickUpObject(grave.id);
    expect(sim.questLog.get('q_nythraxis_graves')?.counts[0]).toBe(1);
    const vision = [...sim.entities.values()].find((e) => e.templateId === 'vision_aldren_warrior');
    expect(vision && !vision.hostile).toBe(true);
    const logEvents = sim.events.filter((e) => e.type === 'log');
    expect(logEvents).toContainEqual(expect.objectContaining({ entityId: vision?.id }));
    expect(logEvents).toContainEqual(expect.objectContaining({ text: 'My king was a good man.' }));
    let delayedEvents: SimEvent[] = [];
    for (let i = 0; i < 101; i++) delayedEvents = sim.tick();
    expect(delayedEvents).toContainEqual(
      expect.objectContaining({ text: 'I swore my blade to him.', entityId: vision?.id }),
    );
    if (!vision) throw new Error('expected vision');
    sim.targetEntity(vision.id);
    sim.startAutoAttack();
    expect(sim.player.autoAttack).toBe(false);
    for (let i = 0; i < 440; i++) sim.tick();
    expect([...sim.entities.values()].some((e) => e.id === vision?.id)).toBe(false);
  });

  it('shares Nythraxis grave progress and dialogue with nearby party members', () => {
    const sim = makeSim();
    const allyPid = sim.addPlayer('mage', 'Ally');
    sim.partyInvite(allyPid);
    sim.partyAccept(allyPid);
    const grave = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'grave_sir_aldren',
    )!;
    teleportTo(sim, grave.pos.x, grave.pos.z);
    teleportTo(sim, grave.pos.x + 5, grave.pos.z, allyPid);
    sim.questLog.set('q_nythraxis_graves', {
      questId: 'q_nythraxis_graves',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.meta(allyPid)?.questLog.set('q_nythraxis_graves', {
      questId: 'q_nythraxis_graves',
      counts: [0, 0, 0],
      state: 'active',
    });

    sim.pickUpObject(grave.id);

    expect(sim.questLog.get('q_nythraxis_graves')?.counts[0]).toBe(1);
    expect(sim.meta(allyPid)?.questLog.get('q_nythraxis_graves')?.counts[0]).toBe(1);
    const vision = [...sim.entities.values()].find(
      (e) => e.templateId === 'vision_aldren_warrior',
    )!;
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'log', pid: sim.playerId, entityId: vision.id }),
    );
    expect(sim.events).toContainEqual(
      expect.objectContaining({ type: 'log', pid: allyPid, entityId: vision.id }),
    );
  });

  it('immediately aggros Nythraxis quest summons on the summoning player', () => {
    const sim = makeSim();
    const ritual = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'crypt_ritual_circle',
    )!;
    teleportTo(sim, ritual.pos.x, ritual.pos.z);
    sim.questLog.set('q_nythraxis_bound_guardian', {
      questId: 'q_nythraxis_bound_guardian',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.addItem('crypt_keystone', 1);

    sim.pickUpObject(ritual.id);

    const guardian = [...sim.entities.values()].find((e) => e.templateId === 'bound_guardian');
    expect(guardian).toBeTruthy();
    expect(guardian).toMatchObject({
      hostile: true,
      aiState: 'chase',
      aggroTargetId: sim.player.id,
    });

    sim.player.maxHp = 100000;
    sim.player.hp = sim.player.maxHp;
    guardian!.hp = Math.floor(guardian!.maxHp * 0.49);
    sim.tick();

    const boneguards = [...sim.entities.values()].filter(
      (e) => e.templateId === 'varkas_boneguard' && !e.dead,
    );
    expect(boneguards).toHaveLength(2);
    for (const boneguard of boneguards) {
      expect(boneguard.hostile).toBe(true);
      expect(['chase', 'attack']).toContain(boneguard.aiState);
      expect(boneguard.aggroTargetId).toBe(sim.player.id);
    }
  });

  it('despawns Varkas Boneguards after 60 seconds out of combat without damage and resets on damage taken', () => {
    const sim = makeSim();
    const boneguard = createMob(909900, MOBS.varkas_boneguard, 19, { x: 0, y: 0, z: 0 });
    boneguard.maxHp = 1000;
    boneguard.hp = 1000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(boneguard);
    teleportTo(sim, 0, -2);
    sim.player.maxHp = 100000;
    sim.player.hp = sim.player.maxHp;

    for (let i = 0; i < 59 * 20; i++) sim.tick();
    expect(sim.entities.has(boneguard.id)).toBe(true);

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
    ).dealDamage(sim.player, boneguard, 5, false, 'physical', 'Test Strike', 'hit', true);
    expect(boneguard.damageIdleDespawnTimer).toBe(60);

    boneguard.damageIdleDespawnTimer = 1;
    boneguard.inCombat = true;
    sim.tick();
    expect(sim.entities.has(boneguard.id)).toBe(true);
    expect(boneguard.damageIdleDespawnTimer).toBe(1);

    teleportTo(sim, 100, 100);
    boneguard.inCombat = false;
    boneguard.aiState = 'idle';
    boneguard.aggroTargetId = null;
    boneguard.damageIdleDespawnTimer = 60;
    for (let i = 0; i < 59 * 20; i++) sim.tick();
    expect(sim.entities.has(boneguard.id)).toBe(true);

    for (let i = 0; i < 2 * 20; i++) sim.tick();
    expect(sim.entities.has(boneguard.id)).toBe(false);
  });

  it('despawns the Bound Guardian after 60 seconds out of combat without damage and resets on damage taken', () => {
    const sim = makeSim();
    const ritual = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'crypt_ritual_circle',
    )!;
    teleportTo(sim, ritual.pos.x, ritual.pos.z);
    sim.questLog.set('q_nythraxis_bound_guardian', {
      questId: 'q_nythraxis_bound_guardian',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.addItem('crypt_keystone', 1);
    sim.player.maxHp = 100000;
    sim.player.hp = sim.player.maxHp;

    sim.pickUpObject(ritual.id);

    const guardian = [...sim.entities.values()].find((e) => e.templateId === 'bound_guardian')!;
    expect(guardian).toBeTruthy();

    guardian.damageIdleDespawnTimer = 1;
    sim.tick();
    expect(sim.entities.has(guardian.id)).toBe(true);
    expect(guardian.damageIdleDespawnTimer).toBe(1);

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
    ).dealDamage(sim.player, guardian, 5, false, 'physical', 'Test Strike', 'hit', true);
    expect(guardian.damageIdleDespawnTimer).toBe(60);

    teleportTo(sim, ritual.pos.x + 100, ritual.pos.z + 100);
    guardian.inCombat = false;
    guardian.aiState = 'idle';
    guardian.aggroTargetId = null;
    guardian.damageIdleDespawnTimer = 60;
    for (let i = 0; i < 59 * 20; i++) sim.tick();
    expect(sim.entities.has(guardian.id)).toBe(true);

    for (let i = 0; i < 2 * 20; i++) sim.tick();
    expect(sim.entities.has(guardian.id)).toBe(false);
  });

  it('re-summons the Bound Guardian at the ritual circle after the first one despawns unkilled', () => {
    const sim = makeSim();
    const ritual = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'crypt_ritual_circle',
    )!;
    teleportTo(sim, ritual.pos.x, ritual.pos.z);
    sim.questLog.set('q_nythraxis_bound_guardian', {
      questId: 'q_nythraxis_bound_guardian',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.addItem('crypt_keystone', 1);

    sim.pickUpObject(ritual.id);
    const first = [...sim.entities.values()].find((e) => e.templateId === 'bound_guardian')!;
    expect(first).toBeTruthy();
    // interact objective is one-shot; it should not block re-summoning the guardian
    expect(sim.questLog.get('q_nythraxis_bound_guardian')?.counts[0]).toBe(1);

    // the guardian leashes and idle-despawns without ever being killed
    first.inCombat = false;
    first.aiState = 'idle';
    first.aggroTargetId = null;
    first.damageIdleDespawnTimer = 0.05;
    sim.tick();
    expect(
      [...sim.entities.values()].some((e) => e.templateId === 'bound_guardian' && !e.dead),
    ).toBe(false);

    // re-using the ritual circle must summon a fresh guardian so the kill is reachable
    teleportTo(sim, ritual.pos.x, ritual.pos.z);
    sim.pickUpObject(ritual.id);
    const second = [...sim.entities.values()].find(
      (e) => e.templateId === 'bound_guardian' && !e.dead,
    );
    expect(second).toBeTruthy();
    // interact count stays satisfied; the keystone is retained for the retry
    expect(sim.questLog.get('q_nythraxis_bound_guardian')?.counts[0]).toBe(1);
    expect(sim.countItem('crypt_keystone', sim.playerId)).toBe(1);
  });

  it('does not re-summon the Bound Guardian once the kill objective is complete', () => {
    const sim = makeSim();
    const ritual = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'crypt_ritual_circle',
    )!;
    teleportTo(sim, ritual.pos.x, ritual.pos.z);
    sim.questLog.set('q_nythraxis_bound_guardian', {
      questId: 'q_nythraxis_bound_guardian',
      counts: [1, 1, 0],
      state: 'active',
    });
    sim.addItem('crypt_keystone', 1);

    sim.pickUpObject(ritual.id);
    expect(
      [...sim.entities.values()].some((e) => e.templateId === 'bound_guardian' && !e.dead),
    ).toBe(false);
  });

  it('shares Nythraxis ritual circle progress with nearby party members', () => {
    const sim = makeSim();
    const allyPid = sim.addPlayer('mage', 'Ally');
    sim.partyInvite(allyPid);
    sim.partyAccept(allyPid);
    const ritual = [...sim.entities.values()].find(
      (e) => e.kind === 'object' && e.objectItemId === 'crypt_ritual_circle',
    )!;
    teleportTo(sim, ritual.pos.x, ritual.pos.z);
    teleportTo(sim, ritual.pos.x + 5, ritual.pos.z, allyPid);
    sim.questLog.set('q_nythraxis_bound_guardian', {
      questId: 'q_nythraxis_bound_guardian',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.meta(allyPid)?.questLog.set('q_nythraxis_bound_guardian', {
      questId: 'q_nythraxis_bound_guardian',
      counts: [0, 0, 0],
      state: 'active',
    });
    sim.addItem('crypt_keystone', 1);

    sim.pickUpObject(ritual.id);

    expect(sim.questLog.get('q_nythraxis_bound_guardian')?.counts[0]).toBe(1);
    expect(sim.meta(allyPid)?.questLog.get('q_nythraxis_bound_guardian')?.counts[0]).toBe(1);
  });

  it('cleanses hostile control auras from quest NPCs', () => {
    const sim = makeSim('mage');
    const redbrook = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook')!;
    redbrook.auras.push({
      id: 'polymorph',
      name: 'Polymorph',
      kind: 'polymorph',
      remaining: 15,
      duration: 15,
      value: 0,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: sim.playerId,
      school: 'arcane',
      breaksOnDamage: true,
    });

    const events = sim.tick();

    expect(redbrook.auras.some((a) => a.kind === 'polymorph')).toBe(false);
    expect(events).toContainEqual({
      type: 'aura',
      targetId: redbrook.id,
      name: 'Polymorph',
      gained: false,
    });
  });
});

describe('warrior charge', () => {
  function chargeSetup() {
    const sim = makeSim();
    (sim as any).grantXp(99999); // learn charge (level 4)
    const p = sim.player;
    const wolf = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead,
    )!;
    // A level-20 warrior one-shots a ~28hp wolf, and the swing that lands the
    // instant the charge arrives would clear autoAttack (target died). Whether
    // that kill connects rides the shared RNG stream — which shifts as world
    // content grows — so beef the wolf up to survive the engaging swing and
    // keep this test about charge -> melee -> auto-attack, not the kill roll.
    wolf.maxHp = 10000;
    wolf.hp = 10000;
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

describe('mob tap rights', () => {
  function wolf(sim: Sim): Entity {
    return [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
    )!;
  }

  it('a hit that deals real damage claims the mob', () => {
    const sim = makeSim('mage');
    const m = wolf(sim);
    expect(m.tappedById).toBeNull();
    (sim as any).dealDamage(sim.player, m, 7, false, 'fire', 'test', 'hit');
    expect(m.tappedById).toBe(sim.player.id);
  });

  it('a fully absorbed (zero-damage) hit does not claim the mob', () => {
    const sim = makeSim('mage');
    const m = wolf(sim);
    // a shield that soaks the whole hit — the mob takes no real damage
    m.auras.push({
      id: 'test_absorb',
      name: 'Test Shield',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 1000,
      sourceId: m.id,
      school: 'arcane',
    } as any);
    const hpBefore = m.hp;
    (sim as any).dealDamage(sim.player, m, 50, false, 'fire', 'test', 'hit');
    expect(m.hp).toBe(hpBefore); // nothing got through
    expect(m.tappedById).toBeNull(); // so nobody owns the tap yet
  });
});

describe('pet heel warp', () => {
  it('keeps the spatial grid exact when a pet warps to its owner', () => {
    const sim = makeSim();
    const p = sim.player;
    // park the owner behind the spawn building, far enough that no heel route
    // exists: the gap (87yd) exceeds the pet's A* search window and the building
    // breaks line of sight, so the pet can only fall back to the last-resort warp.
    teleportTo(sim, 0, 82);

    // adopt a wild beast as a heeling pet and strand it on the far side of the wall
    const pet = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    pet.ownerId = p.id;
    pet.hostile = false;
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.petMode = 'passive';
    pet.pos = { x: 0, z: -5, y: p.pos.y };
    pet.prevPos = { ...pet.pos };
    (sim as any).grid.update(pet); // grid now buckets the pet at its far cell

    // unreachable owner with nothing to fight: the pet warps back to heel
    (sim as any).ctx.updatePet(pet);
    expect(dist2d(pet.pos, p.pos)).toBeLessThan(1);

    // a same-tick radius query at the warp destination must see the pet — it
    // would miss it if the grid still held the pet in its stale far-away cell
    const found: number[] = [];
    (sim as any).grid.forEachInRadius(p.pos.x, p.pos.z, 5, (e: Entity) => found.push(e.id));
    expect(found).toContain(pet.id);
  });
});

describe('aoe damage vs armor', () => {
  // Armor mitigates physical damage only. The single-target path already
  // gates armor on `!isSpell`; the AoE path must match so spell-school novas
  // (Arcane Explosion, Consecration) ignore the target's armor like every
  // other spell in the game.
  function aoeSetup(ability: string) {
    const sim = makeSim('mage');
    (sim as any).grantXp(99999); // level up far past Arcane Explosion (lvl 14)
    const p = sim.player;
    const wolf = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead,
    )!;
    wolf.maxHp = 100000;
    wolf.hp = 100000;
    // huge armor pins armorReduction at its 0.75 cap — a mitigated arcane hit
    // would land at <=8, well under the unmitigated 26-31 band.
    wolf.stats.armor = 10_000_000;
    teleportTo(sim, wolf.pos.x, wolf.pos.z + 1);
    sim.targetEntity(wolf.id);
    return { sim, p, wolf, ability };
  }

  it('arcane explosion ignores the target armor (spell school)', () => {
    const { sim, wolf } = aoeSetup('arcane_explosion');
    const before = wolf.hp;
    sim.castAbility('arcane_explosion');
    for (let i = 0; i < 3; i++) sim.tick();
    // full unmitigated arcane damage is 26-31; mitigated would be <=8
    expect(before - wolf.hp).toBeGreaterThanOrEqual(20);
  });
});

describe('RL observation encoding', () => {
  // The target block, the nearby-mob block, and the interactable block all
  // encode entity distance as clamp(d / 40, ...). The target field used to clamp
  // to [0, 1] while the others use [0, 1.5] (the 60-unit observation radius), so
  // a target between 40 and 60 units saturated and lost distance granularity.
  // Target distance index: 16 self + 2 fields per ability slot + presence/hp/level.
  const ABILITY_SLOTS = ACTIONS.length - 13;
  const TARGET_DIST_INDEX = 16 + ABILITY_SLOTS * 2 + 3;

  it('encodes target distance on the same 1.5 scale as nearby mobs', () => {
    const sim = makeSim();
    const p = sim.player;
    teleportTo(sim, 0, -40); // open road
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    // park the mob 50 units away (inside the 60-unit obs radius, beyond the
    // old 40-unit saturation point)
    mob.pos = { ...sim.groundPos(p.pos.x + 50, p.pos.z) };
    expect(dist2d(p.pos, mob.pos)).toBeCloseTo(50, 0);

    sim.targetEntity(mob.id);
    const obs = encodeObs(sim);
    expect(obs[TARGET_DIST_INDEX]).toBeGreaterThan(1); // would be clamped to 1 before the fix
    expect(obs[TARGET_DIST_INDEX]).toBeCloseTo(50 / 40, 5);
  });
});

describe('pet heel warp', () => {
  it('keeps the spatial grid exact when a pet warps to its owner', () => {
    const sim = makeSim();
    const p = sim.player;
    // park the owner behind the spawn building, far enough that no heel route
    // exists: the gap (87yd) exceeds the pet's A* search window and the building
    // breaks line of sight, so the pet can only fall back to the last-resort warp.
    teleportTo(sim, 0, 82);

    // adopt a wild beast as a heeling pet and strand it on the far side of the wall
    const pet = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
    pet.ownerId = p.id;
    pet.hostile = false;
    pet.aggroTargetId = null;
    pet.inCombat = false;
    pet.petMode = 'passive';
    pet.pos = { x: 0, z: -5, y: p.pos.y };
    pet.prevPos = { ...pet.pos };
    (sim as any).grid.update(pet); // grid now buckets the pet at its far cell

    // unreachable owner with nothing to fight: the pet warps back to heel
    (sim as any).ctx.updatePet(pet);
    expect(dist2d(pet.pos, p.pos)).toBeLessThan(1);

    // a same-tick radius query at the warp destination must see the pet — it
    // would miss it if the grid still held the pet in its stale far-away cell
    const found: number[] = [];
    (sim as any).grid.forEachInRadius(p.pos.x, p.pos.z, 5, (e: Entity) => found.push(e.id));
    expect(found).toContain(pet.id);
  });
});

describe('mob tap rights', () => {
  function wolf(sim: Sim): Entity {
    return [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
    )!;
  }

  it('a hit that deals real damage claims the mob', () => {
    const sim = makeSim('mage');
    const m = wolf(sim);
    expect(m.tappedById).toBeNull();
    (sim as any).dealDamage(sim.player, m, 7, false, 'fire', 'test', 'hit');
    expect(m.tappedById).toBe(sim.player.id);
  });

  it('a fully absorbed (zero-damage) hit does not claim the mob', () => {
    const sim = makeSim('mage');
    const m = wolf(sim);
    // a shield that soaks the whole hit — the mob takes no real damage
    m.auras.push({
      id: 'test_absorb',
      name: 'Test Shield',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 1000,
      sourceId: m.id,
      school: 'arcane',
    } as any);
    const hpBefore = m.hp;
    (sim as any).dealDamage(sim.player, m, 50, false, 'fire', 'test', 'hit');
    expect(m.hp).toBe(hpBefore); // nothing got through
    expect(m.tappedById).toBeNull(); // so nobody owns the tap yet
  });
});

describe('ranged auto-attack crit suppression', () => {
  // The crit chance a swing rolls against is the second rng.chance() call in
  // both meleeSwing and rangedSwing (the first is the miss roll). Capture the
  // args and return false so no miss/crit branches fire and perturb state.
  function critChanceRolled(sim: Sim, swing: () => void, source: any, target: any): number {
    const calls: number[] = [];
    (sim as any).rng.chance = (p: number) => {
      calls.push(p);
      return false;
    };
    swing();
    // The shot's miss + crit rolls now run when the projectile lands, not on the
    // swing tick: resolve the scheduled bolt directly so this stays an isolated unit
    // test (ticking the whole Sim would pollute `calls` with regen/AI rolls).
    const pending = (sim as any).pendingProjectiles as Array<{
      resolve: (s: any, t: any) => void;
    }>;
    for (const proj of pending) proj.resolve(source, target);
    pending.length = 0;
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
    const rolled = critChanceRolled(
      sim,
      () => (sim as any).rangedSwing(hunter, wolf, ranged),
      hunter,
      wolf,
    );
    // 0.5 base - 3 * 0.002 suppression = 0.494 (was a flat 0.5 before the fix)
    expect(rolled).toBeCloseTo(0.5 - 3 * 0.002, 5);
  });

  it('does not suppress crit against an equal-or-lower-level target', () => {
    const { sim, hunter, wolf, ranged } = setup(10, 8); // lower level
    const rolled = critChanceRolled(
      sim,
      () => (sim as any).rangedSwing(hunter, wolf, ranged),
      hunter,
      wolf,
    );
    expect(rolled).toBeCloseTo(0.5, 5);
  });
});

describe('spell visuals', () => {
  it('hostile casts emit projectile spellfx events', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    const wolf = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf',
    )!;
    teleportTo(sim, wolf.pos.x - 10, wolf.pos.z);
    p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
    sim.targetEntity(wolf.id);
    sim.castAbility('fireball');
    const events = [];
    for (let i = 0; i < 60; i++) events.push(...sim.tick());
    const fx = events.filter((e) => e.type === 'spellfx');
    expect(
      fx.some((e) => e.type === 'spellfx' && e.fx === 'projectile' && e.school === 'fire'),
    ).toBe(true);
  });

  it('hostile targeted spells cannot start through dungeon walls', () => {
    const sim = makeSim('mage');
    const origin = instanceOrigin(2, 0);
    const p = sim.player;
    const mob = createMob(990200, MOBS.sanctum_boneguard, 19, {
      x: origin.x - 14,
      y: 0,
      z: origin.z + 74,
    });
    sim.entities.set(mob.id, mob);
    teleportTo(sim, origin.x - 14, origin.z + 60);
    faceTarget(p, mob);
    sim.targetEntity(mob.id);

    expect(lineOfSightClear(sim.cfg.seed, p.pos, mob.pos)).toBe(false);
    sim.castAbility('fireball');
    const events = sim.tick();

    expect(p.castingAbility).toBeNull();
    expect(events.some((e) => e.type === 'castStart' && e.ability === 'fireball')).toBe(false);
    expect(events.some((e) => e.type === 'error' && /line of sight/i.test(e.text))).toBe(true);
  });

  it('hostile targeted spells can start through the open dungeon passage', () => {
    const sim = makeSim('mage');
    const origin = instanceOrigin(2, 0);
    const p = sim.player;
    const mob = createMob(990201, MOBS.sanctum_boneguard, 19, {
      x: origin.x,
      y: 0,
      z: origin.z + 74,
    });
    sim.entities.set(mob.id, mob);
    teleportTo(sim, origin.x, origin.z + 60);
    faceTarget(p, mob);
    sim.targetEntity(mob.id);

    expect(lineOfSightClear(sim.cfg.seed, p.pos, mob.pos)).toBe(true);
    sim.castAbility('fireball');
    const events = sim.tick();

    expect(p.castingAbility).toBe('fireball');
    expect(events.some((e) => e.type === 'castStart' && e.ability === 'fireball')).toBe(true);
  });

  it('a LOW prop (campfire) no longer blocks spell line of sight, buildings still do', () => {
    const sim = makeSim('mage');
    const seed = sim.cfg.seed;
    // Straddle a world campfire: its collider sits on the ray (it still blocks
    // MOVEMENT below), but its visual top (1.45) is under the eye line (1.6),
    // so the cast sees straight over it.
    const [cx, cz] = PROPS.campfires[0];
    expect(isBlocked(seed, cx, cz, 0.5)).toBe(true); // movement still collides
    expect(lineOfSightClear(seed, { x: cx - 3, z: cz }, { x: cx + 3, z: cz })).toBe(true);
    // A building straddled through its center still blocks (top far above eyes).
    const b = PROPS.buildings[0];
    const span = b.w + b.d;
    expect(lineOfSightClear(seed, { x: b.x - span, z: b.z }, { x: b.x + span, z: b.z })).toBe(
      false,
    );
  });

  it('ranged auto shot does not fire through dungeon walls', () => {
    const sim = makeSim('hunter');
    const origin = instanceOrigin(2, 0);
    const p = sim.player;
    const mob = createMob(990202, MOBS.sanctum_boneguard, 19, {
      x: origin.x - 14,
      y: 0,
      z: origin.z + 74,
    });
    sim.entities.set(mob.id, mob);
    teleportTo(sim, origin.x - 14, origin.z + 60);
    placeEntity(sim, mob, origin.x - 14, origin.z + 74);
    faceTarget(p, mob);
    sim.targetEntity(mob.id);
    sim.startAutoAttack();
    p.swingTimer = 0;

    const events = sim.tick();

    expect(events.some((e) => e.type === 'spellfx' && e.targetId === mob.id)).toBe(false);
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(false);
  });
});

describe('mob auto attacks against moving targets', () => {
  function damageTimesFrom(events: SimEvent[], sourceId: number, targetId: number): boolean {
    return events.some(
      (e) => e.type === 'damage' && e.sourceId === sourceId && e.targetId === targetId,
    );
  }

  it('continues landing melee swings after the target moves around melee range', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 1_000_000;
    p.hp = p.maxHp;
    const wolf = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead,
    )!;
    wolf.maxHp = 1_000_000;
    wolf.hp = wolf.maxHp;
    teleportTo(sim, wolf.pos.x, wolf.pos.z + 2.5);
    wolf.aiState = 'attack';
    wolf.aggroTargetId = p.id;
    wolf.inCombat = true;
    wolf.swingTimer = 0;
    wolf.threat.set(p.id, 1000);

    const hitTimes: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      const t = i / 20;
      if (t > 2) {
        const oldPos = { ...p.pos };
        const angle = (t - 2) * 1.6;
        p.pos.x = wolf.spawnPos.x + Math.sin(angle) * 8;
        p.pos.z = wolf.spawnPos.z + Math.cos(angle) * 8;
        p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
        p.prevPos = oldPos;
      }
      const events = sim.tick();
      if (damageTimesFrom(events, wolf.id, p.id)) hitTimes.push(i / 20);
    }

    expect(hitTimes.length).toBeGreaterThanOrEqual(6);
    expect(hitTimes.at(-1)).toBeGreaterThan(15);
  });
});

describe('trade and duel invites validate availability at accept time', () => {
  it('a second invitee cannot hijack the inviter who is already trading', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('warrior', 'Cara');

    // Anna fires off trade requests to both Bert and Cara while still free.
    sim.tradeRequest(b, a);
    sim.tradeRequest(c, a);

    // Bert accepts first — Anna and Bert are now trading together.
    sim.tradeAccept(b);
    const annaSession = sim.tradeFor(a);
    const bertSession = sim.tradeFor(b);
    expect(annaSession).not.toBeNull();
    expect(annaSession).toBe(bertSession);

    // Cara accepts the stale request. This must NOT silently replace Anna's
    // live session with Bert (which would desync Bert's trade window).
    sim.tradeAccept(c);

    expect(sim.tradeFor(c)).toBeNull();
    // Anna is still trading with the same partner she actually opened with.
    expect(sim.tradeFor(a)).toBe(bertSession);
    expect(sim.tradeFor(b)).toBe(bertSession);
  });

  it('a second challenger acceptance cannot hijack a duelist mid-duel', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('warrior', 'Cara');

    sim.duelRequest(b, a);
    sim.duelRequest(c, a);

    sim.duelAccept(b);
    const annaDuel = sim.duelFor(a);
    expect(annaDuel).not.toBeNull();
    expect(sim.duelFor(b)).toBe(annaDuel);

    sim.duelAccept(c);
    expect(sim.duelFor(c)).toBeNull();
    expect(sim.duelFor(a)).toBe(annaDuel);
    expect(sim.duelFor(b)).toBe(annaDuel);
  });
});
