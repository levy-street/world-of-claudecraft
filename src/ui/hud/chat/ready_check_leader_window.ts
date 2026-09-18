// ReadyCheckLeaderWindow (src/ui/hud/chat/ready_check_leader_window.ts):
// A compact, square HUD window for the party/raid leader during a ready check.
// Displays each party member's name in a clean list:
// - Green check if they answered ready
// - Red cross if they answered not ready
// - Nothing if they have not answered yet ("si no ha respondido que no salga nada")
// Automatically dismisses 4 seconds after the check finalizes or when closed.

import type { ReadyCheckMemberResponse } from '../../../sim/types';
import { t } from '../../i18n';
import { svgIcon } from '../../ui_icons';

export const READY_CHECK_AUTO_CLOSE_MS = 4000;

export class ReadyCheckLeaderWindow {
  private closeTimer: number | null = null;
  private lastStatus: { done: boolean; readyCount: number; total: number } | null = null;
  private lastResponses: ReadyCheckMemberResponse[] = [];

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
    this.lastStatus = null;
    this.lastResponses = [];
  }

  relocalize(): void {
    this.paintRoster(this.lastResponses);
    this.paintStatusLine();
  }

  update(ev: { responses: ReadyCheckMemberResponse[]; done: boolean }): void {
    this.show();
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    const rosterEl = this.el.querySelector('.rck-roster');
    this.lastResponses = ev.responses;
    this.paintRoster(ev.responses, rosterEl);

    const statusLine = this.el.querySelector('.rck-status-line');
    const readyCount = ev.responses.filter((r) => r.state === 'ready').length;
    this.lastStatus = { done: ev.done, readyCount, total: ev.responses.length };
    this.paintStatusLine(statusLine);
    if (ev.done) {
      this.closeTimer = setTimeout(
        () => this.hide(),
        READY_CHECK_AUTO_CLOSE_MS,
      ) as unknown as number;
    }
  }

  private paintRoster(responses: ReadyCheckMemberResponse[], existing?: Element | null): void {
    const rosterEl = existing ?? this.el.querySelector('.rck-roster');
    if (rosterEl) {
      rosterEl.replaceChildren();
      for (const m of responses) {
        const row = document.createElement('div');
        row.className = 'rck-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'rck-name';
        nameSpan.textContent = m.name;

        const statusSpan = document.createElement('span');
        statusSpan.className = 'rck-status';
        const statusLabel = this.memberStatusLabel(m);
        statusSpan.setAttribute('role', 'img');
        statusSpan.setAttribute('aria-label', statusLabel);
        statusSpan.title = statusLabel;
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
  }

  private memberStatusLabel(member: ReadyCheckMemberResponse): string {
    if (member.state === 'ready') {
      return t('hudChrome.readyCheck.memberReady', { name: member.name });
    }
    if (member.state === 'notready') {
      return t('hudChrome.readyCheck.memberNotReady', { name: member.name });
    }
    return t('hudChrome.readyCheck.memberPending', { name: member.name });
  }

  private paintStatusLine(existing?: Element | null): void {
    const statusLine = existing ?? this.el.querySelector('.rck-status-line');
    if (!statusLine || !this.lastStatus) return;
    if (this.lastStatus.done) {
      statusLine.textContent = t('hudChrome.readyCheck.status', {
        ready: this.lastStatus.readyCount,
        total: this.lastStatus.total,
      });
      return;
    }
    statusLine.textContent = t('hudChrome.readyCheck.waiting');
  }
}
