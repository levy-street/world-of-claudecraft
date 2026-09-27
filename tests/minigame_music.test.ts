import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MINIGAME_MUSIC_URLS,
  type MinigameTrack,
  resolveActiveMinigameTrack,
} from '../src/game/minigame_music';
import { minigameLayerFor } from '../src/game/minigame_music_layer';
import { MusicDirector } from '../src/game/music';
import type { WorldQuestProgress } from '../src/sim/types';

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number, _startTime?: number, _timeConstant?: number) => {
    this.value = value;
  });
}

class FakeNode {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  loop = false;
  preload = '';
  paused = true;
  currentTime = 0;
  volume = 1;
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

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  decodeAudioData = vi.fn(async () => ({ decoded: true }));
  createGain = vi.fn(() => new FakeGain());
  createDynamicsCompressor = vi.fn(() => ({
    ...new FakeNode(),
    threshold: new FakeParam(),
    knee: new FakeParam(),
    ratio: new FakeParam(),
    attack: new FakeParam(),
    release: new FakeParam(),
  }));
  createMediaElementSource = vi.fn(() => new FakeNode());
  createBufferSource = vi.fn(() => new FakeBufferSource());
  resume = vi.fn(async () => undefined);
}

interface FakeStream {
  el: FakeAudio | null;
  gain: FakeGain;
  target: number;
  silentAt: number;
}

interface DirectorInternals {
  ctx: FakeAudioContext;
  timer: number;
  zoneStreams: Partial<Record<string, FakeStream>>;
  combatStreams: FakeStream[];
  streamKeeper(): void;
}

const internals = (director: MusicDirector): DirectorInternals =>
  director as unknown as DirectorInternals;

