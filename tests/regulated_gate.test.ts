// The shared regulated-feature gate (server/regulated_gate.ts): pure verdict by
// cluster, the mainnet counsel + enforcement requirement, the explicit
// SOLANA_CLUSTER override, the sanctions-vs-gambling blocklist split, the
// self-exclusion short-circuit, and the SDN + edge-country resolution.
import type * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blockedCountriesFor,
  counselSignoffRecorded,
  gamblingBlockedCountries,
  gateVerdict,
  isMainnetCluster,
  mainnetMoneyEnabled,
  requestCountry,
  resetSdnCacheForTests,
  resolveCluster,
  sanctionedCountries,
  screenMoneyRequest,
  sdnWallets,
} from '../server/regulated_gate';

const ENV_KEYS = [
  'SOLANA_CLUSTER',
  'SOLANA_RPC_URL',
  'MONEY_GEO_GATE_ENABLED',
  'MONEY_BLOCKED_COUNTRIES',
  'RIVERBOAT_BLOCKED_COUNTRIES',
  'OFAC_SDN_WALLETS',
  'RIVERBOAT_COUNSEL_SIGNOFF',
];
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  resetSdnCacheForTests();
});

const SDN_WALLET = 'Sanctioned1111111111111111111111111111111111';
const CLEAN_WALLET = 'Clean1111111111111111111111111111111111111';
const req = (country?: string): http.IncomingMessage =>
  ({ headers: country ? { 'cf-ipcountry': country } : {} }) as http.IncomingMessage;

