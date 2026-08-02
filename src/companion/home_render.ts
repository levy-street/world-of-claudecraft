// DOM renderer for Companion Home. Player-facing strings go through `t`.

import type {
  CompanionHistoryRow,
  CompanionHomeModel,
  DeedsStanding,
  SpinAction,
} from './home_model';
import { formatClaudium, formatPrizeUsd, formatResetCountdown } from './home_model';

export type CompanionT = (key: string, vars?: Record<string, string | number>) => string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eligibilityCopy(t: CompanionT, reason: CompanionHomeModel['eligibilityReason']): string {
  switch (reason) {
    case 'eligible':
      return t('companion.home.eligible');
    case 'no_wallet':
      return t('companion.home.eligibility.noWallet');
    case 'under_minimum':
      return t('companion.home.eligibility.underMinimum');
    case 'price_unavailable':
      return t('companion.home.eligibility.priceUnavailable');
    case 'banned':
      return t('companion.home.eligibility.banned');
    default:
      return t('companion.home.eligibility.unknown');
  }
}

function spinButtonLabel(t: CompanionT, spin: SpinAction): string {
  if (spin.kind === 'ready') return t('companion.home.spinCta');
  if (spin.kind === 'claimed') {
    return t('companion.home.spinClaimed', { points: spin.points });
  }
  return t('companion.home.spinUnavailable');
}

function deedsCopy(t: CompanionT, deeds: DeedsStanding): string {
  if (deeds.kind === 'unavailable') return t('companion.home.deedsUnavailable');
  if (deeds.kind === 'unranked') return t('companion.home.deedsUnranked');
  if (deeds.renown !== null) {
    return t('companion.home.deedsRankRenown', {
      rank: deeds.rank,
      topPercent: deeds.topPercent,
      renown: deeds.renown,
    });
  }
  return t('companion.home.deedsRank', {
    rank: deeds.rank,
    topPercent: deeds.topPercent,
  });
}

function historyStatusLabel(t: CompanionT, status: string): string {
  const key = `companion.home.historyStatus.${status}`;
  const localized = t(key);
  return localized === key ? status : localized;
}

function renderHistoryList(t: CompanionT, history: readonly CompanionHistoryRow[]): HTMLElement {
  if (history.length === 0) {
    return el('p', 'companion-empty', t('companion.home.historyEmpty'));
  }
  const list = el('ul', 'companion-history');
  for (const row of history) {
    const li = el('li', 'companion-history-item');
    const head = el('div', 'companion-history-head');
    head.append(
      el('span', 'companion-history-day', row.day),
      el('span', 'companion-history-rank', t('companion.home.historyRank', { rank: row.rank })),
    );
    const meta = el(
      'span',
      'companion-history-meta',
      t('companion.home.historyMeta', {
        points: row.points,
        prize: formatPrizeUsd(row.prizeUsd),
        status: historyStatusLabel(t, row.status),
      }),
    );
    li.append(head, meta);
    if (row.txSignature) {
      const tx = el('a', 'companion-history-tx', t('companion.home.historyTx'));
      tx.href = `https://solscan.io/tx/${encodeURIComponent(row.txSignature)}`;
      tx.target = '_blank';
      tx.rel = 'noopener noreferrer';
      li.append(tx);
    }
    list.append(li);
  }
  return list;
}

export interface HomeRenderHandlers {
  onSpin: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}

