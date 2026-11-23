// The homepage footer (index.html at / and play.html at /play, both indexed) links the
// studio site, levystreet.com, as a crawlable backlink. It ships in the static HTML so
// crawlers see it without running script, and it carries no nofollow/ugc/sponsored rel
// so it passes link equity. These pins keep both shells in step.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { en } from '../src/ui/i18n.catalog';
import { SUPPORTED_LANGUAGES } from '../src/ui/i18n.resolved.generated/loaders';

const read = (p: string) =>
  readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('homepage footer links the Levy Street studio site', () => {
  it.each(['index.html', 'play.html'])('%s carries the backlink in the legal row', (shell) => {
    const html = read(shell);
    const row = html.match(/<div class="footer-legal-row">[\s\S]*?<\/div>/)?.[0] ?? '';
    const link = row.match(/<a [^>]*data-i18n="footer\.levyStreet"[^>]*>([^<]*)<\/a>/);
    expect(link, `${shell} footer-legal-row`).not.toBeNull();
    const tag = link?.[0] ?? '';
    expect(tag).toContain('href="https://levystreet.com"');
    expect(tag).toContain('target="_blank"');
    expect(tag).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/);
    expect(tag).not.toMatch(/\b(nofollow|ugc|sponsored)\b/);
    expect(link?.[1]).toBe('Levy Street');
  });

  it('labels the link from the catalog with the studio name', () => {
    expect(en.footer.levyStreet).toBe('Levy Street');
  });
});

// A production build throws from t() on any key a locale has left pending, and main
// deploys without the release-tier i18n lane, so the label must be filled (the brand,
// verbatim) in every locale or the footer throws for every non-English player.
describe('the footer backlink label renders in every locale on a release build', () => {
  afterAll(() => {
    delete process.env.I18N_RELEASE;
    setLanguage('en');
  });

  it.each(SUPPORTED_LANGUAGES)('%s', async (lang) => {
    process.env.I18N_RELEASE = '1';
    setLanguage(lang);
    await ensureLocaleLoaded(lang);
    expect(t('footer.levyStreet')).toBe('Levy Street');
  });
});
