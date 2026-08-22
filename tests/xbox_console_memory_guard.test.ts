import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

// The Xbox shell injects this file before any game script runs. It is the only
// thing keeping the packaged client inside the console's WebView2 memory
// budget, and getting its direction wrong (raising a setting instead of
// clamping it) is invisible until a console starts killing its render process.
const SOURCE = readFileSync(
  new URL('../xbox/WorldOfClaudecraft.Shell/Assets/console-memory-guard.js', import.meta.url),
  'utf8',
);

const STORE_KEY = 'woc_settings';
const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Run the guard over a given persisted-settings blob. */
function run(seed?: string): { dpr: number; raw: string | undefined } {
  const store = new Map<string, string>();
  if (seed !== undefined) store.set(STORE_KEY, seed);
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  const win = { devicePixelRatio: 4 };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  new Function(SOURCE)();

  return { dpr: win.devicePixelRatio, raw: store.get(STORE_KEY) };
}

const settings = (raw: string | undefined) => JSON.parse(String(raw)) as Record<string, unknown>;

afterEach(() => {
  if (realWindow) Object.defineProperty(globalThis, 'window', realWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage);
  else delete (globalThis as Record<string, unknown>).localStorage;
});

describe('xbox console memory guard', () => {
  it('pins devicePixelRatio to 1 and seeds a console floor on first run', () => {
    const { dpr, raw } = run();
    expect(dpr).toBe(1);
    // graphicsDefaultApplied is the load-bearing part: without it the client's
    // own first-run detection sees a strong console adapter and raises the
    // preset straight back up.
    expect(settings(raw)).toEqual({
      graphicsPreset: 1,
      renderScale: 0.75,
      graphicsDefaultApplied: true,
    });
  });

  it('clamps a desktop-sized tier down to the console ceiling', () => {
    const { raw } = run(JSON.stringify({ graphicsPreset: 6, renderScale: 1, uiScale: 1.25 }));
    const s = settings(raw);
    expect(s.graphicsPreset).toBe(2);
    expect(s.renderScale).toBe(0.75);
    expect(s.graphicsDefaultApplied).toBe(true);
    // Unrelated settings are not the guard's business.
    expect(s.uiScale).toBe(1.25);
  });

  it('never raises a lower choice the player made', () => {
    const { raw } = run(
      JSON.stringify({ graphicsPreset: 1, renderScale: 0.5, graphicsDefaultApplied: true }),
    );
    const s = settings(raw);
    expect(s.graphicsPreset).toBe(1);
    expect(s.renderScale).toBe(0.5);
  });

  it('leaves a corrupt blob alone instead of throwing before the game boots', () => {
    const { dpr, raw } = run('{ not json');
    expect(dpr).toBe(1);
    expect(raw).toBe('{ not json');
  });
});
