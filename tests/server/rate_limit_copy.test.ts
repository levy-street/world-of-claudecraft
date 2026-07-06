// Em-dash copy guard for the rate-limit strings.
//
// The account-portal migration swapped the U+2014 em dash for a comma in the login/register
// throttle 429 strings (server/main.ts legacy arms + server/auth_routes.ts migrated arms) and
// the admin operator copy (src/admin/i18n.locales/en_CA.ts), and retired the
// authRateLimitDashToComma known deviation. The swap MUST stay matcher-safe: the
// client prose-matcher (userFacingApiError, extracted to src/ui/api_error_i18n.ts)
// keys on the "too many attempts" / "too many failed attempts" PREFIX,
// which sits BEFORE the punctuation, so the localized message is unchanged. This gate
// reads the SOURCE files (server/main.ts builds a pg pool, so it is never imported;
// the matcher's runtime behavior is covered by tests/main_api_error.test.ts) and pins:
//  - the four target files carry no U+2014 (the acceptance grep, locked as a test);
//  - the two 429 strings are the comma form and START WITH their matcher prefix;
//  - the userFacingApiError matcher still keys on those prefixes via startsWith.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Repo root, resolved from this file (never the cwd: a shared worktree can run the
// suite from elsewhere). `../../` climbs server -> tests -> root.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');

// The em dash (U+2014) as a codepoint, so this source file itself stays em-dash-free.
const EM_DASH = String.fromCharCode(0x2014);

// The two matcher prefixes userFacingApiError keys on (before the punctuation).
const ATTEMPTS_PREFIX = 'too many attempts';
const FAILED_PREFIX = 'too many failed attempts';
// The exact comma-form strings after the dash-to-comma swap.
const ATTEMPTS_COMMA = 'too many attempts, wait a minute and try again';
const FAILED_COMMA = 'too many failed attempts, wait a few minutes and try again';

const TARGET_FILES = [
  'server/main.ts',
  'src/main.ts',
  'src/admin/i18n.locales/en_CA.ts',
  'src/admin/i18n.resolved.generated/en_CA.ts',
];

describe('rate-limit copy: no em dash', () => {
  it('none of the four touched files contains a U+2014 em dash', () => {
    for (const rel of TARGET_FILES) {
      expect(read(rel).includes(EM_DASH), `${rel} still contains an em dash`).toBe(false);
    }
  });

  it('the server rate-limit 429 strings are the comma form (legacy + migrated arms)', () => {
    const main = read('server/main.ts');
    const auth = read('server/auth_routes.ts');
    // Both the legacy handleApi arms (main.ts) and the migrated arms (auth_routes.ts)
    // now read identically, so the parity between them is byte-exact.
    expect(main).toContain(ATTEMPTS_COMMA);
    expect(main).toContain(FAILED_COMMA);
    expect(auth).toContain(ATTEMPTS_COMMA);
    expect(auth).toContain(FAILED_COMMA);
  });

  it('the admin en_CA tooManyAttempts copy is the comma form', () => {
    expect(read('src/admin/i18n.locales/en_CA.ts')).toContain(
      `'error.tooManyAttempts': '${ATTEMPTS_COMMA}'`,
    );
  });
});

describe('rate-limit copy: matcher-safe (prefix before the comma)', () => {
  it('each comma-form string STARTS WITH its matcher prefix', () => {
    // The dash-to-comma swap only touches the punctuation AFTER the prefix, so the
    // userFacingApiError startsWith() checks still match.
    expect(ATTEMPTS_COMMA.startsWith(ATTEMPTS_PREFIX)).toBe(true);
    expect(FAILED_COMMA.startsWith(FAILED_PREFIX)).toBe(true);
    // The character right after the prefix is a comma, never an em dash.
    expect(ATTEMPTS_COMMA.charAt(ATTEMPTS_PREFIX.length)).toBe(',');
    expect(FAILED_COMMA.charAt(FAILED_PREFIX.length)).toBe(',');
  });

  it('userFacingApiError still keys on the two prefixes via startsWith', () => {
    const client = read('src/ui/api_error_i18n.ts');
    expect(client).toContain(`normalized.startsWith('${ATTEMPTS_PREFIX}')`);
    expect(client).toContain(`normalized.startsWith('${FAILED_PREFIX}')`);
  });

  it("userFacingApiError keeps the exact-match arm for the discord 'rate limited' 429", () => {
    // The Discord-family migration closed the discordRateLimited gap with one exact-match
    // arm reusing the existing errors.api.tooManyAttempts key. The api_error_i18n.ts
    // extraction made the matcher unit-testable (tests/main_api_error.test.ts); this text
    // pin stays as the cheap source-level guard against a silent removal of the arm.
    const client = read('src/ui/api_error_i18n.ts');
    expect(client).toContain("normalized === 'rate limited'");
  });
});
