// One direct chest collection: a fresh character snapshot with the immutable
// reward and its claim marker commit together. The caller holds the existing
// per-character save FIFO for the whole operation.

import type { CharacterState } from '../src/sim/character_state';
import { assertHeroicMarksGrantsFit, HeroicMarksCapacityError } from '../src/sim/heroic_marks';
import type { InvSlot } from '../src/sim/types';
import { beginCharacterSaveTx } from './character_save_transaction';
import { addVaultRewardToCharacterState } from './vault_reward_state';
import {
  markVaultRewardClaimBooked,
  type VaultRewardClaim,
  type VaultRewardClient,
  type VaultRewardPool,
} from './vault_rewards_db';

export interface VaultDirectClaimArgs {
  realm: string;
  attemptId: string;
  claim: VaultRewardClaim;
  owner: boolean;
  state: CharacterState;
  preparedItems?: readonly InvSlot[];
}

export interface VaultDirectClaimDeps {
  pool: Pick<VaultRewardPool, 'connect'>;
  saveCharacter(client: VaultRewardClient, state: CharacterState): Promise<boolean>;
  cancelBackend?: (processId: number) => Promise<void>;
}

export type VaultDirectClaimResult = 'delivered' | 'already_claimed' | 'lease_lost' | 'retry';

export async function commitVaultDirectClaim(
  deps: VaultDirectClaimDeps,
  args: VaultDirectClaimArgs,
): Promise<VaultDirectClaimResult> {
  // This known capacity refusal is before snapshot mutation, connection or
  // write. Keep the durable claim pending without quarantining a valid player.
  // Unknown faults and all ambiguous post-write failures retain their guards.
  assertHeroicMarksGrantsFit({ heroicMarks: 0 }, args.claim.items);
  try {
    assertHeroicMarksGrantsFit(args.state, args.claim.items);
  } catch (error) {
    if (error instanceof HeroicMarksCapacityError) return 'retry';
    throw error;
  }
  const state = addVaultRewardToCharacterState(args.state, args.claim, args.preparedItems);
  let client: VaultRewardClient;
  try {
    client = await deps.pool.connect();
  } catch {
    return 'retry';
  }
  let transaction: Awaited<ReturnType<typeof beginCharacterSaveTx>>;
  try {
    transaction = await beginCharacterSaveTx(
      client as import('pg').PoolClient,
      'vault direct claim',
      undefined,
      deps.cancelBackend,
    );
  } catch {
    // beginCharacterSaveTx rolls back and releases its client on failure.
    return 'retry';
  }
  let commitStarted = false;
  try {
    const saved = await deps.saveCharacter(transaction as unknown as VaultRewardClient, state);
    if (!saved) {
      await transaction.rollback();
      return 'lease_lost';
    }
    const booked = await markVaultRewardClaimBooked(
      transaction,
      args.realm,
      args.attemptId,
      args.claim.characterId,
      'direct',
    );
    if (!booked) {
      await transaction.rollback();
      return 'already_claimed';
    }
    commitStarted = true;
    await transaction.commit();
    return 'delivered';
  } catch (error) {
    await transaction.rollback();
    if (commitStarted) throw error;
    return 'retry';
  } finally {
    transaction.release();
  }
}
