import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  FRONTIER_MUSTER,
  FRONTIER_X_MAX,
  FRONTIER_X_MIN,
  frontierIncursionOnHeal,
  frontierIncursionOnKill,
  INCURSION_PLAYER_KILL_PCT,
  INCURSION_TRASH_KILL_PCT,
  INCURSION_TRASH_RESPAWN_SECONDS,
  inFrontierHub,
  trashSpawnPoint,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';

const RUN_SPEED = 7; // player base run speed (entity.ts); rares must exceed 2x

function bandSim(seed = 31) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  return sim;
}

function placeInBand(sim: Sim, x = FRONTIER_X_MIN + 200, z = 20) {
  const p = sim.player;
  p.pos = { x, y: 1, z };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return p;
}

const wispCount = (sim: Sim) =>
  [...sim.entities.values()].filter((e) => e.templateId === 'rimebound_wisp' && !e.dead).length;

describe('Frontier incursion: unkitable hard rares', () => {
  it('both rares move faster than 2x player run speed and resist CC + slows', () => {
    for (const id of ['rimefang_stalker', 'frostbound_revenant']) {
      const t = MOBS[id];
      expect(t.moveSpeed).toBeGreaterThan(2 * RUN_SPEED);
      expect(t.ccImmune).toBe(true);
      expect(t.slowImmune).toBe(true);
      expect(t.rare).toBe(true);
    }
    // Tanky + hard enough to want a group.
    expect(MOBS.rimefang_stalker.hpBase).toBeGreaterThanOrEqual(3000);
    expect(MOBS.frostbound_revenant.hpBase).toBeGreaterThan(MOBS.rimefang_stalker.hpBase);
  });
});

describe('Frontier incursion: player-gated spawner', () => {
  it('spawns no trash and does not tick the meter with an empty band', () => {
    const sim = bandSim();
    // Player stays in the overworld: nobody is in the band.
    for (let i = 0; i < 20 * 20; i++) sim.tick();
    expect(sim.frontierIncursionState.progress).toBe(0);
    expect(wispCount(sim)).toBe(0);
    expect(sim.frontierIncursionState.phase).toBe('building');
  });

  it('maintains a live trash population and drips the meter while a player is in the band', () => {
    const sim = bandSim();
    placeInBand(sim);
    // Past two respawn windows: at least a couple of trash are up, and the passive
    // drip has moved the meter off zero.
    for (let i = 0; i < INCURSION_TRASH_RESPAWN_SECONDS * 20 * 2 + 5; i++) {
      placeInBand(sim); // keep the player parked in the band each tick
      sim.tick();
    }
    expect(wispCount(sim)).toBeGreaterThanOrEqual(1);
    expect(sim.frontierIncursionState.progress).toBeGreaterThan(0);
  });

  it('tears down trash and resets when the band empties', () => {
    const sim = bandSim();
    for (let i = 0; i < INCURSION_TRASH_RESPAWN_SECONDS * 20 + 5; i++) {
      placeInBand(sim);
      sim.tick();
    }
    expect(wispCount(sim)).toBeGreaterThanOrEqual(1);
    // Walk out of the band; the next tick should despawn the trash and reset.
    const p = sim.player;
    p.pos = { x: 0, y: 1, z: 0 };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.tick();
    expect(wispCount(sim)).toBe(0);
    expect(sim.frontierIncursionState.progress).toBe(0);
  });
});

