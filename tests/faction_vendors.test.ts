// The faction quartermaster ladder (content/faction_vendors.ts,
// docs/design/factions.md "What standing unlocks"): three quartermasters, one
// ladder per faction covering every standing tier, every row gated on the
// exact tier threshold, and every budget COPIED from the raid or heroic row it
// mirrors rather than invented. Faction stock is untiered in item_level.ts,
// so the mirror pins here are the only budget guard it has.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import {
  FACTION_VENDOR_GATES,
  FACTION_VENDOR_ITEMS,
  FACTION_VENDOR_NPCS,
  FACTION_VENDOR_STOCK,
  resolveFactionVendorRowGate,
} from '../src/sim/content/faction_vendors';
import { FIVE_MAN_WEAPON_RATING } from '../src/sim/content/heroic_loot';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  FACTION_IDS,
  freshFactionReputation,
  STANDING_THRESHOLDS,
  STANDING_TIERS,
} from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import { buildVendorView } from '../src/ui/hud/vendor/vendor_view';

const LADDER_TIERS = ['recognized', 'trusted', 'proven', 'vanguard', 'champion'] as const;
const FORMULA_IDS = [
  'formula_riftwalkers_grace',
  'formula_dawnfire_etching',
  'formula_dawns_benediction',
  'formula_piston_drive',
] as const;

