// The Interface panel's bespoke rows: the chat timestamp pair, the chat-window
// reset, and the Unlock Interface action. Each is an ACTION or an async pair
// rather than a declarative GameSettings key, so none of them can ride
// applyControls; they are built here rather than as more method clusters on the
// options painter, which is at its line ceiling
// (tests/monolith_budget.test.ts).

import { audio } from '../game/audio';
import type { ChatClock } from './hud/chat/chat_timestamp';
import { t } from './i18n';
import { interfaceUnlockLabelKey } from './interface_unlock_core';

/** The chat display seam. OptionsWindowDeps satisfies it structurally. */
export interface ChatRowDeps {
  getChatTimestamps(): boolean;
  setChatTimestamps(on: boolean): void;
  getChatClock(): ChatClock;
  setChatClock(clock: ChatClock): void;
  resetChatWindow(): void;
}

/** The frame-editing seam. OptionsWindowDeps satisfies it structurally. */
export interface InterfaceUnlockRowDeps {
  isInterfaceUnlocked(): boolean;
  toggleInterfaceUnlock(): boolean;
}

export function buildChatTimestampRows(body: HTMLElement, deps: ChatRowDeps): void {
  const tsRow = document.createElement('div');
  tsRow.className = 'set-row ui-stat-row';
  const tsName = document.createElement('span');
  tsName.className = 'set-name';
  tsName.textContent = t('hudChrome.chatTimestamps.show');
  const tsToggle = document.createElement('button');
  tsToggle.className = 'btn ui-btn ui-btn--plate set-toggle';

  const fmtRow = document.createElement('div');
  fmtRow.className = 'set-row ui-stat-row';
  const fmtName = document.createElement('span');
  fmtName.className = 'set-name';
  fmtName.textContent = t('hudChrome.chatTimestamps.format');
  const seg = document.createElement('div');
  seg.className = 'set-seg ui-seg';
  const btn12 = document.createElement('button');
  btn12.className = 'btn ui-seg-tab set-seg-btn';
  btn12.textContent = t('hudChrome.chatTimestamps.clock12h');
  const btn24 = document.createElement('button');
  btn24.className = 'btn ui-seg-tab set-seg-btn';
  btn24.textContent = t('hudChrome.chatTimestamps.clock24h');
  seg.append(btn12, btn24);
  fmtRow.append(fmtName, seg);

  const sync = () => {
    const on = deps.getChatTimestamps();
    tsToggle.textContent = on ? t('hud.options.on') : t('hud.options.off');
    tsToggle.classList.toggle('off', !on);
    tsToggle.classList.toggle('is-off', !on);
    tsToggle.setAttribute('aria-pressed', String(on));
    btn12.classList.toggle('active', deps.getChatClock() === '12h');
    btn24.classList.toggle('active', deps.getChatClock() === '24h');
    btn12.classList.toggle('is-on', deps.getChatClock() === '12h');
    btn24.classList.toggle('is-on', deps.getChatClock() === '24h');
    fmtRow.classList.toggle('disabled', !on);
    btn12.disabled = !on;
    btn24.disabled = !on;
  };
  sync();

  tsToggle.addEventListener('click', () => {
    audio.click();
    deps.setChatTimestamps(!deps.getChatTimestamps());
    sync();
  });
  const setClock = (clock: ChatClock) => {
    if (!deps.getChatTimestamps()) return;
    audio.click();
    deps.setChatClock(clock);
    sync();
  };
  btn12.addEventListener('click', () => setClock('12h'));
  btn24.addEventListener('click', () => setClock('24h'));

  tsRow.append(tsName, tsToggle);
  body.append(tsRow, fmtRow);
}

// Reset the movable/resizable chat window back to its default placement. Chat tab.
export function buildChatWindowResetRow(body: HTMLElement, deps: ChatRowDeps): void {
  const resetRow = document.createElement('div');
  resetRow.className = 'set-row ui-stat-row';
  const resetName = document.createElement('span');
  resetName.className = 'set-name';
  resetName.textContent = t('hudChrome.chatWindow.reset');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn ui-btn ui-btn--plate set-toggle';
  resetBtn.textContent = t('hudChrome.chatWindow.resetAction');
  resetBtn.addEventListener('click', () => {
    audio.click();
    deps.resetChatWindow();
  });
  resetRow.append(resetName, resetBtn);
  body.append(resetRow);
}

// Reset the movable player + target unit frames back to their stock spots
// (forgets the saved drag positions and re-docks the player frame). Frames tab.

// "Unlock interface": one press loosens every movable HUD frame (the three
// action bars, the cast bar, the menu rail, the minimap and the player / pet
// frames) so they can be dragged and scaled, and the button relabels itself to
// "Lock interface" while they are loose. An action rather than a stored
// setting, so it is a bespoke row rather than a boolToggle: the unlocked state
// deliberately does not survive a reload (a frame always loads locked, the
// same rule the per-frame corner buttons have always followed). Combat tab,
// rendered directly above Auto-Attack on Ability Use.
export function buildInterfaceUnlockRow(body: HTMLElement, deps: InterfaceUnlockRowDeps): void {
  const row = document.createElement('div');
  row.className = 'set-row ui-stat-row';
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = t('hudChrome.interfaceUnlock.label');
  const btn = document.createElement('button');
  btn.className = 'btn ui-btn ui-btn--plate set-toggle';
  const sync = (unlocked: boolean) => {
    btn.textContent = t(interfaceUnlockLabelKey(unlocked));
    btn.setAttribute('aria-pressed', String(unlocked));
    btn.classList.toggle('active', unlocked);
    btn.classList.toggle('is-on', unlocked);
  };
  sync(deps.isInterfaceUnlocked());
  btn.addEventListener('click', () => {
    audio.click();
    sync(deps.toggleInterfaceUnlock());
  });
  row.append(name, btn);
  body.append(row);
  // One guidance note going in: the freeze while editing is deliberate
  // rather than a hang. (The action-bars note was retired, owner request:
  // the Frames Settings menu now lists bar 2/3 in both shapes, so the
  // plus/minus preamble no longer needs explaining here.)
  const note = document.createElement('div');
  note.className = 'set-note';
  note.textContent = t('hudChrome.interfaceUnlock.frozenNote');
  body.appendChild(note);
}
