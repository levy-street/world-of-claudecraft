import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { MobileDeeplinkWalletProvider, MobileWalletProvider } from './wallet_platform';

export type MobileWalletRequestMethod = 'connect' | 'signMessage' | 'signAndSendTransaction';

export interface MobileWalletState {
  address: string | null;
  chain: string | null;
}

interface MobileWalletLaunchRequestBase {
  provider: MobileWalletProvider;
  walletName: string;
  returnTarget: 'browser' | 'standalone';
}

export type MobileWalletLaunchRequest = MobileWalletLaunchRequestBase &
  (
    | { url: string; connectionUri?: never; open?: never }
    | { url?: never; connectionUri?: never; open: Promise<() => void | Promise<void>> }
  );

export type MobileWalletLaunchOutcome = 'opened';
export type MobileWalletLauncher = (
  request: MobileWalletLaunchRequest,
) => Promise<MobileWalletLaunchOutcome>;

export interface MobileWalletClient {
  current(): MobileWalletState;
  connect(): Promise<MobileWalletState>;
  disconnect(): Promise<void>;
  signMessageBase58(message: string): Promise<string>;
  signAndSendTransactionBase64(transactionBase64: string): Promise<string>;
  onChange(listener: (state: MobileWalletState) => void): () => void;
}

export interface DecryptedConnectResponse {
  address: string;
  session: string;
  walletPublicKey: Uint8Array;
  sharedSecret: Uint8Array;
}

interface StoredMobileWalletSession {
  address: string;
  session: string;
  dappPublicKey: string;
  sharedSecret: string;
}

interface StoredPendingRequest {
  provider: MobileDeeplinkWalletProvider;
  method: MobileWalletRequestMethod;
  returnUrl: string;
  createdAt: number;
}

const PROVIDERS = {
  phantom: { name: 'Phantom', baseUrl: 'https://phantom.app/ul/v1' },
  solflare: { name: 'Solflare', baseUrl: 'https://solflare.com/ul/v1' },
} as const;
const STORAGE_PREFIX = 'woc.wallet.mobile.v1';
const RESPONSE_TIMEOUT_MS = 120_000;
const SOLANA_MAINNET_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`wallet response is missing ${name}`);
  return value;
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('wallet response is invalid');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`wallet response is missing ${name}`);
  }
  return value;
}

export function buildConnectRequest(input: {
  provider: MobileDeeplinkWalletProvider;
  appUrl: string;
  redirectUrl: string;
  dappPublicKey: Uint8Array;
}): URL {
  const url = new URL(`${PROVIDERS[input.provider].baseUrl}/connect`);
  url.searchParams.set('app_url', input.appUrl);
  url.searchParams.set('dapp_encryption_public_key', bs58.encode(input.dappPublicKey));
  url.searchParams.set('redirect_link', input.redirectUrl);
  url.searchParams.set('cluster', 'mainnet-beta');
  return url;
}

export function buildEncryptedRequest(input: {
  provider: MobileDeeplinkWalletProvider;
  method: Exclude<MobileWalletRequestMethod, 'connect'>;
  dappPublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  redirectUrl: string;
  payload: Record<string, unknown>;
  nonce?: Uint8Array;
}): URL {
  const nonce = input.nonce ?? nacl.randomBytes(nacl.box.nonceLength);
  const payload = nacl.box.after(
    new TextEncoder().encode(JSON.stringify(input.payload)),
    nonce,
    input.sharedSecret,
  );
  const url = new URL(`${PROVIDERS[input.provider].baseUrl}/${input.method}`);
  url.searchParams.set('dapp_encryption_public_key', bs58.encode(input.dappPublicKey));
  url.searchParams.set('nonce', bs58.encode(nonce));
  url.searchParams.set('redirect_link', input.redirectUrl);
  url.searchParams.set('payload', bs58.encode(payload));
  return url;
}

export function decryptEncryptedResponse(
  params: URLSearchParams,
  sharedSecret: Uint8Array,
): Record<string, unknown> {
  const nonce = bs58.decode(requireParam(params, 'nonce'));
  const data = bs58.decode(requireParam(params, 'data'));
  const opened = nacl.box.open.after(data, nonce, sharedSecret);
  if (!opened) throw new Error('wallet response could not be decrypted');
  return parseJsonObject(opened);
}

