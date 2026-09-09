// The shader warm worker's settlement judge: reads a link's settle time
// RELATIVE to what this driver costs for a comparable link it has to
// itself, never against an absolute millisecond bound.
//
// Why relative. The AIMD's absolute bounds were read off cold-link tables
// (120 to 215 ms per program on Linux GL and mobile). A cold Windows D3D11
// links the same program in 225 to 740 ms (HLSL plus fxc), so every settle
// there read "slow", the window halved down to one link and stayed there,
// on the one backend whose compiler overlaps links across cores. Measured
// 2026-08-30 on an RTX 3060 under Chrome 152 (a worker OffscreenCanvas
// linking distinct programs, 1, 2 and 4 in flight): ANGLE D3D11 went 26.7
// to 42.2 to 75.2 links/s with the per-link time nearly flat (37 to 48 ms);
// ANGLE OpenGL 29.7 to 38.1 to 45.2 with the per-link time doubling (34 to
// 72 ms); Mesa Intel (this box's iGPU, headless) flat, the per-link time
// doubling at two. The driver's concurrency shows in ONE place, whatever
// the machine: whether a link's settle grows with the number of links it
// shared the driver with. That is what this judge reads. Vulkan and Metal
// have no overlap capture yet: the same rule runs there unmeasured.
//
// The etalon. A link the driver had to itself (concurrency 1) teaches the
// cost of a link on this machine, per thousand characters of GLSL, and a
// settle in company is read as a ratio to that cost. Size only predicts
// link time within a class: 8 to 10 ms per thousand across 2.4k to 15.6k
// characters on D3D11, but a fixed floor dominates small programs on
// OpenGL (7.3 down to 4.4) and on Vulkan (10.2 down to 3.0, the same
// probe's size arm), so a sample is compared only against solo samples of
// COMPARABLE weight (within a factor of two); with none, the verdict is
// mid. The etalon is a median over the last few comparable solo samples,
// and a sample far under it, solo or in company (a cache hit: the main
// thread linked the program first, then asked again), teaches nothing and
// votes nothing: in company it would read as an extremely fast link and
// grow the window on the very abandon that cost the main thread the link.
// The same goes for a unit the lane flags cheap (its prologue linked no
// program): its settle is the queue's time, not a link's.
//
// What a solo sample may decide. It says nothing about queueing, so it
// lifts the window to two, the first step that can produce a concurrent
// reading, and never past it: a trickle of one-at-a-time requests must not
// walk the window to the cap on evidence that cannot see concurrency.
// Every verdict must repeat before it counts (one reading is a
// coincidence), and after a confirmed slow the judge answers mid for a
// while rather than re-growing the window on the very next samples.
//
// Host-agnostic (RENDER_PURE_CORES): numbers in, verdicts out.

import type {
  SettlementJudge,
  SettlementSample,
  SettlementVerdict,
} from './adaptive_link_budget_core';

export interface RelativeSettleJudgeConfig {
  /** A concurrent settle at or under this ratio to the etalon overlapped. */
  growBelowRatio: number;
  /** A concurrent settle at or over this ratio to the etalon queued. */
  shrinkAboveRatio: number;
  /** Raw verdicts in a row before one is returned; `mid` otherwise. */
  agreeingSamples: number;
  /** Solo samples the etalon's median is taken over. */
  etalonSamples: number;
  /** A solo sample counts as comparable to a sample whose weight is within
   *  this factor of its own, either way. */
  comparableWeightFactor: number;
  /** A sample under this fraction of the comparable etalon, solo or in
   *  company, is a cache hit, not a link: it teaches nothing. */
  hitBelowRatio: number;
  /** Samples after a confirmed slow during which no verdict grows the window. */
  cooldownSamples: number;
  /** The window solo evidence may lift the window to, and no further. */
  soloWindowCap: number;
}

/** The bounds, with the measured drivers as the cases they separate: D3D11
 *  at four in flight read 1.3 (grow), NVIDIA GL at two 1.3 (grow) and at
 *  four 2.1 (halve), Mesa at two 2.4 (halve). */
export const RELATIVE_SETTLE_JUDGE_CONFIG: RelativeSettleJudgeConfig = {
  growBelowRatio: 1.5,
  shrinkAboveRatio: 2,
  agreeingSamples: 2,
  etalonSamples: 7,
  comparableWeightFactor: 2,
  hitBelowRatio: 0.25,
  cooldownSamples: 7,
  soloWindowCap: 2,
};

