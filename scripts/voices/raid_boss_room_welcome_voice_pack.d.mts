import type { Buffer } from 'node:buffer';

export interface RaidBossRoomWelcomeVoiceLine {
  npcId: 'ignivar';
  key: string;
  text: string;
  synthesisText: string;
  processingPreset: 'robotic-automaton';
}

export declare const RAID_BOSS_ROOM_WELCOME_VOICE_LINES: readonly RaidBossRoomWelcomeVoiceLine[];

export declare function decodeRaidBossRoomWelcomeSynthesis(
  generated: { audio_base64?: unknown; alignment?: unknown },
  npcId: string,
): { audio: Buffer; alignment: object };
