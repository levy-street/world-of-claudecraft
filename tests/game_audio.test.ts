import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';
// @ts-expect-error untyped zero-dependency build tool (scripts/*.mjs convention)
import { ffmpegArgsForUiSfx, UI_SFX_CATALOG, UI_SFX_SPECS } from '../scripts/sfx/ui_sfx.mjs';

const sfxMock = vi.hoisted(() => ({
  init: vi.fn(),
  setVolume: vi.fn(),
  playUi: vi.fn(),
}));

vi.mock('../src/game/sfx', () => ({ sfx: sfxMock }));

import { GameAudio } from '../src/game/audio';

const ROOT = join(import.meta.dirname, '..');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sampled GameAudio facade', () => {
  it('preserves volume clamping and initialization through the sampled engine', () => {
    const audio = new GameAudio();
    expect(audio.volume).toBe(1);

    audio.setVolume(-4);
    expect(audio.volume).toBe(0);
    expect(sfxMock.setVolume).toHaveBeenLastCalledWith(0);

    audio.setVolume(4);
    expect(audio.volume).toBe(1);
    expect(sfxMock.setVolume).toHaveBeenLastCalledWith(1);

    audio.setVolume(0.42);
    sfxMock.setVolume.mockClear();
    audio.init();
    audio.init();
    expect(sfxMock.setVolume).toHaveBeenCalledTimes(2);
    expect(sfxMock.setVolume).toHaveBeenCalledWith(0.42);
    expect(sfxMock.init).toHaveBeenCalledTimes(2);
  });

  it('routes every non-parameterized live method to one editable sampled cue', () => {
    const audio = new GameAudio();
    const routes = [
      ['bagOpen', 'ui_bag_open'],
      ['bagClose', 'ui_bag_close'],
      ['click', 'ui_click'],
      ['coin', 'ui_coin'],
      ['levelUp', 'ui_level_up'],
      ['achievement', 'ui_achievement'],
      ['cosmeticUnlock', 'ui_cosmetic_unlock'],
      ['lootItem', 'ui_loot_item'],
      ['questDone', 'ui_quest_done'],
      ['whisper', 'ui_whisper'],
      ['sheep', 'ui_sheep'],
      ['death', 'ui_death'],
      ['arenaLoss', 'ui_arena_loss'],
      ['duelChallenge', 'ui_duel_challenge'],
      ['invitePrompt', 'ui_duel_challenge'],
      ['duelCountdownTick', 'ui_duel_countdown'],
      ['duelStart', 'ui_duel_start'],
      ['vcupKickoff', 'ui_vcup_kickoff'],
      ['duelEnd', 'ui_duel_end'],
      ['readyCheck', 'ui_ready_check'],
      ['weaponSheathe', 'ui_weapon_sheathe'],
      ['weaponUnsheathe', 'ui_weapon_unsheathe'],
      ['fiestaWave', 'ui_fiesta_wave'],
      ['fiestaAugment', 'ui_fiesta_augment'],
      ['fiestaDown', 'ui_fiesta_down'],
      ['fiestaRevive', 'ui_fiesta_revive'],
      ['cardPlay', 'ui_card_play'],
      ['cardReveal', 'ui_card_reveal'],
      ['cardRoundPush', 'ui_card_round_push'],
      ['cardShuffle', 'ui_card_shuffle'],
    ] as const;

    for (const [method, key] of routes) {
      audio[method]();
      expect(sfxMock.playUi).toHaveBeenLastCalledWith(key, { jitter: false });
    }
    expect(sfxMock.playUi).toHaveBeenCalledTimes(routes.length);
  });

  it('rate-limits the error cue so spamming a failure does not spam the sound', () => {
    const audio = new GameAudio();

    audio.error();
    expect(sfxMock.playUi).toHaveBeenLastCalledWith('ui_error', {
      jitter: false,
      cooldown: 1.5,
    });
    expect(sfxMock.playUi).toHaveBeenCalledTimes(1);
  });

  it('gates the feedback cues on setFeedbackEnabled but leaves timing/affordance cues alone', () => {
    const audio = new GameAudio();
    expect(audio.feedbackEnabled).toBe(true); // on by default (no change out of the box)

    audio.setFeedbackEnabled(false);
    expect(audio.feedbackEnabled).toBe(false);

    // The interface/feedback cues fall silent (loot, level, quest, whisper, etc.).
    const feedback = [
      'coin',
      'levelUp',
      'lootItem',
      'questDone',
      'whisper',
      'sheep',
      'death',
      'arenaLoss',
      'error',
      'invitePrompt',
    ] as const;
    for (const m of feedback) audio[m]();
    expect(sfxMock.playUi).not.toHaveBeenCalled();

    // Direct-affordance cues (you clicked/opened) and gameplay-timing cues (duel
    // countdown, fiesta) are NOT gated, so they still play.
    audio.click();
    audio.bagOpen();
    audio.duelCountdownTick();
    audio.fiestaWave();
    expect(sfxMock.playUi.mock.calls.map(([k]) => k)).toEqual([
      'ui_click',
      'ui_bag_open',
      'ui_duel_countdown',
      'ui_fiesta_wave',
    ]);

    // Re-enabling restores the feedback cues.
    audio.setFeedbackEnabled(true);
    audio.lootItem();
    expect(sfxMock.playUi).toHaveBeenLastCalledWith('ui_loot_item', { jitter: false });
  });

  it('maps all Fiesta word and score variants to separately editable clips', () => {
    const audio = new GameAudio();

    audio.fiestaWord(-10);
    audio.fiestaWord(1.9);
    audio.fiestaWord(2);
    audio.fiestaWord(99);
    audio.fiestaWord(Number.NaN);
    audio.fiestaScorePing(true);
    audio.fiestaScorePing(false);

    expect(sfxMock.playUi.mock.calls.map(([key]) => key)).toEqual([
      'ui_fiesta_word_0',
      'ui_fiesta_word_1',
      'ui_fiesta_word_2',
      'ui_fiesta_word_3',
      'ui_fiesta_word_0',
      'ui_fiesta_score_mine',
      'ui_fiesta_score_other',
    ]);
  });

  it('removes the ten procedural-only methods that have no call sites', () => {
    const obsolete = [
      'meleeHit',
      'meleeMiss',
      'hitTaken',
      'fire',
      'frost',
      'arcane',
      'castStart',
      'aggro',
      'drink',
      'eat',
    ];
    for (const method of obsolete) expect(method in GameAudio.prototype, method).toBe(false);
  });
});

