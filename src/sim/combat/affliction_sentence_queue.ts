const NEEDLE_OF_FATE_ID = 'needle_of_fate';
const SENTENCE_ID = 'sentence';

// Sentence is Hexcraft's release and may already be queued behind the cast or
// GCD that produced its final Thread. Repeated generator or release presses
// must not overwrite the queued release (the one deliberate exception to the
// queue's last-press-wins rule); a press of any OTHER ability still replaces
// it like any queued slot. The GCD-tail buffering itself is the general spell
// queue in casting_lifecycle.ts (it absorbed the Sentence-only buffer that
// used to live here).
export function shouldPreserveQueuedSentence(
  queuedAbilityId: string | null,
  requestedAbilityId: string,
): boolean {
  return (
    queuedAbilityId === SENTENCE_ID &&
    (requestedAbilityId === NEEDLE_OF_FATE_ID || requestedAbilityId === SENTENCE_ID)
  );
}
