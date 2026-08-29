import type { AccountInfo, AccountSessionApi } from '../net/account_session_api';
import { ApiError } from '../net/api_error';

export type RestoredSession =
  | { authenticated: false }
  | { authenticated: true; account: AccountInfo };

export async function restoreValidatedSession(api: AccountSessionApi): Promise<RestoredSession> {
  if (!api.restoreSession()) return { authenticated: false };
  try {
    return { authenticated: true, account: await api.getAccount() };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      api.clearSession();
    }
    return { authenticated: false };
  }
}

export function splitSecondFactor(value: string): { code: string; recoveryCode: string } {
  const normalized = value.trim();
  return /^\d{6}$/.test(normalized)
    ? { code: normalized, recoveryCode: '' }
    : { code: '', recoveryCode: normalized };
}
