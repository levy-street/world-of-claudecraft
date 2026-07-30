// Pure realm-picker population banding: maps a realm's live online count (and its
// admission cap) to the label/tooltip i18n KEYS and the CSS class the picker
// paints. It returns keys, never rendered text, so it stays DOM/i18n-free and
// unit-testable, the same pure pre-join-core split as char_sort.ts /
// charselect_action.ts. main.ts is the thin consumer that resolves the keys via
// t() and stamps the class onto the realm-pop element.

// The label/tooltip keys this core can emit, as literal unions so the module
// carries no ui/i18n import (they are still valid t() keys at the call site).
export interface RealmPopulation {
  labelKey: 'realm.offline' | 'realm.full' | 'realm.high' | 'realm.medium' | 'realm.low';
  tipKey:
    | 'realm.popTipOffline'
    | 'realm.popTipFull'
    | 'realm.popTipHigh'
    | 'realm.popTipMedium'
    | 'realm.popTipLow';
  cls: string;
}

// Classic-MMO population bands, derived from the realm's current online count
// (the classic MMO's own labels are relative to peak; current count is a fair
// local stand-in). `cap` is the realm admission cap: a positive value is the real
// refusal point, so Full means players have reached it. When the cap is 0
// (disabled, or a server that predates the field) there is no refusal point, so
// the busiest realms fall into the High band rather than a misleading Full.
export function realmPopulation(online: boolean, players: number, cap: number): RealmPopulation {
  if (!online) return { labelKey: 'realm.offline', tipKey: 'realm.popTipOffline', cls: 'offline' };
  if (cap > 0 && players >= cap)
    return { labelKey: 'realm.full', tipKey: 'realm.popTipFull', cls: 'full' };
  if (players >= 80) return { labelKey: 'realm.high', tipKey: 'realm.popTipHigh', cls: 'high' };
  if (players >= 15) return { labelKey: 'realm.medium', tipKey: 'realm.popTipMedium', cls: 'med' };
  return { labelKey: 'realm.low', tipKey: 'realm.popTipLow', cls: 'low' };
}
