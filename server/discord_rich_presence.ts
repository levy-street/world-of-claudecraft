import type { PresenceStatus } from './social';

export interface DiscordRichPresenceInput {
  characterName: string;
  className: string;
  level: number;
  zone: string;
  status: PresenceStatus;
  joinedAt: number;
  realm: string;
  profileUrl: string | null;
}

export interface DiscordRichPresencePayload {
  details: string;
  state: string;
  largeImageKey: string;
  largeImageText: string;
  smallImageKey: string;
  smallImageText: string;
  startTimestamp: number;
  instance: boolean;
  metadata: {
    characterName: string;
    className: string;
    level: number;
    zone: string;
    status: PresenceStatus;
    realm: string;
    profileUrl: string | null;
  };
}

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'Exploring',
  combat: 'In combat',
  dungeon: 'In a dungeon',
  dead: 'Dead',
};

function titleCaseClassName(value: string): string {
  const clean = value.trim();
  if (!clean) return 'Adventurer';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function classImageKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `class_${key || 'adventurer'}`;
}

export function buildDiscordRichPresence(
  input: DiscordRichPresenceInput,
): DiscordRichPresencePayload {
  const className = titleCaseClassName(input.className);
  const level = Math.max(1, Math.floor(input.level));
  const zone = input.zone.trim() || 'Unknown';
  const characterName = input.characterName.trim() || 'Adventurer';

  return {
    details: `${characterName} - Level ${level} ${className}`,
    state: `${STATUS_LABEL[input.status]} in ${zone}`,
    largeImageKey: 'world_of_claudecraft',
    largeImageText: 'World of ClaudeCraft',
    smallImageKey: classImageKey(input.className),
    smallImageText: className,
    startTimestamp: Math.max(0, Math.floor(input.joinedAt / 1000)),
    instance: false,
    metadata: {
      characterName,
      className,
      level,
      zone,
      status: input.status,
      realm: input.realm,
      profileUrl: input.profileUrl,
    },
  };
}
