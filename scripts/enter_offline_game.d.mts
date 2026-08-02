export interface OfflineEntryOptions {
  charClass?: string;
  charName?: string;
  settleMs?: number;
  dismissMobilePreflight?: boolean;
  mobilePreflightTimeoutMs?: number;
  gameBootTimeoutMs?: number;
  selectorTimeoutMs?: number;
}

export function enterOfflineGame(page: unknown, opts?: OfflineEntryOptions): Promise<boolean>;
export function dismissEntryOverlays(page: unknown): Promise<void>;
