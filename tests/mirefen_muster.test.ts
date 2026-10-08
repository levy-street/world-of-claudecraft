// The Mirefen muster: the army Balgath's warpath now marches on (src/sim/mirefen_muster.ts,
// its posts in src/sim/content/mirefen_muster.ts, the soldier AI arm in
// src/sim/mob/muster_soldier.ts and the lethal-collateral rule in mob/boss_collateral.ts).
//
// Two layers. The placement rules are measured against the real heightfield and camp
// table (dry, clear of wildlife, out of the crater bowl). The behavior runs in a live Sim:
// the muster rises with the boss, soldiers stay friendly, untouchable and out of every
// hate table, the arrival slam at each picket kills the squad standing in it and spares the
// sentries, and the fallen stay down for the WHOLE fight (a brief evade included) and stand
// back up only once he falls, a reset pull has stayed quiet, or at a dawn he is not fighting.
import { describe, expect, it } from 'vitest';
import {
  MUSTER_CAMPS,
  MUSTER_CIRCUIT,
  MUSTER_INNER_RADIUS,
  MUSTER_RACK,
  MUSTER_RACK_TEMPLATE_ID,
  musterCamp,
} from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import {
  MUSTER_BRACE_RANGE,
  MUSTER_BRACE_RELEASE_RANGE,
  MUSTER_FACING_STEP,
  MUSTER_RESPAWN_DELAY,
  MUSTER_STAND_DOWN_SECONDS,
  type MusterArmyState,
  nextStandUp,
  tickMusterArmy,
} from '../src/sim/mirefen_muster';
import { blindEyeWard } from '../src/sim/mob/eye_ward';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { CampDef, Entity, WorldContent } from '../src/sim/types';
import {
  groundHeight,
  isInWaterBody,
  MIREFEN_IMPACT_CRATER,
  terrainHeight,
  waterLevel,
} from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

const BALGATH = 'balgath_cyclops';

function lair(): { x: number; z: number } {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row.pos;
}

/** A camp-free world (the warpath suite's trick): only the bodies under test tick. */
function testWorld(camps: CampDef[] = []): WorldContent {
  return { ...BUILTIN_WORLD, camps, npcs: {}, groundObjects: [] };
}

interface Internals {
  ctx: SimContext;
  musterArmy: MusterArmyState;
  spawnDevBoss(t: string, x: number, z: number): number;
  setGm(pid?: number, on?: boolean): void;
  setDevMobsFrozen(on?: boolean): boolean;
  dealDamage(...a: unknown[]): number;
}
const inner = (sim: Sim) => sim as unknown as Internals;

/** Spawn Balgath at his bed and tick until the muster answers (the dev-spawn scan). */
function raise(sim: Sim): Entity {
  const id = inner(sim).spawnDevBoss(BALGATH, lair().x, lair().z);
  const boss = sim.entities.get(id);
  if (!boss) throw new Error('no boss');
  for (let i = 0; i < 25 && inner(sim).musterArmy.soldierIds.length === 0; i++) sim.tick();
  return boss;
}

/** A chip hit from the player, the way a raid keeps a pull alive (warpathGiveUp). */
function harry(sim: Sim, boss: Entity): void {
  inner(sim).dealDamage(sim.player, boss, 20, false, 'physical', 'probe', 'hit', true);
}

/** soldier entity id -> the camp that posted him (soldierIds follows MUSTER_CAMPS order). */
function campOfSoldier(army: MusterArmyState): Map<number, string> {
  const out = new Map<number, string>();
  let i = 0;
  for (const camp of MUSTER_CAMPS)
    for (const post of camp.soldiers)
      if (post.templateId !== 'muster_commander') out.set(army.soldierIds[i++], camp.id);
  return out;
}

const place = (sim: Sim, e: Entity, x: number, z: number) => {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
};

