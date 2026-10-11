// The standing receipt the sim logs after a world quest turn-in or a finished
// clue hunt ("+150 Automatons Standing.") is English from src/sim; the client
// matcher (src/ui/sim_i18n.ts RULES) must re-localize it, faction name and all.
import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

describe('sim standing receipt re-localization', () => {
  afterEach(() => setLanguage('en'));

  it('resolves each faction by its English name and formats the amount', async () => {
    setLanguage('en');
    expect(localizeSimText('+150 Automatons Standing.')).toBe('+150 Automatons Standing.');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const ja = localizeSimText('+1000 Rift Watch Standing.');
    expect(ja).toBe(
      t('hudChrome.reputation.standingGained', {
        amount: '1,000',
        faction: t('hudChrome.reputation.faction.rift_watch'),
      }),
    );
    expect(ja).not.toContain('Standing');
    expect(ja).not.toContain('Rift Watch');
  });

  it('keeps an unknown faction name verbatim rather than dropping it', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    const out = localizeSimText('+80 Nobody Standing.');
    expect(out).toContain('Nobody');
    expect(out).toContain('80');
  });
});
