// The client-perf half of the /metrics exporter: the fleet-wide frame-health
// series distilled from the /api/perf-report beacons the clients already send.
// Until this module, those beacons landed ONLY in the client_perf_reports table,
// so "how do frames feel for players" was answerable by SQL on the production
// database and nowhere else; these series put the same signal on the one
// prom-client registry the exporter serves (server/http/metrics.ts), where
// dashboards and alerting can read it without database access.
//
// EMISSION SITE AND SEMANTICS: server/perf_report.ts calls the slot's
// perfReportStored(row) with the fully SANITIZED insert row, immediately after
// the row is stored. That placement is load-bearing three ways:
// - The ingest rate limiter and the per-session insert throttle have already
//   run, so a beacon flood moves these series no faster than it moves the
//   table, and the series stay 1:1 with stored rows (a Grafana count and a SQL
//   count agree).
// - Every field observed here has already been through perf_report's clamps
//   and allowlists, so values are finite and bounded before they arrive.
// - Reports with source 'benchmark' are skipped here (they measure a harness,
//   not a player) while still reaching storage for the admin reader.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as game_metrics.ts: every
// label value comes from one of the fixed vocabularies below. The two ingest
// fields that are NOT bounded upstream (zone_or_scenario is free text,
// gl_renderer_bucket has an open-ended slug fallback for unrecognized
// hardware) NEVER reach a label raw: classifyClientPerfScene and
// classifyClientPerfGpuFamily collapse them into fixed classes with an
// explicit fallback, so a hand-rolled beacon cannot mint series. Nothing
// per-player, per-session, or per-device (account id, character id, session
// id, ip, exact renderer string) is ever a label.
//
// CLIENT-ATTESTED NUMBERS, the same caveat wsInputSeqGap carries: the beacon
// is public and unauthenticated, so any token holder can post hand-rolled
// values (bounded upstream by the ingest clamps, the per-IP rate limit, and
// the per-session insert throttle). A hostile can skew a cohort's
// distribution, never mint a series; operators corroborate a surprising shift
// against the stored rows before treating it as fleet truth.
//
// Bucket choices are anchored on what the fleet actually reports: the two
// vsync cadences (16.7ms and 33.4ms, where the desktop median p95 sits), the
// governor's render-scale floor, and the client's own 250ms worst-10s clamp
// (src/game/perf.ts caps each frame sample there, so the top bucket edge and
// the jank threshold both sit at that clamp).

import { Counter, Histogram, type Registry } from 'prom-client';

/** The five graphics tiers the ingest allowlist admits (perf_report.ts gfxTier). */
export const CLIENT_PERF_GFX_TIERS = ['low', 'medium', 'high', 'ultra', 'insane'] as const;
export type ClientPerfGfxTier = (typeof CLIENT_PERF_GFX_TIERS)[number];

/** Touch-capable clients vs everything else, from the report's mobileTouch flag. */
export const CLIENT_PERF_DEVICE_CLASSES = ['desktop', 'mobile'] as const;
export type ClientPerfDeviceClass = (typeof CLIENT_PERF_DEVICE_CLASSES)[number];

/**
 * The GPU families worth telling apart in fleet trends. Coarser than the
 * stored gl_renderer_bucket on purpose: the stored bucket is open-ended
 * (apple-<chip> variants, a slug fallback for anything unrecognized), which is
 * fine for a SQL drill-down but can neither bound a label nor keep a rare
 * device from being fingerprintable. 'intel-igpu' folds intel / intel-uhd /
 * intel-iris together: they trend together and jointly form the known worst
 * desktop cohort.
 */
export const CLIENT_PERF_GPU_FAMILIES = [
  'nvidia',
  'amd',
  'intel-igpu',
  'apple',
  'software',
  'other',
] as const;
export type ClientPerfGpuFamily = (typeof CLIENT_PERF_GPU_FAMILIES)[number];

/** The OS families the ingest allowlist admits (perf_report.ts osFamily). */
export const CLIENT_PERF_OS_FAMILIES = [
  'windows',
  'macos',
  'linux',
  'ios',
  'android',
  'other',
] as const;
export type ClientPerfOsFamily = (typeof CLIENT_PERF_OS_FAMILIES)[number];

