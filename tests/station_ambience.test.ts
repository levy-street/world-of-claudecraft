// Station ambience beds (issue #2208): pins the routing config
// (src/game/station_ambience.ts) against the catalog, the generated
// manifest, the station content, and the render-side seam union, plus the
// deterministic synthesis contract of the authored clips themselves
// (scripts/sfx/station_ambience.mjs): reproducible output, exact duration,
// and a loop-safe head/tail.

import { describe, expect, it } from 'vitest';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';
import {
  renderStationAmbience,
  SAMPLE_RATE,
  STATION_AMBIENCE_SPECS,
} from '../scripts/sfx/station_ambience.mjs';
import { FORGE_MAX_DISTANCE, MAX_DISTANCE } from '../src/game/sfx';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import {
  STATION_AMBIENCE,
  STATION_MAX_DISTANCE,
  type StationAmbienceKind,
} from '../src/game/station_ambience';
import type { AmbientPointSource } from '../src/render/audio_sink';
import { STATIONS } from '../src/sim/data';

// Compile-time parity: the render-side seam union (audio_sink.ts, which must
// not import src/game/) and the game-side union (campfire/forge plus
// StationAmbienceKind) must stay identical. Assignability both ways makes
// tsc fail this file the moment either union drifts. CAVEAT (the
// bot_detector_stub.test.ts precedent): vitest transpiles via esbuild
// WITHOUT typechecking, so these two lines can never fail under the test
// runner; `npx tsc --noEmit` (gate and pre-push floor) is what enforces
// them. The runtime arm below pins the same seven-kind fact vitest CAN see.
type SeamKind = AmbientPointSource['kind'];
type GameKind = 'campfire' | 'forge' | StationAmbienceKind;
const seamCoversGame: readonly SeamKind[] = [] as readonly GameKind[];
const gameCoversSeam: readonly GameKind[] = [] as readonly SeamKind[];

const STATION_KINDS: StationAmbienceKind[] = [
  'apothecary',
  'kitchens',
  'loom',
  'tannery',
  'toolworks',
];

describe('station ambience routing config', () => {
  it('keeps the seam unions in sync (compile-time via tsc, runtime literal arm here)', () => {
    expect(seamCoversGame).toEqual([]);
    expect(gameCoversSeam).toEqual([]);
    // The runtime arm: the complete point-ambience kind roster as literals.
    // A kind added to (or dropped from) the game-side config without a
    // deliberate edit here fails under plain vitest, no tsc required.
    expect(['campfire', 'forge', ...STATION_KINDS]).toEqual([
      'campfire',
      'forge',
      'apothecary',
      'kitchens',
      'loom',
      'tannery',
      'toolworks',
    ]);
    expect(Object.keys(STATION_AMBIENCE).sort()).toEqual([...STATION_KINDS].sort());
  });

  it('covers exactly the non-forge station types shipped in the world content', () => {
    expect(Object.keys(STATION_AMBIENCE).sort()).toEqual(STATION_KINDS);
    const contentTypes = new Set(
      STATIONS.filter((station) => station.type !== 'forge').map((station) => station.type),
    );
    expect([...contentTypes].sort()).toEqual(STATION_KINDS);
  });

  it('maps every kind to a registered looping custom amb_* cue with its own bed', () => {
    const catalogByKey = new Map(SFX.map((entry: { key: string }) => [entry.key, entry] as const));
    const seen = new Set<string>();
    for (const kind of STATION_KINDS) {
      const config = STATION_AMBIENCE[kind];
      expect(config.key, kind).toMatch(/^amb_/);
      expect(seen.has(config.key), `${kind} shares a bed`).toBe(false);
      seen.add(config.key);
      expect(config.key in SFX_CLIPS, `${config.key} missing from generated manifest`).toBe(true);
      const row = catalogByKey.get(config.key) as
        | { loop?: boolean; custom?: boolean; duration?: number }
        | undefined;
      expect(row, `${config.key} missing from sfx_prompts catalog`).toBeDefined();
      expect(row?.loop, `${config.key} must loop`).toBe(true);
      expect(row?.custom, `${config.key} must never be API-overwritten`).toBe(true);
    }
  });

  it('keeps station gains in the generated-bed mix range, never the forge compensation', () => {
    for (const kind of STATION_KINDS) {
      const gain = STATION_AMBIENCE[kind].gain;
      expect(gain, kind).toBeGreaterThan(0);
      // The beds conform near the generated-content LUFS target, so their
      // mix gain belongs near POINT_AMBIENCE_GAIN (0.18). FORGE_AMBIENCE_GAIN
      // (0.625) exists only to compensate a quiet custom recording; a station
      // gain drifting toward it means the bed was re-authored wrong.
      expect(gain, kind).toBeLessThanOrEqual(0.3);
    }
  });

  it('reuses the live-tuned forge cull radius under the shared hard cutoff', () => {
    expect(STATION_MAX_DISTANCE).toBe(FORGE_MAX_DISTANCE);
    expect(STATION_MAX_DISTANCE).toBeLessThan(MAX_DISTANCE);
  });
});

describe('station ambience synthesis contract', () => {
  it('matches the routing config and catalog rows one to one', () => {
    const specKeys = STATION_AMBIENCE_SPECS.map((spec: { key: string }) => spec.key).sort();
    const configKeys = STATION_KINDS.map((kind) => STATION_AMBIENCE[kind].key).sort();
    expect(specKeys).toEqual(configKeys);
    const catalogByKey = new Map(
      SFX.map((entry: { key: string; duration?: number }) => [entry.key, entry] as const),
    );
    for (const spec of STATION_AMBIENCE_SPECS as { key: string; duration: number }[]) {
      expect((catalogByKey.get(spec.key) as { duration?: number })?.duration, spec.key).toBe(
        spec.duration,
      );
    }
  });

  it('renders deterministic, exact-duration, loop-safe PCM for every bed', () => {
    for (const spec of STATION_AMBIENCE_SPECS as { key: string; duration: number }[]) {
      const pcm: Float32Array = renderStationAmbience(spec.key);
      expect(pcm.length, spec.key).toBe(Math.round(spec.duration * SAMPLE_RATE));

      // Determinism: a second render is sample-identical (seeded PRNG).
      const again: Float32Array = renderStationAmbience(spec.key);
      expect(again.length).toBe(pcm.length);
      let maxDelta = 0;
      for (let i = 0; i < pcm.length; i++) {
        maxDelta = Math.max(maxDelta, Math.abs(pcm[i] - again[i]));
      }
      expect(maxDelta, spec.key).toBe(0);

      // Loop safety: matched bed-only head/tail windows stay within 4 dB
      // RMS of each other, and no discrete event tail crosses the wrap
      // (tail peak bounded by the head's own bed peak).
      const win = Math.round(0.35 * SAMPLE_RATE);
      const rms = (from: number, to: number) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
        return Math.sqrt(sum / (to - from));
      };
      const peak = (from: number, to: number) => {
        let value = 0;
        for (let i = from; i < to; i++) value = Math.max(value, Math.abs(pcm[i]));
        return value;
      };
      const ratioDb = Math.abs(20 * Math.log10(rms(0, win) / rms(pcm.length - win, pcm.length)));
      expect(ratioDb, spec.key).toBeLessThanOrEqual(4);
      expect(peak(pcm.length - win, pcm.length), spec.key).toBeLessThanOrEqual(3 * peak(0, win));
      expect(peak(0, pcm.length), spec.key).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});
