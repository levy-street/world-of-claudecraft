// The NPC nameplate role tag (src/sim/npc_role.ts): what an NPC DOES, derived
// from its content flags, the profession STATIONS roster and its vendor stock.
// Pinned here: the priority order (a service flag beats stock, a profession
// master is a trainer before a tool vendor), every stock classification arm,
// the null arm that hands the painter the authored flavor title, and that
// every role id has a catalog label so no NPC can ever draw a raw key.

import { describe, expect, it } from 'vitest';
import { NPCS } from '../src/sim/data';
import { NPC_ROLES, npcRoleFor, vendorRoleForStock } from '../src/sim/npc_role';
import type { NpcDef } from '../src/sim/types';
import { setLanguage, t } from '../src/ui/i18n';

function def(over: Partial<NpcDef>): NpcDef {
  return {
    id: 'test_npc',
    name: 'Test',
    title: 'Flavor Title',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0,
    questIds: [],
    greeting: '',
    ...over,
  };
}

describe('npcRoleFor', () => {
  it('service flags win over any stock they also carry', () => {
    expect(npcRoleFor(def({ market: true, vendorItems: ['handaxe'] }))).toBe('auctioneer');
    expect(npcRoleFor(def({ banker: true }))).toBe('banker');
    expect(npcRoleFor(def({ riftForge: true }))).toBe('riftForgemaster');
    expect(npcRoleFor(def({ cardMaster: true }))).toBe('cardMaster');
    expect(npcRoleFor(def({ crucibleVendor: true, vendorItems: ['handaxe'] }))).toBe(
      'crucibleQuartermaster',
    );
    expect(npcRoleFor(def({ heroicVendor: true }))).toBe('heroicQuartermaster');
    expect(npcRoleFor(def({ warfareVendor: true, vendorItems: ['handaxe'] }))).toBe('pvpVendor');
  });

  it('a resident profession master is a trainer before a tool vendor', () => {
    expect(npcRoleFor(NPCS.forgemistress_darva)).toBe('weaponsmithTrainer');
    expect(npcRoleFor(NPCS.cook_marlow)).toBe('cookingTrainer');
    expect(npcRoleFor(NPCS.weaver_ottilie)).toBe('tailoringTrainer');
    expect(npcRoleFor(NPCS.tinker_gizzel)).toBe('engineeringTrainer');
    expect(npcRoleFor(NPCS.tanner_hesk)).toBe('leatherworkingTrainer');
    expect(npcRoleFor(NPCS.alchemist_verane)).toBe('alchemyTrainer');
  });

  it('classifies shipped vendors by their stock', () => {
    expect(npcRoleFor(NPCS.smith_haldren)).toBe('armsDealer');
    expect(npcRoleFor(NPCS.wardsmith_orun)).toBe('armorVendor');
    expect(npcRoleFor(NPCS.stablemaster_marla)).toBe('stableMaster');
    expect(npcRoleFor(NPCS.trader_wilkes)).toBe('generalGoods');
    expect(npcRoleFor(NPCS.warmarshal_draven_kole)).toBe('pvpVendor');
    expect(npcRoleFor(NPCS.the_merchant)).toBe('auctioneer');
    expect(npcRoleFor(NPCS.bursar_wick)).toBe('banker');
  });

  it('an NPC with no functional role resolves to null (the flavor-title arm)', () => {
    expect(npcRoleFor(NPCS.loremaster_caddis)).toBeNull();
    expect(npcRoleFor(def({ questIds: ['q_anything'] }))).toBeNull();
    expect(npcRoleFor(def({ vendorItems: [] }))).toBeNull();
    // A stock of only unknown ids is treated as no stock, never a crash.
    expect(npcRoleFor(def({ vendorItems: ['no_such_item'] }))).toBeNull();
  });

  it('is deterministic across the whole NPC table', () => {
    const run = () => Object.values(NPCS).map((n) => [n.id, npcRoleFor(n)] as const);
    expect(run()).toEqual(run());
  });
});

describe('vendorRoleForStock', () => {
  it('covers every classification arm', () => {
    expect(vendorRoleForStock(['worn_sword'])).toBe('weaponVendor');
    expect(vendorRoleForStock(['wardplate_cuirass'])).toBe('armorVendor');
    expect(vendorRoleForStock(['worn_sword', 'wardplate_cuirass'])).toBe('armsDealer');
    expect(vendorRoleForStock(['tough_jerky'])).toBe('foodVendor');
    expect(vendorRoleForStock(['riding_training'])).toBe('stableMaster');
    // Mixed families read as a general store.
    expect(vendorRoleForStock(['worn_sword', 'tough_jerky'])).toBe('generalGoods');
    expect(vendorRoleForStock(['smithing_flux'])).toBe('generalGoods');
    expect(vendorRoleForStock([])).toBeNull();
  });
});

describe('role catalog coverage', () => {
  it('every role id has an English nameplate label and the tag wrapper exists', () => {
    setLanguage('en');
    for (const role of NPC_ROLES) {
      const label = t(`hudChrome.nameplate.npcRole.${role}`);
      expect(label, `${role} has no catalog label`).not.toBe(`hudChrome.nameplate.npcRole.${role}`);
      expect(label).not.toBe('');
    }
    expect(t('hudChrome.nameplate.npcRoleTag', { role: 'Banker' })).toBe('<Banker>');
  });
});