/**
 * Scene classes for the worst-10s series: the scene KIND is what separates the
 * hitch profiles (interior module streaming vs open-world foliage vs the BG
 * field), and a fixed class set is what free-text zone ids cannot give a
 * label. The stock client's zone tokens come from telemetryZoneId
 * (src/game/world_telemetry.ts): a bare overworld zone id, `dungeon:<id>`,
 * `delve:<id>`, and the fixed instance tokens `arena`, `yumi_maze`,
 * `battleground`, `rift`, `instance`, each of which keeps its own class here
 * (tests/client_perf_scene_parity.test.ts pins the mapping against the real
 * function). Bare ids classify as 'overworld'; the ingest defaults
 * ('gameplay', '') land in 'other'. Per-zone drill-down stays in the table.
 */
export const CLIENT_PERF_SCENE_CLASSES = [
  'overworld',
  'dungeon',
  'delve',
  'battleground',
  'arena',
  'yumi_maze',
  'rift',
  'instance',
  'other',
] as const;
export type ClientPerfSceneClass = (typeof CLIENT_PERF_SCENE_CLASSES)[number];

/**
 * The client perf-doctor suggestion ids. A deliberate copy of
 * KNOWN_PERF_SUGGESTION_IDS in server/perf_report.ts (importing it would cycle
 * perf_report <-> this module); tests/server/http/client_perf_metrics.test.ts
 * pins the two catalogs equal, the same drift guard the crowd-bucket copy uses.
 */
export const CLIENT_PERF_SUGGESTION_IDS = [
  'hardware-acceleration',
  'integrated-gpu',
  'high-dpi',
  'forced-high-graphics',
  'low-memory',
  'browser-stalls',
  'heap-pressure',
  'context-loss',
] as const;
export type ClientPerfSuggestionId = (typeof CLIENT_PERF_SUGGESTION_IDS)[number];

/**
 * A report whose worst 10s window p95 reached this many ms counts as janky.
 * This is the client reporter's own clamp value, so "reached" and "hit the
 * clamp" are the same test and the jank share is exactly the share of reports
 * a raw SQL `worst_10s_frame_p95_ms >= 250` returns.
 */
export const CLIENT_PERF_JANK_THRESHOLD_MS = 250;

// Series names, exported for the test pins.
export const WOC_CLIENT_REPORTS_TOTAL = 'woc_client_reports_total';
export const WOC_CLIENT_JANK_REPORTS_TOTAL = 'woc_client_jank_reports_total';
export const WOC_CLIENT_FRAME_P95_SECONDS = 'woc_client_frame_p95_seconds';
export const WOC_CLIENT_FPS_AVG = 'woc_client_fps_avg';
export const WOC_CLIENT_WORST10S_FRAME_P95_SECONDS = 'woc_client_worst10s_frame_p95_seconds';
export const WOC_CLIENT_LONG_TASK_P95_SECONDS = 'woc_client_long_task_p95_seconds';
export const WOC_CLIENT_EFFECTIVE_RENDER_SCALE = 'woc_client_effective_render_scale';
export const WOC_CLIENT_CONTEXT_LOSSES_TOTAL = 'woc_client_context_losses_total';
export const WOC_CLIENT_SUGGESTIONS_TOTAL = 'woc_client_suggestions_total';

