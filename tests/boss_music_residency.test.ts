// The boss-fight track's decoded PCM fallback: prefetched on the engage edge
// everywhere except the iOS memory profile, where it is decoded only once the
// media element's play() is refused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bossPcmPrefetchAllowed } from '../src/game/boss_music_residency';

const BOSS_URL = '/audio/dungeon-boss-fight.mp3';

class FakeParam {
  value = 0;
  setTargetAtTime(value: number): void {
    this.value = value;
  }
}

class FakeNode {
  connect(): this {
    return this;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeBufferSource extends FakeNode {
  static instances: FakeBufferSource[] = [];
  buffer: unknown = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    super();
    FakeBufferSource.instances.push(this);
  }
}

class FakeAudio {
  static refuse = false;
  loop = false;
  preload = '';
  paused = true;
  currentTime = 0;
  volume = 1;
  constructor(public src: string) {}
  play = vi.fn(async () => {
    if (FakeAudio.refuse) throw new DOMException('refused', 'NotAllowedError');
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  state = 'running';
  destination = new FakeNode();
  decodeAudioData = vi.fn(async () => ({ decoded: true }));
  createGain = () => new FakeGain();
  createDynamicsCompressor = () =>
    Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  createMediaElementSource = () => new FakeNode();
  createBufferSource = () => new FakeBufferSource();
  resume = vi.fn(async () => undefined);
}

let fetchMock: ReturnType<typeof vi.fn>;

async function engageBoss(ios: boolean) {
  if (ios) {
    vi.doMock('../src/render/gfx', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/render/gfx')>();
      return { ...actual, GFX: { ...actual.GFX, iosMemoryProfile: true } };
    });
  }
  const { MusicDirector } = await import('../src/game/music');
  const director = new MusicDirector();
  director.init();
  director.setBossCombat(true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  return director;
}

const bossFetches = (): number =>
  fetchMock.mock.calls.filter(([url]) => String(url) === BOSS_URL).length;

beforeEach(() => {
  vi.resetModules();
  FakeAudio.refuse = false;
  FakeBufferSource.instances = [];
  fetchMock = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    setInterval: vi.fn(() => 1),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.doUnmock('../src/render/gfx');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bossPcmPrefetchAllowed', () => {
  it('prefetches off the iOS memory profile and defers on it', () => {
    expect(bossPcmPrefetchAllowed({ iosMemoryProfile: false })).toBe(true);
    expect(bossPcmPrefetchAllowed({ iosMemoryProfile: true })).toBe(false);
  });
});

describe('boss track PCM on desktop and Android (unchanged)', () => {
  it('still decodes the fallback on the engage edge even when the element plays', async () => {
    const { GFX } = await import('../src/render/gfx');
    expect(GFX.iosMemoryProfile).toBe(false);
    await engageBoss(false);
    expect(bossFetches()).toBe(1);
    expect(FakeBufferSource.instances).toHaveLength(0);
  });
});

describe('boss track PCM on the iOS memory profile', () => {
  it('never fetches or decodes the fallback while the media element plays', async () => {
    await engageBoss(true);
    expect(bossFetches()).toBe(0);
  });

  it('still falls back to the decoded loop when the element is refused', async () => {
    FakeAudio.refuse = true;
    await engageBoss(true);
    expect(bossFetches()).toBe(1);
    const source = FakeBufferSource.instances.at(-1);
    expect(source?.loop).toBe(true);
    expect(source?.start).toHaveBeenCalledTimes(1);
  });
});
