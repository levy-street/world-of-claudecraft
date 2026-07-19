import { describe, expect, it } from 'vitest';
import { syncHotbarActions, type HotbarAction } from '../src/ui/hud/action_bar/hotbar';
import {
  HUNTER_UTILITY_KIT,
  hunterUtilityMigrationIds,
} from '../src/ui/hunter_hotbar_migration';

describe('Hunter persisted hotbar migration', () => {
  it('offers every known utility once for a normal Hunter bar', () => {
    expect(
      hunterUtilityMigrationIds('hunter', 'normal', [...HUNTER_UTILITY_KIT, 'arcane_shot'], false),
    ).toEqual(HUNTER_UTILITY_KIT);
    expect(hunterUtilityMigrationIds('hunter', 'normal', [...HUNTER_UTILITY_KIT], true)).toEqual(
      [],
    );
    expect(hunterUtilityMigrationIds('mage', 'normal', [...HUNTER_UTILITY_KIT], false)).toEqual(
      [],
    );
  });

  it('fills only empty slots and preserves a persisted custom ability and item', () => {
    const actions: HotbarAction[] = [
      { type: 'ability', id: 'arcane_shot' },
      { type: 'item', id: 'minor_healing_potion' },
      null,
      null,
    ];
    const known = ['arcane_shot', 'hunters_mark', 'disengage'];
    const migrationIds = new Set(hunterUtilityMigrationIds('hunter', 'normal', known, false));

    expect(syncHotbarActions(actions, known, migrationIds).actions).toEqual([
      { type: 'ability', id: 'arcane_shot' },
      { type: 'item', id: 'minor_healing_potion' },
      { type: 'ability', id: 'hunters_mark' },
      { type: 'ability', id: 'disengage' },
    ]);
  });
});