// Bucket edges are part of the exporter's public contract (a bucket edit
// silently rewrites every dashboard quantile), so they are exported and pinned
// by the tests like the RED exporter's duration buckets.
// 60Hz is 0.0167 and its half-rate miss is 0.0334; the fleet median desktop
// p95 sits ON the 0.0334 edge, so both cadences are explicit edges.
export const CLIENT_PERF_FRAME_P95_BUCKETS_SECONDS = [
  0.0125, 0.0167, 0.02, 0.025, 0.0334, 0.05, 0.0834, 0.125, 0.25,
] as const;
// Top edge at the client's 0.25s clamp: everything above it is clamp-resident.
export const CLIENT_PERF_WORST10S_BUCKETS_SECONDS = [
  0.0334, 0.05, 0.0667, 0.0834, 0.125, 0.25,
] as const;
export const CLIENT_PERF_FPS_AVG_BUCKETS = [10, 15, 20, 25, 30, 40, 50, 60, 90, 120] as const;
// The top edge sits at the ingest's own clamp: perf_report.ts bounds
// longTaskP95Ms to 1000ms, so no higher edge is reachable (the multi-second
// freeze evidence rides raw_summary's browser.longTasks block instead, under
// its own 60s bound). Raising this tail means raising the ingest clamp in the
// same change.
export const CLIENT_PERF_LONG_TASK_BUCKETS_SECONDS = [0.05, 0.1, 0.2, 0.35, 0.5, 1] as const;
// The governor's floor is 0.3 (perf_report numberIn bound); 1.0 is native.
export const CLIENT_PERF_RENDER_SCALE_BUCKETS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;

const MS_PER_SECOND = 1000;

/**
 * The slice of the sanitized insert row this module reads. Structurally
 * satisfied by db.ts ClientPerfReportInsert, declared apart so the module
 * depends on the ingest contract, never on the database layer.
 */
export interface ClientPerfSample {
  source: string;
  gfxTier: string;
  mobileTouch: boolean;
  osFamily: string;
  glRendererBucket: string;
  zoneOrScenario: string;
  fpsAvg: number;
  frameP95Ms: number;
  worst10sFrameP95Ms: number;
  longTaskP95Ms: number;
  effectiveRenderScale: number;
  contextLostCount: number;
  suggestionIds: string[];
}

/**
 * The client-perf emission hook. The implementation must never throw: an
 * observability write can never be allowed to break the beacon ingest it
 * measures (the same contract as GameMetricsCounters).
 */
export interface ClientPerfMetricsSink {
  /** One sanitized perf report, called right after its row is stored. */
  perfReportStored(sample: ClientPerfSample): void;
}

/** A sink that drops every report; the slot default until boot wires the real one. */
export const noopClientPerfMetricsSink: ClientPerfMetricsSink = {
  perfReportStored() {},
};

let activeSink: ClientPerfMetricsSink = noopClientPerfMetricsSink;

/**
 * Install the process-wide client-perf sink. main.ts calls this once at boot
 * with the exporter-backed implementation; tests install a recording fake and
 * restore noopClientPerfMetricsSink when done.
 */
export function setClientPerfMetricsSink(sink: ClientPerfMetricsSink): void {
  activeSink = sink;
}

/** The current client-perf sink. Read at emission time, never captured at import. */
export function clientPerfMetricsSink(): ClientPerfMetricsSink {
  return activeSink;
}

/** Collapse a stored gl_renderer_bucket into its fixed fleet family. */
export function classifyClientPerfGpuFamily(glRendererBucket: string): ClientPerfGpuFamily {
  const bucket = glRendererBucket.toLowerCase();
  if (bucket.startsWith('nvidia')) return 'nvidia';
  if (bucket.startsWith('amd')) return 'amd';
  if (bucket.startsWith('intel')) return 'intel-igpu';
  if (bucket.startsWith('apple')) return 'apple';
  if (bucket.startsWith('software')) return 'software';
  return 'other';
}

// The fixed single-token instance ids telemetryZoneId emits, each mapped to
// the scene class of the same name.
const INSTANCE_SCENE_TOKENS: readonly ClientPerfSceneClass[] = [
  'battleground',
  'arena',
  'yumi_maze',
  'rift',
  'instance',
];

/** Collapse a free-text zone_or_scenario into its fixed scene class. */
export function classifyClientPerfScene(zoneOrScenario: string): ClientPerfSceneClass {
  if (zoneOrScenario.startsWith('dungeon:')) return 'dungeon';
  if (zoneOrScenario.startsWith('delve:')) return 'delve';
  if ((INSTANCE_SCENE_TOKENS as readonly string[]).includes(zoneOrScenario)) {
    return zoneOrScenario as ClientPerfSceneClass;
  }
  // The ingest defaults ('gameplay' for a stock client that sent nothing,
  // 'benchmark' for the harness) plus the empty string carry no scene at all.
  if (zoneOrScenario === '' || zoneOrScenario === 'gameplay' || zoneOrScenario === 'benchmark') {
    return 'other';
  }
  return 'overworld';
}

