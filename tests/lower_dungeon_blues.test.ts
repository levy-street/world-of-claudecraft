// The lower dungeons' normal blues (maintainer ruling, 2026-10-08; items in
// src/sim/content/hollow_crypt_items.ts, sunken_bastion_items.ts and
// drowned_temple_items.ts): every boss and the Gaol Turnkey of the Hollow
// Crypt, the Sunken Bastion and the Drowned Temple pays ONE normalOnly rare
// group holding a cloth, a leather and a mail version of one armour slot plus
// one weapon, about 35 percent in equal shares on a regular boss and
// guaranteed on the final boss. The Mere Hydra's group rides its centre head
// only (each head pays once, on its first death). Item and required levels
// are pinned as literals; new stat lines are checked against the budget
// formulas, never a copied literal.
import { describe, expect, it } from 'vitest';
import { DROWNED_TEMPLE_ITEMS } from '../src/sim/content/drowned_temple_items';
import { HOLLOW_CRYPT_ITEMS } from '../src/sim/content/hollow_crypt_items';
import { SUNKEN_BASTION_ITEMS } from '../src/sim/content/sunken_bastion_items';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { TWOHAND_DPS_MULT, weaponDpsBudget } from '../src/sim/item_budget';
import { expectedStatBudget, itemLevel, primaryStatSum } from '../src/sim/item_level';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { rollLoot } from '../src/sim/loot/loot_roll';
import { Rng } from '../src/sim/rng';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';