describe('Faction Vendors & Reroll NPC content', () => {
  it('registers all three faction quartermasters and the taskmaster in NPCS', () => {
    const qmRift = NPCS.npc_rift_watch_quartermaster;
    expect(qmRift).toBeDefined();
    expect(qmRift.name).toBe('Quartermaster Vaelen');
    expect(qmRift.title).toBe('Rift Watch Provisioner');
    expect(qmRift.vendorItems).toEqual([...FACTION_VENDOR_STOCK.rift_watch]);

    const qmChurch = NPCS.npc_church_order_quartermaster;
    expect(qmChurch).toBeDefined();
    expect(qmChurch.name).toBe('Templar Althea');
    expect(qmChurch.title).toBe('Church Order Quartermaster');
    expect(qmChurch.vendorItems).toEqual([...FACTION_VENDOR_STOCK.church_order]);

    const qmAuto = NPCS.npc_automaton_quartermaster;
    expect(qmAuto).toBeDefined();
    expect(qmAuto.name).toBe('Artificer Tobrin');
    expect(qmAuto.title).toBe('Automaton Requisitioner');
    expect(qmAuto.vendorItems).toEqual([...FACTION_VENDOR_STOCK.automatons]);

    const taskmaster = NPCS.npc_wq_taskmaster;
    expect(taskmaster).toBeDefined();
    expect(taskmaster.name).toBe('Taskmaster Kaelen');
    expect(taskmaster.title).toBe('World Quest Taskmaster');
    expect(taskmaster.greeting).toContain('assignments');
    expect(Object.keys(FACTION_VENDOR_NPCS)).toHaveLength(4);
  });

  it('the stock lists, the gate table and the item table name exactly the same 32 rows', () => {
    const stockIds = FACTION_IDS.flatMap((f) => [...FACTION_VENDOR_STOCK[f]]);
    expect(stockIds).toHaveLength(32);
    expect(new Set(stockIds).size).toBe(32);
    expect([...stockIds].sort()).toEqual(Object.keys(FACTION_VENDOR_GATES).sort());
    expect([...stockIds].sort()).toEqual(Object.keys(FACTION_VENDOR_ITEMS).sort());
    for (const factionId of FACTION_IDS) {
      for (const id of FACTION_VENDOR_STOCK[factionId]) {
        expect(FACTION_VENDOR_GATES[id].factionId, id).toBe(factionId);
        expect(ITEMS[id], id).toBeDefined();
        expect(ITEMS[id].buyValue, id).toBeGreaterThan(0);
        // Formulas are bind-on-pickup knowledge and never vendor back.
        if (ITEMS[id].kind === 'recipe') expect(ITEMS[id].sellValue, id).toBe(0);
        else expect(ITEMS[id].sellValue, id).toBeGreaterThan(0);
      }
    }
  });

  it('every faction ladder covers all five standing tiers, in ladder order', () => {
    for (const factionId of FACTION_IDS) {
      const tiers = FACTION_VENDOR_STOCK[factionId].map(
        (id) => FACTION_VENDOR_GATES[id].standingTier,
      );
      expect(new Set(tiers), factionId).toEqual(new Set(LADDER_TIERS));
      // Monotone: a row never sits below the tier of the row before it.
      const ranks = tiers.map((t) => STANDING_TIERS.indexOf(t));
      for (let i = 1; i < ranks.length; i++)
        expect(ranks[i], factionId).toBeGreaterThanOrEqual(ranks[i - 1]);
    }
  });

  it('every tier sells the lane the design names: neck, ring + bag, periphery + formula, weapon, jewels', () => {
    const slotsAt = (factionId: (typeof FACTION_IDS)[number], tier: string) =>
      FACTION_VENDOR_STOCK[factionId]
        .filter((id) => FACTION_VENDOR_GATES[id].standingTier === tier)
        .map((id) => (ITEMS[id].kind === 'recipe' ? 'formula' : (ITEMS[id].slot ?? ITEMS[id].kind)))
        .sort();
    for (const factionId of FACTION_IDS) {
      expect(slotsAt(factionId, 'recognized'), factionId).toEqual(['neck']);
      expect(slotsAt(factionId, 'trusted'), factionId).toContain('ring');
      expect(slotsAt(factionId, 'proven'), factionId).toEqual(
        expect.arrayContaining(['waist', 'feet', 'formula']),
      );
      expect(slotsAt(factionId, 'vanguard'), factionId).toContain('mainhand');
      expect(slotsAt(factionId, 'champion'), factionId).toEqual(
        expect.arrayContaining(['neck', 'ring']),
      );
    }
    expect(slotsAt('rift_watch', 'trusted')).toEqual(['bag', 'ring']);
    expect(slotsAt('automatons', 'trusted')).toEqual(['bag', 'ring']);
  });

  it('correctly maps FACTION_VENDOR_GATES to the exact standing thresholds', () => {
    for (const [_itemId, gate] of Object.entries(FACTION_VENDOR_GATES)) {
      expect(gate.requiredStanding).toBe(STANDING_THRESHOLDS[gate.standingTier]);
      expect(FACTION_IDS).toContain(gate.factionId);
      expect(STANDING_TIERS).toContain(gate.standingTier);
    }
  });

  it('prices climb the tier ladder and sell back at a quarter (formulas excepted)', () => {
    const PRICE = {
      recognized: 5_000,
      trusted: 15_000,
      proven: 35_000,
      vanguard: 80_000,
      champion: 150_000,
    };
    for (const [id, gate] of Object.entries(FACTION_VENDOR_GATES)) {
      const tier = gate.standingTier as keyof typeof PRICE;
      expect(ITEMS[id].buyValue, id).toBe(PRICE[tier]);
      if (ITEMS[id].kind !== 'recipe') expect(ITEMS[id].sellValue, id).toBe(PRICE[tier] / 4);
    }
  });

  it('evaluates resolveFactionVendorRowGate accurately', () => {
    const factions = freshFactionReputation();
    factions.rift_watch = 2_500; // Above Recognized (1,000), below Trusted (3,000)

    const t1 = resolveFactionVendorRowGate('tidewatchers_locket', factions);
    expect(t1.locked).toBe(false);
    expect(t1.currentStanding).toBe(2_500);

    const t2 = resolveFactionVendorRowGate('rift_surveyors_satchel', factions);
    expect(t2.locked).toBe(true);
    expect(t2.requirement?.standingTier).toBe('trusted');

    // Church Order items (standing is 0) -> Locked
    const churchT1 = resolveFactionVendorRowGate('order_prayer_beads', factions);
    expect(churchT1.locked).toBe(true);

    // Non-faction item -> Unlocked (no requirement)
    const nonFaction = resolveFactionVendorRowGate('linen_cloth', factions);
    expect(nonFaction.locked).toBe(false);
    expect(nonFaction.requirement).toBeUndefined();
  });
});

