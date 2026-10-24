// One revision-pinned live vault read, streamed only as the socket drains.
// No whole-vault JSON string, parallel transfer queue, or storage size limit.

import type { VaultInfoRead } from '../src/sim/materials_vault';
import {
  VAULT_TRANSFER_FRAME_BYTES,
  VAULT_TRANSFER_SOFT_BACKLOG_BYTES,
  VAULT_TRANSFER_STRING_CHARS,
  VAULT_TRANSFER_TOKEN_LIMIT,
  VAULT_TRANSFER_VERSION,
  type VaultTransferChunk,
  type VaultTransferToken,
} from '../src/vault_transfer_protocol';
import { VaultTransferTree } from '../src/vault_transfer_tree';
import type { VaultInfo } from '../src/world_api';

function* textTokens(kind: 4 | 5, text: string): Generator<VaultTransferToken> {
  if (text.length === 0) {
    yield [kind, '', true];
    return;
  }
  for (let offset = 0; offset < text.length; offset += VAULT_TRANSFER_STRING_CHARS) {
    const end = Math.min(text.length, offset + VAULT_TRANSFER_STRING_CHARS);
    // Splitting a surrogate pair is lossless: each JSON token escapes a lone
    // code unit and the receiver rejoins the original UTF-16 string verbatim.
    yield [kind, text.slice(offset, end), end === text.length];
  }
}

function* tokens(value: unknown, omitSlot = false, root = false): Generator<VaultTransferToken> {
  if (typeof value === 'string') yield* textTokens(5, value);
  else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    yield [6, value];
  } else if (Array.isArray(value)) {
    yield [2];
    for (const entry of value) yield* tokens(entry);
    yield [3];
  } else if (value && typeof value === 'object') {
    yield [0];
    for (const key in value) {
      if (!Object.hasOwn(value, key) || (omitSlot && key === 'slot')) continue;
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue; // JSON's omitted optional fields
      yield* textTokens(4, key);
      if (root && key === 'special' && Array.isArray(entry)) {
        yield [2];
        for (const row of entry) yield* tokens(row, true);
        yield [3];
      } else yield* tokens(entry);
    }
    yield [1];
  } else throw new Error('Invalid vault projection value');
}

export class VaultTransferSender {
  private readonly iterator: Generator<VaultTransferToken>;
  private pending: IteratorResult<VaultTransferToken> | undefined;
  private prepared: VaultTransferChunk | undefined;
  private cursor = 0;

  constructor(
    readonly id: number,
    readonly info: VaultInfoRead['value'],
  ) {
    this.iterator = tokens(info, false, true);
  }

  peek(): VaultTransferChunk {
    if (this.prepared) return this.prepared;
    const batch: VaultTransferToken[] = [];
    // Envelope and separators, with ample room for safe-integer ids/cursors.
    let bytes = 256;
    let next = this.pending ?? this.iterator.next();
    while (!next.done && batch.length < VAULT_TRANSFER_TOKEN_LIMIT) {
      const tokenBytes = Buffer.byteLength(JSON.stringify(next.value), 'utf8') + 1;
      if (bytes + tokenBytes > VAULT_TRANSFER_FRAME_BYTES) break;
      bytes += tokenBytes;
      batch.push(next.value);
      next = this.iterator.next();
    }
    this.pending = next;
    if (batch.length === 0 && !next.done) throw new Error('Vault token exceeds frame bound');
    this.prepared = {
      vaultTransfer: VAULT_TRANSFER_VERSION,
      id: this.id,
      cursor: this.cursor,
      done: !!next.done,
      tokens: batch,
    };
    return this.prepared;
  }

  boundedSmallInfo(): VaultInfo {
    const chunk = this.peek();
    if (!chunk.done || chunk.cursor !== 0) throw new Error('Vault is not a bounded single batch');
    const tree = new VaultTransferTree();
    for (const token of chunk.tokens)
      if (!tree.consume(token)) throw new Error('Invalid vault projection grammar');
    if (!tree.complete) throw new Error('Incomplete vault projection');
    return tree.value as VaultInfo;
  }

  // Called only after emit accepted the chunk. A throwing emitter retries the
  // same cursor and bytes instead of skipping data or stamping the revision.
  accept(): void {
    const chunk = this.peek();
    const next = this.cursor + chunk.tokens.length;
    if (!Number.isSafeInteger(next)) throw new Error('Vault cursor overflow');
    this.cursor = next;
    this.prepared = undefined;
  }
}

export function vaultTransferCanSend(ws?: { bufferedAmount?: number }): boolean {
  return (ws?.bufferedAmount ?? 0) <= VAULT_TRANSFER_SOFT_BACKLOG_BYTES;
}

export interface VaultTransferSession {
  ws?: { bufferedAmount?: number };
  lastSent: Readonly<Record<string, string>>;
  lastVaultWirePid: number | null;
  lastVaultWireRev: number | null;
  vaultTransferSocket?: unknown;
  nextVaultTransferId?: number;
  vaultTransfer?: { sender: VaultTransferSender; read: VaultInfoRead; pid: number; rev: number };
}

export function emitPacedVaultProjection(
  emit: (key: 'vault', value: unknown) => void,
  session: VaultTransferSession,
  pid: number,
  rev: number | null,
  project: () => VaultInfoRead | null,
): void {
  if (session.vaultTransferSocket !== session.ws) {
    delete session.vaultTransfer;
    session.lastVaultWirePid = null;
    session.lastVaultWireRev = null;
    session.vaultTransferSocket = session.ws;
  }
  const changed = pid !== session.lastVaultWirePid || rev !== session.lastVaultWireRev;
  if (rev === null) {
    if (changed || session.lastSent.vault === undefined || session.vaultTransfer)
      emit('vault', null);
    delete session.vaultTransfer;
  } else {
    let pending = session.vaultTransfer;
    if (pending && (pending.pid !== pid || pending.rev !== rev || !pending.read.isCurrent())) {
      delete session.vaultTransfer;
      session.lastVaultWireRev = null; // Re-arm even if identity changed without a numeric bump.
      pending = undefined;
    }
    // Do not bootstrap, enumerate, clone, tokenize or stamp a pending revision
    // while the actual socket backlog is above the soft transfer budget.
    if (!vaultTransferCanSend(session.ws)) return;
    if (
      !pending &&
      (changed || session.lastVaultWireRev === null || session.lastSent.vault === undefined)
    ) {
      const read = project();
      if (read === null || read.revision !== rev || !read.isCurrent()) emit('vault', null);
      else {
        const id = (session.nextVaultTransferId ?? 0) + 1;
        if (!Number.isSafeInteger(id)) throw new Error('Vault transfer id overflow');
        session.nextVaultTransferId = id;
        pending = { sender: new VaultTransferSender(id, read.value), read, pid, rev };
        session.vaultTransfer = pending;
      }
    }
    if (pending) {
      const chunk = pending.sender.peek();
      // Only a completed first bounded batch is materialized as an ordinary
      // small record. Large reads never construct a detached server tree.
      emit('vault', chunk.done && chunk.cursor === 0 ? pending.sender.boundedSmallInfo() : chunk);
      pending.sender.accept();
      if (chunk.done) delete session.vaultTransfer;
    }
  }
  session.lastVaultWirePid = pid;
  session.lastVaultWireRev = rev;
}
