// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { BankWindow } from '../src/ui/bank_window';
import { generalChatQuotaView } from '../src/ui/general_chat_quota_view';
import { ChatAnnouncer } from '../src/ui/hud/chat/chat_announcer';
import { ChatWindowController } from '../src/ui/hud/chat/chat_window_controller';
import { ensureLocaleLoaded, formatDuration, setLanguage, t } from '../src/ui/i18n';
import { chatLineKind, liveRegionPoliteness } from '../src/ui/live_region_politeness';
import { bareClient } from './helpers/bare_client';

const quotaEvent = (retryAfterSeconds: number): Extract<SimEvent, { type: 'error' }> => ({
  type: 'error',
  text: `General chat limit reached. Try again in ${retryAfterSeconds} seconds.`,
  code: 'general_chat_quota',
  channel: 'general',
  retryAfterSeconds,
});

describe('generalChatQuotaView', () => {
  beforeEach(() => setLanguage('en'));

  it('localizes a valid quota denial from its code and positive retry value', () => {
    const view = generalChatQuotaView(quotaEvent(3));

    expect(view).toEqual({
      text: t('hudChrome.chatQuota.limitReached', { seconds: formatDuration(3) }),
      channel: 'general',
      announceWhenFiltered: true,
    });
    expect(view?.text).toBe('General chat limit reached. Try again in 3 seconds.');
  });

  it('renders the structured code in the active locale instead of the English fallback', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');

    const view = generalChatQuotaView(quotaEvent(3));

    expect(view?.text).toContain(formatDuration(3));
    expect(view?.text).not.toBe(quotaEvent(3).text);
    expect(view?.text).toBe(t('hudChrome.chatQuota.limitReached', { seconds: formatDuration(3) }));
  });

  it('localizes the temporary-unavailable code only with its exact structured data', () => {
    expect(
      generalChatQuotaView({
        type: 'error',
        text: 'old-server fallback',
        code: 'general_chat_quota_unavailable',
        channel: 'general',
        retryAfterSeconds: 1,
      }),
    ).toEqual({
      text: t('hudChrome.chatQuota.unavailable'),
      channel: 'general',
      announceWhenFiltered: true,
    });
  });

  it('localizes the same-account pending code only with its exact structured data', () => {
    expect(
      generalChatQuotaView({
        type: 'error',
        text: 'old-server fallback',
        code: 'general_chat_quota_pending',
        channel: 'general',
        retryAfterSeconds: 1,
      }),
    ).toEqual({
      text: t('hudChrome.chatQuota.pending'),
      channel: 'general',
      announceWhenFiltered: true,
    });
    expect(
      generalChatQuotaView({
        type: 'error',
        text: 'old-server fallback',
        code: 'general_chat_quota_pending',
        channel: 'general',
        retryAfterSeconds: 2,
      }),
    ).toBeNull();
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a quota retry value that is not a positive integer: %s',
    (retryAfterSeconds) => {
      expect(
        generalChatQuotaView({
          type: 'error',
          text: 'fallback text',
          code: 'general_chat_quota',
          channel: 'general',
          retryAfterSeconds,
        }),
      ).toBeNull();
    },
  );

  it('preserves fallback behavior for unknown or malformed structure', () => {
    expect(
      generalChatQuotaView({
        type: 'error',
        text: 'fallback text',
        code: 'a_newer_server_code',
        channel: 'general',
        retryAfterSeconds: 3,
      }),
    ).toBeNull();
    expect(
      generalChatQuotaView({
        type: 'error',
        text: 'fallback text',
        code: 'general_chat_quota',
        channel: 'world',
        retryAfterSeconds: 3,
      }),
    ).toBeNull();
    expect(
      generalChatQuotaView({
        type: 'error',
        text: 'fallback text',
        code: 'general_chat_quota_unavailable',
        channel: 'general',
        retryAfterSeconds: 2,
      }),
    ).toBeNull();
  });
});

