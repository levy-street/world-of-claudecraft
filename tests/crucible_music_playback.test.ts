import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRUCIBLE_STREAM_URLS, type CrucibleFloor } from '../src/game/crucible_music';
import { MusicDirector } from '../src/game/music';
import { COMBAT_STREAM_URLS } from '../src/game/music_tracks';

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number, _time?: number, _constant?: number) => {
    this.value = value;
  });
}

class FakeNode {
  connect = vi.fn(() => this);
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  loop = false;
  preload = '';
  paused = true;
  currentTime = 0;
  muted = false;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor(public src: string) {
    FakeAudio.instances.push(this);
  }
}

class FakeContext {
  currentTime = 0;
  destination = new FakeNode();
  createGain = vi.fn(() => new FakeGain());
  createMediaElementSource = vi.fn(() => new FakeNode());
  createDynamicsCompressor = vi.fn(() => ({
    ...new FakeNode(),
    threshold: new FakeParam(),
    knee: new FakeParam(),
    ratio: new FakeParam(),
    attack: new FakeParam(),
    release: new FakeParam(),
  }));
  resume = vi.fn(async () => undefined);
}

interface Stream {
  el: FakeAudio | null;
  target: number;
  gain: FakeGain;
}

interface Internals {
  ctx: FakeContext;
  master: FakeGain;
  crucibleStreams: Partial<Record<CrucibleFloor, Stream>>;
  zoneStreams: Partial<Record<string, Stream>>;
  combatStreams: Stream[];
  streamKeeper(): void;
}

