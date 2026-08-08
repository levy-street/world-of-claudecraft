// Farm plot state and its persistence (Farming, patches-and-plots phase).
//
// Plot state is per-player state on a shared static bed, persisted in
// CharacterState keyed by bed id (src/sim/professions/farm_persist.ts). Growth
// deadlines are ABSOLUTE epoch ms from the lockoutNowMs seam, so the load side
// owns every anti-tamper arm: the bed and crop allowlists, the duration
// ceiling, and the future-anchor re-anchor. Zero-default omission is
// load-bearing throughout: a character who has never farmed serializes
// byte-identically to a pre-farming save.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FARM_BED_IDS, FARM_CROP_IDS, FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
  countDroppedHiddenSlots,
  deriveHiddenSlots,
  FARM_MAX_GROW_MS,
  normalizeFarmPlots,
  type PersistedFarmPlot,
  serializeFarmPlots,
} from '../src/sim/professions/farm_persist';
import { type PlotState, projectFarmPlots } from '../src/sim/professions/farm_projection';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';

// Fixture allowlists for the pure arms: the leaf takes its allowlists as
// arguments precisely so its unit tests never depend on shipped content. The
// end-to-end block below runs against the real FARM_BED_IDS / FARM_CROP_IDS.
const BEDS: ReadonlySet<string> = new Set(['bed_alpha', 'bed_beta']);
const CROPS: ReadonlySet<string> = new Set(['turnip', 'wheat']);

// One valid persisted row, spread into each tamper arm so exactly ONE
// dimension is corrupt per case and a drop can only be blamed on that one.
const VALID: PersistedFarmPlot = { cropId: 'turnip', plantedAtMs: 1_000, readyAtMs: 5_000 };
const NOW = 10_000;
const norm = (saved: Record<string, PersistedFarmPlot>, nowMs = NOW) =>
  normalizeFarmPlots(saved, { validBedIds: BEDS, validCropIds: CROPS, nowMs });

