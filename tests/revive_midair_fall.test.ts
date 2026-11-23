// A revive must land the body settled. A ghost can jump off a cliff and accept a
// resurrection (or reach its corpse) before it hits the ground; reviveAt
// (src/sim/spirit.ts) moves the body to the ground, so the ghost's fall arc and fall
// origin must not carry over, or the next motion tick lands it with the ghost's whole
// drop and the freshly raised player dies of fall damage (reported in Discord,
// "Fall speed carries over after resurrection").

import { describe, expect, it } from 'vitest';
import { RESURRECTION_OFFER_SECONDS } from '../src/sim/combat/resurrection_offer';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function world(): { sim: Sim; caster: Entity; ghost: Entity } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const caster = sim.entities.get(sim.addPlayer('priest', 'Caster')) as Entity;
  const ghost = sim.entities.get(sim.addPlayer('warrior', 'Faller')) as Entity;
  sim.tick();
  ghost.pos = { ...caster.pos };
  ghost.prevPos = { ...ghost.pos };
  ghost.dead = true;
  ghost.hp = 0;
  ghost.corpsePos = { ...ghost.pos };
  sim.releaseSpirit(ghost.id);
  expect(ghost.ghost).toBe(true);
  return { sim, caster, ghost };
}

// The ghost is mid-plunge: 40 yd above where it jumped from the ground, falling hard.
function plunge(sim: Sim, ghost: Entity): void {
  const ground = sim.ctx.groundPos(ghost.pos.x, ghost.pos.z).y;
  ghost.onGround = false;
  ghost.jumping = true;
  ghost.fallStartY = ground + 40;
  ghost.pos.y = ground + 20;
  ghost.vy = -25;
  ghost.vx = 6;
  ghost.vz = -6;
}

function fallingDamage(events: SimEvent[], pid: number): number {
  return events.filter(
    (e) =>
      e.type === 'damage' &&
      (e as { targetId?: number }).targetId === pid &&
      (e as { ability?: string }).ability === 'Falling',
  ).length;
}

function tickMany(sim: Sim, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...sim.tick());
  return events;
}

describe('revive mid-fall', () => {
  it('accepting a resurrection mid-fall lands the body settled, with no fall damage', () => {
    const { sim, caster, ghost } = world();
    sim.pendingResurrections.set(ghost.id, {
      casterId: caster.id,
      hpFrac: 1,
      fallbackDestination: { ...caster.pos },
      expiresAt: sim.time + RESURRECTION_OFFER_SECONDS,
      maxRange: 40,
    });
    plunge(sim, ghost);
    sim.respondToResurrection(true, ghost.id);
    expect(ghost.dead).toBe(false);
    expect(ghost.vy).toBe(0);
    expect(ghost.vx).toBe(0);
    expect(ghost.vz).toBe(0);
    expect(ghost.onGround).toBe(true);
    expect(ghost.jumping).toBe(false);
    expect(ghost.fallStartY).toBe(ghost.pos.y);
    const events = tickMany(sim, 20);
    expect(fallingDamage(events, ghost.id)).toBe(0);
    expect(ghost.dead).toBe(false);
    expect(ghost.hp).toBe(ghost.maxHp);
  });

  it('any revive (the shared reviveAt body) clears the carried fall', () => {
    const { sim, caster, ghost } = world();
    plunge(sim, ghost);
    sim.revivePlayerAt(ghost.id, caster.pos, 1);
    const events = tickMany(sim, 20);
    expect(fallingDamage(events, ghost.id)).toBe(0);
    expect(ghost.hp).toBe(ghost.maxHp);
  });

  it('a corpse run that reaches the body mid-fall revives without fall damage', () => {
    const { sim, ghost } = world();
    const corpse = ghost.corpsePos as Entity['pos'];
    ghost.pos = { ...corpse };
    ghost.prevPos = { ...corpse };
    plunge(sim, ghost);
    sim.resurrectAtCorpse(ghost.id);
    expect(ghost.dead).toBe(false);
    const hp = ghost.hp;
    const events = tickMany(sim, 20);
    expect(fallingDamage(events, ghost.id)).toBe(0);
    expect(ghost.hp).toBeGreaterThanOrEqual(hp);
  });
});
