// Unit tests for the game-state half of the /metrics exporter
// (server/http/game_metrics.ts): the woc_* gauges read live from an injected
// GameStateSource at scrape time, and the three throughput counters pushed through
// the returned sink. These pin the exposed metric NAMES as literals (a rename fails
// the test, not just a constant swap), prove the gauges reflect the source at scrape
// time, that the per-phase timing converts milliseconds to seconds and is bounded to
// the fixed WOC_TICK_PHASES x {p95,max} label set (an unknown phase never becomes a
// series), that the ws direction label is bounded to in/out, and that NO per-player
// label (account/session/character/player/ip) ever appears.

import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { COPPER_FLOW_SOURCES, HARVEST_BANDS, NODE_TIERS } from '../../../server/economy_telemetry';
import {
  FISHING_BANDS,
  ROD_FEE_RECIPE_IDS,
  rodFeeForRecipe,
} from '../../../server/fishing_telemetry';
import {
  type GameStateSource,
  registerGameStateMetrics,
  type TickPhaseMillis,
  WOC_ACCOUNTS_ONLINE,
  WOC_CHARACTERS_CREATED_TOTAL,
  WOC_CHAT_MESSAGES_TOTAL,
  WOC_COPPER_CREDITED_TOTAL,
  WOC_COPPER_SPENT_TOTAL,
  WOC_DB_POOL_CLIENTS,
  WOC_FISHING_CASTS_TOTAL,
  WOC_FISHING_CATCHES_TOTAL,
  WOC_FISHING_EMPTY_HOOKS_TOTAL,
  WOC_FISHING_GOT_AWAYS_TOTAL,
  WOC_FISHING_KOI_TOTAL,
  WOC_GATHER_HARVESTS_TOTAL,
  WOC_INPUT_FRAMES_MISSED_TOTAL,
  WOC_PLAYERS_ONLINE,
  WOC_ROD_FEE_COPPER,
  WOC_ROD_FEE_PAYMENTS_TOTAL,
  WOC_SIM_ENTITIES,
  WOC_SIM_TICK_HZ,
  WOC_SIM_TICK_PHASE_SECONDS,
  WOC_TICK_PHASES,
  WOC_WS_CONNECTIONS,
  WOC_WS_MESSAGES_DROPPED_TOTAL,
  WOC_WS_MESSAGES_TOTAL,
  WOC_WS_RATE_KICKS_TOTAL,
} from '../../../server/http/game_metrics';
import { WS_DROP_CAUSES } from '../../../server/http/game_signals';

/** A GameStateSource returning fixed values; override any field per test. */
function stubSource(overrides: Partial<GameStateSource> = {}): GameStateSource {
  return {
    playersOnline: () => 3,
    accountsOnline: () => 2,
    wsConnections: () => 5,
    simEntities: () => 42,
    simTickHz: () => 20,
    tickPhaseMillis: () => ({}),
    dbPool: () => ({ total: 7, idle: 4, waiting: 1 }),
    lastTickAt: () => 1_700_000_000_000,
    loopStartedAt: () => 1_700_000_000_000,
    ...overrides,
  };
}

/** Capture the numeric value on the first line matching `re` (one capture group). */
function sampleValue(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1];
}

/** Every woc_sim_tick_phase_seconds sample line (one per label combo). */
function tickPhaseSeries(text: string): string[] {
  return text.match(/^woc_sim_tick_phase_seconds\{[^}]*\} \d+(?:\.\d+)?$/gm) ?? [];
}

/** Every woc_gather_harvests_total sample line (one per zone x tier combo). */
function harvestSeries(text: string): string[] {
  return text.match(/^woc_gather_harvests_total\{[^}]*\} \d+$/gm) ?? [];
}

/** The set of distinct values of a given label across the whole exposition text. */
function labelValues(text: string, label: string): Set<string> {
  const values = new Set<string>();
  const re = new RegExp(`${label}="([^"]*)"`, 'g');
  for (const m of text.matchAll(re)) values.add(m[1]);
  return values;
}

