export const REPUTATION_MIN = -42000;
export const REPUTATION_MAX = 42000;

export const FACTIONS = {
  eastbrook: {
    id: 'eastbrook',
    name: 'Eastbrook',
    description: 'The people of Eastbrook Vale and the road wardens who keep its farms safe.',
  },
} as const;

export type FactionId = keyof typeof FACTIONS;
export type FactionDef = (typeof FACTIONS)[FactionId];

export const FACTION_ORDER = ['eastbrook'] as const satisfies readonly FactionId[];

export const REPUTATION_STANDINGS = [
  { name: 'Hostile', min: REPUTATION_MIN },
  { name: 'Unfriendly', min: -6000 },
  { name: 'Neutral', min: 0 },
  { name: 'Friendly', min: 3000 },
  { name: 'Honored', min: 9000 },
  { name: 'Revered', min: 21000 },
  { name: 'Exalted', min: REPUTATION_MAX },
] as const;

export type ReputationStanding = (typeof REPUTATION_STANDINGS)[number]['name'];

export function reputationStanding(points: number): ReputationStanding {
  const value = Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.floor(points)));
  let standing: ReputationStanding = 'Hostile';
  for (const band of REPUTATION_STANDINGS) {
    if (value >= band.min) standing = band.name;
  }
  return standing;
}
