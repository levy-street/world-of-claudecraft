// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hudSource = readFileSync(resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('HUD localized hot-path cache revisions', () => {
  it('distinguishes pseudo English from normal English even though the language is unchanged', async () => {
    window.history.replaceState({}, '', '/?lang=en_XA');
    vi.resetModules();
    const [i18n, { XpBarViewCache }, { LowResourceViewCache }] = await Promise.all([
      import('../src/ui/i18n'),
      import('../src/ui/xp_bar'),
      import('../src/ui/low_resource'),
    ]);

    const pseudoRevision = i18n.getI18nRevision();
    const xpCache = new XpBarViewCache();
    const resourceCache = new LowResourceViewCache();
    const pseudoXp = xpCache.resolve(1, 10, 10, 0, true, pseudoRevision);
    const pseudoResource = resourceCache.resolve(10, 100, 'mana', pseudoRevision);
    expect(pseudoResource).not.toBeNull();
    const pseudoResourceLabel = pseudoResource?.label;
    expect(i18n.getLanguage()).toBe('en');
    expect(pseudoResourceLabel).not.toBe('Low Mana');
    expect(xpCache.resolve(1, 10, 10, 0, true, pseudoRevision)).toBe(pseudoXp);
    expect(resourceCache.resolve(10, 100, 'mana', pseudoRevision)).toBeNull();

    i18n.setLanguage('en');

    expect(i18n.getLanguage()).toBe('en');
    const englishRevision = i18n.getI18nRevision();
    expect(englishRevision).toBeGreaterThan(pseudoRevision);
    const englishXp = xpCache.resolve(1, 10, 10, 0, true, englishRevision);
    const englishResource = resourceCache.resolve(10, 100, 'mana', englishRevision);
    expect(englishXp).not.toBe(pseudoXp);
    expect(englishXp.label).not.toBe(pseudoXp.label);
    expect(englishResource).toBe(pseudoResource);
    expect(englishResource?.label).toBe('Low Mana');
    expect(englishResource?.label).not.toBe(pseudoResourceLabel);
  });

  it('invalidates each independently cached XP and resource input', async () => {
    const [i18n, { XpBarViewCache }, { LowResourceViewCache }] = await Promise.all([
      import('../src/ui/i18n'),
      import('../src/ui/xp_bar'),
      import('../src/ui/low_resource'),
    ]);
    const revision = i18n.getI18nRevision();
    const xpCases = [
      [2, 10, 10, 0, true],
      [1, 11, 10, 0, true],
      [1, 10, 11, 0, true],
      [1, 10, 10, 1, true],
      [1, 10, 10, 0, false],
    ] as const;
    for (const changed of xpCases) {
      const cache = new XpBarViewCache();
      const baseline = cache.resolve(1, 10, 10, 0, true, revision);
      expect(
        cache.resolve(changed[0], changed[1], changed[2], changed[3], changed[4], revision),
      ).not.toBe(baseline);
    }

    const resourceCases = [
      [11, 100, 'mana'],
      [10, 101, 'mana'],
      [10, 100, 'energy'],
    ] as const;
    for (const changed of resourceCases) {
      const cache = new LowResourceViewCache();
      expect(cache.resolve(10, 100, 'mana', revision)).not.toBeNull();
      expect(cache.resolve(changed[0], changed[1], changed[2], revision)).not.toBeNull();
    }
  });

  it('keys every localized HUD hot cache on the resolution revision', () => {
    expect(hudSource).toMatch(
      /const titleSig = `\$\{getDeedTitleI18nRevision\(\)\}\|\$\{target\.title \?\? ''\}`;/,
    );
    expect(hudSource).toContain('const xpI18nRevision = getI18nRevision();');
    expect(hudSource).toMatch(
      /this\.xpBarViewCache\.resolve\(\s*p\.level,\s*sim\.xp,\s*sim\.lifetimeXp,\s*sim\.restedXp,\s*showOverflow,\s*xpI18nRevision,\s*\)/,
    );
    expect(hudSource).toContain('const i18nRevision = getI18nRevision();');
    expect(hudSource).toMatch(
      /this\.lowResourceViewCache\.resolve\(\s*p\.resource,\s*p\.maxResource,\s*p\.resourceType,\s*i18nRevision,\s*\)/,
    );
    expect(hudSource).not.toContain('getLanguage');
  });
});
