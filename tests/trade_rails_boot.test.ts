import { describe, expect, it } from 'vitest';
import { readTradeRailsConfig } from '../server/trade_rails_boot';

describe('readTradeRailsConfig', () => {
  it('both flags unset => both rails off (behavior-neutral)', () => {
    const cfg = readTradeRailsConfig({});
    expect(cfg.claudium).toBe(false);
    expect(cfg.woc).toBeNull();
  });

  it("explicit '0' keeps rails off", () => {
    const cfg = readTradeRailsConfig({ CLAUDIUM_TRADE_ENABLED: '0', WOC_TRADE_ENABLED: '0' });
    expect(cfg.claudium).toBe(false);
    expect(cfg.woc).toBeNull();
  });

  it('claudium enabled but service unconfigured THROWS naming both env vars', () => {
    expect(() => readTradeRailsConfig({ CLAUDIUM_TRADE_ENABLED: '1' })).toThrow(
      /WOC_ECONOMY_SERVICE_URL/,
    );
    expect(() => readTradeRailsConfig({ CLAUDIUM_TRADE_ENABLED: '1' })).toThrow(
      /WOC_ECONOMY_INTERNAL_SECRET/,
    );
    // half-configured (URL only) still throws
    expect(() =>
      readTradeRailsConfig({ CLAUDIUM_TRADE_ENABLED: '1', WOC_ECONOMY_SERVICE_URL: 'http://svc' }),
    ).toThrow(/WOC_ECONOMY_INTERNAL_SECRET/);
  });

  it('claudium enabled + service configured => enabled', () => {
    const cfg = readTradeRailsConfig({
      CLAUDIUM_TRADE_ENABLED: '1',
      WOC_ECONOMY_SERVICE_URL: 'http://127.0.0.1:8798/v1/claudium/',
      WOC_ECONOMY_INTERNAL_SECRET: 'local-dev-secret',
    });
    expect(cfg.claudium).toBe(true);
  });

  it('woc enabled => config with defaults', () => {
    const cfg = readTradeRailsConfig({ WOC_TRADE_ENABLED: '1' });
    expect(cfg.woc).not.toBeNull();
    expect(cfg.woc?.timeoutMs).toBe(180_000);
    expect(cfg.woc?.pollMs).toBe(5000);
    expect(cfg.woc?.minConfirm).toBe('finalized');
    expect(cfg.woc?.mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(cfg.woc?.rpcUrl).toContain('http');
  });

  it('woc timeout/poll overrides clamp to sane bounds', () => {
    const tiny = readTradeRailsConfig({
      WOC_TRADE_ENABLED: '1',
      WOC_TRADE_TIMEOUT_MS: '1',
      WOC_TRADE_POLL_MS: '1',
    });
    expect(tiny.woc?.timeoutMs).toBe(30_000);
    expect(tiny.woc?.pollMs).toBe(1000);
    const huge = readTradeRailsConfig({
      WOC_TRADE_ENABLED: '1',
      WOC_TRADE_TIMEOUT_MS: '99999999',
      WOC_TRADE_POLL_MS: '99999999',
    });
    expect(huge.woc?.timeoutMs).toBe(900_000);
    expect(huge.woc?.pollMs).toBe(60_000);
  });

  it('a valid override within bounds passes through', () => {
    const cfg = readTradeRailsConfig({
      WOC_TRADE_ENABLED: '1',
      WOC_TRADE_TIMEOUT_MS: '120000',
      WOC_TRADE_POLL_MS: '3000',
    });
    expect(cfg.woc?.timeoutMs).toBe(120_000);
    expect(cfg.woc?.pollMs).toBe(3000);
  });

  it('a bad flag value THROWS (catches typos loudly)', () => {
    expect(() => readTradeRailsConfig({ WOC_TRADE_ENABLED: 'true' })).toThrow(/WOC_TRADE_ENABLED/);
    expect(() => readTradeRailsConfig({ WOC_TRADE_ENABLED: '1 ' })).toThrow(/WOC_TRADE_ENABLED/);
    expect(() => readTradeRailsConfig({ CLAUDIUM_TRADE_ENABLED: 'yes' })).toThrow(
      /CLAUDIUM_TRADE_ENABLED/,
    );
  });
});
