import { describe, expect, it } from 'vitest';
import { DEV_KIT_ROLE_COUNT, DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import {
  applyDevEnchant,
  devBisEnchantCandidates,
  devBisEnchantsFor,
} from '../src/sim/dev/bis_enchants';
import { parseDevBisArgs } from '../src/sim/dev/bis_gear';
import { devBisKitChoices, resolveDevBisKit } from '../src/sim/dev/bis_kits';
import { forgeBisGearFor, forgeBisLoadoutEntries } from '../src/sim/dev/forge_bis_loadouts';
import { parseBisGearFor, parseBisLoadoutEntries } from '../src/sim/dev/parse_bis_loadouts';
import {
  canEquipItemInSlot,
  displacedSlotForEquip,
  isShieldItem,
  MASTERWROUGHT_EQUIP_CAP,
} from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { EquipSlot, PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type Kit = { cls: PlayerClass; word: string; kit: string; spec: string };
const KITS: Kit[] = (Object.keys(DEV_KIT_ROLES) as PlayerClass[]).flatMap((cls) =>
  devBisKitChoices(cls).map((word) => ({ cls, word, ...resolveDevBisKit(cls, word)! })),
);
const TIERS = [
  ['nyth', parseBisGearFor],
  ['forge', forgeBisGearFor],
] as const;
const roleOf = (k: Kit) => DEV_KIT_ROLES[k.cls].find((r) => r.spec === k.spec)!;
const TANK_KITS = new Set(['bear', 'stonebound']);
// The Ignivar class set each Forge kit wears (kit key, not the variant word).
const FORGE_SPEC_SETS: Readonly<Record<string, string>> = {
  'warrior/arms': 'slagbreaker',
  'warrior/fury': 'emberfury',
  'warrior/prot': 'forgewall',
  'paladin/holy': 'dawnforged',
  'paladin/protection': 'oathpyre',
  'paladin/retribution': 'zealfire',
  'hunter/beast_mastery': 'packlord_emberhide',
  'hunter/marksmanship': 'coldsight_trackers',
  'hunter/survival': 'slagsnare',
  'rogue/assassination': 'cinderfang',
  'rogue/combat': 'smolderstrike',
  'rogue/subtlety': 'ashveil',
  'priest/discipline': 'emberscreed',
  'priest/holy': 'benison_dawnweave',
  'priest/shadow': 'vesperash',
  'shaman/elemental': 'stormkindled',
  'shaman/enhancement': 'warspirit_emberscale',
  'shaman/stonebound': 'stonehearth',
  'shaman/restoration': 'springmender',
  'mage/arcane': 'chronoweave',
  'mage/fire': 'pyroclast',
  'mage/frost': 'frostquench',
  'warlock/affliction': 'hexthread',
  'warlock/demonology': 'gravebrand',
  'warlock/destruction': 'ruincaller',
  'druid/balance': 'moonscorch',
  'druid/feral': 'wildfang_emberhide',
  'druid/bear': 'cinderbark',
  'druid/restoration': 'grovespring',
};

function devSim(cls: PlayerClass): Sim {
  const sim = new Sim({
    seed: 42,
    playerClass: cls,
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  return sim;
}

describe('BIS kit choices', () => {
  it('gives druid and shaman four kits each and every other class its three specs', () => {
    expect(KITS).toHaveLength(DEV_KIT_ROLE_COUNT + 2);
    expect(devBisKitChoices('druid')).toEqual(['balance', 'cat', 'bear', 'restoration']);
    expect(devBisKitChoices('shaman')).toEqual([
      'elemental',
      'galeheart',
      'stonebound',
      'restoration',
    ]);
    expect(resolveDevBisKit('druid', 'feral')).toEqual({ kit: 'feral', spec: 'feral' });
    expect(resolveDevBisKit('druid', 'bear')).toEqual({ kit: 'bear', spec: 'feral' });
    expect(resolveDevBisKit('shaman', 'Stonebound')).toEqual({
      kit: 'stonebound',
      spec: 'enhancement',
    });
    expect(resolveDevBisKit('warrior', 'bear')).toBeNull();
    expect(parseBisLoadoutEntries()).toHaveLength(KITS.length);
    expect(forgeBisLoadoutEntries()).toHaveLength(KITS.length);
  });
});

describe.each(TIERS)('%s BIS loadouts', (tier, gearFor) => {
  it('gives every kit a complete legal loadout', () => {
    for (const k of KITS) {
      const gear = gearFor(k.cls, k.kit);
      const label = `${tier} ${k.cls} ${k.word}`;
      expect(gear, label).not.toBeNull();
      const slots = Object.entries(gear ?? {}) as [EquipSlot, string][];
      expect(slots.length, label).toBeGreaterThanOrEqual(tier === 'forge' ? 12 : 11);
      for (const [slot, itemId] of slots) {
        expect(ITEMS[itemId], `${label} ${slot}: ${itemId}`).toBeDefined();
        expect(canEquipItemInSlot(k.cls, ITEMS[itemId], slot, k.spec), `${label} ${slot}`).toBe(
          true,
        );
      }
      for (const slot of ['mainhand', 'offhand'] as const) {
        const id = gear?.[slot];
        if (!id) continue;
        expect(
          displacedSlotForEquip(ITEMS[id], slot, gear ?? {}, (x) => ITEMS[x], k.cls, k.spec),
          `${label} ${slot} conflicts with its other hand`,
        ).toBeNull();
      }
      // Nyth Stonebound tanks behind a shield; Forge Stonebound dual-wields wands.
      if (TANK_KITS.has(k.kit) && k.cls === 'shaman' && tier === 'nyth') {
        expect(isShieldItem(ITEMS[gear?.offhand ?? '']), `${label} shield`).toBe(true);
      }
    }
  });

  it.each(['feral', 'bear'])('keeps feral %s on Strength gear', (kit) => {
    let str = 0;
    let agi = 0;
    for (const id of Object.values(gearFor('druid', kit) ?? {}) as string[]) {
      str += ITEMS[id].stats?.str ?? 0;
      agi += ITEMS[id].stats?.agi ?? 0;
      // Cat and bear never carry a caster stick or an Intellect off hand.
      expect(ITEMS[id].stats?.int ?? 0, `${kit} ${id}`).toBe(0);
    }
    expect(str).toBeGreaterThan(agi * 2);
  });
});

describe('Forge BIS loadouts', () => {
  it('wears exactly the Masterwrought cap of Crucible crafted pieces, from one line', () => {
    for (const k of KITS) {
      const ids = Object.values(forgeBisGearFor(k.cls, k.kit) ?? {}) as string[];
      const crafted = ids.filter((id) => id.startsWith('crucible_'));
      const label = `${k.cls} ${k.word}`;
      expect(ids.filter((id) => ITEMS[id]?.masterwrought).length, label).toBe(
        MASTERWROUGHT_EQUIP_CAP,
      );
      expect(crafted.length, label).toBe(2);
      expect(new Set(crafted.map((id) => ITEMS[id].set)).size, label).toBe(1);
      if (TANK_KITS.has(k.kit)) expect(crafted[0], label).toMatch(/^crucible_tank_/);
    }
  });

  it('puts casters in crafted chest and feet and healers in crafted waist and feet', () => {
    for (const k of KITS) {
      const gear = forgeBisGearFor(k.cls, k.kit) ?? {};
      const role = roleOf(k);
      if (role.healer) {
        expect(gear.waist, k.word).toMatch(/^crucible_healer_/);
        expect(gear.feet, k.word).toMatch(/^crucible_healer_/);
      } else if (role.weights.int) {
        expect(gear.chest, k.word).toMatch(/^crucible_caster_/);
        expect(gear.feet, k.word).toMatch(/^crucible_caster_/);
      }
    }
  });

  it('wears only its own spec set of the Ignivar class sets', () => {
    const owned = new Set(Object.values(FORGE_SPEC_SETS));
    for (const k of KITS) {
      const own = FORGE_SPEC_SETS[`${k.cls}/${k.kit}`];
      const gear = forgeBisGearFor(k.cls, k.kit) ?? {};
      const sets = Object.values(gear).map((id) => ITEMS[id].set);
      for (const set of sets) {
        if (set && owned.has(set)) expect(set, `${k.cls} ${k.word}`).toBe(own);
      }
      expect(sets.filter((set) => set === own).length, `${k.cls} ${k.word}`).toBeGreaterThan(0);
    }
  });

  it('gives the agility kits no Strength-primary armor', () => {
    for (const k of KITS.filter((k) => k.cls === 'rogue' || k.cls === 'hunter')) {
      for (const id of Object.values(forgeBisGearFor(k.cls, k.kit) ?? {})) {
        const stats = ITEMS[id].stats ?? {};
        expect((stats.str ?? 0) > (stats.agi ?? 0), `${k.cls} ${k.word} ${id}`).toBe(false);
      }
    }
    expect(forgeBisGearFor('rogue', 'combat')?.waist).toBe('slagstalker_belt');
  });

  it('wields a legendary weapon in every kit but Stonebound, daggers kept for the dagger rogues', () => {
    for (const k of KITS) {
      const gear = forgeBisGearFor(k.cls, k.kit) ?? {};
      if (k.kit === 'stonebound') continue;
      const hands = [gear.mainhand, gear.offhand].filter(Boolean) as string[];
      expect(
        hands.some((id) => ITEMS[id].quality === 'legendary'),
        `${k.cls} ${k.word}`,
      ).toBe(true);
      if (k.cls === 'rogue' && k.spec !== 'combat') {
        expect(ITEMS[gear.mainhand ?? ''].weapon?.dagger, `${k.spec} dagger`).toBe(true);
      }
    }
    expect(forgeBisGearFor('warrior', 'prot')).toMatchObject({
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'varkhul_emberward',
    });
    // Stonebound's current best setup: dual spell-power wands from the Forge.
    expect(forgeBisGearFor('shaman', 'stonebound')).toMatchObject({
      mainhand: 'wand_of_quenched_sparks',
      offhand: 'wand_of_quenched_sparks',
    });
    const stonebound = devBisEnchantsFor(
      'shaman',
      'stonebound',
      'forge',
      forgeBisGearFor('shaman', 'stonebound') ?? {},
    );
    expect(stonebound.mainhand).toBe('enchant_weapon_dawnfire_etching');
    expect(stonebound.offhand).toBe('enchant_weapon_dawnfire_etching');
    expect(forgeBisGearFor('druid', 'bear')?.mainhand).toBe('varkhul_forgebreaker');
    expect(forgeBisGearFor('mage', 'fire')?.mainhand).toBe('heroic_deathless_heartwood');
  });
});

describe('BIS enchants', () => {
  it('names only real enchants and never a Spirit one', () => {
    for (const id of devBisEnchantCandidates()) {
      expect(ENCHANTS[id], id).toBeDefined();
      expect(ENCHANTS[id].statBonus.spi ?? 0, id).toBe(0);
    }
  });

  it('enchants every enchantable worn piece with an enchant that fits it', () => {
    for (const [tier, gearFor] of TIERS) {
      for (const k of KITS) {
        const gear = gearFor(k.cls, k.kit) ?? {};
        const plan = devBisEnchantsFor(k.cls, k.kit, tier, gear);
        for (const [slot, itemId] of Object.entries(gear) as [EquipSlot, string][]) {
          const label = `${tier} ${k.cls} ${k.word} ${slot}`;
          if (slot === 'trinket') {
            expect(plan[slot], label).toBeUndefined();
            continue;
          }
          const enchant = plan[slot] ? ENCHANTS[plan[slot]] : undefined;
          expect(enchant, label).toBeDefined();
          expect(ITEMS[itemId].slot, label).toBe(enchant?.itemSlot);
        }
      }
    }
  });

  it('runs the basic weapon ladder on Nyth and the raid formulas on Forge', () => {
    const forgeOnly = new Set([
      'enchant_weapon_lastflame_zeal',
      'enchant_weapon_piston_drive',
      'enchant_weapon_riftwalkers_grace',
      'enchant_weapon_dawnfire_etching',
      'enchant_weapon_dawns_benediction',
    ]);
    for (const k of KITS) {
      const nyth = devBisEnchantsFor(k.cls, k.kit, 'nyth', parseBisGearFor(k.cls, k.kit) ?? {});
      for (const id of Object.values(nyth)) expect(forgeOnly.has(id ?? ''), k.word).toBe(false);
    }
    const forge = (cls: PlayerClass, kit: string) =>
      devBisEnchantsFor(cls, kit, 'forge', forgeBisGearFor(cls, kit) ?? {});
    expect(forge('mage', 'fire').mainhand).toBe('enchant_weapon_dawnfire_etching');
    expect(forge('priest', 'holy').mainhand).toBe('enchant_weapon_dawns_benediction');
    expect(forge('warrior', 'arms').mainhand).toBe('enchant_weapon_piston_drive');
    expect(forge('warrior', 'prot').mainhand).toBe('enchant_weapon_lastflame_zeal');
    expect(forge('rogue', 'combat')).toMatchObject({
      mainhand: 'enchant_weapon_riftwalkers_grace',
      offhand: 'enchant_weapon_riftwalkers_grace',
    });
    expect(forge('hunter', 'beast_mastery').mainhand).toBe('enchant_weapon_agility');
    expect(forge('druid', 'feral').helmet).toBe('enchant_helmet_greater_fortitude');
    expect(forge('druid', 'feral').shoulder).toBe('enchant_shoulder_strength');
    expect(forge('druid', 'bear').feet).toBe('enchant_feet_stamina');
  });
});

describe('/dev bis and /dev enchant commands', () => {
  it('reads an optional tier and spec in either order', () => {
    expect(parseDevBisArgs([])).toEqual({ tier: 'nyth', spec: null });
    expect(parseDevBisArgs(['fury'])).toEqual({ tier: 'nyth', spec: 'fury' });
    expect(parseDevBisArgs(['Forge'])).toEqual({ tier: 'forge', spec: null });
    expect(parseDevBisArgs(['forge', 'fury'])).toEqual({ tier: 'forge', spec: 'fury' });
    expect(parseDevBisArgs(['fury', 'nyth'])).toEqual({ tier: 'nyth', spec: 'fury' });
    expect(parseDevBisArgs(['nyth', 'forge'])).toBeNull();
    expect(parseDevBisArgs(['fury', 'arms'])).toBeNull();
    expect(parseDevBisArgs(['forge', 'fury', 'x'])).toBeNull();
  });

  it('/dev bis forge equips the Forge kit with its enchants baked in', () => {
    const sim = devSim('warrior');
    sim.chat('/dev bis forge fury');
    const meta = sim.meta(sim.playerId);
    expect(meta?.equipment).toEqual(forgeBisGearFor('warrior', 'fury'));
    expect(meta?.equipmentInstance.mainhand?.enchant).toBe('enchant_weapon_piston_drive');
    expect(meta?.equipmentInstance.offhand?.enchant).toBe('enchant_weapon_lastflame_zeal');
    expect(meta?.equipmentInstance.trinket).toBeUndefined();
    expect(
      sim
        .drainEvents()
        .some((e) => e.type === 'log' && e.text.includes('Forge BiS warrior fury loadout')),
    ).toBe(true);
  });

  it('/dev bis bear equips the bear kit under the feral spec', () => {
    const sim = devSim('druid');
    sim.chat('/dev bis forge bear');
    expect(sim.meta(sim.playerId)?.equipment).toEqual(forgeBisGearFor('druid', 'bear'));
  });

  it('/dev enchant applies, replaces, and refuses an enchant that does not fit', () => {
    const sim = devSim('warrior');
    sim.chat('/dev bis nyth fury');
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    const ctx = (sim as unknown as { ctx: Parameters<typeof applyDevEnchant>[0] }).ctx;
    const strBefore = sim.entities.get(pid)?.attackPower ?? 0;
    expect(applyDevEnchant(ctx, pid, 'mainhand', 'enchant_weapon_piston_drive')).toBe('ok');
    expect(meta?.equipmentInstance.mainhand?.enchant).toBe('enchant_weapon_piston_drive');
    expect(sim.entities.get(pid)?.attackPower ?? 0).toBeGreaterThan(strBefore);
    expect(applyDevEnchant(ctx, pid, 'helmet', 'enchant_weapon_piston_drive')).toBe('wrong_slot');
    expect(applyDevEnchant(ctx, pid, 'trinket', 'enchant_helmet_fortitude')).toBe('empty_slot');
    expect(applyDevEnchant(ctx, pid, 'helmet', 'nope')).toBe('unknown_enchant');
    sim.chat('/dev enchant helmet enchant_helmet_armor');
    expect(meta?.equipmentInstance.helmet?.enchant).toBe('enchant_helmet_armor');
    expect(meta?.equipmentInstance.helmet?.rolled?.stats?.sta ?? 0).toBe(0);
  });
});

describe('feral Strength identity', () => {
  it('the druid-only tank leather is Strength-primary', () => {
    for (const id of [
      'cinderbark_cinch',
      'ashenbark_treads',
      'crucible_tank_leather_chest',
      'crucible_tank_leather_waist',
      'crucible_tank_leather_feet',
    ]) {
      const stats = ITEMS[id].stats ?? {};
      expect(stats.str ?? 0, id).toBeGreaterThan(stats.agi ?? 0);
    }
  });
});
