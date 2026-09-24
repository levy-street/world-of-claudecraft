// #3561: shared failed-write recovery for the incremental mail partition
// save. Both the periodic autosave (GameServer.saveMail) and the leave-flush
// escrow transaction (GameServer.leave, saveCharacterAndMarketState) drain
// dirty mail partitions (Sim.takeDirtyMailPartitions) before attempting to
// persist them. Unlike the whole-book design this replaces, where every
// cycle re-serialized everything regardless of what changed, a drained
// partition whose write then fails is GONE from the dirty set: nothing else
// re-dirties a mailbox nobody touches again, so a failed write must put the
// drained keys back or they are silently never retried.
import type { MailSave } from '../src/sim/sim';
import { saveMailPartitions } from './db';

export interface MailPartitionRearmSim {
  markMailPartitionsDirty(recipientKeys: readonly string[]): void;
  takeDirtyMailPartitions(): { recipientKey: string; letters: MailSave['mail'] }[];
  postOffice?: {
    takeDirtyMailPartition(
      recipientKey: string,
    ): { recipientKey: string; letters: MailSave['mail'] }[];
  };
}

export function rearmMailPartitionsOnFailure(
  sim: MailPartitionRearmSim,
  partitions: readonly { recipientKey: string }[],
): void {
  if (partitions.length > 0) sim.markMailPartitionsDirty(partitions.map((p) => p.recipientKey));
}

/** A character+mail escrow save may persist its own protected mailbox, but
 * must leave every other in-flight vault take for that recipient's own save. */
export function takeMailPartitionsForCharacterSave(
  sim: MailPartitionRearmSim,
  characterId: number,
  blockedRecipientKeys: ReadonlySet<string>,
  onlyOwn = false,
): { recipientKey: string; letters: MailSave['mail'] }[] {
  const ownKey = String(characterId);
  const postOffice = sim.postOffice;
  if (onlyOwn && !postOffice) throw new Error('targeted mail drain unavailable');
  const drained =
    postOffice && onlyOwn
      ? postOffice.takeDirtyMailPartition(ownKey)
      : sim.takeDirtyMailPartitions();
  const deferred = drained.filter(
    (partition) =>
      partition.recipientKey !== ownKey && blockedRecipientKeys.has(partition.recipientKey),
  );
  rearmMailPartitionsOnFailure(sim, deferred);
  return drained.filter(
    (partition) =>
      partition.recipientKey === ownKey || !blockedRecipientKeys.has(partition.recipientKey),
  );
}

// The shared body of GameServer.saveMail/persistMailBlob: drain inside the
// write queue (so a concurrently queued leave-flush can never race the
// drain and lose the partitions it needed for its own atomic transaction),
// write, and rearm on failure. propagate distinguishes saveMail()'s periodic
// flush (log and retry next cycle) from persistMailBlob()'s
// durability-critical callers (server/woc_market_custody.ts), which must see
// the failure to know their just-booked parcel is not yet durable.
export async function writeDirtyMailPartitions<WriteContext = unknown>(
  sim: MailPartitionRearmSim,
  enqueueWrite: <T>(write: () => Promise<T>, context?: WriteContext) => Promise<T>,
  propagate: boolean,
  context?: WriteContext,
  blockedRecipientKeys?: ReadonlySet<string>,
): Promise<void> {
  await enqueueWrite(async () => {
    const drained = sim.takeDirtyMailPartitions();
    const partitions = blockedRecipientKeys
      ? drained.filter((partition) => !blockedRecipientKeys.has(partition.recipientKey))
      : drained;
    if (blockedRecipientKeys) {
      rearmMailPartitionsOnFailure(
        sim,
        drained.filter((partition) => blockedRecipientKeys.has(partition.recipientKey)),
      );
    }
    if (partitions.length === 0) return;
    try {
      await saveMailPartitions(partitions);
    } catch (err) {
      rearmMailPartitionsOnFailure(sim, partitions);
      if (propagate) throw err;
      console.error('failed to save mail:', err);
    }
  }, context);
}
