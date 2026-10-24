import { beforeEach, describe, expect, it } from 'vitest';
import { sfx } from '../src/game/sfx';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { sfxMixBus } from '../src/game/sfx_mix_bus';
import type { AmbientPointSource } from '../src/render/audio_sink';

// The Audio panel's Sound Effects and Ambience sliders drive two separate gain
// buses. These pin which clips land on which bus (the pure classifier, against
// the REAL manifest categories) and that sfx.ts really routes through it: every
// environment bed connects to the ambience bus, every gameplay sound to the
// effects master, and each slider moves only its own bus.

/** The manifest category of a shipped clip; fails loudly if the key vanished. */
function category(key: string): string {
  const entry = (SFX_CLIPS as Record<string, { category: string } | undefined>)[key];
  expect(entry, `${key} must be a shipped clip`).toBeDefined();
  return (entry as { category: string }).category;
}

/** Point emitters that belong to a gameplay object: players use them to find or
 *  dodge it, so they must never move onto the Ambience slider. */
const GAMEPLAY_EMITTERS = [
  'rift_portal_drone',
  'hoard_entrance_hum',
  'rift_boulder_roll',
  'rift_ice_glide',
];

describe('sfxMixBus', () => {
  it('routes every manifest clip in the ambience category to the ambient bus', () => {
    const ambience = Object.entries(SFX_CLIPS).filter(([, e]) => e.category === 'ambience');
    expect(ambience.map(([key]) => key)).toEqual(
      expect.arrayContaining(['amb_wind_vale', 'amb_rain', 'amb_campfire', 'amb_forge']),
    );
    for (const [key, entry] of ambience)
      expect(sfxMixBus(key, entry.category), key).toBe('ambient');
  });

  it('routes the procedural crowd bed (no manifest entry) to the ambient bus', () => {
    expect((SFX_CLIPS as Record<string, unknown>).amb_crowd).toBeUndefined();
    expect(sfxMixBus('amb_crowd', undefined)).toBe('ambient');
  });

  it('keeps gameplay emitters, combat, movement, and interface clips on the effects bus', () => {
    for (const key of [...GAMEPLAY_EMITTERS, 'impact_shadow', 'foot_grass', 'ui_click']) {
      expect(sfxMixBus(key, category(key)), key).toBe('effects');
    }
    expect(sfxMixBus('unknown_key', undefined)).toBe('effects');
  });
});

interface FakeNode {
  gain: { value: number; setValueAtTime(): void; setTargetAtTime(): void };
  out: unknown[];
  connect(n: unknown): unknown;
  disconnect(): void;
}
interface FakeSource extends FakeNode {
  buffer: { duration: number } | null;
}

const destination = { out: [] as unknown[] };
let gains: FakeNode[] = [];
let sources: FakeSource[] = [];

function node(): FakeNode {
  return {
    gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {} },
    out: [],
    connect(n: unknown) {
      this.out.push(n);
      return n;
    },
    disconnect() {},
  };
}

/** The bus a source finally feeds: the last node before the destination. */
function busOf(src: FakeNode): unknown {
  let cur: FakeNode = src;
  while (cur.out[0] !== destination) {
    expect(cur.out.length, 'every source chain must reach the destination').toBe(1);
    cur = cur.out[0] as FakeNode;
  }
  return cur;
}

/** The started source whose seeded buffer has this (unique) duration. */
function sourceFor(duration: number): FakeSource {
  const found = sources.find((s) => s.buffer?.duration === duration);
  expect(found, `a source with duration ${duration} must start`).toBeDefined();
  return found as FakeSource;
}

beforeEach(() => {
  gains = [];
  sources = [];
  class FakeCtx {
    currentTime = 0;
    destination = destination;
    listener = {} as Record<string, unknown>;
    createGain() {
      const g = node();
      gains.push(g);
      return g;
    }
    createPanner() {
      return { ...node(), setPosition() {} };
    }
    createBufferSource() {
      const s = {
        ...node(),
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        onended: null,
        start() {},
        stop() {},
      } as FakeSource;
      sources.push(s);
      return s;
    }
    resume() {
      return Promise.resolve();
    }
  }
  (globalThis as never as { AudioContext: unknown }).AudioContext = FakeCtx;
});

describe('sfx ambience bus routing', () => {
  it('splits sampled output into two buses and routes each sound to the right one', () => {
    sfx.init();
    // Identify the buses by their slider, never by creation order.
    sfx.setVolume(0.5);
    sfx.setAmbientVolume(0.2);
    const buses = gains.filter((g) => g.out[0] === destination);
    expect(buses).toHaveLength(2);
    const master = buses.find((g) => Math.abs(g.gain.value - 0.85 * 0.5) < 1e-9);
    const ambient = buses.find((g) => Math.abs(g.gain.value - 0.85 * 0.2) < 1e-9);
    expect(master).toBeDefined();
    expect(ambient).toBeDefined();
    // Each slider moves only its own bus.
    sfx.setAmbientVolume(0);
    expect(ambient?.gain.value).toBe(0);
    expect(master?.gain.value).toBeCloseTo(0.85 * 0.5);
    sfx.setVolume(1);
    expect(ambient?.gain.value).toBe(0);
    expect(master?.gain.value).toBeCloseTo(0.85);

    // Unique durations tag each seeded buffer so its source can be found.
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('amb_wind_vale', { duration: 4.01 });
    buffers.set('amb_crowd', { duration: 4.02 });
    buffers.set('amb_campfire', { duration: 4.03 });
    buffers.set('rift_portal_drone', { duration: 4.04 });
    buffers.set('rift_boulder_roll', { duration: 4.05 });
    buffers.set('hoard_entrance_hum', { duration: 4.06 });
    buffers.set('impact_shadow', { duration: 0.7 });

    const points: AmbientPointSource[] = [
      { id: 'campfire:1', kind: 'campfire', x: 1, y: 0, z: 1 },
      { id: 'rift_portal:2', kind: 'rift_portal', x: 2, y: 0, z: 2 },
      { id: 'rift_roller:3', kind: 'rift_roller', x: 3, y: 0, z: 3 },
      { id: 'hoard_entrance:4', kind: 'hoard_entrance', x: 4, y: 0, z: 4 },
    ];
    sfx.ambience('vale', false, null, false, 1, points);

    // Environment beds (global and point) land on the ambience bus...
    expect(busOf(sourceFor(4.01)), 'biome wind').toBe(ambient);
    expect(busOf(sourceFor(4.02)), 'procedural crowd').toBe(ambient);
    expect(busOf(sourceFor(4.03)), 'campfire station').toBe(ambient);
    // ...while gameplay-object emitters on the same path stay on effects.
    expect(busOf(sourceFor(4.04)), 'rift portal drone').toBe(master);
    expect(busOf(sourceFor(4.05)), 'rift boulder roll').toBe(master);
    expect(busOf(sourceFor(4.06)), 'buried hoard hum').toBe(master);

    // A combat one-shot plays on the effects master.
    sfx.playAt('impact_shadow', 0, 0, 0, { jitter: false });
    expect(busOf(sourceFor(0.7)), 'combat impact').toBe(master);
  });
});
