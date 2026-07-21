// Interactive autocomplete for the in-game "!" community commands (LFG / trade /
// recruit / event / help). Appears above the chat input while the player is
// typing a "!" command word, with keyboard + click selection. Self-contained: it
// owns its own DOM and is driven by main.ts's chat input handlers. The command
// set is the shared pure catalog (src/sim/discord_relay.ts); display text is
// localized here through t().
import { isRelayInput, matchRelayCommands, type RelayCommand } from '../sim/discord_relay';
import { esc } from './esc';
import { type TranslationKey, t } from './i18n';

// Localized label/hint per command id (the catalog keeps English for the Discord
// embed; the in-game dropdown is localized).
const RELAY_TEXT: Record<string, { label: TranslationKey; hint: TranslationKey }> = {
  lfg: { label: 'hudChrome.discord.relay.lfg.label', hint: 'hudChrome.discord.relay.lfg.hint' },
  wts: { label: 'hudChrome.discord.relay.wts.label', hint: 'hudChrome.discord.relay.wts.hint' },
  wtb: { label: 'hudChrome.discord.relay.wtb.label', hint: 'hudChrome.discord.relay.wtb.hint' },
  recruit: {
    label: 'hudChrome.discord.relay.recruit.label',
    hint: 'hudChrome.discord.relay.recruit.hint',
  },
  event: {
    label: 'hudChrome.discord.relay.event.label',
    hint: 'hudChrome.discord.relay.event.hint',
  },
  help: { label: 'hudChrome.discord.relay.help.label', hint: 'hudChrome.discord.relay.help.hint' },
};

function labelOf(c: RelayCommand): string {
  return RELAY_TEXT[c.id] ? t(RELAY_TEXT[c.id].label) : c.label;
}
function hintOf(c: RelayCommand): string {
  return RELAY_TEXT[c.id] ? t(RELAY_TEXT[c.id].hint) : c.hint;
}

export class ChatCommandMenu {
  private el: HTMLDivElement;
  private items: RelayCommand[] = [];
  private active = 0;
  private visible = false;

  constructor(
    private input: HTMLTextAreaElement,
    private onPick: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'chat-cmd-menu';
    this.el.setAttribute('role', 'listbox');
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    // mousedown (not click) so the input does not blur before we select.
    this.el.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
      if (row) {
        e.preventDefault();
        this.select(Number(row.dataset.idx));
      }
    });
  }

  /** Recompute + show/hide based on the current input value. */
  update(value: string): void {
    // Only while still typing the command WORD (no space yet); once a space is
    // typed the command is chosen and the player is writing the message.
    if (!isRelayInput(value) || !/^\s*![a-zA-Z]*$/.test(value)) {
      this.hide();
      return;
    }
    const after = value.replace(/^\s*!/, '');
    this.items = matchRelayCommands(after);
    if (!this.items.length) {
      this.hide();
      return;
    }
    if (this.active >= this.items.length) this.active = 0;
    this.render();
    this.position();
    this.el.style.display = 'block';
    this.visible = true;
  }

  /** Handle a keydown while open; returns true if it consumed the key. */
  onKeydown(e: KeyboardEvent): boolean {
    if (!this.visible || !this.items.length) return false;
    if (e.key === 'ArrowDown') {
      this.active = (this.active + 1) % this.items.length;
      this.render();
      return true;
    }
    if (e.key === 'ArrowUp') {
      this.active = (this.active - 1 + this.items.length) % this.items.length;
      this.render();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      this.select(this.active);
      return true;
    }
    if (e.key === 'Escape') {
      this.hide();
      return true;
    }
    return false;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.display = 'none';
  }

  get isOpen(): boolean {
    return this.visible;
  }

  private select(i: number): void {
    const cmd = this.items[i];
    if (!cmd) return;
    this.input.value = `!${cmd.id} `;
    this.hide();
    this.onPick();
  }

  private position(): void {
    const r = this.input.getBoundingClientRect();
    this.el.style.left = `${Math.round(r.left)}px`;
    this.el.style.width = `${Math.round(r.width)}px`;
    this.el.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  }

  private render(): void {
    this.el.innerHTML = this.items
      .map(
        (c, i) =>
          `<div class="chat-cmd-row${i === this.active ? ' on' : ''}" role="option" aria-selected="${i === this.active}" data-idx="${i}">` +
          `<span class="chat-cmd-id">!${esc(c.id)}</span>` +
          `<span class="chat-cmd-label">${esc(labelOf(c))}</span>` +
          `<span class="chat-cmd-hint">${esc(hintOf(c))}</span>` +
          `</div>`,
      )
      .join('');
  }
}
