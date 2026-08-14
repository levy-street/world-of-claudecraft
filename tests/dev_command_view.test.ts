import { describe, expect, it } from 'vitest';
import { MAX_LEVEL } from '../src/sim/types';
import {
  buildDevCommand,
  DEV_COMMAND_ACTIONS,
  devCategoryVisible,
  filteredDevActions,
  isDevGuiCommand,
} from '../src/ui/dev_command_view';

describe('developer command view', () => {
  it('builds the BIS-20 kit command with the same optional-spec contract as the fresh kit', () => {
    expect(buildDevCommand('biskit', { bisSpec: '' })).toBe('/dev bis');
    expect(buildDevCommand('biskit', { bisSpec: 'protection' })).toBe('/dev bis protection');
    // Token-gated like every other field: an injection-shaped value never ships.
    expect(buildDevCommand('biskit', { bisSpec: 'prot; /dev gold 999' })).toBe('/dev bis');
  });

  it('builds farmgrow with the optional bed id and refuses to splice a crafted one', () => {
    // The all-plots form is what an EMPTY field means, not a refusal: the
    // command already accepts both shapes, so the row degrades to the wider
    // one instead of going dead (the biskit optional-spec contract).
    expect(buildDevCommand('farmgrow', {})).toBe('/dev farmgrow');
    expect(buildDevCommand('farmgrow', { bed: '' })).toBe('/dev farmgrow');
    expect(buildDevCommand('farmgrow', { bed: 'bed_eastbrook_1' })).toBe(
      '/dev farmgrow bed_eastbrook_1',
    );
    // Token-gated like every other field: an injection-shaped value never
    // reaches the command line, and the fallback is the harmless wide form.
    expect(buildDevCommand('farmgrow', { bed: 'bed_1; /dev gold 999' })).toBe('/dev farmgrow');
  });

  it('shows the Spawns tab only to admin accounts', () => {
    expect(devCategoryVisible('spawns', true)).toBe(true);
    expect(devCategoryVisible('spawns', false)).toBe(false);
    // Every other tab is unaffected by the admin flag.
    for (const category of ['player', 'inventory', 'progress', 'travel', 'scenarios'] as const) {
      expect(devCategoryVisible(category, false)).toBe(true);
    }
  });

  it('recognizes only the exact GUI command', () => {
    expect(isDevGuiCommand('/dev gui')).toBe(true);
    expect(isDevGuiCommand('  /DEV GUI  ')).toBe(true);
    expect(isDevGuiCommand('/dev gui now')).toBe(false);
    expect(isDevGuiCommand('/dev god')).toBe(false);
  });

  it('builds bounded commands without accepting arbitrary tokens', () => {
    expect(buildDevCommand('spawn', { mob: 'forest_wolf', count: 999, mobLevel: 999 })).toBe(
      `/dev spawn forest_wolf 20 ${MAX_LEVEL}`,
    );
    expect(buildDevCommand('give', { item: 'wolf_fang', itemCount: 4 })).toBe(
      '/dev give wolf_fang 4',
    );
    expect(buildDevCommand('spawn', { mob: 'wolf; /dev gold 999', count: 1 })).toBeNull();
    expect(buildDevCommand('teleport', { x: 'NaN', z: 4 })).toBeNull();
  });

  it('keeps every action discoverable by category and search', () => {
    const categories = new Set(DEV_COMMAND_ACTIONS.map((action) => action.category));
    expect(categories).toEqual(
      new Set(['player', 'spawns', 'inventory', 'progress', 'travel', 'scenarios']),
    );
    const searchCopy = (key: string) =>
      key.includes('killtarget') || key.includes('despawntarget') ? 'selected mob' : key;
    expect(filteredDevActions('spawns', 'selected', searchCopy).map((action) => action.id)).toEqual(
      ['killtarget', 'despawntarget'],
    );
    // give, kit, biskit, gold. Named rather than counted so a future add says WHICH
    // action appeared instead of just moving a number.
    expect(filteredDevActions('inventory', '').map((action) => action.id)).toEqual([
      'give',
      'kit',
      'biskit',
      'gold',
    ]);
  });
});
