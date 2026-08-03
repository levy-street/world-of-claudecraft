import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeGraphicsRebuildCrashProbe,
  GRAPHICS_REBUILD_PROBE_KEY,
  parseGraphicsRebuildProbe,
  serializeGraphicsRebuildProbe,
  stampGraphicsRebuildProbe,
  updateGraphicsRebuildProbePhase,
} from '../src/game/graphics_rebuild_crash_guard';

const storage = new Map<string, string>();
const snapshot = (graphicsPreset: string | number) => ({
  graphicsPreset,
  terrainDetail: 2,
  foliageDensity: 2,
  surfaceDetail: 2,
  effectsQuality: 2,
  shadowQuality: 2,
});

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

describe('graphics rebuild crash marker', () => {
  it('round-trips the exact six-setting snapshot including string profile ids', () => {
    const probe = {
      generation: 9,
      at: 1234,
      phase: 'candidate-built' as const,
      from: snapshot('balanced'),
      target: { ...snapshot('ultra'), effectsQuality: 4 },
    };

    expect(parseGraphicsRebuildProbe(serializeGraphicsRebuildProbe(probe))).toEqual(probe);
  });

  it('persists bounded settings, advances phases, and consumes once', () => {
    stampGraphicsRebuildProbe({
      generation: 7,
      at: 1_000,
      phase: 'starting',
      from: snapshot(3),
      target: { ...snapshot(4), terrainDetail: 3 },
    });
    updateGraphicsRebuildProbePhase('candidate-built');

    const consumed = consumeGraphicsRebuildCrashProbe(1_500);
    expect(consumed).toMatchObject({ generation: 7, phase: 'candidate-built' });
    expect(storage.has(GRAPHICS_REBUILD_PROBE_KEY)).toBe(false);
    expect(consumeGraphicsRebuildCrashProbe(1_501)).toBeNull();
  });

  it('rejects malformed, missing, and extra settings fields and clears stale markers', () => {
    expect(
      parseGraphicsRebuildProbe(
        JSON.stringify({
          generation: 1,
          at: 1,
          phase: 'starting',
          from: snapshot('x'.repeat(65)),
          target: snapshot(4),
        }),
      ),
    ).toBeNull();
    expect(
      parseGraphicsRebuildProbe(
        JSON.stringify({
          generation: 1,
          at: 1,
          phase: 'starting',
          from: { ...snapshot(3), accountId: 99 },
          target: snapshot(4),
        }),
      ),
    ).toBeNull();
    expect(
      parseGraphicsRebuildProbe(
        JSON.stringify({
          generation: 1,
          at: 1,
          phase: 'starting',
          from: { graphicsPreset: 3 },
          target: snapshot(4),
        }),
      ),
    ).toBeNull();

    stampGraphicsRebuildProbe({
      generation: 1,
      at: 1,
      phase: 'starting',
      from: snapshot(3),
      target: snapshot(4),
    });
    expect(consumeGraphicsRebuildCrashProbe(60 * 60 * 1000)).toBeNull();
    expect(storage.has(GRAPHICS_REBUILD_PROBE_KEY)).toBe(false);
  });
});
