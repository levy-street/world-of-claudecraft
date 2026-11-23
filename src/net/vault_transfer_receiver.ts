// Incrementally builds the future VaultInfo only. Public state changes atomically
// after the normal strict vault decoder validates the completed tree. There is
// no parallel-transfer map, declared-size preallocation, or whole JSON buffer.
import {
  VAULT_TRANSFER_FRAME_BYTES,
  VAULT_TRANSFER_STRING_CHARS,
  VAULT_TRANSFER_TOKEN_LIMIT,
  VAULT_TRANSFER_VERSION,
  type VaultTransferToken,
} from '../vault_transfer_protocol';
import { VaultTransferTree } from '../vault_transfer_tree';
import type { VaultInfo } from '../world_api';
import { decodeVaultInfoWire, isRecord } from './vault_snapshot_wire';

export interface VaultTransferMirror {
  vaultInfo: VaultInfo | null;
  vaultTransferReceiver?: VaultTransferReceiver;
}

function tokenValid(token: unknown): token is VaultTransferToken {
  if (!Array.isArray(token)) return false;
  if ([0, 1, 2, 3].includes(token[0])) return token.length === 1;
  if (token[0] === 4 || token[0] === 5) {
    return (
      token.length === 3 &&
      typeof token[1] === 'string' &&
      token[1].length <= VAULT_TRANSFER_STRING_CHARS &&
      typeof token[2] === 'boolean'
    );
  }
  return (
    token[0] === 6 &&
    token.length === 2 &&
    (token[1] === null ||
      typeof token[1] === 'boolean' ||
      (typeof token[1] === 'number' && Number.isFinite(token[1])))
  );
}

function tokensWithinFrame(value: unknown): value is VaultTransferToken[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > VAULT_TRANSFER_TOKEN_LIMIT)
    return false;
  let bytes = 256; // Same conservative envelope allowance as the sender.
  const encoder = new TextEncoder();
  for (const token of value) {
    if (!tokenValid(token)) return false;
    // Check one bounded token at a time. Do not stringify an attacker-sized
    // batch before discovering that its declared frame exceeds the bound.
    bytes += encoder.encode(JSON.stringify(token)).length + 1;
    if (bytes > VAULT_TRANSFER_FRAME_BYTES) return false;
  }
  return true;
}

export class VaultTransferReceiver {
  private id = 0;
  private cursor = 0;
  private readonly tree = new VaultTransferTree();
  private active = false;

  private clear(): void {
    this.tree.clear();
    this.active = false;
  }

  // undefined means an accepted partial chunk or an obsolete transfer, not an
  // empty vault. Null is malformed, matching the existing vault reject policy.
  receive(value: unknown): VaultInfo | null | undefined {
    if (
      !isRecord(value) ||
      Object.keys(value).some(
        (k) => !['vaultTransfer', 'id', 'cursor', 'done', 'tokens'].includes(k),
      ) ||
      value.vaultTransfer !== VAULT_TRANSFER_VERSION ||
      !Number.isSafeInteger(value.id) ||
      (value.id as number) <= 0 ||
      !Number.isSafeInteger(value.cursor) ||
      (value.cursor as number) < 0 ||
      typeof value.done !== 'boolean' ||
      !tokensWithinFrame(value.tokens)
    ) {
      this.clear();
      return null;
    }
    const id = value.id as number;
    const cursor = value.cursor as number;
    if (id < this.id || (id === this.id && !this.active)) return undefined;
    if (id > this.id) {
      this.clear();
      this.id = id;
      this.cursor = 0;
      if (cursor !== 0) return null;
      this.active = true;
    }
    if (
      !this.active ||
      cursor !== this.cursor ||
      !Number.isSafeInteger(cursor + value.tokens.length)
    ) {
      this.clear();
      return null;
    }
    for (const token of value.tokens) {
      if (!this.tree.consume(token)) {
        this.clear();
        return null;
      }
    }
    this.cursor += value.tokens.length;
    if (!value.done) {
      if (this.tree.complete) {
        this.clear();
        return null;
      }
      return undefined;
    }
    const result = this.tree.complete ? decodeVaultInfoWire(this.tree.value) : null;
    this.clear();
    return result;
  }
}

export function applyVaultTransferWire(target: VaultTransferMirror, value: unknown): void {
  if (isRecord(value) && Object.hasOwn(value, 'vaultTransfer')) {
    target.vaultTransferReceiver ??= new VaultTransferReceiver();
    const decoded = target.vaultTransferReceiver.receive(value);
    if (decoded !== undefined) target.vaultInfo = decoded;
  } else {
    delete target.vaultTransferReceiver;
    target.vaultInfo = decodeVaultInfoWire(value);
  }
}

export function resetVaultTransferWire(target: VaultTransferMirror): void {
  delete target.vaultTransferReceiver;
  target.vaultInfo = null;
}
