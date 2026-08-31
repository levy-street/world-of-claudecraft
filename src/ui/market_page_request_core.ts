// Pure reconciliation for asynchronous World Market page echoes. The browser can
// send a replacement query before an older page response arrives, so the painter
// keeps the latest page intent until an echo for that request (or its authoritative
// clamp) is distinguishable from the mirror that existed when it was sent.

import type { MarketInfo } from '../world_api';

export interface MarketPageRequestState {
  readonly requestedPage: number;
  readonly priorEchoSignature: string;
  readonly sawOtherEcho: boolean;
}

function browseEchoSignature(info: MarketInfo | null): string {
  if (!info) return 'null';
  return JSON.stringify([
    info.filter,
    info.itemType,
    info.subtype,
    info.armorClass,
    info.primaryStat,
    info.rarity,
    info.sort,
    info.collapseLowest,
    info.page,
    info.pageCount,
    info.totalCount,
    info.listings,
  ]);
}

export function beginMarketPageRequest(
  current: MarketPageRequestState | null,
  requestedPage: number,
  lastRequestedPage: number,
  info: MarketInfo | null,
): MarketPageRequestState | null {
  if (requestedPage === lastRequestedPage && requestedPage === (info?.page ?? 0)) return current;
  return {
    requestedPage,
    priorEchoSignature: browseEchoSignature(info),
    sawOtherEcho: false,
  };
}

export function reconcileMarketPageEcho(
  current: MarketPageRequestState | null,
  localPage: number,
  info: MarketInfo | null,
  echoMatchesQuery: boolean,
): { page: number; pending: MarketPageRequestState | null; accepted: boolean } {
  if (!info) return { page: localPage, pending: current, accepted: false };
  if (!current) {
    return echoMatchesQuery
      ? { page: info.page, pending: null, accepted: true }
      : { page: localPage, pending: null, accepted: false };
  }

  const signature = browseEchoSignature(info);
  const signatureChanged = signature !== current.priorEchoSignature;
  const clampedRequestedPage = Math.max(0, Math.min(info.pageCount - 1, current.requestedPage));
  if (
    echoMatchesQuery &&
    info.page === clampedRequestedPage &&
    (signatureChanged || current.sawOtherEcho)
  ) {
    return { page: info.page, pending: null, accepted: true };
  }

  if (!echoMatchesQuery || signatureChanged) {
    return {
      page: localPage,
      pending: { ...current, sawOtherEcho: true },
      accepted: false,
    };
  }
  return { page: localPage, pending: current, accepted: false };
}
