import type { CharacterState } from './character_state';
import type { ReferralRewardLedger } from './referral_rewards';

export interface ReferralRewardState {
  referralRewards?: ReferralRewardLedger;
  referralInviterRewards?: number;
}
/** JSONB boundary: retain valid receipts while discarding malformed rows. */
export function referralRewardState(
  state: Pick<CharacterState, 'referralRewards' | 'referralInviterRewards'>,
): { referralRewards?: ReferralRewardLedger; referralInviterRewards?: number } {
  const result: ReferralRewardState = {};
  if (
    state.referralRewards &&
    typeof state.referralRewards === 'object' &&
    !Array.isArray(state.referralRewards)
  ) {
    const ledger: ReferralRewardLedger = {};
    for (const [key, value] of Object.entries(state.referralRewards)) {
      if (
        /^[1-9]\d*$/.test(key) &&
        Number.isSafeInteger(Number(key)) &&
        value &&
        Number.isSafeInteger(value.redeemed) &&
        value.redeemed >= 0 &&
        value.redeemed <= 31
      )
        ledger[key] = { redeemed: value.redeemed };
    }
    if (Object.keys(ledger).length) result.referralRewards = ledger;
  }
  if (
    Number.isSafeInteger(state.referralInviterRewards) &&
    state.referralInviterRewards! >= 0 &&
    state.referralInviterRewards! <= 31
  )
    result.referralInviterRewards = state.referralInviterRewards;
  return result;
}