describe('registerGameStateMetrics: gauges read the source at scrape time', () => {
  it('exposes every gauge under its exact exported name and value', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Literal name pins: a rename of any gauge must fail this test.
    expect(WOC_PLAYERS_ONLINE).toBe('woc_players_online');
    expect(WOC_ACCOUNTS_ONLINE).toBe('woc_accounts_online');
    expect(WOC_WS_CONNECTIONS).toBe('woc_ws_connections');
    expect(WOC_SIM_ENTITIES).toBe('woc_sim_entities');
    expect(WOC_SIM_TICK_HZ).toBe('woc_sim_tick_hz');

    for (const name of [
      WOC_PLAYERS_ONLINE,
      WOC_ACCOUNTS_ONLINE,
      WOC_WS_CONNECTIONS,
      WOC_SIM_ENTITIES,
      WOC_SIM_TICK_HZ,
    ]) {
      expect(text).toContain(`# TYPE ${name} gauge`);
    }

    expect(sampleValue(text, /^woc_players_online (\d+)$/m)).toBe('3');
    expect(sampleValue(text, /^woc_accounts_online (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_ws_connections (\d+)$/m)).toBe('5');
    expect(sampleValue(text, /^woc_sim_entities (\d+)$/m)).toBe('42');
    expect(sampleValue(text, /^woc_sim_tick_hz (\d+)$/m)).toBe('20');
  });

  it('exports pg pool saturation by state from the source snapshot', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();
    expect(WOC_DB_POOL_CLIENTS).toBe('woc_db_pool_clients');
    expect(text).toContain(`# TYPE ${WOC_DB_POOL_CLIENTS} gauge`);
    // The stub returns total 7, idle 4, waiting 1: each state must surface as
    // its own labeled sample (waiting is the saturation alarm line).
    expect(sampleValue(text, /^woc_db_pool_clients\{state="total"\} (\d+)$/m)).toBe('7');
    expect(sampleValue(text, /^woc_db_pool_clients\{state="idle"\} (\d+)$/m)).toBe('4');
    expect(sampleValue(text, /^woc_db_pool_clients\{state="waiting"\} (\d+)$/m)).toBe('1');
  });

  it('reflects a fresh source read on every scrape (no drift)', async () => {
    const registry = new Registry();
    let players = 1;
    registerGameStateMetrics(registry, stubSource({ playersOnline: () => players }));

    expect(sampleValue(await registry.metrics(), /^woc_players_online (\d+)$/m)).toBe('1');
    players = 9;
    expect(sampleValue(await registry.metrics(), /^woc_players_online (\d+)$/m)).toBe('9');
  });

  it('maps a null tick Hz (rate-meter warmup) to 0 rather than omitting the series', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource({ simTickHz: () => null }));
    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_sim_tick_hz (\d+)$/m)).toBe('0');
  });
});

describe('registerGameStateMetrics: woc_sim_tick_phase_seconds', () => {
  const phases: Record<string, TickPhaseMillis> = {
    total: { p95: 3, max: 8 },
    tick: { p95: 1.5, max: 4 },
    // An unknown / detailed sub-phase the profiler may report: must be skipped so
    // the exported label set can never grow past WOC_TICK_PHASES.
    'sim.market': { p95: 99, max: 200 },
  };

  it('converts milliseconds to seconds and labels by phase and stat', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource({ tickPhaseMillis: () => phases }));
    const text = await registry.metrics();

    expect(WOC_SIM_TICK_PHASE_SECONDS).toBe('woc_sim_tick_phase_seconds');
    expect(text).toContain(`# TYPE ${WOC_SIM_TICK_PHASE_SECONDS} gauge`);

    // 3 ms p95 -> 0.003 s, 8 ms max -> 0.008 s for the `total` phase.
    expect(
      sampleValue(text, /^woc_sim_tick_phase_seconds\{phase="total",stat="p95"\} (\S+)$/m),
    ).toBe('0.003');
    expect(
      sampleValue(text, /^woc_sim_tick_phase_seconds\{phase="total",stat="max"\} (\S+)$/m),
    ).toBe('0.008');
    expect(
      sampleValue(text, /^woc_sim_tick_phase_seconds\{phase="tick",stat="p95"\} (\S+)$/m),
    ).toBe('0.0015');
  });

  it('keeps the label set bounded: only WOC_TICK_PHASES x {p95,max}, unknown phases skipped', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource({ tickPhaseMillis: () => phases }));
    const text = await registry.metrics();

    // Two known phases reported (total, tick) x two stats = four series; the unknown
    // sim.market phase is dropped.
    expect(tickPhaseSeries(text)).toHaveLength(4);
    expect(labelValues(text, 'phase')).toEqual(new Set(['total', 'tick']));
    expect(labelValues(text, 'stat')).toEqual(new Set(['p95', 'max']));

    // Every exposed phase label is a member of the fixed set (bounded by construction).
    for (const phase of labelValues(text, 'phase')) {
      expect(WOC_TICK_PHASES).toContain(phase);
    }
  });
});

