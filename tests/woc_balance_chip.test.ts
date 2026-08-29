// The bag's $WOC balance chip has four faces and no test of its own until now:
// it was lifted out of the Hud coordinator as a faithful move, and a faithful
// move is exactly when the cheap pin is worth adding, because nothing else
// would notice a face quietly changing shape.
//
// The wallet reads are module functions, so they are mocked here rather than
// staged: this module owns no state, which is the whole point of it being a
// pure core.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/ui/i18n';
import { wocBalanceChipHtml } from '../src/ui/woc_balance_chip';
import { wocTokensText } from '../src/ui/woc_tokens_text';

const wallet = vi.hoisted(() => ({
  enabled: true,
  connection: { kind: 'disconnected' } as { kind: string },
  balance: null as number | null,
  verified: false,
}));

// The escaping test needs a HOSTILE catalog value: with only well-formed
// catalog English in play, an attribute regex passes whether or not the
// builder escapes. One key is wrapped to carry a double quote on demand;
// every other key passes through to the real catalog.
const hostile = vi.hoisted(() => ({ key: '' }));

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/i18n')>();
  return {
    ...real,
    t: (key: Parameters<typeof real.t>[0], params?: Parameters<typeof real.t>[1]) =>
      key === hostile.key ? `injected "quote" ${real.t(key, params)}` : real.t(key, params),
  };
});

vi.mock('../src/ui/wallet_balance', () => ({
  walletUiEnabled: () => wallet.enabled,
  walletConnectionView: () => wallet.connection,
  wocBalance: () => wallet.balance,
  wocBalanceVerified: () => wallet.verified,
}));

beforeEach(() => {
  wallet.enabled = true;
  wallet.connection = { kind: 'disconnected' };
  wallet.balance = null;
  wallet.verified = false;
});

describe('wocBalanceChipHtml: the four faces', () => {
  it('renders nothing at all when the wallet surface is off', () => {
    wallet.enabled = false;
    wallet.balance = 12.5;
    expect(wocBalanceChipHtml()).toBe('');
  });

  it('offers the call to action that matches the connection state', () => {
    // Three different sentences, one per state: a player who linked and then
    // dropped the connection is told to reconnect, not to connect again.
    const cases: Array<[string, string]> = [
      ['disconnected', t('wallet.bagConnect')],
      ['connected_unlinked', t('wallet.bagLink')],
      ['mismatched', t('wallet.bagLink')],
      ['linked_disconnected', t('wallet.bagReconnect')],
    ];
    for (const [kind, label] of cases) {
      wallet.connection = { kind };
      const html = wocBalanceChipHtml();
      expect(html, `${kind} renders a pressable action`).toContain('data-wallet-action');
      expect(html, `${kind} names its own action`).toContain(label);
      expect(html, `${kind} labels the control for a screen reader`).toContain(
        `aria-label="${label}"`,
      );
    }
  });

  it('renders a VERIFIED balance as an inert span, spelled the shared way', () => {
    wallet.connection = { kind: 'linked' };
    wallet.balance = 1234.5678;
    wallet.verified = true;
    const html = wocBalanceChipHtml();
    const balance = t('wallet.balanceAmount', { amount: wocTokensText(1234.5678) });
    expect(html).toContain(balance);
    expect(html, 'the shared two-digit spelling, not a raw number').toContain('1,234.57');
    expect(html.startsWith('<span')).toBe(true);
    expect(html.endsWith('</span>')).toBe(true);
    expect(html, 'a verified balance is not an action').not.toContain('data-wallet-action');
    expect(html).toContain('is-verified');
    expect(html).toContain(t('wallet.balanceAria', { balance }));
  });

  it('renders an UNVERIFIED balance as a button that says it is a preview', () => {
    // The distinction is load bearing: an unlinked balance is a local preview,
    // while a verified one belongs to the account-linked wallet.
    wallet.connection = { kind: 'connected_unlinked' };
    wallet.balance = 8;
    wallet.verified = false;
    const html = wocBalanceChipHtml();
    const balance = t('wallet.balanceAmount', { amount: wocTokensText(8) });
    expect(html.startsWith('<button')).toBe(true);
    expect(html.endsWith('</button>')).toBe(true);
    expect(html).toContain('data-wallet-action');
    expect(html).toContain('is-preview');
    expect(html).toContain(t('wallet.balancePreviewAria', { balance }));
    expect(html).not.toContain('is-verified');
  });

  it('escapes every interpolated value rather than trusting the catalog', () => {
    wallet.connection = { kind: 'linked' };
    wallet.balance = 1;
    wallet.verified = true;
    // Inject a double quote through the aria label's catalog value: with the
    // escaping removed, the raw quote lands inside the attribute and the
    // entity form disappears, so both assertions flip.
    hostile.key = 'wallet.balanceAria';
    try {
      const html = wocBalanceChipHtml();
      expect(html).toContain('injected &quot;quote&quot;');
      expect(html).not.toContain('injected "quote"');
      expect(/aria-label="[^"]*"/.test(html)).toBe(true);
      expect(/title="[^"]*"/.test(html)).toBe(true);
    } finally {
      hostile.key = '';
    }
  });
});
