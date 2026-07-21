// "Stoneskin" boss mechanic: a mob with a `stoneskin` template field
// periodically wraps itself in a damage-absorbing barrier while in melee
// combat. It is telegraphed — the first barrier only snaps up one full
// interval after the fight begins — resets on evade/respawn, and reuses the
// existing `absorb` aura, which dealDamage already soaks before any HP is lost.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

// Spawn a stoneskin boss locked in melee on the player and return it.
function engagedWard(sim: Sim): Entity {
  const mob = createMob(900200, MOBS.marrowlord_varkas, 19, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos }; // sit on the player: in melee, no leash
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  (sim as any).addEntity(mob);
  return mob;
}

const wardAura = (e: Entity) => e.auras.find((a) => a.id === 'stoneskin_marrowlord_varkas');

describe('Stoneskin boss mechanic', () => {
  it('Marrowlord Varkas carries a Bone Carapace', () => {
    expect(MOBS.marrowlord_varkas.stoneskin?.name).toBe('Bone Carapace');
    expect(MOBS.marrowlord_varkas.stoneskin?.amount).toBeGreaterThan(0);
  });

  it('is telegraphed: a freshly spawned warden waits one interval before its first barrier', () => {
    const mob = createMob(900201, MOBS.marrowlord_varkas, 19, { x: 0, y: 0, z: 0 });
    expect(mob.stoneskinTimer).toBe(MOBS.marrowlord_varkas.stoneskin!.every);
  });

  it('raises an absorb barrier on itself when the timer elapses and resets the timer', () => {
    const sim = makeSim();
    const mob = engagedWard(sim);
    mob.stoneskinTimer = 0.001; // due now
    (sim as any).updateMob(mob);

    const aura = wardAura(mob);
    expect(aura?.kind).toBe('absorb');
    expect(aura?.name).toBe('Bone Carapace');
    expect(aura?.value).toBe(MOBS.marrowlord_varkas.stoneskin!.amount);
    expect(mob.stoneskinTimer).toBeCloseTo(MOBS.marrowlord_varkas.stoneskin!.every, 5);
  });

  it('soaks incoming damage: HP is spared while the barrier holds, then drains', () => {
    const sim = makeSim();
    const mob = engagedWard(sim);
    // The boss sits on the player and swings during updateMob; keep the player
    // alive (a dead attacker's blow won't land) so it can test-fire into the shield.
    sim.player.gm = true;
    mob.stoneskinTimer = 0.001;
    (sim as any).updateMob(mob);

    const amount = MOBS.marrowlord_varkas.stoneskin!.amount;
    const hpBefore = mob.hp;

    // A hit smaller than the shield: no HP lost, shield drains by that much.
    (sim as any).dealDamage(sim.player, mob, 100, false, 'physical', null, 'hit');
    expect(mob.hp).toBe(hpBefore);
    expect(wardAura(mob)?.value).toBe(amount - 100);

    // A hit that overruns the remaining shield: shield pops, overflow hits HP.
    (sim as any).dealDamage(sim.player, mob, amount, false, 'physical', null, 'hit');
    expect(wardAura(mob)).toBeUndefined();
    expect(mob.hp).toBeLessThan(hpBefore);
  });

  it('does not raise a barrier before the timer elapses', () => {
    const sim = makeSim();
    const mob = engagedWard(sim);
    mob.stoneskinTimer = 5; // not due yet
    (sim as any).updateMob(mob);

    expect(wardAura(mob)).toBeUndefined();
    expect(mob.stoneskinTimer).toBeLessThan(5);
  });

  it('re-arms the telegraph delay when the mob evades home', () => {
    const sim = makeSim();
    const mob = engagedWard(sim);
    mob.stoneskinTimer = 0;
    (sim as any).resetEvadingMob(mob);
    expect(mob.stoneskinTimer).toBe(MOBS.marrowlord_varkas.stoneskin!.every);
  });

  it('mechanicHealMult scales the barrier at the fire site (heroic-instance plumbing)', () => {
    // Heroic spawns carry mechanicHealMult (instances/difficulty.ts). Stoneskin
    // draws no rng, so the scaled absorb pins exactly: 2x the template amount.
    const sim = makeSim();
    const mob = engagedWard(sim);
    mob.mechanicHealMult = 2;
    mob.stoneskinTimer = 0.001;
    (sim as any).updateMob(mob);

    expect(wardAura(mob)?.value).toBe(MOBS.marrowlord_varkas.stoneskin!.amount * 2);
  });

  it('a normal mob without a stoneskin template never gains the barrier', () => {
    const sim = makeSim();
    const wolf = createMob(900202, MOBS.forest_wolf, 5, { ...sim.player.pos });
    wolf.spawnPos = { ...sim.player.pos };
    wolf.aiState = 'attack';
    wolf.aggroTargetId = sim.playerId;
    wolf.inCombat = true;
    (sim as any).addEntity(wolf);
    wolf.stoneskinTimer = 0.001;
    (sim as any).updateMob(wolf);

    expect(wolf.auras.some((a) => a.kind === 'absorb')).toBe(false);
  });
});
