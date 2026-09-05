import { describe, expect, it, vi } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { createPlayer } from '../src/sim/entity';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura } from '../src/sim/types';

const ENCHANT = 'enchant_weapon_lastflame_zeal';

function harness() {
  const wielder = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Crafter');
  const target = createPlayer(2, 'warrior', { x: 2, y: 0, z: 0 }, 'Target');
  wielder.level = 20;
  wielder.auras = [];
  wielder.mainhandItemId = 'duskforged_warblade';
  wielder.offhandItemId = 'duskforged_warblade';
  const equipmentInstance = {
    mainhand: { enchant: ENCHANT },
    offhand: { enchant: ENCHANT },
  };
  const raw = {
    rng: { chance: vi.fn(() => true) },
    players: new Map([[wielder.id, { equipmentInstance }]]),
    applyAura: (_target: unknown, aura: Aura) => {
      wielder.auras = wielder.auras.filter((active) => active.id !== aura.id);
      wielder.auras.push(aura);
    },
    applyHeal: vi.fn(),
    emit: vi.fn(),
  };
  return { wielder, target, raw, ctx: raw as unknown as SimContext };
}

describe("Last Flame's Zeal", () => {
  it('defines the learned skill-100 recipe and exact visible combat values', () => {
    expect(ENCHANTS[ENCHANT]).toMatchObject({
      skillReq: 100,
      acquisition: 'drop',
      statBonus: {},
      weaponProc: { ppm: 1, strength: 50, duration: 15, heal: 200 },
      reagents: [{ itemId: 'lastflame_core', count: 3 }, { itemId: 'arcane_shard', count: 2 }],
    });
    expect(ENCHANTS[ENCHANT].description).toContain('50 Strength for 15 sec');
    expect(ENCHANTS[ENCHANT].description).toContain('200');
  });

  it('uses base weapon speed / 60 and grants real Strength plus non-recursive healing', () => {
    const { ctx, raw, wielder, target } = harness();
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    const item = ITEMS.duskforged_warblade;
    expect(item.kind).toBe('weapon');
    if (item.kind !== 'weapon') throw new Error('fixture weapon missing');
    expect(raw.rng.chance).toHaveBeenCalledExactlyOnceWith(item.weapon.speed / 60);
    expect(wielder.auras).toHaveLength(1);
    expect(wielder.auras[0]).toMatchObject({ kind: 'buff_str', value: 50, duration: 15 });
    expect(raw.applyHeal).toHaveBeenCalledWith(
      wielder, wielder, 200, "Last Flame's Zeal", ENCHANT, false, false,
    );
  });

  it('distinguishes identical weapons by hand, stacking at most two buffs and refreshing one hand', () => {
    const { ctx, raw, wielder, target } = harness();
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.offhandItemId, 'offhand');
    wielder.auras[0].remaining = 1;
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    expect(wielder.auras).toHaveLength(2);
    expect(wielder.auras.every((aura) => aura.remaining === 15)).toBe(true);
    expect(wielder.auras.reduce((total, aura) => total + aura.value, 0)).toBe(100);
    expect(raw.rng.chance).toHaveBeenCalledTimes(3);
  });

  it('does not proc from ranged Auto Shot, spells, heals, an empty hand, or a dead wielder', () => {
    const { ctx, raw, wielder, target } = harness();
    runWeaponProcs(ctx, wielder, target, 'weaponHit');
    runWeaponProcs(ctx, wielder, target, 'spellDamage');
    runWeaponProcs(ctx, wielder, target, 'heal');
    runWeaponProcs(ctx, wielder, target, 'weaponHit', null, 'offhand');
    wielder.dead = true;
    runWeaponProcs(ctx, wielder, target, 'weaponHit', wielder.mainhandItemId, 'mainhand');
    expect(raw.rng.chance).not.toHaveBeenCalled();
    expect(raw.applyHeal).not.toHaveBeenCalled();
  });
});
