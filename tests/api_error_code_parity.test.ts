import { beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../server/http/error_codes';
import { API_ERROR_KEYS } from '../src/ui/api_error_i18n';
import { ensureLocaleLoaded, setLanguage, supportedLanguages, tOptional } from '../src/ui/i18n';
import { apiErrorStrings } from '../src/ui/i18n.catalog/api_error';

// Per-surface code-parity guard for the REST error matcher. The S3 guard
// (tests/localization_fixes.test.ts) scans only the WS path (server/game.ts) and never
// reads the REST matcher, so a server-emitted stable code with no client-side apiError.*
// entry would ship raw / unresolved to every locale unnoticed. This test closes that gap:
// it enumerates every code from the single source of truth (server/http/error_codes.ts),
// proves each resolves through the client catalog in every locale, proves Agent A's
// declarative code-to-key table is the exact identity, pins the parametric placeholder
// tokens, freezes the code set append-only (AIP-193), and proves the catalog carries
// no phantom leaf and no placeholder the matcher never fills.
//
// Cross-agent contract (fixed): a code 'domain.reason' maps VERBATIM to the nested catalog
// key 'apiError.<domain>.<reason>' (i.e. 'apiError.' + code).

const codes = Object.keys(ERROR_CODES).sort();
const keyForCode = (code: string): string => `apiError.${code}`;

// Extract the sorted, comma-joined {token} set from a translation value (the S3 ph(v)
// idiom). Tokens are the i18n interpolation form /\{([A-Za-z0-9_]+)\}/.
const ph = (value: string): string =>
  [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

// APPEND-ONLY (AIP-193) literal snapshot of every known server-emitted code, sorted. This
// is a REAL literal list, never a re-export of ERROR_CODES compared to itself (a
// self-comparison would guard nothing). A NEW code fails dimension 5 until it is appended
// here AND given an apiError.* catalog entry; a removed or renamed code fails too. One
// line per code so appending a new one is a single-line edit.
const KNOWN_CODES = [
  'account.characters_online',
  'account.deactivated',
  'account.not_found',
  'account.password_too_long',
  'account.password_too_short',
  'account.username_invalid',
  'account.username_mismatch',
  'account.username_not_allowed',
  'account.username_taken',
  'auth.current_password_incorrect',
  'auth.forbidden',
  'auth.invalid_credentials',
  'auth.password_incorrect',
  'auth.required',
  'auth.token_invalid',
  'auth.token_missing',
  'auth.too_many_attempts',
  'auth.too_many_failed_attempts',
  'auth.verification_failed',
  'auth.web_login_only',
  'body.too_large',
  'body.unsupported_media_type',
  'character.already_in_world',
  'character.delete_confirm',
  'character.invalid_class',
  'character.limit_reached',
  'character.name_invalid',
  'character.name_not_allowed',
  'character.name_taken',
  'character.not_found',
  'character.online',
  'character.rename_not_permitted',
  'character.rename_required',
  'character.taken_over',
  'db.conflict',
  'discord.already_linked',
  'discord.expired',
  'discord.link_required',
  'discord.not_configured',
  'discord.password_required',
  'discord.swag_claimed',
  'discord.swag_points',
  'discord.swag_tier',
  'discord.unknown_swag',
  'email.invalid',
  'email.unchanged',
  'internal.error',
  'json.malformed',
  'moderation.banned',
  'moderation.force_rename',
  'moderation.suspended',
  'moderation.suspended_until',
  'origin.cross_site',
  'rate_limit.exceeded',
  'two_factor.already_enabled',
  'two_factor.code_invalid',
  'two_factor.not_enabled',
  'two_factor.setup_required',
  'validation.failed',
];

// The parametric contract pins: the matcher
// (Agent A) formats and passes these tokens client-side, so the catalog English value
// (Agent B) MUST carry exactly these tokens. Pinning the exact token catches an English
// reword that drops the token across ALL locales together, which the per-locale
// placeholder-equality check below (equality with English) cannot see.
const PARAMETRIC_TOKEN_PINS: [string, string][] = [
  ['moderation.suspended_until', 'date'],
  ['rate_limit.exceeded', 'seconds'],
];

// Agent A's declarative code-to-key table (src/ui/api_error_i18n.ts): the fixed
// cross-layer convention that code `domain.reason` maps to key `apiError.domain.reason`
// VERBATIM. Statically imported so tsc guards its presence and a renamed export or a
// missing/typo'd translation key is a compile error. Cast to a string-indexable view for
// the parity loops below (the source object is `satisfies Record<string, TranslationKey>`,
// which keeps its narrow literal type and so is not arbitrary-string indexable).
const codeToKeyTable = API_ERROR_KEYS as Record<string, string>;

beforeAll(async () => {
  // Make every supported locale resident once (the test-harness mirror of the bootstrap
  // await-before-paint), so locale-explicit reads resolve the overlay / English-fill
  // rather than blocking. Mirrors the S3 guard's beforeAll.
  await Promise.all(supportedLanguages.map((lang) => ensureLocaleLoaded(lang)));
});

describe('REST apiError.* code parity', () => {
  it('dimension 1: enumerates every code from the ERROR_CODES single source of truth', () => {
    // The single source of truth drives every downstream loop below; never a hand-copied
    // list. This tripwire catches a broken import and any code that is not domain.reason
    // shaped (which would not map to an apiError.<domain>.<reason> catalog key).
    expect(codes.length, 'ERROR_CODES yielded no codes (import broken)').toBeGreaterThanOrEqual(50);
    const shape = /^[a-z][a-z0-9]*(_[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
    const malformed = codes.filter((code) => !shape.test(code));
    expect(malformed, 'every enumerated code must be domain.reason shaped').toEqual([]);
  });

  it('dimension 2: every code resolves to a non-empty apiError.* entry in every locale', () => {
    // English-fill of a pending locale COUNTS as resolving (the designed PR-tier
    // behavior): a locale that has no override still reads the English-filled dense
    // table, so tOptional returns a non-empty string. The authoritative gap is a missing
    // English entry; report that once (per code), then check each locale is non-empty.
    const missingEnglish: string[] = [];
    const englishMissing = new Set<string>();
    setLanguage('en');
    for (const code of codes) {
      const value = tOptional(keyForCode(code));
      if (value === null || value.trim().length === 0) {
        englishMissing.add(code);
        missingEnglish.push(
          `missing ${keyForCode(code)} English entry in src/ui/i18n.catalog/api_error.ts ` +
            '(add one entry per server-emitted code)',
        );
      }
    }
    const emptyInLocale: string[] = [];
    for (const lang of supportedLanguages) {
      if (lang === 'en') continue;
      setLanguage(lang);
      for (const code of codes) {
        if (englishMissing.has(code)) continue;
        const value = tOptional(keyForCode(code));
        if (value === null || value.trim().length === 0) {
          emptyInLocale.push(`${lang}: ${keyForCode(code)} resolved empty`);
        }
      }
    }
    setLanguage('en');
    expect(missingEnglish, 'server-emitted codes with no English apiError.* catalog entry').toEqual(
      [],
    );
    expect(emptyInLocale, 'apiError.* keys that resolve empty in a specific non-en locale').toEqual(
      [],
    );
  });

  it('dimension 3: the code-to-key table is the exact identity apiError.<code>', () => {
    const table = codeToKeyTable;
    const tableCodes = Object.keys(table);
    // (a) every ERROR_CODES key has a table row.
    const missingRows = codes.filter((code) => !(code in table));
    expect(
      missingRows,
      'ERROR_CODES keys with no row in API_ERROR_KEYS (src/ui/api_error_i18n.ts)',
    ).toEqual([]);
    // (b) no phantom rows (every table code exists in ERROR_CODES).
    const phantomRows = tableCodes.filter((code) => !(code in ERROR_CODES));
    expect(
      phantomRows,
      'API_ERROR_KEYS rows whose code is not in ERROR_CODES (phantom codes)',
    ).toEqual([]);
    // (c) each value is exactly 'apiError.' + code (the identity convention cannot drift).
    const drifted = tableCodes
      .filter((code) => code in ERROR_CODES)
      .filter((code) => table[code] !== keyForCode(code))
      .map((code) => `${code} -> ${String(table[code])} (expected ${keyForCode(code)})`);
    expect(
      drifted,
      'API_ERROR_KEYS values must be exactly apiError.<code> (the identity convention)',
    ).toEqual([]);
  });

  it('dimension 4: parametric entries keep their placeholder set in every locale', () => {
    // Primary: per-locale placeholder-set equality with English. Derived from English, so
    // it needs no hardcoded token names and catches a locale that drops or adds a token.
    setLanguage('en');
    const enPh: Record<string, string> = {};
    for (const code of codes) {
      const value = tOptional(keyForCode(code));
      if (value !== null) enPh[code] = ph(value);
    }
    const drift: string[] = [];
    for (const lang of supportedLanguages) {
      if (lang === 'en') continue;
      setLanguage(lang);
      for (const code of codes) {
        if (!(code in enPh)) continue;
        const value = tOptional(keyForCode(code));
        if (value === null) continue; // dimension 2 already reports a missing entry
        const got = ph(value);
        if (got !== enPh[code]) {
          drift.push(`${lang}: ${keyForCode(code)} placeholders {${got}} != en {${enPh[code]}}`);
        }
      }
    }
    setLanguage('en');
    expect(drift, 'apiError.* placeholder tokens diverge from English in some locale').toEqual([]);

    // Secondary: pin the exact contract token for the two parametric entries the matcher
    // fills, so an English reword that drops the token (across all locales together, which
    // the equality check would still pass) is caught here.
    const pinLeaks: string[] = [];
    for (const [code, token] of PARAMETRIC_TOKEN_PINS) {
      if (!(code in ERROR_CODES)) {
        pinLeaks.push(`${code} is no longer in ERROR_CODES (parametric contract pin is stale)`);
        continue;
      }
      const value = tOptional(keyForCode(code));
      if (value === null || value.trim().length === 0) {
        pinLeaks.push(`${keyForCode(code)} has no English entry (expected token {${token}})`);
        continue;
      }
      if (ph(value) !== token) {
        pinLeaks.push(
          `${keyForCode(code)} English tokens {${ph(value)}} but the matcher contract fills {${token}}`,
        );
      }
    }
    setLanguage('en');
    expect(
      pinLeaks,
      'parametric apiError.* entries must carry exactly the matcher-contract token',
    ).toEqual([]);
  });

  it('dimension 5: the ERROR_CODES set matches the append-only literal snapshot', () => {
    const actual = Object.keys(ERROR_CODES).sort();
    const known = [...KNOWN_CODES].sort();
    const added = actual.filter((code) => !known.includes(code));
    const removed = known.filter((code) => !actual.includes(code));
    expect(
      added,
      'NEW server code(s): append each to KNOWN_CODES here AND add its apiError.* catalog entry',
    ).toEqual([]);
    expect(
      removed,
      'AIP-193 violation: a code was removed or renamed (codes are permanent, append-only)',
    ).toEqual([]);
    expect(actual, 'ERROR_CODES must equal the append-only literal snapshot').toEqual(known);
  });

  it('dimension 6: the catalog carries exactly the code set, with only the contract tokens', () => {
    // Flatten the nested English catalog domain to its 'domain.reason' leaf set. Depth
    // is exactly two for apiError.* (domain -> reason -> string); fail loud otherwise.
    const leaves: Record<string, string> = {};
    for (const [domain, reasons] of Object.entries(apiErrorStrings as Record<string, unknown>)) {
      expect(
        reasons !== null && typeof reasons === 'object',
        `apiError.${domain} must be a nested domain object`,
      ).toBe(true);
      for (const [reason, value] of Object.entries(reasons as Record<string, unknown>)) {
        expect(typeof value, `apiError.${domain}.${reason} must be a string leaf`).toBe('string');
        leaves[`${domain}.${reason}`] = value as string;
      }
    }
    // (a) Set equality with ERROR_CODES seals the direction nothing above covers:
    // dimension 2 catches a code with no catalog entry, but a PHANTOM apiError.* leaf
    // with no server code would pass every other dimension (shipping dead prose and,
    // when wordy, demanding five non-Latin fills for nothing).
    const leafCodes = Object.keys(leaves).sort();
    const phantom = leafCodes.filter((code) => !(code in ERROR_CODES));
    expect(
      phantom,
      'apiError.* catalog leaves with no ERROR_CODES entry (phantom catalog prose)',
    ).toEqual([]);
    expect(leafCodes, 'the apiError.* catalog leaf set must equal ERROR_CODES').toEqual(codes);
    // (b) The matcher fills ONLY the PARAMETRIC_TOKEN_PINS tokens; resolveByCode calls
    // a bare t(key) for every other code, so any other {token} in an apiError English
    // value would render literally to the player. Dimension 4 propagates this rule to
    // every locale via its placeholder-set equality with English.
    const contract = new Map(PARAMETRIC_TOKEN_PINS);
    const leaks = Object.entries(leaves)
      .filter(([code, value]) => ph(value) !== (contract.get(code) ?? ''))
      .map(([code, value]) => `${keyForCode(code)} carries {${ph(value)}} the matcher never fills`);
    expect(
      leaks,
      'apiError.* values may carry only the matcher-contract placeholder tokens',
    ).toEqual([]);
  });
});
