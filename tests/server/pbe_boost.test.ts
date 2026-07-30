// Unit coverage for the PBE account boost (PBE_BOOST_ACCOUNTS=1): the env
// gate, the random name generator, the true best-in-slot kit selection over
// the whole PvE ladder (heroic/raid/rift gear included, WARFARE PvP gear
// excluded), the boosted level-20 character state builder, the world-join
// top-up that re-kits existing characters, and the per-account orchestrator
// driven through injected fakes. The register-handler wire-in is a two-line
// gate on pbeBoostEnabled(); the gate itself is pinned here.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL
// is unset; pbe_boost.ts imports it for the real deps, so set a dummy URL.
// The pool never connects: every db-touching path in this file is faked.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { describe, expect, it } from 'vitest';
import { normalizeCharName, offensiveName } from '../../server/auth';
import {
  applyBoostKitToPlayer,
  BOOST_BAG_SOCKETS,
  BOOST_CLASSES,
  BOOST_COPPER,
  BOOST_KIT_VERSION,
  BOOST_LEVEL,
  type BoostCreateResult,
  type BoostDeps,
  type BoostRole,
  bestBoostBag,
  bisKit,
  bisKitForRole,
  boostAccountCharacters,
  buildBoostedCharacterState,
  CLASS_ROLES,
  classItemScore,
  NYTHRAXIS_ATTUNEMENT_QUESTS,
  pbeBoostEnabled,
  randomBoostName,
} from '../../server/pbe_boost';
import { HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import { WARFARE_ITEMS } from '../../src/sim/content/pvp_honor';
import { ITEMS, QUESTS } from '../../src/sim/data';
import { canEquipItem, canEquipItemInSlot, isShieldItem } from '../../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../../src/sim/item_level_req';
import type { CharacterState } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { type EquipSlot, type PlayerClass, xpToReachLevel } from '../../src/sim/types';

// Deterministic stand-in for crypto.randomInt so name/skin tests are stable.
// Uses the HIGH bits of the LCG state: the low bits have tiny periods and
// would collapse the name variety this suite asserts on.
function lcg(seed: number): (maxExclusive: number) => number {
  let s = seed >>> 0;
  return (maxExclusive: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return Math.floor((s / 2 ** 32) * maxExclusive);
  };
}

const ARMOR_SLOTS: EquipSlot[] = [
  'mainhand',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];

const isWarfareItem = (id: string): boolean => id in WARFARE_ITEMS;

describe('pbeBoostEnabled (env gate)', () => {
  it('is on only for the literal "1"', () => {
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(pbeBoostEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('randomBoostName', () => {
  it('always produces a valid, inoffensive character name', () => {
    const rand = lcg(7);
    for (let i = 0; i < 200; i++) {
      const name = randomBoostName(rand);
      expect(normalizeCharName(name)).toBe(name);
      expect(offensiveName(name)).toBe(false);
    }
  });

  it('draws different names across calls (retry after a collision works)', () => {
    const rand = lcg(11);
    const names = new Set(Array.from({ length: 50 }, () => randomBoostName(rand)));
    expect(names.size).toBeGreaterThan(30);
  });
});

describe('bisKit (true best-in-slot over the whole PvE ladder)', () => {
  it('covers every armor and weapon slot for every class, never in WARFARE gear', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = bisKit(cls);
      for (const slot of ARMOR_SLOTS) {
        expect(kit[slot], `${cls} ${slot}`).toBeTruthy();
      }
      for (const [slot, itemId] of Object.entries(kit) as [EquipSlot, string][]) {
        const item = ITEMS[itemId];
        expect(item, `${cls} ${slot} ${itemId}`).toBeDefined();
        expect(isWarfareItem(itemId), `${cls} ${slot} ${itemId} is PvP gear`).toBe(false);
        expect(item.pvpOffenseRating, `${cls} ${slot} ${itemId} pvp rating`).toBeUndefined();
        expect(item.priceHonor, `${cls} ${slot} ${itemId} honor price`).toBeUndefined();
        expect(canEquipItem(cls, item), `${cls} ${slot} ${itemId} canEquip`).toBe(true);
        if (item.requiredClass) expect(item.requiredClass, `${cls} ${slot}`).toContain(cls);
        expect(meetsLevelRequirement(BOOST_LEVEL, item), `${cls} ${slot} level`).toBe(true);
      }
    }
  });

  it('the heroic pool is IN: at least one kit piece comes from the heroic ladder', () => {
    // The whole point of the v2 kit (the 2026-07-21 S-raid playtest ran in
    // PvP gear because heroic drops were excluded): heroic five-man, raid,
    // and rift gear now compete, so across the classes at least one primary
    // kit slot must resolve to a heroic-pool item. If this fails the
    // exclusions crept back and the kits are "BiS" in name only.
    let heroicPicks = 0;
    for (const cls of BOOST_CLASSES) {
      for (const itemId of Object.values(bisKit(cls))) {
        if (!itemId) continue;
        const item = ITEMS[itemId];
        if (item.heroic || item.heroicOf || itemId in HEROIC_ITEMS) heroicPicks++;
      }
    }
    expect(heroicPicks, 'no heroic-pool item in any kit').toBeGreaterThan(0);
  });

  it('no role kit of any class contains a WARFARE piece', () => {
    for (const cls of BOOST_CLASSES) {
      for (const role of CLASS_ROLES[cls]) {
        for (const itemId of Object.values(bisKitForRole(cls, role))) {
          if (itemId) expect(isWarfareItem(itemId), `${cls} ${role.id} ${itemId}`).toBe(false);
        }
      }
    }
  });

  it('picks the argmax of classItemScore per slot (chest, every class)', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = bisKit(cls);
      const candidates = Object.values(ITEMS).filter(
        (i) =>
          i.slot === 'chest' &&
          i.kind === 'armor' &&
          i.pvpOffenseRating === undefined &&
          i.pvpDefenseRating === undefined &&
          i.priceHonor === undefined &&
          canEquipItem(cls, i) &&
          (!i.requiredClass || i.requiredClass.includes(cls)) &&
          meetsLevelRequirement(BOOST_LEVEL, i),
      );
      const best = Math.max(...candidates.map((i) => classItemScore(cls, i)));
      expect(classItemScore(cls, ITEMS[kit.chest as string]), `${cls} chest`).toBe(best);
    }
  });

  it('equips a real weapon in the mainhand for every class', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = bisKit(cls);
      const weapon = ITEMS[kit.mainhand as string];
      expect(weapon?.kind, `${cls} mainhand`).toBe('weapon');
      expect(weapon?.weapon, `${cls} mainhand dps`).toBeDefined();
    }
  });

  it('fills the offhand legally: never beside a two-hander, always slot-equippable', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = bisKit(cls);
      if (!kit.offhand) continue;
      const main = ITEMS[kit.mainhand as string];
      expect(main.kind === 'weapon' && main.hand === 'twohand', `${cls} 2H+offhand`).toBe(false);
      const off = ITEMS[kit.offhand];
      expect(canEquipItemInSlot(cls, off, 'offhand', null), `${cls} offhand ${off.id}`).toBe(true);
      expect(kit.offhand).not.toBe(kit.mainhand);
    }
  });
});