describe('muster placement (measured)', () => {
  const wl = waterLevel();
  const ground = (x: number, z: number) =>
    Math.min(terrainHeight(x, z, WORLD_SEED), groundHeight(x, z, WORLD_SEED));

  it('puts every camp and every post on dry ground, out of the crater bowl', () => {
    for (const camp of MUSTER_CAMPS) {
      for (let dx = -10; dx <= 10; dx += 2) {
        for (let dz = -10; dz <= 10; dz += 2) {
          if (dx * dx + dz * dz > 100) continue;
          const x = camp.center.x + dx;
          const z = camp.center.z + dz;
          expect(isInWaterBody(x, z), `${camp.id} footprint in water at ${x},${z}`).toBe(false);
          expect(ground(x, z) - wl, `${camp.id} footprint shallow at ${x},${z}`).toBeGreaterThan(
            1.5,
          );
        }
      }
      for (const slot of camp.soldiers) {
        const x = camp.center.x + slot.dx;
        const z = camp.center.z + slot.dz;
        expect(ground(x, z) - wl, `${camp.id} post at ${x},${z}`).toBeGreaterThan(1.5);
        expect(
          Math.hypot(x - MIREFEN_IMPACT_CRATER.x, z - MIREFEN_IMPACT_CRATER.z),
          `${camp.id} post in the crater bowl`,
        ).toBeGreaterThan(MIREFEN_IMPACT_CRATER.bowlRadius + 2);
      }
    }
  });

  it('keeps every camp and post clear of every wildlife camp by aggro reach plus margin', () => {
    // MAX_AGGRO_RADIUS is 20; a quester standing at a picket must never pull the thicket.
    for (const camp of MUSTER_CAMPS) {
      for (const wild of BUILTIN_WORLD.camps) {
        const d = Math.hypot(camp.center.x - wild.center.x, camp.center.z - wild.center.z);
        expect(d - wild.radius, `${camp.id} vs ${wild.mobId}`).toBeGreaterThan(29);
        for (const slot of camp.soldiers) {
          const sx = camp.center.x + slot.dx;
          const sz = camp.center.z + slot.dz;
          const ds = Math.hypot(sx - wild.center.x, sz - wild.center.z);
          expect(ds - wild.radius, `${camp.id} post vs ${wild.mobId}`).toBeGreaterThan(22);
        }
      }
    }
  });

  it('packs each picket so an arrival slam lands on most of it and spares its sentries', () => {
    const wreck = MOBS[BALGATH]?.warpath?.wreck.radius ?? 0;
    const arrive = MOBS[BALGATH]?.warpath?.arriveRadius ?? 0;
    for (const id of MUSTER_CIRCUIT) {
      const camp = musterCamp(id);
      const innerRing = camp.soldiers.filter((s) => Math.hypot(s.dx, s.dz) <= MUSTER_INNER_RADIUS);
      const sentries = camp.soldiers.filter((s) => Math.hypot(s.dx, s.dz) > MUSTER_INNER_RADIUS);
      expect(innerRing.length, `${id} inner ring`).toBeGreaterThanOrEqual(5);
      expect(innerRing.length).toBeGreaterThan(sentries.length);
      // Wherever inside arriveRadius he plants, the whole inner ring is under the ring...
      expect(MUSTER_INNER_RADIUS + arrive).toBeLessThan(wreck);
      // ...and every sentry is outside it.
      for (const s of sentries) expect(Math.hypot(s.dx, s.dz) - arrive).toBeGreaterThan(wreck);
    }
  });

  it('keeps the weapon rack at the command camp, which is never a stop', () => {
    const command = musterCamp('command');
    expect(command.onCircuit).toBe(false);
    expect(
      Math.hypot(MUSTER_RACK.x - command.center.x, MUSTER_RACK.z - command.center.z),
    ).toBeLessThan(8);
  });
});