describe('resolveCluster', () => {
  it('honors an explicit SOLANA_CLUSTER over the RPC hostname', () => {
    // The exact hazard the override fixes: a custom mainnet RPC without "mainnet"
    // in its host would scan as localnet, silently disabling the gate.
    expect(
      resolveCluster({ SOLANA_CLUSTER: 'mainnet-beta', SOLANA_RPC_URL: 'https://my-node.io' }),
    ).toBe('mainnet-beta');
    expect(
      isMainnetCluster({ SOLANA_CLUSTER: 'mainnet', SOLANA_RPC_URL: 'https://rpc.example' }),
    ).toBe(true);
  });
  it('falls back to the RPC hostname scan when SOLANA_CLUSTER is unset', () => {
    expect(resolveCluster({ SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' })).toBe(
      'mainnet-beta',
    );
    expect(resolveCluster({ SOLANA_RPC_URL: 'https://api.devnet.solana.com' })).toBe('devnet');
    expect(resolveCluster({})).toBe('localnet');
  });
});

describe('gateVerdict (pure, by cluster)', () => {
  const base = {
    enforcing: true,
    counselRecorded: true,
    selfExcluded: false,
    country: 'US',
    wallet: CLEAN_WALLET,
    blocked: new Set(['KP', 'IR']),
    sdn: new Set([SDN_WALLET]),
  };
  it('passes everything off mainnet (money is not real)', () => {
    expect(
      gateVerdict({ ...base, isMainnet: false, enforcing: false, counselRecorded: false }),
    ).toEqual({ ok: true });
  });
  it('blocks on mainnet when the gate is not enforcing or counsel is unrecorded', () => {
    expect(gateVerdict({ ...base, isMainnet: true, enforcing: false })).toEqual({
      ok: false,
      reason: 'gate_required',
    });
    expect(gateVerdict({ ...base, isMainnet: true, counselRecorded: false })).toEqual({
      ok: false,
      reason: 'gate_required',
    });
  });
  it('short-circuits a self-excluded player before geo/wallet screening', () => {
    expect(gateVerdict({ ...base, isMainnet: true, selfExcluded: true })).toEqual({
      ok: false,
      reason: 'self_excluded',
    });
  });
  it('fails closed on an unknown country, blocks a listed country', () => {
    expect(gateVerdict({ ...base, isMainnet: true, country: null }).ok).toBe(false);
    expect(gateVerdict({ ...base, isMainnet: true, country: 'KP' })).toEqual({
      ok: false,
      reason: 'geo_blocked',
    });
  });
  it('blocks a sanctioned payer wallet, passes a clean one', () => {
    expect(gateVerdict({ ...base, isMainnet: true, wallet: SDN_WALLET })).toEqual({
      ok: false,
      reason: 'sanctioned_wallet',
    });
    expect(gateVerdict({ ...base, isMainnet: true })).toEqual({ ok: true });
    // A null wallet (route does not know the payer) still passes geo screening.
    expect(gateVerdict({ ...base, isMainnet: true, wallet: null })).toEqual({ ok: true });
  });
});

describe('blocklists split (sanctions vs gambling)', () => {
  it('sanctions list defaults, gambling list is empty until set', () => {
    expect(sanctionedCountries({})).toContain('KP');
    expect(gamblingBlockedCountries({}).size).toBe(0);
  });
  it('a wager route unions the gambling list; a non-wager route does not', () => {
    const env = { MONEY_BLOCKED_COUNTRIES: 'KP', RIVERBOAT_BLOCKED_COUNTRIES: 'US,GB' };
    expect([...blockedCountriesFor(false, env)].sort()).toEqual(['KP']);
    expect([...blockedCountriesFor(true, env)].sort()).toEqual(['GB', 'KP', 'US']);
  });
});

describe('counselSignoffRecorded (per surface)', () => {
  it('is true only when the named var is non-empty', () => {
    expect(counselSignoffRecorded('RIVERBOAT_COUNSEL_SIGNOFF', {})).toBe(false);
    expect(
      counselSignoffRecorded('RIVERBOAT_COUNSEL_SIGNOFF', { RIVERBOAT_COUNSEL_SIGNOFF: '  ' }),
    ).toBe(false);
    expect(
      counselSignoffRecorded('RIVERBOAT_COUNSEL_SIGNOFF', {
        RIVERBOAT_COUNSEL_SIGNOFF: 'memo-2026-07',
      }),
    ).toBe(true);
    // A different surface's var does NOT satisfy this one.
    expect(
      counselSignoffRecorded('RIVERBOAT_COUNSEL_SIGNOFF', { LAUNCHPAD_COUNSEL_SIGNOFF: 'x' }),
    ).toBe(false);
  });
});

describe('sdnWallets + requestCountry', () => {
  it('parses the inline OFAC list and caches it', () => {
    process.env.OFAC_SDN_WALLETS = `${SDN_WALLET}, ${CLEAN_WALLET}`;
    const set = sdnWallets();
    expect(set.has(SDN_WALLET)).toBe(true);
    expect(set.has(CLEAN_WALLET)).toBe(true);
  });
  it('resolves the edge country and nulls placeholders', () => {
    expect(requestCountry(req('us'))).toBe('US');
    expect(requestCountry(req('XX'))).toBeNull();
    expect(requestCountry(req('T1'))).toBeNull();
    expect(requestCountry(req())).toBeNull();
  });
});

describe('screenMoneyRequest (HTTP applier)', () => {
  it('passes off mainnet regardless of missing counsel/geo', () => {
    process.env.SOLANA_CLUSTER = 'devnet';
    expect(
      screenMoneyRequest(req(), {
        counselEnvVar: 'RIVERBOAT_COUNSEL_SIGNOFF',
        isWagerRoute: true,
        wallet: null,
      }),
    ).toEqual({ ok: true });
  });
  it('blocks a gambling-restricted country on a wager route once enforcing', () => {
    process.env.SOLANA_CLUSTER = 'mainnet-beta';
    process.env.MONEY_GEO_GATE_ENABLED = '1';
    process.env.RIVERBOAT_COUNSEL_SIGNOFF = 'memo-1';
    process.env.RIVERBOAT_BLOCKED_COUNTRIES = 'US';
    const v = screenMoneyRequest(req('US'), {
      counselEnvVar: 'RIVERBOAT_COUNSEL_SIGNOFF',
      isWagerRoute: true,
      wallet: null,
    });
    expect(v).toEqual({ ok: false, reason: 'geo_blocked' });
    // The same country on a NON-wager money route is not gambling-blocked.
    expect(
      screenMoneyRequest(req('US'), {
        counselEnvVar: 'RIVERBOAT_COUNSEL_SIGNOFF',
        isWagerRoute: false,
        wallet: null,
      }).ok,
    ).toBe(true);
  });
});

describe('mainnetMoneyEnabled', () => {
  it('is false unless the feature flag, gate, and counsel all pass on mainnet', () => {
    const env = {
      SOLANA_CLUSTER: 'mainnet-beta',
      MONEY_GEO_GATE_ENABLED: '1',
      RIVERBOAT_COUNSEL_SIGNOFF: 'memo',
    };
    expect(mainnetMoneyEnabled(false, 'RIVERBOAT_COUNSEL_SIGNOFF', env)).toBe(false);
    expect(mainnetMoneyEnabled(true, 'RIVERBOAT_COUNSEL_SIGNOFF', env)).toBe(true);
    expect(
      mainnetMoneyEnabled(true, 'RIVERBOAT_COUNSEL_SIGNOFF', {
        ...env,
        MONEY_GEO_GATE_ENABLED: '0',
      }),
    ).toBe(false);
    // Devnet: the flag alone suffices (money is not real).
    expect(
      mainnetMoneyEnabled(true, 'RIVERBOAT_COUNSEL_SIGNOFF', { SOLANA_CLUSTER: 'devnet' }),
    ).toBe(true);
  });
});
