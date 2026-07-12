// Compatibility facade for non-positional UI and event sounds.
//
// GameAudio keeps the established HUD-facing method surface while delegating
// playback, loading, voice limits, and volume control to the sampled SFX engine.

import { sfx } from './sfx';

const READY_CHECK_BASE_GAIN = 0.32;

const UI_CUES = {
  bagOpen: 'ui_bag_open',
  bagClose: 'ui_bag_close',
  click: 'ui_click',
  coin: 'ui_coin',
  levelUp: 'ui_level_up',
  lootItem: 'ui_loot_item',
  questAccept: 'ui_quest_accept',
  questDone: 'ui_quest_done',
  whisper: 'ui_whisper',
  sheep: 'ui_sheep',
  death: 'ui_death',
  error: 'ui_error',
  duelChallenge: 'ui_duel_challenge',
  duelCountdown: 'ui_duel_countdown',
  duelStart: 'ui_duel_start',
  duelEnd: 'ui_duel_end',
  fiestaWords: ['ui_fiesta_word_0', 'ui_fiesta_word_1', 'ui_fiesta_word_2', 'ui_fiesta_word_3'],
  fiestaScoreMine: 'ui_fiesta_score_mine',
  fiestaScoreOther: 'ui_fiesta_score_other',
  fiestaWave: 'ui_fiesta_wave',
  fiestaAugment: 'ui_fiesta_augment',
  fiestaDown: 'ui_fiesta_down',
  fiestaRevive: 'ui_fiesta_revive',
} as const;

type UiCue =
  | Exclude<(typeof UI_CUES)[keyof typeof UI_CUES], readonly string[]>
  | (typeof UI_CUES.fiestaWords)[number];

export class GameAudio {
  private vol = 1;
  private readyCheckCtx: AudioContext | null = null;
  private readyCheckMaster: GainNode | null = null;

  /** Set SFX volume (0..1). Safe before init(). */
  setVolume(value: number): void {
    this.vol = Math.min(1, Math.max(0, value));
    sfx.setVolume(this.vol);
    if (this.readyCheckMaster) {
      this.readyCheckMaster.gain.value = READY_CHECK_BASE_GAIN * this.vol;
    }
  }

  get volume(): number {
    return this.vol;
  }

  /** Initialize sampled playback. Safe to call repeatedly after a user gesture. */
  init(): void {
    sfx.setVolume(this.vol);
    sfx.init();
    this.initReadyCheckChime();
  }

  private initReadyCheckChime(): void {
    if (this.readyCheckCtx) return;
    try {
      this.readyCheckCtx = new AudioContext();
      this.readyCheckMaster = this.readyCheckCtx.createGain();
      this.readyCheckMaster.gain.value = READY_CHECK_BASE_GAIN * this.vol;
      this.readyCheckMaster.connect(this.readyCheckCtx.destination);
    } catch {
      this.readyCheckCtx = null;
      this.readyCheckMaster = null;
    }
  }

  private readyCheckTone(frequency: number, duration: number, delay: number): void {
    if (!this.readyCheckCtx || !this.readyCheckMaster) return;
    const start = this.readyCheckCtx.currentTime + delay;
    const oscillator = this.readyCheckCtx.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    const gain = this.readyCheckCtx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.readyCheckMaster);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  private play(key: UiCue): void {
    sfx.playUi(key, { jitter: false });
  }

  bagOpen(): void {
    this.play(UI_CUES.bagOpen);
  }

  bagClose(): void {
    this.play(UI_CUES.bagClose);
  }

  click(): void {
    this.play(UI_CUES.click);
  }

  coin(): void {
    this.play(UI_CUES.coin);
  }

  levelUp(): void {
    this.play(UI_CUES.levelUp);
  }

  lootItem(): void {
    this.play(UI_CUES.lootItem);
  }

  questAccept(): void {
    this.play(UI_CUES.questAccept);
  }

  questDone(): void {
    this.play(UI_CUES.questDone);
  }

  readyCheck(): void {
    this.readyCheckTone(784, 0.16, 0);
    this.readyCheckTone(988, 0.16, 0.12);
    this.readyCheckTone(1319, 0.28, 0.24);
  }

  whisper(): void {
    this.play(UI_CUES.whisper);
  }

  sheep(): void {
    this.play(UI_CUES.sheep);
  }

  death(): void {
    this.play(UI_CUES.death);
  }

  error(): void {
    this.play(UI_CUES.error);
  }

  duelChallenge(): void {
    this.play(UI_CUES.duelChallenge);
  }

  duelCountdownTick(): void {
    this.play(UI_CUES.duelCountdown);
  }

  duelStart(): void {
    this.play(UI_CUES.duelStart);
  }

  duelEnd(): void {
    this.play(UI_CUES.duelEnd);
  }

  fiestaWord(tier = 0): void {
    const index = Math.max(0, Math.min(3, Math.floor(Number.isFinite(tier) ? tier : 0)));
    this.play(UI_CUES.fiestaWords[index]);
  }

  fiestaScorePing(mine: boolean): void {
    this.play(mine ? UI_CUES.fiestaScoreMine : UI_CUES.fiestaScoreOther);
  }

  fiestaWave(): void {
    this.play(UI_CUES.fiestaWave);
  }

  fiestaAugment(): void {
    this.play(UI_CUES.fiestaAugment);
  }

  fiestaDown(): void {
    this.play(UI_CUES.fiestaDown);
  }

  fiestaRevive(): void {
    this.play(UI_CUES.fiestaRevive);
  }
}

export const audio = new GameAudio();
