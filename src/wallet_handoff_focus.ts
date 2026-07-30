export interface WalletHandoffReplaceOptions {
  focusSelector?: string;
  preserveWalletFocus?: boolean;
}

/** Replace one authorization state without dropping keyboard focus onto the document body. */
export function replaceWalletHandoffContent(
  root: HTMLElement,
  html: string,
  options: WalletHandoffReplaceOptions = {},
): void {
  const active = root.ownerDocument.activeElement;
  const focusedWallet =
    options.preserveWalletFocus && active instanceof HTMLElement && root.contains(active)
      ? active.dataset.wallet
      : undefined;
  root.innerHTML = html;
  const preserved = focusedWallet
    ? Array.from(root.querySelectorAll<HTMLElement>('[data-wallet]')).find(
        (element) => element.dataset.wallet === focusedWallet,
      )
    : null;
  const target =
    preserved ??
    (options.focusSelector ? root.querySelector<HTMLElement>(options.focusSelector) : null);
  target?.focus();
}
