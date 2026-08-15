// The ONE shared en_XA pseudo-locale port (src/ui/i18n_pseudo_port.ts), which
// the deed and Reliquary page-name channels both fold their catalog-external
// English through. The port is a hand-kept copy of the build generator
// (scripts/i18n_pseudo.mjs), so the load-bearing risk is silent drift between
// the two. This suite pins the port TOTALLY against the committed generator
// output: every flat `en` leaf, folded by the port, must equal the committed
// en_XA leaf byte for byte. That exercises all 52 accent-map entries and the
// {token} preservation rule together, instead of the single-leaf spot check each
// channel suite carries.
//
// Node environment on purpose: the port is host-agnostic (no DOM, no URL read).
// The per-channel suites still own the "does this channel actually fold?"
// question, which needs the pseudo flag and therefore a DOM.
import { describe, expect, it } from 'vitest';
import { en } from '../src/ui/i18n.resolved.generated/en';
import { en_XA } from '../src/ui/i18n.resolved.generated/en_XA';
import {
  maybePseudoString,
  PSEUDO_ACCENT_MAP,
  pseudoAccentPush,
  pseudoLocaleString,
} from '../src/ui/i18n_pseudo_port';

function flatten(
  obj: unknown,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') flatten(v, key, out);
      else if (typeof v === 'string') out[key] = v;
    }
  }
  return out;
}

const enFlat = flatten(en);
const xaFlat = flatten(en_XA);

describe('the shared en_XA pseudo-locale port', () => {
  // Vacuity floor: an emptied or mis-imported table would make the total pin
  // below pass over nothing.
  it('reads a whole-catalog corpus on both sides', () => {
    expect(Object.keys(enFlat).length).toBeGreaterThan(1000);
    expect(Object.keys(xaFlat).length).toBe(Object.keys(enFlat).length);
  });

  it('reproduces the committed generator output for EVERY en leaf (total drift pin)', () => {
    const drifted: string[] = [];
    for (const [key, value] of Object.entries(enFlat)) {
      const generated = xaFlat[key];
      if (generated === undefined) {
        drifted.push(`${key}: present in en, missing from the generated en_XA`);
        continue;
      }
      const ported = pseudoLocaleString(value);
      if (ported !== generated) {
        drifted.push(`${key}: port "${ported}" vs generator "${generated}"`);
      }
    }
    expect(
      drifted,
      `src/ui/i18n_pseudo_port.ts drifted from scripts/i18n_pseudo.mjs:\n${drifted.slice(0, 10).join('\n')}`,
    ).toEqual([]);
  });

  it('carries the full 52-letter map, every entry exercised by that corpus', () => {
    // Proves the total pin above is not vacuous for any single map entry: an
    // accent swapped on a letter the catalog never uses would slip through.
    expect(Object.keys(PSEUDO_ACCENT_MAP).length).toBe(52);
    const seen = new Set<string>();
    for (const value of Object.values(enFlat)) {
      for (const ch of value) if (PSEUDO_ACCENT_MAP[ch] !== undefined) seen.add(ch);
    }
    const unexercised = Object.keys(PSEUDO_ACCENT_MAP).filter((ch) => !seen.has(ch));
    expect(unexercised, `accent-map letters absent from the en corpus: ${unexercised}`).toEqual([]);
  });

  it('preserves every {token} and passes non-ASCII through untouched', () => {
    expect(pseudoLocaleString('Relics on {name}')).toBe('[Ŕéļíçš óñ {name}]');
    // A token whose contents would otherwise accent-push, plus CJK and digits.
    expect(pseudoLocaleString('{playerName} 12 虚ろの墓所')).toBe('[{playerName} 12 虚ろの墓所]');
    expect(pseudoAccentPush('ok {name}')).toBe('óķ {ñáɱé}'); // the raw push has no token rule
  });

  it('leaves text untouched while the pseudo-locale is inactive', () => {
    // The default test URL carries no ?lang=en_XA, so the fold is off and every
    // channel renders its authored English.
    expect(maybePseudoString('The Hollow Crypt')).toBe('The Hollow Crypt');
  });
});
