// Browser Ethereum/EVM wallet connect for NFT-PFP skin linking, the EVM sibling of
// wallet.ts (Solana Wallet Standard). Uses EIP-6963 multi-wallet discovery with an
// EIP-1193 fallback, and EIP-191 `personal_sign`. No sim/render dependency; the
// account-to-wallet link is verified server-side (server/wallet_evm.ts). Zero new
// dependency: raw provider events, no wagmi/viem (desktop extension wallets).

export interface EvmProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface EvmProviderChoice {
  info: EvmProviderInfo;
  provider: Eip1193Provider;
}

interface Eip6963AnnounceEvent extends Event {
  detail?: { info?: Partial<EvmProviderInfo>; provider?: Eip1193Provider };
}

function utf8ToHex(s: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(s)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Discover injected EVM wallets via EIP-6963 (every modern extension announces
 * itself), falling back to a legacy `window.ethereum` if nothing announces.
 * Resolves after a short collection window.
 */
export function discoverEvmProviders(timeoutMs = 350): Promise<EvmProviderChoice[]> {
  return new Promise((resolve) => {
    const found = new Map<string, EvmProviderChoice>();
    const onAnnounce = (ev: Event): void => {
      const detail = (ev as Eip6963AnnounceEvent).detail;
      const info = detail?.info;
      const provider = detail?.provider;
      if (info?.uuid && provider) {
        found.set(info.uuid, {
          info: { uuid: info.uuid, name: info.name ?? 'Wallet', icon: info.icon ?? '', rdns: info.rdns ?? '' },
          provider,
        });
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      let list = [...found.values()];
      const injected = (window as unknown as { ethereum?: Eip1193Provider & { isMetaMask?: boolean } }).ethereum;
      if (list.length === 0 && injected) {
        list = [{ info: { uuid: 'injected', name: injected.isMetaMask ? 'MetaMask' : 'Browser Wallet', icon: '', rdns: 'injected' }, provider: injected }];
      }
      resolve(list);
    }, timeoutMs);
  });
}

/** Request account access; returns the selected (lower-cased) address, or null. */
export async function connectEvm(provider: Eip1193Provider): Promise<string | null> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as unknown;
  const first = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
  return first ? first.toLowerCase() : null;
}

/** Sign a UTF-8 message with EIP-191 `personal_sign` (params are [hexData, address]). */
export async function signEvmMessage(provider: Eip1193Provider, address: string, message: string): Promise<string> {
  const sig = await provider.request({ method: 'personal_sign', params: [`0x${utf8ToHex(message)}`, address] });
  if (typeof sig !== 'string') throw new Error('wallet did not return a signature');
  return sig;
}
