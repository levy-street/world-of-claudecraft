import { describe, expect, it } from 'vitest';
import {
  GLIDER_APPRENTICE_NPC_DEF,
  GLIDER_APPRENTICE_NPC_ID,
  GLIDER_COURSE,
  GLIDER_LAUNCH_SITE,
  GLIDER_NPC_DEF,
  GLIDER_NPC_ID,
  GLIDER_QUEST_ID,
  GLIDER_WIND_TUNNELS,
} from '../src/sim/content/world_quest_glider';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { gliderActionsLocked } from '../src/sim/glider_action_lock';
import { mountItemId, summonMountItem } from '../src/sim/mounts';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { emptyMoveInput, normAngle } from '../src/sim/types';
import { WATER_LEVEL } from '../src/sim/world';
import { advanceGliderMovement, startGliderFlight } from '../src/sim/world_quest_glider';
import { WORLD_SEED } from '../src/sim/world_seed';

function setupSim(fullWorld = false) {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    world: fullWorld
      ? BUILTIN_WORLD
      : {
          ...BUILTIN_WORLD,
          camps: [],
          npcs: {
            [GLIDER_NPC_DEF.id]: GLIDER_NPC_DEF,
            [GLIDER_APPRENTICE_NPC_DEF.id]: GLIDER_APPRENTICE_NPC_DEF,
          },
          groundObjects: [],
        },
  });
  sim.resetDay = '2026-09-06';
  return sim;
}

