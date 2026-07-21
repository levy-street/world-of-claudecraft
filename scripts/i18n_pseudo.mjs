// Deterministic en_XA pseudo-locale transform (dev-only).
//
// en_XA is the ONLY mechanism that catches hard-coded literals that never became
// `t()` keys - the gap the type system cannot see. Every `en` leaf is accent-pushed
// (a fixed 1:1 ASCII->Latin map) and wrapped in brackets, so on screen any text
// that stays plain ASCII with NO brackets is an untranslated literal hiding in
// plain sight. {placeholder} tokens are preserved EXACTLY so interpolation still
// works; emoji / non-ASCII pass through unchanged.
//
// The map is FIXED and 1:1, so the same `en` always yields the same en_XA - the
// generated artifact stays reproducible like the rest of the i18n output. This
// module is imported by scripts/i18n_build.mjs and scripts/i18n_admin_build.mjs,
// which emit a generated `en_XA` export that is NEVER a member of `translations`
// (so it stays out of supportedLanguages, the language picker, hreflang, and the
// release gate). The runtimes load it only behind a dev gate (?lang=en_XA on a
// non-release build).

// 1:1 accent-push map for the 52 ASCII letters. Every replacement is a single,
// widely-rendered Latin-script code point that is unmistakably non-ASCII, so an
// accented leaf is visually distinct from an un-keyed English literal. Anything not
// in this map (digits, punctuation, whitespace, CJK, emoji) passes through.
const ACCENT_MAP = {
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

// Accent-push the ASCII letters of `text`; everything else (incl. surrogate-pair
// emoji, iterated correctly by for..of) passes through untouched.
function accentPush(text) {
  let out = '';
  for (const ch of text) out += ACCENT_MAP[ch] ?? ch;
  return out;
}

// Transform one leaf string: split out every {token} (the interpolation runtime
// only substitutes {[A-Za-z0-9_]+}, but we preserve ANY {...} so ICU-style tokens
// survive too), accent-push only the literal text between them, then bracket the
// whole leaf. The placeholder contents are NEVER accented or bracketed.
export function pseudoString(s) {
  const parts = s.split(/(\{[^}]*\})/g);
  const transformed = parts
    .map((part) => (part.startsWith('{') && part.endsWith('}') ? part : accentPush(part)))
    .join('');
  return '[' + transformed + ']';
}

// Deep transform: recurse objects/arrays, pseudo-localize string leaves, pass
// through anything else. Structure (keys, array shape) is preserved exactly, so the
// result still satisfies `typeof en` and tsc keys stay green.
export function pseudoLocalize(value) {
  if (typeof value === 'string') return pseudoString(value);
  if (Array.isArray(value)) return value.map(pseudoLocalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = pseudoLocalize(value[key]);
    return out;
  }
  return value;
}
