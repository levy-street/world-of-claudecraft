import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ErrorCode } from '../../../server/http/error_codes';

// APPEND-ONLY (AIP-193): add new codes to this list; NEVER remove or rename an
// existing one. This sorted set is the contract every migrated surface and the
// client code-matcher depend on; the snapshot assertion below fails on any drift.
const EXPECTED_CODES = [
  'account.characters_online',
  'account.deactivated',
  'account.not_found',
  'account.password_already_set',
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
  'character.delete_busy',
  'character.delete_confirm',
  'character.storage_purchase_open',
  'character.invalid_class',
  'character.limit_reached',
  'character.name_invalid',
  'character.name_not_allowed',
  'character.name_taken',
  'character.not_found',
  'character.online',
  'character.rename_not_permitted',
  'character.rename_required',
  'character.invalid_appearance',
  'character.reroll_unavailable',
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
  'seeker.attestation_failed',
  'seeker.current_ownership_required',
  'seeker.entitlement_required',
  'seeker.genesis_token_claimed',
  'seeker.genesis_token_required',
  'seeker.native_only',
  'seeker.solana_artifact_required',
  'seeker.wallet_required',
  'two_factor.already_enabled',
  'two_factor.code_invalid',
  'two_factor.not_enabled',
  'two_factor.setup_required',
  'validation.failed',
  'wallet.handoff_invalid',
  'wallet.reauth_required',
  'wallet.reauth_two_factor',
  'wallet.reauth_no_password',
  'wallet.reauth_bad_signature',
  'wallet.reauth_bad_password',
  'wallet.reauth_bad_two_factor',
  'woc_market.invalid_input',
  'woc_market.disabled',
  'woc_market.paused',
  'woc_market.wallet_required',
  'woc_market.recipient_wallet_required',
  'woc_market.self_offer',
  'woc_market.offer_expired',
  'woc_market.terms_required',
  'woc_market.totp_required',
  'woc_market.totp_invalid',
  'woc_market.suspended',
  'woc_market.character_invalid',
  'woc_market.not_found',
  'woc_market.not_yours',
  'woc_market.not_active',
  'woc_market.own_listing',
  'woc_market.has_bids',
  'woc_market.bid_too_low',
  'woc_market.already_pending',
  'woc_market.insufficient_balance',
  'woc_market.quote_unavailable',
  'woc_market.quote_expired',
  'woc_market.not_pending',
  'woc_market.claim_cooldown',
  'woc_market.bond_window_closed',
  'woc_market.confirm_failed',
  'woc_market.confirm_in_flight',
  'woc_market.buy_now_locked',
  'woc_market.cancel_pending',
  'woc_market.settlement_in_flight',
  'woc_market.contended',
  'woc_market.sale_conflict',
  'woc_market.no_buy_now',
  'woc_market.cap_reached',
  'woc_market.stale_item',
  'woc_market.not_eligible',
  'woc_market.invalid_params',
  'woc_market.signature_reused',
  'woc_market.item_mismatch',
  'woc_market.offer_pending',
  'woc_market.item_locked',
  'woc_market.stepup_required',
  'woc_market.stepup_challenge_invalid',
  'woc_market.stepup_challenge_expired',
  'woc_market.stepup_wallet_mismatch',
  'woc_market.stepup_binding_mismatch',
  'woc_market.stepup_signature_invalid',
  'deeds.invalid_input',
  'guilds.invalid_roster_name',
  'guilds.unknown',
  'steam.disabled',
  'steam.invalid_ticket',
  'steam.banned',
  'steam.already_linked',
  'steam.account_taken',
  'steam.upstream',
  'epic.disabled',
  'epic.invalid_token',
  'epic.banned',
  'epic.already_linked',
  'epic.account_taken',
  'epic.upstream',
  'ota_updates.invalid_input',
  'cheater_mark.admin_target',
  'cheater_mark.reason_required',
  'cheater_mark.invalid_duration',
  'cheater_mark.not_marked',
];

describe('ERROR_CODES catalog', () => {
  it('matches the append-only snapshot of every code', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([...EXPECTED_CODES].sort());
  });

  it('has no duplicate codes', () => {
    // Over the SOURCE TEXT, not Object.keys: a duplicated literal key (the
    // union-merge hazard this guard exists for) has already collapsed by the
    // time the object is constructed, so a runtime key-set comparison can
    // never fail. tsc flags the duplicate too; this keeps the guard local
    // and named.
    const source = readFileSync(
      fileURLToPath(new URL('../../../server/http/error_codes.ts', import.meta.url)),
      'utf8',
    );
    const start = source.indexOf('export const ERROR_CODES');
    const literal = source.slice(start, source.indexOf('as const', start));
    const keys = [...literal.matchAll(/^\s{2}'([a-z0-9_.]+)': \{/gm)].map((m) => m[1]);
    expect(keys.length).toBe(Object.keys(ERROR_CODES).length);
    const seen = new Set<string>();
    const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(dupes).toEqual([]);
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

  it('declares the buy-now cooldown remaining time (the client renders it as a duration)', () => {
    expect(ERROR_CODES['woc_market.claim_cooldown'].params).toEqual(['retryAfterSeconds']);
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
