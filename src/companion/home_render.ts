// DOM renderer for Companion Home. Player-facing strings go through `t`.

import type { CompanionHomeModel, SpinAction } from './home_model';
import { formatClaudium, formatResetCountdown } from './home_model';

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
  if (model.emptyRoster) {
    roster.append(el('p', 'companion-empty', t('companion.home.rosterEmpty')));
  } else {
    const list = el('ul', 'companion-roster');
    for (const c of model.roster) {
      const li = el('li', 'companion-roster-item');
      const name = el('span', 'companion-roster-name', c.name);
      const meta = el(
        'span',
        'companion-roster-meta',
        t('companion.home.rosterMeta', {
          level: c.level,
          classId: c.classId,
          online: c.online ? t('companion.home.online') : t('companion.home.offline'),
        }),
      );
      li.append(name, meta);
      list.append(li);
    }
    roster.append(list);
  }
  shell.append(roster);

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
