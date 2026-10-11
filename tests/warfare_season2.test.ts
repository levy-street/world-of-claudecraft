// Warfare Season 2 ("Vanguard"): the stock shape, the stat, armor and rating
// rules that keep honor gear under the raid tier in PvE, the set rows, and the
// tank guard (docs/design/warfare-season-2.md, "The PvE promise").
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { ITEM_SETS } from '../src/sim/content/item_sets';
import { HONOR_QUARTERMASTER_STOCK } from '../src/sim/content/pvp_honor';
import {
  SEASON2_ARMOR_FRACTION,
  SEASON2_ARMOR_SLOTS,
  SEASON2_DEFENSE_RATING_MULT,
  SEASON2_OFFENSE_RATING_MULT,
  SEASON2_PRICES,
  SEASON2_SETS,
  SEASON2_SOURCE_LEVEL,
  SEASON2_STAT_FRACTION,
  SEASON2_STOCK,
  SEASON2_WEAPON_IDS,
  SEASON2_WEAPON_PRICE,
} from '../src/sim/content/pvp_honor_season2';
import { RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import type { TalentAllocation } from '../src/sim/content/talents';
import { VANGUARD_SET_ENGINE_BONUSES } from '../src/sim/content/vanguard_set_bonuses';
import { DUNGEON_X_THRESHOLD, ITEMS, NPCS } from '../src/sim/data';
import { bestEpicGearFor } from '../src/sim/dev/bis_gear';
import { canEquipItem, maxArmorTypeForClass } from '../src/sim/equipment_rules';
import {
  staminaBaseline,
  statIdentity,
  TWOHAND_DPS_MULT,
  weaponDpsBudget,
} from '../src/sim/item_budget';
import { expectedLineBudget, itemLevel } from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import {
  armorReduction,
  type Entity,
  type EquipSlot,
  type ItemDef,
  type PlayerClass,
} from '../src/sim/types';

const ARMOR_TYPE: Record<string, string> = {
  warrior: 'mail',
  paladin: 'mail',
  hunter: 'leather',
  shaman: 'mail',
  rogue: 'leather',
  druid: 'leather',
  priest: 'cloth',
  mage: 'cloth',
  warlock: 'cloth',
};

// En and em dash, built from char codes so this file carries neither character.
const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];
const handOf = (it: ItemDef) => (it as { hand?: string }).hand;

const armorPieces = (): ItemDef[] =>
  SEASON2_STOCK.map((id) => ITEMS[id]).filter((it) => it.kind === 'armor');

describe('the Season 2 stock', () => {
  it('is one five-piece set per spec plus four weapons, sold by both quartermasters', () => {
    expect(SEASON2_SETS).toHaveLength(27);
    expect(SEASON2_WEAPON_IDS).toHaveLength(4);
    expect(SEASON2_STOCK).toHaveLength(27 * 5 + 4);
    const specs = Object.entries(DEV_KIT_ROLES).flatMap(([cls, roles]) =>
      roles.map((r) => `vanguard_${cls}_${r.spec}`),
    );
    expect(SEASON2_SETS.map((s) => s.setId).sort()).toEqual([...new Set(specs)].sort());
    for (const npcId of ['fury', 'warmarshal_draven_kole']) {
      const sold = new Set(NPCS[npcId]?.vendorItems ?? []);
      for (const id of SEASON2_STOCK) expect(sold.has(id), `${npcId} sells ${id}`).toBe(true);
    }
    expect(HONOR_QUARTERMASTER_STOCK.slice(-SEASON2_STOCK.length)).toEqual([...SEASON2_STOCK]);
  });

  it('fills the raid slots, locked to its class, in its class armor type, at item level 35', () => {
    expect(SEASON2_SOURCE_LEVEL).toBe(29);
    expect([...SEASON2_ARMOR_SLOTS]).toEqual(['helmet', 'shoulder', 'chest', 'legs', 'gloves']);
    for (const set of SEASON2_SETS) {
      const items = set.itemIds.map((id) => ITEMS[id]);
      expect(
        items.map((it) => it.slot),
        set.setId,
      ).toEqual([...SEASON2_ARMOR_SLOTS]);
      for (const it of items) {
        expect(it.set, it.id).toBe(set.setId);
        expect(it.requiredClass, it.id).toEqual([set.cls]);
        expect(it.armorType, it.id).toBe(ARMOR_TYPE[set.cls]);
        // The class's own heaviest armor, and wearable through the real equip rules.
        expect(it.armorType, it.id).toBe(maxArmorTypeForClass(set.cls as PlayerClass));
        expect(canEquipItem(set.cls as PlayerClass, it), `${set.cls} wears ${it.id}`).toBe(true);
        // Class-locked in earnest: no other class can equip it, even one whose
        // armor type would otherwise allow it (a mage and the priest cloth).
        expect(it.classLocked, it.id).toBe(true);
        for (const other of Object.keys(ARMOR_TYPE) as PlayerClass[]) {
          if (other === set.cls) continue;
          expect(canEquipItem(other, it), `${other} refused ${it.id}`).toBe(false);
        }
      }
    }
    for (const id of SEASON2_STOCK) {
      const it = ITEMS[id];
      expect(itemLevel(it), id).toBe(35);
      expect(it.quality, id).toBe('epic');
      expect(it.soulbound, id).toBe(true);
      expect(it.sellValue, id).toBe(0);
    }
  });

  it('prices every slot at 1.5 times the entry tier, a full set at 6,600 Honor', () => {
    expect({ ...SEASON2_PRICES }).toEqual({
      helmet: 1350,
      shoulder: 1050,
      chest: 1800,
      legs: 1575,
      gloves: 825,
    });
    for (const it of armorPieces())
      expect(it.priceHonor, it.id).toBe(SEASON2_PRICES[it.slot ?? '']);
    for (const id of SEASON2_WEAPON_IDS)
      expect(ITEMS[id].priceHonor, id).toBe(SEASON2_WEAPON_PRICE);
    expect(Object.values(SEASON2_PRICES).reduce((a, b) => a + b, 0)).toBe(6600);
  });
});

