import { describe, expect, it, vi } from 'vitest';
import {
  classifyOnlineGeneralChat,
  GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS,
  GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT,
  GeneralChatQuotaCoordinator,
  GeneralChatRateLimitLiveState,
  generalChatQuotaRefusalEvent,
  resolveGeneralChatAdmission,
} from '../server/general_chat_quota';
import {
  GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS,
  GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS,
} from '../server/general_chat_quota_config';

describe('classifyOnlineGeneralChat', () => {
  it.each([
    ['/general hello', 'say', '/general hello'],
    ['/GENERAL   hello there ', 'guild', '/general hello there'],
    ['/1 hello', 'say', '/general hello'],
    ['sticky hello', 'general', '/general sticky hello'],
  ] as const)('classifies %j with sticky %s as General', (text, remembered, canonicalText) => {
    expect(classifyOnlineGeneralChat(text, remembered)).toEqual({ canonicalText });
  });

  it.each([
    ['/g guild', 'general'],
    ['/gu guild', 'general'],
    ['/guild guild', 'general'],
    ['/o officer', 'general'],
    ['/p party', 'general'],
    ['/w Name whisper', 'general'],
    ['/r reply', 'general'],
    ['/bg battleground', 'general'],
    ['/world world', 'general'],
    ['/lfg group', 'general'],
    ['/s say', 'general'],
    ['/y yell', 'general'],
    ['/roll', 'general'],
    ['/who', 'general'],
    ['!lfg relay', 'general'],
    ['plain say', 'say'],
  ] as const)('does not classify %j with sticky %s', (text, remembered) => {
    expect(classifyOnlineGeneralChat(text, remembered)).toBeNull();
  });
});

