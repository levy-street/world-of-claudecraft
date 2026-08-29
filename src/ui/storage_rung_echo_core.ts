// Shared authoritative-echo latch for the personal-bank socket, guild-bank,
// and Materials Vault gold ladders. All three commands are fire-and-forget and
// carry no quoted price. After one confirmation, the online IWorld mirror can
// still show the old rung for a tick; enabling that stale button lets a second
// activation buy the next rung at a price the player never saw. The latch
// therefore releases only when the mirrored rung reaches the expected
// revision, a matching refusal arrives, or the bounded lost-echo timer expires.

import { DICT } from './sim_i18n';

export const STORAGE_RUNG_ECHO_TIMEOUT_MS = 12_000;

export interface StorageRungEchoTimers {
  schedule(callback: () => void, delayMs: number): number;
  cancel(handle: number): void;
}

export class StorageRungEchoLatch {
  private expectedRevision: number | null = null;
  private timer: number | null = null;

  constructor(
    private readonly timers: StorageRungEchoTimers,
    private readonly onTimeout: () => void,
  ) {}

  get pending(): boolean {
    return this.expectedRevision !== null;
  }

  arm(currentRevision: number, expectedRevision: number): boolean {
    if (this.pending) return false;
    if (
      !Number.isSafeInteger(currentRevision) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision <= currentRevision
    ) {
      return false;
    }
    this.expectedRevision = expectedRevision;
    this.timer = this.timers.schedule(() => {
      this.timer = null;
      if (!this.pending) return;
      this.expectedRevision = null;
      this.onTimeout();
    }, STORAGE_RUNG_ECHO_TIMEOUT_MS);
    return true;
  }

  observe(revision: number | null | undefined): boolean {
    if (
      this.expectedRevision === null ||
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < this.expectedRevision
    ) {
      return false;
    }
    this.release();
    return true;
  }

  refuse(): boolean {
    if (!this.pending) return false;
    this.release();
    return true;
  }

  private release(): void {
    if (this.timer !== null) this.timers.cancel(this.timer);
    this.timer = null;
    this.expectedRevision = null;
  }
}

export interface StorageRungRefusalTargets {
  guild: boolean;
  vault: boolean;
}

// Derived BY KEY from the sim matcher's English table rather than duplicated
// as literals: the sim emits these refusals in raw English, and the S3 guard
// (tests/localization_fixes.test.ts) forces the sim_i18n row to move with any
// sim reword. Deriving from the same rows means a reword can never leave these
// sets silently unmatched (which would latch the buy button for the full
// lost-echo timeout); the literal pins in tests/storage_rung_echo_core.test.ts
// still red on a reword so the change is reviewed, not silent.
const GUILD_REFUSALS = new Set([
  DICT.en['error.guildBankCannotAfford'],
  DICT.en['error.guildBankMaxSlots'],
]);
const VAULT_REFUSALS = new Set([
  DICT.en['error.vaultCannotAfford'],
  DICT.en['error.vaultMaxUpgrades'],
]);

export function storageRungRefusalTargets(text: string): StorageRungRefusalTargets {
  return {
    guild: GUILD_REFUSALS.has(text),
    vault: VAULT_REFUSALS.has(text),
  };
}
