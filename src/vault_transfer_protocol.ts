// Epoch-47 vault-only transport. Limits bound one frame and parser overhead,
// never the player's saved vault or its tolerated legacy rows.
export const VAULT_TRANSFER_VERSION = 1;
export const VAULT_TRANSFER_FRAME_BYTES = 256 * 1024;
export const VAULT_TRANSFER_TOKEN_LIMIT = 16384;
export const VAULT_TRANSFER_STRING_CHARS = 8192;
export const VAULT_TRANSFER_DEPTH = 24;
export const VAULT_TRANSFER_SOFT_BACKLOG_BYTES = 512 * 1024;

// Object/array open and close, segmented key/string, or JSON scalar.
export type VaultTransferToken =
  | [0 | 1 | 2 | 3]
  | [4 | 5, string, boolean]
  | [6, number | boolean | null];
export interface VaultTransferChunk {
  vaultTransfer: typeof VAULT_TRANSFER_VERSION;
  id: number;
  cursor: number;
  done: boolean;
  tokens: VaultTransferToken[];
}