describe('the stat rules (the honor discount at item level 35)', () => {
  it('prices the line at 90 percent of the budget, stamina lifted to the full-budget floor', () => {
    expect(SEASON2_STAT_FRACTION).toBe(0.9);
    for (const id of SEASON2_STOCK) {
      const it = ITEMS[id];
      const budget = expectedLineBudget(it) as number;
      const floor = staminaBaseline(budget);
      const line = Math.round(budget * SEASON2_STAT_FRACTION);
      const s = it.stats ?? {};
      expect(s.sta, `${id} stamina`).toBe(floor);
      if (statIdentity(s) === 'caster') {
        expect((s.int ?? 0) + (s.spi ?? 0), `${id} caster line`).toBe(line);
      } else {
        expect((s.str ?? 0) + (s.agi ?? 0), `${id} physical line`).toBe(line - floor);
      }
      // Warfare ratings: multiples of the full slot budget (the entry tier is 1x).
      expect(it.pvpOffenseRating, id).toBe(Math.round(budget * SEASON2_OFFENSE_RATING_MULT));
      expect(it.pvpDefenseRating, id).toBe(Math.round(budget * SEASON2_DEFENSE_RATING_MULT));
      // Never a combat rating: that is the raid tier's.
      expect(it.critRating ?? 0, id).toBe(0);
      expect(it.hitRating ?? 0, id).toBe(0);
      expect(it.hasteRating ?? 0, id).toBe(0);
    }
  });

  it('carries 0.9 of the mean armor of same-slot, same-type item-level-35 raid set pieces', () => {
    expect(SEASON2_ARMOR_FRACTION).toBe(0.9);
    for (const it of armorPieces()) {
      const peers = Object.values(ITEMS).filter(
        (p) =>
          p.kind === 'armor' &&
          p.slot === it.slot &&
          p.armorType === it.armorType &&
          p.set &&
          !SEASON2_STOCK.includes(p.id) &&
          itemLevel(p) === 35 &&
          (p.stats?.armor ?? 0) > 0,
      );
      expect(peers.length, it.id).toBeGreaterThan(0);
      const mean = peers.reduce((a, p) => a + (p.stats?.armor ?? 0), 0) / peers.length;
      expect(it.stats?.armor, it.id).toBe(Math.round(mean * SEASON2_ARMOR_FRACTION));
    }
  });

  it('puts the weapons on the item-level-35 damage curve (two-handers above it)', () => {
    for (const id of SEASON2_WEAPON_IDS) {
      const w = ITEMS[id];
      const dps = ((w.weapon?.min ?? 0) + (w.weapon?.max ?? 0)) / 2 / (w.weapon?.speed ?? 1);
      const target = weaponDpsBudget(35) * (handOf(w) === 'twohand' ? TWOHAND_DPS_MULT : 1);
      expect(Math.abs(dps - target), id).toBeLessThan(0.5);
    }
    // The strength two-hander the entry tier never had.
    expect(handOf(ITEMS.vanguard_verdict_greatsword)).toBe('twohand');
    expect(ITEMS.vanguard_verdict_greatsword.stats?.str).toBeGreaterThan(0);
  });

  it('never out-rolls the raid tier: every weapon has an item-level-35 raid peer that beats it in PvE', () => {
    // The damage curve is shared, so the discount lives where the armor's does:
    // a smaller stat line and no combat ratings. A raid weapon of the same hand
    // and stat identity matches its damage (within curve rounding) and carries
    // a larger line plus crit, hit or haste rating.
    const dpsOf = (w: ItemDef) =>
      ((w.weapon?.min ?? 0) + (w.weapon?.max ?? 0)) / 2 / (w.weapon?.speed ?? 1);
    const lineOf = (w: ItemDef) => {
      const { sta: _sta, armor: _armor, ...rest } = w.stats ?? {};
      return Object.values(rest).reduce<number>((a, v) => a + (v ?? 0), 0);
    };
    const ratingsOf = (w: ItemDef) =>
      (w.critRating ?? 0) + (w.hitRating ?? 0) + (w.hasteRating ?? 0);
    const raid = Object.values(ITEMS).filter(
      (w) => w.kind === 'weapon' && w.quality === 'epic' && !w.priceHonor && itemLevel(w) === 35,
    );
    for (const id of SEASON2_WEAPON_IDS) {
      const w = ITEMS[id];
      const peer = raid.find(
        (r) =>
          handOf(r) === handOf(w) &&
          statIdentity(r.stats ?? {}) === statIdentity(w.stats ?? {}) &&
          lineOf(r) > lineOf(w) &&
          ratingsOf(r) > 0 &&
          dpsOf(r) > dpsOf(w) - 0.5,
      );
      expect(peer, `${id} has a stronger raid peer`).toBeDefined();
    }
  });
});

