import { describe, expect, it } from 'vitest';
import type { Aura } from '../src/sim/types';
import { auraGainLogKeyFor, findAuraForGainEvent } from '../src/ui/aura_gain_log';

function aura(over: Partial<Aura> = {}): Aura {
  return {
    id: 'test',
    name: 'Test Aura',
    kind: 'dot',
    remaining: 10,
    duration: 10,
    value: 5,
    sourceId: 0,
    school: 'physical',
    ...over,
  };
}

describe('auraGainLogKeyFor', () => {
  it('keeps the affliction wording for a harmful aura on another entity', () => {
    const dot = aura({ kind: 'dot', value: 5 });
    expect(auraGainLogKeyFor(dot)).toBe('hud.combat.auraAfflicted');
  });

  it('uses the neutral gain wording for a stance/buff-kind aura on another entity', () => {
    const stance = aura({ kind: 'defensive_stance', value: 1 });
    expect(auraGainLogKeyFor(stance)).toBe('hud.combat.auraGainOther');
  });

  it('uses the neutral gain wording for a positive stat buff on another entity', () => {
    const buff = aura({ kind: 'buff_speed', value: 1.4 });
    expect(auraGainLogKeyFor(buff)).toBe('hud.combat.auraGainOther');
  });

  it('still treats a negative-value stat buff reuse as a debuff', () => {
    const drain = aura({ kind: 'buff_ap', value: -50 });
    expect(auraGainLogKeyFor(drain)).toBe('hud.combat.auraAfflicted');
  });

  it('falls back to the SimEvent auraKind when no live aura is found', () => {
    expect(auraGainLogKeyFor(undefined, 'stun')).toBe('hud.combat.auraAfflicted');
    expect(auraGainLogKeyFor(undefined, 'hot')).toBe('hud.combat.auraGainOther');
  });

  it('defaults to the neutral wording when neither a matched aura nor a kind is available', () => {
    expect(auraGainLogKeyFor(undefined, undefined)).toBe('hud.combat.auraGainOther');
  });
});

describe('findAuraForGainEvent', () => {
  it('matches by name when no auraKind is supplied', () => {
    const auras = [aura({ name: 'Battle Stance', kind: 'defensive_stance' })];
    expect(findAuraForGainEvent(auras, 'Battle Stance')?.kind).toBe('defensive_stance');
  });

  it('matches by name and kind when both are supplied', () => {
    const auras = [
      aura({ name: 'Fresh Legs', kind: 'buff_speed', value: 1.4 }),
      aura({ name: 'Fresh Legs', kind: 'dot', value: 3 }),
    ];
    const match = findAuraForGainEvent(auras, 'Fresh Legs', 'buff_speed');
    expect(match?.kind).toBe('buff_speed');
  });

  it('returns undefined when nothing matches', () => {
    const auras = [aura({ name: 'Other Aura' })];
    expect(findAuraForGainEvent(auras, 'Missing Aura')).toBeUndefined();
  });
});
