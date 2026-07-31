// Shard 2 of the fixes suite (loot, quest npcs, combat/pet/spell fixes).
// Shared fixtures live in tests/fixes_shared.ts; the world/terrain shard is
// tests/fixes.test.ts.
import { describe, expect, it } from 'vitest';
import { isBlocked, lineOfSightClear } from '../src/sim/colliders';
import {
  BUILTIN_WORLD,
  CLASSES,
  DUNGEON_LIST,
  DUNGEON_X_THRESHOLD,
  dungeonAt,
  instanceOrigin,
  MOBS,
  NPCS,
  PROPS,
  QUESTS,
} from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { ACTIONS, encodeObs } from '../src/sim/obs';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import {
  faceTarget,
  formRaid,
  makeRitualSim,
  makeSim,
  placeEntity,
  SEED,
  teleportTo,
} from './fixes_shared';

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
    // offers several; keep talking until the muster order is taken
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
    const sim = makeRitualSim();
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
  }, 90_000);

  it('despawns the Bound Guardian after 60 seconds out of combat without damage and resets on damage taken', () => {
    const sim = makeRitualSim();
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
    // that kill connects rides the shared RNG stream, which shifts as world
    // content grows, so beef the wolf up to survive the engaging swing and
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
    // still roughly where we started; the run happens over the next ticks
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

  it('does not bill or arm charge through unbreakable encounter control', () => {
    const { sim, p, wolf } = chargeSetup();
    const rageBefore = p.resource;
    p.auras.push({
      id: 'scripted_root',
      name: 'Scripted Root',
      kind: 'root',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: 9000,
      school: 'shadow',
      unbreakableControl: true,
    });

    sim.castAbility('charge');

    expect(p.chargeTargetId).toBe(null);
    expect(p.resource).toBe(rageBefore);
    expect(p.cooldowns.has('charge')).toBe(false);
    expect(wolf.auras.some((a) => a.kind === 'stun')).toBe(false);
  });

  it('stops an in-flight charge when unbreakable encounter control lands', () => {
    const { sim, p } = chargeSetup();
    sim.castAbility('charge');
    sim.tick();
    expect(p.chargeTargetId).not.toBe(null);
    const heldAt = { ...p.pos };
    p.auras.push({
      id: 'scripted_stun',
      name: 'Scripted Stun',
      kind: 'stun',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: 9000,
      school: 'shadow',
      unbreakableControl: true,
    });

    sim.tick();

    expect(p.chargeTargetId).toBe(null);
    expect(p.pos.x).toBeCloseTo(heldAt.x, 5);
    expect(p.pos.z).toBeCloseTo(heldAt.z, 5);
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
    // a shield that soaks the whole hit; the mob takes no real damage
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

    // a same-tick radius query at the warp destination must see the pet; it
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
    sim.setPlayerLevel(20);
    expect(sim.setSpec('arcane')).toBe(true);
    const p = sim.player;
    const wolf = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'forest_wolf' && !e.dead,
    )!;
    wolf.maxHp = 100000;
    wolf.hp = 100000;
    // huge armor pins armorReduction at its 0.75 cap; a mitigated arcane hit
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
    const bldg = PROPS.buildings[0];
    const bldgSpan = bldg.w + bldg.d;
    expect(
      lineOfSightClear(
        seed,
        { x: bldg.x - bldgSpan, z: bldg.z },
        { x: bldg.x + bldgSpan, z: bldg.z },
      ),
    ).toBe(false);
  });

  it('a LOW fence no longer blocks spell line of sight, tall walls still do (#1668)', () => {
    const sim = makeSim('mage');
    const seed = sim.cfg.seed;
    const fence = PROPS.fences[0];
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const dx = fence.x2 - fence.x1;
    const dz = fence.z2 - fence.z1;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const a = { x: mx + nx * 3, z: mz + nz * 3 };
    const b = { x: mx - nx * 3, z: mz - nz * 3 };
    expect(isBlocked(seed, mx, mz, 0.5)).toBe(true);
    expect(lineOfSightClear(seed, a, b)).toBe(true);

    const building = PROPS.buildings[0];
    const span = building.w + building.d;
    expect(
      lineOfSightClear(
        seed,
        { x: building.x - span, z: building.z },
        { x: building.x + span, z: building.z },
      ),
    ).toBe(false);
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
  // Only the orbited forest_wolf matters here; run on a wolves-only world so
  // the two 400-tick orbit windows stay cheap.
  const WOLF_TEST_WORLD: WorldContent = {
    ...BUILTIN_WORLD,
    camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'forest_wolf'),
    npcs: {},
    groundObjects: [],
  };

  function makeWolfSim() {
    return new Sim({ seed: SEED, playerClass: 'warrior', world: WOLF_TEST_WORLD });
  }

  function damageTimesFrom(events: SimEvent[], sourceId: number, targetId: number): boolean {
    return events.some(
      (e) => e.type === 'damage' && e.sourceId === sourceId && e.targetId === targetId,
    );
  }

  function orbitScenario(sim: ReturnType<typeof makeSim>, angularSpeed: number) {
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
        const angle = (t - 2) * angularSpeed;
        p.pos.x = wolf.spawnPos.x + Math.sin(angle) * 8;
        p.pos.z = wolf.spawnPos.z + Math.cos(angle) * 8;
        p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
        p.prevPos = oldPos;
      }
      const events = sim.tick();
      if (damageTimesFrom(events, wolf.id, p.id)) hitTimes.push(i / 20);
    }
    return { p, wolf, hitTimes };
  }

  it('continues landing melee swings after the target moves around melee range', () => {
    // The target circles at 7 yd/s (0.875 rad/s at r=8), a legitimately attainable
    // player run speed. Pursuit combat must keep the wolf (8 yd/s) glued at its
    // desired range, landing a swing on every full weapon cadence, all the way to
    // the end of the window. This is STRONGER than the legacy stop-go behavior,
    // which hovered at the reach boundary and only connected every ~3.5s.
    const sim = makeWolfSim();
    const { hitTimes } = orbitScenario(sim, 0.875);

    expect(hitTimes.length).toBeGreaterThanOrEqual(9);
    expect(hitTimes.at(-1)).toBeGreaterThan(15);
  });

  it('stays locked onto a super-speed circler it cannot catch (kited, never resets)', () => {
    // At 12.8 yd/s (1.6 rad/s at r=8) the orbiter outruns the wolf outright: a
    // sustained speed no player reaches without stacked cooldowns. Fluid pursuit
    // settles into a tail-chase just outside reach, so the circler CAN kite the
    // wolf hit-free after the opening contact: that is the deliberate trade for
    // hit-and-run combat (the mobs that must not be kiteable carry anti-kite
    // pulses instead, see aoeSlow). What the wolf must never do is give up:
    // it stays engaged and on the target the whole window.
    const sim = makeWolfSim();
    const { p, wolf, hitTimes } = orbitScenario(sim, 1.6);

    expect(hitTimes.length).toBeGreaterThanOrEqual(3); // the opening contact still lands
    expect(wolf.aggroTargetId).toBe(p.id);
    expect(wolf.inCombat).toBe(true);
    expect(['chase', 'attack']).toContain(wolf.aiState);
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

    // Bert accepts first; Anna and Bert are now trading together.
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
