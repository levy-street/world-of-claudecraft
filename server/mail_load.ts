import type { MailSave } from '../src/sim/sim';
import { loadMailState } from './db';
import { type CustodyParcelBook, mergeCustodyParcelOverlay } from './mail_custody_overlay';

export async function loadRealmMail(
  book: CustodyParcelBook & { loadMail(save: MailSave | null): void },
): Promise<boolean> {
  try {
    book.loadMail(await loadMailState());
    // Replay only after a successful partition load; an unloaded book is not truth.
    return (await mergeCustodyParcelOverlay(book)).ok;
  } catch (err) {
    console.error('failed to load mail:', err);
    return false;
  }
}
