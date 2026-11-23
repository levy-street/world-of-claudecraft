import { describe, expect, it } from 'vitest';
import { perfReportInternalsForTest } from '../server/perf_report';
import {
  DRAW_CENSUS_RAW_DRAWS_MAX,
  DRAW_CENSUS_RAW_LABEL_MAX,
  DRAW_CENSUS_RAW_RANKING_MAX,
  sanitizeDrawCensus,
} from '../server/perf_report_draw_census';
import { RAW_SUMMARY_SHED_RUNG_IDS, shedRawSummaryToFit } from '../server/perf_report_shed';
import { DRAW_CENSUS_LABEL_MAX, DRAW_CENSUS_TOP_N } from '../src/render/draw_census_core';

const { rawSummary } = perfReportInternalsForTest;

const census = () => ({
  samples: 12,
  latest: {
    draws: 410,
    objects: 380,
    walkMs: 1.4,
    categories: [
      ['entity:player', 220],
      ['dungeon', 90],
    ],
    roots: [['characters', 220]],
    nodes: [['entity:player>characters', 220]],
  },
  peak: {
    draws: 1650,
    objects: 1400,
    walkMs: 3.2,
    categories: [['vfx', 1100]],
    roots: [['ignivar-forge-chains', 960]],
    nodes: [['vfx>forge-chain-links', 640]],
  },
});

describe('rendererDrawCensus ingest bound', () => {
  it('passes a well-formed census through unchanged', () => {
    expect(sanitizeDrawCensus(census())).toEqual(census());
  });

  it('agrees with the client limits it defends', () => {
    // server/ cannot import src/render, so the bounds are written twice.
    expect(DRAW_CENSUS_RAW_RANKING_MAX).toBe(DRAW_CENSUS_TOP_N + 1);
    expect(DRAW_CENSUS_RAW_LABEL_MAX).toBe(DRAW_CENSUS_LABEL_MAX);
  });

  it('clamps a hostile census to its fixed shape', () => {
    const out = sanitizeDrawCensus({
      samples: -5,
      extra: 'x'.repeat(5000),
      latest: {
        draws: 1e12,
        objects: Number.NaN,
        categories: [...Array.from({ length: 50 }, (_, i) => [`cat${i}`, i])],
        roots: [['y'.repeat(500), 3], [7, 3], 'bad', ['', 1], ['ok', 'many']],
        smuggled: { deep: true },
      },
      peak: 'nope',
    }) as Record<string, any>;
    expect(Object.keys(out).sort()).toEqual(['latest', 'peak', 'samples']);
    expect(out.samples).toBe(0);
    expect(out.peak).toBeNull();
    expect(Object.keys(out.latest).sort()).toEqual([
      'categories',
      'draws',
      'nodes',
      'objects',
      'roots',
      'walkMs',
    ]);
    expect(out.latest.walkMs).toBe(0);
    expect(out.latest.nodes).toEqual([]);
    expect(out.latest.draws).toBe(DRAW_CENSUS_RAW_DRAWS_MAX);
    expect(out.latest.objects).toBe(0);
    expect(out.latest.categories).toHaveLength(DRAW_CENSUS_RAW_RANKING_MAX);
    expect(out.latest.roots).toEqual([
      ['y'.repeat(DRAW_CENSUS_RAW_LABEL_MAX), 3],
      ['ok', 0],
    ]);
  });

  it('replaces label characters outside the plain-id charset', () => {
    const out = sanitizeDrawCensus({
      latest: { draws: 1, walkMs: 1e9, roots: [['a"b\u0001<c>', 1]] },
    }) as Record<string, any>;
    expect(out.latest.roots).toEqual([['a_b__c>', 1]]);
    expect(out.latest.walkMs).toBe(60_000);
  });

  it('stays within its stated hard maximum, about 5 KB, at full size', () => {
    const ranking = Array.from({ length: 40 }, (_, i) => [
      `${'\u0001'.repeat(DRAW_CENSUS_RAW_LABEL_MAX - 2)}${i}`,
      DRAW_CENSUS_RAW_DRAWS_MAX,
    ]);
    const big = {
      draws: 1e12,
      objects: 1e12,
      walkMs: 1e12,
      categories: ranking,
      roots: ranking,
      nodes: ranking,
    };
    const out = sanitizeDrawCensus({ samples: 1e12, latest: big, peak: big });
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(5 * 1024);
  });

  it('drops a census with no sample, or a non-record', () => {
    expect(sanitizeDrawCensus({ samples: 3, latest: null, peak: null })).toBeUndefined();
    expect(sanitizeDrawCensus([1, 2])).toBeUndefined();
    expect(rawSummary({ rendererDrawCensus: 'x'.repeat(4000) })).not.toHaveProperty(
      'rendererDrawCensus',
    );
  });

  it('is bounded inside rawSummary before the byte cap', () => {
    const out = rawSummary({
      rendererDrawCensus: { ...census(), latest: { ...census().latest, draws: 1e15 } },
    }) as Record<string, any>;
    expect(out.rendererDrawCensus.latest.draws).toBe(DRAW_CENSUS_RAW_DRAWS_MAX);
    expect(out.rendererDrawCensus.peak.roots).toEqual([['ignivar-forge-chains', 960]]);
  });
});

describe('rendererDrawCensus in the shed ladder', () => {
  it('sits in the core tail, after every big diagnostic block', () => {
    const at = RAW_SUMMARY_SHED_RUNG_IDS.indexOf('rendererDrawCensus');
    expect(at).toBeGreaterThan(RAW_SUMMARY_SHED_RUNG_IDS.indexOf('rendererBudget'));
    for (const big of [
      'rendererDiagnostics',
      'assets',
      'rendererPrewarmSummary',
      'rendererFoliage',
      'rendererQualityBuckets',
      'netPipeline',
      'heapSawtooth',
    ]) {
      expect(at, big).toBeGreaterThan(RAW_SUMMARY_SHED_RUNG_IDS.indexOf(big));
    }
  });

  it('survives a heavy report that has to shed its big blocks', () => {
    const value = {
      rendererDrawCensus: census(),
      rendererDiagnostics: { filler: 'x'.repeat(8000) },
      rendererFoliage: { filler: 'x'.repeat(8000) },
      netPipeline: { filler: 'x'.repeat(8000) },
    };
    const out = shedRawSummaryToFit(value, 4096, { compactPrewarm: () => null });
    expect(out.truncated).toBe(true);
    expect(out.dropped).not.toContain('rendererDrawCensus');
    expect(out.rendererDrawCensus).toEqual(census());
  });
});
