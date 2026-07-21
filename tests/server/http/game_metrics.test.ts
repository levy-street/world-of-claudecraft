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
import {
  type GameStateSource,
  registerGameStateMetrics,
  type TickPhaseMillis,
  WOC_ACCOUNTS_ONLINE,
  WOC_CHARACTERS_CREATED_TOTAL,
  WOC_CHAT_MESSAGES_TOTAL,
  WOC_PLAYERS_ONLINE,
  WOC_SIM_ENTITIES,
  WOC_SIM_TICK_HZ,
  WOC_SIM_TICK_PHASE_SECONDS,
  WOC_TICK_PHASES,
  WOC_WS_CONNECTIONS,
  WOC_WS_MESSAGES_TOTAL,
} from '../../../server/http/game_metrics';

/** A GameStateSource returning fixed values; override any field per test. */
function stubSource(overrides: Partial<GameStateSource> = {}): GameStateSource {
  return {
    playersOnline: () => 3,
    accountsOnline: () => 2,
    wsConnections: () => 5,
    simEntities: () => 42,
    simTickHz: () => 20,
    tickPhaseMillis: () => ({}),
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
