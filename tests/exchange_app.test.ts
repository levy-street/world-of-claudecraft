// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExchangeApp } from '../src/exchange/app';

const walletHarness = vi.hoisted(() => ({
  signature: null as null | ((value: string) => void),
}));
let loginAttempts = 0;

vi.mock('../src/net/wallet', () => ({
  configureWalletConnect: vi.fn(),
  setWalletPicker: vi.fn(),
  currentWallet: () => ({ isConnected: true, address: 'wallet-1' }),
  openWalletModal: vi.fn(),
  signMessageBase58: vi.fn(async () => 'link-signature'),
  signAndSendTransactionBase64: vi.fn(
    () => new Promise<string>((resolve) => (walletHarness.signature = resolve)),
  ),
}));

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

const listing = {
  id: 7,
  itemId: 'cloth_t1',
  sellerName: 'Seller',
  sellerId: 9,
  sellerCharacterId: 10,
  quantity: 1,
  format: 'auction',
  status: 'active',
  startCents: 100,
  currentBidCents: null,
  minNextBidCents: 100,
  buyNowCents: null,
  buyNowLocked: false,
  endsAtMs: Date.now() + 60_000,
  mine: false,
  cancelPending: false,
};

describe('Exchange SPA', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    location.hash = '';
    walletHarness.signature = null;
    loginAttempts = 0;
    localStorage.clear();
    localStorage.setItem('woc_session', JSON.stringify({ token: 'token', username: 'Ada' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/login')) {
          loginAttempts += 1;
          return loginAttempts === 1
            ? json({ twoFactorRequired: true })
            : json({ token: 'new-token', username: 'Ada' });
        }
        if (url.includes('/api/account')) return json({ username: 'Ada', email: 'a@example.test' });
        if (url.includes('/api/characters'))
          return json({ characters: [{ id: 3, name: 'Ada', class: 'warrior', level: 10 }] });
        if (url.includes('/api/woc-market/status'))
          return json({ enabled: true, price: { available: true, healthy: true } });
        if (url.includes('/api/wallet'))
          return json({ wallet: { pubkey: 'wallet-1', linkedAt: 'now' } });
        if (url.includes('/api/woc-market/listings/7/bids'))
          return json({
            bid: { id: 8 },
            bond: { transactionBase64: 'transaction', signatureRequired: true },
          });
        if (url.includes('/api/woc-market/listings/7')) return json({ listing, estimate: null });
        if (url.includes('/api/woc-market/bids/8/bond')) {
          expect(JSON.parse(String(init?.body))).toEqual({ signature: 'chain-signature' });
          return json({ standing: true });
        }
        if (url.includes('/api/woc-market/history/')) return json({ sales: [] });
        if (url.includes('/api/woc-market/seller-history/'))
          return json({ sales: [], seller: null });
        if (url.includes('/api/woc-market/me'))
          return json({
            listings: [],
            bids: [],
            settlements: [],
            strikes: { strikes: 2, suspendedUntilMs: null },
            termsAcceptedAtMs: 1,
            walletLinked: true,
          });
        if (url.includes('/api/woc-market/listings'))
          return json({ page: 1, hasMore: false, listings: [listing] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  });

  it('keeps search focus and requires linked terms consent before a bid', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    await new ExchangeApp(mount).start();

    const search = mount.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    search?.focus();
    search?.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'c' }));
    expect(document.activeElement).toBe(search);

    mount.querySelector<HTMLButtonElement>('.exchange-card button')?.click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '1.00'),
    );
    document.querySelector<HTMLDialogElement>('dialog .exchange-primary')?.click();
    await vi.waitFor(() => expect(document.querySelectorAll('dialog').length).toBe(2));

    const termsDialog = [...document.querySelectorAll('dialog')].at(-1);
    const checkbox = termsDialog?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const termsLink = termsDialog?.querySelector<HTMLAnchorElement>('a[href="/terms"]');
    const continueButton = termsDialog?.querySelector<HTMLButtonElement>('.exchange-primary');
    expect(checkbox?.checked).toBe(false);
    expect(termsLink?.rel).toContain('noopener');
    expect(continueButton?.disabled).toBe(true);
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('seller-history')),
    ).toBe(true);
  });

  it('forwards the recovery code through the two-step login UI', async () => {
    localStorage.clear();
    const mount = document.createElement('div');
    document.body.append(mount);
    await new ExchangeApp(mount).start();
    const form = mount.querySelector<HTMLFormElement>('form');
    const username = form?.elements.namedItem('username') as HTMLInputElement;
    const password = form?.elements.namedItem('password') as HTMLInputElement;
    const factor = form?.elements.namedItem('factor') as HTMLInputElement;
    username.value = 'Ada';
    password.value = 'secret';
    form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(factor.closest('label')?.hidden).toBe(false));

    factor.value = 'recovery-one';
    form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(loginAttempts).toBe(2));
    const loginCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('/api/login'));
    expect(JSON.parse(String(loginCalls[0]?.[1]?.body))).toMatchObject({
      username: 'Ada',
      code: '',
      recoveryCode: '',
      turnstileToken: '',
    });
    expect(JSON.parse(String(loginCalls[1]?.[1]?.body))).toMatchObject({
      code: '',
      recoveryCode: 'recovery-one',
    });
  });

  it('blocks navigation and records a broadcast signature before updating the UI', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    await new ExchangeApp(mount).start();
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '1.00'),
    );

    mount.querySelector<HTMLButtonElement>('.exchange-card button')?.click();
    await vi.waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
    document.querySelector<HTMLDialogElement>('dialog .exchange-primary')?.click();
    await vi.waitFor(() => expect(document.querySelectorAll('dialog').length).toBe(2));
    const termsDialog = [...document.querySelectorAll('dialog')].at(-1);
    const checkbox = termsDialog?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    checkbox?.click();
    termsDialog?.querySelector<HTMLButtonElement>('.exchange-primary')?.click();
    await vi.waitFor(() => expect(walletHarness.signature).not.toBeNull());

    mount.querySelectorAll<HTMLButtonElement>('nav button')[1]?.click();
    expect(location.hash).not.toBe('#activity');
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/bids/8/bond'))).toBe(false);

    document.querySelector<HTMLDialogElement>('dialog')?.close();
    mount.querySelector<HTMLButtonElement>('.exchange-card button')?.click();
    mount.querySelectorAll<HTMLButtonElement>('.exchange-header button').item(1).click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/account/logout'))).toBe(
      false,
    );

    walletHarness.signature?.('chain-signature');
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/bids/8/bond'))).toBe(true),
    );
    const bidRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/listings/7/bids'),
    );
    expect(JSON.parse(String(bidRequest?.[1]?.body))).toMatchObject({
      characterId: 3,
      acceptTerms: true,
    });
  });

  it('renders account terms, strikes, suspension, and wallet status from activity', async () => {
    location.hash = '#activity';
    const mount = document.createElement('div');
    document.body.append(mount);
    await new ExchangeApp(mount).start();
    expect(mount.textContent).toContain('Marketplace terms accepted');
    expect(mount.textContent).toContain('Strikes: 2');
    expect(mount.textContent).toContain('No active suspension');
    expect(mount.textContent).toContain('A wallet is linked to this account');
  });
});
