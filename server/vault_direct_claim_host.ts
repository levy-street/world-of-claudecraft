// GameServer adapter for a direct vault chest claim. The caller supplies its
// character FIFO and session guards; all economic work stays in this sibling.

import { grantHoardReward } from '../src/sim/rift/hoard_reward_grant';
import type { Sim } from '../src/sim/sim';
import type { BankLedgerOutboxSnapshot } from './bank_ledger_outbox';
import { bankLedgerSaveEffects } from './bank_ledger_session';
import { pool, saveCharacterStateOnClient } from './db';
import { backendCancelViaPool } from './db_transaction_deadline';
import { REALM } from './realm';
import { KeyedSerialWriteAborted } from './serial_writer';
import type { StorageAppliedEffect } from './storage_purchase_db';
import { commitVaultDirectClaim, type VaultDirectClaimResult } from './vault_direct_claim';
import type { VaultRewardClaim } from './vault_rewards_db';
import type { CharacterSaveArgs } from './woc_market_character_save';

const cancelVaultBackend = backendCancelViaPool(pool);

interface VaultClaimSession {
  pid: number;
  characterId: number;
  left: boolean;
  escrowQuarantined: boolean;
  leaseNonce?: string;
  lastSave: number;
}

interface VaultClaimSnapshot {
  level: number;
  state: CharacterSaveArgs['state'];
  storageEffects: StorageAppliedEffect[];
  bankLedgerSnapshot: BankLedgerOutboxSnapshot;
}

export interface VaultDirectClaimHost {
  sim: Sim;
  enqueue<T>(characterId: number, job: () => Promise<T>, signal: AbortSignal): Promise<T>;
  session(characterId: number): VaultClaimSession | null;
  mailTakeLocked(characterId: number): boolean;
  hasSaveConflict(characterId: number): boolean;
  serialize(characterId: number): VaultClaimSnapshot | null;
  withPermit<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T>;
  acknowledge(save: CharacterSaveArgs): boolean;
  quarantine(pid: number, characterId: number, kind: 'fenced' | 'ambiguous', surface: string): void;
}

export function claimVaultRewardForSession(
  host: VaultDirectClaimHost,
  attemptId: string,
  claim: VaultRewardClaim,
  owner: boolean,
  commit: typeof commitVaultDirectClaim = commitVaultDirectClaim,
): Promise<VaultDirectClaimResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  const work = host.enqueue(
    claim.characterId,
    async () => {
      const session = host.session(claim.characterId);
      if (!session || session.left || session.escrowQuarantined) return 'retry';
      if (host.mailTakeLocked(claim.characterId) || host.hasSaveConflict(claim.characterId))
        return 'retry';
      const snap = host.serialize(claim.characterId);
      if (!snap) return 'retry';
      const saveArgs: CharacterSaveArgs = {
        characterId: claim.characterId,
        level: snap.level,
        state: snap.state,
        leaseNonce: session.leaseNonce,
        storageEffects: snap.storageEffects,
        bankLedgerSnapshot: snap.bankLedgerSnapshot,
      };
      let result: VaultDirectClaimResult;
      try {
        result = await host.withPermit(
          () =>
            commit(
              {
                pool,
                cancelBackend: cancelVaultBackend,
                saveCharacter: (client, state) =>
                  saveCharacterStateOnClient(
                    client as import('pg').PoolClient,
                    claim.characterId,
                    state.level,
                    state,
                    session.leaseNonce,
                    snap.storageEffects,
                    bankLedgerSaveEffects(snap.bankLedgerSnapshot),
                  ),
              },
              { realm: REALM, attemptId, claim, owner, state: snap.state },
            ),
          controller.signal,
        );
      } catch (error) {
        if (
          controller.signal.aborted &&
          error instanceof DOMException &&
          error.name === 'AbortError'
        )
          return 'retry';
        host.quarantine(session.pid, claim.characterId, 'ambiguous', 'vault reward');
        throw error;
      }
      if (result === 'lease_lost') {
        host.quarantine(session.pid, claim.characterId, 'fenced', 'vault reward');
      } else if (result === 'delivered') {
        const acknowledged = host.acknowledge(saveArgs);
        const inst = host.sim.ctx.riftInstances.find(
          (candidate) => candidate.vault?.attemptId === attemptId,
        );
        const reward = {
          items: claim.items,
          copper: claim.copper,
          capped: claim.items.length === 0 && claim.copper === 0,
        };
        if (
          !acknowledged ||
          !inst?.vault ||
          !grantHoardReward(
            host.sim.ctx,
            session.pid,
            inst.vault.rarity,
            reward,
            owner,
            claim.guestCycle,
            true,
          )
        ) {
          host.quarantine(session.pid, claim.characterId, 'ambiguous', 'vault reward projection');
          throw new Error('vault reward committed but live projection unavailable');
        }
        session.lastSave = Date.now();
      }
      return result;
    },
    controller.signal,
  );
  return work
    .catch((error) => {
      if (error instanceof KeyedSerialWriteAborted) return 'retry' as const;
      throw error;
    })
    .finally(() => clearTimeout(timer));
}
