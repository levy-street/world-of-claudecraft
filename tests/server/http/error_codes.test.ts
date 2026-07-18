import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ErrorCode } from '../../../server/http/error_codes';

// APPEND-ONLY (AIP-193): add new codes to this list; NEVER remove or rename an
// existing one. This sorted set is the contract every migrated surface and the
// client code-matcher depend on; the snapshot assertion below fails on any drift.
const EXPECTED_CODES = [
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
  'wallet.handoff_invalid',
  'deeds.invalid_input',
  'steam.disabled',
  'steam.invalid_ticket',
  'steam.banned',
  'steam.already_linked',
  'steam.account_taken',
  'steam.upstream',
  'welcome.invalid_input',
];

describe('ERROR_CODES catalog', () => {
  it('matches the append-only snapshot of every code', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([...EXPECTED_CODES].sort());
  });

  it('has no duplicate codes', () => {
    const keys = Object.keys(ERROR_CODES);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries the 9 structural codes with their exact param keys', () => {
    expect(ERROR_CODES['validation.failed'].params).toEqual(['issues']);
    expect(ERROR_CODES['json.malformed'].params).toEqual([]);
    expect(ERROR_CODES['auth.token_missing'].params).toEqual([]);
    expect(ERROR_CODES['auth.token_invalid'].params).toEqual([]);
    expect(ERROR_CODES['auth.forbidden'].params).toEqual([]);
    expect(ERROR_CODES['body.too_large'].params).toEqual(['maxBytes']);
    expect(ERROR_CODES['db.conflict'].params).toEqual([]);
    expect(ERROR_CODES['rate_limit.exceeded'].params).toEqual(['retryAfterSeconds']);
    expect(ERROR_CODES['internal.error'].params).toEqual([]);
  });

  it('seeds the one parametric harvested code with its date param', () => {
    expect(ERROR_CODES['moderation.suspended_until'].params).toEqual(['date']);
  });

  it('gives every code a params array of non-empty strings', () => {
    for (const [code, value] of Object.entries(ERROR_CODES)) {
      expect(Array.isArray(value.params), code).toBe(true);
      for (const param of value.params) {
        expect(typeof param, code).toBe('string');
        expect(param.length, code).toBeGreaterThan(0);
      }
    }
  });

  it('uses the domain.reason shape for every code', () => {
    const shape = /^[a-z][a-z0-9]*(_[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
    for (const code of Object.keys(ERROR_CODES)) {
      expect(shape.test(code), code).toBe(true);
    }
  });

  it('is deeply frozen at runtime', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    for (const value of Object.values(ERROR_CODES)) {
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.params)).toBe(true);
    }
    expect(Object.isFrozen(ERROR_CODES['internal.error'])).toBe(true);
  });

  it('throws on any mutation attempt in strict mode', () => {
    expect(() => {
      (ERROR_CODES as Record<string, unknown>).injected = 1;
    }).toThrow();
    expect(() => {
      (ERROR_CODES['validation.failed'].params as unknown as string[]).push('x');
    }).toThrow();
  });

  it('exposes ErrorCode as the keyof union (compile-time)', () => {
    const sample: ErrorCode = 'internal.error';
    expect(Object.keys(ERROR_CODES)).toContain(sample);
  });
});
