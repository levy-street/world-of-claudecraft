import type { CharacterSummary } from './character_summary';

export interface CharacterMembership {
  active: boolean;
  expiresAt: string | null;
}

/** Keep account access metadata beside the roster, including old-server defaults. */
export function applyCharacterRoster(
  target: {
    realm: string | null;
    characterMembership: CharacterMembership;
    characterLimit: number;
  },
  data: {
    realm?: unknown;
    characters: CharacterSummary[];
    membership?: { active?: unknown; expiresAt?: unknown };
    characterLimit?: unknown;
  },
): CharacterSummary[] {
  if (typeof data.realm === 'string') target.realm = data.realm;
  target.characterMembership = {
    active: data.membership?.active === true,
    expiresAt: typeof data.membership?.expiresAt === 'string' ? data.membership.expiresAt : null,
  };
  target.characterLimit = data.characterLimit === 20 ? 20 : 10;
  return data.characters;
}