describe('Frontier incursion: the meter and the spawn', () => {
  it('a trash kill fills the meter and pays a small honor trickle', () => {
    const sim = bandSim();
    const p = placeInBand(sim);
    const meta = sim.meta(p.id)!;
    const honorBefore = meta.honor;
    const trash = createMob(
      90501,
      MOBS.rimebound_wisp,
      19,
      sim.groundPos(FRONTIER_X_MIN + 210, 22),
    );
    sim.addEntity(trash);
    frontierIncursionOnKill(sim.ctx, trash, p);
    expect(sim.frontierIncursionState.progress).toBeCloseTo(INCURSION_TRASH_KILL_PCT, 5);
    expect(meta.honor).toBeGreaterThan(honorBefore);
  });

  it('a PvP kill inside the band feeds the meter more than a trash kill', () => {
    const sim = new Sim({ seed: 32, playerClass: 'warrior', noPlayer: true });
    const aId = sim.addPlayer('warrior', 'Aaa');
    const bId = sim.addPlayer('warrior', 'Bbb');
    const a = sim.entities.get(aId)!;
    const b = sim.entities.get(bId)!;
    for (const e of [a, b]) {
      e.pos = { x: FRONTIER_X_MIN + 200, y: 1, z: 10 };
      e.prevPos = { ...e.pos };
      sim.rebucket(e);
    }
    frontierIncursionOnKill(sim.ctx, b, a);
    expect(sim.frontierIncursionState.progress).toBeCloseTo(INCURSION_PLAYER_KILL_PCT, 5);
  });

  it('spawns the rare at the muster point at a full meter, then rebuilds on its death', () => {
    const sim = bandSim();
    const p = placeInBand(sim);
    sim.frontierIncursionState.progress = 1;
    placeInBand(sim);
    sim.tick();
    const inc = sim.frontierIncursionState;
    expect(inc.phase).toBe('active');
    expect(inc.rareTemplateId).toBe('rimefang_stalker'); // first of the rotation
    const rare = sim.entities.get(inc.rareId!)!;
    expect(rare).toBeTruthy();
    expect(rare.templateId).toBe('rimefang_stalker');
    expect(rare.pos.x).toBeCloseTo(FRONTIER_MUSTER.x, 0);
    expect(inc.progress).toBe(0);
    // Trash is cleared so the zone converges on the rare.
    expect(wispCount(sim)).toBe(0);

    // Kill it: reward pays the contributor, and the meter rebuilds.
    const meta = sim.meta(p.id)!;
    const heroBefore = meta.heroPoints;
    sim.dealDamage(p, rare, 50, false, 'physical', null, 'hit');
    sim.dealDamage(p, rare, rare.hp, false, 'physical', null, 'hit');
    placeInBand(sim);
    sim.tick();
    expect(rare.dead).toBe(true);
    expect(meta.heroPoints).toBeGreaterThan(heroBefore); // awardFrontierRareKill paid out
    expect(sim.frontierIncursionState.phase).toBe('building');
  });
});

describe('Frontier incursion: trash spawn geometry', () => {
  it('never places a trash spawn inside the safe hub, across the whole counter walk', () => {
    // Deterministic sweep: the spawn point is a pure function of the counter, so
    // sweeping it covers every (angle, radius) combination the walker can produce,
    // including the band-edge-clamped mouth-facing candidates (n % 12 == 6 with
    // n % 5 == 4) that used to land inside FRONTIER_HUB_RADIUS.
    for (let n = 0; n <= 600; n++) {
      const { x, z } = trashSpawnPoint(n);
      expect(inFrontierHub(x, z), `spawn ${n} at (${x}, ${z}) is inside the safe hub`).toBe(false);
      expect(x).toBeGreaterThanOrEqual(FRONTIER_X_MIN);
      expect(x).toBeLessThan(FRONTIER_X_MAX);
    }
  });
});

describe('Frontier incursion: healer participation', () => {
  it('drives the meter, and credits only heals on targets fighting the rare (never self-heals)', () => {
    const sim = new Sim({ seed: 33, playerClass: 'priest', noPlayer: true });
    const healerId = sim.addPlayer('priest', 'Mender');
    const woundedId = sim.addPlayer('warrior', 'Tank');
    const healer = sim.entities.get(healerId)!;
    const wounded = sim.entities.get(woundedId)!;
    for (const e of [healer, wounded]) {
      e.pos = { x: FRONTIER_X_MIN + 250, y: 1, z: 15 };
      e.prevPos = { ...e.pos };
      sim.rebucket(e);
    }
    // Meter credit for a heal in the band (incentive #1).
    frontierIncursionOnHeal(sim.ctx, healer, wounded, 300);
    expect(sim.frontierIncursionState.progress).toBeGreaterThan(0);

    const rare = createMob(90601, MOBS.rimefang_stalker, 20, sim.groundPos(FRONTIER_MUSTER.x, 0));
    sim.addEntity(rare);
    sim.frontierIncursionState.phase = 'active';
    sim.frontierIncursionState.rareId = rare.id;

    // A heal on a player NOT on the rare's threat table (a hub bystander) never
    // rides the contributor roster.
    frontierIncursionOnHeal(sim.ctx, healer, wounded, 200);
    expect(rare.bossDamagers.has(healerId)).toBe(false);

    // A self-heal never credits, even when the healer is fighting the rare.
    rare.threat.set(healerId, 50);
    frontierIncursionOnHeal(sim.ctx, healer, healer, 200);
    expect(rare.bossDamagers.has(healerId)).toBe(false);

    // Healing someone who IS on the rare's threat table credits the healer on the
    // roster (incentive #2), so the eventual kill rewards them.
    rare.threat.set(woundedId, 100);
    frontierIncursionOnHeal(sim.ctx, healer, wounded, 200);
    expect(rare.bossDamagers.has(healerId)).toBe(true);
  });
});
