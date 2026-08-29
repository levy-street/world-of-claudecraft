import { describe, expect, it } from 'vitest';
import type { CrossHotbarAction } from '../src/game/cross_hotbar';
import { gamepadControlHint } from '../src/game/gamepad_control_hint';
import { GAMEPAD_CONFIRM, GAMEPAD_CYCLE_SET, GAMEPAD_NONE, GP } from '../src/game/gamepad_map';

const emptySet = (): CrossHotbarAction[] => Array.from({ length: 16 }, () => null);

describe('gamepadControlHint', () => {
  const entries = [
    { button: GP.A, action: GAMEPAD_CONFIRM },
    { button: GP.Y, action: 'jump' },
    { button: GP.BACK, action: 'bags' },
    { button: GP.RB, action: GAMEPAD_CYCLE_SET },
    { button: GP.DPAD_RIGHT, action: GAMEPAD_NONE },
  ];

  it('resolves branded system actions and the bare d-pad targeting fallback', () => {
    const source = {
      entries,
      kind: 'xbox' as const,
      crossHotbarEnabled: false,
      crossHotbarSets: [] as const,
      crossHotbarSet: 0,
    };

    expect(gamepadControlHint(source, { type: 'interact' })).toEqual(['A']);
    expect(gamepadControlHint(source, { type: 'action', action: 'jump' })).toEqual(['Y']);
    expect(gamepadControlHint(source, { type: 'target' })).toEqual(['D-pad →']);
    expect(gamepadControlHint(source, { type: 'action', action: 'bags' })).toEqual(['View']);
    expect(gamepadControlHint({ ...source, kind: 'playstation' }, { type: 'interact' })).toEqual([
      'Cross',
    ]);
  });

  it('names the exact primary cross-hotbar chord for Attack', () => {
    const primary = emptySet();
    primary[2] = { type: 'ability', id: 'attack' };

    expect(
      gamepadControlHint(
        {
          entries,
          kind: 'xbox',
          crossHotbarEnabled: true,
          crossHotbarSets: [primary, emptySet()],
          crossHotbarSet: 0,
        },
        { type: 'crossHotbar', action: { type: 'ability', id: 'attack' }, fallback: 'slot0' },
      ),
    ).toEqual(['LT + D-pad →']);
  });

  it('uses the live controller family for a taught ability chord', () => {
    const primary = emptySet();
    primary[12] = { type: 'ability', id: 'heroic_strike' };

    expect(
      gamepadControlHint(
        {
          entries,
          kind: 'playstation',
          crossHotbarEnabled: true,
          crossHotbarSets: [primary],
          crossHotbarSet: 0,
        },
        {
          type: 'crossHotbar',
          action: { type: 'ability', id: 'heroic_strike' },
          fallback: 'slot1',
        },
      ),
    ).toEqual(['R2 + Triangle']);
  });

  it('switches sets before naming an action outside the standing set', () => {
    const secondary = emptySet();
    secondary[2] = { type: 'ability', id: 'attack' };

    expect(
      gamepadControlHint(
        {
          entries,
          kind: 'xbox',
          crossHotbarEnabled: true,
          crossHotbarSets: [emptySet(), secondary],
          crossHotbarSet: 0,
        },
        { type: 'crossHotbar', action: { type: 'ability', id: 'attack' }, fallback: 'slot0' },
      ),
    ).toEqual(['RB', 'LT + D-pad →']);
  });

  it('prefers the standing set and falls back to a flat bind only with XHB off', () => {
    const primary = emptySet();
    const secondary = emptySet();
    primary[0] = { type: 'ability', id: 'attack' };
    secondary[9] = { type: 'ability', id: 'attack' };
    const withSlot = [...entries, { button: GP.LB, action: 'slot0' }];

    expect(
      gamepadControlHint(
        {
          entries: withSlot,
          kind: 'xbox',
          crossHotbarEnabled: true,
          crossHotbarSets: [primary, secondary],
          crossHotbarSet: 1,
        },
        { type: 'crossHotbar', action: { type: 'ability', id: 'attack' }, fallback: 'slot0' },
      ),
    ).toEqual(['RT + D-pad ←']);

    expect(
      gamepadControlHint(
        {
          entries: withSlot,
          kind: 'xbox',
          crossHotbarEnabled: false,
          crossHotbarSets: [],
          crossHotbarSet: 0,
        },
        { type: 'crossHotbar', action: { type: 'ability', id: 'attack' }, fallback: 'slot0' },
      ),
    ).toEqual(['LB']);
  });

  it('stays silent instead of advertising a swallowed or missing combat bind', () => {
    expect(
      gamepadControlHint(
        {
          entries: [...entries, { button: GP.LB, action: 'slot0' }],
          kind: 'xbox',
          crossHotbarEnabled: true,
          crossHotbarSets: [emptySet(), emptySet()],
          crossHotbarSet: 0,
        },
        { type: 'crossHotbar', action: { type: 'ability', id: 'attack' }, fallback: 'slot0' },
      ),
    ).toEqual([]);
  });
});
