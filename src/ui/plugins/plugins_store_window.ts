// The Plugin Store window painter (#plugins-window): a cold, event-driven
// window over the plugins REST client + the runtime host, the deeds/bank
// shape exactly. Full innerHTML rebuild on open and on every interaction;
// nothing here runs on the per-frame hot path. The pure model lives in
// plugins_store_view.ts; this module only paints and wires callbacks through
// injected deps (it never imports Hud and never hardcodes gameplay state).
// Every community-authored string (names, summaries, sources, notes) crosses
// into HTML through esc().

import { audio } from '../../game/audio';
import { userFacingApiError } from '../api_error_i18n';
import { markDialogRoot } from '../dialog_root';
import { esc } from '../esc';
import { formatNumber, type TranslationKey, t } from '../i18n';
import { svgIcon } from '../ui_icons';
import type { PluginHost } from './plugin_host';
import type { PluginCategoryWire, PluginSubmission, PluginsClient } from './plugins_client';
import {
  buildPluginsStoreView,
  PLUGIN_CATEGORY_KEYS,
  PLUGIN_CATEGORY_ORDER,
  type PluginsStoreState,
  type PluginsStoreTab,
} from './plugins_store_view';

export interface PluginsStoreWindowDeps {
  /** The #plugins-window root (Hud owns the id). */
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** Null while offline or logged out: the window renders its sign-in notice. */
  client(): PluginsClient | null;
  host(): PluginHost | null;
  /** Prefill for the author-handle field (the character name). */
  defaultAuthor(): string;
}

const CATEGORY_LABEL = (category: PluginCategoryWire | 'all'): string =>
  category === 'all'
    ? t('hudChrome.plugins.catAll')
    : t(PLUGIN_CATEGORY_KEYS[category] as TranslationKey);

export class PluginsStoreWindow {
  private opened = false;
  private openerFocus: HTMLElement | null = null;
  private state: PluginsStoreState = {
    tab: 'browse',
    catalog: [],
    installed: [],
    mine: [],
    search: '',
    category: 'all',
    loading: false,
    online: false,
  };
  private errorText = '';
  private noticeText = '';
  private expandedSource: { id: number; source: string; description: string } | null = null;
  /** The plugin id the develop form is updating, or null for a new listing. */
  private editingId: number | null = null;
  private fetchSeq = 0;

