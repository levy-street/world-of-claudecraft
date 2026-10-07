// Compose the revocable item projection with the realm's existing cosmetics,
// profiler, and shared background gate; joins retain independent admission.
import type { Sim } from '../src/sim/sim';
import type { AccountCosmeticsService, CosmeticsSession } from './account_cosmetics_service';
import { AccountMountItemsService } from './account_mount_items_service';
import type { BackgroundDbGate } from './background_db_gate';

export function createRealmMountItemsService(
  sim: () => Pick<Sim, 'meta'>,
  cosmetics: Pick<AccountCosmeticsService, 'setCollectibleMountSkins'>,
  gate: () => BackgroundDbGate | undefined,
  onWorkMs: (durationMs: number) => void,
): AccountMountItemsService {
  return new AccountMountItemsService({
    meta: (pid) => sim().meta(pid),
    setCollectible: (accountId, ids, sessions, authoritative) =>
      cosmetics.setCollectibleMountSkins(
        accountId,
        ids,
        sessions as Iterable<CosmeticsSession>,
        authoritative,
      ),
    tryAcquireRefreshPermit: () => gate()?.tryAcquire(),
    onError: (err) => console.error('failed to refresh account mount items:', err),
    onWorkMs,
  });
}
