import { describe, expect, it } from 'vitest';
import { blankEntity } from '../src/net/blank_entity';
import {
  nameplateCooldownIconUrl,
  resolveNameplateCooldowns,
} from '../src/render/nameplate_cooldown_resolve';
import {
  clampNameplateCooldownScale,
  NAMEPLATE_COOLDOWN_GAP,
  NAMEPLATE_COOLDOWN_GROUP_GAP,
  NAMEPLATE_COOLDOWN_ROW_PAD,
  NAMEPLATE_COOLDOWN_SIZE,
  NAMEPLATE_COOLDOWN_TIMER_STEP,
  nameplateCooldownQuantized,
  nameplateCooldownRowHeight,
  nameplateCooldownRowWidth,
  nameplateCooldownsInto,
  nameplateCooldownTimeUnit,
  newNameplateCooldownsPlan,
} from '../src/render/nameplate_cooldowns_core';
import type { Aura, Entity } from '../src/sim/types';

const MEDALLION = 'trinket:medallion_of_defiance';

// These formatting fixtures describe known successful uses; real equip/use
// provenance is covered through Sim in medallion_cooldown_provenance.test.ts.
function usedCooldowns(cooldowns: Record<string, number>): Map<string, number> {
  const out = new Map(Object.entries(cooldowns));
  if (cooldowns[MEDALLION] > 0) out.set('system_medallion_use', cooldowns[MEDALLION]);
  return out;
}

function plan(cooldowns: Record<string, number>, auras: { id: string; remaining: number }[] = []) {
  return nameplateCooldownsInto(newNameplateCooldownsPlan(), usedCooldowns(cooldowns), auras);
}

const keys = (p: ReturnType<typeof plan>) => p.slots.slice(0, p.count).map((s) => s.key);

