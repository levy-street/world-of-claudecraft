import { esc } from '../../esc';
import { type TranslationKey, t } from '../../i18n';
import { encodeItemLink, encodeQuestLink } from '../quest/quest_link';
import {
  CHANNEL_LABEL_KEYS,
  CHAT_TAB_CHANNELS,
  type ChatInputTintTarget,
  type ChatOpenTab,
  type ChatTabChannel,
  type ChatTabId,
  channelNeedsJoin,
  chatInputTint,
  chatOpenTabLabelKey,
  composeChatLine,
  composeWhisperReply,
  isChatOpenTab,
  isChatTabChannel,
  parseChatTabs,
  sentLineTargetForHost,
  serializeChatTabs,
  WHISPER_TAB,
  WHISPER_TAB_LABEL_KEY,
} from './chat_channels';

const CHAT_TABS_KEY = 'woc_chat_tabs';
const CHAT_ACTIVE_TAB_KEY = 'woc_chat_active_tab';

export interface ChatContextMenuPort {
  readonly element: HTMLElement;
  opener(): HTMLElement | null;
  setOpener(opener: HTMLElement | null): void;
  close(): void;
  place(
    element: HTMLElement,
    x: number,
    y: number,
    reserveRight: number,
    reserveBottom: number,
    minLeft?: number,
    minTop?: number,
  ): void;
  bind(onActivate: (action: string) => void): void;
}

export interface ChatWindowControllerDeps {
  document: Document;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  chatLog: HTMLElement;
  combatLog: HTMLElement;
  contextMenu: ChatContextMenuPort;
  sendChat(line: string): void;
  isMobileLayout(): boolean;
  itemDisplayName(itemId: string): string | null;
  questTitle(questId: string): string;
  selectedQuestId(): string | null;
  hasQuest(questId: string): boolean;
  showError(text: string): void;
}

/** Owns chat tabs, send-channel state, draft links, persistence, and their DOM wiring. */
export class ChatWindowController {
  private chatTabs: ChatOpenTab[] = [];
  private activeChatTab: ChatTabId = 'all';
  // The last target the player actually sent to (classic sticky-channel behavior):
  // a standing channel OR the whisper collector (a `/r` reply). On the All/combat
  // views a plain typed line goes here and the input is tinted to match; a
  // channel-bound tab always overrides it. `say` is the neutral default (no tint,
  // generic placeholder). Tracking whisper here is what keeps a reply conversation
  // going instead of snapping the input back to the previous standing channel.
  private stickyTarget: ChatInputTintTarget = 'say';
  private tabsWheelBound = false;
  private initialized = false;
  private pendingLinks: readonly { display: string; token: string }[] = [];

  constructor(private readonly deps: ChatWindowControllerDeps) {}

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    let savedTabs: string | null = null;
    let savedActive: string | null = null;
    try {
      savedTabs = this.deps.storage.getItem(CHAT_TABS_KEY);
      savedActive = this.deps.storage.getItem(CHAT_ACTIVE_TAB_KEY);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    this.chatTabs = parseChatTabs(savedTabs);
    this.activeChatTab =
      savedActive === 'all' ||
      savedActive === 'combat' ||
      (isChatOpenTab(savedActive) && this.chatTabs.includes(savedActive))
        ? (savedActive as ChatTabId)
        : 'all';
    for (const channel of this.chatTabs) {
      if (isChatTabChannel(channel) && channelNeedsJoin(channel)) {
        this.deps.sendChat(`/join ${channel}`);
      }
    }
    this.renderTabs();
    this.selectTab(this.activeChatTab, false);
  }

  syncTabsForInput(typed: string): void {
    const match = /^\/(join|leave)\b\s*(\S*)/i.exec(typed.trim());
    if (!match) return;
    const channel = match[2].toLowerCase();
    if (!isChatTabChannel(channel) || !channelNeedsJoin(channel)) return;
    if (match[1].toLowerCase() === 'join') this.addTab(channel, { join: false });
    else if (this.chatTabs.includes(channel)) this.removeTab(channel);
  }

  hideIfFiltered(element: HTMLElement, channel: string): void {
    const filter = this.filterTab();
    if (filter !== null && channel !== filter) element.classList.add('chat-hidden');
  }

  applyInputPresentation(): void {
    const input = this.deps.document.getElementById('chat-input') as
      | HTMLTextAreaElement
      | HTMLInputElement
      | null;
    if (input) this.presentInput(input);
  }

  // Remember the target a just-sent line reached as the sticky default for the next
  // chat open on the All tab: a standing channel, or `whisper` for a `/r` reply so a
  // whisper conversation keeps going. An explicit `/w Name`, emotes, rolls, channel
  // membership, and unknown commands leave the sticky target unchanged. `online`
  // disambiguates the one host-sensitive alias, bare `/g` (guild online, general
  // offline), so the sticky follows a guild send made with the classic command.
  noteSentChannel(sentLine: string, online: boolean): void {
    const target = sentLineTargetForHost(sentLine, { online });
    if (target) this.stickyTarget = target;
  }