describe('registerGameStateMetrics: throughput counters via the returned sink', () => {
  it('exposes each counter under its exact exported name and increments through the sink', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    expect(WOC_WS_MESSAGES_TOTAL).toBe('woc_ws_messages_total');
    expect(WOC_CHAT_MESSAGES_TOTAL).toBe('woc_chat_messages_total');
    expect(WOC_CHARACTERS_CREATED_TOTAL).toBe('woc_characters_created_total');

    counters.wsMessage('in');
    counters.wsMessage('in');
    counters.wsMessage('out');
    counters.chatMessage();
    counters.characterCreated();
    counters.characterCreated();
    counters.characterCreated();

    const text = await registry.metrics();
    for (const name of [
      WOC_WS_MESSAGES_TOTAL,
      WOC_CHAT_MESSAGES_TOTAL,
      WOC_CHARACTERS_CREATED_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }

    expect(sampleValue(text, /^woc_ws_messages_total\{direction="in"\} (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_ws_messages_total\{direction="out"\} (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_chat_messages_total (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_characters_created_total (\d+)$/m)).toBe('3');
  });

  it('pre-registers every drop cause series and the kick and missed counters at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Scrape BEFORE any sink call: prom counters cannot backfill a scrape, so a
    // dashboard must see every series from boot. Every WS_DROP_CAUSES series
    // and the two unlabeled counters all expose an explicit 0.
    const text = await registry.metrics();

    expect(WOC_WS_MESSAGES_DROPPED_TOTAL).toBe('woc_ws_messages_dropped_total');
    expect(WOC_WS_RATE_KICKS_TOTAL).toBe('woc_ws_rate_kicks_total');
    expect(WOC_INPUT_FRAMES_MISSED_TOTAL).toBe('woc_input_frames_missed_total');
    for (const name of [
      WOC_WS_MESSAGES_DROPPED_TOTAL,
      WOC_WS_RATE_KICKS_TOTAL,
      WOC_INPUT_FRAMES_MISSED_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }

    expect(WS_DROP_CAUSES).toEqual([
      'rate',
      'bytes',
      'lane_movement',
      'lane_command',
      'lane_chat',
      'list_read',
    ]);
    for (const cause of WS_DROP_CAUSES) {
      expect(
        sampleValue(
          text,
          new RegExp(`^woc_ws_messages_dropped_total\\{cause="${cause}"\\} (\\d+)$`, 'm'),
        ),
      ).toBe('0');
    }
    expect(sampleValue(text, /^woc_ws_rate_kicks_total (\d+)$/m)).toBe('0');
    expect(sampleValue(text, /^woc_input_frames_missed_total (\d+)$/m)).toBe('0');
  });

  it('increments the drop, kick, and seq-gap counters through the sink', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.wsMessageDropped('rate');
    counters.wsMessageDropped('rate');
    counters.wsMessageDropped('bytes');
    counters.wsMessageDropped('lane_movement');
    counters.wsMessageDropped('lane_chat');
    counters.wsMessageDropped('list_read');
    counters.wsRateKick();
    // The seq-gap sink adds the whole observed gap, not one per call.
    counters.wsInputSeqGap(7);
    counters.wsInputSeqGap(2);

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="rate"\} (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="bytes"\} (\d+)$/m)).toBe('1');
    expect(
      sampleValue(text, /^woc_ws_messages_dropped_total\{cause="lane_movement"\} (\d+)$/m),
    ).toBe('1');
    expect(
      sampleValue(text, /^woc_ws_messages_dropped_total\{cause="lane_command"\} (\d+)$/m),
    ).toBe('0');
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="lane_chat"\} (\d+)$/m)).toBe(
      '1',
    );
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="list_read"\} (\d+)$/m)).toBe(
      '1',
    );
    expect(sampleValue(text, /^woc_ws_rate_kicks_total (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_input_frames_missed_total (\d+)$/m)).toBe('9');
  });

  it('keeps the cause label bounded to the fixed six values', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.wsMessageDropped('rate');
    counters.wsMessageDropped('lane_command');
    const text = await registry.metrics();
    expect(labelValues(text, 'cause')).toEqual(new Set(WS_DROP_CAUSES));
  });

  it('swallows a throwing counter in every sink method and never propagates', () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    // The seam's stated contract: an observability write must never break the
    // path it measures. Force each underlying prom counter's inc to throw and
    // prove every sink method swallows it.
    for (const name of [
      WOC_WS_MESSAGES_TOTAL,
      WOC_WS_MESSAGES_DROPPED_TOTAL,
      WOC_WS_RATE_KICKS_TOTAL,
      WOC_INPUT_FRAMES_MISSED_TOTAL,
      WOC_CHAT_MESSAGES_TOTAL,
      WOC_CHARACTERS_CREATED_TOTAL,
      WOC_COPPER_CREDITED_TOTAL,
      WOC_COPPER_SPENT_TOTAL,
      WOC_GATHER_HARVESTS_TOTAL,
      WOC_FISHING_CASTS_TOTAL,
      WOC_FISHING_CATCHES_TOTAL,
      WOC_FISHING_KOI_TOTAL,
      WOC_FISHING_GOT_AWAYS_TOTAL,
      WOC_FISHING_EMPTY_HOOKS_TOTAL,
      WOC_ROD_FEE_PAYMENTS_TOTAL,
    ]) {
      const metric = registry.getSingleMetric(name) as unknown as { inc: () => never };
      metric.inc = () => {
        throw new Error('prom exploded');
      };
    }

    expect(() => counters.wsMessage('in')).not.toThrow();
    expect(() => counters.wsMessageDropped('rate')).not.toThrow();
    expect(() => counters.wsRateKick()).not.toThrow();
    expect(() => counters.wsInputSeqGap(3)).not.toThrow();
    expect(() => counters.chatMessage()).not.toThrow();
    expect(() => counters.characterCreated()).not.toThrow();
    expect(() => counters.copperCredited('quest', 50)).not.toThrow();
    expect(() => counters.copperSpent('vendor', 20)).not.toThrow();
    expect(() => counters.harvest('mirefen_marsh', '2')).not.toThrow();
    expect(() => counters.fishingCast('mirefen_marsh', '1')).not.toThrow();
    // Both arms of the koi split reach the sink without propagating. (The
    // implementation guards both increments under ONE shared try, so a throw
    // from the first counter would skip the second by design: dropping the
    // whole sample is the module's swallow contract, and this assertion can
    // only observe that nothing escapes.)
    expect(() => counters.fishingCatch('mirefen_marsh', '1', false)).not.toThrow();
    expect(() => counters.fishingCatch('mirefen_marsh', '1', true)).not.toThrow();
    expect(() => counters.fishingGotAway('mirefen_marsh', '1')).not.toThrow();
    expect(() => counters.fishingEmptyHook('mirefen_marsh', '1')).not.toThrow();
    expect(() => counters.rodFeePaid(ROD_FEE_RECIPE_IDS[0])).not.toThrow();
  });

  it('bounds the ws direction label to in/out and emits no per-player label anywhere', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(
      registry,
      stubSource({ tickPhaseMillis: () => ({ total: { p95: 1, max: 2 } }) }),
    );
    counters.wsMessage('in');
    counters.wsMessage('out');
    const text = await registry.metrics();

    expect(labelValues(text, 'direction')).toEqual(new Set(['in', 'out']));
    // Cardinality rule: nothing request- or player-derived is ever a label.
    for (const forbidden of [
      'account',
      'account_id',
      'player',
      'player_id',
      'session',
      'session_id',
      'character',
      'character_id',
      'ip',
      'name',
    ]) {
      expect(labelValues(text, forbidden).size).toBe(0);
    }
  });
});

