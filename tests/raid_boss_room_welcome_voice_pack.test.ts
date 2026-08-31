import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeRaidBossRoomWelcomeSynthesis,
  RAID_BOSS_ROOM_WELCOME_VOICE_LINES,
} from '../scripts/voices/raid_boss_room_welcome_voice_pack.mjs';

describe('raid boss room welcome voice pack', () => {
  it('pins the approved Ignivar synthesis direction and treatment', () => {
    expect(RAID_BOSS_ROOM_WELCOME_VOICE_LINES).toEqual([
      {
        npcId: 'ignivar',
        key: 'yell__the_seal_hears_you_little_embers_step_closer_and_feed_the_la',
        text: 'The seal hears you, little embers. Step closer, and feed the Last Flame.',
        synthesisText:
          '[low mechanical whisper] The seal hears you, little embers. Step closer, and feed the Last Flame.',
        processingPreset: 'robotic-automaton',
      },
    ]);
  });

  it('decodes only complete nonempty timestamped synthesis responses', () => {
    const alignment = { characters: ['T'], character_start_times_seconds: [0] };
    expect(
      decodeRaidBossRoomWelcomeSynthesis(
        { audio_base64: Buffer.from('audio').toString('base64'), alignment },
        'ignivar',
      ),
    ).toEqual({ audio: Buffer.from('audio'), alignment });

    expect(() => decodeRaidBossRoomWelcomeSynthesis({ alignment }, 'ignivar')).toThrow(
      'ignivar synthesis returned no audio or alignment',
    );
    expect(() =>
      decodeRaidBossRoomWelcomeSynthesis({ audio_base64: 'YXVkaW8=' }, 'ignivar'),
    ).toThrow('ignivar synthesis returned no audio or alignment');
    expect(() =>
      decodeRaidBossRoomWelcomeSynthesis({ audio_base64: '', alignment }, 'ignivar'),
    ).toThrow('ignivar synthesis returned no audio or alignment');
  });
});