// Every budget is a copy of a live row. The right-hand side of each pin is the
// row it mirrors, read off the merged catalog, so a retune of the raid or
// heroic table is a red here rather than silent drift between the two.
describe('faction ladder budgets mirror the raid and heroic tables', () => {
  const stats = (id: string) => ITEMS[id].stats ?? {};
  const ratings = (id: string) => {
    const it = ITEMS[id] as unknown as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const k of ['critRating', 'hitRating', 'hasteRating', 'spellPower', 'healPower']) {
      if (typeof it[k] === 'number') out[k] = it[k] as number;
    }
    return out;
  };
  const ratingSum = (id: string) => Object.values(ratings(id)).reduce((a, b) => a + b, 0);
  const line = (id: string) => {
    const s = stats(id);
    return (s.str ?? 0) + (s.agi ?? 0) + (s.int ?? 0) + (s.spi ?? 0) + (s.sta ?? 0);
  };

  it('Recognized necks and Trusted rings carry the heroic vendor jewel budget: one 25 rating, its line', () => {
    const pairs: Array<[string, string]> = [
      ['tidewatchers_locket', 'yumis_keepsake_locket'],
      ['rift_watchers_band', 'sutils_gambit'],
      ['order_prayer_beads', 'architects_cornerstone'],
      ['acolytes_signet', 'zense_meridian'],
      ['cogwork_choker', 'medallion_of_endless_profit'],
      ['automaton_cog_ring', 'seal_of_the_nine_oaths'],
    ];
    for (const [id, mirror] of pairs) {
      expect(ITEMS[id].quality, id).toBe('rare');
      expect(line(id), `${id} line vs ${mirror}`).toBe(line(mirror));
      expect(ratingSum(id), `${id} rating vs ${mirror}`).toBe(25);
      expect(Object.keys(ratings(id)), id).toHaveLength(1);
    }
  });

  it('Champion jewels carry the raid jewel rating with their line one point under the raid mirror', () => {
    const pairs: Array<[string, string]> = [
      ['riftwardens_pendant', 'pendant_of_the_first_tempering'],
      ['champion_rift_band', 'seal_of_the_forgewall'],
      ['champion_dawn_medallion', 'locket_of_the_last_flame'],
      ['champions_dawn_loop', 'circle_of_cinders'],
      ['dawnkeepers_circle', 'loop_of_quiet_springs'],
      ['forgewall_gorget', 'pendant_of_the_first_tempering'],
      ['champion_forged_loop', 'seal_of_the_forgewall'],
    ];
    for (const [id, mirror] of pairs) {
      expect(ITEMS[id].quality, id).toBe('epic');
      expect(line(id), `${id} line vs ${mirror}`).toBe(line(mirror) - 1);
      const mirrorRatings = ratings(mirror);
      const ownRatings = ratings(id);
      // The raid jewel's one 25 rating, plus the same power line where the
      // mirror carries one (spellPower 4 / healPower 8).
      expect(
        Object.values(ownRatings).filter((v) => v === 25),
        id,
      ).toHaveLength(1);
      expect(ownRatings.spellPower, id).toBe(mirrorRatings.spellPower);
      expect(ownRatings.healPower, id).toBe(mirrorRatings.healPower);
    }
    // The two tank jewels are Stamina-first: the raid never sells that line.
    expect(stats('forgewall_gorget').sta).toBeGreaterThan(stats('forgewall_gorget').str ?? 0);
    expect(stats('champion_forged_loop').sta).toBeGreaterThan(
      stats('champion_forged_loop').str ?? 0,
    );
    for (const id of ['forgewall_gorget', 'champion_forged_loop']) {
      expect(stats(id).armor, `${id} carries no armor (bis picker)`).toBeUndefined();
      expect((ITEMS[id] as { blockValue?: number }).blockValue, id).toBeUndefined();
    }
  });

  it('Proven waist and feet carry the raid offset ratings and armor with the line one point under', () => {
    // One under on BOTH axes the pickers score, never a tie: dev/bis_gear.ts
    // scores armor plus the class line and the max-armor tank kit
    // (tests/heroic_difficulty_floors.test.ts) breaks an armor tie by id, so
    // an exact mirror would hand the faction row every /dev bis kit and the
    // tank reference pools (both moved by that tie before this rule).
    const pairs: Array<[string, string]> = [
      ['riftwalkers_cord', 'slagstalker_belt'],
      ['riftwalkers_treads', 'ashrunner_boots'],
      ['cord_of_the_dawn', 'cord_of_the_last_flame'],
      ['dawnlit_slippers', 'steps_of_quiet_water'],
      ['forgemasters_girdle', 'warforged_waistguard'],
      ['forgemasters_sabatons', 'furnace_march_greaves'],
    ];
    for (const [id, mirror] of pairs) {
      expect(ITEMS[id].quality, id).toBe('epic');
      expect(ITEMS[id].slot, id).toBe(ITEMS[mirror].slot);
      expect(ITEMS[id].armorType, id).toBe(ITEMS[mirror].armorType);
      expect(stats(id).armor, `${id} armor vs ${mirror}`).toBe((stats(mirror).armor ?? 0) - 1);
      expect(line(id), `${id} line vs ${mirror}`).toBe(line(mirror) - 1);
      expect(ratings(id), `${id} ratings vs ${mirror}`).toEqual(ratings(mirror));
    }
  });

  it('Proven set-slot pieces mirror a heroic five-man drop', () => {
    const pairs: Array<[string, string]> = [
      ['riftwalkers_tunic', 'basin_stalkers_tunic'],
      ['vestments_of_the_acolyte', 'shroud_of_the_gravewyrm'],
      ['artificers_welding_cowl', 'cryptplate_helm'],
    ];
    for (const [id, mirror] of pairs) {
      expect(ITEMS[id].quality, id).toBe('rare');
      expect(ITEMS[id].slot, id).toBe(ITEMS[mirror].slot);
      expect(ITEMS[id].armorType, id).toBe(ITEMS[mirror].armorType);
      expect(stats(id), `${id} vs ${mirror}`).toEqual(stats(mirror));
      expect(ratingSum(id), id).toBe(40);
    }
  });

  it('Vanguard weapons sit on the heroic five-man weapon bar and each carries one proc', () => {
    const dps = (id: string) => {
      const w = ITEMS[id].weapon!;
      return (w.min + w.max) / 2 / w.speed;
    };
    const heroicBar = ['gravewyrm_cleaver', 'deathless_greatblade'].map(dps);
    const [low, high] = [Math.min(...heroicBar), Math.max(...heroicBar)];
    for (const id of [
      'riftwarden_voidblade',
      'dawnkeeper_consecrated_mace',
      'forgemaster_crag_cleaver',
    ]) {
      const def = ITEMS[id];
      if (def.kind !== 'weapon') throw new Error(`${id} is not a weapon`);
      expect(def.quality, id).toBe('epic');
      expect(dps(id), `${id} dps within the heroic bar`).toBeGreaterThanOrEqual(low - 0.05);
      expect(dps(id), `${id} dps within the heroic bar`).toBeLessThanOrEqual(high + 0.05);
      expect(def.weaponProcs, id).toHaveLength(1);
      expect(ratingSum(id) - (def.healPower ?? 0), id).toBe(FIVE_MAN_WEAPON_RATING);
    }
    // The Voidblade is the game's first fast non-dagger one-hander.
    const weapon = (id: string) => {
      const def = ITEMS[id];
      if (def.kind !== 'weapon') throw new Error(`${id} is not a weapon`);
      return def;
    };
    expect(weapon('riftwarden_voidblade').weapon.speed).toBe(1.6);
    expect(weapon('riftwarden_voidblade').weapon.dagger).toBeUndefined();
    expect(weapon('riftwarden_voidblade').weaponProcs?.[0].effects).toEqual([
      { kind: 'attackSlow', name: 'Rift Drag', mult: 1.2, duration: 6 },
    ]);
    // The Crag Cleaver is two-handed, the home of the faction's Piston Drive.
    expect(weapon('forgemaster_crag_cleaver').hand).toBe('twohand');
    expect(weapon('forgemaster_crag_cleaver').weaponProcs?.[0].trigger).toBe('weaponHit');
    // The healer mace procs on heals, never on swings.
    expect(weapon('dawnkeeper_consecrated_mace').weaponProcs?.[0].trigger).toBe('heal');
    expect(weapon('dawnkeeper_consecrated_mace').weaponProcs?.[0].effects[0].kind).toBe('hot');
    expect(weapon('dawnkeeper_consecrated_mace').healPower).toBe(32);
  });

  it('the four formulas teach the four learned faction enchants, at Proven', () => {
    const taught = FORMULA_IDS.map((id) => {
      const def = ITEMS[id];
      expect(def.kind, id).toBe('recipe');
      expect(FACTION_VENDOR_GATES[id].standingTier, id).toBe('proven');
      if (def.kind !== 'recipe') throw new Error('narrowed above');
      expect(def.teachesEnchantId, id).toBe(def.teachesRecipeId);
      expect(ENCHANTS[def.teachesEnchantId ?? ''].acquisition, id).toBe('drop');
      return def.teachesEnchantId;
    });
    expect(taught).toEqual([
      'enchant_weapon_riftwalkers_grace',
      'enchant_weapon_dawnfire_etching',
      'enchant_weapon_dawns_benediction',
      'enchant_weapon_piston_drive',
    ]);
  });

  it('the bags are 14 slots, one step over the 12-slot uncommon line', () => {
    for (const id of ['rift_surveyors_satchel', 'clockwork_tinkers_pack']) {
      expect(ITEMS[id].kind, id).toBe('bag');
      expect(ITEMS[id].bagSlots, id).toBe(14);
    }
  });
});

