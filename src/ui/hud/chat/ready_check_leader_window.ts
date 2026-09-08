// ReadyCheckLeaderWindow (src/ui/hud/chat/ready_check_leader_window.ts):
// A compact, square HUD window for the party/raid leader during a ready check.
// Displays each party member's name in a clean list:
// - Green check if they answered ready
// - Red cross if they answered not ready
// - Nothing if they have not answered yet ("si no ha respondido que no salga nada")
// Automatically dismisses 4 seconds after the check finalizes or when closed.

import type { ReadyCheckMemberResponse } from '../../../sim/types';
import { svgIcon } from '../../ui_icons';

export const READY_CHECK_AUTO_CLOSE_MS = 4000;

export class ReadyCheckLeaderWindow {
  private closeTimer: number | null = null;

  constructor(private readonly el: HTMLElement) {
    this.bindEvents();
  }

  private bindEvents(): void {
    const closeBtn = this.el.querySelector('.rck-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }
  }

  show(): void {
    this.el.hidden = false;
    this.el.style.removeProperty('display');
  }

  hide(): void {
    this.el.hidden = true;
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  update(ev: { responses: ReadyCheckMemberResponse[]; done: boolean }): void {
    this.show();
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    const rosterEl = this.el.querySelector('.rck-roster');
    if (rosterEl) {
      rosterEl.replaceChildren();
      for (const m of ev.responses) {
        const row = document.createElement('div');
        row.className = 'rck-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'rck-name';
        nameSpan.textContent = m.name;

        const statusSpan = document.createElement('span');
        statusSpan.className = 'rck-status';
        if (m.state === 'ready') {
          statusSpan.classList.add('rck-yes');
          statusSpan.innerHTML = svgIcon('check');
        } else if (m.state === 'notready') {
          statusSpan.classList.add('rck-no');
          statusSpan.innerHTML = svgIcon('close');
        } else {
          // Unanswered / pending: show nothing ("si no ha respondido que no salga nada")
          statusSpan.textContent = '';
        }

        row.append(nameSpan, statusSpan);
        rosterEl.appendChild(row);
      }
    }

    const statusLine = this.el.querySelector('.rck-status-line');
    if (statusLine) {
      if (ev.done) {
        const readyCount = ev.responses.filter((r) => r.state === 'ready').length;
        statusLine.textContent = `Ready: ${readyCount}/${ev.responses.length}`;
        this.closeTimer = setTimeout(
          () => this.hide(),
          READY_CHECK_AUTO_CLOSE_MS,
        ) as unknown as number;
      } else {
        statusLine.textContent = 'Waiting for responses...';
      }
    }
  }
}
