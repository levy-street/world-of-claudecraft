import { describe, expect, it, vi } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import { BATTLE_TRANCE_ABILITIES, freeCostAuraActive } from '../src/sim/combat/empower_next';
import { Sim } from '../src/sim/sim';
import { BATTLE_TRANCE_CHANCE, BATTLE_TRANCE_DURATION, dist2d, MAX_LEVEL } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function warrior(spec: 'arms' | 'fury' | 'prot' | null = 'arms'): Sim {
  const sim = new Sim({ seed: 2602, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  if (spec !== null) expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function nearestMob(sim: Sim) {
  return [...sim.entities.values()]
    .filter((entity) => entity.kind === 'mob' && !entity.dead)
    .sort((a, b) => dist2d(a.pos, sim.player.pos) - dist2d(b.pos, sim.player.pos))[0]!;
}

function standOff(sim: Sim, mob: ReturnType<typeof nearestMob>, distance: number): void {
  const player = sim.player;
  player.pos.x = mob.pos.x - distance;
  player.pos.z = mob.pos.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  player.facing = Math.atan2(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z);
}

function swingOnce(sim: Sim): ReturnType<typeof vi.spyOn> {
  const mob = nearestMob(sim);
  mob.hp = 1_000_000;
  mob.maxHp = 1_000_000;
  standOff(sim, mob, 2);
  sim.targetEntity(mob.id);
  const player = sim.player;
  player.autoAttack = true;
  player.swingTimer = 0;
  player.offhandSwingTimer = 100;
  vi.spyOn(sim.rng, 'next').mockReturnValue(0.99);
  const chance = vi.spyOn(sim.rng, 'chance').mockImplementation((p) => p === BATTLE_TRANCE_CHANCE);
  updatePlayerAutoAttack(sim.ctx, player, (sim as any).players.get(player.id));
  return chance;
}

function armTrance(sim: Sim): void {
  sim.ctx.applyAura(sim.player, {
    id: 'battle_trance',
    name: 'Battle Trance',
    kind: 'battle_trance',
    remaining: BATTLE_TRANCE_DURATION,
    duration: BATTLE_TRANCE_DURATION,
    value: 0,
    sourceId: sim.player.id,
    school: 'physical',
  });
}

function hasTrance(sim: Sim): boolean {
  return sim.player.auras.some((aura) => aura.kind === 'battle_trance');
}

describe('v0.26 Battle Trance', () => {
  it('rolls after every connected Warrior mainhand swing and arms one ten-second aura', () => {
    const sim = warrior('arms');
    const chance = swingOnce(sim);
    expect(chance.mock.calls.filter(([p]: [number]) => p === BATTLE_TRANCE_CHANCE)).toHaveLength(1);
    const auras = sim.player.auras.filter((aura) => aura.kind === 'battle_trance');
    expect(auras).toHaveLength(1);
    expect(auras[0]).toMatchObject({ remaining: 10, duration: 10 });
  });

  it('preserves the Battle Trance RNG draw for Fury but discards its result', () => {
    const sim = warrior('fury');
    const chance = swingOnce(sim);
    expect(chance.mock.calls.filter(([p]: [number]) => p === BATTLE_TRANCE_CHANCE)).toHaveLength(1);
    expect(hasTrance(sim)).toBe(false);
  });

  it('shares an exact two-ability consumption scope with UI predicates', () => {
    expect([...BATTLE_TRANCE_ABILITIES].sort()).toEqual(['heroic_strike', 'mortal_strike']);
    const aura = [{ kind: 'battle_trance' }];
    expect(freeCostAuraActive(aura, 'heroic_strike')).toBe(true);
    expect(freeCostAuraActive(aura, 'mortal_strike')).toBe(true);
    expect(freeCostAuraActive(aura, 'slam')).toBe(false);
    expect(freeCostAuraActive(aura, 'hamstring')).toBe(false);
  });

  it('makes Maiming Strike free and consumes exactly one aura', () => {
    const sim = warrior('arms');
    const mob = nearestMob(sim);
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    armTrance(sim);
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    const hpBefore = mob.hp;
    sim.castAbility('mortal_strike');
    expect(mob.hp).toBeLessThan(hpBefore);
    expect(hasTrance(sim)).toBe(false);
  });

  it('never pays for Brute Swing or an unrelated rage ability', () => {
    const sim = warrior('arms');
    const mob = nearestMob(sim);
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    armTrance(sim);
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    sim.castAbility('slam');
    expect(hasTrance(sim)).toBe(true);
    sim.player.gcdRemaining = 0;
    sim.castAbility('hamstring');
    expect(hasTrance(sim)).toBe(true);
  });

  it('moves its free charge onto the queued Reaver Strike', () => {
    const sim = warrior(null);
    const mob = nearestMob(sim);
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    armTrance(sim);
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    sim.castAbility('heroic_strike');
    expect(sim.player.queuedOnSwing).toBe('heroic_strike');
    expect(sim.player.queuedOnSwingFree).toBe(true);
    expect(hasTrance(sim)).toBe(false);
  });
});
