import { describe, expect, it } from 'vitest';
import { MOBS, riftInstanceOrigin } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { isInertInstanceCorpse } from '../src/sim/mob/locomotion';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// A cleared rift floor's corpse field used to pay updateMob every tick for the
// rest of the run (instance corpses never decay or respawn, and the idle cull
// refused every dead mob). These suites pin the inert-corpse skip: WHAT skips
// (far instance corpses with every dead-branch effect spent) and, more
// importantly, what must NEVER skip (fuses, FFA windows, pets, auras,
// overworld corpses, world bosses, near-player corpses).

const RIFT_POS = riftInstanceOrigin(0, 0);

function riftCorpse(overrides?: Partial<Entity>): Entity {
  const mob = createMob(90001, MOBS.forest_wolf, 10, { x: RIFT_POS.x, y: 0, z: RIFT_POS.z });
  mob.spawnPos = { x: RIFT_POS.x, y: 0, z: RIFT_POS.z };
  mob.dead = true;
  mob.hp = 0;
  mob.aiState = 'dead';
  mob.corpseTimer = 60;
  mob.respawnTimer = 600;
  mob.detonateTimer = Infinity;
  mob.lootFfaTimer = 0;
  Object.assign(mob, overrides);
  return mob;
}

describe('isInertInstanceCorpse', () => {
  it('accepts a spent instance corpse and rejects every live-effect arm', () => {
    expect(isInertInstanceCorpse(riftCorpse())).toBe(true);
    // Each exclusion arm, one at a time.
    expect(isInertInstanceCorpse(riftCorpse({ dead: false }))).toBe(false);
    expect(isInertInstanceCorpse(riftCorpse({ spawnPos: { x: 0, y: 0, z: 0 } }))).toBe(false);
    expect(isInertInstanceCorpse(riftCorpse({ ownerId: 5 }))).toBe(false);
    expect(isInertInstanceCorpse(riftCorpse({ detonateTimer: 2 }))).toBe(false);
    expect(isInertInstanceCorpse(riftCorpse({ lootFfaTimer: 1.5 }))).toBe(false);
    const withAura = riftCorpse();
    withAura.auras.push({ id: 'x', kind: 'dot', duration: 3, value: 1 } as never);
    expect(isInertInstanceCorpse(withAura)).toBe(false);
    // A stealth-flagged corpse must keep ticking: updateAuras' dead arm is
    // what settles the flag, and freezing it could ship a stealthed corpse.
    expect(isInertInstanceCorpse(riftCorpse({ stealthed: true }))).toBe(false);
    // Nythraxis: its death dialogue is driven from the dead branch.
    const nythraxis = riftCorpse();
    (nythraxis as { nythraxis?: unknown }).nythraxis = { phase: 'dead', deathSpoken: false };
    expect(isInertInstanceCorpse(nythraxis)).toBe(false);
  });

  it('rejects a world-boss template corpse even inside an instance band', () => {
    const bossEntry = Object.entries(MOBS).find(([, m]) => m.worldBoss);
    expect(bossEntry).toBeDefined();
    const [bossId, bossTemplate] = bossEntry as [string, (typeof MOBS)[string]];
    const boss = createMob(90002, bossTemplate, bossTemplate.maxLevel, {
      x: RIFT_POS.x,
      y: 0,
      z: RIFT_POS.z,
    });
    boss.templateId = bossId;
    boss.spawnPos = { x: RIFT_POS.x, y: 0, z: RIFT_POS.z };
    boss.dead = true;
    boss.detonateTimer = Infinity;
    boss.lootFfaTimer = 0;
    expect(isInertInstanceCorpse(boss)).toBe(false);
  });
});

describe('Sim inert-corpse idle skip', () => {
  function buildSim(): Sim {
    return new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      idleMobTickRadius: 120,
    });
  }

  function addCorpse(sim: Sim, overrides?: Partial<Entity>): Entity {
    const mob = riftCorpse(overrides);
    mob.id = sim.nextId++;
    sim.addEntity(mob);
    return mob;
  }

  it('freezes a far inert rift corpse but keeps ticking every live-effect corpse', () => {
    const sim = buildSim();
    const inert = addCorpse(sim);
    const fused = addCorpse(sim, { detonateTimer: 0.6 });
    const ffa = addCorpse(sim, { lootFfaTimer: 0.4 });
    const overworld = addCorpse(sim, {
      spawnPos: { x: 0, y: 0, z: 0 },
      pos: { x: 0, y: 0, z: 60 },
      // Keep the overworld corpse a corpse for the whole window: decay path
      // stays deferred while the respawn timer is high.
      respawnTimer: 600,
      corpseTimer: 60,
    });
    const before = inert.corpseTimer;
    const overworldBefore = overworld.corpseTimer;
    for (let i = 0; i < 20; i++) sim.tick();
    // The inert instance corpse froze: its dead branch never ran.
    expect(inert.corpseTimer).toBe(before);
    // The fused corpse kept counting down and burst (fuse resets to Infinity).
    expect(fused.detonateTimer).toBe(Infinity);
    // The FFA window kept counting down to its lapse.
    expect(ffa.lootFfaTimer).toBeLessThanOrEqual(0);
    // The overworld corpse is untouched by the new skip arm.
    expect(overworld.corpseTimer).toBeLessThanOrEqual(overworldBefore - 19 * DT);
  });

  it('keeps ticking an inert corpse while any player is inside the radius', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      idleMobTickRadius: 120,
    });
    const player = sim.player;
    player.pos.x = RIFT_POS.x + 4;
    player.pos.z = RIFT_POS.z + 4;
    player.prevPos = { ...player.pos };
    const corpse = riftCorpse();
    corpse.id = sim.nextId++;
    sim.addEntity(corpse);
    const before = corpse.corpseTimer;
    for (let i = 0; i < 20; i++) sim.tick();
    // Near a player the corpse keeps its exact pre-change behavior.
    expect(corpse.corpseTimer).toBeLessThanOrEqual(before - 19 * DT);
  });

  it('never skips any corpse when the idle cull is disabled', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const corpse = riftCorpse();
    corpse.id = sim.nextId++;
    sim.addEntity(corpse);
    const before = corpse.corpseTimer;
    for (let i = 0; i < 10; i++) sim.tick();
    expect(corpse.corpseTimer).toBeLessThanOrEqual(before - 9 * DT);
  });
});
