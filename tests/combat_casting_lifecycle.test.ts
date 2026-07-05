// Direct unit tests for src/sim/combat/casting_lifecycle.ts (C4a). These drive the
// EXPORTED module functions against a real Sim's SimContext (sim.ctx) so the moved
// branches are exercised on their own, independent of the parity golden: a timed
// cast start -> progress -> finish (applyAbility -> runEffects), a channel start ->
// tick -> finish, an interrupt (cancelCast), a pushback (timed + channel branches),
// and a determinism/replay assertion. Proves the extracted module is callable and the
// move preserved behavior.

import { describe, expect, it } from 'vitest';
import {
  cancelCast,
  castAbility,
  pushbackCast,
  updateCasting,
} from '../src/sim/combat/casting_lifecycle';
import { handleDeath } from '../src/sim/combat/damage';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { CAST_PUSHBACK_SEC, CHANNEL_PUSHBACK_FRACTION } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(cls: PlayerClass, level: number): { sim: AnySim; p: AnyEntity; meta: any } {
  const sim = new Sim({ seed: 99, playerClass: cls, autoEquip: true }) as AnySim;
  sim.setPlayerLevel(level);
  const p = sim.player as AnyEntity;
  const meta = sim.players.get(p.id);
  p.resource = p.maxResource;
  return { sim, p, meta };
}

// An idle hostile target in range + faced, so an offensive cast passes its guards.
function spawnTarget(sim: AnySim, p: AnyEntity, level = 1, dz = 6): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, level, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  }) as AnyEntity;
  mob.maxHp = 5000;
  mob.hp = 5000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

// Drive the per-tick lifecycle directly until the cast clears (guarded).
function drainCast(sim: AnySim, p: AnyEntity, meta: any): number {
  let n = 0;
  while (p.castingAbility && n++ < 1000) updateCasting(sim.ctx, p, meta);
  return n;
}