export function renderHome(
  root: HTMLElement,
  model: CompanionHomeModel,
  t: CompanionT,
  handlers: HomeRenderHandlers,
  spinning = false,
): void {
  root.replaceChildren();

  const shell = el('div', 'companion-shell');
  const header = el('header', 'companion-header');
  header.append(
    el('div', 'companion-brand', t('companion.home.brand')),
    el('div', 'companion-user', model.username),
  );
  const logout = el('button', 'companion-btn ghost', t('companion.home.logout'));
  logout.type = 'button';
  logout.addEventListener('click', handlers.onLogout);
  header.append(logout);
  shell.append(header);

  // Hero: daily spin
  const hero = el('section', 'companion-card companion-hero');
  hero.append(el('h1', 'companion-title', t('companion.home.dailyTitle')));
  hero.append(
    el(
      'p',
      'companion-meta',
      t('companion.home.dayLine', {
        day: model.day,
        reset: formatResetCountdown(model.resetAt),
      }),
    ),
  );
  hero.append(
    el(
      'p',
      'companion-meta',
      t('companion.home.scoreLine', {
        score: model.score,
        rank: model.rank ?? t('companion.home.unranked'),
      }),
    ),
  );
  hero.append(el('p', 'companion-eligibility', eligibilityCopy(t, model.eligibilityReason)));

  const spinBtn = el('button', 'companion-btn primary', spinButtonLabel(t, model.spin));
  spinBtn.type = 'button';
  spinBtn.disabled = model.spin.kind !== 'ready' || spinning;
  if (spinning) spinBtn.textContent = t('companion.home.spinning');
  spinBtn.addEventListener('click', handlers.onSpin);
  hero.append(spinBtn);
  shell.append(hero);

  // Deeds / Renown standing chip
  const deeds = el('section', 'companion-card companion-deeds');
  deeds.append(el('h2', 'companion-section', t('companion.home.deedsTitle')));
  deeds.append(el('p', 'companion-deeds-line', deedsCopy(t, model.deeds)));
  shell.append(deeds);

  // Play balances
  const balances = el('section', 'companion-card');
  balances.append(el('h2', 'companion-section', t('companion.home.playBalances')));
  const row = el('div', 'companion-balance-row');
  row.append(el('span', 'companion-k', t('companion.home.claudium')));
  row.append(el('span', 'companion-v', formatClaudium(model.claudium, model.claudiumAvailable)));
  balances.append(row);
  shell.append(balances);

  // Roster
  const roster = el('section', 'companion-card');
  roster.append(el('h2', 'companion-section', t('companion.home.roster')));
  if (model.multiRealm) {
    roster.append(el('p', 'companion-meta', t('companion.home.rosterMultiRealm')));
  }
  if (model.emptyRoster) {
    roster.append(el('p', 'companion-empty', t('companion.home.rosterEmpty')));
  } else {
    const list = el('ul', 'companion-roster');
    for (const c of model.roster) {
      const li = el('li', 'companion-roster-item');
      const name = el('span', 'companion-roster-name', c.name);
      const metaVars: Record<string, string | number> = {
        level: c.level,
        classId: c.classId,
        online: c.online ? t('companion.home.online') : t('companion.home.offline'),
      };
      const metaText = c.realm
        ? t('companion.home.rosterMetaRealm', { ...metaVars, realm: c.realm })
        : t('companion.home.rosterMeta', metaVars);
      const meta = el('span', 'companion-roster-meta', metaText);
      li.append(name, meta);
      list.append(li);
    }
    roster.append(list);
  }
  shell.append(roster);

  // Daily reward history
  const history = el('section', 'companion-card');
  history.append(el('h2', 'companion-section', t('companion.home.historyTitle')));
  history.append(renderHistoryList(t, model.history));
  shell.append(history);

  // Actions
  const actions = el('div', 'companion-actions');
  const play = el('a', 'companion-btn primary', t('companion.home.openGame'));
  play.href = model.playUrl;
  const refresh = el('button', 'companion-btn ghost', t('companion.home.refresh'));
  refresh.type = 'button';
  refresh.addEventListener('click', handlers.onRefresh);
  actions.append(play, refresh);
  shell.append(actions);

  root.append(shell);
}

export function renderLogin(
  root: HTMLElement,
  t: CompanionT,
  onSubmit: (username: string, password: string) => void,
  error: string | null,
  busy: boolean,
): void {
  root.replaceChildren();
  const shell = el('div', 'companion-shell companion-login');
  shell.append(el('h1', 'companion-title', t('companion.login.title')));
  shell.append(el('p', 'companion-meta', t('companion.login.help')));

  const user = document.createElement('input');
  user.type = 'text';
  user.autocomplete = 'username';
  user.placeholder = t('companion.login.username');
  user.className = 'companion-input';

  const pass = document.createElement('input');
  pass.type = 'password';
  pass.autocomplete = 'current-password';
  pass.placeholder = t('companion.login.password');
  pass.className = 'companion-input';

  const submit = el(
    'button',
    'companion-btn primary',
    busy ? t('companion.login.busy') : t('companion.login.submit'),
  );
  submit.type = 'button';
  submit.disabled = busy;
  submit.addEventListener('click', () => onSubmit(user.value.trim(), pass.value));
  pass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit.click();
  });

  shell.append(user, pass, submit);
  if (error) shell.append(el('p', 'companion-error', error));

  const play = el('a', 'companion-btn ghost', t('companion.home.openGame'));
  play.href = '/play';
  shell.append(play);

  root.append(shell);
}

export function renderLoading(root: HTMLElement, t: CompanionT): void {
  root.replaceChildren();
  root.append(el('div', 'companion-shell companion-loading', t('companion.home.loading')));
}