describe('the set rows', () => {
  it('gives every spec set the raid thresholds, 2 and 4 pieces, with tooltip text', () => {
    for (const set of SEASON2_SETS) {
      const row = ITEM_SETS[set.setId];
      expect(row, set.setId).toBeDefined();
      expect(
        row.bonuses.map((b) => b.pieces),
        set.setId,
      ).toEqual([2, 4]);
      for (const b of row.bonuses) {
        expect(b.text.trim().length, `${set.setId} ${b.pieces}pc text`).toBeGreaterThan(0);
        const dashed = DASHES.some((d) => b.text.includes(d));
        expect(dashed, `${set.setId} ${b.pieces}pc dash`).toBe(false);
      }
    }
  });
});

describe('the PvE promise: never the raid pick for a tank', () => {
  const BOSS_LEVEL = 22;
  const ehp = (e: Entity) => e.maxHp / (1 - armorReduction(e.stats.armor, BOSS_LEVEL));

  function geared(
    cls: PlayerClass,
    spec: string,
    kit: Partial<Record<EquipSlot, string>>,
    bear: boolean,
  ) {
    const sim = new Sim({ seed: 20061, playerClass: cls, noPlayer: true });
    const pid = sim.addPlayer(cls, `T${cls}`);
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec, rows: {} } as TalentAllocation, pid);
    for (const [slot, id] of Object.entries(kit)) {
      sim.addItem(id, 1, pid);
      sim.equipItemToSlot(id, slot as EquipSlot, pid);
    }
    const e = sim.entities.get(pid) as Entity;
    e.pos = { ...e.pos, x: DUNGEON_X_THRESHOLD + 900 };
    e.prevPos = { ...e.pos };
    if (bear) {
      e.auras.push({
        id: 'bear_form',
        name: 'Bear Form',
        kind: 'form_bear',
        remaining: 9999,
        duration: 9999,
        value: 0,
      } as never);
    }
    for (let i = 0; i < 12; i++) sim.tick();
    sim.ctx.recalcPlayer(e);
    return e;
  }

  it('keeps each tank set, with entry-tier waist and feet, below raid best-in-slot on effective health', () => {
    const strExtras = {
      waist: 'furyforged_girdle',
      feet: 'furyforged_sabatons',
      neck: 'final_oath_medallion',
      ring1: 'iron_vow_band',
      ring2: 'unbroken_circle',
      mainhand: 'vanguard_oath_blade',
    };
    const agiExtras = {
      waist: 'ashstalker_waistband',
      feet: 'ashstalker_treads',
      neck: 'razorwind_torque',
      ring1: 'fleetblood_band',
      ring2: 'last_step_signet',
      mainhand: 'vanguard_fang_dagger',
    };
    for (const [cls, spec, extras, bear] of [
      ['warrior', 'prot', strExtras, false],
      ['paladin', 'protection', strExtras, false],
      ['druid', 'feral', agiExtras, true],
    ] as [PlayerClass, string, Partial<Record<EquipSlot, string>>, boolean][]) {
      const set = SEASON2_SETS.find((s) => s.cls === cls && s.spec === spec);
      expect(set, `${cls}/${spec}`).toBeDefined();
      const kit: Partial<Record<EquipSlot, string>> = { ...extras };
      for (const id of set?.itemIds ?? []) kit[ITEMS[id].slot as EquipSlot] = id;
      const honor = geared(cls, spec, kit, bear);
      const raid = geared(cls, spec, bestEpicGearFor(cls, spec), bear);
      expect(honor.pvpVitalityActive, `${cls}/${spec}`).toBe(false);
      expect(ehp(honor), `${cls}/${spec} Season 2 effective health`).toBeLessThan(ehp(raid));
    }
  });
});

