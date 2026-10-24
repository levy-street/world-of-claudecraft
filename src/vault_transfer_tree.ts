import { VAULT_TRANSFER_DEPTH, type VaultTransferToken } from './vault_transfer_protocol';

type Frame = { value: Record<string, unknown> | unknown[]; key?: string };

/** Vault-only incremental tree grammar, shared by receive and bounded small sends. */
export class VaultTransferTree {
  private root: unknown;
  private hasRoot = false;
  private stack: Frame[] = [];
  private text: { kind: 4 | 5; value: string } | undefined;

  clear(): void {
    this.root = undefined;
    this.hasRoot = false;
    this.stack = [];
    this.text = undefined;
  }

  private add(value: unknown): boolean {
    const parent = this.stack.at(-1);
    if (!parent) {
      if (this.hasRoot) return false;
      this.root = value;
      this.hasRoot = true;
    } else if (Array.isArray(parent.value)) parent.value.push(value);
    else {
      if (parent.key === undefined || Object.hasOwn(parent.value, parent.key)) return false;
      // __proto__, constructor and prototype stay inert own data, just as in
      // JSON.parse and the existing bank/vault decoder. Never indexed assign.
      Object.defineProperty(parent.value, parent.key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      parent.key = undefined;
    }
    return true;
  }

  consume(token: VaultTransferToken): boolean {
    const kind = token[0];
    if (this.text && kind !== this.text.kind) return false;
    if (kind === 4 || kind === 5) {
      const parent = this.stack.at(-1);
      if (kind === 4 && (!parent || Array.isArray(parent.value) || parent.key !== undefined))
        return false;
      if (!this.text) this.text = { kind, value: '' };
      this.text.value += token[1];
      if (!token[2]) return true;
      const value = this.text.value;
      this.text = undefined;
      if (kind === 4) {
        if (!parent || Object.hasOwn(parent.value, value)) return false;
        parent.key = value;
        return true;
      }
      return this.add(value);
    }
    if (kind === 0 || kind === 2) {
      if (this.stack.length >= VAULT_TRANSFER_DEPTH) return false;
      const value = kind === 0 ? (Object.create(null) as Record<string, unknown>) : [];
      if (!this.add(value)) return false;
      this.stack.push({ value });
      return true;
    }
    if (kind === 1 || kind === 3) {
      const parent = this.stack.at(-1);
      if (!parent || parent.key !== undefined || Array.isArray(parent.value) !== (kind === 3))
        return false;
      this.stack.pop();
      return true;
    }
    return this.add(token[1]);
  }

  get complete(): boolean {
    return this.hasRoot && this.stack.length === 0 && !this.text;
  }
  get value(): unknown {
    return this.root;
  }
}
