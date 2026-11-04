// PvP pet taunt (src/sim/pet/pet_pvp_taunt.ts): a tank pet's taunt switches a
// hostile player's selected target onto the pet. Duels drive the hostility; a
// friendly player is never touched, an enemy already on the pet keeps the
// autocast in reserve, and the manual /pettaunt works on a player too.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  PET_GROWL_INTERVAL,
  type SimEvent,
  type WorldContent,
} from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { ensureLocaleLoaded, getLanguage, setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(e);
}

function rig(duel = true) {
  const sim = new Sim({ seed: 42, playerClass: 'warlock', noPlayer: true, world: WORLD });
  const lockId = sim.addPlayer('warlock', 'Gulda', { autoEquip: true });
  const foeId = sim.addPlayer('warrior', 'Brakka', { autoEquip: true });
  const lock = sim.entities.get(lockId) as Entity;
  const foe = sim.entities.get(foeId) as Entity;
  place(sim, lock, 0, -40);
  place(sim, foe, 0, -34);
  summonPet(sim.ctx, lock, 'gloomshade');
  const pet = sim.petOf(lockId) as Entity;
  place(sim, pet, 0.5, -35);
  if (duel) {
    sim.duelRequest(foeId, lockId);
    sim.duelAccept(foeId);
    for (let i = 0; i < 20 * 5; i++) {
      sim.tick();
      const d = (sim.ctx.duels as Map<number, { state: string }>).get(lockId);
      if (d?.state === 'active') break;
    }
  }
  // The enemy is focused on the warlock; the pet is on the enemy, in melee.
  sim.targetEntity(lockId, foeId);
  pet.aggroTargetId = foeId;
  pet.inCombat = true;
  pet.petTauntTimer = 0;
  return { sim, lock, foe, pet, lockId, foeId };
}

function tickLogs(sim: Sim, ticks: number): Extract<SimEvent, { type: 'log' }>[] {
  const logs: Extract<SimEvent, { type: 'log' }>[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const ev of sim.tick()) if (ev.type === 'log') logs.push(ev);
  }
  return logs;
}

describe('a pet taunt switches a hostile player target onto the pet', () => {
  it('Duskmurk auto-taunts a dueling enemy: their target becomes the pet', () => {
    const { sim, foe, pet, lockId, foeId } = rig();
    expect(pet.petAutoTaunt).toBe(true);
    expect(foe.targetId).toBe(lockId);
    const logs = tickLogs(sim, 10);
    expect(foe.targetId).toBe(pet.id);
    expect(pet.petTauntTimer).toBeGreaterThan(PET_GROWL_INTERVAL - 1);
    expect(
      logs.some(
        (l) => l.pid === foeId && l.text === 'Duskmurk taunts you: your target switches to it.',
      ),
    ).toBe(true);
    expect(
      logs.some(
        (l) =>
          l.pid === lockId && l.text === 'Duskmurk taunts Brakka: their target switches to it.',
      ),
    ).toBe(true);
  });

  it('is one-shot: the enemy can retarget at once, and the next taunt waits for the cooldown', () => {
    const { sim, foe, pet, lockId, foeId } = rig();
    tickLogs(sim, 10);
    expect(foe.targetId).toBe(pet.id);
    sim.targetEntity(lockId, foeId);
    tickLogs(sim, 20);
    expect(foe.targetId).toBe(lockId);
    tickLogs(sim, 20 * PET_GROWL_INTERVAL);
    expect(foe.targetId).toBe(pet.id);
  });

  it('keeps the autocast in reserve while the enemy already targets the pet', () => {
    const { sim, foe, pet, foeId } = rig();
    sim.targetEntity(pet.id, foeId);
    const logs = tickLogs(sim, 10);
    expect(foe.targetId).toBe(pet.id);
    expect(pet.petTauntTimer).toBe(0);
    expect(logs.some((l) => l.text.includes('taunts'))).toBe(false);
  });

  it('never touches a player the pet is not hostile to', () => {
    const { sim, foe, pet, lockId } = rig(false);
    tickLogs(sim, 10);
    expect(foe.targetId).toBe(lockId);
    expect(pet.petTauntTimer).toBe(0);
  });

  it('the manual /pettaunt switches a player target too', () => {
    const { sim, foe, pet, lockId, foeId } = rig();
    pet.petAutoTaunt = false;
    sim.targetEntity(foeId, lockId);
    sim.petTaunt(lockId);
    expect(foe.targetId).toBe(pet.id);
    expect(pet.petTauntTimer).toBe(PET_GROWL_INTERVAL);
  });
});

describe('the PvP taunt notices localize', () => {
  it('maps both lines in French, keeping the names', async () => {
    const restore = getLanguage();
    await ensureLocaleLoaded('fr_FR');
    setLanguage('fr_FR');
    try {
      expect(localizeSimText('Duskmurk taunts you: your target switches to it.')).toContain(
        'vous provoque',
      );
      const other = localizeSimText('Duskmurk taunts Brakka: their target switches to it.');
      expect(other).toContain('Brakka');
      expect(other).toContain('provoque');
    } finally {
      setLanguage(restore);
    }
  });
});
