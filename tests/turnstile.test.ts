import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '../server/turnstile';
import { providerUsageSnapshot, resetProviderUsageForTests } from '../server/provider_usage';

// Minimal fetch stub: resolves to a Response-like object with the given body.
function fakeFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => payload })) as unknown as typeof fetch;
}

describe('verifyTurnstile', () => {
  afterEach(() => {
    resetProviderUsageForTests();
  });

  it('returns false without calling Cloudflare when the token is empty', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(verifyTurnstile('', 'secret', '1.2.3.4', fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns false without calling Cloudflare when the secret is empty', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(verifyTurnstile('token', '', '1.2.3.4', fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns true when Cloudflare reports success', async () => {
    const fetchImpl = fakeFetch({ success: true });
    await expect(verifyTurnstile('good-token', 'secret', '1.2.3.4', fetchImpl)).resolves.toBe(true);
  });

  it('tracks provider verification attempts and failures', async () => {
    await expect(verifyTurnstile('bad-token', 'secret', '1.2.3.4', fakeFetch({ success: false }))).resolves.toBe(false);
    const snapshot = providerUsageSnapshot();
    const verify = snapshot.metrics.find((row) => row.key === 'turnstile.verify');
    const failure = snapshot.metrics.find((row) => row.key === 'turnstile.verify.failure');
    expect(verify?.counts.m1).toBe(1);
    expect(failure?.counts.m1).toBe(1);
  });


  it('sends the secret, token and remote IP to the siteverify endpoint', async () => {
    const fetchImpl = fakeFetch({ success: true });
    await verifyTurnstile('good-token', 'sek', '9.9.9.9', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('challenges.cloudflare.com');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('sek');
    expect(body.get('response')).toBe('good-token');
    expect(body.get('remoteip')).toBe('9.9.9.9');
  });

  it('omits remoteip when none is provided', async () => {
    const fetchImpl = fakeFetch({ success: true });
    await verifyTurnstile('token', 'secret', undefined, fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.body as URLSearchParams).has('remoteip')).toBe(false);
  });

  it('returns false when Cloudflare reports failure', async () => {
    const fetchImpl = fakeFetch({ success: false, 'error-codes': ['invalid-input-response'] });
    await expect(verifyTurnstile('bad-token', 'secret', undefined, fetchImpl)).resolves.toBe(false);
  });

  it('returns false on a non-2xx response', async () => {
    const fetchImpl = fakeFetch({ success: true }, false);
    await expect(verifyTurnstile('token', 'secret', undefined, fetchImpl)).resolves.toBe(false);
  });

  it('fails closed when the network call throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(verifyTurnstile('token', 'secret', undefined, fetchImpl)).resolves.toBe(false);
  });

  it('fails closed when the response body is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    })) as unknown as typeof fetch;
    await expect(verifyTurnstile('token', 'secret', undefined, fetchImpl)).resolves.toBe(false);
  });
});
