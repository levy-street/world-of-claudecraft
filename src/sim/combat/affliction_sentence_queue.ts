import { CAST_QUEUE_WINDOW_SEC } from '../types';

const NEEDLE_OF_FATE_ID = 'needle_of_fate';
const SENTENCE_ID = 'sentence';

export function shouldPreserveQueuedSentence(
  queuedAbilityId: string | null,
  requestedAbilityId: string,
): boolean {
  return (
    queuedAbilityId === SENTENCE_ID &&
    (requestedAbilityId === NEEDLE_OF_FATE_ID || requestedAbilityId === SENTENCE_ID)
  );
}

export function shouldBufferSentenceDuringGcd(abilityId: string, gcdRemaining: number): boolean {
  return abilityId === SENTENCE_ID && gcdRemaining > 0 && gcdRemaining <= CAST_QUEUE_WINDOW_SEC;
}
