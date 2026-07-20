/** "AbCd…WxYz" — never show a full wallet on public surfaces. */
export function truncateWallet(wallet: string): string {
  return wallet.length <= 10 ? wallet : `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}
