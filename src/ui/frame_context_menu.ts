import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import { getUiScale } from './ui_scale';

export interface FrameContextAction {
  labelKey: TranslationKey;
  run(): void;
}

export interface FrameContextTarget {
  id: string;
  element: HTMLElement;
  label(): string;
  isActive(): boolean;
  resetSize(): void;
  hide?(): void;
  visibility?: { value(): boolean; set(visible: boolean): void };
  actions?(): readonly FrameContextAction[];
}

/** Edit-mode capture wins over unit social menus without changing normal play. */
export class FrameContextMenu {
  private root: HTMLElement | null = null;
  private opener: HTMLElement | null = null;
  constructor(
    private readonly deps: {
      document: Document;
      targets(): readonly FrameContextTarget[];
      unlocked(): boolean;
      options(id: string): void;
    },
  ) {
    const doc = deps.document;
    doc.addEventListener('contextmenu', (event) => this.handle(event), true);
    doc.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.root) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.close(true);
        } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          this.handle(event);
      },
      true,
    );
    doc.addEventListener(
      'pointerdown',
      (event) => {
        if (this.root && !this.root.contains(event.target as Node)) this.close(false);
      },
      true,
    );
  }
  private handle(event: MouseEvent | KeyboardEvent): void {
    const entry = event
      .composedPath()
      .map((node) =>
        this.deps.targets().find((candidate) => candidate.isActive() && candidate.element === node),
      )
      .find(Boolean);
    if (!entry || (!this.deps.unlocked() && !entry.actions?.().length)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const frame = entry.element;
    const rect = frame.getBoundingClientRect();
    const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
    this.open(entry, pointer ? event.clientX : rect.left, pointer ? event.clientY : rect.bottom);
  }
  private open(entry: FrameContextTarget, x: number, y: number): void {
    this.close(false);
    const doc = this.deps.document;
    this.opener =
      entry.element.querySelector<HTMLElement>('.tf-move-btn, .focus-unit') ?? entry.element;
    const root = doc.createElement('div');
    root.id = 'frame-context-menu';
    root.className = 'panel frame-context-menu';
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', entry.label());
    const actions: Array<readonly [string, () => void]> = this.deps.unlocked()
      ? [
          [t('hudChrome.interfaceUnlock.resetFrameSize'), () => entry.resetSize()],
          [t('hudChrome.frameMenus.options'), () => this.deps.options(entry.id)],
        ]
      : [];
    if (this.deps.unlocked() && entry.hide)
      actions.push([t('hudChrome.frameMenus.hide'), entry.hide]);
    for (const action of entry.actions?.() ?? []) actions.push([t(action.labelKey), action.run]);
    for (const [label, action] of actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.addEventListener('click', () => {
        this.close(true);
        action();
      });
      root.appendChild(button);
    }
    root.addEventListener('keydown', (event) => {
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowUp' || event.shiftKey ? -1 : 1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }
    });
    doc.getElementById('ui')?.appendChild(root);
    this.root = root;
    const scale = getUiScale();
    const width = root.getBoundingClientRect().width;
    const height = root.getBoundingClientRect().height;
    const view = doc.defaultView;
    root.style.left =
      Math.max(0, Math.min(x, (view?.innerWidth ?? x + width) - width - 8)) / scale + 'px';
    root.style.top =
      Math.max(0, Math.min(y, (view?.innerHeight ?? y + height) - height - 8)) / scale + 'px';
    root.querySelector<HTMLElement>('button')?.focus();
  }
  close(restoreFocus = false): void {
    this.root?.remove();
    this.root = null;
    if (restoreFocus && this.opener?.isConnected) this.opener.focus();
    this.opener = null;
  }
}
