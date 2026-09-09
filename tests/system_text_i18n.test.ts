// The system-message matcher (src/ui/system_text_i18n.ts), driven directly.
//
// It was a private Hud method until hud.ts hit its monolith ceiling; the
// extraction's stated reason was that a Vitest could then drive every arm
// without standing up a coordinator, so this file is that Vitest. The S3 guard
// (tests/localization_fixes.test.ts) parses the arm TABLE out of the source; it
// never calls the function, so a body that returned its input with the arms left
// as dead literals would keep it green. These cases run under a non-English
// locale so a passthrough cannot masquerade as a match.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DUNGEON_LIST } from '../src/sim/data';
import { dungeonText } from '../src/ui/entity_display_core';
import { ensureLocaleLoaded, formatNumber, setLanguage, t } from '../src/ui/i18n';
import { localizeSystemText } from '../src/ui/system_text_i18n';

// Non-en tables are lazy: the dense zh_CN table has to be resident before the
// synchronous setLanguage, or t() falls back to English and every "not the
// input" assertion below would be comparing English to English.
beforeAll(async () => {
  await ensureLocaleLoaded('zh_CN');
});
afterEach(() => setLanguage('en'));

describe('localizeSystemText', () => {
  it('turns an exact system line into its key', () => {
    setLanguage('zh_CN');
    const out = localizeSystemText('You stand up.');
    expect(out).toBe(t('hud.logs.standUp'));
    expect(out).not.toBe('You stand up.');
  });

  it('captures the name out of a party line and carries it through', () => {
    setLanguage('zh_CN');
    const out = localizeSystemText('Bob joins the party.');
    expect(out).toBe(t('hud.logs.partyJoin', { name: 'Bob' }));
    expect(out).toContain('Bob');
    expect(out).not.toBe('Bob joins the party.');
  });

  it('localizes the master-loot threshold through its own nested key', () => {
    setLanguage('zh_CN');
    const out = localizeSystemText('Loot threshold set to rare.');
    expect(out).toBe(
      t('hudChrome.masterLoot.thresholdSet', {
        threshold: t('hudChrome.masterLoot.thresholdRare'),
      }),
    );
    expect(out).not.toContain('rare');
  });

  it('formats a counted line through formatNumber', () => {
    setLanguage('zh_CN');
    const out = localizeSystemText('1200 daily rewards points gained.');
    expect(out).toBe(
      t('hudChrome.dailyRewards.pointsGained', {
        points: formatNumber(1200, { maximumFractionDigits: 0 }),
      }),
    );
    expect(out).toContain(formatNumber(1200, { maximumFractionDigits: 0 }));
  });

  it('matches a dungeon enter line against the content table', () => {
    setLanguage('zh_CN');
    const dungeon = DUNGEON_LIST[0];
    expect(dungeon).toBeDefined();
    expect(localizeSystemText(dungeon.enterText)).toBe(dungeonText(dungeon.id, 'enterText'));
  });

  it('returns an unmatched line unchanged, so an unlocalized message still shows', () => {
    setLanguage('zh_CN');
    expect(localizeSystemText('A line no matcher knows.')).toBe('A line no matcher knows.');
  });
});
