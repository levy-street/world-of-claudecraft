import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function entity(sim: Sim, pid: number): Entity {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  return e;
}

function addDummy(sim: Sim, x = sim.player.pos.x, z = sim.player.pos.z + 4): Entity {
  const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
    x,
    y: sim.player.pos.y,
    z,
  });
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  sim.entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

describe('signature mechanics v2', () => {
  it('bestial_wrath grants hunter AP percent and doubles pet damage', () => {
    const sim = new Sim({ seed: 11, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('beast_mastery')).toBe(true);
    const hunter = sim.player;
    summonPet(sim.ctx, hunter, 'forest_wolf');
    const pet = sim.petOf(sim.playerId);
    if (!pet) throw new Error('expected summoned pet');

    const apBefore = hunter.attackPower;
    hunter.resource = hunter.maxResource;
    sim.castAbility('bestial_wrath');

    const apAura = hunter.auras.find((a) => a.kind === 'buff_ap_pct' && a.id === 'bestial_wrath');
    expect(apAura?.value).toBe(20);
    expect(hunter.attackPower).toBeGreaterThan(apBefore);
    expect(hunter.attackPower - apBefore).not.toBe(55);

    const petAura = pet.auras.find(
      (a) => a.kind === 'pet_damage_pct' && a.id === 'bestial_wrath_pet',
    );
    expect(petAura?.value).toBe(100);
    // 2.0 from the Howling Rage pet buff x 1.2 from the Packbond mastery (petDmgPct 0.2
    // at full level-20 mastery strength); the two stack multiplicatively by design.
    expect((sim as any).petDamageMult(pet)).toBeCloseTo(2.4, 10);
  });

  it('trueshot_aura gives same-party allies a percent AP buff instead of flat AP', () => {
    const sim = new Sim({ seed: 12, playerClass: 'hunter', autoEquip: true });
    const hunterPid = sim.playerId;
    const allyPid = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(20, hunterPid);
    sim.setPlayerLevel(20, allyPid);
    expect(sim.setSpec('marksmanship', hunterPid)).toBe(true);
    const hunter = entity(sim, hunterPid);
    const ally = entity(sim, allyPid);
    ally.pos = { ...hunter.pos, x: hunter.pos.x + 3 };
    ally.prevPos = { ...ally.pos };
    (sim as any).rebucket(ally);
    sim.partyInvite(allyPid, hunterPid);
    sim.partyAccept(allyPid);

    const allyApBefore = ally.attackPower;
    hunter.resource = hunter.maxResource;
    sim.castAbility('trueshot_aura', hunterPid);

    const aura = ally.auras.find((a) => a.kind === 'buff_ap_pct' && a.id === 'trueshot_aura_ap');
    expect(aura?.value).toBe(10);
    expect(aura?.duration).toBe(1800);
    expect(ally.attackPower).toBe(Math.round(allyApBefore * 1.1));
    expect(ally.attackPower - allyApBefore).not.toBe(35);
  });

  it('Maskfall front-loads the old bleed budget into one combo-point weapon strike', () => {
    const sim = new Sim({ seed: 13, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('subtlety')).toBe(true);
    const rogue = sim.player;
    rogue.resource = rogue.maxResource;
    rogue.facing = 0;
    const target = addDummy(sim, rogue.pos.x, rogue.pos.z + 4);
    sim.targetEntity(target.id);
    const rng = sim.ctx.rng as typeof sim.ctx.rng & {
      next(): number;
      range(min: number, max: number): number;
      chance(probability: number): boolean;
    };
    rng.next = () => 0.9;
    rng.range = (min) => min;
    rng.chance = () => false;
    const hpBefore = target.hp;

    sim.castAbility('hemorrhage');

    expect(sim.resolvedAbility('hemorrhage')).toMatchObject({
      def: { name: 'Maskfall' },
      effects: [{ type: 'weaponStrike', bonus: 52 }],
    });
    expect(target.hp).toBeLessThan(hpBefore);
    expect(rogue.comboPoints).toBe(1);
    expect(target.auras.some((aura) => aura.kind === 'dot')).toBe(false);
    expect(target.auras.some((aura) => aura.kind === 'bleed_vuln')).toBe(false);
  });
});
