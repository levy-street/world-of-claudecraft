import { isSolanaChain } from '@solana/wallet-standard-chains';
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import bs58 from 'bs58';

export interface BrowserWalletOption {
  id: string;
  name: string;
  icon: WalletIcon;
}

export interface BrowserWalletSession {
  address: string;
  signMessage(message: string): Promise<string>;
  signAndSendTransaction(transactionBase64: string): Promise<string>;
}

export type BrowserWalletRequirement = 'link' | 'transaction';

type CompatibleWallet = Wallet & StandardConnectFeature & SolanaSignMessageFeature;

function compatible(
  wallet: Wallet,
  requirement: BrowserWalletRequirement,
): wallet is CompatibleWallet {
  const messageCompatible =
    StandardConnect in wallet.features &&
    SolanaSignMessage in wallet.features &&
    (wallet.chains.some(isSolanaChain) ||
      wallet.accounts.some((account) => account.chains.some(isSolanaChain)));
  if (!messageCompatible) return false;
  if (requirement === 'link') return true;
  if (!(SolanaSignAndSendTransaction in wallet.features)) return false;
  return (
    wallet.accounts.length === 0 || accountFor(wallet as CompatibleWallet, requirement) !== null
  );
}

function accountFor(
  wallet: CompatibleWallet,
  requirement: BrowserWalletRequirement,
  accounts = wallet.accounts,
): WalletAccount | null {
  return (
    accounts.find(
      (account) =>
        account.chains.some(isSolanaChain) &&
        account.features.includes(SolanaSignMessage) &&
        (requirement === 'link' || account.features.includes(SolanaSignAndSendTransaction)),
    ) ?? null
  );
}

function walletById(id: string, requirement: BrowserWalletRequirement): CompatibleWallet | null {
  for (const wallet of getWallets().get()) {
    if (wallet.name === id && compatible(wallet, requirement)) return wallet;
  }
  return null;
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function browserWalletOptions(
  requirement: BrowserWalletRequirement = 'link',
): BrowserWalletOption[] {
  return getWallets()
    .get()
    .filter((wallet) => compatible(wallet, requirement))
    .map((wallet) => ({ id: wallet.name, name: wallet.name, icon: wallet.icon }));
}

export function onBrowserWalletRegistered(listener: () => void): () => void {
  return getWallets().on('register', listener);
}

export async function connectBrowserWallet(
  id: string,
  requirement: BrowserWalletRequirement = 'link',
): Promise<BrowserWalletSession> {
  const wallet = walletById(id, requirement);
  if (!wallet) throw new Error('wallet extension is not available');
  const connect = wallet.features[
    StandardConnect
  ] as StandardConnectFeature[typeof StandardConnect];
  const result = await connect.connect();
  const account = accountFor(wallet, requirement, result.accounts);
  if (!account) throw new Error('wallet did not authorize a Solana account');

  return {
    address: account.address,
    async signMessage(message) {
      const bytes = new TextEncoder().encode(message);
      const signMessage = wallet.features[
        SolanaSignMessage
      ] as SolanaSignMessageFeature[typeof SolanaSignMessage];
      const signed = await signMessage.signMessage({
        account,
        message: bytes,
      });
      const result = signed[0];
      if (!result || !(result.signature instanceof Uint8Array)) {
        throw new Error('wallet returned an invalid signature');
      }
      return bs58.encode(result.signature);
    },
    async signAndSendTransaction(transactionBase64) {
      const feature = wallet.features[SolanaSignAndSendTransaction] as
        | SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
        | undefined;
      if (!feature || !account.features.includes(SolanaSignAndSendTransaction)) {
        throw new Error('wallet cannot sign and send transactions');
      }
      const chain = account.chains.find(isSolanaChain);
      if (!chain) throw new Error('wallet did not authorize a Solana chain');
      const sent = await feature.signAndSendTransaction({
        account,
        chain,
        transaction: base64ToBytes(transactionBase64),
        options: { preflightCommitment: 'confirmed' },
      });
      const result = sent[0];
      if (!result || !(result.signature instanceof Uint8Array)) {
        throw new Error('wallet returned an invalid transaction signature');
      }
      return bs58.encode(result.signature);
    },
  };
}