describe('minigame music assets', () => {
  const publicDir = path.join(__dirname, '..', 'public');

  it('maps all 10 activities to existing MP3 files', () => {
    const tracks: MinigameTrack[] = [
      'forge',
      'cannon',
      'glider',
      'pacman',
      'shadow',
      'match3',
      'puzzle',
      'investigation',
      'calligraphy',
      'caravan',
    ];

    for (const track of tracks) {
      const url = MINIGAME_MUSIC_URLS[track];
      expect(url).toBeDefined();
      const relative = url.replace(/^\//, '');
      const filePath = path.join(publicDir, ...relative.split('/'));
      expect(existsSync(filePath), `Asset missing for ${track}: ${filePath}`).toBe(true);
    }
  });
});

describe('resolveActiveMinigameTrack', () => {
  it('returns null when no minigame activity is active', () => {
    const track = resolveActiveMinigameTrack({});
    expect(track).toBeNull();
  });

  it('prioritizes active match-3 puzzle modal', () => {
    const track = resolveActiveMinigameTrack({
      activePuzzleQuestId: 'wq_palmreach_confections',
    });
    expect(track).toBe('match3');
  });

  it('resolves leyline or generic puzzle modal to puzzle track', () => {
    const track = resolveActiveMinigameTrack({
      activePuzzleQuestId: 'wq_frostveil_runes',
    });
    expect(track).toBe('puzzle');
  });

  it('resolves active cannon vehicle session to cannon track', () => {
    const track = resolveActiveMinigameTrack({
      vehicleSession: { stationId: 'cannon_01' },
    });
    expect(track).toBe('cannon');
  });

  it('resolves glider slalom flight to glider track', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_galecrest_slalom', {
      questId: 'wq_galecrest_slalom',
      state: 'active',
      glider: {
        phase: 'flying',
        gateIndex: 2,
        ringsPassed: 2,
        totalGates: 10,
        bonusOrbs: 0,
        speedMultiplier: 1,
        altitudePenalty: 0,
        elapsedSeconds: 15,
        energyRemaining: 80,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBe('glider');
  });

  it('resolves forge workshop to forge track', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_evergarden_forging', {
      questId: 'wq_evergarden_forging',
      state: 'active',
      forging: {
        phase: 'working',
        currentStage: 1,
        totalStages: 3,
        heat: 50,
        purity: 60,
        elapsedSeconds: 10,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBe('forge');
  });

  it('resolves wisp maze to pacman track when unpaused', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_evergarden_wisp_maze', {
      questId: 'wq_evergarden_wisp_maze',
      state: 'active',
      wispMaze: {
        phase: 'active',
        paused: false,
        score: 100,
        pelletsRemaining: 40,
        superCharges: 1,
        lives: 3,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBe('pacman');

    // When paused, should not trigger pacman music
    log.set('wq_evergarden_wisp_maze', {
      questId: 'wq_evergarden_wisp_maze',
      state: 'active',
      wispMaze: {
        phase: 'active',
        paused: true,
        score: 100,
        pelletsRemaining: 40,
        superCharges: 1,
        lives: 3,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBeNull();
  });

  it('resolves shadow stealth infiltration to shadow track', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_wraithwood_restless', {
      questId: 'wq_wraithwood_restless',
      state: 'active',
      shadow: {
        phase: 'cloaked',
        suspicion: 10,
        cooldown: 0,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBe('shadow');
  });

  it('resolves calligraphy tracing to calligraphy track', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_eastbrook_calligraphy', {
      questId: 'wq_eastbrook_calligraphy',
      state: 'active',
      tracing: {
        phase: 'drawing',
        shapeIndex: 1,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBe('calligraphy');
  });

  it('resolves infiltrator investigation to investigation track', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_mirefen_infiltrator', {
      questId: 'wq_mirefen_infiltrator',
      state: 'active',
      investigation: {
        cluesFound: 2,
        totalClues: 4,
      },
    } as unknown as WorldQuestProgress);

    expect(resolveActiveMinigameTrack({ worldQuestLog: log })).toBe('investigation');

    // Proximity check without explicit investigation data
    const logNoSub = new Map<string, WorldQuestProgress>();
    logNoSub.set('wq_mirefen_infiltrator', {
      questId: 'wq_mirefen_infiltrator',
      state: 'active',
    } as unknown as WorldQuestProgress);

    expect(
      resolveActiveMinigameTrack({
        worldQuestLog: logNoSub,
        playerPos: { x: -6, z: 284 },
      }),
    ).toBe('investigation');

    // Far from center returns null
    expect(
      resolveActiveMinigameTrack({
        worldQuestLog: logNoSub,
        playerPos: { x: 500, z: 500 },
      }),
    ).toBeNull();
  });

  it('resolves caravan escort to caravan track only when in proximity', () => {
    const log = new Map<string, WorldQuestProgress>();
    log.set('wq_eastbrook_caravan', {
      questId: 'wq_eastbrook_caravan',
      state: 'active',
    } as unknown as WorldQuestProgress);

    const entities = [
      {
        templateId: 'eastbrook_freight_caravan',
        pos: { x: 100, z: 200 },
      },
    ];

    // Near caravan (< 50 units)
    expect(
      resolveActiveMinigameTrack({
        worldQuestLog: log,
        playerPos: { x: 110, z: 205 },
        entities,
      }),
    ).toBe('caravan');

    // Far from caravan (> 50 units)
    expect(
      resolveActiveMinigameTrack({
        worldQuestLog: log,
        playerPos: { x: 200, z: 300 },
        entities,
      }),
    ).toBeNull();
  });
});

describe('MusicDirector minigame track playback and ducking', () => {
  let director: MusicDirector;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    director = new MusicDirector();
    director.init();
  });

  afterEach(() => {
    clearInterval(internals(director).timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeAudio.instances = [];
  });

  it('sets up looping stream and ducks ambient music when minigame starts', () => {
    // Start ambient vale music
    director.update('vale', false);
    expect(internals(director).zoneStreams.vale?.target).toBe(1);

    // Enter glider minigame
    minigameLayerFor(director).set('glider');
    expect(minigameLayerFor(director).active).toBe('glider');

    // Glider stream target should be 1, loop should be true, vale should be ducked to 0
    const gliderStream = minigameLayerFor(director).streamsByTrack.glider;
    expect(gliderStream?.target).toBe(1);
    expect(gliderStream?.el?.src).toBe(MINIGAME_MUSIC_URLS.glider);
    expect(gliderStream?.el?.loop).toBe(true);
    expect(internals(director).zoneStreams.vale?.target).toBe(0);

    // Frame updates while in minigame should not restore ambient music
    director.update('vale', false);
    expect(internals(director).zoneStreams.vale?.target).toBe(0);
    expect(gliderStream?.target).toBe(1);
  });

  it('ducks combat music when minigame is active', () => {
    director.update('vale', true);
    const combatActiveBefore = internals(director).combatStreams.some((s) => s.target === 1);
    expect(combatActiveBefore).toBe(true);

    minigameLayerFor(director).set('cannon');
    expect(minigameLayerFor(director).active).toBe('cannon');

    const cannonStream = minigameLayerFor(director).streamsByTrack.cannon;
    expect(cannonStream?.target).toBe(1);
    for (const combat of internals(director).combatStreams) {
      expect(combat.target).toBe(0);
    }
  });

  it('restores ambient music when minigame ends', () => {
    director.update('vale', false);
    minigameLayerFor(director).set('forge');
    expect(minigameLayerFor(director).streamsByTrack.forge?.target).toBe(1);
    expect(internals(director).zoneStreams.vale?.target).toBe(0);

    // Exit minigame
    minigameLayerFor(director).set(null);
    expect(minigameLayerFor(director).active).toBeNull();
    expect(minigameLayerFor(director).streamsByTrack.forge?.target).toBe(0);
    expect(internals(director).zoneStreams.vale?.target).toBe(1);
  });

  it('smoothly transitions between two different minigames', () => {
    minigameLayerFor(director).set('match3');
    expect(minigameLayerFor(director).streamsByTrack.match3?.target).toBe(1);

    minigameLayerFor(director).set('puzzle');
    expect(minigameLayerFor(director).streamsByTrack.match3?.target).toBe(0);
    expect(minigameLayerFor(director).streamsByTrack.puzzle?.target).toBe(1);
  });
});

describe('the minigame layer host seam', () => {
  it('stays welded to the private MusicDirector members it reads and its three hooks', () => {
    const source = readFileSync(new URL('../src/game/music.ts', import.meta.url), 'utf8');
    for (const anchor of [
      'private ctx: AudioContext | null = null;',
      'private zoneStreams: Partial<Record<MusicZone, StreamTrack>> = {};',
      'private combatStreams: StreamTrack[] = [];',
      'private zone: MusicZone | null = null;',
      'private combat = false;',
      'private makeStream(url: string): StreamTrack | null {',
      'private setStreamTarget(stream: StreamTrack, target: number, fadeSeconds: number): void {',
      'update(zone: MusicZone, inCombat: boolean, crucibleFloor: CrucibleFloor | null = null): void {',
      'minigameLayerFor(this).rewind();',
      'yield* minigameLayerFor<StreamTrack>(this).streams();',
      'if (minigameLayerFor(this).active !== null) return;',
    ]) {
      expect(source, anchor).toContain(anchor);
    }
  });
});
