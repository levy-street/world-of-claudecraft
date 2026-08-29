// The classic `<Guild>` tag beside a player name: one builder for every
// surface that shows it (the highscore board, the leaderboard window, the
// Exchange's seller pane), extracted on the rule of three. Angle brackets
// are HTML entities, the nameplate convention (nameplate_painter.ts), not
// markup; empty for an unguilded name so the surrounding cell is
// byte-unchanged without a guild. Each surface passes its own class so its
// stylesheet family keeps addressing it.

import { esc } from './esc';
import { t } from './i18n';

export function guildTagHtml(guild: string | null | undefined, className: string): string {
  if (!guild) return '';
  return ` <span class="${className}" title="${esc(t('hudChrome.leaderboard.guildName'))}">&lt;${esc(guild)}&gt;</span>`;
}