describe('the PvP promise: Season 2 is the PvP upgrade over a full Season 1 kit', () => {
  // Level 20, open world. Season 1: the full seven-piece family plus its honor
  // jewelry and weapon. Season 2: the same kit with the five set slots swapped,
  // so the difference is the armor alone.
  const S1 = {
    str: {
      set: 'warfare_furyforged',
      extras: {
        neck: 'final_oath_medallion',
        ring1: 'iron_vow_band',
        ring2: 'unbroken_circle',
        mainhand: 'final_argument_greatblade',
      },
    },
    caster: {
      set: 'warfare_cinderweave',
      extras: {
        neck: 'cinder_sigil_pendant',
        ring1: 'ashen_focus_ring',
        ring2: 'spellbreakers_seal',
        mainhand: 'emberglass_warstaff',
      },
    },
  } as const;

  function inOpenWorld(cls: PlayerClass, spec: string, kit: Partial<Record<EquipSlot, string>>) {
    const sim = new Sim({ seed: 20061, playerClass: cls, noPlayer: true });
    const pid = sim.addPlayer(cls, `P${cls}`);
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec, rows: {} } as TalentAllocation, pid);
    for (const [slot, id] of Object.entries(kit)) {
      sim.addItem(id, 1, pid);
      sim.equipItemToSlot(id, slot as EquipSlot, pid);
    }
    for (let i = 0; i < 12; i++) sim.tick();
    const e = sim.entities.get(pid) as Entity;
    sim.ctx.recalcPlayer(e);
    return e;
  }

  it('reaches every Warfare cap and carries more health than Season 1 in PvP', () => {
    for (const [cls, spec, profile] of [
      ['warrior', 'arms', 'str'],
      ['warrior', 'prot', 'str'],
      ['mage', 'fire', 'caster'],
    ] as [PlayerClass, string, keyof typeof S1][]) {
      const family = S1[profile];
      const s1: Partial<Record<EquipSlot, string>> = { ...family.extras };
      for (const it of Object.values(ITEMS)) {
        if (it.set === family.set) s1[it.slot as EquipSlot] = it.id;
      }
      const s2: Partial<Record<EquipSlot, string>> = { ...s1 };
      const set = SEASON2_SETS.find((s) => s.cls === cls && s.spec === spec);
      for (const id of set?.itemIds ?? []) s2[ITEMS[id].slot as EquipSlot] = id;
      const a = inOpenWorld(cls, spec, s1);
      const b = inOpenWorld(cls, spec, s2);
      expect(b.stats.pvpOffense, `${cls}/${spec} offense`).toBeCloseTo(0.3, 10);
      expect(b.stats.pvpDefense, `${cls}/${spec} defense`).toBeCloseTo(0.3, 10);
      expect(b.stats.pvpVitality, `${cls}/${spec} vitality`).toBeCloseTo(0.8, 10);
      // Owner target: about 10 percent more health than a full Season 1 kit.
      expect(b.maxHp / a.maxHp, `${cls}/${spec} health over Season 1`).toBeGreaterThan(1.07);
    }
  });
});