describe('buildBoostedCharacterState', () => {
  it('builds an internally consistent level-20 character wearing the kit', () => {
    const kit = bisKit('warrior');
    const state = buildBoostedCharacterState('warrior', 'Pbetestwar', 3);
    expect(state.level).toBe(BOOST_LEVEL);
    expect(state.lifetimeXp).toBeGreaterThanOrEqual(xpToReachLevel(BOOST_LEVEL));
    expect(state.skin).toBe(3);
    for (const [slot, itemId] of Object.entries(kit)) {
      expect(state.equipment[slot as EquipSlot], `equipped ${slot}`).toBe(itemId);
    }
    expect(state.pbeBoostKit, 'kit version stamped').toBe(BOOST_KIT_VERSION);
    expect(state.ridingTrained, 'riding trained').toBe(true);
  });

  it('round-trips through a fresh Sim load (the server login path shape)', () => {
    const state = buildBoostedCharacterState('mage', 'Pbetestmage', 1);
    const revived = JSON.parse(JSON.stringify(state)) as CharacterState;
    const sim = new Sim({ seed: 99, playerClass: 'mage', playerName: 'unused', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Pbetestmage', { state: revived });
    const reloaded = sim.serializeCharacter(pid);
    expect(reloaded?.level).toBe(BOOST_LEVEL);
    expect(reloaded?.equipment).toEqual(state.equipment);
    expect(reloaded?.pbeBoostKit, 'stamp survives the login round-trip').toBe(BOOST_KIT_VERSION);
  });
});

describe('applyBoostKitToPlayer (world-join top-up)', () => {
  it('re-kits an existing PvP-geared character: BiS worn, old gear kept, once only', () => {
    // The 2026-07-21 playtest shape: a pre-boost character at the cap wearing
    // honor gear with no boost stamp.
    const sim = new Sim({ seed: 41, playerClass: 'warrior', playerName: 'Pvptester' });
    const pid = sim.playerId;
    sim.setPlayerLevel(BOOST_LEVEL, pid);
    const pvpPiece = Object.values(WARFARE_ITEMS).find(
      (i) => i.slot === 'helmet' && canEquipItem('warrior', i),
    );
    expect(pvpPiece, 'a warrior-equippable WARFARE helmet exists').toBeDefined();
    sim.addItem(pvpPiece!.id, 1, pid);
    sim.equipItem(pvpPiece!.id, pid);
    const meta = sim.meta(pid)!;
    expect(meta.equipment.helmet).toBe(pvpPiece!.id);

    expect(applyBoostKitToPlayer(sim, pid), 'first application applies').toBe(true);
    const kit = bisKit('warrior');
    for (const [slot, itemId] of Object.entries(kit)) {
      expect(meta.equipment[slot as EquipSlot], `re-kitted ${slot}`).toBe(itemId);
    }
    // The displaced PvP piece is retained in the bags, never deleted.
    expect(sim.countItem(pvpPiece!.id, pid), 'old gear kept').toBeGreaterThan(0);
    // Bags: every socket carries the best bag in the game.
    const bagId = bestBoostBag();
    expect(meta.bags).toEqual(Array(BOOST_BAG_SOCKETS).fill(bagId));
    expect(meta.ridingTrained, 'riding trained').toBe(true);
    expect(meta.pbeBoostKit).toBe(BOOST_KIT_VERSION);
    for (const questId of NYTHRAXIS_ATTUNEMENT_QUESTS) {
      expect(meta.questsDone.has(questId), `attuned ${questId}`).toBe(true);
    }
    // Idempotent: the stamp blocks a second application.
    expect(applyBoostKitToPlayer(sim, pid), 'second application is a no-op').toBe(false);
  });

  it('swaps a smaller equipped bag for the boost bag and keeps it', () => {
    const sim = new Sim({ seed: 43, playerClass: 'rogue', playerName: 'Bagtester' });
    const pid = sim.playerId;
    sim.setPlayerLevel(BOOST_LEVEL, pid);
    const bagId = bestBoostBag();
    const smaller = Object.values(ITEMS).find(
      (i) =>
        i.kind === 'bag' &&
        (i.bagSlots ?? 0) > 0 &&
        (i.bagSlots ?? 0) < (ITEMS[bagId].bagSlots ?? 0),
    );
    expect(smaller, 'a smaller bag exists in content').toBeDefined();
    sim.addItem(smaller!.id, 1, pid);
    sim.equipBag(smaller!.id, 0, pid);
    const meta = sim.meta(pid)!;
    expect(meta.bags[0]).toBe(smaller!.id);
    expect(applyBoostKitToPlayer(sim, pid)).toBe(true);
    expect(meta.bags).toEqual(Array(BOOST_BAG_SOCKETS).fill(bagId));
    expect(sim.countItem(smaller!.id, pid), 'small bag kept in the pool').toBeGreaterThan(0);
  });

  it('levels a low-level character to the boost level', () => {
    const sim = new Sim({ seed: 47, playerClass: 'mage', playerName: 'Lowtester' });
    const pid = sim.playerId;
    expect(sim.entities.get(pid)!.level).toBeLessThan(BOOST_LEVEL);
    expect(applyBoostKitToPlayer(sim, pid)).toBe(true);
    expect(sim.entities.get(pid)!.level).toBe(BOOST_LEVEL);
  });
});

describe('bags, gold, and alternate role kits', () => {
  it('equips the largest bag in the game in every bag socket', () => {
    const bagId = bestBoostBag();
    const maxSlots = Math.max(
      ...Object.values(ITEMS)
        .filter((i) => i.kind === 'bag')
        .map((b) => b.bagSlots ?? 0),
    );
    expect(ITEMS[bagId].bagSlots).toBe(maxSlots);
    const state = buildBoostedCharacterState('warrior', 'Pbetestbags', 0);
    expect(state.bags).toEqual(Array(BOOST_BAG_SOCKETS).fill(bagId));
  });

  it('grants exactly 10 gold of pocket money on top of the attunement quest rewards', () => {
    expect(BOOST_COPPER).toBe(100000);
    const questCopper = NYTHRAXIS_ATTUNEMENT_QUESTS.reduce(
      (sum, id) => sum + (QUESTS[id].copperReward ?? 0),
      0,
    );
    const state = buildBoostedCharacterState('rogue', 'Pbetestgold', 0);
    expect(state.copper).toBe(BOOST_COPPER + questCopper);
  });

  it('exactly the multi-kit classes define alternate roles, and spawn roles are stable', () => {
    const hybrids = BOOST_CLASSES.filter((c) => CLASS_ROLES[c].length > 1);
    expect([...hybrids].sort()).toEqual(['druid', 'paladin', 'priest', 'shaman', 'warrior']);
    for (const cls of BOOST_CLASSES) {
      expect(CLASS_ROLES[cls].length, cls).toBeGreaterThanOrEqual(1);
      expect(CLASS_ROLES[cls].length, cls).toBeLessThanOrEqual(3);
    }
    // The spawn-equipped identity (roles[0]) never changes silently: charselect
    // leans on these.
    expect(CLASS_ROLES.warrior[0].id).toBe('arms');
    expect(CLASS_ROLES.paladin[0].id).toBe('retribution');
    expect(CLASS_ROLES.priest[0].id).toBe('holy');
    expect(CLASS_ROLES.shaman[0].id).toBe('elemental');
    expect(CLASS_ROLES.druid[0].id).toBe('balance');
  });

  it('hybrid classes carry their full alternate-role kit in the bags, without duplicates', () => {
    for (const cls of BOOST_CLASSES.filter((c) => CLASS_ROLES[c].length > 1)) {
      const state = buildBoostedCharacterState(cls, 'Pbetesthyb', 0);
      const equipped = new Set(Object.values(state.equipment));
      const carried = state.inventory.map((s) => s.itemId);
      const carriedSet = new Set(carried);
      let distinctAltPieces = 0;
      for (const role of CLASS_ROLES[cls].slice(1)) {
        const altKit = bisKitForRole(cls, role);
        for (const itemId of Object.values(altKit)) {
          if (!itemId) continue;
          expect(canEquipItem(cls, ITEMS[itemId]), `${cls} ${role.id} ${itemId} canEquip`).toBe(
            true,
          );
          if (equipped.has(itemId)) continue;
          distinctAltPieces++;
          expect(carriedSet.has(itemId), `${cls} ${role.id} ${itemId}`).toBe(true);
        }
      }
      // The alternate role must actually add SOMETHING (at minimum its weapon);
      // otherwise a regression that stops bagging alt kits passes silently.
      expect(distinctAltPieces, `${cls} distinct alt pieces`).toBeGreaterThanOrEqual(1);
      // Dedupe: nothing the character wears rides in the bags as a copy, and
      // no alt piece was added twice.
      for (const id of equipped) {
        if (id) expect(carriedSet.has(id), `${cls} equipped ${id} duplicated in bags`).toBe(false);
      }
      expect(carried.length, `${cls} inventory has stack-level duplicates`).toBe(carriedSet.size);
    }
  });

  it('the shaman spawns in caster gear and carries a distinct melee weapon', () => {
    const state = buildBoostedCharacterState('shaman', 'Pbetestsham', 0);
    const equippedMain = ITEMS[state.equipment.mainhand as string];
    const casterSignal = (equippedMain.stats?.int ?? 0) + (equippedMain.spellPower ?? 0);
    expect(casterSignal, 'equipped weapon is caster gear').toBeGreaterThan(0);
    const enhancement = CLASS_ROLES.shaman[1];
    expect(enhancement.id).toBe('enhancement');
    const altMain = bisKitForRole('shaman', enhancement).mainhand as string;
    expect(altMain).not.toBe(equippedMain.id);
    const altDef = ITEMS[altMain];
    expect((altDef.stats?.agi ?? 0) + (altDef.stats?.str ?? 0), 'melee stats').toBeGreaterThan(0);
    expect(state.inventory.some((s) => s.itemId === altMain)).toBe(true);
  });
});

function roleOf(cls: PlayerClass, id: string): BoostRole {
  const role = CLASS_ROLES[cls].find((r) => r.id === id);
  expect(role, `${cls} has a ${id} role`).toBeDefined();
  return role as BoostRole;
}

describe('tank, dual-wield, and shadow kits', () => {
  it('the warrior prot kit tanks with a one-hander and a shield', () => {
    const kit = bisKitForRole('warrior', roleOf('warrior', 'prot'));
    const main = ITEMS[kit.mainhand as string];
    expect(main.kind).toBe('weapon');
    // Shieldcrack (the prot signature) requiresShield, so the kit must leave
    // the offhand free of a two-hander and actually hold a shield.
    expect(main.kind === 'weapon' && main.hand === 'twohand', 'prot mainhand is 1H').toBe(false);
    expect(isShieldItem(ITEMS[kit.offhand as string]), 'prot offhand is a shield').toBe(true);
  });

  it('the paladin protection kit tanks with a one-hander and a shield', () => {
    const kit = bisKitForRole('paladin', roleOf('paladin', 'protection'));
    const main = ITEMS[kit.mainhand as string];
    expect(main.kind).toBe('weapon');
    expect(main.kind === 'weapon' && main.hand === 'twohand', 'protection MH is 1H').toBe(false);
    expect(isShieldItem(ITEMS[kit.offhand as string]), 'protection offhand is a shield').toBe(true);
  });

  it('the warrior fury kit fills both hands with distinct spec-legal weapons', () => {
    const kit = bisKitForRole('warrior', roleOf('warrior', 'fury'));
    expect(ITEMS[kit.mainhand as string].kind).toBe('weapon');
    expect(ITEMS[kit.offhand as string].kind).toBe('weapon');
    expect(kit.mainhand).not.toBe(kit.offhand);
    // The offhand pick must be legal under the fury spec specifically
    // (Titan's Grip admits two-handers a spec-less warrior cannot offhand).
    expect(canEquipItemInSlot('warrior', ITEMS[kit.offhand as string], 'offhand', 'fury')).toBe(
      true,
    );
  });

  it('the shadow kit differs from holy: the heroic cloth pool differentiates (tripwire flip)', () => {
    // The old single-kit priest relied on an undifferentiated non-heroic
    // cloth pool. Opening the heroic/raid pool split healer (spi-heavy) from
    // shadow (sta/int) cloth, so priest now carries a real shadow role and
    // this pins that it stays genuinely distinct: if the two kits ever
    // converge again, drop the role back to a single kit.
    const holy = bisKitForRole('priest', roleOf('priest', 'holy'));
    const shadow = bisKitForRole('priest', roleOf('priest', 'shadow'));
    expect(shadow).not.toEqual(holy);
  });

  it('boosted warriors carry the tank shield in their bags', () => {
    const war = buildBoostedCharacterState('warrior', 'Pbetesttank', 0);
    const carried = war.inventory.map((s) => s.itemId);
    expect(
      carried.some((id) => isShieldItem(ITEMS[id])),
      'warrior carries a shield for prot',
    ).toBe(true);
  });
});

describe('Nythraxis attunement', () => {
  it('every boosted character has completed the whole attunement chain', () => {
    expect(NYTHRAXIS_ATTUNEMENT_QUESTS).toEqual([
      'q_nythraxis_restless_dead',
      'q_nythraxis_graves',
      'q_nythraxis_sealed_crypt',
      'q_nythraxis_bound_guardian',
    ]);
    for (const cls of BOOST_CLASSES) {
      const state = buildBoostedCharacterState(cls, 'Pbetestattn', 0);
      for (const questId of NYTHRAXIS_ATTUNEMENT_QUESTS) {
        expect(state.questsDone, `${cls} ${questId}`).toContain(questId);
      }
    }
  });

  it('attunement survives the server login round-trip (the raid door reads questsDone)', () => {
    const state = buildBoostedCharacterState('warlock', 'Pbetestdoor', 0);
    const revived = JSON.parse(JSON.stringify(state)) as CharacterState;
    const sim = new Sim({ seed: 7, playerClass: 'warlock', playerName: 'unused', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Pbetestdoor', { state: revived });
    // canEnterNythraxisRaid (src/sim/instances/dungeons.ts) gates on exactly
    // this quest id in the loaded meta.
    expect(sim.meta(pid)?.questsDone.has('q_nythraxis_bound_guardian')).toBe(true);
  });
});

describe('boostAccountCharacters', () => {
  function fakes() {
    const created: { name: string; cls: PlayerClass; state: CharacterState }[] = [];
    const saved: { id: number; level: number }[] = [];
    let nextId = 100;
    const deps: BoostDeps = {
      createCharacter: async (
        _accountId: number,
        name: string,
        cls: PlayerClass,
        state: CharacterState,
      ): Promise<BoostCreateResult> => {
        created.push({ name, cls, state });
        return { id: nextId++ };
      },
      saveState: async (id: number, level: number) => {
        saved.push({ id, level });
      },
      rand: lcg(23),
    };
    return { created, saved, deps };
  }

  it('creates one level-20 character per class with distinct valid names', async () => {
    const { created, saved, deps } = fakes();
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(BOOST_CLASSES.length);
    expect(created.map((c) => c.cls).sort()).toEqual([...BOOST_CLASSES].sort());
    const names = new Set(created.map((c) => c.name));
    expect(names.size).toBe(BOOST_CLASSES.length);
    for (const c of created) {
      expect(normalizeCharName(c.name)).toBe(c.name);
      expect(c.state.level).toBe(BOOST_LEVEL);
    }
    expect(saved).toHaveLength(BOOST_CLASSES.length);
    for (const s of saved) expect(s.level).toBe(BOOST_LEVEL);
  });

  it('retries with a different name when the first is taken', async () => {
    const { created, deps } = fakes();
    const tried: string[] = [];
    const inner = deps.createCharacter;
    let rejectedOnce = false;
    deps.createCharacter = async (accountId, name, cls, state) => {
      tried.push(name);
      if (!rejectedOnce) {
        rejectedOnce = true;
        return 'name_taken';
      }
      return inner(accountId, name, cls, state);
    };
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(BOOST_CLASSES.length);
    expect(tried.length).toBe(BOOST_CLASSES.length + 1);
    expect(tried[0]).not.toBe(tried[1]);
    expect(created).toHaveLength(BOOST_CLASSES.length);
  });

  it('a failure on one class never blocks the rest', async () => {
    const { created, deps } = fakes();
    const inner = deps.createCharacter;
    deps.createCharacter = async (accountId, name, cls, state) => {
      if (cls === 'priest') throw new Error('boom');
      return inner(accountId, name, cls, state);
    };
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(BOOST_CLASSES.length - 1);
    expect(created.some((c) => c.cls === 'priest')).toBe(false);
    expect(created).toHaveLength(BOOST_CLASSES.length - 1);
  });

  it('stops burning names after the retry budget (account at cap)', async () => {
    const { deps } = fakes();
    deps.createCharacter = async () => 'name_taken';
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(0);
  });
});