export interface RelativeSettleJudgeSnapshot {
  /** Milliseconds per unit of weight for a link the driver has to itself,
   *  over every solo sample kept; null until the first. */
  etalonMsPerWeight: number | null;
  soloSamples: number;
  /** Samples set aside as cache hits: under the ratio, solo or in company,
   *  or flagged cheap by the lane. */
  hits: number;
  /** The last concurrent settle's ratio to its expectation; null if none
   *  was comparable yet. */
  lastRatio: number | null;
  /** The raw verdict streak the next verdict needs to extend. */
  streak: { verdict: SettlementVerdict; count: number } | null;
  /** Samples left before a verdict may grow the window again. */
  cooldown: number;
}

export interface RelativeSettleJudge {
  judge: SettlementJudge;
  snapshot(): RelativeSettleJudgeSnapshot;
}

interface SoloSample {
  weight: number;
  perWeight: number;
}

const MIN_WEIGHT = 0.05;

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function createRelativeSettleJudge(
  config: RelativeSettleJudgeConfig = RELATIVE_SETTLE_JUDGE_CONFIG,
): RelativeSettleJudge {
  const solo: SoloSample[] = [];
  let soloSamples = 0;
  let hits = 0;
  let lastRatio: number | null = null;
  let streak: { verdict: SettlementVerdict; count: number } | null = null;
  let cooldown = 0;
  const agreeing = Math.max(1, Math.floor(config.agreeingSamples));
  const keep = Math.max(1, Math.floor(config.etalonSamples));
  const factor = Math.max(1, config.comparableWeightFactor);
  const soloCap = Math.max(1, Math.floor(config.soloWindowCap));

  const comparableEtalon = (weight: number): number | null => {
    const values: number[] = [];
    for (const sample of solo) {
      if (sample.weight <= weight * factor && sample.weight >= weight / factor) {
        values.push(sample.perWeight);
      }
    }
    return values.length === 0 ? null : median(values);
  };

  const confirmed = (raw: SettlementVerdict): SettlementVerdict => {
    if (streak && streak.verdict === raw) streak.count++;
    else streak = { verdict: raw, count: 1 };
    if (streak.count < agreeing) return 'mid';
    if (raw === 'slow') cooldown = Math.max(0, Math.floor(config.cooldownSamples));
    return raw;
  };

  /** Whether this sample falls in the cooldown a confirmed slow started. */
  let cooling = false;

  /** A verdict, with the cooldown applied to growth. */
  const answer = (raw: SettlementVerdict): SettlementVerdict => {
    const verdict = confirmed(raw);
    if (verdict === 'fast' && cooling) return 'mid';
    return verdict;
  };

  const judge: SettlementJudge = (sample: SettlementSample): SettlementVerdict => {
    const weight = Math.max(MIN_WEIGHT, Number.isFinite(sample.weight) ? sample.weight : 1);
    const perWeight = Math.max(0, sample.settlementMs) / weight;
    if (sample.cheap) {
      // The lane saw no program come out of it: nothing about a link in it.
      hits++;
      return 'mid';
    }
    const etalon = comparableEtalon(weight);
    if (etalon !== null && etalon > 0 && perWeight < etalon * config.hitBelowRatio) {
      // A program the driver already had: nothing about a link in it, and
      // no vote, in company least of all.
      hits++;
      return 'mid';
    }
    // Only a sample that is read spends the cooldown: a flood of set-asides
    // (the boot sweep's already-linked views) must not drain it.
    cooling = cooldown > 0;
    if (cooling) cooldown--;
    if (sample.concurrency <= 1) {
      solo.push({ weight, perWeight });
      if (solo.length > keep) solo.splice(0, solo.length - keep);
      soloSamples++;
      // Solo evidence lifts the window to the first step that can produce a
      // concurrent reading, and no further.
      return answer(sample.windowLinks < soloCap ? 'fast' : 'mid');
    }
    if (etalon === null || etalon <= 0) {
      // Nothing comparable to read it against: neither grow nor shrink.
      streak = null;
      return 'mid';
    }
    const ratio = perWeight / etalon;
    lastRatio = ratio;
    if (ratio <= config.growBelowRatio) return answer('fast');
    if (ratio >= config.shrinkAboveRatio) return answer('slow');
    return answer('mid');
  };

  return {
    judge,
    snapshot: () => ({
      etalonMsPerWeight: solo.length === 0 ? null : median(solo.map((s) => s.perWeight)),
      soloSamples,
      hits,
      lastRatio,
      streak: streak ? { ...streak } : null,
      cooldown,
    }),
  };
}
