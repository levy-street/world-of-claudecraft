import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimFuryAudio, clearFuryAudioClaim, FURY_AUDIO } from '../src/fury_audio_core';
import { sfx } from '../src/game/sfx';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { preparedAbilityAudio, type SpatialAudioSink } from '../src/render/audio_sink';
import type { SimEvent } from '../src/sim/types';
import { impactCueForDamage, playerSwingCueForDamage } from '../src/ui/combat_sfx';
import { StudioCombatAudio } from '../src/vfx_studio/combat_audio';
import { DEFAULT_STUDIO_CONFIG, StudioSession } from '../src/vfx_studio/session';

afterEach(() => vi.restoreAllMocks());

describe('Fury audio consumer integration', () => {
  it('warms every missing take in one request batch and keeps cold events unclaimed', () => {
    const sink = { abilityAudio: vi.fn(), isBuffered: vi.fn(() => false), preload: vi.fn() };
    const queue = new FuryAudioQueue();
    const event = {};
    const host = { anchorOf: vi.fn(), abilityAudio: sink.abilityAudio } as unknown as SequencerHost;
    expect(
      queue.reserve(host, event, 'red_harvest', 1, 2, 1, (key) =>
        preparedAbilityAudio(sink as unknown as SpatialAudioSink, key),
      ),
    ).toBe(false);
    expect(sink.preload.mock.calls.map(([key]) => key)).toEqual([
      FURY_AUDIO.red_harvest.release,
      ...FURY_AUDIO.red_harvest.impacts,
    ]);
    expect(host.anchorOf).not.toHaveBeenCalled();
    sink.isBuffered.mockReturnValue(true);
    sink.preload.mockClear();
    expect(
      preparedAbilityAudio(sink as unknown as SpatialAudioSink, FURY_AUDIO.red_harvest.release),
    ).toBe(true);
    expect(sink.preload).not.toHaveBeenCalled();
    expect(preparedAbilityAudio(null, FURY_AUDIO.red_harvest.release)).toBe(false);
  });

  it('suppresses only owned ordinary contacts while retaining block and crit feedback in Studio', () => {
    const session = new StudioSession({ ...DEFAULT_STUDIO_CONFIG, cls: 'warrior', spec: 'fury' });
    const source = session.sim.player;
    const target = session.sim.entities.get(session.targetIds[0])!;
    const event: Extract<SimEvent, { type: 'damage' }> = {
      type: 'damage',
      sourceId: source.id,
      targetId: target.id,
      amount: 10,
      kind: 'hit',
      school: 'physical',
      crit: true,
      absorbed: 5,
      abilityId: 'raging_gale',
      ability: 'Twinstrike',
    };
    expect(playerSwingCueForDamage(event, source)).not.toBeNull();
    expect(impactCueForDamage(event, target)).not.toBeNull();
    claimFuryAudio(event);
    expect(playerSwingCueForDamage(event, source)).toBeNull();
    expect(impactCueForDamage(event, target)).toBeNull();
    const sink = { playAt: vi.fn(), loop: vi.fn(), unloop: vi.fn(), preload: vi.fn() };
    new StudioCombatAudio(sink).event(event, session.sim.entities, source.id);
    expect(sink.playAt.mock.calls.map(([key]) => key)).toContain('combat_block');
    expect(sink.playAt.mock.calls.map(([key]) => key)).toContain('combat_crit');
    expect(sink.playAt.mock.calls.some(([key]) => /^(melee_|impact_)/.test(key))).toBe(false);
    clearFuryAudioClaim(event);
    expect(playerSwingCueForDamage(event, source)).not.toBeNull();
    expect(impactCueForDamage(event, target)).not.toBeNull();
  });

  it('plays only the prepared Fury recording and preserves fixed pitch and finisher weight', () => {
    const internal = sfx as unknown as { ctx: unknown; master: unknown };
    const old = { ctx: internal.ctx, master: internal.master };
    internal.ctx = {};
    internal.master = {};
    const play = vi.spyOn(sfx, 'playAt').mockReturnValue(true);
    try {
      sfx.abilityAudio('impact', 'physical', 1, 0, 0, 0, {
        abilityId: 'red_harvest',
        sample: FURY_AUDIO.red_harvest.impacts[2],
        finisher: true,
      });
      expect(play).toHaveBeenCalledExactlyOnceWith(
        FURY_AUDIO.red_harvest.impacts[2],
        0,
        0,
        0,
        expect.objectContaining({ gain: 0.95, rate: 1, jitter: false, cooldown: 0 }),
      );
      play.mockClear();
      sfx.abilityAudio('impact', 'physical', 1, 0, 0, 0, { abilityId: 'red_harvest' });
      sfx.abilityAudio('impact', 'physical', 1, 0, 0, 0, {
        abilityId: 'red_harvest',
        sample: FURY_AUDIO.raging_gale.impacts[0],
      });
      expect(play).not.toHaveBeenCalled();
    } finally {
      internal.ctx = old.ctx;
      internal.master = old.master;
    }
  });
});
