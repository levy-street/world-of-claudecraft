import type {
  MobileWalletLaunchOutcome,
  MobileWalletLaunchRequest,
} from '../net/mobile_wallet_deeplink';
import type { FocusManager } from './focus_manager';
import { t } from './i18n';

function walletConnectionCancelled(): Error {
  const error = new Error('wallet connection cancelled');
  error.name = 'WalletConnectionCancelled';
  return error;
}

export function showMobileWalletLauncher(
  request: MobileWalletLaunchRequest,
  focusManager: FocusManager,
): Promise<MobileWalletLaunchOutcome> {
  return new Promise<MobileWalletLaunchOutcome>((resolve, reject) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const back = document.createElement('div');
    back.className = 'modal-backdrop wallet-picker-backdrop';

    const panel = document.createElement('div');
    panel.className = 'panel wallet-picker-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'mobile-wallet-launch-title');
    panel.setAttribute('aria-describedby', 'mobile-wallet-launch-help mobile-wallet-return-help');

    const titleRow = document.createElement('div');
    titleRow.className = 'panel-title';
    const title = document.createElement('span');
    title.id = 'mobile-wallet-launch-title';
    title.textContent = t('wallet.openAppTitle', { wallet: request.walletName });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'x-btn wallet-picker-close';
    closeBtn.setAttribute('aria-label', t('skinEvent.close'));
    closeBtn.textContent = '×';
    titleRow.append(title, closeBtn);

    const help = document.createElement('p');
    help.className = 'wallet-picker-help';
    help.id = 'mobile-wallet-launch-help';
    help.textContent = t('wallet.openAppHelp', { wallet: request.walletName });

    const manualReturnHelp = document.createElement('p');
    manualReturnHelp.className = 'wallet-picker-help wallet-manual-return-help';
    manualReturnHelp.id = 'mobile-wallet-return-help';
    manualReturnHelp.textContent = t(
      request.returnTarget === 'standalone'
        ? 'wallet.manualReturnStandaloneHelp'
        : 'wallet.manualReturnBrowserHelp',
    );

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'wallet-picker-option wallet-app-launch-button';
    openBtn.textContent = t('wallet.openAppButton', { wallet: request.walletName });
    let openWallet: (() => void | Promise<void>) | null = null;

    const actions = document.createElement('div');
    actions.className = 'wallet-app-launch-actions';
    actions.appendChild(openBtn);

    const launchStatus = document.createElement('div');
    launchStatus.className = 'wallet-app-launch-status';
    launchStatus.setAttribute('role', 'status');
    launchStatus.setAttribute('aria-live', 'polite');
    if (request.open) {
      openBtn.disabled = true;
      openBtn.textContent = t('wallet.preparingAppButton', { wallet: request.walletName });
      void request.open.then(
        (preparedOpen) => {
          openWallet = preparedOpen;
          openBtn.disabled = false;
          openBtn.textContent = t('wallet.openAppButton', { wallet: request.walletName });
          openBtn.focus();
        },
        () => {
          launchStatus.textContent = t('wallet.walletAppUnavailable', {
            wallet: request.walletName,
          });
        },
      );
    }

    panel.append(titleRow, help, manualReturnHelp);
    panel.append(actions, launchStatus);
    back.appendChild(panel);
    document.body.appendChild(back);
    const focusHandle = focusManager.open({ root: () => panel, returnFocusTo: opener });
    let settled = false;
    const finish = (error?: Error, outcome?: MobileWalletLaunchOutcome): void => {
      if (settled) return;
      settled = true;
      back.remove();
      focusHandle.release(true);
      if (error) reject(error);
      else if (outcome) resolve(outcome);
    };
    const cancel = (): void => finish(walletConnectionCancelled());
    closeBtn.addEventListener('click', cancel);
    back.addEventListener('click', (event) => {
      if (event.target === back) cancel();
    });
    back.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    });
    openBtn.addEventListener('click', async () => {
      let opening: void | Promise<void>;
      if (request.open) {
        if (!openWallet) return;
        // Invoke during the click event so iOS preserves transient user activation.
        opening = openWallet();
      } else {
        window.open(request.url, '_blank', 'noopener,noreferrer');
        opening = undefined;
      }
      openBtn.disabled = true;
      try {
        await opening;
        finish(undefined, 'opened');
      } catch (error) {
        openBtn.disabled = false;
        finish(error instanceof Error ? error : new Error('wallet app could not be opened'));
      }
    });
    openBtn.focus();
  });
}
