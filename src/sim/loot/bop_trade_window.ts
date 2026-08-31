// The bind-on-pickup party trade window (Ignivar raid loot follow-up): a
// soulbound item awarded from party boss loot stays tradeable for a bounded
// window, but ONLY with the players who were loot-eligible at the exact moment
// the item dropped (the kill-time candidate snapshot, never the current party
// roster), and equipping the copy ends the window immediately (items.ts
// equipmentPayloadFor strips it on the bag-to-worn bridge).
//
// The clock is ctx.lockoutNowMs(), the shared raid-lockout clock: real epoch ms
// on the live server, tick-derived ms offline, so `untilMs` stays comparable to
// the host's own "now" in both worlds and survives a server restart. This
// module itself reads no clock (callers pass nowMs) and draws no rng; it is
// `src/sim`-pure bookkeeping over ItemInstancePayload.partyTrade.
//
// The window RIDES the copy: trading it hands the same payload over
// (social/trade.ts removeOffer/grantOffer preserve instances), so a recipient
// can pass it on to another drop-moment member within the same deadline.
// Mail, market, vendor, and guild-bank stay hard-blocked by def.soulbound at
// their existing gates; the trade offer path is the ONE channel this opens.

import type { ItemInstancePayload } from '../types';

/** How long a bind-on-pickup drop stays tradeable inside its drop group. */
export const BOP_PARTY_TRADE_MS = 2 * 60 * 60 * 1000;

/** Name equality for the eligible list: case-insensitive, so a client-typed
 *  or differently-cased mirror of the same character name never silently
 *  fails the window. Names are stored verbatim as stamped. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Builds the instance payload for a soulbound copy awarded from party loot,
 *  or undefined when no window applies: fewer than two eligible names means
 *  nobody exists to trade with, so the copy stays a plain grant. `eligible`
 *  is the drop-moment loot-candidate snapshot (winner included);
 *  `eligibleIds` carries the stable character ids behind those names where
 *  the host knows them (the live server always does), and the trade gate
 *  prefers them, because a display name can be freed by a rename and
 *  re-taken inside the window while a character id cannot. */
export function bopPartyTradeInstance(
  nowMs: number,
  eligible: readonly string[],
  eligibleIds: readonly number[] = [],
): ItemInstancePayload | undefined {
  if (eligible.length < 2) return undefined;
  return {
    partyTrade: {
      untilMs: nowMs + BOP_PARTY_TRADE_MS,
      eligible: [...eligible],
      ...(eligibleIds.length > 0 ? { eligibleIds: [...eligibleIds] } : {}),
    },
  };
}

/** Whether the copy's window is present, well-formed, and unexpired. The
 *  payload crosses a JSONB save/load boundary, so the shape checks are real
 *  input validation, not paranoia: a malformed window reads as no window
 *  (the copy falls back to plain soulbound, the safe direction). */
export function partyTradeActive(
  instance: ItemInstancePayload | undefined,
  nowMs: number,
): boolean {
  const trade = instance?.partyTrade;
  if (!trade || !Number.isFinite(trade.untilMs) || !Array.isArray(trade.eligible)) return false;
  return trade.untilMs > nowMs;
}

/** Whether the copy may be traded to `counterparty` right now: the window
 *  must be active AND the counterparty must be one of the drop-moment
 *  members. When the copy carries stable character ids AND the counterparty
 *  has one, the id list DECIDES (both directions): a renamed drop-mate stays
 *  eligible, and a stranger who takes a freed name inside the window does
 *  not become eligible. The name match remains for id-less hosts (the
 *  offline sim) and for pre-id persisted copies. */
export function partyTradeWindowAllows(
  instance: ItemInstancePayload | undefined,
  counterparty: { name: string; characterId?: number },
  nowMs: number,
): boolean {
  if (!partyTradeActive(instance, nowMs)) return false;
  const trade = instance?.partyTrade;
  const ids = Array.isArray(trade?.eligibleIds) ? trade.eligibleIds : [];
  if (ids.length > 0 && counterparty.characterId !== undefined) {
    return ids.some((id) => typeof id === 'number' && id === counterparty.characterId);
  }
  const eligible = trade?.eligible ?? [];
  return eligible.some((name) => typeof name === 'string' && sameName(name, counterparty.name));
}

/** Milliseconds left on the copy's window, clamped to zero. */
export function partyTradeMsLeft(instance: ItemInstancePayload | undefined, nowMs: number): number {
  if (!partyTradeActive(instance, nowMs)) return 0;
  return Math.max(0, (instance?.partyTrade?.untilMs ?? 0) - nowMs);
}

/** Load-time shape rule for one persisted marker, judged ATOMICALLY: the
 *  window is one snapshot (`untilMs` plus the eligibility data the trade gate
 *  reads together), so eligibility data that is invalid or missing refuses
 *  the WHOLE marker rather than salvaging a partial `{ untilMs }` residue.
 *  Total on `unknown` (JSONB is never trusted). Required: a plain object
 *  whose `untilMs` is a finite number and whose `eligible` is an array of
 *  names within `maxNameLength` (the caller's persisted-string ceiling,
 *  item_instance_load.ts MAX_INSTANCE_STRING_LENGTH). `eligibleIds`, when
 *  present, must be an array of finite numbers. Unknown extra keys ride
 *  along (the payload's additive forward-compat doctrine); the caller's
 *  subtree JSON ceiling is what bounds them. */
export function isLoadablePartyTradeMarker(value: unknown, maxNameLength: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as { untilMs?: unknown; eligible?: unknown; eligibleIds?: unknown };
  if (typeof marker.untilMs !== 'number' || !Number.isFinite(marker.untilMs)) return false;
  if (!Array.isArray(marker.eligible)) return false;
  const namesLegal = marker.eligible.every(
    (name) => typeof name === 'string' && name.length <= maxNameLength,
  );
  if (!namesLegal) return false;
  if (marker.eligibleIds === undefined) return true;
  return (
    Array.isArray(marker.eligibleIds) &&
    marker.eligibleIds.every((id) => typeof id === 'number' && Number.isFinite(id))
  );
}

/** The payload without its partyTrade marker, as a NEW object (the input is
 *  never mutated), or undefined when nothing else remains: an empty `{}`
 *  payload can never stack with a plain copy of the same item again, so
 *  absence is the clean form. THE shared strip: the equip bridge (items.ts
 *  equipmentPayloadFor) and the persisted-equipment load arm (Sim.addPlayer)
 *  both route through it, so a worn payload never carries the window
 *  whichever door it arrived through. */
export function withoutPartyTradeMarker(
  instance: ItemInstancePayload,
): ItemInstancePayload | undefined {
  const { partyTrade: _partyTrade, ...rest } = instance;
  return Object.keys(rest).length > 0 ? rest : undefined;
}
