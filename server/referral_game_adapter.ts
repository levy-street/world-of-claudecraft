import { applyBankBonusStamp } from '../src/sim/bank';
import type { ReferralCardsAction } from '../src/sim/referral_contract';
import { referralParticipants } from '../src/sim/referral_evidence';
import {
  grantReferralInviterReward,
  grantReferralReward,
  moveReferralRewards,
  ownsReferralTitle,
} from '../src/sim/referral_rewards';
import type { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { PROCESS_LEASE_HOLDER } from './character_lease_db';
import { pool } from './db';
import type { ClientSession } from './game';
import type { MembershipGameServices } from './membership_game_services';
import { REALM, REALM_PUBLIC_ORIGIN } from './realm';
import { saveOfflineReferralCharacter, saveReferralCharacter } from './referral_character_save_db';
import {
  type ReferralGameHost,
  ReferralGameServices,
  type ReferralSession,
} from './referral_game_services';
import { createReferralFriendPageReadiness } from './referral_indexes';
import { getOrCreateReferralInvite } from './referral_invites_db';
import { ReferralRewardDelivery } from './referral_reward_delivery';
import { PgReferralStore } from './referral_store_db';
import { canInteractWithReferralFriend, canSummonReferralFriend } from './referral_summon';
import type { VaultGameHost } from './vault_game_services';

export interface ReferralAdapterHost {
  sim: Sim;
  session(characterId: number): ClientSession | null;
  enqueue: ReferralGameHost['enqueue'];
  capture: VaultGameHost['serialize'];
  conflict(characterId: number): boolean;
  withPermit: ReferralGameHost['withPermit'];
  acknowledge: ReferralGameHost['acknowledge'];
  quarantine(pid: number, characterId: number, kind: 'fenced' | 'ambiguous', surface: string): void;
  send(session: ClientSession, frame: unknown): void;
  teleport(session: ClientSession, pos: { x: number; z: number }): void;
  membership: MembershipGameServices;
  observeCost(ms: number): void;
}

/** Account-scoped lifecycle composition. The only retained collections are live
 * sessions; cards themselves stay in the bounded service pages and indexed DB. */
export class ReferralGameAdapter {
  readonly cards: ReferralGameServices;
  private readonly delivery: ReferralRewardDelivery;
  private readonly store: PgReferralStore;
  private readonly accounts = new Map<number, Set<ClientSession>>();
  private readonly refreshes = new Map<number, Promise<void>>();
  constructor(private readonly host: ReferralAdapterHost) {
    this.store = new PgReferralStore({
      pool,
      leaseHolder: PROCESS_LEASE_HOLDER,
      grant: (...args) => this.measure(() => grantReferralReward(...args)),
      move: (...args) => this.measure(() => moveReferralRewards(...args)),
      save: saveReferralCharacter,
      saveOffline: saveOfflineReferralCharacter,
      ready: createReferralFriendPageReadiness((sql) => pool.query(sql)),
    });
    const live = (s: ReferralSession): ClientSession | null => {
      const session = host.session(s.characterId);
      return session === s && !session.left && !session.escrowQuarantined ? session : null;
    };
    this.cards = new ReferralGameServices(
      {
        character: (s) =>
          live(s) ? (referralParticipants(host.sim.ctx, [s.pid])[0] ?? null) : null,
        sessionForAccount: (id, characterId, partyId) => {
          const sessions = this.accounts.get(id);
          if (partyId !== undefined)
            for (const s of sessions ?? []) {
              if (live(s) && referralParticipants(host.sim.ctx, [s.pid])[0]?.partyId === partyId)
                return s;
            }
          if (characterId)
            for (const s of sessions ?? []) if (s.characterId === characterId && live(s)) return s;
          for (const s of sessions ?? []) if (live(s)) return s;
          return null;
        },
        send: (s, snapshot) => {
          const session = live(s);
          if (session) host.send(session, { t: 'referralCards', snapshot });
        },
        enqueue: host.enqueue,
        serialize: (id) => {
          const session = host.session(id),
            snapshot = host.capture(id);
          return session && snapshot
            ? { ...snapshot, characterId: id, leaseNonce: session.leaseNonce }
            : null;
        },
        conflict: (id) => {
          const session = host.session(id);
          return host.conflict(id) || !!(session && host.sim.ctx.trades.has(session.pid));
        },
        withPermit: host.withPermit,
        acknowledge: host.acknowledge,
        quarantine: (s, kind, surface) => host.quarantine(s.pid, s.characterId, kind, surface),
        applyReward: (s, before, after) =>
          !!live(s) && host.sim.applyReferralRewardState(s.pid, before, after),
        canInteract: (a, b) =>
          !!live(a) && !!live(b) && canInteractWithReferralFriend(live(a)!, live(b)!),
        canSummon: (a, b) => !!live(a) && !!live(b) && this.canSummon(live(a)!, live(b)!),
        summon: (a, b) => {
          const from = live(a),
            to = live(b),
            entity = host.sim.entities.get(a.pid);
          if (!from || !to || !entity || !this.canSummon(from, to)) return false;
          host.teleport(to, entity.pos);
          return true;
        },
        accountInviteUrl: (id) =>
          host.withPermit(async () => {
            const token = await getOrCreateReferralInvite(id);
            return `${REALM_PUBLIC_ORIGIN || 'https://worldofclaudecraft.com'}/?ref=${token}`;
          }, AbortSignal.timeout(5000)),
        titleOwned: (s) => ownsReferralTitle(host.sim.meta(s.pid)?.referralRewards),
        now: Date.now,
        observeCost: host.observeCost,
        onError: (error) => console.error('referral card operation failed:', error),
      },
      this.store,
    );
    this.delivery = new ReferralRewardDelivery(
      {
        realm: REALM,
        withPermit: host.withPermit,
        applyEntitlements: (id, mask) => this.applyEntitlements(id, mask),
        membershipRecipient: (id) => {
          const recipient = host.membership.recipient(id);
          return recipient ? { ...recipient, realm: REALM } : null;
        },
        deliverMembershipBond: (id, receipt, recipient) =>
          recipient.realm === REALM
            ? host.membership.deliverToken(id, recipient, receipt)
            : Promise.resolve(false),
        observeCost: host.observeCost,
        onError: (error) => console.error('referral reward delivery failed:', error),
      },
      this.store,
    );
  }
  private measure<T>(run: () => T): T {
    const started = performance.now();
    try {
      return run();
    } finally {
      this.host.observeCost(performance.now() - started);
    }
  }
  private canSummon(a: ClientSession, b: ClientSession): boolean {
    return canSummonReferralFriend(this.host.sim, a, b);
  }
  attach(session: ClientSession): void {
    const sessions = this.accounts.get(session.accountId) ?? new Set<ClientSession>();
    sessions.add(session);
    this.accounts.set(session.accountId, sessions);
    this.cards.attach(session);
    this.delivery.attach(session.accountId);
    void this.refresh(session.accountId);
  }
  detach(session: ClientSession): void {
    this.cards.detach(session);
    const sessions = this.accounts.get(session.accountId);
    sessions?.delete(session);
    if (!sessions?.size) {
      this.accounts.delete(session.accountId);
      this.delivery.detach(session.accountId);
    }
  }
  observe(events: readonly SimEvent[]): void {
    for (const event of events) if (event.type === 'referralEvidence') this.cards.observe(event);
  }
  command(session: ClientSession, action: ReferralCardsAction): void {
    if (action.type === 'page') void this.refresh(session.accountId);
    void this.cards.command(session, action);
  }
  private refresh(accountId: number): Promise<void> {
    const existing = this.refreshes.get(accountId);
    if (existing) return existing;
    const pending = this.refreshEntitlements(accountId).finally(() =>
      this.refreshes.delete(accountId),
    );
    this.refreshes.set(accountId, pending);
    return pending;
  }
  private async refreshEntitlements(accountId: number): Promise<void> {
    try {
      this.applyEntitlements(
        accountId,
        await this.host.withPermit(
          () => this.store.accountRewards(accountId),
          AbortSignal.timeout(5000),
        ),
      );
    } catch (error) {
      console.error('referral entitlement refresh failed:', error);
    }
  }
  private applyEntitlements(accountId: number, mask: number): void {
    const started = performance.now();
    for (const session of this.accounts.get(accountId) ?? []) {
      if (session.left || session.escrowQuarantined) continue;
      const meta = this.host.sim.meta(session.pid),
        before = this.host.sim.serializeCharacter(session.pid);
      if (!meta || !before) continue;
      try {
        const after = grantReferralInviterReward(before, mask & 1 ? 1 : 0);
        if (after !== before) this.host.sim.applyReferralRewardState(session.pid, before, after);
      } catch (error) {
        console.error('referral mount projection deferred:', error);
      }
      if (mask & 2) {
        const sources = meta.bankBonusSources.filter((source) => source.id !== 'referral_cards');
        sources.push({ id: 'referral_cards', slots: 20, maxSlots: 20 });
        applyBankBonusStamp(meta, {
          bonusSlots: sources.reduce((sum, source) => sum + source.slots, 0),
          sources,
        });
      }
      if (mask & 16)
        this.host.sim.syncBuddyOwnershipFor(session.pid, [
          ...this.host.sim.ownedBuddiesFor(session.pid),
          'sapling',
        ]);
    }
    this.host.observeCost(performance.now() - started);
    this.cards.updateEntitlements(accountId, mask);
  }
  async stop(): Promise<void> {
    await Promise.all([this.cards.stop(), this.delivery.stop(), ...this.refreshes.values()]);
    this.accounts.clear();
  }
}
