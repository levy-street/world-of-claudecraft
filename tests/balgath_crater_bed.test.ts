// Balgath sleeps IN the Starfall Crater, and only players start his fight.
//
// Two owner playtest reports pinned here. First, his bed sat beside the crater on its rim,
// not in the bowl: it now sits on the bowl's scorched floor, measured dry (the bowl bottoms
// out within a yard of the fen's waterline, so "dry" is a real constraint, not a formality),
// and with no raid-floor calm pad, so the crater fixture keeps the shape Brother Aldric's
// star gave it. Second, a soldier posted ten yards from his bed looked like it was pulling
// him: a player walking up to that soldier was inside his aggro radius. Every muster post
// now stands outside it, and a live world proves a player standing at ANY post, or nobody
// at all, never starts the fight, and that no soldier ever does.
import { describe, expect, it } from 'vitest';
import { buildRealmSimConfig } from '../server/sim_boot_config';
import { MUSTER_CAMPS } from '../src/sim/content/mirefen_muster';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { phaseToCycleMs } from '../src/sim/day_night';
import type { MusterArmyState } from '../src/sim/mirefen_muster';
import { MAX_AGGRO_RADIUS } from '../src/sim/mob/aggro_ranges';
import { Sim } from '../src/sim/sim';
import { inertVaultConsumptionAdmission } from '../src/sim/sim_context';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';
import type { Entity, WorldContent } from '../src/sim/types';
import {
  groundHeight,
  isInWaterBody,
  MIREFEN_IMPACT_CRATER,
  mirefenImpactCraterOffset,
  terrainHeight,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_BOSSES } from '../src/sim/world_boss';
import { WORLD_SEED } from '../src/sim/world_seed';

const BALGATH = 'balgath_cyclops';

function bossDef() {
  const row = WORLD_BOSSES.find((b) => b.templateId === BALGATH);
  if (!row) throw new Error('balgath_cyclops is not in WORLD_BOSSES');
  return row;
}
const bed = () => bossDef().pos;
const fromCrater = (x: number, z: number) =>
  Math.hypot(x - MIREFEN_IMPACT_CRATER.x, z - MIREFEN_IMPACT_CRATER.z);

/** Every muster post in the world, with the camp that posted it. */
function posts(): { x: number; z: number; camp: string }[] {
  const out: { x: number; z: number; camp: string }[] = [];
  for (const camp of MUSTER_CAMPS) {
    for (const s of camp.soldiers) {
      out.push({ x: camp.center.x + s.dx, z: camp.center.z + s.dz, camp: camp.id });
    }
  }
  return out;
}

