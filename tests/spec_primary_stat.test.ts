import { describe, expect, it } from 'vitest';
import { CLASS_ROLES } from '../server/pbe_boost';
import { DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { MEMBERSHIP_ARMOUR_SLOTS, MEMBERSHIP_WEAPON_ID } from '../src/sim/content/membership';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { SPEC_PRIMARY_STAT, type SpecPrimaryStat } from '../src/sim/content/spec_primary_stat';
import { classSpecs, TALENTS } from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import { membershipArmourItem, referralArmourItem } from '../src/sim/membership_armour';
import { QUEST_REWARD_SPEC_WEIGHTS } from '../src/sim/quests/quest_reward_choice';
import type { Aura, AuraKind, PlayerClass } from '../src/sim/types';

// Enhancement and Feral kept being itemized as Agility specs (membership armour,
// the Vanguard sets, the dev kit weights, the raid loot plan) because each gear
// table carried its own copy of "what this spec wants". SPEC_PRIMARY_STAT is the
// one answer; this file re-derives it from the live stat path and holds every
// per-spec stat table to it.

const CLASSES = Object.keys(TALENTS) as PlayerClass[];
type Stats = Readonly<Partial<Record<string, number>>> | undefined;

/** The strictly largest of Strength, Agility and Intellect, or null on a tie or none. */
function leading(stats: Stats): SpecPrimaryStat | null {
  const ranked = (['str', 'agi', 'int'] as const)
    .map((stat) => [stat, stats?.[stat] ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

function aura(kind: AuraKind, value: number): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 60,
    duration: 60,
    value,
    sourceId: 0,
    school: 'physical',
  };
}

/** Attack power (ranged for hunters) one point of a stat buys a level-20 player. */
function powerPerPoint(cls: PlayerClass, stat: 'str' | 'agi', form?: AuraKind): number {
  const power = (points: number) => {
    const e = createPlayer(0, cls, { x: 0, y: 0, z: 0 }, '');
    e.level = 20;
    e.auras = [aura(stat === 'str' ? 'buff_str' : 'buff_agi', points)];
    if (form) e.auras.push(aura(form, 0));
    recalcPlayerStats(e, cls, {}, undefined, {});
    return cls === 'hunter' ? e.rangedPower : e.attackPower;
  };
  return (power(100) - power(0)) / 100;
}

function eachSpec(visit: (cls: PlayerClass, spec: string, primary: SpecPrimaryStat) => void) {
  for (const cls of CLASSES) {
    for (const [spec, primary] of Object.entries(SPEC_PRIMARY_STAT[cls])) visit(cls, spec, primary);
  }
}

describe('SPEC_PRIMARY_STAT', () => {
  it('names exactly the talent tree specs', () => {
    for (const cls of CLASSES) {
      expect(Object.keys(SPEC_PRIMARY_STAT[cls]).sort(), cls).toEqual(classSpecs(cls).sort());
    }
  });

  it('re-derives every physical primary from the live attack power path', () => {
    let checked = 0;
    eachSpec((cls, spec, primary) => {
      if (primary === 'int') return;
      const other = primary === 'str' ? 'agi' : 'str';
      // Druids are checked in caster, cat and bear form: Agility buys a bear
      // 1.5 attack power and a cat none, Strength 2 in every form.
      const forms: (AuraKind | undefined)[] =
        cls === 'druid' ? [undefined, 'form_cat', 'form_bear'] : [undefined];
      for (const form of forms) {
        const label = `${cls}/${spec}${form ? ` in ${form}` : ''}`;
        const mine = powerPerPoint(cls, primary, form);
        const theirs = powerPerPoint(cls, other, form);
        expect(mine, label).toBeGreaterThan(0);
        // Agility also adds crit, so it takes an attack power tie (the rogue).
        if (primary === 'agi') expect(mine, label).toBeGreaterThanOrEqual(theirs);
        else expect(mine, label).toBeGreaterThan(theirs);
      }
      checked++;
    });
    expect(checked).toBe(13);
  });
});

describe('every per-spec stat table leads with SPEC_PRIMARY_STAT', () => {
  it('membership and referral armour and the Staff of Changing', () => {
    eachSpec((cls, spec, primary) => {
      const pieces = [
        ...MEMBERSHIP_ARMOUR_SLOTS.map((slot) =>
          membershipArmourItem(ITEMS[`membership_${slot}`], cls, spec, 20, true),
        ),
        ...MEMBERSHIP_ARMOUR_SLOTS.map((slot) =>
          referralArmourItem(ITEMS[`referral_${slot}`], cls, spec, 20, true),
        ),
        membershipArmourItem(ITEMS[MEMBERSHIP_WEAPON_ID], cls, spec, 20, true),
      ];
      const total: Record<string, number> = {};
      for (const item of pieces) {
        const label = `${cls}/${spec} ${item.id}`;
        const stats = item.stats ?? {};
        // Per piece the primary is present and never outweighed. A tie is allowed:
        // the bear's Strength beside Agility rounds to 1 and 1 on a small budget.
        expect(stats[primary] ?? 0, label).toBeGreaterThan(0);
        for (const other of ['str', 'agi', 'int'] as const) {
          expect(stats[primary] ?? 0, `${label} ${primary} vs ${other}`).toBeGreaterThanOrEqual(
            stats[other] ?? 0,
          );
          total[other] = (total[other] ?? 0) + (stats[other] ?? 0);
        }
        if (primary === 'int') expect((stats.str ?? 0) + (stats.agi ?? 0), label).toBe(0);
        else expect(stats.int ?? 0, label).toBe(0);
      }
      // Across the worn kit the primary leads outright.
      expect(leading(total), `${cls}/${spec} kit`).toBe(primary);
    });
  });

  it('the Season 2 Vanguard sets', () => {
    expect(SEASON2_SETS).toHaveLength(27);
    for (const set of SEASON2_SETS) {
      const primary = SPEC_PRIMARY_STAT[set.cls as PlayerClass][set.spec];
      const leads = set.itemIds.map((id) => leading(ITEMS[id].stats));
      for (const [index, id] of set.itemIds.entries()) expect(leads[index], id).toBe(primary);
    }
  });

  it('the quest reward, dev kit and PBE boost weights', () => {
    eachSpec((cls, spec, primary) => {
      expect(leading(QUEST_REWARD_SPEC_WEIGHTS[cls][spec]), `quest ${cls}/${spec}`).toBe(primary);
      const devKit = DEV_KIT_ROLES[cls].find((role) => role.spec === spec);
      expect(leading(devKit?.weights), `dev kit ${cls}/${spec}`).toBe(primary);
    });
    let boosted = 0;
    for (const cls of CLASSES) {
      for (const role of CLASS_ROLES[cls]) {
        expect(leading(role.weights), `boost ${cls}/${role.id}`).toBe(
          SPEC_PRIMARY_STAT[cls][role.id],
        );
        boosted++;
      }
    }
    expect(boosted).toBeGreaterThan(0);
  });
});
