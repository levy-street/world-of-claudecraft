// The localized crafting-celebration text core
// (src/ui/craft_celebration_text_view.ts): the masterwork toast/tier-up/zone
// lines extracted from hud.ts, and the Masterwrought phase 13 legendary pair.
// The extraction pins hold the pre-extraction hud behavior byte for byte; the
// legendary pins hold the phase 13 doctrine: the player-chosen name is a
// VALUE spliced into the template as data, never a key, and the zone line
// reads the name off the EVENT payload, never a def lookup.
import { readFileSync } from 'node:fs';
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

  it('the cue decision rides the bundle: personal forged line only, every zone line silent', () => {
    // The review-round extraction: the hud switch consumes playCue instead of
    // deciding the achievement cue inline, so which recipient hears it is a
    // pure-core fact pinned here for all three chat-line builders.
    expect(legendaryForgedLine(ITEM_ID, 'Oath').playCue).toBe(true);
    expect(legendaryZoneLine('Ayla', ITEM_ID, 'Oath').playCue).toBe(false);
    expect(masterworkZoneLine('Ayla', ITEM_ID).playCue).toBe(false);
  });
});

describe('the hud switch consumes the bundle decisions (source pins)', () => {
  // The consumer half: string interpolation in the event switch that no
  // behavioral suite drives (the celebration arms need a full Hud world), so
  // the wiring is pinned at source with comments stripped.
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
    /^\s*\/\/.*$/gm,
    '',
  );

  it('both legendary arms gate the achievement cue on playCue, never inline', () => {
    const arms = hud.match(/if \(l\.playCue\) audio\.achievement\(\);/g);
    expect(arms).toHaveLength(2);
  });

  it('both legendary log calls opt out of chat item-link parsing (plainText)', () => {
    // The chosen name is player-authored and the load bound deliberately
    // admits [[i: shapes from persistence, so both lines must render verbatim:
    // the 6th log argument (plainText) is spelled true on each.
    const calls = hud.match(
      /this\.log\(l\.text, l\.color, l\.icon, ERROR_LOG_CHAN, false, true\);/g,
    );
    expect(calls).toHaveLength(2);
  });
});