describe('deterministic UI SFX catalog', () => {
  it('adds 14 unique UI cues to the authoritative studio inventory', () => {
    const keys = UI_SFX_CATALOG.map((cue: { key: string }) => cue.key);
    const fullCatalogKeys = new Set(SFX.map((cue: { key: string }) => cue.key));

    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key: string) => key.startsWith('ui_'))).toBe(true);
    expect(UI_SFX_CATALOG.every((cue: { generator: string }) => cue.generator === 'ffmpeg')).toBe(
      true,
    );
    for (const key of keys) expect(fullCatalogKeys.has(key), key).toBe(true);
  });

  it('builds stable shell-free FFmpeg arguments with fixed noise seeds', () => {
    for (const spec of UI_SFX_SPECS) {
      const first = ffmpegArgsForUiSfx(spec, '/tmp/cue.wav');
      const second = ffmpegArgsForUiSfx(spec, '/tmp/cue.wav');
      expect(first, spec.key).toEqual(second);
      expect(first[first.indexOf('-ar') + 1]).toBe('44100');
      expect(first[first.indexOf('-c:a') + 1]).toBe('pcm_s24le');
      expect(first[first.indexOf('-f') + 1]).toBe('lavfi');
      expect(first.at(-2)).toBe('wav');
      expect(first).toContain('+bitexact');
      expect(first.at(-1)).toBe('/tmp/cue.wav');
      const graph = first[first.indexOf('-filter_complex') + 1];
      expect(graph).toContain(`volume=${spec.masterGainDb}dB`);
      expect(graph).toContain('alimiter=limit=0.749894');
      expect(graph).toContain(':level=0:');
    }

    const runner = readFileSync(join(ROOT, 'scripts/gen_ui_sfx.mjs'), 'utf8');
    expect(runner).toContain('spawnSync(binary, args');
    expect(runner).toContain('conformSfxAudio({');
    expect(runner).not.toMatch(/\bexec(?:File|Sync)?\s*\(/);
    expect(runner).not.toContain('shell: true');

    const remoteGenerator = readFileSync(join(ROOT, 'scripts/gen_sfx.mjs'), 'utf8');
    expect(remoteGenerator).toContain("track.generator === 'ffmpeg'");
    expect(remoteGenerator).toContain('track.custom');
  });

  it('ships one compact generated MP3 for every UI catalog entry', () => {
    for (const cue of UI_SFX_CATALOG) {
      const path = join(ROOT, 'public/audio/sfx', `${cue.key}.mp3`);
      expect(existsSync(path), cue.key).toBe(true);
      expect(statSync(path).size, cue.key).toBeGreaterThan(5_000);
    }
  });
});
