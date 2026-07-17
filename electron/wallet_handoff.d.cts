export function sanitizeWalletHandoffCode(value: unknown): string | null;
export function buildWalletHandoffBrowserUrl(origin: string, code: string): string;
export function parseWalletHandoffDeepLink(value: string): { code: string } | null;
