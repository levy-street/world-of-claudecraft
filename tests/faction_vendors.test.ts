import { describe, expect, it } from 'vitest';
import {
  FACTION_VENDOR_GATES,
  FACTION_VENDOR_ITEMS,
  resolveFactionVendorRowGate,
} from '../src/sim/content/faction_vendors';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  FACTION_IDS,
  freshFactionReputation,
  STANDING_THRESHOLDS,
  STANDING_TIERS,
} from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import { buildVendorView } from '../src/ui/hud/vendor/vendor_view';

describe('Faction Vendors & Reroll NPC content', () => {
  it('registers all three faction quartermasters and the taskmaster in NPCS', () => {
    const qmRift = NPCS.npc_rift_watch_quartermaster;
    expect(qmRift).toBeDefined();
    expect(qmRift.name).toBe('Quartermaster Vaelen');
    expect(qmRift.title).toBe('Rift Watch Provisioner');
    expect(qmRift.vendorItems?.length).toBe(5);

    const qmChurch = NPCS.npc_church_order_quartermaster;
    expect(qmChurch).toBeDefined();
    expect(qmChurch.name).toBe('Templar Althea');
    expect(qmChurch.title).toBe('Church Order Quartermaster');
    expect(qmChurch.vendorItems?.length).toBe(5);

    const qmAuto = NPCS.npc_automaton_quartermaster;
    expect(qmAuto).toBeDefined();
    expect(qmAuto.name).toBe('Artificer Tobrin');
    expect(qmAuto.title).toBe('Automaton Requisitioner');
    expect(qmAuto.vendorItems?.length).toBe(5);

    const taskmaster = NPCS.npc_wq_taskmaster;
    expect(taskmaster).toBeDefined();
    expect(taskmaster.name).toBe('Taskmaster Kaelen');
    expect(taskmaster.title).toBe('World Quest Taskmaster');
    expect(taskmaster.greeting).toContain('assignments');
  });

  it('authors exactly 15 faction vendor items (5 tiers × 3 factions)', () => {
    const itemIds = Object.keys(FACTION_VENDOR_ITEMS);
    expect(itemIds.length).toBe(15);

    for (const factionId of FACTION_IDS) {
      const itemsForFaction = itemIds.filter(
        (id) => FACTION_VENDOR_GATES[id]?.factionId === factionId,
      );
      expect(itemsForFaction.length).toBe(5);

      // Verify one item per tier
      const tiersCovered = itemsForFaction.map((id) => FACTION_VENDOR_GATES[id]?.standingTier);
      expect(tiersCovered).toEqual(
        expect.arrayContaining(['recognized', 'trusted', 'proven', 'vanguard', 'champion']),
      );
    }

    // Every item is also in the global ITEMS dictionary
    for (const id of itemIds) {
      expect(ITEMS[id]).toBeDefined();
      expect(ITEMS[id].buyValue).toBeGreaterThan(0);
      expect(ITEMS[id].sellValue).toBeGreaterThan(0);
    }
  });

  it('correctly maps FACTION_VENDOR_GATES to the exact standing thresholds', () => {
    for (const [_itemId, gate] of Object.entries(FACTION_VENDOR_GATES)) {
      expect(gate.requiredStanding).toBe(STANDING_THRESHOLDS[gate.standingTier]);
      expect(FACTION_IDS).toContain(gate.factionId);
      expect(STANDING_TIERS).toContain(gate.standingTier);
    }
  });

  it('evaluates resolveFactionVendorRowGate accurately', () => {
    const factions = freshFactionReputation();
    factions.rift_watch = 2_500; // Above Recognized (1,000), below Trusted (3,000)

    // Tier 1 Rift Watch (Recognized - 1,000) -> Unlocked
    const t1 = resolveFactionVendorRowGate('rift_watchers_band', factions);
    expect(t1.locked).toBe(false);
    expect(t1.currentStanding).toBe(2_500);

    // Tier 2 Rift Watch (Trusted - 3,000) -> Locked
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

    // Attempting to buy Tier 2 (Trusted - 3,000) still fails
    sim.buyItem(qm.id, 'vestments_of_the_acolyte');
    expect(sim.countItem('vestments_of_the_acolyte')).toBe(0);

    // Elevate to Trusted (3,000)
    meta.factions.church_order = 3_000;
    sim.buyItem(qm.id, 'vestments_of_the_acolyte');
    expect(sim.countItem('vestments_of_the_acolyte')).toBe(1);
    expect(meta.copper).toBe(80_000); // 95,000 - 15,000 buyValue
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
      'rift_watchers_band', // Recognized (1,000) -> Unlocked
      'rift_surveyors_satchel', // Trusted (3,000) -> Locked
      'automaton_cog_ring', // Recognized (1,000) -> Unlocked
      'artificers_welding_cowl', // Proven (7,000) -> Unlocked
      'forgemaster_crag_cleaver', // Vanguard (13,000) -> Locked
    ];

    const view = buildVendorView(vendorStock, [], ITEMS, balances);
    expect(view.goods.length).toBe(5);

    const r1 = view.goods.find((g) => g.itemId === 'rift_watchers_band');
    expect(r1).toBeDefined();
    expect(r1?.requirementUnmet).toBe(false);

    const r2 = view.goods.find((g) => g.itemId === 'rift_surveyors_satchel');
    expect(r2).toBeDefined();
    expect(r2?.requirementUnmet).toBe(true);
    expect(r2?.factionRequirement?.standingTier).toBe('trusted');

    const a1 = view.goods.find((g) => g.itemId === 'automaton_cog_ring');
    expect(a1).toBeDefined();
    expect(a1?.requirementUnmet).toBe(false);

    const a3 = view.goods.find((g) => g.itemId === 'artificers_welding_cowl');
    expect(a3).toBeDefined();
    expect(a3?.requirementUnmet).toBe(false);

    const a4 = view.goods.find((g) => g.itemId === 'forgemaster_crag_cleaver');
    expect(a4).toBeDefined();
    expect(a4?.requirementUnmet).toBe(true);
    expect(a4?.factionRequirement?.standingTier).toBe('vanguard');
  });
});