describe('World Quest Glider Integration', () => {
  it('publishes a wind-only crossing immediately between periodic snapshot ticks', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    const meta = sim.meta(sim.playerId)!;
    const state = meta.worldQuestLog.get(GLIDER_QUEST_ID)!.glider!;
    state.phase = 'flying';
    state.speed = 22;
    state.tick = 0;
    const lane = GLIDER_WIND_TUNNELS[0];
    sim.player.pos = {
      x: lane.x - Math.sin(lane.yaw) * 0.5,
      y: lane.y,
      z: lane.z - Math.cos(lane.yaw) * 0.5,
    };
    sim.player.facing = lane.yaw;
    Object.assign(meta.moveInput, emptyMoveInput(), { gliderPitch: 0 });
    const revision = meta.wireRev;
    advanceGliderMovement((sim as unknown as { ctx: SimContext }).ctx, sim.player, meta);
    expect(state.tick).toBe(1);
    expect(state.passedRings).toEqual([]);
    expect(state.phase).toBe('flying');
    expect(state.windBoosts).toEqual([lane.id]);
    expect(meta.wireRev).toBe(revision + 1);
  });

  it('pitch-only steering clears AFK while a neutral camera does not', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    const meta = sim.meta(sim.playerId)!;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    meta.away = { mode: 'afk', message: '' };
    sim.player.afk = true;
    Object.assign(meta.moveInput, emptyMoveInput(), { gliderPitch: 0 });
    advanceGliderMovement(ctx, sim.player, meta);
    expect(meta.away?.mode).toBe('afk');
    expect(sim.player.afk).toBe(true);
    meta.moveInput.gliderPitch = 0.3;
    advanceGliderMovement(ctx, sim.player, meta);
    expect(meta.away).toBeNull();
    expect(sim.player.afk).toBe(false);
    expect(meta.lastActiveTick).toBe(ctx.tickCount);
  });

  it('replays pitch and tunnel inputs identically across independent seeded Sims', () => {
    const sims = [setupSim(), setupSim()];
    const lane = GLIDER_WIND_TUNNELS[0];
    for (const sim of sims) {
      sim.chat('/dev glider start');
      const state = sim.worldQuestLog.get(GLIDER_QUEST_ID)!.glider!;
      state.phase = 'flying';
      state.speed = 22;
      sim.player.pos = {
        x: lane.x - Math.sin(lane.yaw),
        y: lane.y,
        z: lane.z - Math.cos(lane.yaw),
      };
      sim.player.facing = lane.yaw;
    }
    for (let tick = 0; tick < 20; tick++) {
      for (const sim of sims) {
        Object.assign(sim.moveInput, emptyMoveInput(), { gliderPitch: Math.sin(tick / 5) * 0.3 });
        sim.tick();
      }
      expect(sims[0].player.pos).toEqual(sims[1].player.pos);
      expect(sims[0].worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toEqual(
        sims[1].worldQuestLog.get(GLIDER_QUEST_ID)?.glider,
      );
    }
    expect(sims[0].worldQuestLog.get(GLIDER_QUEST_ID)?.glider?.windBoosts).toEqual([lane.id]);
    const tail = (sim: Sim) =>
      Array.from({ length: 8 }, () => (sim as unknown as { ctx: SimContext }).ctx.rng.next());
    expect(tail(sims[0])).toEqual(tail(sims[1]));
  });

  it('arms quest and positions player with /dev glider', () => {
    const sim = setupSim();
    sim.chat('/dev glider');

    expect(sim.player.level).toBeGreaterThanOrEqual(10);
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    expect(progress).toBeDefined();
    expect(progress?.state).toBe('active');

    const instructor = sim.entities.get(GLIDER_NPC_ID);
    expect(instructor).toBeDefined();
    expect(instructor?.templateId).toBe(GLIDER_NPC_DEF.id);

    const apprentice = sim.entities.get(GLIDER_APPRENTICE_NPC_ID);
    expect(apprentice).toBeDefined();
    expect(apprentice?.templateId).toBe(GLIDER_APPRENTICE_NPC_DEF.id);
  });

  it('talks to Flightmaster Zephyr to launch flight with countdown', () => {
    const sim = setupSim();
    sim.chat('/dev glider');

    sim.talkToNpc(GLIDER_NPC_ID);

    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    expect(progress?.glider).toBeDefined();
    expect(progress?.glider?.phase).toBe('countdown');

    // Player position should be at launch perch
    expect(sim.player.pos.x).toBe(GLIDER_LAUNCH_SITE.playerLaunch.x);
    expect(sim.player.pos.y).toBe(GLIDER_LAUNCH_SITE.playerLaunch.y);
    expect(sim.player.pos.z).toBe(GLIDER_LAUNCH_SITE.playerLaunch.z);

    // Ticking 60 ticks finishes countdown and starts flying
    for (let i = 0; i < 60; i++) {
      sim.tick();
    }
    expect(progress?.glider?.phase).toBe('flying');

    // Ticking sim advances glider movement
    const prevZ = sim.player.pos.z;
    sim.tick();
    expect(sim.player.pos.z).toBeGreaterThan(prevZ);
  });

  it('immediately arms flight when using /dev glider start', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');

    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID);
    expect(['countdown', 'flying']).toContain(progress?.glider?.phase);
    expect(sim.player.pos.y).toBe(GLIDER_LAUNCH_SITE.playerLaunch.y);
  });

  it('talks to Skye at landing pad to return to launch tower', () => {
    const sim = setupSim();
    sim.chat('/dev glider');

    // Teleport player near Skye
    sim.player.pos = { ...sim.entities.get(GLIDER_APPRENTICE_NPC_ID)!.pos };
    sim.talkToNpc(GLIDER_APPRENTICE_NPC_ID);

    // Player should be back near launch site
    expect(
      Math.hypot(sim.player.pos.x - GLIDER_LAUNCH_SITE.x, sim.player.pos.z - GLIDER_LAUNCH_SITE.z),
    ).toBeLessThan(5);
  });

  it('completes the quest upon safe landing and grants deed', () => {
    const sim = setupSim();
    sim.chat('/dev glider');
    sim.talkToNpc(GLIDER_NPC_ID);

    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    expect(progress.glider).toBeDefined();

    progress.glider!.phase = 'flying';
    // Simulate passing all rings
    progress.glider!.passedRings = GLIDER_COURSE.rings.map((r) => r.id);

    // Place player right above landing pad
    sim.player.pos = {
      x: GLIDER_COURSE.landingPad.x,
      y: GLIDER_COURSE.landingPad.y + 0.5,
      z: GLIDER_COURSE.landingPad.z,
    };

    sim.tick();

    expect(progress.glider?.phase).toBe('won');
    // Quest update tick credits completion
    sim.tick();
    expect(progress.state).toBe('completed');
    expect(sim.meta(sim.playerId)?.deedsEarned.has('exp_windrider_slalom')).toBe(true);
  });
  it('completes the authored course with real ticks and steering inputs, awarding exactly once', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const before = sim.copper;
    for (let i = 0; i < 2600 && progress.state === 'active'; i++) {
      const state = progress.glider!;
      const target =
        GLIDER_COURSE.rings.find((r) => !state.passedRings.includes(r.id)) ??
        GLIDER_COURSE.landingPad;
      const difference = normAngle(
        Math.atan2(target.x - sim.player.pos.x, target.z - sim.player.pos.z) - sim.player.facing,
      );
      Object.assign(sim.moveInput, {
        ...emptyMoveInput(),
        forward: true,
        turnLeft: difference > 0.06,
        turnRight: difference < -0.06,
        gliderPitch: Math.max(
          -1,
          Math.min(
            1,
            ((target.y - sim.player.pos.y) * 1.5 + 0.55) / (target.y > sim.player.pos.y ? 7 : 14),
          ),
        ),
      });
      sim.tick();
    }
    expect(progress.state).toBe('completed');
    expect(progress.glider?.passedRings).toHaveLength(GLIDER_COURSE.rings.length);
    expect(progress.glider?.windBoosts?.length).toBeGreaterThan(0);
    expect(progress.gliderResult?.elapsedSeconds).toBeLessThan(85);
    expect(sim.copper).toBeGreaterThan(before);
    const rewarded = sim.copper;
    const hpAtLanding = sim.player.hp;
    Object.assign(sim.moveInput, emptyMoveInput());
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.copper).toBe(rewarded);
    expect(sim.player.hp).toBe(hpAtLanding);
    expect(sim.player.onGround).toBe(true);
    expect(sim.player.pos.y).toBeGreaterThan(WATER_LEVEL + 0.5);
    expect(sim.player.dead).toBe(false);
  });
  it('returns a missed flight to Zephyr and allows immediate retry without resetting quest credit', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    Object.assign(sim.moveInput, { ...emptyMoveInput(), forward: true });
    for (let i = 0; i < 2600 && progress.glider?.phase !== 'failed'; i++) sim.tick();
    expect(progress.glider?.phase).toBe('failed');
    expect(
      Math.hypot(sim.player.pos.x - GLIDER_NPC_DEF.pos.x, sim.player.pos.z - GLIDER_NPC_DEF.pos.z),
    ).toBeLessThan(3);
    Object.assign(sim.moveInput, emptyMoveInput());
    sim.talkToNpc(GLIDER_NPC_ID);
    expect(progress.glider?.phase).toBe('countdown');
    expect(progress.count).toBe(0);
  });
  it('rejects remote, vertical, and forged apprentice returns through authoritative entry points', () => {
    const sim = setupSim();
    sim.chat('/dev glider');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const apprentice = sim.entities.get(GLIDER_APPRENTICE_NPC_ID)!;
    const meta = sim.meta(sim.playerId)!;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    sim.player.pos = sim.groundPos(200, 620);
    const remote = { ...sim.player.pos };
    startGliderFlight(ctx, meta, sim.player, apprentice, progress);
    expect(sim.player.pos).toEqual(remote);
    sim.player.pos = { ...apprentice.pos, y: apprentice.pos.y + 20 };
    const vertical = { ...sim.player.pos };
    startGliderFlight(ctx, meta, sim.player, apprentice, progress);
    expect(sim.player.pos).toEqual(vertical);
    sim.player.pos = { ...apprentice.pos };
    const nearby = { ...sim.player.pos };
    startGliderFlight(ctx, meta, sim.player, { ...apprentice, id: 123 }, progress);
    startGliderFlight(
      ctx,
      meta,
      sim.player,
      { ...apprentice, templateId: 'glider_instructor' },
      progress,
    );
    startGliderFlight(ctx, meta, sim.player, { ...apprentice, dead: true }, progress);
    expect(sim.player.pos).toEqual(nearby);
  });
  it('rejects the apprentice during flight, while a completed run may return normally', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const apprentice = sim.entities.get(GLIDER_APPRENTICE_NPC_ID)!;
    sim.player.pos = { ...apprentice.pos };
    const before = { ...sim.player.pos };
    sim.talkToNpc(GLIDER_APPRENTICE_NPC_ID);
    expect(sim.player.pos).toEqual(before);
    progress.glider!.phase = 'won';
    progress.state = 'completed';
    sim.talkToNpc(GLIDER_APPRENTICE_NPC_ID);
    expect(
      Math.hypot(sim.player.pos.x - GLIDER_NPC_DEF.pos.x, sim.player.pos.z - GLIDER_NPC_DEF.pos.z),
    ).toBeLessThan(3);
  });
  it('requires real instructor proximity including height before launching', () => {
    const sim = setupSim();
    sim.chat('/dev glider');
    const instructor = sim.entities.get(GLIDER_NPC_ID)!;
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const meta = sim.meta(sim.playerId)!;
    sim.player.pos = { ...instructor.pos, y: instructor.pos.y + 20 };
    startGliderFlight(ctx, meta, sim.player, instructor, progress);
    expect(progress.glider).toBeUndefined();
    sim.player.pos = sim.groundPos(instructor.pos.x + 6, instructor.pos.z);
    startGliderFlight(ctx, meta, sim.player, instructor, progress);
    expect(progress.glider).toBeUndefined();
  });

  it('rotation expiry returns an airborne pilot safely before restoring ordinary movement', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    for (let i = 0; i < 70; i++) sim.tick();
    expect(sim.player.pos.y).toBeGreaterThan(60);
    sim.meta(sim.playerId)!.devWorldQuestCycle = 'wq3_0';
    sim.tick();
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toBeUndefined();
    expect(
      Math.hypot(sim.player.pos.x - GLIDER_NPC_DEF.pos.x, sim.player.pos.z - GLIDER_NPC_DEF.pos.z),
    ).toBeLessThan(3);
    expect(sim.player.vy).toBe(0);
    expect(sim.player.onGround).toBe(true);
    const hp = sim.player.hp;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.player.hp).toBe(hp);
    expect(sim.player.dead).toBe(false);
  });
  it('finishes the real populated world course at level 20 without ground mobs cancelling aerial flight', () => {
    const sim = setupSim(true);
    sim.chat('/dev glider start');
    expect(sim.player.level).toBe(20);
    expect(
      [...sim.entities.values()].filter((e) => e.kind === 'mob' && e.hostile).length,
    ).toBeGreaterThan(100);
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    for (let i = 0; i < 2600 && progress.state === 'active'; i++) {
      const state = progress.glider;
      if (!state)
        throw new Error(
          JSON.stringify({
            tick: i,
            pos: sim.player.pos,
            inCombat: sim.player.inCombat,
            hp: sim.player.hp,
            attackers: [...sim.entities.values()]
              .filter((e) => e.aggroTargetId === sim.playerId)
              .map((e) => ({ id: e.id, template: e.templateId, pos: e.pos })),
          }),
        );
      const target =
        GLIDER_COURSE.rings.find((r) => !state.passedRings.includes(r.id)) ??
        GLIDER_COURSE.landingPad;
      const difference = normAngle(
        Math.atan2(target.x - sim.player.pos.x, target.z - sim.player.pos.z) - sim.player.facing,
      );
      Object.assign(sim.moveInput, {
        ...emptyMoveInput(),
        forward: true,
        turnLeft: difference > 0.06,
        turnRight: difference < -0.06,
        gliderPitch: Math.max(
          -1,
          Math.min(
            1,
            ((target.y - sim.player.pos.y) * 1.5 + 0.55) / (target.y > sim.player.pos.y ? 7 : 14),
          ),
        ),
      });
      sim.tick();
    }
    expect(progress.state).toBe('completed');
    expect(sim.player.dead).toBe(false);
    Object.assign(sim.moveInput, emptyMoveInput());
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.onGround).toBe(true);
    expect(sim.player.pos.y).toBeGreaterThan(WATER_LEVEL + 0.5);
    const ram = [...sim.entities.values()].find((e) => e.templateId === 'moor_ram' && !e.dead)!;
    sim.player.pos = sim.groundPos(ram.pos.x + 1, ram.pos.z);
    for (let i = 0; i < 30 && !sim.player.inCombat; i++) sim.tick();
    expect(sim.player.inCombat).toBe(true);
  }, 60000);

  it('unexpected combat aborts safely without erasing combat or allowing a free reward', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    for (let i = 0; i < 70; i++) sim.tick();
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const before = sim.copper;
    sim.player.inCombat = true;
    sim.player.combatTimer = 0;
    sim.tick();
    expect(progress.glider?.phase).toBe('failed');
    expect(progress.state).toBe('active');
    expect(sim.player.inCombat).toBe(true);
    expect(sim.copper).toBe(before);
    expect(sim.player.pos.y).toBeCloseTo(sim.groundPos(sim.player.pos.x, sim.player.pos.z).y);
    expect(sim.player.vy).toBe(0);
    expect(sim.player.onGround).toBe(true);
    const hp = sim.player.hp;
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.player.hp).toBe(hp);
    expect(sim.player.dead).toBe(false);
  });

  it('blocks normal spells, attacks, consumables and mounts during flight, then restores them', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    const progress = sim.worldQuestLog.get(GLIDER_QUEST_ID)!;
    const meta = sim.meta(sim.playerId)!;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    sim.player.resource = 100;
    sim.player.hp -= 100;
    sim.addItem('minor_healing_potion', 1);
    sim.addItem(mountItemId('valorsteed')!, 1);
    meta.ridingTrained = true;
    const mob = createMob(2000000, MOBS.moor_ram, 10, sim.groundPos(600, 700));
    sim.addEntity(mob);
    sim.player.targetId = mob.id;
    const hp = sim.player.hp;
    sim.castAbility('battle_shout');
    sim.startAutoAttack();
    sim.useItem('minor_healing_potion');
    expect(summonMountItem(ctx, sim.playerId, 'valorsteed')).toBe(false);
    expect(sim.player.autoAttack).toBe(false);
    expect(sim.player.hp).toBe(hp);
    expect(sim.player.auras.some((a) => a.id === 'battle_shout')).toBe(false);
    progress.glider!.phase = 'failed';
    sim.player.pos = sim.groundPos(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z);
    sim.castAbility('battle_shout');
    sim.useItem('minor_healing_potion');
    sim.startAutoAttack();
    expect(sim.player.autoAttack).toBe(true);
    expect(sim.player.hp).toBeGreaterThan(hp);
    expect(sim.player.auras.some((a) => a.id === 'battle_shout')).toBe(true);
    expect(summonMountItem(ctx, sim.playerId, 'valorsteed')).toBe(true);
  });
  it('death clears flight state on the normal dead tick and revival does not resume an airborne run', () => {
    const sim = setupSim();
    sim.chat('/dev glider start');
    expect(gliderActionsLocked(sim.worldQuestLog)).toBe(true);
    const deadPos = { ...sim.player.pos };
    sim.player.dead = true;
    sim.player.hp = 0;
    sim.tick();
    expect(gliderActionsLocked(sim.worldQuestLog)).toBe(false);
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toBeUndefined();
    expect(sim.player.pos).toEqual(deadPos);
    sim.player.dead = false;
    sim.player.hp = sim.player.maxHp;
    sim.player.pos = sim.groundPos(GLIDER_NPC_DEF.pos.x, GLIDER_NPC_DEF.pos.z);
    sim.player.onGround = true;
    sim.player.fallStartY = sim.player.pos.y;
    sim.tick();
    expect(gliderActionsLocked(sim.worldQuestLog)).toBe(false);
    expect(sim.player.dead).toBe(false);
  });
});
