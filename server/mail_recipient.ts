// Mail recipient resolution for the `mail_send` command: the one place the
// server turns a typed name into the sim's `MailRecipient`, including the
// answer the sim cannot compute itself, `sameAccount` (mail/account_bound.ts):
// bound gear is account bound, so it rides the Ravenpost only between
// characters of ONE account. Extracted from server/game.ts (the monolith
// ratchet) so both arms of the command, the live-session recipient and the
// offline character row, build the recipient through the same function and no
// account id ever crosses the wire (the woc_market.ts characterByName rule).
//
// Block semantics stay exactly as before: a recipient who has blocked the
// sender resolves to "no such recipient", revealing nothing more.
import type { MailRecipient } from '../src/sim/mail/account_bound';
import { type AccountLookupPool, characterAccountId } from './mail_recipient_db';
import type { CharRef } from './social';

/** The sender's identity the resolution compares against. */
export interface MailSender {
  characterId: number;
  accountId: number;
}

/** The character-directory slice of SocialDb the offline arm needs. */
export interface MailRecipientDirectory {
  findCharacterByName(name: string): Promise<CharRef | null>;
  blockedIds(charId: number): Promise<number[]>;
}

/** Build the sim recipient for a character whose account is already known
 *  (a live session): the key is the stable character id string. */
export function mailRecipientFor(
  characterId: number,
  name: string,
  recipientAccountId: number,
  sender: Pick<MailSender, 'accountId'>,
): MailRecipient {
  return {
    key: String(characterId),
    name,
    sameAccount: recipientAccountId === sender.accountId,
  };
}

/** Whether the character row belongs to `accountId`. A missing row (deleted
 *  between the name lookup and this read) answers false: never same-account
 *  by accident. The read lives in mail_recipient_db.ts (SQL stays in *_db). */
export async function characterSharesAccount(
  pool: AccountLookupPool,
  characterId: number,
  accountId: number,
): Promise<boolean> {
  const owner = await characterAccountId(pool, characterId);
  return owner !== null && owner === accountId;
}

/** The offline arm: resolve a typed name against the character directory,
 *  apply the recipient's block list (blocked == "no such recipient"), then
 *  stamp `sameAccount` from the characters table. Null means refuse with
 *  `noRecipient`; the caller re-checks its session before touching the sim. */
export async function resolveOfflineMailRecipient(
  directory: MailRecipientDirectory,
  pool: AccountLookupPool,
  to: string,
  sender: MailSender,
): Promise<MailRecipient | null> {
  const target = await directory.findCharacterByName(to);
  if (!target) return null;
  const blockedBy = await directory.blockedIds(target.id);
  if (blockedBy.includes(sender.characterId)) return null;
  const sameAccount = await characterSharesAccount(pool, target.id, sender.accountId);
  return { key: String(target.id), name: target.name, sameAccount };
}
