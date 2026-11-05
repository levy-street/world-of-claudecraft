// Realm registry — register any set of realm overlays and resolve the active
// one. The active realm is resolved from ?realm=<id>, then localStorage, then
// the default. Provide your realms via createRealmRegistry().

import type { RealmContent, RealmId } from './types';

const STORE_KEY = 'active_realm';

export interface RealmRegistry {
  REALMS: Record<RealmId, RealmContent>;
  REALM_LIST: readonly RealmContent[];
  HOME_REALM_LIST: readonly RealmContent[];
  DEFAULT_REALM: RealmId;
  getRealm(id: RealmId): RealmContent;
  isRealmId(s: string | null | undefined): s is RealmId;
  isCrossRealm(id: RealmId): boolean;
  resolveActiveRealmId(): RealmId;
  persistActiveRealm(id: RealmId): void;
  getActiveRealm(): RealmContent;
}

export function createRealmRegistry(realms: readonly RealmContent[]): RealmRegistry {
  if (realms.length === 0) throw new Error('createRealmRegistry: at least one realm required');
  const REALMS: Record<RealmId, RealmContent> = {};
  for (const r of realms) REALMS[r.id] = r;
  const REALM_LIST = realms;
  const HOME_REALM_LIST = realms.filter((r) => !r.crossRealm);
  const DEFAULT_REALM = (realms.find((r) => r.isDefault) ?? realms[0]).id;

  const isRealmId = (s: string | null | undefined): s is RealmId => s != null && s in REALMS;
  const getRealm = (id: RealmId): RealmContent => REALMS[id] ?? REALMS[DEFAULT_REALM];
  const isCrossRealm = (id: RealmId): boolean => REALMS[id]?.crossRealm === true;

  const resolveActiveRealmId = (): RealmId => {
    try {
      if (typeof window !== 'undefined') {
        const q = new URLSearchParams(window.location.search).get('realm');
        if (isRealmId(q)) return q;
        const ls = window.localStorage?.getItem(STORE_KEY);
        if (isRealmId(ls)) return ls;
      }
    } catch { /* SSR / sandboxed */ }
    return DEFAULT_REALM;
  };
  const persistActiveRealm = (id: RealmId): void => {
    try { window.localStorage?.setItem(STORE_KEY, id); } catch { /* unavailable */ }
  };
  const getActiveRealm = (): RealmContent => getRealm(resolveActiveRealmId());

  return {
    REALMS, REALM_LIST, HOME_REALM_LIST, DEFAULT_REALM,
    getRealm, isRealmId, isCrossRealm,
    resolveActiveRealmId, persistActiveRealm, getActiveRealm,
  };
}