describe('the muster in a live world', () => {
  it('rises with the boss, never before, with a friendly squad at every camp and the rack', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: testWorld() });
    for (let i = 0; i < 60; i++) sim.tick();
    // No boss, no muster: a world that never sees him keeps every entity id it had.
    expect(inner(sim).musterArmy.soldierIds).toEqual([]);
    raise(sim);
    const army = inner(sim).musterArmy;
    // Every post but the commander's: he is an NPC (the muster quests), raised beside them.
    const total = MUSTER_CAMPS.reduce(
      (n, c) => n + c.soldiers.filter((s) => s.templateId !== 'muster_commander').length,
      0,
    );
    expect(army.soldierIds.length).toBe(total);
    expect(sim.entities.get(army.commanderId ?? -1)?.kind).toBe('npc');
    expect(total).toBeGreaterThanOrEqual(30);
    for (const id of army.soldierIds) {
      const s = sim.entities.get(id);
      expect(s?.kind).toBe('mob');
      expect(s?.hostile).toBe(false);
      // Untouchable: the ordinary hostility rule refuses every player attack on him.
      expect(sim.isHostileTo(sim.player, s as Entity)).toBe(false);
    }
    const rack = army.rackId !== null ? sim.entities.get(army.rackId) : undefined;
    expect(rack?.templateId).toBe(MUSTER_RACK_TEMPLATE_ID);
    expect(rack?.kind).toBe('object');
  });

  it('is left alone by wildlife and leaves wildlife alone', () => {
    // A widow camp dropped right on the west picket: the widows scan for PLAYERS only, the
    // soldiers never scan at all, and neither side ever takes the other as a target.
    const west = musterCamp('west');
    const widows: CampDef = {
      mobId: 'mire_widow',
      center: { x: west.center.x + 7, z: west.center.z },
      radius: 1.5,
      count: 3,
      offStream: true,
    };
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: true,
      world: testWorld([widows]),
    });
    raise(sim);
    const army = inner(sim).musterArmy;
    for (let i = 0; i < 20 * 20; i++) sim.tick();
    const soldiers = army.soldierIds.map((id) => sim.entities.get(id) as Entity);
    for (const s of soldiers) {
      expect(s.dead).toBe(false);
      expect(s.hp).toBe(s.maxHp);
      expect(s.inCombat).toBe(false);
      expect(s.threat.size).toBe(0);
    }
    const spiders = [...sim.entities.values()].filter((e) => e.templateId === 'mire_widow');
    expect(spiders.length).toBe(3);
    const soldierIds = new Set(army.soldierIds);
    for (const w of spiders) {
      expect(w.aggroTargetId === null || !soldierIds.has(w.aggroTargetId)).toBe(true);
      for (const id of w.threat.keys()) expect(soldierIds.has(id)).toBe(false);
    }
  });

  it('wrecks each picket in turn: the squad in the ring dies, the sentries live, no hate table ever sees a soldier', () => {
    // Through the SCHEDULER this time (worldBossAtBoot, as the live realm boots), so his
    // participant HP scaling is live and can prove no soldier ever counted as one.
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: true,
      world: testWorld(),
      worldBossAtBoot: true,
    });
    sim.setPlayerLevel(20);
    inner(sim).setGm(sim.playerId, true);
    const player = sim.player;
    place(sim, player, lair().x, lair().z - 18);
    sim.tick();
    const bossId = inner(sim).musterArmy.bossId;
    const boss = bossId !== null ? (sim.entities.get(bossId) as Entity) : null;
    if (!boss) throw new Error('the scheduler raised no Balgath');
    const army = inner(sim).musterArmy;
    const campOf = campOfSoldier(army);
    const soldierIds = new Set(army.soldierIds);
    const stops = MOBS[BALGATH]?.warpath?.destinations ?? [];
    const wreckRadius = MOBS[BALGATH]?.warpath?.wreck.radius ?? 0;

    let ringFor: number | null = null;
    let aliveAtRing = new Set<number>();
    const results: { stop: number; dead: number; innerDead: boolean; sentriesSpared: boolean }[] =
      [];
    let soldierDamage = 0;
    for (let i = 0; i < 20 * 260 && results.length < stops.length; i++) {
      // A chip hit a second: a pull nobody hurts for 30 seconds is one he gives up on.
      if (i % 20 === 0) harry(sim, boss);
      const d = Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
      if (d > 6) {
        const a = Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z);
        player.pos.x += Math.sin(a) * 7 * 0.05;
        player.pos.z += Math.cos(a) * 7 * 0.05;
        player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
      }
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && soldierIds.has(ev.sourceId)) soldierDamage++;
        if (ev.type !== 'spellfxAt' || ev.radius !== wreckRadius) continue;
        if (ev.fx === 'runeCircle') {
          ringFor = boss.warpathDestination ?? 0;
          aliveAtRing = new Set(army.soldierIds.filter((id) => !sim.entities.get(id)?.dead));
        }
        if (ev.fx === 'nova' && ringFor !== null) {
          const campId = MUSTER_CIRCUIT[ringFor];
          const camp = musterCamp(campId);
          const mine = army.soldierIds.filter((id) => campOf.get(id) === campId);
          let dead = 0;
          let innerDead = true;
          let sentriesSpared = true;
          for (const id of mine) {
            const s = sim.entities.get(id) as Entity;
            if (s.dead) dead++;
            const r = Math.hypot(s.spawnPos.x - camp.center.x, s.spawnPos.z - camp.center.z);
            if (r <= MUSTER_INNER_RADIUS && !s.dead) innerDead = false;
            if (r > MUSTER_INNER_RADIUS && aliveAtRing.has(id) && s.dead) sentriesSpared = false;
          }
          results.push({ stop: ringFor, dead, innerDead, sentriesSpared });
          ringFor = null;
        }
      }
      // Never a soldier on the boss's hate table or loot roster, at any tick.
      for (const id of boss.threat.keys()) expect(soldierIds.has(id)).toBe(false);
      for (const id of boss.bossDamagers) expect(soldierIds.has(id)).toBe(false);
    }
    expect(results.map((r) => r.stop)).toEqual([0, 1, 2, 3]);
    for (const r of results) {
      expect(r.innerDead, `the inner ring at ${MUSTER_CIRCUIT[r.stop]}`).toBe(true);
      expect(r.dead, `dead at ${MUSTER_CIRCUIT[r.stop]}`).toBeGreaterThanOrEqual(5);
      expect(r.sentriesSpared, `sentries at ${MUSTER_CIRCUIT[r.stop]}`).toBe(true);
    }
    expect(soldierDamage, 'a soldier dealt damage').toBe(0);
    // His pool is the world-boss base plus nothing: no soldier ever counted as a participant.
    const base = WORLD_BOSSES.find((b) => b.templateId === BALGATH)?.hpScale.base ?? 0;
    expect(boss.maxHp).toBe(base);
    // The command camp was never touched.
    for (const [id, campId] of campOf) {
      if (campId === 'command') expect(sim.entities.get(id)?.dead).toBe(false);
    }
  });

  it('braces while he is engaged and close, faces him, and cheers when his eye goes out', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: testWorld() });
    sim.setPlayerLevel(20);
    inner(sim).setGm(sim.playerId, true);
    place(sim, sim.player, lair().x, lair().z - 18);
    const boss = raise(sim);
    const army = inner(sim).musterArmy;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(boss.inCombat).toBe(true);
    const near = army.soldierIds
      .map((id) => sim.entities.get(id) as Entity)
      .filter(
        (s) =>
          !s.dead &&
          Math.hypot(s.pos.x - boss.pos.x, s.pos.z - boss.pos.z) < MUSTER_BRACE_RANGE - 2,
      );
    expect(near.length).toBeGreaterThan(0);
    for (const s of near) {
      expect(s.aggroTargetId).toBe(boss.id);
      const want = Math.atan2(boss.pos.x - s.pos.x, boss.pos.z - s.pos.z);
      let err = Math.abs(want - s.facing);
      while (err > Math.PI) err = Math.abs(err - 2 * Math.PI);
      // Re-aimed in steps (a head-turn, not a 20 Hz track), never further off than one step.
      expect(err).toBeLessThanOrEqual(MUSTER_FACING_STEP + 1e-9);
      // Braced is not fighting: never in combat, never a hate table.
      expect(s.inCombat).toBe(false);
      expect(s.threat.size).toBe(0);
    }
    blindEyeWard(inner(sim).ctx, boss);
    sim.tick();
    expect(near.some((s) => s.overheadEmoteId === 'cheer')).toBe(true);
  });

  it('stands the fallen back up once the pull ends, and at dawn at the latest', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: testWorld() });
    sim.setPlayerLevel(20);
    inner(sim).setGm(sim.playerId, true);
    place(sim, sim.player, lair().x, lair().z - 18);
    const boss = raise(sim);
    const army = inner(sim).musterArmy;
    const victim = sim.entities.get(army.soldierIds[0]) as Entity;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(army.engaged).toBe(true);
    inner(sim).dealDamage(boss, victim, victim.maxHp * 10, false, 'physical', 'probe', 'hit', true);
    expect(victim.dead).toBe(true);
    // Down for as long as the fight goes on: the ordinary respawn timer never fires. The
    // raid keeps hitting him, or the fight would end on its own (he gives up an unhurt pull).
    for (let i = 0; i < 20 * 30; i++) {
      if (i % 20 === 0) harry(sim, boss);
      sim.tick();
    }
    expect(victim.dead).toBe(true);
    // The pull ends (he falls): after the short grace, the muster stands its dead up.
    boss.hp = 1;
    inner(sim).dealDamage(sim.player, boss, 5000, false, 'physical', 'probe', 'hit', true);
    expect(boss.dead).toBe(true);
    for (let i = 0; i < 20 * (MUSTER_RESPAWN_DELAY - 1); i++) sim.tick();
    expect(victim.dead).toBe(true);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(victim.dead).toBe(false);
    expect(victim.hostile).toBe(false);
    expect(
      Math.hypot(victim.pos.x - victim.spawnPos.x, victim.pos.z - victim.spawnPos.z),
    ).toBeLessThan(0.01);

    // Dawn stands them up outright, pull or no pull.
    inner(sim).dealDamage(boss, victim, victim.maxHp * 10, false, 'physical', 'probe', 'hit', true);
    expect(victim.dead).toBe(true);
    tickMusterArmy(inner(sim).ctx, army, null, true);
    expect(victim.dead).toBe(false);
  });
});

