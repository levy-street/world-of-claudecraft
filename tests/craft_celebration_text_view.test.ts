// The localized crafting-celebration text core
// (src/ui/craft_celebration_text_view.ts): the masterwork toast/tier-up/zone
// lines extracted from hud.ts, and the Masterwrought phase 13 legendary pair.
// The extraction pins hold the pre-extraction hud behavior byte for byte; the
// legendary pins hold the phase 13 doctrine: the player-chosen name is a
// VALUE spliced into the template as data, never a key, and the zone line
// reads the name off the EVENT payload, never a def lookup.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  craftBannerIcon,
  craftBannerText,
  legendaryForgedLine,
  legendaryZoneLine,
  masterworkToastText,
  masterworkZoneLine,
  tierUpToastText,
} from '../src/ui/craft_celebration_text_view';
import { QUALITY_COLOR } from '../src/ui/icons';
import { MASTERWORK_SEAL_IMAGE_URL } from '../src/ui/profession_art';

const ITEM_ID = 'eastbrook_arming_sword';
const ITEM_NAME = ITEMS[ITEM_ID].name;

describe('masterwork lines (the hud extraction, byte-identical)', () => {
  it('masterworkToastText renders the toast with the resolved item name', () => {
    expect(masterworkToastText(ITEM_ID)).toBe(`Masterwork! ${ITEM_NAME}`);
    // An id this client cannot resolve falls back to the raw id (the
    // pre-extraction hud fallback).
    expect(masterworkToastText('no_such_item')).toBe('Masterwork! no_such_item');
  });

  it('tierUpToastText names the craft and the tier', () => {
    expect(tierUpToastText({ craftId: 'smithing', toTier: 3 })).toContain('3');
  });

  it('masterworkZoneLine bundles the exact pre-extraction log call', () => {
    const line = masterworkZoneLine('Ayla', ITEM_ID);
    expect(line.text).toBe(`Ayla crafted a masterwork ${ITEM_NAME}!`);
    expect(line.color).toBe(QUALITY_COLOR.epic);
    expect(line.icon).toBe(MASTERWORK_SEAL_IMAGE_URL);
  });

  it('craftBannerText/craftBannerIcon keep the banner arm byte-identical', () => {
    expect(craftBannerText({ kind: 'masterwork', itemId: ITEM_ID })).toBe(
      masterworkToastText(ITEM_ID),
    );
    expect(craftBannerText({ kind: 'tierUp', craftId: 'smithing', toTier: 2 })).toBe(
      tierUpToastText({ craftId: 'smithing', toTier: 2 }),
    );
    expect(craftBannerIcon({ kind: 'masterwork', itemId: ITEM_ID })).toBe(
      MASTERWORK_SEAL_IMAGE_URL,
    );
    // A tier-up banner carries NO icon, the pre-extraction behavior.
    expect(craftBannerIcon({ kind: 'tierUp', craftId: 'smithing', toTier: 2 })).toBeUndefined();
  });
});

describe('legendary lines (Masterwrought phase 13)', () => {
  it('legendaryForgedLine splices the chosen name as data into the personal line', () => {
    const line = legendaryForgedLine(ITEM_ID, "Vel'tara's Oath");
    expect(line.text).toBe(`${ITEM_NAME} is reborn as Vel'tara's Oath, a legend!`);
    expect(line.color).toBe(QUALITY_COLOR.legendary);
    expect(line.icon).toBe(MASTERWORK_SEAL_IMAGE_URL);
  });

  it('legendaryZoneLine reads the chosen name off the EVENT, never a def lookup', () => {
    // The chosen name deliberately shares no substring with any def name, so
    // its appearance proves the event payload is the source.
    const line = legendaryZoneLine('Ayla', ITEM_ID, 'Zzyzx');
    expect(line.text).toBe(`Ayla forged ${ITEM_NAME} into the legend Zzyzx!`);
    expect(line.color).toBe(QUALITY_COLOR.legendary);
    expect(line.icon).toBe(MASTERWORK_SEAL_IMAGE_URL);
  });

  it('a name-shaped token is spliced verbatim, not re-resolved through i18n', () => {
    // A hostile or coincidental chosen name that LOOKS like a key must render
    // as itself (the value path); a t() re-resolution would throw or swap it.
    const line = legendaryForgedLine(ITEM_ID, 'hudChrome.crafting.legendaryLine');
    expect(line.text).toContain('reborn as hudChrome.crafting.legendaryLine');
  });
});