describe('ClientWorld structured General chat quota event queue', () => {
  it('preserves stable code, channel, retry data, and fallback text through drainEvents', () => {
    const client = bareClient(1);
    const event = quotaEvent(3);

    (client as unknown as { onMessage(raw: string): void }).onMessage(
      JSON.stringify({ t: 'events', list: [event] }),
    );

    expect(client.drainEvents()).toEqual([event]);
    expect(client.drainEvents()).toEqual([]);
  });
});

function makeChatWindow(activeTab: 'world' | 'general', chatLog: HTMLElement) {
  const chatWindow = new ChatWindowController({
    document,
    storage: localStorage,
    chatLog,
    combatLog: document.createElement('div'),
    contextMenu: {
      element: document.createElement('div'),
      opener: () => null,
      setOpener: () => {},
      close: () => {},
      place: () => {},
      bind: () => {},
    },
    sendChat: () => {},
    isMobileLayout: () => false,
    itemDisplayName: () => null,
    questTitle: () => '',
    selectedQuestId: () => null,
    hasQuest: () => false,
    showError: () => {},
  });
  Object.assign(chatWindow as unknown as Record<string, unknown>, { activeChatTab: activeTab });
  return chatWindow;
}

describe('structured General chat quota UI routing', () => {
  const hudSource = readFileSync(resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('retains the denial for the General tab while another tab is active', () => {
    const chatLog = document.createElement('div');
    const chatWindow = makeChatWindow('world', chatLog);
    const line = document.createElement('div');
    line.dataset.chan = 'general';
    line.textContent = 'General chat limit reached. Try again in 3 seconds.';
    chatWindow.hideIfFiltered(line, 'general');
    chatLog.append(line);

    expect(line.dataset.chan).toBe('general');
    expect(line.classList.contains('chat-hidden')).toBe(true);
    expect(chatLog.contains(line)).toBe(true);
    expect(line.textContent).toContain('General chat limit reached. Try again in 3 seconds.');

    Object.assign(chatWindow as unknown as Record<string, unknown>, { activeChatTab: 'general' });
    (chatWindow as unknown as { applyFilter(): void }).applyFilter();
    expect(line.classList.contains('chat-hidden')).toBe(false);
  });

  it('announces filtered denials politely through the existing throttled chat announcer', () => {
    const announcements: string[] = [];
    const announcer = new ChatAnnouncer((text) => announcements.push(text), 1000);

    expect(liveRegionPoliteness(chatLineKind())).toBe('polite');
    announcer.push('General chat limit reached. Try again in 3 seconds.', 0);
    announcer.push('General chat limit reached. Try again in 4 seconds.', 500);

    expect(announcements).toEqual(['General chat limit reached. Try again in 3 seconds.']);
    announcer.flush(999);
    expect(announcements).toHaveLength(1);
    announcer.flush(1000);
    expect(announcements).toEqual([
      'General chat limit reached. Try again in 3 seconds.',
      'General chat limit reached. Try again in 4 seconds.',
    ]);
  });

  it('wires recognized events to General and keeps the prose fallback arm', () => {
    const errorCase = hudSource.slice(
      hudSource.indexOf("case 'error':"),
      hudSource.indexOf("case 'questAccepted':"),
    );
    expect(errorCase).toContain('const quota = generalChatQuotaView(ev)');
    // The view result is ALREADY localized, so it must take the localized
    // sink; re-running showError's English matcher on it would double-localize.
    expect(errorCase).toContain(
      'this.showLocalizedError(quota.text, quota.channel, quota.announceWhenFiltered)',
    );
    expect(errorCase).toContain(
      'this.showError(this.localizeErrorText(this.bankWindow.observeStorageText(ev.text)))',
    );
  });

  it('passes unrecognized prose through the storage observer unchanged', () => {
    const prose = 'An older server sent an unstructured refusal.';
    const bankWindow = {
      guildPane: { onDefinitivePurchaseRefusal: () => false },
      vaultPane: { onDefinitivePurchaseRefusal: () => false },
      socketPurchase: { observeText: () => false },
      opened: false,
    } as unknown as BankWindow;

    expect(BankWindow.prototype.observeStorageText.call(bankWindow, prose)).toBe(prose);
  });
});