describe('the fallen stay down for the whole fight', () => {
  it('stands them up only at the true end: never engaged, his death soon, a reset slowly, a free dawn at once', () => {
    const quiet = { engaged: false, fell: false, pullEnded: false, dawn: false };
    // Mid-fight nothing rises, whatever was pending and even at sunrise.
    expect(nextStandUp(100, 50, { ...quiet, engaged: true })).toBeNull();
    expect(nextStandUp(null, 50, { ...quiet, engaged: true, dawn: true })).toBeNull();
    // He fell: the short delay.
    expect(nextStandUp(null, 50, { ...quiet, fell: true, pullEnded: true })).toBe(
      50 + MUSTER_RESPAWN_DELAY,
    );
    // Any other end of the pull (an evade, a leash, a wipe): the long quiet.
    expect(nextStandUp(null, 50, { ...quiet, pullEnded: true })).toBe(
      50 + MUSTER_STAND_DOWN_SECONDS,
    );
    expect(MUSTER_STAND_DOWN_SECONDS).toBeGreaterThanOrEqual(120);
    expect(MUSTER_STAND_DOWN_SECONDS).toBeLessThanOrEqual(180);
    // A dawn he is not fighting through: at once.
    expect(nextStandUp(500, 50, { ...quiet, dawn: true })).toBe(50);
    // Otherwise the clock holds.
    expect(nextStandUp(77, 50, quiet)).toBe(77);
    expect(nextStandUp(null, 50, quiet)).toBeNull();
  });

  /** An engaged boss with one soldier already dead at his fists, and the mob AI frozen so
   *  the test alone decides when the pull blips and ends (the muster pass still runs every
   *  tick, through the real scheduler hook). */
  function midFight() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: testWorld() });
    sim.setPlayerLevel(20);
    inner(sim).setGm(sim.playerId, true);
    place(sim, sim.player, lair().x, lair().z - 18);
    const boss = raise(sim);
    const army = inner(sim).musterArmy;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(army.engaged).toBe(true);
    const victim = sim.entities.get(army.soldierIds[0]) as Entity;
    inner(sim).dealDamage(boss, victim, victim.maxHp * 10, false, 'physical', 'probe', 'hit', true);
    expect(victim.dead).toBe(true);
    inner(sim).setDevMobsFrozen(true);
    const ticks = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) sim.tick();
    };
    return { sim, boss, army, victim, ticks };
  }

  it('keeps them down through a brief evade blip, and long past the old 12 seconds', () => {
    const { boss, army, victim, ticks } = midFight();
    // He drops out of combat for three seconds (a leash, an evade), then the raid has him
    // again. That is NOT the end of the pull.
    boss.inCombat = false;
    ticks(3);
    expect(army.engaged).toBe(false);
    boss.inCombat = true;
    ticks(0.1);
    expect(army.engaged).toBe(true);
    expect(army.respawnAt).toBeNull();
    // Well past the delay the old rule stood them up on (mid-fight, in front of the raid).
    ticks(MUSTER_RESPAWN_DELAY * 4);
    expect(victim.dead).toBe(true);
  });

  it('stands them up after a reset only once it has stayed quiet for the stand-down', () => {
    const { boss, victim, ticks } = midFight();
    boss.inCombat = false; // the raid wiped or walked away: he reset
    ticks(MUSTER_STAND_DOWN_SECONDS - 2);
    expect(victim.dead).toBe(true);
    ticks(3);
    expect(victim.dead).toBe(false);
    expect(victim.hostile).toBe(false);
  });

  it('never stands them up at a dawn he is still fighting through', () => {
    const { sim, boss, army, victim, ticks } = midFight();
    tickMusterArmy(inner(sim).ctx, army, boss, true);
    expect(victim.dead).toBe(true);
    ticks(MUSTER_RESPAWN_DELAY * 2);
    expect(victim.dead).toBe(true);
    // ...and his death is the true end: the short delay, then up.
    boss.inCombat = false;
    boss.dead = true;
    ticks(MUSTER_RESPAWN_DELAY + 1);
    expect(victim.dead).toBe(false);
  });
});

