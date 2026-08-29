// The STORAGE_PRICES boot chain, EXECUTED (QA 09). tunables.test.ts pins the
// wiring by comment-stripped source scrape (parser fed by env, builder
// carrying the constant, game.ts consuming the builder); scrapes are gameable,
// so these arms run the chain for real: the env var is stubbed BEFORE a
// dynamic import re-runs the module-scope parse, and the assertions ride the
// exported constant, the boot console lines, and the built SimConfig. Each
// arm resets the module registry (ESM hoisting makes static imports unusable
// for this) and the afterEach restores env, registry, and console so no other
// arm inherits the stub. The parser/resolver agreement battery at the end
// pins the dual-validation contract: a boot-ACCEPTED dimension can never
// quietly fall back in-sim, and a boot-REJECTED one can never apply.
import { afterEach, describe, expect, it, vi } from 'vitest';

const SOCKET_DEFAULTS = [1000000, 2000000, 3500000, 5000000];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

const muted = () => ({
  err: vi.spyOn(console, 'error').mockImplementation(() => {}),
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
});

describe('the STORAGE_PRICES boot chain, executed end to end', () => {
  it('a set env var reaches the exported constant, with the applied and rejection lines', async () => {
    vi.resetModules();
    vi.stubEnv('STORAGE_PRICES', '{"bankSockets":[111111,2000000,3500000,5000000],"junkKey":1}');
    const { err, log } = muted();
    const { STORAGE_PRICES } = await import('../../server/storage_prices');
    // 111111 is in no price table: a wiring drop (constant no longer fed by
    // the parse) cannot reproduce it by coincidence.
    expect(STORAGE_PRICES).toStrictEqual({ bankSockets: [111111, 2000000, 3500000, 5000000] });
    expect(err.mock.calls.map((c) => c[0])).toStrictEqual([
      'STORAGE_PRICES: unknown key "junkKey"; the compiled default prices apply for it.',
    ]);
    expect(log.mock.calls.map((c) => c[0])).toContain(
      'storage prices: STORAGE_PRICES overrides bankSockets',
    );
  });

  it('a blank env var boots SILENTLY, the unset path (both land on the trimmed-empty branch)', async () => {
    vi.resetModules();
    vi.stubEnv('STORAGE_PRICES', '');
    const { err, log } = muted();
    const { STORAGE_PRICES } = await import('../../server/storage_prices');
    expect(STORAGE_PRICES).toBeUndefined();
    expect(err).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('a rejected env var leaves the constant undefined AND says why on the console', async () => {
    vi.resetModules();
    vi.stubEnv('STORAGE_PRICES', 'not json');
    const { err } = muted();
    const { STORAGE_PRICES } = await import('../../server/storage_prices');
    expect(STORAGE_PRICES).toBeUndefined();
    expect(err.mock.calls.map((c) => c[0])).toStrictEqual([
      'STORAGE_PRICES: the value is not valid JSON; the compiled default prices apply for it.',
    ]);
  });

  it('a capped flood prints 8 suffixed lines plus ONE bare summary line', async () => {
    vi.resetModules();
    const junk = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`junk${i}`, 1]));
    vi.stubEnv('STORAGE_PRICES', JSON.stringify(junk));
    const { err } = muted();
    await import('../../server/storage_prices');
    const lines = err.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(9);
    for (const line of lines.slice(0, 8)) {
      expect(line.endsWith('; the compiled default prices apply for it.')).toBe(true);
    }
    // The summary counts lines rather than refusing a value, so the
    // per-rejection defaults suffix must not dangle on it.
    expect(lines[8]).toBe('STORAGE_PRICES: ...and 4 more rejections');
  });

  it('buildRealmSimConfig binds the SAME parsed override object into SimConfig', async () => {
    vi.resetModules();
    vi.stubEnv('STORAGE_PRICES', '{"vaultUpgrades":[333,50000,100000,200000,400000]}');
    muted();
    const { buildRealmSimConfig } = await import('../../server/sim_boot_config');
    const mod = await import('../../server/storage_prices');
    // The admission parameter is REQUIRED on this seam (a realm boot that
    // dropped the journal wiring must not compile); this test has no journal,
    // so it says so with the exported inert constant.
    const { inertVaultConsumptionAdmission } = await import('../../src/sim/sim_context');
    const cfg = buildRealmSimConfig(undefined, inertVaultConsumptionAdmission);
    expect(cfg.storagePrices).toStrictEqual({
      vaultUpgrades: [333, 50000, 100000, 200000, 400000],
    });
    // Reference identity closes the chain: the builder hands the Sim the very
    // object the boot parse minted (the behavioral half of the tunables
    // scrape pins; builder-to-Sim is pinned by idle_mob_tick_radius.test.ts
    // and the live-Sim charge arms in tests/storage_prices.test.ts).
    expect(cfg.storagePrices).toBe(mod.STORAGE_PRICES);
  });
});

describe('parser/resolver dual-validation agreement (QA 09)', () => {
  it('every JSON-representable candidate is accepted by both arms or neither', async () => {
    vi.resetModules();
    vi.stubEnv('STORAGE_PRICES', '');
    const { parseStoragePrices } = await import('../../server/storage_prices');
    const { resolveStoragePrices } = await import('../../src/sim/storage_prices');
    // bankSockets candidates (compiled length 4). NaN/Infinity cannot ride
    // JSON, so they are out of scope here; the resolver-only suite covers
    // them for hosts that hand non-JSON values.
    const candidates: unknown[] = [
      [0, 0, 0, 0],
      [1, 2, 3, 4],
      [111111, 2000000, 3500000, 5000000],
      [1000000, 2000000, 3500000, 5000000], // the compiled default restated
      [9007199254740991, 2, 3, 4],
      [9007199254740992, 2, 3, 4], // past MAX_SAFE_INTEGER: both reject
      [-1, 2, 3, 4],
      [1.5, 2, 3, 4],
      ['5', 2, 3, 4],
      [1, 2, 3],
      [1, 2, 3, 4, 5],
      null,
      7,
      'cheap',
      {},
    ];
    for (const candidate of candidates) {
      const raw = JSON.stringify({ bankSockets: candidate });
      const parsed = parseStoragePrices(raw);
      const resolved = resolveStoragePrices(JSON.parse(raw));
      if (parsed.override !== undefined) {
        // Boot-accepted: the sim applies it VERBATIM (never a quiet fallback).
        expect(resolved.bankSockets, raw).toEqual(candidate);
        expect(parsed.override.bankSockets, raw).toEqual(candidate);
      } else {
        // Boot-rejected: the sim stays on the compiled default (fresh literal).
        expect(resolved.bankSockets, raw).toEqual(SOCKET_DEFAULTS);
      }
    }
  });
});
