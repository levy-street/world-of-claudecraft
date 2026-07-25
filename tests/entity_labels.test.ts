import { describe, expect, it } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import type { Entity } from '../src/sim/types';
import { t } from '../src/ui/i18n';

// entity_labels.ts is DOM/Three-free (only wraps tEntity/t), so it is a plain
// leaf module a Vitest can drive directly without a renderer/painter harness.

function obj(overrides: Record<string, unknown> = {}): Entity {
  return {
    templateId: 'crate',
    ...overrides,
  } as unknown as Entity;
}

describe('entity_labels: objectDisplayName', () => {
  it('labels the Source Cave centre button with the exact reboot call to action', () => {
    expect(objectDisplayName(obj({ templateId: 'source_cave_reboot' }))).toBe(
      t('worldContent.sourceCaveReboot'),
    );
    expect(t('worldContent.sourceCaveReboot')).toBe('Do not push the button');
  });

  it('the Source Cave reward chest reuses the delve reward-chest interact label', () => {
    // Dropping the source_cave_chest clause reddens nothing elsewhere: this is the
    // one assertion proving the label, not just the chest's nameplate visibility.
    expect(objectDisplayName(obj({ templateId: 'source_cave_chest' }))).toBe(
      t('worldContent.delveRewardChestInteract'),
    );
  });

  it('matches the real delve reward chest label exactly (same precedent, not a lookalike)', () => {
    const caveLabel = objectDisplayName(obj({ templateId: 'source_cave_chest' }));
    const delveLabel = objectDisplayName(obj({ templateId: 'delve_reward_chest' }));
    expect(caveLabel).toBe(delveLabel);
  });

  it('a plain ground object outside the special-cased ids does not get the chest label', () => {
    expect(objectDisplayName(obj({ templateId: 'crate' }))).not.toBe(
      t('worldContent.delveRewardChestInteract'),
    );
  });

  it('the overworld entrance labels through the well landmark key', () => {
    const label = objectDisplayName(obj({ templateId: 'dungeon_door', dungeonId: 'source_cave' }));
    expect(label).toBe(t('worldContent.sourceCaveWellName'));
  });

  it('the Source Cave interior exit labels the seal denial (its only visible state)', () => {
    // nameplate_view hides the open exit entirely; the plate only ever shows
    // while the encounter seals it, so its one label is the red call-out.
    const label = objectDisplayName(obj({ templateId: 'dungeon_exit', dungeonId: 'source_cave' }));
    expect(label).toBe(t('worldContent.sourceCaveExitDenied'));
    expect(label).toBe('ACCESS DENIED');
  });

  it('another dungeon exit keeps the generic dungeon-exit label', () => {
    const label = objectDisplayName(
      obj({ templateId: 'dungeon_exit', dungeonId: 'nythraxis_crypt' }),
    );
    expect(label).toBe(
      t('worldContent.dungeonExitName', { name: t('entities.dungeons.nythraxis_crypt.name') }),
    );
  });

  it('a different dungeon door is unaffected by the well special-case', () => {
    const label = objectDisplayName(
      obj({ templateId: 'dungeon_door', dungeonId: 'nythraxis_crypt' }),
    );
    expect(label).toBe(t('entities.dungeons.nythraxis_crypt.name'));
  });
});
