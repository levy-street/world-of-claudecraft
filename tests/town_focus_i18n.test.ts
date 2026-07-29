import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { MOBS } from '../src/sim/data';
import { componentLabel } from '../src/ui/hud/loot/corpse_harvest_window';
import { t } from '../src/ui/i18n';

// Town Focus (src/ui/town_focus_window.ts) builds a component label key
// dynamically as `hudChrome.corpseHarvest.components.${component}` for every
// key of HARVEST_COMPONENT_ITEMS. The label map (i18n.catalog/hud_chrome.ts
// corpseHarvest.components) is a hand-maintained sibling list that must cover
// every one of those keys, or t()'s onUntrackedKey path throws in dev/test
// (and silently renders the raw key string in production) the first time that
// component's row renders (issue #2344). This pin iterates the real source of
// truth so a future new harvest component cannot silently reintroduce the gap.

describe('Town Focus component labels cover every HARVEST_COMPONENT_ITEMS key', () => {
  for (const component of Object.keys(HARVEST_COMPONENT_ITEMS)) {
    it(`resolves a real label for "${component}"`, () => {
      const key = `hudChrome.corpseHarvest.components.${component}` as Parameters<typeof t>[0];
      const label = t(key);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(key);
    });
  }
});

// The sibling per-corpse harvest picker (src/ui/hud/loot/corpse_harvest_window.ts)
// has its own hand-maintained COMPONENT_LABEL_KEYS map covering the wider set of
// creature-part tags (claw/gills/horn/tusk are live componentTags used by mob
// content, not retired) plus the HARVEST_COMPONENT_ITEMS set above. componentLabel
// silently falls back to the raw tag string when a key is missing, so this can't
// throw the way Town Focus did, but it is the same class of gap: a corpse tagged
// meat or cloth showed a lowercase raw tag instead of a label. Iterate every real
// componentTags value used by mob content so a future new tag can't reopen it.
describe('Corpse harvest picker labels cover every componentTags value used by mob content', () => {
  const tags = new Set<string>();
  for (const mob of Object.values(MOBS)) {
    for (const tag of mob.componentTags ?? []) tags.add(tag);
  }
  expect(tags.size).toBeGreaterThan(0);

  for (const tag of tags) {
    it(`resolves a real label for "${tag}", not the raw tag`, () => {
      expect(componentLabel(tag)).not.toBe(tag);
    });
  }
});
