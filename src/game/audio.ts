// Compatibility facade for non-positional UI and event sounds.
//
// GameAudio keeps the established HUD-facing method surface while delegating
// playback, loading, voice limits, and volume control to the sampled SFX engine.

import { sfx } from './sfx';

// The small procedural WebAudio bed still used by the cues that have no sampled
// catalog key yet (the ready-check chime and the weapon sheathe/draw pair).
const PROCEDURAL_BASE_GAIN = 0.32;
const NOISE_BUFFER_SECONDS = 1;

const UI_CUES = {
  bagOpen: 'ui_bag_open',
  bagClose: 'ui_bag_close',
  click: 'ui_click',
  coin: 'ui_coin',
  levelUp: 'ui_level_up',
  achievement: 'ui_achievement',
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
  private cueCtx: AudioContext | null = null;
  private cueMaster: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  // Gates the discrete interface/feedback cues (loot, level, quest, whisper, error,
  // ...) plus the combat avoid cues the HUD reads via `feedbackEnabled`. On by
  // default; driven by the `interfaceSfx` setting. World/spatial sounds and the
  // gameplay-timing cues (ready check, duel countdown) are unaffected.
  private feedbackOn = true;

  /** Set SFX volume (0..1). Safe before init(). */
  setVolume(value: number): void {
    this.vol = Math.min(1, Math.max(0, value));
    sfx.setVolume(this.vol);
    if (this.cueMaster) {
      this.cueMaster.gain.value = PROCEDURAL_BASE_GAIN * this.vol;
    }
  }

  get volume(): number {
    return this.vol;
  }

  /** Enable/disable the interface and feedback cues (the `interfaceSfx` setting).
   *  On by default; when off, the notification "beeps" fall silent while the SFX
   *  volume slider and the spatial world sounds are untouched. Safe before init(). */
  setFeedbackEnabled(value: boolean): void {
    this.feedbackOn = value;
  }

  /** Whether the interface/feedback cues are on. The HUD reads this to gate the
   *  combat avoid cues (miss/dodge/parry) it plays through the spatial engine. */
  get feedbackEnabled(): boolean {
    return this.feedbackOn;
  }

  /** Initialize sampled playback. Safe to call repeatedly after a user gesture. */
  init(): void {
    sfx.setVolume(this.vol);
    sfx.init();
    this.initCueSynth();
  }

  private initCueSynth(): void {
    if (this.cueCtx) return;
    try {
      this.cueCtx = new AudioContext();
      this.cueMaster = this.cueCtx.createGain();
      this.cueMaster.gain.value = PROCEDURAL_BASE_GAIN * this.vol;
      this.cueMaster.connect(this.cueCtx.destination);
    } catch {
      this.cueCtx = null;
      this.cueMaster = null;
    }
  }

  private readyCheckTone(frequency: number, duration: number, delay: number): void {
    if (!this.cueCtx || !this.cueMaster) return;
    const start = this.cueCtx.currentTime + delay;
    const oscillator = this.cueCtx.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    const gain = this.cueCtx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.cueMaster);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  /** The shared white-noise buffer the scrape cues sample, built on first use.
   *  Kept OUT of initCueSynth: a context that cannot build a buffer must still
   *  play the oscillator cues (the ready-check chime). */
  private noiseBuffer(): AudioBuffer | null {
    if (this.noiseBuf || !this.cueCtx) return this.noiseBuf;
    try {
      const frames = Math.floor(this.cueCtx.sampleRate * NOISE_BUFFER_SECONDS);
      const buf = this.cueCtx.createBuffer(1, frames, this.cueCtx.sampleRate);
      const data = buf.getChannelData(0);
      // Presentation-side randomness: this is not sim logic (see src/game/CLAUDE.md).
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch {
      this.noiseBuf = null;
    }
    return this.noiseBuf;
  }

  /** Filtered noise burst (the scrape half of the sheathe/draw cues). */
  private cueNoise(
    duration: number,
    filterFreq: number,
    gain: number,
    decay = 0.9,
    filterType: BiquadFilterType = 'lowpass',
  ): void {
    const noise = this.noiseBuffer();
    if (!this.cueCtx || !this.cueMaster || !noise) return;
    const t = this.cueCtx.currentTime;
    const src = this.cueCtx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.cueCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = this.cueCtx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration * decay);
    src.connect(filter).connect(g).connect(this.cueMaster);
    src.start(t, Math.random() * 0.5, duration);
  }

  /** Shaped oscillator ping (the metallic half of the sheathe/draw cues). */
  private cueTone(
    freq: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0,
    slideTo?: number,
  ): void {
    if (!this.cueCtx || !this.cueMaster) return;
    const t = this.cueCtx.currentTime + delay;
    const osc = this.cueCtx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.cueCtx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.cueMaster);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private play(key: UiCue): void {
    sfx.playUi(key, { jitter: false });
  }

  /** Play a cue only when interface/feedback sounds are enabled. The notification
   *  cues (loot, level, quest, whisper, error, polymorph, death) route through here;
   *  the gameplay-timing cues (ready check, duel countdown) call `play` directly. */
  private playFeedback(key: UiCue): void {
    if (this.feedbackOn) this.play(key);
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
    this.playFeedback(UI_CUES.coin);
  }

  levelUp(): void {
    this.playFeedback(UI_CUES.levelUp);
  }

  achievement(): void {
    this.play(UI_CUES.achievement);
  }

  lootItem(): void {
    this.playFeedback(UI_CUES.lootItem);
  }

  questAccept(): void {
    this.playFeedback(UI_CUES.questAccept);
  }

  questDone(): void {
    this.playFeedback(UI_CUES.questDone);
  }

  readyCheck(): void {
    this.readyCheckTone(784, 0.16, 0);
    this.readyCheckTone(988, 0.16, 0.12);
    this.readyCheckTone(1319, 0.28, 0.24);
  }

  weaponSheathe(): void {
    // steel sliding home over a leather strap, then a soft catch
    this.cueNoise(0.16, 2200, 0.15, 0.8, 'bandpass');
    this.cueTone(520, 0.08, 0.05, 'triangle', 0.09, 320);
  }

  weaponUnsheathe(): void {
    // brighter draw: a rising metallic ring over the scrape
    this.cueNoise(0.14, 3600, 0.16, 0.75, 'highpass');
    this.cueTone(760, 0.12, 0.07, 'triangle', 0.02, 1500);
  }

  whisper(): void {
    this.playFeedback(UI_CUES.whisper);
  }

  sheep(): void {
    this.playFeedback(UI_CUES.sheep);
  }

  death(): void {
    this.playFeedback(UI_CUES.death);
  }

  error(): void {
    this.playFeedback(UI_CUES.error);
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
