// Shared DOM leaf for bank-family status feedback: visible copy is present
// synchronously, while assistive-tech copy starts empty and is published only
// after mount. Callers retain status identity and decide whether it is current.

export interface BankStatusAnnouncementState {
  announcedText: string | null;
}

export interface BankStatusLineOptions {
  text: string;
  visibleClass: string;
  liveDataAttribute: `data-${string}`;
  isCurrent(): boolean;
}

export interface BankStatusLineNodes {
  visible: HTMLDivElement;
  live: HTMLSpanElement;
}

export function appendBankStatusLine(
  parent: HTMLElement,
  state: BankStatusAnnouncementState,
  options: BankStatusLineOptions,
): BankStatusLineNodes {
  const visible = document.createElement('div');
  visible.className = `bank-status ${options.visibleClass}`;
  visible.textContent = options.text;
  const live = document.createElement('span');
  live.className = 'visually-hidden';
  live.setAttribute(options.liveDataAttribute, '');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  parent.append(visible, live);
  if (state.announcedText !== options.text) {
    queueMicrotask(() => {
      if (!options.isCurrent() || !live.isConnected) return;
      live.textContent = options.text;
      state.announcedText = options.text;
    });
  }
  return { visible, live };
}
