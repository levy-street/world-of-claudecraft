import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const SEED = 42;
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function mountedSim(): Sim {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world: WORLD });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = 0;
  p.pos.z = 0;
  p.pos.y = terrainHeight(0, 0, SEED);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  // Own the reins, so the ride survives the ownership re-validation stagger.
  sim.addItem('reins_valorsteed', 1, p.id);
  p.mountKey = 'valorsteed';
  return sim;
}

/** Ticks until the ride ends, or -1 if it survived `ticks`. */
function ticksUntilDismount(sim: Sim, ticks: number): number {
  for (let i = 0; i < ticks; i++) {
    sim.tick();
    if (sim.player.mountKey !== 'valorsteed') return i;
  }
  return -1;
}

describe('space while mounted', () => {
  it('control: standing still keeps the ride', () => {
    const sim = mountedSim();
    expect(ticksUntilDismount(sim, 140), 'dismount tick standing still').toBe(-1);
  });

  it('control: running keeps the ride', () => {
    const sim = mountedSim();
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing meta');
    meta.moveInput.forward = true;
    expect(ticksUntilDismount(sim, 140), 'dismount tick while running').toBe(-1);
  });

  it('jumps the mount instead of dismounting', () => {
    const sim = mountedSim();
    const p = sim.player;
    const meta = sim.players.get(p.id);
    if (!meta) throw new Error('missing meta');

    sim.tick();
    expect(p.mountKey, 'still mounted before the jump').toBe('valorsteed');

    meta.moveInput.jump = true;
    sim.tick();
    // eslint-disable-next-line no-console
    console.log(
      `jump edge: mountKey=${JSON.stringify(p.mountKey)} vy=${p.vy} onGround=${p.onGround} jumping=${p.jumping}`,
    );
    expect(p.vy, 'jump velocity applied').toBeGreaterThan(0);
    expect(p.mountKey, 'mount survives the jump edge').toBe('valorsteed');

    meta.moveInput.jump = false;
    const at = ticksUntilDismount(sim, 140);
    // eslint-disable-next-line no-console
    console.log(`dismount tick after the jump: ${at} (-1 = survived)`);
    expect(at, 'mount survives the whole arc and the landing').toBe(-1);
  });
});