describe('casting_lifecycle: timed cast start -> progress -> finish', () => {
  it('starts a timed cast (gcd armed, state set) and resolves the ability on completion', () => {
    const { sim, p, meta } = makeSim('priest', 12);
    p.hp = Math.max(1, p.maxHp - 500);
    const hp0 = p.hp;
    // Whispered Prayer (friendly, never misses) so finish -> applyAbility -> runEffects is observable.
    castAbility(sim.ctx, 'lesser_heal', p.id);
    expect(p.castingAbility).toBe('lesser_heal');
    expect(p.castRemaining).toBeGreaterThan(0);
    expect(p.gcdRemaining).toBeGreaterThan(0);
    const ticks = drainCast(sim, p, meta);
    expect(p.castingAbility).toBeNull(); // FINISHED via updateCasting
    expect(ticks).toBeGreaterThan(1); // actually progressed over multiple ticks
    expect(p.hp).toBeGreaterThan(hp0); // applyAbility ran the heal effect
  });

  it('resolves a completed hostile cast against the target selected at cast start', () => {
    const { sim, p, meta } = makeSim('mage', 12);
    const firstTarget = spawnTarget(sim, p, 12, 6);
    const firstHp0 = firstTarget.hp;
    castAbility(sim.ctx, 'fireball', p.id);
    expect(p.castingAbility).toBe('fireball');
    expect(p.castTargetId).toBe(firstTarget.id);

    const secondTarget = spawnTarget(sim, p, 12, 8);
    const secondHp0 = secondTarget.hp;
    expect(p.targetId).toBe(secondTarget.id);
    sim.rng.chance = () => true;
    drainCast(sim, p, meta);

    expect(p.castingAbility).toBeNull();
    expect(p.castTargetId).toBeNull();
    expect(sim.ctx.pendingProjectiles[0]?.targetId).toBe(firstTarget.id);
    for (let i = 0; i < 200 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    expect(firstTarget.hp).toBeLessThan(firstHp0);
    expect(secondTarget.hp).toBe(secondHp0);
  });

  it('resolves a completed friendly heal against the target locked at cast start', () => {
    const { sim, p, meta } = makeSim('priest', 12);
    const ally = sim.entities.get(sim.addPlayer('warrior', 'Ally')) as AnyEntity;
    const bystander = sim.entities.get(sim.addPlayer('rogue', 'Bystander')) as AnyEntity;
    ally.hp = Math.max(1, ally.maxHp - 500);
    bystander.hp = Math.max(1, bystander.maxHp - 500);
    const allyHp0 = ally.hp;
    const bystanderHp0 = bystander.hp;

    sim.targetEntity(ally.id, p.id);
    castAbility(sim.ctx, 'lesser_heal', p.id);
    expect(p.castingAbility).toBe('lesser_heal');
    expect(p.castTargetId).toBe(ally.id);

    sim.targetEntity(bystander.id, p.id); // retarget mid-cast
    expect(p.targetId).toBe(bystander.id);
    drainCast(sim, p, meta);

    expect(p.castingAbility).toBeNull();
    expect(p.castTargetId).toBeNull();
    expect(ally.hp).toBeGreaterThan(allyHp0); // the heal landed on the locked target
    expect(bystander.hp).toBe(bystanderHp0); // the current target got nothing
  });
});

describe('casting_lifecycle: channel start -> tick -> finish', () => {
  it('starts a channel (channeling, resource spent at START), ticks drain, then finishes', () => {
    const { sim, p, meta } = makeSim('warlock', 12);
    const mob = spawnTarget(sim, p);
    p.hp = Math.max(1, p.maxHp - 300);
    const res0 = p.resource;
    castAbility(sim.ctx, 'drain_life', p.id);
    expect(p.castingAbility).toBe('drain_life');
    expect(p.channeling).toBe(true);
    expect(p.resource).toBeLessThan(res0); // channels spend at START
    const mobHp0 = mob.hp;
    const ticks = drainCast(sim, p, meta);
    expect(p.castingAbility).toBeNull(); // channel ran to completion
    expect(ticks).toBeGreaterThan(1);
    // Each channel bolt deals its damage when it reaches the target (projectile_travel),
    // a few ticks after it is fired: let the last bolts land.
    for (let i = 0; i < 20 && mob.hp >= mobHp0; i++) sim.tick();
    expect(mob.hp).toBeLessThan(mobHp0); // applyChannelTick dealt drain damage
  });

  it('keeps channel ticks on the target locked at channel start after retargeting', () => {
    const { sim, p, meta } = makeSim('warlock', 12);
    const first = spawnTarget(sim, p, 12, 6);
    const firstHp0 = first.hp;
    sim.drainEvents();
    castAbility(sim.ctx, 'drain_life', p.id);
    expect(p.channeling).toBe(true);
    expect(p.castTargetId).toBe(first.id);

    const second = spawnTarget(sim, p, 12, 8); // spawnTarget also retargets p to it
    const secondHp0 = second.hp;
    expect(p.targetId).toBe(second.id);
    drainCast(sim, p, meta);

    const stops = sim
      .drainEvents()
      .filter((e: any) => e.type === 'castStop' && e.entityId === p.id);
    expect(stops.some((e: any) => e.success === false)).toBe(false); // never cancelled
    for (let i = 0; i < 200 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    expect(first.hp).toBeLessThan(firstHp0); // ticks kept hitting the locked target
    expect(second.hp).toBe(secondHp0); // the new current target was never drained
  });

  it('keeps a channel ticking when the current target is cleared mid-channel', () => {
    const { sim, p, meta } = makeSim('warlock', 12);
    const mob = spawnTarget(sim, p, 12, 6);
    const mobHp0 = mob.hp;
    sim.drainEvents();
    castAbility(sim.ctx, 'drain_life', p.id);
    expect(p.castTargetId).toBe(mob.id);

    for (let i = 0; i < 25; i++) updateCasting(sim.ctx, p, meta); // past the 1s tick
    sim.targetEntity(null, p.id); // clear the current target mid-channel
    expect(p.targetId).toBeNull();
    for (let i = 0; i < 25; i++) updateCasting(sim.ctx, p, meta); // crosses the 2s tick
    expect(p.castingAbility).toBe('drain_life'); // NOT cancelled by the cleared target
    expect(p.channeling).toBe(true);

    drainCast(sim, p, meta);
    const stops = sim
      .drainEvents()
      .filter((e: any) => e.type === 'castStop' && e.entityId === p.id);
    expect(stops.some((e: any) => e.success === false)).toBe(false); // never cancelled
    expect((stops.at(-1) as any)?.success).toBe(true); // ran to completion
    for (let i = 0; i < 200 && sim.ctx.pendingProjectiles.length > 0; i++)
      advancePendingProjectiles(sim.ctx);
    expect(mob.hp).toBeLessThan(mobHp0); // the locked target kept taking ticks
  });

  it('cancels the channel when the locked target dies mid-channel', () => {
    const { sim, p, meta } = makeSim('warlock', 12);
    const mob = spawnTarget(sim, p, 12, 6);
    sim.drainEvents();
    castAbility(sim.ctx, 'drain_life', p.id);
    expect(p.castTargetId).toBe(mob.id);

    for (let i = 0; i < 22; i++) updateCasting(sim.ctx, p, meta); // the 1s tick fired
    expect(p.castingAbility).toBe('drain_life');
    handleDeath(sim.ctx, mob, p); // the locked target dies mid-channel
    for (let i = 0; i < 25 && p.castingAbility; i++) updateCasting(sim.ctx, p, meta);

    expect(p.castingAbility).toBeNull(); // the 2s tick found a dead locked target
    expect(p.channeling).toBe(false);
    expect(p.castTargetId).toBeNull();
    expect(p.castRemaining).toBe(0);
    // cancelCast emitted castStop(success:false). (updateCasting's channel branch also
    // emits a trailing success:true because the cancel zeroed castRemaining — a
    // pre-existing quirk of mid-tick cancellation, so assert on the cancel event.)
    const stops = sim
      .drainEvents()
      .filter((e: any) => e.type === 'castStop' && e.entityId === p.id);
    expect(stops.some((e: any) => e.success === false)).toBe(true);
  });
});

describe('casting_lifecycle: interrupt (cancelCast)', () => {
  it('clears cast state and emits castStop(success:false)', () => {
    const { sim, p } = makeSim('mage', 12);
    spawnTarget(sim, p);
    sim.drainEvents();
    castAbility(sim.ctx, 'fireball', p.id);
    expect(p.castingAbility).toBe('fireball');
    cancelCast(sim.ctx, p);
    expect(p.castingAbility).toBeNull();
    expect(p.channeling).toBe(false);
    expect(p.castRemaining).toBe(0);
    const stop = sim.drainEvents().find((e: any) => e.type === 'castStop' && e.entityId === p.id);
    expect(stop).toBeTruthy();
    expect((stop as any).success).toBe(false);
  });

  it('clears the locked cast target on interrupt', () => {
    const { sim, p } = makeSim('mage', 12);
    const mob = spawnTarget(sim, p);
    castAbility(sim.ctx, 'fireball', p.id);
    expect(p.castTargetId).toBe(mob.id);
    cancelCast(sim.ctx, p);
    expect(p.castTargetId).toBeNull();
  });
});

describe('casting_lifecycle: pushbackCast', () => {
  it('delays a timed cast by CAST_PUSHBACK_SEC (does not cancel)', () => {
    const { sim, p } = makeSim('mage', 12);
    spawnTarget(sim, p);
    castAbility(sim.ctx, 'fireball', p.id);
    const rem0 = p.castRemaining;
    const tot0 = p.castTotal;
    pushbackCast(p);
    expect(p.castingAbility).toBe('fireball'); // delayed, NOT cancelled
    expect(p.castRemaining).toBeCloseTo(rem0 + CAST_PUSHBACK_SEC, 9);
    expect(p.castTotal).toBeCloseTo(tot0 + CAST_PUSHBACK_SEC, 9);
  });

  it('shaves a channel by CHANNEL_PUSHBACK_FRACTION of its total', () => {
    const { sim, p } = makeSim('warlock', 12);
    spawnTarget(sim, p);
    castAbility(sim.ctx, 'drain_life', p.id);
    const rem0 = p.castRemaining;
    const tot0 = p.castTotal;
    pushbackCast(p);
    expect(p.channeling).toBe(true);
    expect(p.castRemaining).toBeCloseTo(Math.max(0, rem0 - tot0 * CHANNEL_PUSHBACK_FRACTION), 9);
  });
});

describe('casting_lifecycle: determinism', () => {
  it('same seed + same module-driven sequence -> identical end state', () => {
    const run = () => {
      const { sim, p, meta } = makeSim('warlock', 12);
      const mob = spawnTarget(sim, p);
      p.hp = Math.max(1, p.maxHp - 300);
      castAbility(sim.ctx, 'drain_life', p.id);
      for (let i = 0; i < 22; i++) updateCasting(sim.ctx, p, meta); // a channel tick fires
      pushbackCast(p); // mid-channel pushback
      drainCast(sim, p, meta); // run to completion
      return { hp: p.hp, resource: p.resource, mobHp: mob.hp, casting: p.castingAbility };
    };
    expect(run()).toEqual(run());
  });
});

describe('casting_lifecycle: physical ranged shots resolve on projectile impact (Long Draw)', () => {
  it('deals no damage at cast completion; damage lands when the arrow arrives', () => {
    const { sim, p, meta } = makeSim('hunter', 20);
    p.resource = p.maxResource = 500;
    const mob = spawnTarget(sim, p, 20, 20); // 20yd: within 35yd range, beyond the 8yd deadzone
    const events: Array<Record<string, any>> = [];
    const orig = (sim as any).emit.bind(sim);
    (sim as any).emit = (e: Record<string, any>) => {
      events.push(e);
      orig(e);
    };
    const hp0 = mob.hp;
    castAbility(sim.ctx, 'aimed_shot', p.id);
    expect(p.castingAbility).toBe('aimed_shot');
    drainCast(sim, p, meta); // run the 3s cast to completion (updateCasting only, no projectile step)
    // The shot is LAUNCHED at cast completion, not landed: no damage yet, a bolt is in flight.
    expect(mob.hp).toBe(hp0);
    expect(events.some((e) => e.type === 'spellfx' && e.fx === 'projectile')).toBe(true);
    // Advance ticks so the arrow travels and connects.
    for (let i = 0; i < 60 && mob.hp === hp0; i++) sim.tick();
    expect(mob.hp).toBeLessThan(hp0);
    expect(events.some((e) => e.type === 'damage' && e.ability === 'Long Draw')).toBe(true);
  });
});
