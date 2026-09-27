import { describe, expect, it } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { objectDisplayName } from '../src/render/entity_labels';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { INVESTIGATION_NPCS } from '../src/sim/content/world_quest_investigation';
import type { Entity } from '../src/sim/types';
import { entityDisplayName } from '../src/ui/entity_display_core';
import { t } from '../src/ui/i18n';

describe('investigation reused presentation', () => {
  it('uses existing soldier and undead looks', () => {
    for (const npc of INVESTIGATION_NPCS)
      expect(visualKeyFor({ kind: 'npc', templateId: npc.id } as Entity)).toBe('npc_knight');
    expect(visualKeyFor({ kind: 'mob', templateId: 'fenbridge_infiltrator' } as Entity)).toBe(
      visualKeyFor({ kind: 'mob', templateId: 'drowned_dead' } as Entity),
    );
  });

  it('reuses the exact prepared scroll and tome visuals, including their material treatment', () => {
    const resolve = questObjectPreloadInternalsForTest.visualItemIdForEntity;
    expect(resolve('wq_infiltrator_orders', 2146900025)).toBe('fen_muster_order');
    expect(resolve('wq_infiltrator_ledger', 2146900026)).toBe('morthen_grimoire');
  });

  it('localizes both ground-template and item-id clue labels in HUD and world', () => {
    for (const [item, key] of [
      ['wq_infiltrator_orders', 'questUi.worldQuest.investigation.clueNames.c0'],
      ['wq_infiltrator_ledger', 'questUi.worldQuest.investigation.clueNames.c1'],
    ] as const) {
      for (const objectItemId of [item, null]) {
        const entity = {
          kind: 'object',
          templateId: `ground_${item}`,
          objectItemId,
          name: 'Do not show this raw name',
        } as Entity;
        expect(entityDisplayName(entity)).toBe(t(key));
        expect(objectDisplayName(entity)).toBe(t(key));
      }
    }
  });
});
