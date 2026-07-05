import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import {
  isWorldBossLootEligible,
  markWorldBossLooted,
  refreshWorldBossDaily,
  WORLD_BOSS_INTERVAL_SECONDS,
  WORLD_BOSSES,
} from '../src/sim/world_boss';

const BOSS_ID = 'thunzharr_waking_peak';
const DAY = '2026-06-28';

// Minimal PlayerMeta stand-in for the pure daily-gate helpers (they touch only
// .worldBossDaily). Cast through unknown to satisfy the full PlayerMeta type.
function fakeMeta() {
  return { worldBossDaily: { date: '', looted: new Set<string>() } } as unknown as Parameters<
    typeof isWorldBossLootEligible
  >[0];
}

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, noPlayer: true });
}

function findBoss(sim: Sim): Entity | undefined {
  return [...(sim as any).entities.values()].find(
    (e: Entity) => e.templateId === BOSS_ID && !e.dead,
  );
}

// Force the world-boss scheduler to fire on the next tick instead of waiting the
// full 3h interval, then tick once to spawn it. Returns the spawn-tick events.
function spawnBossNow(sim: Sim): { boss: Entity; events: SimEvent[] } {
  (sim as any).worldBossNextAt[0] = (sim as any).time;
  const events = sim.tick();
  const boss = findBoss(sim);
  if (!boss) throw new Error('world boss did not spawn');
  return { boss, events };
}

describe('world boss daily-loot gate (pure helpers)', () => {
  it('is eligible until looted, then blocked for the same day', () => {
    const meta = fakeMeta();
    expect(isWorldBossLootEligible(meta, BOSS_ID, DAY)).toBe(true);
    markWorldBossLooted(meta, BOSS_ID, DAY);
    expect(isWorldBossLootEligible(meta, BOSS_ID, DAY)).toBe(false);
  });

  it('resets at the UTC day boundary', () => {
    const meta = fakeMeta();
    markWorldBossLooted(meta, BOSS_ID, DAY);
    expect(isWorldBossLootEligible(meta, BOSS_ID, DAY)).toBe(false);
    refreshWorldBossDaily(meta, '2026-06-29');
    expect(isWorldBossLootEligible(meta, BOSS_ID, '2026-06-29')).toBe(true);
  });

  it('never gates when the calendar day is unknown (headless/replay)', () => {
    const meta = fakeMeta();
    markWorldBossLooted(meta, BOSS_ID, '');
    expect(isWorldBossLootEligible(meta, BOSS_ID, '')).toBe(true);
  });
});

describe('world boss scheduler', () => {
  it('spawns on the interval and announces server-wide', () => {
    const sim = makeSim();
    expect(findBoss(sim)).toBeUndefined();
    const { boss, events } = spawnBossNow(sim);
    expect(boss.level).toBe(20);
    const announce = events.find(
      (e) => e.type === 'log' && /rises over Thornpeak Heights!$/.test((e as any).text),
    );
    expect(announce).toBeDefined();
    // Server-wide => no pid (personal) and no entityId (proximity) anchor.
    expect((announce as any).pid).toBeUndefined();
    expect((announce as any).entityId).toBeUndefined();
  });

  it('worldBossAtBoot spawns the boss on the first tick (the live server), default waits the interval', () => {
    // The live server opts in: Thunzharr is up as soon as the realm boots.
    const atBoot = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: true,
      noPlayer: true,
      worldBossAtBoot: true,
    });
    atBoot.tick();
    expect(findBoss(atBoot)).toBeDefined();
    // After the boot spawn, the next rise is still one interval out.
    expect((atBoot as any).worldBossNextAt[0]).toBeCloseTo(WORLD_BOSS_INTERVAL_SECONDS, 0);
    // Default (offline worlds, parity traces): nothing spawns at boot.
    const plain = makeSim();
    plain.tick();
    expect(findBoss(plain)).toBeUndefined();
  });

  it('does not spawn a second boss while one is alive', () => {
    const sim = makeSim();
    spawnBossNow(sim);
    // Due again immediately, but the live boss blocks a duplicate spawn.
    (sim as any).worldBossNextAt[0] = (sim as any).time;
    sim.tick();
    const bosses = [...(sim as any).entities.values()].filter(
      (e: Entity) => e.templateId === BOSS_ID,
    );
    expect(bosses).toHaveLength(1);
  });

  it('schedules the next spawn one interval out', () => {
    const sim = makeSim();
    const before = (sim as any).worldBossNextAt[0] as number;
    expect(before).toBe(WORLD_BOSSES[0].intervalSeconds);
    (sim as any).worldBossNextAt[0] = (sim as any).time;
    sim.tick();
    expect((sim as any).worldBossNextAt[0]).toBeCloseTo(
      (sim as any).time + WORLD_BOSS_INTERVAL_SECONDS - 1 / 20,
      4,
    );
  });
});