describe('the pure farm-plot round trip (no Sim)', () => {
  it('round-trips a full row and a minimal row through serialize and normalize', () => {
    // Inserted beta-first so the sorted output below cannot be insertion order.
    const live = new Map<string, PlotState>([
      [
        'bed_beta',
        {
          cropId: 'wheat',
          plantedAtMs: 2_000,
          readyAtMs: 3_000,
          compost: false,
          watch: false,
          tonic: false,
          notified: false,
        },
      ],
      [
        'bed_alpha',
        {
          cropId: 'turnip',
          plantedAtMs: 1_000,
          readyAtMs: 5_000,
          survivalRoll: 0.25,
          yieldSeed: 77,
          compost: true,
          watch: true,
          tonic: true,
          notified: true,
        },
      ],
    ]);
    const saved = serializeFarmPlots(live);
    // Fresh literals, never the minted objects above: an assertion against the
    // value it was built from is a self-comparison that survives any writer bug.
    expect(saved).toEqual({
      bed_alpha: {
        cropId: 'turnip',
        plantedAtMs: 1_000,
        readyAtMs: 5_000,
        survivalRoll: 0.25,
        yieldSeed: 77,
        compost: true,
        watch: true,
        tonic: true,
        notified: true,
      },
      // False flags and absent hidden slots write nothing at all.
      bed_beta: { cropId: 'wheat', plantedAtMs: 2_000, readyAtMs: 3_000 },
    });

    const loaded = norm(saved as Record<string, PersistedFarmPlot>);
    expect(loaded.size).toBe(2);
    expect(loaded.get('bed_alpha')).toEqual({
      cropId: 'turnip',
      plantedAtMs: 1_000,
      readyAtMs: 5_000,
      survivalRoll: 0.25,
      yieldSeed: 77,
      compost: true,
      watch: true,
      tonic: true,
      notified: true,
    });
    // The minimal row comes back with DERIVED hidden slots rather than none:
    // the load side never leaves a plot slotless, because an absent slot would
    // otherwise resolve at harvest time (see the derivation arms below). Every
    // other field round-trips verbatim.
    const beta = loaded.get('bed_beta') as PlotState;
    expect({ ...beta, survivalRoll: undefined, yieldSeed: undefined }).toEqual({
      cropId: 'wheat',
      plantedAtMs: 2_000,
      readyAtMs: 3_000,
      survivalRoll: undefined,
      yieldSeed: undefined,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
    expect(Number.isFinite(beta.survivalRoll)).toBe(true);
    expect(Number.isInteger(beta.yieldSeed)).toBe(true);
  });

  it('writes key-sorted rows so persisted blob diffs stay readable', () => {
    const live = new Map<string, PlotState>([
      ['bed_beta', { ...VALID, compost: false, watch: false, tonic: false, notified: false }],
      ['bed_alpha', { ...VALID, compost: false, watch: false, tonic: false, notified: false }],
    ]);
    expect(Object.keys(serializeFarmPlots(live) as Record<string, PersistedFarmPlot>)).toEqual([
      'bed_alpha',
      'bed_beta',
    ]);
  });

  it('omits the field entirely when no bed is planted', () => {
    expect(serializeFarmPlots(new Map())).toBeUndefined();
  });

  it('omits a non-finite hidden slot at write time, the JSON hygiene arm', () => {
    // NaN and Infinity are not representable in JSON and would round-trip as
    // null; the writer drops the SLOT (never the row) so the persisted bytes
    // stay honest.
    const live = new Map<string, PlotState>([
      [
        'bed_alpha',
        {
          cropId: 'turnip',
          plantedAtMs: 1_000,
          readyAtMs: 5_000,
          survivalRoll: Number.NaN,
          yieldSeed: 7,
          compost: false,
          watch: false,
          tonic: false,
          notified: false,
        },
      ],
    ]);
    const saved = serializeFarmPlots(live) as Record<string, PersistedFarmPlot>;
    expect(Object.keys(saved.bed_alpha)).not.toContain('survivalRoll');
    expect(saved.bed_alpha.yieldSeed).toBe(7);
  });

  it('loads an absent field as the no-plots default, always a fresh map', () => {
    const a = normalizeFarmPlots(undefined, {
      validBedIds: BEDS,
      validCropIds: CROPS,
      nowMs: NOW,
    });
    const b = normalizeFarmPlots(undefined, {
      validBedIds: BEDS,
      validCropIds: CROPS,
      nowMs: NOW,
    });
    expect(a.size).toBe(0);
    expect(b).not.toBe(a);
  });
});

describe('the public projection, driven directly (the pure-leaf contract)', () => {
  // The module header promises "a Vitest imports it directly"; this suite is
  // that import. The wire-path twin lives in tests/snapshots.test.ts.
  //
  // The growth phase gave projectFarmPlots two more explicit arguments (the
  // farmer's current skill and a crop-tier resolver) so it can derive the
  // `withered` status without importing a content table. Both fixtures below
  // keep the leaf contract: a literal skill and a local resolver, never
  // shipped content.
  const TIER_1 = () => 1;
  // A skill a full band above every tier-1 gate, so survival is 1 and the
  // projection's status is decided by the DEADLINE alone in these arms; the
  // survival-driven arms name their own skill.
  const OUTLEVELLED = 25;
  const project = (
    m: ReadonlyMap<string, PlotState>,
    nowMs: number,
    skill = OUTLEVELLED,
    tierOf: (cropId: string) => number = TIER_1,
  ) => projectFarmPlots(m, nowMs, skill, tierOf);
  const plot = (over: Partial<PlotState> = {}): PlotState => ({
    cropId: 'turnip',
    plantedAtMs: 1_000,
    readyAtMs: 5_000,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    ...over,
  });

  it('projects the empty map to the shared frozen instance, no per-call allocation', () => {
    // The empty case is ~100% of players until planting ships, and the
    // projection runs per session per tick on the snapshot path: the
    // EMPTY_TOOL_EFFECT_SLOT_VIEWS precedent, identity-pinned so a fresh []
    // regression reds here.
    const m = new Map<string, PlotState>();
    expect(project(m, 1_000)).toBe(project(m, 2_000));
    expect(project(m, 1_000)).toEqual([]);
    expect(Object.isFrozen(project(m, 1_000))).toBe(true);
  });

  it('sorts rows by bed id regardless of map insertion order', () => {
    const m = new Map<string, PlotState>([
      ['bed_beta', plot()],
      ['bed_alpha', plot()],
    ]);
    expect(project(m, 10_000).map((r) => r.bedId)).toEqual(['bed_alpha', 'bed_beta']);
  });

  it('turns ready EXACTLY at readyAtMs, growing one ms before', () => {
    // The boundary frame is a stated contract (src/world_api/farming.ts:
    // withered may surface only AT or after readyAtMs), so the growth phase
    // builds on "at readyAtMs the plot is already ready". A drift from < to <=
    // in the projector must red here.
    const m = new Map<string, PlotState>([['bed_alpha', plot({ readyAtMs: 5_000 })]]);
    expect(project(m, 4_999)[0]?.status).toBe('growing');
    expect(project(m, 5_000)[0]?.status).toBe('ready');
  });

  it('keeps a doomed crop indistinguishable from a healthy one WHILE it grows', () => {
    // The hidden pre-roll must stay unobservable until the deadline, or a
    // client could read a failure the moment it was planted. A roll that is
    // certain to fail still projects as `growing` right up to readyAtMs.
    const doomed = new Map<string, PlotState>([['bed_alpha', plot({ survivalRoll: 0.99 })]]);
    expect(project(doomed, 4_999, 0)[0]?.status).toBe('growing');
    expect(project(doomed, 5_000, 0)[0]?.status).toBe('withered');
  });

  it('re-reads survival against CURRENT skill, so out-levelling retires the risk', () => {
    // Same plot, same clock, same roll: only the farmer's proficiency differs.
    // At the gate the 0.99 roll loses (survival 0.85); a full band above it
    // survives (1.0), which is D6's "out-levelling a crop permanently retires
    // its risk" read retroactively. Monotone player-favorable, because
    // gathering proficiency has no decrement path.
    const m = new Map<string, PlotState>([['bed_alpha', plot({ survivalRoll: 0.99 })]]);
    expect(project(m, 5_000, 0)[0]?.status).toBe('withered');
    expect(project(m, 5_000, 25)[0]?.status).toBe('ready');
  });

  it('reads the crop tier through the resolver, never a hardcoded band', () => {
    // A tier-2 crop gates at 25, so skill 25 is only AT its gate (survival
    // 0.85) where the same skill was a full band above a tier-1 crop. The
    // resolver argument is what carries that difference in.
    const m = new Map<string, PlotState>([['bed_alpha', plot({ survivalRoll: 0.9 })]]);
    expect(project(m, 5_000, 25, () => 1)[0]?.status).toBe('ready');
    expect(project(m, 5_000, 25, () => 2)[0]?.status).toBe('withered');
  });

  it('picks the nine public fields explicitly, never the hidden slots', () => {
    const m = new Map<string, PlotState>([
      ['bed_alpha', plot({ survivalRoll: 0.5, yieldSeed: 9 })],
    ]);
    const row = project(m, 10_000)[0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual([
      'bedId',
      'compost',
      'cropId',
      'notified',
      'plantedAtMs',
      'readyAtMs',
      'status',
      'tonic',
      'watch',
    ]);
  });
});

describe('load-side anti-tamper (one corrupt dimension per arm)', () => {
  it('drops a bed id outside the allowlist and keeps the valid row', () => {
    const loaded = norm({ bed_bogus: { ...VALID }, bed_alpha: { ...VALID } });
    expect([...loaded.keys()]).toEqual(['bed_alpha']);
  });

  it('drops a crop id outside the allowlist', () => {
    const loaded = norm({ bed_alpha: { ...VALID, cropId: 'moonfruit' }, bed_beta: { ...VALID } });
    expect([...loaded.keys()]).toEqual(['bed_beta']);
  });

  it('drops a deadline BEFORE its plant time, and keeps the grow-now instant', () => {
    // Negative duration is malformed (nothing can mint it) and drops. Exactly
    // zero is the legitimate /dev farmgrow mint (readyAtMs written to the
    // plant instant; on the server, a plant and a grow inside one ms): the row
    // must survive the round trip as a permanently-ready plot rather than be
    // destroyed as tampered (the QA-round zero-duration finding).
    expect(norm({ bed_alpha: { ...VALID, readyAtMs: 900 } }).size).toBe(0);
    const grown = norm({ bed_alpha: { ...VALID, readyAtMs: VALID.plantedAtMs } });
    expect([...grown.keys()]).toEqual(['bed_alpha']);
    expect(grown.get('bed_alpha')?.readyAtMs).toBe(VALID.plantedAtMs);
  });

  it('derives deterministic in-domain slots, and a derived row is a load fixed point', () => {
    // The exported derivation contract, pinned THROUGH the export (it had only
    // indirect coverage via normalizeFarmPlots before the QA round).
    const a = deriveHiddenSlots('bed_alpha', 4_242);
    expect(deriveHiddenSlots('bed_alpha', 4_242)).toEqual(a);
    expect(a.survivalRoll).toBeGreaterThanOrEqual(0);
    expect(a.survivalRoll).toBeLessThan(1);
    expect(Number.isInteger(a.yieldSeed)).toBe(true);
    expect(a.yieldSeed).toBeGreaterThanOrEqual(0);
    expect(a.yieldSeed).toBeLessThan(0x100000000);
    // The identity key does real work: a different bed or anchor answers
    // differently, so no two plots share a derived fate.
    expect(deriveHiddenSlots('bed_beta', 4_242)).not.toEqual(a);
    expect(deriveHiddenSlots('bed_alpha', 4_243)).not.toEqual(a);
    // The doc's fixed-point claim: a row that lost both slots loads to exactly
    // this derivation, and a second round trip of the loaded map changes
    // nothing (the derived values persist and then clamp to themselves).
    const loaded = norm({ bed_alpha: { cropId: 'turnip', plantedAtMs: 4_242, readyAtMs: 8_242 } });
    const row = loaded.get('bed_alpha') as PlotState;
    expect(row.survivalRoll).toBe(a.survivalRoll);
    expect(row.yieldSeed).toBe(a.yieldSeed);
    const again = norm(serializeFarmPlots(loaded) as Record<string, PersistedFarmPlot>);
    expect(again.get('bed_alpha')).toEqual(row);
  });

  it('drops non-finite and non-positive timestamps', () => {
    expect(norm({ bed_alpha: { ...VALID, plantedAtMs: Number.NaN } }).size).toBe(0);
    expect(norm({ bed_alpha: { ...VALID, readyAtMs: Number.POSITIVE_INFINITY } }).size).toBe(0);
    expect(norm({ bed_alpha: { ...VALID, plantedAtMs: 0 } }).size).toBe(0);
    expect(norm({ bed_alpha: { ...VALID, plantedAtMs: -5_000, readyAtMs: -1_000 } }).size).toBe(0);
  });

  it('clamps an over-long growth duration to exactly the ceiling', () => {
    const planted = 1_000_000;
    const loaded = norm(
      { bed_alpha: { ...VALID, plantedAtMs: planted, readyAtMs: planted + FARM_MAX_GROW_MS + 1 } },
      planted + 5_000,
    );
    // The bound is REACHED, not merely respected: an inequality here would
    // hold for a clamp that never fired.
    expect(loaded.get('bed_alpha')?.readyAtMs).toBe(planted + FARM_MAX_GROW_MS);
    expect(loaded.get('bed_alpha')?.plantedAtMs).toBe(planted);
  });

  it('re-anchors a future plant time to now, preserving the duration', () => {
    const loaded = norm(
      { bed_alpha: { ...VALID, plantedAtMs: 9_000_000, readyAtMs: 9_060_000 } },
      NOW,
    );
    expect(loaded.get('bed_alpha')?.plantedAtMs).toBe(NOW);
    expect(loaded.get('bed_alpha')?.readyAtMs).toBe(NOW + 60_000);
  });

  it('bounds the duration BEFORE re-anchoring, so a future row cannot launder it', () => {
    const loaded = norm(
      {
        bed_alpha: {
          ...VALID,
          plantedAtMs: 9_000_000,
          readyAtMs: 9_000_000 + 10 * FARM_MAX_GROW_MS,
        },
      },
      NOW,
    );
    expect(loaded.get('bed_alpha')?.plantedAtMs).toBe(NOW);
    expect(loaded.get('bed_alpha')?.readyAtMs).toBe(NOW + FARM_MAX_GROW_MS);
  });

  it('re-anchors on a zero clock too, to the floor of 1, and settles there', () => {
    // THE ANCHOR SEMANTICS the growth phase resolved on purpose. A fresh
    // offline Sim reports lockoutNowMs 0 before it has ticked, and the old
    // `nowMs > 0` guard skipped the re-anchor entirely on that path, which
    // left the fresh-Sim load and the post-tick load DISAGREEING about the
    // same bytes. Flooring the anchor at 1 gives both paths one rule while
    // keeping the property the guard existed for: 1 is positive, so the row
    // survives every subsequent load rather than being dropped by the
    // positivity arm.
    const loaded = norm({ bed_alpha: { ...VALID } }, 0);
    expect(loaded.get('bed_alpha')?.plantedAtMs).toBe(1);
    expect(loaded.get('bed_alpha')?.readyAtMs).toBe(1 + 4_000);
    // The fixed point: re-loading what that load would save changes nothing.
    const resaved = serializeFarmPlots(loaded) as Record<string, PersistedFarmPlot>;
    const again = norm(resaved, 0);
    expect(again.get('bed_alpha')?.plantedAtMs).toBe(1);
    expect(again.get('bed_alpha')?.readyAtMs).toBe(1 + 4_000);
  });

  it('SKIPS the re-anchor entirely when the clock is not a finite number', () => {
    // The destructive branch, pinned so a mutation of the ternary dies here.
    // Folding a non-finite clock into the floor of 1 would re-anchor EVERY row
    // to 1 and PERSIST it, which on any host reading a real epoch clock puts
    // readyAtMs back in 1970 and makes every crop in the world instantly
    // ready: a silent, saved, total loss of growth state. When the clock
    // cannot be trusted, preserving the saved anchors is strictly safer.
    const saved = {
      bed_alpha: { ...VALID, plantedAtMs: 1_700_000_000_000, readyAtMs: 1_700_000_060_000 },
    };
    for (const clock of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const loaded = norm(saved, clock);
      const row = loaded.get('bed_alpha') as PlotState;
      // Byte-for-byte: the anchor and the deadline both ride through untouched.
      expect(row.plantedAtMs, String(clock)).toBe(1_700_000_000_000);
      expect(row.readyAtMs, String(clock)).toBe(1_700_000_060_000);
    }
    // Anti-vacuous: the very same row DOES re-anchor under a finite clock, so
    // the arm above is proving a skip rather than a row that never moves.
    expect(norm(saved, 0).get('bed_alpha')?.plantedAtMs).toBe(1);
    expect(norm(saved, NOW).get('bed_alpha')?.plantedAtMs).toBe(NOW);
  });

  it('gives the fresh-Sim and post-tick load paths the SAME semantics', () => {
    // The disagreement the fix removes, asserted as an agreement: a row whose
    // anchor is in the future re-anchors on BOTH clocks, and the two loads
    // preserve the identical duration. Before the fix the zero-clock arm kept
    // the future anchor and the ticked arm moved it.
    const future = { bed_alpha: { ...VALID, plantedAtMs: 9_000_000, readyAtMs: 9_060_000 } };
    const fresh = norm(future, 0);
    const ticked = norm(future, NOW);
    expect(fresh.get('bed_alpha')?.plantedAtMs).toBe(1);
    expect(ticked.get('bed_alpha')?.plantedAtMs).toBe(NOW);
    const durationOf = (m: Map<string, PlotState>) => {
      const row = m.get('bed_alpha') as PlotState;
      return row.readyAtMs - row.plantedAtMs;
    };
    expect(durationOf(fresh)).toBe(60_000);
    expect(durationOf(ticked)).toBe(60_000);
  });

  it('REPLACES a corrupt hidden slot with a derived one, never dropping the row', () => {
    // The growth phase turned the drop into a derivation: a lost slot must not
    // become a reroll primitive, so the replacement is a pure function of the
    // row's own identity rather than a fresh draw.
    const loaded = norm({
      bed_alpha: { ...VALID, survivalRoll: Number.NaN, yieldSeed: 42 },
    });
    const row = loaded.get('bed_alpha') as PlotState;
    expect(row.yieldSeed).toBe(42);
    // The finite slot rode through untouched; the corrupt one came back as a
    // real number in the draw's own domain.
    expect(row.survivalRoll).toEqual(expect.any(Number));
    expect(row.survivalRoll).toBeGreaterThanOrEqual(0);
    expect(row.survivalRoll).toBeLessThan(1);
    expect({ ...row, survivalRoll: undefined }).toEqual({
      cropId: 'turnip',
      plantedAtMs: 1_000,
      readyAtMs: 5_000,
      survivalRoll: undefined,
      yieldSeed: 42,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
  });

  it('derives a missing slot deterministically, and differently per bed', () => {
    // Same inputs, same answer, twice: derivation is a pure expansion, so a
    // tamperer who blanks a slot and reloads gets the SAME outcome back rather
    // than a resample.
    const saved = { bed_alpha: { ...VALID }, bed_beta: { ...VALID } };
    const first = norm(saved);
    const second = norm(saved);
    const a1 = first.get('bed_alpha') as PlotState;
    const a2 = second.get('bed_alpha') as PlotState;
    expect(a1.survivalRoll).toBe(a2.survivalRoll);
    expect(a1.yieldSeed).toBe(a2.yieldSeed);
    // Keyed off the bed, so two beds saved from the same bytes do not share an
    // outcome (which would make every plot in a patch succeed or fail as one).
    const b1 = first.get('bed_beta') as PlotState;
    expect(b1.survivalRoll).not.toBe(a1.survivalRoll);
    expect(b1.yieldSeed).not.toBe(a1.yieldSeed);
    // Both land in the domain the live draws use.
    for (const row of [a1, b1]) {
      expect(row.survivalRoll as number).toBeGreaterThanOrEqual(0);
      expect(row.survivalRoll as number).toBeLessThan(1);
      expect(Number.isInteger(row.yieldSeed)).toBe(true);
      expect(row.yieldSeed as number).toBeGreaterThanOrEqual(0);
      expect(row.yieldSeed as number).toBeLessThan(0x100000000);
    }
  });

  it('clamps a present hidden slot into its domain rather than trusting it', () => {
    // Hand-edited JSONB is the threat model: an out-of-range survivalRoll would
    // otherwise make a crop deterministically survive or fail regardless of
    // skill, and a fractional or huge yieldSeed would alias onto another
    // seed's stream.
    const low = norm({ bed_alpha: { ...VALID, survivalRoll: -5, yieldSeed: -3 } });
    expect(low.get('bed_alpha')?.survivalRoll).toBe(0);
    expect(low.get('bed_alpha')?.yieldSeed).toBe(0);
    const high = norm({ bed_alpha: { ...VALID, survivalRoll: 2, yieldSeed: 1e30 } });
    expect(high.get('bed_alpha')?.survivalRoll).toBeLessThan(1);
    expect(high.get('bed_alpha')?.yieldSeed).toBe(0x100000000 - 1);
    const fractional = norm({ bed_alpha: { ...VALID, survivalRoll: 0.5, yieldSeed: 7.9 } });
    expect(fractional.get('bed_alpha')?.survivalRoll).toBe(0.5);
    expect(fractional.get('bed_alpha')?.yieldSeed).toBe(7);
  });

  it('normalizes every flag through === true', () => {
    // Every flag gets its own junk arm so dropping the coercion on any ONE of
    // the four is a red, not just on compost.
    const loaded = norm({
      bed_alpha: {
        ...VALID,
        compost: 1 as unknown as boolean,
        watch: true,
        tonic: 'yes' as unknown as boolean,
        notified: 0 as unknown as boolean,
      },
    });
    expect(loaded.get('bed_alpha')?.compost).toBe(false);
    expect(loaded.get('bed_alpha')?.watch).toBe(true);
    expect(loaded.get('bed_alpha')?.tonic).toBe(false);
    expect(loaded.get('bed_alpha')?.notified).toBe(false);
  });

  it('loads a malformed container shape to the no-plots default without throwing', () => {
    // A crafted blob can put ANY JSON value where the record belongs. An array
    // yields index keys, a string yields character indices, a number yields
    // nothing: every synthesized key fails the bed allowlist, so the load is
    // total and lands on the fresh empty map.
    const asSaved = (v: unknown) => v as Record<string, PersistedFarmPlot>;
    expect(norm(asSaved([{ ...VALID }])).size).toBe(0);
    expect(norm(asSaved('bed_alpha')).size).toBe(0);
    expect(norm(asSaved(42)).size).toBe(0);
    expect(norm(asSaved(true)).size).toBe(0);
  });

  it('drops prototype-name keys, which JSON.parse mints as OWN properties', () => {
    // JSON.parse('{"__proto__":...}') creates __proto__ as an own key that
    // Object.entries DOES yield; the bed allowlist drops it and the Map
    // container makes pollution structurally impossible. Pinned as insurance
    // for any future phase that swaps the Map for a plain object.
    const raw = JSON.parse(
      `{"__proto__": {"cropId": "turnip", "plantedAtMs": 1000, "readyAtMs": 5000},
        "constructor": {"cropId": "turnip", "plantedAtMs": 1000, "readyAtMs": 5000},
        "bed_alpha": {"cropId": "turnip", "plantedAtMs": 1000, "readyAtMs": 5000}}`,
    ) as Record<string, PersistedFarmPlot>;
    const loaded = norm(raw);
    expect([...loaded.keys()]).toEqual(['bed_alpha']);
    expect(({} as { cropId?: unknown }).cropId).toBeUndefined();
  });

  it('inserts survivors in sorted bed order, never saved-JSON key order', () => {
    // The live Map's iteration order must be sim-owned: the growth phase will
    // iterate meta.farmPlots per tick, and if insertion mirrored the saved
    // JSON, the rng stream position would become a function of JSONB key
    // order, a DB round-trip artifact outside the sim's control.
    const loaded = norm({ bed_beta: { ...VALID }, bed_alpha: { ...VALID } });
    expect([...loaded.keys()]).toEqual(['bed_alpha', 'bed_beta']);
  });

  it('pins the tamper ceiling to its literal (seven days in ms)', () => {
    expect(FARM_MAX_GROW_MS).toBe(604800000);
  });
});

describe('hidden-slot drop counting (the operator signal)', () => {
  it('counts non-finite slots on surviving rows and nothing else', () => {
    const saved = {
      bed_alpha: { ...VALID, survivalRoll: Number.NaN, yieldSeed: null as unknown as number },
      bed_beta: { ...VALID, survivalRoll: 0.5 },
      bed_bogus: { ...VALID, survivalRoll: Number.NaN },
    };
    const loaded = norm(saved);
    // bed_alpha survives with BOTH slots dropped; bed_beta keeps its finite
    // slot; bed_bogus is a dropped ROW, which is the row counter's job.
    expect(countDroppedHiddenSlots(saved, loaded)).toBe(2);
  });

  it('is zero for an absent field, a clean load, and a malformed container', () => {
    expect(countDroppedHiddenSlots(undefined, new Map())).toBe(0);
    const clean = { bed_alpha: { ...VALID, survivalRoll: 0.25 } };
    expect(countDroppedHiddenSlots(clean, norm(clean))).toBe(0);
    const junk = 'bed_alpha' as unknown as Record<string, PersistedFarmPlot>;
    expect(countDroppedHiddenSlots(junk, norm(junk))).toBe(0);
  });

  it('counts a CLAMPED slot too, which is the likeliest deliberate tamper', () => {
    // An out-of-domain slot is exactly what the clamps exist to defeat, so a
    // silent correction was the one family most worth an operator line and the
    // one the counter used to miss.
    for (const survivalRoll of [5, -1, 1e9]) {
      const saved = { bed_alpha: { ...VALID, survivalRoll } };
      expect(countDroppedHiddenSlots(saved, norm(saved)), `survivalRoll ${survivalRoll}`).toBe(1);
    }
    for (const yieldSeed of [-3, 7.9, 1e30]) {
      const saved = { bed_alpha: { ...VALID, yieldSeed } };
      expect(countDroppedHiddenSlots(saved, norm(saved)), `yieldSeed ${yieldSeed}`).toBe(1);
    }
    // Both dimensions on one row count separately.
    const both = { bed_alpha: { ...VALID, survivalRoll: 5, yieldSeed: -3 } };
    expect(countDroppedHiddenSlots(both, norm(both))).toBe(2);
  });

  it('stays silent for a LEGACY row whose slots are simply absent', () => {
    // The deliberate asymmetry: an absent slot derives exactly like a corrupt
    // one, but absence is also the shape of every row written before the
    // growth phase, so counting it would warn on every ordinary boot.
    const legacy = { bed_alpha: { ...VALID } };
    expect('survivalRoll' in legacy.bed_alpha).toBe(false);
    expect('yieldSeed' in legacy.bed_alpha).toBe(false);
    const loaded = norm(legacy);
    // The slots really were filled by derivation, so this is silence about
    // work that happened, not silence because nothing happened.
    expect(Number.isFinite(loaded.get('bed_alpha')?.survivalRoll)).toBe(true);
    expect(countDroppedHiddenSlots(legacy, loaded)).toBe(0);
  });

  it('stays silent for an IN-DOMAIN slot that rode through untouched', () => {
    // The boundary values the clamp accepts unchanged must not warn either.
    const edge = { bed_alpha: { ...VALID, survivalRoll: 0, yieldSeed: 0 } };
    expect(countDroppedHiddenSlots(edge, norm(edge))).toBe(0);
    const top = {
      bed_alpha: { ...VALID, survivalRoll: 1 - Number.EPSILON, yieldSeed: 0xffffffff },
    };
    expect(countDroppedHiddenSlots(top, norm(top))).toBe(0);
  });
});

describe('the save round trip through a real Sim', () => {
  // A real epoch-ms clock through the lockoutNowMs seam (never Date.now): the
  // same host hook the raid lockouts use.
  const NOW_MS = 1_700_000_000_000;
  const BED = 'bed_eastbrook_1';
  const BED2 = 'bed_eastbrook_2';

  const baseState = (): CharacterState => {
    const seed = new Sim({
      seed: 11,
      playerClass: 'warrior',
      autoEquip: false,
      lockoutNowMs: () => NOW_MS,
    });
    return seed.serializeCharacter(seed.playerId) as CharacterState;
  };
  // noPlayer so the loaded character IS the primary and the `myFarmPlots`
  // getter reads it.
  const load = (state: CharacterState) => {
    const sim = new Sim({
      seed: 11,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => NOW_MS,
    });
    const pid = sim.addPlayer('warrior', 'Farmhand', { state });
    return { sim, pid, meta: sim.meta(pid) as PlayerMeta };
  };

  it('keeps a valid row against shipped content and drops a bogus bed', () => {
    expect(FARM_BED_IDS.has(BED)).toBe(true);
    expect(FARM_CROP_IDS.has('vale_wheat')).toBe(true);
    const state = baseState();
    // Both hidden slots are written explicitly so this arm tests the BED
    // allowlist and the round trip and nothing else; the derivation of an
    // absent slot has its own arms above and below.
    state.farmPlots = {
      bed_not_a_real_bed: {
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 1_000,
        readyAtMs: NOW_MS + 1,
      },
      [BED]: {
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 30_000,
        readyAtMs: NOW_MS + 60_000,
        survivalRoll: 0.25,
        yieldSeed: 77,
      },
    };
    const { sim, pid, meta } = load(state);
    expect([...meta.farmPlots.keys()]).toEqual([BED]);
    expect(meta.farmPlots.get(BED)).toEqual({
      cropId: 'vale_wheat',
      plantedAtMs: NOW_MS - 30_000,
      readyAtMs: NOW_MS + 60_000,
      survivalRoll: 0.25,
      yieldSeed: 77,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
    // And the surviving row rides back out, with the bogus bed self-healed away.
    expect(sim.serializeCharacter(pid)?.farmPlots).toEqual({
      [BED]: {
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 30_000,
        readyAtMs: NOW_MS + 60_000,
        survivalRoll: 0.25,
        yieldSeed: 77,
      },
    });
  });

  it('fills the hidden slots of a slotless saved row, and settles on re-save', () => {
    // A row with no hidden slots is only reachable by hand-editing the JSONB
    // (the live writer always mints both). It loads with DERIVED slots rather
    // than empty ones, and the derivation is a fixed point: what the load
    // saves is what the next load reads back, so blanking a slot cannot be
    // used as a reroll.
    const state = baseState();
    state.farmPlots = {
      [BED]: { cropId: 'vale_wheat', plantedAtMs: NOW_MS - 30_000, readyAtMs: NOW_MS + 60_000 },
    };
    const { sim, pid, meta } = load(state);
    const row = meta.farmPlots.get(BED) as PlotState;
    expect(Number.isFinite(row.survivalRoll)).toBe(true);
    expect(Number.isInteger(row.yieldSeed)).toBe(true);
    const resaved = sim.serializeCharacter(pid)?.farmPlots as Record<string, PersistedFarmPlot>;
    expect(resaved[BED].survivalRoll).toBe(row.survivalRoll);
    expect(resaved[BED].yieldSeed).toBe(row.yieldSeed);
    const second = load({ ...state, farmPlots: resaved });
    expect(second.meta.farmPlots.get(BED)).toEqual(row);
  });

  it('warns the operator once when a load drops rows or hidden slots', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state = baseState();
      state.farmPlots = {
        bed_not_a_real_bed: {
          cropId: 'vale_wheat',
          plantedAtMs: NOW_MS - 1_000,
          readyAtMs: NOW_MS + 1,
        },
        [BED]: {
          cropId: 'vale_wheat',
          plantedAtMs: NOW_MS - 30_000,
          readyAtMs: NOW_MS + 60_000,
          survivalRoll: Number.NaN,
        },
      };
      load(state);
      const dropWarns = warn.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('[load] dropped'));
      expect(dropWarns).toHaveLength(1);
      // Both silent-drop families surface: the tampered row AND the corrupt
      // hidden slot on the surviving row (which the row counter cannot see).
      expect(dropWarns[0]).toContain('1 farmPlots row(s)');
      expect(dropWarns[0]).toContain('1 hidden slot(s)');
    } finally {
      warn.mockRestore();
    }
  });

  it('loads a pre-farming save to no plots and re-omits the key on save', () => {
    const state = baseState();
    expect('farmPlots' in state).toBe(false);
    const { sim, pid, meta } = load(state);
    expect(meta.farmPlots.size).toBe(0);
    const resaved = sim.serializeCharacter(pid) as CharacterState;
    expect('farmPlots' in resaved).toBe(false);
  });

  it('projects the loaded plots for the seam, sorted, with clock-derived status', () => {
    const state = baseState();
    // BED2 first in the record so the sorted projection cannot be load order.
    // A winning survivalRoll on the finished plot keeps this arm about the
    // CLOCK: a plot past its deadline whose roll succeeds is `ready`. The
    // survival half has its own arms in the pure-projection block above.
    state.farmPlots = {
      [BED2]: {
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 120_000,
        readyAtMs: NOW_MS - 60_000,
        survivalRoll: 0.1,
        yieldSeed: 5,
      },
      [BED]: {
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 30_000,
        readyAtMs: NOW_MS + 60_000,
        survivalRoll: 0.1,
        yieldSeed: 5,
      },
    };
    const { sim, pid } = load(state);
    expect(sim.farmPlotsFor(pid)).toEqual([
      {
        bedId: BED,
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 30_000,
        readyAtMs: NOW_MS + 60_000,
        compost: false,
        watch: false,
        tonic: false,
        notified: false,
        status: 'growing',
      },
      {
        bedId: BED2,
        cropId: 'vale_wheat',
        plantedAtMs: NOW_MS - 120_000,
        readyAtMs: NOW_MS - 60_000,
        compost: false,
        watch: false,
        tonic: false,
        notified: false,
        status: 'ready',
      },
    ]);
    // The local-player getter reads the same rows through the same path.
    expect(sim.myFarmPlots).toEqual(sim.farmPlotsFor(pid));
    // An unknown pid is empty, never a throw (the toolEffectSlotsFor arm).
    expect(sim.farmPlotsFor(987_654)).toEqual([]);
  });

  it('serves the shared empty projection for a plotless player and an unknown pid', () => {
    // Both empty arms return the ONE frozen instance (the
    // EMPTY_TOOL_EFFECT_SLOT_VIEWS precedent): this runs per session per tick
    // on the snapshot path, and a fresh [] per call was an allocation for the
    // overwhelming majority who have no planted bed.
    const { sim, pid } = load(baseState());
    expect(sim.farmPlotsFor(pid)).toBe(sim.farmPlotsFor(pid));
    expect(sim.farmPlotsFor(pid)).toBe(sim.farmPlotsFor(987_654));
    expect(sim.farmPlotsFor(pid)).toEqual([]);
  });

  it('pins the persisted bed-id roster to its literals', () => {
    // Bed ids are SAVE KEYS: the load allowlist destroys any plot whose id
    // leaves this list, so a rename is a deliberate destroy-on-load decision.
    // Uniqueness and set-size pins cannot see a rename; only literals can.
    expect([...FARM_BED_IDS].sort()).toEqual([
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_eastbrook_3',
      'bed_eastbrook_4',
      'bed_evergarden_1',
      'bed_evergarden_2',
      'bed_evergarden_3',
      'bed_evergarden_4',
      'bed_evergarden_5',
      'bed_evergarden_6',
      'bed_evergarden_7',
      'bed_evergarden_8',
      'bed_mirefen_1',
      'bed_mirefen_2',
      'bed_mirefen_3',
      'bed_mirefen_4',
      'bed_mirefen_5',
      'bed_thornpeak_1',
      'bed_thornpeak_2',
      'bed_thornpeak_3',
      'bed_thornpeak_4',
      'bed_thornpeak_5',
      'bed_thornpeak_6',
    ]);
    // The crop allowlist is a save-key roster too (deviation (h): one
    // pre-declared crop until the growth phase ships the catalog).
    expect([...FARM_CROP_IDS]).toEqual(['vale_wheat']);
  });

  it('serves the static patch table by reference, deep-frozen', () => {
    const { sim } = load(baseState());
    expect(sim.farmPatches).toBe(FARM_PATCHES);
    // By-reference sharing across the seam is only safe because the table is
    // FROZEN at runtime (readonly types erase): array, patch, beds, bed.
    expect(Object.isFrozen(FARM_PATCHES)).toBe(true);
    for (const patch of FARM_PATCHES) {
      expect(Object.isFrozen(patch)).toBe(true);
      expect(Object.isFrozen(patch.beds)).toBe(true);
      for (const bed of patch.beds) expect(Object.isFrozen(bed)).toBe(true);
    }
  });
});

describe('the cross-clock-base save assumption', () => {
  it('every serializeCharacter caller lives in server/ and injects the wall clock', () => {
    // farm_persist.ts stores ABSOLUTE deadlines and its normalize guard only
    // re-anchors future rows, which is safe solely because every persisted
    // blob is written AND read by a WALL-CLOCK host. That is two properties,
    // and the directory scan alone only proved the weaker one: three
    // server-side scratch sims (character creation, the PBE boost builder,
    // the community test-account templates) sat inside server/ while
    // building on the sim-clock default (0 before the first tick), which is
    // exactly the anchor family normalize can never repair (a t=0 anchor on
    // a wall-clock host reads decades past ready with no arm firing). So the
    // scan pins BOTH: no caller outside server/, and every caller file
    // injects lockoutNowMs. The file-level token check is a tripwire, not
    // proof (the deeds_content producer-site idiom): the decisive fact is
    // each scratch-sim constructor passing () => Date.now(). A caller that
    // cannot inject the wall clock must revisit farm_persist.ts's clock-base
    // doctrine before it lands. (scripts/*.mjs probes stay out of scope:
    // they never reach Postgres.)
    const roots = ['src', 'server', 'headless'].map((d) => path.join(__dirname, '..', d));
    const callers = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) {
          const content = fs.readFileSync(p, 'utf8');
          if (/\.serializeCharacter\(/.test(content)) {
            callers.set(path.relative(path.join(__dirname, '..'), p), content);
          }
        }
      }
    };
    for (const root of roots) walk(root);
    expect(callers.size).toBeGreaterThan(0); // the scan itself must see the real call sites
    for (const [caller, content] of callers) {
      expect(caller.startsWith('server/'), `${caller} calls serializeCharacter`).toBe(true);
      expect(
        /lockoutNowMs/.test(content),
        `${caller} persists character blobs without injecting the wall clock (lockoutNowMs)`,
      ).toBe(true);
    }
  });
});
