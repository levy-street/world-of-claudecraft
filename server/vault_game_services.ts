// The Buried Hoard vault wiring the GameServer coordinator owns, composed in one
// place: the vault-open save observer, the reward outcome/claim service, the
// direct-claim host, and the vault-mail take guard plus its recovery. The
// coordinator hands in closures over its private save/session machinery and
// keeps one-line call sites (tests/monolith_budget.test.ts pins server/game.ts).
// No game rules live here; every rule stays in the modules this composes.

import { applyDurableVaultGuestPayouts } from '../src/sim/rift/hoard_guest_cap';
import type { MailSave, Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import type { ClientSession } from './game';
import { snapshotPendingCustodyRefs } from './mail_custody_overlay';
import { takeMailPartitionsForCharacterSave } from './mail_partition_rearm';
import { claimVaultRewardForSession, type VaultDirectClaimHost } from './vault_direct_claim_host';
import { handleVaultMailTake, VaultMailTakeGuard } from './vault_mail_take_guard';
import { VaultMailTakeRecovery } from './vault_mail_take_recovery';
import * as vo from './vault_open_persistence';
import { saveVaultOwner, VaultRewardService } from './vault_reward_service';

/** What the vault services borrow from the GameServer coordinator. */
export interface VaultGameHost {
  sim(): Sim;
  session(pid: number): ClientSession | undefined;
  sessionByCharacterId(characterId: number): ClientSession | null;
  enqueue: VaultDirectClaimHost['enqueue'];
  hasSaveConflict(characterId: number): boolean;
  serialize: VaultDirectClaimHost['serialize'];
  withPermit<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  acknowledge: VaultDirectClaimHost['acknowledge'];
  quarantine: VaultDirectClaimHost['quarantine'];
  /** A fenced character save on the background DB permit. */
  saveInBackground(session: ClientSession): Promise<boolean>;
  /** The ordinary fenced character save. */
  save(session: ClientSession): Promise<boolean>;
  kick(session: ClientSession, message: string, auditReason: string): void;
}

/** The mail snapshot a character save carries while a vault take is fenced. */
export interface VaultMailSaveCapture {
  partitions: { recipientKey: string; letters: MailSave['mail'] }[];
  generation: number | undefined;
  custodyRefs: string[];
}

export class VaultGameServices {
  readonly guard = new VaultMailTakeGuard();
  private readonly openSaveState = vo.createVaultOpenPersistenceState();
  private readonly openPersistence: vo.VaultOpenPersistenceDeps;
  private readonly recovery: VaultMailTakeRecovery;
  private readonly claimHost: VaultDirectClaimHost;
  readonly rewards: VaultRewardService;

  constructor(private readonly host: VaultGameHost) {
    const sim = host.sim();
    sim.cfg.vaultOpenNeedsSave = true;
    sim.cfg.vaultRewardNeedsSave = true;
    this.recovery = new VaultMailTakeRecovery(
      this.guard,
      () => host.sim(),
      (run, signal) => host.withPermit(run, signal),
    );
    this.openPersistence = vo.createVaultOpenPersistenceDeps(
      () => host.sim(),
      (pid) => host.session(pid),
      (session) => host.saveInBackground(session),
    );
    this.claimHost = {
      sim,
      enqueue: (id, job, signal) => host.enqueue(id, job, signal),
      session: (id) => host.sessionByCharacterId(id),
      mailTakeLocked: (id) => this.guard.isLocked(id),
      hasSaveConflict: (id) => host.hasSaveConflict(id),
      serialize: (id) => host.serialize(id),
      withPermit: (run, signal) => host.withPermit(run, signal),
      acknowledge: (save) => host.acknowledge(save),
      quarantine: (pid, id, kind, surface) => host.quarantine(pid, id, kind, surface),
    };
    this.rewards = new VaultRewardService({
      sim,
      withPermit: (run, signal) => host.withPermit(run, signal),
      saveOwner: (pid) =>
        saveVaultOwner(host.session(pid), (session) => host.saveInBackground(session)),
      claimDirect: (attemptId, claim, owner) =>
        claimVaultRewardForSession(this.claimHost, attemptId, claim, owner),
      characterPid: (characterId) => host.sessionByCharacterId(characterId)?.pid ?? null,
      onClaimFailure: (characterId, error) => console.error(`vault reward ${characterId}:`, error),
    });
  }

  /** Per-tick observer: vault-open saves, then the reward outcome/claim pump. */
  observe(events: readonly SimEvent[]): void {
    vo.persistNewVaultOpens(events, this.openSaveState, this.openPersistence);
    this.rewards.observe(events);
    this.rewards.tick();
  }

  /** A fresh join is refused while this character's vault mail is still recovering. */
  joinError(characterId: number): string | null {
    return this.recovery.joinError(characterId);
  }

  /** Re-applies the durable per-cycle guest payout count loaded at join. */
  applyGuestUsage(pid: number, usage: { cycle: string; payouts: number } | undefined): void {
    const meta = this.host.sim().meta(pid);
    if (usage && meta) applyDurableVaultGuestPayouts(meta, usage.cycle, usage.payouts, usage.cycle);
  }

  /** A registered session: heal an orphaned vault-mail take, reconcile a live attempt. */
  onJoin(pid: number, characterId: number): void {
    if (!this.guard.maySave(characterId, pid)) this.recovery.recover(characterId);
    const attemptId = this.host.sim().meta(pid)?.vaultAttempt?.id;
    if (attemptId) void this.rewards.reconcileJoin(pid, characterId, attemptId);
  }

  /** Drains the mail partitions a character save carries and captures the take fence. */
  captureMailSave(
    session: Pick<ClientSession, 'characterId' | 'pid'>,
    withMarket: boolean,
  ): VaultMailSaveCapture {
    const { characterId, pid } = session;
    const partitions = takeMailPartitionsForCharacterSave(
      this.host.sim(),
      characterId,
      this.guard.blocked,
      !withMarket,
    );
    return {
      partitions,
      generation: this.guard.capture(characterId, pid, partitions),
      custodyRefs: snapshotPendingCustodyRefs(partitions.map((p) => p.recipientKey)),
    };
  }

  /** The `mail_take` command: a vault letter take is fenced behind its own save. */
  mailTake(session: ClientSession, mailId: number): void {
    handleVaultMailTake(
      this.guard,
      this.host.sim(),
      session.characterId,
      session.pid,
      mailId,
      () => this.host.save(session),
      () =>
        this.host.kick(
          session,
          'Vault reward save failed. Please reconnect.',
          'vault mail save failed',
        ),
      () => void this.rewards.onVaultMailTaken(session.characterId),
    );
  }
}
