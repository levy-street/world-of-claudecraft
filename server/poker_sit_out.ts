export const POKER_SIT_OUT_HAND_LIMIT = 5;
const POKER_MAX_SEATS = 6;

export interface PokerSitOutEntry {
  characterId: number;
  sinceHandNumber: number;
}

export type PokerSitOutState = Map<number, number>;

export function decodePokerSitOut(value: unknown): PokerSitOutState {
  const state = new Map<number, number>();
  if (!Array.isArray(value)) return state;
  for (const entry of value.slice(0, POKER_MAX_SEATS)) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      !Number.isSafeInteger((entry as Partial<PokerSitOutEntry>).characterId) ||
      ((entry as Partial<PokerSitOutEntry>).characterId ?? 0) <= 0 ||
      !Number.isSafeInteger((entry as Partial<PokerSitOutEntry>).sinceHandNumber) ||
      ((entry as Partial<PokerSitOutEntry>).sinceHandNumber ?? -1) < 0
    ) {
      continue;
    }
    const parsed = entry as PokerSitOutEntry;
    if (!state.has(parsed.characterId)) state.set(parsed.characterId, parsed.sinceHandNumber);
  }
  return state;
}

export function encodePokerSitOut(state: PokerSitOutState): PokerSitOutEntry[] {
  return [...state]
    .sort(([left], [right]) => left - right)
    .slice(0, POKER_MAX_SEATS)
    .map(([characterId, sinceHandNumber]) => ({ characterId, sinceHandNumber }));
}

export function markPokerSitOut(
  state: PokerSitOutState,
  characterId: number,
  handNumber: number,
): PokerSitOutState {
  if (state.has(characterId)) return new Map(state);
  return new Map(state).set(characterId, handNumber);
}

export function clearPokerSitOut(state: PokerSitOutState, characterId: number): PokerSitOutState {
  const next = new Map(state);
  next.delete(characterId);
  return next;
}

export function pokerSitOutLeavesAfterHand(
  state: PokerSitOutState,
  completedHandNumber: number,
): number[] {
  return [...state].flatMap(([characterId, sinceHandNumber]) =>
    completedHandNumber - sinceHandNumber + 1 >= POKER_SIT_OUT_HAND_LIMIT ? [characterId] : [],
  );
}
