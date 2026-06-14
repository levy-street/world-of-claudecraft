export const CHAT_HISTORY_LIMIT = 200;

export interface StoredChatEntry {
  kind: 'from';
  at: number;
  color: string;
  name: string;
  text: string;
  prefix: string;
  separator: string;
  isPrivate: boolean;
  incomingPrivate: boolean;
}

type ChatStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function chatHistoryStorageKey(realm: string, playerName: string): string {
  const realmName = realm.trim() || 'offline';
  const normalized = playerName.trim() || 'player';
  return `woc_chat_history_${encodeURIComponent(realmName)}_${encodeURIComponent(normalized)}`;
}

export function chatPrivateSeenStorageKey(realm: string, playerName: string): string {
  const realmName = realm.trim() || 'offline';
  const normalized = playerName.trim() || 'player';
  return `woc_chat_private_seen_${encodeURIComponent(realmName)}_${encodeURIComponent(normalized)}`;
}

export function formatChatTimestamp(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `[${hh}:${mm}]`;
}

export function readStoredChatHistory(storage: ChatStorage | null | undefined, key: string): StoredChatEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredChatEntry).slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function appendStoredChatHistory(
  storage: ChatStorage | null | undefined,
  key: string,
  entry: StoredChatEntry,
): void {
  if (!storage) return;
  try {
    const entries = readStoredChatHistory(storage, key);
    entries.push(entry);
    storage.setItem(key, JSON.stringify(entries.slice(-CHAT_HISTORY_LIMIT)));
  } catch {
    // localStorage can throw in private browsing or when quota is full.
  }
}

export function readChatPrivateSeenAt(storage: ChatStorage | null | undefined, key: string): number {
  if (!storage) return 0;
  try {
    const value = Number(storage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeChatPrivateSeenAt(storage: ChatStorage | null | undefined, key: string, at: number): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(at));
  } catch {
    // localStorage can throw in private browsing or when quota is full.
  }
}

function isStoredChatEntry(value: unknown): value is StoredChatEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.kind === 'from'
    && typeof row.at === 'number'
    && Number.isFinite(row.at)
    && typeof row.color === 'string'
    && typeof row.name === 'string'
    && typeof row.text === 'string'
    && typeof row.prefix === 'string'
    && typeof row.separator === 'string'
    && typeof row.isPrivate === 'boolean'
    && typeof row.incomingPrivate === 'boolean';
}
