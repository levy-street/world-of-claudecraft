import type { KeyedSerialQueue } from './keyed_serial_queue';
import { PokerCurrencyOutcomeUnknownError } from './poker_db';
import type { PokerCurrencyRuntime } from './poker_service';

interface PokerCurrencySession {
  accountId: number;
  characterId: number;
  leaseNonce: string | undefined;
}

export interface PokerCurrencyCoordinatorDeps {
  queue: KeyedSerialQueue<number>;
  sessionForCharacter(characterId: number): PokerCurrencySession | null;
  copperForCharacter(characterId: number): number | null;
  adjustCopper(characterId: number, delta: number): boolean;
  setCopper(characterId: number, copper: number): boolean;
  quarantineCharacter(characterId: number): void;
}

export class PokerCurrencyCoordinator implements PokerCurrencyRuntime {
  private readonly busyCharacters = new Set<number>();

  constructor(private readonly deps: PokerCurrencyCoordinatorDeps) {}

  isBusy(characterId: number): boolean {
    return this.busyCharacters.has(characterId);
  }

  async transact(
    input: { accountId: number; characterId: number; copperDelta: number },
    persist: (
      leaseNonce: string | null,
      copperBefore?: number,
      copperAfter?: number,
    ) => Promise<{ applied: boolean; characterCopper?: number }>,
  ): Promise<void> {
    await this.deps.queue.run(input.characterId, async () => {
      const session = this.deps.sessionForCharacter(input.characterId);
      if (!session) {
        await persist(null);
        return;
      }
      if (session.accountId !== input.accountId) throw new Error('Poker account changed');
      if (!session.leaseNonce) throw new Error('Poker requires an active character lease');
      const copper = this.deps.copperForCharacter(input.characterId);
      const next = copper === null ? Number.NaN : copper + input.copperDelta;
      if (!Number.isSafeInteger(next) || next < 0) {
        throw new Error(input.copperDelta < 0 ? 'Not enough Copper' : 'Copper would overflow');
      }

      this.busyCharacters.add(input.characterId);
      const debitApplied = input.copperDelta < 0;
      if (debitApplied && !this.deps.adjustCopper(input.characterId, input.copperDelta)) {
        this.busyCharacters.delete(input.characterId);
        throw new Error('Poker character is no longer available');
      }
      const optimisticBaseline = debitApplied ? next : copper;
      try {
        const result = await persist(session.leaseNonce, copper, next);
        if (result.characterCopper !== undefined) {
          const currentCopper = this.deps.copperForCharacter(input.characterId);
          const concurrentDelta =
            currentCopper === null ? Number.NaN : currentCopper - optimisticBaseline;
          const reconciledCopper = result.characterCopper + concurrentDelta;
          if (
            !Number.isSafeInteger(reconciledCopper) ||
            reconciledCopper < 0 ||
            !this.deps.setCopper(input.characterId, reconciledCopper)
          ) {
            this.deps.quarantineCharacter(input.characterId);
            throw new Error('Poker character disappeared after currency commit');
          }
        } else if (!debitApplied) {
          this.deps.adjustCopper(input.characterId, input.copperDelta);
        }
      } catch (error) {
        if (error instanceof PokerCurrencyOutcomeUnknownError) {
          this.deps.quarantineCharacter(input.characterId);
        } else if (debitApplied && !this.deps.adjustCopper(input.characterId, -input.copperDelta)) {
          this.deps.quarantineCharacter(input.characterId);
        }
        throw error;
      } finally {
        this.busyCharacters.delete(input.characterId);
      }
    });
  }
}
