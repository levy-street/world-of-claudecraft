export type AccountStatus = 'active' | 'suspended' | 'banned';

export interface AccountStatusFields {
  bannedAt: string | null;
  suspendedUntil: string | null;
}

export function accountStatusFor(account: AccountStatusFields, now = Date.now()): AccountStatus {
  if (account.bannedAt !== null) return 'banned';
  if (account.suspendedUntil !== null && new Date(account.suspendedUntil).getTime() > now) {
    return 'suspended';
  }
  return 'active';
}
