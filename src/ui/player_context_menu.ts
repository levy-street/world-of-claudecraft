import {
  STREAMER_PLATFORMS,
  type StreamerLinks,
  type StreamerPlatform,
  streamerLinkList,
} from '../sim/account_flair';
import { type TranslationKey, t } from './i18n';
import type { UiIconName } from './ui_icons';

export type PlayerContextActionId =
  | 'info'
  | 'whisper'
  | 'invite'
  | 'friend'
  | 'unfriend'
  | 'ginvite'
  | 'ignore'
  | 'block'
  | 'report'
  | 'stream-twitch'
  | 'stream-x'
  | 'stream-kick'
  | 'stream-youtube'
  | 'close';

export interface PlayerContextAction {
  id: PlayerContextActionId;
  label: string;
  /** brand mark drawn inside the row (stream links only) */
  icon?: UiIconName;
  /** the external URL a stream-link row opens (already normalized) */
  href?: string;
}

export interface ChatPlayerContextState {
  playerName: string;
  selfName: string;
  online: boolean;
  isFriend: boolean;
  /** chat-only: hides their public chat from you. Toggles the Ignore/Unignore label. */
  ignored: boolean;
  /** the heavy tool: also kills invites, whispers, mail and /who. Online only. */
  blocked: boolean;
  canGuildInvite: boolean;
  alreadyGuilded: boolean;
  canReport: boolean;
  /** an official streamer's platform links, when the server sent any for this player */
  streamerLinks?: StreamerLinks;
}

const STREAM_ACTION: Record<
  StreamerPlatform,
  { id: PlayerContextActionId; icon: UiIconName; labelKey: TranslationKey }
> = {
  twitch: { id: 'stream-twitch', icon: 'twitch', labelKey: 'hudChrome.playerMenu.watchTwitch' },
  x: { id: 'stream-x', icon: 'x', labelKey: 'hudChrome.playerMenu.watchX' },
  kick: { id: 'stream-kick', icon: 'kick', labelKey: 'hudChrome.playerMenu.watchKick' },
  youtube: {
    id: 'stream-youtube',
    icon: 'youtube',
    labelKey: 'hudChrome.playerMenu.watchYouTube',
  },
};

/** The platform a stream-link row opens; null for every other menu row. */
export function streamerActionPlatform(id: PlayerContextActionId): StreamerPlatform | null {
  for (const platform of STREAMER_PLATFORMS) {
    if (STREAM_ACTION[platform].id === id) return platform;
  }
  return null;
}

/**
 * The stream-link rows for a player, in the STREAMER_PLATFORMS render order and
 * present-only. `streamerLinkList` re-validates every URL, so a link that is not a
 * plain https URL on that platform's own host never becomes a row at all. Both
 * player menus (the chat-name one and the nameplate/unit-frame one) build their
 * rows from this single source of truth, so the two can never disagree.
 */
export function streamerMenuActions(links: StreamerLinks | undefined): PlayerContextAction[] {
  return streamerLinkList(links).map(({ platform, url }) => {
    const def = STREAM_ACTION[platform];
    return { id: def.id, label: t(def.labelKey), icon: def.icon, href: url };
  });
}

export function chatPlayerContextActions(state: ChatPlayerContextState): PlayerContextAction[] {
  const samePlayer = state.playerName.toLowerCase() === state.selfName.toLowerCase();
  const actions: PlayerContextAction[] = [];

  // The streamer's own channels lead, right under the title: they are the reason a
  // player opens the menu on a broadcaster's name at all. They make sense on
  // yourself too (a streamer checking their own links), so like Player Info below
  // they sit outside the samePlayer guard.
  actions.push(...streamerMenuActions(state.streamerLinks));

  // Player Info leads the social block, and is offered even for a player who is
  // nowhere near you: online it falls back to the public character sheet, so a name
  // you only ever saw in /world or /lfg still resolves. It is the one social row
  // that makes sense on yourself, so it sits outside the samePlayer guard.
  actions.push({ id: 'info', label: t('hudChrome.playerMenu.info') });

  if (!samePlayer) {
    actions.push({ id: 'whisper', label: t('hud.chat.context.whisper') });
    actions.push({ id: 'invite', label: t('hud.chat.context.invite') });
    if (state.online) {
      actions.push({
        id: state.isFriend ? 'unfriend' : 'friend',
        label: state.isFriend
          ? t('hud.chat.context.removeFriend')
          : t('hud.chat.context.addFriend'),
      });
    }
    if (state.canGuildInvite && !state.alreadyGuilded) {
      actions.push({ id: 'ginvite', label: t('hud.chat.context.inviteGuild') });
    }
    // Ignore is the chat-only tier. It is NOT a "mute": a mute is the admin
    // account silence and is not something a player applies to anyone.
    actions.push({
      id: 'ignore',
      label: state.ignored ? t('hud.chat.context.unignore') : t('hud.chat.context.ignore'),
    });
    // Blocking is a server-side social action, so it only exists online.
    if (state.online) {
      actions.push({
        id: 'block',
        label: state.blocked ? t('hudChrome.playerMenu.unblock') : t('hudChrome.playerMenu.block'),
      });
    }
    if (state.canReport) actions.push({ id: 'report', label: t('hud.chat.context.report') });
  }

  actions.push({ id: 'close', label: t('hud.chat.context.cancel') });
  return actions;
}
