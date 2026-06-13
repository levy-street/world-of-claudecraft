import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Entity, dist2d } from '../src/sim/types';
import { CRYPT_DOOR_POS, DUNGEON_X_THRESHOLD, LAKE, MOBS, NPCS, QUESTS } from '../src/sim/data';
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
  it('a turned-in quest cannot be accepted again', () => {
    const sim = makeSim();
    sim.acceptQuest('q_wolves');
    expect(sim.questState('q_wolves')).toBe('active');

    const qp = sim.questLog.get('q_wolves')!;
    qp.counts[0] = 8;
    qp.state = 'ready';

    const redbrook = [...sim.entities.values()].find((e) => e.templateId === 'marshal_redbrook')!;
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
      const min = MOBS[e.templateId].family === 'murloc' ? WATER_LEVEL - 0.55 : WATER_LEVEL + 0.35;
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

describe('boss loot and encounter resets', () => {
  it('Korzul and Velkhar always drop exactly one item from their three-way table', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.playerId)!;
    for (const bossId of ['korzul_the_gravewyrm', 'grand_necromancer_velkhar']) {
      const template = MOBS[bossId];
      const groupItems = template.loot.filter((l) => l.rollGroup).map((l) => l.itemId!);
      expect(groupItems.length).toBe(3);
      const mob = createMob(900000, template, 20, { x: 0, y: 0, z: 0 });
      // accessor defeats TS narrowing (mob.loot is assigned null in the loop)
      const lootOf = (m: Entity) => m.loot;
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        mob.loot = null;
        (sim as any).rollLoot(mob, meta);
        const dropped = (lootOf(mob)?.items ?? []).filter((s) => groupItems.includes(s.itemId));
        expect(dropped.length, `${bossId} kill #${i}`).toBe(1);
        seen.add(dropped[0].itemId);
      }
      expect([...seen].sort()).toEqual([...groupItems].sort()); // all three reachable
    }
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