describe('nameplate cooldowns core', () => {
  it('draws nothing when no tracked cooldown is running', () => {
    const p = plan({ mortal_strike: 4, system_unstuck: 200 }, [{ id: 'rend', remaining: 9 }]);
    expect(p.count).toBe(0);
    expect(nameplateCooldownRowHeight(p)).toBe(0);
    expect(nameplateCooldownRowWidth(p, 1)).toBe(0);
  });

  it('orders medallion, then defensives, then offensives, each by key', () => {
    const p = plan({ recklessness: 100, die_by_sword: 50, [MEDALLION]: 90, avatar: 20 }, [
      { id: 'barkskin', remaining: 8 },
    ]);
    expect(keys(p)).toEqual([MEDALLION, 'barkskin', 'die_by_sword', 'avatar', 'recklessness']);
    expect(p.slots.slice(0, p.count).map((s) => s.group)).toEqual([
      'medallion',
      'defensive',
      'defensive',
      'offensive',
      'offensive',
    ]);
  });

  it('shows a buff that is up as ACTIVE, counting the buff, over its own cooldown', () => {
    const p = plan({ barkskin: 55 }, [{ id: 'barkskin', remaining: 11 }]);
    expect(p.count).toBe(1);
    expect(p.slots[0]).toMatchObject({ key: 'barkskin', active: true, remaining: 11 });
  });

  it('keeps the slot in place when the buff falls off and the cooldown takes over', () => {
    const out = newNameplateCooldownsPlan();
    const cds = new Map([
      ['barkskin', 45],
      ['recklessness', 150],
    ]);
    nameplateCooldownsInto(out, cds, [{ id: 'barkskin', remaining: 0.5 }]);
    const before = keys(out);
    nameplateCooldownsInto(out, cds, []);
    expect(keys(out)).toEqual(before);
    // Spent: the slot keeps its place but carries no time forward at all.
    expect(out.slots[0]).toMatchObject({ key: 'barkskin', active: false, remaining: 0 });
  });

  it('shows a buff an ally cast on this entity, with no cooldown of its own', () => {
    const p = plan({}, [{ id: 'martyrs_aegis', remaining: 5.2 }]);
    expect(p.count).toBe(1);
    expect(p.slots[0]).toMatchObject({ key: 'martyrs_aegis', group: 'defensive', active: true });
  });

  it('shows a buff whose aura id is a companion or handler form of its ability', () => {
    const p = plan({ rallying_cry: 170 }, [
      { id: 'rallying_cry_hp', remaining: 9 },
      { id: 'aegis_first_dawn_dr:42', remaining: 4 },
      { id: 'howling_rage_empower', remaining: 12 },
    ]);
    expect(keys(p)).toEqual(['aegis_first_dawn', 'rallying_cry', 'bestial_wrath']);
    for (let i = 0; i < p.count; i++) expect(p.slots[i].active).toBe(true);
  });

  it('counts the longer copy when two casters put the same buff up', () => {
    const p = plan({}, [
      { id: 'power_infusion', remaining: 3 },
      { id: 'power_infusion', remaining: 12 },
    ]);
    expect(p.count).toBe(1);
    expect(p.slots[0].remaining).toBe(12);
  });

  it('has no icon cap: every tracked cooldown in play shows', () => {
    const p = plan({
      ice_barrier: 20,
      blazing_barrier: 20,
      ice_block: 200,
      mass_barrier: 80,
      arcane_power: 80,
      combustion: 100,
      icy_veins: 150,
      overload: 25,
      power_echo: 25,
      [MEDALLION]: 100,
    });
    expect(p.count).toBe(10);
  });

  it('carries no time for a spent cooldown, whatever the host holds', () => {
    // The offline Sim's bots hold real remaining times; the online mirror holds
    // Infinity (time withheld). Either way the plan shows only that it is spent.
    for (const held of [90, 2.5, Number.POSITIVE_INFINITY]) {
      expect(plan({ recklessness: held }).slots[0]).toMatchObject({
        key: 'recklessness',
        active: false,
        remaining: 0,
      });
    }
  });

  it('reads whole minutes from a minute up, seconds below, and tenths under ten', () => {
    expect(nameplateCooldownTimeUnit(161)).toBe('minutes');
    expect(nameplateCooldownQuantized(161, 'minutes')).toBe(3);
    expect(nameplateCooldownQuantized(61, 'minutes')).toBe(2);
    expect(nameplateCooldownTimeUnit(59.5)).toBe('seconds');
    expect(nameplateCooldownQuantized(21.2, 'seconds')).toBe(22);
    expect(nameplateCooldownTimeUnit(6.24)).toBe('tenths');
    expect(nameplateCooldownQuantized(6.24, 'tenths')).toBe(6.2);
  });

  it('adds the group gap between groups to the row width and scales the whole row', () => {
    const p = plan({ [MEDALLION]: 50, barkskin: 30, die_by_sword: 30, avatar: 30 });
    const raw =
      4 * NAMEPLATE_COOLDOWN_SIZE + 3 * NAMEPLATE_COOLDOWN_GAP + 2 * NAMEPLATE_COOLDOWN_GROUP_GAP;
    expect(nameplateCooldownRowWidth(p, 1)).toBeCloseTo(raw);
    expect(nameplateCooldownRowWidth(p, 2)).toBeCloseTo(raw * 2);
    p.scale = 2;
    expect(nameplateCooldownRowHeight(p)).toBeCloseTo(
      (NAMEPLATE_COOLDOWN_SIZE + NAMEPLATE_COOLDOWN_TIMER_STEP + NAMEPLATE_COOLDOWN_ROW_PAD) * 2,
    );
  });

  it('clamps a corrupt stored size into the slider range', () => {
    expect(clampNameplateCooldownScale(Number.NaN)).toBe(1);
    expect(clampNameplateCooldownScale(0.2)).toBe(1);
    expect(clampNameplateCooldownScale(9)).toBe(3);
  });

  it('invalidates a recycled slot that now shows a different key', () => {
    const out = newNameplateCooldownsPlan();
    nameplateCooldownsInto(out, new Map([['barkskin', 30]]), []);
    out.slots[0].iconUrl = '/old.webp';
    out.slots[0].timeText = '30';
    nameplateCooldownsInto(out, new Map([['evasion', 30]]), []);
    expect(out.slots[0]).toMatchObject({ key: 'evasion', iconUrl: '', timeText: '' });
  });
});

