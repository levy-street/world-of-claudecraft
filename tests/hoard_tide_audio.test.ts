import { describe, expect, it, vi } from 'vitest';
import { HoardTideAudio } from '../src/game/hoard_tide_audio';
import type { HoardBossCueView } from '../src/world_api/dungeons';

function fixture(nowMs = () => 0) {
  const sink = { playAt: vi.fn(() => true), loop: vi.fn(), unloop: vi.fn() };
  return { sink, audio: new HoardTideAudio(sink, nowMs) };
}
function cue(remaining = 5): HoardBossCueView {
  return {
    instanceId: 1,
    cueId: 1,
    kind: 'sweep',
    variant: 'tide-wave',
    phase: 'warning',
    x: 10,
    z: 20,
    radius: 28,
    remaining,
    total: 5,
    facing: Math.PI / 2,
    waveLead: 2,
  };
}

describe('Hoard tide spatial audio', () => {
  it('sounds the lead once, then moves the rush panner with the authoritative crest', () => {
    const { sink, audio } = fixture();
    audio.sync([cue()], 3);
    audio.sync([cue(4.5)], 3);
    expect(sink.playAt).toHaveBeenCalledTimes(1);
    expect(sink.playAt).toHaveBeenCalledWith('hoard_tide_build', -4, 3, 20, {
      gain: 0.65,
      cooldown: 0,
      rate: 1.2,
    });
    expect(sink.loop).not.toHaveBeenCalled();
    audio.sync([cue(3)], 3);
    expect(sink.loop).toHaveBeenLastCalledWith(
      'hoard-tide:1:1',
      'hoard_tide_rush',
      0.48,
      -4,
      4,
      20,
      55,
      true,
    );
    audio.sync([cue(1.5)], 3);
    expect(sink.loop).toHaveBeenLastCalledWith(
      'hoard-tide:1:1',
      'hoard_tide_rush',
      0.48,
      10,
      4,
      20,
      55,
      true,
    );
  });

  it('crashes only after natural completion and never replays buildup on late join', () => {
    let now = 0;
    const { sink, audio } = fixture(() => now);
    audio.sync([cue(0.1)], 3);
    expect(sink.playAt).not.toHaveBeenCalled();
    now = 100;
    audio.sync([], 3);
    expect(sink.playAt).toHaveBeenCalledWith('hoard_tide_crash', 24, 3, 20, {
      gain: 0.8,
      cooldown: 0,
    });
    expect(sink.unloop).toHaveBeenCalledWith('hoard-tide:1:1', 0.12);
    sink.playAt.mockClear();
    audio.sync([cue(2)], 3);
    audio.sync([], 3);
    expect(sink.playAt).not.toHaveBeenCalled();
  });

  it('preserves the expiry crash across a long render frame but silences an early cancellation', () => {
    let now = 1000;
    const { sink, audio } = fixture(() => now);
    audio.sync([cue(0.8)], 3);
    now = 1950;
    audio.sync([], 3);
    expect(sink.playAt).toHaveBeenCalledWith('hoard_tide_crash', 24, 3, 20, {
      gain: 0.8,
      cooldown: 0,
    });
    sink.playAt.mockClear();
    audio.sync([cue(0.8)], 3);
    now += 400;
    audio.sync([], 3);
    expect(sink.playAt).not.toHaveBeenCalled();
  });

  it('disposes every simultaneous wave loop and bounds voice fanout', () => {
    const { sink, audio } = fixture();
    audio.sync(Array.from({ length: 20 }, (_, cueId) => ({ ...cue(2), cueId })));
    expect(sink.loop).toHaveBeenCalledTimes(8);
    audio.dispose();
    expect(sink.unloop).toHaveBeenCalledTimes(8);
    audio.sync([]);
    expect(sink.unloop).toHaveBeenCalledTimes(8);
  });

  it('routes player contact through the sampled spatial impact key', () => {
    const { sink, audio } = fixture();
    audio.hit(1, 2, 3);
    expect(sink.playAt).toHaveBeenCalledWith('hoard_tide_hit', 1, 2, 3, {
      gain: 0.72,
      cooldown: 0.08,
    });
  });
});
