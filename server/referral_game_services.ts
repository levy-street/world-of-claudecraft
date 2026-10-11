import { randomUUID } from 'node:crypto';
import type { CharacterState } from '../src/sim/character_state';
import {
  creditReferralCard,
  type ReferralCardContext,
  type ReferralCardEvent,
  type ReferralCardState,
  type ReferralCharacter,
  referralStartError,
  transitionReferralCard,
} from '../src/sim/referral_cards';
import type {
  ReferralCardsAction,
  ReferralCardsSnapshot,
  ReferralNotice,
} from '../src/sim/referral_contract';
import type { ReferralEvidence } from '../src/sim/referral_evidence';
import { referralDiagnostics } from './referral_metrics';
import {
  type PgReferralStore,
  REFERRAL_SUMMON_SECONDS,
  ReferralCommitAmbiguous,
  ReferralLeaseLost,
  type ReferralPage,
  type StoredReferral,
} from './referral_store_db';
import type { CharacterSaveArgs } from './woc_market_character_save';

export interface ReferralSession {
  pid: number;
  accountId: number;
  characterId: number;
  name: string;
  left: boolean;
  escrowQuarantined: boolean;
  leaseNonce?: string;
}
type NoticeInput = ReferralNotice extends infer N
  ? N extends ReferralNotice
    ? Omit<N, 'id'>
    : never
  : never;
export interface ReferralGameHost {
  character(session: ReferralSession): ReferralCharacter | null;
  sessionForAccount(
    accountId: number,
    characterId?: number,
    partyId?: number,
  ): ReferralSession | null;
  send(session: ReferralSession, snapshot: ReferralCardsSnapshot): void;
  enqueue<T>(characterId: number, job: () => Promise<T>, signal: AbortSignal): Promise<T>;
  serialize(characterId: number): CharacterSaveArgs | null;
  conflict(characterId: number): boolean;
  withPermit<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T>;
  acknowledge(save: CharacterSaveArgs): boolean;
  quarantine(session: ReferralSession, kind: 'fenced' | 'ambiguous', surface: string): void;
  applyReward(session: ReferralSession, before: CharacterState, after: CharacterState): boolean;
  canSummon(from: ReferralSession, to: ReferralSession): boolean;
  canInteract(from: ReferralSession, to: ReferralSession): boolean;
  summon(from: ReferralSession, to: ReferralSession): boolean;
  accountInviteUrl(accountId: number): Promise<string | null>;
  titleOwned?(session: ReferralSession): boolean;
  now(): number;
  observeCost(ms: number): void;
  onError(error: unknown): void;
}
interface Viewer {
  session: ReferralSession;
  page: ReferralPage;
  notices: ReferralNotice[];
  inviteUrl: string | null;
  revision: number;
  after: number;
}
interface SummonRequest {
  id: string;
  linkId: number;
  from: ReferralSession;
  to: ReferralSession;
  expiresAt: number;
}
const EMPTY_PAGE = (): ReferralPage => ({
  links: [],
  nextCursor: null,
  completedFriends: 0,
  rewardedTiers: [],
  readyCount: 0,
});
export const REFERRAL_PENDING_EVIDENCE_MAX = 512;

/** Explicit pushes only. No DB or account-history scan participates in selfWireJson.
 * Retained links are bounded to one 50-row page per connected viewer; event reads
 * resolve at most 45 pairs from an authoritative party of at most 10 people. */