describe('world boss raid-tier combat (melee, Stormcall hardcast, yells)', () => {
  // Park an effectively unkillable level-20 player in the boss's face so the
  // fight can run for real sim seconds without the raid-tier melee ending it.
  function engageBoss(sim: Sim, pid: number, boss: Entity): Entity {
    const p = (sim as any).entities.get(pid) as Entity;
    p.pos = { ...boss.pos };
    p.pos.x += 2;
    p.maxHp = 1_000_000;
    p.hp = 1_000_000;
    (sim as any).dealDamage(p, boss, 10, false, 'physical', 'Chip', 'hit', true);
    return p;
  }

  const chatYells = (events: SimEvent[]) =>
    events.filter((e) => e.type === 'chat' && (e as any).channel === 'yell');

  it('swings raid-tier melee (Nythraxis-class per-swing damage)', () => {
    const sim = makeSim();
    const { boss } = spawnBossNow(sim);
    // createMob: dmg = (dmgBase + dmgPerLevel * (level - 1)) * elite 1.5, weapon
    // min/max at 0.8x / 1.25x. Recompute from the template so the test tracks it.
    const dmg = (54 + 10.3 * 19) * 1.5;
    expect(boss.weapon.min).toBe(Math.round(dmg * 0.8));
    expect(boss.weapon.max).toBe(Math.round(dmg * 1.25));
    expect(boss.weapon.max).toBeGreaterThan(400); // a tank must be healed through this
  });

  it('barks the engage yell exactly once per pull, to nearby players only', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ada');
    const { boss } = spawnBossNow(sim);
    engageBoss(sim, pid, boss);
    let yells = chatYells(sim.tick()).filter((e) => /You wake the mountain/.test((e as any).text));
    expect(yells).toHaveLength(1);
    expect((yells[0] as any).pid).toBe(pid);
    // Re-poking the already-engaged boss must not re-fire the bark.
    const p = (sim as any).entities.get(pid) as Entity;
    (sim as any).dealDamage(p, boss, 10, false, 'physical', 'Chip', 'hit', true);
    yells = chatYells(sim.tick()).filter((e) => /You wake the mountain/.test((e as any).text));
    expect(yells).toHaveLength(0);
  });

  it('a player-owned pet pull triggers the engage yell too', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('hunter', 'Ada');
    const { boss } = spawnBossNow(sim);
    const p = (sim as any).entities.get(pid) as Entity;
    p.pos = { ...boss.pos };
    p.pos.x += 5;
    // Minimal stand-in for a controlled pet: aggroMob reads only kind/ownerId/id
    // off the pulling target.
    const pet = {
      id: 987_654,
      kind: 'mob',
      ownerId: pid,
      dead: false,
      pos: { ...boss.pos },
    } as unknown as Entity;
    (sim as any).aggroMob(boss, pet, false);
    const yells = chatYells(sim.tick()).filter((e) =>
      /You wake the mountain/.test((e as any).text),
    );
    expect(yells).toHaveLength(1);
    expect((yells[0] as any).pid).toBe(pid);
  });

  it('hardcasts Stormcall on a visible cast bar, then novas players in range', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ada');
    const { boss } = spawnBossNow(sim);
    engageBoss(sim, pid, boss);
    const p = (sim as any).entities.get(pid) as Entity;
    // Stand-in tank: gm invulnerability (every damage path early-outs on it)
    // survives the raid-tier melee that would otherwise kill an unhealed level-1
    // dummy mid-tick and evade-reset the boss (which reseeds the cadence).
    p.gm = true;
    let sawCastBar = false;
    let castYell = false;
    let unleashed = false;
    // 25s cadence + 3.5s cast, with slack for chase/knockback interruptions.
    for (let t = 0; t < 20 * 45 && !unleashed; t++) {
      // Step back into melee after every Tectonic Heave shove, and keep chipping
      // so the threat table never empties.
      p.pos.x = boss.pos.x + 2;
      p.pos.z = boss.pos.z;
      if (t % 20 === 0) {
        (sim as any).dealDamage(p, boss, 1, false, 'physical', 'Chip', 'hit', true);
      }
      const events = sim.tick();
      if (boss.castingAbility === 'thunzharr_stormcall') {
        sawCastBar = true;
        expect(boss.castTotal).toBeCloseTo(3.5, 5);
      }
      if (chatYells(events).some((e) => /The storm answers my call!/.test((e as any).text)))
        castYell = true;
      if (events.some((e) => e.type === 'log' && /unleashes Stormcall!$/.test((e as any).text)))
        unleashed = true;
    }
    expect(sawCastBar).toBe(true);
    expect(castYell).toBe(true);
    expect(unleashed).toBe(true);
    expect(boss.castingAbility).toBeNull(); // the bar cleared when the spell landed
  });

  it('barks the enrage yell when the last-fifth enrage turns on', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ada');
    const { boss } = spawnBossNow(sim);
    engageBoss(sim, pid, boss);
    sim.tick();
    boss.hp = Math.floor(boss.maxHp * 0.19);
    const events = sim.tick();
    expect(boss.enraged).toBe(true);
    const yells = chatYells(events).filter((e) => /The peak breaks/.test((e as any).text));
    expect(yells).toHaveLength(1);
  });

  it('barks the summon yell as each stormling wave rises', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ada');
    const { boss } = spawnBossNow(sim);
    engageBoss(sim, pid, boss);
    sim.tick();
    boss.hp = Math.floor(boss.maxHp * 0.6); // below the first 0.66 threshold
    const events = sim.tick();
    const yells = chatYells(events).filter((e) => /Rise, stormlings/.test((e as any).text));
    expect(yells).toHaveLength(1);
    expect(boss.summonedIds.length).toBeGreaterThan(0);
  });

  it('collapses the summoned stormlings the moment the boss dies', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Ada');
    const { boss } = spawnBossNow(sim);
    const p = engageBoss(sim, pid, boss);
    sim.tick();
    boss.hp = Math.floor(boss.maxHp * 0.6);
    sim.tick();
    const addIds = [...boss.summonedIds];
    expect(addIds.length).toBeGreaterThan(0);
    (sim as any).dealDamage(p, boss, 999_999, false, 'physical', 'Finisher', 'hit', true);
    expect(boss.dead).toBe(true);
    // Adds despawn with the boss (no live stormlings harassing looters, no
    // in-place add respawn during the 300s loot window); the corpse remains.
    expect(boss.summonedIds).toHaveLength(0);
    for (const id of addIds) expect((sim as any).entities.has(id)).toBe(false);
    expect((sim as any).entities.has(boss.id)).toBe(true);
  });
});

