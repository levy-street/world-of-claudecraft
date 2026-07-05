// Focused tests for the Tolling Bells boss mechanic (Stage 3).
// Drives Sister Nhalia's tick driver and asserts:
//   - a volley spawns the correct bell count (Normal vs Heroic)
//   - each bell entity moves over ticks
//   - contact with a player deals damage and displaces the player outward
//   - bells expire/despawn after their lifetime elapses

import { describe, expect, it } from 'vitest';
import { DELVES, MOBS } from '../src/sim/data';
import { initDrownedLitanyBossState } from '../src/sim/delves/drowned_litany_boss';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const BELL_TEMPLATE_ID = 'tolling_bell';
const SISTER_NHALIA_ID = 'sister_nhalia_drowned_canticle';
// One sim tick = DT = 1/20 seconds.
const DT = 1 / 20;

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function teleport(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

// Enter the Drowned Litany and jump directly to the Apse (finale) module.
// Returns the run so callers can immediately manipulate boss state.
function enterLitanyFinale(sim: Sim, tier: 'normal' | 'heroic' = 'normal') {
  const delve = DELVES.drowned_litany;
  const heroicTier = delve.tiers.find((t) => t.id === 'heroic');
  const level = tier === 'heroic' ? (heroicTier?.minPlayerLevel ?? delve.minLevel) : delve.minLevel;
  sim.setPlayerLevel(level);
  const door = delve.doorPos;
  teleport(sim, door.x, door.z);
  sim.enterDelve('drowned_litany', tier);

  // Jump directly to the finale module (Apse) by overwriting the module list.
  // We use delveRunForPlayer to get the authoritative run object.
  const run: any = sim.delveRunForPlayer(sim.playerId);
  if (!run) return null;
  run.modules = [delve.finaleModuleId];
  run.moduleIndex = 0;
  run.mobIds = [];
  run.objectIds = [];
  run.objectState = {};
  (sim as any).spawnDelveModule(run);
  return run;
}

// Find Nhalia in the run mob list.
function findNhalia(sim: Sim, run: any): any {
  for (const mid of run.mobIds) {
    const e = (sim as any).entities.get(mid);
    if (e && e.templateId === SISTER_NHALIA_ID) return e;
  }
  return null;
}

// Put Nhalia into combat state and ensure nhaliaBoss state is initialized.
function setupNhaliaCombat(sim: Sim, run: any): any {
  const boss = findNhalia(sim, run);
  if (!boss) return null;
  // Stand near boss so she enters combat.
  sim.player.pos.x = boss.pos.x + 1;
  sim.player.pos.z = boss.pos.z + 1;
  sim.player.pos.y = boss.pos.y;
  sim.player.prevPos = { ...sim.player.pos };
  // Force combat state.
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  // Ensure nhaliaBoss state is present.
  if (!run.nhaliaBoss) {
    initDrownedLitanyBossState(run);
  }
  return boss;
}

function countBellEntities(sim: Sim): number {
  let n = 0;
  (sim as any).entities.forEach((e: any) => {
    if (!e.dead && e.templateId === BELL_TEMPLATE_ID) n++;
  });
  return n;
}

describe('Tolling Bells: mob template', () => {
  it('tolling_bell template exists and is correctly configured', () => {
    const tmpl = MOBS[BELL_TEMPLATE_ID];
    expect(tmpl).toBeDefined();
    expect(tmpl.aggroRadius).toBe(0);
    expect(tmpl.loot).toHaveLength(0);
    expect(tmpl.ccImmune).toBe(true);
    // Must NOT be in the boss list (cannot trigger onDelveBossDefeated).
    expect(DELVES.drowned_litany.bosses).not.toContain(BELL_TEMPLATE_ID);
  });
});

describe('Tolling Bells: Normal tier volley', () => {
  it('spawns 4 bell entities on Normal after the volley timer fires', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    expect(st).toBeDefined();

    // Force the volley timer so it fires on the very next tick.
    st.bellVolleyTimer = DT * 0.5;

    const before = countBellEntities(sim);
    sim.tick(); // timer fires -> volley spawned
    const after = countBellEntities(sim);
    expect(after - before).toBe(4); // every volley = 4 bells
    expect(run.nhaliaBoss.bells.length).toBeGreaterThanOrEqual(4);
  });

  it('bells in one volley fly in 4 different directions (90 degrees apart)', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    st.bellVolleyTimer = DT * 0.5;
    sim.tick();

    const angles = st.bells
      .map((b: any) => Math.atan2(b.vx, -b.vz))
      .sort((a: number, b: number) => a - b);
    expect(angles).toHaveLength(4);
    // Consecutive directions are 90 degrees apart.
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 2, 5);
    }
  });
});

describe('Tolling Bells: Heroic tier volley', () => {
  it('spawns 4 bell entities on Heroic', () => {
    const sim = makeSim(99);
    const run = enterLitanyFinale(sim, 'heroic');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    expect(st).toBeDefined();

    st.bellVolleyTimer = DT * 0.5;

    const before = countBellEntities(sim);
    sim.tick();
    const after = countBellEntities(sim);
    expect(after - before).toBe(4); // every volley = 4 bells, Heroic included
  });
});