export class ReferralGameServices {
  private readonly viewers = new Map<number, Viewer>();
  private readonly accounts = new Map<number, Set<Viewer>>();
  private readonly busy = new Set<number>();
  private readonly critical = new Set<number>();
  private readonly summons = new Map<number, SummonRequest>();
  private readonly pending = new Map<string, ReferralEvidence>();
  private readonly pendingSince = new Map<string, number>();
  private readonly retryAfter = new Map<string, { at: number; attempts: number }>();
  private readonly pendingPages = new Map<number, number>();
  private readonly pageRetryAfter = new Map<number, number>();
  private pumpingPages = false;
  private stopped = false;
  private closing = false;
  private stopWork: Promise<void> | null = null;
  private readonly activeJobs = new Set<Promise<void>>();
  private draining = false;
  private readonly retryTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly host: ReferralGameHost,
    private readonly store: Pick<
      PgReferralStore,
      'page' | 'pairs' | 'mutate' | 'summon' | 'acknowledgeCompletion'
    >,
  ) {
    this.retryTimer = setInterval(() => {
      const start = performance.now();
      void this.drain();
      this.pumpPages();
      host.observeCost(performance.now() - start);
    }, 1_000);
    this.retryTimer.unref();
  }

  attach(session: ReferralSession): void {
    if (this.closing || this.stopped) return;
    const viewer: Viewer = {
      session,
      page: EMPTY_PAGE(),
      notices: [],
      inviteUrl: null,
      revision: 0,
      after: 0,
    };
    this.viewers.set(session.characterId, viewer);
    const account = this.accounts.get(session.accountId) ?? new Set<Viewer>();
    account.add(viewer);
    this.accounts.set(session.accountId, account);
    void this.page(session).catch(this.host.onError);
    const inviteWork = this.host
      .accountInviteUrl(session.accountId)
      .then((url) => {
        if (this.valid(session)) {
          viewer.inviteUrl = url;
          this.publish(viewer);
        }
      })
      .catch(this.host.onError);
    this.activeJobs.add(inviteWork);
    void inviteWork.finally(() => this.activeJobs.delete(inviteWork));
  }
  detach(session: ReferralSession): void {
    const viewer = this.viewers.get(session.characterId);
    if (viewer?.session === session) {
      this.viewers.delete(session.characterId);
      const account = this.accounts.get(session.accountId);
      account?.delete(viewer);
      if (!account?.size) this.accounts.delete(session.accountId);
    }
    this.summons.delete(session.accountId);
    this.pendingPages.delete(session.characterId);
    this.pageRetryAfter.delete(session.characterId);
  }
  stop(): Promise<void> {
    if (this.stopWork) return this.stopWork;
    this.closing = true;
    clearInterval(this.retryTimer);
    const drain = this.finishStop();
    this.stopWork = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Referral shutdown drain timed out')),
        15_000,
      );
      timer.unref();
      void drain.then(resolve, reject).finally(() => clearTimeout(timer));
    });
    return this.stopWork;
  }
  private async finishStop(): Promise<void> {
    await Promise.all(this.activeJobs);
    while (this.pending.size) {
      const before = this.pending.size;
      this.retryAfter.clear();
      await this.drain(true);
      if (this.pending.size >= before)
        throw new Error('Referral evidence could not be flushed during shutdown');
    }
    this.stopped = true;
    this.viewers.clear();
    this.accounts.clear();
    this.pending.clear();
    this.pendingSince.clear();
    this.evidenceMetrics();
    this.retryAfter.clear();
    this.summons.clear();
    this.pendingPages.clear();
    this.pageRetryAfter.clear();
  }
  isBusy(accountId: number): boolean {
    return this.critical.has(accountId);
  }
  updateEntitlements(accountId: number, mask: number): void {
    for (const viewer of this.accounts.get(accountId) ?? []) {
      viewer.page.rewardedTiers = [1, 2, 3, 4, 5].filter((tier) => mask & (1 << (tier - 1)));
      this.publish(viewer);
    }
  }
  private updateReady(counts: Record<number, number> | undefined): void {
    if (!counts) return;
    for (const [id, count] of Object.entries(counts)) {
      const viewer = this.viewers.get(Number(id));
      if (viewer) viewer.page.readyCount = count;
    }
  }
  private valid(session: ReferralSession): boolean {
    return (
      !this.stopped &&
      !session.left &&
      !session.escrowQuarantined &&
      this.viewers.get(session.characterId)?.session === session
    );
  }
  private async admitted<T>(
    accountId: number,
    run: (signal: AbortSignal) => Promise<T>,
    duringShutdown = false,
  ): Promise<T | undefined> {
    if (
      this.stopped ||
      (this.closing && !duringShutdown) ||
      this.busy.has(accountId) ||
      this.busy.size >= 4
    )
      return undefined;
    this.busy.add(accountId);
    let finish: () => void = () => {};
    const active = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.activeJobs.add(active);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
      this.busy.delete(accountId);
      this.activeJobs.delete(active);
      finish();
      queueMicrotask(() => {
        this.pumpPages();
        void this.drain();
      });
    }
  }
  async page(session: ReferralSession, after = 0): Promise<void> {
    if (this.closing) return;
    const viewer = this.viewers.get(session.characterId);
    if (!viewer || !this.valid(session)) return;
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      (after !== 0 && after !== viewer.page.nextCursor)
    ) {
      this.notice(session, { type: 'reason', reason: 'unavailable' });
      return;
    }
    let page: ReferralPage | undefined;
    try {
      page = await this.admitted(session.accountId, (signal) =>
        this.host.withPermit(
          () => this.store.page(session.accountId, after, session.characterId),
          signal,
        ),
      );
    } catch (error) {
      if (this.valid(session)) {
        this.pendingPages.set(session.characterId, after);
        this.pageRetryAfter.set(session.characterId, this.host.now() + 2_000);
      }
      throw error;
    }
    if (page && this.valid(session)) {
      this.pendingPages.delete(session.characterId);
      this.pageRetryAfter.delete(session.characterId);
      viewer.page = page;
      viewer.after = after;
      if (
        page.completionNotice &&
        !viewer.notices.some((n) => n.id === `completed:${page.completionNotice!.count}`)
      ) {
        viewer.notices.push({
          id: `completed:${page.completionNotice.count}`,
          type: 'completed',
          friendName: page.completionNotice.friendName,
        });
        if (viewer.notices.length > 16) viewer.notices.shift();
      }
      this.publish(viewer);
    } else if (this.valid(session)) this.pendingPages.set(session.characterId, after);
  }
  private pumpPages(): void {
    if (this.stopped || this.closing || this.pumpingPages) return;
    this.pumpingPages = true;
    try {
      // Completion re-arms this pump. Only four requests can be admitted and
      // at most eight queued entries are inspected in one synchronous slice.
      for (let checked = 0; checked < 8 && this.busy.size < 4; checked++) {
        const next = this.pendingPages.entries().next().value;
        if (!next) break;
        const [id, after] = next;
        const viewer = this.viewers.get(id);
        this.pendingPages.delete(id);
        if (!viewer || !this.valid(viewer.session)) continue;
        if (
          this.busy.has(viewer.session.accountId) ||
          (this.pageRetryAfter.get(id) ?? 0) > this.host.now()
        ) {
          this.pendingPages.set(id, after);
          continue;
        }
        void this.page(viewer.session, after).catch(this.host.onError);
      }
    } finally {
      this.pumpingPages = false;
    }
  }
  private context(card: ReferralCardState, actor?: ReferralSession): ReferralCardContext {
    return {
      characters: card.participants
        .map((p) => {
          const session =
            actor?.accountId === p.accountId
              ? actor
              : this.host.sessionForAccount(
                  p.accountId,
                  card.status === 'idle' ? undefined : (p.characterId ?? undefined),
                  actor ? (this.host.character(actor)?.partyId ?? undefined) : undefined,
                );
          return session &&
            this.valid(session) &&
            (!actor || actor === session || this.host.canInteract(actor, session))
            ? this.host.character(session)
            : null;
        })
        .map(
          (character, i) =>
            character ?? {
              accountId: card.participants[i].accountId,
              characterId: card.participants[i].characterId ?? 1,
              name: card.participants[i].characterName,
              level: 1,
              completedQuestIds: [],
              partyId: null,
            },
        ) as [ReferralCharacter, ReferralCharacter],
    };
  }
  private publish(viewer: Viewer): void {
    this.measured(() => this.publishSnapshot(viewer));
  }
  private measured<T>(run: () => T): T {
    const start = performance.now();
    try {
      return run();
    } finally {
      this.host.observeCost(performance.now() - start);
    }
  }
  private publishSnapshot(viewer: Viewer): void {
    if (!this.valid(viewer.session)) return;
    const { session } = viewer;
    const snapshot: ReferralCardsSnapshot = {
      revision: ++viewer.revision,
      accountId: session.accountId,
      characterId: session.characterId,
      characterName: session.name,
      inviteUrl: viewer.inviteUrl,
      completedFriends: viewer.page.completedFriends,
      rewardedTiers: viewer.page.rewardedTiers,
      readyCount: viewer.page.readyCount,
      nextCursor: viewer.page.nextCursor,
      notices: viewer.notices,
      titleOwned: this.host.titleOwned?.(session) ?? false,
      links: viewer.page.links.map((link) => {
        const card = link.card;
        const own = card.participants.findIndex((p) => p.accountId === session.accountId);
        const context = this.context(card, session);
        const move = transitionReferralCard(
          card,
          {
            type: 'move',
            accountId: session.accountId,
            expectedRevision: card.revision,
            characterId: session.characterId,
          },
          context,
        );
        const other = this.host.sessionForAccount(card.participants[1 - own].accountId);
        return {
          card,
          friendName:
            other && this.host.canInteract(session, other)
              ? other.name
              : card.participants[1 - own].characterName,
          startReason: referralStartError(card, context),
          canMove: !move.error,
          moveReason: move.error,
          summonRemainingSeconds: Math.max(
            0,
            Math.ceil(
              (link.summonAt[own] + REFERRAL_SUMMON_SECONDS * 1000 - this.host.now()) / 1000,
            ),
          ),
          summonReason:
            other && this.host.canInteract(session, other) && this.host.canSummon(session, other)
              ? undefined
              : 'notTogether',
        };
      }),
    };
    this.host.send(session, snapshot);
  }
  private notice(session: ReferralSession, notice: NoticeInput): void {
    const viewer = this.viewers.get(session.characterId);
    if (!viewer || !this.valid(session)) return;
    viewer.notices.push({
      ...notice,
      id: notice.type === 'completed' ? `completed:${viewer.page.completedFriends}` : randomUUID(),
    } as ReferralNotice);
    if (viewer.notices.length > 16) viewer.notices.shift();
    this.publish(viewer);
  }
  private replace(link: StoredReferral): void {
    for (const participant of link.card.participants) {
      for (const viewer of this.accounts.get(participant.accountId) ?? []) {
        const i = viewer.page.links.findIndex((row) => row.card.linkId === link.card.linkId);
        if (i >= 0) viewer.page.links[i] = link;
        else {
          // A live party link must be actionable even when it is beyond the current
          // page. Replace a visible row instead of extending the page past its cap.
          if (viewer.page.links.length >= 50) viewer.page.links.pop();
          viewer.page.links.push(link);
        }
        this.publish(viewer);
      }
    }
  }

  async command(session: ReferralSession, action: ReferralCardsAction): Promise<void> {
    if (this.closing) return;
    if (!this.valid(session)) return;
    if (action.type === 'page') return this.page(session, action.after);
    if (action.type === 'acknowledgeNotice') {
      const viewer = this.viewers.get(session.characterId)!;
      const noticed = viewer.notices.find((n) => n.id === action.noticeId);
      if (noticed?.type === 'completed') {
        const count = Number(noticed.id.slice('completed:'.length));
        if (Number.isSafeInteger(count) && count > 0)
          void this.admitted(session.accountId, (signal) =>
            this.host.withPermit(
              () => this.store.acknowledgeCompletion(session.accountId, count),
              signal,
            ),
          ).catch(this.host.onError);
      }
      viewer.notices = viewer.notices.filter((n) => n.id !== action.noticeId);
      this.publish(viewer);
      return;
    }
    if (action.type === 'answerSummon')
      return this.answerSummon(session, action.requestId, action.accept);
    const row = this.viewers
      .get(session.characterId)!
      .page.links.find((r) => r.card.linkId === action.linkId);
    if (!row) {
      this.notice(session, { type: 'reason', reason: 'newAccountsOnly' });
      return;
    }
    if (action.type === 'summon') {
      this.requestSummon(session, row);
      return;
    }
    let ownsCritical = false;
    try {
      const committed = await this.admitted(session.accountId, (signal) => {
        if (action.type === 'redeem' || action.type === 'move') {
          ownsCritical = true;
          this.critical.add(session.accountId);
        }
        return this.host.enqueue(
          session.characterId,
          async () => {
            if (!this.valid(session) || this.host.conflict(session.characterId)) return undefined;
            const result = await this.host.withPermit(
              () =>
                this.store.mutate(
                  action.linkId,
                  session.accountId,
                  (card) =>
                    this.measured(() =>
                      transitionReferralCard(
                        card,
                        { ...action, accountId: session.accountId },
                        this.context(card, session),
                      ),
                    ),
                  () =>
                    this.measured(() =>
                      this.valid(session) ? this.host.serialize(session.characterId) : null,
                    ),
                ),
              signal,
            );
            this.measured(() => {
              for (const save of result.saves) {
                if (
                  !this.valid(session) ||
                  !this.host.acknowledge(save.before) ||
                  !this.host.applyReward(session, save.before.state, save.after)
                ) {
                  this.host.quarantine(session, 'ambiguous', 'referral reward projection');
                  throw new ReferralCommitAmbiguous(
                    'Committed referral reward could not be projected',
                  );
                }
              }
            });
            return result;
          },
          signal,
        );
      });
      if (!committed) {
        this.notice(session, { type: 'reason', reason: 'unavailable' });
        return;
      }
      this.updateReady(committed.readyCounts);
      this.replace({ ...row, card: committed.result.state });
      if (committed.result.error)
        this.notice(session, { type: 'reason', reason: committed.result.error });
      else if (action.type === 'start') this.promptBoth(committed.result.state, 'start');
      else if (action.type === 'respond' && !action.accept && action.confirmDecline)
        this.notifyBoth(committed.result.state, { type: 'declined' });
      if (committed.completedFriends !== undefined) {
        const inviter = this.host.sessionForAccount(
          committed.result.state.participants[0].accountId,
        );
        if (inviter) {
          const viewer = this.viewers.get(inviter.characterId);
          if (viewer) viewer.page.completedFriends = committed.completedFriends;
          this.notice(inviter, { type: 'completed', friendName: session.name });
        }
      }
    } catch (error) {
      if (error instanceof ReferralCommitAmbiguous)
        this.host.quarantine(session, 'ambiguous', 'referral reward');
      else if (error instanceof ReferralLeaseLost)
        this.host.quarantine(session, 'fenced', 'referral reward');
      else this.notice(session, { type: 'reason', reason: 'unavailable' });
      this.host.onError(error);
    } finally {
      if (ownsCritical) this.critical.delete(session.accountId);
    }
  }
  private notifyBoth(card: ReferralCardState, notice: NoticeInput): void {
    for (const p of card.participants) {
      const session = this.host.sessionForAccount(p.accountId, p.characterId ?? undefined);
      if (session) this.notice(session, notice);
    }
  }
  private promptBoth(card: ReferralCardState, type: 'start' | 'move'): void {
    this.notifyBoth(card, { type, linkId: card.linkId });
  }
  private requestSummon(session: ReferralSession, row: StoredReferral): void {
    const other = row.card.participants.find((p) => p.accountId !== session.accountId)!;
    const target = this.host.sessionForAccount(other.accountId);
    if (
      !target ||
      !this.valid(target) ||
      !this.host.canInteract(session, target) ||
      !this.host.canSummon(session, target)
    ) {
      this.notice(session, { type: 'reason', reason: 'notTogether' });
      return;
    }
    const pending = this.summons.get(target.accountId);
    if (pending && pending.expiresAt > this.host.now()) return;
    const request: SummonRequest = {
      id: randomUUID(),
      linkId: row.card.linkId,
      from: session,
      to: target,
      expiresAt: this.host.now() + 60_000,
    };
    this.summons.set(target.accountId, request);
    this.notice(target, { type: 'summon', requestId: request.id, friendName: session.name });
  }
  private async answerSummon(session: ReferralSession, id: string, accept: boolean): Promise<void> {
    const request = this.summons.get(session.accountId);
    if (!request || request.id !== id || request.to !== session) return;
    this.summons.delete(session.accountId);
    if (
      !accept ||
      request.expiresAt < this.host.now() ||
      !this.valid(request.from) ||
      !this.host.canInteract(request.from, session) ||
      !this.host.canSummon(request.from, session)
    )
      return;
    try {
      const booked = await this.admitted(request.from.accountId, (signal) =>
        this.host.withPermit(
          () => this.store.summon(request.linkId, request.from.accountId),
          signal,
        ),
      );
      if (
        !booked ||
        !this.valid(request.from) ||
        !this.valid(session) ||
        !this.host.canInteract(request.from, session) ||
        !this.host.canSummon(request.from, session) ||
        !this.host.summon(request.from, session)
      ) {
        this.notice(request.from, { type: 'reason', reason: 'unavailable' });
        return;
      }
      for (const participant of [request.from, session]) {
        const viewer = this.viewers.get(participant.characterId);
        const row = viewer?.page.links.find((r) => r.card.linkId === request.linkId);
        if (viewer && row) {
          const at: [number, number] = [...row.summonAt];
          at[row.card.participants.findIndex((p) => p.accountId === request.from.accountId)] =
            this.host.now();
          row.summonAt = at;
          this.publish(viewer);
        }
      }
    } catch (error) {
      this.host.onError(error);
    }
  }

  /** Evidence is a detached event-time snapshot from Sim, never reconstructed
   * after await from the party's mutable membership. Coalesce repeated evidence
   * by party/quest/boss identity; the queue is drained in insertion order. */
  observe(evidence: ReferralEvidence): void {
    this.measured(() => this.queueEvidence(evidence));
  }
  private queueEvidence(evidence: ReferralEvidence): void {
    if (
      this.stopped ||
      this.closing ||
      evidence.participants.length < 2 ||
      evidence.participants.length > 10
    )
      return;
    const key = `${evidence.participants
      .map((p) => p.characterId)
      .sort((a, b) => a - b)
      .join(
        ',',
      )}:${evidence.kind}:${evidence.characterId ?? ''}:${evidence.questId ?? ''}:${evidence.dungeonId ?? ''}:${evidence.mobId ?? ''}`;
    if (!this.pending.has(key) && this.pending.size >= REFERRAL_PENDING_EVIDENCE_MAX) {
      referralDiagnostics.evidenceOverflow++;
      // Fail closed under sustained DB outage instead of acknowledging gameplay
      // while silently dropping a milestone. Quarantine blocks subsequent saves;
      // the client reconnects to the last durably accepted character state.
      for (const p of evidence.participants) {
        const session = this.host.sessionForAccount(p.accountId, p.characterId);
        if (session && this.valid(session)) {
          this.notice(session, { type: 'reason', reason: 'unavailable' });
          this.host.quarantine(session, 'ambiguous', 'referral evidence backpressure');
        }
      }
      return;
    }
    this.pending.set(key, structuredClone(evidence));
    if (!this.pendingSince.has(key)) this.pendingSince.set(key, this.host.now());
    this.evidenceMetrics();
    void this.drain();
  }
  private async drain(duringShutdown = false): Promise<void> {
    if (this.draining || this.stopped || (this.closing && !duringShutdown) || this.busy.size >= 4)
      return;
    let next = this.pending.entries().next().value;
    for (let checked = 0; next && checked < 4; checked++) {
      if ((this.retryAfter.get(next[0])?.at ?? 0) <= this.host.now()) break;
      this.pending.delete(next[0]);
      this.pending.set(next[0], next[1]);
      next = this.pending.entries().next().value;
    }
    if (next && (this.retryAfter.get(next[0])?.at ?? 0) > this.host.now()) return;
    if (!next) return;
    this.draining = true;
    const [key, evidence] = next;
    let processed = false;
    try {
      const done = await this.admitted(
        evidence.participants[0].accountId,
        async (signal) => {
          const links = await this.host.withPermit(
            () => this.store.pairs(evidence.participants.map((p) => p.accountId)),
            signal,
          );
          for (const row of links) {
            const context: ReferralCardContext = {
              characters: [
                evidence.participants.find(
                  (c) => c.accountId === row.card.participants[0].accountId,
                )!,
                evidence.participants.find(
                  (c) => c.accountId === row.card.participants[1].accountId,
                )!,
              ],
            };
            const first = row.card.participants[0].accountId;
            if (evidence.kind === 'party') {
              await this.party(row, context, signal);
              continue;
            }
            const events: ReferralCardEvent[] = [];
            if (evidence.kind === 'quest' && evidence.questId && evidence.characterId)
              events.push({
                type: 'questTurnIn',
                questId: evidence.questId,
                characterId: evidence.characterId,
              });
            if (evidence.kind === 'boss' && evidence.mobId) {
              if (evidence.activityId)
                events.push({
                  type: 'raidBossKill',
                  activityId: evidence.activityId,
                  mobId: evidence.mobId,
                  eligibleCharacterIds: evidence.participants.map((p) => p.characterId),
                });
              if (evidence.dungeonId)
                events.push({
                  type: 'dungeonClear',
                  dungeonId: evidence.dungeonId,
                  eligibleCharacterIds: evidence.participants.map((p) => p.characterId),
                });
            }
            for (const event of events) {
              const result = await this.host.withPermit(
                () =>
                  this.store.mutate(row.card.linkId, first, (card) =>
                    this.measured(() => creditReferralCard(card, event, context)),
                  ),
                signal,
              );
              this.updateReady(result.readyCounts);
              this.replace({ ...row, card: result.result.state });
            }
          }
          if (evidence.kind === 'party' && !links.length) {
            for (const p of evidence.participants) {
              const session = this.host.sessionForAccount(p.accountId);
              if (session && this.valid(session))
                this.notice(session, { type: 'reason', reason: 'newAccountsOnly' });
            }
          }
          return true;
        },
        duringShutdown,
      );
      if (done && this.pending.get(key) === evidence) {
        processed = true;
        this.pending.delete(key);
        this.retryAfter.delete(key);
        this.pendingSince.delete(key);
      }
    } catch (error) {
      processed = true;
      const attempts = (this.retryAfter.get(key)?.attempts ?? 0) + 1;
      this.retryAfter.set(key, {
        at: this.host.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)),
        attempts,
      });
      if (this.pending.get(key) === evidence) {
        this.pending.delete(key);
        this.pending.set(key, evidence);
      }
      this.host.onError(error);
    } finally {
      this.draining = false;
      this.evidenceMetrics();
      if (processed)
        queueMicrotask(() => {
          void this.drain();
        });
    }
  }
  private evidenceMetrics(): void {
    referralDiagnostics.evidenceDepth = this.pending.size;
    referralDiagnostics.evidenceOldestAt = this.pendingSince.size
      ? Math.min(...this.pendingSince.values())
      : 0;
    referralDiagnostics.evidenceParked = this.retryAfter.size;
  }
  private async party(
    row: StoredReferral,
    context: ReferralCardContext,
    signal: AbortSignal,
  ): Promise<void> {
    const a = this.host.sessionForAccount(
      context.characters[0].accountId,
      context.characters[0].characterId,
    );
    const b = this.host.sessionForAccount(
      context.characters[1].accountId,
      context.characters[1].characterId,
    );
    if (!a || !b || !this.host.canInteract(a, b)) return;
    this.replace(row);
    if (row.card.status === 'idle' && !row.card.declined) {
      const reason = referralStartError(row.card, context);
      if (reason) {
        this.notifyBoth(row.card, { type: 'reason', reason });
        return;
      }
      const started = await this.host.withPermit(
        () =>
          this.store.mutate(row.card.linkId, row.card.participants[0].accountId, (card) =>
            transitionReferralCard(
              card,
              {
                type: 'start',
                accountId: card.participants[0].accountId,
                expectedRevision: card.revision,
              },
              context,
            ),
          ),
        signal,
      );
      this.replace({ ...row, card: started.result.state });
      if (!started.result.error) this.promptBoth(started.result.state, 'start');
    } else if (row.card.status === 'pending') this.promptBoth(row.card, 'start');
    else if (row.card.status === 'active') {
      const reunion = await this.host.withPermit(
        () =>
          this.store.mutate(row.card.linkId, row.card.participants[0].accountId, (card) =>
            creditReferralCard(card, { type: 'partyReunion' }, context),
          ),
        signal,
      );
      this.updateReady(reunion.readyCounts);
      row = { ...row, card: reunion.result.state };
      this.replace(row);
      for (const p of row.card.participants) {
        const present = context.characters.find((c) => c.accountId === p.accountId);
        const session = this.host.sessionForAccount(p.accountId, present?.characterId);
        if (!session || session.characterId === p.characterId) continue;
        const move = transitionReferralCard(
          row.card,
          {
            type: 'move',
            accountId: p.accountId,
            characterId: session.characterId,
            expectedRevision: row.card.revision,
          },
          context,
        );
        if (move.error) this.notice(session, { type: 'reason', reason: move.error });
        else this.notice(session, { type: 'move', linkId: row.card.linkId });
      }
    }
  }
}