export function decryptConnectResponse(
  provider: MobileDeeplinkWalletProvider,
  params: URLSearchParams,
  dappSecretKey: Uint8Array,
): DecryptedConnectResponse {
  const walletKeyName =
    provider === 'phantom' ? 'phantom_encryption_public_key' : 'solflare_encryption_public_key';
  const walletPublicKey = bs58.decode(requireParam(params, walletKeyName));
  const sharedSecret = nacl.box.before(walletPublicKey, dappSecretKey);
  const data = decryptEncryptedResponse(params, sharedSecret);
  return {
    address: requireString(data.public_key, 'public_key'),
    session: requireString(data.session, 'session'),
    walletPublicKey,
    sharedSecret,
  };
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sessionStorageKey(provider: MobileDeeplinkWalletProvider): string {
  return `${STORAGE_PREFIX}.session.${provider}`;
}

function pendingStorageKey(requestId: string): string {
  return `${STORAGE_PREFIX}.pending.${requestId}`;
}

function responseStorageKey(requestId: string): string {
  return `${STORAGE_PREFIX}.response.${requestId}`;
}

function randomRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function walletResponseError(params: URLSearchParams): Error | null {
  const code = params.get('errorCode');
  if (!code) return null;
  const error = new Error(params.get('errorMessage') || 'wallet request was rejected');
  if (code === '4001') error.name = 'WalletConnectionCancelled';
  return error;
}

function defaultLauncher(request: MobileWalletLaunchRequest): Promise<MobileWalletLaunchOutcome> {
  window.open(request.url, '_blank', 'noopener,noreferrer');
  return Promise.resolve('opened');
}

export function createMobileWalletClient(
  provider: MobileDeeplinkWalletProvider,
  launcher: MobileWalletLauncher = defaultLauncher,
): MobileWalletClient {
  const listeners = new Set<(state: MobileWalletState) => void>();

  function readSession(): StoredMobileWalletSession | null {
    try {
      const raw = window.localStorage.getItem(sessionStorageKey(provider));
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<StoredMobileWalletSession>;
      if (
        typeof value.address !== 'string' ||
        typeof value.session !== 'string' ||
        typeof value.dappPublicKey !== 'string' ||
        typeof value.sharedSecret !== 'string'
      ) {
        return null;
      }
      return value as StoredMobileWalletSession;
    } catch {
      return null;
    }
  }

  function writeSession(session: StoredMobileWalletSession | null): void {
    const key = sessionStorageKey(provider);
    if (session) window.localStorage.setItem(key, JSON.stringify(session));
    else window.localStorage.removeItem(key);
  }

  function state(): MobileWalletState {
    const session = readSession();
    return session
      ? { address: session.address, chain: SOLANA_MAINNET_CHAIN }
      : { address: null, chain: null };
  }

  function emit(): void {
    const next = state();
    for (const listener of listeners) listener(next);
  }

  function waitForResponse(requestId: string): {
    promise: Promise<URLSearchParams>;
    cancel: () => void;
  } {
    const key = responseStorageKey(requestId);
    let cleanup = (): void => {};
    const promise = new Promise<URLSearchParams>((resolve, reject) => {
      let settled = false;
      const finish = (raw: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(pendingStorageKey(requestId));
        const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
        const responseError = walletResponseError(params);
        if (responseError) reject(responseError);
        else resolve(params);
      };
      const check = (): void => {
        const raw = window.localStorage.getItem(key);
        if (raw) finish(raw);
      };
      const onStorage = (event: StorageEvent): void => {
        if (event.key === key && event.newValue) finish(event.newValue);
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('wallet app did not return in time'));
      }, RESPONSE_TIMEOUT_MS);
      const poller = window.setInterval(check, 300);
      cleanup = () => {
        window.clearTimeout(timer);
        window.clearInterval(poller);
        window.removeEventListener('storage', onStorage);
      };
      window.addEventListener('storage', onStorage);
      check();
    });
    return {
      promise,
      cancel: () => {
        cleanup();
        window.localStorage.removeItem(key);
        window.localStorage.removeItem(pendingStorageKey(requestId));
      },
    };
  }

  async function request(
    method: MobileWalletRequestMethod,
    build: (redirectUrl: string) => URL,
  ): Promise<URLSearchParams> {
    const requestId = randomRequestId();
    const returnUrl = window.location.href;
    const redirectUrl = new URL('/wallet-return.html', window.location.origin);
    redirectUrl.searchParams.set('woc_wallet_request', requestId);
    const pending: StoredPendingRequest = {
      provider,
      method,
      returnUrl,
      createdAt: Date.now(),
    };
    window.localStorage.setItem(pendingStorageKey(requestId), JSON.stringify(pending));
    const response = waitForResponse(requestId);
    try {
      await launcher({
        provider,
        walletName: PROVIDERS[provider].name,
        returnTarget: 'browser',
        url: build(redirectUrl.toString()).toString(),
      });
      return await response.promise;
    } catch (error) {
      response.cancel();
      throw error;
    }
  }

  function requireSession(): StoredMobileWalletSession {
    const session = readSession();
    if (!session) throw new Error('connect a wallet first');
    return session;
  }

  return {
    current: state,
    async connect() {
      const existing = state();
      if (existing.address) return existing;
      const dapp = nacl.box.keyPair();
      const params = await request('connect', (redirectUrl) =>
        buildConnectRequest({
          provider,
          appUrl: window.location.origin,
          redirectUrl,
          dappPublicKey: dapp.publicKey,
        }),
      );
      const connected = decryptConnectResponse(provider, params, dapp.secretKey);
      writeSession({
        address: connected.address,
        session: connected.session,
        dappPublicKey: bs58.encode(dapp.publicKey),
        sharedSecret: bs58.encode(connected.sharedSecret),
      });
      emit();
      return state();
    },
    async disconnect() {
      writeSession(null);
      emit();
    },
    async signMessageBase58(message) {
      const session = requireSession();
      const sharedSecret = bs58.decode(session.sharedSecret);
      const params = await request('signMessage', (redirectUrl) =>
        buildEncryptedRequest({
          provider,
          method: 'signMessage',
          dappPublicKey: bs58.decode(session.dappPublicKey),
          sharedSecret,
          redirectUrl,
          payload: {
            message: bs58.encode(new TextEncoder().encode(message)),
            session: session.session,
            display: 'utf8',
          },
        }),
      );
      return requireString(decryptEncryptedResponse(params, sharedSecret).signature, 'signature');
    },
    async signAndSendTransactionBase64(transactionBase64) {
      const session = requireSession();
      const sharedSecret = bs58.decode(session.sharedSecret);
      const params = await request('signAndSendTransaction', (redirectUrl) =>
        buildEncryptedRequest({
          provider,
          method: 'signAndSendTransaction',
          dappPublicKey: bs58.decode(session.dappPublicKey),
          sharedSecret,
          redirectUrl,
          payload: {
            transaction: bs58.encode(base64ToBytes(transactionBase64)),
            sendOptions: { preflightCommitment: 'confirmed' },
            session: session.session,
          },
        }),
      );
      return requireString(decryptEncryptedResponse(params, sharedSecret).signature, 'signature');
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
