import { afterEach, expect, it } from 'vitest';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

afterEach(() => setLanguage('en'));

it('localizes the live advanced riding percentage instead of pinning the old speed', async () => {
  for (const locale of ['en', 'zh_CN', 'zh_TW', 'ko_KR', 'ja_JP', 'ru_RU'] as const) {
    await ensureLocaleLoaded(locale);
    setLanguage(locale);
    for (const speed of [110, 137]) {
      const text = localizeSimText(
        `You have learned Advanced Riding. Your mount speed is increased by ${speed}%.`,
      );
      expect(text).toContain(`${speed}%`);
      expect(text).not.toContain('{speed}');
      if (locale !== 'en') expect(text).not.toContain('You have learned');
    }
  }
});