const HEAVY = ['warrior', 'paladin', 'shaman'];
const AGILE = ['rogue', 'hunter'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'];

type Piece = readonly [id: string, itemLevel: number, requiredLevel: number];
interface BlueGroup {
  group: string;
  total: number;
  slot: ItemDef['slot'];
  mail: Piece;
  leather: Piece;
  cloth: Piece;
  weapon: Piece;
}

const REGULAR = 0.35;
const FINAL = 1;

const DUNGEONS: Record<string, Record<string, BlueGroup>> = {
  hollow_crypt: {
    sexton_marrow: {
      group: 'marrow_blue',
      total: REGULAR,
      slot: 'gloves',
      mail: ['spadeworn_gauntlets', 11, 8],
      leather: ['gravedirt_grips', 11, 8],
      cloth: ['bellrope_mitts', 11, 8],
      weapon: ['sextons_spadehaft', 11, 8],
    },
    rimeweb: {
      group: 'rimeweb_blue',
      total: REGULAR,
      slot: 'helmet',
      mail: ['rimewreath_coif', 12, 9],
      leather: ['rime_laced_hood', 12, 9],
      cloth: ['lamenting_veil', 12, 9],
      weapon: ['rimeweb_fang', 12, 9],
    },
    cantor_ilvane: {
      group: 'ilvane_blue',
      total: REGULAR,
      slot: 'shoulder',
      mail: ['choirward_pauldrons', 12, 9],
      leather: ['choristers_spaulders', 12, 9],
      cloth: ['cantors_stole', 12, 9],
      weapon: ['cantors_hymnal', 12, 9],
    },
    morthen: {
      group: 'morthen_blue',
      total: FINAL,
      slot: 'chest',
      mail: ['knellbound_hauberk', 13, 10],
      leather: ['candlewatch_jerkin', 13, 10],
      cloth: ['robe_of_the_unquiet_rite', 13, 10],
      weapon: ['gravecallers_rod', 13, 10],
    },
  },
  sunken_bastion: {
    // The shipped Tideguard, Eelscale and Drowned Prayer pieces keep the
    // source tier they shipped at (level 13, item level 16) on level-12 Olen.
    knight_commander_olen: {
      group: 'olen_blue',
      total: REGULAR,
      slot: 'legs',
      mail: ['tideguard_greaves', 16, 13],
      leather: ['eelscale_leggings', 16, 13],
      cloth: ['drowned_prayer_leggings', 16, 13],
      weapon: ['knight_commanders_longsword', 15, 12],
    },
    gaol_turnkey: {
      group: 'turnkey_blue',
      total: REGULAR,
      slot: 'waist',
      mail: ['portcullis_girdle', 16, 13],
      leather: ['cellwatch_belt', 16, 13],
      cloth: ['lanternwick_sash', 16, 13],
      weapon: ['turnkeys_shank', 16, 13],
    },
    gaoler_ossick: {
      group: 'ossick_blue',
      total: REGULAR,
      slot: 'chest',
      mail: ['tidescale_vest', 16, 13],
      leather: ['gaolyard_jerkin', 16, 13],
      cloth: ['brinewarden_robe', 16, 13],
      weapon: ['gaolyard_cudgel', 16, 13],
    },
    vael_the_mistcaller: {
      group: 'vael_blue',
      total: FINAL,
      slot: 'feet',
      mail: ['tideguard_sabatons', 16, 13],
      leather: ['eelscale_treads', 16, 13],
      cloth: ['drowned_prayer_sandals', 16, 13],
      weapon: ['fogbinders_rod', 16, 13],
    },
  },
  drowned_temple: {
    // Selthe's shipped Sea-Striders keep their shipped tier (source 18).
    choirmother_selthe: {
      group: 'selthe_blue',
      total: REGULAR,
      slot: 'feet',
      mail: ['conchplate_sabatons', 19, 16],
      leather: ['selthes_seastriders', 21, 18],
      cloth: ['pale_chorus_slippers', 19, 16],
      weapon: ['chorus_conch', 19, 16],
    },
    tideglass_colossus: {
      group: 'colossus_blue',
      total: REGULAR,
      slot: 'gloves',
      mail: ['tideglass_gauntlets', 20, 17],
      leather: ['moonburn_grips', 20, 17],
      cloth: ['prism_etched_handwraps', 20, 17],
      weapon: ['tideglass_shiv', 20, 17],
    },
    mere_hydra_head_center: {
      group: 'hydra_blue',
      total: REGULAR,
      slot: 'helmet',
      mail: ['mere_crested_helm', 20, 17],
      leather: ['mereskin_hood', 20, 17],
      cloth: ['merewater_cowl', 20, 17],
      weapon: ['merecleaver', 20, 17],
    },
    ysolei: {
      group: 'ysolei_blue',
      total: FINAL,
      slot: 'chest',
      mail: ['moonshroud_breastplate', 21, 18],
      leather: ['moonshroud_tunic', 21, 18],
      cloth: ['moonshroud_robe', 21, 18],
      weapon: ['moonwrack_stave', 21, 18],
    },
  },
};

const BOSSES = Object.values(DUNGEONS).flatMap((bosses) => Object.entries(bosses));

const NEW_ITEM_IDS = [
  'spadeworn_gauntlets',
  'gravedirt_grips',
  'bellrope_mitts',
  'rimewreath_coif',
  'rime_laced_hood',
  'lamenting_veil',
  'choirward_pauldrons',
  'choristers_spaulders',
  'cantors_stole',
  'knellbound_hauberk',
  'candlewatch_jerkin',
  'robe_of_the_unquiet_rite',
  'gravecallers_rod',
  'portcullis_girdle',
  'cellwatch_belt',
  'lanternwick_sash',
  'turnkeys_shank',
  'gaolyard_jerkin',
  'brinewarden_robe',
  'fogbinders_rod',
  'conchplate_sabatons',
  'pale_chorus_slippers',
  'tideglass_gauntlets',
  'moonburn_grips',
  'prism_etched_handwraps',
  'mere_crested_helm',
  'mereskin_hood',
  'merewater_cowl',
  'merecleaver',
  'moonwrack_stave',
];

/** An equippable rare (the blues this ruling is about). */
function isRareGear(id: string | undefined): boolean {
  const item = id ? ITEMS[id] : undefined;
  return (
    item?.quality === 'rare' &&
    !!item.slot &&
    (item.kind === 'armor' || item.kind === 'weapon' || item.kind === 'held_offhand')
  );
}

const weaponArchetype = (item: ItemDef): 'strength' | 'agility' | 'caster' =>
  (item.stats?.str ?? 0) > 0 ? 'strength' : (item.stats?.agi ?? 0) > 0 ? 'agility' : 'caster';

describe('Lower-dungeon normal blues: one group per boss', () => {
  it.each(BOSSES)(
    '%s has exactly one normalOnly blue group: the slot trio plus a weapon',
    (bossId, spec) => {
      const loot = MOBS[bossId].loot;
      const rows = loot.filter((entry) => entry.rollGroup === spec.group);
      expect(rows.map((entry) => entry.itemId)).toEqual([
        spec.mail[0],
        spec.leather[0],
        spec.cloth[0],
        spec.weapon[0],
      ]);
      // Equal shares, summing to the group's total.
      for (const row of rows) expect(row.chance).toBeCloseTo(spec.total / 4, 12);
      expect(rows.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(spec.total, 12);
      expect(rows.every((row) => row.normalOnly === true)).toBe(true);
      // The armour trio: one slot, one piece per armour type and archetype.
      for (const [type, classes, piece] of [
        ['mail', HEAVY, spec.mail],
        ['leather', AGILE, spec.leather],
        ['cloth', CASTER, spec.cloth],
      ] as const) {
        const item = ITEMS[piece[0]];
        expect(item.kind, piece[0]).toBe('armor');
        expect(item.armorType, piece[0]).toBe(type);
        expect(item.slot, piece[0]).toBe(spec.slot);
        expect(item.quality, piece[0]).toBe('rare');
        // Shipped pieces predate the archetype groups (the Tidescale Vest is
        // classless); every new piece is archetype-gated.
        if (NEW_ITEM_IDS.includes(piece[0])) expect(item.requiredClass, piece[0]).toEqual(classes);
      }
      const weapon = ITEMS[spec.weapon[0]];
      expect(['weapon', 'held_offhand']).toContain(weapon.kind);
      expect(weapon.quality).toBe('rare');
      // No other rare gear rolls on this boss's normal table: the group is its
      // one blue. Ysolei's own Pearl Greaves keep their shipped independent row
      // (a mail legs piece named for her completes no other boss's trio).
      const otherBlues = loot.filter(
        (entry) => entry.rollGroup !== spec.group && isRareGear(entry.itemId),
      );
      expect(otherBlues.map((entry) => entry.itemId)).toEqual(
        bossId === 'ysolei' ? ['ysols_pearl_greaves'] : [],
      );
    },
  );

  it.each(BOSSES)(
    '%s blue pieces sit at their pinned item and required levels',
    (_bossId, spec) => {
      for (const [id, ilvl, req] of [spec.mail, spec.leather, spec.cloth, spec.weapon]) {
        expect(itemLevel(ITEMS[id]), id).toBe(ilvl);
        expect(requiredLevelFor(ITEMS[id]), id).toBe(req);
      }
    },
  );

  it("each dungeon's bosses cover different slots, the three together every armour slot", () => {
    const all = new Set<string>();
    for (const bosses of Object.values(DUNGEONS)) {
      const slots = Object.values(bosses).map((spec) => spec.slot as string);
      expect(new Set(slots).size).toBe(slots.length);
      for (const slot of slots) all.add(slot);
    }
    expect([...all].sort()).toEqual(
      ['chest', 'feet', 'gloves', 'helmet', 'legs', 'shoulder', 'waist'].sort(),
    );
  });

  it('every dungeon offers a strength, an agility and a caster weapon', () => {
    for (const [dungeonId, bosses] of Object.entries(DUNGEONS)) {
      const kinds = new Set(
        Object.values(bosses).map((spec) => weaponArchetype(ITEMS[spec.weapon[0]])),
      );
      expect([...kinds].sort(), dungeonId).toEqual(['agility', 'caster', 'strength']);
    }
  });

  it("the Mere Hydra's blue rides its centre head alone; the side heads keep their copper", () => {
    expect(MOBS.mere_hydra_head_left.loot).toEqual([{ copper: 400, chance: 1 }]);
    expect(MOBS.mere_hydra_head_right.loot).toEqual([{ copper: 400, chance: 1 }]);
    expect(MOBS.mere_hydra_head_center.loot[0]).toEqual({ copper: 400, chance: 1 });
  });

  it('the old one-off blue rows are gone into the groups', () => {
    // The shipped chase rows and Olen's one-of-four bonus row folded in.
    expect(MOBS.knight_commander_olen.loot.some((e) => e.rollGroup === 'olen_bonus')).toBe(false);
    // Vael's bonus group keeps its uncommons and the Duffel at their chances.
    expect(
      MOBS.vael_the_mistcaller.loot
        .filter((e) => e.rollGroup === 'vael_bonus')
        .map((e) => [e.itemId, e.chance]),
    ).toEqual([
      ['eelskin_tunic', 0.2],
      ['mistveil_cord', 0.12],
      ['mistveil_grips', 0.12],
      ['mistcallers_duffel', 0.1],
    ]);
  });
});

describe('Lower-dungeon normal blues: the new pieces', () => {
  it('defines every new piece in its dungeon module and the merged ITEMS table', () => {
    const modules: Record<string, ItemDef> = {
      ...HOLLOW_CRYPT_ITEMS,
      ...SUNKEN_BASTION_ITEMS,
      ...DROWNED_TEMPLE_ITEMS,
    };
    for (const id of NEW_ITEM_IDS) {
      expect(modules[id], id).toBeDefined();
      expect(ITEMS[id], id).toBe(modules[id]);
    }
  });

  it('every new piece is budget-exact and every new weapon on its damage curve', () => {
    const weapons: string[] = [];
    for (const id of NEW_ITEM_IDS) {
      const item = ITEMS[id];
      expect(item.quality, id).toBe('rare');
      expect(primaryStatSum(item), id).toBe(expectedStatBudget(item));
      if (item.kind !== 'weapon' || !item.weapon) continue;
      weapons.push(id);
      const w = item.weapon;
      const level = itemLevel(item) ?? 0;
      const curve = weaponDpsBudget(level) * (item.hand === 'twohand' ? TWOHAND_DPS_MULT : 1);
      const dps = (w.min + w.max) / 2 / w.speed;
      expect(Math.abs(dps - curve), id).toBeLessThan(0.3);
    }
    expect(weapons).toEqual([
      'gravecallers_rod',
      'turnkeys_shank',
      'fogbinders_rod',
      'merecleaver',
      'moonwrack_stave',
    ]);
  });
});

describe('Lower-dungeon normal blues: through the real loot roller', () => {
  it('a final boss pays exactly one blue a kill, a regular boss about 35 percent and never two', () => {
    const sim = new Sim({ seed: 77, playerClass: 'warrior' });
    const meta = sim.ctx.players.get(sim.player.id);
    if (!meta) throw new Error('no player meta');
    sim.rng = new Rng(4242);
    const KILLS = 400;
    for (const [bossId, spec] of BOSSES) {
      const ids = [spec.mail[0], spec.leather[0], spec.cloth[0], spec.weapon[0]];
      const seen = new Set<string>();
      let paid = 0;
      for (let kill = 0; kill < KILLS; kill++) {
        const template = MOBS[bossId];
        const mob = createMob(-1, template, template.minLevel, { x: 0, y: 0, z: 0 });
        rollLoot(sim.ctx, mob, meta);
        const pieces = (mob.loot?.items ?? []).filter((slot) => ids.includes(slot.itemId));
        expect(pieces.length, `${bossId} kill ${kill}`).toBeLessThanOrEqual(1);
        if (spec.total === FINAL) expect(pieces, `${bossId} kill ${kill}`).toHaveLength(1);
        if (pieces[0]) {
          paid++;
          seen.add(pieces[0].itemId);
        }
      }
      expect([...seen].sort(), bossId).toEqual([...ids].sort());
      if (spec.total === REGULAR) {
        expect(paid / KILLS, bossId).toBeGreaterThan(0.27);
        expect(paid / KILLS, bossId).toBeLessThan(0.43);
      }
    }
  });

  it('pays no normal blue on a heroic claim (the heroic table pays that slot)', () => {
    const sim = new Sim({ seed: 78, playerClass: 'warrior' });
    const meta = sim.ctx.players.get(sim.player.id);
    if (!meta) throw new Error('no player meta');
    sim.rng = new Rng(77);
    let mobId = 990_000;
    for (const [bossId, spec] of BOSSES) {
      const ids = new Set([spec.mail[0], spec.leather[0], spec.cloth[0], spec.weapon[0]]);
      const template = MOBS[bossId];
      for (let kill = 0; kill < 60; kill++) {
        const mob = createMob(++mobId, template, template.minLevel, { x: 0, y: 0, z: 0 });
        const inst: InstanceSlot = {
          dungeonId: 'heroic-claim-probe',
          difficulty: 'heroic',
          slot: 0,
          partyKey: 'party:lower-blues',
          mobIds: [mob.id],
          npcIds: [],
          objectIds: [],
          exitId: null,
          bossExitId: null,
          emptyFor: 0,
          resetAvailableAt: 0,
          clearedBy: new Set(),
          enteredBy: new Set(),
          raidReturnKeys: new Set(),
          raidBossWelcomeKeys: new Set(),
        };
        sim.ctx.instances.push(inst);
        rollLoot(sim.ctx, mob, meta);
        sim.ctx.instances.splice(sim.ctx.instances.indexOf(inst), 1);
        const base = (mob.loot?.items ?? []).filter((slot) => ids.has(slot.itemId));
        expect(base, `${bossId} heroic kill ${kill}`).toEqual([]);
      }
    }
  });
});