function player(cooldowns: Record<string, number>, auras: Partial<Aura>[] = []): Entity {
  const e = blankEntity(9);
  e.kind = 'player';
  e.cooldowns = usedCooldowns(cooldowns);
  e.auras = auras as Aura[];
  return e;
}

describe('nameplate cooldowns resolve (painter side)', () => {
  it('carries the row only on a living hostile player with the setting on', () => {
    const out = newNameplateCooldownsPlan();
    const enemy = player({ barkskin: 30 });
    resolveNameplateCooldowns(out, enemy, true, 1.5);
    expect(out.count).toBe(1);
    expect(out.scale).toBe(1.5);

    resolveNameplateCooldowns(out, enemy, false, 1.5); // a friendly player
    expect(out.count).toBe(0);
    resolveNameplateCooldowns(out, enemy, true, 0); // the toggle is off
    expect(out.count).toBe(0);
    const mob = player({ barkskin: 30 });
    mob.kind = 'mob';
    resolveNameplateCooldowns(out, mob, true, 1);
    expect(out.count).toBe(0);
    enemy.dead = true;
    resolveNameplateCooldowns(out, enemy, true, 1);
    expect(out.count).toBe(0);
  });

  it('resolves artwork for every slot and a countdown for active buffs only', () => {
    const out = newNameplateCooldownsPlan();
    resolveNameplateCooldowns(
      out,
      player({ recklessness: 161, [MEDALLION]: 47 }, [
        { id: 'barkskin', remaining: 6.24 },
        { id: 'icy_veins', remaining: 14.2 },
      ]),
      true,
      1,
    );
    const byKey = Object.fromEntries(out.slots.slice(0, out.count).map((s) => [s.key, s]));
    // Active buffs count down their buff time.
    expect(byKey.barkskin.timeText).toBe('6.2');
    expect(byKey.icy_veins.timeText).toBe('15');
    // Recharging cooldowns show that they are spent, never their time left.
    expect(byKey[MEDALLION].active).toBe(false);
    expect(byKey[MEDALLION].timeText).toBe('');
    expect(byKey.recklessness.timeText).toBe('');
    expect(byKey.recklessness.remaining).toBe(0);
    expect(byKey.barkskin.iconUrl).toBe(nameplateCooldownIconUrl('barkskin'));
    expect(byKey.barkskin.iconUrl).toContain('barkskin');
    expect(byKey[MEDALLION].iconUrl).toContain('medallion_of_defiance');
  });

  it('drops the countdown the moment an active buff falls off into its cooldown', () => {
    const out = newNameplateCooldownsPlan();
    resolveNameplateCooldowns(
      out,
      player({ barkskin: 50 }, [{ id: 'barkskin', remaining: 0.4 }]),
      true,
      1,
    );
    expect(out.slots[0].timeText).toBe('0.4');
    resolveNameplateCooldowns(out, player({ barkskin: 49.6 }), true, 1);
    expect(out.slots[0]).toMatchObject({ key: 'barkskin', active: false, timeText: '' });
  });

  it('re-formats an active countdown that crosses the minute boundary, never reusing the text', () => {
    const out = newNameplateCooldownsPlan();
    resolveNameplateCooldowns(out, player({}, [{ id: 'barkskin', remaining: 60.5 }]), true, 1);
    expect(out.slots[0].timeText).toMatch(/^2\s?m/);
    resolveNameplateCooldowns(out, player({}, [{ id: 'barkskin', remaining: 59.5 }]), true, 1);
    expect(out.slots[0].timeText).toBe('60');
  });

  it('shows an active-only buff while up and never as spent', () => {
    const plan = newNameplateCooldownsPlan();
    // Red Harvest's Enrage is up; Raised Guard's 12 s cooldown is running.
    nameplateCooldownsInto(plan, new Map([['raised_guard', 9]]), [
      { id: 'fury_enrage', remaining: 3.2 },
    ]);
    expect(plan.count).toBe(1);
    expect(plan.slots[0]).toMatchObject({
      key: 'enrage_passive',
      group: 'offensive',
      active: true,
      remaining: 3.2,
    });
    // Once the Enrage falls off, nothing is left: no spent slot for it.
    nameplateCooldownsInto(plan, new Map([['raised_guard', 8]]), []);
    expect(plan.count).toBe(0);
  });
});
