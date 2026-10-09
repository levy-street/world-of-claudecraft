// The Wildheart Basin's encounter alert (src/ui/hud/dungeon/
// wildheart_alert_view.ts): Zulgar's Prey runs him through the glyphs (and on
// heroic Twin Prey hears whether he chases them now), the jaguar's prey kites
// it, a pollinated player stays off the seeds, and a target bound by Pack Bond
// says pull them apart; the priority is Prey, Stalk, pollen, bond. Driven from
// real fights too, so the view reads exactly the auras the sim mirrors.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import {
  BEAST_PACK_BOND,
  BEAST_STALKED,
  BEAST_TUNING,
  BEASTMASTER_ID,
  BLOOM_POLLINATED,
  BLOOM_TUNING,
  FANGLORD_JAGUAR_ID,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_PREY,
  ZULGAR_TUNING,
} from '../src/sim/encounters/wildheart_basin';
import type { Aura } from '../src/sim/types';
import { type AuraEffectInput, auraEffectDescriptor } from '../src/ui/aura_effect';
import {
  buildWildheartAlertView,
  type WildheartAlertInput,
} from '../src/ui/hud/dungeon/wildheart_alert_view';
import { setLanguage, t } from '../src/ui/i18n';
import { boss, engage, fight, put, run } from './helpers/wildheart_fight';

setLanguage('en');

function input(over: Partial<WildheartAlertInput>): WildheartAlertInput {
  return { auras: [], targetId: null, entity: () => null, ...over };
}

function kind(over: Partial<WildheartAlertInput>): string {
  const v = buildWildheartAlertView(input(over));
  return v.visible ? v.kind : 'hidden';
}

describe('the Wildheart alert view', () => {
  it('hides when no Basin mechanic concerns the player', () => {
    expect(buildWildheartAlertView(input({})).visible).toBe(false);
  });

  it('the Prey runs; on Twin Prey the waiting one hears it', () => {
    const v = buildWildheartAlertView(
      input({ auras: [{ id: ZULGAR_PREY, remaining: 10, duration: 20, value2: 1 }] }),
    );
    expect(v.visible && v.kind).toBe('prey');
    expect(v.visible && v.title).toBe(t('hudChrome.wildheartAlert.preyTitle'));
    expect(v.visible && v.line).toBe(t('hudChrome.wildheartAlert.preyLine'));
    expect(v.visible && v.progress).toBe(0.5);
    expect(kind({ auras: [{ id: ZULGAR_PREY, remaining: 10, duration: 20, value2: 0 }] })).toBe(
      'prey-wait',
    );
  });

  it('the Stalk, the pollen and the bond each read their own line', () => {
    expect(kind({ auras: [{ id: BEAST_STALKED, remaining: 4, duration: 10 }] })).toBe('stalked');
    expect(kind({ auras: [{ id: BLOOM_POLLINATED, remaining: 4, duration: 8 }] })).toBe(
      'pollinated',
    );
    const bound = { templateId: FANGLORD_JAGUAR_ID, auras: [{ id: BEAST_PACK_BOND }] };
    expect(kind({ targetId: 7, entity: () => bound })).toBe('bonded');
    // The bond is read only off the pair, and only while it holds.
    expect(
      kind({ targetId: 7, entity: () => ({ templateId: ZULGAR_ID, auras: bound.auras }) }),
    ).toBe('hidden');
    expect(kind({ targetId: 7, entity: () => ({ templateId: BEASTMASTER_ID, auras: [] }) })).toBe(
      'hidden',
    );
  });

  it('priority: Prey over Stalk over pollen over bond', () => {
    const all = [
      { id: BLOOM_POLLINATED, remaining: 4, duration: 8 },
      { id: BEAST_STALKED, remaining: 4, duration: 10 },
      { id: ZULGAR_PREY, remaining: 4, duration: 20, value2: 1 },
    ];
    expect(kind({ auras: all })).toBe('prey');
    expect(kind({ auras: all.slice(0, 2) })).toBe('stalked');
    expect(kind({ auras: all.slice(0, 1) })).toBe('pollinated');
  });

  it('reads the live fight: the jaguar prey sees the Stalk, the tank on the master sees the bond', () => {
    const f = fight();
    const bm = boss(f, BEASTMASTER_ID);
    put(f, bm, -86, 58);
    put(f, f.tank, -86, 61);
    put(f, f.others[0], -86, 22);
    put(f, f.others[1], -104, 38);
    put(f, f.others[2], -68, 38);
    engage(f, bm);
    run(f, 0.2);
    const entity = (id: number) => f.sim.ctx.entities.get(id);
    f.tank.targetId = bm.id;
    expect(kind({ auras: f.tank.auras, targetId: bm.id, entity })).toBe('bonded');
    run(f, 3);
    const prey = f.others.find((p) => p.auras.some((a) => a.id === BEAST_STALKED));
    expect(prey).toBeDefined();
    if (prey) expect(kind({ auras: prey.auras, targetId: null, entity })).toBe('stalked');
  });
});

describe('the Basin aura tooltips say the live rule', () => {
  function text(id: string, kind: Aura['kind'], value = 0): string {
    const d = auraEffectDescriptor({ id, kind, value } as AuraEffectInput);
    expect(d, id).not.toBeNull();
    if (!d) return '';
    const nums: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.nums ?? {})) nums[k] = String(v);
    return t(d.key as never, nums);
  }

  it('a mark never claims a 0 percent damage change', () => {
    for (const id of [BEAST_STALKED, ZULGAR_PREY, BLOOM_POLLINATED]) {
      const line = text(id, 'vulnerability', 0);
      expect(line).not.toMatch(/(^|[^0-9])0%/);
      expect(line).not.toMatch(/\{\w+\}/);
    }
  });

  it('the numbers are the ones combat uses, heroic included', () => {
    const heroicJaguar =
      HEROIC_DUNGEON_TUNING.wildheart_basin.mechanicDamageMultiplierByMob?.fanglord_jaguar ?? 1;
    const stalked = text(BEAST_STALKED, 'vulnerability');
    expect(stalked).toContain(`${BEAST_TUNING.biteMin} to ${BEAST_TUNING.biteMax}`);
    expect(stalked).toContain(`${Math.round(BEAST_TUNING.biteMin * heroicJaguar)} to`);
    const prey = text(ZULGAR_PREY, 'vulnerability');
    expect(prey).toContain(`${ZULGAR_TUNING.maulDamage} damage`);
    expect(prey).toContain(`${Math.round(ZULGAR_TUNING.sunstruckSlow * 100)}%`);
    expect(text(BEAST_PACK_BOND, 'buff_dr', BEAST_TUNING.bondDr)).toContain('50% less damage');
    expect(text(ZULGAR_AVATAR, 'buff_speed', ZULGAR_TUNING.huntSpeedMult)).toContain('10% faster');
    expect(text(BLOOM_POLLINATED, 'vulnerability')).toContain(`${BLOOM_TUNING.podSprout} sec`);
  });
});
