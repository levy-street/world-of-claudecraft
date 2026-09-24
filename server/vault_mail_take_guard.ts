// Fence a vault-mail take until the save that captured its character and
// recipient mailbox commits together. Older saves cannot release the fence.
import type { Sim } from '../src/sim/sim';

interface MailView {
  copper: number;
  items: readonly unknown[];
  read: boolean;
}

export class VaultMailTakeGuard {
  readonly blocked = new Set<string>();
  private readonly owners = new Map<string, number>();
  private readonly generations = new Map<string, number>();
  private readonly refs = new Map<string, string>();
  private nextGeneration = 0;

  isLocked(characterId: number): boolean {
    return this.blocked.has(String(characterId));
  }

  joinError(characterId: number, resumingLiveSession: boolean): string | null {
    // A new session must not pair an older saved character with the emptied
    // live letter of an uncommitted previous take.
    return this.isLocked(characterId) && !resumingLiveSession
      ? 'Vault reward mail is still recovering. Please retry shortly.'
      : null;
  }

  maySave(characterId: number, pid: number): boolean {
    const owner = this.owners.get(String(characterId));
    return owner === undefined || owner === pid;
  }

  begin(characterId: number, pid: number, custodyRef?: string): boolean {
    const key = String(characterId);
    if (this.blocked.has(key)) return false;
    this.blocked.add(key);
    this.owners.set(key, pid);
    this.generations.set(key, ++this.nextGeneration);
    if (custodyRef) this.refs.set(key, custodyRef);
    return true;
  }

  recoveryRef(characterId: number): string | null {
    return this.refs.get(String(characterId)) ?? null;
  }

  recovered(characterId: number, custodyRef: string): void {
    if (this.recoveryRef(characterId) === custodyRef) this.clear(characterId);
  }

  take(
    sim: Pick<Sim, 'mailInfoFor' | 'mailTake' | 'postOffice'>,
    characterId: number,
    pid: number,
    mailId: number,
    save: () => void,
  ): boolean {
    const before = sim.mailInfoFor(pid)?.messages.find((mail) => mail.id === mailId);
    if (before?.letterId !== 'hoard_vault_reward') return false;
    const custodyRef = sim.postOffice.vaultCustodyRefFor(mailId, pid);
    if (!custodyRef) return true;
    const beforeView: MailView = {
      copper: before.copper,
      items: [...before.items],
      read: before.read,
    };
    if (!this.begin(characterId, pid, custodyRef)) return true;
    try {
      sim.mailTake(mailId, pid);
    } finally {
      const after = sim.mailInfoFor(pid)?.messages.find((mail) => mail.id === mailId);
      if (!this.discardIfUnchanged(characterId, beforeView, after)) save();
    }
    return true;
  }

  discardIfUnchanged(characterId: number, before: MailView, after?: MailView): boolean {
    if (
      after &&
      after.copper === before.copper &&
      after.items.length === before.items.length &&
      after.read === before.read
    ) {
      this.clear(characterId);
      return true;
    }
    return false;
  }

  capture(
    characterId: number,
    pid: number,
    partitions: readonly { recipientKey: string }[],
  ): number | undefined {
    const key = String(characterId);
    return this.owners.get(key) === pid &&
      partitions.some((partition) => partition.recipientKey === key)
      ? this.generations.get(key)
      : undefined;
  }

  committed(characterId: number, capturedGeneration?: number): void {
    if (
      capturedGeneration !== undefined &&
      this.generations.get(String(characterId)) === capturedGeneration
    ) {
      this.clear(characterId);
    }
  }

  private clear(characterId: number): void {
    const key = String(characterId);
    this.blocked.delete(key);
    this.owners.delete(key);
    this.generations.delete(key);
    this.refs.delete(key);
  }
}

export function handleVaultMailTake(
  guard: VaultMailTakeGuard,
  sim: Pick<Sim, 'mailInfoFor' | 'mailTake' | 'postOffice'>,
  characterId: number,
  pid: number,
  mailId: number,
  save: () => Promise<boolean>,
  onSaveFailure: (error: unknown) => void = () => {},
  onSaved: () => void = () => {},
): void {
  if (
    !guard.take(sim, characterId, pid, mailId, () => {
      void save().then(
        (saved) => {
          if (saved) onSaved();
          else onSaveFailure(new Error('vault mail take was not saved'));
        },
        (error) => {
          console.error(`vault mail take save failed for ${characterId}:`, error);
          onSaveFailure(error);
        },
      );
    })
  )
    sim.mailTake(mailId, pid);
}
