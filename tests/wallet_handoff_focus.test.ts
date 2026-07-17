// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { replaceWalletHandoffContent } from '../src/wallet_handoff_focus';

describe('wallet handoff focus management', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="root"></main>';
    const element = document.querySelector<HTMLElement>('#root');
    if (!element) throw new Error('missing wallet handoff test root');
    root = element;
  });

  it('moves focus to the authorization status when the chosen wallet button is removed', () => {
    root.innerHTML = '<button data-wallet="Solflare">Solflare</button>';
    root.querySelector<HTMLElement>('[data-wallet]')?.focus();

    replaceWalletHandoffContent(
      root,
      '<h1 tabindex="-1" data-wallet-handoff-status>Review in Solflare</h1>',
      { focusSelector: '[data-wallet-handoff-status]' },
    );

    expect(document.activeElement).toBe(root.querySelector('[data-wallet-handoff-status]'));
  });

  it('focuses retry after an authorization error', () => {
    replaceWalletHandoffContent(root, '<button data-retry>Retry</button>', {
      focusSelector: '[data-retry]',
    });

    expect(document.activeElement).toBe(root.querySelector('[data-retry]'));
  });

  it('focuses the completion status when the protocol return leaves the page open', () => {
    replaceWalletHandoffContent(
      root,
      '<h1 tabindex="-1" data-wallet-handoff-complete>Complete</h1><a href="worldofclaudecraft://wallet-handoff">Return</a>',
      { focusSelector: '[data-wallet-handoff-complete]' },
    );

    expect(document.activeElement).toBe(root.querySelector('[data-wallet-handoff-complete]'));
  });

  it('preserves the selected wallet button across registration-driven rerenders', () => {
    root.innerHTML = '<button data-wallet="Phantom">Phantom</button>';
    root.querySelector<HTMLElement>('[data-wallet]')?.focus();

    replaceWalletHandoffContent(
      root,
      '<button data-wallet="Phantom">Phantom updated</button><button data-wallet="Solflare">Solflare</button>',
      { preserveWalletFocus: true },
    );

    expect(document.activeElement).toBe(root.querySelector('[data-wallet="Phantom"]'));
  });
});
