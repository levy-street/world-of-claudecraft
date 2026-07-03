// Editor notifications + modal dialogs: a small toast stack (polite live region),
// a confirm dialog for destructive actions, and a one-field prompt (Save As).
// Self-contained DOM; the app composes one instance. All copy arrives already
// localized (the callers pass t() output).

import { t } from '../ui/i18n';
import { button, el } from './dom';

const TOAST_LIFE_MS = 4200;
const TOAST_CAP = 4;

export type ToastKind = 'info' | 'success' | 'error';

export class Toasts {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ed-toasts');
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', t('editor.a11y.toasts'));
    parent.appendChild(this.root);
  }

  show(message: string, kind: ToastKind = 'info'): void {
    while (this.root.children.length >= TOAST_CAP) this.root.firstChild?.remove();
    const node = el('div', `ed-toast ed-toast-${kind}`, message);
    this.root.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('ed-toast-out');
      window.setTimeout(() => node.remove(), 300);
    }, TOAST_LIFE_MS);
  }

  info(message: string): void {
    this.show(message, 'info');
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error');
  }
}

export interface ConfirmOptions {
  title: string;
  body: string;
  /** Confirm button label; defaults to the localized OK. */
  confirmLabel?: string;
  danger?: boolean;
}

interface ModalHandles {
  overlay: HTMLElement;
  panel: HTMLElement;
  close(): void;
}

function buildModal(parent: HTMLElement, title: string, onClose: () => void): ModalHandles {
  const overlay = el('div', 'ed-modal-overlay');
  const panel = el('div', 'ed-modal');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
  panel.appendChild(el('h2', 'ed-modal-title', title));
  overlay.appendChild(panel);
  parent.appendChild(overlay);
  const close = (): void => {
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
    onClose();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', (ev) => {
    if (ev.target === overlay) close();
  });
  return { overlay, panel, close };
}

/** In-app confirm; resolves true on confirm, false on cancel/dismiss. */
export function confirmDialog(parent: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const modal = buildModal(parent, opts.title, () => settle(false));
    modal.panel.appendChild(el('p', 'ed-modal-body', opts.body));
    const row = el('div', 'ed-modal-actions');
    const cancel = button(t('editor.confirm.cancel'), () => {
      settle(false);
      modal.close();
    });
    const ok = button(
      opts.confirmLabel ?? t('editor.confirm.ok'),
      () => {
        settle(true);
        modal.close();
      },
      opts.danger ? 'danger' : 'primary',
    );
    row.append(cancel, ok);
    modal.panel.appendChild(row);
    ok.focus();
  });
}

/** One-field text prompt; resolves the trimmed value, or null on cancel. */
export function promptDialog(
  parent: HTMLElement,
  title: string,
  label: string,
  initial: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const modal = buildModal(parent, title, () => settle(null));
    const field = el('label', 'ed-modal-field');
    field.appendChild(el('span', undefined, label));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    input.maxLength = 60;
    field.appendChild(input);
    modal.panel.appendChild(field);
    const row = el('div', 'ed-modal-actions');
    const cancel = button(t('editor.confirm.cancel'), () => {
      settle(null);
      modal.close();
    });
    const ok = button(
      t('editor.confirm.ok'),
      () => {
        settle(input.value.trim() || null);
        modal.close();
      },
      'primary',
    );
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') ok.click();
    });
    row.append(cancel, ok);
    modal.panel.appendChild(row);
    input.focus();
    input.select();
  });
}
