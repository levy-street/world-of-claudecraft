import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { HEROIC_MIN_MOVE_SPEED } from '../src/sim/instances/difficulty';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

// Voss (the heroic Nythraxis rogue add) is the raid's CONTROL assignment: he
// ignores taunt by design, so player crowd control and slows are his entire
// counterplay budget. This contract pins all three legs so no future
// cc-immunity sweep (the Sanctum bosses got one) silently deletes his
// counterplay: (1) CC lands, (2) slows land AND create real escape velocity
// (his old moveSpeed 11 outran a 50%-slowed escape; at the heroic floor 8, a
// half slow drops him to 4, under player run speed 7), (3) taunt still fails.

const SEED = 777;
const VOSS = 'nythraxis_heroic_rogue_add';

function makeSim(): Sim {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
}

function spawnVoss(sim: Sim): Entity {
  const tmpl = MOBS[VOSS];
  const voss = createMob(sim.nextId++, tmpl, tmpl.maxLevel, { x: 0, y: 0, z: 0 });
  voss.hostile = true;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(voss);
  return voss;
}

const playerAura = (kind: Aura['kind'], value = 0): Aura => ({
  id: `test_${kind}`,
  name: `Test ${kind}`,
  kind,
  remaining: 8,
  duration: 8,
  value,
  sourceId: 999,
  school: 'frost',
});

describe('Voss stays the control assignment', () => {
  it('is authored CC-able, slow-able, taunt-immune, at the heroic speed floor', () => {
    const t = MOBS[VOSS];
    expect(t.ccImmune).toBe(false);
    expect(t.slowImmune).toBeUndefined();
    expect(t.ignoreTaunt).toBe(true);
    // The speed contract: AT the heroic anti-kite floor, not above it. His old
    // 11 meant a 50% slow left him at 5.5, barely under run speed 7 - control
    // in name only. At 8, a half slow drops him to 4: genuinely escapable.
    expect(t.moveSpeed).toBe(HEROIC_MIN_MOVE_SPEED);
  });

  it('accepts a player stun and a player slow', () => {
    const sim = makeSim();
    const voss = spawnVoss(sim);
    const inner = sim as unknown as { applyAura(target: Entity, aura: Aura): void };
    inner.applyAura(voss, playerAura('stun'));
    inner.applyAura(voss, playerAura('slow', 0.5));
    expect(voss.auras.some((a) => a.kind === 'stun')).toBe(true);
    expect(voss.auras.some((a) => a.kind === 'slow')).toBe(true);
  });
});