describe('Tolling Bells: wall pass-through despawn', () => {
  it('a bell despawns once it has flown past the apse walls', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    st.bellVolleyTimer = DT * 0.5;
    sim.tick(); // spawn bells

    // Lifetime never fires; only the wall bounds check can drop these bells.
    const ids = st.bells.map((b: any) => b.entityId);
    expect(ids).toHaveLength(4);
    for (const b of st.bells) b.remaining = 999;
    st.bellVolleyTimer = 9999; // no further volleys during the flight

    // At 8 yd/s the farthest wall (altar z=72 to zMin -16, 88yd + margin) is
    // crossed in ~11.4s. Every bell must be gone well before its lifetime.
    for (let i = 0; i < 20 * 14; i++) {
      sim.player.hp = sim.player.maxHp; // stay alive so the run keeps ticking
      sim.tick();
      st.bellVolleyTimer = 9999;
    }
    for (const id of ids) {
      expect((sim as any).entities.get(id)).toBeUndefined();
    }
    expect(st.bells).toHaveLength(0);
  });
});

describe('Tolling Bells: bell movement', () => {
  it('bell entity moves each tick at the configured speed', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    st.bellVolleyTimer = DT * 0.5;
    sim.tick(); // spawn bells

    // Find a bell entity.
    let bellE: any = null;
    (sim as any).entities.forEach((e: any) => {
      if (!e.dead && e.templateId === BELL_TEMPLATE_ID) bellE = e;
    });
    expect(bellE).not.toBeNull();

    const x0 = bellE.pos.x;
    const z0 = bellE.pos.z;
    sim.tick(); // bell moves
    const x1 = bellE.pos.x;
    const z1 = bellE.pos.z;

    // At 8 yd/s and DT=0.05s the bell moves exactly 0.4yd per tick (pinned as a
    // literal so a speed regression fails, not just "moved at all").
    const dist = Math.hypot(x1 - x0, z1 - z0);
    expect(dist).toBeCloseTo(0.4, 5);
  });

  it('in-flight bells are removed the tick after Sister Nhalia dies', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    st.bellVolleyTimer = DT * 0.5;
    sim.tick(); // spawn a volley
    expect(st.bells.length).toBeGreaterThan(0);

    // Kill the boss with bells still in flight; the driver's dead-boss branch
    // must drop them instead of leaving them frozen mid-air through the rite.
    (sim as any).dealDamage(sim.player, boss, boss.maxHp + 1, false, 'physical', null, 'hit', true);
    sim.tick();
    sim.tick();
    expect(st.bells.length).toBe(0);
    let liveBells = 0;
    (sim as any).entities.forEach((e: any) => {
      if (!e.dead && e.templateId === BELL_TEMPLATE_ID) liveBells++;
    });
    expect(liveBells).toBe(0);
  });
});

describe('Tolling Bells: contact damage and knockback', () => {
  it('player in contact with a bell takes damage and is displaced outward', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    st.bellVolleyTimer = DT * 0.5;
    sim.tick(); // spawn bells

    // Find a bell entity.
    let bellE: any = null;
    (sim as any).entities.forEach((e: any) => {
      if (!e.dead && e.templateId === BELL_TEMPLATE_ID) bellE = e;
    });
    expect(bellE).not.toBeNull();

    // Teleport player directly on the bell so contact fires.
    const p = sim.player;
    const hpBefore = p.hp;
    p.pos.x = bellE.pos.x;
    p.pos.z = bellE.pos.z;
    p.pos.y = bellE.pos.y;
    p.prevPos = { ...p.pos };

    sim.tick(); // driver fires contact check

    // Exactly 12% of maxHp (BELL_DMG_PCT), pinned as a literal.
    expect(hpBefore - p.hp).toBe(Math.max(1, Math.round(p.maxHp * 0.12)));
    // Player should have been knocked back from the bell.
    const distFromBell = Math.hypot(p.pos.x - bellE.pos.x, p.pos.z - bellE.pos.z);
    expect(distFromBell).toBeGreaterThan(0.5);
  });
});

describe('Tolling Bells: expiry and despawn', () => {
  it('bell entities are removed from the world after their lifetime elapses', () => {
    const sim = makeSim(42);
    const run = enterLitanyFinale(sim, 'normal');
    expect(run).not.toBeNull();
    const boss = setupNhaliaCombat(sim, run);
    expect(boss).not.toBeNull();

    const st = run.nhaliaBoss;
    st.bellVolleyTimer = DT * 0.5;
    sim.tick(); // spawn bells

    const countAfterSpawn = countBellEntities(sim);
    expect(countAfterSpawn).toBeGreaterThan(0);

    // Force all bells to near-expiry (just over one tick remaining).
    for (const b of st.bells) {
      b.remaining = DT * 1.1;
    }

    sim.tick(); // remaining -= DT; still alive by 0.1 * DT
    const countMidway = countBellEntities(sim);
    expect(countMidway).toBe(countAfterSpawn); // still present

    // Now force them past expiry.
    for (const b of st.bells) {
      b.remaining = DT * 0.01;
    }
    sim.tick(); // drops below 0 -> expired and entity dropped
    const countAfterExpiry = countBellEntities(sim);
    expect(countAfterExpiry).toBeLessThan(countAfterSpawn);
  });
});
