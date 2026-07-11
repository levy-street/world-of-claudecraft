// Mastery-application mechanism fixes from the codex pass over #1543:
//  - a global damage mult must not corrupt a utility rate/multiplier buff (F1)
//  - Demonology's redirected pet damage must not re-apply the source's output mods (F7)
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

describe('mastery does not corrupt utility rate buffs (F1)', () => {
  it("an Elemental shaman's spell-damage mastery leaves Ghost Wolf's 1.4x speed intact", () => {
    const sim = new Sim({ seed: 1, playerClass: 'shaman', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('elemental')).toBe(true); // mastery = +15% spell damage
    // Ghost Wolf is a nature-school selfBuff whose value (1.4) is a movement-speed
    // MULTIPLIER, not a magnitude. The old `value < 1` guard scaled it by the spell
    // mastery mult and rounded 1.4 -> 2; it must now pass through untouched.
    const gw = sim.resolvedAbility('ghost_wolf', sim.playerId);
    const buff = gw?.effects.find((e) => e.type === 'selfBuff');
    expect(buff && 'value' in buff ? buff.value : null).toBe(1.4);
  });
});

describe('Demonology damage redirect is not double-modified (F7)', () => {
  it("a source's Defensive Stance cut is applied once, not again on the pet's share", () => {
    const sim = new Sim({ seed: 1, playerClass: 'warlock', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('demonology')).toBe(true); // mastery = 20% damage redirected to pet
    const wl = sim.entities.get(sim.playerId) as Entity;
    wl.maxHp = wl.hp = 1_000_000;
    wl.resource = wl.maxResource;
    // Bring up the demon: the summon is a multi-second cast, so tick past it.
    sim.castAbility('summon_voidwalker', sim.playerId);
    for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
    const pet = sim.petOf(sim.playerId) as Entity;
    expect(pet).toBeTruthy();
    pet.maxHp = pet.hp = 1_000_000;

    // A source in Defensive Stance (deals 10% less). createMob is hostile.
    const source = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      MOBS.ridge_stalker,
      20,
      {
        x: wl.pos.x,
        y: wl.pos.y,
        z: wl.pos.z + 3,
      },
    );
    source.auras.push({ kind: 'defensive_stance', value: 0, remaining: 60, duration: 60 } as Aura);
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(source);

    const wl0 = wl.hp;
    const pet0 = pet.hp;
    // 100 raw -> source Defensive Stance x0.9 -> 90 to the warlock, of which 20% (18)
    // is redirected to the pet. The pet's 18 must NOT be cut by Defensive Stance again.
    (sim as any).dealDamage(source, wl, 100, false, 'physical', null, 'hit');
    expect(pet0 - pet.hp).toBe(18); // not 16 (would be 18 * 0.9 double-cut)
    expect(wl0 - wl.hp).toBe(72); // 90 - 18
  });
});