describe('his bed is in the crater', () => {
  it('sits inside the bowl, on its scorched floor, not on the rim', () => {
    const { x, z } = bed();
    expect(fromCrater(x, z)).toBeLessThan(MIREFEN_IMPACT_CRATER.bowlRadius - 4);
    // Down in it: the crater's own carve is under him, and his bed is lower than the rim.
    expect(mirefenImpactCraterOffset(x, z)).toBeLessThan(-0.3);
    const rimRadius = MIREFEN_IMPACT_CRATER.bowlRadius + 4;
    let rimLowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      rimLowest = Math.min(
        rimLowest,
        terrainHeight(
          MIREFEN_IMPACT_CRATER.x + Math.cos(a) * rimRadius,
          MIREFEN_IMPACT_CRATER.z + Math.sin(a) * rimRadius,
          WORLD_SEED,
        ),
      );
    }
    expect(terrainHeight(x, z, WORLD_SEED)).toBeLessThan(rimLowest);
  });

  it('keeps him in the bowl: he holds his spot while idle and lies down inside it', () => {
    // A wandering giant walked out of the crater by day, and a loose bed let him lie down
    // on its rim at night: the owner saw him beside the crater, not in it.
    expect(MOBS[BALGATH]?.idleStationary).toBe(true);
    const bedRadius = MOBS[BALGATH]?.slumber?.bedRadius ?? Number.POSITIVE_INFINITY;
    expect(fromCrater(bed().x, bed().z) + bedRadius).toBeLessThan(
      MIREFEN_IMPACT_CRATER.bowlRadius - 1,
    );
  });

  it('is dry under his whole sleeping body: no lake, no sea, a yard above the waterline', () => {
    // He lies thirteen yards long; the whole disc he can lie across is measured.
    const wl = waterLevel();
    const { x: bx, z: bz } = bed();
    for (let r = 0; r <= 7; r += 1) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x = bx + Math.cos(a) * r;
        const z = bz + Math.sin(a) * r;
        expect(isInWaterBody(x, z), `lake at ${x},${z}`).toBe(false);
        expect(waterLevelAt(x, z, WORLD_SEED)).toBe(Number.NEGATIVE_INFINITY);
        const ground = Math.min(terrainHeight(x, z, WORLD_SEED), groundHeight(x, z, WORLD_SEED));
        expect(ground - wl, `shallow bed at ${x},${z}`).toBeGreaterThan(1);
      }
    }
  });

  it('keeps the crater its own shape: no raid-floor calm pad anywhere near the bowl', () => {
    // A world-boss pad calms the natural relief to the legacy field over up to 54 yards;
    // one here would re-grade the fixture he sleeps in. He opts out, and no pad of that
    // category may reach the crater from anywhere else either.
    expect(bossDef().raidFloorPad).toBe(false);
    const reach = MIREFEN_IMPACT_CRATER.radius + 18 + 36;
    for (const row of collectCalmAnchorPads()) {
      if (row.category !== 'worldBoss') continue;
      expect(fromCrater(row.x, row.z), `a world-boss pad at ${row.x},${row.z}`).toBeGreaterThan(
        reach,
      );
    }
    // Thunzharr still keeps his: the category is not gone, only this boss's row.
    expect(collectCalmAnchorPads().some((row) => row.category === 'worldBoss')).toBe(true);
  });
});

