import { describe, expect, it } from 'vitest';
import { MAX_LEVEL } from '../src/sim/types';
import {
  buildDevCommand,
  DEV_COMMAND_ACTIONS,
  filteredDevActions,
  isDevGuiCommand,
} from '../src/ui/dev_command_view';

describe('developer command view', () => {
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
    expect(filteredDevActions('inventory', '')).toHaveLength(2);
  });
});