  composeSend(typed: string): string {
    const withLinks = this.applyPendingLinks(typed);
    const target = this.effectiveSendTarget();
    if (target === WHISPER_TAB) return composeWhisperReply(withLinks);
    return composeChatLine(target, withLinks);
  }

  insertQuestLink(questId: string): void {
    this.insertLink(`[${this.deps.questTitle(questId)}]`, encodeQuestLink(questId));
  }

  insertItemLink(itemId: string): void {
    const displayName = this.deps.itemDisplayName(itemId);
    if (displayName === null) return;
    this.insertLink(`[${displayName}]`, encodeItemLink(itemId));
  }

  clearPendingLinks(): void {
    this.pendingLinks = [];
  }

  maybeHandleQuestShareCommand(raw: string): boolean {
    if (!/^\/share(?:\s|$)/i.test(raw.trim())) return false;
    const questId = this.deps.selectedQuestId();
    if (!questId || !this.deps.hasQuest(questId)) {
      this.deps.showError(t('hudChrome.questShare.noQuestSelected'));
      return true;
    }
    this.deps.sendChat(`/p ${encodeQuestLink(questId)}`);
    return true;
  }

  // Placeholder for the chat input reflecting the active tab and sticky target.
  activePlaceholder(): string {
    const target = this.effectiveSendTarget();
    // The whisper collector (its own tab, or a sticky `/r` reply) prompts "Whisper".
    if (target === WHISPER_TAB) {
      return t('hud.core.chatChannels.sendingTo', { channel: t(WHISPER_TAB_LABEL_KEY) });
    }
    // A channel-bound tab keeps its "Message {channel}" prompt (unchanged, incl. a
    // Say tab). On the All/combat views a non-say sticky channel surfaces the same
    // "Message {channel}" prompt so the player sees where plain text will go.
    const bound = this.sendChannel();
    if (bound !== null || target !== 'say') {
      return t('hud.core.chatChannels.sendingTo', {
        channel: t(CHANNEL_LABEL_KEYS[target]),
      });
    }
    return this.deps.isMobileLayout()
      ? t('hudChrome.mobile.chatPlaceholder')
      : t('hud.core.chatPlaceholder');
  }

  private persist(): void {
    try {
      this.deps.storage.setItem(CHAT_TABS_KEY, serializeChatTabs(this.chatTabs));
      this.deps.storage.setItem(CHAT_ACTIVE_TAB_KEY, this.activeChatTab);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private renderTabs(): void {
    const bar = this.requireElement('chatlog-tabs');
    if (!this.tabsWheelBound) {
      this.tabsWheelBound = true;
      bar.addEventListener(
        'wheel',
        (event) => {
          if (event.deltaY === 0 || bar.scrollWidth <= bar.clientWidth) return;
          event.preventDefault();
          bar.scrollLeft += event.deltaY;
        },
        { passive: false },
      );
    }
    bar.innerHTML = '';
    bar.setAttribute('role', 'tablist');
    const makeTab = (id: ChatTabId, label: string): HTMLButtonElement => {
      const button = this.deps.document.createElement('button');
      button.type = 'button';
      button.className = 'chat-tab';
      button.dataset.tab = id;
      button.setAttribute('role', 'tab');
      button.textContent = label;
      button.addEventListener('click', () => this.selectTab(id, true));
      return button;
    };
    bar.append(
      makeTab('all', t('hud.core.chatTab')),
      makeTab('combat', t('hud.core.combatLogTab')),
    );
    for (const channel of this.chatTabs) {
      const label = t(chatOpenTabLabelKey(channel));
      const button = makeTab(channel, label);
      button.title = t('hud.core.chatChannels.close', { channel: label });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.removeTab(channel);
      });
      bar.append(button);
    }
    const add = this.deps.document.createElement('button');
    add.type = 'button';
    add.className = 'chat-tab chat-tab-add';
    add.textContent = '+';
    add.setAttribute('aria-label', t('hud.core.chatChannels.add'));
    add.title = t('hud.core.chatChannels.add');
    add.addEventListener('click', () => {
      const menu = this.deps.contextMenu.element;
      if (menu.style.display === 'block' && this.deps.contextMenu.opener() === add) {
        this.deps.contextMenu.close();
        return;
      }
      const rect = add.getBoundingClientRect();
      this.openChannelMenu(rect.left, rect.bottom, add);
    });
    bar.append(add);
    this.updateActiveTabStyles();
  }

  private updateActiveTabStyles(): void {
    this.requireElement('chatlog-tabs')
      .querySelectorAll<HTMLButtonElement>('.chat-tab')
      .forEach((button) => {
        if (button.classList.contains('chat-tab-add')) return;
        const active = button.dataset.tab === this.activeChatTab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      });
  }