describe('the crowd-control promise: no set makes heavy control spammable', () => {
  // Player stuns carry no PvP diminishing returns here (src/sim/stun_dr.ts), so
  // a cooldown cut on a stun is pure extra stun time; fears, roots, pulls and
  // lockouts ride ladders but still gain uptime. Every Season 2 set that
  // shortens a control ability's cooldown, flat or through a cast-triggered
  // refund (with the trigger used on its own cooldown), stays within 20 percent
  // of the base cooldown.
  const CONTROL = new Set([
    'stun',
    'finisherStun',
    'aoeFear',
    'fear',
    'incapacitate',
    'root',
    'aoeRoot',
    'pullTarget',
    'interrupt',
    'polymorph',
    'silence',
    'knockback',
  ]);
  const MAX_CUT = 0.2;

  type Row = { ability: string; cooldownFlat?: number; cooldownPct?: number };
  type Proc = {
    trigger: { on: string; abilities?: string[]; ability?: string; icd?: number };
    responses: { kind: string; ability?: string; seconds?: number | 'reset' }[];
  };

  function isControl(abilityId: string): boolean {
    const def = ABILITIES[abilityId] as unknown as { effects?: Record<string, unknown>[] };
    return (def?.effects ?? []).some((e) => CONTROL.has(String(e.type)) || e.stunSec !== undefined);
  }

  it('cuts no control ability cooldown by more than 20 percent, refunds included', () => {
    const cuts: Record<string, number> = {};
    for (const [setId, tiers] of Object.entries(VANGUARD_SET_ENGINE_BONUSES)) {
      // Every tier of the set together: the worst case is the full four pieces.
      const flat = new Map<string, number>();
      const refundRate = new Map<string, number>();
      for (const tier of tiers) {
        const effect = tier.effect as { ability?: Row[]; proc?: Proc | Proc[] };
        for (const row of effect.ability ?? []) {
          const base = ABILITIES[row.ability]?.cooldown ?? 0;
          const cut = -(row.cooldownFlat ?? 0) - base * (row.cooldownPct ?? 0);
          if (cut > 0) flat.set(row.ability, (flat.get(row.ability) ?? 0) + cut);
        }
        const procs = effect.proc ? (Array.isArray(effect.proc) ? effect.proc : [effect.proc]) : [];
        for (const proc of procs) {
          for (const r of proc.responses) {
            if (r.kind !== 'cooldownRefund' || !r.ability) continue;
            // Seconds refunded per second of play, with the trigger on cooldown.
            const triggers =
              proc.trigger.abilities ?? (proc.trigger.ability ? [proc.trigger.ability] : []);
            const period = Math.max(
              proc.trigger.icd ?? 0,
              ...triggers.map((id) => ABILITIES[id]?.cooldown ?? 0),
            );
            const refunded = r.seconds === 'reset' ? Number.POSITIVE_INFINITY : (r.seconds ?? 0);
            const rate = period > 0 ? refunded / period : Number.POSITIVE_INFINITY;
            refundRate.set(r.ability, (refundRate.get(r.ability) ?? 0) + rate);
          }
        }
      }
      for (const id of new Set([...flat.keys(), ...refundRate.keys()])) {
        if (!isControl(id)) continue;
        const base = ABILITIES[id]?.cooldown ?? 0;
        const effective = (base - (flat.get(id) ?? 0)) / (1 + (refundRate.get(id) ?? 0));
        cuts[`${setId}:${id}`] = base > 0 ? 1 - effective / base : 1;
      }
    }
    for (const [key, cut] of Object.entries(cuts)) {
      expect(cut, `${key} cooldown cut`).toBeLessThanOrEqual(MAX_CUT + 1e-9);
    }
    // Anti-vacuity: the sweep sees the control cuts that do ship.
    expect(Object.keys(cuts).length).toBeGreaterThan(3);
  });
});

describe('the Reliquary page: class-personal stock outside completion', () => {
  it('lists every Season 2 item but never gates the Conquerors capstone', () => {
    const page = RELIQUARY_PAGES_BY_ID.conquerors_vanguard_gallery;
    expect(page.shelf).toBe('conquerors');
    // The sets are class-locked and the shop lists only the viewer's own class,
    // so no single character can fill the page: the Riftbound precedent.
    expect(page.excludeFromCompletion).toBe('personal');
    const listed = new Set(page.relics.map((r) => (r as { itemId?: string }).itemId));
    for (const id of SEASON2_STOCK) expect(listed.has(id), id).toBe(true);
  });
});
