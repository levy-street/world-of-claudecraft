import type * as http from 'node:http';
import {
  CharacterDeleteClientGone,
  CharacterDeleteQueueSaturated,
  CharacterStoragePurchaseOpen,
} from './character_delete_db';

/** An abort signal that fires when the client goes away before the response
 * is finished. Both DELETE dispatch arms thread it into deleteCharacter,
 * where it bounds ONLY the permit wait (a disconnected client stops burning
 * the bounded gate wait); it deliberately never reaches the transaction, so
 * a disconnect during COMMIT can no longer strand a committed DELETE without
 * its world-state purge. The 'close' every completed exchange also emits
 * never aborts: by then the response has ended and the delete has settled. */
export function characterDeleteRequestSignal(res: http.ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.once('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

/** Stable legacy-envelope refusal shared by both character DELETE dispatch arms. */
export const CHARACTER_STORAGE_PURCHASE_OPEN_BODY = {
  error: 'A storage purchase must finish or be resolved before this character can be deleted.',
  code: 'character.storage_purchase_open',
} as const;

/** Retryable gate-saturation refusal: the delete never took a pool client. */
export const CHARACTER_DELETE_BUSY_BODY = {
  error: 'The realm is busy. Try deleting this character again in a moment.',
  code: 'character.delete_busy',
} as const;

export interface CharacterDeleteHttpRefusal {
  status: 409 | 503;
  body: typeof CHARACTER_STORAGE_PURCHASE_OPEN_BODY | typeof CHARACTER_DELETE_BUSY_BODY;
}

/** True when the delete failed only because the requesting client vanished
 * during the permit wait. The socket is closed, so both dispatch arms write
 * NOTHING for it: any status would reach nobody, and booking the 503 would
 * count a dead client as gate saturation. */
export function characterDeleteClientGone(error: unknown): boolean {
  return error instanceof CharacterDeleteClientGone;
}

/** Translate only the known domain refusals, without exposing character id or status. */
export function characterDeleteHttpRefusal(error: unknown): CharacterDeleteHttpRefusal | null {
  if (error instanceof CharacterStoragePurchaseOpen) {
    return { status: 409, body: CHARACTER_STORAGE_PURCHASE_OPEN_BODY };
  }
  if (error instanceof CharacterDeleteQueueSaturated) {
    return { status: 503, body: CHARACTER_DELETE_BUSY_BODY };
  }
  return null;
}