  private selectTab(tab: ChatTabId, persist = true): void {
    this.activeChatTab = tab;
    const showCombat = tab === 'combat';
    this.deps.chatLog.classList.toggle('active', !showCombat);
    this.deps.combatLog.classList.toggle('active', showCombat);
    if (!showCombat) this.applyFilter();
    this.updateActiveTabStyles();
    if (persist) this.persist();
    this.applyInputPresentation();
  }

  private addTab(channel: ChatOpenTab, options: { join?: boolean; select?: boolean } = {}): void {
    const { join = true, select = false } = options;
    if (!this.chatTabs.includes(channel)) {
      this.chatTabs.push(channel);
      if (join && isChatTabChannel(channel) && channelNeedsJoin(channel)) {
        this.deps.sendChat(`/join ${channel}`);
      }
      this.renderTabs();
      this.persist();
    }
    if (select) this.selectTab(channel, true);
  }

  private removeTab(channel: ChatOpenTab): void {
    const index = this.chatTabs.indexOf(channel);
    if (index < 0) return;
    this.chatTabs.splice(index, 1);
    if (this.activeChatTab === channel) this.activeChatTab = 'all';
    this.renderTabs();
    this.selectTab(this.activeChatTab, true);
  }

  private openChannelMenu(x: number, y: number, opener: HTMLElement): void {
    const menu = this.deps.contextMenu.element;
    this.deps.contextMenu.setOpener(opener);
    let html = `<div class="ctx-title">${esc(t('hud.core.chatChannels.addTitle'))}</div>`;
    const checkMark = ` ${String.fromCharCode(0x2713)}`;
    const item = (id: ChatOpenTab, labelKey: TranslationKey): string => {
      const open = this.chatTabs.includes(id);
      return `<div class="ctx-item" data-act="${id}">${esc(t(labelKey))}${open ? checkMark : ''}</div>`;
    };
    for (const channel of CHAT_TAB_CHANNELS) {
      html += item(channel, CHANNEL_LABEL_KEYS[channel]);
    }
    html += item(WHISPER_TAB, WHISPER_TAB_LABEL_KEY);
    html += `<div class="ctx-item" data-act="close">${esc(t('hud.chat.context.cancel'))}</div>`;
    menu.innerHTML = html;
    this.deps.contextMenu.place(menu, x, y, 170, 320, 0, 8);
    menu.style.display = 'block';
    this.deps.contextMenu.bind((action) => {
      if (!isChatOpenTab(action)) return;
      if (this.chatTabs.includes(action)) this.removeTab(action);
      else this.addTab(action, { select: action === WHISPER_TAB });
    });
  }

  private filterTab(): ChatOpenTab | null {
    return this.activeChatTab === 'all' || this.activeChatTab === 'combat'
      ? null
      : this.activeChatTab;
  }

  private sendChannel(): ChatTabChannel | null {
    const tab = this.filterTab();
    return tab !== null && isChatTabChannel(tab) ? tab : null;
  }

  // The target a plain typed line actually reaches, honoring the active tab and the
  // sticky "last used" target: the whisper collector wins on its own tab, else a
  // channel-bound tab wins (its bound channel), else the All/combat views fall back
  // to the sticky target (`say` by default, or `whisper` right after a reply).
  private effectiveSendTarget(): ChatInputTintTarget {
    if (this.activeChatTab === WHISPER_TAB) return WHISPER_TAB;
    return this.sendChannel() ?? this.stickyTarget;
  }

  // The target the chat input's tint should signal. chatInputTint maps `say` to no
  // tint (the default input color) and `whisper` to the whisper color.
  private inputTintTarget(): ChatInputTintTarget {
    return this.effectiveSendTarget();
  }

  private applyFilter(): void {
    const filter = this.filterTab();
    for (const child of Array.from(this.deps.chatLog.children)) {
      const element = child as HTMLElement;
      element.classList.toggle('chat-hidden', filter !== null && element.dataset.chan !== filter);
    }
    this.deps.chatLog.scrollTop = this.deps.chatLog.scrollHeight;
  }

  private presentInput(input: HTMLTextAreaElement | HTMLInputElement): void {
    input.placeholder = this.activePlaceholder();
    input.style.color = chatInputTint(this.inputTintTarget()) ?? '';
  }

  private insertLink(display: string, token: string): void {
    const input = this.requireElement('chat-input') as HTMLInputElement;
    this.pendingLinks = [...this.pendingLinks, { display, token }];
    this.presentInput(input);
    input.style.display = 'block';
    input.value =
      input.value && !input.value.endsWith(' ')
        ? `${input.value} ${display}`
        : `${input.value}${display}`;
    input.focus();
  }

  private applyPendingLinks(typed: string): string {
    if (this.pendingLinks.length === 0) return typed;
    const pending = this.pendingLinks;
    this.pendingLinks = [];
    let output = typed;
    for (const { display, token } of pending) output = output.replace(display, token);
    return output;
  }

  private requireElement(id: string): HTMLElement {
    const element = this.deps.document.getElementById(id);
    if (!element) throw new Error(`Missing chat element #${id}`);
    return element;
  }
}