describe('Faction vendor purchase authoritative simulation & UI', () => {
  it('enforces standing gates during sim.buyItem authoritative purchase', () => {
    const sim = new Sim({ seed: 777, playerClass: 'warrior', autoEquip: false });
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    meta.copper = 100_000; // 10 gold, plenty of copper
    meta.factions.church_order = 500; // Not yet Recognized (requires 1,000)

    // Find the Church Quartermaster in Eastbrook Vale and move player into range
    const qm = [...sim.entities.values()].find(
      (e) => e.templateId === 'npc_church_order_quartermaster',
    );
    expect(qm).toBeDefined();
    if (!qm) return;
    sim.player.pos.x = qm.pos.x;
    sim.player.pos.z = qm.pos.z;

    // Purchase should be refused due to standing
    sim.drainEvents();
    sim.buyItem(qm.id, 'order_prayer_beads');
    const deniedEvents = sim.drainEvents();
    expect(
      deniedEvents.some((e) => e.type === 'error' && e.text.includes('Requires Recognized')),
    ).toBe(true);
    expect(sim.countItem('order_prayer_beads')).toBe(0);
    expect(meta.copper).toBe(100_000);

    // Increase standing to Recognized (1,000)
    meta.factions.church_order = 1_000;
    sim.buyItem(qm.id, 'order_prayer_beads');
    expect(sim.countItem('order_prayer_beads')).toBe(1);
    expect(meta.copper).toBe(95_000); // 100,000 - 5,000 buyValue

    // Attempting to buy Trusted (3,000) still fails
    sim.buyItem(qm.id, 'acolytes_signet');
    expect(sim.countItem('acolytes_signet')).toBe(0);

    // Elevate to Trusted (3,000)
    meta.factions.church_order = 3_000;
    sim.buyItem(qm.id, 'acolytes_signet');
    expect(sim.countItem('acolytes_signet')).toBe(1);
    expect(meta.copper).toBe(80_000); // 95,000 - 15,000 buyValue

    // A Proven formula is refused at Trusted and sold at Proven.
    sim.buyItem(qm.id, 'formula_dawnfire_etching');
    expect(sim.countItem('formula_dawnfire_etching')).toBe(0);
    meta.factions.church_order = 7_000;
    sim.buyItem(qm.id, 'formula_dawnfire_etching');
    expect(sim.countItem('formula_dawnfire_etching')).toBe(1);
    expect(meta.copper).toBe(45_000); // 80,000 - 35,000 buyValue
  });

  it('a bought formula teaches its enchant once the buyer holds Enchanting 100', () => {
    const sim = new Sim({ seed: 778, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.meta(pid);
    if (!meta) throw new Error('fixture player missing');
    sim.addItem('formula_piston_drive', 1, pid);
    meta.craftSkills.enchanting = 99;
    sim.useItem('formula_piston_drive');
    expect(meta.knownRecipes.has('enchant_weapon_piston_drive')).toBe(false);
    expect(sim.countItem('formula_piston_drive', pid)).toBe(1);
    meta.craftSkills.enchanting = 100;
    sim.useItem('formula_piston_drive');
    expect(meta.knownRecipes.has('enchant_weapon_piston_drive')).toBe(true);
    expect(sim.countItem('formula_piston_drive', pid)).toBe(0);
  });

  it('marks locked rows and supplies requirement metadata in buildVendorView', () => {
    const balances = {
      copper: 50_000,
      honor: 0,
      gatheringProficiency: { mining: 0, logging: 0, herbalism: 0 },
      factions: {
        rift_watch: 1_200, // Recognized
        church_order: 0,
        automatons: 8_000, // Proven
      },
    };

    const vendorStock = [
      'tidewatchers_locket', // Recognized (1,000) -> Unlocked
      'rift_surveyors_satchel', // Trusted (3,000) -> Locked
      'cogwork_choker', // Recognized (1,000) -> Unlocked
      'formula_piston_drive', // Proven (7,000) -> Unlocked
      'forgemaster_crag_cleaver', // Vanguard (13,000) -> Locked
    ];

    const view = buildVendorView(vendorStock, [], ITEMS, balances);
    expect(view.goods.length).toBe(5);

    const r1 = view.goods.find((g) => g.itemId === 'tidewatchers_locket');
    expect(r1).toBeDefined();
    expect(r1?.requirementUnmet).toBe(false);

    const r2 = view.goods.find((g) => g.itemId === 'rift_surveyors_satchel');
    expect(r2).toBeDefined();
    expect(r2?.requirementUnmet).toBe(true);
    expect(r2?.factionRequirement?.standingTier).toBe('trusted');

    const a1 = view.goods.find((g) => g.itemId === 'cogwork_choker');
    expect(a1).toBeDefined();
    expect(a1?.requirementUnmet).toBe(false);

    const a3 = view.goods.find((g) => g.itemId === 'formula_piston_drive');
    expect(a3).toBeDefined();
    expect(a3?.requirementUnmet).toBe(false);

    const a4 = view.goods.find((g) => g.itemId === 'forgemaster_crag_cleaver');
    expect(a4).toBeDefined();
    expect(a4?.requirementUnmet).toBe(true);
    expect(a4?.factionRequirement?.standingTier).toBe('vanguard');
  });
});
