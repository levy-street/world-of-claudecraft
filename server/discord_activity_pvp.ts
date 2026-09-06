// The Discord activity card a finished duel produces, pure over the two
// sessions the game loop resolved by name. Extracted from the duelEnd arm of
// Game.detectActivity's sibling loop (server/game.ts) so the card's shape is
// unit-testable and the coordinator keeps only the session lookups and the
// enqueue (the monolith ratchet: game.ts is extracted beside, never grown).

import type { QueuedActivity } from './discord_activity';

/** The identity a duel card needs from a participant's session. */
export interface DuelParticipant {
  accountId: number;
  name: string;
}

/** The queued card plus its dedupe key, one pair per finished duel. */
export interface DuelActivityCard {
  item: QueuedActivity;
  key: string;
}

/**
 * Build the duel card. A participant without a session (a bot, or a player
 * who logged out between the last blow and the event) is left off the
 * participant lists, so the card still posts for whoever is linked; the names
 * on the card itself come from the event, never the sessions.
 */
export function duelActivityCard(
  ev: { winnerName: string; loserName: string },
  winner: DuelParticipant | null | undefined,
  loser: DuelParticipant | null | undefined,
  realm: string,
  profileUrl: string | null,
): DuelActivityCard {
  const accountIds: number[] = [];
  const names: string[] = [];
  for (const p of [winner, loser]) {
    if (!p) continue;
    accountIds.push(p.accountId);
    names.push(p.name);
  }
  return {
    item: {
      kind: 'duel',
      accountIds,
      names,
      realm,
      profileUrl,
      winnerName: ev.winnerName,
      loserName: ev.loserName,
    },
    key: `duel:${ev.winnerName}:${ev.loserName}`,
  };
}
