import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeReferralAction } from '../server/referral_command';
import {
  type ReferralGameHost,
  ReferralGameServices,
  type ReferralSession,
} from '../server/referral_game_services';
import {
  type PgReferralStore,
  ReferralCommitAmbiguous,
  type ReferralPage,
} from '../server/referral_store_db';
import { createReferralCard, type ReferralCardContext } from '../src/sim/referral_cards';
import type { ReferralCardsSnapshot } from '../src/sim/referral_contract';

const services: ReferralGameServices[] = [];
afterEach(async () => {
  for (const service of services) await service.stop();
  services.length = 0;
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup() {
  const a: ReferralSession = {
    pid: 1,
    accountId: 10,
    characterId: 100,
    name: 'Inviter',
    left: false,
    escrowQuarantined: false,
    leaseNonce: 'a',
  };
  const b: ReferralSession = {
    pid: 2,
    accountId: 20,
    characterId: 200,
    name: 'Invitee',
    left: false,
    escrowQuarantined: false,
    leaseNonce: 'b',
  };
  const context: ReferralCardContext = {
    characters: [
      {
        accountId: 10,
        characterId: 100,
        name: a.name,
        level: 1,
        completedQuestIds: [],
        partyId: 1,
      },
      {
        accountId: 20,
        characterId: 200,
        name: b.name,
        level: 1,
        completedQuestIds: [],
        partyId: 1,
      },
    ],
  };
  let card = createReferralCard(20, 10, 20);
  const frames = new Map<number, ReferralCardsSnapshot>();
  const host: ReferralGameHost = {
    character: (s) => context.characters.find((c) => c.characterId === s.characterId) ?? null,
    sessionForAccount: (id, char) =>
      [a, b].find((s) => s.accountId === id && (char === undefined || char === s.characterId)) ??
      null,
    send: (s, snapshot) => {
      frames.set(s.characterId, snapshot);
    },
    enqueue: async (_id, job) => job(),
    serialize: () => null,
    conflict: () => false,
    withPermit: async (job) => job(),
    acknowledge: () => true,
    quarantine: vi.fn(),
    applyReward: () => true,
    canSummon: () => true,
    canInteract: () => true,
    summon: vi.fn(() => true),
    accountInviteUrl: async () => '/play?ref=abc',
    now: () => 1_000_000,
    observeCost: () => {},
    onError: vi.fn(),
  };
  const page = (): ReferralPage => ({
    links: [{ card, summonAt: [0, 0] }],
    nextCursor: null,
    completedFriends: 0,
    rewardedTiers: [],
    readyCount: 0,
  });
  const store: Pick<
    PgReferralStore,
    'page' | 'pairs' | 'mutate' | 'summon' | 'acknowledgeCompletion'
  > = {
    acknowledgeCompletion: async () => {},
    page: vi.fn(async () => page()),
    pairs: vi.fn(async () => page().links),
    mutate: vi.fn(async (_link, _account, reduce) => {
      const result = reduce(card);
      card = result.state;
      return { result, saves: [] };
    }),
    summon: vi.fn(async () => true),
  };
  const service = new ReferralGameServices(host, store);
  services.push(service);
  service.attach(a);
  service.attach(b);
  return { a, b, host, store, service, context, frames, card: () => card };
}
describe('referral game host', () => {
  it('acknowledges an issued completion notice through the production command decoder', async () => {
    const h = setup();
    await flush();
    h.store.page = async () => ({
      links: [],
      nextCursor: null,
      completedFriends: 3,
      rewardedTiers: [],
      readyCount: 0,
      completionNotice: { count: 3, friendName: 'Invitee' },
    });
    h.store.acknowledgeCompletion = vi.fn(async () => {});
    await h.service.page(h.a);
    const noticeId = h.frames.get(100)?.notices.find((n) => n.type === 'completed')?.id;
    expect(noticeId).toBe('completed:3');
    const action = decodeReferralAction({ type: 'acknowledgeNotice', noticeId });
    expect(action).not.toBeNull();
    if (!action) throw new Error('Completion notice rejected by decoder');
    await h.service.command(h.a, action);
    await flush();
    expect(h.store.acknowledgeCompletion).toHaveBeenCalledWith(10, 3);
  });
  it('finishes a committed reward projection before shutdown resolves', async () => {
    const h = setup();
    await flush();
    let release: () => void = () => {};
    const before = { state: {} } as Parameters<ReferralGameHost['acknowledge']>[0];
    h.host.applyReward = vi.fn(() => true);
    h.store.mutate = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            result: { state: h.card(), intents: [] },
            saves: [{ before, after: before.state }],
          });
      });
    const command = h.service.command(h.a, {
      type: 'redeem',
      linkId: 20,
      expectedRevision: 0,
      milestone: 'tutorial',
    });
    const stopping = h.service.stop();
    release();
    await stopping;
    await command;
    expect(h.host.applyReward).toHaveBeenCalledOnce();
    expect(h.host.quarantine).not.toHaveBeenCalled();
  });
  it('drains admitted and queued evidence before shutdown resolves', async () => {
    const h = setup();
    await flush();
    let release: () => void = () => {};
    h.store.pairs = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve([]);
          }),
      )
      .mockResolvedValue([]);
    const participants = h.context.characters.map((c, i) => ({ ...c, pid: i + 1 }));
    for (const questId of ['one', 'two'])
      h.service.observe({
        type: 'referralEvidence',
        kind: 'quest',
        participants,
        questId,
        characterId: 100,
      });
    let stopped = false;
    const stopping = h.service.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(h.store.pairs).toHaveBeenCalledTimes(2);
  });
  it('rejects shutdown when accepted evidence cannot be persisted', async () => {
    const h = setup();
    await flush();
    h.store.pairs = vi.fn().mockRejectedValue(new Error('database unavailable'));
    h.service.observe({
      type: 'referralEvidence',
      kind: 'quest',
      participants: h.context.characters.map((c, i) => ({ ...c, pid: i + 1 })),
      questId: 'one',
      characterId: 100,
    });
    await flush();
    await expect(h.service.stop()).rejects.toThrow('could not be flushed');
    services.splice(services.indexOf(h.service), 1);
  });
  it('starts from trusted party evidence and requires both independent acceptances', async () => {
    const h = setup();
    await flush();
    h.service.observe({
      type: 'referralEvidence',
      kind: 'party',
      participants: h.context.characters.map((c, i) => ({ ...c, pid: i + 1 })),
    });
    await flush();
    expect(h.card().status).toBe('pending');
    expect(h.frames.get(100)?.notices.at(-1)?.type).toBe('start');
    expect(h.frames.get(200)?.notices.at(-1)?.type).toBe('start');
    await h.service.command(h.a, {
      type: 'respond',
      linkId: 20,
      expectedRevision: h.card().revision,
      accept: true,
    });
    expect(h.card().status).toBe('pending');
    await h.service.command(h.b, {
      type: 'respond',
      linkId: 20,
      expectedRevision: h.card().revision,
      accept: true,
    });
    expect(h.card().status).toBe('active');
  });
  it('does not trust a client invented link or permit foreign revision acceptance', async () => {
    const h = setup();
    await flush();
    await h.service.command(h.a, { type: 'start', linkId: 999, expectedRevision: 0 });
    expect(h.store.mutate).not.toHaveBeenCalled();
    expect(h.frames.get(100)?.notices.at(-1)).toMatchObject({
      type: 'reason',
      reason: 'newAccountsOnly',
    });
    await h.service.command(h.a, { type: 'start', linkId: 20, expectedRevision: 100 });
    expect(h.card().status).toBe('idle');
    expect(h.frames.get(100)?.notices.at(-1)).toMatchObject({ reason: 'staleRevision' });
  });
  it('consumes cooldown only after the intended recipient consents', async () => {
    const h = setup();
    await flush();
    await h.service.command(h.a, { type: 'summon', linkId: 20, expectedRevision: 0 });
    expect(h.store.summon).not.toHaveBeenCalled();
    const request = h.frames.get(200)!.notices.at(-1)!;
    expect(request.type).toBe('summon');
    if (request.type !== 'summon') return;
    await h.service.command(h.a, {
      type: 'answerSummon',
      requestId: request.requestId,
      accept: true,
    });
    expect(h.store.summon).not.toHaveBeenCalled();
    await h.service.command(h.b, {
      type: 'answerSummon',
      requestId: request.requestId,
      accept: true,
    });
    expect(h.store.summon).toHaveBeenCalledWith(20, 10);
    expect(h.host.summon).toHaveBeenCalledOnce();
    await h.service.command(h.b, {
      type: 'answerSummon',
      requestId: request.requestId,
      accept: true,
    });
    expect(h.host.summon).toHaveBeenCalledOnce();
  });
  it('does not summon across a changed session or restricted destination', async () => {
    const h = setup();
    await flush();
    await h.service.command(h.a, { type: 'summon', linkId: 20, expectedRevision: 0 });
    const request = h.frames.get(200)!.notices.at(-1)!;
    if (request.type !== 'summon') throw new Error('missing request');
    h.host.canSummon = () => false;
    await h.service.command(h.b, {
      type: 'answerSummon',
      requestId: request.requestId,
      accept: true,
    });
    expect(h.store.summon).not.toHaveBeenCalled();
    expect(h.host.summon).not.toHaveBeenCalled();
  });
  it('quarantines an ambiguous reward commit without live projection', async () => {
    const h = setup();
    await flush();
    h.store.mutate = vi.fn(async () => {
      throw new ReferralCommitAmbiguous('unknown');
    });
    await h.service.command(h.a, { type: 'start', linkId: 20, expectedRevision: 0 });
    expect(h.host.quarantine).toHaveBeenCalledWith(h.a, 'ambiguous', 'referral reward');
  });
  it('requires an issued keyset cursor and does not run reads from idle snapshots', async () => {
    const h = setup();
    await flush();
    const reads = vi.mocked(h.store.page).mock.calls.length;
    await h.service.page(h.a, 999);
    expect(vi.mocked(h.store.page).mock.calls.length).toBe(reads);
    await flush();
    expect(vi.mocked(h.store.page).mock.calls.length).toBe(reads);
  });
  it('captures quest party membership before asynchronous database reads', async () => {
    const h = setup();
    await flush();
    await h.service.command(h.a, { type: 'start', linkId: 20, expectedRevision: 0 });
    await h.service.command(h.a, {
      type: 'respond',
      linkId: 20,
      expectedRevision: h.card().revision,
      accept: true,
    });
    await h.service.command(h.b, {
      type: 'respond',
      linkId: 20,
      expectedRevision: h.card().revision,
      accept: true,
    });
    h.context.characters[0].completedQuestIds = ['q_ps_set_sail'];
    const participants = h.context.characters.map((c, i) => ({ ...c, pid: i + 1 }));
    h.service.observe({
      type: 'referralEvidence',
      kind: 'quest',
      participants,
      questId: 'q_ps_set_sail',
      characterId: 100,
    });
    h.context.characters[0].partyId = null;
    await flush();
    expect(h.card().participants[0].credited).toBe(1);
    expect(h.card().participants[1].credited).toBe(0);
  });
  it('rotates a failed evidence entry so another milestone can make progress', async () => {
    const h = setup();
    await flush();
    vi.mocked(h.store.pairs).mockRejectedValueOnce(new Error('temporary database failure'));
    const participants = h.context.characters.map((c, i) => ({ ...c, pid: i + 1 }));
    h.service.observe({
      type: 'referralEvidence',
      kind: 'quest',
      participants,
      questId: 'q_ps_set_sail',
      characterId: 100,
    });
    await flush();
    h.service.observe({
      type: 'referralEvidence',
      kind: 'quest',
      participants,
      questId: 'q_hollow',
      characterId: 100,
    });
    await flush();
    expect(h.host.onError).toHaveBeenCalledOnce();
    expect(h.store.mutate).toHaveBeenCalledOnce();
  });
  it('does not mark ordinary page reads as a critical inventory transaction', async () => {
    const h = setup();
    await flush();
    let release: (value: ReferralPage) => void = () => {};
    h.store.page = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const read = h.service.page(h.a);
    expect(h.service.isBusy(10)).toBe(false);
    release({ links: [], nextCursor: null, completedFriends: 0, rewardedTiers: [], readyCount: 0 });
    await read;
  });
  it('drains a thousand initial pages from admission completions with at most four database jobs', async () => {
    const h = setup();
    h.service.stop();
    const sessions = Array.from({ length: 1000 }, (_, i) => ({
      ...h.a,
      pid: 1000 + i,
      accountId: 1000 + i,
      characterId: 1000 + i,
    }));
    let reads = 0,
      inFlight = 0,
      maxInFlight = 0;
    h.host.sessionForAccount = (id) => sessions.find((s) => s.accountId === id) ?? null;
    h.host.character = (s) => ({
      accountId: s.accountId,
      characterId: s.characterId,
      name: s.name,
      level: 1,
      completedQuestIds: [],
      partyId: null,
    });
    h.store.page = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      reads++;
      return { links: [], nextCursor: null, completedFriends: 0, rewardedTiers: [], readyCount: 0 };
    };
    const service = new ReferralGameServices(h.host, h.store);
    services.push(service);
    for (const session of sessions) service.attach(session);
    await flush();
    await flush();
    expect(reads).toBe(1000);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
  it('measures synchronous work with a thousand stored links, fifty visible cards and a full evidence queue', async () => {
    const h = setup();
    await flush();
    const samples: number[] = [];
    h.host.observeCost = (ms) => {
      samples.push(ms);
    };
    const history = Array.from({ length: 1000 }, (_, i) => ({
      card: createReferralCard(20 + i, 10, 20 + i),
      summonAt: [0, 0] as const,
    }));
    h.store.page = async () => ({
      links: history.slice(0, 50),
      nextCursor: 69,
      completedFriends: 0,
      rewardedTiers: [],
      readyCount: 0,
    });
    for (let i = 0; i < 50; i++) await h.service.page(h.a);
    expect(h.frames.get(100)?.links).toHaveLength(50);
    const publish = [...samples].sort((a, b) => a - b);
    samples.length = 0;
    let release: () => void = () => {};
    h.store.pairs = () =>
      new Promise((resolve) => {
        release = () => resolve([]);
      });
    const participants = h.context.characters.map((c, i) => ({ ...c, pid: i + 1 }));
    for (let i = 0; i < 512; i++)
      h.service.observe({
        type: 'referralEvidence',
        kind: 'quest',
        participants,
        questId: `benchmark_${i}`,
        characterId: 100,
      });
    const queued = [...samples].sort((a, b) => a - b);
    process.stdout.write(
      'Referral bounded synchronous CPU ms ' +
        JSON.stringify({
          storedLinks: history.length,
          visibleCards: 50,
          evidence: 512,
          publishP50: publish[Math.floor(publish.length / 2)],
          publishMax: publish.at(-1),
          queueP50: queued[Math.floor(queued.length / 2)],
          queueMax: queued.at(-1),
        }) +
        '\n',
    );
    expect(publish.length).toBeGreaterThanOrEqual(50);
    expect(queued.length).toBe(512);
    expect(h.host.quarantine).not.toHaveBeenCalled();
    h.service.observe({
      type: 'referralEvidence',
      kind: 'quest',
      participants,
      questId: 'benchmark_overflow',
      characterId: 100,
    });
    expect(h.host.quarantine).toHaveBeenCalledTimes(2);
    h.store.pairs = async () => [];
    release();
    await flush();
  });
});
