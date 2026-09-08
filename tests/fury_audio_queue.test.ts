import { describe, expect, it, vi } from 'vitest';
import { FURY_AUDIO, furyAudioClaimed, MELEE_AUDIO } from '../src/fury_audio_core';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';

function setup() {
  const abilityAudio = vi.fn();
  const anchorOf = vi.fn((id: number, _height: number, out = { x: 0, y: 0, z: 0 }) =>
    Object.assign(out, { x: id * 2, y: 1, z: id * 3 }),
  );
  const host = { abilityAudio, anchorOf } as unknown as SequencerHost;
  return { queue: new FuryAudioQueue(), host, abilityAudio, anchorOf };
}

describe('retained Fury audio', () => {
  it.each([
    'raging_gale',
    'red_harvest',
    'mortal_strike',
    'execute',
    'bloodthirst',
    'victory_rush',
    'shield_slam',
  ] as const)('plays %s contacts once on the authored times', (id) => {
    const h = setup(),
      cue = MELEE_AUDIO[id];
    for (const _key of cue.impacts) {
      const event = {};
      expect(h.queue.reserve(h.host, event, id, 1, 2, 1, () => true)).toBe(true);
      expect(furyAudioClaimed(event)).toBe(true);
    }
    expect(h.abilityAudio.mock.calls.map((c) => c[6].sample)).toEqual([cue.release]);
    for (const dt of [0, Number.NaN, -1]) h.queue.update(h.host, dt);
    expect(h.abilityAudio).toHaveBeenCalledTimes(1);
    let time = 0;
    for (let beat = 0; beat < cue.times.length; beat++) {
      h.queue.update(h.host, cue.times[beat] - time - 0.0001);
      expect(h.abilityAudio).toHaveBeenCalledTimes(beat + 1);
      h.queue.update(h.host, 0.00011);
      time = cue.times[beat] + 0.00001;
      expect(h.abilityAudio.mock.calls.at(-1)?.[6]).toEqual(
        expect.objectContaining({
          sample: cue.impacts[beat],
          finisher: (id === 'red_harvest' && beat === 2) || id === 'execute',
        }),
      );
    }
    h.queue.update(h.host, 2);
    expect(h.abilityAudio).toHaveBeenCalledTimes(cue.impacts.length + 1);
  });

  it('keeps miss and absorption outcomes separate from flesh impacts', () => {
    const h = setup();
    for (const outcome of [0, 2, 1] as const)
      h.queue.reserve(h.host, {}, 'red_harvest', 1, 2, outcome, () => true);
    h.queue.update(h.host, 0.7);
    expect(h.abilityAudio.mock.calls.map((c) => c[6].sample)).toEqual([
      FURY_AUDIO.red_harvest.release,
      FURY_AUDIO.red_harvest.impacts[2],
    ]);
  });

  it('shares the source release while retaining each actual secondary contact', () => {
    const h = setup();
    for (const target of [2, 3])
      for (let beat = 0; beat < 2; beat++)
        h.queue.reserve(h.host, {}, 'raging_gale', 1, target, 1, () => true);
    h.queue.update(h.host, 0.4);
    expect(h.abilityAudio.mock.calls.filter((c) => c[0] === 'release')).toHaveLength(1);
    const impacts = h.abilityAudio.mock.calls.filter((c) => c[0] === 'impact');
    expect(impacts).toHaveLength(4);
    expect(impacts.filter((c) => c[3] === 6 && c[6].lite === true)).toHaveLength(2);
    expect(impacts.filter((c) => c[3] === 4 && c[6].lite === false)).toHaveLength(2);
  });

  it('retains last known victim coordinates when visual anchors disappear, and clears pending cues', () => {
    const h = setup();
    h.queue.reserve(h.host, {}, 'raging_gale', 1, 2, 1, () => true);
    h.anchorOf.mockImplementation(() => undefined as never);
    h.queue.update(h.host, 0.2);
    expect(h.abilityAudio.mock.calls.at(-1)?.slice(3, 6)).toEqual([4, 1, 6]);
    const fresh = setup();
    fresh.queue.reserve(fresh.host, {}, 'red_harvest', 1, 2, 1, () => true);
    fresh.queue.clear();
    fresh.queue.update(fresh.host, 0.7);
    expect(fresh.abilityAudio.mock.calls.map((c) => c[0])).toEqual(['release']);
  });

  it('leaves ordinary feedback unclaimed when any take, source anchor or queue slot is missing', () => {
    const h = setup();
    const cold = {},
      absent = {},
      full = {};
    expect(
      h.queue.reserve(
        h.host,
        cold,
        'raging_gale',
        1,
        2,
        1,
        (key) => key !== FURY_AUDIO.raging_gale.impacts[1],
      ),
    ).toBe(false);
    h.anchorOf.mockImplementationOnce((_id, _height, out = { x: 0, y: 0, z: 0 }) => out);
    h.anchorOf.mockImplementationOnce(() => undefined as never);
    expect(h.queue.reserve(h.host, absent, 'raging_gale', 1, 2, 1, () => true)).toBe(false);
    for (let caster = 1; caster <= 24; caster++)
      expect(h.queue.reserve(h.host, {}, 'raging_gale', caster, caster + 100, 1, () => true)).toBe(
        true,
      );
    expect(h.queue.reserve(h.host, full, 'raging_gale', 25, 125, 1, () => true)).toBe(false);
    for (const event of [cold, absent, full]) expect(furyAudioClaimed(event)).toBe(false);
    h.queue.update(h.host, 0.8);
    expect(h.queue.reserve(h.host, full, 'raging_gale', 25, 125, 1, () => true)).toBe(true);
  });
});
