import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildConnectRequest,
  buildEncryptedRequest,
  createMobileWalletClient,
  decryptConnectResponse,
  decryptEncryptedResponse,
} from '../src/net/mobile_wallet_deeplink';

afterEach(() => vi.unstubAllGlobals());

function installFakeWindow() {
  const values = new Map<string, string>();
  const storageListeners = new Set<(event: { key: string; newValue: string }) => void>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
    location: {
      href: 'https://dev.worldofclaudecraft.com/play',
      origin: 'https://dev.worldofclaudecraft.com',
      assign: vi.fn(),
    },
    open: vi.fn(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: (
      type: string,
      listener: (event: { key: string; newValue: string }) => void,
    ) => {
      if (type === 'storage') storageListeners.add(listener);
    },
    removeEventListener: (
      type: string,
      listener: (event: { key: string; newValue: string }) => void,
    ) => {
      if (type === 'storage') storageListeners.delete(listener);
    },
  };
  vi.stubGlobal('window', fakeWindow);
  return {
    emitStorage(key: string, newValue: string) {
      for (const listener of storageListeners) listener({ key, newValue });
    },
  };
}

function encryptedResponse(payload: unknown, sharedSecret: Uint8Array) {
  const nonce = new Uint8Array(nacl.box.nonceLength).fill(7);
  const data = nacl.box.after(
    new TextEncoder().encode(JSON.stringify(payload)),
    nonce,
    sharedSecret,
  );
  return new URLSearchParams({ nonce: bs58.encode(nonce), data: bs58.encode(data) });
}