describe('only players start his fight', () => {
  it('posts every soldier outside his aggro radius of the bed', () => {
    // His authored radius (26) is wider than any player detection can reach (the idle scan
    // clamps to MAX_AGGRO_RADIUS), so a post outside it leaves a player standing beside the
    // soldier well clear of him.
    const radius = MOBS[BALGATH]?.aggroRadius ?? 0;
    expect(radius).toBeGreaterThanOrEqual(MAX_AGGRO_RADIUS);
    for (const p of posts()) {
      expect(
        Math.hypot(p.x - bed().x, p.z - bed().z),
        `a ${p.camp} post at ${p.x},${p.z}`,
      ).toBeGreaterThan(radius);
    }
  });

  const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
  interface Internals {
    musterArmy: MusterArmyState;
  }

  function liveWorld(): { sim: Sim; boss: Entity; army: MusterArmyState } {
    // The realm's boot shape: the scheduler spawns him at boot and the muster stands.
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      autoEquip: true,
      world: WORLD,
      worldBossAtBoot: true,
      mirefenMuster: true,
    });
    // A low-level local: the widest detection his level advantage can buy (the cap).
    sim.setPlayerLevel(6);
    sim.player.pos = { ...sim.player.pos, x: bed().x - 120, z: bed().z };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    const boss = [...sim.entities.values()].find((e) => e.templateId === BALGATH);
    if (!boss) throw new Error('the scheduler did not spawn him at boot');
    const army = (sim as unknown as Internals).musterArmy;
    expect(army.soldierIds.length).toBeGreaterThan(30);
    return { sim, boss, army };
  }

  function expectUnpulled(boss: Entity, army: MusterArmyState, where: string): void {
    expect(boss.inCombat, where).toBe(false);
    expect(boss.aiState, where).toBe('idle');
    expect(boss.aggroTargetId, where).toBeNull();
    expect(boss.threat.size, where).toBe(0);
    for (const id of army.soldierIds) expect(boss.threat.has(id), where).toBe(false);
  }

  it('stays asleep on his feet with the whole muster around him and no player near', () => {
    const { sim, boss, army } = liveWorld();
    const soldiers = new Set(army.soldierIds);
    for (let i = 0; i < 20 * 60; i++) {
      sim.tick();
      if (boss.aggroTargetId !== null) expect(soldiers.has(boss.aggroTargetId)).toBe(false);
    }
    expectUnpulled(boss, army, 'no player near');
    // A minute idle and he has not wandered off his bed in the crater.
    expect(Math.hypot(boss.pos.x - bed().x, boss.pos.z - bed().z)).toBeLessThan(0.5);
    for (const id of army.soldierIds) {
      const s = sim.entities.get(id) as Entity;
      expect(s.inCombat).toBe(false);
      expect(s.aggroTargetId).toBeNull();
    }
  });

  it('is not pulled by a player standing at any soldier, the one by his bed included', () => {
    const { sim, boss, army } = liveWorld();
    for (const p of posts()) {
      // Beside the soldier, on the side toward his bed: the closest a player gets to him
      // while visiting that post.
      const d = Math.hypot(bed().x - p.x, bed().z - p.z);
      const x = p.x + ((bed().x - p.x) / d) * 1.5;
      const z = p.z + ((bed().z - p.z) / d) * 1.5;
      sim.player.pos = { x, y: terrainHeight(x, z, WORLD_SEED), z };
      sim.player.prevPos = { ...sim.player.pos };
      for (let i = 0; i < 10; i++) sim.tick();
      expect(sim.player.dead).toBe(false);
      expectUnpulled(boss, army, `player at the ${p.camp} post ${p.x},${p.z}`);
    }
    // Control: walking INTO his radius does pull him, so the loop above measured something.
    // (Godded, or the level six is dead before the assertion and he has already evaded.)
    (sim as unknown as { setGm(pid?: number, on?: boolean): void }).setGm(sim.playerId, true);
    sim.player.pos = {
      x: bed().x - 10,
      y: terrainHeight(bed().x - 10, bed().z, WORLD_SEED),
      z: bed().z,
    };
    sim.player.prevPos = { ...sim.player.pos };
    for (let i = 0; i < 10; i++) sim.tick();
    expect(boss.inCombat).toBe(true);
    expect(boss.aggroTargetId).toBe(sim.playerId);
  });

  it('the realm boot config, by day: nobody at his bed, then a local at every post, and he never wakes to them', () => {
    // The server path: the exact Sim configuration the realm GameServer boots (scheduler
    // at boot, the muster from boot, the idle-AI distance cull, the day/night clock),
    // with the clock pinned to noon so he is awake and pullable the whole time.
    const noon = phaseToCycleMs(0.5);
    const sim = new Sim({
      ...buildRealmSimConfig(undefined, inertVaultConsumptionAdmission),
      dayNightNowMs: () => noon,
    });
    const pid = sim.addPlayer('warrior', 'Probe', { tutorialGreetingSent: true });
    const p = sim.entities.get(pid) as Entity;
    // Godded: a level-one probe left among the fen's wildlife would otherwise die, and a
    // dead player pulls nothing, which would make every assertion below vacuous.
    (sim as unknown as { setGm(pid?: number, on?: boolean): void }).setGm(pid, true);
    const put = (x: number, z: number) => {
      p.pos = { x, y: terrainHeight(x, z, WORLD_SEED), z };
      p.prevPos = { ...p.pos };
    };
    // Nobody near: parked at the command camp's rack, a hundred yards south of his bed.
    put(146, 213);
    for (let i = 0; i < 20 * 20; i++) sim.tick();
    const boss = [...sim.entities.values()].find((e) => e.templateId === BALGATH);
    if (!boss) throw new Error('the realm did not spawn him at boot');
    const army = (sim as unknown as Internals).musterArmy;
    expect(boss.asleep ?? false).toBe(false);
    expect(boss.hostile).toBe(true);
    expectUnpulled(boss, army, 'realm, nobody near');
    for (const post of posts()) {
      const d = Math.hypot(bed().x - post.x, bed().z - post.z);
      put(post.x + ((bed().x - post.x) / d) * 1.5, post.z + ((bed().z - post.z) / d) * 1.5);
      for (let i = 0; i < 10; i++) sim.tick();
      expect(p.dead, `the probe died at the ${post.camp} post`).toBe(false);
      expectUnpulled(boss, army, `realm, a player at the ${post.camp} post`);
    }
    // Control: ten yards from him the same player does pull him, so the loop measured a
    // world in which a pull was possible.
    put(boss.pos.x - 10, boss.pos.z);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(boss.inCombat).toBe(true);
    expect(boss.aggroTargetId).toBe(pid);
  });
});
