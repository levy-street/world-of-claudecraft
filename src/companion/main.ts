// Companion SPA entry: Home P0 (auth, daily spin, Claudium, roster).

import { CompanionApp } from './app';
import './companion.css';

// Minimal t(): English catalog embedded so the SPA boots before full locale
// pipeline is wired. Keys match companion.* in i18n.catalog for later swap to t().
const EN: Record<string, string> = {
  'companion.home.brand': 'WOC Companion',
  'companion.home.logout': 'Log out',
  'companion.home.dailyTitle': 'Daily rewards',
  'companion.home.dayLine': 'Day {day} · Resets in {reset}',
  'companion.home.scoreLine': 'Score {score} · Rank {rank}',
  'companion.home.unranked': '-',
  'companion.home.eligible': "Eligible for today's spin.",
  'companion.home.eligibility.noWallet':
    'Link a wallet in the game to become eligible for daily rewards.',
  'companion.home.eligibility.underMinimum': 'Hold more $WOC to meet the daily rewards minimum.',
  'companion.home.eligibility.priceUnavailable':
    'Daily rewards pricing is temporarily unavailable.',
  'companion.home.eligibility.banned': 'This account cannot use daily rewards right now.',
  'companion.home.eligibility.unknown': 'Not eligible for daily rewards.',
  'companion.home.spinCta': 'Spin now',
  'companion.home.spinClaimed': 'Claimed · +{points} pts',
  'companion.home.spinUnavailable': 'Spin unavailable',
  'companion.home.spinning': 'Spinning…',
  'companion.home.spinFailed': 'Spin failed. Try again.',
  'companion.home.playBalances': 'Play balances',
  'companion.home.claudium': 'Claudium',
  'companion.home.roster': 'Roster',
  'companion.home.rosterEmpty': 'No characters yet. Open the game to create one.',
  'companion.home.rosterMeta': 'Lv {level} {classId} · {online}',
  'companion.home.online': 'Online',
  'companion.home.offline': 'Offline',
  'companion.home.openGame': 'Open game',
  'companion.home.refresh': 'Refresh',
  'companion.home.loading': 'Loading…',
  'companion.home.loadFailed': 'Could not load companion data.',
  'companion.login.title': 'Sign in',
  'companion.login.help': 'Use your World of ClaudeCraft account.',
  'companion.login.username': 'Username',
  'companion.login.password': 'Password',
  'companion.login.submit': 'Sign in',
  'companion.login.busy': 'Signing in…',
  'companion.login.missingFields': 'Enter username and password.',
  'companion.login.failed': 'Sign-in failed.',
  'companion.login.sessionExpired': 'Session expired. Sign in again.',
  'companion.login.twoFactor': 'Two-factor login is required. Use the full game client.',
};

function t(key: string, vars?: Record<string, string | number>): string {
  let out = EN[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

const root = document.getElementById('root');
if (!root) throw new Error('companion root missing');

const app = new CompanionApp({ root, t, playUrl: '/play' });
void app.start();
