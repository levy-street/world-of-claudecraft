// The Open Map drawer: local drafts (MapStore + the autosave draft) and server
// maps (mine + a Public tab for browsing/forking). A modal overlay with
// loading, empty, error, and signed-out states; all server calls go through
// net.ts and errors map to t() keys via server_errors_core.

import { formatDateTime, t } from '../ui/i18n';
import type { CustomMapMeta } from './custom_map';
import { button, el } from './dom';
import * as net from './net';
import { EditorApiError, type MapSummaryWire } from './net';
import { editorErrorKey } from './server_errors_core';

type Tab = 'local' | 'mine' | 'public';

export interface MapDrawerDeps {
  listLocal(): CustomMapMeta[];
  hasDraft(): boolean;
  onOpenLocal(id: string): void;
  onOpenDraft(): void;
  onDeleteLocal(id: string): Promise<void>;
  onOpenServer(map: net.MapFullWire, mine: boolean): void;
  confirm(title: string, body: string, confirmLabel: string): Promise<boolean>;
  toastError(message: string): void;
  toastSuccess(message: string): void;
}

function when(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? formatDateTime(ms, { dateStyle: 'medium', timeStyle: 'short' })
    : iso;
}

export class MapDrawer {
  private overlay: HTMLElement | null = null;
  private body!: HTMLElement;
  private tabsEl!: HTMLElement;
  private tab: Tab = 'local';
  private publicPage = 1;
  private readonly onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.close();
    }
  };

  constructor(
    private readonly parent: HTMLElement,
    private readonly deps: MapDrawerDeps,
  ) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(): void {
    if (this.overlay) {
      this.render();
      return;
    }
    this.overlay = el('div', 'ed-modal-overlay');
    const panel = el('div', 'ed-modal ed-drawer');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t('editor.openDrawer.title'));
    const head = el('div', 'ed-drawer-head');
    head.appendChild(el('h2', 'ed-modal-title', t('editor.openDrawer.title')));
    head.appendChild(button(t('editor.openDrawer.close'), () => this.close(), 'ed-drawer-close'));
    panel.appendChild(head);
    this.tabsEl = el('div', 'ed-drawer-tabs');
    this.tabsEl.setAttribute('role', 'tablist');
    panel.appendChild(this.tabsEl);
    this.body = el('div', 'ed-drawer-body');
    panel.appendChild(this.body);
    this.overlay.appendChild(panel);
    this.overlay.addEventListener('pointerdown', (ev) => {
      if (ev.target === this.overlay) this.close();
    });
    window.addEventListener('keydown', this.onKey, true);
    this.parent.appendChild(this.overlay);
    this.render();
  }

  close(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay?.remove();
    this.overlay = null;
  }

  private render(): void {
    this.renderTabs();
    if (this.tab === 'local') this.renderLocal();
    else if (this.tab === 'mine') void this.renderMine();
    else void this.renderPublic();
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = '';
    const tabs: { id: Tab; label: string }[] = [
      { id: 'local', label: t('editor.openDrawer.tabLocal') },
      { id: 'mine', label: t('editor.openDrawer.tabMine') },
      { id: 'public', label: t('editor.openDrawer.tabPublic') },
    ];
    for (const tb of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-drawer-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', tb.id === this.tab ? 'true' : 'false');
      b.classList.toggle('active', tb.id === this.tab);
      b.textContent = tb.label;
      b.addEventListener('click', () => {
        this.tab = tb.id;
        this.render();
      });
      this.tabsEl.appendChild(b);
    }
  }

  private note(text: string): void {
    this.body.innerHTML = '';
    this.body.appendChild(el('p', 'ed-drawer-note', text));
  }

  private table(headers: string[], hasStatus = false): { table: HTMLElement; rows: HTMLElement } {
    this.body.innerHTML = '';
    const table = el('div', 'ed-map-table');
    const head = el('div', `ed-map-row ed-map-head${hasStatus ? ' has-status' : ''}`);
    for (const h of headers) head.appendChild(el('span', 'ed-map-cell', h));
    head.appendChild(el('span', 'ed-map-cell ed-map-actions', ''));
    table.appendChild(head);
    const rows = el('div', 'ed-map-rows');
    table.appendChild(rows);
    this.body.appendChild(table);
    return { table, rows };
  }

  // ---- local ------------------------------------------------------------------

  private renderLocal(): void {
    const metas = this.deps.listLocal();
    const hasDraft = this.deps.hasDraft();
    if (metas.length === 0 && !hasDraft) {
      this.note(t('editor.openDrawer.emptyLocal'));
      return;
    }
    const { rows } = this.table([
      t('editor.openDrawer.colName'),
      t('editor.openDrawer.colUpdated'),
    ]);
    if (hasDraft) {
      const row = el('div', 'ed-map-row ed-map-draft');
      row.appendChild(el('span', 'ed-map-cell', t('editor.openDrawer.draft')));
      row.appendChild(el('span', 'ed-map-cell', ''));
      const actions = el('span', 'ed-map-cell ed-map-actions');
      actions.appendChild(
        button(t('editor.openDrawer.open'), () => {
          this.deps.onOpenDraft();
          this.close();
        }),
      );
      row.appendChild(actions);
      rows.appendChild(row);
    }
    for (const m of metas) {
      const row = el('div', 'ed-map-row');
      row.appendChild(el('span', 'ed-map-cell', m.name));
      row.appendChild(
        el(
          'span',
          'ed-map-cell ed-map-muted',
          m.updatedAt
            ? formatDateTime(m.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })
            : '',
        ),
      );
      const actions = el('span', 'ed-map-cell ed-map-actions');
      actions.appendChild(
        button(t('editor.openDrawer.open'), () => {
          this.deps.onOpenLocal(m.id);
          this.close();
        }),
      );
      actions.appendChild(
        button(
          t('editor.openDrawer.delete'),
          async () => {
            const ok = await this.deps.confirm(
              t('editor.openDrawer.delete'),
              t('editor.openDrawer.deleteLocalConfirm', { name: m.name }),
              t('editor.openDrawer.delete'),
            );
            if (!ok) return;
            await this.deps.onDeleteLocal(m.id);
            this.renderLocal();
          },
          'danger',
        ),
      );
      row.appendChild(actions);
      rows.appendChild(row);
    }
  }

  // ---- server: mine -------------------------------------------------------------

  private async renderMine(): Promise<void> {
    if (!net.signedIn()) {
      this.note(t('editor.openDrawer.signInHint'));
      return;
    }
    this.note(t('editor.openDrawer.loading'));
    let maps: MapSummaryWire[];
    try {
      maps = await net.listMyMaps();
    } catch (err) {
      this.serverError(err);
      return;
    }
    if (this.tab !== 'mine' || !this.overlay) return;
    if (maps.length === 0) {
      this.note(t('editor.openDrawer.emptyMine'));
      return;
    }
    const { rows } = this.table(
      [
        t('editor.openDrawer.colName'),
        t('editor.openDrawer.colUpdated'),
        t('editor.openDrawer.colStatus'),
      ],
      true,
    );
    for (const m of maps) rows.appendChild(this.mineRow(m));
  }

  private mineRow(m: MapSummaryWire): HTMLElement {
    const row = el('div', 'ed-map-row has-status');
    row.appendChild(el('span', 'ed-map-cell', m.name));
    row.appendChild(el('span', 'ed-map-cell ed-map-muted', when(m.updatedAt)));
    row.appendChild(
      el(
        'span',
        `ed-map-cell ed-map-status ${m.status === 'public' ? 'is-public' : ''}`,
        m.status === 'public'
          ? t('editor.openDrawer.statusPublic')
          : t('editor.openDrawer.statusPrivate'),
      ),
    );
    const actions = el('span', 'ed-map-cell ed-map-actions');
    actions.appendChild(button(t('editor.openDrawer.open'), () => void this.openServer(m.id)));
    const pubLabel =
      m.status === 'public' ? t('editor.openDrawer.unpublish') : t('editor.openDrawer.publish');
    actions.appendChild(
      button(pubLabel, async () => {
        try {
          await net.setMapPublished(m.id, m.status !== 'public');
          this.deps.toastSuccess(
            m.status !== 'public' ? t('editor.status.published') : t('editor.status.unpublished'),
          );
          void this.renderMine();
        } catch (err) {
          this.toastServerError(err);
        }
      }),
    );
    actions.appendChild(
      button(
        t('editor.openDrawer.delete'),
        async () => {
          const ok = await this.deps.confirm(
            t('editor.openDrawer.delete'),
            t('editor.openDrawer.deleteServerConfirm', { name: m.name }),
            t('editor.openDrawer.delete'),
          );
          if (!ok) return;
          try {
            await net.deleteServerMap(m.id);
            this.deps.toastSuccess(t('editor.status.deleted'));
            void this.renderMine();
          } catch (err) {
            this.toastServerError(err);
          }
        },
        'danger',
      ),
    );
    row.appendChild(actions);
    return row;
  }

  // ---- server: public -------------------------------------------------------------

  private async renderPublic(): Promise<void> {
    this.note(t('editor.openDrawer.loading'));
    let page: Awaited<ReturnType<typeof net.listPublicMaps>>;
    try {
      page = await net.listPublicMaps(this.publicPage);
    } catch (err) {
      this.serverError(err);
      return;
    }
    if (this.tab !== 'public' || !this.overlay) return;
    if (page.rows.length === 0 && this.publicPage === 1) {
      this.note(t('editor.openDrawer.emptyPublic'));
      return;
    }
    const { table, rows } = this.table([
      t('editor.openDrawer.colName'),
      t('editor.openDrawer.colUpdated'),
    ]);
    for (const m of page.rows) {
      const row = el('div', 'ed-map-row');
      row.appendChild(el('span', 'ed-map-cell', m.name));
      row.appendChild(el('span', 'ed-map-cell ed-map-muted', when(m.updatedAt)));
      const actions = el('span', 'ed-map-cell ed-map-actions');
      actions.appendChild(button(t('editor.openDrawer.open'), () => void this.openServer(m.id)));
      if (net.signedIn()) {
        actions.appendChild(
          button(t('editor.openDrawer.fork'), async () => {
            try {
              const forked = await net.forkMap(m.id);
              this.deps.toastSuccess(t('editor.status.forked', { name: forked.name }));
              this.deps.onOpenServer(forked, true);
              this.close();
            } catch (err) {
              this.toastServerError(err);
            }
          }),
        );
      }
      row.appendChild(actions);
      rows.appendChild(row);
    }
    const totalPages = Math.max(1, Math.ceil(page.total / Math.max(1, page.limit)));
    if (totalPages > 1) {
      const pager = el('div', 'ed-drawer-pager');
      const prev = button(t('editor.openDrawer.prev'), () => {
        this.publicPage = Math.max(1, this.publicPage - 1);
        void this.renderPublic();
      });
      prev.disabled = this.publicPage <= 1;
      const next = button(t('editor.openDrawer.next'), () => {
        this.publicPage = Math.min(totalPages, this.publicPage + 1);
        void this.renderPublic();
      });
      next.disabled = this.publicPage >= totalPages;
      pager.append(
        prev,
        el('span', 'ed-map-muted', t('editor.openDrawer.page', { page: this.publicPage })),
        next,
      );
      table.appendChild(pager);
    }
    if (!net.signedIn()) {
      table.appendChild(el('p', 'ed-drawer-note', t('editor.openDrawer.signInHint')));
    }
  }

  private async openServer(id: number): Promise<void> {
    try {
      const full = await net.getMap(id);
      this.deps.onOpenServer(full, this.tab === 'mine');
      this.close();
    } catch (err) {
      this.toastServerError(err);
    }
  }

  private serverError(err: unknown): void {
    const key =
      err instanceof EditorApiError ? editorErrorKey(err.code, err.status) : editorErrorKey(null);
    this.body.innerHTML = '';
    this.body.appendChild(el('p', 'ed-drawer-note ed-error', t('editor.openDrawer.loadFailed')));
    this.body.appendChild(el('p', 'ed-drawer-note', t(key)));
  }

  private toastServerError(err: unknown): void {
    const key =
      err instanceof EditorApiError ? editorErrorKey(err.code, err.status) : editorErrorKey(null);
    this.deps.toastError(t(key));
  }
}
