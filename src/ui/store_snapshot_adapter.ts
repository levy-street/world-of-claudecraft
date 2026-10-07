import type { WocStoreItemInput } from './woc_store_view';
export function dailyRewardsStoreSnapshot(snapshot: {
  available: boolean;
  balance: number | null;
  storeItems: readonly WocStoreItemInput[];
}) {
  return {
    available: snapshot.available,
    balance: snapshot.balance,
    items: [...snapshot.storeItems],
  };
}
