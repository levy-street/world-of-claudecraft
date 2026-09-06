// Account-bound mail: the one rule that lets a bound (def-level `soulbound`)
// item ride the Ravenpost. Bound gear is bound to the ACCOUNT, not the
// character, so it may be mailed between characters that share an account and
// nowhere else (a stranger's letter, the trade window, the World Market, the
// $WOC Exchange, a vendor, and the guild bank stay hard-blocked by
// `def.soulbound` exactly as before). The sim never learns account ids: the
// host that can answer "same account?" (the server, from its character rows)
// stamps the answer on the already-resolved recipient, and the offline world
// treats a letter to yourself as the only same-account case it has.
//
// Pure, host-agnostic: PostOffice consumes it at send time and at book load,
// and the Vitest suite imports it directly.
import type { ItemDef, MailResultCode } from '../types';

/** A resolved mail recipient. `key` is the stable character identity (the
 *  market sellerKey convention), `name` the display name at send time, and
 *  `sameAccount` whether the recipient character belongs to the SENDER's
 *  account. Absent means unknown, which the bound-parcel rule treats as
 *  "another account": the safe default for every host that cannot answer. */
export interface MailRecipient {
  key: string;
  name: string;
  sameAccount?: boolean;
}

/** The def-level bound refusal for one attachment: a bound item may only be
 *  mailed to a character on the sender's own account. Returns the mail result
 *  code to emit, or null when the attachment passes this rule (the caller
 *  continues with the quest / noMarketList / per-copy lock checks). */
export function boundAttachmentRefusal(
  def: Pick<ItemDef, 'soulbound'>,
  recipient: Pick<MailRecipient, 'sameAccount'>,
): MailResultCode | null {
  if (def.soulbound !== true) return null;
  return recipient.sameAccount === true ? null : 'noMailSoulbound';
}

/** Whether a letter that carries a bound parcel must be stamped `accountBound`
 *  at booking: only a player letter to a same-account recipient whose parcels
 *  include at least one bound def. The stamp is what exempts the letter from
 *  the boot-time migration that returns bound parcels to their sender (a
 *  letter booked before an item became bound), so it is set only when a bound
 *  parcel actually rides; an ordinary letter keeps its serialized shape. */
export function letterCarriesBoundParcel(
  parcels: readonly { itemId: string }[],
  defs: Readonly<Record<string, Pick<ItemDef, 'soulbound'> | undefined>>,
): boolean {
  return parcels.some((s) => defs[s.itemId]?.soulbound === true);
}

/** The boot-load migration arm: a bound parcel on a PLAYER letter is returned
 *  to its sender unless the letter was booked account-bound (a legitimate
 *  transfer between the same account's characters). System and npc letters
 *  never return, so the rule only ever sees player mail. */
export function boundParcelReturnsOnLoad(
  kind: 'player' | 'system' | 'npc',
  def: Pick<ItemDef, 'soulbound'> | undefined,
  accountBound: boolean | undefined,
): boolean {
  return kind === 'player' && def?.soulbound === true && accountBound !== true;
}