describe('the guard is held, not flickered', () => {
  it('raises inside the brace range and lowers only past the wider release range', () => {
    expect(MUSTER_BRACE_RELEASE_RANGE).toBeGreaterThan(MUSTER_BRACE_RANGE + 4);
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, world: testWorld() });
    sim.setPlayerLevel(20);
    inner(sim).setGm(sim.playerId, true);
    place(sim, sim.player, lair().x, lair().z - 18);
    const boss = raise(sim);
    const army = inner(sim).musterArmy;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(army.engaged).toBe(true);
    inner(sim).setDevMobsFrozen(true);
    const s = sim.entities.get(army.soldierIds[army.soldierIds.length - 1]) as Entity;
    // Put him `d` yards due north of this soldier and run one pass.
    const at = (d: number) => {
      place(sim, boss, s.pos.x, s.pos.z + d);
      sim.tick();
      return s.aggroTargetId === boss.id;
    };
    expect(at(MUSTER_BRACE_RANGE - 3)).toBe(true);
    // Pacing out through the band keeps the guard up...
    expect(at(MUSTER_BRACE_RANGE + 3)).toBe(true);
    expect(at(MUSTER_BRACE_RELEASE_RANGE - 1)).toBe(true);
    // ...past it, down.
    expect(at(MUSTER_BRACE_RELEASE_RANGE + 2)).toBe(false);
    // Coming back into the band does not raise it: only the brace range does.
    expect(at(MUSTER_BRACE_RANGE + 3)).toBe(false);
    expect(at(MUSTER_BRACE_RANGE - 3)).toBe(true);
  });
});
