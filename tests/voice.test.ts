import { describe, expect, it } from 'vitest';
import { yellKey } from '../scripts/voices/extra_lines.mjs';
import {
  GameVoice,
  IGNIVAR_ROOM_WELCOME_VOICE_KEY,
  VOICE_FULL_DIST,
  VOICE_SILENT_DIST,
  voice,
  voiceDistanceGain,
} from '../src/game/voice';
import { IGNIVAR_DIALOGUE } from '../src/sim/encounters/ignivar_dialogue';

describe('voiceDistanceGain', () => {
  it('plays at full volume at or within the full distance', () => {
    expect(voiceDistanceGain(0)).toBe(1);
    expect(voiceDistanceGain(VOICE_FULL_DIST - 1)).toBe(1);
    expect(voiceDistanceGain(VOICE_FULL_DIST)).toBe(1);
  });

  it('is silent at or beyond the silent distance', () => {
    expect(voiceDistanceGain(VOICE_SILENT_DIST)).toBe(0);
    expect(voiceDistanceGain(VOICE_SILENT_DIST + 5)).toBe(0);
  });

  it('ramps down monotonically between full and silent, reaching ~0.5 at the midpoint', () => {
    const mid = (VOICE_FULL_DIST + VOICE_SILENT_DIST) / 2;
    expect(voiceDistanceGain(mid)).toBeCloseTo(0.5, 5);
    let prev = 1;
    for (let d = VOICE_FULL_DIST; d <= VOICE_SILENT_DIST; d++) {
      const g = voiceDistanceGain(d);
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(0);
      prev = g;
    }
  });

  it('never dips a line the moment a dialog opens (opened within INTERACT_RANGE 5)', () => {
    expect(voiceDistanceGain(5)).toBe(1);
  });

  it('treats NaN or negative distance as full, never a negative volume', () => {
    expect(voiceDistanceGain(Number.NaN)).toBe(1);
    expect(voiceDistanceGain(-3)).toBe(1);
  });

  it('honors custom full/silent bounds', () => {
    expect(voiceDistanceGain(10, 10, 20)).toBe(1);
    expect(voiceDistanceGain(20, 10, 20)).toBe(0);
    expect(voiceDistanceGain(15, 10, 20)).toBeCloseTo(0.5, 5);
  });
});

describe('voice preference', () => {
  it('exposes whether semantic voice-over can sound to the SFX routing layer', () => {
    voice.setEnabled(false);
    expect(voice.isAudible()).toBe(false);
    voice.setEnabled(true);
    voice.setVolume(0);
    expect(voice.isAudible()).toBe(false);
    voice.setVolume(0.9);
    expect(voice.isAudible()).toBe(true);
  });

  it('finishes Ignivar room entry before playing the latest encounter line', () => {
    class FakeAudio {
      currentTime = 0;
      ended = false;
      onended: (() => void) | null = null;
      paused = true;
      src = '';
      volume = 1;

      pause(): void {
        this.paused = true;
      }

      play(): Promise<void> {
        this.ended = false;
        this.paused = false;
        return Promise.resolve();
      }

      finish(): void {
        this.ended = true;
        this.paused = true;
        this.onended?.();
      }
    }

    const previousAudio = globalThis.Audio;
    const audioInstances: FakeAudio[] = [];
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: class extends FakeAudio {
        constructor() {
          super();
          audioInstances.push(this);
        }
      },
    });

    try {
      const director = new GameVoice();
      const engageKey = yellKey(IGNIVAR_DIALOGUE.engage);
      expect(IGNIVAR_ROOM_WELCOME_VOICE_KEY).toBe(yellKey(IGNIVAR_DIALOGUE.roomEntry));

      director.play(IGNIVAR_ROOM_WELCOME_VOICE_KEY);
      director.play(engageKey);
      const audio = audioInstances[0];
      expect(audio.src).toContain(`/${IGNIVAR_ROOM_WELCOME_VOICE_KEY}.mp3`);

      audio.finish();
      expect(audio.src).toContain(`/${engageKey}.mp3`);
      director.stop();
    } finally {
      Object.defineProperty(globalThis, 'Audio', {
        configurable: true,
        value: previousAudio,
      });
    }
  });
});
