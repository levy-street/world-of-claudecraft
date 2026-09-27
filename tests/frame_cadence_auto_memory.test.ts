import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  frameCadenceAutoMemoryKey,
  localFrameCadenceAutoMemory,
  parseFrameCadenceAutoRecord,
} from '../src/game/frame_cadence_auto_memory';

const SETTLED = { ceiling: 30, confirmed: true, failStreak: 1 } as const;

describe('automatic frame rate limit memory', () => {
  const store = new Map<string, string>();
  const original = (globalThis as { localStorage?: unknown }).localStorage;

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });

  it('keys on the preset and the refresh class, so either change forgets the verdict', () => {
    expect(frameCadenceAutoMemoryKey(1, 59.94)).toBe(frameCadenceAutoMemoryKey(1, 60.02));
    expect(frameCadenceAutoMemoryKey(1, 60)).not.toBe(frameCadenceAutoMemoryKey(1, 144));
    expect(frameCadenceAutoMemoryKey(1, 60)).not.toBe(frameCadenceAutoMemoryKey(3, 60));
  });

  it('round-trips a verdict on the same display, and forgets it on another', () => {
    localFrameCadenceAutoMemory.save(60, SETTLED);
    expect(localFrameCadenceAutoMemory.load(59.9)).toEqual(SETTLED);
    expect(localFrameCadenceAutoMemory.load(144)).toBeNull();
    localFrameCadenceAutoMemory.save(60, { ceiling: 30, confirmed: false, failStreak: 0 });
    expect(localFrameCadenceAutoMemory.load(60)?.confirmed).toBe(false);
  });

  it('reads a record written before verdicts carried a confirmation as a settled one', () => {
    const key = frameCadenceAutoMemoryKey(1, 60);
    expect(parseFrameCadenceAutoRecord({ key, ceiling: 30 }, key)).toEqual({
      ceiling: 30,
      confirmed: true,
      failStreak: 0,
    });
  });

  it('bounds a stored fail streak and refuses a record under another key', () => {
    const key = frameCadenceAutoMemoryKey(1, 60);
    const stored = { v: 2, key, ceiling: 30, confirmed: true };
    expect(parseFrameCadenceAutoRecord({ ...stored, failStreak: 1e9 }, key)?.failStreak).toBe(16);
    expect(parseFrameCadenceAutoRecord({ ...stored, failStreak: -3 }, key)?.failStreak).toBe(0);
    expect(parseFrameCadenceAutoRecord({ ...stored, failStreak: 'x' }, key)?.failStreak).toBe(0);
    expect(parseFrameCadenceAutoRecord({ ...stored, confirmed: 'yes' }, key)?.confirmed).toBe(
      false,
    );
    expect(parseFrameCadenceAutoRecord(stored, frameCadenceAutoMemoryKey(2, 60))).toBeNull();
    expect(parseFrameCadenceAutoRecord('30', key)).toBeNull();
  });

  it('signs the preset and the render scale, and nothing else', () => {
    const sign = () => localFrameCadenceAutoMemory.settingsSignature();
    const write = (settings: Record<string, number>) =>
      store.set('woc_settings', JSON.stringify(settings));
    write({ graphicsPreset: 2, renderScale: 1, musicVolume: 0.2 });
    const base = sign();
    write({ graphicsPreset: 2, renderScale: 1, musicVolume: 0.9 });
    expect(sign()).toBe(base);
    write({ graphicsPreset: 3, renderScale: 1 });
    expect(sign()).not.toBe(base);
    write({ graphicsPreset: 2, renderScale: 0.75 });
    expect(sign()).not.toBe(base);
  });

  it('forgets on clear', () => {
    localFrameCadenceAutoMemory.save(60, SETTLED);
    localFrameCadenceAutoMemory.clear();
    expect(localFrameCadenceAutoMemory.load(60)).toBeNull();
  });

  it('reads nothing from a missing, corrupt or out-of-vocabulary entry', () => {
    expect(localFrameCadenceAutoMemory.load(60)).toBeNull();
    store.set('woc_frame_cadence_auto', '{not json');
    expect(localFrameCadenceAutoMemory.load(60)).toBeNull();
    // A matching key with a ceiling outside the vocabulary.
    localFrameCadenceAutoMemory.save(60, SETTLED);
    const entry = JSON.parse(store.get('woc_frame_cadence_auto') ?? '{}');
    store.set('woc_frame_cadence_auto', JSON.stringify({ ...entry, ceiling: 45 }));
    expect(localFrameCadenceAutoMemory.load(60)).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(() => localFrameCadenceAutoMemory.save(60, SETTLED)).not.toThrow();
    expect(() => localFrameCadenceAutoMemory.clear()).not.toThrow();
    expect(() => localFrameCadenceAutoMemory.settingsSignature()).not.toThrow();
    expect(localFrameCadenceAutoMemory.load(60)).toBeNull();
  });
});
