// The world-label half of the feast title (src/render/entity_labels.ts
// objectDisplayName). The SAME composed string is asserted here and in
// tests/entity_display_name.test.ts (the target-frame half): the composition
// is deliberately duplicated at two presentation sites (under the extraction
// rule of three), so the twin literal pins are what keep the nameplate and
// the target frame from silently diverging on an empty-name fallback, an
// escaping pass, or a locale possessive rule.
import { beforeAll, describe, expect, it } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import { FARM_FEAST_TEMPLATE_ID } from '../src/sim/professions/feast';
import type { Entity } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

function feastEntity(name: string): Entity {
  return {
    id: 7,
    kind: 'object',
    templateId: FARM_FEAST_TEMPLATE_ID,
    name,
    objectItemId: null,
    lootable: false,
  } as unknown as Entity;
}

describe('the placed feast world label', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it("composes the placer's raw name into the localized title, the twin of the target frame", () => {
    // The literal below MUST match tests/entity_display_name.test.ts's
    // expectation for the same input: the two sites compose the same key.
    expect(objectDisplayName(feastEntity('Mira'))).toBe("Mira's Harvest Feast");
  });

  it('never localizes or rewrites the name value itself', () => {
    expect(objectDisplayName(feastEntity('Xx_Grower_xX'))).toBe("Xx_Grower_xX's Harvest Feast");
  });
});
