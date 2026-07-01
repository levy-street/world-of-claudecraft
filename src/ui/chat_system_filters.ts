export type SystemChatFilterCategory = 'joinLeave' | 'duelArena';

export interface SystemChatFilterPrefs {
  hideJoinLeaveSystemMessages: boolean;
  hideDuelArenaSystemMessages: boolean;
}

const DUEL_ARENA_EXACT = new Set([
  'The duel has begun!',
  'The duel has ended.',
  'You join the Ashen Coliseum queue. Stand by for a worthy opponent...',
  'You leave the Ashen Coliseum queue.',
  'You step onto the sands of the Ashen Coliseum.',
]);

export function classifyLowPrioritySystemChatMessage(
  text: string,
): SystemChatFilterCategory | null {
  if (/^.+ has entered World of ClaudeCraft\.$/.test(text)) return 'joinLeave';
  if (/^.+ has left the world\.(?: \([^)]+\))?$/.test(text)) return 'joinLeave';
  if (/^You have challenged .+ to a duel\.$/.test(text)) return 'duelArena';
  if (/^.+ declines your challenge\.$/.test(text)) return 'duelArena';
  if (DUEL_ARENA_EXACT.has(text)) return 'duelArena';
  return null;
}

export function shouldShowSystemChatMessage(
  text: string,
  prefs: SystemChatFilterPrefs,
  category: SystemChatFilterCategory | null = classifyLowPrioritySystemChatMessage(text),
): boolean {
  if (category === 'joinLeave') return !prefs.hideJoinLeaveSystemMessages;
  if (category === 'duelArena') return !prefs.hideDuelArenaSystemMessages;
  return true;
}
