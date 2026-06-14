import { describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY_LIMIT,
  appendStoredChatHistory,
  chatHistoryStorageKey,
  chatPrivateSeenStorageKey,
  formatChatTimestamp,
  readChatPrivateSeenAt,
  readStoredChatHistory,
  writeChatPrivateSeenAt,
  type StoredChatEntry,
} from '../src/ui/chat_history';

class FakeStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function entry(text: string, at = Date.UTC(2026, 0, 2, 3, 4)): StoredChatEntry {
  return {
    kind: 'from',
    at,
    color: '#ff80ff',
    name: 'Ardenn',
    text,
    prefix: '',
    separator: ' whispers: ',
    isPrivate: true,
    incomingPrivate: true,
  };
}

describe('chat history storage', () => {
  it('uses a stable per-character storage key', () => {
    expect(chatHistoryStorageKey(' Claudemoon ', ' Ardenn ')).toBe('woc_chat_history_Claudemoon_Ardenn');
    expect(chatPrivateSeenStorageKey(' Claudemoon ', ' Ardenn ')).toBe('woc_chat_private_seen_Claudemoon_Ardenn');
    expect(chatHistoryStorageKey('Claudemoon', 'Ardenn')).not.toBe(chatHistoryStorageKey('Claudemoon', 'ardenn'));
    expect(chatHistoryStorageKey('Claudemoon', 'Ardenn')).not.toBe(chatHistoryStorageKey('Otherrealm', 'Ardenn'));
    expect(chatHistoryStorageKey('', '')).toBe('woc_chat_history_offline_player');
  });

  it('keeps valid timestamped chat rows and ignores malformed rows', () => {
    const storage = new FakeStorage();
    const key = chatHistoryStorageKey('Claudemoon', 'Aleph');
    storage.setItem(key, JSON.stringify([
      entry('dungeon?'),
      { kind: 'from', text: 'missing fields' },
      'bad row',
    ]));

    expect(readStoredChatHistory(storage, key)).toEqual([entry('dungeon?')]);
  });

  it('appends chat rows while enforcing the visible chat limit', () => {
    const storage = new FakeStorage();
    const key = chatHistoryStorageKey('Claudemoon', 'Aleph');
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 3; i++) {
      appendStoredChatHistory(storage, key, entry(`msg ${i}`, i));
    }

    const rows = readStoredChatHistory(storage, key);
    expect(rows).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(rows[0].text).toBe('msg 3');
    expect(rows.at(-1)?.text).toBe(`msg ${CHAT_HISTORY_LIMIT + 2}`);
  });

  it('formats local chat timestamps as compact clock labels', () => {
    expect(formatChatTimestamp(new Date(2026, 0, 2, 3, 4).getTime())).toBe('[03:04]');
  });

  it('stores the last acknowledged private-message timestamp defensively', () => {
    const storage = new FakeStorage();
    const key = chatPrivateSeenStorageKey('Claudemoon', 'Aleph');

    expect(readChatPrivateSeenAt(storage, key)).toBe(0);
    writeChatPrivateSeenAt(storage, key, 1234);
    expect(readChatPrivateSeenAt(storage, key)).toBe(1234);
    storage.setItem(key, 'not a time');
    expect(readChatPrivateSeenAt(storage, key)).toBe(0);
  });
});
