import type * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  CharacterDeleteClientGone,
  CharacterDeleteQueueSaturated,
  CharacterStoragePurchaseOpen,
} from '../../server/character_delete_db';
import {
  CHARACTER_DELETE_BUSY_BODY,
  CHARACTER_STORAGE_PURCHASE_OPEN_BODY,
  characterDeleteClientGone,
  characterDeleteHttpRefusal,
  characterDeleteRequestSignal,
} from '../../server/character_delete_http';
import { FakeRes } from './helpers/fake_http';

describe('characterDeleteHttpRefusal', () => {
  it.each(['pending', 'unresolved'] as const)(
    'maps an open %s storage purchase to the same non-sensitive 409 contract',
    (status) => {
      const refusal = characterDeleteHttpRefusal(new CharacterStoragePurchaseOpen(42, status));

      expect(refusal).toEqual({
        status: 409,
        body: {
          error:
            'A storage purchase must finish or be resolved before this character can be deleted.',
          code: 'character.storage_purchase_open',
        },
      });
      expect(refusal?.body).toBe(CHARACTER_STORAGE_PURCHASE_OPEN_BODY);
      expect(JSON.stringify(refusal)).not.toContain('42');
      expect(JSON.stringify(refusal)).not.toContain(status);
    },
  );

  it('maps gate saturation to a retryable non-sensitive 503', () => {
    const refusal = characterDeleteHttpRefusal(new CharacterDeleteQueueSaturated(42));

    expect(refusal).toEqual({
      status: 503,
      body: {
        error: 'The realm is busy. Try deleting this character again in a moment.',
        code: 'character.delete_busy',
      },
    });
    expect(refusal?.body).toBe(CHARACTER_DELETE_BUSY_BODY);
    expect(JSON.stringify(refusal)).not.toContain('42');
  });

  it('leaves unrelated failures for the caller to surface', () => {
    expect(characterDeleteHttpRefusal(new Error('database unavailable'))).toBeNull();
    expect(characterDeleteHttpRefusal(null)).toBeNull();
  });

  it('keeps a client-gone abandonment OUT of the refusal mapping: no 503 on a dead socket', () => {
    const gone = new CharacterDeleteClientGone(42);
    // The predicate is the arms' no-write short-circuit; the refusal mapper
    // must never turn the abandonment into a booked saturation 503.
    expect(characterDeleteClientGone(gone)).toBe(true);
    expect(characterDeleteHttpRefusal(gone)).toBeNull();
    // And the predicate stays specific: the real refusals are not client-gone.
    expect(characterDeleteClientGone(new CharacterDeleteQueueSaturated(42))).toBe(false);
    expect(characterDeleteClientGone(new CharacterStoragePurchaseOpen(42, 'pending'))).toBe(false);
    expect(characterDeleteClientGone(new Error('database unavailable'))).toBe(false);
    expect(characterDeleteClientGone(null)).toBe(false);
  });
});

describe('characterDeleteRequestSignal', () => {
  it('starts unaborted and aborts when the connection closes before the response ends', () => {
    const res = new FakeRes();
    const signal = characterDeleteRequestSignal(res as unknown as http.ServerResponse);
    expect(signal.aborted).toBe(false);
    // The client tore the connection mid-delete: node emits 'close' with the
    // response still unfinished.
    res.emit('close');
    expect(signal.aborted).toBe(true);
  });

  it('never aborts on the ordinary close after a finished response', () => {
    const res = new FakeRes();
    const signal = characterDeleteRequestSignal(res as unknown as http.ServerResponse);
    res.end('{"ok":true}');
    // Every completed exchange also emits 'close'; a post-response abort
    // would cancel nothing useful but must not fire regardless.
    res.emit('close');
    expect(signal.aborted).toBe(false);
  });
});

describe('delete dispatch arm wiring (source pins)', () => {
  // The legacy /api ladder cannot be driven db-free end to end (its DELETE
  // arm sits behind a live bearer resolve), so pin the exact call shape: the
  // arm builds the signal from ITS response object and threads it as
  // deleteCharacter's third argument. The helper's abort behavior is pinned
  // above; that a threaded signal short-circuits the bounded gate wait is
  // pinned in tests/character_db.test.ts. The migrated characters.ts arm has
  // a full behavioral drive in tests/server/characters.test.ts.
  it('the legacy main.ts arm threads the request close signal into deleteCharacter', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../helpers/strip_comments');
    // Strip FIRST, then slice: a commented-out copy of the start marker
    // above the real arm would otherwise widen the slice silently.
    const src = stripComments(
      readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8'),
    );
    // Slice to the DELETE dispatch arm before matching, the sibling idiom in
    // tests/server/characters.test.ts ('legacy DELETE dispatch arm'): a
    // whole-file grep would stay green on a second characterDeleteClientGone
    // guard anywhere in main.ts while the real arm regressed.
    const start = src.indexOf("if (req.method === 'DELETE' && delMatch) {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("url === '/api/realms'", start);
    expect(end).toBeGreaterThan(start);
    const arm = src.slice(start, end);
    expect(arm).toMatch(
      /deleteCharacter\(\s*accountId,\s*characterId,\s*characterDeleteRequestSignal\(res\),?\s*\)/,
    );
    // And its catch short-circuits a client-gone abandonment to a NO-WRITE
    // BEFORE the refusal mapping, so a dead socket is never booked as a 503
    // (the migrated arm's behavioral twin lives in tests/server/characters.test.ts).
    expect(arm).toMatch(
      /if \(characterDeleteClientGone\(error\)\) return;\s*const refusal = characterDeleteHttpRefusal\(error\);/,
    );
  });
});
