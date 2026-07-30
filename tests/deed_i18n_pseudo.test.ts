// @vitest-environment jsdom
//
// The dev-only en_XA pseudo-locale (?lang=en_XA on a non-release build) exists to
// surface un-keyed literals: every catalog leaf is accent-pushed and bracketed.
// Deed names/descs/titles resolve their English from the sim content table, OUTSIDE
// the i18n catalog, so the tableFor pseudo swap misses them; deed_i18n folds them at
// render time through a port of the generator's transform (scripts/i18n_pseudo.mjs).
// This pins the fold on/off behavior and the drift pin that the port cannot silently
// diverge from the generator. jsdom is needed so the i18n init reads the URL, and a
// fresh import per active case picks up the pseudo flag.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { deedName, deedTitleText, pseudoDeedString } from '../src/ui/deed_i18n';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { en_XA } from '../src/ui/i18n.resolved.generated/en_XA';

// A fresh deed_i18n whose i18n init sees ?lang=en_XA in the URL, so the dev
// pseudo-locale is active. The statically imported deed_i18n above stays the
// inactive instance (the default '/' URL at file load).
async function loadPseudoActive(): Promise<typeof import('../src/ui/deed_i18n')> {
  window.history.replaceState({}, '', '/?lang=en_XA');
  vi.resetModules();
  return import('../src/ui/deed_i18n');
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('deed pseudo-locale port', () => {
  it('accent-pushes and brackets a leaf, preserving {placeholders}', () => {
    const out = pseudoDeedString('Reach level {n}');
    expect(out.startsWith('[') && out.endsWith(']')).toBe(true);
    expect(out).toContain('{n}'); // the placeholder token survived unchanged
    expect(out).not.toBe('[Reach level {n}]'); // the literal letters were pushed
  });

  it('matches the generator byte for byte on a known catalog leaf (drift pin)', () => {
    // meta.builtOn = "Built {date}"; the committed en_XA table is the generator's
    // output for the same leaf, so a drift from scripts/i18n_pseudo.mjs reds here.
    expect(pseudoDeedString(en.meta.builtOn)).toBe(en_XA.meta.builtOn);
  });
});

describe('deed name/desc/title under the dev pseudo-locale', () => {
  it('folds authored deed English when ?lang=en_XA is active', async () => {
    const pseudo = await loadPseudoActive();
    expect(pseudo.deedName('prog_first_steps')).toBe(pseudoDeedString(DEEDS.prog_first_steps.name));
    expect(pseudo.deedName('prog_first_steps')).not.toBe(DEEDS.prog_first_steps.name);
    expect(pseudo.deedDesc('prog_first_steps')).toBe(pseudoDeedString(DEEDS.prog_first_steps.desc));
    expect(pseudo.deedTitleText('prog_veteran')).toBe(pseudoDeedString('Veteran'));
  });

  it('returns authored deed English byte-identical when the pseudo-locale is inactive', () => {
    // The statically imported (inactive) resolver: authored English, untouched.
    expect(deedName('prog_first_steps')).toBe('First Steps');
    expect(deedTitleText('prog_veteran')).toBe('Veteran');
  });
});
