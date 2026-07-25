// First-party seed catalog for the plugin store: the plugins the store ships
// with so it is genuinely useful on day one, each authored against the public
// woc API v1 only (they double as living documentation and as the API's
// integration fixtures; tests/seed_plugins.test.ts validates every entry
// through the same submit-path validators community uploads face, and pins
// that each source screens CLEAN in plugin_screen.ts).
//
// Seed rows are first party: account_id NULL, author shown as the WoC team
// (the client's hudChrome.plugins.byTeam line). Applied by
// scripts/seed_plugins.ts (npm run db:seed-plugins), idempotent by slug: an
// unchanged seed is a no-op, a changed source or metadata lands as a new
// APPROVED version, exactly the update path a community author goes through
// minus the human review (the team reviews these in the PR instead).

import type { PluginCategory } from '../plugins';

export interface SeedPluginDef {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: PluginCategory;
  /** Source file name inside server/plugins_seed/. */
  file: string;
}

export const SEED_PLUGINS: readonly SeedPluginDef[] = [
  {
    slug: 'battle-scribe',
    name: 'Battle Scribe',
    summary: 'A personal damage meter with automatic pull tracking and a best-pull record.',
    description:
      'Battle Scribe watches your own combat events and turns them into a compact meter.\n\n' +
      'A pull starts with your first hit and closes after six quiet seconds. While you fight ' +
      'you see live DPS and your top abilities with bars; between fights it remembers the best ' +
      'pull of the session so you can tell whether the new rotation actually helped.',
    category: 'combat',
    file: 'battle_scribe.js',
  },
  {
    slug: 'loot-ledger',
    name: 'Loot Ledger',
    summary: 'Session gold and XP tracker with per-hour rates and a recent-loot list.',
    description:
      'How much did that dungeon actually pay? Loot Ledger tracks your gold and experience ' +
      'from login, works out per-hour rates, and keeps the last eight loot lines so the drop ' +
      'you half-noticed is one glance away. One button resets the session when you change spots.',
    category: 'economy',
    file: 'loot_ledger.js',
  },
  {
    slug: 'wayfarer-waypoints',
    name: 'Wayfarer Waypoints',
    summary: 'Save named spots and get live distance and direction to each one.',
    description:
      'Mark the rare spawn, the herb circuit, the meeting stone, the vendor with the good ' +
      'prices. Wayfarer keeps a named list of saved positions with a live distance and compass ' +
      'direction to each, sorted nearest first, and the list survives logout. Up to twelve ' +
      'waypoints, removable with one click.',
    category: 'tools',
    file: 'wayfarer_waypoints.js',
  },
  {
    slug: 'chat-chimes',
    name: 'Chat Chimes',
    summary: 'A soft chime and toast whenever someone says your name or whispers you.',
    description:
      'Tabbed out of the chat log mid-fight? Chat Chimes listens for your name across every ' +
      'channel and always rings for whispers, with a toast naming who wants you. Mute channels ' +
      'individually (looking at you, world chat) and your choices are remembered. Recent pings ' +
      'stay listed so you can catch up after the boss dies.',
    category: 'social',
    file: 'chat_chimes.js',
  },
  {
    slug: 'xp-forecast',
    name: 'XP Forecast',
    summary: 'Rolling XP per hour and a live estimate of the time to your next level.',
    description:
      'XP Forecast keeps a rolling ten-minute window of your experience gains and answers the ' +
      'only question that matters at 2am: how long until the level? XP per hour, remaining XP, ' +
      'average gain per kill, and a live time-to-level estimate that resets cleanly when you ' +
      'ding.',
    category: 'interface',
    file: 'xp_forecast.js',
  },
  {
    slug: 'adventure-journal',
    name: 'Adventure Journal',
    summary: 'A timestamped session diary of level ups, deeds, quests, deaths, and loot rolls.',
    description:
      'Your session, written down as it happens: level ups, deeds unlocked, quests turned in, ' +
      'the loot you rolled on, and every death (a lesson was probably learned). Entries carry ' +
      'timestamps, persist between sessions, and make guild recaps write themselves.',
    category: 'tools',
    file: 'adventure_journal.js',
  },
];
