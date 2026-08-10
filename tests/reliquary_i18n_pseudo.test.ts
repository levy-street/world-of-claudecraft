// @vitest-environment happy-dom
//
// The dev-only en_XA pseudo-locale (?lang=en_XA on a non-release build) exists to
// surface un-keyed literals: every catalog leaf is accent-pushed and bracketed.
// Reliquary page names/descs resolve their English from the sim content table,
// OUTSIDE the i18n catalog, so the tableFor pseudo swap misses them;
// reliquary_i18n folds them at render time through the shared port of the
// generator's transform (src/ui/i18n_pseudo_port.ts, a copy of
// scripts/i18n_pseudo.mjs). This suite pins the fold on/off behavior for THIS
// channel; the port's total drift pin against the committed en_XA table lives in
// tests/i18n_pseudo_port.test.ts. A DOM (the happy-dom pragma above) is needed so
// the i18n init reads the URL, and a fresh import per active case picks up the
// pseudo flag.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { en_XA } from '../src/ui/i18n.resolved.generated/en_XA';
import { pseudoReliquaryString, reliquaryPageName } from '../src/ui/reliquary_i18n';

// A fresh reliquary_i18n whose i18n init sees ?lang=en_XA in the URL, so the dev
// pseudo-locale is active. The statically imported reliquary_i18n above stays the
// inactive instance (the default '/' URL at file load).
async function loadPseudoActive(): Promise<typeof import('../src/ui/reliquary_i18n')> {
  window.history.replaceState({}, '', '/?lang=en_XA');
  vi.resetModules();
  return import('../src/ui/reliquary_i18n');
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('reliquary pseudo-locale port', () => {
  it('accent-pushes and brackets a leaf, preserving {placeholders}', () => {
    const out = pseudoReliquaryString('Relics on {name}');
    expect(out.startsWith('[') && out.endsWith(']')).toBe(true);
    expect(out).toContain('{name}'); // the placeholder token survived unchanged
    expect(out).not.toBe('[Relics on {name}]'); // the literal letters were pushed
  });

  it('matches the generator byte for byte on a known catalog leaf (drift pin)', () => {
    // meta.builtOn = "Built {date}"; the committed en_XA table is the generator's
    // output for the same leaf, so a drift from scripts/i18n_pseudo.mjs reds here.
    expect(pseudoReliquaryString(en.meta.builtOn)).toBe(en_XA.meta.builtOn);
  });

  it('folds a real page name to a pinned literal (no self-comparison)', () => {
    // The assertions above compare the port against itself or against a catalog
    // leaf; this one states the expected transform of a page name outright, so an
    // accent-map or bracket change is decisive for the strings this channel
    // actually renders. Both sides are literals, computed once from the map. The
    // input is the authored English of conquerors_hollow_crypt (pinned as such in
    // tests/reliquary_i18n.test.ts).
    expect(pseudoReliquaryString('The Hollow Crypt')).toBe('[Ţĥé Ĥóļļóŵ Çŕýþţ]');
  });
});

describe('reliquary page name/desc under the dev pseudo-locale', () => {
  it('folds authored page English when ?lang=en_XA is active', async () => {
    const pseudo = await loadPseudoActive();
    const def = RELIQUARY_PAGES_BY_ID.conquerors_hollow_crypt;
    expect(pseudo.reliquaryPageName('conquerors_hollow_crypt')).toBe(
      pseudoReliquaryString(def.name),
    );
    expect(pseudo.reliquaryPageName('conquerors_hollow_crypt')).not.toBe(def.name);
    expect(pseudo.reliquaryPageDesc('conquerors_hollow_crypt')).toBe(
      pseudoReliquaryString(def.desc ?? ''),
    );
  });

  it('returns authored page English byte-identical when the pseudo-locale is inactive', () => {
    // The statically imported (inactive) resolver: authored English, untouched.
    expect(reliquaryPageName('conquerors_hollow_crypt')).toBe('The Hollow Crypt');
    expect(reliquaryPageName('horizons_mounts')).toBe('Mounts');
  });
});