describe('GeneralChatQuotaCoordinator', () => {
  const policy = { messages: 2, windowMinutes: 1 };

  it('matches the no-queue process cap to the separate dedicated pool', () => {
    expect(GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT).toBe(2);
    expect(GENERAL_CHAT_QUOTA_DB_POOL_MAX_CLIENTS).toBe(2);
    expect(GENERAL_CHAT_QUOTA_ACQUIRE_TIMEOUT_MS).toBe(500);
  });

  it('does no database work for known-unlimited accounts', async () => {
    const consume = vi.fn();
    const quota = new GeneralChatQuotaCoordinator({ consume });

    await expect(quota.admit(1, null)).resolves.toEqual({ status: 'allowed', notify: false });
    expect(consume).not.toHaveBeenCalled();
  });

  it('refuses a same-account overlap as pending without arming the unavailable cache', async () => {
    const releases: Array<(value: { status: 'allowed' }) => void> = [];
    const consume = vi.fn(
      () => new Promise<{ status: 'allowed' }>((resolve) => releases.push(resolve)),
    );
    const quota = new GeneralChatQuotaCoordinator({ consume });

    const first = quota.admit(7, policy);
    const second = quota.admit(7, policy);
    await expect(second).resolves.toEqual({ status: 'pending', notify: true });
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    releases.shift()?.({ status: 'allowed' });
    await expect(first).resolves.toEqual({ status: 'allowed', notify: false });
    expect(quota.inFlight).toBe(0);
    // The healthy overlap refusal must not poison the account: the very next
    // send reaches PostgreSQL immediately instead of being shed by the
    // 1-second unavailable cache the busy/error paths arm.
    const third = quota.admit(7, policy);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(2));
    releases.shift()?.({ status: 'allowed' });
    await expect(third).resolves.toEqual({ status: 'allowed', notify: false });
  });

  it('caches denials and throttles their sender notice without another query', async () => {
    let nowMs = 10_000;
    const consume = vi.fn(async () => ({ status: 'denied' as const, retryAfterSeconds: 42 }));
    const quota = new GeneralChatQuotaCoordinator({ consume, now: () => nowMs });

    await expect(quota.admit(7, policy)).resolves.toEqual({
      status: 'denied',
      retryAfterSeconds: 42,
      notify: true,
    });
    nowMs += 100;
    await expect(quota.admit(7, policy)).resolves.toEqual({
      status: 'denied',
      retryAfterSeconds: 42,
      notify: false,
    });
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('fails configured accounts closed on errors and clears local state on policy edits', async () => {
    let reject = true;
    const consume = vi.fn(async () => {
      if (reject) throw new Error('database unavailable');
      return { status: 'allowed' as const };
    });
    const quota = new GeneralChatQuotaCoordinator({ consume, now: () => 1_000 });

    await expect(quota.admit(3, policy)).resolves.toEqual({ status: 'error', notify: true });
    await expect(quota.admit(3, policy)).resolves.toEqual({ status: 'busy', notify: false });
    quota.policyChanged(3);
    reject = false;
    await expect(quota.admit(3, policy)).resolves.toEqual({ status: 'allowed', notify: false });
  });

  it('does not restore an old denial cache after a live policy change', async () => {
    let resolveFirst!: (value: { status: 'denied'; retryAfterSeconds: number }) => void;
    const consume = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ status: 'denied'; retryAfterSeconds: number }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: 'allowed' });
    const quota = new GeneralChatQuotaCoordinator({ consume, now: () => 1_000 });

    const oldDecision = quota.admit(3, policy);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    quota.policyChanged(3);
    resolveFirst({ status: 'denied', retryAfterSeconds: 86_400 });
    await expect(oldDecision).resolves.toEqual({
      status: 'denied',
      retryAfterSeconds: 86_400,
      notify: true,
    });

    await expect(quota.admit(3, policy)).resolves.toEqual({
      status: 'allowed',
      notify: false,
    });
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('refuses above the conservative process-wide database cap without queueing pg work', async () => {
    const releases: Array<(value: { status: 'allowed' }) => void> = [];
    const consume = vi.fn(
      () => new Promise<{ status: 'allowed' }>((resolve) => releases.push(resolve)),
    );
    const quota = new GeneralChatQuotaCoordinator({ consume });
    const active = Array.from({ length: GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT }, (_, index) =>
      quota.admit(index + 1, policy),
    );
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT));

    await expect(quota.admit(999, policy)).resolves.toEqual({ status: 'busy', notify: true });
    expect(consume).toHaveBeenCalledTimes(GENERAL_CHAT_QUOTA_MAX_IN_FLIGHT);
    for (const release of releases) release({ status: 'allowed' });
    await Promise.all(active);
  });

  it('bounds refusal and notice state and supports last-session eviction', async () => {
    const quota = new GeneralChatQuotaCoordinator({
      consume: async () => ({ status: 'denied', retryAfterSeconds: 60 }),
      now: () => 1_000,
    });
    for (let accountId = 1; accountId <= GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS + 1; accountId++) {
      await quota.admit(accountId, policy);
    }
    expect(quota.cachedAccounts).toBe(GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS);
    quota.forgetAccount(GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS + 1);
    expect(quota.cachedAccounts).toBe(GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS - 1);
  });

  it('observes fixed database outcomes and duration without changing admission', async () => {
    let now = 1_000;
    const observeDbCall = vi.fn();
    const quota = new GeneralChatQuotaCoordinator({
      consume: async () => {
        now = 1_250;
        return { status: 'allowed' };
      },
      now: () => now,
      observeDbCall,
    });
    await expect(quota.admit(1, policy)).resolves.toEqual({ status: 'allowed', notify: false });
    expect(observeDbCall).toHaveBeenCalledWith('allowed', 0.25);
  });
});