  constructor(private readonly deps: PluginsStoreWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) {
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.errorText = '';
    this.noticeText = '';
    this.state.online = this.deps.client() !== null;
    this.render();
    this.deps.root().style.display = 'flex';
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
    audio.click();
    void this.refreshData();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    const root = this.deps.root();
    root.style.display = 'none';
    delete root.dataset.windowOpen;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Fetch all three data sets; a stale response after close/reopen is dropped. */
  private async refreshData(): Promise<void> {
    const client = this.deps.client();
    this.state.online = client !== null;
    if (!client) {
      this.render();
      return;
    }
    const seq = ++this.fetchSeq;
    this.state.loading = true;
    this.render();
    const [catalog, installed, mine] = await Promise.all([
      client.catalog(),
      client.installed(),
      client.mine(),
    ]);
    if (seq !== this.fetchSeq || !this.opened) return;
    this.state.catalog = catalog;
    this.state.installed = installed;
    this.state.mine = mine;
    this.state.loading = false;
    this.render();
  }

  /** Re-pull installs and hot-sync the runtime (instant activation path). */
  private async syncInstalls(): Promise<void> {
    const client = this.deps.client();
    if (!client) return;
    const rows = await client.installed();
    this.state.installed = rows;
    this.deps.host()?.syncInstalled(rows);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorText = '';
    this.noticeText = '';
    try {
      await action();
    } catch (err) {
      this.errorText = userFacingApiError(err);
    }
    if (this.opened) this.render();
  }

  private install(id: number): void {
    void this.run(async () => {
      await this.deps.client()?.install(id, true);
      await this.syncInstalls();
      audio.coin();
    });
  }

  private setEnabled(id: number, enabled: boolean): void {
    void this.run(async () => {
      await this.deps.client()?.install(id, enabled);
      await this.syncInstalls();
    });
  }

  private uninstall(id: number): void {
    void this.run(async () => {
      await this.deps.client()?.uninstall(id);
      await this.syncInstalls();
    });
  }

  private toggleSource(id: number): void {
    if (this.expandedSource?.id === id) {
      this.expandedSource = null;
      this.render();
      return;
    }
    void this.run(async () => {
      const detail = await this.deps.client()?.detail(id);
      if (detail) {
        this.expandedSource = { id, source: detail.source, description: detail.description };
      }
    });
  }

  private submitForm(): void {
    const root = this.deps.root();
    const read = (sel: string): string =>
      (root.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
    const submission: PluginSubmission = {
      name: read('[data-f-name]'),
      summary: read('[data-f-summary]'),
      description: read('[data-f-description]'),
      category: (read('[data-f-category]') || 'tools') as PluginCategoryWire,
      source: read('[data-f-source]'),
      notes: read('[data-f-notes]'),
    };
    const editingId = this.editingId;
    void this.run(async () => {
      const client = this.deps.client();
      if (!client) return;
      if (editingId === null) {
        await client.create({ ...submission, author: read('[data-f-author]') });
      } else {
        await client.submitVersion(editingId, submission);
      }
      this.noticeText = t('hudChrome.plugins.submitted');
      this.editingId = null;
      this.state.mine = await client.mine();
      audio.questDone();
    });
  }

  /** Load one of my plugins into the develop form for an update submission. */
  private editMine(id: number): void {
    this.editingId = id;
    this.state.tab = 'develop';
    this.render();
  }

  // -------------------------------------------------------------------------
  // Rendering.
  // -------------------------------------------------------------------------

  render(): void {
    if (!this.opened) return;
    const root = this.deps.root();
    root.dataset.windowOpen = '1';
    const view = buildPluginsStoreView(this.state);
    const tabs: [PluginsStoreTab, string][] = [
      ['browse', t('hudChrome.plugins.tabBrowse')],
      ['installed', t('hudChrome.plugins.tabInstalled')],
      ['develop', t('hudChrome.plugins.tabDevelop')],
    ];
    const body = view.online
      ? this.state.loading
        ? `<div class="plugins-note">${esc(t('hudChrome.plugins.loading'))}</div>`
        : this.renderTab(view)
      : `<div class="plugins-note">${esc(t('hudChrome.plugins.offline'))}</div>`;
    root.innerHTML = `
      <div class="panel-title">
        <span>${esc(t('hudChrome.plugins.title'))}</span>
        <button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.plugins.close'))}">${svgIcon('close')}</button>
      </div>
      <div class="plugins-tabs" role="tablist">
        ${tabs
          .map(
            ([tab, label]) =>
              `<button type="button" role="tab" class="plugins-tab${this.state.tab === tab ? ' active' : ''}"
                 aria-selected="${this.state.tab === tab}" data-tab="${tab}">${esc(label)}</button>`,
          )
          .join('')}
      </div>
      ${this.errorText ? `<div class="plugins-error" role="alert">${esc(this.errorText)}</div>` : ''}
      ${this.noticeText ? `<div class="plugins-notice" role="status">${esc(this.noticeText)}</div>` : ''}
      <div class="plugins-body">${body}</div>
    `;
    markDialogRoot(root, { label: t('hudChrome.plugins.title') });
    this.wire(root);
  }

  private renderTab(view: ReturnType<typeof buildPluginsStoreView>): string {
    if (view.tab === 'browse') return this.renderBrowse(view);
    if (view.tab === 'installed') return this.renderInstalled(view);
    return this.renderDevelop();
  }

  private renderBrowse(view: ReturnType<typeof buildPluginsStoreView>): string {
    const filters = `
      <div class="plugins-filters">
        <input type="search" class="plugins-search" data-search
          placeholder="${esc(t('hudChrome.plugins.searchPlaceholder'))}"
          aria-label="${esc(t('hudChrome.plugins.searchPlaceholder'))}"
          value="${esc(this.state.search)}">
        <select class="plugins-category" data-category
          aria-label="${esc(t('hudChrome.plugins.formCategory'))}">
          ${PLUGIN_CATEGORY_ORDER.map(
            (category) =>
              `<option value="${category}"${this.state.category === category ? ' selected' : ''}>
                 ${esc(CATEGORY_LABEL(category))}</option>`,
          ).join('')}
        </select>
      </div>`;
    if (view.browse.length === 0) {
      const key = view.filteredOut ? 'hudChrome.plugins.filteredOut' : 'hudChrome.plugins.empty';
      return `${filters}<div class="plugins-note">${esc(t(key as TranslationKey))}</div>`;
    }
    const rows = view.browse
      .map((row) => {
        const author = row.author
          ? t('hudChrome.plugins.byAuthor', { author: row.author })
          : t('hudChrome.plugins.byTeam');
        const actions = row.installed
          ? `<button type="button" class="plugins-btn" data-toggle="${row.id}" data-next="${row.enabled ? '0' : '1'}">
               ${esc(t(row.enabled ? 'hudChrome.plugins.disable' : 'hudChrome.plugins.enable'))}</button>
             <button type="button" class="plugins-btn" data-uninstall="${row.id}">
               ${esc(t('hudChrome.plugins.uninstall'))}</button>`
          : `<button type="button" class="plugins-btn primary" data-install="${row.id}">
               ${esc(t('hudChrome.plugins.install'))}</button>`;
        const expanded =
          this.expandedSource?.id === row.id
            ? `<div class="plugins-source">
                 ${
                   this.expandedSource.description
                     ? `<p class="plugins-desc">${esc(this.expandedSource.description)}</p>`
                     : ''
}
                 <pre>${esc(this.expandedSource.source)}</pre>
               </div>`
            : '';
        return `
        <div class="plugins-row" data-slug="${esc(row.slug)}">
          <div class="plugins-row-main">
            <div class="plugins-row-title">
              <span class="plugins-name">${esc(row.name)}</span>
              <span class="plugins-version">v${formatNumber(row.version, { useGrouping: false })}</span>
              <span class="plugins-chip">${esc(t(row.categoryKey as TranslationKey))}</span>
            </div>
            <div class="plugins-row-sub">${esc(author)} · ${esc(
              t('hudChrome.plugins.installs', { count: formatNumber(row.installs) }),
            )}</div>
            <div class="plugins-summary">${esc(row.summary)}</div>
          </div>
          <div class="plugins-row-actions">
            ${actions}
            <button type="button" class="plugins-btn ghost" data-source="${row.id}">
              ${esc(
                t(
                  this.expandedSource?.id === row.id
                    ? 'hudChrome.plugins.hideSource'
                    : 'hudChrome.plugins.viewSource',
                ),
              )}</button>
          </div>
          ${expanded}
        </div>`;
      })
      .join('');
    return `${filters}<div class="plugins-list">${rows}</div>`;
  }

  private renderInstalled(view: ReturnType<typeof buildPluginsStoreView>): string {
    if (view.installedRows.length === 0) {
      return `<div class="plugins-note">${esc(t('hudChrome.plugins.installedEmpty'))}</div>`;
    }
    const rows = view.installedRows
      .map(
        (row) => `
        <div class="plugins-row">
          <div class="plugins-row-main">
            <div class="plugins-row-title">
              <span class="plugins-name">${esc(row.name)}</span>
              <span class="plugins-version">v${formatNumber(row.version, { useGrouping: false })}</span>
              <span class="plugins-chip">${esc(t(row.categoryKey as TranslationKey))}</span>
            </div>
            <div class="plugins-summary">${esc(row.summary)}</div>
          </div>
          <div class="plugins-row-actions">
            <button type="button" class="plugins-btn" data-toggle="${row.id}" data-next="${row.enabled ? '0' : '1'}">
              ${esc(t(row.enabled ? 'hudChrome.plugins.disable' : 'hudChrome.plugins.enable'))}</button>
            <button type="button" class="plugins-btn" data-uninstall="${row.id}">
              ${esc(t('hudChrome.plugins.uninstall'))}</button>
          </div>
        </div>`,
      )
      .join('');
    return `<div class="plugins-list">${rows}</div>`;
  }

  private renderDevelop(): string {
    const editing = this.editingId !== null;
    const source = editing ? this.state.mine.find((row) => row.id === this.editingId) : null;
    const mine = this.state.mine
      .map((row) => {
        const status = t(
          (row.status === 'listed'
            ? 'hudChrome.plugins.statusListed'
            : row.status === 'delisted'
              ? 'hudChrome.plugins.statusDelisted'
              : 'hudChrome.plugins.statusPending') as TranslationKey,
        );
        const latest = row.latest
          ? t('hudChrome.plugins.latestLine', {
              version: formatNumber(row.latest.version, { useGrouping: false }),
              status: t(
                (row.latest.status === 'pending'
                  ? 'hudChrome.plugins.statusPending'
                  : row.latest.status === 'approved'
                    ? 'hudChrome.plugins.statusApproved'
                    : 'hudChrome.plugins.statusRejected') as TranslationKey,
              ),
            })
          : '';
        const note =
          row.latest?.status === 'rejected' && row.latest.reviewNote
            ? `<div class="plugins-review-note">${esc(
                t('hudChrome.plugins.reviewNote', { note: row.latest.reviewNote }),
              )}</div>`
            : '';
        return `
        <div class="plugins-row">
          <div class="plugins-row-main">
            <div class="plugins-row-title">
              <span class="plugins-name">${esc(row.name)}</span>
              <span class="plugins-chip">${esc(status)}</span>
            </div>
            <div class="plugins-row-sub">${esc(latest)}</div>
            ${note}
          </div>
          <div class="plugins-row-actions">
            <button type="button" class="plugins-btn" data-edit="${row.id}">
              ${esc(t('hudChrome.plugins.editPlugin'))}</button>
            <button type="button" class="plugins-btn danger" data-delete="${row.id}">
              ${esc(t('hudChrome.plugins.deletePlugin'))}</button>
          </div>
        </div>`;
      })
      .join('');
    return `
      <p class="plugins-note">${esc(t('hudChrome.plugins.developIntro'))}</p>
      <p class="plugins-hint">${esc(t('hudChrome.plugins.docsHint'))}</p>
      <form class="plugins-form" data-form>
        <div class="plugins-form-grid">
          <label>${esc(t('hudChrome.plugins.formName'))}
            <input type="text" data-f-name maxlength="40" value="${esc(source?.name ?? '')}" ${editing ? 'readonly' : ''}></label>
          ${
            editing
              ? ''
              : `<label>${esc(t('hudChrome.plugins.formAuthor'))}
            <input type="text" data-f-author maxlength="24" value="${esc(this.deps.defaultAuthor())}"></label>`
          }
          <label>${esc(t('hudChrome.plugins.formCategory'))}
            <select data-f-category>
              ${PLUGIN_CATEGORY_ORDER.filter((category) => category !== 'all')
                .map(
                  (category) =>
                    `<option value="${category}"${source?.category === category ? ' selected' : ''}>
                       ${esc(CATEGORY_LABEL(category))}</option>`,
                )
                .join('')}
            </select></label>
        </div>
        <label>${esc(t('hudChrome.plugins.formSummary'))}
          <input type="text" data-f-summary maxlength="140" value="${esc(source?.summary ?? '')}"></label>
        <label>${esc(t('hudChrome.plugins.formDescription'))}
          <textarea data-f-description rows="3" maxlength="4000">${esc(source?.description ?? '')}</textarea></label>
        <label>${esc(t('hudChrome.plugins.formSource'))}
          <textarea data-f-source rows="10" spellcheck="false" class="plugins-code"></textarea></label>
        <label>${esc(t('hudChrome.plugins.formNotes'))}
          <input type="text" data-f-notes maxlength="200"></label>
        <div class="plugins-form-actions">
          ${
            editing
              ? `<button type="button" class="plugins-btn ghost" data-cancel-edit>
                   ${esc(t('hudChrome.plugins.newPlugin'))}</button>`
              : ''
          }
          <button type="submit" class="plugins-btn primary">
            ${esc(t(editing ? 'hudChrome.plugins.submitUpdate' : 'hudChrome.plugins.submitNew'))}</button>
        </div>
      </form>
      ${mine ? `<h3 class="plugins-mine-title">${esc(t('hudChrome.plugins.mineTitle'))}</h3>` : ''}
      <div class="plugins-list">${mine}</div>
    `;
  }

  private wire(root: HTMLElement): void {
    (root.querySelector('[data-close]') as HTMLElement | null)?.addEventListener('click', () =>
      this.close(),
    );
    for (const el of root.querySelectorAll<HTMLElement>('[data-tab]')) {
      el.addEventListener('click', () => {
        this.state.tab = el.dataset.tab as PluginsStoreTab;
        this.expandedSource = null;
        this.render();
      });
    }
    const search = root.querySelector<HTMLInputElement>('[data-search]');
    search?.addEventListener('input', () => {
      this.state.search = search.value;
      const active = document.activeElement === search;
      const pos = search.selectionStart ?? search.value.length;
      this.render();
      if (active) {
        const next = root.querySelector<HTMLInputElement>('[data-search]');
        next?.focus();
        next?.setSelectionRange(pos, pos);
      }
    });
    const category = root.querySelector<HTMLSelectElement>('[data-category]');
    category?.addEventListener('change', () => {
      this.state.category = category.value as PluginsStoreState['category'];
      this.render();
    });
    for (const el of root.querySelectorAll<HTMLElement>('[data-install]')) {
      el.addEventListener('click', () => this.install(Number(el.dataset.install)));
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-toggle]')) {
      el.addEventListener('click', () =>
        this.setEnabled(Number(el.dataset.toggle), el.dataset.next === '1'),
      );
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-uninstall]')) {
      el.addEventListener('click', () => this.uninstall(Number(el.dataset.uninstall)));
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-source]')) {
      el.addEventListener('click', () => this.toggleSource(Number(el.dataset.source)));
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-edit]')) {
      el.addEventListener('click', () => this.editMine(Number(el.dataset.edit)));
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-delete]')) {
      el.addEventListener('click', () => {
        void this.run(async () => {
          const client = this.deps.client();
          if (!client) return;
          await client.remove(Number(el.dataset.delete));
          this.state.mine = await client.mine();
          await this.syncInstalls();
        });
      });
    }
    (root.querySelector('[data-cancel-edit]') as HTMLElement | null)?.addEventListener(
      'click',
      () => {
        this.editingId = null;
        this.render();
      },
    );
    (root.querySelector('[data-form]') as HTMLFormElement | null)?.addEventListener(
      'submit',
      (ev) => {
        ev.preventDefault();
        this.submitForm();
      },
    );
  }
}
