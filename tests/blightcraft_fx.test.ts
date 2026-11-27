import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLIGHTCRAFT_FX_ABILITIES,
  BLIGHTCRAFT_FX_SCHOOL,
  blightcraftFxEvent,
  blightcraftFxSchool,
} from '../src/render/blightcraft_fx';
import { SCHOOL_COLORS } from '../src/render/vfx';
import { ABILITIES } from '../src/sim/content/classes';
import type { SimEvent } from '../src/sim/types';

describe('Blightcaller rot-green effects', () => {
  it('covers exactly the spells only Blightcaller casts', () => {
    const blightcraftOnly = Object.values(ABILITIES)
      .filter((ability) => ability.specs?.length === 1 && ability.specs[0] === 'affliction')
      .map((ability) => ability.id)
      .sort();
    expect([...BLIGHTCRAFT_FX_ABILITIES].sort()).toEqual(blightcraftOnly);
  });

  it('has its own green, apart from the purple every other shadow spell keeps', () => {
    expect(SCHOOL_COLORS[BLIGHTCRAFT_FX_SCHOOL]).toBe(0x9bd23c);
    expect(SCHOOL_COLORS.shadow).toBe(0x9a5df0);
    // Light pulses keep their own school table; a missing key lights pale gold.
    const pulses = readFileSync(path.join(__dirname, '../src/render/light_pulses.ts'), 'utf8');
    expect(pulses).toContain(`${BLIGHTCRAFT_FX_SCHOOL}: 0xa6e65a,`);
  });

  it('recolours only shadow effects of Blightcaller spells', () => {
    expect(blightcraftFxSchool('plague_bloom', 'shadow')).toBe('blight');
    expect(blightcraftFxSchool('shadow_bolt', 'shadow')).toBe('shadow');
    expect(blightcraftFxSchool('drain_life', 'shadow')).toBe('shadow');
    expect(blightcraftFxSchool(undefined, 'shadow')).toBe('shadow');

    const litany: SimEvent = {
      type: 'spellfxAt',
      x: 0,
      z: 0,
      school: 'shadow',
      fx: 'nova',
      ability: 'litany_of_guilt',
    };
    expect(blightcraftFxEvent(litany)).toMatchObject({ school: 'blight', fx: 'nova' });
    expect(litany.school).toBe('shadow');

    const bolt: SimEvent = {
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      school: 'shadow',
      fx: 'projectile',
      ability: 'shadow_bolt',
    };
    expect(blightcraftFxEvent(bolt)).toBe(bolt);
  });

  it('greens a bare DoT tick only when its caster has a Blightcaller aura on the target', () => {
    const tick: SimEvent = {
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      school: 'shadow',
      fx: 'tick',
    };
    const festerhex = () => [{ id: 'curse_of_agony', sourceId: 1 }];
    const otherCaster = () => [{ id: 'curse_of_agony', sourceId: 9 }];
    const otherDot = () => [{ id: 'shadow_word_pain', sourceId: 1 }];

    expect(blightcraftFxEvent(tick, festerhex)).toMatchObject({ school: 'blight' });
    expect(blightcraftFxEvent(tick, otherCaster)).toBe(tick);
    expect(blightcraftFxEvent(tick, otherDot)).toBe(tick);
    expect(blightcraftFxEvent(tick)).toBe(tick);
  });

  it('draws Veinleech blood red and colours a named DoT tick by its own DoT', () => {
    expect(blightcraftFxSchool('siphon_life', 'shadow')).toBe('leech');
    expect(SCHOOL_COLORS.leech).toBe(0xd8202f);
    const pulses = readFileSync(path.join(__dirname, '../src/render/light_pulses.ts'), 'utf8');
    expect(pulses).toContain('leech: 0xff4a5a,');

    const tick = (dot: string): SimEvent => ({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      school: 'shadow',
      fx: 'tick',
      dot,
    });
    // Both DoTs from the same caster on one target: each tick keeps its own colour.
    const both = () => [
      { id: 'corruption', sourceId: 1 },
      { id: 'siphon_life', sourceId: 1 },
    ];
    expect(blightcraftFxEvent(tick('siphon_life'), both)).toMatchObject({ school: 'leech' });
    expect(blightcraftFxEvent(tick('corruption'), both)).toMatchObject({ school: 'blight' });
    const priestTick = tick('shadow_word_pain');
    expect(blightcraftFxEvent(priestTick, both)).toBe(priestTick);
  });
});