describe('world boss personal loot', () => {
  function killWith(sim: Sim, boss: Entity, pids: number[]) {
    // Register each contributor's threat with a chip, then have the first land the
    // killing blow.
    for (const pid of pids) {
      const e = (sim as any).entities.get(pid) as Entity;
      (sim as any).dealDamage(e, boss, 10, false, 'physical', 'Chip', 'hit', true);
    }
    const killer = (sim as any).entities.get(pids[0]) as Entity;
    (sim as any).dealDamage(killer, boss, 999_999, false, 'physical', 'Finisher', 'hit', true);
    expect(boss.dead).toBe(true);
  }

  it('drops an independent personal slot for every contributor', () => {
    const sim = makeSim();
    sim.utcDay = DAY;
    const p1 = sim.addPlayer('warrior', 'Ada');
    const p2 = sim.addPlayer('mage', 'Bru');
    const { boss } = spawnBossNow(sim);
    killWith(sim, boss, [p1, p2]);

    const items = boss.loot?.items ?? [];
    // The guaranteed Inert Storm Shard (chance 1) must land for both contributors,
    // each as a self-only personal slot.
    const shardOwners = items
      .filter((s) => s.itemId === 'inert_storm_shard')
      .flatMap((s) => s.personalFor ?? []);
    expect(shardOwners).toContain(p1);
    expect(shardOwners).toContain(p2);
    // Every world-boss slot is personal (never a shared/open slot).
    for (const slot of items) {
      expect(slot.personalFor && slot.personalFor.length === 1).toBe(true);
      expect(slot.openToAll).toBeFalsy();
    }
    // The KILL does not consume the daily: only actually looting a personal
    // slot does. p1 walks over and loots; p2 never does.
    expect((sim as any).players.get(p1).worldBossDaily.looted.has(BOSS_ID)).toBe(false);
    expect((sim as any).players.get(p2).worldBossDaily.looted.has(BOSS_ID)).toBe(false);
    const e1 = (sim as any).entities.get(p1) as Entity;
    e1.pos = { ...boss.pos };
    sim.lootCorpse(boss.id, p1);
    expect((sim as any).players.get(p1).worldBossDaily.looted.has(BOSS_ID)).toBe(true);
    expect((sim as any).players.get(p2).worldBossDaily.looted.has(BOSS_ID)).toBe(false);
  });

  it('gives a contributor who LOOTED a boss no loot from a second boss the same day', () => {
    const sim = makeSim();
    sim.utcDay = DAY;
    const p1 = sim.addPlayer('warrior', 'Ada');
    const first = spawnBossNow(sim);
    killWith(sim, first.boss, [p1]);
    expect((first.boss.loot?.items ?? []).length).toBeGreaterThan(0);
    const e1 = (sim as any).entities.get(p1) as Entity;
    e1.pos = { ...first.boss.pos };
    sim.lootCorpse(first.boss.id, p1); // consumes the daily

    // Remove the first corpse, then spawn + kill a second boss the same UTC day.
    (sim as any).worldBossEntityIds[0] = null;
    const second = spawnBossNow(sim);
    killWith(sim, second.boss, [p1]);
    const ownedBySecond = (second.boss.loot?.items ?? []).flatMap((s) => s.personalFor ?? []);
    expect(ownedBySecond).not.toContain(p1);
  });

  it('keeps the daily for a contributor who never looted the corpse', () => {
    const sim = makeSim();
    sim.utcDay = DAY;
    const p1 = sim.addPlayer('warrior', 'Ada');
    const first = spawnBossNow(sim);
    killWith(sim, first.boss, [p1]);
    expect((first.boss.loot?.items ?? []).length).toBeGreaterThan(0);
    // p1 dies / walks away: the corpse window lapses unlooted.

    (sim as any).worldBossEntityIds[0] = null;
    const second = spawnBossNow(sim);
    killWith(sim, second.boss, [p1]);
    const ownedBySecond = (second.boss.loot?.items ?? []).flatMap((s) => s.personalFor ?? []);
    expect(ownedBySecond).toContain(p1); // still eligible: the kill alone burned nothing
  });

  it('produces identical personal loot for the same seed (determinism)', () => {
    const run = () => {
      const sim = makeSim(99);
      sim.utcDay = DAY;
      const p1 = sim.addPlayer('warrior', 'Ada');
      const p2 = sim.addPlayer('rogue', 'Bru');
      const { boss } = spawnBossNow(sim);
      killWith(sim, boss, [p1, p2]);
      return JSON.stringify(boss.loot?.items ?? []);
    };
    expect(run()).toBe(run());
  });
});
