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
import { describe, expect, it } from 'vitest';
import { FARM_BED_IDS, FARM_CROP_IDS, FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
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
    expect(loaded.get('bed_beta')).toEqual({
      cropId: 'wheat',
      plantedAtMs: 2_000,
      readyAtMs: 3_000,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
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

  it('sorts rows by bed id regardless of map insertion order', () => {
    const m = new Map<string, PlotState>([
      ['bed_beta', plot()],
      ['bed_alpha', plot()],
    ]);
    expect(projectFarmPlots(m, 10_000).map((r) => r.bedId)).toEqual(['bed_alpha', 'bed_beta']);
  });

  it('turns ready EXACTLY at readyAtMs, growing one ms before', () => {
    // The boundary frame is a stated contract (src/world_api/farming.ts:
    // withered may surface only AT or after readyAtMs), so the growth phase
    // builds on "at readyAtMs the plot is already ready". A drift from < to <=
    // in the projector must red here.
    const m = new Map<string, PlotState>([['bed_alpha', plot({ readyAtMs: 5_000 })]]);
    expect(projectFarmPlots(m, 4_999)[0]?.status).toBe('growing');
    expect(projectFarmPlots(m, 5_000)[0]?.status).toBe('ready');
  });

  it('picks the nine public fields explicitly, never the hidden slots', () => {
    const m = new Map<string, PlotState>([
      ['bed_alpha', plot({ survivalRoll: 0.5, yieldSeed: 9 })],
    ]);
    const row = projectFarmPlots(m, 10_000)[0] as Record<string, unknown>;
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

  it('drops a deadline at or before its plant time', () => {
    expect(norm({ bed_alpha: { ...VALID, readyAtMs: 1_000 } }).size).toBe(0);
    expect(norm({ bed_alpha: { ...VALID, readyAtMs: 900 } }).size).toBe(0);
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

  it('keeps the saved anchor when the loading clock is at or below zero', () => {
    // A fresh offline Sim reports lockoutNowMs 0 before it has ticked.
    // Re-anchoring to 0 would write an anchor this same function drops on the
    // NEXT load, so a row would survive exactly one round trip.
    const loaded = norm({ bed_alpha: { ...VALID } }, 0);
    expect(loaded.get('bed_alpha')?.plantedAtMs).toBe(1_000);
    expect(loaded.get('bed_alpha')?.readyAtMs).toBe(5_000);
  });

  it('drops a corrupt hidden slot without dropping the row', () => {
    const loaded = norm({
      bed_alpha: { ...VALID, survivalRoll: Number.NaN, yieldSeed: 42 },
    });
    expect(loaded.get('bed_alpha')).toEqual({
      cropId: 'turnip',
      plantedAtMs: 1_000,
      readyAtMs: 5_000,
      yieldSeed: 42,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
    expect(loaded.get('bed_alpha')?.survivalRoll).toBeUndefined();
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

  it('pins the tamper ceiling to its literal (seven days in ms)', () => {
    expect(FARM_MAX_GROW_MS).toBe(604800000);
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
    expect(FARM_CROP_IDS.has('wheat')).toBe(true);
    const state = baseState();
    state.farmPlots = {
      bed_not_a_real_bed: { cropId: 'wheat', plantedAtMs: NOW_MS - 1_000, readyAtMs: NOW_MS + 1 },
      [BED]: { cropId: 'wheat', plantedAtMs: NOW_MS - 30_000, readyAtMs: NOW_MS + 60_000 },
    };
    const { sim, pid, meta } = load(state);
    expect([...meta.farmPlots.keys()]).toEqual([BED]);
    expect(meta.farmPlots.get(BED)).toEqual({
      cropId: 'wheat',
      plantedAtMs: NOW_MS - 30_000,
      readyAtMs: NOW_MS + 60_000,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });
    // And the surviving row rides back out, with the bogus bed self-healed away.
    expect(sim.serializeCharacter(pid)?.farmPlots).toEqual({
      [BED]: { cropId: 'wheat', plantedAtMs: NOW_MS - 30_000, readyAtMs: NOW_MS + 60_000 },
    });
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
    state.farmPlots = {
      [BED2]: { cropId: 'wheat', plantedAtMs: NOW_MS - 120_000, readyAtMs: NOW_MS - 60_000 },
      [BED]: { cropId: 'wheat', plantedAtMs: NOW_MS - 30_000, readyAtMs: NOW_MS + 60_000 },
    };
    const { sim, pid } = load(state);
    expect(sim.farmPlotsFor(pid)).toEqual([
      {
        bedId: BED,
        cropId: 'wheat',
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
        cropId: 'wheat',
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
    expect([...FARM_CROP_IDS]).toEqual(['wheat']);
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
  it('serializeCharacter has no caller outside server/, the epoch-anchor premise', () => {
    // farm_persist.ts stores ABSOLUTE deadlines and its normalize guard only
    // re-anchors future rows, which is safe solely because every persisted
    // blob is written AND read by a wall-clock host: serializeCharacter is
    // called nowhere outside server/. If an offline host (sim-clock ms from
    // zero) ever wrote a blob a server later loads, every crop would read
    // decades past ready with no arm firing. This scan turns that prose
    // premise into a pin (the deeds_content producer-site idiom): a new
    // caller outside server/ must revisit farm_persist.ts's clock-base
    // doctrine before it lands.
    const roots = ['src', 'server', 'headless'].map((d) => path.join(__dirname, '..', d));
    const callers = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (
          entry.name.endsWith('.ts') &&
          /\.serializeCharacter\(/.test(fs.readFileSync(p, 'utf8'))
        ) {
          callers.add(path.relative(path.join(__dirname, '..'), p));
        }
      }
    };
    for (const root of roots) walk(root);
    expect(callers.size).toBeGreaterThan(0); // the scan itself must see the real call sites
    for (const caller of callers) {
      expect(caller.startsWith('server/'), `${caller} calls serializeCharacter`).toBe(true);
    }
  });
});