describe('registerGameStateMetrics: economy telemetry counters', () => {
  it('pre-registers every copper source and harvest band series at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Scrape BEFORE any sink call: prom counters cannot backfill, so every
    // economic surface and every band must be visible from boot rather than
    // appearing the first time a player earns a coin or swings a pick.
    const text = await registry.metrics();

    expect(WOC_COPPER_CREDITED_TOTAL).toBe('woc_copper_credited_total');
    expect(WOC_COPPER_SPENT_TOTAL).toBe('woc_copper_spent_total');
    expect(WOC_GATHER_HARVESTS_TOTAL).toBe('woc_gather_harvests_total');
    for (const name of [
      WOC_COPPER_CREDITED_TOTAL,
      WOC_COPPER_SPENT_TOTAL,
      WOC_GATHER_HARVESTS_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
    for (const source of COPPER_FLOW_SOURCES) {
      for (const name of [WOC_COPPER_CREDITED_TOTAL, WOC_COPPER_SPENT_TOTAL]) {
        expect(
          sampleValue(text, new RegExp(`^${name}\\{source="${source}"\\} (\\d+)$`, 'm')),
          `${name} ${source}`,
        ).toBe('0');
      }
    }
    // The WHOLE zone x tier cross product (R31), not just the combos live
    // content fills: Eastbrook ships no tier-3 ground, and that series has to
    // read as an explicit zero rather than be missing.
    expect([...NODE_TIERS]).toEqual(['1', '2', '3']);
    let seeded = 0;
    for (const band of HARVEST_BANDS) {
      for (const tier of NODE_TIERS) {
        expect(
          sampleValue(
            text,
            new RegExp(
              `^woc_gather_harvests_total\\{band="${band}",tier="${tier}"\\} (\\d+)$`,
              'm',
            ),
          ),
          `${band} tier ${tier}`,
        ).toBe('0');
        seeded++;
      }
    }
    expect(seeded).toBe(HARVEST_BANDS.length * NODE_TIERS.length);
    // And nothing BEYOND the cross product: a bare {band=} series would mean
    // an un-labeled emission site slipped past the tier thread-through.
    expect(harvestSeries(text)).toHaveLength(seeded);
  });

  it('increments copper by amount and harvests by one, each under its own label', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.copperCredited('quest', 150);
    counters.copperCredited('quest', 50);
    counters.copperCredited('loot', 7);
    counters.copperSpent('vendor', 20);
    counters.harvest('mirefen_marsh', '2');
    counters.harvest('mirefen_marsh', '2');
    counters.harvest('thornpeak_heights', '3');
    // Same zone, different tier: the two must land on different series, which
    // is the whole point of the tier label (R31's traveler-versus-capped read).
    counters.harvest('thornpeak_heights', '1');

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_copper_credited_total\{source="quest"\} (\d+)$/m)).toBe('200');
    expect(sampleValue(text, /^woc_copper_credited_total\{source="loot"\} (\d+)$/m)).toBe('7');
    // Untouched surfaces stay at their pre-registered zero rather than drifting.
    expect(sampleValue(text, /^woc_copper_credited_total\{source="vendor"\} (\d+)$/m)).toBe('0');
    expect(sampleValue(text, /^woc_copper_spent_total\{source="vendor"\} (\d+)$/m)).toBe('20');
    expect(sampleValue(text, /^woc_copper_spent_total\{source="quest"\} (\d+)$/m)).toBe('0');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="mirefen_marsh",tier="2"\} (\d+)$/m),
    ).toBe('2');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="thornpeak_heights",tier="3"\} (\d+)$/m),
    ).toBe('1');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="thornpeak_heights",tier="1"\} (\d+)$/m),
    ).toBe('1');
    // The zone's OTHER tiers stay at zero: the tier label splits the zone
    // total rather than being ignored and folded back into one series.
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="mirefen_marsh",tier="1"\} (\d+)$/m),
    ).toBe('0');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="thornpeak_heights",tier="2"\} (\d+)$/m),
    ).toBe('0');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="eastbrook_vale",tier="1"\} (\d+)$/m),
    ).toBe('0');
  });

  it('drops a non-positive or non-finite copper amount instead of corrupting the series', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    // A counter can only go up. These are caller bugs, and the sink's job is to
    // keep them out of the exposition rather than throw inside a command path.
    counters.copperCredited('quest', 0);
    counters.copperCredited('quest', -5);
    counters.copperCredited('quest', Number.NaN);
    counters.copperSpent('vendor', Number.POSITIVE_INFINITY);
    counters.copperCredited('quest', 10);

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_copper_credited_total\{source="quest"\} (\d+)$/m)).toBe('10');
    expect(sampleValue(text, /^woc_copper_spent_total\{source="vendor"\} (\d+)$/m)).toBe('0');
  });

  it('emits no label beyond the fixed economy vocabularies', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.copperCredited('quest', 1);
    counters.harvest('eastbrook_vale', '1');

    const text = await registry.metrics();
    const sources = new Set(
      [...text.matchAll(/^woc_copper_(?:credited|spent)_total\{source="([^"]+)"\}/gm)].map(
        (m) => m[1],
      ),
    );
    expect([...sources].sort()).toEqual([...COPPER_FLOW_SOURCES].sort());
    const bands = new Set(
      [...text.matchAll(/^woc_gather_harvests_total\{band="([^"]+)",tier="[^"]+"\}/gm)].map(
        (m) => m[1],
      ),
    );
    expect([...bands].sort()).toEqual([...HARVEST_BANDS].sort());
    const tiers = new Set(
      [...text.matchAll(/^woc_gather_harvests_total\{band="[^"]+",tier="([^"]+)"\}/gm)].map(
        (m) => m[1],
      ),
    );
    expect([...tiers].sort()).toEqual([...NODE_TIERS].sort());
    // No per-player dimension anywhere on these families.
    expect(text).not.toMatch(/woc_(copper|gather)[^\n]*\b(account|character|player|name|ip)=/);
  });

  it('drops an off-vocabulary harvest band or tier instead of minting a series', async () => {
    // HarvestBand is plain string (ZoneDef.id is not literal-typed), so the
    // emitter's membership guard is the only cardinality bound. A retired
    // material band and a player-shaped string must both vanish without a
    // series and without moving any real zone's count.
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.harvest('starter', '1');
    counters.harvest('account:12345', '1');
    // The tier is checked on its own axis: a real zone with a made-up tier is
    // dropped whole rather than counted under the zone's tier-1 series, or the
    // guard would be testable only through the band and could rot on the tier.
    counters.harvest('eastbrook_vale', '9' as never);
    counters.harvest('eastbrook_vale', 'account:12345' as never);

    const text = await registry.metrics();
    expect(text).not.toMatch(/band="starter"/);
    expect(text).not.toMatch(/band="account:12345"/);
    expect(text).not.toMatch(/tier="9"/);
    expect(text).not.toMatch(/tier="account:12345"/);
    for (const band of HARVEST_BANDS) {
      for (const tier of NODE_TIERS) {
        expect(
          sampleValue(
            text,
            new RegExp(
              `^woc_gather_harvests_total\\{band="${band}",tier="${tier}"\\} (\\d+)$`,
              'm',
            ),
          ),
          `${band} tier ${tier}`,
        ).toBe('0');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The fishing family: five outcome counters over the same zone x band label
// pair, plus the rod-fee payment counter and the static fee gauge beside it.
// ---------------------------------------------------------------------------

/** Every woc_fishing_* sample line of one metric (one per zone x band combo). */
function fishingSeries(text: string, name: string): string[] {
  return text.match(new RegExp(`^${name}\\{[^}]*\\} \\d+$`, 'gm')) ?? [];
}

/** One fishing counter's sample value for a zone/band pair, as a string. */
function fishingValue(text: string, name: string, zone: string, band: string): string | undefined {
  return sampleValue(text, new RegExp(`^${name}\\{zone="${zone}",band="${band}"\\} (\\d+)$`, 'm'));
}

/** Every fishing counter's exported metric name, so a sweep covers the family. */
const FISHING_COUNTER_NAMES = [
  WOC_FISHING_CASTS_TOTAL,
  WOC_FISHING_CATCHES_TOTAL,
  WOC_FISHING_KOI_TOTAL,
  WOC_FISHING_GOT_AWAYS_TOTAL,
  WOC_FISHING_EMPTY_HOOKS_TOTAL,
];

describe('registerGameStateMetrics: fishing telemetry counters', () => {
  it('exposes each fishing counter under its exact exported name', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Literal name pins: a rename must fail here, not merely swap a constant.
    expect(WOC_FISHING_CASTS_TOTAL).toBe('woc_fishing_casts_total');
    expect(WOC_FISHING_CATCHES_TOTAL).toBe('woc_fishing_catches_total');
    expect(WOC_FISHING_KOI_TOTAL).toBe('woc_fishing_koi_total');
    expect(WOC_FISHING_GOT_AWAYS_TOTAL).toBe('woc_fishing_got_aways_total');
    expect(WOC_FISHING_EMPTY_HOOKS_TOTAL).toBe('woc_fishing_empty_hooks_total');
    expect(WOC_ROD_FEE_PAYMENTS_TOTAL).toBe('woc_rod_fee_payments_total');
    expect(WOC_ROD_FEE_COPPER).toBe('woc_rod_fee_copper');

    for (const name of [...FISHING_COUNTER_NAMES, WOC_ROD_FEE_PAYMENTS_TOTAL]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
    expect(text).toContain(`# TYPE ${WOC_ROD_FEE_COPPER} gauge`);
    // The published usage recipe must keep the recipe grouping: the two rod
    // fees differ 4x, so an ungrouped sum() * max() multiplies every training
    // by the single highest fee. The help line is the operator-facing copy of
    // that recipe, so its by (recipe) form is pinned here.
    const helpLine = text.split('\n').find((l) => l.startsWith(`# HELP ${WOC_ROD_FEE_COPPER}`));
    expect(helpLine).toContain('max by (recipe)');
    expect(helpLine).toContain('sum by (recipe)');
  });

  it('pre-registers the whole zone x band cross product of every fishing counter at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Scrape BEFORE any sink call: prom counters cannot backfill, so an angler
    // who never appears in a band must read as a real zero, not as a gap.
    const text = await registry.metrics();

    expect([...FISHING_BANDS]).toEqual(['0', '1', '2']);
    const combos = HARVEST_BANDS.length * FISHING_BANDS.length;
    // 14 zones x 3 bands since the v0.32.0 expansion (was 3 x 3 = 9).
    expect(combos).toBe(42);
    for (const name of FISHING_COUNTER_NAMES) {
      for (const zone of HARVEST_BANDS) {
        for (const band of FISHING_BANDS) {
          expect(fishingValue(text, name, zone, band), `${name} ${zone} ${band}`).toBe('0');
        }
      }
      // Exactly the cross product and nothing else: an un-pre-seeded emission
      // site would add a tenth series the first time it fires.
      expect(fishingSeries(text, name), name).toHaveLength(combos);
    }
  });

  it('pre-registers a payment series and publishes the static fee for every rod recipe', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Non-vacuity: the vocabulary is the two shipped rod recipes, and the
    // fee is real copper, so a dashboard multiplying the two gets an amount.
    expect([...ROD_FEE_RECIPE_IDS]).toEqual([
      'recipe_stormreel_fishing_rod',
      'recipe_tidewrought_fishing_rod',
    ]);
    for (const recipe of ROD_FEE_RECIPE_IDS) {
      expect(
        sampleValue(
          text,
          new RegExp(`^woc_rod_fee_payments_total\\{recipe="${recipe}"\\} (\\d+)$`, 'm'),
        ),
        recipe,
      ).toBe('0');
      const fee = rodFeeForRecipe(recipe);
      expect(fee, recipe).toBeGreaterThan(0);
      expect(
        sampleValue(text, new RegExp(`^woc_rod_fee_copper\\{recipe="${recipe}"\\} (\\d+)$`, 'm')),
        recipe,
      ).toBe(String(fee));
    }
    // The two rods do NOT charge the same fee, so the gauge is load-bearing:
    // a single hardcoded constant in a dashboard would be wrong for one of them.
    expect(rodFeeForRecipe('recipe_stormreel_fishing_rod')).not.toBe(
      rodFeeForRecipe('recipe_tidewrought_fishing_rod'),
    );
  });

  it('counts each fishing outcome under its own zone and band', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.fishingCast('eastbrook_vale', '0');
    counters.fishingCast('eastbrook_vale', '0');
    counters.fishingCast('thornpeak_heights', '2');
    counters.fishingCatch('eastbrook_vale', '0', false);
    counters.fishingGotAway('eastbrook_vale', '0');
    counters.fishingEmptyHook('mirefen_marsh', '1');
    counters.fishingEmptyHook('mirefen_marsh', '1');

    const text = await registry.metrics();
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'eastbrook_vale', '0')).toBe('2');
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'thornpeak_heights', '2')).toBe('1');
    // The same zone in a different band is a different series, and vice versa:
    // neither label may be silently folded away.
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'eastbrook_vale', '2')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'thornpeak_heights', '0')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_CATCHES_TOTAL, 'eastbrook_vale', '0')).toBe('1');
    expect(fishingValue(text, WOC_FISHING_GOT_AWAYS_TOTAL, 'eastbrook_vale', '0')).toBe('1');
    expect(fishingValue(text, WOC_FISHING_EMPTY_HOOKS_TOTAL, 'mirefen_marsh', '1')).toBe('2');
    // Each outcome lands on its OWN counter: a cast is not a catch.
    expect(fishingValue(text, WOC_FISHING_CATCHES_TOTAL, 'thornpeak_heights', '2')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_EMPTY_HOOKS_TOTAL, 'eastbrook_vale', '0')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_GOT_AWAYS_TOTAL, 'mirefen_marsh', '1')).toBe('0');
  });

  it('counts a koi in BOTH the catches and the koi counter, never only one', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    // The R4 odds question is koi/catches with identical labels, so the koi
    // counter must be a strict SUBSET of catches: a koi that skipped the
    // catches counter would read as odds above one.
    counters.fishingCatch('mirefen_marsh', '1', true);
    counters.fishingCatch('mirefen_marsh', '1', false);
    counters.fishingCatch('mirefen_marsh', '1', false);
    counters.fishingCatch('mirefen_marsh', '1', false);

    const text = await registry.metrics();
    expect(fishingValue(text, WOC_FISHING_CATCHES_TOTAL, 'mirefen_marsh', '1')).toBe('4');
    expect(fishingValue(text, WOC_FISHING_KOI_TOTAL, 'mirefen_marsh', '1')).toBe('1');
    // A plain catch must NOT touch the koi counter in some other band either.
    expect(fishingValue(text, WOC_FISHING_KOI_TOTAL, 'mirefen_marsh', '0')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_KOI_TOTAL, 'mirefen_marsh', '2')).toBe('0');
  });

  it('counts one rod fee payment per successful training, by recipe', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.rodFeePaid('recipe_stormreel_fishing_rod');
    counters.rodFeePaid('recipe_stormreel_fishing_rod');
    counters.rodFeePaid('recipe_tidewrought_fishing_rod');

    const text = await registry.metrics();
    expect(
      sampleValue(
        text,
        /^woc_rod_fee_payments_total\{recipe="recipe_stormreel_fishing_rod"\} (\d+)$/m,
      ),
    ).toBe('2');
    expect(
      sampleValue(
        text,
        /^woc_rod_fee_payments_total\{recipe="recipe_tidewrought_fishing_rod"\} (\d+)$/m,
      ),
    ).toBe('1');
  });

  it('drops an off-vocabulary zone, band, or recipe instead of minting a series', async () => {
    // Both fishing labels are plain strings at the sink (the zone is a ZoneDef
    // id and the band arrives as a label value), so these membership guards are
    // the family's only cardinality bound.
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.fishingCast('account:12345' as never, '0');
    counters.fishingCatch('eastbrook_vale', '7' as never, false);
    counters.fishingCatch('eastbrook_vale', '7' as never, true);
    counters.fishingGotAway('starter' as never, '0');
    counters.fishingEmptyHook('eastbrook_vale', 'toString' as never);
    counters.rodFeePaid('recipe_copper_mining_pick');
    counters.rodFeePaid('toString');
    counters.rodFeePaid('account:12345');

    const text = await registry.metrics();
    expect(text).not.toMatch(/zone="account:12345"/);
    expect(text).not.toMatch(/zone="starter"/);
    expect(text).not.toMatch(/band="7"/);
    expect(text).not.toMatch(/band="toString"/);
    expect(text).not.toMatch(/recipe="recipe_copper_mining_pick"/);
    expect(text).not.toMatch(/recipe="toString"/);
    expect(text).not.toMatch(/recipe="account:12345"/);
    // A dropped sample must not have moved a real series on the way out: an
    // off-vocabulary BAND with a real zone is the arm most likely to leak.
    for (const name of FISHING_COUNTER_NAMES) {
      expect(fishingSeries(text, name), name).toHaveLength(42);
      for (const zone of HARVEST_BANDS) {
        for (const band of FISHING_BANDS) {
          expect(fishingValue(text, name, zone, band), `${name} ${zone} ${band}`).toBe('0');
        }
      }
    }
    for (const recipe of ROD_FEE_RECIPE_IDS) {
      expect(
        sampleValue(
          text,
          new RegExp(`^woc_rod_fee_payments_total\\{recipe="${recipe}"\\} (\\d+)$`, 'm'),
        ),
        recipe,
      ).toBe('0');
    }
  });

  it('emits no per-player label anywhere on the fishing or rod-fee families', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.fishingCast('eastbrook_vale', '0');
    counters.fishingCatch('eastbrook_vale', '0', true);
    counters.rodFeePaid('recipe_stormreel_fishing_rod');

    const text = await registry.metrics();
    // The zone label is bounded to the SAME zone vocabulary the harvest counter
    // uses (one zone list, not two), and the band to the three fishing rungs.
    const zones = new Set(
      [...text.matchAll(/^woc_fishing_\w+\{zone="([^"]+)",band="[^"]+"\}/gm)].map((m) => m[1]),
    );
    expect([...zones].sort()).toEqual([...HARVEST_BANDS].sort());
    const bands = new Set(
      [...text.matchAll(/^woc_fishing_\w+\{zone="[^"]+",band="([^"]+)"\}/gm)].map((m) => m[1]),
    );
    expect([...bands].sort()).toEqual([...FISHING_BANDS].sort());
    const recipes = new Set(
      [...text.matchAll(/^woc_rod_fee_\w*\{?recipe="([^"]+)"\}/gm)].map((m) => m[1]),
    );
    expect([...recipes].sort()).toEqual([...ROD_FEE_RECIPE_IDS].sort());

    // Cardinality rule: nothing player-derived is ever a label on these.
    for (const forbidden of [
      'account',
      'account_id',
      'player',
      'player_id',
      'session',
      'session_id',
      'character',
      'character_id',
      'ip',
      'name',
      // And no realm dimension either: Prometheus attaches realm identity at
      // scrape time, so a per-realm process must expose an identical series set.
      'realm',
      'realm_name',
      'server_name',
    ]) {
      expect(labelValues(text, forbidden).size, forbidden).toBe(0);
    }
    expect(text).not.toMatch(/woc_(fishing|rod)[^\n]*\b(account|character|player|name|ip)=/);
  });
});
