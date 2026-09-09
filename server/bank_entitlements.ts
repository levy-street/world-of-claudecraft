// Bank bonus-slot entitlements: the pure, extensible source registry that turns a
// bag of account facts (email verified, Discord linked, wallet linked, qualified
// referrals) into the bonus-slot total plus the per-source breakdown the bank
// window advertises. No DB import lives here: server/db.ts reads the raw facts in
// one parameterized query and server/main.ts pipes them through computeBankBonus,
// so this module stays a host-agnostic leaf a Vitest imports directly.
//
// EXTENSIBILITY (the registry's design contract): a new source is one more row
// in BANK_BONUS_SOURCES. computeBankBonus emits one BankBonusSource per registry
// row, so adding a row grows the breakdown by exactly one entry and changes no
// existing row or the wire SHAPE. Two such rows are already approved by the
// maintainer but BLOCKED on their platform-link systems being built separately:
//   { id: 'x_follow',      slotsPerUnit: 2, capUnits: 1, units: (f) => (f.xFollowing ? 1 : 0) }
//   { id: 'twitch_follow', slotsPerUnit: 2, capUnits: 1, units: (f) => (f.twitchFollowing ? 1 : 0) }
// Do NOT add them until those link facts exist. When one lands it also bumps the
// sim's BANK_MAX_BONUS_SLOTS in the SAME change, or the tripwire below reds.
//
// TRIPWIRE: maxBankBonusSlots(BANK_BONUS_SOURCES) is test-pinned EQUAL to
// BANK_MAX_BONUS_SLOTS (src/sim/bank.ts), the load-path clamp for a persisted/
// tampered bonusSlots value. The registry can never grant more than the sim will
// admit, so a future source row bumps both constants together.

import type { BankBonusSource } from '../src/world_api';

/** The raw account facts the entitlement math reads. Populated by one parameterized
 *  query (server/db.ts bankBonusFactsForAccount); a missing account is all-false/0.
 *  qualifiedReferrals is the UNCAPPED count (the cap is registry data, applied here). */
export interface BankBonusFacts {
  emailVerified: boolean;
  discordLinked: boolean;
  walletLinked: boolean;
  qualifiedReferrals: number;
}

/** One entitlement source as data: how many slots a unit is worth, how many units
 *  cap the source, and the pure function that reads the fact into a unit count.
 *  A binary source (email/Discord/wallet) returns 0 or 1 units with capUnits 1;
 *  the referral source returns the raw qualified count with capUnits 5. */
export interface BankBonusSourceDef {
  id: string;
  slotsPerUnit: number;
  capUnits: number;
  units(f: BankBonusFacts): number;
}

/** The shipped v1 registry: +2 email (verified), +2 Discord, +2 wallet (a link row
 *  is the proof, never a balance), +2 per qualified referral capped at 5 (+10). The
 *  order is the display order the bank-window footer renders. Append-only data: a new
 *  source is a new row (see the future X/Twitch rows in the module header). */
export const BANK_BONUS_SOURCES: readonly BankBonusSourceDef[] = [
  { id: 'email', slotsPerUnit: 2, capUnits: 1, units: (f) => (f.emailVerified ? 1 : 0) },
  { id: 'discord', slotsPerUnit: 2, capUnits: 1, units: (f) => (f.discordLinked ? 1 : 0) },
  { id: 'wallet', slotsPerUnit: 2, capUnits: 1, units: (f) => (f.walletLinked ? 1 : 0) },
  { id: 'referral', slotsPerUnit: 2, capUnits: 5, units: (f) => f.qualifiedReferrals },
];

/** Turn the facts into the bonus-slot total and the per-source breakdown. Each row is
 *  { id, slots, maxSlots } plus count/cap ONLY for a multi-unit source (capUnits > 1):
 *  slots = min(units, capUnits) * slotsPerUnit, maxSlots = capUnits * slotsPerUnit,
 *  count = min(units, capUnits) (capped for display), cap = capUnits. bonusSlots is
 *  the sum of the row slots. A binary source carries no count/cap keys. Units are
 *  floored and clamped non-negative so a malformed fact can never mint slots. */
export function computeBankBonus(
  facts: BankBonusFacts,
  registry: readonly BankBonusSourceDef[] = BANK_BONUS_SOURCES,
): { bonusSlots: number; sources: BankBonusSource[] } {
  const sources: BankBonusSource[] = [];
  let bonusSlots = 0;
  for (const def of registry) {
    // The || 0 mirrors clampBonusSlots: a NaN from a malformed future units() decays
    // to 0 instead of propagating into slots/bonusSlots (Infinity is bounded by the
    // capUnits min below).
    const rawUnits = Math.max(0, Math.floor(def.units(facts)) || 0);
    const earnedUnits = Math.min(rawUnits, def.capUnits);
    const slots = earnedUnits * def.slotsPerUnit;
    const row: BankBonusSource = {
      id: def.id,
      slots,
      maxSlots: def.capUnits * def.slotsPerUnit,
    };
    if (def.capUnits > 1) {
      row.count = earnedUnits;
      row.cap = def.capUnits;
    }
    sources.push(row);
    bonusSlots += slots;
  }
  return { bonusSlots, sources };
}

/** The most bonus slots the registry can grant, i.e. every source fully earned. Pinned
 *  EQUAL to BANK_MAX_BONUS_SLOTS (src/sim/bank.ts) by tests/bank_entitlements.test.ts;
 *  a future source that bumps this must bump that sim constant in the same change. */
export function maxBankBonusSlots(
  registry: readonly BankBonusSourceDef[] = BANK_BONUS_SOURCES,
): number {
  return registry.reduce((sum, def) => sum + def.capUnits * def.slotsPerUnit, 0);
}
