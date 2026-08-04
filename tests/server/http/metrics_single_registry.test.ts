// The production registration shape (server/main.ts startServer): the HTTP
// exporter, the game-state family, and the business family all register onto
// the ONE prom-client Registry, one process per realm (single-exporter
// registration, phase 15 of the professions packet). startServer never runs
// under Vitest, so before this file a duplicate metric name across families
// (or a registrar run twice against the shared registry) would throw at BOOT
// with no test catching it. This performs the same registrations against one
// registry and scrapes it once. Default process metrics stay off to keep the
// test hermetic; their nodejs_*/process_* namespace cannot collide with the
// woc_*/http_* names asserted here.
import { describe, expect, it } from 'vitest';
import {
  registerBusinessMetrics,
  WOC_PLAYER_ACCOUNTS_CREATED,
} from '../../../server/http/business_metrics';
import {
  type GameStateSource,
  registerGameStateMetrics,
  WOC_GATHER_HARVESTS_TOTAL,
  WOC_ROD_FEE_COPPER,
} from '../../../server/http/game_metrics';
import { createHttpMetrics, HTTP_REQUESTS_TOTAL } from '../../../server/http/metrics';

function stubSource(): GameStateSource {
  return {
    playersOnline: () => 0,
    accountsOnline: () => 0,
    wsConnections: () => 0,
    simEntities: () => 0,
    simTickHz: () => 20,
    tickPhaseMillis: () => ({}),
    dbPool: () => ({ total: 0, idle: 0, waiting: 0 }),
    lastTickAt: () => 1_700_000_000_000,
    loopStartedAt: () => 1_700_000_000_000,
  };
}

describe('single-registry production shape', () => {
  it('registers the exporter, game-state, and business families together without collision', async () => {
    const httpMetrics = createHttpMetrics({ defaultMetrics: false });
    // Registration alone is what can throw on a duplicate name; the business
    // queries are never refreshed here, so they must never be called.
    registerGameStateMetrics(httpMetrics.registry, stubSource());
    const collector = registerBusinessMetrics(httpMetrics.registry, {
      business: async () => {
        throw new Error('never refreshed in this test');
      },
      funnel: async () => {
        throw new Error('never refreshed in this test');
      },
    });
    try {
      const text = await httpMetrics.registry.metrics();
      // One representative per family proves all three landed on the ONE
      // registry (HELP lines render even before a gauge holds a sample).
      expect(text).toContain(`# HELP ${HTTP_REQUESTS_TOTAL} `);
      expect(text).toContain(`# HELP ${WOC_GATHER_HARVESTS_TOTAL} `);
      expect(text).toContain(`# HELP ${WOC_ROD_FEE_COPPER} `);
      expect(text).toContain(`# HELP ${WOC_PLAYER_ACCOUNTS_CREATED} `);
    } finally {
      await collector.stop();
    }
  });

  it('a registrar run twice against the shared registry throws instead of silently double-counting', () => {
    const httpMetrics = createHttpMetrics({ defaultMetrics: false });
    registerGameStateMetrics(httpMetrics.registry, stubSource());
    expect(() => registerGameStateMetrics(httpMetrics.registry, stubSource())).toThrow(
      /already been registered/,
    );
  });
});