function tierIn(value: string): ClientPerfGfxTier {
  // The ingest allowlist already guarantees membership with a 'low' fallback;
  // this mirrors that fallback so a direct caller cannot widen the label.
  return (CLIENT_PERF_GFX_TIERS as readonly string[]).includes(value)
    ? (value as ClientPerfGfxTier)
    : 'low';
}

function osIn(value: string): ClientPerfOsFamily {
  return (CLIENT_PERF_OS_FAMILIES as readonly string[]).includes(value)
    ? (value as ClientPerfOsFamily)
    : 'other';
}

// Every observed value routes through this ONE sanitizer, and the jank compare
// runs on its output, never the raw field: a histogram _sum is treated as
// monotone by dashboards, so a direct caller's negative finite value must not
// subtract from it, and an Infinity must neither poison a _sum nor satisfy the
// jank threshold while its histogram observes zero.
function observedOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Create the client-perf series on `registry` and return the sink that feeds
 * them. main.ts installs the result via setClientPerfMetricsSink at boot.
 */
export function registerClientPerfMetrics(registry: Registry): ClientPerfMetricsSink {
  const reports = new Counter({
    name: WOC_CLIENT_REPORTS_TOTAL,
    help: 'Stored gameplay perf reports, by graphics tier, device class, and GPU family.',
    labelNames: ['gfx_tier', 'device', 'gpu_family'] as const,
    registers: [registry],
  });
  const jankReports = new Counter({
    name: WOC_CLIENT_JANK_REPORTS_TOTAL,
    help:
      'Stored gameplay perf reports whose worst 10s window frame p95 reached the client clamp ' +
      `(${CLIENT_PERF_JANK_THRESHOLD_MS}ms): the heavy-jank share numerator over woc_client_reports_total.`,
    labelNames: ['gfx_tier', 'device'] as const,
    registers: [registry],
  });
  const frameP95 = new Histogram({
    name: WOC_CLIENT_FRAME_P95_SECONDS,
    help: 'Reported frame-time p95 per report window, by graphics tier and device class.',
    labelNames: ['gfx_tier', 'device'] as const,
    buckets: [...CLIENT_PERF_FRAME_P95_BUCKETS_SECONDS],
    registers: [registry],
  });
  const fpsAvg = new Histogram({
    name: WOC_CLIENT_FPS_AVG,
    help: 'Reported average fps per report window, by graphics tier and device class.',
    labelNames: ['gfx_tier', 'device'] as const,
    buckets: [...CLIENT_PERF_FPS_AVG_BUCKETS],
    registers: [registry],
  });
  const worst10s = new Histogram({
    name: WOC_CLIENT_WORST10S_FRAME_P95_SECONDS,
    help: 'Reported worst 10s window frame p95 (client-clamped at 0.25s), by scene class and device class.',
    labelNames: ['scene', 'device'] as const,
    buckets: [...CLIENT_PERF_WORST10S_BUCKETS_SECONDS],
    registers: [registry],
  });
  const longTask = new Histogram({
    name: WOC_CLIENT_LONG_TASK_P95_SECONDS,
    help: 'Reported main-thread long-task p95 per report window, by graphics tier.',
    labelNames: ['gfx_tier'] as const,
    buckets: [...CLIENT_PERF_LONG_TASK_BUCKETS_SECONDS],
    registers: [registry],
  });
  const renderScale = new Histogram({
    name: WOC_CLIENT_EFFECTIVE_RENDER_SCALE,
    help: 'Reported effective render scale (governor pressure; 1.0 is native), by graphics tier.',
    labelNames: ['gfx_tier'] as const,
    buckets: [...CLIENT_PERF_RENDER_SCALE_BUCKETS],
    registers: [registry],
  });
  const contextLosses = new Counter({
    name: WOC_CLIENT_CONTEXT_LOSSES_TOTAL,
    help: 'WebGL context losses summed from stored gameplay perf reports, by OS family.',
    labelNames: ['os'] as const,
    registers: [registry],
  });
  const suggestions = new Counter({
    name: WOC_CLIENT_SUGGESTIONS_TOTAL,
    help: 'Perf-doctor suggestion ids carried by stored gameplay perf reports.',
    labelNames: ['suggestion'] as const,
    registers: [registry],
  });

  // The exporter's zero-backfill design, whole family (game_metrics.ts: "Prom
  // counters cannot backfill a scrape", histograms pre-seeded with .zero()):
  // every counter cross product registers at zero and every histogram series
  // is pre-seeded, so the first post-deploy increment is visible to
  // increase()/rate() and the jank SHARE reads 0% for a healthy cohort rather
  // than "no data". The full family is a fixed ~600-sample scrape ceiling,
  // measured immaterial per scrape.
  for (const gfxTier of CLIENT_PERF_GFX_TIERS) {
    for (const device of CLIENT_PERF_DEVICE_CLASSES) {
      const tierDevice = { gfx_tier: gfxTier, device };
      jankReports.inc(tierDevice, 0);
      frameP95.zero(tierDevice);
      fpsAvg.zero(tierDevice);
      for (const gpuFamily of CLIENT_PERF_GPU_FAMILIES) {
        reports.inc({ ...tierDevice, gpu_family: gpuFamily }, 0);
      }
    }
    longTask.zero({ gfx_tier: gfxTier });
    renderScale.zero({ gfx_tier: gfxTier });
  }
  for (const scene of CLIENT_PERF_SCENE_CLASSES) {
    for (const device of CLIENT_PERF_DEVICE_CLASSES) worst10s.zero({ scene, device });
  }
  for (const os of CLIENT_PERF_OS_FAMILIES) contextLosses.inc({ os }, 0);
  for (const suggestion of CLIENT_PERF_SUGGESTION_IDS) suggestions.inc({ suggestion }, 0);

  return {
    perfReportStored(sample: ClientPerfSample): void {
      // Guarded like every sibling sink on this registry (game_metrics.ts,
      // metrics.ts): a throw here would 500 a beacon whose row is already
      // stored, and the client then re-sends the same worst-10s window, so
      // dropping one observation is the correct failure mode.
      try {
        if (sample.source !== 'gameplay') return;
        const gfxTier = tierIn(sample.gfxTier);
        const device: ClientPerfDeviceClass = sample.mobileTouch ? 'mobile' : 'desktop';
        const tierDevice = { gfx_tier: gfxTier, device };

        reports.inc({
          ...tierDevice,
          gpu_family: classifyClientPerfGpuFamily(sample.glRendererBucket),
        });
        frameP95.observe(tierDevice, observedOrZero(sample.frameP95Ms) / MS_PER_SECOND);
        fpsAvg.observe(tierDevice, observedOrZero(sample.fpsAvg));
        const worst10sMs = observedOrZero(sample.worst10sFrameP95Ms);
        worst10s.observe(
          { scene: classifyClientPerfScene(sample.zoneOrScenario), device },
          worst10sMs / MS_PER_SECOND,
        );
        if (worst10sMs >= CLIENT_PERF_JANK_THRESHOLD_MS) jankReports.inc(tierDevice);
        longTask.observe(
          { gfx_tier: gfxTier },
          observedOrZero(sample.longTaskP95Ms) / MS_PER_SECOND,
        );
        renderScale.observe({ gfx_tier: gfxTier }, observedOrZero(sample.effectiveRenderScale));
        const lost = Math.floor(observedOrZero(sample.contextLostCount));
        if (lost > 0) contextLosses.inc({ os: osIn(sample.osFamily) }, lost);
        for (const id of sample.suggestionIds) {
          // The ingest allowlist already filtered these; membership is re-checked
          // so a direct caller cannot mint a label value.
          if ((CLIENT_PERF_SUGGESTION_IDS as readonly string[]).includes(id)) {
            suggestions.inc({ suggestion: id });
          }
        }
      } catch {
        // Deliberately silent, matching the sibling sinks: the observation is
        // lost, the beacon and its stored row are not.
      }
    },
  };
}