describe('Crucible floor soundtrack playback', () => {
  let director: MusicDirector;
  let inner: Internals;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    director = new MusicDirector();
    director.init();
    inner = director as unknown as Internals;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeAudio.instances = [];
  });

  const element = (floor: CrucibleFloor): FakeAudio => {
    const el = inner.crucibleStreams?.[floor]?.el;
    if (!el) throw new Error(`Missing floor ${floor} stream`);
    return el;
  };

  it.each([1, 2, 3, 4] as const)('plays only floor %s through combat and quiet', (floor) => {
    director.update('vale', false);
    director.update('vale', true);
    director.update('ignivar_raid_arena', true, floor);
    const el = element(floor);
    expect(el.src).toBe(CRUCIBLE_STREAM_URLS[floor]);
    expect(el.loop).toBe(true);
    expect(el.preload).toBe('auto');
    expect(inner.crucibleStreams[floor]?.target).toBe(1);
    expect(inner.zoneStreams.vale?.target).toBe(0);
    expect(inner.combatStreams.every((stream) => stream.target === 0)).toBe(true);
    el.currentTime = 97;
    director.update('ignivar_raid_arena', false, floor);
    director.update('ignivar_raid_arena', true, floor);
    expect(el.currentTime).toBe(97);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(inner.zoneStreams.ignivar_raid_arena).toBeUndefined();
    expect(inner.combatStreams.every((stream) => stream.target === 0)).toBe(true);
  });

  it('downloads only the current floor, including when the keeper runs', () => {
    expect(FakeAudio.instances.map((el) => el.src)).toEqual(COMBAT_STREAM_URLS);
    director.update('ignivar_raid_arena', false, 3);
    inner.streamKeeper();
    expect(FakeAudio.instances.map((el) => el.src)).toEqual([
      ...COMBAT_STREAM_URLS,
      CRUCIBLE_STREAM_URLS[3],
    ]);
    expect(Object.keys(inner.crucibleStreams)).toEqual(['3']);
  });

  it('fades the old floor quickly, pauses it, and starts every floor entry at the beginning', () => {
    director.update('ignivar_raid_arena', false, 1);
    element(1).currentTime = 80;
    director.update('ignivar_raid_arena', false, 2);
    expect(element(2).currentTime).toBe(0);
    expect(inner.crucibleStreams[1]?.target).toBe(0);
    expect(inner.crucibleStreams[2]?.target).toBe(1);
    const out = inner.crucibleStreams[1]?.gain.gain.setTargetAtTime.mock.calls.at(-1);
    const incoming = inner.crucibleStreams[2]?.gain.gain.setTargetAtTime.mock.calls.at(-1);
    expect(out?.[2]).toBeLessThan(incoming?.[2] as number);
    inner.ctx.currentTime += 5;
    inner.streamKeeper();
    expect(element(1).paused).toBe(true);
    director.update('ignivar_raid_arena', false, 1);
    expect(element(1).currentTime).toBe(0);
    expect(element(1).paused).toBe(false);
    expect(Object.keys(inner.crucibleStreams)).toHaveLength(2);
  });

  it('reuses at most four streams through repeated runs of the whole raid', () => {
    for (let run = 0; run < 3; run++) {
      for (const floor of [1, 2, 3, 4] as const) {
        director.update('ignivar_raid_arena', true, floor);
        expect(element(floor).currentTime).toBe(0);
        element(floor).currentTime = 40;
      }
      director.update('vale', false);
    }
    expect(Object.keys(inner.crucibleStreams)).toHaveLength(4);
    const floorElements = FakeAudio.instances.filter((el) =>
      Object.values(CRUCIBLE_STREAM_URLS).includes(el.src),
    );
    expect(floorElements).toHaveLength(4);
  });

  it.each([false, true])('restores normal music on exit with combat=%s', (combat) => {
    director.update('ignivar_raid_arena', true, 4);
    director.update('vale', combat);
    expect(inner.crucibleStreams[4]?.target).toBe(0);
    expect(inner.combatStreams.filter((stream) => stream.target === 1)).toHaveLength(
      combat ? 1 : 0,
    );
    expect(inner.zoneStreams.vale?.target ?? 0).toBe(combat ? 0 : 1);
    element(4).currentTime = 160;
    director.update('ignivar_raid_arena', true, 4);
    expect(element(4).currentTime).toBe(0);
  });

  it.each(['disabled', 'volume', 'menu'] as const)(
    'shares %s pause and immediate restore without rewinding',
    (mode) => {
      director.update('ignivar_raid_arena', true, 4);
      const el = element(4);
      el.currentTime = 130;
      if (mode === 'disabled') director.setEnabled(false);
      if (mode === 'volume') director.setVolume(0);
      if (mode === 'menu') director.pauseForMenu();
      expect(inner.master.gain.value).toBe(0);
      inner.streamKeeper();
      inner.ctx.currentTime += 5;
      inner.streamKeeper();
      expect(el.paused).toBe(true);
      if (mode === 'disabled') director.setEnabled(true);
      if (mode === 'volume') director.setVolume(0.4);
      if (mode === 'menu') director.resumeFromMenu();
      expect(el.paused).toBe(false);
      expect(el.currentTime).toBe(130);
      expect(inner.master.gain.value).toBeCloseTo(mode === 'volume' ? 0.2 : 0.5);
    },
  );

  it('delays the floor download until music is enabled and only downloads the latest floor', () => {
    director.setEnabled(false);
    const before = FakeAudio.instances.length;
    director.update('ignivar_raid_arena', false, 1);
    director.update('ignivar_raid_arena', true, 2);
    inner.streamKeeper();
    expect(FakeAudio.instances).toHaveLength(before);
    director.setEnabled(true);
    expect(FakeAudio.instances).toHaveLength(before + 1);
    expect(element(2).src).toBe(CRUCIBLE_STREAM_URLS[2]);
    expect(inner.crucibleStreams[1]?.el).toBeNull();
  });

  it('uses the WebAudio route and silences a failed route rather than bypassing volume', () => {
    inner.ctx.createMediaElementSource.mockImplementationOnce(() => {
      throw new Error('No route');
    });
    director.update('ignivar_raid_arena', false, 3);
    expect(element(3).muted).toBe(true);
  });
});