describe('mobile Solana wallet deeplinks', () => {
  it('builds provider-specific connect requests with the app callback', () => {
    const dapp = nacl.box.keyPair();
    const phantom = buildConnectRequest({
      provider: 'phantom',
      appUrl: 'https://dev.worldofclaudecraft.com',
      redirectUrl:
        'https://dev.worldofclaudecraft.com/wallet-return.html?woc_wallet_request=request-1',
      dappPublicKey: dapp.publicKey,
    });
    const solflare = buildConnectRequest({
      provider: 'solflare',
      appUrl: 'https://dev.worldofclaudecraft.com',
      redirectUrl:
        'https://dev.worldofclaudecraft.com/wallet-return.html?woc_wallet_request=request-2',
      dappPublicKey: dapp.publicKey,
    });

    expect(phantom.origin + phantom.pathname).toBe('https://phantom.app/ul/v1/connect');
    expect(solflare.origin + solflare.pathname).toBe('https://solflare.com/ul/v1/connect');
    expect(phantom.searchParams.get('cluster')).toBe('mainnet-beta');
    expect(phantom.searchParams.get('redirect_link')).toContain('wallet-return.html');
    expect(phantom.searchParams.get('dapp_encryption_public_key')).toBe(
      bs58.encode(dapp.publicKey),
    );
  });

  it('decrypts a connect response and preserves the provider session', () => {
    const dapp = nacl.box.keyPair();
    const wallet = nacl.box.keyPair();
    const shared = nacl.box.before(dapp.publicKey, wallet.secretKey);
    const response = encryptedResponse(
      { public_key: 'WalletAddress', session: 'opaque-session' },
      shared,
    );
    response.set('phantom_encryption_public_key', bs58.encode(wallet.publicKey));

    expect(decryptConnectResponse('phantom', response, dapp.secretKey)).toEqual({
      address: 'WalletAddress',
      session: 'opaque-session',
      walletPublicKey: wallet.publicKey,
      sharedSecret: shared,
    });
  });

  it('encrypts signing payloads and decrypts wallet signatures', () => {
    const shared = new Uint8Array(nacl.box.sharedKeyLength).fill(9);
    const request = buildEncryptedRequest({
      provider: 'solflare',
      method: 'signMessage',
      dappPublicKey: new Uint8Array(nacl.box.publicKeyLength).fill(3),
      sharedSecret: shared,
      redirectUrl: 'https://worldofclaudecraft.com/wallet-return.html?woc_wallet_request=req',
      payload: { message: 'encoded-message', session: 'opaque-session', display: 'utf8' },
      nonce: new Uint8Array(nacl.box.nonceLength).fill(5),
    });
    const encrypted = bs58.decode(request.searchParams.get('payload') ?? '');
    const nonce = bs58.decode(request.searchParams.get('nonce') ?? '');
    const opened = nacl.box.open.after(encrypted, nonce, shared);

    expect(opened).not.toBeNull();
    if (!opened) throw new Error('expected request payload to decrypt');
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({
      message: 'encoded-message',
      session: 'opaque-session',
      display: 'utf8',
    });
    expect(
      decryptEncryptedResponse(encryptedResponse({ signature: 'tx-signature' }, shared), shared),
    ).toEqual({ signature: 'tx-signature' });
  });

  it('keeps the game tab alive while a wallet app connects and signs', async () => {
    const browser = installFakeWindow();
    const wallet = nacl.box.keyPair();
    let sharedSecret: Uint8Array | null = null;
    const deliver = (requestUrl: URL, response: URLSearchParams): void => {
      const callback = new URL(requestUrl.searchParams.get('redirect_link') ?? '');
      const requestId = callback.searchParams.get('woc_wallet_request') ?? '';
      response.set('woc_wallet_request', requestId);
      const key = `woc.wallet.mobile.v1.response.${requestId}`;
      const raw = `?${response.toString()}`;
      window.localStorage.setItem(key, raw);
      browser.emitStorage(key, raw);
    };
    const client = createMobileWalletClient('solflare', async (launchRequest) => {
      expect(launchRequest.returnTarget).toBe('browser');
      if (!launchRequest.url) throw new Error('expected a direct wallet URL');
      const { url } = launchRequest;
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith('/connect')) {
        const dappPublicKey = bs58.decode(
          requestUrl.searchParams.get('dapp_encryption_public_key') ?? '',
        );
        sharedSecret = nacl.box.before(dappPublicKey, wallet.secretKey);
        const response = encryptedResponse(
          { public_key: 'MobileWalletAddress', session: 'mobile-session' },
          sharedSecret,
        );
        response.set('solflare_encryption_public_key', bs58.encode(wallet.publicKey));
        deliver(requestUrl, response);
        return 'opened';
      }
      expect(sharedSecret).not.toBeNull();
      const encryptedPayload = bs58.decode(requestUrl.searchParams.get('payload') ?? '');
      const nonce = bs58.decode(requestUrl.searchParams.get('nonce') ?? '');
      const activeSharedSecret = sharedSecret;
      if (!activeSharedSecret) throw new Error('expected an established wallet session');
      const opened = nacl.box.open.after(encryptedPayload, nonce, activeSharedSecret);
      expect(opened).not.toBeNull();
      if (!opened) throw new Error('expected request payload to decrypt');
      const payload = JSON.parse(new TextDecoder().decode(opened));
      expect(payload).toMatchObject({
        session: 'mobile-session',
      });
      if (requestUrl.pathname.endsWith('/signMessage')) {
        expect(payload).toMatchObject({ display: 'utf8' });
        deliver(
          requestUrl,
          encryptedResponse({ signature: 'message-signature' }, activeSharedSecret),
        );
        return 'opened';
      }
      expect(requestUrl.pathname).toMatch(/signAndSendTransaction$/);
      expect(payload).toMatchObject({
        transaction: bs58.encode(new Uint8Array([1, 2, 3])),
        sendOptions: { preflightCommitment: 'confirmed' },
      });
      deliver(
        requestUrl,
        encryptedResponse({ signature: 'transaction-signature' }, activeSharedSecret),
      );
      return 'opened';
    });

    await expect(client.connect()).resolves.toEqual({
      address: 'MobileWalletAddress',
      chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    });
    await expect(client.signMessageBase58('Verify me')).resolves.toBe('message-signature');
    await expect(client.signAndSendTransactionBase64('AQID')).resolves.toBe(
      'transaction-signature',
    );
  });
});
