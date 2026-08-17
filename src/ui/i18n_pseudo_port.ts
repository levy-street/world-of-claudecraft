// The dev-only en_XA pseudo-locale port, shared by every channel whose English
// resolves OUTSIDE the i18n catalog (deed names/descs/titles from the DEEDS
// table, Reliquary page names/descs from RELIQUARY_PAGES). tableFor pseudo-swaps
// every catalog leaf, but a string that never lived in the catalog would render
// plain English inside pseudolocalized chrome, hiding the very literal the
// pseudo-locale exists to expose. Both channels fold their resolved English
// through this one port of the generator's transform (scripts/i18n_pseudo.mjs),
// so there is a single place that can drift from the generator, and
// tests/i18n_pseudo_port.test.ts pins it against the committed en_XA table leaf
// by leaf.
//
// Host-agnostic and content-free: no DOM, no channel data. The
// `!import.meta.env.PROD` gate in maybePseudoString keeps the map and the
// transform statically dead in a release build.

import { isPseudoActive } from './i18n';

// 1:1 accent-push map for the 52 ASCII letters (copied from
// scripts/i18n_pseudo.mjs; the two must stay identical, guarded by the total
// drift pin in tests/i18n_pseudo_port.test.ts).
export const PSEUDO_ACCENT_MAP: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'þ',
  q: 'ɋ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'ú',
  v: 'ʋ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ɱ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Þ',
  Q: 'Ɋ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Ú',
  V: 'Ʋ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/** Accent-push the ASCII letters of `text`; everything else (digits,
 *  punctuation, CJK, surrogate-pair emoji iterated correctly by for..of) passes
 *  through untouched. */
export function pseudoAccentPush(text: string): string {
  let out = '';
  for (const ch of text) out += PSEUDO_ACCENT_MAP[ch] ?? ch;
  return out;
}

/** Accent-push the literal text of `s`, preserving every {token} exactly, then
 *  bracket the whole leaf. A faithful port of scripts/i18n_pseudo.mjs's
 *  pseudoString; exported so each channel can re-export it under its own name
 *  for the drift pins. */
export function pseudoLocaleString(s: string): string {
  const transformed = s
    .split(/(\{[^}]*\})/g)
    .map((part) => (part.startsWith('{') && part.endsWith('}') ? part : pseudoAccentPush(part)))
    .join('');
  return `[${transformed}]`;
}

/** Fold a resolved English string under the dev pseudo-locale, else return it
 *  untouched. The `!import.meta.env.PROD` prefix makes the whole branch
 *  statically dead in a release build, so the port above tree-shakes away. */
export function maybePseudoString(s: string): string {
  return !import.meta.env.PROD && isPseudoActive() ? pseudoLocaleString(s) : s;
}
