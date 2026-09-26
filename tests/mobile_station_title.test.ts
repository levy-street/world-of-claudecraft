// The placed mobile-station title (src/ui/hud/professions/
// mobile_station_title.ts): one leaf, read by the target frame
// (entity_display_core.ts) and the floating world label (entity_labels.ts),
// so the two surfaces cannot name the same station two different things.
// The literal titles are pinned at BOTH sites, the feast twin-pin idiom.
import { beforeAll, describe, expect, it } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import { mobileStationTemplateId } from '../src/sim/professions/mobile_station_object';
import type { Entity } from '../src/sim/types';
import { entityDisplayName } from '../src/ui/entity_display_core';
import {
  mobileStationNounFor,
  mobileStationTitleFor,
} from '../src/ui/hud/professions/mobile_station_title';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

function station(suffix: string, name = 'Fizban'): Entity {
  return {
    id: 9,
    kind: 'object',
    templateId: mobileStationTemplateId(suffix),
    name,
    objectItemId: null,
    lootable: false,
  } as unknown as Entity;
}

describe('the placed mobile-station title', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('names the placing item for an item placement, at both surfaces', () => {
    expect(entityDisplayName(station('grand_cauldron'))).toBe("Fizban's Grand Cauldron");
    expect(objectDisplayName(station('grand_cauldron'))).toBe("Fizban's Grand Cauldron");
    expect(objectDisplayName(station('masters_field_forge'))).toBe("Fizban's Master's Field Forge");
  });

  it("strips the item's own leading article so the possessive reads naturally", () => {
    expect(mobileStationNounFor(mobileStationTemplateId('laden_hearth'))).toBe('Laden Hearth');
    expect(entityDisplayName(station('laden_hearth'))).toBe("Fizban's Laden Hearth");
  });

  it('names the station type for a specialization placement with no item', () => {
    expect(entityDisplayName(station('alchemy'))).toBe("Fizban's Apothecary");
    expect(objectDisplayName(station('cooking'))).toBe("Fizban's Kitchens");
  });

  it('never rewrites the name value and answers null for anything else', () => {
    expect(objectDisplayName(station('grand_cauldron', 'Xx_Brewer_xX'))).toBe(
      "Xx_Brewer_xX's Grand Cauldron",
    );
    expect(mobileStationTitleFor('farm_feast', 'Fizban')).toBeNull();
    expect(mobileStationTitleFor(mobileStationTemplateId('not_a_craft'), 'Fizban')).toBeNull();
  });
});