describe('generalChatQuotaRefusalEvent', () => {
  it('maps each refusal to its stable code with the exact English fallback text', () => {
    expect(
      generalChatQuotaRefusalEvent({ status: 'denied', retryAfterSeconds: 41.2, notify: true }),
    ).toEqual({
      type: 'error',
      text: 'General chat limit reached. Try again in 42 seconds.',
      code: 'general_chat_quota',
      channel: 'general',
      retryAfterSeconds: 42,
    });
    expect(generalChatQuotaRefusalEvent({ status: 'pending', notify: true })).toEqual({
      type: 'error',
      text: 'Your previous General chat message is still sending. Try again in a moment.',
      code: 'general_chat_quota_pending',
      channel: 'general',
      retryAfterSeconds: 1,
    });
    expect(generalChatQuotaRefusalEvent({ status: 'busy', notify: true })).toEqual({
      type: 'error',
      text: 'General chat is temporarily unavailable. Try again shortly.',
      code: 'general_chat_quota_unavailable',
      channel: 'general',
      retryAfterSeconds: 1,
    });
    expect(generalChatQuotaRefusalEvent({ status: 'error', notify: true })).toMatchObject({
      code: 'general_chat_quota_unavailable',
    });
  });
});

describe('resolveGeneralChatAdmission', () => {
  function makeHost(current = true) {
    return {
      sessionCurrent: vi.fn(() => current),
      refundChatToken: vi.fn(),
      deliver: vi.fn(),
      notify: vi.fn(),
      recordOutcome: vi.fn(),
    };
  }

  it('delivers an allowed admission without refunding', async () => {
    const host = makeHost();
    await resolveGeneralChatAdmission(Promise.resolve({ status: 'allowed', notify: false }), host);
    expect(host.deliver).toHaveBeenCalledOnce();
    expect(host.refundChatToken).not.toHaveBeenCalled();
    expect(host.recordOutcome).toHaveBeenCalledWith('allowed');
    expect(host.notify).not.toHaveBeenCalled();
  });

  it('records a stale-session allowed admission as dropped so labels sum to attempts', async () => {
    const host = makeHost(false);
    await resolveGeneralChatAdmission(Promise.resolve({ status: 'allowed', notify: false }), host);
    expect(host.deliver).not.toHaveBeenCalled();
    expect(host.refundChatToken).toHaveBeenCalledOnce();
    expect(host.recordOutcome).toHaveBeenCalledWith('dropped');
    expect(host.notify).not.toHaveBeenCalled();
  });

  it('keeps the real refusal outcome for a stale session and never notifies it', async () => {
    const host = makeHost(false);
    await resolveGeneralChatAdmission(
      Promise.resolve({ status: 'denied', retryAfterSeconds: 5, notify: true }),
      host,
    );
    expect(host.refundChatToken).toHaveBeenCalledOnce();
    expect(host.recordOutcome).toHaveBeenCalledWith('denied');
    expect(host.notify).not.toHaveBeenCalled();
  });

  it('refunds a live refusal and notifies only when the admission says to', async () => {
    const host = makeHost();
    await resolveGeneralChatAdmission(Promise.resolve({ status: 'pending', notify: true }), host);
    expect(host.refundChatToken).toHaveBeenCalledOnce();
    expect(host.recordOutcome).toHaveBeenCalledWith('pending');
    expect(host.notify).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'general_chat_quota_pending' }),
    );

    const throttled = makeHost();
    await resolveGeneralChatAdmission(
      Promise.resolve({ status: 'busy', notify: false }),
      throttled,
    );
    expect(throttled.recordOutcome).toHaveBeenCalledWith('busy');
    expect(throttled.notify).not.toHaveBeenCalled();
  });
});

describe('GeneralChatRateLimitLiveState', () => {
  it('pins an in-progress auth generation while bounding ordinary notification state', () => {
    const state = new GeneralChatRateLimitLiveState();
    const hydration = state.beginHydration(1);
    const committed = { messages: 4, windowMinutes: 12 };
    state.policyChanged(1, committed);
    for (let accountId = 2; accountId <= GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS + 2; accountId++) {
      state.policyChanged(accountId, null);
    }

    expect(state.cachedAccounts).toBe(GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS);
    expect(hydration.resolve(null)).toEqual(committed);
    hydration.release();
    state.policyChanged(GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS + 3, null);
    expect(state.cachedAccounts).toBe(GENERAL_CHAT_QUOTA_CACHE_MAX_ACCOUNTS);
  });
});
