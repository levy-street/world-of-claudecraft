// The couch co-op join overlay: opened when an unassigned controller presses
// Start (or the keyboard join key). It is fully pad-navigable (D-pad moves the
// selection, the bottom face button confirms, the right face button cancels)
// and also pointer-clickable, so a parent can set a child up with the mouse.
//
// Three flows, chosen by the host's mode:
//   offline            -> pick one of the nine classes (a fresh session hero)
//   online, same acct  -> pick one of the account's OTHER characters
//   online, diff acct  -> a small sign-in, then that account's characters
//
// The overlay only gathers the CHOICE; the host turns it into a live co-op
// player (Sim.addPlayer offline, a secondary ClientWorld online). All copy is
// t()-keyed under the `coop` namespace.

import type { PlayerClass } from '../sim/types';
import { GP } from '../game/gamepad_map';
import { t } from './i18n';

export interface CoopCharacterRef {
  id: number;
  name: string;
  cls: PlayerClass;
}

export type CoopJoinChoice =
  | { kind: 'offline'; cls: PlayerClass; name: string }
  | { kind: 'online'; character: CoopCharacterRef; token: string | null; base: string | null };

export interface CoopOverlayDeps {
  mode: 'offline' | 'online';
  // The nine class ids in display order (offline flow).
  classes: readonly PlayerClass[];
  // Localized class display name, e.g. t('classes.warrior').
  classLabel: (cls: PlayerClass) => string;
  // Online, same account: the account's characters other than Player 1's.
  sameAccountCharacters?: () => CoopCharacterRef[];
  // Online, separate account: sign in and return that account's roster + a
  // token/base the host uses to open the secondary session.
  loginSeparate?: (
    username: string,
    password: string,
  ) => Promise<{ token: string; base: string; characters: CoopCharacterRef[] }>;
  // Online: create a brand-new character (on Player 1's account when token is
  // null, else on the signed-in separate account) and return its ref so the
  // joiner can enter the world as it immediately.
  createCharacter?: (
    name: string,
    cls: PlayerClass,
    token: string | null,
    base: string | null,
  ) => Promise<CoopCharacterRef>;
}

type Step = 'account' | 'class' | 'name' | 'character' | 'login' | 'create';
type FlowState = 'idle' | 'loading';

const OVERLAY_ID = 'coop-join-overlay';
const STYLE_ID = 'coop-join-overlay-styles';

