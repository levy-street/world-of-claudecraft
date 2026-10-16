import { describe, expect, it } from 'vitest';
import { SelfMotionPredictor } from '../src/render/self_motion';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { emptyMoveInput } from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

function fixture() {
  const sim = new Sim({
    seed: 104,
    playerClass: 'rogue',
    autoEquip: false,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const p = sim.player;
  p.pos = { x: 100, y: groundHeight(100, 100, sim.cfg.seed), z: 100 };
  p.prevPos = { ...p.pos };
  p.onGround = true;
  p.fallStartY = p.pos.y;
  sim.addItem('rift_feather_glider', 1);
  return sim;
}

const glider = (sim: Sim) => sim.player.auras.find((a) => a.id === 'rift_feather_glider');

describe('reputation glider takeoff', () => {
  it('keeps a flight aura in the authoritative mirror when the legacy predictor initially seats its scratch actor', () => {
    const sim = fixture();
    sim.useItem('rift_feather_glider');
    const aura = glider(sim)!;
    aura.value = 1;
    const authoritativeAuras = sim.player.auras;
    const predictor = new SelfMotionPredictor(sim.cfg.seed);
    predictor.step(sim.player, {
      enabled: true,
      moveInput: emptyMoveInput(),
      displayFacing: sim.player.facing,
      echoMs: 100,
      jitterMs: 0,
      alpha: 1,
      frameDt: 0.05,
      snapAgeMs: 0,
      snapIntervalMs: 50,
      riftFloor: null,
      delveRun: null,
      delveSolids: [],
    });
    expect(sim.player.auras).toBe(authoritativeAuras);
    expect(glider(sim)).toBe(aura);
    expect(aura.value).toBe(1);
  });

  it('stays armed on the ground until jumping and cancels only on the subsequent landing', () => {
    const sim = fixture();
    const startHp = sim.player.hp;
    sim.useItem('rift_feather_glider');
    expect(glider(sim)?.value).toBe(0);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(glider(sim)?.value).toBe(0);
    expect(sim.player.onGround).toBe(true);

    sim.meta(sim.playerId)!.moveInput.jump = true;
    sim.tick();
    sim.meta(sim.playerId)!.moveInput.jump = false;
    expect(sim.player.onGround).toBe(false);
    expect(glider(sim)?.value).toBe(1);
    for (let i = 0; i < 200 && !sim.player.onGround; i++) {
      sim.tick();
      expect(sim.player.vy).toBeGreaterThanOrEqual(-2.5);
    }
    expect(sim.player.onGround).toBe(true);
    expect(glider(sim)).toBeUndefined();
    expect(sim.player.hp).toBe(startHp);
    expect(sim.countItem('rift_feather_glider')).toBe(1);
  });

  it('preserves the armed effect through the grounded-to-falling ledge transition', () => {
    const sim = fixture();
    sim.useItem('rift_feather_glider');
    sim.tick();
    // A grounded body has just walked past a high support surface.
    sim.player.pos.y += 20;
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.player.onGround).toBe(false);
    expect(glider(sim)?.value).toBe(1);
    sim.player.vy = -20;
    sim.tick();
    expect(sim.player.vy).toBe(-2.5);
    expect(glider(sim)).toBeDefined();
  });

  it('expires if takeoff never happens and still enforces the original cooldown', () => {
    const sim = fixture();
    sim.useItem('rift_feather_glider');
    for (let i = 0; i < 20 * 31; i++) sim.tick();
    expect(glider(sim)).toBeUndefined();
    sim.useItem('rift_feather_glider');
    expect(glider(sim)).toBeUndefined();
    expect(sim.meta(sim.playerId)!.riftGliderReadyAt).toBe(120);
  });

  it('still cancels an armed glider when combat begins before takeoff', () => {
    const sim = fixture();
    sim.useItem('rift_feather_glider');
    sim.player.inCombat = true;
    sim.tick();
    expect(glider(sim)).toBeUndefined();
  });

  it('does not grant ground aggro immunity while waiting for takeoff', () => {
    const sim = fixture();
    sim.useItem('rift_feather_glider');
    const mob = createMob(99999, MOBS.forest_wolf, 20, { ...sim.player.pos });
    mob.pos.z += 2;
    mob.spawnPos = { ...mob.pos };
    sim.addEntity(mob);
    sim.tick();
    sim.tick();
    expect(mob.aggroTargetId).toBe(sim.playerId);
  });

  it.each([true, false])('cleans up in deep water when initially grounded=%s', (onGround) => {
    const sim = fixture();
    let found = false;
    for (let z = -300; z <= 300 && !found; z += 8) {
      for (let x = -300; x <= 300 && !found; x += 8) {
        const water = waterLevelAt(x, z, sim.cfg.seed);
        if (groundHeight(x, z, sim.cfg.seed) >= water - 2) continue;
        sim.player.pos = { x, y: water - 0.75, z };
        found = true;
      }
    }
    expect(found).toBe(true);
    sim.player.prevPos = { ...sim.player.pos };
    sim.player.onGround = onGround;
    sim.useItem('rift_feather_glider');
    expect(glider(sim)).toBeDefined();
    sim.tick();
    expect(glider(sim)).toBeUndefined();
  });
});