// Self-contained styling injected once, so the overlay needs no entry in the
// @layer CSS build. Scoped under the overlay id/classes; touch-target and
// font-size floors follow src/ui/CLAUDE.md (>=40px targets, >=16px inputs).
function ensureCoopOverlayStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  .coop-join-panel {
    display: flex; flex-direction: column; gap: 14px;
    min-width: min(520px, 92vw); max-width: 92vw; max-height: 88vh; overflow-y: auto;
    padding: 24px; border-radius: 12px;
    background: rgba(18, 16, 26, 0.96); border: 1px solid rgba(255, 209, 0, 0.4);
    color: #f4f1e8; text-align: center;
  }
  .coop-join-panel h2 { margin: 0; font-size: 22px; color: #ffd100; }
  .coop-join-panel p { margin: 0; font-size: 16px; opacity: 0.85; }
  .coop-option-grid { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  .coop-join-panel button {
    min-height: 44px; min-width: 44px; padding: 10px 16px; font-size: 16px;
    border-radius: 8px; cursor: pointer;
    background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.25);
    color: inherit;
  }
  .coop-option { flex: 1 1 30%; }
  .coop-join-panel button:hover { background: rgba(255, 209, 0, 0.18); }
  .coop-option-selected, .coop-join-panel button:focus-visible {
    outline: 3px solid #ffd100; outline-offset: 2px; background: rgba(255, 209, 0, 0.22);
  }
  .coop-cancel { align-self: center; background: rgba(255, 90, 90, 0.14); }
  .coop-login-form { display: flex; flex-direction: column; gap: 10px; }
  .coop-login-form input {
    min-height: 44px; padding: 10px 12px; font-size: 16px; border-radius: 8px;
    background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.25); color: inherit;
  }
  .coop-login-error { color: #ff8a8a; }
  .coop-empty { opacity: 0.7; }
  .coop-create { flex-basis: 100%; background: rgba(255, 209, 0, 0.14); }
  .coop-create-name {
    min-height: 44px; padding: 10px 12px; font-size: 16px; border-radius: 8px;
    background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.25); color: inherit;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) { .coop-join-panel * { transition: none !important; } }
  `;
  document.head.appendChild(style);
}

export class CoopOverlay {
  private root: HTMLDivElement | null = null;
  private slot = 0;
  private step: Step = 'class';
  private selectedIndex = 0;
  private options: HTMLButtonElement[] = [];
  private roster: CoopCharacterRef[] = [];
  private onConfirm: ((choice: CoopJoinChoice) => void) | null = null;
  private onCancel: (() => void) | null = null;
  // Filled during the separate-account flow.
  private sepToken: string | null = null;
  private sepBase: string | null = null;
  private flowState: FlowState = 'idle';
  private pendingName = '';

  get isOpen(): boolean {
    return this.root !== null;
  }

  get openSlot(): number {
    return this.isOpen ? this.slot : 0;
  }

  constructor(private readonly deps: CoopOverlayDeps) {}

  open(
    slot: number,
    onConfirm: (choice: CoopJoinChoice) => void,
    onCancel: () => void,
  ): void {
    ensureCoopOverlayStyles();
    this.close();
    this.slot = slot;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.sepToken = null;
    this.sepBase = null;
    this.root = document.createElement('div');
    this.root.id = OVERLAY_ID;
    this.root.className = 'fatal-overlay coop-join-overlay';
    document.body.appendChild(this.root);
    // Keyboard navigation: Arrow keys, Enter, Escape for keyboard-only joins.
    this.root.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.moveSelection(-1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.activateSelection();
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        // Don't back out when the user is typing in an input field.
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        this.cancel();
      }
    });
    // Online starts with the account step; offline goes straight to class pick.
    this.step = this.deps.mode === 'online' ? 'account' : 'class';
    this.render();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.options = [];
    this.onConfirm = null;
    this.onCancel = null;
  }

  /** Drive the overlay from a joining pad's rising button edges. */
  padInput(edges: readonly number[]): void {
    if (!this.isOpen) return;
    for (const b of edges) {
      if (b === GP.DPAD_DOWN || b === GP.DPAD_RIGHT) this.moveSelection(1);
      else if (b === GP.DPAD_UP || b === GP.DPAD_LEFT) this.moveSelection(-1);
      else if (b === GP.A) this.activateSelection();
      else if (b === GP.B) this.cancel();
    }
  }

  private moveSelection(delta: number): void {
    if (this.options.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.options.length) % this.options.length;
    this.highlight();
  }

  private highlight(): void {
    this.options.forEach((el, i) => {
      el.classList.toggle('coop-option-selected', i === this.selectedIndex);
      if (i === this.selectedIndex) el.focus({ preventScroll: true });
    });
  }

  private activateSelection(): void {
    this.options[this.selectedIndex]?.click();
  }

  private cancel(): void {
    // Back navigation: go to the previous step instead of closing entirely.
    if (this.step === 'account') {
      // At the root: close the overlay.
      const cb = this.onCancel;
      this.close();
      cb?.();
      return;
    }
    if (this.step === 'class') {
      // Back from class pick: go to account step (online) or close (offline).
      if (this.deps.mode === 'online') {
        this.step = 'account';
      } else {
        const cb = this.onCancel;
        this.close();
        cb?.();
        return;
      }
    } else if (this.step === 'name') {
      this.step = 'class';
    } else if (this.step === 'character' || this.step === 'create') {
      this.step = this.deps.mode === 'online' ? 'account' : 'class';
    } else if (this.step === 'login') {
      this.step = 'account';
    }
    this.render();
  }

  private confirm(choice: CoopJoinChoice): void {
    const cb = this.onConfirm;
    this.close();
    cb?.(choice);
  }

  // --- rendering -------------------------------------------------------------

  private render(): void {
    if (!this.root) return;
    this.root.replaceChildren();
    this.options = [];
    this.selectedIndex = 0;
    this.flowState = 'idle';

    const panel = document.createElement('div');
    panel.className = 'coop-join-panel';
    const title = document.createElement('h2');
    title.textContent = t('coop.joinTitle', { slot: String(this.slot) });
    panel.appendChild(title);

    if (this.step === 'account') this.renderAccountStep(panel);
    else if (this.step === 'class') this.renderClassStep(panel);
    else if (this.step === 'name') this.renderNameStep(panel);
    else if (this.step === 'character') this.renderCharacterStep(panel);
    else if (this.step === 'login') this.renderLoginStep(panel);
    else if (this.step === 'create') this.renderCreateStep(panel);

    const cancel = this.makeButton(t('coop.joinCancel'), () => this.cancel());
    cancel.classList.add('coop-cancel');
    panel.appendChild(cancel);

    this.root.appendChild(panel);
    this.highlight();
  }

  private renderAccountStep(panel: HTMLElement): void {
    const label = document.createElement('p');
    label.textContent = t('coop.pickCharacter');
    panel.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'coop-option-grid';
    grid.appendChild(
      this.makeOption(t('coop.accountThis'), () => {
        this.step = 'character';
        this.roster = this.deps.sameAccountCharacters?.() ?? [];
        this.render();
      }),
    );
    grid.appendChild(
      this.makeOption(t('coop.accountOther'), () => {
        this.step = 'login';
        this.render();
      }),
    );
    panel.appendChild(grid);
  }

  private renderClassStep(panel: HTMLElement): void {
    const label = document.createElement('p');
    label.textContent = t('coop.pickClass');
    panel.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'coop-option-grid';
    for (const cls of this.deps.classes) {
      grid.appendChild(
        this.makeOption(this.deps.classLabel(cls), () => {
          // Offline: go to name-entry step so the player can customize their
          // name before joining. Online (create flow): go straight to create.
          if (this.deps.mode === 'offline') {
            this.pendingName = `${this.deps.classLabel(cls)} ${this.slot}`;
            this.step = 'name';
            this.render();
          } else {
            this.confirm({ kind: 'offline', cls, name: `${this.deps.classLabel(cls)} ${this.slot}` });
          }
        }),
      );
    }
    panel.appendChild(grid);
  }

  private renderNameStep(panel: HTMLElement): void {
    const label = document.createElement('p');
    label.textContent = t('coop.createTitle');
    panel.appendChild(label);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 24;
    nameInput.value = this.pendingName;
    nameInput.placeholder = t('coop.createName');
    nameInput.setAttribute('aria-label', t('coop.createName'));
    nameInput.className = 'coop-create-name';
    // Submit on Enter in the name field.
    nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinBtn.click();
      }
    });
    panel.appendChild(nameInput);
    const joinBtn = this.makeButton(t('coop.joinConfirm'), () => {
      const nm = nameInput.value.trim() || this.pendingName;
      // Find the class from the pendingName pattern: "ClassName N"
      const clsMatch = this.deps.classes.find(
        (c) => this.deps.classLabel(c) === this.pendingName.split(' ').slice(0, -1).join(' ')
      );
      const cls = clsMatch ?? this.deps.classes[0];
      this.confirm({ kind: 'offline', cls, name: nm });
    });
    joinBtn.classList.add('coop-option');
    joinBtn.style.marginTop = '10px';
    panel.appendChild(joinBtn);
    // Register the name input and join button as navigable options for pad input.
    this.options = [joinBtn as unknown as HTMLButtonElement];
    // Focus the name input so the user can start typing immediately.
    setTimeout(() => nameInput.focus(), 50);
  }
  private renderCharacterStep(panel: HTMLElement): void {
    const label = document.createElement('p');
    label.textContent = t('coop.pickCharacter');
    panel.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'coop-option-grid';
    // Make a brand-new character on this account (family play: a kid creates
    // their own hero under the parent's login), offered first.
    if (this.deps.createCharacter) {
      const create = this.makeOption(`+ ${t('coop.createCharacter')}`, () => {
        this.step = 'create';
        this.render();
      });
      create.classList.add('coop-create');
      grid.appendChild(create);
    }
    for (const ch of this.roster) {
      grid.appendChild(
        this.makeOption(`${ch.name} (${this.deps.classLabel(ch.cls)})`, () => {
          this.confirm({
            kind: 'online',
            character: ch,
            token: this.sepToken,
            base: this.sepBase,
          });
        }),
      );
    }
    panel.appendChild(grid);
    if (this.roster.length === 0 && !this.deps.createCharacter) {
      const empty = document.createElement('p');
      empty.className = 'coop-empty';
      empty.textContent = t('coop.noOtherCharacters');
      panel.appendChild(empty);
    }
  }

  private renderCreateStep(panel: HTMLElement): void {
    const label = document.createElement('p');
    label.textContent = t('coop.createTitle');
    panel.appendChild(label);
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 24;
    name.placeholder = t('coop.createName');
    name.setAttribute('aria-label', t('coop.createName'));
    name.className = 'coop-create-name';
    panel.appendChild(name);
    const error = document.createElement('p');
    error.className = 'coop-login-error';
    error.hidden = true;
    panel.appendChild(error);
    const grid = document.createElement('div');
    grid.className = 'coop-option-grid';
    // Pick the class; a click creates the character and joins as it.
    for (const cls of this.deps.classes) {
      const btn = this.makeOption(this.deps.classLabel(cls), () => {
        const nm = name.value.trim() || `${this.deps.classLabel(cls)} ${this.slot}`;
        error.hidden = true;
        this.flowState = 'loading';
        for (const o of this.options) o.disabled = true;
        btn.textContent = `${this.deps.classLabel(cls)}...`;
        void this.deps
          .createCharacter?.(nm, cls, this.sepToken, this.sepBase)
          .then((character) => {
            this.confirm({ kind: 'online', character, token: this.sepToken, base: this.sepBase });
          })
          .catch(() => {
            error.textContent = t('coop.createError');
            error.hidden = false;
            for (const o of this.options) o.disabled = false;
          });
      });
      grid.appendChild(btn);
    }
    panel.appendChild(grid);
  }

  private renderLoginStep(panel: HTMLElement): void {
    const label = document.createElement('p');
    label.textContent = t('coop.loginTitle', { slot: String(this.slot) });
    panel.appendChild(label);
    const form = document.createElement('form');
    form.className = 'coop-login-form';
    const user = document.createElement('input');
    user.type = 'text';
    user.autocomplete = 'username';
    user.placeholder = t('coop.loginUser');
    user.setAttribute('aria-label', t('coop.loginUser'));
    const pass = document.createElement('input');
    pass.type = 'password';
    pass.autocomplete = 'current-password';
    pass.placeholder = t('coop.loginPass');
    pass.setAttribute('aria-label', t('coop.loginPass'));
    const error = document.createElement('p');
    error.className = 'coop-login-error';
    error.hidden = true;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'coop-option';
    submit.textContent = t('coop.loginSubmit');
    form.append(user, pass, error, submit);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      error.hidden = true;
      this.flowState = 'loading';
      submit.disabled = true;
      submit.textContent = t('coop.loggingIn') || 'Signing in...';
      void this.deps
        .loginSeparate?.(user.value, pass.value)
        .then((res) => {
          this.sepToken = res.token;
          this.sepBase = res.base;
          this.roster = res.characters;
          this.step = 'character';
          this.render();
        })
        .catch(() => {
          error.textContent = t('coop.loginError');
          error.hidden = false;
          submit.disabled = false;
        });
    });
    panel.appendChild(form);
    // The text inputs are the interactive elements here; the pad's confirm
    // targets the submit button, so register it as the single "option".
    this.options = [submit as unknown as HTMLButtonElement];
  }

  private makeOption(label: string, onClick: () => void): HTMLButtonElement {
    const btn = this.makeButton(label, onClick);
    btn.classList.add('coop-option');
    this.options.push(btn);
    return btn;
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }
}
